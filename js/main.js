// INÍCIO: liga as escutas, aplica o tema, retoma a sessão (ou mostra o login) e registra o
// service worker. Ordem do mapa do desenho aprovado: config → integra → dados → util → telas →
// componentes → acoes → roteador → visual → main.

import { ic } from './util.js';
import { estado, rascunho } from './estado.js';
import { Integra } from './integra.js';
import { estadoDados } from './dados.js';
import { aoMudarDados, aoMudarDuracao } from './roteador.js';
import { ligarAcoes, entrarNoApp, mostrarLogin, pintarBotaoSair, pintarEntrada, sairDaConta, aoMudarManual } from './acoes.js';
import { Downloads } from './componentes/downloads.js';
import { aplicarAtualizacao } from './versao.js';
import { tirarSaida, sessaoSegura } from './saida.js';
import { avisoFixo, removerAviso, subirAvisos } from './componentes/janelas.js';
import { Paleta } from './componentes/paleta.js';
import { Tele } from './componentes/tele.js';
import { Players } from './componentes/players.js';
import { ligarGrafico } from './componentes/grafico.js';
import { Veu, Tema, ligarLuz } from './visual.js';

/* ---- Sessão (eventos do auth.js) ---- */
window.addEventListener('motor:sessao-expirada', () => {
  if (!estado.logada) return;
  avisoFixo('sessao', 'Sua sessão expirou. Toque aqui para continuar.', { acao: 'renovar-sessao', icone: 'alerta' });
  Tele.sessaoExpirada(); // com o teleprompter aberto, a faixa no topo dele (um toque de verdade)
});
// Depois de renovar (a sessão nova já está gravada): o rótulo do "Sair" mostra a conta atual.
window.addEventListener('motor:sessao-renovada', () => { removerAviso('sessao'); Tele.sessaoRenovada(); pintarBotaoSair(); });
window.addEventListener('motor:conta-trocada', () => aoMudarDados()); // a saudação usa o nome da conta

/* ---- Dados: redesenha a tela e mostra/tira o aviso de sem internet ---- */
window.addEventListener('motor:dados', () => {
  if (estado.logada && estadoDados().offline) avisoFixo('offline', 'Sem internet. Mostrando o que já foi carregado.', { calmo: true, icone: 'semRede' });
  else removerAviso('offline');
  aoMudarDados();
});

// Textos baixados sob demanda (notas da prévia, pedidos de ajuste, legendas do pacote) chegaram.
window.addEventListener('motor:anexo', () => aoMudarDados());
// Abas Execuções, Seleção e Decisões da planilha Radar chegaram (controle manual, js/dados.js).
window.addEventListener('motor:manual', () => { aoMudarDados(); aoMudarManual(); });
// Um vídeo da prévia descobriu a duração real: a linha do tempo dos ajustes ganha as marcas.
window.addEventListener('motor:duracao', () => aoMudarDuracao());

// Erros do login e da renovação já viram mensagem na tela: não precisam sujar o console.
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name === 'ErroAuth' || e.reason?.codigo) e.preventDefault();
});

/* ---- Service worker (PWA): cache só dos arquivos do app, nova versão ----
   O sw.js novo se instala sozinho (skipWaiting + clients.claim) quando o navegador vê que ele mudou.
   No iPhone, o app instalado volta da memória sem recarregar, com o JS antigo: por isso a página
   procura atualização ao abrir, ao voltar a ficar visível e no pageshow (bfcache), e pergunta a
   versão do SW que a controla. Versão diferente: recarrega sozinha uma vez se não houver trabalho em
   andamento; senão mostra "Nova versão" (tocar recarrega). Regras e anti-laço em js/versao.js. */
const VERSAO_APP = 'motor-app-v16'; // igual a VERSAO em sw.js (tests/sw.test.mjs confere)

function avisarNovaVersao() {
  avisoFixo('versao', 'Nova versão do app. Toque para atualizar.', { acao: 'nova-versao', icone: 'atualizar' });
}

/** Algo que uma recarga perderia: download, envio, ajustes juntados ou digitados, vídeo tocando,
    teleprompter ou janela aberta, campo em edição. */
function trabalhoEmAndamento() {
  try {
    if (Downloads.andando.size || Downloads.tudo) return true;
    if (document.querySelector('#tela-login button[aria-busy="true"]')) return true; // login do Google em andamento
    if (estado.envio || estado.arquivo) return true;
    if (Object.values(estado.pendentes || {}).some((l) => l?.length)) return true;
    if (['aj-pedido', 'aj-tempo', 'aj-como'].some((k) => String(rascunho[k] || '').trim())) return true;
    if (document.getElementById('tele')?.open || document.getElementById('dialogo')?.hasAttribute('open')) return true;
    if ([...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended)) return true;
    const ativo = document.activeElement;
    if (ativo && ativo.matches?.('input:not([type="radio"]):not([type="checkbox"]):not([type="range"]), textarea') && ativo.value) return true;
    return false;
  } catch {
    return true; // na dúvida, não recarrega: só avisa
  }
}

let recarregando = false;
let esperaVersao = null;

function resolverVersao(versaoSw) {
  clearTimeout(esperaVersao);
  esperaVersao = null;
  if (recarregando) return;
  const feito = aplicarAtualizacao({ versaoPagina: VERSAO_APP, versaoSw, ocupada: trabalhoEmAndamento() }, sessaoSegura(), {
    recarregar: () => { recarregando = true; location.reload(); },
    avisar: avisarNovaVersao,
  });
  if (feito === 'nada') removerAviso('versao');
}

/** Pergunta a versão ao SW que controla a página. `semResposta`: o que fazer se ele não responder. */
function perguntarVersao(semResposta = false) {
  const c = navigator.serviceWorker?.controller;
  if (!c) return;
  clearTimeout(esperaVersao);
  if (semResposta) esperaVersao = setTimeout(() => resolverVersao(null), 4000);
  try { c.postMessage('versao'); } catch { /* sem resposta: o tempo acima decide */ }
}

function registrarSw() {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  const tinhaControlador = !!sw.controller;
  sw.addEventListener('message', (e) => { if (e.data?.versao) resolverVersao(e.data.versao); });
  // Um SW novo assumiu (skipWaiting + clients.claim): sem resposta dele, avisa por garantia.
  sw.addEventListener('controllerchange', () => perguntarVersao(tinhaControlador));
  // A página pode ter vindo com JS mais velho que o SW (cache HTTP): confere logo ao abrir.
  perguntarVersao(false);
  let registro = null;
  const procurar = () => {
    registro?.update().catch(() => {});
    perguntarVersao(false); // se estava ocupada antes e agora não está, a recarga acontece agora
  };
  sw.register('./sw.js', { scope: './', updateViaCache: 'none' }).then((reg) => {
    registro = reg;
    reg.update().catch(() => {});
  }).catch(() => { /* sem SW (ex.: http local sem suporte): o app funciona igual */ });
  // No iPhone, ao voltar para o app instalado: visibilitychange e, se veio do bfcache, pageshow.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') procurar(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) procurar(); });
}

/* ---- Volta do bfcache: depois de sair, nada da conta reaparece ----
   A sessão fica em localStorage (compartilhado entre as abas): temSessao() lê de lá na hora, então
   um "Sair" nesta aba ou em outra também vale aqui. Na entrada, a porta é pintada de novo pela
   sessão guardada agora ("Continuar como …" some se ela saiu em outra aba); nunca entra sozinha. */
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  if (estado.logada && !Integra.temSessao()) sairDaConta();
  else if (!estado.logada) { document.documentElement.classList.remove('retomando'); pintarEntrada(); }
});

/* ---- "Sair" em outra aba (o evento storage só chega às outras abas): esta sai também ---- */
window.addEventListener('storage', (e) => {
  if (e.key !== null && e.key !== 'motor.sessao') return; // null = clear()
  if (estado.logada && !Integra.temSessao()) sairDaConta();
  else if (!estado.logada) pintarEntrada();
});

/* ---- Começo ---- */
document.getElementById('botao-busca').innerHTML = `${ic('pautas', 18)}<span class="txt">Ir para</span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>`;
pintarBotaoSair();
Veu.iniciar();
Tema.aplicar(Tema.lembrado());
ligarAcoes();
Paleta.ligar();
Tele.ligar({ segurar: Integra.segurarRenovacao });
subirAvisos(); // #avisos como popover (acima das janelas), quando o navegador tiver
Players.ligar();
ligarGrafico();
ligarLuz();

// Acabou de sair (a página recarregou pelo "Sair"): fica na entrada normal, mesmo que algo tenha
// sobrado (Integra.encerrar apaga de novo). Senão, pela sessão guardada em localStorage:
//  - token válido: entra direto, sem login e sem esperar o script do GIS (renovação reagendada);
//  - token vencido: a entrada com "Continuar como …" e "Usar outra conta" (mostrarLogin pinta);
//  - sem sessão: a entrada normal, "Entrar com Google".
const saida = tirarSaida(sessaoSegura());
if (saida) { Integra.encerrar(); mostrarLogin(saida.mensagem); }
else if (Integra.abertura().estado === 'entrar' && Integra.retomar()) entrarNoApp();
else mostrarLogin();

registrarSw();
