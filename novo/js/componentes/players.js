// Players das prévias (tela Vídeos, parte 2).
// INTEGRAÇÃO: cada <figure data-player> traz um <video> que toca o arquivo do Drive baixado como
// Blob (Integra.baixarBlob). Tocar o arquivo de verdade (e não o iframe do Drive) é o que deixa o
// botão "Pedir ajuste neste ponto" saber o tempo exato. O download só começa no primeiro toque.

import { $, esc, ic, relogio, NOME_REDE } from '../util.js';
import { Integra } from '../integra.js';

const chaveArquivo = (f) => `${f.id}:${f.modifiedTime || ''}`;

export const Players = {
  urls: new Map(), // chaveArquivo → URL do Blob (vale enquanto o app estiver aberto)
  tempos: {}, // chave do player → segundos (sobrevive ao redesenho da tela)
  arquivos: new Map(), // chave do player → arquivo do Drive
  ativo: null,

  /** HTML do player. `chave` identifica o player (ex. "S47-01-ig-v2"). */
  html(chave, rede, arquivo, { marcar = false } = {}) {
    const nome = NOME_REDE[rede];
    if (!arquivo) return `<figure class="player"><div class="tela tela-${rede}"><span class="tela-rede">${nome}</span><p class="tela-legenda">Sem a versão do ${nome} nesta prévia.</p></div></figure>`;
    this.arquivos.set(chave, arquivo);
    const t = this.tempos[chave] || 0;
    return `<figure class="player" data-player="${esc(chave)}" data-rede="${rede}">
      <div class="tela tela-${rede}">
        <video data-player-video playsinline preload="none" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" aria-label="Prévia do ${nome}"></video>
        <span class="tela-rede">${nome}</span>
        <button type="button" class="tela-play" data-acao="player-alternar" aria-label="Tocar a versão do ${nome}">${ic('play', 26)}</button>
      </div>
      <div class="player-linha"><input type="range" min="0" max="0" step="0.1" value="${t}" data-player-pos aria-label="Posição no vídeo do ${nome}"><span><span data-player-tempo>${relogio(t)}</span> / <span data-player-dur>–:––</span></span></div>
      ${marcar ? `<button type="button" class="botao calmo" data-acao="marcar-momento" data-valor="${rede}">Pedir ajuste neste ponto</button>` : ''}
    </figure>`;
  },

  video: (fig) => $('[data-player-video]', fig),
  figura: (chave) => document.querySelector(`[data-player="${CSS.escape(chave)}"]`),

  /** Depois de desenhar a tela: devolve aos vídeos o arquivo já baixado e o tempo em que estavam. */
  montar(raiz = document) {
    raiz.querySelectorAll('[data-player]').forEach((fig) => {
      const f = this.arquivos.get(fig.dataset.player);
      const url = f && this.urls.get(chaveArquivo(f));
      if (url) this.prender(fig, url);
    });
  },

  prender(fig, url) {
    const v = this.video(fig);
    if (v.src === url) return;
    v.src = url;
    v.addEventListener('loadedmetadata', () => {
      v.currentTime = Math.min(this.tempos[fig.dataset.player] || 0, v.duration || 0);
      this.pintar(fig);
    }, { once: true });
  },

  async alternar(fig) {
    const chave = fig.dataset.player;
    const v = this.video(fig);
    if (this.ativo === chave && !v.paused) { v.pause(); return; }
    this.parar();
    if (!v.src) {
      const f = this.arquivos.get(chave);
      const b = $('.tela-play', fig);
      b.disabled = true;
      b.setAttribute('aria-label', 'Baixando o vídeo do Drive…');
      try {
        const k = chaveArquivo(f);
        if (!this.urls.has(k)) this.urls.set(k, URL.createObjectURL(await Integra.baixarBlob(f)));
        this.prender(fig, this.urls.get(k));
      } finally {
        b.disabled = false;
      }
    }
    this.ativo = chave;
    await v.play();
  },

  parar() {
    document.querySelectorAll('[data-player-video]').forEach((v) => { if (!v.paused) v.pause(); });
    this.ativo = null;
  },

  /** Tempo atual (segundos) do player, para "Pedir ajuste neste ponto". */
  tempo(fig) {
    const v = this.video(fig);
    return v ? v.currentTime : this.tempos[fig.dataset.player] || 0;
  },

  mover(entrada) {
    const fig = entrada.closest('[data-player]');
    const v = this.video(fig);
    this.tempos[fig.dataset.player] = +entrada.value;
    if (v?.src) v.currentTime = +entrada.value;
    this.pintar(fig);
  },

  pintar(fig) {
    const v = this.video(fig);
    const t = v?.src ? v.currentTime : this.tempos[fig.dataset.player] || 0;
    this.tempos[fig.dataset.player] = t;
    const pos = $('[data-player-pos]', fig);
    if (v?.duration) { pos.max = String(v.duration); $('[data-player-dur]', fig).textContent = relogio(v.duration); }
    pos.value = String(t);
    $('[data-player-tempo]', fig).textContent = relogio(t);
  },

  botao(fig, tocando) {
    const b = $('.tela-play', fig);
    const nome = NOME_REDE[fig.dataset.rede];
    fig.classList.toggle('tocando', tocando);
    b.innerHTML = ic(tocando ? 'pausa' : 'play', 26);
    b.setAttribute('aria-label', `${tocando ? 'Pausar' : 'Tocar'} a versão do ${nome}`);
  },

  /** Libera os vídeos baixados (ao sair da conta). */
  liberar() {
    this.parar();
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls.clear();
    this.arquivos.clear();
    this.tempos = {};
  },

  /** Escutas gerais (uma vez). Eventos de mídia não sobem: escutamos na captura. */
  ligar() {
    const fig = (ev) => ev.target?.closest?.('[data-player]');
    document.addEventListener('timeupdate', (ev) => { const f = fig(ev); if (f) this.pintar(f); }, true);
    document.addEventListener('play', (ev) => { const f = fig(ev); if (f) this.botao(f, true); }, true);
    document.addEventListener('pause', (ev) => { const f = fig(ev); if (f) this.botao(f, false); }, true);
    document.addEventListener('input', (ev) => { if (ev.target.matches?.('[data-player-pos]')) this.mover(ev.target); });
  },
};
