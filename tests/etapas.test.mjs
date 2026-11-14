// Testes de js/etapas.js (etapa no vocabulário do protótipo) sobre projetos de montarProjetos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarProjetos, ajusteEmAndamento, MIME_PASTA } from '../js/model.js';
import { etapaDe, versaoRascunho, versaoPreviaAtual, ajustePendente } from '../js/etapas.js';

let seq = 0;
function arq(name, quando = '2026-11-10T12:00:00.000Z', extra = {}) {
  seq++;
  return {
    id: `e${seq}`, name, mimeType: name.endsWith('.md') ? 'text/markdown' : 'video/mp4',
    createdTime: quando, modifiedTime: quando, size: '100', parents: [], ...extra,
  };
}
const pasta = (name) => arq(name, undefined, { mimeType: MIME_PASTA });

/** Um projeto a partir das listagens (nomes de arquivo bastam). */
function projeto(id, { roteiros = [], rascunhos = [], brutos = [], revisao = [], prontos = [], vencedores = [], postados } = {}) {
  const m = montarProjetos({
    roteiros: roteiros.map((n) => arq(n)),
    rascunhos: rascunhos.map((n) => (typeof n === 'string' ? arq(n) : n)),
    brutos: brutos.map((n) => arq(n)),
    revisao: revisao.map((n) => arq(n)),
    prontos: prontos.map(pasta),
    vencedores: vencedores.map((n) => arq(n)),
    postados,
  });
  return m.get(id);
}

const ROT = 'S46-01 - Ansiedade de domingo.md';

/* ------------------------------------------------------- cada etapa */

test('rascunho: só rascunho vN em rascunhos*', () => {
  const p = projeto('S46-01', { rascunhos: ['S46-01 rascunho v1.md', 'S46-01 fontes.md'] });
  assert.equal(etapaDe(p), 'rascunho');
  assert.equal(versaoRascunho(p), 1);
  assert.equal(versaoPreviaAtual(p), null);
});

test('rascunho: versões espalhadas em "rascunhos" e "rascunhos (1)" (inclusive repetidas)', () => {
  // montarProjetos recebe os arquivos de todas as pastas rascunhos* juntos
  const p = projeto('S46-01', {
    rascunhos: [
      arq('S46-01 rascunho v1.md', '2026-11-10T10:00:00.000Z', { parents: ['pasta-rascunhos'] }),
      arq('S46-01 rascunho v2.md', '2026-11-10T11:00:00.000Z', { parents: ['pasta-rascunhos'] }),
      arq('S46-01 rascunho v2.md', '2026-11-10T12:00:00.000Z', { parents: ['pasta-rascunhos-1'] }),
      arq('S46-01 Ansiedade rascunho v3.md', '2026-11-10T13:00:00.000Z', { parents: ['pasta-rascunhos-1'] }),
    ],
  });
  assert.equal(etapaDe(p), 'rascunho');
  assert.equal(versaoRascunho(p), 3);
  assert.equal(p.rascunhos.length, 3);
});

test('aprovado: roteiro na raiz, sem bruto do id', () => {
  assert.equal(etapaDe(projeto('S46-01', { roteiros: [ROT] })), 'aprovado');
});

test('aprovado: rascunho que continua na pasta depois de aprovado não volta para rascunho', () => {
  const p = projeto('S46-01', { roteiros: [ROT], rascunhos: ['S46-01 rascunho v2.md'] });
  assert.equal(etapaDe(p), 'aprovado');
  assert.equal(versaoRascunho(p), 2);
});

test('aprovado: bruto sem id no nome não conta (fica aprovado até a prévia)', () => {
  const p = projeto('S46-01', { roteiros: [ROT], brutos: ['IMG_1234.MOV'] });
  assert.equal(etapaDe(p), 'aprovado');
});

test('recebido: bruto "T01.mp4" e "T01 bruto.MOV"', () => {
  for (const nome of ['T01.mp4', 'T01 bruto.MOV']) {
    const p = projeto('T01', { roteiros: ['T01 - Teste.md'], brutos: [nome] });
    assert.equal(etapaDe(p), 'recebido', nome);
  }
  // bruto de outro id parecido não conta
  assert.equal(etapaDe(projeto('T01', { roteiros: ['T01 - Teste.md'], brutos: ['T011.mp4'] })), 'aprovado');
});

test('recebido: bruto do id mesmo sem roteiro aprovado', () => {
  assert.equal(etapaDe(projeto('T02', { brutos: ['T02 bruto.mp4'] })), 'recebido');
});

test('previa: IG e TT v1', () => {
  const p = projeto('S46-01', {
    roteiros: [ROT], brutos: ['S46-01 bruto.mov'],
    revisao: ['S46-01 IG v1.mp4', 'S46-01 TT v1.mp4', 'S46-01 notas v1.md', 'S46-01 storyboard IG v1.jpg'],
  });
  assert.equal(etapaDe(p), 'previa');
  assert.equal(versaoPreviaAtual(p), 1);
});

test('previa: só IG ou só TT também vale', () => {
  assert.equal(etapaDe(projeto('S46-01', { revisao: ['S46-01 IG v1.mp4'] })), 'previa');
  assert.equal(etapaDe(projeto('S46-01', { revisao: ['S46-01 TT v1.mp4'] })), 'previa');
  // só notas/storyboard não é prévia
  assert.equal(etapaDe(projeto('S46-01', { roteiros: [ROT], revisao: ['S46-01 notas v1.md'] })), 'aprovado');
});

test('previa: versões múltiplas (v2 depois de ajustes v1)', () => {
  const p = projeto('S46-01', {
    revisao: ['S46-01 IG v1.mp4', 'S46-01 TT v1.mp4', 'S46-01 ajustes v1.md', 'S46-01 IG v2.mp4', 'S46-01 TT v2.mp4'],
  });
  assert.equal(etapaDe(p), 'previa');
  assert.equal(versaoPreviaAtual(p), 2);
});

test('ajustes: ajustes vN da última prévia, sem vN+1', () => {
  const p = projeto('S46-01', {
    revisao: ['S46-01 IG v1.mp4', 'S46-01 TT v1.mp4', 'S46-01 ajustes v1.md', 'S46-01 IG v2.mp4', 'S46-01 TT v2.mp4', 'S46-01 ajustes v2.md'],
  });
  assert.equal(etapaDe(p), 'ajustes');
  assert.equal(ajustePendente(p).v, 2);
  assert.equal(versaoPreviaAtual(p), 2);
});

test('ajustes: versão maior que a última prévia também conta', () => {
  const p = projeto('S46-01', { revisao: ['S46-01 IG v1.mp4', 'S46-01 TT v1.mp4', 'S46-01 ajustes v3.md'] });
  assert.equal(etapaDe(p), 'ajustes');
});

test('ajustes de versão antiga não contam (diverge de model.ajusteEmAndamento)', () => {
  // ajustes v1 sem v2, mas já existe v3 (v2 pulada): a última prévia é v3 e não tem pedido
  const p = projeto('S46-01', {
    revisao: ['S46-01 IG v1.mp4', 'S46-01 TT v1.mp4', 'S46-01 ajustes v1.md', 'S46-01 IG v3.mp4', 'S46-01 TT v3.mp4'],
  });
  assert.equal(etapaDe(p), 'previa');
  assert.equal(ajustePendente(p), null);
  assert.equal(ajusteEmAndamento(p).v, 1); // model.js vê ajuste em andamento
});

test('ajustes sem prévia nenhuma não viram etapa ajustes', () => {
  assert.equal(etapaDe(projeto('S46-01', { roteiros: [ROT], revisao: ['S46-01 ajustes v1.md'] })), 'aprovado');
});

test('video-aprovado: aprovado.md sem pacote (mesmo com ajustes pendentes)', () => {
  const p = projeto('S46-01', {
    revisao: ['S46-01 IG v2.mp4', 'S46-01 TT v2.mp4', 'S46-01 ajustes v2.md', 'S46-01 aprovado.md'],
  });
  assert.equal(etapaDe(p), 'video-aprovado');
});

test('pronto: pasta do id em 5-Prontos', () => {
  assert.equal(etapaDe(projeto('S46-01', { prontos: ['S46-01 - Ansiedade de domingo'] })), 'pronto');
  assert.equal(etapaDe(projeto('S46-01', { prontos: ['S46-01'] })), 'pronto');
});

test('pronto: aprovado + pacote (e postado, vencedor) continua pronto', () => {
  const p = projeto('S46-01', {
    roteiros: [ROT], brutos: ['S46-01 bruto.mov'],
    revisao: ['S46-01 IG v1.mp4', 'S46-01 TT v1.mp4', 'S46-01 aprovado.md'],
    prontos: ['S46-01 - Ansiedade de domingo', 'vencedores'],
    vencedores: ['S46-01 vencedor.md'],
    postados: new Map([['S46-01', '2026-11-13']]),
  });
  assert.equal(etapaDe(p), 'pronto');
  // roteiro + pacote, sem nada no meio (brutos/prévias já limpos)
  assert.equal(etapaDe(projeto('S46-01', { roteiros: [ROT], prontos: ['S46-01 - Ansiedade de domingo'] })), 'pronto');
});

/* ------------------------------------------------------- sem etapa */

test('sem etapa: só fontes, só limpar.md, só vencedor, projeto inexistente', () => {
  assert.equal(etapaDe(projeto('S46-01', { rascunhos: ['S46-01 fontes.md'] })), '');
  assert.equal(etapaDe(projeto('T03', { revisao: ['T03 limpar.md'] })), '');
  assert.equal(etapaDe(projeto('S46-02', { vencedores: ['S46-02 vencedor.md'] })), '');
  assert.equal(etapaDe(undefined), '');
});

test('limpar.md não muda a etapa calculada', () => {
  const p = projeto('T01', { roteiros: ['T01 - Teste.md'], brutos: ['T01 bruto.mp4'], revisao: ['T01 limpar.md'] });
  assert.equal(etapaDe(p), 'recebido');
});

test('arquivado nunca sai: 2-Roteiros/arquivo não é registrado por model.js', () => {
  // a pasta arquivo/ na raiz de 2-Roteiros é ignorada; seus arquivos não chegam ao modelo
  const m = montarProjetos({ roteiros: [pasta('arquivo'), pasta('rascunhos')] });
  assert.equal(m.size, 0);
  const p = projeto('S46-01', { rascunhos: ['S46-01 rascunho v1.md'] });
  assert.notEqual(etapaDe(p), 'arquivado');
});

test('versões: null quando não há', () => {
  const p = projeto('S46-01', { roteiros: [ROT] });
  assert.equal(versaoRascunho(p), null);
  assert.equal(versaoPreviaAtual(p), null);
});
