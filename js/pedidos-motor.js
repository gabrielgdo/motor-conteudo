// Pedidos e decisões gravados no Drive para o Motor Reels (puro: sem DOM, sem rede).
// O app escreve estes arquivos; o vigia é quem roda /radar e /roteirizar. Não passa pela ponte
// (Radar e Roteirista). Campos desconhecidos no pedido são ignorados (não são instruções).
// A decisão de roteiro e a escolha do gancho levam, quando ela respondeu, o campo `regras` (as respostas dela às
// perguntas de regra; js/regras.js).

import { linhasRegras, lerRegrasYaml } from './regras.js';

const TIPOS = Object.freeze(['busca', 'selecao', 'pauta-completa']);
const DECISOES_ROTEIRO = Object.freeze(['aprovar', 'mudar', 'recusar']);
const DECISOES_PAUTA = Object.freeze(['aprovada', 'recusada']);

const pad2 = (n) => String(n).padStart(2, '0');

/** Data/hora em ISO com offset de Brasília (−03:00), a partir de um Date. */
export function isoBrasilia(agora = new Date()) {
  const t = agora instanceof Date ? agora : new Date(agora);
  if (Number.isNaN(t.getTime())) return '';
  const brt = new Date(t.getTime() - 3 * 60 * 60 * 1000);
  return `${brt.getUTCFullYear()}-${pad2(brt.getUTCMonth() + 1)}-${pad2(brt.getUTCDate())}`
    + `T${pad2(brt.getUTCHours())}:${pad2(brt.getUTCMinutes())}:${pad2(brt.getUTCSeconds())}-03:00`;
}

const texto = (v) => String(v ?? '').trim();
const minusc = (v) => texto(v).toLowerCase();

function tiposLimpos(tipo) {
  const bruto = Array.isArray(tipo) ? tipo : String(tipo || '').split(/[,;]/);
  const vistos = new Set();
  const out = [];
  for (const t of bruto) {
    const k = minusc(t).replace(/\s+/g, '-');
    if (!TIPOS.includes(k) || vistos.has(k)) continue;
    vistos.add(k);
    out.push(k);
  }
  return out;
}

function idsLimpos(ids) {
  const bruto = Array.isArray(ids) ? ids : String(ids || '').split(/[,;\s]+/);
  const vistos = new Set();
  const out = [];
  for (const i of bruto) {
    const k = texto(i);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    out.push(k);
  }
  return out;
}

function inteiro(n, min, max) {
  const v = typeof n === 'number' ? n : Number(String(n || '').trim());
  if (!Number.isInteger(v) || v < min || v > max) return null;
  return v;
}

function yamlEsc(v) {
  const s = String(v ?? '');
  if (s === '') return '""';
  if (/[:#\n"'\\]/.test(s) || /^-/.test(s) || s !== s.trim()) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  return s;
}

function yamlVal(linha) {
  const i = linha.indexOf(':');
  if (i < 0) return '';
  let v = linha.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return v;
}

/** Nome fixo do pedido de busca em 1-Radar/. */
export const NOME_PEDIDO_BUSCA = 'pedido-busca.md';

export function nomeDecisoesSemana(semana) {
  const s = texto(semana) || 'S00';
  return `decisoes ${s}.md`;
}

export function nomeDecisaoRoteiro(id, versao) {
  return `${texto(id)} decisao v${Number(versao) || 0}.md`;
}

/** `<id> decisao v<N>.md` → {id, versao} ou null. Não confunde com rascunho. */
export function parseNomeDecisaoRoteiro(nome) {
  const m = String(nome || '').trim().match(/^(\S+) decisao v(\d+)\.md$/i);
  if (!m) return null;
  return { id: m[1], versao: Number(m[2]) };
}

/**
 * Lê um pedido-busca.md já gravado (para mesclar um pedido novo).
 * Campos desconhecidos são ignorados.
 */
export function lerPedidoBusca(textoMd = '') {
  const out = { quantidade: null, tipo: [], ids: [], teste: false, quem: '', quando: '' };
  for (const linha of String(textoMd || '').split(/\r?\n/)) {
    const l = linha.trim();
    if (!l || l.startsWith('#') || !l.includes(':')) continue;
    const chave = minusc(l.split(':')[0]);
    const v = yamlVal(l);
    if (chave === 'quantidade') out.quantidade = inteiro(v, 1, 15);
    else if (chave === 'tipo') out.tipo = tiposLimpos(v);
    else if (chave === 'ids') out.ids = idsLimpos(v);
    else if (chave === 'teste') out.teste = /^(sim|true|1|yes)$/i.test(v);
    else if (chave === 'quem') out.quem = minusc(v);
    else if (chave === 'quando') out.quando = texto(v);
  }
  return out;
}

/**
 * Monta um pedido. quantidade opcional (1–15). tipo: busca, selecao e/ou pauta-completa.
 */
export function planejarPedidoBusca({
  quantidade, tipo, tipos, ids = [], teste = false, quem = '', quando = null, existente = '',
} = {}) {
  const atual = lerPedidoBusca(existente);
  const tiposNovos = tiposLimpos(tipo ?? tipos);
  const tiposFinais = [...new Set([...atual.tipo, ...tiposNovos])];
  if (!tiposFinais.length) tiposFinais.push('busca');
  const qNovo = quantidade == null || quantidade === '' ? null : inteiro(quantidade, 1, 15);
  if (quantidade != null && quantidade !== '' && qNovo == null) {
    return { ok: false, erro: 'quantidade-invalida', mensagem: 'A quantidade precisa ser um inteiro de 1 a 15.' };
  }
  const qs = [atual.quantidade, qNovo].filter((n) => n != null);
  const quantidadeFinal = qs.length ? Math.max(...qs) : null;
  const idsFinais = [...new Set([...atual.ids, ...idsLimpos(ids)])];
  const pedido = {
    quantidade: quantidadeFinal,
    tipo: tiposFinais,
    ids: idsFinais,
    teste: !!(teste || atual.teste),
    quem: minusc(quem) || atual.quem,
    quando: isoBrasilia(quando || new Date()),
  };
  return { ok: true, pedido, texto: textoPedidoBusca(pedido), nome: NOME_PEDIDO_BUSCA };
}

export function textoPedidoBusca(pedido = {}) {
  const tipo = tiposLimpos(pedido.tipo).join(', ') || 'busca';
  const linhas = ['# Pedido de busca'];
  if (pedido.quantidade != null) linhas.push(`quantidade: ${pedido.quantidade}`);
  linhas.push(`tipo: ${tipo}`);
  linhas.push(`teste: ${pedido.teste ? 'sim' : 'nao'}`);
  linhas.push(`ids: ${idsLimpos(pedido.ids).join(', ')}`);
  if (pedido.quem) linhas.push(`quem: ${pedido.quem}`);
  if (pedido.quando) linhas.push(`quando: ${pedido.quando}`);
  linhas.push('');
  return linhas.join('\n');
}

/**
 * Arquivo de decisão de roteiro (YAML). quem deve ser o e-mail de quem está logado.
 * O motor ignora se quem não for o e-mail dela (e, no teste, "test"). `regras`: as respostas dela às perguntas de regra.
 */
export function textoDecisaoRoteiro({
  id, versao, decisao, pedido = '', motivo = '', regras = [], quem = '', quando = null,
} = {}) {
  const dec = minusc(decisao);
  return [
    '---',
    `id: ${texto(id)}`,
    `versao: ${Number(versao) || 0}`,
    `decisao: ${DECISOES_ROTEIRO.includes(dec) ? dec : texto(decisao)}`,
    `pedido: ${yamlEsc(pedido)}`,
    `motivo: ${yamlEsc(motivo)}`,
    ...linhasRegras(regras, texto(id)),
    `quem: ${minusc(quem)}`,
    `quando: ${isoBrasilia(quando || new Date())}`,
    '---',
    '',
  ].join('\n');
}

export function lerDecisaoRoteiro(textoMd = '') {
  const out = { id: '', versao: 0, decisao: '', pedido: '', motivo: '', quem: '', quando: '', regras: lerRegrasYaml(textoMd) };
  const m = String(textoMd || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return out;
  for (const linha of m[1].split(/\r?\n/)) {
    if (/^\s/.test(linha)) continue; // só campos de topo (os itens de `regras` são indentados)
    const l = linha.trim();
    if (!l.includes(':')) continue;
    const chave = minusc(l.split(':')[0]);
    const v = yamlVal(l);
    if (chave === 'id') out.id = texto(v);
    else if (chave === 'versao') out.versao = Number(v) || 0;
    else if (chave === 'decisao') out.decisao = minusc(v);
    else if (chave === 'pedido') out.pedido = v;
    else if (chave === 'motivo') out.motivo = v;
    else if (chave === 'quem') out.quem = minusc(v);
    else if (chave === 'quando') out.quando = texto(v);
  }
  return out;
}

/* Escolha do gancho (desde 15/11/2026): 2-Roteiros/rascunhos/<id> gancho vN.md, N = a versão dos ganchos escolhida.
   Lista fechada: id, versao, escolha (1 | 2 | 3 | outros), observacoes, regras (as respostas às perguntas de regra, só
   quando ela respondeu), quem, quando. */

export const ESCOLHAS_GANCHO = Object.freeze(['1', '2', '3', 'outros']);

export function nomeEscolhaGancho(id, versao) {
  return `${texto(id)} gancho v${Number(versao) || 0}.md`;
}

/** `<id> gancho v<N>.md` → {id, versao} ou null. Não confunde com os ganchos do motor ("ganchos vN"). */
export function parseNomeEscolhaGancho(nome) {
  const m = String(nome || '').trim().match(/^(\S+) gancho v(\d+)\.md$/i);
  return m ? { id: m[1], versao: Number(m[2]) } : null;
}

export function textoEscolhaGancho({ id, versao, escolha, observacoes = '', regras = [], quem = '', quando = null } = {}) {
  const e = minusc(escolha);
  return [
    '---',
    `id: ${texto(id)}`,
    `versao: ${Number(versao) || 0}`,
    `escolha: ${ESCOLHAS_GANCHO.includes(e) ? e : texto(escolha)}`,
    `observacoes: ${yamlEsc(observacoes)}`,
    ...linhasRegras(regras, texto(id)),
    `quem: ${minusc(quem)}`,
    `quando: ${isoBrasilia(quando || new Date())}`,
    '---',
    '',
  ].join('\n');
}

export function lerEscolhaGancho(textoMd = '') {
  const out = { id: '', versao: 0, escolha: '', observacoes: '', quem: '', quando: '', regras: lerRegrasYaml(textoMd) };
  const m = String(textoMd || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return out;
  for (const linha of m[1].split(/\r?\n/)) {
    if (/^\s/.test(linha)) continue; // só campos de topo
    const l = linha.trim();
    if (!l.includes(':')) continue;
    const chave = minusc(l.split(':')[0]);
    const v = yamlVal(l);
    if (chave === 'id') out.id = texto(v);
    else if (chave === 'versao') out.versao = Number(String(v).replace(/^v/i, '')) || 0;
    else if (chave === 'escolha') out.escolha = ESCOLHAS_GANCHO.includes(minusc(v)) ? minusc(v) : '';
    else if (chave === 'observacoes') out.observacoes = v.slice(0, 2000);
    else if (chave === 'quem') out.quem = minusc(v);
    else if (chave === 'quando') out.quando = texto(v);
  }
  return out;
}

/**
 * Decisões da semana (1-Radar/decisoes <semana>.md). Uma pauta por item.
 * itens: [{id_pauta|id, decisao: 'aprovada'|'recusada', motivo, id_candidato}]
 */
export function textoDecisoesSemana({ semana, itens = [], quem = '', quando = null } = {}) {
  const linhas = [
    `# Decisões ${texto(semana)}`,
    `quando: ${isoBrasilia(quando || new Date())}`,
    `quem: ${minusc(quem)}`,
    '',
  ];
  for (const it of itens) {
    const id = texto(it.id_pauta || it.id);
    const dec = minusc(it.decisao);
    if (!id) continue;
    linhas.push(`- id: ${id}`);
    linhas.push(`  decisao: ${DECISOES_PAUTA.includes(dec) ? dec : it.decisao}`);
    if (it.id_candidato) linhas.push(`  id_candidato: ${texto(it.id_candidato)}`);
    if (texto(it.motivo)) linhas.push(`  motivo: ${yamlEsc(it.motivo)}`);
    linhas.push('');
  }
  return linhas.join('\n');
}

/**
 * Itens do arquivo da semana derivados da aba Decisões (a fonte da verdade) mais as linhas que acabaram de ser
 * gravadas: a última decisão de cada pauta daquela semana, na ordem da planilha. O arquivo é sempre regravado
 * inteiro a partir daqui, então uma gravação nunca apaga a decisão de outra pauta e uma nova tentativa depois
 * de uma falha recria o arquivo. Ids T e de outras semanas ficam de fora.
 */
export function itensDaSemana({ semana, decisoes = [], novos = [] } = {}) {
  const alvo = String(semana || '').trim().toUpperCase();
  const porId = new Map();
  const antigas = [...(Array.isArray(decisoes) ? decisoes : [])].sort((a, b) => (a._linha || 0) - (b._linha || 0));
  for (const d of [...antigas, ...(Array.isArray(novos) ? novos : [])]) {
    const id = texto(d?.id_pauta || d?.id);
    if (!id || semanaDeIdPauta(id) !== alvo) continue;
    const dec = minusc(d.decisao);
    if (!DECISOES_PAUTA.includes(dec)) continue;
    porId.delete(id); // a mais nova vai para o fim, na ordem em que foi decidida
    porId.set(id, { id_pauta: id, decisao: dec, motivo: texto(d.motivo), id_candidato: texto(d.id_candidato) });
  }
  return [...porId.values()];
}

export function semanaDeIdPauta(id) {
  const m = String(id || '').trim().match(/^(S\d{2})-\d{2}$/i);
  return m ? m[1].toUpperCase() : '';
}

export { TIPOS as TIPOS_PEDIDO, DECISOES_ROTEIRO, DECISOES_PAUTA };
