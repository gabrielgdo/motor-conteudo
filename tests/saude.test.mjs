// Sinal de vida do motor (js/saude.js): validação do _motor/saude.json, resumo em PT-BR e HTML escapado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerSaude, validarSaude, resumirSaude, htmlSaude, duracao } from '../js/saude.js';

const AGORA = new Date('2026-11-16T10:12:00-03:00');

/* Exemplo do gravador (bin/saude.py do Motor Reels). */
const BASE = {
  versao: 1, atualizado_em: '2026-11-16T10:05:00-03:00', intervalo_s: 300,
  vigia: { estado: 'ok', pausa_ate: null }, rodando: null, fila: 2, ultimo_erro: null,
  coletas: {
    x: { arquivo: 'x 2026-11-16.json', data: '2026-11-16', dias: 0 },
    instagram: { arquivo: 'instagram 2026-11-15.json', data: '2026-11-15', dias: 1 },
    tiktok: null,
  },
  gatilhos: { pedido_busca: false, radar_7h: false, decisoes: true },
  commit: 'ae29602', git_pull_falhou_em: null,
};
const com = (mudar) => { const o = structuredClone(BASE); mudar(o); return JSON.stringify(o); };

test('funcionando: última passada, fila e detalhes', () => {
  const r = lerSaude(JSON.stringify(BASE), AGORA);
  assert.equal(r.ok, true);
  assert.equal(r.tom, 'ok');
  assert.equal(r.titulo, 'Motor funcionando');
  assert.equal(r.frase, 'Última passada às 10h05 · 2 tarefas na fila.');
  assert.equal(r.detalhes[0].texto, 'Coletas do Diretor: X: hoje · Instagram: ontem · TikTok: sem coleta');
  assert.equal(r.detalhes[0].tom, 'alerta'); // TikTok sem coleta
  assert.match(r.detalhes[1].texto, /^Desligado no motor: busca pedida pelo app, busca das 7h \(/);
});

test('sem sinal: passou do intervalo + 10 min', () => {
  const r = lerSaude(JSON.stringify(BASE), new Date('2026-11-16T10:21:00-03:00'));
  assert.equal(r.tom, 'alerta');
  assert.equal(r.titulo, 'Sem sinal do motor');
  assert.match(r.frase, /^Nenhuma notícia há 16 min \(a última foi às 10h05\)/);
  const ontem = lerSaude(JSON.stringify(BASE), new Date('2026-11-17T12:00:00-03:00'));
  assert.match(ontem.frase, /há 1 dia \(a última foi em 16 de nov às 10h05\)/);
});

test('trabalhando: tarefa longa não é "sem sinal" até o limite + 10 min', () => {
  const rodando = com((o) => { o.atualizado_em = '2026-11-16T09:00:00-03:00'; o.rodando = { skill: 'editar', arquivo: 'S47-01.mov', desde: '2026-11-16T09:00:00-03:00', limite_s: 5400 }; });
  const r = lerSaude(rodando, AGORA);
  assert.equal(r.tom, 'espera');
  assert.equal(r.titulo, 'Motor trabalhando');
  assert.equal(r.frase, 'Editando um vídeo (S47-01.mov) desde 9h');
  const tarde = lerSaude(rodando, new Date('2026-11-16T10:41:00-03:00'));
  assert.equal(tarde.tom, 'alerta');
  assert.equal(tarde.titulo, 'Motor parece parado');
});

test('pausas: limite do Claude (espera) e pausa à mão (alerta)', () => {
  const lim = lerSaude(com((o) => { o.vigia = { estado: 'pausa_limite', pausa_ate: '2026-11-16T14:00:00-03:00' }; }), AGORA);
  assert.equal(lim.tom, 'espera');
  assert.equal(lim.frase, 'O limite de uso do Claude acabou; volta sozinho às 14h.');
  const mao = lerSaude(com((o) => { o.vigia = { estado: 'pausado' }; }), AGORA);
  assert.equal(mao.tom, 'alerta');
  assert.equal(mao.titulo, 'Motor pausado');
});

test('erro recente e git pull falho entram nos detalhes; erro velho não', () => {
  const r = lerSaude(com((o) => {
    o.ultimo_erro = { quando: '2026-11-16T09:30:00-03:00', texto: '/editar S47-01 falhou' };
    o.git_pull_falhou_em = '2026-11-16T09:50:00-03:00';
  }), AGORA);
  assert.ok(r.detalhes.some((d) => d.texto === 'Último erro às 9h30: /editar S47-01 falhou'));
  assert.ok(r.detalhes.some((d) => d.texto === 'A atualização do código do motor falhou às 9h50.'));
  const velho = lerSaude(com((o) => { o.ultimo_erro = { quando: '2026-11-14T09:30:00-03:00', texto: 'antigo' }; }), AGORA);
  assert.ok(!velho.detalhes.some((d) => /antigo/.test(d.texto)));
});

test('inválido: JSON quebrado, versão errada, sem data; campos estranhos ignorados', () => {
  assert.deepEqual(validarSaude('{quebrado'), { ok: false, motivo: 'json' });
  assert.deepEqual(validarSaude('[]'), { ok: false, motivo: 'json' });
  assert.deepEqual(validarSaude(com((o) => { o.versao = 2; })), { ok: false, motivo: 'versao' });
  assert.deepEqual(validarSaude(com((o) => { o.atualizado_em = 'ontem'; })), { ok: false, motivo: 'data' });
  const v = validarSaude(com((o) => {
    o.vigia = { estado: 'hackeado' }; o.fila = -3; o.rodando = { skill: 'editar' }; o.coletas.x = { dias: 'muitos' }; o.extra = 'x';
  }));
  assert.equal(v.ok, true);
  assert.equal(v.dados.vigia.estado, 'ok');
  assert.equal(v.dados.fila, null);
  assert.equal(v.dados.rodando, null); // sem "desde" válido
  assert.equal(v.dados.coletas.x, null);
});

test('HTML: escapa o texto do arquivo, some sem arquivo, avisa falha de leitura', () => {
  const r = resumirSaude(validarSaude(com((o) => { o.ultimo_erro = { quando: '2026-11-16T10:00:00-03:00', texto: '<img src=x onerror=alert(1)>' }; })).dados, AGORA);
  const h = htmlSaude({ fase: 'ok', saude: r });
  assert.ok(!h.includes('<img'));
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.match(h, /Motor funcionando/);
  assert.match(h, /<details class="andamento-mais">/);
  assert.equal(htmlSaude({ fase: 'carregando' }), '');
  assert.equal(htmlSaude({ fase: 'sem-arquivo' }), '');
  assert.match(htmlSaude({ fase: 'indisponivel' }), /Não consegui ler o sinal de vida agora/);
  const alerta = htmlSaude({ fase: 'ok', saude: resumirSaude(validarSaude(JSON.stringify(BASE)).dados, new Date('2026-11-16T12:00:00-03:00')) });
  assert.match(alerta, /role="status"/);
  assert.ok(!/%/.test(h), 'sem percentuais');
});

test('duracao', () => {
  assert.equal(duracao(75 * 1000), '1 min');
  assert.equal(duracao(3 * 3600 * 1000 + 20 * 60 * 1000), '3 h');
  assert.equal(duracao(26 * 3600 * 1000), '1 dia');
  assert.equal(duracao(50 * 3600 * 1000), '2 dias');
});
