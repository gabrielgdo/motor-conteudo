// Teleprompter (Ponto 6) e avisos acima das janelas, com um DOM falso mínimo (sem navegador):
// "Do começo" para, volta ao topo E começa a rolar, com o retorno "Lendo do começo" (role=status);
// abrir segura a renovação do token e fechar solta; a faixa "Sua sessão expirou" é um <button> no
// topo do teleprompter; #avisos vira popover="manual" reapresentado depois de abrir a janela (e,
// sem popover, nada quebra). Nada sai para a rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** Elemento falso com o que o tele.js e o janelas.js usam. */
function elemento(extra = {}) {
  const ouvintes = {};
  return {
    innerHTML: '', textContent: '', scrollTop: 0, scrollHeight: 5000, clientHeight: 600, style: {}, dataset: {}, atributos: {},
    addEventListener(tipo, fn) { (ouvintes[tipo] ||= []).push(fn); },
    disparar(tipo) { for (const fn of ouvintes[tipo] || []) fn({ target: this }); },
    setAttribute(k, v) { this.atributos[k] = String(v); },
    getAttribute(k) { return this.atributos[k] ?? null; },
    hasAttribute(k) { return k in this.atributos; },
    ...extra,
  };
}

function montarDom(t, { popover = true, avisoSessao = false } = {}) {
  const antes = {};
  for (const k of ['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']) antes[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  t.after(() => {
    for (const [k, d] of Object.entries(antes)) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  });
  const quadros = [];
  const dom = { rolo: elemento(), anuncio: elemento(), botao: elemento(), inseridos: [], popover: [], faixa: null };
  dom.fechar = elemento({ insertAdjacentHTML(onde, html) { dom.inseridos.push([onde, html]); dom.faixa = elemento({ remove() { dom.faixa = null; } }); } });
  dom.topo = elemento({ querySelector: (s) => (s === '#tele-sessao' ? dom.faixa : s === '[data-acao="tele-fechar"]' ? dom.fechar : null) });
  dom.tele = elemento({
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; this.disparar('close'); },
    querySelector: (s) => (s === '.tele-topo' ? dom.topo : null),
  });
  dom.avisos = elemento(popover ? {
    aberto: false,
    showPopover() { this.aberto = true; dom.popover.push('show'); },
    hidePopover() { this.aberto = false; dom.popover.push('hide'); },
    matches(s) { return s === ':popover-open' && this.aberto; },
  } : {});
  const porSeletor = {
    '#tele': dom.tele, '#tele-rolo': dom.rolo, '#tele-anuncio': dom.anuncio, '#tele-botao': dom.botao, '#avisos': dom.avisos,
  };
  const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  def('document', {
    querySelector: (s) => {
      if (s === '#tele-sessao') return dom.faixa;
      if (s === '#avisos [data-aviso="sessao"]') return avisoSessao ? elemento() : null;
      return porSeletor[s] || null;
    },
    addEventListener() {},
  });
  def('window', { innerWidth: 390 });
  def('requestAnimationFrame', (fn) => { quadros.push(fn); return quadros.length; });
  def('cancelAnimationFrame', () => {});
  def('getComputedStyle', () => ({ paddingTop: '0', paddingBottom: '0' }));
  dom.quadros = quadros;
  return dom;
}

const ROTEIRO = { id: 'S99-01', curto: 'Roteiro <b>fictício</b>', falas: [{ texto: 'Primeira frase. Segunda frase!' }], formatoRoteiro: 'novo' };

let n = 0;
const novoTele = async () => (await import(`../js/componentes/tele.js?t=${++n}`)).Tele;

test('"Do começo": para, volta ao topo e começa a rolar, com "Lendo do começo" (role=status, aria-live)', async (t) => {
  const dom = montarDom(t);
  const Tele = await novoTele();
  Tele.ligar();
  Tele.abrir(ROTEIRO);
  assert.match(dom.tele.innerHTML, /<span class="tele-anuncio" id="tele-anuncio" role="status" aria-live="polite"><\/span>/);
  assert.match(dom.tele.innerHTML, /<button type="button" class="botao sec" data-acao="tele-reiniciar">Do começo<\/button>/);
  assert.ok(dom.tele.innerHTML.includes('Roteiro &lt;b&gt;fictício&lt;/b&gt;'), 'título com esc()');

  // Parado no meio do texto
  dom.rolo.scrollTop = 900;
  Tele.pos = 900;
  Tele.reiniciar();
  assert.equal(dom.rolo.scrollTop, 0);
  assert.equal(Tele.tocando, true, 'começa a rolar');
  assert.match(dom.botao.innerHTML, /Pausar/);
  assert.equal(dom.anuncio.textContent, 'Lendo do começo');

  // Já rolando: recomeça do topo e continua rolando (não vira pausa)
  dom.rolo.scrollTop = 1200;
  Tele.reiniciar();
  assert.equal(dom.rolo.scrollTop, 0);
  assert.equal(Tele.tocando, true);
  dom.tele.close();
  assert.equal(Tele.tocando, false);
});

test('teleprompter segura a renovação do token ao abrir e solta ao fechar (Esc, X ou Sair: o evento close)', async (t) => {
  const dom = montarDom(t);
  const Tele = await novoTele();
  const chamadas = [];
  Tele.ligar({ segurar: (sim) => chamadas.push(sim) });
  Tele.abrir(ROTEIRO);
  assert.deepEqual(chamadas, [true]);
  Tele.reiniciar(); // "Do começo" não usa login nem rede
  assert.deepEqual(chamadas, [true]);
  dom.tele.close();
  assert.deepEqual(chamadas, [true, false]);
});

test('sessão vencida com o teleprompter aberto: faixa <button> no topo que chama renovar-sessao; some ao renovar', async (t) => {
  const dom = montarDom(t);
  const Tele = await novoTele();
  Tele.ligar();
  Tele.sessaoExpirada(); // fechado: nada
  assert.equal(dom.inseridos.length, 0);
  Tele.abrir(ROTEIRO);
  Tele.sessaoExpirada();
  Tele.sessaoExpirada(); // uma faixa só
  assert.equal(dom.inseridos.length, 1);
  const [onde, html] = dom.inseridos[0];
  assert.equal(onde, 'beforebegin'); // antes do X, dentro do tele-topo
  assert.match(html, /^<button type="button" class="tele-sessao" id="tele-sessao" data-acao="renovar-sessao">/);
  assert.match(html, /Sua sessão expirou\. Toque para continuar/);
  Tele.sessaoRenovada();
  assert.equal(dom.faixa, null);
});

test('abrir o teleprompter com o aviso de sessão já na tela mostra a faixa na hora', async (t) => {
  const dom = montarDom(t, { avisoSessao: true });
  const Tele = await novoTele();
  Tele.ligar();
  Tele.abrir(ROTEIRO);
  assert.equal(dom.inseridos.length, 1);
});

test('#avisos acima das janelas: popover="manual" reapresentado depois de abrir o teleprompter', async (t) => {
  const dom = montarDom(t);
  const Tele = await novoTele();
  Tele.ligar();
  Tele.abrir(ROTEIRO);
  assert.equal(dom.avisos.getAttribute('popover'), 'manual');
  assert.deepEqual(dom.popover, ['show']);
  const { subirAvisos } = await import('../js/componentes/janelas.js');
  assert.equal(subirAvisos(dom.avisos), true);
  assert.deepEqual(dom.popover, ['show', 'hide', 'show'], 'esconde e mostra de novo: entra por último na camada de cima');
});

test('#avisos sem popover (iOS < 17): reserva sem lançar, tudo como antes', async (t) => {
  const dom = montarDom(t, { popover: false });
  const { subirAvisos } = await import('../js/componentes/janelas.js');
  assert.equal(subirAvisos(dom.avisos), false);
  assert.equal(subirAvisos(null), false);
  assert.equal(dom.avisos.getAttribute('popover'), null);
  const Tele = await novoTele();
  Tele.ligar();
  assert.doesNotThrow(() => Tele.abrir(ROTEIRO));
  const lanca = elemento({ showPopover() { throw new Error('x'); }, hidePopover() {}, matches: () => false });
  assert.equal(subirAvisos(lanca), false);
});

test('código: abrirJanela reapresenta os avisos depois do showModal; CSS desfaz o estilo do popover; main liga o adiamento', () => {
  const janelas = readFileSync(new URL('../js/componentes/janelas.js', import.meta.url), 'utf8');
  assert.match(janelas, /d\.showModal\(\); subirAvisos\(\);/);
  const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.avisos\[popover\]\{top:auto;[^}]*background:transparent/);
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  assert.match(main, /Tele\.ligar\(\{ segurar: Integra\.segurarRenovacao \}\)/);
  assert.match(main, /Tele\.sessaoExpirada\(\)/);
  const integra = readFileSync(new URL('../js/integra.js', import.meta.url), 'utf8');
  assert.match(integra, /segurarRenovacao: \(sim\) => auth\.segurarRenovacao\(!!sim\)/);
});
