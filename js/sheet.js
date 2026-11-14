// Planilha do Radar.
// - "data do post" na aba Desempenho (ler os ids postados e gravar): dois caminhos, escolhidos pelo
//   mimeType do arquivo, Planilha Google nativa (Sheets API v4) ou .xlsx guardado no Drive
//   (SheetJS vendorizado, carregado sob demanda só aqui).
// - Abas do controle manual (Seleção, Decisões, Execuções): lerAba, acrescentarLinhas e
//   atualizarCelula, só na planilha nativa (Sheets API v4 values.get/append/update). Leituras com
//   cache curto, esquecido depois de gravar, no "Atualizar" e ao sair.

import { RADAR_SHEET, SHEETJS_URL, CACHE_MS } from './config.js';
import { api, metadados, baixarArrayBuffer, substituirConteudo } from './drive.js';
import { postadosDeLinhas, localizarColunasDesempenho, normalizarCabecalho, alinharAoA1, letraColuna } from './parse.js';

const MIME_NATIVA = 'application/vnd.google-apps.spreadsheet';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const ABA = 'Desempenho';

export class ErroPlanilha extends Error {
  constructor(mensagem, codigo = '') {
    super(mensagem);
    this.codigo = codigo;
  }
}

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

/* ------------------------------------------- abas do controle manual (nativa) */

const CACHE_ABA_MS = 20 * 1000;
let mimeCache = null; // promessa do mimeType da planilha (na sessão)
let titulosCache = null; // {quando, promessa} dos nomes das abas
const abasCache = new Map(); // nome normalizado da aba → {quando, promessa}

// Depois de gravar: as próximas leituras vão à planilha.
function esquecerLeituras() {
  abasCache.clear();
}

/** Esquece as leituras das abas, os nomes das abas e o formato da planilha ("Atualizar" e sair). */
export function invalidarAbas() {
  esquecerLeituras();
  titulosCache = null;
  mimeCache = null;
}

async function exigirNativa() {
  if (!mimeCache) {
    mimeCache = metadados(RADAR_SHEET, 'mimeType').then((m) => m.mimeType);
    mimeCache.catch(() => { mimeCache = null; });
  }
  const mime = await mimeCache;
  if (mime === MIME_XLSX) {
    throw new ErroPlanilha('A planilha do Radar está em .xlsx: as abas Seleção, Decisões e Execuções só funcionam pelo app numa Planilha Google nativa.', 'xlsx');
  }
  if (mime !== MIME_NATIVA) throw new ErroPlanilha('A planilha do Radar está num formato que o app não reconhece.', 'formato');
}

function titulos() {
  if (titulosCache && Date.now() - titulosCache.quando < CACHE_ABA_MS) return titulosCache.promessa;
  const promessa = api(`${SHEETS}/${RADAR_SHEET}?fields=${encodeURIComponent('sheets.properties.title')}`)
    .then((r) => r.json()).then((j) => (j.sheets || []).map((s) => s.properties?.title).filter(Boolean));
  titulosCache = { quando: Date.now(), promessa };
  promessa.catch(() => { if (titulosCache?.promessa === promessa) titulosCache = null; });
  return promessa;
}

/** Título real da aba (sem diferença de acento, caixa ou espaços), ou erro "a aba X ainda não existe". */
async function tituloReal(nome) {
  await exigirNativa();
  const alvo = normalizarCabecalho(nome);
  const t = (await titulos()).find((x) => normalizarCabecalho(x) === alvo);
  if (!t) throw new ErroPlanilha(`A aba "${nome}" ainda não existe na planilha.`, 'aba-ausente');
  return t;
}

/** Faixa A1 com o nome da aba entre aspas simples (aspas internas dobradas), já para a URL. */
function faixa(titulo, resto = '') {
  return encodeURIComponent(`'${String(titulo).replace(/'/g, "''")}'${resto ? `!${resto}` : ''}`);
}

/**
 * Lê uma aba inteira da planilha nativa → {aba (título real), linhas (matriz alinhada à A1),
 * cabecalho (a primeira linha com algum texto), linhaCabecalho (0-based)}.
 * Aba que não existe: ErroPlanilha com codigo 'aba-ausente' e a mensagem para a tela.
 */
export function lerAba(nome, { forcar = false } = {}) {
  const chave = normalizarCabecalho(nome);
  const guardado = abasCache.get(chave);
  if (!forcar && guardado && Date.now() - guardado.quando < CACHE_ABA_MS) return guardado.promessa;
  const promessa = (async () => {
    const titulo = await tituloReal(nome);
    const r = await api(`${SHEETS}/${RADAR_SHEET}/values/${faixa(titulo)}?majorDimension=ROWS`);
    const j = await r.json();
    const linhas = alinharAoA1(j.values || [], j.range || '');
    const linhaCabecalho = linhas.findIndex((l) => (l || []).some((v) => String(v ?? '').trim() !== ''));
    return { aba: titulo, linhas, cabecalho: linhaCabecalho >= 0 ? [...linhas[linhaCabecalho]] : [], linhaCabecalho };
  })();
  abasCache.set(chave, { quando: Date.now(), promessa });
  promessa.catch(() => { if (abasCache.get(chave)?.promessa === promessa) abasCache.delete(chave); });
  return promessa;
}

/**
 * Acrescenta linhas no fim da tabela da aba (values.append, RAW, INSERT_ROWS): o texto vai como
 * está, sem virar fórmula nem data. Cada linha já vem na ordem do cabeçalho real, a partir da
 * coluna A.
 */
export async function acrescentarLinhas(nome, linhas) {
  if (!Array.isArray(linhas) || !linhas.length) return { atualizadas: 0 };
  const titulo = await tituloReal(nome);
  try {
    const r = await api(`${SHEETS}/${RADAR_SHEET}/values/${faixa(titulo, 'A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ majorDimension: 'ROWS', values: linhas.map((l) => l.map((v) => (v === null || v === undefined ? '' : String(v)))) }),
    });
    const j = await r.json();
    return { atualizadas: j.updates?.updatedRows ?? linhas.length, faixa: j.updates?.updatedRange || '' };
  } finally {
    esquecerLeituras();
  }
}

/** Grava uma célula (values.update, RAW). `linha`: número da linha (1-based); `coluna`: índice 0-based ou letra. */
export async function atualizarCelula(nome, linha, coluna, valor) {
  const l = Number(linha);
  if (!Number.isInteger(l) || l < 1) throw new ErroPlanilha('Linha inválida.');
  const letra = typeof coluna === 'number' ? (Number.isInteger(coluna) && coluna >= 0 ? letraColuna(coluna) : '') : String(coluna || '').toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(letra)) throw new ErroPlanilha('Coluna inválida.');
  const titulo = await tituloReal(nome);
  const celula = `${letra}${l}`;
  try {
    await api(`${SHEETS}/${RADAR_SHEET}/values/${faixa(titulo, celula)}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ range: `'${titulo.replace(/'/g, "''")}'!${celula}`, majorDimension: 'ROWS', values: [[valor === null || valor === undefined ? '' : String(valor)]] }),
    });
  } finally {
    esquecerLeituras();
  }
}
