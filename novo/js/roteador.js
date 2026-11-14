// ROTEADOR. Endereços: #/inicio  #/pautas  #/roteiros  #/roteiros/S47-04  #/videos  #/videos/S47-01
//                      #/enviar  #/enviar/S47-02  #/prontos  #/resultados
// São estes os links que o Diretor manda nos avisos.

import { $, ic } from './util.js';
import { estado } from './estado.js';
import { porEtapa, semPostar, estadoDados } from './dados.js';
import { vInicio } from './telas/inicio.js';
import { vPautas } from './telas/pautas.js';
import { vRoteiros, vRoteiro } from './telas/roteiros.js';
import { vVideos, vVideo } from './telas/videos.js';
import { vEnviar } from './telas/enviar.js';
import { vProntos } from './telas/prontos.js';
import { vResultados } from './telas/resultados.js';
import { Tele } from './componentes/tele.js';
import { Players } from './componentes/players.js';

export const ROTAS = {
  inicio: { titulo: 'Início', ver: vInicio },
  pautas: { titulo: 'Pautas', ver: vPautas },
  roteiros: { titulo: 'Roteiros', ver: (id) => (id ? vRoteiro(id) : vRoteiros()) },
  videos: { titulo: 'Vídeos', ver: (id) => (id ? vVideo(id) : vVideos()) },
  enviar: { titulo: 'Enviar gravação', ver: vEnviar },
  prontos: { titulo: 'Prontos', ver: vProntos },
  resultados: { titulo: 'Resultados', ver: vResultados },
};

export const NAVEGACAO = [
  { rota: 'inicio', rotulo: 'Início', icone: 'inicio' },
  { rota: 'pautas', rotulo: 'Pautas', icone: 'pautas', conta: () => 0 }, // etapa 3: aba Seleção da planilha
  { rota: 'roteiros', rotulo: 'Roteiros', icone: 'roteiros', conta: () => porEtapa('rascunho').length },
  { rota: 'videos', rotulo: 'Vídeos', icone: 'videos', conta: () => porEtapa('previa').length },
  { rota: 'prontos', rotulo: 'Prontos', icone: 'prontos', conta: () => semPostar().length },
  { rota: 'resultados', rotulo: 'Resultados', icone: 'resultados', soLateral: true, conta: () => 0 }, // no celular, fica na busca rápida
];

export function desenharNav() {
  const atual = estado.rota.nome;
  const link = (n) => {
    const c = n.conta ? n.conta() : 0;
    return `<a class="nav-link" href="#/${n.rota}" ${atual === n.rota ? 'aria-current="page"' : ''} aria-label="${n.rotulo}${c ? ', ' + c + ' esperando você' : ''}">${ic(n.icone, 22)}<span class="nav-rot">${n.rotulo}</span>${c ? `<span class="nav-conta" aria-hidden="true">${c}</span>` : ''}</a>`;
  };
  $('#nav-topo').innerHTML = NAVEGACAO.map(link).join(''); // computador: todos os itens na ilha
  $('#nav-doca').innerHTML = NAVEGACAO.filter((n) => !n.soLateral).map(link).join(''); // celular e tablet: cinco na doca
}

function chaveDeFoco(el) {
  if (!el || !el.dataset) return null;
  if (el.dataset.acao) return ['a', el.dataset.acao, el.dataset.id || '', el.dataset.valor || ''].join('|');
  if (el.dataset.modelo) return ['m', el.dataset.modelo, el.type === 'radio' ? el.value : ''].join('|');
  return null;
}

/* Redesenha a tela atual. Em mudança de rota, o foco vai para o conteúdo (leitores de tela
   anunciam a tela nova). Numa ação dentro da tela, o foco volta para o mesmo controle. */
let ultimoHTML = '';
export function desenhar(novaRota = false) {
  if (!estado.logada) return;
  const { nome, id } = estado.rota;
  const foco = novaRota ? null : chaveDeFoco(document.activeElement);
  const conteudo = $('#conteudo');
  const rolagem = window.scrollY;
  const html = ROTAS[nome].ver(id);
  desenharNav();
  if (!novaRota && html === ultimoHTML) return; // nada mudou: não refaz a tela (nem as animações)
  ultimoHTML = html;
  conteudo.innerHTML = html;
  document.title = `${ROTAS[nome].titulo} · Motor de Conteúdo`;
  if (novaRota) { window.scrollTo(0, 0); conteudo.focus({ preventScroll: true }); return; }
  window.scrollTo(0, rolagem); // dados novos não fazem a tela pular
  if (foco) {
    const alvo = [...conteudo.querySelectorAll('[data-acao], [data-modelo]')].find((el) => chaveDeFoco(el) === foco);
    if (alvo) alvo.focus({ preventScroll: true });
  }
}

export function rotear() {
  let partes;
  try { partes = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent); } catch { partes = []; }
  const [nome, id] = partes;
  estado.rota = ROTAS[nome] ? { nome, id: id || null } : { nome: 'inicio', id: null };
  if (!ROTAS[nome] && location.hash !== '#/inicio') history.replaceState(null, '', '#/inicio');
  Players.parar();
  Tele.fechar();
  estado.erros = {};
  /* View Transitions API: a tela antiga sai e a nova entra animadas, e o título de um item
     da lista vira o título do detalhe. Sem suporte, ou com "reduzir movimento", troca direto. */
  const animar = document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animar) return desenhar(true);
  const troca = document.startViewTransition(() => desenhar(true));
  [troca.ready, troca.finished, troca.updateCallbackDone].forEach((p) => p.catch(() => { /* troca interrompida por outra: normal */ }));
}

/** Dados novos (ou mudança de fase): redesenha a tela atual sem tirar o foco nem a rolagem. */
export function aoMudarDados() {
  // Releitura em segundo plano: a tela atual fica como está até os dados novos chegarem.
  if (estado.logada && estadoDados().fase !== 'atualizando') desenhar(false);
}
