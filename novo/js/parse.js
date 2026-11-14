// Funções puras: ids, nomes de arquivo, frontmatter, gerador de YAML, markdown simples, datas.
// Nada aqui toca DOM, rede ou armazenamento — tudo testável com `node --test`.

import { TIMEZONE } from './config.js';

/* ------------------------------------------------------------------ ids */

const ID_SRC = 'S\\d{2}-\\d{2}|T\\d{2}(?:-\\d{2})?|R\\d{3}';
export const ID_RE = /^(S\d{2}-\d{2}|T\d{2}(-\d{2})?|R\d{3})$/;

export function idValido(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

export function ehTeste(id) {
  return idValido(id) && id.startsWith('T');
}

/** Id no começo do nome, seguido de espaço ou ponto ("S46-03 bruto.MOV", "T01.mp4"). */
export function idNoInicio(nome) {
  const m = String(nome || '').match(new RegExp(`^(${ID_SRC})(?=[ .])`));
  return m && idValido(m[1]) ? m[1] : null;
}

// Compila um padrão de nome de arquivo cujo primeiro grupo é o id. Case-insensitive no resto
// do nome; o id capturado é validado depois com ID_RE (que é sensível à caixa).
function padrao(resto) {
  return new RegExp(`^(${ID_SRC})${resto}$`, 'i');
}

const RE_RASCUNHO = padrao(' (?:.+ )?rascunho v(\\d+)\\.md');
const RE_FONTES = padrao(' fontes\\.md');
const RE_APROVADO_ROTEIRO = padrao(' - (.+)\\.md');
const RE_PREVIA = padrao(' (IG|TT) v(\\d+)\\.mp4');
const RE_STORYBOARD = padrao(' storyboard (IG|TT) v(\\d+)\\.jpe?g');
const RE_NOTAS_AJUSTES = padrao(' (notas|ajustes) v(\\d+)\\.md');
const RE_APROVADO_LIMPAR = padrao(' (aprovado|limpar)\\.md');
const RE_PACOTE = padrao('(?: - (.+))?');
const RE_VENCEDOR = padrao(' vencedor\\.md');
const RE_VIDEO = /\.(mp4|mov|m4v)$/i;

function comId(m) {
  return m && idValido(m[1]) ? m : null;
}

/** `<id> rascunho v<N>.md` ou `<id> <qualquer coisa> rascunho v<N>.md` → {id, v}. */
export function parseRascunho(nome) {
  const m = comId(String(nome).match(RE_RASCUNHO));
  return m ? { id: m[1], v: Number(m[2]) } : null;
}

/** `<id> fontes.md` → {id}. */
export function parseFontes(nome) {
  const m = comId(String(nome).match(RE_FONTES));
  return m ? { id: m[1] } : null;
}

/** `<id> - <título>.md` (roteiro aprovado, na raiz de 2-Roteiros) → {id, titulo}. */
export function parseRoteiroAprovado(nome) {
  const m = comId(String(nome).match(RE_APROVADO_ROTEIRO));
  return m ? { id: m[1], titulo: m[2].trim() } : null;
}

/**
 * Arquivos de 4-Revisao → {id, tipo, v}. Tipos: ig, tt, sbIg, sbTt, notas, ajustes, aprovado, limpar.
 * `v` é null para aprovado/limpar.
 */
export function parseRevisao(nome) {
  const n = String(nome);
  let m = comId(n.match(RE_PREVIA));
  if (m) return { id: m[1], tipo: m[2].toLowerCase(), v: Number(m[3]) };
  m = comId(n.match(RE_STORYBOARD));
  if (m) return { id: m[1], tipo: m[2].toUpperCase() === 'IG' ? 'sbIg' : 'sbTt', v: Number(m[3]) };
  m = comId(n.match(RE_NOTAS_AJUSTES));
  if (m) return { id: m[1], tipo: m[2].toLowerCase(), v: Number(m[3]) };
  m = comId(n.match(RE_APROVADO_LIMPAR));
  if (m) return { id: m[1], tipo: m[2].toLowerCase(), v: null };
  return null;
}

export function ehVideo(nome) {
  return RE_VIDEO.test(String(nome || ''));
}

/** Arquivo de 3-Brutos → {id|null, ext} ou null se não for vídeo. */
export function parseBruto(nome) {
  const n = String(nome || '');
  if (!ehVideo(n)) return null;
  return { id: idNoInicio(n), ext: extensao(n) };
}

/** Pasta de pacote em 5-Prontos: `<id> - <título>` (ou só `<id>`) → {id, titulo}. */
export function parsePacote(nomePasta) {
  const m = comId(String(nomePasta).trim().match(RE_PACOTE));
  return m ? { id: m[1], titulo: (m[2] || '').trim() } : null;
}

/** `<id> vencedor.md` → {id}. */
export function parseVencedor(nome) {
  const m = comId(String(nome).match(RE_VENCEDOR));
  return m ? { id: m[1] } : null;
}

/** Extensão como veio (sem o ponto), ex. "MOV". */
export function extensao(nome) {
  const n = String(nome || '');
  const i = n.lastIndexOf('.');
  return i > 0 ? n.slice(i + 1) : '';
}

/** Nome do bruto no Drive: `<id> bruto.<extensão original>`. */
export function nomeBruto(id, nomeOriginal) {
  return `${id} bruto.${extensao(nomeOriginal)}`;
}

/**
 * Classifica um arquivo de pacote em 5-Prontos. `sub` = nome da subpasta (carrossel/stories) ou ''.
 * Retorna {tipo, ordem?}. Tipos: ig, igSemMusica, tt, ttSemMusica, capaIg, capaTt, carrossel,
 * stories, threads, legendaIg, legendaTt, creditos, agenda, outro.
 */
export function classificarArquivoPacote(nome, sub = '') {
  const n = String(nome || '');
  const s = String(sub || '').toLowerCase();
  if (s === 'carrossel' || s === 'stories') {
    const ordem = parseInt(n, 10);
    return { tipo: s, ordem: Number.isFinite(ordem) ? ordem : 999 };
  }
  const low = n.toLowerCase();
  const m = n.match(/^\S+ (IG|TT)( sem musica)?\.mp4$/i);
  if (m) {
    const base = m[1].toLowerCase();
    return { tipo: m[2] ? `${base}SemMusica` : base };
  }
  if (/^capa-instagram\.(jpe?g|png)$/.test(low)) return { tipo: 'capaIg' };
  if (/^capa-tiktok\.(jpe?g|png)$/.test(low)) return { tipo: 'capaTt' };
  if (low === 'threads.txt') return { tipo: 'threads' };
  if (low === 'legenda-instagram.txt') return { tipo: 'legendaIg' };
  if (low === 'legenda-tiktok.txt') return { tipo: 'legendaTt' };
  if (low === 'creditos.md') return { tipo: 'creditos' };
  if (/^(agenda|horarios)\.(md|txt)$/.test(low)) return { tipo: 'agenda' };
  return { tipo: 'outro' };
}

/* ---------------------------------------------------------- frontmatter */

export const CAMPOS_ROTEIRO = [
  'id', 'titulo', 'plataformas', 'extras', 'duracao_alvo', 'formato', 'cta',
  'valido_ate', 'status', 'teste', 'bruto',
];

// Limpa o valor de uma linha `chave: valor`: aspas (com escapes) ou comentário `# …` no fim.
function limparValor(bruto) {
  const v = bruto.trim();
  if (v.startsWith('"')) {
    let out = '';
    for (let i = 1; i < v.length; i++) {
      const c = v[i];
      if (c === '\\' && i + 1 < v.length) { out += v[++i]; continue; }
      if (c === '"') return out;
      out += c;
    }
    return out; // aspas não fechadas: devolve o que houver
  }
  if (v.startsWith("'")) {
    let out = '';
    for (let i = 1; i < v.length; i++) {
      if (v[i] === "'") {
        if (v[i + 1] === "'") { out += "'"; i++; continue; }
        return out;
      }
      out += v[i];
    }
    return out;
  }
  if (v.startsWith('#')) return '';
  return v.replace(/\s+#.*$/, '').trim();
}

/**
 * Lê o bloco entre `---` no começo do texto e devolve {chave: valor} só com as linhas de nível
 * superior `chave: valor` (linhas indentadas, listas e comentários são ignorados).
 * Retorna null se não houver frontmatter.
 */
export function extrairFrontmatter(texto) {
  if (typeof texto !== 'string') return null;
  const linhas = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < linhas.length && linhas[i].trim() === '') i++;
  if (i >= linhas.length || linhas[i].trim() !== '---') return null;
  let fim = -1;
  for (let j = i + 1; j < linhas.length; j++) {
    if (linhas[j].trim() === '---') { fim = j; break; }
  }
  if (fim < 0) return null;
  const obj = {};
  for (const linha of linhas.slice(i + 1, fim)) {
    const m = linha.match(/^([A-Za-z_][\w-]*)\s*:(.*)$/);
    if (!m) continue;
    obj[m[1].toLowerCase()] = limparValor(m[2]);
  }
  return obj;
}

/** Frontmatter do roteiro, só com os campos do contrato. */
export function parseFrontmatterRoteiro(texto) {
  const fm = extrairFrontmatter(texto);
  if (!fm) return null;
  const out = {};
  for (const k of CAMPOS_ROTEIRO) if (k in fm) out[k] = fm[k];
  return out;
}

/* -------------------------------------------------------- gerador YAML */

/** Texto livre → string YAML entre aspas duplas; `\` e `"` escapados, quebras viram espaço. */
export function yamlTexto(valor) {
  const v = String(valor ?? '')
    .replace(/\r\n|\r|\n/g, ' ')
    // demais caracteres de controle também viram espaço (YAML não aceita crus entre aspas)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .trim();
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function exigirId(id) {
  if (!idValido(id)) throw new Error(`Id inválido: ${id}`);
}

function exigirVersao(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Versão inválida: ${v}`);
  return n;
}

/** Conteúdo de `4-Revisao/<id> aprovado.md`. */
export function gerarAprovacao({ id, versao, observacoes = '' }) {
  exigirId(id);
  const v = exigirVersao(versao);
  return [
    '---',
    `id: ${id}`,
    `versao_aprovada: ${v}`,
    'decisao: aprovar',
    `observacoes: ${yamlTexto(observacoes)}`,
    '---',
  ].join('\n') + '\n';
}

export const VERSOES_AJUSTE = ['ig', 'tt', 'ambas'];

/** Conteúdo de `4-Revisao/<id> ajustes v<N>.md`. */
export function gerarAjustes({ id, versaoBase, ajustes, observacoes = '' }) {
  exigirId(id);
  const v = exigirVersao(versaoBase);
  if (!Array.isArray(ajustes) || ajustes.length === 0) throw new Error('Inclua pelo menos um ajuste.');
  const linhas = ['---', `id: ${id}`, `versao_base: ${v}`, 'decisao: ajustar', 'ajustes:'];
  for (const a of ajustes) {
    const versao = String(a.versao || '').toLowerCase();
    if (!VERSOES_AJUSTE.includes(versao)) throw new Error(`Versão de ajuste inválida: ${a.versao}`);
    if (!String(a.pedido || '').trim()) throw new Error('Cada ajuste precisa dizer o que mudar.');
    linhas.push(`  - versao: ${versao}`);
    if (String(a.tempo || '').trim()) linhas.push(`    tempo: ${yamlTexto(a.tempo)}`);
    linhas.push(`    pedido: ${yamlTexto(a.pedido)}`);
    if (String(a.como || '').trim()) linhas.push(`    como: ${yamlTexto(a.como)}`);
  }
  linhas.push(`observacoes: ${yamlTexto(observacoes)}`, '---');
  return linhas.join('\n') + '\n';
}

/* --------------------------------------------------- markdown simples */

/**
 * Quebra um markdown simples em blocos (para renderizar com textContent, nunca innerHTML):
 * {tipo:'titulo', nivel, texto} | {tipo:'lista', itens:[...]} | {tipo:'tabela', linhas:[[...]]}
 * | {tipo:'paragrafo', linhas:[...]}.
 */
export function blocosMarkdown(texto) {
  const linhas = String(texto || '').replace(/\r\n?/g, '\n').split('\n');
  const blocos = [];
  let atual = null;
  const fechar = () => { if (atual) blocos.push(atual); atual = null; };
  for (const bruta of linhas) {
    const l = bruta.replace(/\s+$/, '');
    if (!l.trim()) { fechar(); continue; }
    const tit = l.match(/^\s*(#{1,6})\s+(.*)$/);
    if (tit) { fechar(); blocos.push({ tipo: 'titulo', nivel: tit[1].length, texto: tit[2].trim() }); continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      if (atual?.tipo !== 'tabela') { fechar(); atual = { tipo: 'tabela', linhas: [] }; }
      const celulas = l.trim().slice(1, -1).split('|').map((c) => c.trim());
      // linha separadora |---|:--:| é descartada
      if (!celulas.every((c) => /^:?-+:?$/.test(c))) atual.linhas.push(celulas);
      continue;
    }
    const item = l.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (atual?.tipo !== 'lista') { fechar(); atual = { tipo: 'lista', itens: [] }; }
      atual.itens.push(item[1]);
      continue;
    }
    if (atual?.tipo !== 'paragrafo') { fechar(); atual = { tipo: 'paragrafo', linhas: [] }; }
    atual.linhas.push(l.trim());
  }
  fechar();
  return blocos;
}

/* ---------------------------------------------------------------- datas */

const formatadores = new Map();
function partesNoFuso(data, tz = TIMEZONE) {
  const d = data instanceof Date ? data : new Date(data);
  if (Number.isNaN(d.getTime())) return null;
  if (!formatadores.has(tz)) {
    formatadores.set(tz, new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
  }
  const p = {};
  for (const { type, value } of formatadores.get(tz).formatToParts(d)) p[type] = value;
  return { ano: Number(p.year), mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute };
}

/** ISO (createdTime do Drive) → `dd/mm HH:mm` no fuso de São Paulo. */
export function formatarDataHora(iso, tz = TIMEZONE) {
  const p = partesNoFuso(iso, tz);
  return p ? `${p.dia}/${p.mes} ${p.hora}:${p.minuto}` : '';
}

/** ISO → `dd/mm` no fuso de São Paulo. */
export function formatarData(iso, tz = TIMEZONE) {
  const p = partesNoFuso(iso, tz);
  return p ? `${p.dia}/${p.mes}` : '';
}

/** Data `AAAA-MM-DD` (sem fuso) → `dd/mm`. */
export function dataCurta(aaaaMmDd) {
  const m = String(aaaaMmDd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : '';
}

/** Hoje (ou `data`) em São Paulo como `AAAA-MM-DD`. */
export function hojeISO(data = new Date(), tz = TIMEZONE) {
  const p = partesNoFuso(data, tz);
  return `${p.ano}-${p.mes}-${p.dia}`;
}

/** Hora (0–23) em São Paulo. */
export function horaNoFuso(data = new Date(), tz = TIMEZONE) {
  return Number(partesNoFuso(data, tz).hora);
}

/** Semana ISO 8601 da data no fuso dado → {ano, semana}. */
export function semanaIso(data = new Date(), tz = TIMEZONE) {
  const p = partesNoFuso(data, tz);
  const d = new Date(Date.UTC(p.ano, Number(p.mes) - 1, Number(p.dia)));
  const diaSemana = d.getUTCDay() || 7; // segunda = 1 … domingo = 7
  d.setUTCDate(d.getUTCDate() + 4 - diaSemana); // quinta-feira da mesma semana
  const anoIso = d.getUTCFullYear();
  const semana = Math.ceil(((d - Date.UTC(anoIso, 0, 1)) / 86400000 + 1) / 7);
  return { ano: anoIso, semana };
}

/** Prefixo de id da semana atual, ex. "S46". */
export function prefixoSemana(data = new Date(), tz = TIMEZONE) {
  return 'S' + String(semanaIso(data, tz).semana).padStart(2, '0');
}

/**
 * Normaliza uma célula "data do post" para `AAAA-MM-DD` (ou '' se vazia/ilegível).
 * Aceita número serial do Excel, Date, `AAAA-MM-DD…`, `dd/mm/aaaa`.
 */
export function normalizarDataPost(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(valor) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(valor).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d+(\.\d+)?$/.test(s)) return normalizarDataPost(Number(s));
  return s ? s : '';
}

/* ------------------------------------------------------ planilha (puro) */

/** Texto de cabeçalho comparável: sem acento, minúsculas, espaços simples. */
export function normalizarCabecalho(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Localiza o cabeçalho da aba Desempenho nas primeiras linhas: devolve
 * {linha, colId, colData} (índices 0-based) ou null.
 */
export function localizarColunasDesempenho(linhas) {
  const max = Math.min(linhas.length, 10);
  for (let r = 0; r < max; r++) {
    const norm = (linhas[r] || []).map(normalizarCabecalho);
    const colId = norm.indexOf('id');
    const colData = norm.indexOf('data do post');
    if (colId >= 0 && colData >= 0) return { linha: r, colId, colData };
  }
  return null;
}

/** Linhas da aba Desempenho → Map id → `AAAA-MM-DD` (só ids com data preenchida). */
export function postadosDeLinhas(linhas) {
  const out = new Map();
  const cab = localizarColunasDesempenho(linhas || []);
  if (!cab) return out;
  for (let r = cab.linha + 1; r < linhas.length; r++) {
    const linha = linhas[r] || [];
    const id = String(linha[cab.colId] ?? '').trim();
    const data = normalizarDataPost(linha[cab.colData]);
    if (id && data) out.set(id, data);
  }
  return out;
}

/* ------------------------------------------------------------- tamanhos */

/** Bytes → "12,3 MB" / "1,25 GB". */
export function formatarBytes(n) {
  const b = Number(n) || 0;
  const fmt = (v, casas) => v.toFixed(casas).replace('.', ',');
  if (b >= 1024 ** 3) return `${fmt(b / 1024 ** 3, 2)} GB`;
  if (b >= 1024 ** 2) return `${fmt(b / 1024 ** 2, 1)} MB`;
  if (b >= 1024) return `${fmt(b / 1024, 0)} KB`;
  return `${b} B`;
}
