// PAUTAS (#/pautas): as pautas que o Radar gravou na aba Seleção da planilha Radar, para decidir
// no app (aprovar, ou recusar com um dos 5 motivos), confirmar e mandar as aprovadas ao Roteirista.
// No topo, as faixas do Radar diário e da Seleção (aba Execuções). Visual do desenho aprovado
// (css: "8. Pautas"): cartão .pauta com a nota, .decisao com aria-pressed e a .bandeja fixa.
//
// Estados honestos: lendo, sem internet, planilha sem resposta, aba Seleção ausente, aba Decisões
// sem as colunas novas (decidir desligado, com a explicação). Ids T aparecem com o selo Teste e não
// são decididos ("teste não vai para Decisões"). Só a conta da Robertta decide.
//
// htmlPautas(...) é puro (recebe os dados): testado em tests/telas.test.mjs.

import { esc, ic, NOME_REDE } from '../util.js';
import { FLAGS } from '../config.js';
import { estado } from '../estado.js';
import { Integra } from '../integra.js';
import { pautasLidas, execucoesLidas } from '../dados.js';
import { podeDecidir, idLote } from '../controle.js';
import { paraDecidir, estadoDasPautas, MOTIVOS_RECUSA, MENSAGEM_COLUNAS_DECISOES, STATUS_PAUTA } from '../selecao.js';
import { ehTeste, prefixoSemana, lerDataHora, formatarData, horaCurta, hojeISO } from '../parse.js';
import { faixaExecucao } from '../componentes/execucao.js';
import { moldura } from '../componentes/janelas.js';
import { cab, selo, chipFiltro, vazio, campo, segmento, painelCarregando } from './pecas.js';

export const MENSAGEM_SELECAO_AUSENTE = 'A aba Seleção ainda não existe na planilha Radar. Até lá, a escolha continua na conversa com o Radar.';
export const NOTA_SO_ROBERTTA = 'Só a conta da Robertta decide.';
const NOTA_TESTE = 'teste não vai para Decisões';

const ehIdTeste = (id) => ehTeste(id) || /^T/i.test(String(id || ''));

/* ------------------------------------------------------------ contas */

/** Pautas que esperam decisão (proposta, sem linha em Decisões), sem os ids de teste. */
export function pautasParaDecidir(selecao, decisoes) {
  return paraDecidir(selecao, decisoes).filter((p) => !ehIdTeste(p.id_pauta));
}

/** Contador da navegação e do Início: pautas para decidir (0 enquanto a planilha não respondeu). */
export function contarParaDecidir(dados = pautasLidas()) {
  if (!dados?.selecao) return 0;
  return pautasParaDecidir(dados.selecao, dados.decisoes).length;
}

/** Aprovadas que ainda não foram ao Roteirista (sem testes). */
export function aprovadasParaEnviar(selecao, decisoes) {
  const est = estadoDasPautas(selecao, decisoes);
  return (selecao?.pautas || []).filter((p) => !ehIdTeste(p.id_pauta) && est.get(p.id_pauta)?.status === STATUS_PAUTA.aprovada);
}

/** Lote da próxima seleção manual (S47-manual-1…), olhando Execuções e Seleção. */
export function loteDaProximaSelecao({ execucoes = [], selecao = null, agora = new Date() } = {}) {
  return idLote({ semana: prefixoSemana(agora), existentes: [...(execucoes || []), ...(selecao?.pautas || [])] });
}

/* ------------------------------------------------------------ partes */

const REDES = { ig: NOME_REDE.ig, tt: NOME_REDE.tt, ambas: NOME_REDE.ambos, ambos: NOME_REDE.ambos };
const nomeRede = (r) => REDES[String(r || '').trim().toLowerCase()] || String(r || '').trim();

function anelNota(nota) {
  const n = Number(String(nota || '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return '';
  const v = Math.min(100, Math.round(n));
  const C = 2 * Math.PI * 27;
  return `<div class="nota-anel" role="img" aria-label="Nota ${v} de 100"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27"/><circle class="valor" cx="32" cy="32" r="27" stroke-dasharray="${((v / 100) * C).toFixed(1)} ${C.toFixed(1)}"/></svg><b aria-hidden="true">${v}</b></div>`;
}

const item = (rotulo, valor) => (String(valor || '').trim() ? `<div><dt>${esc(rotulo)}</dt><dd>${esc(valor)}</dd></div>` : '');

const SELO_ESTADO = {
  proposta: ['Para decidir', 'acao'],
  aprovada: ['Aprovada', 'ok'],
  recusada: ['Recusada', 'neutro'],
  'enviada ao Roteirista': ['Enviada ao Roteirista', 'espera'],
};

const ORIGEM = { app: 'pelo app', chat: 'pelo chat', radar: 'pelo Radar' };

/** "Decidida pelo chat em 18/11 às 10h12 · repetição: …" a partir da linha de Decisões. */
function linhaDaDecisao(d, agora) {
  if (!d) return '';
  const q = lerDataHora(d.data);
  const quando = q ? `${hojeISO(q) === hojeISO(agora) ? 'hoje' : `em ${formatarData(q)}`} às ${horaCurta(q)}` : '';
  const partes = [`Decidida ${ORIGEM[d.origem] || (d.origem ? `por ${d.origem}` : '')} ${quando}`.replace(/\s+/g, ' ').trim()];
  if (d.motivo) partes.push(d.motivo);
  return partes.join(' · ');
}

const TOM_RESULTADO = { gravar: 'ok', nada: 'calma', recusado: 'atencao', erro: 'atencao' };

function cartao(p, ctx) {
  const id = p.id_pauta;
  const teste = ehIdTeste(id);
  const est = ctx.estado.get(id) || { status: p.status, decisao: null };
  const pendente = ctx.pendentes[id] || '';
  const decidida = est.status === 'aprovada' || est.status === 'recusada';
  const enviada = est.status === STATUS_PAUTA.enviada;
  const mudando = decidida && !!ctx.mudando[id];
  const [rotuloEstado, tom] = SELO_ESTADO[est.status] || [p.statusOriginal || est.status || 'Sem status', 'neutro'];
  const classe = pendente || (decidida && !mudando ? est.status : '');
  const titulo = p.titulo || id;
  const resultado = ctx.resultados[id];

  let decisao = '';
  if (teste) {
    decisao = `<p class="pequeno apagado">${ic('info', 16)} ${esc(NOTA_TESTE)}.</p>`;
  } else if (enviada) {
    decisao = '<p class="pequeno apagado">Já foi para o Roteirista: a decisão não muda mais por aqui.</p>';
  } else if (decidida && !mudando) {
    decisao = `<div class="decisao"><button type="button" class="botao calmo menor" data-acao="pauta-mudar" data-id="${esc(id)}"${ctx.bloqueio ? ' disabled' : ''}>Mudar decisão</button>${ctx.bloqueio ? `<span class="pequeno apagado">${esc(ctx.bloqueio)}</span>` : ''}</div>`;
  } else {
    const dis = ctx.bloqueio ? ' disabled' : '';
    decisao = `<div class="decisao" role="group" aria-label="Decisão sobre ${esc(titulo)}">
      <button type="button" class="botao contorno menor sim" data-acao="pauta-decidir" data-id="${esc(id)}" data-valor="aprovada" aria-pressed="${pendente === 'aprovada'}"${dis}>${ic('check', 18)} Aprovar</button>
      <button type="button" class="botao calmo menor nao" data-acao="pauta-decidir" data-id="${esc(id)}" data-valor="recusada" aria-pressed="${pendente === 'recusada'}"${dis}>Recusar</button>
      ${mudando ? `<button type="button" class="botao calmo menor" data-acao="pauta-mudar" data-id="${esc(id)}">Deixar como estava</button>` : ''}
      ${ctx.bloqueio ? `<span class="pequeno apagado">${esc(ctx.bloqueio)}</span>` : ''}
    </div>
    ${pendente === 'recusada' && !ctx.bloqueio ? `<div class="pilha" style="gap:.875rem">
      ${segmento(`pm-${id}`, 'Por que recusar?', MOTIVOS_RECUSA.map((m) => [m, m.charAt(0).toUpperCase() + m.slice(1)]), '')}
      ${ctx.erros[`pm-${id}`] ? `<p class="erro">${esc(ctx.erros[`pm-${id}`])}</p>` : ''}
      ${campo({ modelo: `po-${id}`, rotulo: 'Observação', opcional: true, exemplo: 'Ex.: já falamos disso em outubro' })}
    </div>` : ''}`;
  }

  return `<article class="painel pauta ${classe}" aria-labelledby="p-${esc(id)}">
    <div class="pauta-topo">
      ${anelNota(p.nota_v2)}
      <div class="pilha" style="gap:.5rem">
        <div class="meta"><span class="id">${esc(id)}</span>${selo(rotuloEstado, tom)}${p.rede ? selo(nomeRede(p.rede)) : ''}${p.tema ? selo(p.tema) : ''}${teste ? selo('Teste') : ''}</div>
        <h2 id="p-${esc(id)}">${esc(titulo)}</h2>
      </div>
    </div>
    <dl>
      ${item('Pergunta central', p.pergunta_central)}
      ${item('Por que agora', p.por_que_agora)}
      ${item('Fundamentação', p.fundamentacao)}
      ${item('Restrição principal', p.restricao_principal)}
    </dl>
    <p class="meta pequeno apagado">${[p.prazo ? `Prazo: ${p.prazo}` : '', p.estado_verificacao ? `Verificação: ${p.estado_verificacao}` : '', p.id_lote ? `Lote ${p.id_lote}` : ''].filter(Boolean).map(esc).join(' · ')}</p>
    ${est.decisao && decidida ? `<p class="pequeno apagado">${esc(linhaDaDecisao(est.decisao, ctx.agora))}</p>` : ''}
    <details><summary>Mais sobre esta pauta</summary><dl>
      ${item('Público e situação', p.publico_situacao)}
      ${item('Entrega', p.entrega)}
      ${item('Sinal social', p.sinal_social)}
      ${item('Contribuição junguiana', p.contribuicao_junguiana)}
      ${item('Ganchos opcionais', p.ganchos_opcionais)}
      ${item('Semana', p.semana)}
      ${item('Data da seleção', p.data_selecao)}
      ${item('Candidato', p.id_candidato)}
    </dl></details>
    ${decisao}
    ${resultado ? `<p class="nota ${TOM_RESULTADO[resultado.acao] || 'calma'} pequeno" role="status">${ic(resultado.acao === 'gravar' ? 'check' : 'info', 18)}<span>${esc(resultado.mensagem)}</span></p>` : ''}
  </article>`;
}

/** Por que decidir está desligado agora ('' = pode decidir). */
export function bloqueioDeDecisao({ email, dados, offline = false } = {}) {
  if (!podeDecidir(email)) return NOTA_SO_ROBERTTA;
  if (!FLAGS.decisoesPeloApp) return 'Decidir pelo app está desligado. Por enquanto, responda ao Radar no chat.';
  if (dados?.decisoesAusente) return 'A aba Decisões não foi encontrada na planilha Radar. Até ela existir, responda ao Radar no chat.';
  if (dados && !dados.colunasProntas) return MENSAGEM_COLUNAS_DECISOES;
  if (offline) return 'Sem internet: dá para decidir quando a conexão voltar.';
  return '';
}

function faixas(exec, dados, agora) {
  const lote = dados?.selecao ? loteDaProximaSelecao({ execucoes: exec.execucoes, selecao: dados.selecao, agora }) : '';
  return `<section class="painel faixas" aria-label="Rodadas do Radar">
    ${faixaExecucao({ rotina: 'radar-diario', dados: exec, agora, botao: { texto: 'Rodar agora' } })}
    ${faixaExecucao({ rotina: 'radar-selecao', rotulo: 'Seleção', dados: exec, agora, botao: { texto: 'Fazer seleção agora', titulo: lote ? `Lote ${lote}` : '' } })}
  </section>`;
}

/**
 * HTML da tela (puro).
 *   dados       pautasLidas()     exec   execucoesLidas()
 *   email, filtro ('decidir' | 'decididas' | 'todas'), pendentes, mudando, resultados, erros, agora
 */
export function htmlPautas({
  dados = {}, exec = {}, email = '', filtro = 'decidir', pendentes = {}, mudando = {}, resultados = {}, erros = {}, agora = new Date(),
} = {}) {
  const topo = `${cab('Pautas', 'As sugestões do Radar para a semana, da maior nota para a menor.')}${faixas(exec, dados, agora)}`;
  const largura = 'style="max-width:58.75rem;margin-top:1rem"';

  if (!dados.selecao) {
    if (dados.fase === 'carregando' || dados.fase === 'vazio' || dados.fase === undefined) {
      if (dados.offline) return `${topo}<div class="painel" ${largura}>${vazio('Sem internet', 'Assim que a conexão voltar, as pautas da aba Seleção aparecem aqui.')}</div>`;
      return `${topo}<div ${largura}>${painelCarregando('Lendo a planilha Radar…')}</div>`;
    }
    const e = dados.erro;
    if (e?.codigo === 'aba-ausente') return `${topo}<div class="painel" ${largura}>${vazio('Ainda sem a aba Seleção', esc(MENSAGEM_SELECAO_AUSENTE))}</div>`;
    const texto = dados.offline ? 'Sem internet. Assim que a conexão voltar, toque em “Tentar de novo”.'
      : esc(e?.message || 'A planilha Radar não respondeu agora.');
    return `${topo}<div class="painel" role="alert" ${largura}>${vazio('Não consegui ler a planilha Radar', texto, `<button type="button" class="botao contorno" data-acao="pautas-recarregar">${ic('atualizar', 18)} Tentar de novo</button>`)}</div>`;
  }

  const { selecao, decisoes } = dados;
  const est = estadoDasPautas(selecao, decisoes);
  const abertas = new Set(paraDecidir(selecao, decisoes).map((p) => p.id_pauta));
  const nota = (p) => Number(String(p.nota_v2 || '').replace(',', '.')) || 0;
  const ordem = (a, b) => nota(b) - nota(a) || String(a.id_pauta).localeCompare(String(b.id_pauta));
  const todas = [...selecao.pautas].sort(ordem);
  const lista = filtro === 'decididas' ? todas.filter((p) => !abertas.has(p.id_pauta))
    : filtro === 'todas' ? todas : todas.filter((p) => abertas.has(p.id_pauta));
  const nDecidir = todas.filter((p) => abertas.has(p.id_pauta)).length;
  const bloqueio = bloqueioDeDecisao({ email, dados, offline: dados.offline });
  const ctx = { estado: est, pendentes, mudando, resultados, erros, bloqueio, agora };

  const estrutural = !bloqueio || bloqueio === NOTA_SO_ROBERTTA ? '' : `<p class="nota atencao" ${largura}>${ic('alerta')}<span>${esc(bloqueio)}</span></p>`;
  const filtros = `<div class="filtros" role="group" aria-label="Filtrar pautas" style="margin-top:1.25rem">
    ${chipFiltro('filtroPautas', 'decidir', `Para decidir (${nDecidir})`, filtro)}${chipFiltro('filtroPautas', 'decididas', `Decididas (${todas.length - nDecidir})`, filtro)}${chipFiltro('filtroPautas', 'todas', `Todas (${todas.length})`, filtro)}
  </div>`;
  const vazioLista = filtro === 'decididas' ? vazio('Nenhuma pauta decidida ainda', 'As pautas que você aprovar ou recusar ficam aqui.')
    : todas.length ? vazio('Nada para decidir agora', 'O Radar grava as próximas pautas na seleção de domingo, ou quando você pedir uma seleção agora.')
      : vazio('Nenhuma pauta na aba Seleção', 'O Radar grava as pautas aqui na seleção de domingo, ou quando você pedir uma seleção agora.');
  const corpo = lista.length ? `<div class="pautas">${lista.map((p) => cartao(p, ctx)).join('')}</div>` : `<div class="painel" ${largura}>${vazioLista}</div>`;

  return `${topo}${estrutural}${filtros}${corpo}${bandeja({ selecao, decisoes, pendentes, bloqueio, est })}`;
}

/** Barra fixa acima da doca: "Confirmar decisões (n)" ou, sem decisão pendente, "Enviar ao Roteirista". */
function bandeja({ selecao, decisoes, pendentes, bloqueio, est }) {
  const ids = Object.keys(pendentes).filter((id) => pendentes[id] && est.has(id) && !ehIdTeste(id));
  if (ids.length) {
    const n = ids.length;
    const aprov = ids.filter((id) => pendentes[id] === 'aprovada').length;
    const texto = [aprov ? `${aprov} ${aprov === 1 ? 'aprovada' : 'aprovadas'}` : '', n - aprov ? `${n - aprov} ${n - aprov === 1 ? 'recusada' : 'recusadas'}` : ''].filter(Boolean).join(', ');
    return `<div class="bandeja" role="region" aria-label="Decisões a confirmar">
      <span class="bandeja-pontos" aria-hidden="true">${ids.map((id) => `<i class="${pendentes[id]}"></i>`).join('')}</span>
      <span>${esc(texto)}, ainda não gravadas</span>
      <button type="button" class="botao primario menor" data-acao="pautas-confirmar"${bloqueio ? ' disabled' : ''}>Confirmar decisões (${n})</button>
    </div>`;
  }
  const aprovadas = aprovadasParaEnviar(selecao, decisoes);
  if (!aprovadas.length) return '';
  const n = aprovadas.length;
  const so = bloqueio === NOTA_SO_ROBERTTA;
  return `<div class="bandeja" role="region" aria-label="Enviar ao Roteirista">
    <span>${so ? esc(NOTA_SO_ROBERTTA) : `${n} ${n === 1 ? 'aprovada espera' : 'aprovadas esperam'} o Roteirista`}</span>
    <button type="button" class="botao primario menor" data-acao="pautas-enviar"${so ? ' disabled' : ''}>Enviar ao Roteirista (${n} ${n === 1 ? 'aprovada' : 'aprovadas'})</button>
  </div>`;
}

/* ------------------------------------------------------------ janelas */

const ROTULO_DECISAO = { aprovada: 'Aprovar', recusada: 'Recusar' };

/**
 * Pedidos de decisão da tela → {pedidos, erros}. Recusa sem motivo vira erro no campo `pm-<id>`.
 * Ids T e pautas que não estão na Seleção ficam de fora.
 */
export function pedidosDaTela(pendentes, valores, selecao) {
  const ids = new Set((selecao?.pautas || []).map((p) => p.id_pauta));
  const pedidos = [];
  const erros = {};
  for (const [id, decisao] of Object.entries(pendentes || {})) {
    if (!decisao || !ids.has(id) || ehIdTeste(id)) continue;
    const motivo = decisao === 'recusada' ? String(valores[`pm-${id}`] || '') : '';
    if (decisao === 'recusada' && !motivo) erros[`pm-${id}`] = 'Escolha o motivo da recusa.';
    pedidos.push({ id_pauta: id, decisao, motivo, observacao: String(valores[`po-${id}`] || '').trim() });
  }
  return { pedidos, erros };
}

/** Resultado de gravarDecisoes → {id_pauta: {acao, mensagem}} no tom da tela. */
export function resultadosDaGravacao(res) {
  const out = {};
  const falhas = new Map((res?.falhasSelecao || []).map((f) => [f.id_pauta, f]));
  for (const r of res?.resultados || []) {
    let mensagem = r.mensagem;
    if (r.acao === 'gravar') {
      mensagem = r.mudanca ? `Gravada: ${r.mensagem}.` : 'Gravada.';
      if (falhas.has(r.id_pauta)) mensagem += ' O status na Seleção não atualizou; a decisão vale pela aba Decisões.';
    } else if (r.acao === 'nada') mensagem = 'Já estava assim.';
    else if (r.acao === 'recusado') mensagem = `Não gravada: ${r.mensagem}.`;
    else mensagem = `Erro: ${r.mensagem}`;
    out[r.id_pauta] = { acao: r.acao, mensagem: mensagem.replace(/\.\.$/, '.') };
  }
  return out;
}

/**
 * Janela "Confirmar decisões": cada decisão e onde ela grava; depois de gravar, o resultado por
 * pauta. `itens`: [{id_pauta, titulo, decisao, motivo, observacao, de}] (de = estado atual, se muda).
 */
export function janelaDecisoes({ itens = [], enviando = false, resultados = null, erro = '' } = {}) {
  const linha = (it) => {
    const r = resultados?.[it.id_pauta];
    const motivo = it.decisao === 'recusada' ? ` (${[it.motivo, it.observacao].filter(Boolean).join(': ')})` : (it.observacao ? ` (${it.observacao})` : '');
    return `<li><div><strong>${esc(it.id_pauta)}</strong> · ${esc(it.titulo || '')}<br><span class="pequeno">${esc(ROTULO_DECISAO[it.decisao] || it.decisao)}${esc(motivo)}${it.de ? esc(` · muda de ${it.de}`) : ''}</span>${r ? `<br><span class="pequeno resultado-${esc(r.acao)}">${esc(r.mensagem)}</span>` : ''}</div></li>`;
  };
  const feito = !!resultados;
  const corpo = `
    <ul class="pedidos">${itens.map(linha).join('')}</ul>
    ${feito ? '' : '<p><strong>Onde grava:</strong> Decisões e status na Seleção da planilha Radar; o Radar e o domingo passam a considerar estas decisões.</p><p class="pequeno apagado">Antes de gravar, o app relê a planilha: se uma pauta já foi decidida pelo chat, vale a primeira decisão e esta não é gravada. Nada é apagado: mudar de ideia vira uma linha nova em Decisões.</p>'}
    ${erro ? `<p class="nota atencao" role="alert">${ic('alerta')}<span>${esc(erro)}</span></p>` : ''}`;
  const rodape = feito
    ? '<button type="button" class="botao primario" data-acao="fechar-janela">Fechar</button>'
    : `<button type="button" class="botao calmo" data-acao="fechar-janela">Voltar</button><button type="button" class="botao primario" data-acao="pautas-gravar"${enviando ? ' disabled aria-busy="true"' : ''}>${enviando ? 'Gravando…' : `Gravar ${itens.length === 1 ? 'a decisão' : `as ${itens.length} decisões`}`}</button>`;
  return moldura(feito ? 'Decisões gravadas' : `Confirmar ${itens.length === 1 ? 'a decisão' : `as ${itens.length} decisões`}?`, corpo, rodape);
}

/* ------------------------------------------------------------ tela */

export function vPautas() {
  return htmlPautas({
    dados: pautasLidas(),
    exec: execucoesLidas(),
    email: Integra.email(),
    filtro: estado.filtroPautas,
    pendentes: estado.decisoesPauta,
    mudando: estado.mudandoPauta,
    resultados: estado.resultadoPautas,
    erros: estado.erros,
    agora: new Date(),
  });
}

