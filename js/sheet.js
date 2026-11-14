// Planilha do Radar: ler os ids postados e gravar "data do post" na aba Desempenho.
// Dois caminhos, escolhidos pelo mimeType do arquivo: Planilha Google nativa (Sheets API v4) ou
// .xlsx guardado no Drive (SheetJS vendorizado, carregado sob demanda só aqui).

import { RADAR_SHEET, SHEETJS_URL, CACHE_MS } from './config.js';
import { api, metadados, baixarArrayBuffer, substituirConteudo } from './drive.js';
import { postadosDeLinhas, localizarColunasDesempenho, normalizarCabecalho } from './parse.js';

const MIME_NATIVA = 'application/vnd.google-apps.spreadsheet';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const ABA = 'Desempenho';

export class ErroPlanilha extends Error {}

/* ------------------------------------------------------------ SheetJS */

let xlsxPromise = null;
function carregarSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SHEETJS_URL;
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new ErroPlanilha('Não foi possível carregar o leitor de planilhas.')));
    s.onerror = () => { xlsxPromise = null; s.remove(); reject(new ErroPlanilha('Não foi possível carregar o leitor de planilhas.')); };
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

function abaDesempenho(XLSX, wb) {
  const nome = wb.SheetNames.find((n) => normalizarCabecalho(n) === 'desempenho');
  if (!nome) throw new ErroPlanilha('A planilha do Radar não tem a aba "Desempenho".');
  return wb.Sheets[nome];
}

// Linhas da aba como matriz alinhada à célula A1 (para os índices baterem com o endereço).
function linhasDaAba(XLSX, ws) {
  if (!ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const linhas = [];
  for (let r = 0; r <= range.e.r; r++) {
    const linha = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cel = ws[XLSX.utils.encode_cell({ r, c })];
      linha.push(cel ? cel.v : null);
    }
    linhas.push(linha);
  }
  return linhas;
}

/* ------------------------------------------------------------ leitura */

async function lerLinhasNativa() {
  const r = await api(`${SHEETS}/${RADAR_SHEET}/values/${encodeURIComponent(`${ABA}!A:G`)}`);
  return (await r.json()).values || [];
}

async function lerXlsx() {
  const XLSX = await carregarSheetJs();
  const buf = await baixarArrayBuffer(RADAR_SHEET);
  const wb = XLSX.read(buf, { type: 'array', cellStyles: true, cellDates: false });
  return { XLSX, wb };
}

let postadosCache = null;

/** Map id → 'AAAA-MM-DD' dos ids com "data do post" preenchida (cache de 60 s). */
export function lerPostados(forcar = false) {
  if (!forcar && postadosCache && Date.now() - postadosCache.quando < CACHE_MS) return postadosCache.promessa;
  const promessa = (async () => {
    const meta = await metadados(RADAR_SHEET, 'mimeType,modifiedTime');
    if (meta.mimeType === MIME_NATIVA) return postadosDeLinhas(await lerLinhasNativa());
    if (meta.mimeType === MIME_XLSX) {
      const { XLSX, wb } = await lerXlsx();
      return postadosDeLinhas(linhasDaAba(XLSX, abaDesempenho(XLSX, wb)));
    }
    throw new ErroPlanilha('A planilha do Radar está num formato que o app não reconhece.');
  })();
  postadosCache = { quando: Date.now(), promessa };
  promessa.catch(() => { if (postadosCache?.promessa === promessa) postadosCache = null; });
  return promessa;
}

export function invalidarPostados() {
  postadosCache = null;
}

/* ------------------------------------------------------------ escrita */

function letraColuna(c) {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

async function marcarNativa(id, data) {
  const linhas = await lerLinhasNativa();
  const cab = localizarColunasDesempenho(linhas);
  if (!cab) throw new ErroPlanilha('Não encontrei as colunas "id" e "data do post" na aba Desempenho.');
  const r = linhas.findIndex((l, i) => i > cab.linha && String(l?.[cab.colId] ?? '').trim() === id);
  if (r >= 0) {
    const faixa = `${ABA}!${letraColuna(cab.colData)}${r + 1}`;
    await api(`${SHEETS}/${RADAR_SHEET}/values/${encodeURIComponent(faixa)}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ range: faixa, values: [[data]] }),
    });
    return;
  }
  const nova = [];
  nova[cab.colId] = id;
  nova[cab.colData] = data;
  for (let i = 0; i < nova.length; i++) if (nova[i] === undefined) nova[i] = '';
  const faixa = `${ABA}!A:G`;
  await api(`${SHEETS}/${RADAR_SHEET}/values/${encodeURIComponent(faixa)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [nova] }),
  });
}

// Altera só as células da Desempenho no workbook em memória.
function alterarWorkbook(XLSX, wb, id, data) {
  const ws = abaDesempenho(XLSX, wb);
  const linhas = linhasDaAba(XLSX, ws);
  const cab = localizarColunasDesempenho(linhas);
  if (!cab) throw new ErroPlanilha('Não encontrei as colunas "id" e "data do post" na aba Desempenho.');
  let r = linhas.findIndex((l, i) => i > cab.linha && String(l?.[cab.colId] ?? '').trim() === id);
  if (r < 0) {
    // última linha com algum conteúdo + 1
    r = linhas.length;
    while (r > cab.linha + 1 && (linhas[r - 1] || []).every((v) => v === null || v === '')) r--;
    ws[XLSX.utils.encode_cell({ r, c: cab.colId })] = { t: 's', v: id };
  }
  ws[XLSX.utils.encode_cell({ r, c: cab.colData })] = { t: 's', v: data };
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  range.e.r = Math.max(range.e.r, r);
  range.e.c = Math.max(range.e.c, cab.colId, cab.colData);
  ws['!ref'] = XLSX.utils.encode_range(range);
}

async function marcarXlsx(id, data) {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const antes = await metadados(RADAR_SHEET, 'mimeType,modifiedTime');
    const { XLSX, wb } = await lerXlsx();
    alterarWorkbook(XLSX, wb, id, data);
    const saida = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    // Alguém mexeu na planilha enquanto isso? Refaz leitura + alteração.
    const agora = await metadados(RADAR_SHEET, 'mimeType,modifiedTime');
    if (agora.modifiedTime !== antes.modifiedTime) continue;
    await substituirConteudo(RADAR_SHEET, new Blob([saida], { type: MIME_XLSX }), MIME_XLSX);
    return;
  }
  throw new ErroPlanilha('A planilha do Radar está sendo alterada por outra pessoa agora. Tente de novo em instantes.');
}

/** Grava "data do post" (AAAA-MM-DD) do id na aba Desempenho. */
export async function marcarPostado(id, data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ErroPlanilha('Data inválida.');
  const meta = await metadados(RADAR_SHEET, 'mimeType,modifiedTime');
  if (meta.mimeType === MIME_NATIVA) await marcarNativa(id, data);
  else if (meta.mimeType === MIME_XLSX) await marcarXlsx(id, data);
  else throw new ErroPlanilha('A planilha do Radar está num formato que o app não reconhece.');
  invalidarPostados();
}
