// Funções puras: ids, nomes de arquivo, frontmatter, gerador de YAML, markdown simples, datas,
// pedido de ajustes (leitura e texto para copiar), nome de download e horários do pacote.
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

/**
 * Id de candidato da aba Candidatos (gravado pelo Radar diário): `AAAA-MM-DD-NN` (ex.:
 * `2026-11-14-01`), com `T` na frente nos de teste. Igual a ID_CANDIDATO_RE de ponte/Code.gs.
 */
export const ID_CANDIDATO_RE = /^T?\d{4}-\d{2}-\d{2}-\d{1,3}$/;

export function idCandidatoValido(id) {
  return typeof id === 'string' && ID_CANDIDATO_RE.test(id);
}

/** Candidato de teste: o id começa com T (como os ids T do resto do app). */
export function ehCandidatoTeste(id) {
  return /^T/i.test(String(id ?? '').trim());
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
const RE_GANCHOS = padrao(' ganchos v(\\d+)\\.md');
const RE_ESCOLHA_GANCHO = padrao(' gancho v(\\d+)\\.md');
const RE_APROVADO_ROTEIRO = padrao(' - (.+)\\.md');
const RE_PREVIA = padrao(' (IG|TT) v(\\d+)\\.mp4');
const RE_STORYBOARD = padrao(' storyboard (IG|TT) v(\\d+)\\.jpe?g');
// storyboard antes das prévias (desde 15/11/2026): "<id> storyboard vN.md", a pasta "<id> storyboard vN/" e a decisão dela
const RE_STORYBOARD_MD = padrao(' storyboard v(\\d+)\\.md');
const RE_PASTA_STORYBOARD = padrao(' storyboard v(\\d+)');
const RE_DECISAO_STORYBOARD = padrao(' decisao storyboard v(\\d+)\\.md');
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

/** `<id> ganchos v<N>.md` (os 3 ganchos que o motor propõe antes do roteiro, em rascunhos*) → {id, v}. */
export function parseGanchos(nome) {
  const m = comId(String(nome).match(RE_GANCHOS));
  return m ? { id: m[1], v: Number(m[2]) } : null;
}

/** `<id> gancho v<N>.md` (a escolha dela, que o app grava em rascunhos*) → {id, v}. */
export function parseEscolhaGancho(nome) {
  const m = comId(String(nome).match(RE_ESCOLHA_GANCHO));
  return m ? { id: m[1], v: Number(m[2]) } : null;
}

/** `<id> - <título>.md` (roteiro aprovado, na raiz de 2-Roteiros) → {id, titulo}. */
export function parseRoteiroAprovado(nome) {
  const m = comId(String(nome).match(RE_APROVADO_ROTEIRO));
  return m ? { id: m[1], titulo: m[2].trim() } : null;
}

/**
 * Arquivos de 4-Revisao → {id, tipo, v}. Tipos: ig, tt, sbIg, sbTt, notas, ajustes, aprovado, limpar, storyboard (o .md
 * do storyboard antes das prévias) e decisaoStoryboard (a decisão dela sobre ele).
 * `v` é null para aprovado/limpar.
 */
export function parseRevisao(nome) {
  const n = String(nome);
  let m = comId(n.match(RE_PREVIA));
  if (m) return { id: m[1], tipo: m[2].toLowerCase(), v: Number(m[3]) };
  m = comId(n.match(RE_STORYBOARD));
  if (m) return { id: m[1], tipo: m[2].toUpperCase() === 'IG' ? 'sbIg' : 'sbTt', v: Number(m[3]) };
  m = comId(n.match(RE_STORYBOARD_MD));
  if (m) return { id: m[1], tipo: 'storyboard', v: Number(m[2]) };
  m = comId(n.match(RE_DECISAO_STORYBOARD));
  if (m) return { id: m[1], tipo: 'decisaoStoryboard', v: Number(m[2]) };
  m = comId(n.match(RE_NOTAS_AJUSTES));
  if (m) return { id: m[1], tipo: m[2].toLowerCase(), v: Number(m[3]) };
  m = comId(n.match(RE_APROVADO_LIMPAR));
  if (m) return { id: m[1], tipo: m[2].toLowerCase(), v: null };
  return null;
}

/** Pasta de quadros do storyboard em 4-Revisao: `<id> storyboard vN` → {id, v}. */
export function parsePastaStoryboard(nome) {
  const m = comId(String(nome).trim().match(RE_PASTA_STORYBOARD));
  return m ? { id: m[1], v: Number(m[2]) } : null;
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

const formatadoresSeg = new Map();
/**
 * Data → {ano, mes, dia, hora, minuto, segundo, diaSemana} no fuso (números; diaSemana 0 = domingo),
 * ou null se a data for inválida.
 */
export function momentoNoFuso(data, tz = TIMEZONE) {
  const d = data instanceof Date ? data : new Date(data);
  if (Number.isNaN(d.getTime())) return null;
  if (!formatadoresSeg.has(tz)) {
    formatadoresSeg.set(tz, new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }));
  }
  const p = {};
  for (const { type, value } of formatadoresSeg.get(tz).formatToParts(d)) p[type] = Number(value);
  const diaSemana = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute, segundo: p.second, diaSemana };
}

/**
 * Data e hora "de parede" no fuso → Date. Aceita dia/hora fora do intervalo (dia 32 = dia 1 do mês
 * seguinte), o que serve para contas de calendário ("amanhã às 7h").
 */
export function dataNoFuso(ano, mes, dia, hora = 0, minuto = 0, segundo = 0, tz = TIMEZONE) {
  const alvo = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo);
  let t = alvo;
  for (let i = 0; i < 3; i++) {
    const p = momentoNoFuso(new Date(t), tz);
    const visto = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
    if (visto === alvo) break;
    t += alvo - visto;
  }
  return new Date(t);
}

/**
 * Célula de data e hora da planilha → Date (ou null se vazia/ilegível). Sem fuso escrito, vale o
 * horário de São Paulo. Aceita Date, número serial (dias desde 30/12/1899, a fração é a hora),
 * ISO com Z ou deslocamento, `AAAA-MM-DD[ HH:MM[:SS]]` (também com T) e `dd/mm/aaaa[ HH:MM[:SS]]`.
 */
export function lerDataHora(valor, tz = TIMEZONE) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor <= 0) return null;
    const ms = Math.round(valor * 86400000);
    const dia = new Date(Date.UTC(1899, 11, 30) + ms);
    return dataNoFuso(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(),
      dia.getUTCHours(), dia.getUTCMinutes(), dia.getUTCSeconds(), tz);
  }
  const s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) {
    const b = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (b) m = [b[0], b[3], b[2], b[1], b[4], b[5], b[6]];
  }
  if (m) {
    const [ano, mes, dia, h, mi, se] = m.slice(1).map((x) => Number(x || 0));
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || h > 23 || mi > 59 || se > 59) return null;
    return dataNoFuso(ano, mes, dia, h, mi, se, tz);
  }
  if (/^\d+(\.\d+)?$/.test(s)) return lerDataHora(Number(s), tz);
  return null;
}

const dois = (n) => String(n).padStart(2, '0');

/** Date → `AAAA-MM-DD HH:MM` no fuso de São Paulo (o formato das colunas de data da planilha). */
export function dataHoraPlanilha(data, tz = TIMEZONE) {
  const p = momentoNoFuso(data, tz);
  return p ? `${p.ano}-${dois(p.mes)}-${dois(p.dia)} ${dois(p.hora)}:${dois(p.minuto)}` : '';
}

/** Date → hora curta no fuso: "7h03", "10h12", "9h" (minuto zero não aparece). */
export function horaCurta(data, tz = TIMEZONE) {
  const p = momentoNoFuso(data, tz);
  if (!p) return '';
  return p.minuto ? `${p.hora}h${dois(p.minuto)}` : `${p.hora}h`;
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

/** Cabeçalho → chave de coluna: "Id Execução" → "id_execucao", "quem disparou" → "quem_disparou". */
export function chaveDeCabecalho(s) {
  return normalizarCabecalho(s).replace(/[\s\-–—]+/g, '_').replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/** Coluna canônica de uma célula de cabeçalho (pelo nome ou por um sinônimo), ou ''. */
export function colunaDoCabecalho(celula, colunas, sinonimos = {}) {
  const k = chaveDeCabecalho(celula);
  if (colunas.includes(k)) return k;
  const s = sinonimos[k];
  return s && colunas.includes(s) ? s : '';
}

/**
 * Cabeçalho (lista de células) → {coluna canônica: índice 0-based}. O nome canônico vence o
 * sinônimo; com a mesma coluna repetida, vale a primeira.
 */
export function indicesDoCabecalho(cabecalho, colunas, sinonimos = {}) {
  const exatos = {};
  const porSinonimo = {};
  (cabecalho || []).forEach((celula, i) => {
    const k = chaveDeCabecalho(celula);
    if (colunas.includes(k)) { if (!(k in exatos)) exatos[k] = i; return; }
    const s = sinonimos[k];
    if (s && colunas.includes(s) && !(s in porSinonimo)) porSinonimo[s] = i;
  });
  return { ...porSinonimo, ...exatos };
}

const celulaTexto = (v) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Linhas de uma aba (matriz alinhada à célula A1) → tabela lida pelo cabeçalho.
 * O cabeçalho é a primeira das 10 primeiras linhas com pelo menos `minimo` colunas conhecidas.
 * Devolve {encontrado, linhaCabecalho (0-based), cabecalho, indices, registros}; cada registro tem
 * todas as `colunas` (texto sem espaços nas pontas; '' quando a coluna não existe) e `_linha`, o
 * número da linha na planilha (1-based). Linhas vazias ficam de fora.
 */
export function lerTabela(linhas, { colunas, sinonimos = {}, minimo = 2 } = {}) {
  const ls = Array.isArray(linhas) ? linhas : [];
  for (let r = 0; r < Math.min(ls.length, 10); r++) {
    const indices = indicesDoCabecalho(ls[r] || [], colunas, sinonimos);
    if (Object.keys(indices).length < Math.min(minimo, colunas.length)) continue;
    const registros = [];
    for (let i = r + 1; i < ls.length; i++) {
      const linha = ls[i] || [];
      if (!linha.some((v) => celulaTexto(v) !== '')) continue;
      const reg = { _linha: i + 1 };
      for (const c of colunas) reg[c] = c in indices ? celulaTexto(linha[indices[c]]) : '';
      registros.push(reg);
    }
    return { encontrado: true, linhaCabecalho: r, cabecalho: [...(ls[r] || [])], indices, registros };
  }
  return { encontrado: false, linhaCabecalho: -1, cabecalho: [], indices: {}, registros: [] };
}

/**
 * Valores {coluna canônica: valor} → linha na ORDEM DO CABEÇALHO REAL da aba. Colunas que o app
 * não conhece (ou repetidas) ficam vazias; valores sem coluna no cabeçalho ficam de fora.
 */
export function linhaNaOrdem(cabecalho, valores, colunas, sinonimos = {}) {
  const usadas = new Set();
  return (cabecalho || []).map((celula) => {
    const c = colunaDoCabecalho(celula, colunas, sinonimos);
    if (!c || usadas.has(c)) return '';
    usadas.add(c);
    const v = valores[c];
    return v === null || v === undefined ? '' : String(v);
  });
}

/** Letra(s) da coluna 0-based: 0 → "A", 26 → "AA". */
export function letraColuna(c) {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * `values` de uma resposta do Sheets (values.get) → matriz alinhada à célula A1, usando o
 * `range` devolvido ("'Seleção'!B3:K20" começa na linha 3, coluna B).
 */
export function alinharAoA1(values, range = '') {
  const r = String(range);
  const m = r.slice(r.lastIndexOf('!') + 1).match(/^\$?([A-Z]+)?\$?(\d+)?/i);
  let col = 0;
  if (m?.[1]) for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  const desloc = Math.max(0, col - 1);
  const linha = m?.[2] ? Math.max(0, Number(m[2]) - 1) : 0;
  const corpo = (values || []).map((l) => (desloc ? [...Array(desloc).fill(''), ...(l || [])] : [...(l || [])]));
  return [...Array.from({ length: linha }, () => []), ...corpo];
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

/* ------------------------------------------------- pedido de ajustes (4-Revisao) */

/** 'ig' | 'tt' | 'ambas' a partir do que o Diretor escreveu (aceita "ambos", "instagram", "tiktok"). */
export function versaoDoAjuste(valor) {
  const v = String(valor ?? '').trim().toLowerCase();
  if (v === 'ig' || v === 'instagram') return 'ig';
  if (v === 'tt' || v === 'tiktok') return 'tt';
  return 'ambas';
}

const numeroDaVersao = (v) => {
  const m = String(v ?? '').trim().match(/^v?(\d+)$/i);
  return m ? Number(m[1]) : null;
};

/**
 * Lê `4-Revisao/<id> ajustes v<N>.md` (frontmatter de formatos.md) →
 * {id, versaoBase, decisao, ajustes:[{versao, tempo, pedido, como}], observacoes}, ou null sem frontmatter.
 * Só os campos do contrato; o resto é ignorado. Itens sem pedido nem tempo ficam de fora.
 */
export function parseAjustes(texto) {
  if (typeof texto !== 'string') return null;
  const linhas = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < linhas.length && linhas[i].trim() === '') i++;
  if (i >= linhas.length || linhas[i].trim() !== '---') return null;
  let fim = -1;
  for (let j = i + 1; j < linhas.length; j++) if (linhas[j].trim() === '---') { fim = j; break; }
  if (fim < 0) return null;

  const out = { id: '', versaoBase: null, decisao: '', ajustes: [], observacoes: '' };
  const itens = [];
  let naLista = false;
  let atual = null;
  for (const linha of linhas.slice(i + 1, fim)) {
    if (!linha.trim() || /^\s*#/.test(linha)) continue;
    const topo = linha.match(/^([A-Za-z_][\w-]*)\s*:(.*)$/);
    if (topo) {
      atual = null;
      const k = topo[1].toLowerCase();
      const v = limparValor(topo[2]);
      naLista = k === 'ajustes';
      if (k === 'id') out.id = v;
      else if (k === 'versao_base') out.versaoBase = numeroDaVersao(v);
      else if (k === 'decisao') out.decisao = v.toLowerCase();
      else if (k === 'observacoes') out.observacoes = v;
      continue;
    }
    if (!naLista) continue;
    const item = linha.match(/^\s*-\s*(?:([A-Za-z_][\w-]*)\s*:(.*))?$/);
    if (item) {
      atual = {};
      itens.push(atual);
      if (item[1]) atual[item[1].toLowerCase()] = limparValor(item[2]);
      continue;
    }
    const campo = linha.match(/^\s+([A-Za-z_][\w-]*)\s*:(.*)$/);
    if (campo && atual) atual[campo[1].toLowerCase()] = limparValor(campo[2]);
  }
  out.ajustes = itens
    .map((a) => ({
      versao: versaoDoAjuste(a.versao),
      tempo: String(a.tempo || '').trim(),
      pedido: String(a.pedido || '').trim(),
      como: String(a.como || '').trim(),
    }))
    .filter((a) => a.pedido || a.tempo);
  return out;
}

/** "0:12" → {de: 12, ate: null}; "0:00-0:03" (também com travessão e espaços) → {de: 0, ate: 3}; inválido → {de: null, ate: null}. */
export function segundosDoTempo(texto) {
  const seg = (s) => {
    const m = String(s || '').trim().match(/^(?:(\d+):)?(\d+):(\d{2})$/);
    return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  };
  const [de, ate] = String(texto || '').split(/\s*[-–—]\s*/);
  const d = seg(de);
  if (d === null) return { de: null, ate: null };
  const a = ate === undefined ? null : seg(ate);
  return { de: d, ate: a !== null && a > d ? a : null };
}

const NOME_DO_AJUSTE = { ig: 'Instagram', tt: 'TikTok', ambas: 'As duas versões' };
const umaLinha = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Lista de ajustes → texto simples para colar no chat, um por linha: "Instagram, em 0:12: pedido (como)". */
export function textoDosAjustes(lista) {
  return (lista || []).map((a) => {
    const tempo = umaLinha(a.tempo);
    const como = umaLinha(a.como);
    return `${NOME_DO_AJUSTE[versaoDoAjuste(a.versao)]}${tempo ? `, em ${tempo}` : ''}: ${umaLinha(a.pedido)}${como ? ` (${como})` : ''}`;
  }).join('\n');
}

/* ------------------------------------------------------------- pacotes */

/**
 * Nome com que um arquivo do pacote é salvo: o original; nas subpastas, "<subpasta>-<nome>"
 * (carrossel/01.png → carrossel-01.png). Tira caracteres que os sistemas não aceitam em nome de arquivo.
 */
export function nomeDownload(nome, sub = '') {
  const limpo = (s) => String(s ?? '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-');
  const n = limpo(nome) || 'arquivo';
  const s = limpo(sub).toLowerCase();
  return s ? `${s}-${n}` : n;
}

/**
 * Texto de horários sugeridos do pacote (agenda.md / horarios.txt) → {ig, tt}.
 * Linhas "Instagram: …" / "TikTok: …" (também IG/TT, com marcador de lista ou negrito) valem para a
 * rede; sem nenhuma delas, a primeira linha de texto vale para as duas. Sem texto: {ig: '', tt: ''}.
 */
export function sugestaoDaAgenda(texto) {
  const out = { ig: '', tt: '' };
  const linhas = String(texto || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
    .map((l) => l.trim()).filter(Boolean);
  let primeira = '';
  let noFrontmatter = linhas[0] === '---';
  for (const [i, l] of linhas.entries()) {
    if (noFrontmatter) { if (i > 0 && l === '---') noFrontmatter = false; continue; }
    if (/^#/.test(l)) continue;
    const s = l.replace(/^(?:[-*•]|\d+[.)])\s+/, '').replace(/\*\*/g, '').trim();
    const m = s.match(/^(instagram|ig|tiktok|tt)\s*[:–—-]\s*(.+)$/i);
    if (m) {
      const rede = /^(instagram|ig)$/i.test(m[1]) ? 'ig' : 'tt';
      if (!out[rede]) out[rede] = m[2].trim();
      continue;
    }
    if (!primeira && s) primeira = s;
  }
  if (!out.ig && !out.tt && primeira) return { ig: primeira, tt: primeira };
  return out;
}
