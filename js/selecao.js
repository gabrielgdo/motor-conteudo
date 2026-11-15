// PAUTAS (puro: sem DOM, sem rede): abas Seleção e Decisões da planilha Radar.
//
//   lerSelecao(linhas) / lerDecisoes(linhas)   leitura pelo cabeçalho (tolerante a acento e caixa)
//   colunasDecisoesProntas(cabecalho)          as colunas novas de Decisões já existem?
//   estadoDasPautas / paraDecidir / decididas  o que a tela mostra
//   planejarDecisoes(...)                      o que gravar: linhas novas em Decisões (na ordem do
//                                              cabeçalho real) e o status na Seleção (por id_pauta)
//
// Regras: vale a primeira decisão gravada (app ou chat); mudança de ideia no app vira linha nova
// (nada é apagado) enquanto a pauta não foi enviada ao Roteirista; ids T nunca vão para
// Decisões; só a conta da Robertta (ALLOWED[0]) decide.

import { lerTabela, linhaNaOrdem, normalizarCabecalho, lerDataHora, dataHoraPlanilha, horaCurta, formatarData, hojeISO, ehTeste } from './parse.js';
import { podeDecidir } from './controle.js';

/* ------------------------------------------------------------ Seleção */

export const COLUNAS_SELECAO = [
  'id_pauta', 'id_candidato', 'semana', 'data_selecao', 'titulo', 'tema', 'rede', 'publico_situacao',
  'pergunta_central', 'entrega', 'por_que_agora', 'sinal_social', 'fundamentacao',
  'contribuicao_junguiana', 'estado_verificacao', 'restricao_principal', 'nota_v2', 'prazo',
  'ganchos_opcionais', 'status',
];
// O Radar vai acrescentar `id_lote` (CM-03); sem a coluna, id_lote fica vazio.
const COLUNAS_SELECAO_LIDAS = [...COLUNAS_SELECAO, 'id_lote'];

export const STATUS_PAUTA = Object.freeze({
  proposta: 'proposta', aprovada: 'aprovada', recusada: 'recusada', enviada: 'enviada ao Roteirista',
});

/** Status da Seleção como o app usa ('enviada ao Roteirista' para "Enviada ao roteirista" etc.). */
export function normalizarStatusPauta(v) {
  const s = normalizarCabecalho(v);
  if (!s) return '';
  if (s.startsWith('propost')) return STATUS_PAUTA.proposta;
  if (s.startsWith('enviad')) return STATUS_PAUTA.enviada;
  if (s.startsWith('aprovad')) return STATUS_PAUTA.aprovada;
  if (s.startsWith('recusad')) return STATUS_PAUTA.recusada;
  return s;
}

/**
 * Linhas da aba Seleção (matriz alinhada à A1) → {encontrado, cabecalho, indices, temIdLote, pautas}.
 * Cada pauta tem as colunas aprovadas + id_lote (texto), `status` normalizado, `statusOriginal` e
 * `_linha` (número da linha na planilha). Linhas sem id_pauta ficam de fora.
 */
export function lerSelecao(linhas) {
  const t = lerTabela(linhas, { colunas: COLUNAS_SELECAO_LIDAS, minimo: 3 });
  const pautas = t.registros.filter((r) => r.id_pauta)
    .map((r) => ({ ...r, statusOriginal: r.status, status: normalizarStatusPauta(r.status) }));
  return { encontrado: t.encontrado, cabecalho: t.cabecalho, indices: t.indices, temIdLote: 'id_lote' in t.indices, pautas };
}

/* ----------------------------------------------------------- Decisões */

export const COLUNAS_DECISOES_ANTIGAS = ['semana', 'pauta', 'decisao', 'motivo'];
export const COLUNAS_DECISOES_NOVAS = ['id_pauta', 'rede', 'id_candidato', 'id_lote', 'data', 'quem', 'origem'];
export const COLUNAS_DECISOES = [...COLUNAS_DECISOES_ANTIGAS, ...COLUNAS_DECISOES_NOVAS];

export const MENSAGEM_COLUNAS_DECISOES = 'A aba Decisões ainda não tem as colunas novas (id_pauta, rede, origem…). Peça ao Programador para criá-las.';

/** 'aprovada' | 'recusada' (aceita aprovar/aprovado/sim, recusar/recusado/não) ou o texto normalizado. */
export function normalizarDecisao(v) {
  const s = normalizarCabecalho(v);
  if (/^aprov/.test(s) || s === 'sim' || s === 'ok') return 'aprovada';
  if (/^recus/.test(s) || s === 'nao') return 'recusada';
  return s;
}

/**
 * Linhas da aba Decisões → {encontrado, cabecalho, indices, decisoes}. Cada decisão tem as 11
 * colunas (texto), `decisao` normalizada, `origem` em minúsculas e `_linha`.
 */
export function lerDecisoes(linhas) {
  const t = lerTabela(linhas, { colunas: COLUNAS_DECISOES, minimo: 3 });
  const decisoes = t.registros.map((r) => ({
    ...r, decisao: normalizarDecisao(r.decisao), origem: normalizarCabecalho(r.origem), quem: r.quem.toLowerCase(),
  }));
  return { encontrado: t.encontrado, cabecalho: t.cabecalho, indices: t.indices, decisoes };
}

/** As colunas novas (id_pauta, rede, id_candidato, id_lote, data, quem, origem) já estão no cabeçalho? */
export function colunasDecisoesProntas(cabecalho) {
  return colunasDecisoesFaltando(cabecalho).length === 0;
}

/** Colunas (antigas e novas) que faltam no cabeçalho de Decisões. */
export function colunasDecisoesFaltando(cabecalho) {
  const t = lerTabela([cabecalho || []], { colunas: COLUNAS_DECISOES, minimo: 1 });
  return COLUNAS_DECISOES.filter((c) => !(c in t.indices));
}

const listaDecisoes = (d) => (Array.isArray(d) ? d : d?.decisoes || []);
const listaPautas = (s) => (Array.isArray(s) ? s : s?.pautas || []);

/** Linhas de Decisões de um id_pauta, na ordem da planilha (a última é a que vale). */
export function decisoesDe(decisoes, idPauta) {
  const id = String(idPauta || '').trim();
  return listaDecisoes(decisoes).filter((d) => d.id_pauta === id).sort((a, b) => (a._linha || 0) - (b._linha || 0));
}

export function ultimaDecisao(decisoes, idPauta) {
  const l = decisoesDe(decisoes, idPauta);
  return l.length ? l[l.length - 1] : null;
}

/**
 * Estado de cada pauta: a última linha de Decisões do id_pauta (se houver), senão o status da
 * Seleção. Exceção: "enviada ao Roteirista" (gravado pelo Radar depois da aprovação, sem linha em
 * Decisões) continua valendo, porque é a etapa seguinte à aprovação.
 * → Map id_pauta → {status, decisao (linha ou null), fonte: 'decisoes' | 'selecao'}.
 */
export function estadoDasPautas(selecao, decisoes) {
  const out = new Map();
  for (const p of listaPautas(selecao)) {
    const u = ultimaDecisao(decisoes, p.id_pauta);
    if (u && p.status !== STATUS_PAUTA.enviada && (u.decisao === 'aprovada' || u.decisao === 'recusada')) {
      out.set(p.id_pauta, { status: u.decisao, decisao: u, fonte: 'decisoes' });
    } else {
      out.set(p.id_pauta, { status: p.status, decisao: u, fonte: 'selecao' });
    }
  }
  return out;
}

/**
 * A aprovação de um CANDIDATO em Decisões (a linha que a ponte grava no "Mandar ao Roteirista" de
 * radar-candidato: id_candidato preenchido, decisão aprovada; id_pauta vazio, porque a pauta ainda
 * não existia). A mais nova, ou null. Ela não decide a pauta: a pauta só é decidida por id_pauta.
 */
export function aprovacaoDoCandidato(decisoes, idCandidato) {
  const id = String(idCandidato || '').trim();
  if (!id) return null;
  return listaDecisoes(decisoes).filter((d) => d.id_candidato === id && !d.id_pauta && normalizarDecisao(d.decisao) === 'aprovada')
    .sort((a, b) => (b._linha || 0) - (a._linha || 0))[0] || null;
}

/**
 * Pautas "para decidir": status proposta na Seleção e nenhuma linha em Decisões com o id_pauta.
 * Uma aprovação do candidato (aprovacaoDoCandidato, sem id_pauta) não tira a pauta daqui: se o
 * Radar deixou a pauta como proposta (a verificação das fontes não passou), ela não foi ao
 * Roteirista e precisa de uma decisão nova, sobre a pauta já verificada.
 */
export function paraDecidir(selecao, decisoes) {
  const ids = new Set(listaDecisoes(decisoes).map((d) => d.id_pauta).filter(Boolean));
  return listaPautas(selecao).filter((p) => p.status === STATUS_PAUTA.proposta && !ids.has(p.id_pauta));
}

/** As demais (filtro "Decididas"), com o estado calculado. */
export function decididas(selecao, decisoes) {
  const pendentes = new Set(paraDecidir(selecao, decisoes).map((p) => p.id_pauta));
  const estado = estadoDasPautas(selecao, decisoes);
  return listaPautas(selecao).filter((p) => !pendentes.has(p.id_pauta)).map((p) => ({ ...p, estado: estado.get(p.id_pauta) }));
}

/* ------------------------------------------------------------- motivos */

export const MOTIVOS_RECUSA = Object.freeze(['repetição', 'recorte', 'timing', 'desalinhamento', 'fundamentação']);
export const MAX_MOTIVO = 500;

/** Motivo da lista fechada (aceita sem acento e com outra caixa) ou ''. */
export function motivoDaLista(v) {
  const s = normalizarCabecalho(v);
  return MOTIVOS_RECUSA.find((m) => normalizarCabecalho(m) === s) || '';
}

const umaLinha = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Texto da coluna `motivo`: "<motivo>" ou "<motivo>: <observação>" (recusa), só a observação
 * (aprovação). Uma linha só, no máximo 500 caracteres.
 */
export function textoMotivo(motivo, observacao = '') {
  const m = umaLinha(motivo);
  const o = umaLinha(observacao);
  const t = m && o ? `${m}: ${o}` : (m || o);
  return t.length > MAX_MOTIVO ? t.slice(0, MAX_MOTIVO).trimEnd() : t;
}

/* -------------------------------------------------- planejar a gravação */

const ROTULO_ORIGEM = { app: 'app', 'manual-app': 'app', chat: 'chat', radar: 'Radar', ponte: 'app' };

function textoJaDecidido(d, agora) {
  const quando = lerDataHora(d.data);
  const quem = d.origem ? ` pelo ${ROTULO_ORIGEM[d.origem] || d.origem}` : '';
  if (!quando) return `já decidido${quem}`;
  const outroDia = hojeISO(quando) !== hojeISO(agora);
  return `já decidido${quem} ${outroDia ? `em ${formatarData(quando)} ` : ''}às ${horaCurta(quando)}`;
}

/** Semana da pauta: a coluna `semana` da Seleção; sem ela, o prefixo do id (S47-07 → S47). */
function semanaDaPauta(p) {
  if (p.semana) return p.semana;
  const m = String(p.id_pauta).match(/^(S\d{2})-\d{2}$/);
  return m ? m[1] : '';
}

/**
 * O que gravar para os pedidos de decisão da tela.
 *
 *   selecao         Seleção relida agora (lerSelecao)
 *   decisoesVistas  Decisões como a tela viu quando a pessoa decidiu (lista ou lerDecisoes)
 *   decisoesAgora   Decisões relida agora (lerDecisoes: precisa do cabeçalho real)
 *   pedidos         [{id_pauta, decisao: 'aprovada'|'recusada', motivo, observacao}]
 *   email, agora
 *
 * Para cada pedido, na ordem: id T → recusado; decisão igual à atual → nada ("já estava assim");
 * Decisões ganhou linha desse id depois do que a tela viu → recusado ("já decidido pelo chat às
 * 10h12"); pauta já enviada ao Roteirista → recusado; senão, linha nova (mudança de ideia também).
 * Sem permissão ou sem as colunas novas, nada é gravado.
 *
 * → {ok, erro?, mensagem?, linhas (para values.append), registros, atualizacoes
 *    [{id_pauta, linha, coluna, valor}] (status na Seleção), resultados [{id_pauta, acao:
 *    'gravar'|'nada'|'recusado'|'erro', motivo, mensagem, mudanca?}]}.
 */
export function planejarDecisoes({ selecao, decisoesVistas = [], decisoesAgora, pedidos = [], email, agora = new Date() } = {}) {
  const vazio = { linhas: [], registros: [], atualizacoes: [] };
  const lista = Array.isArray(pedidos) ? pedidos : [];
  const todos = (motivo, mensagem) => lista.map((p) => ({ id_pauta: String(p?.id_pauta || '').trim(), acao: 'erro', motivo, mensagem }));

  if (!podeDecidir(email)) {
    const mensagem = 'Só a conta da Robertta decide. Esta conta pode ver e disparar rodadas, mas não decidir.';
    return { ok: false, erro: 'sem-permissao', mensagem, ...vazio, resultados: todos('sem-permissao', mensagem) };
  }
  const cabecalho = decisoesAgora?.cabecalho || [];
  if (!colunasDecisoesProntas(cabecalho)) {
    return { ok: false, erro: 'colunas-ausentes', mensagem: MENSAGEM_COLUNAS_DECISOES, ...vazio, resultados: todos('colunas-ausentes', MENSAGEM_COLUNAS_DECISOES) };
  }

  const pautas = new Map(listaPautas(selecao).map((p) => [p.id_pauta, p]));
  const idxStatus = selecao?.indices?.status;
  const data = dataHoraPlanilha(agora);
  const quem = String(email).trim().toLowerCase();
  const out = { ok: true, ...vazio, resultados: [] };
  const noLote = new Set();
  const r = (id_pauta, acao, motivo, mensagem, extra = {}) => out.resultados.push({ id_pauta, acao, motivo, mensagem, ...extra });

  for (const pedido of lista) {
    const id = String(pedido?.id_pauta || '').trim();
    if (!id) { r(id, 'erro', 'sem-id', 'Pedido sem id_pauta.'); continue; }
    if (noLote.has(id)) { r(id, 'erro', 'repetido', 'Pedido repetido para a mesma pauta.'); continue; }
    noLote.add(id);
    if (ehTeste(id) || /^T/i.test(id)) { r(id, 'recusado', 'teste', 'teste não vai para Decisões'); continue; }

    const decisao = normalizarDecisao(pedido.decisao);
    if (decisao !== 'aprovada' && decisao !== 'recusada') { r(id, 'erro', 'decisao-invalida', 'A decisão precisa ser aprovar ou recusar.'); continue; }
    let motivo = '';
    if (decisao === 'recusada') {
      if (!String(pedido.motivo || '').trim()) { r(id, 'erro', 'falta-motivo', 'Escolha o motivo da recusa.'); continue; }
      motivo = motivoDaLista(pedido.motivo);
      if (!motivo) { r(id, 'erro', 'motivo-invalido', `Motivo fora da lista: ${MOTIVOS_RECUSA.join(', ')}.`); continue; }
    }

    const pauta = pautas.get(id);
    if (!pauta) { r(id, 'erro', 'pauta-nao-encontrada', `Não encontrei a pauta ${id} na aba Seleção.`); continue; }

    const agoraDeste = decisoesDe(decisoesAgora, id);
    const vistasDeste = decisoesDe(decisoesVistas, id);
    const ultima = agoraDeste[agoraDeste.length - 1] || null;
    const decididaNaSelecao = pauta.status === 'aprovada' || pauta.status === 'recusada' ? pauta.status : '';
    const atual = ultima ? ultima.decisao : decididaNaSelecao;

    if (atual === decisao) { r(id, 'nada', 'ja-estava', 'já estava assim'); continue; }
    if (agoraDeste.length > vistasDeste.length) { r(id, 'recusado', 'ja-decidido', textoJaDecidido(ultima, agora)); continue; }
    if (pauta.status === STATUS_PAUTA.enviada) {
      r(id, 'recusado', 'ja-enviada', 'Esta pauta já foi enviada ao Roteirista; a decisão não muda mais por aqui.');
      continue;
    }

    const registro = {
      semana: semanaDaPauta(pauta),
      pauta: pauta.titulo,
      decisao,
      motivo: textoMotivo(motivo, pedido.observacao),
      id_pauta: id,
      rede: pauta.rede,
      id_candidato: pauta.id_candidato,
      id_lote: pauta.id_lote,
      data,
      quem,
      origem: 'app',
    };
    out.registros.push(registro);
    out.linhas.push(linhaNaOrdem(cabecalho, registro, COLUNAS_DECISOES));
    if (Number.isInteger(idxStatus) && pauta._linha) {
      out.atualizacoes.push({ id_pauta: id, linha: pauta._linha, coluna: idxStatus, valor: decisao });
    }
    r(id, 'gravar', atual ? 'mudanca' : 'nova', atual ? `muda de ${atual} para ${decisao}` : decisao, { mudanca: !!atual });
  }
  return out;
}
