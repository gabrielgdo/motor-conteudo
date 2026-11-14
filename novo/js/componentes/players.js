// Players das prévias (tela Vídeos). Cada <figure data-player> traz um <video> que toca o ARQUIVO
// REAL da prévia: baixado do Drive como Blob (Integra.baixarBlob, files/{id}?alt=media com o token)
// e tocado por uma URL de Blob. É o único jeito de um <video> tocar um arquivo privado sem o iframe
// do Drive, e é o que deixa "Pedir ajuste neste ponto" saber o tempo exato.
//
// - O download começa quando o player aparece na tela; enquanto baixa, a .tela mostra
//   "Carregando o vídeo… 45%" (o % só quando o tamanho é conhecido). Erro: mensagem + "Tentar de novo".
// - As URLs de Blob ficam guardadas por arquivo (id + modifiedTime) enquanto o app estiver aberto,
//   no máximo MAX_VIDEOS; as mais antigas que não estão na tela são revogadas. Ao sair da conta,
//   tudo é revogado (liberar).
// - O <video> sobrevive aos redesenhos da tela: guardar() o tira da tela antiga e montar() o põe na
//   nova (o vídeo continua tocando, com a duração e o tempo de antes).
// - Tocar um pausa o outro. Ao trocar de rota, o roteador chama parar().

import { $, esc, ic, relogio, NOME_REDE } from '../util.js';
import { Integra } from '../integra.js';

export const chaveArquivo = (f) => (f?.id ? `${f.id}:${f.modifiedTime || ''}` : '');
const MAX_VIDEOS = 4;
const porArquivo = (k) => document.querySelectorAll(`figure[data-arquivo="${CSS.escape(k)}"]`);

export const Players = {
  urls: new Map(), // chaveArquivo → URL do Blob (ordem de uso: a primeira é a mais antiga)
  cargas: new Map(), // chaveArquivo → {fase: 'baixando' | 'erro', pct, erro}
  duracoes: new Map(), // chaveArquivo → duração real (segundos), depois do loadedmetadata
  arquivos: new Map(), // chaveArquivo → arquivo do Drive
  tempos: {}, // chave do player → segundos (sobrevive ao redesenho da tela)
  ativo: null,
  geracao: 0, // muda ao sair da conta: downloads antigos são descartados

  /** HTML do player. `chave` identifica o player (ex. "S47-01-ig-v2"). */
  html(chave, rede, arquivo, { marcar = false } = {}) {
    const nome = NOME_REDE[rede];
    if (!arquivo) return `<figure class="player"><div class="tela tela-${rede}"><span class="tela-rede">${nome}</span><div class="tela-carga"><p>Sem a versão do ${nome} nesta prévia.</p></div></div></figure>`;
    const k = chaveArquivo(arquivo);
    this.arquivos.set(k, arquivo);
    const t = this.tempos[chave] || 0;
    const dur = this.duracoes.get(k) || 0;
    const pronto = this.urls.has(k);
    return `<figure class="player" data-player="${esc(chave)}" data-rede="${rede}" data-arquivo="${esc(k)}">
      <div class="tela tela-${rede}">
        <video data-player-video playsinline preload="metadata" aria-label="Prévia do ${nome}"></video>
        <span class="tela-rede">${nome}</span>
        <div class="tela-carga" data-player-carga ${pronto ? 'hidden' : ''}>${pronto ? '' : this.htmlCarga(k)}</div>
        <button type="button" class="tela-play" data-acao="player-alternar" aria-label="Tocar a versão do ${nome}" ${pronto ? '' : 'hidden'}>${ic('play', 26)}</button>
      </div>
      <div class="player-linha"><input type="range" min="0" max="${dur}" step="0.1" value="${Math.min(t, dur || t)}" data-player-pos aria-label="Posição no vídeo do ${nome}" ${dur ? '' : 'disabled'}><span><span data-player-tempo>${relogio(t)}</span> / <span data-player-dur>${dur ? relogio(dur) : '–:––'}</span></span></div>
      ${marcar ? `<button type="button" class="botao calmo" data-acao="marcar-momento" data-valor="${rede}">Pedir ajuste neste ponto</button>` : ''}
    </figure>`;
  },

  /** Conteúdo da camada de "carregando" / erro dentro da .tela. */
  htmlCarga(k) {
    const c = this.cargas.get(k);
    if (c?.fase === 'erro') {
      const msg = navigator.onLine === false ? 'Sem internet agora.' : (c.erro?.message || 'O Google Drive não respondeu.');
      return `<p>Não consegui baixar o vídeo.</p><p class="tela-carga-msg">${esc(msg)}</p><button type="button" class="botao calmo menor" data-acao="player-tentar">${ic('atualizar', 16)} Tentar de novo</button>`;
    }
    const pct = c && Number.isFinite(c.pct) ? ` ${c.pct}%` : '';
    return `<p role="status">Carregando o vídeo…<span data-player-pct aria-hidden="true">${pct}</span></p>`;
  },

  video: (fig) => $('[data-player-video]', fig),
  duracaoDe(arquivo) { return this.duracoes.get(chaveArquivo(arquivo)) || 0; },

  /** Antes de trocar o HTML da tela: tira os <video> que já têm arquivo (para montar() reaproveitar). */
  guardar(raiz = document) {
    const guardados = new Map();
    raiz.querySelectorAll('figure[data-player]').forEach((fig) => {
      const v = this.video(fig);
      if (v?.src) { v.dataset.arquivo = fig.dataset.arquivo; guardados.set(fig.dataset.player, v); }
    });
    return guardados;
  },

  /** Depois de desenhar a tela: devolve os vídeos guardados, prende as URLs prontas e começa os downloads. */
  montar(raiz = document, guardados = new Map()) {
    raiz.querySelectorAll('figure[data-player]').forEach((fig) => {
      const k = fig.dataset.arquivo;
      const velho = guardados.get(fig.dataset.player);
      if (velho && velho.dataset.arquivo === k) this.video(fig).replaceWith(velho);
      const url = this.urls.get(k);
      if (url) {
        this.urls.delete(k); this.urls.set(k, url); // usado agora: vai para o fim da fila
        this.prender(fig, url);
        this.pintarCarga(fig);
        this.pintar(fig);
        this.botao(fig, !this.video(fig).paused);
      } else this.carregar(k);
    });
  },

  prender(fig, url) {
    const v = this.video(fig);
    if (v && v.src !== url) v.src = url;
  },

  /** Baixa o arquivo (uma vez por arquivo, mesmo com vários players) e prende nos players que o mostram. */
  carregar(k) {
    const f = this.arquivos.get(k);
    if (!f || this.urls.has(k) || this.cargas.has(k)) return; // já baixando, ou erro esperando "Tentar de novo"
    const g = this.geracao;
    const carga = { fase: 'baixando', pct: null, erro: null };
    this.cargas.set(k, carga);
    porArquivo(k).forEach((fig) => this.pintarCarga(fig));
    Integra.baixarBlob(f, {
      aoProgresso: (recebido, total) => {
        const pct = total ? Math.min(99, Math.floor((recebido / total) * 100)) : null;
        if (pct === carga.pct) return;
        carga.pct = pct;
        porArquivo(k).forEach((fig) => { const s = $('[data-player-pct]', fig); if (s) s.textContent = pct === null ? '' : ` ${pct}%`; });
      },
    }).then((blob) => {
      if (g !== this.geracao) return;
      this.cargas.delete(k);
      this.guardarUrl(k, URL.createObjectURL(blob));
      porArquivo(k).forEach((fig) => { this.prender(fig, this.urls.get(k)); this.pintarCarga(fig); });
    }, (erro) => {
      if (g !== this.geracao) return;
      carga.fase = 'erro';
      carga.erro = erro;
      porArquivo(k).forEach((fig) => this.pintarCarga(fig));
    });
  },

  /** "Tentar de novo" depois de um erro de download. */
  tentar(fig) {
    const k = fig?.dataset.arquivo;
    if (!k) return;
    if (this.cargas.get(k)?.fase === 'erro') this.cargas.delete(k);
    this.carregar(k);
  },

  /** Guarda a URL nova e revoga as mais antigas além de MAX_VIDEOS (nunca as que estão na tela). */
  guardarUrl(k, url) {
    this.urls.delete(k);
    this.urls.set(k, url);
    if (this.urls.size <= MAX_VIDEOS) return;
    const naTela = new Set([...document.querySelectorAll('[data-player-video]')].map((v) => v.src).filter(Boolean));
    for (const [chave, u] of this.urls) {
      if (this.urls.size <= MAX_VIDEOS) break;
      if (chave === k || naTela.has(u)) continue;
      URL.revokeObjectURL(u);
      this.urls.delete(chave);
    }
  },

  /** Mostra/esconde a camada de carregando e o botão de play conforme o arquivo já esteja pronto. */
  pintarCarga(fig) {
    const k = fig.dataset.arquivo;
    const camada = $('[data-player-carga]', fig);
    const play = $('.tela-play', fig);
    const pronto = this.urls.has(k);
    if (camada) {
      camada.hidden = pronto;
      if (!pronto) camada.innerHTML = this.htmlCarga(k);
      else camada.innerHTML = '';
    }
    if (play) play.hidden = !pronto;
  },

  async alternar(fig) {
    const v = this.video(fig);
    if (!v?.src) { this.tentar(fig); return; }
    if (!v.paused) { v.pause(); return; }
    this.parar();
    this.ativo = fig.dataset.player;
    await v.play();
  },

  parar() {
    document.querySelectorAll('[data-player-video]').forEach((v) => { if (!v.paused) v.pause(); });
    this.ativo = null;
  },

  /** Tempo atual (segundos) do player, para "Pedir ajuste neste ponto". */
  tempo(fig) {
    const v = this.video(fig);
    return v?.src ? v.currentTime : this.tempos[fig.dataset.player] || 0;
  },

  mover(entrada) {
    const fig = entrada.closest('[data-player]');
    const v = this.video(fig);
    this.tempos[fig.dataset.player] = +entrada.value;
    if (v?.src && v.readyState > 0) v.currentTime = +entrada.value;
    this.pintar(fig);
  },

  pintar(fig) {
    const v = this.video(fig);
    const t = v?.src && v.readyState > 0 ? v.currentTime : this.tempos[fig.dataset.player] || 0;
    this.tempos[fig.dataset.player] = t;
    const pos = $('[data-player-pos]', fig);
    const dur = v?.duration && Number.isFinite(v.duration) ? v.duration : this.duracoes.get(fig.dataset.arquivo) || 0;
    if (dur) { pos.max = String(dur); pos.disabled = false; $('[data-player-dur]', fig).textContent = relogio(dur); }
    pos.value = String(t);
    $('[data-player-tempo]', fig).textContent = relogio(t);
  },

  botao(fig, tocando) {
    const b = $('.tela-play', fig);
    if (!b) return;
    const nome = NOME_REDE[fig.dataset.rede];
    fig.classList.toggle('tocando', tocando);
    b.innerHTML = ic(tocando ? 'pausa' : 'play', 26);
    b.setAttribute('aria-label', `${tocando ? 'Pausar' : 'Tocar'} a versão do ${nome}`);
  },

  /** Libera os vídeos baixados (ao sair da conta). */
  liberar() {
    this.geracao++;
    this.parar();
    document.querySelectorAll('[data-player-video]').forEach((v) => { v.removeAttribute('src'); v.load(); });
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls.clear();
    this.cargas.clear();
    this.duracoes.clear();
    this.arquivos.clear();
    this.tempos = {};
  },

  /** Escutas gerais (uma vez). Eventos de mídia não sobem: escutamos na captura. */
  ligar() {
    const fig = (ev) => ev.target?.closest?.('figure[data-player]');
    document.addEventListener('loadedmetadata', (ev) => {
      const f = fig(ev);
      if (!f) return;
      const v = ev.target;
      if (Number.isFinite(v.duration) && v.duration > 0) this.duracoes.set(f.dataset.arquivo, v.duration);
      const t = this.tempos[f.dataset.player] || 0;
      if (t > 0 && t < v.duration) v.currentTime = t;
      this.pintar(f);
      window.dispatchEvent(new CustomEvent('motor:duracao'));
    }, true);
    document.addEventListener('timeupdate', (ev) => { const f = fig(ev); if (f) this.pintar(f); }, true);
    document.addEventListener('play', (ev) => {
      const f = fig(ev);
      if (!f) return;
      // Tocar um pausa o outro.
      document.querySelectorAll('[data-player-video]').forEach((v) => { if (v !== ev.target && !v.paused) v.pause(); });
      this.ativo = f.dataset.player;
      this.botao(f, true);
    }, true);
    document.addEventListener('pause', (ev) => { const f = fig(ev); if (f) this.botao(f, false); }, true);
    document.addEventListener('ended', (ev) => {
      const f = fig(ev);
      if (!f) return;
      if (this.ativo === f.dataset.player) this.ativo = null;
      this.botao(f, false);
    }, true);
    document.addEventListener('input', (ev) => { if (ev.target.matches?.('[data-player-pos]')) this.mover(ev.target); });
  },
};
