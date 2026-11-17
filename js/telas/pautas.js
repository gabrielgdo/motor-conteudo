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
// rodada"). Cada um tem "Passar para Para decidir" (só muda o estado no arquivo do app
// `_motor/app/candidatos/<id>.json`, sem o Radar), "Mandar ao Roteirista" e "Pedir pauta completa ao
// Radar" (rotina radar-candidato pela ponte) e "Excluir" (o mesmo arquivo; nada mais é tocado). Só a
// conta da Robertta muda alguma coisa; o estado do cartão vem de Execuções, Seleção e Decisões, para
// o mesmo candidato não ser pedido duas vezes. As pautas de "Para decidir" vêm da aba Seleção; os
// candidatos passados para lá pelo app ficam no bloco "Candidatos para decidir (sem verificação do
// Radar)", com Aprovar e mandar ao Roteirista, Pedir pauta completa, Recusar e Voltar. Excluídos e
// recusados ficam atrás do chip discreto "Excluídos (n)", com Restaurar.
//
// htmlPautas(...) é puro (recebe os dados): testado em tests/telas.test.mjs e candidatos.test.mjs.

import { esc, ic, NOME_REDE, hrefWeb, quando } from '../util.js';
import { FLAGS } from '../config.js';
import { estado } from '../estado.js';
import { Integra } from '../integra.js';
import { pautasLidas, execucoesLidas, candidatosLidas, roteiros } from '../dados.js';
import { enviosAoRoteirista, mapaDeEnvios, podeEnviar, aCaminho } from '../envios.js';
import {
  podeDecidir, idLote, DESTINOS_CANDIDATO, MAX_MOTIVO_CANDIDATO, QUANTIDADE_PADRAO, QUANTIDADE_MIN, QUANTIDADE_MAX,
} from '../controle.js';
import { paraDecidir, estadoDasPautas, aprovacaoDoCandidato, MOTIVOS_RECUSA, MENSAGEM_COLUNAS_DECISOES, STATUS_PAUTA } from '../selecao.js';
import { ehTeste, prefixoSemana, lerDataHora, formatarData, horaCurta, hojeISO, dataCurta } from '../parse.js';
import {
  candidatosDaTela, ultimaRodada, estadoDoCandidato, rotuloOrigem, mesclarEstadosApp, separarCandidatos,
  contarCandidatosParaDecidir, MOTIVOS_RECUSA_CANDIDATO, caminhoArquivoCandidato,
} from '../candidatos.js';
import { faixaExecucao } from '../componentes/execucao.js';
import { moldura } from '../componentes/janelas.js';
import { cab, selo, chipFiltro, vazio, campo, segmento, painelCarregando } from './pecas.js';
import { fichaDoTexto, separarTextoRadar, numerosDoTexto, referenciasEmLista, htmlTextoRadar } from './ficha.js';

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

/**
 * Contador da navegação e do Início: pautas para decidir (0 enquanto a planilha não respondeu) mais
 * os candidatos passados para Para decidir no app, sem o Radar (bloco "Candidatos para decidir").
 */
export function contarParaDecidir(dados = pautasLidas(), candidatos = candidatosLidas(), locais = estado.candidatosLocais) {
  const pautas = dados?.selecao ? pautasParaDecidir(dados.selecao, dados.decisoes).length : 0;
  return pautas + contarCandidatosParaDecidir(candidatos, { locais: locais || {}, selecao: dados?.selecao || null });
}

/**
 * Aprovadas que podem ir ao Roteirista (sem testes): sem envio ativo ou concluído em `envios`
 * (enviosAoRoteirista, js/envios.js). Um envio que falhou devolve a pauta ("Tentar de novo"); um
 * `ok` nunca devolve.
 */
export function aprovadasParaEnviar(selecao, decisoes, { envios = [] } = {}) {
  const est = estadoDasPautas(selecao, decisoes);
  const env = mapaDeEnvios(envios);
  return (selecao?.pautas || []).filter((p) => !ehIdTeste(p.id_pauta) && est.get(p.id_pauta)?.status === STATUS_PAUTA.aprovada && podeEnviar(env.get(p.id_pauta)));
}

/** Os envios ao Roteirista como a tela vê (Execuções lidas + projetos do Drive + registro otimista). */
export function enviosDaTela({ dados = pautasLidas(), exec = execucoesLidas(), projetos = roteiros(), locais = estado.enviosLocais, agora = new Date() } = {}) {
  return enviosAoRoteirista({ selecao: dados?.selecao || null, decisoes: dados?.decisoes || null, execucoes: exec?.execucoes || [], projetos, agora, locais: locais || {} });
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

/**
 * A pauta continua proposta, mas o candidato dela foi aprovado para o Roteirista (linha de Decisões
 * por id_candidato, sem id_pauta: "Mandar ao Roteirista" na lista de candidatos). O Radar deixou a
 * pauta para decidir porque a verificação das fontes não passou: ela fica em Para decidir (precisa de
 * uma decisão nova, sobre a pauta verificada), com este aviso.
 */
function notaAprovadoSemEnvio(p, est, ctx) {
  if (est.status !== STATUS_PAUTA.proposta || !p.id_candidato) return '';
  const a = aprovacaoDoCandidato(ctx.decisoes, p.id_candidato);
  if (!a) return '';
  const q = lerDataHora(a.data);
  const quando = q ? ` em ${formatarData(q)}` : '';
  const texto = `Você mandou o candidato ${p.id_candidato} ao Roteirista${quando}, mas a verificação das fontes não passou: o Radar deixou esta pauta para decidir e ela não foi ao Roteirista.${p.estado_verificacao ? ` Verificação: ${p.estado_verificacao}.` : ''}`;
  return `<p class="nota atencao pequeno" role="status">${ic('alerta', 18)}<span>${esc(texto)}</span></p>`;
}

const TOM_RESULTADO = { gravar: 'ok', nada: 'calma', recusado: 'atencao', erro: 'atencao' };

/** Tom do selo de verificação: reprovada/pendente pesam na decisão (alerta); aprovada = ok. */
export function tomDaVerificacao(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return 'neutro';
  if (/reprov|pendent|falh|n[aã]o passou|erro|incomplet|aguard/.test(s)) return 'alerta';
  if (/aprov|verificad|^ok$|passou|confirmad/.test(s)) return 'ok';
  return 'neutro';
}

/** "Prazo: … · Verificação [selo] · Lote …" do cartão de Para decidir (legível, não apagado). */
function linhaPrazo(p) {
  const partes = [
    p.prazo ? esc(`Prazo: ${p.prazo}`) : '',
    p.estado_verificacao ? `<span class="verif">Verificação ${selo(p.estado_verificacao, tomDaVerificacao(p.estado_verificacao))}</span>` : '',
    p.id_lote ? esc(`Lote ${p.id_lote}`) : '',
  ].filter(Boolean);
  return partes.length ? `<p class="linha-id pequeno">${partes.join('<span aria-hidden="true"> · </span>')}</p>` : '';
}

/** Corpo de um campo longo: com rótulos do Radar, um parágrafo por rótulo (rótulo em negrito). */
function corpoDoCampo(texto) {
  return separarTextoRadar(texto).map((s) => {
    const refs = s.chave === 'REFERÊNCIAS' ? referenciasEmLista(s.texto) : [];
    const rot = s.rotulo ? `<b>${esc(s.rotulo)}${s.nota ? ` (${esc(s.nota)})` : ''}:</b> ` : '';
    return refs.length > 1
      ? `<p>${rot}</p><ol class="ficha-refs">${refs.map((r) => `<li>${htmlTextoRadar(r)}</li>`).join('')}</ol>`
      : `<p>${rot}${htmlTextoRadar(s.texto)}</p>`;
  }).join('');
}

/** As seções recolhidas do cartão de pauta (Ficha): uma por campo preenchido, e os dados no fim. */
function secoesDaPauta(p) {
  const campos = [
    ['Fundamentação', p.fundamentacao], ['Restrição principal', p.restricao_principal],
    ['Público e situação', p.publico_situacao], ['Entrega', p.entrega], ['Sinal social', p.sinal_social],
    ['Contribuição junguiana', p.contribuicao_junguiana], ['Ganchos opcionais', p.ganchos_opcionais],
  ].filter(([, v]) => String(v || '').trim());
  const secoes = campos.map(([rotulo, v]) => `<details class="ficha-secao"><summary>${esc(rotulo)}</summary><div class="ficha-corpo">${corpoDoCampo(v)}</div></details>`);
  const dados = [item('Semana', p.semana), item('Data da seleção', p.data_selecao), item('Candidato', p.id_candidato)].join('');
  if (dados) secoes.push(`<details class="ficha-secao"><summary>Dados da pauta</summary><div class="ficha-corpo"><dl>${dados}</dl></div></details>`);
  return secoes.length ? `<div class="ficha-secoes">${secoes.join('')}</div>` : '';
}

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
    ${(pendente === 'recusada' || pendente === 'aprovada') && !ctx.bloqueio ? `<div class="pilha" style="gap:.875rem">
      ${pendente === 'recusada' ? `${segmento(`pm-${id}`, 'Que tipo de problema?', MOTIVOS_RECUSA.map((m) => [m, m.charAt(0).toUpperCase() + m.slice(1)]), '')}
      ${ctx.erros[`pm-${id}`] ? `<p class="erro">${esc(ctx.erros[`pm-${id}`])}</p>` : ''}` : ''}
      ${campo({ modelo: `po-${id}`, rotulo: 'Por quê, em uma linha', opcional: pendente === 'aprovada', exemplo: pendente === 'recusada' ? 'Ex.: já falamos disso em outubro' : 'Ex.: é a dúvida que mais chega', dica: 'O Radar usa o seu motivo para acertar as próximas sugestões.' })}
    </div>` : ''}`;
  }

  return `<article class="painel pauta ${classe}" aria-labelledby="p-${esc(id)}">
    <div class="pauta-topo">
      ${anelNota(p.nota_v2)}
      <div class="pilha leitura" style="gap:.375rem">
        <h2 id="p-${esc(id)}">${esc(titulo)}</h2>
        ${p.tema ? `<p class="subtitulo">${esc(p.tema)}</p>` : ''}
        <div class="meta selos"><span class="id">${esc(id)}</span>${ctx.filtro === 'decidir' && est.status === STATUS_PAUTA.proposta ? '' : selo(rotuloEstado, tom)}${p.rede ? selo(nomeRede(p.rede), 'neutro') : ''}${teste ? selo('Teste') : ''}</div>
      </div>
    </div>
    <dl>
      ${item('Pergunta central', p.pergunta_central)}
      ${item('Por que agora', p.por_que_agora)}
    </dl>
    ${linhaPrazo(p)}
    ${est.decisao && decidida ? `<p class="pequeno apagado">${esc(linhaDaDecisao(est.decisao, ctx.agora))}</p>` : ''}
    ${notaAprovadoSemEnvio(p, est, ctx)}
    ${secoesDaPauta(p)}
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
  visiveis = LIMITE_CANDIDATOS, agora = new Date(), projetos = [], enviosLocais = {}, candidatosLocais = {}, verExcluidos = false,
  errosCandidato = {},
} = {}) {
  const topo = `${cab('Pautas', 'As sugestões do Radar para a semana, da maior nota para a menor.')}${faixas(exec, dados, agora)}`;
  const largura = 'style="max-width:58.75rem;margin-top:1rem"';
  const grupos = gruposDeCandidatos({ candidatos, dados, locais: candidatosLocais });
  const nCandidatos = grupos ? grupos.candidatos.length : null;
  const nCandDecidir = grupos ? grupos.paraDecidir.length : 0;
  const opcoesCand = { candidatos, dados, exec, email, agora, locais: candidatosLocais, errosCandidato };

  if (filtro === 'candidatos') {
    const contas = dados.selecao ? contagemDasPautas(dados.selecao, dados.decisoes) : {};
    if (Number.isInteger(contas.decidir)) contas.decidir += nCandDecidir;
    const so = !podeDecidir(email);
    const nota = so ? `<p class="nota calma" ${largura}>${ic('info')}<span>${esc(NOTA_SO_ROBERTTA)} Esta conta vê os candidatos, mas não manda ao Roteirista, não passa para Para decidir e não exclui.</span></p>` : '';
    return `${topo}${nota}${filtrosPautas(filtro, { candidatos: nCandidatos, ...contas })}${htmlCandidatos({ ...opcoesCand, visiveis, verExcluidos })}`;
  }

  // Para decidir: os candidatos passados para cá pelo app (sem o Radar), num bloco antes das pautas.
  const blocoCand = filtro === 'decidir' && nCandDecidir ? blocoCandidatosParaDecidir({ ...opcoesCand, lista: grupos.paraDecidir }) : '';

  if (!dados.selecao) {
    const chips = filtrosPautas(filtro, { candidatos: nCandidatos });
    if (dados.fase === 'carregando' || dados.fase === 'vazio' || dados.fase === undefined) {
      if (dados.offline) return `${topo}${chips}${blocoCand}<div class="painel" ${largura}>${vazio('Sem internet', 'Assim que a conexão voltar, as pautas da aba Seleção aparecem aqui.')}</div>`;
      return `${topo}${chips}<div ${largura}>${painelCarregando('Lendo a planilha Radar…')}</div>`;
    }
    const e = dados.erro;
    if (e?.codigo === 'aba-ausente') return `${topo}${chips}${blocoCand}<div class="painel" ${largura}>${vazio('Ainda sem a aba Seleção', esc(MENSAGEM_SELECAO_AUSENTE))}</div>`;
    const texto = dados.offline ? 'Sem internet. Assim que a conexão voltar, toque em “Tentar de novo”.'
      : esc(e?.message || 'A planilha Radar não respondeu agora.');
    return `${topo}${chips}${blocoCand}<div class="painel" role="alert" ${largura}>${vazio('Não consegui ler a planilha Radar', texto, `<button type="button" class="botao contorno" data-acao="pautas-recarregar">${ic('atualizar', 18)} Tentar de novo</button>`)}</div>`;
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
  const ctx = { estado: est, decisoes, pendentes, mudando, resultados, erros, bloqueio, agora, filtro, notaNoTopo };

  const estrutural = !bloqueio ? ''
    : notaNoTopo ? `<p class="nota calma" ${largura}>${ic('info')}<span>${esc(NOTA_SO_ROBERTTA)} Esta conta vê as pautas e pode pedir rodadas, mas não aprova nem recusa.</span></p>`
      : `<p class="nota atencao" ${largura}>${ic('alerta')}<span>${esc(bloqueio)}</span></p>`;
  const filtros = filtrosPautas(filtro, { candidatos: nCandidatos, decidir: nDecidir + nCandDecidir, decididas: todas.length - nDecidir, todas: todas.length });
  const vazioLista = filtro === 'decididas' ? vazio('Nenhuma pauta decidida ainda', 'As pautas que você aprovar ou recusar ficam aqui.')
    : todas.length ? vazio('Nada para decidir agora', 'O Radar grava as próximas pautas na seleção de domingo, ou quando você pedir uma seleção agora.')
      : vazio('Nenhuma pauta na aba Seleção', 'O Radar grava as pautas aqui na seleção de domingo, ou quando você pedir uma seleção agora.');
  const corpo = lista.length ? `<div class="pautas">${lista.map((p) => cartao(p, ctx)).join('')}</div>`
    : blocoCand ? '' : `<div class="painel" ${largura}>${vazioLista}</div>`;

  const envios = enviosAoRoteirista({ selecao, decisoes, execucoes: exec?.execucoes || [], projetos, agora, locais: enviosLocais || {} });
  return `${topo}${estrutural}${filtros}${blocoCand}${corpo}${bandeja({ selecao, decisoes, pendentes, bloqueio, est, envios })}`;
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
function bandeja({ selecao, decisoes, pendentes, bloqueio, est, envios = [] }) {
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
  const aprovadas = aprovadasParaEnviar(selecao, decisoes, { envios });
  const m = aCaminho(envios).filter((e) => !ehIdTeste(e.id_pauta)).length;
  const n = aprovadas.length;
  if (!n && !m) return '';
  const so = bloqueio === NOTA_SO_ROBERTTA;
  const caminho = m ? `<span>${m} a caminho do Roteirista · <a href="#/roteiros">ver em Roteiros</a></span>` : '';
  const espera = n ? `<span>${n} ${n === 1 ? 'aprovada espera' : 'aprovadas esperam'} o Roteirista${so ? ' (só a conta da Robertta envia)' : ''}</span>` : '';
  // Sem pauta que possa ir agora, não há botão (só o "a caminho").
  const botao = n ? `<button type="button" class="botao primario menor" data-acao="pautas-enviar"${so ? ' disabled' : ''}>Enviar ao Roteirista (${n} ${n === 1 ? 'aprovada' : 'aprovadas'})</button>` : '';
  return `<div class="bandeja" role="region" aria-label="Enviar ao Roteirista">
    <span class="bandeja-texto">${[espera, caminho].filter(Boolean).join(' ')}</span>
    ${botao}
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

const COMPACTO = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * Lê um número da planilha ("120000", "120.000", "1,5", "8x") ou devolve null quando o texto não é
 * só um número (aí o cartão mostra o texto original, escapado).
 */
export function numeroDaPlanilha(v) {
  let s = String(v ?? '').trim().replace(/\s+/g, '').replace(/[x×]$/i, '');
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "120 mil", "1,5 mi" quando é número; senão o texto original (texto puro: quem monta o HTML escapa). */
export function numeroCompacto(v) {
  const n = numeroDaPlanilha(v);
  return n === null ? String(v ?? '').trim() : COMPACTO.format(n);
}

/** Nome de usuário solto ("thomytalks") ganha @; com @, endereço ou frase fica como está (texto puro). */
export function comArroba(criador) {
  const t = String(criador ?? '').trim();
  return /^[\p{L}\p{N}._]+$/u.test(t) ? `@${t}` : t;
}

/** "120 mil visualizações · mediana 15 mil · 8× a mediana · @criador" (texto puro, partes vazias somem). */
export function linhaDosNumeros(c) {
  const vis = String(c?.visualizacoes ?? '').trim();
  const med = String(c?.mediana_do_criador ?? '').trim();
  const out = String(c?.outlier_x ?? '').trim();
  const nOut = numeroDaPlanilha(out);
  return [
    vis ? (numeroDaPlanilha(vis) === null ? `Visualizações: ${vis}` : `${numeroCompacto(vis)} visualizações`) : '',
    med ? `mediana ${numeroCompacto(med)}` : '',
    out ? (nOut === null ? `outlier ${comX(out)}` : `${COMPACTO.format(nOut)}× a mediana`) : '',
    comArroba(c?.criador),
  ].filter(Boolean);
}

/** O selo de estado do cartão de candidato (um só): [rótulo, tom] ou null. */
function seloDoCandidato(est, nova) {
  switch (est.tipo) {
    case 'pauta': return [`Virou pauta ${est.pauta.id_pauta}`, 'ok'];
    case 'andamento': return ['Em andamento', 'espera'];
    case 'parece-travada': return ['Parece travado', 'alerta'];
    case 'erro': return ['Erro', 'alerta'];
    case 'aprovado': return ['Aprovado', 'ok'];
    default: return nova ? ['Nova rodada', 'acao'] : null;
  }
}

/** A linha de estado do cartão (todo dado passa por esc). */
function linhaDoEstado(est, ctx) {
  switch (est.tipo) {
    case 'pauta': {
      const p = est.pauta;
      // O selo "Virou pauta Sxx" fica no topo do cartão; aqui o resto do estado vai em texto.
      if (est.enviada) return `<p class="pequeno estado-candidato">${esc(`A pauta ${p.id_pauta} foi enviada ao Roteirista.`)}</p>`;
      if (est.ficouParaDecidir) {
        // "Mandar ao Roteirista" pedido, mas o Radar deixou a pauta como proposta.
        const det = est.detalhe ? ` O Radar disse: ${est.detalhe}` : '';
        return `<p class="nota atencao pequeno" role="status">${ic('alerta', 18)}<span>${esc(`Aprovado, mas a pauta ${p.id_pauta} ficou para decidir: a verificação das fontes não passou e ela não foi ao Roteirista.${det}`)} Decida a pauta em Para decidir.</span></p>`;
      }
      const [rotulo] = SELO_ESTADO[est.status] || [p.statusOriginal || est.status || 'sem status'];
      const ainda = est.aberto ? ' O Radar ainda está terminando o pedido.' : '';
      return `<p class="pequeno estado-candidato">${esc(`A pauta ${p.id_pauta} está como: ${rotulo}.${ainda}`)}</p>`;
    }
    case 'andamento': {
      const l = est.linha;
      const desde = l.inicioData ? ` desde ${quando(l.inicioData, ctx.agora)}` : '';
      return `<p class="nota calma pequeno" role="status">${ic('info', 18)}<span>${esc(`Pedido em andamento (${l.status}${desde}). Os botões voltam se ele der erro.`)}</span></p>`;
    }
    case 'parece-travada':
      return `<p class="nota atencao pequeno" role="status">${ic('alerta', 18)}<span>O pedido está aberto há mais de 2 h e parece travado. Dá para pedir de novo: a janela pede para marcar o antigo como travado.</span></p>`;
    case 'erro':
      return `<p class="nota atencao pequeno" role="status">${ic('alerta', 18)}<span>${esc(`O último pedido deu erro${est.erro ? `: ${est.erro}` : ''}.`)} Dá para tentar de novo${est.aprovacao ? ' (a aprovação já está em Decisões e não é gravada outra vez)' : ''}.</span></p>`;
    case 'aprovado':
      return '<p class="pequeno estado-candidato">A aprovação está em Decisões; a pauta ainda não apareceu na aba Seleção.</p>';
    case 'concluido':
      return `<p class="nota calma pequeno" role="status">${ic('info', 18)}<span>O Radar terminou o pedido, mas a pauta ainda não apareceu na aba Seleção. Toque em Atualizar daqui a pouco.</span></p>`;
    default:
      return '';
  }
}

/** Uma seção recolhida da Ficha (HTML escapado; Referências numeradas viram lista). */
function secaoDaFicha(s) {
  const nota = s.nota ? ` <small>${esc(s.nota)}</small>` : '';
  const refs = s.rotulo === 'Referências' ? referenciasEmLista(s.texto) : [];
  const corpo = refs.length > 1
    ? `<ol class="ficha-refs">${refs.map((r) => `<li>${htmlTextoRadar(r)}</li>`).join('')}</ol>`
    : `<p>${htmlTextoRadar(s.texto)}</p>`;
  return `<details class="ficha-secao"><summary>${esc(s.rotulo)}${nota}</summary><div class="ficha-corpo">${corpo}</div></details>`;
}

function cartaoCandidato(c, ctx) {
  const id = c.id;
  const nova = ctx.nova.has(id);
  const est = estadoDoCandidato(c, ctx.fontes);
  // Ficha: o texto do Radar separado pelos rótulos (PERGUNTA vira o título; o resto, seções recolhidas).
  const ficha = fichaDoTexto(c.angulo || '');
  const titulo = ficha.titulo || c.tema || `Candidato ${id}`;
  const href = hrefWeb(c.link);
  let host = '';
  try { host = href ? new URL(href).hostname.replace(/^www\./, '') : ''; } catch { host = ''; }
  const link = href
    ? `<p class="pequeno"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Abrir o post${host ? ` (${esc(host)})` : ''}</a></p>`
    : (c.link ? '<p class="pequeno apagado">O link não é http nem https: o app não abre.</p>' : '');
  const data = c.dataData ? formatarData(c.dataData) : c.data;
  const origem = rotuloOrigem(c.origem);
  // Linha discreta: id · data · origem. O id_execucao (longo, técnico) fica nos Detalhes.
  const rodape = [id, data || '', origem ? `rodada ${origem}` : '']
    .filter(Boolean).map(esc).join(' · ');
  const numerosLivres = numerosDoTexto(c.visualizacoes);
  const criadorCurto = comArroba(c.criador);
  const linhaNumeros = numerosLivres.length
    ? [...numerosLivres.map((n) => `<b>${esc(n.valor)}</b> ${esc(n.rotulo)}`),
      // mediana e outlier só quando são número (o "N/D …" fica na seção Números e origem)
      ...(numeroDaPlanilha(c.mediana_do_criador) !== null ? [esc(`mediana ${numeroCompacto(c.mediana_do_criador)}`)] : []),
      ...(numeroDaPlanilha(c.outlier_x) !== null ? [esc(`${COMPACTO.format(numeroDaPlanilha(c.outlier_x))}× a mediana`)] : []),
      ...(criadorCurto && criadorCurto.length <= 40 && !/\s/.test(criadorCurto) ? [esc(criadorCurto)] : [])]
    : linhaDosNumeros(c).map(esc);
  const secoes = [...ficha.secoes.map(secaoDaFicha)];
  if (numerosLivres.length) {
    const dl = [item('Visualizações', c.visualizacoes), item('Mediana', c.mediana_do_criador), item('Outlier', c.outlier_x), item('Criador', c.criador)].join('');
    secoes.push(`<details class="ficha-secao"><summary>Números e origem</summary><div class="ficha-corpo"><dl>${dl}</dl></div></details>`);
  }
  const estadoSelo = seloDoCandidato(est, nova);
  const detalhes = [item('Status na planilha', c.status), item('Execução', c.id_execucao)].join('');
  const acoes = acoesDoCandidato(c, est, ctx, titulo);
  const falha = ctx.errosCandidato?.[id];
  const notaFalha = falha
    ? `<p class="nota atencao pequeno" role="alert">${ic('alerta', 18)}<span>${esc(`Não gravei no Drive: ${falha.mensagem}`)} <button type="button" class="botao calmo menor" data-acao="candidato-mover" data-id="${esc(id)}" data-valor="${esc(falha.para)}">Tentar de novo</button></span></p>`
    : '';

  return `<article class="painel pauta candidato${nova ? ' nova' : ''}" aria-labelledby="cand-${esc(id)}">
    <div class="pauta-topo">
      ${anelNota(c.nota)}
      <div class="pilha leitura" style="gap:.375rem">
        ${c.tema && ficha.titulo ? `<p class="subtitulo">${esc(c.tema)}</p>` : ''}
        <h2 id="cand-${esc(id)}">${esc(titulo)}</h2>
        ${estadoSelo || c.plataforma ? `<div class="meta selos">${estadoSelo ? selo(estadoSelo[0], estadoSelo[1]) : ''}${c.plataforma ? selo(c.plataforma, 'neutro') : ''}</div>` : ''}
      </div>
    </div>
    ${ficha.entrega ? `<p class="ficha-entrega"><b>Entrega:</b> ${htmlTextoRadar(ficha.entrega)}</p>` : ''}
    ${linhaNumeros.length ? `<p class="candidato-numeros">${linhaNumeros.map((n) => `<span>${n}</span>`).join('<span aria-hidden="true"> · </span>')}</p>` : ''}
    ${link}
    ${linhaDoEstado(est, ctx)}
    ${secoes.length ? `<div class="ficha-secoes">${secoes.join('')}</div>` : ''}
    ${rodape ? `<p class="linha-id pequeno">${rodape}</p>` : ''}
    ${detalhes ? `<details><summary>Detalhes</summary><dl>${detalhes}</dl></details>` : ''}
    ${notaFalha}
    ${acoes}
  </article>`;
}

/**
 * Botões do cartão de candidato (todos <button>, com data-id escapado).
 *   modo 'candidatos': Passar para Para decidir (primário: só o estado no app, sem o Radar) · Mandar
 *     ao Roteirista (contorno) · Pedir pauta completa ao Radar (calmo) · Excluir (discreto, no fim)
 *   modo 'decidir' (bloco "Candidatos para decidir"): Aprovar e mandar ao Roteirista (primário) ·
 *     Pedir pauta completa ao Radar (contorno) · Recusar (calmo) · Voltar para Candidatos (discreto)
 * Com pedido ao Radar aberto, nada de mover/excluir/recusar (só Voltar, no bloco). Gravando: a nota.
 */
function acoesDoCandidato(c, est, ctx, titulo) {
  const id = c.id;
  if (!c.idOk) return `<p class="pequeno apagado">${ic('info', 16)} Id fora do formato AAAA-MM-DD-NN: o app não pede nada para este candidato.</p>`;
  if (ctx.estados?.get(id)?.pendente) return `<p class="nota calma pequeno" role="status">${ic('info', 18)}<span>Gravando no Drive…</span></p>`;
  const emAndamento = est.tipo === 'andamento' || est.tipo === 'parece-travada';
  const dis = ctx.bloqueio ? ' disabled' : '';
  const disApp = dis || (ctx.bloqueioApp ? ' disabled' : '');
  const disR = dis || (ctx.bloqueioRoteirista ? ' disabled' : '');
  const did = esc(id);
  const botao = (classe, acao, valor, texto, d) => `<button type="button" class="${classe}" data-acao="${acao}" data-id="${did}"${valor ? ` data-valor="${esc(valor)}"` : ''}${d}>${esc(texto)}</button>`;
  const b = [];
  if (ctx.modo === 'decidir') {
    if (est.podePedir) {
      b.push(botao('botao primario', 'candidato-pedir', 'roteirista', 'Aprovar e mandar ao Roteirista', disR));
      b.push(botao('botao contorno', 'candidato-pedir', 'decidir', DESTINOS_CANDIDATO.decidir.botao, dis));
    }
    if (!emAndamento && est.tipo !== 'aprovado') b.push(botao('botao calmo nao', 'candidato-recusar', '', 'Recusar', disApp));
    b.push(botao('discreto', 'candidato-mover', 'candidato', 'Voltar para Candidatos', disApp));
  } else {
    if (est.podePedir && est.tipo !== 'parece-travada') b.push(botao('botao primario', 'candidato-mover', 'para-decidir', 'Passar para Para decidir', disApp));
    if (est.podePedir) {
      b.push(botao('botao contorno', 'candidato-pedir', 'roteirista', DESTINOS_CANDIDATO.roteirista.botao, disR));
      b.push(botao('botao calmo', 'candidato-pedir', 'decidir', DESTINOS_CANDIDATO.decidir.botao, dis));
    }
    if (!emAndamento) b.push(botao('discreto excluir', 'candidato-excluir', '', 'Excluir', disApp));
  }
  if (!b.length) return '';
  const nota = ctx.bloqueio ? (ctx.notaNoTopo ? '' : ctx.bloqueio)
    : [est.podePedir ? ctx.bloqueioRoteirista : '', ctx.bloqueioApp].filter(Boolean).join(' ');
  return `<div class="decisao" role="group" aria-label="${esc(`Ações do candidato: ${titulo}`)}">
      ${b.join('\n      ')}
      ${nota ? `<span class="pequeno apagado">${esc(nota)}</span>` : ''}
    </div>`;
}

/**
 * Candidatos da tela em grupos, pelo estado no app (o lido do Drive + o otimista da tela):
 * {candidatos, paraDecidir, excluidos, estados} ou null enquanto a aba não foi lida. Os "para
 * decidir" que já viraram pauta na Seleção saem do bloco (a pauta aparece pela Seleção).
 */
export function gruposDeCandidatos({ candidatos = {}, dados = {}, locais = {} } = {}) {
  if (!candidatos?.candidatos) return null;
  const estados = mesclarEstadosApp(candidatos.app?.registros, locais || {});
  const comPauta = new Set((dados?.selecao?.pautas || []).map((p) => p.id_candidato).filter(Boolean));
  return { ...separarCandidatos(candidatosDaTela(candidatos), estados, (c) => (comPauta.has(c.id) ? 'pauta' : '')), estados };
}

/** Por que mover/excluir/recusar esperam: o estado dos candidatos no Drive não foi lido ('' = pode). */
export function bloqueioDoArquivoApp(candidatos) {
  return candidatos?.app?.erro ? 'O estado dos candidatos no Drive não foi lido: mover, excluir e recusar esperam o “Atualizar”.' : '';
}

/** O contexto comum dos cartões de candidato (chip Candidatos e bloco de Para decidir). */
function contextoDosCandidatos({ candidatos = {}, dados = {}, exec = {}, email = '', agora = new Date(), locais = {}, errosCandidato = {}, modo = 'candidatos', lista = [] }) {
  const execucoes = exec.execucoes || [];
  const bloqueio = bloqueioDeCandidato({ email, offline: candidatos.offline });
  const rodada = ultimaRodada({ candidatos: lista, temIdExecucao: !!candidatos.temIdExecucao, execucoes });
  return {
    modo,
    rodada,
    nova: modo === 'candidatos' ? rodada.ids : new Set(),
    fontes: { selecao: dados.selecao || null, decisoes: dados.decisoes || null, execucoes, agora, estadoPautas: dados.selecao ? estadoDasPautas(dados.selecao, dados.decisoes) : new Map() },
    bloqueio,
    bloqueioRoteirista: bloqueioDeRoteirista(dados),
    bloqueioApp: bloqueioDoArquivoApp(candidatos),
    notaNoTopo: bloqueio === NOTA_SO_ROBERTTA,
    estados: mesclarEstadosApp(candidatos.app?.registros, locais || {}),
    errosCandidato: errosCandidato || {},
    agora,
  };
}

/** "excluído hoje às 10h12" / "recusado em 14/11 às 9h · motivo" a partir do registro do app (texto puro). */
function textoDoRegistro(r, agora) {
  const q = r?.quando ? new Date(r.quando) : null;
  const ok = q && Number.isFinite(q.getTime());
  const quandoTxt = ok ? ` ${hojeISO(q) === hojeISO(agora) ? 'hoje' : `em ${formatarData(q)}`} às ${horaCurta(q)}` : '';
  if (r?.estado === 'recusado') return `Recusado${quandoTxt}${r.motivo ? ` · ${r.motivo}` : ''}`;
  return `Excluído${quandoTxt}`;
}

/** Cartão curto de um excluído/recusado, com "Restaurar" (volta para Candidatos). */
function cartaoExcluido(c, ctx) {
  const id = c.id;
  const r = ctx.estados.get(id);
  const titulo = c.angulo || c.tema || `Candidato ${id}`;
  const dis = ctx.bloqueio || ctx.bloqueioApp ? ' disabled' : '';
  const acao = r?.pendente ? `<p class="nota calma pequeno" role="status">${ic('info', 18)}<span>Gravando no Drive…</span></p>`
    : `<div class="decisao"><button type="button" class="botao contorno" data-acao="candidato-mover" data-id="${esc(id)}" data-valor="candidato"${dis}>Restaurar</button></div>`;
  const falha = ctx.errosCandidato?.[id];
  return `<article class="painel pauta candidato excluido" aria-labelledby="cand-x-${esc(id)}">
    <div class="pilha leitura" style="gap:.375rem">
      <h2 id="cand-x-${esc(id)}">${esc(titulo)}</h2>
      ${c.tema && c.angulo ? `<p class="subtitulo">${esc(c.tema)}</p>` : ''}
    </div>
    <p class="linha-id pequeno">${[id, textoDoRegistro(r, ctx.agora)].map(esc).join(' · ')}</p>
    ${falha ? `<p class="nota atencao pequeno" role="alert">${ic('alerta', 18)}<span>${esc(`Não gravei no Drive: ${falha.mensagem}`)}</span></p>` : ''}
    ${acao}
  </article>`;
}

/**
 * Bloco "Candidatos para decidir (sem verificação do Radar)" no chip Para decidir (puro): os
 * candidatos passados para cá pelo app, no estilo do cartão, com as ações do modo 'decidir'.
 */
export function blocoCandidatosParaDecidir({ lista = [], ...o } = {}) {
  if (!lista.length) return '';
  const ctx = contextoDosCandidatos({ ...o, modo: 'decidir', lista });
  const n = lista.length;
  return `<section class="bloco-candidatos" aria-labelledby="cand-decidir-titulo">
    <h2 id="cand-decidir-titulo" class="bloco-titulo">Candidatos para decidir (sem verificação do Radar)</h2>
    <p class="pequeno apagado candidatos-intro">${esc(`${n === 1 ? 'Este candidato veio' : `Estes ${n} candidatos vieram`} de Candidatos sem passar pelo Radar: as fontes ainda não foram verificadas. “Aprovar e mandar ao Roteirista” pede ao Radar que verifique e mande; “Pedir pauta completa ao Radar” só verifica e cria a pauta.`)}</p>
    <div class="pautas">${lista.map((c) => cartaoCandidato(c, ctx)).join('')}</div>
  </section>`;
}

/**
 * A lista do chip Candidatos (puro).
 *   candidatos  candidatosLidas()   dados  pautasLidas()   exec  execucoesLidas()
 *   email, visiveis (quantos antes do "Mostrar mais"), agora
 */
export function htmlCandidatos({
  candidatos = {}, dados = {}, exec = {}, email = '', visiveis = LIMITE_CANDIDATOS, agora = new Date(), locais = {}, verExcluidos = false, errosCandidato = {},
} = {}) {
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

  const grupos = gruposDeCandidatos({ candidatos, dados, locais });
  const lista = grupos.candidatos;
  const ctx = contextoDosCandidatos({ candidatos, dados, exec, email, agora, locais, errosCandidato, modo: 'candidatos', lista });
  const { bloqueio } = ctx;
  const nExcl = grupos.excluidos.length;
  const nDec = grupos.paraDecidir.length;
  // Chip discreto "Excluídos (n)" (abre a lista com Restaurar); some quando não há nenhum.
  const chipExcl = nExcl
    ? `<div class="excluidos-candidatos"><button type="button" class="discreto" data-acao="candidatos-excluidos" aria-expanded="${verExcluidos ? 'true' : 'false'}" aria-controls="cand-excluidos">${esc(`Excluídos (${nExcl})`)}</button></div>`
    : '';
  const ctxX = { ...ctx, modo: 'excluidos' };
  const listaExcl = nExcl && verExcluidos
    ? `<section id="cand-excluidos" class="bloco-candidatos" aria-label="Candidatos excluídos e recusados"><p class="pequeno apagado candidatos-intro">Excluídos e recusados no app. Restaurar devolve o cartão para Candidatos; nada foi apagado da planilha nem do Drive.</p><div class="pautas">${grupos.excluidos.map((c) => cartaoExcluido(c, ctxX)).join('')}</div></section>`
    : '';
  const notaApp = ctx.bloqueioApp ? `<p class="nota atencao" ${largura}>${ic('alerta')}<span>${esc(`${candidatos.app.erro} ${ctx.bloqueioApp}`)}</span></p>` : '';
  const emDecidir = nDec ? ` ${nDec === 1 ? '1 candidato está' : `${nDec} candidatos estão`} em Para decidir.` : '';

  if (!lista.length) {
    const soTestes = candidatos.candidatos.length > 0 && !nExcl && !nDec;
    const titulo = nExcl || nDec ? 'Nenhum candidato esperando aqui' : 'Nenhum candidato na aba Candidatos';
    const texto = soTestes ? 'Só há candidatos de teste (T), e eles ficam fora daqui.'
      : nExcl || nDec ? esc(`Os outros já foram passados para Para decidir ou excluídos.${emDecidir}`)
        : 'O Radar diário grava os candidatos aqui: todo dia às 7h, ou quando você pedir “Rodar agora”.';
    return `${notaApp}<div class="painel" ${largura}>${vazio(titulo, texto)}</div>${chipExcl}${listaExcl}`;
  }

  const textoRodada = textoDaRodada(ctx.rodada, { agora, execucoesLidas: !!exec.execucoes });
  const limite = Math.max(1, Number(visiveis) || LIMITE_CANDIDATOS);
  const mostrar = lista.slice(0, limite);
  const resto = lista.length - mostrar.length;
  const aviso = bloqueio && bloqueio !== NOTA_SO_ROBERTTA ? `<p class="nota atencao" ${largura}>${ic('alerta')}<span>${esc(bloqueio)}</span></p>` : '';
  const total = lista.length === 1 ? '1 candidato' : `${lista.length} candidatos`;
  const intro = `<p class="pequeno apagado candidatos-intro">Candidatos do Radar diário, do mais recente para o mais antigo (${total}). “Passar para Para decidir” só muda o estado no app, sem chamar o Radar; “Pedir pauta completa ao Radar” pede a pauta verificada.${esc(emDecidir)}${textoRodada ? ` ${esc(textoRodada)}` : ''}</p>`;
  const mais = resto > 0
    ? `<div class="mais-candidatos"><button type="button" class="botao calmo" data-acao="candidatos-mais">Mostrar mais (${resto === 1 ? 'falta 1' : `faltam ${resto}`})</button></div>`
    : '';
  return `${aviso}${notaApp}${intro}<div class="pautas">${mostrar.map((c) => cartaoCandidato(c, ctx)).join('')}</div>${mais}${chipExcl}${listaExcl}`;
}

/* -------------------------------------------- janelas do estado do candidato */

/** Resumo do candidato no topo das janelas (título, tema, id · plataforma). Tudo escapado. */
function resumoDoCandidato(c) {
  const titulo = c?.angulo || c?.tema || `Candidato ${c?.id || ''}`;
  return `<div class="resumo-candidato">
      <p class="titulo-resumo">${esc(titulo)}</p>
      ${c?.tema && c?.angulo ? `<p class="subtitulo">${esc(c.tema)}</p>` : ''}
      <p class="linha-id pequeno">${[c?.id, c?.plataforma].filter(Boolean).map(esc).join(' · ')}</p>
    </div>`;
}

const notaErroJanela = (erro) => (erro ? `<p class="nota atencao" role="alert">${ic('alerta')}<span>${esc(erro)}</span></p>` : '');

/**
 * Janela "Excluir este candidato?" (pura). `situacao`: estadoDoCandidato (para avisar que a pauta
 * continua). Grava só `_motor/app/candidatos/<id>.json`.
 */
export function janelaExcluirCandidato({ c, situacao = null, enviando = false, erro = '' } = {}) {
  const id = c?.id || '';
  const pauta = situacao?.tipo === 'pauta' ? situacao.pauta?.id_pauta : '';
  const corpo = `${resumoDoCandidato(c)}
    <p>O cartão sai de Candidatos e fica em “Excluídos”, onde dá para restaurar.</p>
    ${pauta ? `<p class="nota calma" role="status">${ic('info')}<span>${esc(`A pauta ${pauta} continua na Seleção: excluir o candidato não muda a pauta.`)}</span></p>` : ''}
    <p class="pequeno apagado">${esc(`Onde grava: só o arquivo do app ${caminhoArquivoCandidato(id)} no Drive. Nada em Seleção, Decisões, na planilha ou em outras pastas do Drive é apagado ou alterado. O Radar ainda não lê esse arquivo: ele pode sugerir este candidato de novo.`)}</p>
    ${notaErroJanela(erro)}`;
  const rodape = `<button type="button" class="botao calmo" data-acao="fechar-janela">Voltar</button><button type="button" class="botao primario" data-acao="candidato-excluir-confirmar" data-id="${esc(id)}"${enviando ? ' disabled aria-busy="true"' : ''}>${enviando ? 'Excluindo…' : (erro ? 'Tentar de novo' : 'Excluir')}</button>`;
  return moldura('Excluir este candidato?', corpo, rodape);
}

/** Modelo (rascunho) do motivo da recusa de um candidato. */
export const modeloRecusaCandidato = (id) => `rcr-${id}`;

/**
 * Janela "Recusar este candidato?" (pura): o motivo (os mesmos da recusa de pauta) e onde grava
 * (só o arquivo do app; nada vai para Decisões nem para o Radar).
 */
export function janelaRecusarCandidato({ c, enviando = false, erro = '', erroMotivo = '' } = {}) {
  const id = c?.id || '';
  const modelo = modeloRecusaCandidato(id);
  const corpo = `${resumoDoCandidato(c)}
    <div class="pilha campos-janela">
      ${segmento(modelo, 'Por que recusar?', MOTIVOS_RECUSA_CANDIDATO.map((m) => [m, m.charAt(0).toUpperCase() + m.slice(1)]), '')}
      ${erroMotivo ? `<p class="erro" role="alert">${esc(erroMotivo)}</p>` : ''}
    </div>
    <p class="pequeno apagado">${esc(`Onde grava: só o arquivo do app ${caminhoArquivoCandidato(id)} no Drive, com o motivo. Nada vai para Decisões nem para o Radar; o cartão fica em “Excluídos”, onde dá para restaurar.`)}</p>
    ${notaErroJanela(erro)}`;
  const rodape = `<button type="button" class="botao calmo" data-acao="fechar-janela">Voltar</button><button type="button" class="botao primario" data-acao="candidato-recusar-confirmar" data-id="${esc(id)}"${enviando ? ' disabled aria-busy="true"' : ''}>${enviando ? 'Recusando…' : (erro ? 'Tentar de novo' : 'Recusar')}</button>`;
  return moldura('Recusar este candidato?', corpo, rodape);
}

/** Aviso depois de gravar o estado de um candidato (texto puro): o texto do plano + o aviso da pauta. */
export function textoDoEstadoGravado(res = {}) {
  return [res.texto, res.aviso].filter(Boolean).join(' ');
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
  const quem = [c?.id, c?.angulo || c?.tema, c?.criador ? `de ${comArroba(c.criador)}` : ''].filter(Boolean).join(' · ');
  const resumo = {
    titulo: c?.angulo || c?.tema || (c?.id ? `Candidato ${c.id}` : ''),
    tema: c?.angulo && c?.tema ? c.tema : '',
    numeros: c ? linhaDosNumeros(c).join(' · ') : '',
    id: [c?.id, c?.plataforma].filter(Boolean).join(' · '),
  };
  return [
    { chave: 'candidato', rotulo: 'O candidato', texto: quem, resumo },
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
    const observacao = String(valores[`po-${id}`] || '').replace(/\s+/g, ' ').trim();
    if (decisao === 'recusada' && !observacao) erros[`po-${id}`] = 'Diga por quê, em uma linha.';
    pedidos.push({ id_pauta: id, decisao, motivo, observacao });
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
    projetos: roteiros(),
    enviosLocais: estado.enviosLocais,
    candidatosLocais: estado.candidatosLocais,
    verExcluidos: !!estado.verExcluidos,
    errosCandidato: estado.errosCandidato,
  });
}

