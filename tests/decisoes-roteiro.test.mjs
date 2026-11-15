// Decisão sobre o roteiro (lote 2): estados (js/decisoes-roteiro.js), bloqueio dos botões, abas de
// versão e payload.versao = a versão vista (js/telas/roteiros.js). Sem rede e sem agentes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALLOWED } from '../js/config.js';
import { lerDataHora } from '../js/parse.js';
import { planejarDecisaoRoteiro } from '../js/controle.js';
import {
  estadoDaDecisaoRoteiro, lerDecisaoDoResumo, bloqueioDaDecisao, chaveIdemDecisao, versoesDo, extrasDaDecisao, textoDaDecisaoAceita,
} from '../js/decisoes-roteiro.js';
import { decisaoDoRascunho, seloDaDecisao, versaoVistaDe, abasDeVersao, roteiroDaVersao, decisaoDe, painelFalas } from '../js/telas/roteiros.js';
import { idsEnviadosNoTexto, enviosAoRoteirista, podeEnviar } from '../js/envios.js';

const ROBERTTA = ALLOWED[0];
const GABRIEL = ALLOWED[1];
const MAL = '<img src=x onerror=alert(1)>';
const sp = (s) => lerDataHora(s);
const AGORA = sp('2026-11-18 10:30');
const CHAVE_IDEM_RE = /^[A-Za-z0-9_-]{8,80}$/; // a da ponte

let n = 0;
const dec = (o) => ({
  rotina: 'roteirista-decisao', bot: 'roteirista', origem: 'manual-app', id_alvo: 'S47-04', status: 'pedido', resumo: 'mudar v2', erro: '',
  chave_idem: `k-${++n}`, teste: false, _linha: n + 1, inicioData: sp('2026-11-18 10:00'), fimData: null, ...o,
});
const rot = (o = {}) => ({ id: 'S47-04', etapa: 'rascunho', versaoRoteiro: 2, versoesRoteiro: [1, 2], temFinal: false, lido: true, fontes: [], fontesConferidas: true, ...o });
const est = (execucoes, projeto = rot(), extra = {}) => estadoDaDecisaoRoteiro({ execucoes, projeto, agora: AGORA, ...extra });

test('resumo da linha: formatos da ponte e os sobrescritos pelo Roteirista', () => {
  assert.deepEqual(lerDecisaoDoResumo('mudar v2'), { decisao: 'mudar', versao: 2 });
  assert.deepEqual(lerDecisaoDoResumo('aprovar v3'), { decisao: 'aprovar', versao: 3 });
  assert.deepEqual(lerDecisaoDoResumo('recusar v1 (ética)'), { decisao: 'recusar', versao: 1 });
  assert.deepEqual(lerDecisaoDoResumo('rodar de novo; EX-1 marcada como travada; mudar v2'), { decisao: 'mudar', versao: 2 });
  assert.deepEqual(lerDecisaoDoResumo('S46-01 v2 gravado: abertura nova e fim mais curto'), { decisao: 'mudar', versao: 1, nova: 2 });
  assert.deepEqual(lerDecisaoDoResumo('S46-01 v2 aprovada: gravado S46-01 - Título.md'), { decisao: 'aprovar', versao: 2 });
  assert.equal(lerDecisaoDoResumo(MAL), null);
  assert.equal(lerDecisaoDoResumo(''), null);
});

test('estado: sem linha = livre; mudar na fila / processando = em revisão e bloqueia', () => {
  assert.equal(est([]).estado, 'livre');
  assert.equal(est([]).bloqueia, false);
  const fila = est([dec({ status: 'pedido' })]);
  assert.equal(fila.estado, 'em-revisao');
  assert.equal(fila.fase, 'na-fila');
  assert.equal(fila.bloqueia, true);
  assert.equal(fila.texto, 'Em revisão: preparando a v3');
  assert.match(fila.explicacao, /Na fila desde 10h/);
  assert.doesNotMatch(fila.explicacao, /Processando/);
  const rodando = est([dec({ status: 'rodando' })]);
  assert.equal(rodando.fase, 'processando');
  assert.match(rodando.explicacao, /Processando desde 10h/);
});

test('estado: ok sem a v(N+1) segura 2 h; depois desbloqueia com aviso (nunca fica preso)', () => {
  const ok = dec({ status: 'ok', fimData: sp('2026-11-18 10:10') });
  const cedo = est([ok]);
  assert.equal(cedo.estado, 'em-revisao');
  assert.equal(cedo.fase, 'ok');
  assert.equal(cedo.bloqueia, true);
  const tarde = estadoDaDecisaoRoteiro({ execucoes: [ok], projeto: rot(), agora: sp('2026-11-18 12:10') });
  assert.equal(tarde.estado, 'sem-versao-nova');
  assert.equal(tarde.bloqueia, false);
  assert.equal(tarde.texto, 'O Roteirista terminou, mas a v3 não chegou');
  // a ponte também libera o mesmo pedido depois de 2 h (paridade em ponte.test.mjs)
  assert.equal(bloqueioDaDecisao([ok], { id: 'S47-04', decisao: 'mudar', versao: 2, agora: sp('2026-11-18 12:10') }).livre, true);
  assert.equal(bloqueioDaDecisao([ok], { id: 'S47-04', decisao: 'mudar', versao: 2, agora: AGORA }).codigo, 'ja-pedida');
});

test('estado: a v(N+1) no Drive = revisada (mesmo com a linha ainda aberta), inclusive com o resumo do Roteirista', () => {
  const r3 = rot({ versaoRoteiro: 3, versoesRoteiro: [1, 2, 3] });
  const e = est([dec({ status: 'ok' })], r3);
  assert.equal(e.estado, 'revisada');
  assert.equal(e.texto, 'Revisada (v3, a partir da v2)');
  assert.equal(e.bloqueia, false);
  assert.equal(est([dec({ status: 'rodando' })], r3).estado, 'revisada');
  const sobrescrito = est([dec({ status: 'ok', resumo: 'S47-04 v3 gravado: abertura nova' })], r3);
  assert.equal(sobrescrito.texto, 'Revisada (v3, a partir da v2)');
});

test('estado: aprovar até o roteiro final aparecer = "o Roteirista está fechando"; depois "Aprovado (v2)"', () => {
  const aberta = est([dec({ resumo: 'aprovar v2', status: 'rodando' })]);
  assert.equal(aberta.estado, 'aprovacao');
  assert.equal(aberta.texto, 'Aprovado (v2): o Roteirista está fechando');
  assert.equal(aberta.bloqueia, true);
  const ok = dec({ resumo: 'S47-04 v2 aprovada: gravado S47-04 - Título.md', status: 'ok' });
  assert.equal(est([ok]).estado, 'aprovacao');
  const final = est([ok], rot({ temFinal: true, etapa: 'aprovado' }));
  assert.equal(final.estado, 'aprovado');
  assert.equal(final.texto, 'Aprovado (v2)');
  // depois de aprovado, nada de nova decisão (nem uma falha mais nova muda isso)
  assert.equal(est([dec({ status: 'erro', inicioData: sp('2026-11-18 10:20') }), ok]).estado, 'aprovacao');
  assert.equal(bloqueioDaDecisao([ok], { id: 'S47-04', decisao: 'recusar', versao: 2 }).codigo, 'ja-decidido');
});

test('estado: recusar (aberta e concluída) bloqueia', () => {
  const aberta = est([dec({ resumo: 'recusar v2 (ética)' })]);
  assert.equal(aberta.estado, 'recusado');
  assert.equal(aberta.texto, 'Recusa enviada (v2)');
  assert.equal(aberta.bloqueia, true);
  const ok = est([dec({ resumo: 'recusar v2 (ética)', status: 'ok' })]);
  assert.equal(ok.estado, 'recusado');
  assert.equal(ok.texto, 'Recusado (v2)');
});

test('estado: falha (erro / parcial / travada / recusado-pela-trava) desbloqueia com o texto, e a recuperação volta a "Em revisão"', () => {
  for (const status of ['erro', 'parcial', 'travada', 'recusado-pela-trava']) {
    const e = est([dec({ status, erro: status === 'erro' ? MAL : '' })]);
    assert.equal(e.estado, 'falhou', status);
    assert.equal(e.bloqueia, false, status);
    assert.match(e.texto, /^A revisão falhou: /, status);
  }
  assert.equal(est([dec({ status: 'erro', erro: 'limite de 5 h' })]).texto, 'A revisão falhou: limite de 5 h');
  assert.match(est([dec({ status: 'erro', resumo: 'aprovar v2' })]).texto, /^A aprovação falhou/);
  // a falha libera na ponte
  assert.equal(bloqueioDaDecisao([dec({ status: 'erro' })], { id: 'S47-04', decisao: 'mudar', versao: 2, agora: AGORA }).livre, true);
  // pedir de novo: a linha nova (mais nova) vale
  const falha = dec({ status: 'erro', inicioData: sp('2026-11-18 09:00') });
  const denovo = dec({ status: 'pedido', inicioData: sp('2026-11-18 10:20') });
  assert.equal(est([falha, denovo]).estado, 'em-revisao');
  assert.equal(est([falha, { ...denovo, status: 'ok' }], rot({ versaoRoteiro: 3, versoesRoteiro: [1, 2, 3] })).estado, 'revisada');
});

test('estado: linha aberta há 2 h ou mais (ou sem início) = parece travada, sem bloquear', () => {
  const velha = est([dec({ status: 'rodando', inicioData: sp('2026-11-18 08:00') })]);
  assert.equal(velha.estado, 'parece-travada');
  assert.equal(velha.bloqueia, false);
  assert.match(velha.texto, /^Parece travada: aberta desde /);
  assert.equal(est([dec({ status: 'pedido', inicioData: null })]).estado, 'parece-travada');
});

test('estado otimista: "Em revisão" na hora, até a linha da mesma chave aparecer (ou 2 h)', () => {
  const local = { desde: AGORA.getTime() - 60_000, chave: 'roteirista-decisao-S47-04-mudar-v2-1', decisao: 'mudar', versao: 2 };
  const e = est([], rot(), { local });
  assert.equal(e.estado, 'em-revisao');
  assert.equal(e.otimista, true);
  assert.equal(e.bloqueia, true);
  const apr = est([], rot(), { local: { ...local, decisao: 'aprovar' } });
  assert.equal(apr.texto, 'Aprovado (v2): o Roteirista está fechando');
  // a linha com a chave chegou: vale a linha (aqui, falhou)
  assert.equal(est([dec({ status: 'erro', chave_idem: local.chave })], rot(), { local }).estado, 'falhou');
  // registro velho não segura nada
  assert.equal(est([], rot(), { local: { ...local, desde: AGORA.getTime() - 3 * 3600_000 } }).estado, 'livre');
});

test('linhas de outro id não contam; id T segue a mesma regra (só casa com T)', () => {
  assert.equal(est([dec({ id_alvo: 'S47-05' })]).estado, 'livre');
  const t = est([dec({ id_alvo: 'T01-01', teste: true })], rot({ id: 'T01-01' }));
  assert.equal(t.estado, 'em-revisao');
});

test('chave estável da decisão: dois toques = mesma chave; depois de uma linha nova, chave nova; formato da ponte', () => {
  const p = { id: 'S47-04', decisao: 'mudar', versao: 2 };
  const a = chaveIdemDecisao(p, []);
  assert.equal(a, chaveIdemDecisao(p, []));
  assert.match(a, CHAVE_IDEM_RE);
  const b = chaveIdemDecisao(p, [dec({ status: 'erro' })]);
  assert.notEqual(a, b);
  assert.match(b, CHAVE_IDEM_RE);
  assert.notEqual(chaveIdemDecisao({ ...p, versao: 1 }, []), a);
});

test('payload.versao = a versão vista nas abas (inválida volta para a mais nova); confirmação avisa quando não é a mais nova', () => {
  const r = rot({ versaoRoteiro: 3, versoesRoteiro: [1, 2, 3] });
  assert.deepEqual(versoesDo(r), [1, 2, 3]);
  assert.equal(versaoVistaDe(r, {}), 3);
  assert.equal(versaoVistaDe(r, { 'S47-04': 2 }), 2);
  assert.equal(versaoVistaDe(r, { 'S47-04': 9 }), 3);
  const plano = planejarDecisaoRoteiro({ id: r.id, versao: versaoVistaDe(r, { 'S47-04': 2 }), decisao: 'aprovar' });
  assert.equal(plano.payload.versao, 2);
  const extras = extrasDaDecisao(plano, versoesDo(r));
  assert.equal(extras[1].texto, 'Você está decidindo a v2 (existe a v3, mais nova).');
  assert.equal(extrasDaDecisao(planejarDecisaoRoteiro({ id: r.id, versao: 3, decisao: 'aprovar' }), versoesDo(r)).length, 1);
  assert.match(textoDaDecisaoAceita('S47-04', { decisao: 'mudar', versao: 2 }), /Em revisão: o Roteirista prepara a v3/);
});

test('tela: em revisão desliga Aprovar, Pedir mudança e Recusar, com a explicação visível; Gabriel continua sem decidir', () => {
  const exec = { execucoes: [dec({ status: 'rodando' })] };
  const h = decisaoDoRascunho(rot(), { email: ROBERTTA, escolha: 'aprovar', exec, agora: AGORA });
  for (const v of ['aprovar', 'mudar', 'recusar']) assert.match(h, new RegExp(`data-valor="${v}" aria-pressed="false" disabled`), v);
  assert.match(h, /Em revisão: preparando a v3/);
  assert.match(h, /Você pediu mudança na v2\. Processando desde 10h/);
  assert.doesNotMatch(h, /roteiro-confirmar/); // a escolha velha não vira botão de confirmar
  const apr = decisaoDoRascunho(rot(), { email: ROBERTTA, exec: { execucoes: [dec({ resumo: 'aprovar v2' })] }, agora: AGORA });
  assert.match(apr, /data-valor="recusar" aria-pressed="false" disabled/);
  assert.match(apr, /Aprovado \(v2\): o Roteirista está fechando/);
  const g = decisaoDoRascunho(rot(), { email: GABRIEL, exec: { execucoes: [] }, agora: AGORA });
  assert.match(g, /data-valor="aprovar" aria-pressed="false" disabled/);
  assert.match(g, /Só a conta da Robertta decide\./);
});

test('tela: falha mostra o texto escapado e "Pedir de novo" (<button>); ok sem versão nova depois de 2 h libera tudo', () => {
  const h = decisaoDoRascunho(rot(), { email: ROBERTTA, exec: { execucoes: [dec({ status: 'erro', erro: MAL })] }, agora: AGORA });
  assert.ok(!h.includes(MAL));
  assert.match(h, /A revisão falhou: &lt;img/);
  assert.match(h, /<button type="button" class="botao contorno menor" data-acao="roteiro-repetir" data-id="S47-04" data-valor="mudar" data-versao="2">/);
  assert.doesNotMatch(h, /disabled/);
  const tarde = decisaoDoRascunho(rot(), { email: ROBERTTA, exec: { execucoes: [dec({ status: 'ok', fimData: sp('2026-11-18 08:00') })] }, agora: AGORA });
  assert.doesNotMatch(tarde, /disabled/);
  assert.match(tarde, /O Roteirista terminou, mas a v3 não chegou/);
  assert.match(tarde, /roteiro-repetir/);
  // Gabriel não vê "Pedir de novo"
  assert.doesNotMatch(decisaoDoRascunho(rot(), { email: GABRIEL, exec: { execucoes: [dec({ status: 'erro' })] }, agora: AGORA }), /roteiro-repetir/);
});

test('tela: decisão na versão vista ("Aprovar a v2", a mais nova é a v3); mudança já pedida nessa versão fica desligada', () => {
  const r = rot({ versaoRoteiro: 3, versoesRoteiro: [1, 2, 3] });
  const h = decisaoDoRascunho(r, { email: ROBERTTA, escolha: 'aprovar', exec: { execucoes: [] }, agora: AGORA, vista: 2 });
  assert.match(h, />Aprovar a v2<\/button>/);
  assert.match(h, /Rascunho v2 \(a mais nova é a v3\)/);
  assert.match(h, /data-acao="roteiro-confirmar" data-id="S47-04">Aprovar a v2</);
  // v3 nasceu de "mudar v2" há pouco: pedir mudança na v2 de novo é recusado (como na ponte)
  const exec = { execucoes: [dec({ status: 'ok', fimData: sp('2026-11-18 10:10') })] };
  const de = decisaoDoRascunho(r, { email: ROBERTTA, escolha: 'mudar', exec, agora: AGORA, vista: 2 });
  assert.match(de, /data-valor="mudar" aria-pressed="false" disabled/);
  assert.match(de, /A mudança na v2 do S47-04 já foi pedida/);
  assert.doesNotMatch(de, /data-valor="aprovar" aria-pressed="false" disabled/);
  // na v3 (a mais nova) pedir mudança está livre
  assert.doesNotMatch(decisaoDoRascunho(r, { email: ROBERTTA, exec, agora: AGORA, vista: 3 }), /disabled/);
});

test('tela: abas v1 · v2 · v3 (<button>, só no rascunho com mais de uma versão) e selo do estado escapado', () => {
  const r = rot({ versaoRoteiro: 3, versoesRoteiro: [1, 2, 3] });
  const abas = abasDeVersao(r, 2);
  assert.equal((abas.match(/<button type="button" class="chip" data-acao="roteiro-versao"/g) || []).length, 3);
  assert.match(abas, /data-valor="2" aria-pressed="true">v2</);
  assert.match(abas, /v3 \(mais nova\)/);
  assert.equal(abasDeVersao(rot({ versoesRoteiro: [1], versaoRoteiro: 1 }), 1), '');
  assert.equal(abasDeVersao({ ...r, etapa: 'aprovado' }, 3), '');
  const s = seloDaDecisao(decisaoDe(rot(), { execucoes: [dec({ status: 'erro', erro: MAL })], agora: AGORA }));
  assert.ok(!s.includes(MAL));
  assert.match(s, /^<span class="selo alerta">A revisão falhou: &lt;img/);
  assert.equal(seloDaDecisao(decisaoDe(rot(), { execucoes: [], agora: AGORA })), '');
});

test('versão anterior: texto lido com o download de sempre (anexo) e lerRoteiro; carregando e erro', () => {
  const file = { id: 'f1', name: 'S47-04 rascunho v1.md', modifiedTime: '2026-11-17T10:00:00Z' };
  const r = rot({ versaoRoteiro: 2, versoesRoteiro: [1, 2], arquivosRascunho: [{ v: 1, file }, { v: 2, file: { id: 'f2' } }] });
  assert.equal(roteiroDaVersao(r, 2).r, r);
  assert.equal(roteiroDaVersao(r, 1, { anexoDe: () => ({ fase: 'carregando' }) }).fase, 'carregando');
  assert.equal(roteiroDaVersao(r, 1, { anexoDe: () => ({ fase: 'erro' }) }).fase, 'erro');
  const pedidos = [];
  const base = readFileSync(new URL('./fixtures/roteiros/S46-01 - Formato com etiquetas.md', import.meta.url), 'utf8');
  const texto = base.replace('[PROMESSA] Em trinta segundos', `[PROMESSA] ${MAL} Em trinta segundos`);
  const out = roteiroDaVersao(r, 1, { anexoDe: (f) => { pedidos.push(f.id); return { fase: 'pronto', texto }; } });
  assert.deepEqual(pedidos, ['f1']);
  assert.equal(out.fase, 'pronto');
  assert.equal(out.r.versaoVista, 1);
  assert.equal(out.r.id, 'S47-04');
  assert.ok(out.r.falas.some((f) => f.texto.includes(MAL)), 'o texto da v1 foi lido');
  const html = painelFalas(out.r, 'ig');
  assert.ok(!html.includes(MAL));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; Em trinta segundos/);
  // a mais nova continua com o próprio texto
  assert.equal(roteiroDaVersao(r, 2, { anexoDe: () => assert.fail('não baixa a mais nova') }).fase, 'pronto');
});

test('envios (paridade com a ponte): parcial só segura os ids que o resumo dá como enviados', () => {
  assert.deepEqual(idsEnviadosNoTexto('pauta S46-01 (lote S46-manual-1) enviada ao Roteirista; aprovação confirmada em Decisões'), ['S46-01']);
  assert.deepEqual(idsEnviadosNoTexto('S46-01, S46-02 enviadas ao Roteirista; S46-03 falhou'), ['S46-01', 'S46-02']);
  assert.deepEqual(idsEnviadosNoTexto('enviar S46-01, S46-02'), []);
  assert.deepEqual(idsEnviadosNoTexto('S46-03 não enviada'), []);
  const linha = { rotina: 'radar-enviar', status: 'parcial', resumo: 'S46-01 enviada ao Roteirista; S46-02 falhou', id_alvo: '', teste: false, inicioData: sp('2026-11-18 09:00'), _linha: 2 };
  const envios = enviosAoRoteirista({ execucoes: [linha], agora: AGORA });
  const por = new Map(envios.map((e) => [e.id_pauta, e]));
  assert.equal(por.get('S46-01').estado, 'enviada');
  assert.equal(podeEnviar(por.get('S46-01')), false);
  assert.equal(por.get('S46-02').estado, 'falhou');
  assert.equal(podeEnviar(por.get('S46-02')), true);
});
