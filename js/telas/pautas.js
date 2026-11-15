// PAUTAS (#/pautas): as pautas que o Radar gravou na aba Seleção da planilha Radar, para decidir
// no app (aprovar, ou recusar com um dos 5 motivos), confirmar e mandar as aprovadas ao Roteirista.
// No topo, as faixas do Radar diário e da Seleção (aba Execuções). Visual do desenho aprovado
// (css: "8. Pautas"): cartão .pauta com a nota, .decisao com aria-pressed e a .bandeja fixa.
//
// Estados honestos: lendo, sem internet, planilha sem resposta, aba Seleção ausente, aba Decisões
// sem as colunas novas (decidir desligado, com a explicação). Ids T aparecem com o selo Teste e não
// são decididos ("teste não vai para Decisões"). Só a conta da Robertta decide.
//
// Chip "Candidatos" (antes de Para decidir / Decididas / Todas): os candidatos da aba Candidatos
// (Radar diário), do mais recente para o mais antigo, com os da última rodada em destaque ("Nova
// rodada"). Cada um tem "Passar para Para decidir" e "Mandar ao Roteirista" (rotina radar-candidato
// pela ponte, só a conta da Robertta); o estado do cartão vem de Execuções, Seleção e Decisões, para
// o mesmo candidato não ser pedido duas vezes. "Para decidir" continua vindo só da aba Seleção.
//
// htmlPautas(...) é puro (recebe os dados): testado em tests/telas.test.mjs e candidatos.test.mjs.

import { esc, ic, NOME_REDE, hrefWeb, quando } from '../util.js';
import { FLAGS } from '../config.js';
import { estado } from '../estado.js';
import { Integra } from '../integra.js';
import { pautasLidas, execucoesLidas, candidatosLidas } from '../dados.js';
import {
  podeDecidir, idLote, DESTINOS_CANDIDATO, MAX_MOTIVO_CANDIDATO, QUANTIDADE_PADRAO, QUANTIDADE_MIN, QUANTIDADE_MAX,
} from '../controle.js';
import { paraDecidir, estadoDasPautas, MOTIVOS_RECUSA, MENSAGEM_COLUNAS_DECISOES, STATUS_PAUTA } from '../selecao.js';
import { ehTeste, prefixoSemana, lerDataHora, formatarData, horaCurta, hojeISO, dataCurta } from '../parse.js';
import { candidatosDaTela, contarCandidatos, ultimaRodada, estadoDoCandidato } from '../candidatos.js';
import { faixaExecucao } from '../componentes/execucao.js';
import { moldura } from '../componentes/janelas.js';
import { cab, selo, chipFiltro, vazio, campo, segmento, painelCarregando } from './pecas.js';

export const MENSAGEM_SELECAO_AUSENTE = 'A aba Seleção ainda não existe na planilha Radar. Até lá, a escolha continua na conversa com o Radar.';
export const NOTA_SO_ROBERTTA = 'Só a conta da Robertta decide.';
export const MENSAGEM_CANDIDATOS_AUSENTE = 'A aba Candidatos ainda não existe na planilha Radar. O Radar diário cria a aba e grava os candidatos nela; até lá, eles chegam pela conversa com o Radar.';
/** Quantos cartões de candidato aparecem antes do "Mostrar mais" (e quantos a mais a cada toque). */
export const LIMITE_CANDIDATOS = 30;
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

const ORIGEM = { app: 'pelo app', 'manual-app': 'pelo app', chat: 'pelo chat', radar: 'pelo Radar' };

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
    decisao = `<div class="decisao"><button type="button" class="botao calmo" data-acao="pauta-mudar" data-id="${esc(id)}"${ctx.bloqueio ? ' disabled' : ''}>Mudar decisão</button>${ctx.bloqueio && !ctx.notaNoTopo ? `<span class="pequeno apagado">${esc(ctx.bloqueio)}</span>` : ''}</div>`;
  } else {
    const dis = ctx.bloqueio ? ' disabled' : '';
    // Como no desenho aprovado: dois botões calmos; o check aparece quando "Aprovar" está marcado.
    decisao = `<div class="decisao" role="group" aria-label="Decisão sobre ${esc(titulo)}">
      <button type="button" class="botao calmo sim" data-acao="pauta-decidir" data-id="${esc(id)}" data-valor="aprovada" aria-pressed="${pendente === 'aprovada'}"${dis}>${pendente === 'aprovada' ? ic('check', 18) : ''}Aprovar</button>
      <button type="button" class="botao calmo nao" data-acao="pauta-decidir" data-id="${esc(id)}" data-valor="recusada" aria-pressed="${pendente === 'recusada'}"${dis}>Recusar</button>
      ${mudando ? `<button type="button" class="botao calmo" data-acao="pauta-mudar" data-id="${esc(id)}">Deixar como estava</button>` : ''}
      ${ctx.bloqueio && !ctx.notaNoTopo ? `<span class="pequeno apagado">${esc(ctx.bloqueio)}</span>` : ''}
    </div>
    ${pendente === 'recusada' && !ctx.bloqueio ? `<div class="pilha" style="gap:.875rem">
      ${segmento(`pm-${id}`, 'Por que recusar?', MOTIVOS_RECUSA.map((m) => [m, m.charAt(0).toUpperCase() + m.slice(1)]), '')}
      ${ctx.erros[`pm-${id}`] ? `<p class="erro">${esc(ctx.erros[`pm-${id}`])}</p>` : ''}
      ${campo({ modelo: `po-${id}`, rotulo: 'Observação', opcional: true, exemplo: 'Ex.: já falamos disso em outubro', dica: 'O Radar usa o motivo para acertar as próximas sugestões.' })}
    </div>` : ''}`;
  }

  return `<article class="painel pauta ${classe}" aria-labelledby="p-${esc(id)}">
    <div class="pauta-topo">
      ${anelNota(p.nota_v2)}
      <div class="pilha" style="gap:.5rem">
        <h2 id="p-${esc(id)}">${esc(titulo)}</h2>
        <div class="meta"><span class="id">${esc(id)}</span>${ctx.filtro === 'decidir' && est.status === STATUS_PAUTA.proposta ? '' : selo(rotuloEstado, tom)}${p.rede ? selo(nomeRede(p.rede), 'espera') : ''}${p.tema ? selo(p.tema) : ''}${teste ? selo('Teste') : ''}</div>
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
  dados = {}, exec = {}, candidatos = {}, email = '', filtro = 'decidir', pendentes = {}, mudando = {}, resultados = {}, erros = {},
  visiveis = LIMITE_CANDIDATOS, agora = new Date(),
} = {}) {
  const topo = `${cab('Pautas', 'As sugestões do Radar para a semana, da maior nota para a menor.')}${faixas(exec, dados, agora)}`;
  const largura = 'style="max-width:58.75rem;margin-top:1rem"';
  const nCandidatos = contarCandidatos(candidatos);

  if (filtro === 'candidatos') {
    const contas = dados.selecao ? contagemDasPautas(dados.selecao, dados.decisoes) : {};
    const so = !podeDecidir(email);
    const nota = so ? `<p class="nota calma" ${largura}>${ic('info')}<span>${esc(NOTA_SO_ROBERTTA)} Esta conta vê os candidatos, mas não manda ao Roteirista nem passa para Para decidir.</span></p>` : '';
    return `${topo}${nota}${filtrosPautas(filtro, { candidatos: nCandidatos, ...contas })}${htmlCandidatos({ candidatos, dados, exec, email, visiveis, agora })}`;
  }

  if (!dados.selecao) {
    const chips = filtrosPautas(filtro, { candidatos: nCandidatos });
    if (dados.fase === 'carregando' || dados.fase === 'vazio' || dados.fase === undefined) {
      if (dados.offline) return `${topo}${chips}<div class="painel" ${largura}>${vazio('Sem internet', 'Assim que a conexão voltar, as pautas da aba Seleção aparecem aqui.')}</div>`;
      return `${topo}${chips}<div ${largura}>${painelCarregando('Lendo a planilha Radar…')}</div>`;
    }
    const e = dados.erro;
    if (e?.codigo === 'aba-ausente') return `${topo}${chips}<div class="painel" ${largura}>${vazio('Ainda sem a aba Seleção', esc(MENSAGEM_SELECAO_AUSENTE))}</div>`;
    const texto = dados.offline ? 'Sem internet. Assim que a conexão voltar, toque em “Tentar de novo”.'
      : esc(e?.message || 'A planilha Radar não respondeu agora.');
    return `${topo}${chips}<div class="painel" role="alert" ${largura}>${vazio('Não consegui ler a planilha Radar', texto, `<button type="button" class="botao contorno" data-acao="pautas-recarregar">${ic('atualizar', 18)} Tentar de novo</button>`)}</div>`;
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
  // A conta que não decide: uma nota só, no topo (não repetida em cada cartão).
  const notaNoTopo = bloqueio === NOTA_SO_ROBERTTA;
  const ctx = { estado: est, pendentes, mudando, resultados, erros, bloqueio, agora, filtro, notaNoTopo };

  const estrutural = !bloqueio ? ''
    : notaNoTopo ? `<p class="nota calma" ${largura}>${ic('info')}<span>${esc(NOTA_SO_ROBERTTA)} Esta conta vê as pautas e pode pedir rodadas, mas não aprova nem recusa.</span></p>`
      : `<p class="nota atencao" ${largura}>${ic('alerta')}<span>${esc(bloqueio)}</span></p>`;
  const filtros = filtrosPautas(filtro, { candidatos: nCandidatos, decidir: nDecidir, decididas: todas.length - nDecidir, todas: todas.length });
  const vazioLista = filtro === 'decididas' ? vazio('Nenhuma pauta decidida ainda', 'As pautas que você aprovar ou recusar ficam aqui.')
    : todas.length ? vazio('Nada para decidir agora', 'O Radar grava as próximas pautas na seleção de domingo, ou quando você pedir uma seleção agora.')
      : vazio('Nenhuma pauta na aba Seleção', 'O Radar grava as pautas aqui na seleção de domingo, ou quando você pedir uma seleção agora.');
  const corpo = lista.length ? `<div class="pautas">${lista.map((p) => cartao(p, ctx)).join('')}</div>` : `<div class="painel" ${largura}>${vazioLista}</div>`;

  return `${topo}${estrutural}${filtros}${corpo}${bandeja({ selecao, decisoes, pendentes, bloqueio, est })}`;
}

/** Contagens dos chips de pautas (as mesmas de sempre: o teste aparece em Para decidir, mas não se decide). */
function contagemDasPautas(selecao, decisoes) {
  const abertas = new Set(paraDecidir(selecao, decisoes).map((p) => p.id_pauta));
  const todas = selecao?.pautas || [];
  const nDecidir = todas.filter((p) => abertas.has(p.id_pauta)).length;
  return { decidir: nDecidir, decididas: todas.length - nDecidir, todas: todas.length };
}

/** Os chips: Candidatos (n) · Para decidir (n) · Decididas (n) · Todas (n); sem o número enquanto a aba não foi lida. */
function filtrosPautas(filtro, n = {}) {
  const r = (rotulo, v) => (Number.isInteger(v) ? `${rotulo} (${v})` : rotulo);
  return `<div class="filtros" role="group" aria-label="Filtrar pautas" style="margin-top:1.25rem">
    ${chipFiltro('filtroPautas', 'candidatos', r('Candidatos', n.candidatos), filtro)}${chipFiltro('filtroPautas', 'decidir', r('Para decidir', n.decidir), filtro)}${chipFiltro('filtroPautas', 'decididas', r('Decididas', n.decididas), filtro)}${chipFiltro('filtroPautas', 'todas', r('Todas', n.todas), filtro)}
  </div>`;
}

/** Barra fixa acima da doca: "Confirmar decisões (n)" ou, sem decisão pendente, "Enviar ao Roteirista". */
function bandeja({ selecao, decisoes, pendentes, bloqueio, est }) {
  const ids = Object.keys(pendentes).filter((id) => pendentes[id] && est.has(id) && !ehIdTeste(id));
  if (ids.length) {
    const n = ids.length;
    const aprov = ids.filter((id) => pendentes[id] === 'aprovada').length;
    const texto = [aprov ? `${aprov} ${aprov === 1 ? 'aprovada' : 'aprovadas'}` : '', n - aprov ? `${n - aprov} ${n - aprov === 1 ? 'recusada' : 'recusadas'}` : ''].filter(Boolean).join(', ');
    return `<div class="bandeja" role="region" aria-label="Decisões a confirmar">
      <span class="bandeja-texto"><span class="bandeja-pontos" aria-hidden="true">${ids.map((id) => `<i class="${pendentes[id]}"></i>`).join('')}</span><span>${esc(texto)}, ainda não gravadas</span></span>
      <button type="button" class="botao primario menor" data-acao="pautas-confirmar"${bloqueio ? ' disabled' : ''}>Confirmar decisões (${n})</button>
    </div>`;
  }
  const aprovadas = aprovadasParaEnviar(selecao, decisoes);
  if (!aprovadas.length) return '';
  const n = aprovadas.length;
  const so = bloqueio === NOTA_SO_ROBERTTA;
  return `<div class="bandeja" role="region" aria-label="Enviar ao Roteirista">
    <span class="bandeja-texto">${n} ${n === 1 ? 'aprovada espera' : 'aprovadas esperam'} o Roteirista${so ? ' (só a conta da Robertta envia)' : ''}</span>
    <button type="button" class="botao primario menor" data-acao="pautas-enviar"${so ? ' disabled' : ''}>Enviar ao Roteirista (${n} ${n === 1 ? 'aprovada' : 'aprovadas'})</button>
  </div>`;
}

/* --------------------------------------------------------- candidatos */

/** Por que os botões dos candidatos estão desligados agora ('' = pode pedir). */
export function bloqueioDeCandidato({ email, offline = false } = {}) {
  if (!podeDecidir(email)) return NOTA_SO_ROBERTTA;
  if (offline) return 'Sem internet: dá para pedir quando a conexão voltar.';
  return '';
}

/** Por que "Mandar ao Roteirista" está desligado (a ponte grava a aprovação em Decisões). */
export function bloqueioDeRoteirista(dados) {
  if (dados?.decisoesAusente) return 'Sem a aba Decisões na planilha Radar, “Mandar ao Roteirista” fica desligado: a aprovação é gravada lá.';
  if (dados?.selecao && dados.colunasProntas === false) return MENSAGEM_COLUNAS_DECISOES;
  return '';
}

/** Texto honesto do destaque "Nova rodada" (ultimaRodada de candidatos.js). Texto puro. */
export function textoDaRodada(r, { agora = new Date(), execucoesLidas = true } = {}) {
  if (!r || r.modo === 'nenhum') return '';
  if (r.modo === 'execucao') {
    const q = r.quando ? ` (${quando(r.quando, agora)})` : '';
    const n = r.ids.size;
    if (!n) return `A última rodada do Radar diário${q} não trouxe candidato novo: nenhum fica em destaque.`;
    return `Em destaque com “Nova rodada”: ${n === 1 ? 'o candidato' : `os ${n} candidatos`} da última rodada do Radar diário${q}.`;
  }
  const d = dataCurta(r.dia) || r.dia;
  if (r.motivo === 'sem-coluna') return `A aba Candidatos ainda não tem a coluna id_execucao, então “Nova rodada” marca os candidatos da data mais recente (${d}); eles podem ser de mais de uma rodada.`;
  if (!execucoesLidas) return `Enquanto o registro de Execuções não chega, “Nova rodada” marca os candidatos da data mais recente (${d}).`;
  return `Não achei uma rodada do Radar diário terminada (ok ou parcial) na aba Execuções, então “Nova rodada” marca os candidatos da data mais recente (${d}).`;
}

const comX = (v) => {
  const s = String(v ?? '').trim();
  return s && !/x$/i.test(s) ? `${s}x` : s;
};

/** A linha de estado do cartão (todo dado passa por esc). */
function linhaDoEstado(est, ctx) {
  switch (est.tipo) {
    case 'pauta': {
      const p = est.pauta;
      const status = ctx.estadoPautas.get(p.id_pauta)?.status || p.status;
      if (status === STATUS_PAUTA.enviada) return `<p class="meta">${selo(`Virou pauta ${p.id_pauta}`, 'ok')}${selo('Enviado ao Roteirista', 'espera')}</p>`;
      const [rotulo, tom] = SELO_ESTADO[status] || [p.statusOriginal || status || 'sem status', 'neutro'];
      return `<p class="meta">${selo(`Virou pauta ${p.id_pauta}`, 'ok')}${selo(rotulo, tom)}</p>`;
    }
    case 'andamento': {
      const l = est.linha;
      const desde = l.inicioData ? ` desde ${quando(l.inicioData, ctx.agora)}` : '';
      return `<p class="nota calma pequeno" role="status">${ic('info', 18)}<span>${esc(`Pedido em andamento (${l.status}${desde}). Os botões voltam se ele der erro.`)}</span></p>`;
    }
    case 'parece-travada':
      return `<p class="nota atencao pequeno" role="status">${ic('alerta', 18)}<span>O pedido está aberto há mais de 2 h e parece travado. Dá para pedir de novo: a janela pede para marcar o antigo como travado.</span></p>`;
    case 'erro':
      return `<p class="nota atencao pequeno" role="status">${ic('alerta', 18)}<span>${esc(`O último pedido deu erro${est.erro ? `: ${est.erro}` : ''}.`)} Dá para tentar de novo.</span></p>`;
    case 'aprovado':
      return `<p class="meta">${selo('Aprovado', 'ok')}<span class="pequeno apagado">A aprovação está em Decisões; a pauta ainda não apareceu na aba Seleção.</span></p>`;
    case 'concluido':
      return `<p class="nota calma pequeno" role="status">${ic('info', 18)}<span>O Radar terminou o pedido, mas a pauta ainda não apareceu na aba Seleção. Toque em Atualizar daqui a pouco.</span></p>`;
    default:
      return '';
  }
}

function cartaoCandidato(c, ctx) {
  const id = c.id;
  const nova = ctx.nova.has(id);
  const est = estadoDoCandidato(c, ctx.fontes);
  const titulo = c.angulo || c.tema || `Candidato ${id}`;
  const href = hrefWeb(c.link);
  let host = '';
  try { host = href ? new URL(href).hostname.replace(/^www\./, '') : ''; } catch { host = ''; }
  const link = href
    ? `<p class="pequeno"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Abrir o post${host ? ` (${esc(host)})` : ''}</a></p>`
    : (c.link ? '<p class="pequeno apagado">O link não é http nem https: o app não abre.</p>' : '');
  const data = c.dataData ? formatarData(c.dataData) : c.data;
  const rodape = [data ? `Data: ${data}` : '', c.origem ? `Origem: ${c.origem}` : '', c.id_execucao ? `Rodada ${c.id_execucao}` : '']
    .filter(Boolean).map(esc).join(' · ');

  let acoes = '';
  if (!c.idOk) {
    acoes = `<p class="pequeno apagado">${ic('info', 16)} Id fora do formato AAAA-MM-DD-NN: o app não pede nada para este candidato.</p>`;
  } else if (est.podePedir) {
    const dis = ctx.bloqueio ? ' disabled' : '';
    const disR = dis || (ctx.bloqueioRoteirista ? ' disabled' : '');
    const nota = ctx.bloqueio ? (ctx.notaNoTopo ? '' : ctx.bloqueio) : ctx.bloqueioRoteirista;
    acoes = `<div class="decisao" role="group" aria-label="Pedir ao Radar: ${esc(titulo)}">
      <button type="button" class="botao calmo" data-acao="candidato-pedir" data-id="${esc(id)}" data-valor="decidir"${dis}>${esc(DESTINOS_CANDIDATO.decidir.botao)}</button>
      <button type="button" class="botao calmo" data-acao="candidato-pedir" data-id="${esc(id)}" data-valor="roteirista"${disR}>${esc(DESTINOS_CANDIDATO.roteirista.botao)}</button>
      ${nota ? `<span class="pequeno apagado">${esc(nota)}</span>` : ''}
    </div>`;
  }

  return `<article class="painel pauta candidato${nova ? ' nova' : ''}" aria-labelledby="cand-${esc(id)}">
    <div class="pauta-topo">
      ${anelNota(c.nota)}
      <div class="pilha" style="gap:.5rem">
        <h2 id="cand-${esc(id)}">${esc(titulo)}</h2>
        <div class="meta"><span class="id">${esc(id)}</span>${nova ? selo('Nova rodada', 'acao') : ''}${c.plataforma ? selo(c.plataforma, 'espera') : ''}${c.tema && c.angulo ? selo(c.tema) : ''}${c.status ? selo(c.status) : ''}</div>
      </div>
    </div>
    <dl class="candidato-numeros">
      ${item('Criador', c.criador)}
      ${item('Visualizações', c.visualizacoes)}
      ${item('Mediana do criador', c.mediana_do_criador)}
      ${item('Outlier', comX(c.outlier_x))}
    </dl>
    ${link}
    ${rodape ? `<p class="meta pequeno apagado">${rodape}</p>` : ''}
    ${linhaDoEstado(est, ctx)}
    ${acoes}
  </article>`;
}

/**
 * A lista do chip Candidatos (puro).
 *   candidatos  candidatosLidas()   dados  pautasLidas()   exec  execucoesLidas()
 *   email, visiveis (quantos antes do "Mostrar mais"), agora
 */
export function htmlCandidatos({ candidatos = {}, dados = {}, exec = {}, email = '', visiveis = LIMITE_CANDIDATOS, agora = new Date() } = {}) {
  const largura = 'style="max-width:58.75rem;margin-top:1rem"';
  if (!candidatos.candidatos) {
    if (candidatos.fase === 'erro') {
      const texto = candidatos.offline ? 'Sem internet. Assim que a conexão voltar, toque em “Tentar de novo”.'
        : esc(candidatos.erro?.message || 'A planilha Radar não respondeu agora.');
      return `<div class="painel" role="alert" ${largura}>${vazio('Não consegui ler a aba Candidatos', texto, `<button type="button" class="botao contorno" data-acao="candidatos-recarregar">${ic('atualizar', 18)} Tentar de novo</button>`)}</div>`;
    }
    if (candidatos.offline) return `<div class="painel" ${largura}>${vazio('Sem internet', 'Assim que a conexão voltar, os candidatos da aba Candidatos aparecem aqui.')}</div>`;
    return `<div ${largura}>${painelCarregando('Lendo a aba Candidatos…')}</div>`;
  }
  if (candidatos.abaAusente) return `<div class="painel" ${largura}>${vazio('Ainda sem a aba Candidatos', esc(MENSAGEM_CANDIDATOS_AUSENTE))}</div>`;

  const lista = candidatosDaTela(candidatos);
  if (!lista.length) {
    const soTestes = candidatos.candidatos.length > 0;
    return `<div class="painel" ${largura}>${vazio('Nenhum candidato na aba Candidatos', soTestes
      ? 'Só há candidatos de teste (T), e eles ficam fora daqui.'
      : 'O Radar diário grava os candidatos aqui: todo dia às 7h, ou quando você pedir “Rodar agora”.')}</div>`;
  }

  const execucoes = exec.execucoes || [];
  const rodada = ultimaRodada({ candidatos: lista, temIdExecucao: !!candidatos.temIdExecucao, execucoes });
  const textoRodada = textoDaRodada(rodada, { agora, execucoesLidas: !!exec.execucoes });
  const bloqueio = bloqueioDeCandidato({ email, offline: candidatos.offline });
  const ctx = {
    nova: rodada.ids,
    fontes: { selecao: dados.selecao || null, decisoes: dados.decisoes || null, execucoes, agora },
    estadoPautas: dados.selecao ? estadoDasPautas(dados.selecao, dados.decisoes) : new Map(),
    bloqueio,
    bloqueioRoteirista: bloqueioDeRoteirista(dados),
    notaNoTopo: bloqueio === NOTA_SO_ROBERTTA,
    agora,
  };
  const limite = Math.max(1, Number(visiveis) || LIMITE_CANDIDATOS);
  const mostrar = lista.slice(0, limite);
  const resto = lista.length - mostrar.length;
  const aviso = bloqueio && bloqueio !== NOTA_SO_ROBERTTA ? `<p class="nota atencao" ${largura}>${ic('alerta')}<span>${esc(bloqueio)}</span></p>` : '';
  const total = lista.length === 1 ? '1 candidato' : `${lista.length} candidatos`;
  const intro = `<p class="pequeno apagado candidatos-intro">Candidatos do Radar diário, do mais recente para o mais antigo (${total}). Um candidato só entra em Para decidir depois que o Radar o transforma em pauta.${textoRodada ? ` ${esc(textoRodada)}` : ''}</p>`;
  const mais = resto > 0
    ? `<div class="mais-candidatos"><button type="button" class="botao calmo" data-acao="candidatos-mais">Mostrar mais (${resto === 1 ? 'falta 1' : `faltam ${resto}`})</button></div>`
    : '';
  return `${aviso}${intro}<div class="pautas">${mostrar.map((c) => cartaoCandidato(c, ctx)).join('')}</div>${mais}`;
}

/** Campo "Quantos candidatos" da janela do Radar diário (rascunho `rd-quantidade`, padrão 5). */
export function campoQuantidade() {
  return campo({
    modelo: 'rd-quantidade', rotulo: 'Quantos candidatos nesta rodada', tipo: 'number', valor: String(QUANTIDADE_PADRAO),
    attrs: `inputmode="numeric" min="${QUANTIDADE_MIN}" max="${QUANTIDADE_MAX}" step="1" required`,
    dica: `Um número inteiro de ${QUANTIDADE_MIN} a ${QUANTIDADE_MAX}. Vale só para esta rodada; o diário das 7h continua igual.`,
  });
}

/** Campo opcional "Motivo" da janela de um candidato (rascunho `rc-motivo`, uma linha). */
export function campoMotivoCandidato() {
  return campo({
    modelo: 'rc-motivo', rotulo: 'Motivo', opcional: true, exemplo: 'Ex.: tema forte para esta semana',
    attrs: `maxlength="${MAX_MOTIVO_CANDIDATO}" autocomplete="off" enterkeyhint="done"`,
    dica: `Uma linha, até ${MAX_MOTIVO_CANDIDATO} caracteres. Vai ao Radar junto com o pedido.`,
  });
}

/** Itens a mais da janela de um candidato: quem é e o que vai acontecer (texto puro; a janela escapa). */
export function extrasDoCandidato(c, destino) {
  const quem = [c?.id, c?.angulo || c?.tema, c?.criador ? `de ${c.criador}` : ''].filter(Boolean).join(' · ');
  return [
    { chave: 'candidato', rotulo: 'O candidato', texto: quem },
    { chave: 'destino', rotulo: 'O que vai acontecer', texto: DESTINOS_CANDIDATO[destino]?.texto || '' },
  ];
}

/** Aviso depois que a ponte aceitou o pedido de um candidato (resposta da ponte: repetido, decisao). */
export function textoDoPedidoCandidato(destino, res = {}) {
  if (res?.repetido) return 'Este pedido já tinha chegado à ponte: nada foi pedido de novo. O andamento aparece no cartão.';
  if (destino === 'roteirista') {
    return res?.decisao === 'ja-existia'
      ? 'Pedido enviado ao Radar. A aprovação já estava em Decisões e não foi gravada de novo. O andamento aparece no cartão.'
      : 'Pedido enviado ao Radar e aprovação gravada em Decisões. O andamento aparece no cartão.';
  }
  return 'Pedido enviado ao Radar: a pauta aparece em Para decidir quando ele terminar. O andamento aparece no cartão.';
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
    candidatos: candidatosLidas(),
    email: Integra.email(),
    filtro: estado.filtroPautas,
    pendentes: estado.decisoesPauta,
    mudando: estado.mudandoPauta,
    resultados: estado.resultadoPautas,
    erros: estado.erros,
    visiveis: estado.candidatosVisiveis,
    agora: new Date(),
  });
}

