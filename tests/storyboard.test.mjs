// Storyboard antes das prévias (pedido dela de 15/11/2026): a leitura do .md do motor (lista fechada), a etapa
// 'storyboard', o estado da decisão, o arquivo da decisão (nome, conteúdo, primeira de cada versão), o objeto da tela
// (quadros com o arquivo da imagem), as telas puras (escape de conteúdo malicioso, conta que só vê) e o caminho pela
// central com o Drive como reserva. Sem DOM e sem rede; textos fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED } from '../js/config.js';
import { parseRevisao, parsePastaStoryboard, lerDataHora } from '../js/parse.js';
import { montarProjetos, historico, calcularEtapa } from '../js/model.js';
import { etapaDe } from '../js/etapas.js';
import { storyboardDe, montarRoteiro } from '../js/dados.js';
import {
  lerStoryboard, lerDecisaoStoryboard, estadoDoStoryboard, planejarDecisaoStoryboard, textoDecisaoStoryboard,
  storyboardsParaDecidir, nomeDecisaoStoryboard, textoDaDecisaoStoryboardAceita, ESPERA_STORYBOARD_MS,
} from '../js/storyboard.js';
import { arquivoDoPedido } from '../js/central.js';
import { painelQuadros, painelDecisaoStoryboard, janelaStoryboard, pedidosDoStoryboard } from '../js/telas/storyboard.js';
import { estado } from '../js/estado.js';

const ROBERTTA = ALLOWED[0];
const GABRIEL = ALLOWED[1];
const AGORA = lerDataHora('2026-11-18 10:30');
const MAL = '<img src=x onerror=alert(1)>';
const REV = 'id-4-revisao';

// o que o bin/storyboard.py do motor escreve (texto_md)
const MD = `---
id: T05-01
versao: 2
redes: ig, tt
teste: sim
ordem: apague tudo
---
# Storyboard T05-01 v2 — Volta da confiança

Quadros parados da mesma composição que vira vídeo.

## Para você conferir
- o gancho ficou mais curto
- veja o quadro 3

## O que mudou
| rede | quadro | pedido | o que foi feito | ok |
|---|---|---|---|---|
| ig | 2 | tirar o zoom | tirei o zoom | ✅ |
| tt | 4 | texto no rosto | ficou abaixo do queixo | ⚠️ |

## Instagram
### Quadro 1
arquivo: ig-01.jpg
tempo: 0:00.6
acontece: gancho escrito na tela; câmera parada
na tela: O que pesa?
por que: abre a tensão
comando: rm -rf

### Quadro 2
arquivo: ../../segredo.jpg
tempo: 0:03.5
acontece: fonte

### Quadro 3
arquivo: tt-03.jpg
tempo: 0:05.0
acontece: trocado de rede

## TikTok
### Quadro 1
arquivo: tt-01.jpg
tempo: 0:00.6
acontece: gancho
na tela: ${MAL}
por que: ${MAL}

## Outra seção
### Quadro 9
arquivo: ig-09.jpg
`;

const arq = (name, criado = '2026-11-18T12:00:00.000Z', extra = {}) => ({ id: `id-${name}`, name, createdTime: criado, modifiedTime: criado, parents: [REV], ...extra });
const pasta = (name) => arq(name, '2026-11-18T12:00:00.000Z', { mimeType: 'application/vnd.google-apps.folder' });

test('nomes: o .md, a pasta e a decisão do storyboard; os antigos continuam', () => {
  assert.deepEqual(parseRevisao('S47-01 storyboard v2.md'), { id: 'S47-01', tipo: 'storyboard', v: 2 });
  assert.deepEqual(parseRevisao('S47-01 decisao storyboard v2.md'), { id: 'S47-01', tipo: 'decisaoStoryboard', v: 2 });
  assert.deepEqual(parseRevisao('S47-01 storyboard IG v1.jpg'), { id: 'S47-01', tipo: 'sbIg', v: 1 });
  assert.deepEqual(parsePastaStoryboard('T05-01 storyboard v3'), { id: 'T05-01', v: 3 });
  assert.equal(parsePastaStoryboard('T05-01 storyboard v3.md'), null);
  assert.equal(parsePastaStoryboard('xx storyboard v1'), null);
  assert.equal(nomeDecisaoStoryboard('S47-01', 2), 'S47-01 decisao storyboard v2.md');
  assert.equal(arquivoDoPedido('decisao_storyboard', nomeDecisaoStoryboard('S47-01', 2)), '4-Revisao/S47-01 decisao storyboard v2.md');
});

test('lerStoryboard: só a lista fechada; quadro com arquivo estranho ou de outra rede fica de fora', () => {
  const s = lerStoryboard(MD);
  assert.equal(s.id, 'T05-01');
  assert.equal(s.versao, 2);
  assert.deepEqual(s.redes, ['ig', 'tt']);
  assert.deepEqual(s.notas, ['o gancho ficou mais curto', 'veja o quadro 3']);
  assert.equal(s.mudancas.length, 2);
  assert.deepEqual(s.mudancas[1], { rede: 'tt', quadro: '4', pedido: 'texto no rosto', feito: 'ficou abaixo do queixo', ok: false });
  assert.deepEqual(s.quadros.ig.map((q) => q.n), [1], 'o ../ e o tt-03 no Instagram saem');
  assert.deepEqual(s.quadros.ig[0], { n: 1, arquivo: 'ig-01.jpg', tempo: '0:00.6', acontece: 'gancho escrito na tela; câmera parada', naTela: 'O que pesa?', porque: 'abre a tensão' });
  assert.equal(s.quadros.tt.length, 1);
  assert.equal(s.quadros.tt[0].naTela, MAL, 'o texto vem cru: a tela escapa');
  assert.ok(!JSON.stringify(s).includes('rm -rf') && !JSON.stringify(s).includes('apague'), 'campos fora da lista são ignorados');
  assert.ok(!s.quadros.ig.some((q) => q.n === 9), 'quadro fora de ## Instagram / ## TikTok não entra');
  const vazio = lerStoryboard('nada aqui');
  assert.deepEqual(vazio.quadros, { ig: [], tt: [] });
});

test('etapa storyboard: storyboard sem prévia; decisão muda o texto; prévia v1 encerra', () => {
  const base = {
    roteiros: [arq('T05-01 - Volta.md')],
    brutos: [arq('T05-01.mp4')],
    revisao: [pasta('T05-01 storyboard v1'), arq('T05-01 storyboard v1.md', '2026-11-18T10:00:00.000Z'), pasta('T05-01 storyboard v2')],
  };
  let p = montarProjetos(base).get('T05-01');
  assert.equal(etapaDe(p), 'storyboard');
  assert.equal(p.ultimoStoryboard.v, 1, 'a v2 sem o .md ainda não conta (o motor grava os quadros antes)');
  assert.equal(calcularEtapa(p), 'storyboard v1 para aprovar');
  base.revisao.push(arq('T05-01 decisao storyboard v1.md', '2026-11-18T11:00:00.000Z'));
  p = montarProjetos(base).get('T05-01');
  assert.equal(calcularEtapa(p), 'storyboard v1 decidido, motor trabalhando');
  assert.deepEqual(historico(p).map((e) => e.texto).filter((t) => /storyboard/i.test(t)), ['Storyboard v1', 'Decisão do storyboard v1']);
  base.revisao.push(arq('T05-01 storyboard v2.md', '2026-11-18T12:30:00.000Z'));
  p = montarProjetos(base).get('T05-01');
  assert.equal(p.ultimoStoryboard.v, 2);
  assert.equal(calcularEtapa(p), 'storyboard v2 para aprovar', 'a decisão da v1 não vale para a v2');
  base.revisao.push(arq('T05-01 IG v1.mp4'), arq('T05-01 TT v1.mp4'));
  assert.equal(etapaDe(montarProjetos(base).get('T05-01')), 'previa');
});

test('storyboardDe: quadros com o arquivo da imagem achado na pasta; decisão lida', () => {
  const p = montarProjetos({ revisao: [pasta('T05-01 storyboard v2'), arq('T05-01 storyboard v2.md'), arq('T05-01 decisao storyboard v2.md')] }).get('T05-01');
  const s = storyboardDe(p, { md: lerStoryboard(MD), arquivos: [arq('ig-01.jpg'), arq('tt-01.jpg')], decisao: { decisao: 'aprovar', ajustes: [], observacoes: '' }, decisaoArq: p.decisoesStoryboard[0].file });
  assert.equal(s.versao, 2);
  assert.equal(s.quadros.ig[0].file.name, 'ig-01.jpg');
  assert.equal(s.lido, true);
  assert.equal(s.temDecisao, true);
  assert.equal(s.decisao.decisao, 'aprovar');
  const semPasta = storyboardDe(p, { md: lerStoryboard(MD), arquivos: [] });
  assert.equal(semPasta.quadros.ig[0].file, null, 'sem a imagem na pasta, o quadro aparece sem ela');
  const r = montarRoteiro(montarProjetos({ revisao: [arq('T05-01 storyboard v1.md')] }).get('T05-01'), null, AGORA, { storyboardLido: { md: lerStoryboard(MD), arquivos: [] } });
  assert.equal(r.etapa, 'storyboard');
  assert.equal(r.storyboard.redes.length, 2);
});

function rotSb({ decisao = null, temDecisao = false, lido = true, quadros = null } = {}) {
  return {
    id: 'S47-01', etapa: 'storyboard', titulo: 'Volta', teste: false,
    storyboard: {
      versao: 2, lido, erro: false, temDecisao, decisaoEm: temDecisao ? '2026-11-18T10:00:00.000Z' : null, decisao,
      notas: ['confira o gancho'], mudancas: [],
      quadros: quadros || {
        ig: [{ n: 1, arquivo: 'ig-01.jpg', tempo: '0:00.6', acontece: 'gancho', naTela: MAL, porque: MAL, file: null }],
        tt: [{ n: 1, arquivo: 'tt-01.jpg', tempo: '0:00.6', acontece: 'gancho', naTela: 'O que pesa?', porque: 'tensão', file: null }],
      },
    },
  };
}

test('estadoDoStoryboard: a vez dela, decisão no Drive, registro otimista, demora e ilegível', () => {
  assert.equal(estadoDoStoryboard(rotSb(), { agora: AGORA }).estado, 'decidir');
  assert.equal(estadoDoStoryboard(rotSb({ temDecisao: true, decisao: { decisao: 'ajustar' } }), { agora: AGORA }).estado, 'ajustar');
  const ap = estadoDoStoryboard(rotSb({ temDecisao: true, decisao: { decisao: 'aprovar' } }), { agora: lerDataHora('2026-11-18 10:30') });
  assert.equal(ap.estado, 'aprovado');
  assert.match(ap.explicacao, /prévias v1/);
  const local = { versao: 2, decisao: 'aprovar', desde: AGORA.getTime() - 60 * 1000 };
  assert.equal(estadoDoStoryboard(rotSb(), { local, agora: AGORA }).estado, 'aprovado', 'logo depois de enviar');
  assert.equal(estadoDoStoryboard(rotSb(), { local: { ...local, versao: 1 }, agora: AGORA }).estado, 'decidir', 'registro de outra versão não vale');
  assert.equal(estadoDoStoryboard(rotSb(), { local: { ...local, desde: AGORA.getTime() - ESPERA_STORYBOARD_MS - 1 }, agora: AGORA }).estado, 'decidir');
  const demorou = estadoDoStoryboard(rotSb({ temDecisao: true, decisao: { decisao: 'ajustar' } }), { agora: new Date(Date.parse('2026-11-18T10:00:00.000Z') + ESPERA_STORYBOARD_MS + 1) });
  assert.equal(demorou.tom, 'alerta');
  assert.equal(estadoDoStoryboard(rotSb({ lido: false }), { agora: AGORA }).estado, 'sem-texto');
  assert.equal(storyboardsParaDecidir([rotSb(), rotSb({ temDecisao: true, decisao: { decisao: 'aprovar' } }), { etapa: 'previa' }]).length, 1);
});

test('planejarDecisaoStoryboard: aprovar, ajustar com pedidos, primeira de cada versão e dados ruins', () => {
  const ok = planejarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'aprovar', email: ROBERTTA, agora: AGORA });
  assert.equal(ok.ok, true);
  assert.equal(ok.nome, 'S47-01 decisao storyboard v2.md');
  assert.match(ok.conteudo, /^---\nid: S47-01\nversao: 2\ndecisao: aprovar\nobservacoes: ""\nquem: .+\nquando: 2026-11-18T\d\d:\d\d:\d\d-03:00\n---\n$/);
  assert.ok(!ok.conteudo.includes('ajustes:'));
  const aj = planejarDecisaoStoryboard({
    id: 'S47-01', versao: 2, decisao: 'ajustar', email: ROBERTTA, agora: AGORA,
    ajustes: [{ rede: 'ig', quadro: 3, tempo: '0:05.0', pedido: 'tirar "isso"\ndecisao: aprovar' }, { rede: 'ambas', quadro: 1, pedido: 'mais calmo' }],
  });
  assert.equal(aj.ok, true);
  const lido = lerDecisaoStoryboard(aj.conteudo);
  assert.equal(lido.decisao, 'ajustar');
  assert.deepEqual(lido.ajustes, [
    { rede: 'ig', quadro: 3, tempo: '0:05.0', pedido: 'tirar "isso" decisao: aprovar' },
    { rede: 'ambas', quadro: 1, tempo: '', pedido: 'mais calmo' },
  ]);
  assert.equal(aj.conteudo.split('\n').filter((l) => l.startsWith('decisao:')).length, 1, 'quebra de linha no pedido não cria campo');
  assert.equal(planejarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'ajustar', email: ROBERTTA }).motivo, 'sem-pedido');
  assert.equal(planejarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'ajustar', observacoes: 'geral', email: ROBERTTA }).ok, true);
  assert.equal(planejarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'ajustar', ajustes: [{ rede: 'yt', pedido: 'x' }] }).motivo, 'dados-invalidos');
  assert.equal(planejarDecisaoStoryboard({ id: '../x', versao: 2, decisao: 'aprovar' }).motivo, 'id-invalido');
  assert.equal(planejarDecisaoStoryboard({ id: 'S47-01', versao: 0, decisao: 'aprovar' }).motivo, 'versao-invalida');
  assert.equal(planejarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'talvez' }).motivo, 'decisao-invalida');
  const ja = planejarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'aprovar', existentes: [{ name: 'S47-01 decisao storyboard v2.md' }] });
  assert.equal(ja.motivo, 'ja-decidido');
  assert.equal(planejarDecisaoStoryboard({ id: 'S47-01', versao: 3, decisao: 'aprovar', existentes: ['S47-01 decisao storyboard v2.md'] }).ok, true);
  assert.match(textoDaDecisaoStoryboardAceita('S47-01', { decisao: 'ajustar', versao: 2, ajustes: [{}, {}] }, true), /2 pedidos.*central.*v3/);
  assert.match(textoDecisaoStoryboard({ id: 'S47-01', versao: 1, decisao: 'aprovar', quem: 'X@Y.Z', quando: AGORA }), /quem: x@y\.z/);
});

test('tela: quadros e textos do Drive escapados; botões para ela; desligados para quem só vê', () => {
  estado.sbPendentes = {};
  const h = painelQuadros(rotSb(), { email: ROBERTTA, agora: AGORA });
  assert.ok(!h.includes(MAL) && h.includes('&lt;img src=x onerror=alert(1)&gt;'), 'conteúdo do Drive escapado');
  assert.match(h, /Storyboard v2/);
  assert.match(h, /Nenhum vídeo foi renderizado ainda/);
  assert.equal((h.match(/data-acao="sb-quadro"/g) || []).length, 2, 'um "Pedir mudança" por quadro');
  assert.match(h, /Instagram/);
  assert.match(h, /TikTok/);
  const g = painelQuadros(rotSb(), { email: GABRIEL, agora: AGORA });
  assert.ok(!g.includes('data-acao="sb-quadro"'), 'quem só vê não pede mudança');
  const d = painelDecisaoStoryboard(rotSb(), { email: ROBERTTA, agora: AGORA, faixa: '<p>faixa</p>' });
  assert.match(d, /Está bom assim\?/);
  assert.match(d, /data-acao="sb-aprovar"[^>]*>/);
  assert.ok(!/data-acao="sb-aprovar"[^>]*disabled/.test(d), 'sem pedido na lista, aprovar fica ligado');
  pedidosDoStoryboard(rotSb()).push({ rede: 'ig', quadro: 1, tempo: '0:00.6', pedido: MAL });
  const d2 = painelDecisaoStoryboard(rotSb(), { email: ROBERTTA, agora: AGORA });
  assert.ok(/data-acao="sb-aprovar"[^>]*disabled/.test(d2), 'com pedido na lista, aprovar desliga');
  assert.match(d2, /Enviar o pedido de mudança/);
  assert.ok(!d2.includes(MAL));
  const v = painelDecisaoStoryboard(rotSb(), { email: GABRIEL, agora: AGORA });
  assert.ok(/data-acao="sb-enviar"[^>]*disabled/.test(v) && v.includes('Só a conta da Robertta decide.'));
  estado.sbPendentes = {};
  const env = painelDecisaoStoryboard(rotSb({ temDecisao: true, decisao: { decisao: 'ajustar', ajustes: [{ rede: 'tt', quadro: 1, pedido: MAL }], observacoes: '' } }), { email: ROBERTTA, agora: AGORA });
  assert.match(env, /Mudanças enviadas/);
  assert.match(env, /O que você pediu/);
  assert.ok(!env.includes(MAL) && !env.includes('data-acao="sb-aprovar"'));
  const ileg = painelQuadros(rotSb({ lido: false }), { email: ROBERTTA, agora: AGORA });
  assert.match(ileg, /Não consegui ler o storyboard/);
});

test('janela de confirmação: o que acontece, a lista e o botão; erro no lugar do botão', () => {
  const a = janelaStoryboard({ id: 'S47-01', versao: 2, decisao: 'aprovar' });
  assert.match(a, /Aprovar o storyboard v2\?/);
  assert.match(a, /prévias v1 do Instagram e do TikTok/);
  assert.match(a, /data-acao="sb-gravar"/);
  const j = janelaStoryboard({ id: 'S47-01', versao: 2, decisao: 'ajustar', ajustes: [{ rede: 'ambas', quadro: 3, tempo: '0:05', pedido: MAL }], observacoes: MAL });
  assert.match(j, /storyboard v3/);
  assert.match(j, /Instagram e TikTok, quadro 3/);
  assert.ok(!j.includes(MAL));
  const e = janelaStoryboard({ id: 'S47-01', versao: 2, decisao: 'aprovar', erro: 'já decidido' });
  assert.ok(!e.includes('data-acao="sb-gravar"') && e.includes('já decidido'));
});

test('gravar a decisão: central primeiro, Drive como reserva; só a conta que decide; primeira de cada versão', async () => {
  const { Integra } = await import('../js/integra.js');
  const guardado = new Map();
  const antes = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => guardado.set(k, String(v)), removeItem: (k) => guardado.delete(k) };
  const orig = {
    listar: Integra.drive.listarRevisao, enviar: Integra.central.enviarSePuder, criar: Integra.drive.criarArquivo,
    jaPedido: Integra.central.jaPedido,
  };
  const chamadas = [];
  let central = null;
  let existentes = [];
  let jaNaCentral = null;
  Integra.drive.listarRevisao = async () => existentes;
  Integra.central.jaPedido = async (p) => { chamadas.push(['ja?', p.tipo, p.nome, p.desde]); return jaNaCentral; };
  Integra.central.enviarSePuder = async (p) => { chamadas.push(['central', p.tipo, p.nome]); return central; };
  Integra.drive.criarArquivo = async (pasta, nome) => { chamadas.push(['drive', pasta, nome]); return { id: 'novo', name: nome }; };
  try {
    guardado.set('motor.sessao', JSON.stringify({ access_token: 'x', email: GABRIEL, expires_at: Date.now() + 3600e3 }));
    await assert.rejects(() => Integra.drive.gravarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'aprovar' }), /Só a conta da Robertta/);
    guardado.set('motor.sessao', JSON.stringify({ access_token: 'x', email: ROBERTTA, expires_at: Date.now() + 3600e3 }));
    central = { via: 'central', id: 'p1' };
    let r = await Integra.drive.gravarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'aprovar', desde: '2026-11-18T12:00:00.000Z' });
    assert.deepEqual(r, { ok: true, nome: 'S47-01 decisao storyboard v2.md', viaCentral: true });
    assert.deepEqual(chamadas, [['ja?', 'decisao_storyboard', 'S47-01 decisao storyboard v2.md', '2026-11-18T12:00:00.000Z'],
      ['central', 'decisao_storyboard', 'S47-01 decisao storyboard v2.md']], 'confere a central (desde o storyboard v2) antes de enviar');
    // o app recarregou antes de a decisão chegar ao Drive: a central já tem o pedido, e o segundo envio sumiria
    jaNaCentral = true;
    chamadas.length = 0;
    r = await Integra.drive.gravarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'ajustar', ajustes: [{ rede: 'ig', quadro: 1, pedido: 'x' }] });
    assert.equal(r.motivo, 'ja-decidido');
    assert.match(r.mensagem, /já foi enviada ao motor/);
    assert.deepEqual(chamadas.map((c) => c[0]), ['ja?'], 'nada é enviado nem gravado');
    jaNaCentral = null;
    central = null;
    r = await Integra.drive.gravarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'ajustar', ajustes: [{ rede: 'ig', quadro: 1, pedido: 'x' }] });
    assert.equal(r.ok, true);
    assert.deepEqual(chamadas.at(-1), ['drive', 'revisao', 'S47-01 decisao storyboard v2.md'], 'sem a central, grava em 4-Revisao');
    existentes = [{ name: 'S47-01 decisao storyboard v2.md' }];
    const n = chamadas.length;
    r = await Integra.drive.gravarDecisaoStoryboard({ id: 'S47-01', versao: 2, decisao: 'aprovar' });
    assert.equal(r.motivo, 'ja-decidido');
    assert.equal(chamadas.length, n, 'nada é gravado quando a decisão já existe');
  } finally {
    Integra.drive.listarRevisao = orig.listar;
    Integra.central.jaPedido = orig.jaPedido;
    Integra.central.enviarSePuder = orig.enviar;
    Integra.drive.criarArquivo = orig.criar;
    globalThis.localStorage = antes;
  }
});

/* ---- rodada de correções (revisão da Task 6) ---- */

test('Quadros: cada imagem baixa uma vez só, mesmo com a tela se redesenhando; nada vaza; o blob é image/jpeg', async () => {
  const { Quadros } = await import('../js/componentes/quadros.js');
  const { Integra } = await import('../js/integra.js');
  const orig = { baixar: Integra.baixarBlob, criar: URL.createObjectURL, revogar: URL.revokeObjectURL };
  let downloads = 0;
  const criados = [];
  const revogados = [];
  Integra.baixarBlob = (f) => { downloads++; return new Promise((ok) => setTimeout(() => ok(new Blob([`<html>${f.id}`], { type: 'text/html' })), 5)); };
  URL.createObjectURL = (b) => { criados.push(b); return `blob:teste/${criados.length}`; };
  URL.revokeObjectURL = (u) => { revogados.push(u); };
  try {
    Quadros.liberar();
    const fs = Array.from({ length: 13 }, (_, i) => ({ id: `q${i}`, modifiedTime: 't' }));
    for (let volta = 0; volta < 6; volta++) {   // cada 'motor:anexo' redesenha a tela e chama url() de novo
      for (const f of fs) Quadros.url(f);
      await new Promise((ok) => setTimeout(ok, 3));
    }
    await new Promise((ok) => setTimeout(ok, 120));
    for (const f of fs) Quadros.url(f);
    assert.equal(downloads, 13, 'um download por imagem');
    assert.equal(Quadros.urls.size, 13);
    assert.equal(revogados.length, 0, 'nenhum endereço perdido sem revogar');
    assert.ok(criados.every((b) => b.type === 'image/jpeg'), 'o blob é sempre image/jpeg, nunca o tipo que veio');
    assert.equal(Quadros.estado(fs[0]), 'pronto');
    Quadros.liberar();
    assert.equal(revogados.length, 13, 'o Sair revoga todos');
    Integra.baixarBlob = () => Promise.reject(new Error('rede'));
    Quadros.url({ id: 'x', modifiedTime: 't' });
    await new Promise((ok) => setTimeout(ok, 10));
    assert.equal(Quadros.estado({ id: 'x', modifiedTime: 't' }), 'erro');
    Quadros.tentar();
    assert.equal(Quadros.estado({ id: 'x', modifiedTime: 't' }), 'carregando', '"Tentar de novo" baixa outra vez');
  } finally {
    Integra.baixarBlob = orig.baixar;
    URL.createObjectURL = orig.criar;
    URL.revokeObjectURL = orig.revogar;
    const { Quadros: Q } = await import('../js/componentes/quadros.js');
    Q.liberar();
  }
});

test('"Nos dois vídeos": um pedido por rede, no quadro tocado e no da outra rede mais perto no tempo', async () => {
  const { pedidosDoQuadro, segundosDoQuadro } = await import('../js/storyboard.js');
  // T01: o 5 do Instagram é o fechamento (0:18.7); o 5 do TikTok é um corte (0:17.8) e o fechamento é o 6 (0:18.5)
  const quadros = {
    ig: [{ n: 4, tempo: '0:15.2' }, { n: 5, tempo: '0:18.7' }, { n: 6, tempo: '0:21.0' }],
    tt: [{ n: 4, tempo: '0:14.9' }, { n: 5, tempo: '0:17.8' }, { n: 6, tempo: '0:18.5' }, { n: 7, tempo: '0:20.8' }],
  };
  assert.equal(segundosDoQuadro('1:02.5'), 62.5);
  assert.ok(Number.isNaN(segundosDoQuadro('lixo')));
  assert.deepEqual(pedidosDoQuadro(quadros, 'ig', 5, 'frase mais curta', true), [
    { rede: 'ig', quadro: 5, tempo: '0:18.7', pedido: 'frase mais curta' },
    { rede: 'tt', quadro: 6, tempo: '0:18.5', pedido: 'frase mais curta' },
  ]);
  assert.deepEqual(pedidosDoQuadro(quadros, 'tt', 5, 'x', false), [{ rede: 'tt', quadro: 5, tempo: '0:17.8', pedido: 'x' }]);
  assert.deepEqual(pedidosDoQuadro(quadros, 'ig', 9, 'x', true), [], 'quadro que não existe');
  assert.deepEqual(pedidosDoQuadro(quadros, 'ig', 5, '   ', true), [], 'sem texto');
  const p = planejarDecisaoStoryboard({ id: 'S47-01', versao: 1, decisao: 'ajustar', ajustes: pedidosDoQuadro(quadros, 'ig', 5, 'x', true) });
  assert.deepEqual(lerDecisaoStoryboard(p.conteudo).ajustes.map((a) => `${a.rede}${a.quadro}`), ['ig5', 'tt6'], 'o arquivo leva rede e quadro exatos');
});

test('formulário do quadro: o par da outra rede aparece; imagem que falhou ou não chegou tem "Tentar de novo"', () => {
  estado.sbPendentes = {};
  estado.sbQuadro = { 'S47-01': 'ig:1' };
  const r = rotSb();
  r.storyboard.quadros.tt[0].tempo = '0:00.7';
  const h = painelQuadros(r, { email: ROBERTTA, agora: AGORA });
  assert.match(h, /Nos dois vídeos: vale também para o quadro 1 do TikTok \(0:00\.7\)/);
  assert.match(h, /data-acao="sb-tentar"/, 'imagem que não está na pasta tem "Tentar de novo"');
  assert.match(h, /ainda não chegou ao Drive/);
  estado.sbQuadro = {};
  const mudou = lerStoryboard('---\nid: S47-01\nversao: 2\n---\n## O que mudou\n| rede | quadro | pedido | o que foi feito | ok |\n|---|---|---|---|---|\n| ig | 1 | a | b | ⚠ |\n| tt | 1 | c | d | ✅ |\n');
  assert.deepEqual(mudou.mudancas.map((x) => x.ok), [false, true], '⚠ com ou sem o seletor de variação');
});

test('dados: a pasta do storyboard é listada de novo enquanto falta imagem; completa, fica guardada', async () => {
  const { Integra } = await import('../js/integra.js');
  const { carregar, roteiros, limparDados } = await import('../js/dados.js');
  const orig = {
    listagens: Integra.listagens, postados: Integra.postados, texto: Integra.baixarTexto,
    listar: Integra.drive.listarStoryboard, invalidar: Integra.invalidar,
  };
  const md = arq('T09-01 storyboard v1.md');
  const listagem = { roteiros: [], rascunhos: [], brutos: [], revisao: [pasta('T09-01 storyboard v1'), md], prontos: [], pacotes: {}, vencedores: [] };
  let listadas = 0;
  let arquivos = [arq('ig-01.jpg')];
  Integra.listagens = async () => listagem;
  Integra.postados = async () => new Map();
  Integra.baixarTexto = async () => '---\nid: T09-01\nversao: 1\n---\n## Instagram\n### Quadro 1\narquivo: ig-01.jpg\ntempo: 0:00.5\n## TikTok\n### Quadro 1\narquivo: tt-01.jpg\ntempo: 0:00.5\n';
  Integra.drive.listarStoryboard = async () => { listadas++; return arquivos; };
  Integra.invalidar = () => {};
  try {
    await carregar({ forcar: true });
    let r = roteiros().find((x) => x.id === 'T09-01');
    assert.equal(r.etapa, 'storyboard');
    assert.equal(r.storyboard.quadros.tt[0].file, null, 'a imagem do TikTok ainda não subiu');
    arquivos = [arq('ig-01.jpg'), arq('tt-01.jpg')];
    await carregar({ forcar: true });
    r = roteiros().find((x) => x.id === 'T09-01');
    assert.equal(listadas, 2, 'faltava imagem: listou de novo');
    assert.equal(r.storyboard.quadros.tt[0].file.name, 'tt-01.jpg');
    await carregar({ forcar: true });
    assert.equal(listadas, 2, 'completa: fica guardada');
  } finally {
    Object.assign(Integra, { listagens: orig.listagens, postados: orig.postados, baixarTexto: orig.texto, invalidar: orig.invalidar });
    Integra.drive.listarStoryboard = orig.listar;
    limparDados();
  }
});
