// Tela cheia das prévias (componentes/telacheia.js), com um DOM falso mínimo (sem navegador):
// cada player com arquivo tem um <button> "Tela cheia"; o <dialog> traz um <video> com playsinline e
// controls e o nome do arquivo do Drive escapado; abrir reaproveita a MESMA URL de Blob (não baixa de
// novo), continua do mesmo ponto e pausa o pequeno; fechar (botão, toque fora, Esc na reserva) para
// o grande, devolve o ponto ao pequeno e o foco ao botão. Nada sai para a rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Players, chaveArquivo } from '../js/componentes/players.js';
import { TelaCheia, htmlTelaCheia, ID_TELACHEIA } from '../js/componentes/telacheia.js';
import { Integra } from '../js/integra.js';

const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function ouvinte(obj) {
  const ouvintes = {};
  obj.addEventListener = (tipo, fn, opc) => { (ouvintes[tipo] ||= []).push({ fn, once: opc?.once }); };
  obj.dispatchEvent = (ev) => {
    const lista = ouvintes[ev.type] || [];
    ouvintes[ev.type] = lista.filter((o) => !o.once);
    for (const o of lista) o.fn(ev);
    return true;
  };
  obj.disparar = (tipo, alvo = obj) => obj.dispatchEvent({ type: tipo, target: alvo });
  return obj;
}

function video(extra = {}) {
  return ouvinte({
    src: '', currentTime: 0, duration: 30, readyState: 1, paused: true, atributos: {}, tocou: 0, carregou: 0,
    async play() { this.paused = false; this.tocou++; },
    pause() { this.paused = true; },
    load() { this.carregou++; },
    removeAttribute(k) { if (k === 'src') this.src = ''; delete this.atributos[k]; },
    ...extra,
  });
}

function montar(t, { modal = true } = {}) {
  const antes = {};
  for (const k of ['document', 'window', 'CSS']) antes[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  const baixar = Integra.baixarBlob;
  t.after(() => {
    for (const [k, d] of Object.entries(antes)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
    Integra.baixarBlob = baixar;
    Players.urls.clear(); Players.arquivos.clear(); Players.cargas.clear(); Players.tempos = {};
    TelaCheia.aberto = null;
  });
  let baixou = 0;
  Integra.baixarBlob = () => { baixou++; return new Promise(() => {}); };

  const arquivo = { id: 'arq1', modifiedTime: '2026-11-10T10:00:00Z', name: '<img src=x onerror=alert(1)>.mp4' };
  const k = chaveArquivo(arquivo);
  Players.arquivos.set(k, arquivo);
  Players.urls.set(k, 'blob:https://motor/abc');

  const pequeno = video({ src: 'blob:https://motor/abc', currentTime: 12.5, paused: false });
  const grande = video({ readyState: 0 });
  const botao = { isConnected: true, focado: 0, focus() { this.focado++; } };
  const campo = { value: '', max: '', disabled: true, textContent: '' };
  const fig = {
    dataset: { player: 'S47-01-ig-v2', rede: 'ig', arquivo: k },
    querySelector(s) {
      if (s === '[data-player-video]') return pequeno;
      if (s === '[data-acao="player-tela-cheia"]') return botao;
      return campo;
    },
  };
  const d = ouvinte({
    id: ID_TELACHEIA, innerHTML: '', dataset: {}, atributos: {}, open: false, classes: new Set(),
    classList: { add: (c) => d.classes.add(c), remove: (c) => d.classes.delete(c), contains: (c) => d.classes.has(c) },
    setAttribute(k2, v) { this.atributos[k2] = v; if (k2 === 'open') this.open = true; },
    removeAttribute(k2) { delete this.atributos[k2]; if (k2 === 'open') this.open = false; },
    querySelector(s) { return s === '[data-telacheia-video]' ? grande : null; },
    ...(modal ? {
      showModal() { this.open = true; this.modal = true; },
      close() { this.open = false; this.dispatchEvent({ type: 'close' }); },
    } : {}),
  });
  const doc = ouvinte({
    getElementById: (id) => (id === ID_TELACHEIA ? d : null),
    querySelector: (s) => (s === 'figure[data-player="S47-01-ig-v2"]' ? fig : null),
    querySelectorAll: (s) => (s.includes('[data-player-video]') ? [pequeno] : []),
  });
  globalThis.document = doc;
  globalThis.window = ouvinte({});
  globalThis.CSS = { escape: (s) => s };
  return { d, fig, pequeno, grande, botao, arquivo, baixou: () => baixou };
}

test('cada player com arquivo tem um <button> "Tela cheia" (escondido até o vídeo estar pronto)', () => {
  const arquivo = { id: 'arq9', modifiedTime: 'x', name: 'a.mp4' };
  const pronto = Players.html('S1-ig-v1', 'ig', arquivo);
  const botao = pronto.match(/<button[^>]*data-acao="player-tela-cheia"[^>]*>/)?.[0];
  assert.ok(botao, 'botão presente');
  assert.match(botao, /type="button"/);
  assert.match(botao, /aria-label="Tela cheia: versão do Instagram"/);
  assert.match(botao, /\bhidden\b/, 'sem o arquivo baixado, fica escondido');
  Players.urls.set(chaveArquivo(arquivo), 'blob:x');
  const tt = Players.html('S1-tt-v1', 'tt', arquivo);
  assert.doesNotMatch(tt.match(/<button[^>]*data-acao="player-tela-cheia"[^>]*>/)[0], /\bhidden\b/);
  assert.match(tt, /Tela cheia: versão do TikTok/);
  Players.urls.clear(); Players.arquivos.clear();
  assert.doesNotMatch(Players.html('S1-ig-v1', 'ig', null), /player-tela-cheia/, 'sem versão, sem botão');
});

test('o <dialog> traz <video> com playsinline e controls, Fechar de verdade e o nome escapado', () => {
  const h = htmlTelaCheia({ rede: 'tt', arquivo: { name: '<script>alert("x")</script>&.mp4' } });
  const v = h.match(/<video[^>]*>/)[0];
  assert.match(v, /\bplaysinline\b/);
  assert.match(v, /\bwebkit-playsinline\b/);
  assert.match(v, /\bcontrols\b/);
  assert.match(v, /data-telacheia-video/);
  assert.match(h, /<button type="button" class="tc-fechar" data-acao="telacheia-fechar" aria-label="Fechar a tela cheia">/);
  assert.doesNotMatch(h, /<script>/);
  assert.match(h, /TikTok · &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;&amp;\.mp4/);
  assert.match(h, /id="tc-nome"/);
});

test('abrir usa a MESMA URL de Blob, continua do mesmo ponto, pausa o pequeno e não baixa de novo', async (t) => {
  const { d, fig, pequeno, grande, botao, baixou } = montar(t);
  assert.equal(await TelaCheia.abrir(fig, botao), true);
  assert.equal(d.open, true);
  assert.equal(d.modal, true, 'abre com showModal');
  assert.equal(pequeno.paused, true, 'o pequeno pausa');
  assert.equal(grande.src, 'blob:https://motor/abc', 'a mesma fonte do player pequeno');
  assert.equal(baixou(), 0, 'nada baixado de novo');
  grande.readyState = 1;
  grande.disparar('loadedmetadata');
  assert.equal(grande.currentTime, 12.5, 'continua do mesmo ponto');
  assert.equal(grande.tocou, 1);
  assert.doesNotMatch(d.innerHTML, /<img/, 'nome do arquivo escapado');
  assert.match(d.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;\.mp4/);

  grande.currentTime = 20;
  d.close();
  assert.equal(d.open, false);
  assert.equal(grande.paused, true, 'fechar para o grande');
  assert.equal(grande.src, '');
  assert.equal(pequeno.currentTime, 20, 'o pequeno fica no ponto em que o grande parou');
  assert.equal(Players.tempos['S47-01-ig-v2'], 20);
  assert.equal(botao.focado, 1, 'foco volta ao botão');
  assert.equal(d.innerHTML, '');
  assert.equal(TelaCheia.aberto, null);
});

test('toque fora do vídeo fecha; toque no vídeo (controles) não fecha', async (t) => {
  const { d, fig, grande, botao } = montar(t);
  await TelaCheia.abrir(fig, botao);
  d.disparar('click', grande);
  assert.equal(d.open, true, 'no vídeo, segue aberto');
  d.disparar('click', { matches: (s) => s.includes('[data-tc-palco]') });
  assert.equal(d.open, false, 'no palco, fecha');
  await TelaCheia.abrir(fig, botao);
  d.disparar('click', d);
  assert.equal(d.open, false, 'no fundo (::backdrop), fecha');
});

test('sem showModal (iOS antigo): abre pelo atributo open e o Esc fecha', async (t) => {
  const { d, fig, grande, botao } = montar(t, { modal: false });
  TelaCheia.ligar();
  await TelaCheia.abrir(fig, botao);
  assert.equal(d.open, true);
  assert.ok(d.classes.has('sem-modal'));
  document.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(d.open, false);
  assert.ok(!d.classes.has('sem-modal'));
  assert.equal(grande.paused, true);
  assert.equal(botao.focado, 1);
});

test('sem o vídeo baixado, Tela cheia não abre: pede o download do próprio player', async (t) => {
  const { d, fig, pequeno, baixou } = montar(t);
  Players.urls.clear();
  pequeno.src = '';
  assert.equal(await TelaCheia.abrir(fig, null), false);
  assert.equal(d.open, false);
  assert.equal(baixou(), 1, 'um download só, pelo caminho do Players');
});

test('ligações: ação, service worker, index.html e CSS (blur com reserva, safe-area, 9:16)', () => {
  const acoes = ler('js/acoes.js');
  assert.match(acoes, /'player-tela-cheia'\(el\)/);
  assert.match(acoes, /'telacheia-fechar'\(\)/);
  assert.match(ler('sw.js'), /'\.\/js\/componentes\/telacheia\.js'/);
  assert.match(ler('index.html'), /<dialog id="telacheia" class="telacheia"/);
  assert.match(ler('js/main.js'), /TelaCheia\.ligar\(\)/);
  const css = ler('css/app.css');
  const bloco = css.slice(css.indexOf('/* ===== Tela cheia das prévias'));
  assert.ok(bloco.length > 100, 'regras no fim do app.css');
  assert.match(bloco, /dialog\.telacheia::backdrop\{[^}]*backdrop-filter:blur\([^}]*-webkit-backdrop-filter:blur\(/);
  assert.match(bloco, /@supports not/);
  assert.match(bloco, /aspect-ratio:9\/16/);
  assert.match(bloco, /object-fit:contain/);
  assert.match(bloco, /92dvh/);
  assert.match(bloco, /\.tc-fechar\{[^}]*min-width:44px;min-height:44px/);
  assert.match(bloco, /safe-area-inset-top/);
});
