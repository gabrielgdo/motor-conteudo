// Task 14b: a tira de cada peça de motion no storyboard e o selo "novo" (o motor escreve, no quadro em que a peça
// entra, "- tira: ig-p01-1.jpg, …" com 4 a 6 imagens da peça e "- novo: sim" quando ela é sob medida deste vídeo), a
// tela cheia que desliza pela tira, a fila das imagens (os quadros antes das tiras) e as correções da revisão da 14a
// (pergunta da reserva não vira pedido de mudança, chave desconhecida da configuração fixa em palavras, "os 1 pedidos",
// o pedido geral nos "Ajustes enviados", "Mudar a regra" com "Recusar"). Sem navegador e sem rede; textos fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED } from '../js/config.js';
import { lerDataHora, parseAjustes, gerarAjustes } from '../js/parse.js';
import { montarProjetos } from '../js/model.js';
import { storyboardDe } from '../js/dados.js';
import { lerStoryboard, lerTira, MAX_TIRA, textoDaDecisaoStoryboardAceita } from '../js/storyboard.js';
import {
  lerPerguntasRegra, decisaoComRegras, textoDoPedidoDasRegras, regraLegivel, efeitoDaResposta, chaveRespostas,
} from '../js/regras.js';
import { blocoRegras, algumaLibera, notaPedidoJaFeito } from '../js/componentes/regras.js';
import { painelQuadros, painelDecisaoStoryboard, tiraDoQuadro, seloNovo, LEGENDA_NOVO } from '../js/telas/storyboard.js';
import { pedidosDoTexto, listaPedidos } from '../js/telas/videos.js';
import { decisaoDoRascunho } from '../js/telas/roteiros.js';
import { Quadros, chaveDoQuadro, MAX_IMAGENS } from '../js/componentes/quadros.js';
import { TelaCheia, htmlTiraCheia, ID_TELACHEIA } from '../js/componentes/telacheia.js';
import { Integra } from '../js/integra.js';
import { estado } from '../js/estado.js';

const ROBERTTA = ALLOWED[0];
const AGORA = lerDataHora('2026-11-18 10:30');
const MAL = '<img src=x onerror=alert(1)>';
const REV = 'id-4-revisao';
const arq = (name, extra = {}) => ({ id: `id-${name}`, name, createdTime: '2026-11-18T12:00:00.000Z', modifiedTime: '2026-11-18T12:00:00.000Z', parents: [REV], ...extra });

// o que o bin/storyboard.py do motor escreve (texto_md), com uma peça sob medida (novo) e uma da biblioteca
const MD = `---
id: S47-01
versao: 1
redes: ig, tt
---
# Storyboard S47-01 v1 — Volta

## Instagram
### Quadro 1
arquivo: ig-01.jpg
tempo: 0:00.6
acontece: gancho escrito na tela; câmera parada
na tela: Traição: o que pesa?
por que: a pergunta abre a tensão

### Quadro 4
arquivo: ig-04.jpg
tempo: 0:09.0
acontece: peça "contador" entra na caixa abaixo do queixo; câmera 1,10x
na tela: 62% · das pessoas ouvidas · Autora et al., 2024
por que: o número é a ideia da frase
- tira: ig-p01-1.jpg, ig-p01-2.jpg, ig-p01-3.jpg, ig-p01-4.jpg
- novo: sim

### Quadro 5
arquivo: ig-05.jpg
tempo: 0:12.0
acontece: peça da biblioteca
- tira: ig-p02-1.jpg, ig-p02-2.jpg, ig-p02-3.jpg, ig-p02-4.jpg, ig-p02-5.jpg

## TikTok
### Quadro 1
arquivo: tt-01.jpg
tempo: 0:00.5
acontece: gancho
- tira: tt-p01-1.jpg, tt-p01-2.jpg, tt-p01-3.jpg, tt-p01-4.jpg
`;

/* ------------------------------------------------------------------ leitura */

test('tira e novo: lidos no quadro em que a peça entra; a numeração dos quadros não muda; sem as linhas, nada', () => {
  const s = lerStoryboard(MD);
  assert.deepEqual(s.quadros.ig.map((q) => q.n), [1, 4, 5], 'a tira não vira quadro');
  const [q1, q4, q5] = s.quadros.ig;
  assert.deepEqual(q1, {
    n: 1, arquivo: 'ig-01.jpg', tempo: '0:00.6', acontece: 'gancho escrito na tela; câmera parada', naTela: 'Traição: o que pesa?',
    porque: 'a pergunta abre a tensão', tira: [], novo: false,
  });
  assert.deepEqual(q4.tira, ['ig-p01-1.jpg', 'ig-p01-2.jpg', 'ig-p01-3.jpg', 'ig-p01-4.jpg']);
  assert.equal(q4.novo, true);
  assert.equal(q4.porque, 'o número é a ideia da frase', 'as linhas da tira não mexem nos outros campos');
  assert.equal(q5.tira.length, 5);
  assert.equal(q5.novo, false, 'peça da biblioteca: sem "novo"');
  assert.deepEqual(s.quadros.tt[0].tira, ['tt-p01-1.jpg', 'tt-p01-2.jpg', 'tt-p01-3.jpg', 'tt-p01-4.jpg']);
  assert.equal(MAX_TIRA, 6);
});

test('tira malformada: só nomes de tira da mesma rede e da mesma peça, sem repetir, até 6; "novo" só com tira', () => {
  const md = `---
id: S47-01
versao: 1
---
## Instagram
### Quadro 2
arquivo: ig-02.jpg
tempo: 0:03.0
- tira: ../../segredo.jpg, tt-p01-1.jpg, ig-03.jpg, ig-p01-1.png, ig-p03-1.jpg, ig-p03-1.jpg, IG-P03-2.JPG, ig-p04-1.jpg, ig-p03-3.jpg, ig-p03-4.jpg, ig-p03-5.jpg, ig-p03-6.jpg, ig-p03-7.jpg, ig-p03-0.jpg
- novo: sim

### Quadro 3
arquivo: ig-03.jpg
tempo: 0:05.0
- novo: sim

### Quadro 6
arquivo: ig-06.jpg
tempo: 0:07.0
- tira: tt-p01-1.jpg, ${MAL}
- novo: talvez

### Quadro 7
arquivo: ig-07.jpg
tempo: 0:08.0
- tira: "ig-p05-1.jpg, ig-p05-2.jpg"
- novo: não

### Quadro 8
arquivo: ig-08.jpg
tempo: 0:09.0
tira: ig-p06-1.jpg, ig-p06-2.jpg, ig-p06-3.jpg, ig-p06-4.jpg
novo: SIM
- tira: ig-p07-1.jpg

### Quadro 9
arquivo: ig-p01-1.jpg
tempo: 0:10.0
`;
  const s = lerStoryboard(md);
  const q = Object.fromEntries(s.quadros.ig.map((x) => [x.n, x]));
  assert.deepEqual(Object.keys(q).map(Number), [2, 3, 6, 7, 8], 'imagem de tira no lugar do quadro: o quadro sai');
  assert.deepEqual(q[2].tira, ['ig-p03-1.jpg', 'IG-P03-2.JPG', 'ig-p03-3.jpg', 'ig-p03-4.jpg', 'ig-p03-5.jpg', 'ig-p03-6.jpg']);
  assert.equal(q[2].novo, true);
  assert.deepEqual([q[3].tira, q[3].novo], [[], false], '"novo" sem tira não vale');
  assert.deepEqual([q[6].tira, q[6].novo], [[], false], 'tira da outra rede e lixo saem; "talvez" não é sim');
  assert.deepEqual([q[7].tira, q[7].novo], [['ig-p05-1.jpg', 'ig-p05-2.jpg'], false], 'entre aspas também; "não" não é novo');
  assert.deepEqual([q[8].tira.length, q[8].novo], [4, true], 'sem o "- " também; vale a primeira linha');
  assert.ok(!JSON.stringify(s).includes('segredo') && !JSON.stringify(s).includes('onerror'));
  assert.deepEqual(lerTira('ig-p01-1.jpg, ig-p01-2.jpg', 'tt'), [], 'tira de outra rede');
  assert.deepEqual(lerTira('', 'ig'), []);
  assert.deepEqual(lerTira(null, 'ig'), []);
});

test('storyboardDe: cada imagem da tira achada na pasta (sem diferença de maiúscula); a que falta fica sem arquivo', () => {
  const p = montarProjetos({ revisao: [arq('S47-01 storyboard v1.md')] }).get('S47-01');
  const arquivos = ['ig-01.jpg', 'ig-04.jpg', 'ig-05.jpg', 'tt-01.jpg', 'ig-p01-1.jpg', 'IG-P01-2.jpg', 'ig-p01-3.jpg'].map((n) => arq(n));
  const sb = storyboardDe(p, { md: lerStoryboard(MD), arquivos });
  const q4 = sb.quadros.ig.find((q) => q.n === 4);
  assert.deepEqual(q4.tira.map((t) => t.arquivo), ['ig-p01-1.jpg', 'ig-p01-2.jpg', 'ig-p01-3.jpg', 'ig-p01-4.jpg']);
  assert.deepEqual(q4.tira.map((t) => t.file?.name || null), ['ig-p01-1.jpg', 'IG-P01-2.jpg', 'ig-p01-3.jpg', null]);
  assert.equal(q4.novo, true);
  assert.deepEqual(sb.quadros.ig[0].tira, []);
  assert.equal(sb.quadros.ig[0].novo, false);
  // o .md de antes (sem os campos novos): continua lendo
  const velho = storyboardDe(p, { md: { redes: ['ig'], notas: [], mudancas: [], quadros: { ig: [{ n: 1, arquivo: 'ig-01.jpg', tempo: '0:01.0' }], tt: [] } }, arquivos });
  assert.deepEqual([velho.quadros.ig[0].tira, velho.quadros.ig[0].novo], [[], false]);
});

test('dados: com imagem da tira faltando, a pasta é listada de novo; completa, fica guardada', async () => {
  const { carregar, roteiros, limparDados } = await import('../js/dados.js');
  const orig = {
    listagens: Integra.listagens, postados: Integra.postados, texto: Integra.baixarTexto,
    listar: Integra.drive.listarStoryboard, invalidar: Integra.invalidar,
  };
  const pasta = { id: 'id-pasta-T09-01', name: 'T09-01 storyboard v1', mimeType: 'application/vnd.google-apps.folder', parents: [REV] };
  const listagem = { roteiros: [], rascunhos: [], brutos: [], revisao: [pasta, arq('T09-01 storyboard v1.md')], prontos: [], pacotes: {}, vencedores: [] };
  let listadas = 0;
  let arquivos = ['ig-01.jpg', 'ig-p01-1.jpg'].map((n) => arq(n));
  Integra.listagens = async () => listagem;
  Integra.postados = async () => new Map();
  Integra.baixarTexto = async () => '---\nid: T09-01\nversao: 1\n---\n## Instagram\n### Quadro 1\narquivo: ig-01.jpg\ntempo: 0:00.5\n- tira: ig-p01-1.jpg, ig-p01-2.jpg\n';
  Integra.drive.listarStoryboard = async () => { listadas++; return arquivos; };
  Integra.invalidar = () => {};
  try {
    await carregar({ forcar: true });
    let r = roteiros().find((x) => x.id === 'T09-01');
    assert.equal(r.storyboard.quadros.ig[0].tira[1].file, null, 'a segunda imagem da tira ainda não subiu');
    arquivos = ['ig-01.jpg', 'ig-p01-1.jpg', 'ig-p01-2.jpg'].map((n) => arq(n));
    await carregar({ forcar: true });
    r = roteiros().find((x) => x.id === 'T09-01');
    assert.equal(listadas, 2, 'faltava imagem da tira: listou de novo');
    assert.equal(r.storyboard.quadros.ig[0].tira[1].file.name, 'ig-p01-2.jpg');
    await carregar({ forcar: true });
    assert.equal(listadas, 2, 'completa: fica guardada');
  } finally {
    Object.assign(Integra, { listagens: orig.listagens, postados: orig.postados, baixarTexto: orig.texto, invalidar: orig.invalidar });
    Integra.drive.listarStoryboard = orig.listar;
    limparDados();
  }
});

/* ------------------------------------------------------------------ tela */

function rotTira() {
  const f = (name) => ({ id: `id-${name}`, name, modifiedTime: 't' });
  return {
    id: 'S47-01', etapa: 'storyboard', titulo: 'Volta', teste: false,
    storyboard: {
      versao: 1, lido: true, erro: false, temDecisao: false, decisao: null, notas: [], mudancas: [], regras: [],
      quadros: {
        ig: [
          { n: 1, arquivo: 'ig-01.jpg', tempo: '0:00.6', acontece: 'gancho', naTela: '', porque: '', file: null, tira: [], novo: false },
          {
            n: 4, arquivo: 'ig-04.jpg', tempo: '0:09.0', acontece: 'peça', naTela: MAL, porque: '', file: null, novo: true,
            tira: [{ arquivo: 'ig-p01-1.jpg', file: f('ig-p01-1.jpg') }, { arquivo: 'ig-p01-2.jpg', file: f('ig-p01-2.jpg') },
              { arquivo: 'ig-p01-3.jpg', file: f('ig-p01-3.jpg') }, { arquivo: 'ig-p01-4.jpg', file: null }],
          },
        ],
        tt: [{ n: 1, arquivo: 'tt-01.jpg', tempo: '0:00.5', acontece: 'gancho', file: null, novo: false,
          tira: [{ arquivo: 'tt-p01-1.jpg', file: f('tt-p01-1.jpg') }, { arquivo: 'tt-p01-2.jpg', file: f('tt-p01-2.jpg') }] }],
      },
    },
  };
}

function semDownload(t) {
  const orig = Integra.baixarBlob;
  Integra.baixarBlob = () => new Promise(() => {});
  t.after(() => { Integra.baixarBlob = orig; Quadros.liberar(); });
  Quadros.liberar();
}

test('a tira na tela: fileira de miniaturas que abrem a tela cheia; a que falta diz e tem "Tentar de novo"', (t) => {
  semDownload(t);
  const r = rotTira();
  const q4 = r.storyboard.quadros.ig[1];
  Quadros.urls.set(chaveDoQuadro(q4.tira[0].file), 'blob:teste/1');
  const h = tiraDoQuadro(r, 'ig', q4);
  assert.match(h, /class="tira"/);
  assert.match(h, /Animação/);
  const botoes = h.match(/<button[^>]*data-acao="sb-tira"[^>]*>/g) || [];
  assert.equal(botoes.length, 3, 'uma miniatura tocável por imagem que existe');
  assert.deepEqual(botoes.map((b) => b.match(/data-valor="([^"]+)"/)[1]), ['ig:4:0', 'ig:4:1', 'ig:4:2']);
  assert.ok(botoes.every((b) => /type="button"/.test(b) && /data-id="S47-01"/.test(b)));
  assert.match(botoes[0], /aria-label="Animação do quadro 4 do Instagram, imagem 1 de 4: ver em tela cheia"/);
  assert.match(h, /<img src="blob:teste\/1" alt=""/, 'a imagem que chegou');
  assert.equal((h.match(/<img /g) || []).length, 1, 'as outras ainda baixando: sem <img>');
  assert.match(h, /Imagem 4 de 4 da animação ainda não chegou ao Drive/);
  assert.match(h, /data-acao="sb-tentar"/, 'imagem da tira faltando: "Tentar de novo"');
  assert.equal(tiraDoQuadro(r, 'ig', r.storyboard.quadros.ig[0]), '', 'sem tira, nada');
  assert.equal(tiraDoQuadro(r, 'ig', { n: 2, arquivo: 'ig-02.jpg', tempo: '0:01' }), '', 'quadro sem os campos novos, nada');
});

test('o selo "novo": discreto, com a explicação em palavras simples; a legenda só aparece se houver peça nova', (t) => {
  semDownload(t);
  const s = seloNovo();
  assert.match(s, /class="selo neutro novo"/);
  assert.match(s, /title="peça nova, feita para este vídeo"/);
  assert.match(s, />novo</);
  assert.match(s, /class="vh">: peça nova, feita para este vídeo</, 'quem usa leitor de tela ouve a explicação');
  assert.equal(LEGENDA_NOVO, 'peça nova, feita para este vídeo');
  const r = rotTira();
  const h = painelQuadros(r, { email: ROBERTTA, agora: AGORA });
  assert.equal((h.match(/class="selo neutro novo"/g) || []).length, 2, 'no quadro 4 e na legenda');
  assert.match(h, /class="pequeno apagado legenda-novo"/);
  assert.equal((h.match(/data-acao="sb-tira"/g) || []).length, 5, 'IG quadro 4 (3) e TT quadro 1 (2)');
  assert.ok(!h.includes(MAL), 'conteúdo do Drive escapado');
  assert.equal(tiraDoQuadro(r, 'tt', r.storyboard.quadros.tt[0]).includes('novo'), false, 'peça da biblioteca: sem selo');
  // nenhuma peça nova: sem legenda e sem selo
  r.storyboard.quadros.ig[1].novo = false;
  const sem = painelQuadros(r, { email: ROBERTTA, agora: AGORA });
  assert.ok(!sem.includes('legenda-novo') && !sem.includes('selo neutro novo'));
});

test('quadros sem tira aparecem exatamente como antes (sem tira, selo nem legenda)', (t) => {
  semDownload(t);
  estado.sbPendentes = {};
  estado.sbQuadro = {};
  const r = rotTira();
  for (const rede of ['ig', 'tt']) r.storyboard.quadros[rede] = r.storyboard.quadros[rede].map(({ tira, novo, ...q }) => q);
  const antes = painelQuadros(r, { email: ROBERTTA, agora: AGORA });
  const comVazios = structuredClone(r);
  for (const rede of ['ig', 'tt']) comVazios.storyboard.quadros[rede] = comVazios.storyboard.quadros[rede].map((q) => ({ ...q, tira: [], novo: false }));
  assert.equal(painelQuadros(comVazios, { email: ROBERTTA, agora: AGORA }), antes);
  assert.ok(!/tira|legenda-novo|selo neutro novo/.test(antes), antes);
});

/* ------------------------------------------------------------------ tela cheia da tira */

test('tela cheia da tira (puro): uma imagem por vez, o contador, anterior e próxima; nada do Drive cru', () => {
  const itens = [
    { alt: 'imagem 1', url: 'blob:teste/1', estado: 'pronto' },
    { alt: 'imagem 2', url: null, estado: 'carregando' },
    { alt: 'imagem 3', url: null, estado: 'sem-arquivo' },
    { alt: 'imagem 4', url: null, estado: 'erro' },
  ];
  const h = htmlTiraCheia({ titulo: `Instagram · quadro 4 · ${MAL}`, itens, inicio: 1 });
  assert.ok(!h.includes(MAL) && h.includes('&lt;img src=x'), 'título escapado');
  assert.match(h, /id="tc-nome"/, 'o <dialog> continua com o nome');
  assert.match(h, /data-acao="telacheia-fechar"/);
  assert.equal((h.match(/data-tira-i="/g) || []).length, 4);
  assert.match(h, /<img class="tc-img" src="blob:teste\/1" alt="imagem 1"/);
  assert.match(h, /Baixando…/);
  assert.match(h, /Esta imagem ainda não chegou ao Drive\./);
  assert.match(h, /Não consegui baixar esta imagem\./);
  assert.match(h, /data-tc-conta[^>]*>2 de 4</, 'começa na imagem tocada');
  assert.match(h, /<button type="button" class="tc-passo" data-acao="tira-passo" data-valor="-1" aria-label="Imagem anterior">/);
  assert.match(h, /<button type="button" class="tc-passo" data-acao="tira-passo" data-valor="1" aria-label="Próxima imagem">/);
  assert.match(htmlTiraCheia({ itens, inicio: 99 }), />4 de 4</, 'início fora da tira: a última');
});

function ouvinte(obj) {
  const ouvintes = {};
  obj.addEventListener = (tipo, fn) => { (ouvintes[tipo] ||= []).push(fn); };
  obj.dispatchEvent = (ev) => { for (const fn of ouvintes[ev.type] || []) fn(ev); return true; };
  return obj;
}

function domTira(t) {
  const antes = {};
  for (const k of ['document', 'window', 'CSS']) antes[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  t.after(() => {
    for (const [k, d] of Object.entries(antes)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
    TelaCheia.aberto = null;
  });
  const figuras = [];
  const tira = ouvinte({ clientWidth: 390, scrollLeft: 0, rolagens: [], scrollTo(o) { this.rolagens.push(o); this.scrollLeft = o.left; } });
  const conta = { textContent: '' };
  const passos = [{ dataset: { valor: '-1' }, disabled: false }, { dataset: { valor: '1' }, disabled: false }];
  const d = ouvinte({
    id: ID_TELACHEIA, dataset: {}, open: false, classes: new Set(), _html: '',
    classList: { add: (c) => d.classes.add(c), remove: (c) => d.classes.delete(c), contains: (c) => d.classes.has(c) },
    get innerHTML() { return this._html; },
    set innerHTML(v) {
      this._html = v;
      figuras.length = 0;
      for (const [, i] of v.matchAll(/data-tira-i="(\d+)"/g)) figuras.push({ dataset: { tiraI: i }, innerHTML: '' });
    },
    setAttribute(k, v) { if (k === 'open') this.open = true; this[`attr_${k}`] = v; },
    removeAttribute(k) { if (k === 'open') this.open = false; },
    querySelector(s) { return s === '[data-tc-tira]' ? tira : s === '[data-tc-conta]' ? conta : null; },
    querySelectorAll(s) { return s === '[data-tira-i]' ? figuras : s === '[data-acao="tira-passo"]' ? passos : []; },
    showModal() { this.open = true; },
    close() { this.open = false; this.dispatchEvent({ type: 'close' }); },
  });
  const botao = { isConnected: true, focado: 0, focus() { this.focado++; } };
  globalThis.document = ouvinte({ getElementById: (id) => (id === ID_TELACHEIA ? d : null), querySelector: () => null, querySelectorAll: () => [] });
  globalThis.window = ouvinte({});
  globalThis.CSS = { escape: (s) => s };
  return { d, tira, conta, passos, figuras, botao };
}

test('TelaCheia.abrirTira: abre na imagem tocada, desliza (anterior/próxima, setas), troca a imagem que chega e devolve o foco', (t) => {
  const { d, tira, conta, passos, figuras, botao } = domTira(t);
  const urls = new Map([['a', 'blob:teste/a']]);
  const fonte = { url: (f) => urls.get(f?.id) || null, estado: (f) => (!f ? 'sem-arquivo' : urls.has(f.id) ? 'pronto' : 'carregando') };
  const itens = [{ file: { id: 'a' }, alt: 'um' }, { file: { id: 'b' }, alt: 'dois' }, { file: null, alt: 'três' }];
  TelaCheia.ligar();
  assert.equal(TelaCheia.abrirTira({ titulo: 'Instagram · quadro 4 · animação', itens, inicio: 1, botao, fonte }), true);
  assert.equal(d.open, true);
  assert.equal(TelaCheia.aberto.tipo, 'tira');
  assert.equal(tira.scrollLeft, 390, 'começa na segunda imagem');
  assert.equal(conta.textContent, '2 de 3');
  assert.match(d.innerHTML, /<img class="tc-img" src="blob:teste\/a"/);
  // a segunda imagem chega: só a figura dela muda
  urls.set('b', 'blob:teste/b');
  globalThis.window.dispatchEvent({ type: 'motor:anexo' });
  assert.match(figuras[1].innerHTML, /src="blob:teste\/b"/);
  assert.equal(figuras[0].innerHTML, '', 'a que já estava pronta não é refeita');
  // próxima / anterior e as setas do teclado
  TelaCheia.passoTira(1);
  assert.deepEqual(tira.rolagens.at(-1), { left: 780, behavior: 'smooth' });
  tira.dispatchEvent({ type: 'scroll' });
  assert.equal(conta.textContent, '3 de 3');
  assert.deepEqual(passos.map((p) => p.disabled), [false, true], 'na última, "Próxima" desliga');
  TelaCheia.passoTira(1);
  assert.equal(tira.rolagens.length, 1, 'não passa da última');
  globalThis.document.dispatchEvent({ type: 'keydown', key: 'ArrowLeft' });
  assert.deepEqual(tira.rolagens.at(-1), { left: 390, behavior: 'smooth' });
  // fechar: limpa e devolve o foco a quem abriu
  TelaCheia.fechar();
  assert.equal(d.open, false);
  assert.equal(TelaCheia.aberto, null);
  assert.equal(d.innerHTML, '');
  assert.equal(botao.focado, 1);
  assert.equal(TelaCheia.abrirTira({ itens: [], fonte }), false, 'tira vazia não abre');
});

test('Quadros: os quadros baixam antes das imagens da tira; a tela cheia passa a dela na frente da tira', async (t) => {
  const orig = Integra.baixarBlob;
  const pedidos = [];
  const espera = [];
  Integra.baixarBlob = (f) => { pedidos.push(f.id); return new Promise((ok) => espera.push(() => ok(new Blob(['x'])))); };
  const criar = URL.createObjectURL;
  URL.createObjectURL = () => 'blob:teste';
  t.after(() => { Integra.baixarBlob = orig; URL.createObjectURL = criar; Quadros.liberar(); });
  Quadros.liberar();
  const f = (id) => ({ id, modifiedTime: 't' });
  // a ordem do desenho: quadro 1, a tira dele, quadro 2…
  Quadros.url(f('q1'));
  for (const i of [1, 2, 3, 4]) Quadros.url(f(`p1-${i}`), { depois: true });
  for (const n of [2, 3, 4, 5]) Quadros.url(f(`q${n}`));
  assert.deepEqual(pedidos, [], 'nada começa no meio do desenho');
  await new Promise((ok) => setTimeout(ok, 0));
  assert.deepEqual(pedidos, ['q1', 'q2', 'q3', 'q4'], 'os 4 primeiros downloads são de quadros');
  Quadros.url(f('p1-4'));   // a tela cheia pede uma imagem da tira: ela passa na frente das outras da tira
  espera.shift()();
  await new Promise((ok) => setTimeout(ok, 0));
  assert.equal(pedidos[4], 'q5', 'os quadros que faltam continuam primeiro');
  espera.shift()();
  await new Promise((ok) => setTimeout(ok, 0));
  assert.equal(pedidos[5], 'p1-4');
  espera.shift()();
  await new Promise((ok) => setTimeout(ok, 0));
  assert.equal(pedidos[6], 'p1-1', 'e só então o resto da tira');
  assert.ok(MAX_IMAGENS >= 2 * (12 + 12 * 6), 'cabe um storyboard inteiro com uma tira em cada quadro');
});

/* ------------------------------------------------------------------ correções da revisão da 14a */

const PERGUNTA = 'pergunta: mudar a regra, fazer só neste vídeo ou manter?';
const SECAO = `## Regra que esbarra no seu pedido
### S47-01-R1
pedido: "pôr a pergunta num cartão" (IG, quadro 4)
regra: estilo/limites.md:28 — "Nunca caixa, tarja, cartão ou faixa com texto"
feito agora: a pergunta em Lora solta com sombra, no mesmo lugar
texto novo: "[ambos] Cartão com texto só quando ela pedir no storyboard; o resto continua em letra solta."
${PERGUNTA}

### S47-01-R2
pedido: "um gancho mais longo" (ajustes v2)
regra: roteiro/regras.md:3 — "Gancho em até 12 palavras."
feito agora: o gancho com 12 palavras
texto novo: "Gancho em até 15 palavras."
${PERGUNTA}
`;
// R1 voltou porque a resposta anterior ("Mudar a regra") veio pela reserva do Drive (bin/regras.py DE_NOVO["reserva"])
const SECAO_RESERVA = SECAO.replace(PERGUNTA,
  'pergunta: sua resposta não veio pelo app, então valeu só para este vídeo. Mudar a regra, fazer só neste vídeo ou manter?');

test('reserva: a pergunta que voltou porque a resposta veio pelo Drive é marcada; o pedido dela já foi feito', () => {
  const [r1, r2] = lerPerguntasRegra(SECAO_RESERVA, 'S47-01');
  assert.equal(r1.reserva, true);
  assert.equal(r1.motivo, 'sua resposta não veio pelo app, então valeu só para este vídeo.');
  assert.equal(r2.reserva, false);
  const sumiu = lerPerguntasRegra(SECAO.replace(PERGUNTA, 'pergunta: a regra mudou antes da sua resposta e nada foi trocado. Mudar a regra, fazer só neste vídeo ou manter?'), 'S47-01');
  assert.equal(sumiu[0].reserva, false, 'outro porquê: o pedido não foi feito');
});

test('reserva: "Aprovar" com "Mudar a regra" não vira pedido de mudança; a resposta vai com a aprovação e a tela explica', () => {
  const perguntas = lerPerguntasRegra(SECAO_RESERVA, 'S47-01');
  const mudar = { 'S47-01-R1': 'mudar' };
  for (const alvo of ['storyboard', 'roteiro']) {
    const dc = decisaoComRegras({ decisao: 'aprovar', perguntas, respostas: mudar, id: 'S47-01', alvo });
    assert.deepEqual([dc.decisao, dc.virou, dc.pedido], ['aprovar', false, ''], alvo);
    assert.deepEqual(dc.regras, [{ id: 'S47-01-R1', resposta: 'mudar' }], `${alvo}: a resposta vai junto`);
  }
  const pv = decisaoComRegras({ decisao: 'aprovar', perguntas, respostas: mudar, id: 'S47-01', alvo: 'previa' });
  assert.deepEqual([pv.decisao, pv.virou, pv.regras], ['aprovar', false, []]);
  assert.equal(algumaLibera(perguntas, mudar, 'S47-01'), false);
  // com outra pergunta que libera, vira; o pedido que vai junto é só o dela
  const duas = decisaoComRegras({ decisao: 'aprovar', perguntas, respostas: { ...mudar, 'S47-01-R2': 'so_neste' }, id: 'S47-01', alvo: 'storyboard' });
  assert.equal(duas.virou, true);
  assert.equal(duas.pedido, 'Fazer o pedido que esperava a resposta sobre a regra: "um gancho mais longo" (ajustes v2).');
  assert.equal(textoDoPedidoDasRegras(perguntas, [{ id: 'S47-01-R1', resposta: 'mudar' }]), '');

  // o cartão: o que a resposta faz, sem prometer o pedido de novo
  const h = blocoRegras({ perguntas, respostas: mudar, chave: 'sb:S47-01:v2', pode: true });
  assert.match(h, /A regra muda \(para os próximos vídeos também\)\. O seu pedido já foi feito neste vídeo\./);
  assert.ok(!h.includes('e o motor faz o seu pedido'));
  // storyboard: "Aprovar" fica, com a nota
  const r = { id: 'S47-01', etapa: 'storyboard', titulo: 'Volta', teste: false,
    storyboard: { versao: 2, lido: true, erro: false, temDecisao: false, decisao: null, notas: [], mudancas: [], regras: perguntas,
      quadros: { ig: [{ n: 1, arquivo: 'ig-01.jpg', tempo: '0:00.6', file: null }], tt: [] } } };
  estado.sbPendentes = {};
  estado.respostasRegra = { [chaveRespostas('sb', 'S47-01', 2)]: mudar };
  const d = painelDecisaoStoryboard(r, { email: ROBERTTA, agora: AGORA });
  assert.match(d, /Aprovar o storyboard v2/);
  assert.ok(!d.includes('Refazer o storyboard'));
  assert.match(d, /O seu pedido já foi feito neste vídeo\. A resposta sobre a regra vai junto com a aprovação/);
  estado.respostasRegra = {};
  // rascunho: idem
  const rot = { id: 'S47-01', etapa: 'rascunho', versaoRoteiro: 2, versoesRoteiro: [1, 2], temFinal: false, lido: true, fontes: [], fontesConferidas: true, perguntasRegra: perguntas };
  const hr = decisaoDoRascunho(rot, { email: ROBERTTA, escolha: 'aprovar', exec: { execucoes: [] }, agora: AGORA, respostasRegra: { [chaveRespostas('rt', 'S47-01', 2)]: mudar } });
  assert.match(hr, /Aprovar a v2<\/button>/);
  assert.ok(!hr.includes('Refazer o rascunho'));
  assert.match(hr, /O seu pedido já foi feito neste vídeo\./);
  // prévia: a aprovação não leva a resposta; a nota diz como mudar a regra
  assert.match(notaPedidoJaFeito(perguntas, mudar, 'S47-01', { previa: true }),
    /O seu pedido já foi feito nesta prévia\. A aprovação não leva a resposta sobre a regra: para mudar a regra, mande a resposta junto com um ajuste\./);
  assert.match(notaPedidoJaFeito(perguntas, { 'S47-01-R1': 'so_neste' }, 'S47-01', { previa: true }), /“Só neste vídeo” não precisa ir com a aprovação/);
  assert.equal(notaPedidoJaFeito(perguntas, { 'S47-01-R1': 'manter' }, 'S47-01'), '', '"Manter": nada a explicar');
  assert.equal(notaPedidoJaFeito(perguntas, { ...mudar, 'S47-01-R2': 'mudar' }, 'S47-01'), '', 'se vira pedido de mudança, vale o aviso de virar');
  assert.equal(notaPedidoJaFeito(lerPerguntasRegra(SECAO, 'S47-01'), mudar, 'S47-01'), '', 'pergunta comum: nada');
});

test('configuração fixa com chave desconhecida: uma frase simples, sem chave, JSON nem "trava"', () => {
  for (const [regra, novo] of [['efeitos.max_s = 1.0', 'efeitos.max_s = 2'], ['modos.cheia = {"max_s": 5, "max_por_video": 2}', 'modos.cheia sai da trava']]) {
    const r = regraLegivel({ arquivo: 'estilo/travas.json', regra, novo });
    assert.equal(r.literal, false);
    assert.equal(r.onde, 'Configuração fixa do estilo');
    assert.equal(r.texto, 'Uma configuração fixa do estilo não deixa fazer o seu pedido.');
    const visivel = `${r.texto} ${r.novo}`;
    assert.ok(!/efeitos|modos|max_|=|\{|trava/i.test(visivel), visivel);
  }
  assert.equal(regraLegivel({ arquivo: 'estilo/travas.json', regra: 'efeitos.max_s = 1.0', novo: 'efeitos.max_s sai da trava' }).novo, 'Essa configuração deixa de valer.');
  assert.equal(regraLegivel({ arquivo: 'estilo/travas.json', regra: 'efeitos.max_s = 1.0', novo: 'efeitos.max_s = 2' }).novo, 'Essa configuração muda para deixar o seu pedido.');
});

test('plural: um pedido longo não vira "os 1 pedidos"; pedido geral sem lista não vira "0 pedidos"', () => {
  const longo = 'a'.repeat(990);
  const perguntas = [{ rid: 'S47-01-R1', pedido: longo, onde: 'IG, quadro 4', reserva: false }];
  const t1 = textoDoPedidoDasRegras(perguntas, [{ id: 'S47-01-R1', resposta: 'mudar' }]);
  assert.equal(t1, 'Fazer o pedido que esperava a resposta sobre a regra.');
  const dois = [...perguntas, { rid: 'S47-01-R2', pedido: longo, onde: '', reserva: false }];
  assert.equal(textoDoPedidoDasRegras(dois, [{ id: 'S47-01-R1', resposta: 'mudar' }, { id: 'S47-01-R2', resposta: 'so_neste' }]),
    'Fazer os 2 pedidos que esperavam a resposta sobre a regra.');
  const aceita = textoDaDecisaoStoryboardAceita('S47-01', { decisao: 'ajustar', versao: 2, ajustes: [] }, true);
  assert.ok(!/\b0 pedidos/.test(aceita), aceita);
  assert.match(aceita, /^S47-01: pedido de mudança enviado ao motor pela central/);
  assert.match(textoDaDecisaoStoryboardAceita('S47-01', { decisao: 'ajustar', versao: 2, ajustes: [{}] }), /1 pedido de mudança enviado/);
});

test('"Ajustes enviados": o pedido geral aparece mesmo com a lista vazia (ajustes: [] + observações)', () => {
  const soGeral = gerarAjustes({ id: 'S47-01', versaoBase: 2, ajustes: [], observacoes: `Fazer o pedido: ${MAL}`, quem: ROBERTTA });
  const p = pedidosDoTexto(soGeral);
  assert.deepEqual(p.lista, []);
  assert.equal(p.observacoes, `Fazer o pedido: ${MAL}`);
  const h = listaPedidos({ fase: 'pronto', ...p });
  assert.match(h, /<strong>Geral:<\/strong> Fazer o pedido: &lt;img src=x/);
  assert.ok(!h.includes(MAL));
  const comLista = pedidosDoTexto(gerarAjustes({ id: 'S47-01', versaoBase: 2, ajustes: [{ versao: 'ig', tempo: '0:12', pedido: 'tirar o zoom' }], observacoes: 'mais calmo' }));
  const h2 = listaPedidos({ fase: 'pronto', ...comLista });
  assert.match(h2, /tirar o zoom[\s\S]*Geral:<\/strong> mais calmo/);
  assert.equal(listaPedidos({ fase: 'pronto', lista: [], observacoes: '' }), '', 'nada pedido: nada');
  assert.deepEqual(pedidosDoTexto('sem cabeçalho'), { lista: [], observacoes: '' });
  assert.equal(parseAjustes(soGeral).ajustes.length, 0);
});

test('"Mudar a regra" com "Recusar": a descrição não promete o pedido', () => {
  assert.equal(efeitoDaResposta('mudar', { decisao: 'recusar' }), 'A regra muda (para os próximos vídeos também). Com o rascunho recusado, o seu pedido não é feito.');
  assert.equal(efeitoDaResposta('so_neste', { decisao: 'recusar' }), 'A regra continua como está. Com o rascunho recusado, o seu pedido não é feito.');
  assert.equal(efeitoDaResposta('manter', { decisao: 'recusar' }), 'A regra continua como está.');
  assert.equal(efeitoDaResposta('mudar'), 'A regra muda (para os próximos vídeos também) e o motor faz o seu pedido.', 'fora do recusar, como antes');
  assert.equal(efeitoDaResposta('nada'), '');
  const perguntas = lerPerguntasRegra(SECAO, 'S47-01');
  const rot = { id: 'S47-01', etapa: 'rascunho', versaoRoteiro: 2, versoesRoteiro: [1, 2], temFinal: false, lido: true, fontes: [], fontesConferidas: true, perguntasRegra: perguntas };
  const respostasRegra = { [chaveRespostas('rt', 'S47-01', 2)]: { 'S47-01-R2': 'mudar' } };
  const recusar = decisaoDoRascunho(rot, { email: ROBERTTA, escolha: 'recusar', exec: { execucoes: [] }, agora: AGORA, respostasRegra });
  assert.match(recusar, /Com o rascunho recusado, o seu pedido não é feito\./);
  assert.ok(!recusar.includes('o motor faz o seu pedido'), 'nada de prometer o pedido');
  const aprovar = decisaoDoRascunho(rot, { email: ROBERTTA, escolha: 'mudar', exec: { execucoes: [] }, agora: AGORA, respostasRegra });
  assert.match(aprovar, /e o motor faz o seu pedido\./, 'pedindo mudança, a promessa vale');
});
