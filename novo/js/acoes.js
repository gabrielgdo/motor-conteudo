// AÇÕES: todo elemento com data-acao="nome" chama ACOES.nome(elemento) ao ser clicado.
// Aqui também ficam as passagens login ⇄ app (entrarNoApp, mostrarLogin, sairDaConta).

import { $, NOME_REDE } from './util.js';
import { estado, rascunho } from './estado.js';
import { Integra } from './integra.js';
import { carregar, iniciarDados, limparDados, estadoDados, rot } from './dados.js';
import { desenhar, rotear } from './roteador.js';
import { abrirJanela, fecharJanela, avisar, removerAviso, copiarTexto, janelaSobre } from './componentes/janelas.js';
import { Paleta } from './componentes/paleta.js';
import { Tele } from './componentes/tele.js';
import { Players } from './componentes/players.js';
import { Tema } from './visual.js';

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

export function entrarNoApp() {
  estado.logada = true;
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

export function mostrarLogin(mensagem = '') {
  estado.logada = false;
  document.documentElement.classList.remove('retomando');
  $('#casca').hidden = true;
  $('#tela-login').hidden = false;
  document.body.classList.add('entrada');
  document.title = 'Motor de Conteúdo';
  mensagemLogin(mensagem);
  // Carrega o GIS antes do clique: assim o popup do Google sai direto do toque e não é bloqueado.
  Integra.prepararLogin().catch(() => { /* o erro aparece se ela tentar entrar */ });
  window.scrollTo(0, 0);
}

export function sairDaConta(mensagem = '') {
  fecharJanela();
  Tele.fechar();
  Players.liberar();
  Integra.sair();
  limparDados();
  removerAviso('sessao');
  mostrarLogin(mensagem);
}

/* ---- As ações ---- */

export const ACOES = {
  /* -- geral -- */
  async entrar() {
    const b = $('#botao-entrar');
    if (!b || b.disabled) return;
    mensagemLogin('');
    if (navigator.onLine === false) { mensagemLogin('Sem internet. Conecte-se e tente de novo.'); return; }
    b.disabled = true;
    b.setAttribute('aria-busy', 'true');
    $('#botao-entrar-texto').textContent = 'Entrando…';
    try {
      await Integra.entrar();
      entrarNoApp();
    } catch (e) {
      if (e?.codigo !== 'substituido') mensagemLogin(textoDoErro(e));
    } finally {
      b.disabled = false;
      b.removeAttribute('aria-busy');
      $('#botao-entrar-texto').textContent = 'Entrar com Google';
    }
  },
  sair() { sairDaConta(); },
  async 'renovar-sessao'(el) {
    if (el.disabled) return;
    el.disabled = true;
    try {
      await Integra.renovarInterativo();
      removerAviso('sessao');
      avisar('Sessão renovada.');
    } catch (e) {
      if (e?.codigo === 'nao_permitido') { sairDaConta(e.message); return; }
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

  /* -- teleprompter (tela Roteiros, parte 2) -- */
  'tele-abrir'(el) { Tele.abrir(rot(el.dataset.id)); },
  'tele-fechar'() { Tele.fechar(); },
  'tele-alternar'() { Tele.alternar(); },
  'tele-reiniciar'() { Tele.reiniciar(); },
  'tele-tamanho'(el) { Tele.tamanho(+el.dataset.valor); },

  /* -- players (tela Vídeos, parte 2) -- */
  async 'player-alternar'(el) {
    try { await Players.alternar(el.closest('[data-player]')); } catch (e) {
      if (e?.name !== 'AbortError') avisar(e?.message || 'Não consegui tocar este vídeo agora.');
    }
  },
};

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
    if (r && typeof r.catch === 'function') r.catch((e) => avisar(e?.message || 'Algo deu errado. Tente de novo.'));
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
