// AÇÕES: todo elemento com data-acao="nome" chama ACOES.nome(elemento) ao ser clicado.
// Aqui também ficam as passagens login ⇄ app (entrarNoApp, mostrarLogin, sairDaConta).

import { $, NOME_REDE, relogio, ic } from './util.js';
import { FLAGS } from './config.js';
import { estado, rascunho, reiniciarEstado } from './estado.js';
import { Integra } from './integra.js';
import {
  carregar, iniciarDados, limparDados, estadoDados, rot, ultima, anexo, textoDoAnexo, tentarAnexosDeNovo,
  execucoesLidas, pautasLidas, candidatosLidas, relerManual,
} from './dados.js';
import { textoDosAjustes, idCandidatoValido, ehCandidatoTeste } from './parse.js';
import {
  novaChaveIdem, planejarDecisaoRoteiro, podeDecidir, avaliarDisparo, rotinaConhecida, ROTINAS,
  dadosDoRadarDiario, planejarPedidoCandidato, chaveIdemCandidato, DESTINOS_CANDIDATO,
} from './controle.js';
import { estadoDasPautas } from './selecao.js';
import { estadoDoCandidato, planejarEstadoCandidato, mesclarEstadosApp } from './candidatos.js';
import { janelaRodar, janelaDetalhes, NOTA_PONTE_DESLIGADA, classeJanelaRodar } from './componentes/execucao.js';
import { pendentesDe, janelaPrevia } from './telas/videos.js';
import {
  janelaDecisoes, pedidosDaTela, resultadosDaGravacao, aprovadasParaEnviar, loteDaProximaSelecao, bloqueioDeDecisao,
  bloqueioDeCandidato, bloqueioDeRoteirista, campoQuantidade, campoMotivoCandidato, extrasDoCandidato, textoDoPedidoCandidato,
  LIMITE_CANDIDATOS, enviosDaTela, janelaExcluirCandidato, janelaRecusarCandidato, modeloRecusaCandidato, textoDoEstadoGravado,
  bloqueioDoArquivoApp,
} from './telas/pautas.js';
import { chaveIdemEnvio, mapaDeEnvios } from './envios.js';
import {
  estadoDaDecisaoRoteiro, bloqueioDaDecisao, chaveIdemDecisao, versoesDo, extrasDaDecisao, textoDaDecisaoAceita,
} from './decisoes-roteiro.js';
import { versaoVistaDe } from './telas/roteiros.js';
import { arquivoDeLegenda } from './telas/prontos.js';
import { desenhar, rotear } from './roteador.js';
import { abrirJanela, fecharJanela, avisar, avisarComAcao, removerAviso, copiarTexto, janelaSobre, janelaSair } from './componentes/janelas.js';
import { Paleta } from './componentes/paleta.js';
import { Tele } from './componentes/tele.js';
import { Players } from './componentes/players.js';
import { TelaCheia } from './componentes/telacheia.js';
import { Downloads } from './componentes/downloads.js';
import { Tema } from './visual.js';
import { executarSaida, urlDaEntrada, tirarSaida, sessaoSegura } from './saida.js';

/* ---- Login ⇄ app ---- */

function mensagemLogin(texto) {
  const p = $('#login-msg');
  if (!p) return;
  p.innerHTML = '';
  if (!texto) return;
  p.innerHTML = '<svg class="ic" width="20" height="20" style="width:1.25rem;height:1.25rem" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg><span></span>';
  p.lastChild.textContent = texto;
}

/** Texto para a tela de login a partir do erro do auth.js (as mensagens já vêm no tom do app). */
function textoDoErro(e) {
  if (navigator.onLine === false) return 'Sem internet. Conecte-se e tente de novo.';
  if (e?.codigo && e.message) return e.message; // nao_permitido, escopos, popup_closed, popup_failed_to_open, gis_*…
  return 'Não foi possível entrar agora. Verifique a internet e tente de novo.';
}

/** Botão "Sair" da ilha: ícone e rótulo com o e-mail da conta (o e-mail muda se a conta trocar). */
export function pintarBotaoSair() {
  const b = $('#botao-sair');
  if (!b) return;
  if (!b.firstChild) b.innerHTML = ic('sair');
  const email = Integra.email();
  const rotulo = email ? `Sair da conta (${email})` : 'Sair da conta';
  b.setAttribute('aria-label', rotulo);
  b.title = rotulo;
}

export function entrarNoApp() {
  tirarSaida(sessaoSegura()); // entrou de novo: a marca de "acabou de sair" não vale mais
  estado.logada = true;
  pintarBotaoSair();
  document.documentElement.classList.remove('retomando');
  mensagemLogin('');
  $('#tela-login').hidden = true;
  $('#casca').hidden = false;
  document.body.classList.remove('entrada');
  // O script do GIS carrega em segundo plano: a renovação do token (silenciosa ou pelo aviso) precisa dele.
  Integra.prepararLogin().catch(() => {});
  iniciarDados();
  if (!location.hash || location.hash === '#' || location.hash === '#/') history.replaceState(null, '', '#/inicio');
  rotear();
  carregar();
}

/** Botões de login da entrada (Entrar com Google, Continuar como …, Usar outra conta). */
const botoesDeEntrada = () => ['#botao-entrar', '#botao-continuar', '#botao-outra-conta'].map((s) => $(s)).filter(Boolean);

/** E-mail do "Continuar como …" pintado agora ('' = entrada normal). Fica em memória: se um pedido
    falhar e a sessão vencida sumir do armazenamento, o botão continua valendo até recarregar. */
let emailDaContinuacao = '';

/**
 * Pinta a porta da entrada pela sessão guardada (Integra.abertura): com a sessão vencida, no lugar
 * do "Entrar com Google", "Continuar como <nome>" e "Usar outra conta"; sem sessão (ou depois de
 * sair), a entrada normal. Nunca entra no app sozinha. Com um login em andamento, não mexe em nada.
 */
export function pintarEntrada() {
  const [entrar, continuar, outra] = ['#botao-entrar', '#botao-continuar', '#botao-outra-conta'].map((s) => $(s));
  if (!entrar || !continuar || !outra) return;
  if (botoesDeEntrada().some((b) => b.disabled)) return;
  let abertura = { estado: 'normal', email: '' };
  try { abertura = Integra.abertura(); } catch { /* sem armazenamento: entrada normal */ }
  emailDaContinuacao = abertura.estado === 'continuar' ? abertura.email : '';
  const instrucao = $('#login-instrucao');
  if (instrucao) {
    instrucao.dataset.normal ??= instrucao.textContent;
    instrucao.textContent = emailDaContinuacao
      ? 'A sessão terminou. Continue com a mesma conta Google ou entre com outra.'
      : instrucao.dataset.normal;
  }
  if (emailDaContinuacao) {
    $('#botao-continuar-texto').textContent = Integra.rotuloContinuar(emailDaContinuacao); // texto puro, sem HTML
    continuar.title = emailDaContinuacao;
  } else {
    continuar.removeAttribute('title');
  }
  entrar.hidden = !!emailDaContinuacao;
  continuar.hidden = !emailDaContinuacao;
  outra.hidden = !emailDaContinuacao;
}

/** O botão principal visível da entrada (para o foco). */
const botaoPrincipalDaEntrada = () => ($('#botao-continuar') && !$('#botao-continuar').hidden ? $('#botao-continuar') : $('#botao-entrar'));

export function mostrarLogin(mensagem = '', { preparar = true } = {}) {
  estado.logada = false;
  document.documentElement.classList.remove('retomando');
  $('#casca').hidden = true;
  $('#tela-login').hidden = false;
  document.body.classList.add('entrada');
  document.title = 'Motor de Conteúdo';
  pintarEntrada();
  mensagemLogin(mensagem);
  // Carrega o GIS antes do clique: assim o popup do Google sai direto do toque e não é bloqueado.
  if (preparar) Integra.prepararLogin().catch(() => { /* o erro aparece se ela tentar entrar */ });
  window.scrollTo(0, 0);
}

/**
 * Sai da conta (ordem em js/saida.js): primeiro apaga a sessão e o armazenamento e mostra a entrada,
 * de forma síncrona e sem depender do Google; depois fecha janelas e teleprompter, para os players e
 * revoga as URLs dos vídeos, esquece downloads, apaga dados, estado, rascunhos e a lista de ajustes;
 * então desliga a seleção automática do Google (sem revogar nada: ver auth.js) e recarrega a página no endereço do app sem rota
 * (location.replace), para nada da conta ficar em memória nem no bfcache. Nada renova sozinho.
 */
export function sairDaConta(mensagem = '') {
  executarSaida({
    storage: sessaoSegura(),
    mensagem,
    encerrar: () => Integra.encerrar(),
    mostrarEntrada: () => {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      mostrarLogin(mensagem, { preparar: false }); // a página recarrega logo em seguida
    },
    limpezas: [
      () => fecharJanela(),
      () => Tele.fechar(),
      () => Players.liberar(),
      () => Downloads.liberar(),
      () => limparDados(),
      () => reiniciarEstado(),
      () => { Paleta.termo = ''; Paleta.i = 0; },
      // Avisos da sessão que acabou e nada da conta no DOM escondido.
      () => document.querySelectorAll('#avisos .aviso').forEach((a) => a.remove()),
      () => { for (const sel of ['#conteudo', '#nav-topo', '#nav-doca']) { const el = $(sel); if (el) el.innerHTML = ''; } },
      () => pintarBotaoSair(),
      () => botaoPrincipalDaEntrada()?.focus({ preventScroll: true }),
    ],
    desligar: (token) => Integra.desligarGoogle(token),
    recarregar: () => location.replace(urlDaEntrada(location)),
  });
}

/**
 * Um login da entrada pelo botão `b` (`textoEl`: onde vai o "Entrando…"). Enquanto o Google
 * responde, os três botões ficam desligados (um pedido por vez). Se falhar, a mensagem aparece no
 * estilo de sempre e os botões voltam como estavam, todos usáveis.
 */
async function loginDaEntrada(b, textoEl, pedir) {
  if (!b || botoesDeEntrada().some((x) => x.disabled)) return;
  mensagemLogin('');
  if (navigator.onLine === false) { mensagemLogin('Sem internet. Conecte-se e tente de novo.'); return; }
  const botoes = botoesDeEntrada();
  const texto = textoEl || b;
  const antes = texto.textContent;
  for (const x of botoes) x.disabled = true;
  b.setAttribute('aria-busy', 'true');
  texto.textContent = 'Entrando…';
  try {
    await pedir();
    entrarNoApp();
  } catch (e) {
    if (e?.codigo !== 'substituido' && e?.codigo !== 'saiu') mensagemLogin(textoDoErro(e));
  } finally {
    for (const x of botoes) x.disabled = false;
    b.removeAttribute('aria-busy');
    texto.textContent = antes;
  }
}

/* ---- Janelas de confirmação do controle manual ----
   estado.janela guarda o que está aberto ({tipo:'rodar'|'decisoes'|'previa'|'detalhes', ...}); a
   chave_idem nasce quando a janela "Rodar agora?" abre e vale até ela fechar (no pedido de um
   candidato, ela é estável: chaveIdemCandidato). A janela "rodar" tem `acao`: 'disparar' (faixas),
   'decidir-roteiro' ou 'candidato' (Mandar ao Roteirista / Passar para Para decidir). */

/** Campos da janela "rodar": a quantidade do Radar diário, o motivo de um candidato. */
function camposDaJanela(j) {
  if (j.rotina === 'radar-diario' && j.acao === 'disparar') return campoQuantidade();
  if (j.acao === 'candidato') return campoMotivoCandidato();
  return '';
}

function pintarJanela() {
  const j = estado.janela;
  if (!j) return;
  let html = '';
  if (j.tipo === 'rodar') {
    html = janelaRodar({
      rotina: j.rotina, idAlvo: j.idAlvo, email: Integra.email(), agora: new Date(), dados: execucoesLidas(), extras: j.extras,
      etapa: j.etapa, enviando: j.enviando, erro: j.erro, notaDesligada: j.notaDesligada,
      podeTravar: j.acao === 'disparar' || j.acao === 'candidato',
      titulo: j.titulo, rotuloConfirmar: j.rotuloConfirmar, campos: camposDaJanela(j),
    });
  } else if (j.tipo === 'decisoes') {
    html = janelaDecisoes({ itens: j.itens, enviando: j.enviando, resultados: j.resultados, erro: j.erro });
  } else if (j.tipo === 'previa') {
    html = janelaPrevia({
      id: j.id, versao: j.versao, decisao: j.decisao, ajustes: j.ajustes, teste: j.teste,
      execucoes: execucoesLidas().execucoes || [], enviando: j.enviando, erro: j.erro,
    });
  } else if (j.tipo === 'cand-excluir') {
    html = janelaExcluirCandidato({ c: j.c, situacao: j.situacao, enviando: j.enviando, erro: j.erro });
  } else if (j.tipo === 'cand-recusar') {
    html = janelaRecusarCandidato({ c: j.c, enviando: j.enviando, erro: j.erro, erroMotivo: j.erroMotivo });
  }
  if (html) abrirJanela(html, j.tipo === 'rodar' ? classeJanelaRodar(j.rotina) : 'janela');
}

/** As Execuções chegaram com a janela "Rodar agora?" aberta: os conflitos passam a valer. */
export function aoMudarManual() {
  if (estado.janela?.tipo === 'rodar' && !estado.janela.enviando && $('#dialogo')?.open) pintarJanela();
}

function abrirRodar(janela) {
  estado.janela = {
    tipo: 'rodar', acao: 'disparar', idAlvo: '', idLote: '', extras: [], dados: {}, etapa: 'confirmar', enviando: false, erro: '',
    notaDesligada: NOTA_PONTE_DESLIGADA, ...janela, chaveIdem: janela.chaveIdem || novaChaveIdem(),
  };
  pintarJanela();
}

const limparCampos = (...modelos) => { for (const m of modelos) delete rascunho[m]; };

/**
 * Candidato que a tela pode mudar agora (o botão pode estar velho): lido, não de teste, no formato,
 * conta que decide, com internet e com o estado do Drive lido. → {c, situacao, atual} | null.
 */
function contextoDoCandidato(id) {
  if (!idCandidatoValido(id) || ehCandidatoTeste(id)) return null;
  const lidos = candidatosLidas();
  if (bloqueioDeCandidato({ email: Integra.email(), offline: lidos.offline }) || bloqueioDoArquivoApp(lidos)) return null;
  const c = (lidos.candidatos || []).find((x) => x.id === id);
  if (!c) return null;
  const pautas = pautasLidas();
  const situacao = estadoDoCandidato(c, { selecao: pautas.selecao, decisoes: pautas.decisoes, execucoes: execucoesLidas().execucoes || [], agora: new Date() });
  const atual = mesclarEstadosApp(lidos.app?.registros, estado.candidatosLocais).get(id) || null;
  return { c, situacao, atual };
}

/**
 * Muda o estado de um candidato no arquivo do app (só esse arquivo; nada em Seleção, Decisões ou na
 * planilha). Sem janela (mover/voltar/restaurar/desfazer): estado otimista na hora, confirmado
 * quando o Drive grava; se falhar, volta e o cartão mostra o erro com "Tentar de novo". Com janela
 * (excluir/recusar): "Excluindo…" na janela e o erro dentro dela. Sucesso: aviso com "Desfazer".
 */
async function mudarEstadoCandidato(id, para, { janela = null, motivo = '', desfazer = false } = {}) {
  const ctx = contextoDoCandidato(id);
  if (!ctx) { desenhar(); return; }
  if (ctx.atual?.pendente) return; // já gravando (toque repetido)
  // Desfazer um "Restaurar" de recusado: a recusa volta com o motivo que tinha.
  if (para === 'recusado' && !motivo) motivo = [...(ctx.atual?.historico || [])].reverse().find((h) => h.estado === 'recusado')?.motivo || '';
  const email = Integra.email();
  const quando = new Date().toISOString();
  const plano = planejarEstadoCandidato({ id, para, email, atual: ctx.atual, situacao: ctx.situacao, motivo, quando });
  if (!plano.ok) {
    if (janela) { janela.erro = plano.mensagem; pintarJanela(); } else { avisar(plano.mensagem); desenhar(); }
    return;
  }
  const anterior = estado.candidatosLocais[id];
  delete estado.errosCandidato[id];
  if (janela) { janela.enviando = true; janela.erro = ''; pintarJanela(); } else { estado.candidatosLocais[id] = { ...plano.registro, pendente: true }; desenhar(); }
  try {
    const res = await Integra.app.candidatos.gravar({ id, para, email, situacao: ctx.situacao, motivo, quando });
    if (!estado.logada) return;
    estado.candidatosLocais[id] = res.registro;
    if (janela && estado.janela === janela) fecharJanela();
    if (janela) limparCampos(modeloRecusaCandidato(id));
    const texto = textoDoEstadoGravado(res);
    if (desfazer || !res.de || res.de === para) avisar(texto);
    else avisarComAcao(texto, { rotulo: 'Desfazer', acao: 'candidato-desfazer', id, valor: res.de });
    desenhar();
  } catch (e) {
    if (!estado.logada) return;
    if (anterior) estado.candidatosLocais[id] = anterior; else delete estado.candidatosLocais[id];
    const mensagem = e?.message || 'O Drive não respondeu agora.';
    if (janela) {
      janela.enviando = false;
      janela.erro = `Não gravei no Drive: ${mensagem} Nada mudou; dá para tentar de novo.`;
      if (estado.janela === janela) pintarJanela();
    } else {
      estado.errosCandidato[id] = { mensagem, para };
      avisar(`Não gravei no Drive: ${mensagem}`);
    }
    desenhar();
  }
}

/** Conta e planilha permitem decidir pautas agora? (o motivo aparece na tela) */
function podeDecidirPautas() {
  const dados = pautasLidas();
  return !!dados.selecao && !bloqueioDeDecisao({ email: Integra.email(), dados, offline: dados.offline });
}

/* ---- As ações ---- */

export const ACOES = {
  /* -- geral -- */
  entrar() { return loginDaEntrada($('#botao-entrar'), $('#botao-entrar-texto'), () => Integra.entrar()); },
  // Sessão guardada vencida: um toque com a mesma conta (login_hint) ou a escolha de conta.
  continuar() {
    const email = emailDaContinuacao;
    return loginDaEntrada($('#botao-continuar'), $('#botao-continuar-texto'), () => Integra.continuar(email));
  },
  'outra-conta'() { return loginDaEntrada($('#botao-outra-conta'), null, () => Integra.entrarComOutraConta()); },
  sair() { if (estado.logada) abrirJanela(janelaSair(Integra.email())); },
  'confirmar-sair'() { sairDaConta(); },
  async 'renovar-sessao'(el) {
    if (el.disabled) return;
    el.disabled = true;
    try {
      await Integra.renovarInterativo();
      removerAviso('sessao');
      avisar('Sessão renovada.');
    } catch (e) {
      if (e?.codigo === 'nao_permitido') { sairDaConta(e.message); return; }
      if (e?.codigo === 'saiu' || !estado.logada) return;
      avisar(e?.message || 'Não consegui renovar a sessão. Toque de novo no aviso.');
    } finally {
      el.disabled = false;
    }
  },
  'nova-versao'() { location.reload(); },
  async atualizar() {
    const { fase } = estadoDados();
    if (fase === 'carregando' || fase === 'atualizando') { avisar('Já estou lendo o Drive.'); return; }
    if (fase !== 'erro') avisar('Atualizando com o Drive…');
    await carregar({ forcar: true });
    const e = estadoDados();
    if (e.fase === 'erro') return; // a tela mostra o erro com "Tentar de novo"
    avisar(e.erro ? `Não consegui atualizar: ${e.erro.message || 'o Drive não respondeu.'} Mostrando o que já foi carregado.` : 'Tudo atualizado.');
  },
  'abrir-paleta'() { Paleta.abrir(); },
  'paleta-ir'(el) { Paleta.ir(+el.dataset.valor); },
  tema() { Tema.alternar(); },
  'abrir-sobre'() { abrirJanela(janelaSobre()); },
  'fechar-janela'() { fecharJanela(); },
  filtro(el) { estado[el.dataset.grupo] = el.dataset.valor; desenhar(); },
  aba(el) { estado.abaRoteiro = el.dataset.valor; desenhar(); },
  async copiar(el) {
    const r = rot(el.dataset.id);
    const rede = el.dataset.valor;
    const texto = r?.legendas?.[rede] || '';
    if (!texto) { avisar('Esta legenda ainda não chegou.'); return; }
    const ok = await copiarTexto(texto);
    avisar(ok ? `Legenda do ${NOME_REDE[rede]} copiada.` : 'Não consegui copiar. Selecione o texto e copie à mão.');
  },

  'anexo-tentar'() { tentarAnexosDeNovo(); desenhar(); },

  /* -- roteiros: teleprompter -- */
  'tele-abrir'(el) {
    const r = rot(el.dataset.id);
    if (!r || (!r.falas.length && !r.teleprompter)) { avisar('O texto deste roteiro ainda não chegou.'); return; }
    Tele.abrir(r);
  },
  'tele-fechar'() { Tele.fechar(); },
  'tele-alternar'() { Tele.alternar(); },
  'tele-reiniciar'() { Tele.reiniciar(); },
  'tele-tamanho'(el) { Tele.tamanho(+el.dataset.valor); },

  /* -- vídeos -- */
  async 'player-alternar'(el) {
    try { await Players.alternar(el.closest('[data-player]')); } catch (e) {
      if (e?.name !== 'AbortError') avisar(e?.message || 'Não consegui tocar este vídeo agora.');
    }
  },
  'player-tela-cheia'(el) { return TelaCheia.abrir(el.closest('[data-player]'), el); },
  'telacheia-fechar'() { TelaCheia.fechar(); },
  'player-tentar'(el) { Players.tentar(el.closest('[data-player]')); },
  'video-versao'(el) { Players.parar(); estado.versaoVista[el.dataset.id] = +el.dataset.valor; desenhar(); },
  'marcar-momento'(el) {
    const fig = el.closest('[data-player]');
    Players.parar();
    rascunho['aj-versao'] = el.dataset.valor;
    rascunho['aj-tempo'] = relogio(Players.tempo(fig));
    desenhar();
    const alvo = $('#c-aj-pedido');
    if (alvo) { alvo.scrollIntoView({ block: 'center' }); alvo.focus({ preventScroll: true }); }
  },
  'ajuste-adicionar'(el) {
    const r = rot(el.dataset.id);
    if (r && lerAjuste(r)) avisar(FLAGS.revisaoPeloApp ? 'Ajuste na lista. Adicione outros ou envie a lista ao motor.' : 'Ajuste na lista. Adicione outros ou copie a lista.');
    desenhar();
  },
  'ajuste-remover'(el) {
    const r = rot(el.dataset.id);
    if (r) pendentesDe(r, ultima(r)).splice(+el.dataset.valor, 1);
    desenhar();
  },
  /* Etapa 2: "Enviar N ajustes ao motor" grava "<id> ajustes vN.md" (parse.gerarAjustes). Por
     enquanto, a lista vira texto simples para ela colar no chat do Diretor. */
  async 'ajustes-copiar'(el) {
    const r = rot(el.dataset.id);
    if (!r) return;
    if ((rascunho['aj-pedido'] || '').trim() && !lerAjuste(r)) { desenhar(); return; } // inclui o que ficou digitado
    const lista = pendentesDe(r, ultima(r));
    if (!lista.length) return;
    const texto = textoDosAjustes(lista);
    desenhar();
    const ok = await copiarTexto(texto);
    avisar(ok ? `${lista.length === 1 ? 'Ajuste copiado' : `${lista.length} ajustes copiados`}. Cole no chat do Diretor.` : 'Não consegui copiar. Selecione o texto e copie à mão.');
  },

  /* -- vídeos: decisão da prévia em 4-Revisao (FLAGS.revisaoPeloApp) -- */
  'previa-aprovar'(el) {
    const r = rot(el.dataset.id);
    const v = r && ultima(r);
    if (!r || !v || !FLAGS.revisaoPeloApp || !podeDecidir(Integra.email())) return;
    Players.parar();
    estado.janela = { tipo: 'previa', id: r.id, versao: v.n, decisao: 'aprovar', ajustes: [], teste: r.teste, enviando: false, erro: '' };
    pintarJanela();
  },
  'ajustes-enviar'(el) {
    const r = rot(el.dataset.id);
    const v = r && ultima(r);
    if (!r || !v || !FLAGS.revisaoPeloApp || !podeDecidir(Integra.email())) return;
    if ((rascunho['aj-pedido'] || '').trim() && !lerAjuste(r)) { desenhar(); return; } // inclui o que ficou digitado
    const lista = pendentesDe(r, v);
    if (!lista.length) return;
    desenhar();
    Players.parar();
    estado.janela = { tipo: 'previa', id: r.id, versao: v.n, decisao: 'ajustar', ajustes: lista.map((a) => ({ ...a })), teste: r.teste, enviando: false, erro: '' };
    pintarJanela();
  },
  async 'previa-gravar'(el) {
    const j = estado.janela;
    if (j?.tipo !== 'previa' || j.enviando || el.disabled) return;
    el.disabled = true; // o toque duplo não grava duas vezes
    j.enviando = true;
    j.erro = '';
    pintarJanela();
    try {
      const res = await Integra.drive.gravarDecisaoPrevia({
        id: j.id, decisao: j.decisao, versao: j.versao, ajustes: j.ajustes, observacoes: (rascunho['pv-obs'] || '').trim(),
      });
      if (estado.janela !== j) return;
      if (!res.ok) { j.enviando = false; j.erro = res.mensagem; pintarJanela(); return; }
      const r = rot(j.id);
      const v = r?.video.versoes.find((x) => x.n === j.versao);
      if (v && j.decisao === 'ajustar') pendentesDe(r, v).length = 0;
      limparCampos('pv-obs');
      fecharJanela();
      avisar(`“${res.nome}” gravado em 4-Revisao. O motor pega o arquivo em 1 a 6 min.`);
      carregar({ forcar: true });
    } catch (e) {
      if (estado.janela !== j || !estado.logada) return;
      j.enviando = false;
      j.erro = e?.message || 'Não consegui gravar no Drive agora. Tente de novo.';
      pintarJanela();
    }
  },

  /* -- controle manual: faixas de execução e "Rodar agora" -- */
  'rodar-abrir'(el) {
    const rotina = el.dataset.valor;
    // A decisão de roteiro e o pedido de um candidato têm botões próprios (com os dados de cada um).
    if (!rotinaConhecida(rotina) || !ROTINAS[rotina].disparavel || rotina === 'roteirista-decisao' || rotina === 'radar-candidato') return;
    const extras = [];
    let idLote = '';
    if (rotina === 'radar-diario') { limparCampos('rd-quantidade'); delete estado.erros['rd-quantidade']; } // a janela abre sempre com o padrão (5)
    if (rotina === 'radar-selecao') {
      idLote = loteDaProximaSelecao({ execucoes: execucoesLidas().execucoes || [], selecao: pautasLidas().selecao, agora: new Date() });
      extras.push({ chave: 'lote', rotulo: 'Lote que vai nascer', texto: `${idLote}: as pautas entram na aba Seleção com ids novos e status “proposta”.` });
    }
    abrirRodar({ rotina, idAlvo: el.dataset.id || '', idLote, extras });
  },
  'rodar-travada'() {
    const j = estado.janela;
    if (j?.tipo !== 'rodar' || (j.acao !== 'disparar' && j.acao !== 'candidato')) return;
    j.etapa = 'travada';
    pintarJanela();
  },
  async 'rodar-confirmar'(el) {
    const j = estado.janela;
    if (j?.tipo !== 'rodar' || j.enviando || el.disabled) return;
    el.disabled = true; // desabilita no toque
    const exec = execucoesLidas();
    const d = avaliarDisparo({ execucoes: exec.execucoes || [], rotina: j.rotina, idAlvo: j.idAlvo, email: Integra.email(), agora: new Date() });
    const travada = el.dataset.valor === 'travada';
    if (!d.pode && !(travada && d.motivo === 'parece-travada')) { pintarJanela(); return; }
    // Os campos da janela, conferidos antes de qualquer pedido (a ponte confere de novo).
    if (j.rotina === 'radar-diario' && j.acao === 'disparar') {
      const q = dadosDoRadarDiario(rascunho['rd-quantidade']);
      if (!q.ok) {
        estado.erros = { ...estado.erros, 'rd-quantidade': q.erro };
        pintarJanela();
        $('#c-rd-quantidade')?.focus();
        return;
      }
      delete estado.erros['rd-quantidade'];
      j.dados = { ...j.dados, ...q.dados }; // dados.quantidade (inteiro de 1 a 15)
    }
    if (j.acao === 'candidato') {
      const plano = planejarPedidoCandidato({ id: j.idAlvo, destino: j.destino, motivo: rascunho['rc-motivo'], email: Integra.email() });
      if (!plano.ok) { j.erro = Object.values(plano.erros)[0]; pintarJanela(); return; }
      j.dados = { ...plano.dados }; // {id_candidato, destino, motivo}
    }
    j.enviando = true;
    j.erro = '';
    pintarJanela();
    try {
      let res;
      const viaArquivo = rotinaViaArquivo(j.rotina);
      if (viaArquivo && j.acao === 'decidir-roteiro') {
        res = await Integra.drive.gravarDecisaoRoteiro({ ...j.payload });
      } else if (viaArquivo) {
        const tipo = j.rotina === 'radar-selecao' ? 'selecao'
          : (j.rotina === 'radar-enviar' || j.acao === 'candidato') ? 'pauta-completa' : 'busca';
        const ids = j.acao === 'candidato' ? [j.idAlvo]
          : String(j.dados?.ids || '').split(/[,;\s]+/).filter(Boolean);
        res = await Integra.drive.gravarPedidoBusca({
          quantidade: j.rotina === 'radar-diario' ? j.dados?.quantidade : null,
          tipo, ids, teste: false,
        });
      } else if (j.acao === 'decidir-roteiro') {
        res = await Integra.ponte.decidirRoteiro({ ...j.payload, chave_idem: j.chaveIdem });
      } else {
        const marcar = travada ? { marcar_travada: true, id_execucao_travada: String(d.trava?.linha?.id_execucao || '') } : {};
        res = await Integra.ponte.disparar({ rotina: j.rotina, id_alvo: j.idAlvo, id_lote: j.idLote, chave_idem: j.chaveIdem, dados: { ...j.dados, ...marcar } });
      }
      if (estado.janela !== j) return;
      fecharJanela();
      if (j.acao === 'decidir-roteiro') {
        delete estado.decisaoRoteiro[j.idAlvo];
        limparCampos(`rp-${j.idAlvo}`, `rm-${j.idAlvo}`, `ro-${j.idAlvo}`);
        // Registro otimista até a releitura de Execuções mostrar a linha (js/decisoes-roteiro.js).
        estado.decisoesEnviadas[j.idAlvo] = { desde: Date.now(), chave: j.chaveIdem, decisao: j.payload.decisao, versao: j.payload.versao };
        estado.filtroRoteiros = 'todos';
        avisar(textoDaDecisaoAceita(j.idAlvo, j.payload));
      } else if (j.acao === 'candidato') {
        limparCampos('rc-motivo');
        avisar(textoDoPedidoCandidato(j.destino, res));
      } else if (j.rotina === 'radar-enviar') {
        // Registro otimista até a releitura de Execuções mostrar a linha; depois, a tela Roteiros.
        const desde = Date.now();
        for (const id of String(j.dados?.ids || '').split(',').map((s) => s.trim()).filter(Boolean)) {
          estado.enviosLocais[id] = { desde, chave: j.chaveIdem };
        }
        avisar('Pedido gravado no Drive. O motor escreve os rascunhos na próxima passada do vigia (até 5 min).');
      } else {
        const q = j.rotina === 'radar-diario' && j.dados?.quantidade ? ` (${j.dados.quantidade} ${j.dados.quantidade === 1 ? 'candidato' : 'candidatos'})` : '';
        const destino = viaArquivo ? 'Pedido gravado no Drive. O motor atende na próxima passada do vigia (até 5 min).' : 'pedido enviado. O andamento aparece na faixa.';
        avisar(`${ROTINAS[j.rotina].rotulo}${q}: ${destino}`);
      }
      relerManual('execucoes');
      if (j.rotina === 'radar-enviar' || j.rotina === 'radar-selecao' || j.acao === 'candidato') relerManual('pautas');
      if (j.rotina === 'radar-diario' || j.acao === 'candidato') relerManual('candidatos');
      // Envio aceito: vai para Roteiros (seção "Com o Roteirista"); o hashchange redesenha.
      // Decisão de roteiro aceita: também vai para Roteiros ("Em revisão" / "Aprovado" no cartão).
      const irParaRoteiros = (j.rotina === 'radar-enviar' && j.acao === 'disparar') || j.acao === 'decidir-roteiro';
      if (irParaRoteiros && location.hash !== '#/roteiros') location.hash = '#/roteiros';
      else desenhar();
    } catch (e) {
      if (estado.janela !== j || !estado.logada) return;
      j.enviando = false;
      j.erro = e?.message || 'A ponte não respondeu. Tente de novo.';
      pintarJanela();
    }
  },
  'execucao-detalhes'(el) {
    const v = el.dataset.valor || '';
    const bot = v.startsWith('bot:') ? v.slice(4) : '';
    estado.janela = { tipo: 'detalhes' };
    abrirJanela(janelaDetalhes({ rotina: bot ? '' : v, bot, idAlvo: el.dataset.id || '', dados: execucoesLidas(), agora: new Date() }));
  },

  /* -- pautas -- */
  'pautas-recarregar'() { relerManual('pautas'); desenhar(); },
  'pauta-decidir'(el) {
    if (!podeDecidirPautas()) return;
    const id = el.dataset.id;
    const valor = el.dataset.valor;
    if (estado.decisoesPauta[id] === valor) delete estado.decisoesPauta[id];
    else estado.decisoesPauta[id] = valor;
    delete estado.resultadoPautas[id];
    delete estado.erros[`pm-${id}`];
    desenhar();
  },
  'pauta-mudar'(el) {
    const id = el.dataset.id;
    if (estado.mudandoPauta[id]) {
      delete estado.mudandoPauta[id];
      delete estado.decisoesPauta[id];
      limparCampos(`pm-${id}`, `po-${id}`);
    } else {
      if (!podeDecidirPautas()) return;
      estado.mudandoPauta[id] = true;
      delete estado.resultadoPautas[id];
    }
    desenhar();
  },
  'pautas-confirmar'() {
    if (!podeDecidirPautas()) return;
    const dados = pautasLidas();
    const { pedidos, erros } = pedidosDaTela(estado.decisoesPauta, rascunho, dados.selecao);
    if (Object.keys(erros).length) {
      estado.erros = { ...estado.erros, ...erros };
      desenhar();
      avisar('Escolha o motivo de cada recusa antes de confirmar.');
      document.querySelector(`[name="${CSS.escape(Object.keys(erros)[0])}"]`)?.closest('.pauta')?.scrollIntoView({ block: 'center' });
      return;
    }
    if (!pedidos.length) return;
    const est = estadoDasPautas(dados.selecao, dados.decisoes);
    const porId = new Map(dados.selecao.pautas.map((p) => [p.id_pauta, p]));
    const itens = pedidos.map((p) => {
      const atual = est.get(p.id_pauta)?.status;
      return { ...p, titulo: porId.get(p.id_pauta)?.titulo || '', de: atual === 'aprovada' || atual === 'recusada' ? atual : '' };
    });
    estado.janela = { tipo: 'decisoes', itens, pedidos, enviando: false, resultados: null, erro: '' };
    pintarJanela();
  },
  async 'pautas-gravar'(el) {
    const j = estado.janela;
    if (j?.tipo !== 'decisoes' || j.enviando || el.disabled) return;
    el.disabled = true;
    j.enviando = true;
    j.erro = '';
    pintarJanela();
    try {
      const vistas = pautasLidas().decisoes?.decisoes || [];
      const res = await Integra.planilha.gravarDecisoes({ pedidos: j.pedidos, decisoesVistas: vistas });
      if (estado.janela !== j) return;
      j.enviando = false;
      if (!res.ok) { j.erro = res.mensagem || 'Nada foi gravado.'; pintarJanela(); return; }
      const resultados = resultadosDaGravacao(res);
      Object.assign(estado.resultadoPautas, resultados);
      for (const [id, r] of Object.entries(resultados)) {
        if (r.acao === 'erro') continue;
        delete estado.decisoesPauta[id];
        delete estado.mudandoPauta[id];
        limparCampos(`pm-${id}`, `po-${id}`);
      }
      j.resultados = resultados;
      pintarJanela();
      // A planilha gravou, mas o arquivo da semana (que o motor lê) não: ele é refeito inteiro, a partir da
      // aba Decisões, na próxima decisão desta semana.
      for (const f of res.falhasArquivo || []) {
        avisar(`Decisão gravada na planilha, mas o arquivo da semana ${f.semana} para o motor não foi atualizado. Ele é refeito na próxima decisão desta semana.`);
      }
      relerManual('pautas');
      desenhar();
    } catch (e) {
      if (estado.janela !== j || !estado.logada) return;
      j.enviando = false;
      j.erro = e?.message || 'A planilha não respondeu. Nada foi gravado.';
      pintarJanela();
    }
  },
  /* "Enviar ao Roteirista" (bandeja) ou "Tentar de novo" (Roteiros, data-id de uma pauta cujo envio
     falhou ou parece travado). Só aprovadas sem envio ativo ou concluído; chave_idem estável. */
  'pautas-enviar'(el) {
    const dados = pautasLidas();
    if (!dados.selecao || !podeDecidir(Integra.email())) return;
    const execucoes = execucoesLidas().execucoes || [];
    const envios = enviosDaTela({ dados });
    const so = String(el?.dataset?.id || '');
    let aprovadas;
    if (so) {
      const env = mapaDeEnvios(envios).get(so);
      aprovadas = env && !['falhou', 'parece-travada'].includes(env.estado) ? []
        : aprovadasParaEnviar(dados.selecao, dados.decisoes).filter((p) => p.id_pauta === so);
    } else {
      aprovadas = aprovadasParaEnviar(dados.selecao, dados.decisoes, { envios });
    }
    if (!aprovadas.length) { avisar('Nenhuma pauta aprovada espera o Roteirista agora.'); desenhar(); return; }
    const ids = aprovadas.map((p) => p.id_pauta);
    const lotes = [...new Set(aprovadas.map((p) => p.id_lote).filter(Boolean))];
    abrirRodar({
      rotina: 'radar-enviar',
      idLote: lotes.length === 1 ? lotes[0] : '',
      chaveIdem: chaveIdemEnvio(ids, execucoes, { selecao: dados.selecao, decisoes: dados.decisoes }),
      dados: { ids: ids.join(',') },
      extras: [{ chave: 'pautas', rotulo: aprovadas.length === 1 ? 'A pauta que vai' : `As ${aprovadas.length} pautas que vão`, lista: aprovadas.map((p) => `${p.id_pauta} · ${p.titulo || ''}`) }],
    });
  },

  /* -- pautas: candidatos (aba Candidatos) -- */
  'candidatos-recarregar'() { relerManual('candidatos'); desenhar(); },
  'candidatos-mais'() {
    estado.candidatosVisiveis = (Number(estado.candidatosVisiveis) || LIMITE_CANDIDATOS) + LIMITE_CANDIDATOS;
    desenhar();
  },
  /* "Mandar ao Roteirista" / "Passar para Para decidir": confere tudo de novo (o botão pode estar
     velho) e abre a janela de confirmação da rotina radar-candidato, com a chave estável. */
  'candidato-pedir'(el) {
    const id = String(el.dataset.id || '');
    const destino = el.dataset.valor;
    const email = Integra.email();
    if (!idCandidatoValido(id) || ehCandidatoTeste(id) || !Object.prototype.hasOwnProperty.call(DESTINOS_CANDIDATO, destino)) return;
    const lidos = candidatosLidas();
    if (bloqueioDeCandidato({ email, offline: lidos.offline })) return;
    const c = (lidos.candidatos || []).find((x) => x.id === id);
    if (!c) return;
    const pautas = pautasLidas();
    if (destino === 'roteirista' && bloqueioDeRoteirista(pautas)) return;
    const execucoes = execucoesLidas().execucoes || [];
    const est = estadoDoCandidato(c, { selecao: pautas.selecao, decisoes: pautas.decisoes, execucoes, agora: new Date() });
    if (!est.podePedir) { desenhar(); return; }
    limparCampos('rc-motivo');
    const def = DESTINOS_CANDIDATO[destino];
    abrirRodar({
      rotina: 'radar-candidato', acao: 'candidato', idAlvo: id, destino,
      chaveIdem: chaveIdemCandidato(id, destino, execucoes),
      titulo: def.titulo, rotuloConfirmar: def.botao,
      extras: extrasDoCandidato(c, destino),
    });
  },

  /* -- pautas: estado do candidato no app (_motor/app/candidatos/<id>.json; sem o Radar) -- */
  // "Passar para Para decidir" / "Voltar para Candidatos" / "Restaurar": gravação direta, otimista.
  'candidato-mover'(el) {
    const para = el.dataset.valor;
    if (para !== 'para-decidir' && para !== 'candidato') return undefined;
    return mudarEstadoCandidato(String(el.dataset.id || ''), para);
  },
  // "Desfazer" do aviso: volta ao estado de antes (o aviso some no toque).
  'candidato-desfazer'(el) {
    el.closest?.('.aviso')?.remove();
    const para = el.dataset.valor;
    if (!['candidato', 'para-decidir', 'excluido', 'recusado'].includes(para)) return undefined;
    return mudarEstadoCandidato(String(el.dataset.id || ''), para, { desfazer: true });
  },
  'candidato-excluir'(el) {
    const ctx = contextoDoCandidato(String(el.dataset.id || ''));
    if (!ctx) return;
    estado.janela = { tipo: 'cand-excluir', id: ctx.c.id, c: ctx.c, situacao: ctx.situacao, enviando: false, erro: '' };
    pintarJanela();
  },
  'candidato-excluir-confirmar'(el) {
    const j = estado.janela;
    if (j?.tipo !== 'cand-excluir' || j.enviando || el.disabled || j.id !== el.dataset.id) return undefined;
    return mudarEstadoCandidato(j.id, 'excluido', { janela: j });
  },
  'candidato-recusar'(el) {
    const ctx = contextoDoCandidato(String(el.dataset.id || ''));
    if (!ctx) return;
    limparCampos(modeloRecusaCandidato(ctx.c.id));
    estado.janela = { tipo: 'cand-recusar', id: ctx.c.id, c: ctx.c, enviando: false, erro: '', erroMotivo: '' };
    pintarJanela();
  },
  'candidato-recusar-confirmar'(el) {
    const j = estado.janela;
    if (j?.tipo !== 'cand-recusar' || j.enviando || el.disabled || j.id !== el.dataset.id) return undefined;
    const motivo = String(rascunho[modeloRecusaCandidato(j.id)] || '').trim();
    if (!motivo) { j.erroMotivo = 'Escolha o motivo da recusa.'; pintarJanela(); return undefined; }
    j.erroMotivo = '';
    return mudarEstadoCandidato(j.id, 'recusado', { janela: j, motivo });
  },
  'candidatos-excluidos'() { estado.verExcluidos = !estado.verExcluidos; desenhar(); },

  /* -- roteiros: decisão do rascunho (arquivo no Drive; o motor atende) -- */
  'roteiro-escolher'(el) {
    if (!podeDecidir(Integra.email())) return;
    const id = el.dataset.id;
    if (estado.decisaoRoteiro[id] === el.dataset.valor) delete estado.decisaoRoteiro[id];
    else estado.decisaoRoteiro[id] = el.dataset.valor;
    estado.erros = {};
    desenhar();
  },
  // Abas v1 · v2 · v3 do rascunho: a versão vista é a que recebe a decisão.
  'roteiro-versao'(el) {
    const id = el.dataset.id;
    const r = rot(id);
    const v = Number(el.dataset.valor);
    if (!r || !versoesDo(r).includes(v)) return;
    estado.versaoRoteiroVista[id] = v;
    desenhar();
  },
  // "Pedir de novo" (decisão que falhou ou mudança cuja versão nova não chegou): volta a escolha e a
  // versão; a confirmação abre com uma chave nova (a linha a mais muda o n de chaveIdemDecisao).
  'roteiro-repetir'(el) {
    if (!podeDecidir(Integra.email())) return;
    const id = el.dataset.id;
    const r = rot(id);
    if (!r || !['aprovar', 'mudar', 'recusar'].includes(el.dataset.valor)) return;
    const v = Number(el.dataset.versao);
    if (versoesDo(r).includes(v)) estado.versaoRoteiroVista[id] = v;
    estado.decisaoRoteiro[id] = el.dataset.valor;
    estado.erros = {};
    desenhar();
  },
  'roteiro-confirmar'(el) {
    const id = el.dataset.id;
    const r = rot(id);
    if (!r || r.etapa !== 'rascunho' || !podeDecidir(Integra.email())) return;
    // Confere de novo com as Execuções da vez (o botão pode estar velho, ou foi o segundo toque).
    const execucoes = execucoesLidas().execucoes || [];
    const agora = new Date();
    const est = estadoDaDecisaoRoteiro({ execucoes, projeto: r, agora, local: estado.decisoesEnviadas[id] || null });
    if (est.bloqueia) { avisar(est.explicacao || est.texto); desenhar(); return; }
    const versao = versaoVistaDe(r, estado.versaoRoteiroVista);
    const decisao = estado.decisaoRoteiro[id];
    const rep = bloqueioDaDecisao(execucoes, { id, decisao, versao, agora });
    if (!rep.livre) { avisar(rep.mensagem); desenhar(); return; }
    const plano = planejarDecisaoRoteiro({
      id, versao, decisao, pedido: rascunho[`rp-${id}`], motivo: rascunho[`rm-${id}`], observacao: rascunho[`ro-${id}`],
    });
    if (!plano.ok) {
      estado.erros = {};
      if (plano.erros.pedido) estado.erros[`rp-${id}`] = plano.erros.pedido;
      if (plano.erros.motivo) estado.erros[`rm-${id}`] = plano.erros.motivo;
      desenhar();
      if (!plano.erros.pedido && !plano.erros.motivo) avisar(Object.values(plano.erros)[0]);
      return;
    }
    abrirRodar({
      rotina: 'roteirista-decisao', acao: 'decidir-roteiro', idAlvo: id, payload: plano.payload,
      chaveIdem: chaveIdemDecisao(plano.payload, execucoes),
      extras: extrasDaDecisao(plano, versoesDo(r)),
    });
  },

  /* -- enviar gravação -- */
  async 'copiar-nome'(el) {
    const ok = await copiarTexto(el.dataset.id);
    avisar(ok ? `Nome copiado: ${el.dataset.id}. A extensão do vídeo continua a mesma.` : 'Não consegui copiar. Selecione o texto e copie à mão.');
  },

  /* -- prontos -- */
  async 'copiar-legenda'(el) {
    const r = rot(el.dataset.id);
    const rede = el.dataset.valor;
    if (!r) return;
    const arq = arquivoDeLegenda(r, rede);
    let texto = r.legendas?.[rede] || '';
    if (arq) {
      const a = anexo(arq.file);
      texto = a.fase === 'pronto' ? a.texto.trim() : textoDoAnexo(arq.file).then((t) => t.trim());
    }
    if (!texto) { avisar('Esta legenda ainda não chegou.'); return; }
    try {
      const ok = await copiarTexto(texto);
      avisar(ok ? `Legenda do ${NOME_REDE[rede]} copiada.` : 'Não consegui copiar. Toque de novo em "Copiar a legenda".');
    } catch (e) {
      avisar(`Não consegui baixar a legenda: ${e?.message || 'o Drive não respondeu.'}`);
    }
  },
  async 'baixar-arquivo'(el) {
    const r = rot(el.dataset.id);
    const a = r?.pacote?.arquivos.find((x) => x.file.id === el.dataset.valor);
    if (!a) return;
    try { await Downloads.baixar(a); } catch (e) {
      if (!estado.logada || e?.codigo === 'saiu') return; // saiu da conta no meio do download
      avisar(`Não consegui baixar ${a.nome}: ${e?.message || 'o Drive não respondeu.'}`);
    }
  },
  'baixar-tudo'(el) {
    const r = rot(el.dataset.id);
    return r?.pacote ? Downloads.baixarTudo(r) : undefined;
  },
};

/* Lê o formulário de ajuste, confere e põe na lista da prévia atual. Devolve false se houver erro. */
function lerAjuste(r) {
  const tempo = (rascunho['aj-tempo'] || '').trim();
  const pedido = (rascunho['aj-pedido'] || '').trim();
  estado.erros = {};
  if (!pedido) estado.erros['aj-pedido'] = 'Escreva o que mudar.';
  if (tempo && !/^\d{1,2}:\d{2}(-\d{1,2}:\d{2})?$/.test(tempo)) estado.erros['aj-tempo'] = 'Use o formato 0:12 ou 0:12-0:15.';
  if (Object.keys(estado.erros).length) return false;
  pendentesDe(r, ultima(r)).push({ versao: rascunho['aj-versao'] || 'ambas', tempo, pedido, como: (rascunho['aj-como'] || '').trim() });
  rascunho['aj-tempo'] = rascunho['aj-pedido'] = rascunho['aj-como'] = '';
  return true;
}

/** Executa uma ação pelo nome (a paleta usa). */
export function executar(nome, el = document.body, ev = null) {
  const acao = ACOES[nome];
  if (acao) return acao(el, ev);
  return undefined;
}

/* ---- Escutas gerais (uma vez) ---- */
export function ligarAcoes() {
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-acao]');
    if (!el) return;
    if (el.tagName === 'A' && el.getAttribute('href') === '#') ev.preventDefault();
    const r = executar(el.dataset.acao, el, ev);
    if (r && typeof r.catch === 'function') r.catch((e) => { if (estado.logada && e?.codigo !== 'saiu') avisar(e?.message || 'Algo deu errado. Tente de novo.'); });
  });
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset?.modelo) rascunho[t.dataset.modelo] = t.value;
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset?.modelo && 'redesenhar' in t.dataset) desenhar();
  });
  /* Abas: setas do teclado trocam de aba */
  document.addEventListener('keydown', (ev) => {
    if (ev.target.matches?.('[role="tab"]') && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {
      const abas = [...ev.target.parentElement.children]; const i = abas.indexOf(ev.target);
      const proxima = abas[(i + (ev.key === 'ArrowRight' ? 1 : -1) + abas.length) % abas.length];
      estado.abaRoteiro = proxima.dataset.valor;
      desenhar();
      $('#aba-' + proxima.dataset.valor)?.focus();
    }
  });
  /* Janelas: clicar fora fecha */
  $('#dialogo').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) fecharJanela(); });
  $('#dialogo').addEventListener('close', () => { estado.erros = {}; estado.janela = null; });
  window.addEventListener('hashchange', () => { if (estado.logada) rotear(); });
}
