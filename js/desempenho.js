// DESEMPENHO (puro, sem DOM nem rede): a aba Desempenho da planilha Radar, uma linha por vídeo e por rede.
// Colunas: id, data do post, visualizações, retenção média, envios, salvamentos, seguidores ganhos, rede
// (a coluna "rede" foi acrescentada em 15/11/2026; se faltar, o primeiro "Salvar" cria o cabeçalho dela no fim).
// O "Postei" grava id + data do post sem rede; os números entram nessa linha (com a rede) ou numa linha nova.
// O /retrospectiva do motor lê esta aba (bin/retrospectiva.py) e marca os vencedores.

import { normalizarCabecalho } from './parse.js';

export const REDES = ['Instagram', 'TikTok'];
export const NUMEROS = [
  ['visualizacoes', 'Visualizações', 'visualizações'],
  ['retencao', 'Retenção média (%)', 'retenção média'],
  ['envios', 'Envios', 'envios'],
  ['salvamentos', 'Salvamentos', 'salvamentos'],
  ['seguidores', 'Seguidores ganhos', 'seguidores ganhos'],
];
export const DIAS_PARA_NUMEROS = 7;
const DIA_MS = 86400000;

const texto = (v) => String(v ?? '').trim();
const ehTeste = (id) => /^T\d/i.test(id);

/** Aba lida (sheet.lerAba) → {cabecalho, linhaCabecalho (0-based), col: {nome→índice}, registros}. */
export function lerDesempenho(aba) {
  const linhas = aba?.linhas || [];
  const lc = aba?.linhaCabecalho ?? 0;
  const cabecalho = (aba?.cabecalho || []).map(texto);
  const col = {};
  cabecalho.forEach((c, i) => { const n = normalizarCabecalho(c); if (n && !(n in col)) col[n] = i; });
  const registros = [];
  for (let i = lc + 1; i < linhas.length; i++) {
    const l = linhas[i] || [];
    const id = texto(l[col.id]);
    if (!id) continue;
    const reg = { linha: i + 1, id, data: texto(l[col['data do post']]), rede: normalizarRede(l[col.rede]), numeros: {} };
    for (const [chave, , nome] of NUMEROS) {
      const c = col[normalizarCabecalho(nome)];
      reg.numeros[chave] = c === undefined ? '' : texto(l[c]);
    }
    registros.push(reg);
  }
  return { cabecalho, linhaCabecalho: lc, col, registros };
}

export function normalizarRede(v) {
  const n = normalizarCabecalho(v);
  if (n === 'instagram' || n === 'ig') return 'Instagram';
  if (n === 'tiktok' || n === 'tt') return 'TikTok';
  return '';
}

const temNumeros = (r) => Object.values(r.numeros).some((v) => v !== '');

/** Vídeos postados há 7 dias ou mais com rede ainda sem números → [{id, data, redes:[...]}] (sem testes). */
export function esperandoNumeros(lido, agora = new Date()) {
  const postados = new Map();
  for (const r of lido.registros) {
    if (ehTeste(r.id) || !/^\d{4}-\d{2}-\d{2}/.test(r.data)) continue;
    const d = r.data.slice(0, 10);
    if (!postados.has(r.id) || d < postados.get(r.id)) postados.set(r.id, d);
  }
  const out = [];
  for (const [id, data] of postados) {
    if ((agora.getTime() - Date.parse(`${data}T12:00:00-03:00`)) / DIA_MS < DIAS_PARA_NUMEROS) continue;
    const redes = REDES.filter((rede) => !lido.registros.some((r) => r.id === id && r.rede === rede && temNumeros(r)));
    if (redes.length) out.push({ id, data, redes });
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

/** "12.300", "12,3 mil", "45%", "45,5" → texto limpo para a planilha; vazio → ''; inválido → null. */
export function limparNumero(v, { porcentagem = false } = {}) {
  let t = texto(v).toLowerCase().replace(/\s+/g, ' ');
  if (!t) return '';
  if (porcentagem) t = t.replace(/%$/, '').trim();
  let mult = 1;
  const m = t.match(/^(.*?)\s*(mil|k|mi)$/);
  if (m) { t = m[1]; mult = m[2] === 'mi' ? 1e6 : 1e3; }
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  else if (/^\d+,\d+$/.test(t)) t = t.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t) * mult;
  if (!Number.isFinite(n) || n < 0) return null;
  return porcentagem ? String(Math.round(n * 10) / 10) : String(Math.round(n));
}

/**
 * Plano para gravar os números de um vídeo numa rede. → {ok:false, mensagem} |
 * {ok:true, cabecalhoRede: {linha, coluna} | null, celulas: [{linha, coluna, valor}] | null, novaLinha: [...] | null}
 * Linha 1-based; coluna 0-based. Ordem: a linha do mesmo id e rede; senão a do "Postei" (id sem rede e sem
 * números); senão uma linha nova no fim (com a data do post do vídeo).
 */
export function planejarNumeros(lido, { id, rede, valores }) {
  const vid = texto(id);
  if (!vid) return { ok: false, mensagem: 'Falta o id do vídeo.' };
  if (!REDES.includes(rede)) return { ok: false, mensagem: 'Escolha Instagram ou TikTok.' };
  if (!('id' in lido.col)) return { ok: false, mensagem: 'A aba Desempenho não tem a coluna "id".' };
  const limpos = {};
  for (const [chave, rotulo] of NUMEROS) {
    const v = limparNumero(valores?.[chave], { porcentagem: chave === 'retencao' });
    if (v === null) return { ok: false, mensagem: `${rotulo}: use só números (ex.: 12300 ou 12,3 mil).` };
    limpos[chave] = v;
  }
  if (!limpos.visualizacoes) return { ok: false, mensagem: 'Preencha pelo menos as visualizações.' };

  let colRede = lido.col.rede;
  let cabecalhoRede = null;
  if (colRede === undefined) {
    colRede = lido.cabecalho.length;
    cabecalhoRede = { linha: lido.linhaCabecalho + 1, coluna: colRede, valor: 'rede' };
  }
  const colDe = (nome) => lido.col[normalizarCabecalho(nome)];
  const alvo = lido.registros.find((r) => r.id === vid && r.rede === rede)
    || lido.registros.find((r) => r.id === vid && !r.rede && !temNumeros(r));
  if (alvo) {
    const celulas = [{ linha: alvo.linha, coluna: colRede, valor: rede }];
    for (const [chave, , nome] of NUMEROS) {
      const c = colDe(nome);
      if (c !== undefined) celulas.push({ linha: alvo.linha, coluna: c, valor: limpos[chave] });
    }
    return { ok: true, cabecalhoRede, celulas, novaLinha: null };
  }
  const data = lido.registros.find((r) => r.id === vid && r.data)?.data || '';
  const largura = Math.max(lido.cabecalho.length, colRede + 1);
  const linha = Array(largura).fill('');
  linha[lido.col.id] = vid;
  if (colDe('data do post') !== undefined) linha[colDe('data do post')] = data;
  for (const [chave, , nome] of NUMEROS) { const c = colDe(nome); if (c !== undefined) linha[c] = limpos[chave]; }
  linha[colRede] = rede;
  return { ok: true, cabecalhoRede, celulas: null, novaLinha: linha };
}

/** Nome do pedido de retrospectiva do dia (5-Prontos/retrospectivas/<AAAA-MM-DD> pedido.md). */
export function nomePedidoRetrospectiva(hojeIso) { return `${hojeIso} pedido.md`; }
export function textoPedidoRetrospectiva({ quem, quando }) {
  return `# Pedido de retrospectiva\npedido: retrospectiva\nquem: ${quem}\nquando: ${quando}\n`;
}

/** A retrospectiva mais nova entre os arquivos da pasta → o arquivo ou null. */
export function retrospectivaMaisNova(arquivos = []) {
  return arquivos
    .filter((f) => /^\d{4}-\d{2}-\d{2} retrospectiva\.md$/.test(String(f.name || '').trim()))
    .sort((a, b) => String(b.name).localeCompare(String(a.name)))[0] || null;
}
