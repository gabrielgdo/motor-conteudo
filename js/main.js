// INÍCIO: liga as escutas, aplica o tema, retoma a sessão (ou mostra o login) e registra o
// service worker. Ordem do mapa do desenho aprovado: config → integra → dados → util → telas →
// componentes → acoes → roteador → visual → main.

import { ic } from './util.js';
import { estado } from './estado.js';
import { Integra } from './integra.js';
import { estadoDados } from './dados.js';
import { aoMudarDados, aoMudarDuracao } from './roteador.js';
import { ligarAcoes, entrarNoApp, mostrarLogin, pintarBotaoSair } from './acoes.js';
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
// Depois de renovar (a sessão nova já está gravada): o rótulo do "Sair" mostra a conta atual.
window.addEventListener('motor:sessao-renovada', () => { removerAviso('sessao'); pintarBotaoSair(); });
window.addEventListener('motor:conta-trocada', () => aoMudarDados()); // a saudação usa o nome da conta

/* ---- Dados: redesenha a tela e mostra/tira o aviso de sem internet ---- */
window.addEventListener('motor:dados', () => {
  if (estado.logada && estadoDados().offline) avisoFixo('offline', 'Sem internet. Mostrando o que já foi carregado.', { calmo: true, icone: 'semRede' });
  else removerAviso('offline');
  aoMudarDados();
});

// Textos baixados sob demanda (notas da prévia, pedidos de ajuste, legendas do pacote) chegaram.
window.addEventListener('motor:anexo', () => aoMudarDados());
// Um vídeo da prévia descobriu a duração real: a linha do tempo dos ajustes ganha as marcas.
window.addEventListener('motor:duracao', () => aoMudarDuracao());

// Erros do login e da renovação já viram mensagem na tela: não precisam sujar o console.
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name === 'ErroAuth' || e.reason?.codigo) e.preventDefault();
});

/* ---- Service worker (PWA): cache só dos arquivos do app, aviso de nova versão ----
   O sw.js novo se instala sozinho (skipWaiting + clients.claim) quando o navegador vê que ele mudou,
   inclusive no lugar do SW do app antigo. Quando um SW novo passa a controlar a página, ela pergunta
   a versão dele: se for outra que a desta página, mostra "Nova versão" (tocar recarrega). Se for a
   mesma (a página já veio da rede com os arquivos novos), não há o que avisar. */
const VERSAO_APP = 'motor-app-v5'; // igual a VERSAO em sw.js (tests/sw.test.mjs confere)

function avisarNovaVersao() {
  avisoFixo('versao', 'Nova versão do app. Toque para atualizar.', { acao: 'nova-versao', icone: 'atualizar' });
}
function registrarSw() {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  const tinhaControlador = !!sw.controller;
  let esperando = null; // espera a resposta do SW novo; sem resposta, avisa por garantia
  sw.addEventListener('message', (e) => {
    if (!e.data?.versao) return;
    clearTimeout(esperando);
    if (e.data.versao !== VERSAO_APP) avisarNovaVersao();
  });
  sw.addEventListener('controllerchange', () => {
    clearTimeout(esperando);
    if (tinhaControlador) esperando = setTimeout(avisarNovaVersao, 4000);
    sw.controller?.postMessage('versao');
  });
  sw.register('./sw.js', { scope: './' }).then((reg) => {
    // Procura atualização quando o app volta a ficar visível (no iPhone, ao voltar para o app).
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => { /* sem SW (ex.: http local sem suporte): o app funciona igual */ });
}

/* ---- Começo ---- */
document.getElementById('botao-busca').innerHTML = `${ic('pautas', 18)}<span class="txt">Ir para</span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>`;
pintarBotaoSair();
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
