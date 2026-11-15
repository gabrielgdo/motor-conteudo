// Leitor do andamento do motor (js/andamento.js): validação, resumo em PT-BR e HTML escapado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerAndamento, validarAndamento, resumirAndamento, htmlAndamento } from '../js/andamento.js';

const AGORA = new Date('2026-11-14T23:30:00-03:00');

/* Exemplo real do gravador (caso S46-01: edição pausada na checagem de ética). */
const S46_01 = {
  versao: 1, id: 'S46-01', atualizado_em: '2026-11-14T23:19:43-03:00', atual: null,
  etapas: [{
    etapa: 'editar', arquivo: 'S46-01.mp4', estado: 'parou', versao: null,
    inicio: '2026-11-14T23:19:43-03:00', fim: '2026-11-14T23:19:43-03:00', tentativa: 1, de: 3, duracao_s: 0,
    erro: 'edição pausada na checagem de ética: quem aparece no bruto não parece ser a Robertta',
  }],
  eventos: [
    { evento: 'recebido', id: 'S46-01', resumo: 'bruto S46-01.mp4 reconhecido como S46-01', quando: '2026-11-14T23:19:40-03:00' },
    { evento: 'erro', id: 'S46-01', resumo: 'edição pausada na checagem de ética: quem aparece no bruto não parece ser a Robertta', erro: 'O bruto mostra outra pessoa.', quando: '2026-11-14T23:19:43-03:00' },
  ],
};
const json = (o) => JSON.stringify(o);
const com = (mudar) => { const o = structuredClone(S46_01); mudar(o); return json(o); };

test('andamento válido: S46-01 parou na checagem de ética', () => {
  const r = lerAndamento(json(S46_01), 'S46-01', AGORA);
  assert.equal(r.ok, true);
  assert.equal(r.resumo.estado, 'parou');
  assert.equal(r.resumo.etapa, 'Edição');
  assert.equal(r.resumo.texto, 'Parou: edição pausada na checagem de ética: quem aparece no bruto não parece ser a Robertta');
  assert.equal(r.emAndamento, false);
  assert.equal(r.atualizado, 'atualizado às 23h19');
  assert.equal(r.etapas.length, 1);
  assert.equal(r.etapas[0].rotulo, 'Parou');
  assert.equal(r.etapas[0].horario, '23h19');
  assert.deepEqual(r.eventos.map((e) => e.evento), ['erro', 'recebido']); // mais novo primeiro
  assert.ok(!/%/.test(JSON.stringify(r)), 'sem percentuais');
});

test('inválido: JSON quebrado, não objeto, sem data', () => {
  assert.deepEqual(lerAndamento('{"versao":1,', 'S46-01', AGORA), { ok: false, motivo: 'json' });
  assert.deepEqual(lerAndamento('[1,2]', 'S46-01', AGORA), { ok: false, motivo: 'json' });
  assert.deepEqual(lerAndamento('null', 'S46-01', AGORA), { ok: false, motivo: 'json' });
  assert.equal(lerAndamento(com((o) => { o.atualizado_em = 'ontem'; }), 'S46-01', AGORA).motivo, 'data');
  assert.equal(lerAndamento(com((o) => { delete o.atualizado_em; }), 'S46-01', AGORA).motivo, 'data');
});

test('id trocado é recusado', () => {
  assert.deepEqual(lerAndamento(json(S46_01), 'S46-02', AGORA), { ok: false, motivo: 'id' });
  assert.equal(lerAndamento(com((o) => { delete o.id; }), 'S46-01', AGORA).motivo, 'id');
});

test('versão desconhecida é recusada', () => {
  assert.equal(lerAndamento(com((o) => { o.versao = 2; }), 'S46-01', AGORA).motivo, 'versao');
  assert.equal(lerAndamento(com((o) => { o.versao = '1'; }), 'S46-01', AGORA).motivo, 'versao');
});

test('estado desconhecido é descartado (etapa, atual) e datas ruins também', () => {
  const v = validarAndamento(com((o) => {
    o.etapas.push({ etapa: 'editar', estado: 'limpo', inicio: '2026-11-14T23:20:00-03:00' });
    o.etapas.push({ etapa: 'editar', estado: 'ok', inicio: 'depois', fim: 'xx' });
    o.atual = { etapa: 'editar', estado: 'pensando', desde: '2026-11-14T23:21:00-03:00' };
    o.eventos.push({ evento: 'previa', id: 'S47-01', quando: '2026-11-14T23:22:00-03:00' }); // outro id
    o.eventos.push({ evento: 'previa', id: 'S46-01', quando: 'agora' });
  }), 'S46-01');
  assert.equal(v.ok, true);
  assert.equal(v.dados.etapas.length, 1);
  assert.equal(v.dados.atual, null);
  assert.equal(v.dados.eventos.length, 2);
});

test('rodando: texto humano e "parece parado" passado o limite + 10 min', () => {
  const rodando = com((o) => {
    o.atual = { etapa: 'editar', arquivo: 'S46-01.mp4', estado: 'rodando', desde: '2026-11-14T22:46:00-03:00', tentativa: 1, de: 3, limite_s: 5400 };
  });
  const cedo = lerAndamento(rodando, 'S46-01', new Date('2026-11-14T23:00:00-03:00'));
  assert.equal(cedo.resumo.texto, 'Editando · desde 22h46 · tentativa 1 de 3');
  assert.equal(cedo.resumo.pareceParado, false);
  assert.equal(cedo.emAndamento, true);
  // 22h46 + 90 min + 10 min = 0h26 do dia 15: um minuto depois parece parado
  const tarde = lerAndamento(rodando, 'S46-01', new Date('2026-11-15T00:27:00-03:00'));
  assert.equal(tarde.resumo.pareceParado, true);
  assert.match(tarde.resumo.texto, /^Editando · desde 14 de nov, 22h46 · tentativa 1 de 3 · parece parado$/);
  assert.equal(tarde.resumo.tom, 'alerta');
  const noLimite = lerAndamento(rodando, 'S46-01', new Date('2026-11-15T00:25:00-03:00'));
  assert.equal(noLimite.resumo.pareceParado, false);
});

test('aguardando, falhou, desistiu, concluída', () => {
  const ag = lerAndamento(com((o) => { o.atual = { etapa: 'editar', arquivo: 'S46-01.mp4', estado: 'aguardando', desde: '2026-11-14T22:40:00-03:00' }; }), 'S46-01', AGORA);
  assert.equal(ag.resumo.texto, 'Aguardando o upload terminar · desde 22h40');
  assert.equal(ag.emAndamento, true);
  const etapa = (e) => lerAndamento(com((o) => { o.etapas.push({ etapa: 'editar', arquivo: 'S46-01.mp4', inicio: '2026-11-14T22:46:00-03:00', fim: '2026-11-14T22:51:00-03:00', tentativa: 2, de: 3, ...e }); }), 'S46-01', AGORA);
  assert.equal(etapa({ estado: 'falhou', erro: 'tempo esgotado (5400s)' }).resumo.texto, 'Falhou (tentativa 2 de 3): tempo esgotado (5400s)');
  assert.equal(etapa({ estado: 'desistiu', tentativa: 3 }).resumo.texto, 'Desistiu depois de 3 tentativas');
  const ok = etapa({ estado: 'ok', erro: '' });
  assert.equal(ok.resumo.texto, 'Concluída às 22h51');
  assert.equal(ok.emAndamento, false);
});

test('render: escapa o HTML vindo do arquivo; estados sem arquivo e erro', () => {
  const mau = com((o) => {
    o.etapas[0].erro = '<img src=x onerror=alert(1)>';
    o.etapas[0].etapa = '<b>editar</b>';
    o.eventos[1].resumo = '"><script>alert(2)</script>';
  });
  const r = resumirAndamento(validarAndamento(mau, 'S46-01').dados, AGORA);
  const html = htmlAndamento({ fase: 'ok', andamento: r }, 'S46-01');
  assert.ok(!/<img|<script|<b>/.test(html), html);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /atualizado às 23h19/);

  assert.match(htmlAndamento({ fase: 'sem-arquivo' }), /O motor ainda não registrou andamento para este vídeo/);
  const erro = htmlAndamento({ fase: 'indisponivel' }, 'S46-01"><x');
  assert.match(erro, /Andamento indisponível agora/);
  assert.match(erro, /<button type="button"[^>]*data-acao="andamento-tentar"[^>]*>Tentar de novo<\/button>/);
  assert.ok(!erro.includes('"><x'));
});

test('a tela de Vídeos usa o andamento real, e o sw guarda js/andamento.js', () => {
  const videos = readFileSync(new URL('../js/telas/videos.js', import.meta.url), 'utf8');
  assert.ok(!videos.includes('o motor ainda não publica o andamento no app'));
  assert.match(videos, /Integra\.motor\.andamento\(id\)/);
  assert.match(videos, /document\.visibilityState === 'visible'/);
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'\.\/js\/andamento\.js'/);
});
