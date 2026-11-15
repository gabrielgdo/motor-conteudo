// Tela cheia das prévias (tela Vídeos). O botão "Tela cheia" de cada player (players.js) abre um
// <dialog id="telacheia"> próprio (showModal) com o MESMO arquivo do player pequeno: a mesma URL de
// Blob que Players já baixou do Drive (nada é baixado de novo). O vídeo fica grande e centralizado
// em 9:16 (object-fit: contain, nunca corta), com controles nativos e playsinline (o PWA do iPhone
// não pula para o player do sistema). O fundo da plataforma fica desfocado no ::backdrop (CSS).
//
// - Abrir: pausa o pequeno, continua do mesmo ponto (currentTime) e começa a tocar.
// - Fechar (botão, Esc, toque fora do vídeo, troca de rota, sair da conta): para o grande, devolve
//   o ponto ao pequeno (serve para "Pedir ajuste neste ponto") e o foco ao botão que abriu.
// - Sem showModal (iOS < 15.4): abre pelo atributo open com .sem-modal, como janelas.js.

import { $, esc, ic, NOME_REDE } from '../util.js';
import { Players } from './players.js';

export const ID_TELACHEIA = 'telacheia';

/** Conteúdo do <dialog> (puro). Nome do arquivo vem do Drive: sempre por esc(). */
export function htmlTelaCheia({ rede, arquivo } = {}) {
  const nome = NOME_REDE[rede] || 'vídeo';
  const titulo = [nome, arquivo?.name].filter(Boolean).map((s) => esc(s)).join(' · ');
  return `<div class="tc-topo"><p class="tc-nome" id="tc-nome">${titulo}</p><button type="button" class="tc-fechar" data-acao="telacheia-fechar" aria-label="Fechar a tela cheia">${ic('fechar', 22)}</button></div>
    <div class="tc-palco" data-tc-palco><video class="tc-video" data-telacheia-video playsinline webkit-playsinline controls preload="auto" aria-label="Prévia do ${esc(nome)} em tela cheia"></video></div>`;
}

function mostrar(d) {
  d.classList.remove('sem-modal');
  if (typeof d.showModal === 'function') {
    try { d.showModal(); return; } catch { /* cai na reserva */ }
  }
  d.classList.add('sem-modal');
  d.setAttribute('open', '');
}

export const TelaCheia = {
  aberto: null, // {chave do player, botão que abriu, <video> grande}

  /** O <dialog> (o do index.html; se faltar, cria um igual). */
  dialogo() {
    let d = document.getElementById(ID_TELACHEIA);
    if (!d) {
      d = document.createElement('dialog');
      d.id = ID_TELACHEIA;
      d.className = 'telacheia';
      d.setAttribute('aria-labelledby', 'tc-nome');
      document.body.append(d);
    }
    if (!d.dataset.ligado) {
      d.dataset.ligado = '1';
      d.addEventListener('close', () => this.aoFechar());
      // Toque fora do vídeo (no fundo, no palco ou na faixa do topo) fecha.
      d.addEventListener('click', (ev) => {
        const t = ev.target;
        if (t === d || t?.matches?.('[data-tc-palco], .tc-topo')) this.fechar();
      });
    }
    return d;
  },

  /** Abre a tela cheia do player `fig`. `botao` recebe o foco de volta ao fechar. */
  async abrir(fig, botao = null) {
    if (!fig) return false;
    const pequeno = Players.video(fig);
    const k = fig.dataset.arquivo;
    const url = Players.urls.get(k) || pequeno?.src || ''; // a mesma fonte/Blob do player pequeno
    if (!url) { Players.tentar(fig); return false; }
    const d = this.dialogo();
    if (this.aberto) this.fechar();
    const t = pequeno?.src && pequeno.readyState > 0 ? pequeno.currentTime : Players.tempos[fig.dataset.player] || 0;
    Players.parar();
    d.innerHTML = htmlTelaCheia({ rede: fig.dataset.rede, arquivo: Players.arquivos.get(k) });
    const v = $('[data-telacheia-video]', d);
    this.aberto = { chave: fig.dataset.player, botao, video: v };
    const posicionar = () => { if (t > 0 && !(v.duration <= t)) v.currentTime = t; };
    v.addEventListener('loadedmetadata', posicionar, { once: true });
    v.src = url;
    if (v.readyState > 0) posicionar();
    mostrar(d);
    try { await v.play(); } catch { /* sem permissão para tocar: fica pausado, com os controles */ }
    return true;
  },

  fechar() {
    const d = document.getElementById(ID_TELACHEIA);
    if (!d || !this.aberto) return;
    if (d.classList.contains('sem-modal') || typeof d.close !== 'function') {
      d.removeAttribute('open');
      d.classList.remove('sem-modal');
      d.dispatchEvent(new Event('close'));
      return;
    }
    try { d.close(); } catch { d.removeAttribute('open'); d.dispatchEvent(new Event('close')); }
  },

  /** Depois do close (por qualquer caminho, inclusive o Esc nativo). */
  aoFechar() {
    const a = this.aberto;
    this.aberto = null;
    if (!a) return;
    const v = a.video;
    const t = v && v.readyState > 0 ? v.currentTime : null;
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); } // para o grande; o Blob continua com Players
    const fig = document.querySelector(`figure[data-player="${CSS.escape(a.chave)}"]`);
    if (fig && t !== null) {
      Players.tempos[a.chave] = t;
      const p = Players.video(fig);
      if (p?.src && p.readyState > 0) p.currentTime = t;
      Players.pintar(fig);
    }
    const d = document.getElementById(ID_TELACHEIA);
    if (d) d.innerHTML = '';
    const b = a.botao?.isConnected ? a.botao : fig && $('[data-acao="player-tela-cheia"]', fig);
    b?.focus?.({ preventScroll: true });
  },

  /** Escutas gerais (uma vez): Esc na reserva sem showModal e troca de rota. */
  ligar() {
    this.dialogo();
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && this.aberto) this.fechar(); });
    window.addEventListener('hashchange', () => this.fechar());
    window.addEventListener('motor:telacheia-fechar', () => this.fechar());
  },
};
