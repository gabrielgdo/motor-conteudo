// INÍCIO: liga as escutas, aplica o tema, retoma a sessão (ou mostra o login) e registra o
// service worker. Ordem do mapa do desenho aprovado: config → integra → dados → util → telas →
// componentes → acoes → roteador → visual → main.

import { ic } from './util.js';
import { estado } from './estado.js';
import { Integra } from './integra.js';
import { estadoDados } from './dados.js';
import { aoMudarDados } from './roteador.js';
import { ligarAcoes, entrarNoApp, mostrarLogin } from './acoes.js';
import { avisoFixo, removerAviso } from './componentes/janelas.js';
import { Paleta } from './componentes/paleta.js';
import { Tele } from './componentes/tele.js';
import { Players } from './componentes/players.js';
import { ligarGrafico } from './componentes/grafico.js';
import { Veu, Tema, ligarLuz } from './visual.js';

/* ---- Sessão (eventos do auth.js) ---- */
window.addEventListener('motor:sessao-expirada', () => {
  if (estado.logada) avisoFixo('sessao', 'Sua sessão expirou. Toque aqui para continuar.', { acao: 'renovar-sessao', icone: 'alerta' });
});
window.addEventListener('motor:sessao-renovada', () => removerAviso('sessao'));
window.addEventListener('motor:conta-trocada', () => aoMudarDados()); // a saudação usa o nome da conta

/* ---- Dados: redesenha a tela e mostra/tira o aviso de sem internet ---- */
window.addEventListener('motor:dados', () => {
  if (estado.logada && estadoDados().offline) avisoFixo('offline', 'Sem internet. Mostrando o que já foi carregado.', { calmo: true, icone: 'semRede' });
  else removerAviso('offline');
  aoMudarDados();
});

// Erros do login e da renovação já viram mensagem na tela: não precisam sujar o console.
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name === 'ErroAuth' || e.reason?.codigo) e.preventDefault();
});

/* ---- Service worker (PWA): cache só dos arquivos do app, aviso de nova versão ---- */
function avisarNovaVersao() {
  avisoFixo('versao', 'Nova versão do app. Toque para atualizar.', { acao: 'nova-versao', icone: 'atualizar' });
}
function registrarSw() {
  if (!('serviceWorker' in navigator)) return;
  const tinhaControlador = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    reg.addEventListener('updatefound', () => {
      const novo = reg.installing;
      novo?.addEventListener('statechange', () => {
        if (novo.state === 'installed' && navigator.serviceWorker.controller) avisarNovaVersao();
      });
    });
    // Procura atualização quando o app volta a ficar visível.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => { /* sem SW (ex.: http local sem suporte): o app funciona igual */ });
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (tinhaControlador) avisarNovaVersao(); });
}

/* ---- Começo ---- */
document.getElementById('botao-busca').innerHTML = `${ic('pautas', 18)}<span class="txt">Ir para</span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>`;
Veu.iniciar();
Tema.aplicar(Tema.lembrado());
ligarAcoes();
Paleta.ligar();
Tele.ligar();
Players.ligar();
ligarGrafico();
ligarLuz();

// Sessão válida em sessionStorage: entra direto, sem esperar o script do GIS.
if (Integra.retomar()) entrarNoApp();
else mostrarLogin();

registrarSw();
