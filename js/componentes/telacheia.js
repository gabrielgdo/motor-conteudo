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
//
// Tira do storyboard (desde 16/11/2026): tocar numa miniatura da tira de uma peça de motion (telas/storyboard.js) abre
// o mesmo <dialog> com as imagens da peça lado a lado, uma por tela: deslizar troca (rolagem com encaixe), e há
// "Imagem anterior"/"Próxima imagem", as setas do teclado e o contador. As imagens são os endereços blob: que
// componentes/quadros.js já baixou (ou baixa agora); quando uma chega, só ela é trocada. Fechar como no vídeo.

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

/** Uma imagem da tira na tela cheia (puro): a imagem, "Baixando…" ou o porquê de ela faltar. */
function figuraTira(it = {}) {
  if (it.url) return `<img class="tc-img" src="${esc(it.url)}" alt="${esc(it.alt || '')}" decoding="async">`;
  const msg = it.estado === 'erro' ? 'Não consegui baixar esta imagem.'
    : it.estado === 'sem-arquivo' ? 'Esta imagem ainda não chegou ao Drive.' : 'Baixando…';
  return `<div class="tc-img tc-img-vazia"><span>${it.alt ? `<span class="vh">${esc(it.alt)}: </span>` : ''}${esc(msg)}</span></div>`;
}

const limitar = (i, n) => Math.min(Math.max(0, Math.trunc(Number(i)) || 0), Math.max(0, n - 1));

/**
 * Conteúdo do <dialog> no modo tira (puro): as imagens de uma peça lado a lado, uma por tela (deslizar troca), o
 * contador e "Imagem anterior"/"Próxima imagem". `itens`: [{alt, url|null, estado}]; `inicio`: a imagem tocada. O
 * título vem de dados do Drive: sempre por esc().
 */
export function htmlTiraCheia({ titulo = '', itens = [], inicio = 0 } = {}) {
  const n = itens.length;
  const i0 = limitar(inicio, n);
  const passo = (v, rotulo, icone, desliga) => `<button type="button" class="tc-passo" data-acao="tira-passo" data-valor="${v}" aria-label="${rotulo}"${desliga ? ' disabled' : ''}>${ic(icone, 22)}</button>`;
  return `<div class="tc-topo"><p class="tc-nome" id="tc-nome">${esc(titulo)}</p><button type="button" class="tc-fechar" data-acao="telacheia-fechar" aria-label="Fechar a tela cheia">${ic('fechar', 22)}</button></div>
    <div class="tc-tira" data-tc-tira tabindex="0" aria-label="${esc(titulo || 'Animação')}">${itens.map((it, k) => `<figure class="tc-tira-item" data-tc-palco data-tira-i="${k}" aria-label="${k + 1} de ${n}">${figuraTira(it)}</figure>`).join('')}</div>
    <div class="tc-rodape">${passo(-1, 'Imagem anterior', 'voltar', i0 <= 0)}<p class="tc-conta" data-tc-conta aria-live="polite">${i0 + 1} de ${n}</p>${passo(1, 'Próxima imagem', 'seta', i0 >= n - 1)}</div>`;
}

function mostrar(d) {
  d.classList.remove('sem-modal');
  if (typeof d.showModal === 'function') {
    try { d.showModal(); return; } catch { /* cai na reserva */ }
  }
  d.classList.add('sem-modal');
  d.setAttribute('open', '');
}

/** Uma imagem da tira agora: {alt, url|null, estado} (pedir o endereço começa o download, se faltar). */
function itemDaTira(it, fonte) {
  const url = it?.file ? fonte.url(it.file) : null;
  return { alt: it?.alt || '', url, estado: url ? 'pronto' : it?.file ? fonte.estado(it.file) : 'sem-arquivo' };
}

export const TelaCheia = {
  aberto: null, // vídeo: {chave do player, botão que abriu, <video> grande}; tira: {tipo: 'tira', itens, fonte, atual, …}

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

  /**
   * Abre a tela cheia na tira de uma peça do storyboard. `itens`: [{file, alt}] (o arquivo do Drive de cada imagem, ou
   * null se ela não chegou); `fonte`: de onde vêm os endereços (componentes/quadros.js: url(f) e estado(f)); `inicio`:
   * a imagem tocada; `botao` (ou `seletor`, se a tela se redesenhou) recebe o foco de volta. → false sem imagem.
   */
  abrirTira({ titulo = '', itens = [], inicio = 0, botao = null, seletor = '', fonte = null } = {}) {
    if (!itens?.length || !fonte) return false;
    const d = this.dialogo();
    if (this.aberto) this.fechar();
    const lidos = itens.map((it) => itemDaTira(it, fonte));
    const atual = limitar(inicio, itens.length);
    d.innerHTML = htmlTiraCheia({ titulo, itens: lidos, inicio: atual });
    const tira = $('[data-tc-tira]', d);
    this.aberto = { tipo: 'tira', botao, seletor, itens, fonte, estados: lidos.map((x) => x.estado), atual, tira };
    mostrar(d);
    if (tira) {
      tira.scrollLeft = atual * (tira.clientWidth || 0); // depois de abrir: fechado, não tem largura
      tira.addEventListener('scroll', () => this.aoRolarTira(), { passive: true });
    }
    this.pintarContaTira();
    return true;
  },

  /** Deslizou: a imagem que está na tela é a da posição da rolagem. */
  aoRolarTira() {
    const a = this.aberto;
    if (a?.tipo !== 'tira' || !a.tira) return;
    a.atual = limitar(Math.round(a.tira.scrollLeft / (a.tira.clientWidth || 1)), a.itens.length);
    this.pintarContaTira();
  },

  /** "Imagem anterior" (-1) / "Próxima imagem" (+1), e as setas do teclado. */
  passoTira(passo) {
    const a = this.aberto;
    if (a?.tipo !== 'tira' || !a.tira) return;
    const i = limitar(a.atual + Math.sign(Number(passo) || 0), a.itens.length);
    if (i === a.atual) return;
    a.atual = i;
    const left = i * (a.tira.clientWidth || 0);
    if (typeof a.tira.scrollTo === 'function') a.tira.scrollTo({ left, behavior: 'smooth' });
    else a.tira.scrollLeft = left;
    this.pintarContaTira();
  },

  /** O contador e os botões de passo (desligados nas pontas). */
  pintarContaTira() {
    const a = this.aberto;
    const d = document.getElementById(ID_TELACHEIA);
    if (a?.tipo !== 'tira' || !d) return;
    const conta = $('[data-tc-conta]', d);
    if (conta) conta.textContent = `${a.atual + 1} de ${a.itens.length}`;
    for (const b of d.querySelectorAll('[data-acao="tira-passo"]')) {
      b.disabled = Number(b.dataset.valor) < 0 ? a.atual <= 0 : a.atual >= a.itens.length - 1;
    }
  },

  /** Chegou (ou falhou) uma imagem ('motor:anexo'): troca só as figuras que mudaram de estado. */
  pintarTira() {
    const a = this.aberto;
    const d = document.getElementById(ID_TELACHEIA);
    if (a?.tipo !== 'tira' || !d) return;
    for (const fig of d.querySelectorAll('[data-tira-i]')) {
      const k = Number(fig.dataset.tiraI);
      if (!a.itens[k]) continue;
      const it = itemDaTira(a.itens[k], a.fonte);
      if (it.estado === a.estados[k]) continue;
      a.estados[k] = it.estado;
      fig.innerHTML = figuraTira(it);
    }
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
    if (a.tipo === 'tira') {
      const d = document.getElementById(ID_TELACHEIA);
      if (d) d.innerHTML = '';
      const b = a.botao?.isConnected ? a.botao : a.seletor ? document.querySelector(a.seletor) : null;
      b?.focus?.({ preventScroll: true });
      return;
    }
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

  /** Escutas gerais (uma vez): Esc na reserva sem showModal, setas na tira, troca de rota e imagem da tira que chegou. */
  ligar() {
    this.dialogo();
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.aberto) this.fechar();
      else if (this.aberto?.tipo === 'tira' && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
        ev.preventDefault?.(); // a rolagem nativa não anda junto
        this.passoTira(ev.key === 'ArrowLeft' ? -1 : 1);
      }
    });
    window.addEventListener('hashchange', () => this.fechar());
    window.addEventListener('motor:telacheia-fechar', () => this.fechar());
    window.addEventListener('motor:anexo', () => this.pintarTira());
  },
};
