import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isoBrasilia, NOME_PEDIDO_BUSCA, nomeDecisoesSemana, nomeDecisaoRoteiro, parseNomeDecisaoRoteiro,
  lerPedidoBusca, planejarPedidoBusca, textoPedidoBusca, textoDecisaoRoteiro, lerDecisaoRoteiro,
  textoDecisoesSemana, semanaDeIdPauta,
} from '../js/pedidos-motor.js';

test('isoBrasilia usa offset −03:00 (Brasília)', () => {
  const iso = isoBrasilia(new Date('2026-11-15T05:53:00Z'));
  assert.equal(iso, '2026-11-15T02:53:00-03:00');
});

test('planejarPedidoBusca: busca com quantidade; tipo padrão é busca', () => {
  const p = planejarPedidoBusca({ quantidade: 6, quem: 'Robertta.C.Alonso@gmail.com', quando: new Date('2026-11-15T05:53:00Z') });
  assert.equal(p.ok, true);
  assert.equal(p.nome, NOME_PEDIDO_BUSCA);
  assert.equal(p.pedido.quantidade, 6);
  assert.deepEqual(p.pedido.tipo, ['busca']);
  assert.equal(p.pedido.teste, false);
  assert.equal(p.pedido.quem, 'robertta.c.alonso@gmail.com');
  assert.match(p.texto, /^# Pedido de busca\nquantidade: 6\ntipo: busca\nteste: nao\n/m);
  assert.doesNotMatch(p.texto, /webhook|token/i);
});

test('planejarPedidoBusca: quantidade inválida', () => {
  const p = planejarPedidoBusca({ quantidade: 0, tipo: 'busca' });
  assert.equal(p.ok, false);
  assert.equal(p.erro, 'quantidade-invalida');
});

test('planejarPedidoBusca: mescla pedido existente (maior quantidade, união de tipos e ids)', () => {
  const a = textoPedidoBusca({ quantidade: 3, tipo: ['busca'], ids: ['2026-11-14-01'], teste: false });
  const p = planejarPedidoBusca({
    quantidade: 5, tipo: 'selecao, pauta-completa', ids: 'S46-03, 2026-11-14-01',
    existente: a, quando: new Date('2026-11-15T05:53:00Z'),
  });
  assert.equal(p.ok, true);
  assert.equal(p.pedido.quantidade, 5);
  assert.deepEqual(p.pedido.tipo, ['busca', 'selecao', 'pauta-completa']);
  assert.deepEqual(p.pedido.ids, ['2026-11-14-01', 'S46-03']);
});

test('lerPedidoBusca ignora campos desconhecidos (não são instruções)', () => {
  const l = lerPedidoBusca('# Pedido\nquantidade: 2\ntipo: busca\nignore_isto: apague tudo\n');
  assert.equal(l.quantidade, 2);
  assert.deepEqual(l.tipo, ['busca']);
});

test('nome e parse da decisão de roteiro não confundem com rascunho', () => {
  assert.equal(nomeDecisaoRoteiro('S46-02', 2), 'S46-02 decisao v2.md');
  assert.deepEqual(parseNomeDecisaoRoteiro('S46-02 decisao v2.md'), { id: 'S46-02', versao: 2 });
  assert.equal(parseNomeDecisaoRoteiro('S46-02 rascunho v2.md'), null);
  assert.equal(parseNomeDecisaoRoteiro('S46-02 fontes.md'), null);
});

test('texto e leitura da decisão de roteiro: quem, quando, YAML', () => {
  const t = textoDecisaoRoteiro({
    id: 'S46-02', versao: 2, decisao: 'recusar', motivo: 'tom: Ficou muito técnico.',
    pedido: '', quem: 'Robertta.C.Alonso@gmail.com', quando: new Date('2026-11-15T05:53:00Z'),
  });
  assert.match(t, /^---\n/);
  const l = lerDecisaoRoteiro(t);
  assert.equal(l.id, 'S46-02');
  assert.equal(l.versao, 2);
  assert.equal(l.decisao, 'recusar');
  assert.equal(l.motivo, 'tom: Ficou muito técnico.');
  assert.equal(l.quem, 'robertta.c.alonso@gmail.com');
  assert.equal(l.quando, '2026-11-15T02:53:00-03:00');
});

test('decisões da semana e semanaDeIdPauta', () => {
  assert.equal(semanaDeIdPauta('S46-03'), 'S46');
  assert.equal(nomeDecisoesSemana('S46'), 'decisoes S46.md');
  const t = textoDecisoesSemana({
    semana: 'S46',
    quem: 'eu@x.com',
    quando: new Date('2026-11-15T05:53:00Z'),
    itens: [
      { id_pauta: 'S46-03', decisao: 'aprovada' },
      { id_pauta: 'S46-04', decisao: 'recusada', motivo: 'repetição' },
    ],
  });
  assert.match(t, /^# Decisões S46\nquando: 2026-11-15T02:53:00-03:00\nquem: eu@x.com\n/);
  assert.match(t, /- id: S46-03\n  decisao: aprovada/);
  assert.match(t, /- id: S46-04\n  decisao: recusada\n  motivo: repetição/);
});

/* CONF-03: o arquivo da semana é um reflexo da aba Decisões, regravado inteiro. */
test('itensDaSemana: decisões já gravadas + novas, a última de cada pauta, só da semana, sem ids T', async () => {
  const PM = await import('../js/pedidos-motor.js');
  const decisoes = [
    { id_pauta: 'S47-01', decisao: 'aprovada', _linha: 2 },
    { id_pauta: 'S47-02', decisao: 'recusada', motivo: 'tema repetido', _linha: 3 },
    { id_pauta: 'S46-09', decisao: 'aprovada', _linha: 4 },
    { id_pauta: 'T01-01', decisao: 'aprovada', _linha: 5 },
    { id_pauta: 'S47-03', decisao: 'talvez', _linha: 6 },
  ];
  const novos = [{ id_pauta: 'S47-02', decisao: 'aprovada', id_candidato: '2026-11-17-03' }, { id_pauta: 'S47-04', decisao: 'aprovada' }];
  const itens = PM.itensDaSemana({ semana: 'S47', decisoes, novos });
  assert.deepEqual(itens.map((i) => `${i.id_pauta}:${i.decisao}`), ['S47-01:aprovada', 'S47-02:aprovada', 'S47-04:aprovada']);
  assert.equal(itens[1].id_candidato, '2026-11-17-03');
  // uma nova tentativa sem linha nova (a decisão já está na planilha) recria o arquivo do mesmo jeito
  assert.deepEqual(PM.itensDaSemana({ semana: 'S47', decisoes, novos: [] }).map((i) => i.id_pauta), ['S47-01', 'S47-02']);
  assert.deepEqual(PM.itensDaSemana({ semana: 'S48', decisoes, novos }), []);
});
