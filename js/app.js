// Boot, roteador por hash, layout (menu lateral no computador, abas inferiores no celular).

import { el, limpar, anexar, icone, toast, erroBloco, carregando, modal, botao } from './ui.js';
import { lerSessao, retomarSessao, sair, emailAtual, renovarInterativo } from './auth.js';
import { carregarListagens, invalidarCache } from './drive.js';
import { lerPostados, invalidarPostados } from './sheet.js';
import { montarProjetos, brutosSemId } from './model.js';
import * as login from './views/login.js';
import * as inicio from './views/inicio.js';
import * as videos from './views/videos.js';
import * as enviar from './views/enviar.js';
import * as prontos from './views/prontos.js';
import * as embreve from './views/embreve.js';

const ABAS = [
  { rota: 'inicio', rotulo: 'Início', icone: 'inicio' },
  { rota: 'pautas', rotulo: 'Pautas', icone: 'pautas' },
  { rota: 'roteiros', rotulo: 'Roteiros', icone: 'roteiros' },
  { rota: 'videos', rotulo: 'Vídeos', icone: 'videos' },
  { rota: 'prontos', rotulo: 'Prontos', icone: 'prontos' },
  { rota: 'resultados', rotulo: 'Resultados', icone: 'resultados' },
];

const ROTAS = {
  inicio: inicio.render,
  pautas: (ctx) => embreve.render(ctx, 'pautas'),
  roteiros: (ctx) => embreve.render(ctx, 'roteiros'),
  resultados: (ctx) => embreve.render(ctx, 'resultados'),
  videos: videos.render,
  enviar: enviar.render,
  prontos: prontos.render,
};

const raiz = document.getElementById('app');
let layout = null; // {titulo, conteudo, faixas, abas: Map rota → [elementos]}
let geracao = 0; // incrementa a cada navegação; renders antigos se descartam
let limpezas = [];
let protecao = null; // função que devolve mensagem se a saída da tela deve ser confirmada
let hashAnterior = location.hash;
let ignorarProximoHash = false;

/* ------------------------------------------------------------ estado */

/** Listagens do Drive + postados da planilha → projetos. Cache de 60 s nas camadas de baixo. */
async function obterEstado(forcar = false) {
  const [listagens, post] = await Promise.all([
    carregarListagens(forcar),
    lerPostados(forcar).then((m) => ({ m }), (erro) => ({ erro })),
  ]);
  const projetos = montarProjetos({ ...listagens, postados: post.m || new Map() });
  return {
    projetos,
    listagens,
    brutosSemId: brutosSemId(listagens.brutos),
    postadosErro: post.erro ? 'Não consegui ler a planilha do Radar; o que já foi postado pode não aparecer.' : null,
  };
}

function atualizarTudo() {
  invalidarCache();
  invalidarPostados();
  navegar();
}

/* ------------------------------------------------------------ layout */

function montarLayout() {
  const abasLaterais = ABAS.map((a) => el('a', { href: `#/${a.rota}`, class: 'aba', 'data-rota': a.rota }, icone(a.icone), el('span', {}, a.rotulo)));
  const abasInferiores = ABAS.map((a) => el('a', { href: `#/${a.rota}`, class: 'aba', 'data-rota': a.rota }, icone(a.icone), el('span', {}, a.rotulo)));
  const titulo = el('h1', { class: 'topo-titulo' }, 'Motor de Conteúdo');
  const faixas = el('div', { class: 'faixas' });
  const conteudo = el('main', { class: 'conteudo', id: 'conteudo', tabindex: '-1' });

  const lateral = el('aside', { class: 'lateral' },
    el('a', { href: '#/inicio', class: 'marca' },
      el('img', { src: './icons/icon-192.png', alt: '', width: '40', height: '40' }),
      el('span', {}, 'Motor de Conteúdo')),
    el('nav', { class: 'menu', 'aria-label': 'Navegação principal' }, abasLaterais),
    el('div', { class: 'lateral-rodape' },
      el('span', { class: 'email-logado' }, emailAtual()),
      botao('Sair', { tipo: 'texto', icone: 'sair', onclick: fazerSair })));

  const topo = el('header', { class: 'topo' },
    titulo,
    el('div', { class: 'topo-acoes' },
      el('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Atualizar', title: 'Atualizar', onclick: atualizarTudo }, icone('atualizar')),
      el('button', { type: 'button', class: 'btn-icone so-celular', 'aria-label': 'Conta', title: 'Conta', onclick: abrirConta }, icone('sair'))));

  const inferior = el('nav', { class: 'abas-inferiores', 'aria-label': 'Navegação' }, abasInferiores);

  limpar(raiz).append(el('div', { class: 'app' }, lateral, el('div', { class: 'principal' }, topo, faixas, conteudo), inferior));
  layout = { titulo, conteudo, faixas, abas: [...abasLaterais, ...abasInferiores] };
}

async function abrirConta() {
  const v = await modal({
    titulo: 'Sua conta',
    corpo: el('p', {}, 'Conectado como ', el('strong', {}, emailAtual())),
    acoes: [{ texto: 'Fechar', tipo: 'texto', valor: null }, { texto: 'Sair', tipo: 'principal', valor: 'sair' }],
  });
  if (v === 'sair') fazerSair();
}

function fazerSair() {
  if (protecao?.()) {
    if (!window.confirm(protecao())) return;
  }
  protecao = null;
  sair();
  layout = null;
  mostrarLogin();
}

/** Faixa no topo (sessão expirada, nova versão…). Uma por chave. */
function mostrarFaixa(chave, texto, aoClicar) {
  const alvo = layout?.faixas || document.body;
  if (alvo.querySelector(`[data-faixa="${chave}"]`)) return;
  const f = el('button', { type: 'button', class: 'faixa', 'data-faixa': chave, onclick: () => aoClicar(f) }, texto);
  alvo.prepend(f);
}

function removerFaixa(chave) {
  document.querySelectorAll(`[data-faixa="${chave}"]`).forEach((f) => f.remove());
}

/* ------------------------------------------------------------ rotas */

function rotaAtual() {
  const h = location.hash.replace(/^#\/?/, '');
  const [nome, ...resto] = h.split('/').filter(Boolean);
  return { nome: ROTAS[nome] ? nome : 'inicio', params: resto.map((p) => { try { return decodeURIComponent(p); } catch { return p; } }) };
}

async function navegar() {
  if (!lerSessao()) { mostrarLogin(); return; }
  if (!layout) montarLayout();
  const minha = ++geracao;
  limpezas.forEach((f) => { try { f(); } catch { /* ignore */ } });
  limpezas = [];
  protecao = null;

  const { nome, params } = rotaAtual();
  const abaAtiva = nome === 'enviar' ? 'inicio' : nome;
  layout.abas.forEach((a) => a.classList.toggle('ativa', a.dataset.rota === abaAtiva));
  layout.abas.forEach((a) => (a.dataset.rota === abaAtiva ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));

  const conteudo = limpar(layout.conteudo);
  conteudo.append(carregando());
  const ctx = {
    params,
    email: emailAtual(),
    ativo: () => minha === geracao,
    titulo: (t) => { layout.titulo.textContent = t; document.title = `${t} · Motor de Conteúdo`; },
    estado: obterEstado,
    /** Troca o conteúdo da tela (ignorado se o usuário já navegou para outra). */
    mostrar: (...nos) => { if (minha === geracao) anexar(limpar(conteudo), ...nos); },
    aoSair: (f) => limpezas.push(f),
    protegerSaida: (f) => { protecao = f; },
    recarregar: () => navegar(),
    atualizarTudo,
  };
  try {
    await ROTAS[nome](ctx);
  } catch (e) {
    if (minha !== geracao) return;
    ctx.mostrar(erroBloco(e?.message || 'Algo deu errado ao carregar esta tela.', () => navegar()));
  }
  if (minha === geracao) window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => {
  if (ignorarProximoHash) { ignorarProximoHash = false; hashAnterior = location.hash; return; }
  const msg = protecao?.();
  if (msg && !window.confirm(msg)) {
    ignorarProximoHash = true;
    location.hash = hashAnterior;
    return;
  }
  hashAnterior = location.hash;
  navegar();
});

/* ------------------------------------------------------------- login */

function mostrarLogin() {
  layout = null;
  geracao++;
  document.title = 'Entrar · Motor de Conteúdo';
  limpar(raiz);
  login.render(raiz, () => {
    if (!location.hash || location.hash === '#/') history.replaceState(null, '', '#/inicio');
    hashAnterior = location.hash;
    navegar();
  });
}

/* ---------------------------------------------------- eventos globais */

window.addEventListener('motor:sessao-expirada', () => {
  mostrarFaixa('sessao', 'Sua sessão expirou — toque para entrar de novo', async (f) => {
    f.disabled = true;
    try {
      await renovarInterativo();
      removerFaixa('sessao');
      toast('Sessão renovada.');
    } catch (e) {
      if (e?.codigo === 'nao_permitido') { toast(e.message, 'erro', 7000); fazerSair(); return; }
      toast(e?.message || 'Não foi possível entrar de novo.', 'erro');
    } finally {
      f.disabled = false;
    }
  });
});
window.addEventListener('motor:sessao-renovada', () => removerFaixa('sessao'));

window.addEventListener('beforeunload', (e) => {
  if (protecao?.()) { e.preventDefault(); e.returnValue = ''; }
});

// Nenhuma rejeição sem tratamento deve sujar o console.
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.codigo || e.reason?.name === 'ErroAuth') e.preventDefault();
});

/* ---------------------------------------------------- service worker */

function registrarSw() {
  if (!('serviceWorker' in navigator)) return;
  const tinhaControlador = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const novo = reg.installing;
      novo?.addEventListener('statechange', () => {
        if (novo.state === 'installed' && navigator.serviceWorker.controller) avisarNovaVersao();
      });
    });
    // Verifica atualização quando o app volta a ficar visível.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => { /* sem SW (ex.: http local sem suporte) — o app funciona igual */ });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (tinhaControlador) avisarNovaVersao();
  });
}

function avisarNovaVersao() {
  mostrarFaixa('versao', 'Nova versão — toque para atualizar', () => {
    if (protecao?.() && !window.confirm(protecao())) return;
    protecao = null;
    location.reload();
  });
}

/* -------------------------------------------------------------- boot */

registrarSw();
if (retomarSessao()) {
  if (!location.hash) history.replaceState(null, '', '#/inicio');
  hashAnterior = location.hash;
  navegar();
} else {
  mostrarLogin();
}
