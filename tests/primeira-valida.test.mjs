// Revisão final de 16/11/2026: na escolha do gancho e na decisão do storyboard vale a PRIMEIRA decisão VÁLIDA de cada
// versão, no motor e no app (um arquivo inválido antes não bloqueia uma decisão válida depois); e a decisão enviada e
// ainda não vista no Drive não volta a pedir decisão depois de uma recarga (registro no aparelho e conferência na
// central antes de outro envio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED } from '../js/config.js';
import { montarProjetos, escolhaDosUltimosGanchos, decisaoDoUltimoStoryboard } from '../js/model.js';
import { primeiraValida, propostaDeGanchos, storyboardDe } from '../js/dados.js';
import { escolhaValida, quemDecide, estadoDosGanchos, lerGanchos } from '../js/ganchos.js';
import { decisaoValida, lerDecisaoStoryboard, textoDecisaoStoryboard, estadoDoStoryboard } from '../js/storyboard.js';
import { lerEscolhaGancho, textoEscolhaGancho } from '../js/pedidos-motor.js';
import { lerEnviados, guardarEnviado, CHAVE_ENVIADOS, VALIDADE_ENVIADOS_MS } from '../js/enviados.js';
import { chaveParaApagar } from '../js/auth.js';
import { criarCentral, CHAVE_SESSAO, arquivoDoPedido } from '../js/central.js';

const ROBERTTA = ALLOWED[0];
const GABRIEL = ALLOWED[1];
const AGORA = new Date('2026-11-18T13:30:00.000Z');
const arq = (name, criado = '2026-11-18T12:00:00.000Z', extra = {}) => ({ id: `id-${name}-${criado}`, name, createdTime: criado, modifiedTime: criado, ...extra });
const GANCHOS = `---\nid: S47-01\nversao: 1\ntitulo: Domingo\n---\n\n## Gancho 1\nfala: Um\ntela: um\npor que: a\n\n## Gancho 2\nfala: Dois\ntela: dois\npor que: b\n`;

function armazenamento() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, mapa: m,
  };
}

/* ------------------------------------------------------------ quem decide e o que vale sozinho */

test('quemDecide: o e-mail de quem decide; test só em id T; chat, quem vê e vazio não', () => {
  assert.equal(quemDecide(ROBERTTA, 'S47-01'), true);
  assert.equal(quemDecide(ROBERTTA.toUpperCase(), 'S47-01'), true);
  assert.equal(quemDecide('test', 'T05-01'), true);
  assert.equal(quemDecide('test', 'S47-01'), false);
  for (const q of ['chat', GABRIEL, '', null]) assert.equal(quemDecide(q, 'S47-01'), false, String(q));
});

test('escolhaValida: os critérios do motor (id e versão do nome, escolha da lista, quem, gancho que existe)', () => {
  const opcoes = lerGanchos(GANCHOS).opcoes;
  const base = { id: 'S47-01', versao: 1, escolha: '2', observacoes: '', quem: ROBERTTA };
  const ctx = { id: 'S47-01', versao: 1, opcoes };
  assert.equal(escolhaValida(base, ctx), true);
  assert.equal(escolhaValida(lerEscolhaGancho(textoEscolhaGancho({ ...base, quem: ROBERTTA })), ctx), true, 'a que o app grava vale');
  assert.equal(escolhaValida({ ...base, id: '' }, ctx), true, 'id vazio: vale o do nome, como no motor');
  assert.equal(escolhaValida({ ...base, id: 'S47-02' }, ctx), false);
  assert.equal(escolhaValida({ ...base, versao: 2 }, ctx), false);
  assert.equal(escolhaValida({ ...base, escolha: '' }, ctx), false);
  assert.equal(escolhaValida({ ...base, quem: 'chat' }, ctx), false);
  assert.equal(escolhaValida({ ...base, escolha: '3' }, ctx), false, 'o gancho 3 não está nos ganchos v1');
  assert.equal(escolhaValida({ ...base, escolha: 'outros' }, ctx), true);
  assert.equal(escolhaValida({ ...base, escolha: '3' }, { id: 'S47-01', versao: 1 }), true, 'sem as opções lidas, não dá para barrar o número');
  assert.equal(escolhaValida(null, ctx), false);
});

test('decisaoValida: os critérios do motor; lerDecisaoStoryboard passa a ler quem', () => {
  const texto = textoDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'aprovar', quem: ROBERTTA });
  const lida = lerDecisaoStoryboard(texto);
  assert.equal(lida.quem, ROBERTTA);
  const ctx = { id: 'S47-01', versao: 2 };
  assert.equal(decisaoValida(lida, ctx), true);
  assert.equal(decisaoValida({ ...lida, quem: 'chat' }, ctx), false);
  assert.equal(decisaoValida({ ...lida, id: 'S47-09' }, ctx), false);
  assert.equal(decisaoValida({ ...lida, versao: 1 }, ctx), false);
  assert.equal(decisaoValida({ ...lida, decisao: '' }, ctx), false);
  assert.equal(decisaoValida({ ...lida, decisao: 'ajustar', ajustes: [], observacoes: '' }, ctx), false, 'ajustar sem pedido');
  assert.equal(decisaoValida({ ...lida, decisao: 'ajustar', ajustes: [], observacoes: 'menos texto' }, ctx), true);
  assert.equal(decisaoValida({ ...lida, quem: 'test' }, { id: 'T05-01', versao: 2 }), false, 'id do conteúdo difere do nome');
  assert.equal(decisaoValida({ ...lida, id: 'T05-01', quem: 'test' }, { id: 'T05-01', versao: 2 }), true);
});

/* ------------------------------------------------------------ todos os arquivos da versão, do mais velho */

test('model: todas as escolhas e decisões de cada versão, do mais velho para o mais novo (pasta duplicada)', () => {
  const velho = arq('S47-01 gancho v1.md', '2026-11-18T10:00:00.000Z');
  const novo = arq('S47-01 gancho v1.md', '2026-11-18T11:00:00.000Z');
  const p = montarProjetos({ rascunhos: [arq('S47-01 ganchos v1.md'), novo, velho] }).get('S47-01');
  const e = escolhaDosUltimosGanchos(p);
  assert.equal(e.v, 1);
  assert.deepEqual(e.arquivos.map((f) => f.createdTime), [velho.createdTime, novo.createdTime]);
  assert.equal(e.file, velho, 'o file é o mais velho (a primeira)');
  const d1 = arq('S47-01 decisao storyboard v1.md', '2026-11-18T12:30:00.000Z');
  const d0 = arq('S47-01 decisao storyboard v1.md', '2026-11-18T12:10:00.000Z');
  const q = montarProjetos({ revisao: [arq('S47-01 storyboard v1.md'), d1, d0] }).get('S47-01');
  assert.deepEqual(decisaoDoUltimoStoryboard(q).arquivos, [d0, d1]);
});

test('primeiraValida: pula as inválidas; uma que não leu antes da válida deixa incerto; nenhuma válida: null', async () => {
  const fs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const conteudo = { a: { ok: false }, b: { ok: true }, c: { ok: true } };
  let r = await primeiraValida(fs, async (f) => conteudo[f.id], (l) => l.ok);
  assert.equal(r.file.id, 'b', 'a primeira inválida não bloqueia a válida depois');
  r = await primeiraValida(fs, async (f) => { if (f.id === 'a') throw new Error('rede'); return conteudo[f.id]; }, (l) => l.ok);
  assert.deepEqual([r.incerto, r.file.id], [true, 'a'], 'sem ler a primeira, não dá para saber qual vale');
  r = await primeiraValida(fs, async () => ({ ok: false }), (l) => l.ok);
  assert.equal(r, null);
  assert.equal(await primeiraValida([], async () => ({}), () => true), null);
});

test('propostaDeGanchos: a escolha em vigor é a primeira válida; sem válida, a vez volta a ser dela', () => {
  const p = montarProjetos({ rascunhos: [arq('S47-01 ganchos v1.md'), arq('S47-01 gancho v1.md', '2026-11-18T10:00:00.000Z')] }).get('S47-01');
  const ganchos = lerGanchos(GANCHOS);
  const valida = { escolha: '2', observacoes: '', quem: ROBERTTA };
  let g = propostaDeGanchos(p, { ganchos, escolha: valida, escolhaArq: p.escolhasGancho[0].file, erro: false });
  assert.deepEqual([g.temEscolha, g.escolha.escolha, g.escolhaEm], [true, '2', '2026-11-18T10:00:00.000Z']);
  g = propostaDeGanchos(p, { ganchos, escolha: null, escolhaArq: null, escolhaIncerta: false, erro: false });
  assert.equal(g.temEscolha, false, 'nenhuma válida: nada em vigor');
  assert.equal(estadoDosGanchos({ propostaGanchos: g }, { agora: AGORA }).estado, 'escolher');
  g = propostaDeGanchos(p, { ganchos, escolha: null, escolhaArq: null, escolhaIncerta: true, erro: false });
  assert.equal(g.temEscolha, true, 'um arquivo antes não leu: bloqueia, como antes');
  assert.equal(propostaDeGanchos(p, null).temEscolha, true, 'não baixado: o arquivo existe, bloqueia');
  assert.equal(propostaDeGanchos(p, { ganchos: null, erro: true }).temEscolha, true);
});

test('storyboardDe: a decisão em vigor é a primeira válida; sem válida, a vez volta a ser dela', () => {
  const p = montarProjetos({ revisao: [arq('S47-01 storyboard v1.md'), arq('S47-01 decisao storyboard v1.md')] }).get('S47-01');
  const md = { redes: ['ig'], notas: [], mudancas: [], quadros: { ig: [{ n: 1, arquivo: 'ig-01.jpg', tempo: '0:01.0' }], tt: [] } };
  let s = storyboardDe(p, { md, arquivos: [], decisao: null, decisaoArq: null, decisaoIncerta: false, erro: false });
  assert.equal(s.temDecisao, false);
  assert.equal(estadoDoStoryboard({ storyboard: s }, { agora: AGORA }).estado, 'decidir');
  s = storyboardDe(p, { md, arquivos: [], decisao: { decisao: 'ajustar', ajustes: [], observacoes: 'x' }, decisaoArq: p.decisoesStoryboard[0].file, erro: false });
  assert.deepEqual([s.temDecisao, s.decisao.decisao], [true, 'ajustar']);
  s = storyboardDe(p, { md, arquivos: [], decisao: null, decisaoArq: null, decisaoIncerta: true, erro: false });
  assert.equal(s.temDecisao, true);
  assert.equal(storyboardDe(p, null).temDecisao, true);
});

/* ------------------------------------------------------------ registro no aparelho (D/I1) */

test('enviados: guarda no aparelho, preso à conta e por 2 h; o Sair apaga (chave motor.*)', () => {
  const st = armazenamento();
  const t = Date.parse('2026-11-18T13:00:00.000Z');
  assert.equal(guardarEnviado(st, ROBERTTA, 'ganchos', 'S47-01', { versao: 1, escolha: '2', desde: t }, t), true);
  guardarEnviado(st, ROBERTTA, 'storyboards', 'S47-02', { versao: 3, decisao: 'aprovar', desde: t }, t);
  let r = lerEnviados(st, ROBERTTA.toUpperCase(), t + 60 * 1000);
  assert.deepEqual(r.ganchos['S47-01'], { versao: 1, escolha: '2', desde: t });
  assert.equal(r.storyboards['S47-02'].decisao, 'aprovar');
  assert.deepEqual(lerEnviados(st, GABRIEL, t), { ganchos: {}, storyboards: {} }, 'outra conta não vê');
  r = lerEnviados(st, ROBERTTA, t + VALIDADE_ENVIADOS_MS + 1);
  assert.deepEqual(r, { ganchos: {}, storyboards: {} }, 'depois de 2 h, não vale mais');
  guardarEnviado(st, ROBERTTA, 'ganchos', 'S47-03', { versao: 1, escolha: '1', desde: t + VALIDADE_ENVIADOS_MS + 5 }, t + VALIDADE_ENVIADOS_MS + 5);
  assert.deepEqual(Object.keys(JSON.parse(st.getItem(CHAVE_ENVIADOS)).ganchos), ['S47-03'], 'os vencidos saem ao gravar');
  assert.equal(chaveParaApagar(CHAVE_ENVIADOS), true);
  st.setItem(CHAVE_ENVIADOS, '{quebrado');
  assert.deepEqual(lerEnviados(st, ROBERTTA, t), { ganchos: {}, storyboards: {} });
  const ruim = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('cheio'); } };
  assert.deepEqual(lerEnviados(ruim, ROBERTTA, t), { ganchos: {}, storyboards: {} });
  assert.equal(guardarEnviado(ruim, ROBERTTA, 'ganchos', 'S47-01', { desde: t }, t), false, 'modo privado: só na memória');
  assert.equal(guardarEnviado(st, ROBERTTA, 'outro', 'S47-01', { desde: t }, t), false);
  assert.equal(guardarEnviado(st, '', 'ganchos', 'S47-01', { desde: t }, t), false);
});

test('o registro do aparelho mantém a tela em "escolhido" depois de recarregar (antes os botões voltavam)', () => {
  const st = armazenamento();
  const t = AGORA.getTime() - 10 * 60 * 1000;
  guardarEnviado(st, ROBERTTA, 'ganchos', 'S47-01', { versao: 1, escolha: '2', desde: t }, t);
  const local = lerEnviados(st, ROBERTTA, AGORA.getTime()).ganchos['S47-01'];
  const r = { propostaGanchos: { versao: 1, lido: true, opcoes: lerGanchos(GANCHOS).opcoes, temEscolha: false } };
  assert.equal(estadoDosGanchos(r, { agora: AGORA }).estado, 'escolher', 'só a memória (vazia depois de recarregar)');
  const st2 = estadoDosGanchos(r, { local, agora: AGORA });
  assert.deepEqual([st2.estado, st2.bloqueia], ['escolhido', true]);
});

/* ------------------------------------------------------------ central: já há pedido deste arquivo? */

test('central.pedidoRecente: pedido novo ou entregue do arquivo, desde a data dada (só leitura)', async () => {
  const st = armazenamento();
  st.setItem(CHAVE_SESSAO, JSON.stringify({ access_token: 'A1', refresh_token: 'R', email: ROBERTTA, expira: 9e15 }));
  const chamadas = [];
  let resposta = [{ id: 'p1' }];
  const fetch = async (url, op) => {
    chamadas.push({ metodo: op.method, url: new URL(url) });
    return { ok: true, status: 200, text: async () => JSON.stringify(resposta) };
  };
  const c = criarCentral({ url: 'https://x', chave: 'k', fetch, storage: st, agora: () => 0 });
  const arquivo = arquivoDoPedido('decisao_storyboard', 'S47-01 decisao storyboard v2.md');
  assert.equal(await c.pedidoRecente(arquivo, '2026-11-18T12:00:00.000Z'), true);
  const u = chamadas[0].url;
  assert.equal(chamadas[0].metodo, 'GET');
  assert.equal(u.pathname, '/rest/v1/pedidos');
  assert.equal(u.searchParams.get('arquivo'), `eq.${arquivo}`);
  assert.equal(u.searchParams.get('status'), 'in.(novo,entregue)');
  assert.equal(u.searchParams.get('criado_em'), 'gte.2026-11-18T12:00:00.000Z');
  resposta = [];
  assert.equal(await c.pedidoRecente(arquivo, null), false);
  assert.equal(chamadas[1].url.searchParams.get('criado_em'), null, 'sem data: qualquer pedido do arquivo');
});
