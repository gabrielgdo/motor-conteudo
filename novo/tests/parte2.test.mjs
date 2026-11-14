// Testes das funções puras da parte 2 (js/parse.js): leitura do pedido de ajustes, tempos da linha
// do tempo, texto de "Copiar a lista", nome de download e horários do pacote. E o teleprompter do
// formato com etiquetas em dados.montarRoteiro.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseAjustes, versaoDoAjuste, segundosDoTempo, textoDosAjustes, nomeDownload, sugestaoDaAgenda, gerarAjustes,
} from '../js/parse.js';
import { montarProjetos } from '../js/model.js';
import { lerRoteiro } from '../js/roteiro.js';
import { montarRoteiro } from '../js/dados.js';

/* ------------------------------------------------------------ parseAjustes */

test('parseAjustes: o exemplo de formatos.md', () => {
  const texto = `---
id: S46-01
versao_base: 1          # aceite também "v1"
decisao: ajustar
ajustes:
  - versao: tt          # ig | tt | ambas (aceite "ambos")
    tempo: "0:00-0:03"
    pedido: deixar o gancho mais impactante
    como: texto maior e zoom in na palavra "nunca"
  - versao: ambas
    tempo: "0:12"
    pedido: tirar o zoom
observacoes: texto livre (opcional)
---
`;
  assert.deepEqual(parseAjustes(texto), {
    id: 'S46-01',
    versaoBase: 1,
    decisao: 'ajustar',
    ajustes: [
      { versao: 'tt', tempo: '0:00-0:03', pedido: 'deixar o gancho mais impactante', como: 'texto maior e zoom in na palavra "nunca"' },
      { versao: 'ambas', tempo: '0:12', pedido: 'tirar o zoom', como: '' },
    ],
    observacoes: 'texto livre (opcional)',
  });
});

test('parseAjustes: "v2", "ambos", CRLF, BOM, lista sem recuo e campos fora do contrato', () => {
  const texto = '﻿---\r\nid: T01\r\nversao_base: v2\r\ndecisao: ajustar\r\nextra: ignorar\r\najustes:\r\n- versao: ambos\r\n  pedido: \'trocar a música\'\r\n  outro: x\r\n- versao: Instagram\r\n  tempo: 0:40\r\n  pedido: cortar o fim\r\n---\r\ncorpo ignorado\r\n';
  const a = parseAjustes(texto);
  assert.equal(a.id, 'T01');
  assert.equal(a.versaoBase, 2);
  assert.deepEqual(a.ajustes, [
    { versao: 'ambas', tempo: '', pedido: 'trocar a música', como: '' },
    { versao: 'ig', tempo: '0:40', pedido: 'cortar o fim', como: '' },
  ]);
  assert.equal(a.observacoes, '');
});

test('parseAjustes: o que o próprio app gera (gerarAjustes) volta igual', () => {
  const ajustes = [
    { versao: 'ig', tempo: '0:12-0:15', pedido: 'tirar o "zoom": rápido', como: 'parado' },
    { versao: 'tt', tempo: '', pedido: 'legenda maior', como: '' },
  ];
  const a = parseAjustes(gerarAjustes({ id: 'S47-01', versaoBase: 3, ajustes, observacoes: 'nada' }));
  assert.equal(a.versaoBase, 3);
  assert.deepEqual(a.ajustes, ajustes);
  assert.equal(a.observacoes, 'nada');
});

test('parseAjustes: sem frontmatter → null; itens vazios ficam de fora', () => {
  assert.equal(parseAjustes('só texto'), null);
  assert.equal(parseAjustes('---\nid: S46-01\n'), null);
  assert.equal(parseAjustes(null), null);
  assert.deepEqual(parseAjustes('---\nid: S46-01\najustes:\n  - versao: ig\n  - versao: tt\n    pedido: x\n---').ajustes,
    [{ versao: 'tt', tempo: '', pedido: 'x', como: '' }]);
});

test('versaoDoAjuste', () => {
  assert.equal(versaoDoAjuste('IG'), 'ig');
  assert.equal(versaoDoAjuste('tiktok'), 'tt');
  assert.equal(versaoDoAjuste('ambos'), 'ambas');
  assert.equal(versaoDoAjuste(''), 'ambas');
});

/* -------------------------------------------------------- segundosDoTempo */

test('segundosDoTempo', () => {
  assert.deepEqual(segundosDoTempo('0:12'), { de: 12, ate: null });
  assert.deepEqual(segundosDoTempo('0:00-0:03'), { de: 0, ate: 3 });
  assert.deepEqual(segundosDoTempo('1:05 – 1:10'), { de: 65, ate: 70 });
  assert.deepEqual(segundosDoTempo('00:12'), { de: 12, ate: null });
  assert.deepEqual(segundosDoTempo('0:20-0:10'), { de: 20, ate: null }, 'fim antes do começo: só o ponto');
  assert.deepEqual(segundosDoTempo(''), { de: null, ate: null });
  assert.deepEqual(segundosDoTempo('no começo'), { de: null, ate: null });
});

/* -------------------------------------------------------- textoDosAjustes */

test('textoDosAjustes: um por linha, no formato "Instagram, em 0:12: pedido (como)"', () => {
  assert.equal(textoDosAjustes([
    { versao: 'ig', tempo: '0:12', pedido: 'tirar o zoom', como: 'deixar parado' },
    { versao: 'tt', tempo: '', pedido: 'legenda maior', como: '' },
    { versao: 'ambas', tempo: '0:00-0:03', pedido: 'gancho\nmais forte', como: '' },
  ]), [
    'Instagram, em 0:12: tirar o zoom (deixar parado)',
    'TikTok: legenda maior',
    'As duas versões, em 0:00-0:03: gancho mais forte',
  ].join('\n'));
  assert.equal(textoDosAjustes([]), '');
});

/* ---------------------------------------------------------- nomeDownload */

test('nomeDownload: original; subpastas como "carrossel-01.png"', () => {
  assert.equal(nomeDownload('S47-01 IG.mp4'), 'S47-01 IG.mp4');
  assert.equal(nomeDownload('01.png', 'carrossel'), 'carrossel-01.png');
  assert.equal(nomeDownload('02.png', 'Stories'), 'stories-02.png');
  assert.equal(nomeDownload('a/b:c?.txt'), 'a-b-c-.txt');
  assert.equal(nomeDownload(''), 'arquivo');
});

/* ------------------------------------------------------- sugestaoDaAgenda */

test('sugestaoDaAgenda: por rede, ou a primeira linha para as duas', () => {
  assert.deepEqual(sugestaoDaAgenda('# Horários\n- **Instagram:** quinta, 19h\n- TikTok: sexta, 12h\n'), { ig: 'quinta, 19h', tt: 'sexta, 12h' });
  assert.deepEqual(sugestaoDaAgenda('IG - hoje, 18h'), { ig: 'hoje, 18h', tt: '' });
  assert.deepEqual(sugestaoDaAgenda('Postar na quinta à noite\n'), { ig: 'Postar na quinta à noite', tt: 'Postar na quinta à noite' });
  assert.deepEqual(sugestaoDaAgenda('---\nid: S47-01\n---\nsábado, 10h'), { ig: 'sábado, 10h', tt: 'sábado, 10h' });
  assert.deepEqual(sugestaoDaAgenda(''), { ig: '', tt: '' });
});

/* --------------------------------------------- teleprompter (dados.js) */

test('montarRoteiro: "Versão teleprompter" no formato com etiquetas; vazio no formato novo', () => {
  const dir = new URL('./fixtures/roteiros/', import.meta.url);
  const ler = (nome) => lerRoteiro(readFileSync(new URL(nome, dir), 'utf8'), nome);
  const p = montarProjetos({ roteiros: [{ id: 'f1', name: 'S46-01 - Formato com etiquetas.md', mimeType: 'text/markdown', createdTime: '2026-11-10T12:00:00Z' }] }).get('S46-01');
  const antigo = montarRoteiro(p, ler('S46-01 - Formato com etiquetas.md'));
  assert.ok(antigo.teleprompter.length > 0);
  assert.ok(!antigo.teleprompter.startsWith('#'));
  const novo = montarRoteiro(p, ler('T90 - Novo mesmo roteiro.md'));
  assert.equal(novo.teleprompter, '', 'no formato novo o teleprompter são as próprias falas');
});
