// Testes das regras do modelo (js/model.js), incluindo o cenário real atual da SPEC §11.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  montarProjetos, brutosSemId, ehRoteiroParaAprovar, ehPreviaNova, ajusteEmAndamento, ehPacoteSemPostei,
  ehAprovadoSemBruto, estadoVideo, resumoEsperando, aprovadosSemBruto, progressoSemana, projetosDaSemana,
  testesAtivos, historico, MIME_PASTA,
} from '../js/model.js';

let seq = 0;
function arq(name, quando = '2026-11-10T12:00:00.000Z', extra = {}) {
  seq++;
  return {
    id: `f${seq}`, name, mimeType: name.endsWith('.md') ? 'text/markdown' : 'application/octet-stream',
    createdTime: quando, modifiedTime: quando, size: '100', parents: [], webViewLink: `https://drive.google.com/file/d/f${seq}/view`,
    ...extra,
  };
}
function pasta(name, quando = '2026-11-10T12:00:00.000Z') {
  return arq(name, quando, { mimeType: MIME_PASTA });
}

/* -------------------------------------------- cenário real atual (§11) */

function cenarioReal() {
  return montarProjetos({
    roteiros: [
      arq('T01-01 - Padrões familiares herdados não são destino.md', '2026-11-11T10:00:00.000Z'),
      pasta('rascunhos'),
      pasta('arquivo'),
    ],
    rascunhos: [
      arq('T01-01 rascunho v1.md', '2026-11-10T10:00:00.000Z'),
      arq('T01-01 rascunho v2.md', '2026-11-10T14:00:00.000Z'),
      arq('T01-01 fontes.md', '2026-11-10T14:30:00.000Z'),
    ],
    brutos: [arq('T01-01 bruto.mp4', '2026-11-12T09:00:00.000Z')],
    revisao: [],
    prontos: [pasta('vencedores')],
    pacotes: {},
    vencedores: [],
    postados: new Map(),
  });
}

test('cenário real: T01-01 não é roteiro para aprovar, nem "sem bruto"; etapa gravação enviada', () => {
  const ps = cenarioReal();
  assert.deepEqual([...ps.keys()], ['T01-01']);
  const p = ps.get('T01-01');
  assert.equal(p.titulo, 'Padrões familiares herdados não são destino');
  assert.equal(p.teste, true);
  assert.deepEqual(p.rascunhos.map((r) => r.v), [1, 2]);
  assert.equal(p.ultimoRascunho.v, 2);
  assert.ok(p.fontes);
  assert.ok(p.roteiro);
  assert.equal(p.brutos.length, 1);
  assert.equal(p.pacote, null);
  assert.equal(ehRoteiroParaAprovar(p), false);
  assert.equal(ehAprovadoSemBruto(p), false);
  assert.equal(ehPreviaNova(p), false);
  assert.equal(ajusteEmAndamento(p), null);
  assert.equal(ehPacoteSemPostei(p), false);
  assert.equal(p.etapa, 'gravação enviada');

  const esp = resumoEsperando(ps);
  assert.equal(esp.roteirosParaAprovar.length, 0);
  assert.equal(esp.previasNovas.length, 0);
  assert.equal(esp.pacotesSemPostei.length, 0);
  assert.equal(aprovadosSemBruto(ps).length, 0);
  assert.deepEqual(testesAtivos(ps).map((x) => x.id), ['T01-01']);
});

/* ------------------------------------------------ roteiro para aprovar */

test('roteiro para aprovar: rascunho sem aprovado; etapas de checagem', () => {
  const ps = montarProjetos({
    rascunhos: [
      arq('S46-01 rascunho v1.md', '2026-11-10T10:00:00.000Z'),
      arq('S46-01 fontes.md', '2026-11-10T10:05:00.000Z'),
      arq('S46-02 rascunho v1.md', '2026-11-10T10:00:00.000Z'),
      arq('S46-02 fontes.md', '2026-11-10T10:05:00.000Z'),
      arq('S46-02 Um título no meio rascunho v2.md', '2026-11-10T12:00:00.000Z'),
      // pasta duplicada "rascunhos (1)" com a mesma versão
      arq('S46-03 rascunho v1.md', '2026-11-10T09:00:00.000Z'),
      arq('S46-03 rascunho v1.md', '2026-11-10T11:00:00.000Z'),
      arq('IMG.md'),
    ],
  });
  const s1 = ps.get('S46-01');
  const s2 = ps.get('S46-02');
  const s3 = ps.get('S46-03');
  assert.ok(ehRoteiroParaAprovar(s1));
  assert.ok(ehRoteiroParaAprovar(s2));
  assert.equal(s1.etapa, 'roteiro para aprovar');
  assert.equal(s2.etapa, 'rascunho v2 em checagem'); // fontes é da v1
  assert.equal(s3.rascunhos.length, 1);
  assert.equal(s3.ultimoRascunho.file.createdTime, '2026-11-10T11:00:00.000Z');
  assert.equal(s3.etapa, 'rascunho v1 em checagem');
  assert.deepEqual(resumoEsperando(ps).roteirosParaAprovar.map((p) => p.id), ['S46-01', 'S46-02', 'S46-03']);
});

/* ----------------------------------------------------------- prévias */

test('prévia nova, ajustes em andamento e aprovado', () => {
  const ps = montarProjetos({
    roteiros: [arq('S46-01 - A.md'), arq('S46-02 - B.md'), arq('S46-03 - C.md'), arq('S46-04 - D.md')],
    brutos: [arq('S46-01 bruto.mp4'), arq('S46-02 bruto.mov'), arq('S46-03.MOV'), arq('S46-04 bruto.m4v')],
    revisao: [
      // S46-01: v1 nova
      arq('S46-01 IG v1.mp4', '2026-11-12T10:00:00.000Z'), arq('S46-01 TT v1.mp4', '2026-11-12T10:01:00.000Z'),
      arq('S46-01 notas v1.md'), arq('S46-01 storyboard IG v1.jpg'), arq('S46-01 storyboard TT v1.jpg'),
      // S46-02: v1 com ajustes pedidos, sem v2 → em andamento
      arq('S46-02 IG v1.mp4'), arq('S46-02 TT v1.mp4'), arq('S46-02 ajustes v1.md'),
      // S46-03: v1 + ajustes v1 + v2 → v2 é nova
      arq('S46-03 IG v1.mp4'), arq('S46-03 TT v1.mp4'), arq('S46-03 ajustes v1.md'),
      arq('S46-03 IG v2.mp4', '2026-11-13T10:00:00.000Z'), arq('S46-03 TT v2.mp4', '2026-11-13T10:00:00.000Z'),
      // S46-04: v1 aprovada
      arq('S46-04 IG v1.mp4'), arq('S46-04 TT v1.mp4'), arq('S46-04 aprovado.md'),
    ],
  });
  const [a, b, c, d] = ['S46-01', 'S46-02', 'S46-03', 'S46-04'].map((id) => ps.get(id));

  assert.ok(ehPreviaNova(a));
  assert.equal(a.previas.atual, 1);
  assert.ok(a.previas.versoes[0].sbIg && a.previas.versoes[0].sbTt && a.previas.versoes[0].notas);
  assert.equal(a.previas.versoes[0].created, '2026-11-12T10:00:00.000Z');
  assert.equal(a.etapa, 'prévia v1 para ver');
  assert.equal(estadoVideo(a), 'nova');

  assert.ok(!ehPreviaNova(b));
  assert.equal(ajusteEmAndamento(b).v, 1);
  assert.equal(b.etapa, 'ajustes v1 pedidos, motor trabalhando');
  assert.equal(estadoVideo(b), 'ajustes');

  assert.ok(ehPreviaNova(c));
  assert.equal(ajusteEmAndamento(c), null);
  assert.equal(c.previas.atual, 2);
  assert.equal(c.etapa, 'prévia v2 para ver');

  assert.ok(!ehPreviaNova(d));
  assert.equal(d.etapa, 'aprovado, finalizando');
  assert.equal(estadoVideo(d), 'aprovado');

  assert.deepEqual(resumoEsperando(ps).previasNovas.map((p) => p.id).sort(), ['S46-01', 'S46-03']);
  // ajustes com versão maior que a atual também bloqueiam a prévia nova
  const ps2 = montarProjetos({ revisao: [arq('S46-09 IG v1.mp4'), arq('S46-09 ajustes v2.md')] });
  assert.ok(!ehPreviaNova(ps2.get('S46-09')));
});

/* ------------------------------------------------------ pacotes/postados */

test('pacote pronto sem Postei, postado e vencedor', () => {
  const pk1 = pasta('S45-01 - Título um', '2026-11-08T10:00:00.000Z');
  const pk2 = pasta('S45-02 - Título dois', '2026-11-09T10:00:00.000Z');
  const ps = montarProjetos({
    prontos: [pk1, pk2, pasta('vencedores')],
    pacotes: {
      [pk1.id]: [arq('S45-01 IG.mp4', undefined, { sub: '' }), arq('01.png', undefined, { sub: 'carrossel' })],
      [pk2.id]: [],
    },
    vencedores: [arq('S45-02 vencedor.md'), pasta('S45-02')],
    revisao: [arq('S45-01 aprovado.md')],
    postados: new Map([['S45-02', '2026-11-10'], ['S99-99', '2026-11-10']]),
  });
  assert.ok(!ps.has('S99-99'));
  const a = ps.get('S45-01');
  const b = ps.get('S45-02');
  assert.equal(a.titulo, 'Título um');
  assert.equal(a.pacote.files.length, 2);
  assert.ok(ehPacoteSemPostei(a));
  assert.equal(a.etapa, 'pacote pronto');
  assert.ok(!ehPacoteSemPostei(b));
  assert.deepEqual(b.postado, { data: '2026-11-10' });
  assert.equal(b.etapa, 'postado em 10/11');
  assert.equal(b.vencedor, true);
  assert.equal(a.vencedor, false);
  assert.deepEqual(resumoEsperando(ps).pacotesSemPostei.map((p) => p.id), ['S45-01']);
});

/* ------------------------------------------------- aprovado sem bruto */

test('roteiro aprovado sem bruto', () => {
  const pk = pasta('S46-05 - E');
  const ps = montarProjetos({
    roteiros: [arq('S46-01 - A.md'), arq('S46-02 - B.md'), arq('S46-03 - C.md'), arq('S46-04 - D.md'), arq('S46-05 - E.md')],
    rascunhos: [arq('S46-01 rascunho v3.md')],
    brutos: [arq('S46-02 bruto.MOV'), arq('IMG_1234.MOV'), arq('S46-03X.mp4'), arq('leia-me.txt')],
    revisao: [arq('S46-04 IG v1.mp4')],
    prontos: [pk],
    pacotes: { [pk.id]: [] },
  });
  assert.deepEqual(aprovadosSemBruto(ps).map((p) => p.id), ['S46-01', 'S46-03']);
  assert.equal(ps.get('S46-01').etapa, 'aprovado, falta gravar');
  assert.ok(!ehRoteiroParaAprovar(ps.get('S46-01')));
  assert.deepEqual(brutosSemId([arq('S46-02 bruto.MOV'), arq('IMG_1234.MOV'), arq('leia-me.txt')]).map((f) => f.name), ['IMG_1234.MOV']);
});

/* ------------------------------------------------------ semana ISO */

test('progresso da semana', () => {
  const ps = montarProjetos({
    roteiros: [arq('S46-01 - A.md'), arq('S46-02 - B.md')],
    rascunhos: [arq('S46-01 rascunho v1.md'), arq('S46-03 rascunho v1.md'), arq('S45-01 rascunho v1.md')],
    brutos: [arq('S46-01 bruto.mp4')],
    revisao: [arq('S46-01 IG v1.mp4'), arq('S46-01 aprovado.md'), arq('T02 IG v1.mp4'), arq('T03 limpar.md')],
    postados: new Map([['S46-01', '2026-11-13']]),
  });
  assert.deepEqual(projetosDaSemana(ps, 'S46').map((p) => p.id), ['S46-01', 'S46-02', 'S46-03']);
  const prog = progressoSemana(ps, 'S46');
  assert.equal(prog.total, 3);
  assert.deepEqual(prog.etapas.map((e) => [e.chave, e.feitos]), [
    ['pautas', 3], ['roteiros', 2], ['gravacao', 1], ['revisao', 1], ['postagem', 1],
  ]);
  assert.equal(prog.etapas[0].completa, true);
  assert.equal(prog.etapas[1].completa, false);
  assert.equal(progressoSemana(ps, 'S50').total, 0);
  assert.deepEqual(testesAtivos(ps).map((p) => p.id), ['T02']);
});

test('histórico em ordem cronológica', () => {
  const ps = montarProjetos({
    roteiros: [arq('S46-01 - A.md', '2026-11-10T12:00:00.000Z')],
    rascunhos: [arq('S46-01 rascunho v1.md', '2026-11-09T12:00:00.000Z')],
    brutos: [arq('S46-01 bruto.mp4', '2026-11-11T12:00:00.000Z')],
    revisao: [arq('S46-01 IG v1.mp4', '2026-11-12T12:00:00.000Z'), arq('S46-01 ajustes v1.md', '2026-11-12T15:00:00.000Z')],
  });
  assert.deepEqual(historico(ps.get('S46-01')).map((e) => e.texto),
    ['Rascunho v1', 'Roteiro aprovado', 'Gravação enviada (S46-01 bruto.mp4)', 'Prévia v1', 'Ajustes v1 pedidos']);
});
