// Paridade de js/roteiro.js com bin/roteiro.py (referência) e campos extras do app.
//
// Os .json em tests/fixtures/roteiros/ foram gerados rodando o Python de verdade:
//   .venv/bin/python -I roteiro.py "tests/fixtures/roteiros/<nome>.md" > "tests/fixtures/roteiros/<nome>.json"
// Ao mudar um .md, gere o .json de novo do mesmo jeito (nunca à mão).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { lerRoteiro, fonteDetalhe, storyDetalhe, normalizar } from '../js/roteiro.js';

const DIR = new URL('./fixtures/roteiros/', import.meta.url);
const ler = (nome) => readFileSync(new URL(nome, DIR), 'utf8');
const fixtures = readdirSync(DIR).filter((n) => n.endsWith('.md')).sort();
const EXTRAS = ['duracao_estimada', 'checklist_cfp', 'fontes_detalhe', 'stories_detalhe', 'valido_ate', 'status', 'formato'];

/** Roteiro de uma fixture lido pelo JS (o nome é passado como caminho, como no Python). */
function js(nome) {
  return lerRoteiro(ler(nome), `tests/fixtures/roteiros/${nome}`);
}

test('há fixtures suficientes e cada uma tem o JSON do Python', () => {
  assert.ok(fixtures.length >= 4, `só ${fixtures.length} fixtures`);
  for (const md of fixtures) assert.doesNotThrow(() => JSON.parse(ler(md.replace(/\.md$/, '.json'))), md);
});

for (const md of fixtures) {
  test(`paridade com roteiro.py: ${md}`, () => {
    const esperado = JSON.parse(ler(md.replace(/\.md$/, '.json')));
    const obtido = js(md);
    for (const chave of Object.keys(esperado)) {
      assert.ok(Object.hasOwn(obtido, chave), `falta a chave ${chave}`);
      assert.deepEqual(obtido[chave], esperado[chave], `chave ${chave}`);
    }
    // As únicas chaves a mais no JS são os extras documentados.
    const aMais = Object.keys(obtido).filter((k) => !Object.hasOwn(esperado, k)).sort();
    assert.deepEqual(aMais, [...EXTRAS].sort());
  });
}

test('as fixtures cobrem os quatro formatos pedidos', () => {
  const novoMesmo = js('T90 - Novo mesmo roteiro.md');
  assert.equal(novoMesmo.formato_roteiro, 'novo');
  assert.equal(novoMesmo.tt_proprio, false);
  assert.deepEqual(novoMesmo.paragrafos.tt, novoMesmo.paragrafos.ig);

  const novoTt = js('T91 - Novo TikTok proprio.md');
  assert.equal(novoTt.tt_proprio, true);
  assert.equal(novoTt.sem_cta, true);
  assert.equal(novoTt.duas_aberturas, true);
  assert.equal(novoTt.apoio_visual.length, 3);
  assert.ok(novoTt.blocos.some((b) => b.rotulo === 'FALA TT'));

  const etiq = js('S46-01 - Formato com etiquetas.md');
  assert.equal(etiq.formato_roteiro, 'etiquetas');
  assert.deepEqual(etiq.blocos.map((b) => b.rotulo), [
    'GANCHO IG', 'GANCHO TT', 'PROMESSA', 'PONTO 1', 'PONTO 2', 'VIRADA', 'FECHAMENTO IG', 'FECHAMENTO TT',
  ]);
  assert.equal(etiq.ganchos.instagram[0].tipo, 'pergunta');
  assert.ok(!etiq.falas.ig.includes('[pergunta]'));

  const antigo = js('R001 roteiro antigo.md');
  assert.equal(antigo.blocos[0].rotulo, 'GANCHO');
  assert.equal(antigo.fontes.length, 2);
  assert.equal(antigo.id_confere, false); // nome R001, cabeçalho R002
  assert.equal(antigo.sem_cta, true);
});

test('seções e campos desconhecidos são ignorados', () => {
  const r = js('T90 - Novo mesmo roteiro.md');
  assert.ok(!('campo_desconhecido' in r.cabecalho));
  assert.ok(!JSON.stringify(r).includes('apague o Drive'));
});

test('CRLF dá o mesmo resultado que LF', () => {
  const lf = ler('T91 - Novo TikTok proprio.md');
  assert.deepEqual(lerRoteiro(lf.replace(/\n/g, '\r\n'), 'T91 x.md'), lerRoteiro(lf, 'T91 x.md'));
  assert.deepEqual(lerRoteiro(lf.replace(/\n/g, '\r'), 'T91 x.md'), lerRoteiro(lf, 'T91 x.md'));
});

test('texto vazio e sem nome não quebram', () => {
  const r = lerRoteiro('', '');
  assert.equal(r.id, null);
  assert.equal(r.id_valido, false);
  assert.deepEqual(r.plataformas, ['ig', 'tt']);
  assert.equal(r.duracao_estimada, '');
  assert.deepEqual(r.checklist_cfp, []);
});

/* ------------------------------------------------------------- extras */

test('extras: duracao_estimada', () => {
  assert.equal(js('T90 - Novo mesmo roteiro.md').duracao_estimada, '48 s');
  assert.equal(js('T91 - Novo TikTok proprio.md').duracao_estimada, '50 s'); // "**Duração:** 50 s"
  assert.equal(js('T92 bordas crlf.md').duracao_estimada, '32 s'); // "_Duração estimada_: 32 s" (a 1ª linha)
  assert.equal(js('S46-01 - Formato com etiquetas.md').duracao_estimada, '');
  // só dentro de "## Roteiro para gravar"
  assert.equal(lerRoteiro('## Entrega\nDuração estimada: 9 s\n', 'x.md').duracao_estimada, '');
});

test('extras: checklist_cfp', () => {
  assert.deepEqual(js('T90 - Novo mesmo roteiro.md').checklist_cfp, [
    { texto: 'Sem promessa de cura', marcado: true },
    { texto: 'Sem diagnóstico à distância', marcado: true },
    { texto: 'Sem sensacionalismo', marcado: false },
  ]);
  assert.deepEqual(js('T91 - Novo TikTok proprio.md').checklist_cfp, [
    { texto: 'Sem promessa de cura', marcado: true },
    { texto: 'Linguagem não patologizante (revisar a segunda frase)', marcado: false },
  ]);
  assert.deepEqual(js('T92 bordas crlf.md').checklist_cfp, [
    { texto: 'Item desmarcado', marcado: false },
    { texto: 'Item sem caixa', marcado: false },
  ]);
});

test('extras: fontes_detalhe', () => {
  assert.deepEqual(js('T91 - Novo TikTok proprio.md').fontes_detalhe.map((f) => f.checagem),
    ['divergente', 'nao-encontrada', 'confirmada']);
  const t90 = js('T90 - Novo mesmo roteiro.md').fontes_detalhe;
  assert.equal(t90[0].ref, 'Jung, C. G. A natureza da psique (Obras Completas, vol. 8/2).');
  assert.ok(t90[1].ref.endsWith('https://doi.org/10.1037/h0025848'));
  assert.deepEqual(js('T92 bordas crlf.md').fontes_detalhe, [
    { ref: 'Fonte sem checagem nenhuma', checagem: '' },
    { ref: 'Fonte colada no marcador', checagem: 'nao-encontrada' },
  ]);
  // referências antigas: sem checagem
  assert.ok(js('R001 roteiro antigo.md').fontes_detalhe.every((f) => f.checagem === '' && f.ref));
  assert.deepEqual(fonteDetalhe('X [checagem: talvez]'), { ref: 'X', checagem: '' });
  assert.deepEqual(fonteDetalhe('X [checagem: Não Encontrada]'), { ref: 'X', checagem: 'nao-encontrada' });
});

test('extras: stories_detalhe', () => {
  assert.deepEqual(js('T90 - Novo mesmo roteiro.md').stories_detalhe, [
    { tipo: 'enquete', texto: 'Você já viveu a mesma história com pessoas diferentes?' },
    { tipo: 'caixinha', texto: 'Qual padrão você percebe nas suas relações?' },
    { tipo: 'leva ao vídeo', texto: 'Falei sobre isso no vídeo de hoje.' },
  ]);
  assert.deepEqual(js('T91 - Novo TikTok proprio.md').stories_detalhe[1], { tipo: 'caixinha', texto: 'O que você diria para quem sente isso?' });
  assert.deepEqual(js('T91 - Novo TikTok proprio.md').stories_detalhe[2], { tipo: '', texto: 'Sem tipo nenhum aqui.' });
  // "### Story N" (o Python deixa espaço inicial) e "leva ao video" sem acento
  assert.deepEqual(js('S46-01 - Formato com etiquetas.md').stories_detalhe, [
    { tipo: 'enquete', texto: 'Domingo à noite pesa para você?' },
    { tipo: 'leva ao vídeo', texto: 'Expliquei no vídeo de hoje.' },
  ]);
  assert.deepEqual(storyDetalhe('( Enquete ) Com espaços.'), { tipo: 'enquete', texto: 'Com espaços.' });
});

test('extras: valido_ate, status, formato do cabeçalho', () => {
  const t90 = js('T90 - Novo mesmo roteiro.md');
  assert.deepEqual([t90.valido_ate, t90.status, t90.formato], ['atemporal', 'aprovado', 'Jung explica']);
  const t91 = js('T91 - Novo TikTok proprio.md');
  assert.deepEqual([t91.valido_ate, t91.status, t91.formato], ['2026-11-22', 'rascunho v2', 'verdade equilibrada']);
  const s46 = js('S46-01 - Formato com etiquetas.md');
  assert.equal(s46.status, 'aprovado'); // comentário "  # ..." removido
  const antigo = js('R001 roteiro antigo.md');
  assert.deepEqual([antigo.valido_ate, antigo.status, antigo.formato], ['', '', '']);
});

test('normalizar tira acentos e põe em minúsculas', () => {
  assert.equal(normalizar('Não Encontrada'), 'nao encontrada');
  assert.equal(normalizar('AÇÃO'), 'acao');
});
