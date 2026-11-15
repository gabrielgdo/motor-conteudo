// Envios ao Roteirista (Ponto 4, js/envios.js) e o que aparece na bandeja de Pautas e na seção
// "Com o Roteirista" de Roteiros. Sem DOM e sem rede; datas fixas; textos fictícios. A linha real
// do Radar depois de concluída tem o resumo SOBRESCRITO ("pauta S46-01 (lote S46-manual-1) enviada
// ao Roteirista; …"): os ids saem da regex no resumo e do id_lote cruzado com a Seleção.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED, FLAGS } from '../js/config.js';
FLAGS.ponte = false;
import { lerDataHora } from '../js/parse.js';
import { lerExecucoes, COLUNAS_EXECUCOES } from '../js/controle.js';
import { lerSelecao, lerDecisoes } from '../js/selecao.js';
import {
  enviosAoRoteirista, idsNoTexto, idsDaLinha, chaveIdemEnvio, textoDoEnvio, podeEnviar, aCaminho, mapaDeEnvios, ESTADOS_ENVIO,
} from '../js/envios.js';
import { htmlPautas, aprovadasParaEnviar } from '../js/telas/pautas.js';
import { htmlComRoteirista } from '../js/telas/roteiros.js';

const ROBERTTA = ALLOWED[0];
const AGORA = lerDataHora('2026-11-14 23:00');
const MAL = '<img src=x onerror=alert(1)>';

const CAB_SELECAO = ['id_pauta', 'titulo', 'tema', 'rede', 'nota_v2', 'status', 'id_lote'];
const pauta = (o) => CAB_SELECAO.map((c) => ({ titulo: `Pauta ${o.id_pauta}`, tema: 't', rede: 'ig', nota_v2: '80', status: 'aprovada', id_lote: 'S46-manual-1', ...o })[c] ?? '');
const CAB_DECISOES = ['semana', 'pauta', 'decisao', 'motivo', 'id_pauta', 'rede', 'id_candidato', 'id_lote', 'data', 'quem', 'origem'];

function dados(pautas, decisoes = []) {
  const selecao = lerSelecao([CAB_SELECAO, ...pautas.map(pauta)]);
  const dec = lerDecisoes([CAB_DECISOES, ...decisoes.map((o) => CAB_DECISOES.map((c) => ({ semana: 'S46', data: '2026-11-14 20:00', origem: 'app', ...o })[c] ?? ''))]);
  return { fase: 'pronto', selecao, decisoes: dec, colunasProntas: true };
}
const linha = (o) => ({ bot: 'radar', rotina: 'radar-enviar', origem: 'manual-app', quem: ROBERTTA, teste: 'não', id_lote: 'S46-manual-1', ...o });
const execs = (...ls) => lerExecucoes([COLUNAS_EXECUCOES, ...ls.map((o) => COLUNAS_EXECUCOES.map((c) => linha(o)[c] ?? ''))]).execucoes;
const RESUMO_RADAR = 'pauta S46-01 (lote S46-manual-1) enviada ao Roteirista; aprovação confirmada em Decisões (S46-01 aprovada)';

const D = dados([{ id_pauta: 'S46-01' }, { id_pauta: 'S46-02' }, { id_pauta: 'S46-03', status: 'recusada' }]);
const estadoDe = (env, id) => mapaDeEnvios(env).get(id)?.estado;

test('ids: regex S\\d{2}-\\d{2} no resumo da ponte e no texto sobrescrito pelo Radar (sem pegar o lote)', () => {
  assert.deepEqual(idsNoTexto('enviar S46-01, S46-02'), ['S46-01', 'S46-02']);
  assert.deepEqual(idsNoTexto(RESUMO_RADAR), ['S46-01']);
  assert.deepEqual(idsNoTexto('lote S46-manual-1'), []);
  assert.deepEqual(idsNoTexto('S46-012 XS46-01'), []);
  // Sem id no texto: id_lote cruzado com a Seleção, só as aprovadas/enviadas (a recusada S46-03 fica fora)
  const [l] = execs({ id_execucao: 'EX-1', status: 'ok', resumo: 'concluído', inicio: '2026-11-14 21:58' });
  assert.deepEqual(idsDaLinha(l, { selecao: D.selecao, decisoes: D.decisoes }), ['S46-01', 'S46-02']);
});

test('estados: na-fila, processando, parece-travada (≥ 2 h), enviada, falhou (com texto), rascunho-chegou', () => {
  const cenarios = [
    [{ status: 'pedido', resumo: 'enviar S46-01', inicio: '2026-11-14 21:58' }, 'na-fila'],
    [{ status: 'rodando', resumo: 'enviar S46-01', inicio: '2026-11-14 22:30' }, 'processando'],
    [{ status: 'rodando', resumo: 'enviar S46-01', inicio: '2026-11-14 20:30' }, 'parece-travada'],
    [{ status: 'pedido', resumo: 'enviar S46-01', inicio: '' }, 'parece-travada'],
    [{ status: 'ok', resumo: RESUMO_RADAR, inicio: '2026-11-14 21:58', fim: '2026-11-14 22:10' }, 'enviada'],
    [{ status: 'erro', resumo: 'enviar S46-01', erro: 'Roteirista fora do ar', inicio: '2026-11-14 21:58' }, 'falhou'],
    [{ status: 'parcial', resumo: 'enviar S46-01', inicio: '2026-11-14 21:58' }, 'falhou'],
    [{ status: 'travada', resumo: 'enviar S46-01', inicio: '2026-11-14 18:00' }, 'falhou'],
  ];
  for (const [l, esperado] of cenarios) {
    const env = enviosAoRoteirista({ ...D, execucoes: execs({ id_execucao: 'EX-1', ...l }), agora: AGORA });
    assert.equal(estadoDe(env, 'S46-01'), esperado, JSON.stringify(l));
    assert.ok(ESTADOS_ENVIO.includes(esperado));
  }
  const erro = enviosAoRoteirista({ ...D, execucoes: execs({ id_execucao: 'EX-1', status: 'erro', resumo: 'enviar S46-01', erro: 'Roteirista fora do ar', inicio: '2026-11-14 21:58' }), agora: AGORA });
  assert.equal(textoDoEnvio(mapaDeEnvios(erro).get('S46-01')), 'Falhou: Roteirista fora do ar');
  assert.equal(textoDoEnvio(enviosAoRoteirista({ ...D, execucoes: execs({ status: 'pedido', resumo: 'enviar S46-01', inicio: '2026-11-14 21:58' }), agora: AGORA })[0]), 'Na fila desde 21h58');
  // Seleção "enviada ao Roteirista", sem linha: enviada. Com projeto no Drive: o rascunho chegou.
  const d2 = dados([{ id_pauta: 'S46-04', status: 'enviada ao Roteirista' }]);
  assert.equal(estadoDe(enviosAoRoteirista({ ...d2, agora: AGORA }), 'S46-04'), 'enviada');
  assert.equal(estadoDe(enviosAoRoteirista({ ...d2, projetos: [{ id: 'S46-04' }], agora: AGORA }), 'S46-04'), 'rascunho-chegou');
  assert.equal(estadoDe(enviosAoRoteirista({ ...D, execucoes: execs({ status: 'ok', resumo: RESUMO_RADAR, inicio: '2026-11-14 21:58' }), projetos: ['S46-01'], agora: AGORA }), 'S46-01'), 'rascunho-chegou');
});

test('ok nunca volta: um erro depois de um ok não devolve a pauta; linhas de teste não contam', () => {
  const ex = execs(
    { id_execucao: 'EX-1', status: 'ok', resumo: RESUMO_RADAR, inicio: '2026-11-14 20:00' },
    { id_execucao: 'EX-2', status: 'erro', resumo: 'enviar S46-01', inicio: '2026-11-14 21:00' },
    { id_execucao: 'EX-3', status: 'pedido', resumo: 'enviar S46-02', inicio: '2026-11-14 22:50', teste: 'sim' },
  );
  const env = enviosAoRoteirista({ ...D, execucoes: ex, agora: AGORA });
  assert.equal(estadoDe(env, 'S46-01'), 'enviada');
  assert.equal(estadoDe(env, 'S46-02'), undefined);
  assert.deepEqual(aprovadasParaEnviar(D.selecao, D.decisoes, { envios: env }).map((p) => p.id_pauta), ['S46-02']);
});

test('aprovadasParaEnviar: só aprovadas sem envio ativo/concluído; falhou volta a ser elegível', () => {
  assert.deepEqual(aprovadasParaEnviar(D.selecao, D.decisoes).map((p) => p.id_pauta), ['S46-01', 'S46-02']); // sem envios: como antes
  const pedido = enviosAoRoteirista({ ...D, execucoes: execs({ status: 'pedido', resumo: 'enviar S46-01, S46-02', inicio: '2026-11-14 22:50' }), agora: AGORA });
  assert.deepEqual(aprovadasParaEnviar(D.selecao, D.decisoes, { envios: pedido }), []);
  const falhou = enviosAoRoteirista({ ...D, execucoes: execs({ status: 'erro', resumo: 'enviar S46-01', inicio: '2026-11-14 22:50' }), agora: AGORA });
  assert.deepEqual(aprovadasParaEnviar(D.selecao, D.decisoes, { envios: falhou }).map((p) => p.id_pauta), ['S46-01', 'S46-02']);
  assert.equal(podeEnviar(undefined), true);
  assert.equal(podeEnviar({ estado: 'falhou' }), true);
  for (const e of ['na-fila', 'processando', 'parece-travada', 'enviada', 'rascunho-chegou']) assert.equal(podeEnviar({ estado: e }), false, e);
});

test('registro otimista: na fila logo depois do envio, até a linha da mesma chave aparecer (também a de teste)', () => {
  const desde = lerDataHora('2026-11-14 22:55').getTime();
  const locais = { 'S46-01': { desde, chave: 'radar-enviar-S46-01-1' } };
  const env = enviosAoRoteirista({ ...D, execucoes: [], locais, agora: AGORA });
  assert.equal(estadoDe(env, 'S46-01'), 'na-fila');
  assert.ok(mapaDeEnvios(env).get('S46-01').otimista);
  // A linha de teste com a mesma chave chegou: o otimista sai (e a de teste não conta)
  const comTeste = execs({ status: 'pedido', chave_idem: 'radar-enviar-S46-01-1', resumo: 'enviar S46-01', inicio: '2026-11-14 22:55', teste: 'sim' });
  assert.equal(estadoDe(enviosAoRoteirista({ ...D, execucoes: comTeste, locais, agora: AGORA }), 'S46-01'), undefined);
  // Falha antiga + envio novo aceito: na fila
  const velha = execs({ status: 'erro', resumo: 'enviar S46-01', inicio: '2026-11-14 20:00' });
  assert.equal(estadoDe(enviosAoRoteirista({ ...D, execucoes: velha, locais, agora: AGORA }), 'S46-01'), 'na-fila');
  // Passou o tempo da trava sem nada: o otimista não fica para sempre
  assert.equal(estadoDe(enviosAoRoteirista({ ...D, locais, agora: lerDataHora('2026-11-15 02:00') }), 'S46-01'), undefined);
});

test('chave de idempotência estável: radar-enviar-<ids ordenados>-<n>', () => {
  assert.equal(chaveIdemEnvio(['S46-02', 'S46-01'], []), 'radar-enviar-S46-01-S46-02-1');
  assert.equal(chaveIdemEnvio(['S46-01', 'S46-02', 'S46-01'], []), chaveIdemEnvio(['S46-02', 'S46-01'], [])); // dois toques, mesma chave
  const ex = execs({ status: 'erro', resumo: 'enviar S46-01', inicio: '2026-11-14 20:00' }, { status: 'erro', rotina: 'radar-diario', resumo: 'S46-01' });
  assert.equal(chaveIdemEnvio(['S46-01'], ex), 'radar-enviar-S46-01-2'); // depois da falha, pedido novo
  const lote = execs({ status: 'erro', resumo: 'falhou', inicio: '2026-11-14 20:00' });
  assert.equal(chaveIdemEnvio(['S46-02'], lote, { selecao: D.selecao, decisoes: D.decisoes }), 'radar-enviar-S46-02-2'); // pelo id_lote
  assert.match(chaveIdemEnvio([MAL], []), /^[A-Za-z0-9-]+$/);
});

test('bandeja: "n a caminho do Roteirista · ver em Roteiros" e sem botão quando não há elegíveis', () => {
  const ex = { fase: 'pronto', execucoes: execs({ status: 'rodando', resumo: 'enviar S46-01, S46-02', inicio: '2026-11-14 22:50' }) };
  const h = htmlPautas({ dados: D, exec: ex, email: ROBERTTA, agora: AGORA });
  assert.match(h, /2 a caminho do Roteirista · <a href="#\/roteiros">ver em Roteiros<\/a>/);
  assert.doesNotMatch(h, /data-acao="pautas-enviar"/);
  // Uma vai, a outra ainda não: as duas informações e o botão só com a que pode ir
  const ex1 = { fase: 'pronto', execucoes: execs({ status: 'pedido', resumo: 'enviar S46-01', inicio: '2026-11-14 22:50' }) };
  const h1 = htmlPautas({ dados: D, exec: ex1, email: ROBERTTA, agora: AGORA });
  assert.match(h1, /1 aprovada espera o Roteirista/);
  assert.match(h1, /1 a caminho do Roteirista/);
  assert.match(h1, /data-acao="pautas-enviar">Enviar ao Roteirista \(1 aprovada\)/);
  // Otimista (antes da releitura): já sai da lista
  const locais = { 'S46-01': { desde: AGORA.getTime() }, 'S46-02': { desde: AGORA.getTime() } };
  assert.doesNotMatch(htmlPautas({ dados: D, exec: { fase: 'pronto', execucoes: [] }, email: ROBERTTA, agora: AGORA, enviosLocais: locais }), /data-acao="pautas-enviar"/);
  // Rascunho no Drive: não está mais "a caminho"
  const ok = { fase: 'pronto', execucoes: execs({ status: 'ok', resumo: 'enviar S46-01, S46-02', inicio: '2026-11-14 21:00' }) };
  const h2 = htmlPautas({ dados: D, exec: ok, email: ROBERTTA, agora: AGORA, projetos: [{ id: 'S46-01' }, { id: 'S46-02' }] });
  assert.doesNotMatch(h2, /a caminho|pautas-enviar/);
  assert.doesNotMatch(h + h1 + h2, /undefined|\[object|NaN/);
});

test('Roteiros, "Com o Roteirista": estado real, Tentar de novo (<button>) só na falha e para quem decide; tudo com esc()', () => {
  const d = dados([{ id_pauta: 'S46-01', titulo: MAL }, { id_pauta: 'S46-02' }, { id_pauta: 'S46-05', status: 'enviada ao Roteirista' }]);
  const ex = execs(
    { status: 'erro', resumo: 'enviar S46-01', erro: MAL, inicio: '2026-11-14 21:00' },
    { status: 'pedido', resumo: 'enviar S46-02', inicio: '2026-11-14 22:40' },
  );
  const env = enviosAoRoteirista({ ...d, execucoes: ex, projetos: [{ id: 'S46-09' }], agora: AGORA });
  const h = htmlComRoteirista(env, { decide: true });
  assert.match(h, /<h2 id="t-com-roteirista"[^>]*>Com o Roteirista<\/h2>/);
  assert.ok(!h.includes(MAL), 'nada da planilha sem escape');
  assert.ok(h.includes('Falhou: &lt;img src=x onerror=alert(1)&gt;'));
  assert.match(h, /Na fila desde 22h40/);
  assert.match(h, /Enviada, esperando o rascunho/);
  assert.match(h, /<button type="button" class="botao contorno menor" data-acao="pautas-enviar" data-id="S46-01">[\s\S]*?Tentar de novo<\/button>/);
  assert.equal((h.match(/Tentar de novo/g) || []).length, 1);
  assert.doesNotMatch(htmlComRoteirista(env, { decide: false }), /Tentar de novo/); // conta do Gabriel vê, não pede
  // Com o rascunho no Drive, a pauta sai da seção; sem nada, a seção não aparece
  assert.equal(htmlComRoteirista(enviosAoRoteirista({ ...d, projetos: ['S46-05'], agora: AGORA }), { decide: true }), '');
  assert.equal(htmlComRoteirista([], { decide: true }), '');
  assert.equal(aCaminho(env).length, 2);
});
