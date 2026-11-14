// AÇÕES: todo elemento com data-acao="nome" chama ACOES.nome(elemento) ao ser clicado.
// Aqui também ficam as passagens login ⇄ app (entrarNoApp, mostrarLogin, sairDaConta).

import { $, NOME_REDE, relogio, ic } from './util.js';
import { estado, rascunho, reiniciarEstado } from './estado.js';
import { Integra } from './integra.js';
import { carregar, iniciarDados, limparDados, estadoDados, rot, ultima, anexo, textoDoAnexo, tentarAnexosDeNovo } from './dados.js';
import { textoDosAjustes } from './parse.js';
import { pendentesDe } from './telas/videos.js';
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
    if (r && lerAjuste(r)) avisar('Ajuste na lista. Adicione outros ou copie a lista.');
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
  $('#dialogo').addEventListener('close', () => { estado.erros = {}; });
  window.addEventListener('hashchange', () => { if (estado.logada) rotear(); });
}
