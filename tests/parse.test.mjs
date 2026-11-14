// Testes das funções puras de js/parse.js (e das partes puras de js/upload.js).
// Rodar com: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  idValido, ehTeste, idNoInicio, parseRascunho, parseFontes, parseRoteiroAprovado, parseRevisao,
  parseBruto, parsePacote, parseVencedor, nomeBruto, classificarArquivoPacote, extrairFrontmatter,
  parseFrontmatterRoteiro, yamlTexto, gerarAprovacao, gerarAjustes, blocosMarkdown, formatarDataHora,
  formatarData, dataCurta, hojeISO, semanaIso, prefixoSemana, normalizarDataPost, postadosDeLinhas,
  localizarColunasDesempenho, formatarBytes,
} from '../js/parse.js';
import {
  proximoOffset, intervaloPedaco, rangeConsulta, esperaBackoff, velocidade, tempoRestante,
  formatarDuracao, chaveSessao, sessaoValida, PEDACO,
} from '../js/upload.js';

test('ids válidos e de teste', () => {
  for (const id of ['S46-01', 'T01', 'T01-01', 'R001']) assert.ok(idValido(id), id);
  for (const id of ['S4-01', 'S46', 'T1', 'R01', 's46-01', 'T01-1', 'X46-01', '']) assert.ok(!idValido(id), id);
  assert.ok(ehTeste('T01-01'));
  assert.ok(!ehTeste('S46-01'));
});

test('id no início do nome', () => {
  assert.equal(idNoInicio('S46-03 bruto.MOV'), 'S46-03');
  assert.equal(idNoInicio('T01-01 bruto.mp4'), 'T01-01');
  assert.equal(idNoInicio('T01.mp4'), 'T01');
  assert.equal(idNoInicio('IMG_1234.MOV'), null);
  assert.equal(idNoInicio('S46-031 bruto.mp4'), null);
  assert.equal(idNoInicio('S46-03bruto.mp4'), null);
});

test('rascunhos e fontes', () => {
  assert.deepEqual(parseRascunho('T01-01 rascunho v1.md'), { id: 'T01-01', v: 1 });
  assert.deepEqual(parseRascunho('S46-02 Padrões herdados rascunho v12.md'), { id: 'S46-02', v: 12 });
  assert.equal(parseRascunho('T01-01 fontes.md'), null);
  assert.equal(parseRascunho('T01-01 rascunho.md'), null);
  assert.equal(parseRascunho('X01 rascunho v1.md'), null);
  assert.deepEqual(parseFontes('T01-01 fontes.md'), { id: 'T01-01' });
  assert.equal(parseFontes('T01-01 rascunho v1.md'), null);
});

test('roteiro aprovado', () => {
  assert.deepEqual(parseRoteiroAprovado('T01-01 - Padrões familiares herdados não são destino.md'),
    { id: 'T01-01', titulo: 'Padrões familiares herdados não são destino' });
  assert.equal(parseRoteiroAprovado('T01-01 rascunho v1.md'), null);
  assert.equal(parseRoteiroAprovado('arquivo'), null);
});

test('prévias, storyboards, notas, ajustes, aprovado, limpar', () => {
  assert.deepEqual(parseRevisao('S46-01 IG v2.mp4'), { id: 'S46-01', tipo: 'ig', v: 2 });
  assert.deepEqual(parseRevisao('S46-01 TT v2.mp4'), { id: 'S46-01', tipo: 'tt', v: 2 });
  assert.deepEqual(parseRevisao('S46-01 storyboard IG v1.jpg'), { id: 'S46-01', tipo: 'sbIg', v: 1 });
  assert.deepEqual(parseRevisao('S46-01 storyboard TT v3.jpg'), { id: 'S46-01', tipo: 'sbTt', v: 3 });
  assert.deepEqual(parseRevisao('S46-01 notas v1.md'), { id: 'S46-01', tipo: 'notas', v: 1 });
  assert.deepEqual(parseRevisao('S46-01 ajustes v1.md'), { id: 'S46-01', tipo: 'ajustes', v: 1 });
  assert.deepEqual(parseRevisao('S46-01 aprovado.md'), { id: 'S46-01', tipo: 'aprovado', v: null });
  assert.deepEqual(parseRevisao('T01 limpar.md'), { id: 'T01', tipo: 'limpar', v: null });
  assert.equal(parseRevisao('S46-01 IG.mp4'), null);
  assert.equal(parseRevisao('qualquer.mp4'), null);
});

test('brutos', () => {
  assert.deepEqual(parseBruto('T01-01 bruto.mp4'), { id: 'T01-01', ext: 'mp4' });
  assert.deepEqual(parseBruto('S46-03.MOV'), { id: 'S46-03', ext: 'MOV' });
  assert.deepEqual(parseBruto('IMG_1234.MOV'), { id: null, ext: 'MOV' });
  assert.deepEqual(parseBruto('clip.M4V'), { id: null, ext: 'M4V' });
  assert.equal(parseBruto('S46-03 notas.txt'), null);
  assert.equal(nomeBruto('S46-03', 'IMG_9.MOV'), 'S46-03 bruto.MOV');
  assert.equal(nomeBruto('S46-03', 'video.final.mp4'), 'S46-03 bruto.mp4');
});

test('pacotes e vencedores', () => {
  assert.deepEqual(parsePacote('S46-01 - Por que repetimos'), { id: 'S46-01', titulo: 'Por que repetimos' });
  assert.deepEqual(parsePacote('T01'), { id: 'T01', titulo: '' });
  assert.equal(parsePacote('vencedores'), null);
  assert.deepEqual(parseVencedor('S46-01 vencedor.md'), { id: 'S46-01' });
  assert.equal(parseVencedor('S46-01'), null);
  const c = (n, s) => classificarArquivoPacote(n, s).tipo;
  assert.equal(c('S46-01 IG.mp4'), 'ig');
  assert.equal(c('S46-01 IG sem musica.mp4'), 'igSemMusica');
  assert.equal(c('S46-01 TT.mp4'), 'tt');
  assert.equal(c('S46-01 TT sem musica.mp4'), 'ttSemMusica');
  assert.equal(c('capa-instagram.jpg'), 'capaIg');
  assert.equal(c('capa-tiktok.jpg'), 'capaTt');
  assert.equal(c('threads.txt'), 'threads');
  assert.equal(c('legenda-instagram.txt'), 'legendaIg');
  assert.equal(c('legenda-tiktok.txt'), 'legendaTt');
  assert.equal(c('creditos.md'), 'creditos');
  assert.equal(c('agenda.md'), 'agenda');
  assert.equal(c('horarios.txt'), 'agenda');
  assert.deepEqual(classificarArquivoPacote('03.png', 'carrossel'), { tipo: 'carrossel', ordem: 3 });
  assert.deepEqual(classificarArquivoPacote('01.png', 'stories'), { tipo: 'stories', ordem: 1 });
  assert.equal(c('outra-coisa.pdf'), 'outro');
});

const ROTEIRO = `---
id: S46-01
titulo: Por que a gente repete o mesmo tipo de relacionamento
plataformas: instagram, tiktok
extras: carrossel, threads, stories
duracao_alvo: instagram 45 s; tiktok 40 s
formato: Jung explica
cta: instagram enviar; tiktok comentar
valido_ate: atemporal
status: rascunho v1          # ou: aprovado
teste: sim                   # só em testes
bruto: sintetico | gravado   # só em testes
outra: ignorar
---
## Ganchos
titulo: isto não é frontmatter
`;

test('frontmatter do roteiro', () => {
  const fm = parseFrontmatterRoteiro(ROTEIRO);
  assert.deepEqual(fm, {
    id: 'S46-01',
    titulo: 'Por que a gente repete o mesmo tipo de relacionamento',
    plataformas: 'instagram, tiktok',
    extras: 'carrossel, threads, stories',
    duracao_alvo: 'instagram 45 s; tiktok 40 s',
    formato: 'Jung explica',
    cta: 'instagram enviar; tiktok comentar',
    valido_ate: 'atemporal',
    status: 'rascunho v1',
    teste: 'sim',
    bruto: 'sintetico | gravado',
  });
  assert.equal(extrairFrontmatter('sem frontmatter'), null);
  assert.equal(extrairFrontmatter('---\nid: X\n'), null);
  // CRLF, BOM e aspas com escapes
  const fm2 = extrairFrontmatter('﻿---\r\nid: S46-01\r\nobservacoes: "postar # na \\"quinta\\""  # c\r\n---\r\n');
  assert.deepEqual(fm2, { id: 'S46-01', observacoes: 'postar # na "quinta"' });
  // linhas indentadas (lista de ajustes) não viram chaves
  const fm3 = extrairFrontmatter('---\nid: S46-01\najustes:\n  - versao: tt\n    pedido: x\nobservacoes: ""\n---');
  assert.deepEqual(fm3, { id: 'S46-01', ajustes: '', observacoes: '' });
});

test('yamlTexto escapa aspas, barras e quebras', () => {
  assert.equal(yamlTexto('a "b" \\ c'), '"a \\"b\\" \\\\ c"');
  assert.equal(yamlTexto('linha 1\nlinha 2\r\nlinha 3'), '"linha 1 linha 2 linha 3"');
  assert.equal(yamlTexto(''), '""');
  assert.equal(yamlTexto(undefined), '""');
});

test('gerador de aprovação: byte a byte', () => {
  const esperado = '---\nid: S46-01\nversao_aprovada: 2\ndecisao: aprovar\nobservacoes: "postar na quinta"\n---\n';
  assert.equal(gerarAprovacao({ id: 'S46-01', versao: 2, observacoes: 'postar na quinta' }), esperado);
  assert.equal(gerarAprovacao({ id: 'S46-01', versao: 2 }),
    '---\nid: S46-01\nversao_aprovada: 2\ndecisao: aprovar\nobservacoes: ""\n---\n');
  assert.throws(() => gerarAprovacao({ id: 'xx', versao: 1 }));
  assert.throws(() => gerarAprovacao({ id: 'S46-01', versao: 0 }));
});

test('gerador de ajustes: byte a byte', () => {
  const esperado = [
    '---',
    'id: S46-01',
    'versao_base: 1',
    'decisao: ajustar',
    'ajustes:',
    '  - versao: tt',
    '    tempo: "0:00-0:03"',
    '    pedido: "deixar o gancho mais impactante"',
    '    como: "texto maior e zoom in na palavra \\"nunca\\""',
    '  - versao: ambas',
    '    tempo: "0:12"',
    '    pedido: "tirar o zoom"',
    'observacoes: "texto livre"',
    '---',
    '',
  ].join('\n');
  const gerado = gerarAjustes({
    id: 'S46-01',
    versaoBase: 1,
    ajustes: [
      { versao: 'tt', tempo: '0:00-0:03', pedido: 'deixar o gancho mais impactante', como: 'texto maior e zoom in na palavra "nunca"' },
      { versao: 'ambas', tempo: '0:12', pedido: 'tirar o zoom', como: '' },
    ],
    observacoes: 'texto livre',
  });
  assert.equal(gerado, esperado);
  assert.equal(Buffer.compare(Buffer.from(gerado, 'utf8'), Buffer.from(esperado, 'utf8')), 0);

  // tempo/como vazios são omitidos; observacoes vazia vira ""
  assert.equal(gerarAjustes({ id: 'T01', versaoBase: 3, ajustes: [{ versao: 'ig', tempo: ' ', pedido: 'a\nb' }] }),
    '---\nid: T01\nversao_base: 3\ndecisao: ajustar\najustes:\n  - versao: ig\n    pedido: "a b"\nobservacoes: ""\n---\n');
  assert.throws(() => gerarAjustes({ id: 'T01', versaoBase: 1, ajustes: [] }));
  assert.throws(() => gerarAjustes({ id: 'T01', versaoBase: 1, ajustes: [{ versao: 'yt', pedido: 'x' }] }));
  assert.throws(() => gerarAjustes({ id: 'T01', versaoBase: 1, ajustes: [{ versao: 'ig', pedido: '  ' }] }));
});

test('markdown simples em blocos', () => {
  const b = blocosMarkdown('# Resumo\nIG: gancho\nmais texto\n\n- um\n- dois\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n');
  assert.deepEqual(b, [
    { tipo: 'titulo', nivel: 1, texto: 'Resumo' },
    { tipo: 'paragrafo', linhas: ['IG: gancho', 'mais texto'] },
    { tipo: 'lista', itens: ['um', 'dois'] },
    { tipo: 'tabela', linhas: [['a', 'b'], ['1', '2']] },
  ]);
});

test('datas no fuso de São Paulo', () => {
  assert.equal(formatarDataHora('2026-11-14T02:30:00.000Z'), '13/11 23:30');
  assert.equal(formatarData('2026-11-14T02:30:00.000Z'), '13/11');
  assert.equal(dataCurta('2026-11-05'), '05/11');
  assert.equal(hojeISO(new Date('2026-11-14T02:30:00Z')), '2026-11-13');
});

test('semana ISO', () => {
  assert.deepEqual(semanaIso(new Date('2026-11-12T15:00:00Z')), { ano: 2026, semana: 46 });
  assert.deepEqual(semanaIso(new Date('2021-01-03T15:00:00Z')), { ano: 2020, semana: 53 });
  assert.deepEqual(semanaIso(new Date('2024-12-30T15:00:00Z')), { ano: 2025, semana: 1 });
  assert.deepEqual(semanaIso(new Date('2026-01-01T15:00:00Z')), { ano: 2026, semana: 1 });
  // segunda 00:30 em SP = segunda 03:30 UTC; domingo 23:30 em SP ainda é a semana anterior
  assert.equal(prefixoSemana(new Date('2026-11-16T02:30:00Z')), 'S46');
  assert.equal(prefixoSemana(new Date('2026-11-16T03:30:00Z')), 'S47');
  assert.equal(prefixoSemana(new Date('2026-01-05T12:00:00Z')), 'S02');
});

test('planilha: colunas por cabeçalho e postados', () => {
  const linhas = [
    ['ID', 'Data do Post', 'Visualizações', 'Retenção média'],
    ['S46-01', '2026-11-12'],
    ['S46-02', ''],
    ['S46-03', 46338],
    ['S46-04', '05/11/2026'],
    [],
  ];
  assert.deepEqual(localizarColunasDesempenho(linhas), { linha: 0, colId: 0, colData: 1 });
  const m = postadosDeLinhas(linhas);
  assert.deepEqual([...m], [['S46-01', '2026-11-12'], ['S46-03', '2026-11-12'], ['S46-04', '2026-11-05']]);
  // colunas fora de ordem
  const m2 = postadosDeLinhas([['visualizacoes', 'data do post', 'id'], [10, '2026-11-01', 'T01']]);
  assert.deepEqual([...m2], [['T01', '2026-11-01']]);
  assert.equal(normalizarDataPost(null), '');
  assert.equal(postadosDeLinhas([['x']]).size, 0);
});

test('tamanhos', () => {
  assert.equal(formatarBytes(500), '500 B');
  assert.equal(formatarBytes(12.3 * 1024 * 1024), '12,3 MB');
  assert.equal(formatarBytes(1.25 * 1024 ** 3), '1,25 GB');
});

test('upload: offsets, pedaços, backoff, ETA', () => {
  assert.equal(PEDACO % (256 * 1024), 0);
  assert.equal(PEDACO, 8 * 1024 * 1024);
  assert.equal(proximoOffset('bytes=0-8388607'), 8388608);
  assert.equal(proximoOffset(null), 0);
  assert.equal(proximoOffset(''), 0);
  assert.deepEqual(intervaloPedaco(0, 20 * 1024 * 1024), { inicio: 0, fim: PEDACO - 1, contentRange: `bytes 0-${PEDACO - 1}/${20 * 1024 * 1024}` });
  // último pedaço menor
  assert.deepEqual(intervaloPedaco(16 * 1024 * 1024, 20 * 1024 * 1024),
    { inicio: 16777216, fim: 20971519, contentRange: 'bytes 16777216-20971519/20971520' });
  assert.equal(rangeConsulta(1000), 'bytes */1000');
  assert.deepEqual([0, 1, 2, 3, 6, 7, 20].map(esperaBackoff), [1000, 2000, 4000, 8000, 60000, 60000, 60000]);
  assert.equal(velocidade([{ t: 0, bytes: 0 }, { t: 2000, bytes: 4_000_000 }]), 2_000_000);
  assert.equal(velocidade([{ t: 0, bytes: 0 }]), 0);
  assert.equal(tempoRestante(4_000_000, 10_000_000, 2_000_000), 3);
  assert.equal(tempoRestante(0, 10, 0), null);
  assert.equal(formatarDuracao(45), '45 s');
  assert.equal(formatarDuracao(125), '2 min 5 s');
  assert.equal(formatarDuracao(3720), '1 h 2 min');
  assert.equal(formatarDuracao(null), '—');
  assert.equal(chaveSessao('S46-01', { name: 'a.MOV', size: 10, lastModified: 5 }), 'motor.upload.S46-01.a.MOV.10.5');
  const agora = Date.now();
  assert.ok(sessaoValida({ uri: 'https://x', data: agora - 1000 }, agora));
  assert.ok(!sessaoValida({ uri: 'https://x', data: agora - 7 * 86400000 }, agora));
  assert.ok(!sessaoValida(null, agora));
});
