// FICHA: o texto livre que o Radar grava (ex.: a coluna `angulo` da aba Candidatos) organizado para a
// tela. O Radar escreve rótulos em MAIÚSCULAS seguidos de dois-pontos ("PERGUNTA: …", "REFERÊNCIAS
// (consultado só o resumo): …"); aqui o texto é cortado nesses rótulos, a pergunta vira o título e os
// números saem de frases como "230.111 impressões, 929 salvamentos".
//
// Puro (sem DOM, sem rede): testado em tests/ficha.test.mjs. As funções devolvem texto puro, menos
// htmlTextoRadar, que devolve HTML já escapado (links só https).

import { esc, hrefSeguro } from '../util.js';

/** Rótulos conhecidos do Radar → nome na tela. Os desconhecidos viram "Primeira maiúscula". */
export const ROTULOS_RADAR = {
  'PÚBLICO/SITUAÇÃO': 'Para quem',
  PERGUNTA: 'Pergunta',
  ENTREGA: 'Entrega',
  ORIGENS: 'Origem',
  DATAS: 'Datas',
  'REFERÊNCIAS': 'Referências',
  LIMITES: 'Limites',
};

/** Ordem das seções recolhidas na ficha (as desconhecidas vêm depois, na ordem do texto). */
const ORDEM_SECOES = ['PÚBLICO/SITUAÇÃO', 'REFERÊNCIAS', 'LIMITES', 'ORIGENS', 'DATAS'];

// Rótulo: 4+ letras maiúsculas (aceita / e espaço no meio), um parêntese opcional e dois-pontos.
// "CFP/CRP." e "DOI 10.1002" não casam: falta o dois-pontos logo depois.
const ROTULO = /(?<=^|[\s.;(])(\p{Lu}[\p{Lu}/ ]{2,}\p{Lu})(?:\s*\(([^)]*)\))?:\s*/gu;

const nomeDoRotulo = (chave) => ROTULOS_RADAR[chave]
  || (chave ? chave.charAt(0) + chave.slice(1).toLowerCase() : '');

/** "X DATAS" (uma palavra em maiúscula antes de um rótulo conhecido): separa o rótulo do que veio antes. */
function partirChave(chave) {
  if (ROTULOS_RADAR[chave]) return ['', chave];
  const conhecida = Object.keys(ROTULOS_RADAR).find((k) => chave.endsWith(` ${k}`));
  return conhecida ? [chave.slice(0, -conhecida.length).trim(), conhecida] : ['', chave];
}

/**
 * Texto do Radar → [{chave, rotulo, nota, texto}]. `chave` '' é o trecho antes do primeiro rótulo.
 * Sem rótulos: uma parte só, sem rótulo. Vazio: [].
 */
export function separarTextoRadar(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return [];
  const achados = [...t.matchAll(ROTULO)];
  if (!achados.length) return [{ chave: '', rotulo: '', nota: '', texto: t }];
  const partes = [];
  let antes = t.slice(0, achados[0].index);
  achados.forEach((m, i) => {
    const [sobra, chave] = partirChave(m[1].trim());
    if (sobra) antes = `${antes} ${sobra}`;
    if (i === 0) {
      if (antes.trim()) partes.push({ chave: '', rotulo: '', nota: '', texto: antes.trim() });
    } else {
      partes[partes.length - 1].texto = `${partes[partes.length - 1].texto} ${sobra}`.trim();
    }
    const fim = i + 1 < achados.length ? achados[i + 1].index : t.length;
    partes.push({ chave, rotulo: nomeDoRotulo(chave), nota: (m[2] || '').trim(), texto: t.slice(m.index + m[0].length, fim).trim() });
  });
  return partes;
}

const maiuscula = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Título curto a partir de um texto corrido: inteiro se couber, senão a primeira frase; o resto (ou tudo) vai ao Resumo. */
function tituloCurto(texto, limite) {
  if (texto.length <= limite) return { titulo: texto, resto: '' };
  const m = texto.match(/^(.+?[.?!])\s+([\s\S]+)$/);
  if (m && m[1].length <= limite) return { titulo: m[1], resto: m[2].trim() };
  const corte = texto.slice(0, limite).replace(/\s+\S*$/, '');
  return { titulo: `${corte}…`, resto: texto };
}

/**
 * Texto do Radar → {titulo, entrega, secoes:[{rotulo, nota, texto}]} (texto puro).
 * Título = PERGUNTA; sem ela, o trecho sem rótulo (curto) ou a primeira frase dele.
 */
export function fichaDoTexto(texto, { limiteTitulo = 160 } = {}) {
  const partes = separarTextoRadar(texto);
  const pergunta = partes.find((p) => p.chave === 'PERGUNTA');
  const entrega = partes.find((p) => p.chave === 'ENTREGA');
  const solto = partes.find((p) => p.chave === '');
  const secoes = [];
  let titulo = '';
  if (pergunta) {
    titulo = maiuscula(pergunta.texto);
    if (solto) secoes.push({ rotulo: 'Resumo', nota: '', texto: solto.texto });
  } else if (solto) {
    const c = tituloCurto(solto.texto, limiteTitulo);
    titulo = c.titulo;
    if (c.resto) secoes.push({ rotulo: 'Resumo', nota: '', texto: c.resto });
  }
  const resto = partes.filter((p) => p.chave && p.chave !== 'PERGUNTA' && p.chave !== 'ENTREGA' && p.texto);
  const pos = (p) => { const i = ORDEM_SECOES.indexOf(p.chave); return i < 0 ? ORDEM_SECOES.length : i; };
  resto.map((p, i) => [p, i]).sort((a, b) => pos(a[0]) - pos(b[0]) || a[1] - b[1])
    .forEach(([p]) => secoes.push({ rotulo: p.rotulo, nota: p.nota, texto: p.texto }));
  return { titulo, entrega: entrega ? entrega.texto : '', secoes };
}

const COMPACTO = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const NUMERO_COM_ROTULO = /(\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?)\s+(impressões|visualizações|views|curtidas|comentários|reposts|compartilhamentos|salvamentos)/giu;

/** "230.111 impressões, 929 salvamentos" → [{valor:'230,1 mil', rotulo:'impressões'}, …] (um por rótulo). */
export function numerosDoTexto(texto) {
  const vistos = new Set();
  const out = [];
  for (const m of String(texto ?? '').matchAll(NUMERO_COM_ROTULO)) {
    const rotulo = m[2].toLowerCase();
    if (vistos.has(rotulo)) continue;
    vistos.add(rotulo);
    const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
    out.push({ valor: COMPACTO.format(n), rotulo });
  }
  return out;
}

/** "(1) a; (2) b" → ['a', 'b']; sem numeração, o texto inteiro. */
export function referenciasEmLista(texto) {
  const t = String(texto ?? '').trim();
  const itens = t.split(/\(\d+\)\s+/).map((s) => s.trim().replace(/[;,]$/, '').trim()).filter(Boolean);
  return itens.length > 1 || /^\(\d+\)\s/.test(t) ? itens : [t];
}

/** Texto → HTML escapado; endereços https viram link (http e o resto ficam como texto). */
export function htmlTextoRadar(texto) {
  const t = String(texto ?? '');
  let out = '';
  let ultimo = 0;
  for (const m of t.matchAll(/https?:\/\/[^\s<>]+/g)) {
    let url = m[0];
    while (/[.,;:!?]$/.test(url) || (url.endsWith(')') && !url.includes('('))) url = url.slice(0, -1);
    const href = hrefSeguro(url);
    out += esc(t.slice(ultimo, m.index));
    out += href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>` : esc(url);
    ultimo = m.index + url.length;
  }
  return out + esc(t.slice(ultimo));
}
