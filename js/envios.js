// Envios ao Roteirista (rotina radar-enviar): regra PURA, sem DOM e sem rede.
//
//   enviosAoRoteirista({selecao, decisoes, execucoes, projetos, agora, locais}) → um registro por
//   pauta que já foi mandada (ou está indo) ao Roteirista, com o estado real:
//     na-fila          linha `pedido` (ou `aguardando`), ou o registro otimista logo depois do envio
//     processando      linha `rodando`
//     parece-travada   linha ainda aberta há 2 h ou mais (ou sem início registrado)
//     enviada          linha `ok`, ou Seleção com status "enviada ao Roteirista"
//     falhou           linha `erro` / `parcial` / `travada` / `recusado-pela-trava`, com o texto
//     rascunho-chegou  já há projeto desse id no Drive (2-Roteiros)
//
// De onde saem os ids de uma linha radar-enviar (decisões do coordenador, item 2): o Radar
// SOBRESCREVE o resumo quando termina ("pauta S46-01 (lote S46-manual-1) enviada ao Roteirista…"),
// então (a) os ids de pauta (S\d{2}-\d{2}) achados no resumo (cobre "enviar S46-01, S46-02" da
// ponte e o texto do Radar) e o id_alvo; (b) sem id no texto, o id_lote da linha cruzado com
// Seleção.id_lote (só as pautas aprovadas ou já enviadas desse lote); (c) a Seleção com status
// "enviada ao Roteirista". Linhas de teste não contam.
//
// Uma conclusão `ok` nunca devolve a pauta para "Enviar ao Roteirista"; só `falhou` devolve
// (com "Tentar de novo").

import { horaCurta, ehTeste } from './parse.js';
import { estadoDasPautas, STATUS_PAUTA } from './selecao.js';
import { TRAVA_MS } from './controle.js';

export const ESTADOS_ENVIO = Object.freeze(['na-fila', 'processando', 'parece-travada', 'enviada', 'falhou', 'rascunho-chegou']);

/** Estados em que a pauta NÃO volta para "Enviar ao Roteirista" (envio ativo ou concluído). */
export const ENVIO_OCUPADO = new Set(['na-fila', 'processando', 'parece-travada', 'enviada', 'rascunho-chegou']);
/** Estados contados como "a caminho do Roteirista" (sem rascunho no Drive ainda). */
export const A_CAMINHO = new Set(['na-fila', 'processando', 'parece-travada', 'enviada']);

const ABERTOS = new Set(['pedido', 'rodando', 'aguardando']);
const FALHAS = new Set(['erro', 'parcial', 'travada', 'recusado-pela-trava']);
const RE_ID_PAUTA = /\bS\d{2}-\d{2}\b/g;

const ms = (d) => (d instanceof Date ? d.getTime() : d == null ? NaN : new Date(d).getTime());
const texto = (v) => String(v ?? '').trim();

/** Ids de pauta (S46-01…) num texto, sem repetir, na ordem em que aparecem. */
export function idsNoTexto(t) {
  return [...new Set(String(t ?? '').toUpperCase().match(RE_ID_PAUTA) || [])];
}

/**
 * Ids que uma linha `parcial` dá como ENVIADOS: os que aparecem num trecho (separado por ";", ponto
 * ou quebra de linha) que diz "enviada(s)" sem "não", "falhou" ou "erro". O "enviar S46-01, …" da
 * ponte não conta (ninguém confirmou o envio). Espelhado em ponte/Code.gs (paridade testada).
 */
export function idsEnviadosNoTexto(t) {
  const ids = [];
  for (const trecho of String(t ?? '').split(/[;\n]|\.(?:\s|$)/)) {
    if (!/enviad[ao]s?\b/i.test(trecho) || /\bn[aã]o\b|falh|erro/i.test(trecho)) continue;
    for (const id of idsNoTexto(trecho)) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Linhas radar-enviar de verdade (sem teste). */
const linhasEnviar = (execucoes) => (execucoes || []).filter((e) => e && e.rotina === 'radar-enviar' && !e.teste);

/**
 * Ids de pauta de uma linha radar-enviar: resumo + id_alvo; sem nenhum, o id_lote cruzado com a
 * Seleção (só as aprovadas ou já enviadas desse lote, para não pegar as recusadas).
 */
export function idsDaLinha(linha, { selecao = null, decisoes = null, est = null } = {}) {
  const ids = idsNoTexto(`${texto(linha?.resumo)} ${texto(linha?.id_alvo)}`);
  if (ids.length) return ids;
  const lote = texto(linha?.id_lote);
  if (!lote || !selecao?.pautas) return [];
  const estados = est || estadoDasPautas(selecao, decisoes);
  return selecao.pautas
    .filter((p) => texto(p.id_lote) === lote && !ehTeste(p.id_pauta))
    .filter((p) => [STATUS_PAUTA.aprovada, STATUS_PAUTA.enviada].includes(estados.get(p.id_pauta)?.status))
    .map((p) => p.id_pauta);
}

const maisNovaPrimeiro = (a, b) => (ms(b.inicioData) || -Infinity) - (ms(a.inicioData) || -Infinity) || (b._linha || 0) - (a._linha || 0);

/** Texto curto da falha (o erro da linha; senão o resumo; senão um padrão). Texto puro: esc() na tela. */
function textoDaFalha(l) {
  if (l.status === 'recusado-pela-trava') return texto(l.erro) || 'Outra rodada do Radar estava em andamento; nada foi enviado.';
  if (l.status === 'travada') return texto(l.erro) || 'A rodada parou sem terminar.';
  if (l.status === 'parcial') return texto(l.erro) || texto(l.resumo) || 'O Radar terminou só uma parte do envio.';
  return texto(l.erro) || texto(l.resumo) || 'O Radar não conseguiu enviar.';
}

/** O registro otimista {desde, chave} ainda vale? (sem linha com a chave, dentro do tempo da trava) */
function localValido(local, execucoes, t) {
  const desde = ms(local?.desde);
  if (Number.isFinite(desde) && t - desde >= TRAVA_MS) return false;
  const chave = texto(local?.chave);
  return !(chave && (execucoes || []).some((e) => texto(e?.chave_idem) === chave));
}

/**
 * Estado de cada pauta enviada (ou indo) ao Roteirista → array ordenado por id:
 *   {id_pauta, titulo, estado, desde (Date|null), texto, linha (a linha de Execuções ou null)}
 * `projetos`: os projetos do Drive (objetos com `id`, ou os próprios ids).
 * `locais`: registro otimista do app {id_pauta: {desde: Date|ms, chave}} até a releitura de Execuções.
 */
export function enviosAoRoteirista({ selecao = null, decisoes = null, execucoes = [], projetos = [], agora = new Date(), locais = {} } = {}) {
  const t = ms(agora);
  const est = selecao?.pautas ? estadoDasPautas(selecao, decisoes) : new Map();
  const noDrive = new Set((projetos || []).map((p) => (typeof p === 'string' ? p : p?.id)).filter(Boolean).map((id) => String(id).toUpperCase()));
  const pauta = new Map((selecao?.pautas || []).map((p) => [p.id_pauta, p]));

  // id → linhas radar-enviar que falam dele
  const porId = new Map();
  for (const l of linhasEnviar(execucoes)) {
    for (const id of idsDaLinha(l, { selecao, decisoes, est })) {
      if (!porId.has(id)) porId.set(id, []);
      porId.get(id).push(l);
    }
  }
  const ids = new Set([...porId.keys(), ...Object.keys(locais || {})]);
  for (const p of selecao?.pautas || []) if (p.status === STATUS_PAUTA.enviada) ids.add(p.id_pauta);

  const out = [];
  for (const id of ids) {
    if (!id || ehTeste(id)) continue;
    const linhas = (porId.get(id) || []).slice().sort(maisNovaPrimeiro);
    const p = pauta.get(id);
    const base = { id_pauta: id, titulo: texto(p?.titulo), desde: null, texto: '', linha: null };
    // `parcial` que dá este id como enviado conta como `ok` (a ponte também recusa reenviar: ja-enviada).
    const ok = linhas.find((l) => l.status === 'ok' || (l.status === 'parcial' && idsEnviadosNoTexto(l.resumo).includes(id)));
    const aberta = linhas.find((l) => ABERTOS.has(l.status));
    const falha = linhas.find((l) => FALHAS.has(l.status));
    const ultima = linhas[0] || null;
    const local = locais?.[id];
    let r;
    if (noDrive.has(String(id).toUpperCase())) r = { ...base, estado: 'rascunho-chegou', linha: ok || ultima };
    else if (ok) r = { ...base, estado: 'enviada', desde: ok.fimData || ok.inicioData || null, linha: ok };
    else if (p?.status === STATUS_PAUTA.enviada) r = { ...base, estado: 'enviada', linha: ultima };
    else if (aberta && aberta === ultima) {
      const inicio = ms(aberta.inicioData);
      const velha = !Number.isFinite(inicio) || t - inicio >= TRAVA_MS;
      r = { ...base, estado: velha ? 'parece-travada' : aberta.status === 'rodando' ? 'processando' : 'na-fila', desde: aberta.inicioData || null, linha: aberta };
    } else if (falha) r = { ...base, estado: 'falhou', desde: falha.fimData || falha.inicioData || null, texto: textoDaFalha(falha), linha: falha };
    else if (aberta) r = { ...base, estado: 'na-fila', desde: aberta.inicioData || null, linha: aberta };
    else r = null;

    // Registro otimista (logo depois de a ponte aceitar): vale até aparecer uma linha mais nova, a
    // linha com a mesma chave_idem (também a de teste) ou passar o tempo da trava.
    if (local && (!r || r.estado === 'falhou') && localValido(local, execucoes, t)) {
      const desdeLocal = ms(local.desde);
      const linhaDepois = r?.linha && Number.isFinite(ms(r.linha.inicioData)) && ms(r.linha.inicioData) >= desdeLocal - 60_000;
      if (!r || !linhaDepois) r = { ...base, estado: 'na-fila', desde: Number.isFinite(desdeLocal) ? new Date(desdeLocal) : null, texto: '', linha: null, otimista: true };
    }
    if (r) out.push(r);
  }
  return out.sort((a, b) => String(a.id_pauta).localeCompare(String(b.id_pauta)));
}

/** Mapa id_pauta → registro de enviosAoRoteirista. */
export const mapaDeEnvios = (envios) => new Map((envios || []).map((e) => [e.id_pauta, e]));

/** A pauta pode ir (de novo) ao Roteirista? Sem envio, ou com o último envio falho. */
export const podeEnviar = (envio) => !envio || !ENVIO_OCUPADO.has(envio.estado);

/** Pautas "a caminho do Roteirista" (enviadas, sem rascunho no Drive ainda). */
export const aCaminho = (envios) => (envios || []).filter((e) => A_CAMINHO.has(e.estado));

/** O texto de cada estado, no tom do app ("Na fila desde 21h58", "Falhou: …"). Texto puro. */
export function textoDoEnvio(e) {
  if (!e) return '';
  const h = e.desde ? horaCurta(e.desde) : '';
  switch (e.estado) {
    case 'na-fila': return h ? `Na fila desde ${h}` : 'Na fila';
    case 'processando': return h ? `Em processamento desde ${h}` : 'Em processamento';
    case 'parece-travada': return h ? `Parece travada: aberta desde ${h}` : 'Parece travada: a rodada não registrou o fim';
    case 'enviada': return 'Enviada, esperando o rascunho';
    case 'falhou': return `Falhou: ${e.texto || 'o Radar não conseguiu enviar.'}`;
    case 'rascunho-chegou': return 'O rascunho chegou';
    default: return '';
  }
}

/**
 * chave_idem ESTÁVEL do envio: `radar-enviar-<ids ordenados>-<n>`, com n = 1 + as linhas
 * radar-enviar que já falam de algum desses ids (no estilo de chaveIdemCandidato). Dois toques ou
 * dois aparelhos com a mesma tela mandam a mesma chave e a ponte não duplica; depois de uma falha,
 * a linha a mais muda o n e "Tentar de novo" vira um pedido novo. Só letras, números e hífen.
 */
export function chaveIdemEnvio(ids, execucoes = [], { selecao = null, decisoes = null } = {}) {
  const lista = [...new Set((ids || []).map((id) => texto(id).toUpperCase()).filter(Boolean))].sort();
  const alvo = new Set(lista);
  const est = selecao?.pautas ? estadoDasPautas(selecao, decisoes) : null;
  // Conta também as linhas de teste: no modo de teste, repetir também precisa de chave nova.
  const n = 1 + (execucoes || []).filter((l) => l?.rotina === 'radar-enviar').filter((l) => idsDaLinha(l, { selecao, decisoes, est }).some((id) => alvo.has(id))).length;
  return `radar-enviar-${lista.join('-').replace(/[^A-Za-z0-9-]/g, '')}-${n}`;
}
