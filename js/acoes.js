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
import { estadoDoCandidato } from './candidatos.js';
import { janelaRodar, janelaDetalhes, NOTA_PONTE_DESLIGADA } from './componentes/execucao.js';
import { pendentesDe, janelaPrevia } from './telas/videos.js';
import {
  janelaDecisoes, pedidosDaTela, resultadosDaGravacao, aprovadasParaEnviar, loteDaProximaSelecao, bloqueioDeDecisao,
  bloqueioDeCandidato, bloqueioDeRoteirista, campoQuantidade, campoMotivoCandidato, extrasDoCandidato, textoDoPedidoCandidato,
  LIMITE_CANDIDATOS,
} from './telas/pautas.js';
import { arquivoDeLegenda } from './telas/prontos.js';
import { desenhar, rotear } from './roteador.js';
import { abrirJanela, fecharJanela, avisar, removerAviso, copiarTexto, janelaSobre, janelaSair } from './componentes/janelas.js';
import { Paleta } from './componentes/paleta.js';
import { Tele } from './componentes/tele.js';
import { Players } from './componentes/players.js';
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
 * então revoga o token (sem esperar) e recarrega a página no endereço do app sem rota
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
  }
  if (html) abrirJanela(html);
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
    if (rotina === 'radar-diario') limparCampos('rd-quantidade'); // a janela abre sempre com o padrão (5)
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
      if (j.acao === 'decidir-roteiro') {
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
        avisar('Decisão enviada ao Roteirista. O andamento aparece na faixa.');
      } else if (j.acao === 'candidato') {
        limparCampos('rc-motivo');
        avisar(textoDoPedidoCandidato(j.destino, res));
      } else {
        const q = j.rotina === 'radar-diario' && j.dados?.quantidade ? ` (${j.dados.quantidade} ${j.dados.quantidade === 1 ? 'candidato' : 'candidatos'})` : '';
        avisar(`${ROTINAS[j.rotina].rotulo}${q}: pedido enviado. O andamento aparece na faixa.`);
      }
      relerManual('execucoes');
      if (j.rotina === 'radar-enviar' || j.rotina === 'radar-selecao' || j.acao === 'candidato') relerManual('pautas');
      if (j.rotina === 'radar-diario' || j.acao === 'candidato') relerManual('candidatos');
      desenhar();
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
      relerManual('pautas');
      desenhar();
    } catch (e) {
      if (estado.janela !== j || !estado.logada) return;
      j.enviando = false;
      j.erro = e?.message || 'A planilha não respondeu. Nada foi gravado.';
      pintarJanela();
    }
  },
  'pautas-enviar'() {
    const dados = pautasLidas();
    if (!dados.selecao || !podeDecidir(Integra.email())) return;
    const aprovadas = aprovadasParaEnviar(dados.selecao, dados.decisoes);
    if (!aprovadas.length) return;
    const lotes = [...new Set(aprovadas.map((p) => p.id_lote).filter(Boolean))];
    abrirRodar({
      rotina: 'radar-enviar',
      idLote: lotes.length === 1 ? lotes[0] : '',
      dados: { ids: aprovadas.map((p) => p.id_pauta).join(',') },
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
      notaDesligada: 'O pedido pelo app ainda não está ligado. Por enquanto, peça ao Radar no chat.',
    });
  },

  /* -- roteiros: decisão do rascunho (pela ponte, ao Roteirista) -- */
  'roteiro-escolher'(el) {
    if (!podeDecidir(Integra.email())) return;
    const id = el.dataset.id;
    if (estado.decisaoRoteiro[id] === el.dataset.valor) delete estado.decisaoRoteiro[id];
    else estado.decisaoRoteiro[id] = el.dataset.valor;
    estado.erros = {};
    desenhar();
  },
  'roteiro-confirmar'(el) {
    const id = el.dataset.id;
    const r = rot(id);
    if (!r || r.etapa !== 'rascunho' || !podeDecidir(Integra.email())) return;
    const plano = planejarDecisaoRoteiro({
      id, versao: r.versaoRoteiro, decisao: estado.decisaoRoteiro[id], pedido: rascunho[`rp-${id}`], motivo: rascunho[`rm-${id}`], observacao: rascunho[`ro-${id}`],
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
      extras: [{ chave: 'decisao', rotulo: 'Sua decisão', texto: plano.resumo }],
      notaDesligada: 'O disparo pelo app ainda não está ligado. Por enquanto, responda ao Roteirista no chat.',
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
