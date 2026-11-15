// Testes da PONTE (ponte/Code.gs, Google Apps Script). O próprio Code.gs é carregado com node:vm
// num contexto com STUBS dos serviços do Apps Script: planilha em memória, propriedades, lock,
// UrlFetchApp (tokeninfo/userinfo e webhooks, registrando as chamadas), ContentService, Utilities,
// CacheService e Logger/console espiões. Tokens, e-mails, URLs e chaves são FALSOS.
// Datas fixas: quarta 18/11/2026, domingo 15/11, segunda 16/11 (horário de São Paulo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { lerDataHora as lerDataHoraApp, prefixoSemana, dataHoraPlanilha, ID_CANDIDATO_RE } from '../js/parse.js';
import * as C from '../js/controle.js';
import * as S from '../js/selecao.js';
import * as E from '../js/envios.js';
import * as D from '../js/decisoes-roteiro.js';

const CODIGO = readFileSync(new URL('../ponte/Code.gs', import.meta.url), 'utf8');
const INTEGRA = readFileSync(new URL('../js/integra.js', import.meta.url), 'utf8');

const CLIENT = '000000000000-falso.apps.googleusercontent.com';
const ROBERTTA = 'robertta@exemplo.com';
const GABRIEL = 'gabriel@exemplo.com';
const OUTRA = 'outra@exemplo.com';
const URL_RADAR = 'https://webhook.exemplo.test/radar';
const URL_ROTEIRISTA = 'https://webhook.exemplo.test/roteirista-decisao';
const CHAVE_RADAR = 'chave-falsa-radar';
const CHAVE_ROTEIRISTA = 'chave-falsa-roteirista';

const sp = (s) => lerDataHoraApp(s); // 'AAAA-MM-DD HH:MM' em São Paulo
const QUARTA_10 = '2026-11-18 10:00';

const CAB = ['id_execucao', 'chave_idem', 'bot', 'rotina', 'origem', 'quem', 'id_alvo', 'id_lote', 'etapa_evento', 'inicio', 'fim', 'status', 'resumo', 'erro', 'link', 'teste'];

/* ----------------------------------------------------------------- stubs */

const ESCOPO = 'openid https://www.googleapis.com/auth/userinfo.email email https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets';
const info = (email, extra = {}) => ({
  azp: CLIENT, aud: CLIENT, sub: `sub-${email}`, scope: ESCOPO, exp: '1900000000', expires_in: '3500',
  email, email_verified: 'true', access_type: 'online', ...extra,
});

const TOKENS = {
  'tok-falso-robertta': { tokeninfo: info(ROBERTTA) },
  'tok-falso-gabriel': { tokeninfo: info(GABRIEL) },
  'tok-falso-outra': { tokeninfo: info(OUTRA) },
  'tok-falso-aud-errado': { tokeninfo: info(ROBERTTA, { aud: 'outro-app', azp: 'outro-app' }) },
  'tok-falso-azp-certo': { tokeninfo: info(ROBERTTA, { aud: 'outro-app' }) },
  'tok-falso-nao-verificado': { tokeninfo: info(ROBERTTA, { email_verified: 'false' }) },
  'tok-falso-vencido': { tokeninfo: info(ROBERTTA, { expires_in: '0' }) },
  'tok-falso-sem-escopo': { tokeninfo: info(ROBERTTA, { scope: 'https://www.googleapis.com/auth/drive' }) },
  'tok-falso-sem-email': {
    tokeninfo: (() => { const i = info(ROBERTTA); delete i.email; delete i.email_verified; return i; })(),
    userinfo: { sub: `sub-${ROBERTTA}`, email: ROBERTTA, email_verified: true },
  },
  'tok-falso-sem-email-nao-verif': {
    tokeninfo: (() => { const i = info(ROBERTTA); delete i.email; delete i.email_verified; return i; })(),
    userinfo: { sub: `sub-${ROBERTTA}`, email: ROBERTTA, email_verified: false },
  },
  'tok-falso-google-fora': { status: 503 },
};

const PROPS = {
  CLIENT_ID: CLIENT,
  PLANILHA_ID: 'planilha-falsa',
  EMAILS_DISPARAR: GABRIEL,
  EMAILS_DECIDIR: ` ${ROBERTTA.toUpperCase()} `,
  WEBHOOK_RADAR_URL: URL_RADAR,
  WEBHOOK_RADAR_KEY: CHAVE_RADAR,
  WEBHOOK_ROTEIRISTA_URL: URL_ROTEIRISTA,
  WEBHOOK_ROTEIRISTA_KEY: CHAVE_ROTEIRISTA,
};

const ehDataQualquer = (v) => Object.prototype.toString.call(v) === '[object Date]';

/**
 * Planilha em memória que imita o Sheets: texto com apóstrofo fica texto (sem o apóstrofo);
 * texto sem apóstrofo que começa com "=" vira fórmula (registrada); número e data viram valor.
 */
function criarAba(nome, linhas) {
  const aba = { nome, linhas: linhas.map((l) => [...l]), formulas: [] };
  const converter = (v, r, c) => {
    if (typeof v !== 'string') return v;
    if (v.startsWith("'")) return v.slice(1);
    if (v.startsWith('=')) { aba.formulas.push({ r, c, v }); return v; }
    if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v)) return lerDataHoraApp(v);
    return v;
  };
  const largura = () => Math.max(0, ...aba.linhas.map((l) => l.length));
  const ultimaLinha = () => {
    for (let i = aba.linhas.length; i > 0; i--) if ((aba.linhas[i - 1] || []).some((v) => v !== '' && v !== null && v !== undefined)) return i;
    return 0;
  };
  const escrever = (r, c, v) => {
    while (aba.linhas.length < r) aba.linhas.push([]);
    const l = aba.linhas[r - 1];
    while (l.length < c) l.push('');
    l[c - 1] = converter(v, r, c);
  };
  aba.sheet = {
    getName: () => aba.nome,
    setFrozenRows: (n) => { aba.congeladas = n; },
    getLastRow: ultimaLinha,
    getLastColumn: largura,
    getDataRange: () => ({
      getValues: () => {
        const w = largura();
        return aba.linhas.slice(0, ultimaLinha()).map((l) => Array.from({ length: w }, (_, i) => (l[i] === undefined ? '' : l[i])));
      },
    }),
    getRange: (r, c, nr = 1, nc = 1) => ({
      setValues(vals) {
        assert.equal(vals.length, nr);
        vals.forEach((linha, i) => { assert.equal(linha.length, nc); linha.forEach((v, j) => escrever(r + i, c + j, v)); });
        return this;
      },
      setValue(v) { escrever(r, c, v); return this; },
    }),
  };
  return aba;
}

function criarAmbiente({
  agora = QUARTA_10, linhas = [CAB], props = PROPS, webhooks = {}, lockOk = true, nomeAba = 'Execuções', abrirLanca = null, setupHash = null,
} = {}) {
  const aba = criarAba(nomeAba, linhas);
  const abas = { [nomeAba]: aba };
  const propsVivas = { ...props };
  const gravacoesDeProps = [];
  const chamadas = [];
  const logs = [];
  const respostas = [];
  const cache = new Map();
  const lock = { segurando: false, pedidos: 0 };
  let uuid = 0;
  let relogio = sp(agora);
  const resp = (codigo, corpo) => ({ getResponseCode: () => codigo, getContentText: () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) });
  const filaWebhook = {};
  for (const [url, codigos] of Object.entries(webhooks)) filaWebhook[url] = Array.isArray(codigos) ? [...codigos] : [codigos];
  const espiao = (nivel) => (...a) => logs.push({ nivel, texto: a.map(String).join(' ') });

  const ctx = {
    console: { log: espiao('log'), info: espiao('info'), warn: espiao('warn'), error: espiao('error') },
    Logger: { log: espiao('Logger') },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => ({ ...propsVivas }),
        getProperty: (k) => (k in propsVivas ? propsVivas[k] : null),
        setProperties: (obj, apagarOutras) => {
          gravacoesDeProps.push({ obj: { ...obj }, apagarOutras });
          if (apagarOutras) for (const k of Object.keys(propsVivas)) delete propsVivas[k];
          Object.assign(propsVivas, obj);
        },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { lock.pedidos++; if (!lockOk) return false; lock.segurando = true; return true; },
        releaseLock: () => { lock.segurando = false; },
      }),
    },
    SpreadsheetApp: {
      openById: (id) => {
        if (abrirLanca) throw new Error(abrirLanca);
        assert.equal(id, propsVivas.PLANILHA_ID);
        return {
          getSheetByName: (n) => (abas[n] ? abas[n].sheet : null),
          insertSheet: (n) => { assert.ok(!abas[n]); abas[n] = criarAba(n, []); abas[n].criada = true; return abas[n].sheet; },
        };
      },
      flush: () => {},
    },
    UrlFetchApp: {
      fetch: (url, params = {}) => {
        chamadas.push({ url, params });
        if (url.startsWith('https://oauth2.googleapis.com/tokeninfo?access_token=')) {
          const t = TOKENS[decodeURIComponent(url.split('=')[1])];
          if (!t) return resp(400, { error: 'invalid_token', error_description: 'Invalid Value' });
          if (t.status) return resp(t.status, 'fora');
          return resp(200, t.tokeninfo);
        }
        if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
          const tok = String(params.headers?.Authorization || '').replace(/^Bearer /, '');
          const t = TOKENS[tok];
          return t?.userinfo ? resp(200, t.userinfo) : resp(401, { error: 'invalid_token' });
        }
        if (url === 'https://www.google.com') return resp(200, '<html>');
        const fila = filaWebhook[url];
        const codigo = fila ? (fila.length > 1 ? fila.shift() : fila[0]) : 200;
        if (codigo === 'lanca') throw new Error(`falhou ${url}`);
        return resp(codigo, '{"ok":true}');
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => {
        const o = { conteudo: s, mime: '', setMimeType(m) { o.mime = m; return o; }, getContent: () => o.conteudo };
        respostas.push(o);
        return o;
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (alg, texto) => {
        assert.equal(alg, 'SHA_256');
        return [...createHash('sha256').update(String(texto), 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b));
      },
      getUuid: () => { uuid++; return `${uuid.toString(16).padStart(4, '0')}abcd-0000-4000-8000-000000000000`; },
      formatDate: (d, tz, fmt) => { assert.equal(tz, 'America/Sao_Paulo'); return `${fmt}:${d.toISOString()}`; },
      sleep: () => {},
    },
    CacheService: {
      getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { cache.set(k, v); } }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(CODIGO, ctx, { filename: 'Code.gs' });
  // Setup.gs (não versionado) só define a constante; os arquivos do Apps Script dividem o escopo global
  if (setupHash !== null) vm.runInContext('const PONTE_SETUP_HASH = ' + JSON.stringify(setupHash) + ';', ctx, { filename: 'Setup.gs' });
  ctx.agora_ = () => new Date(relogio.getTime());

  function post(corpo) {
    const contents = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    const out = ctx.doPost({ postData: { contents, type: 'text/plain', length: contents.length }, parameter: {} });
    assert.equal(out.mime, 'application/json');
    assert.equal(lock.segurando, false, 'o lock sempre é solto');
    return JSON.parse(out.getContent());
  }
  const execs = () => vm.runInContext('lerExecucoes', ctx)(aba.linhas).execucoes;
  const webhooksChamados = () => chamadas.filter((c) => c.url.startsWith('https://webhook.'));
  return {
    ctx, aba, abas, propsVivas, gravacoesDeProps, chamadas, logs, respostas, cache, lock, post, execs, webhooksChamados,
    pure: (nome) => vm.runInContext(nome, ctx),
    setAgora: (s) => { relogio = sp(s); },
  };
}

const json = (x) => JSON.parse(JSON.stringify(x));

/** Linha da aba a partir de um objeto parcial (cabeçalho canônico). */
const linha = (r) => CAB.map((c) => r[c] ?? '');

let n = 0;
const chave = () => `chave-teste-${String(++n).padStart(4, '0')}`;

const disparo = (token, rotina, extra = {}) => ({
  acao: 'disparar', rotina, id_alvo: '', id_lote: '', chave_idem: chave(), dados: {}, access_token: token, ...extra,
});
const decisao = (token, id, dados, extra = {}) => ({
  acao: 'decidir-roteiro', rotina: 'roteirista-decisao', id_alvo: id, chave_idem: chave(),
  dados: { id, versao: 2, decisao: 'aprovar', pedido: '', motivo: '', ...dados }, access_token: token, ...extra,
});

/** Tudo o que sai da ponte, junto: células, logs, respostas, webhooks (com headers) e cache. */
function tudoQueSai(amb) {
  return JSON.stringify({
    celulas: amb.aba.linhas,
    logs: amb.logs,
    respostas: amb.respostas.map((r) => r.conteudo),
    webhooks: amb.webhooksChamados(),
    cache: [...amb.cache.entries()],
  });
}

/* ----------------------------------------------------------------- doGet e corpo */

test('doGet: só a saúde, sem dados', () => {
  const amb = criarAmbiente();
  const out = amb.ctx.doGet({ parameter: { qualquer: 'coisa' } });
  assert.equal(out.mime, 'application/json');
  assert.deepEqual(JSON.parse(out.getContent()), { ok: true, servico: 'ponte-motor' });
});

test('corpo inválido: vazio, não JSON, lista, campos extras, tipos errados, dados fora do formato, grande demais', () => {
  const amb = criarAmbiente();
  const base = disparo('tok-falso-robertta', 'radar-diario');
  const casos = [
    '',
    'não é json',
    '[]',
    '"texto"',
    JSON.stringify({ ...base, origem: 'agendada' }), // campo extra (não dá para fingir rodada agendada)
    JSON.stringify({ ...base, url: 'https://x' }),
    JSON.stringify({ ...base, acao: 'gravar-decisoes' }), // não existe acao que grave em Decisões
    JSON.stringify({ ...base, acao: undefined }),
    JSON.stringify({ ...base, rotina: 5 }),
    JSON.stringify({ ...base, dados: [] }),
    JSON.stringify({ ...base, dados: 'texto' }),
    JSON.stringify({ ...base, dados: { aninhado: { a: 1 } } }),
    JSON.stringify({ ...base, dados: { lista: [1] } }),
    JSON.stringify({ ...base, dados: { Maiuscula: 'x' } }),
    JSON.stringify({ ...base, dados: { nulo: null } }),
    JSON.stringify({ ...base, dados: { longo: 'a'.repeat(4001) } }),
    JSON.stringify({ ...base, chave_idem: 'curta' }),
    JSON.stringify({ ...base, chave_idem: 'com espaço no meio' }),
    JSON.stringify({ ...base, id_lote: '=1+1' }),
    JSON.stringify({ ...base, dados: { texto: 'a'.repeat(3999), b: 'b'.repeat(3999), c: 'c'.repeat(3999), d: 'd'.repeat(3999), e: 'e'.repeat(3999), f: 'f'.repeat(1000) } }),
  ];
  for (const corpo of casos) {
    const r = amb.post(corpo);
    assert.equal(r.ok, false, corpo.slice(0, 80));
    assert.equal(r.codigo, 'pedido-invalido', corpo.slice(0, 80));
    assert.ok(r.mensagem && r.mensagem.length <= 500);
  }
  // falta a chave: o mesmo código do app ('sem-chave')
  assert.equal(amb.post({ ...base, chave_idem: '' }).codigo, 'sem-chave');
  // dado de texto no limite passa na leitura
  assert.equal(amb.pure('lerPedido')(JSON.stringify({ ...base, dados: { texto: 'a'.repeat(4000) } })).ok, true);
  // nada foi conferido no Google nem gravado
  assert.equal(amb.chamadas.length, 0);
  assert.equal(amb.aba.linhas.length, 1);
});

/* ----------------------------------------------------------------- token */

test('token: inválido, aud errado, e-mail não verificado, vencido, sem escopo de e-mail → token-invalido', () => {
  const amb = criarAmbiente();
  for (const t of ['tok-falso-desconhecido', 'tok-falso-aud-errado', 'tok-falso-nao-verificado', 'tok-falso-vencido', 'tok-falso-sem-escopo', 'tok-falso-sem-email-nao-verif']) {
    const r = amb.post(disparo(t, 'radar-diario'));
    assert.equal(r.codigo, 'token-invalido', t);
  }
  assert.equal(amb.post(disparo('curto', 'radar-diario')).codigo, 'token-invalido');
  assert.equal(amb.post(disparo('tok-falso-google-fora', 'radar-diario')).codigo, 'verificacao-indisponivel');
  assert.equal(amb.aba.linhas.length, 1);
  assert.equal(amb.webhooksChamados().length, 0);
});

test('token: azp igual ao CLIENT_ID basta; sem e-mail no tokeninfo, cai para o userinfo com Bearer', () => {
  const amb = criarAmbiente();
  assert.equal(amb.post(disparo('tok-falso-azp-certo', 'radar-diario')).ok, true);
  const amb2 = criarAmbiente();
  const r = amb2.post(disparo('tok-falso-sem-email', 'radar-diario'));
  assert.equal(r.ok, true);
  const ui = amb2.chamadas.find((c) => c.url === 'https://openidconnect.googleapis.com/v1/userinfo');
  assert.equal(ui.params.headers.Authorization, 'Bearer tok-falso-sem-email');
  assert.equal(amb2.execs()[0].quem, ROBERTTA);
});

test('token: resultado guardado no cache pelo hash (nunca o token); sem CLIENT_ID a ponte não aceita nada', () => {
  const amb = criarAmbiente();
  amb.post(disparo('tok-falso-gabriel', 'radar-diario'));
  amb.setAgora('2026-11-18 14:00');
  amb.post(disparo('tok-falso-gabriel', 'diretor-retrospectiva'));
  assert.equal(amb.chamadas.filter((c) => c.url.includes('tokeninfo')).length, 1);
  for (const [k, v] of amb.cache) {
    assert.match(k, /^tok:[0-9a-f]{64}$/);
    assert.ok(!k.includes('tok-falso') && !v.includes('tok-falso'));
  }
  const semCfg = criarAmbiente({ props: { ...PROPS, CLIENT_ID: '' } });
  assert.equal(semCfg.post(disparo('tok-falso-robertta', 'radar-diario')).codigo, 'ponte-sem-configuracao');
  assert.equal(semCfg.chamadas.length, 0);
});

/* ----------------------------------------------------------------- permissões */

test('permissões: Gabriel dispara, mas não decide nem envia ao Roteirista; e-mail fora da lista é recusado', () => {
  const amb = criarAmbiente();
  const ok = amb.post(disparo('tok-falso-gabriel', 'radar-diario'));
  assert.equal(ok.ok, true);
  assert.equal(amb.execs()[0].quem, GABRIEL);

  const dec = amb.post(decisao('tok-falso-gabriel', 'S47-01', {}));
  assert.equal(dec.codigo, 'sem-permissao');
  assert.match(dec.mensagem, /Robertta/);
  assert.equal(amb.post(disparo('tok-falso-gabriel', 'radar-enviar')).codigo, 'sem-permissao');

  assert.equal(amb.post(disparo('tok-falso-outra', 'radar-diario')).codigo, 'sem-permissao');
  assert.equal(amb.post(decisao('tok-falso-outra', 'S47-01', {})).codigo, 'sem-permissao');
  assert.equal(amb.execs().length, 1);
});

test('permissões: lista vazia = ninguém (falha fechada); e-mails comparados em minúsculas', () => {
  const amb = criarAmbiente({ props: { ...PROPS, EMAILS_DISPARAR: '', EMAILS_DECIDIR: '' } });
  assert.equal(amb.post(disparo('tok-falso-robertta', 'radar-diario')).codigo, 'sem-permissao');
  assert.equal(amb.post(decisao('tok-falso-robertta', 'S47-01', {})).codigo, 'sem-permissao');
  const f = criarAmbiente().pure('conferirPermissao');
  const listas = { disparar: [GABRIEL], decidir: [ROBERTTA] };
  assert.equal(f('disparar', 'radar-diario', 'Robertta@Exemplo.com', listas).ok, true);
  assert.equal(f('decidir-roteiro', 'roteirista-decisao', GABRIEL, listas).ok, false);
  assert.equal(f('disparar', 'radar-diario', '', listas).ok, false);
  assert.deepEqual(json(criarAmbiente().pure('listaDeEmails')(' A@x.com, b@Y.com;c@z.com  sem-arroba ')), ['a@x.com', 'b@y.com', 'c@z.com']);
});

/* ----------------------------------------------------------------- rotinas e ids */

test('rotinas: fora da lista, motor-* e roteirista-decisao por "disparar" são recusadas', () => {
  const amb = criarAmbiente();
  assert.equal(amb.post(disparo('tok-falso-robertta', 'radar-qualquer')).codigo, 'rotina-desconhecida');
  assert.equal(amb.post(disparo('tok-falso-robertta', '')).codigo, 'rotina-desconhecida');
  for (const r of ['motor-editar', 'motor-checar-fontes', 'motor-revisar', 'motor-finalizar']) {
    const res = amb.post(disparo('tok-falso-robertta', r, { id_alvo: 'S47-01' }));
    assert.equal(res.codigo, 'rotina-desconhecida', r);
    assert.match(res.mensagem, /motor/);
  }
  assert.equal(amb.post(disparo('tok-falso-robertta', 'roteirista-decisao', { id_alvo: 'S47-01' })).codigo, 'rotina-desconhecida');
  assert.equal(amb.post(decisao('tok-falso-robertta', 'S47-01', {}, { rotina: 'radar-diario' })).codigo, 'rotina-desconhecida');
  assert.equal(amb.execs().length, 0);
});

test('ids: mesma regra de idValido do app; roteiro exige id; lista de pautas do enviar conferida', () => {
  const amb = criarAmbiente();
  for (const id of ['S1-01', 'x', 'S47-1', 's47-01', 'T1', 'S47-01 ']) {
    const r = amb.post(disparo('tok-falso-robertta', 'diretor-retrospectiva', { id_alvo: id }));
    if (id === 'S47-01 ') assert.notEqual(r.codigo, 'id-invalido'); // espaço nas pontas é aparado
    else assert.equal(r.codigo, 'id-invalido', id);
  }
  assert.equal(amb.post(decisao('tok-falso-robertta', '', {})).codigo, 'id-invalido');
  assert.equal(amb.post(disparo('tok-falso-robertta', 'radar-enviar', { dados: { ids: 'S47-01,xx' } })).codigo, 'id-invalido');
});

/* ----------------------------------------------------------------- decisão de roteiro */

test('decidir-roteiro: valida id, versão, decisão, pedido e motivo', () => {
  const amb = criarAmbiente();
  const R = 'tok-falso-robertta';
  assert.equal(amb.post(decisao(R, 'S47-01', { id: 'S47-02' })).codigo, 'id-invalido');
  for (const v of [0, -1, 1.5, 'a', '', null]) assert.equal(amb.post(decisao(R, 'S47-01', { versao: v })).codigo, v === null ? 'pedido-invalido' : 'versao-invalida', String(v));
  assert.equal(amb.post(decisao(R, 'S47-01', { decisao: 'talvez' })).codigo, 'decisao-invalida');
  assert.equal(amb.post(decisao(R, 'S47-01', { decisao: 'mudar', pedido: '   ' })).codigo, 'falta-pedido');
  assert.equal(amb.post(decisao(R, 'S47-01', { decisao: 'recusar', motivo: 'chato' })).codigo, 'motivo-invalido');
  assert.equal(amb.post(decisao(R, 'S47-01', { campo_novo: 'x' })).codigo, 'pedido-invalido');
  assert.equal(amb.execs().length, 0);
});

test('decidir-roteiro: resumos curtos e dados do bot exatamente {id, versao, decisao, pedido, motivo}', () => {
  const amb = criarAmbiente({ props: { ...PROPS, LIMITE_POR_HORA: '20' } });
  const R = 'tok-falso-robertta';
  assert.equal(amb.post(decisao(R, 'S47-01', { versao: 2 })).ok, true);
  assert.equal(amb.post(decisao(R, 'S47-02', { versao: 3, decisao: 'mudar', pedido: 'Encurtar o gancho.' })).ok, true);
  assert.equal(amb.post(decisao(R, 'S47-03', { versao: 1, decisao: 'recusar', motivo: 'Clareza: confuso no meio' })).ok, true);
  assert.equal(amb.post(decisao(R, 'S47-04', { versao: 1, decisao: 'recusar', motivo: 'tom' })).ok, true);
  assert.deepEqual(json(amb.execs().map((e) => e.resumo)), ['aprovar v2', 'mudar v3', 'recusar v1 (clareza)', 'recusar v1 (tom)']);
  const corpos = amb.webhooksChamados().map((c) => JSON.parse(c.params.payload));
  assert.deepEqual(corpos[0].dados, { id: 'S47-01', versao: 2, decisao: 'aprovar', pedido: '', motivo: '' });
  assert.deepEqual(corpos[1].dados, { id: 'S47-02', versao: 3, decisao: 'mudar', pedido: 'Encurtar o gancho.', motivo: '' });
  // o motivo vai como o app mandou (sem separar a observação)
  assert.deepEqual(corpos[2].dados, { id: 'S47-03', versao: 1, decisao: 'recusar', pedido: '', motivo: 'Clareza: confuso no meio' });
  // sem `pedido` no corpo do app: vai ''
  const semPedido = decisao(R, 'S47-09', {});
  delete semPedido.dados.pedido;
  assert.equal(amb.post(semPedido).ok, true);
  assert.equal(JSON.parse(amb.webhooksChamados().at(-1).params.payload).dados.pedido, '');
  // observacao não é campo da decisão de roteiro
  assert.equal(amb.post(decisao(R, 'S47-10', { observacao: 'x' })).codigo, 'pedido-invalido');
  assert.ok(amb.webhooksChamados().every((c) => c.url === URL_ROTEIRISTA && c.params.headers.Authorization === `Bearer ${CHAVE_ROTEIRISTA}`));
});

/* ----------------------------------------------------------------- idempotência */

test('chave_idem repetida: devolve o id existente e não dispara de novo', () => {
  const amb = criarAmbiente();
  const corpo = disparo('tok-falso-gabriel', 'radar-diario');
  const a = amb.post(corpo);
  const b = amb.post(corpo);
  assert.equal(a.ok, true);
  assert.deepEqual(b, { ok: true, repetido: true, id_execucao: a.id_execucao, status: 'pedido' });
  assert.equal(amb.execs().length, 1);
  assert.equal(amb.webhooksChamados().length, 1);
  // a mesma chave em outra rotina não vira outro pedido
  assert.equal(amb.post({ ...corpo, rotina: 'diretor-retrospectiva' }).codigo, 'pedido-invalido');
});

test('chave_idem de um pedido que falhou: recusa e pede uma janela nova (não fica "ok" falso)', () => {
  const amb = criarAmbiente({ webhooks: { [URL_RADAR]: 500 } });
  const corpo = disparo('tok-falso-gabriel', 'radar-diario');
  assert.equal(amb.post(corpo).codigo, 'webhook-falhou');
  const r = amb.post(corpo);
  assert.equal(r.codigo, 'repetido-com-erro');
  assert.equal(amb.webhooksChamados().length, 2); // as 2 tentativas do primeiro pedido, nenhuma a mais
});

/* ----------------------------------------------------------------- trava */

test('trava: linha rodando do grupo radar com menos de 2 h recusa com "Rodando desde…"', () => {
  const amb = criarAmbiente({
    linhas: [CAB, linha({ id_execucao: 'EX-20261118-091000-aaaa', bot: 'radar', rotina: 'radar-diario', origem: 'agendada', quem: 'cron', inicio: '2026-11-18 09:10', status: 'rodando' })],
  });
  const r = amb.post(disparo('tok-falso-robertta', 'radar-selecao'));
  assert.equal(r.codigo, 'rodando');
  assert.equal(r.mensagem, 'Rodando desde 9h10 (agendada).');
  assert.equal(r.desde, '2026-11-18 09:10:00');
  assert.equal(r.origem, 'agendada');
  assert.equal(amb.aba.linhas.length, 2);
});

test('trava: ≥ 2 h "parece travada"; marcar com o id certo vira "travada" (nada apagado) e segue; id errado recusa', () => {
  const velha = linha({
    id_execucao: 'EX-20261118-070500-bbbb', chave_idem: 'c-agendada', bot: 'radar', rotina: 'radar-diario', origem: 'agendada', quem: 'cron',
    inicio: '2026-11-18 07:05', status: 'rodando', resumo: 'lendo o X', link: 'https://exemplo.test/x',
  });
  const amb = criarAmbiente({ linhas: [CAB, velha] });
  const sem = amb.post(disparo('tok-falso-robertta', 'radar-diario'));
  assert.equal(sem.codigo, 'parece-travada');
  assert.equal(sem.id_execucao_travada, 'EX-20261118-070500-bbbb');
  assert.match(sem.mensagem, /há mais de 2 h/);

  const errado = amb.post(disparo('tok-falso-robertta', 'radar-diario', { dados: { marcar_travada: true, id_execucao_travada: 'EX-outra' } }));
  assert.equal(errado.codigo, 'parece-travada');
  assert.match(errado.mensagem, /mudou/);
  // "true" em texto não vale como marcar
  assert.equal(amb.post(disparo('tok-falso-robertta', 'radar-diario', { dados: { marcar_travada: 'true', id_execucao_travada: 'EX-20261118-070500-bbbb' } })).codigo, 'parece-travada');
  assert.equal(amb.aba.linhas[1][11], 'rodando');

  const certo = amb.post(disparo('tok-falso-robertta', 'radar-diario', { dados: { marcar_travada: true, id_execucao_travada: 'EX-20261118-070500-bbbb' } }));
  assert.equal(certo.ok, true);
  const [antiga, nova] = amb.execs();
  assert.equal(antiga.status, 'travada');
  assert.equal(antiga.resumo, 'lendo o X'); // nada apagado
  assert.equal(antiga.link, 'https://exemplo.test/x');
  assert.equal(antiga.chave_idem, 'c-agendada');
  assert.match(antiga.erro, /marcada como travada pelo app \(EX-/);
  assert.equal(nova.status, 'pedido');
  assert.match(nova.resumo, /EX-20261118-070500-bbbb marcada como travada/);
  // marcar_travada/id_execucao_travada não vão ao bot
  const corpo = JSON.parse(amb.webhooksChamados()[0].params.payload);
  assert.deepEqual(corpo.dados, {});
});

test('trava: linha aberta sem início também "parece travada"', () => {
  const amb = criarAmbiente({ linhas: [CAB, linha({ id_execucao: 'EX-x', bot: 'diretor', rotina: 'diretor-retrospectiva', origem: 'chat', status: 'pedido' })] });
  assert.equal(amb.post(disparo('tok-falso-robertta', 'diretor-retrospectiva')).codigo, 'parece-travada');
});

test('trava: grupos diferentes não se travam (roteirista por id, radar, diretor)', () => {
  const amb = criarAmbiente({
    linhas: [CAB,
      linha({ id_execucao: 'EX-r1', bot: 'roteirista', rotina: 'roteirista-decisao', origem: 'manual-app', id_alvo: 'S47-01', inicio: '2026-11-18 09:50', status: 'rodando' }),
      linha({ id_execucao: 'EX-d1', bot: 'diretor', rotina: 'diretor-retrospectiva', origem: 'manual-app', inicio: '2026-11-18 09:55', status: 'pedido' }),
    ],
  });
  assert.equal(amb.post(decisao('tok-falso-robertta', 'S47-02', {})).ok, true);
  assert.equal(amb.post(disparo('tok-falso-robertta', 'radar-diario')).ok, true);
  assert.equal(amb.post(decisao('tok-falso-robertta', 'S47-01', {})).codigo, 'rodando');
  assert.equal(amb.post(disparo('tok-falso-robertta', 'diretor-retrospectiva')).codigo, 'rodando');
  // o pedido que a ponte acabou de gravar trava o grupo radar
  assert.equal(amb.post(disparo('tok-falso-robertta', 'radar-enviar')).codigo, 'rodando');
});

/* ----------------------------------------------------------------- janela de proteção */

test('proteção: 6h30 recusa radar-diario e radar-enviar; domingo 9h recusa a seleção; segunda 7h30 recusa a retrospectiva', () => {
  const amb = criarAmbiente({ agora: '2026-11-18 06:30' });
  const d = amb.post(disparo('tok-falso-robertta', 'radar-diario'));
  assert.equal(d.codigo, 'protecao');
  assert.equal(d.mensagem, 'Perto da rodada agendada (Radar diário, hoje às 7h): o disparo manual fica fechado até 9h. O navegador do Radar faz uma tarefa por vez.');
  assert.equal(amb.post(disparo('tok-falso-robertta', 'radar-enviar')).codigo, 'protecao');
  // quarta: a retrospectiva não tem janela (passa da proteção; só falta o webhook do Diretor nestas propriedades)
  assert.equal(amb.post(disparo('tok-falso-robertta', 'diretor-retrospectiva')).codigo, 'webhook-nao-configurado');
  assert.equal(amb.post(decisao('tok-falso-robertta', 'S47-01', {})).ok, true); // roteirista não tem agenda

  const dom = criarAmbiente({ agora: '2026-11-15 09:00' });
  const s = dom.post(disparo('tok-falso-robertta', 'radar-selecao'));
  assert.equal(s.codigo, 'protecao');
  assert.match(s.mensagem, /Seleção de pautas, hoje às 9h/);
  assert.equal(s.ate, '2026-11-15 11:00:00');

  const seg = criarAmbiente({ agora: '2026-11-16 07:30' });
  assert.equal(seg.post(disparo('tok-falso-robertta', 'diretor-retrospectiva')).codigo, 'protecao');
});

test('proteção: depois que a agendada fecha, libera; sem linha agendada, até 2 h depois do horário', () => {
  const fechada = criarAmbiente({
    agora: '2026-11-18 07:30',
    linhas: [CAB, linha({ id_execucao: 'EX-ag', bot: 'radar', rotina: 'radar-diario', origem: 'agendada', quem: 'cron', inicio: '2026-11-18 07:02', fim: '2026-11-18 07:20', status: 'ok' })],
  });
  assert.equal(fechada.post(disparo('tok-falso-robertta', 'radar-diario')).ok, true);

  const semLinha = criarAmbiente({ agora: '2026-11-18 08:00' });
  const r = semLinha.post(disparo('tok-falso-robertta', 'radar-diario'));
  assert.equal(r.codigo, 'protecao');
  assert.equal(r.ate, '2026-11-18 09:00:00');
  semLinha.setAgora('2026-11-18 09:00');
  assert.equal(semLinha.post(disparo('tok-falso-robertta', 'radar-diario')).ok, true);
});

test('proteção e trava: a rodada agendada nunca é bloqueada (só na lógica pura; o doPost não tem caminho de origem agendada)', () => {
  const amb = criarAmbiente();
  const execs = amb.pure('lerExecucoes')([CAB, linha({ id_execucao: 'EX-a', bot: 'radar', rotina: 'radar-diario', origem: 'manual-app', inicio: '2026-11-18 06:50', status: 'rodando' })]).execucoes;
  const agora = sp('2026-11-18 06:55');
  assert.equal(amb.pure('avaliarTrava')(execs, 'radar-diario', '', agora, { origem: 'agendada' }).livre, true);
  assert.equal(amb.pure('avaliarProtecao')(execs, 'radar-diario', agora, { origem: 'agendada' }).livre, true);
  assert.equal(amb.pure('avaliarTrava')(execs, 'radar-diario', '', agora).livre, false);
  assert.equal(amb.pure('avaliarProtecao')(execs, 'radar-diario', agora).livre, false);
  // o pedido não escolhe a origem: toda linha gravada pela ponte é manual-app
  amb.post(disparo('tok-falso-gabriel', 'diretor-retrospectiva'));
  assert.equal(amb.execs()[0].origem, 'manual-app');
});

/* ----------------------------------------------------------------- limite por hora */

test('limite: no máximo N disparos manuais por rotina por hora (padrão 4; propriedades ajustam)', () => {
  const feitas = [0, 10, 20, 30].map((m, i) => linha({
    id_execucao: `EX-${i}`, bot: 'radar', rotina: 'radar-diario', origem: 'manual-app', inicio: `2026-11-18 09:${String(5 + m).padStart(2, '0')}`, status: 'ok',
  }));
  const amb = criarAmbiente({ linhas: [CAB, ...feitas] });
  const r = amb.post(disparo('tok-falso-robertta', 'radar-diario'));
  assert.equal(r.codigo, 'limite');
  assert.match(r.mensagem, /4 pedidos de "Radar diário"/);
  // outra rotina do mesmo bot não conta
  assert.equal(amb.post(disparo('tok-falso-robertta', 'radar-selecao')).ok, true);

  const maisTarde = criarAmbiente({ agora: '2026-11-18 10:06', linhas: [CAB, ...feitas] }); // a das 9h05 saiu da janela
  assert.equal(maisTarde.post(disparo('tok-falso-robertta', 'radar-diario')).ok, true);

  const geral = criarAmbiente({ linhas: [CAB, feitas[0], feitas[1]], props: { ...PROPS, LIMITE_POR_HORA: '2' } });
  assert.equal(geral.post(disparo('tok-falso-robertta', 'radar-diario')).codigo, 'limite');
  const porRotina = criarAmbiente({ linhas: [CAB, ...feitas], props: { ...PROPS, LIMITE_POR_HORA: '2', LIMITE_POR_HORA_RADAR_DIARIO: '10' } });
  assert.equal(porRotina.post(disparo('tok-falso-robertta', 'radar-diario')).ok, true);
});

/* ----------------------------------------------------------------- ids T */

test('id T: vai para Execuções com teste = sim; podeGravarNaAba recusa T em Decisões e Desempenho', () => {
  const amb = criarAmbiente();
  const r = amb.post(decisao('tok-falso-robertta', 'T01-01', { versao: 1 }));
  assert.equal(r.ok, true);
  assert.equal(r.teste, true);
  assert.equal(amb.aba.linhas[1][15], 'sim');
  assert.equal(JSON.parse(amb.webhooksChamados()[0].params.payload).id_alvo, 'T01-01'); // o bot vê o id T
  amb.post(decisao('tok-falso-robertta', 'S47-01', { versao: 1 }));
  assert.equal(amb.aba.linhas[2][15], 'não');

  const pode = amb.pure('podeGravarNaAba');
  assert.equal(pode('Decisões', 'T01-01').ok, false);
  assert.equal(pode('Decisões', 'T01-01').codigo, 'teste-recusado');
  assert.equal(pode('desempenho', 'T02').ok, false);
  assert.equal(pode('DECISOES', ' T03 ').ok, false);
  assert.equal(pode('Decisões', 'S47-01').ok, true);
  assert.equal(pode('Execuções', 'T01-01').ok, true);
  // e a ponte só grava em Execuções
  const g = amb.pure('conferirGravacao');
  assert.equal(g('Decisões', 'S47-01', 'Execuções').codigo, 'aba-nao-permitida');
  assert.equal(g('Desempenho', 'T01', 'Execuções').codigo, 'teste-recusado');
  assert.equal(g('Execuções', 'T01', 'Execuções').ok, true);
  assert.equal(g('Registro', 'S47-01', 'Registro').ok, true); // ABA_EXECUCOES com outro nome
});

/* ----------------------------------------------------------------- webhook */

test('webhook não configurado: linha vira "erro" (sem URL nem chave) e a resposta diz que nada rodou', () => {
  const amb = criarAmbiente();
  const r = amb.post(disparo('tok-falso-robertta', 'diretor-retrospectiva'));
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'webhook-nao-configurado');
  assert.match(r.mensagem, /Nada rodou/);
  assert.match(r.id_execucao, /^EX-/);
  const [e] = amb.execs();
  assert.equal(e.status, 'erro');
  assert.equal(e.erro, 'webhook não configurado');
  assert.equal(e.fim, '2026-11-18 10:00:00');
  assert.equal(amb.webhooksChamados().length, 0);
});

test('webhook: um por bot (WEBHOOK_<BOT>_URL/_KEY), só https e com chave; o esquema antigo não vale', () => {
  const amb = criarAmbiente();
  const escolher = amb.pure('escolherWebhook');
  const radar = { WEBHOOK_RADAR_URL: 'https://x.test/r', WEBHOOK_RADAR_KEY: 'k' };
  for (const r of ['radar-diario', 'radar-selecao', 'radar-enviar', 'radar-candidato']) assert.equal(escolher(radar, r).url, 'https://x.test/r', r);
  assert.equal(escolher(radar, 'roteirista-decisao'), null);
  assert.equal(escolher({ WEBHOOK_ROTEIRISTA_URL: 'https://x.test/t', WEBHOOK_ROTEIRISTA_KEY: 'k' }, 'roteirista-decisao').url, 'https://x.test/t');
  assert.equal(escolher({ WEBHOOK_DIRETOR_URL: 'https://x.test/d', WEBHOOK_DIRETOR_KEY: 'k' }, 'diretor-retrospectiva').url, 'https://x.test/d');
  assert.equal(escolher({ WEBHOOK_RADAR_URL: 'http://inseguro.test/x', WEBHOOK_RADAR_KEY: 'k' }, 'radar-diario'), null);
  assert.equal(escolher({ WEBHOOK_RADAR_URL: 'https://x.test/a' }, 'radar-diario'), null); // sem chave
  assert.equal(escolher({ WEBHOOK_URL_RADAR: 'https://x.test/a', WEBHOOK_KEY_RADAR: 'k' }, 'radar-diario'), null); // esquema antigo
  assert.equal(escolher({ WEBHOOK_URL_RADAR_DIARIO: 'https://x.test/a', WEBHOOK_KEY_RADAR_DIARIO: 'k' }, 'radar-diario'), null);
  assert.equal(escolher(radar, 'motor-editar'), null);

  const http = criarAmbiente({ props: { ...PROPS, WEBHOOK_RADAR_URL: 'http://webhook.exemplo.test/radar' } });
  assert.equal(http.post(disparo('tok-falso-robertta', 'radar-diario')).codigo, 'webhook-nao-configurado');
  assert.equal(http.webhooksChamados().length, 0);
});

test('webhook 500: duas tentativas, depois "webhook-falhou" e linha "erro"; 404 não tenta de novo; 500 e depois 200 = ok', () => {
  const amb = criarAmbiente({ webhooks: { [URL_RADAR]: 500 } });
  const r = amb.post(disparo('tok-falso-robertta', 'radar-diario'));
  assert.equal(r.codigo, 'webhook-falhou');
  assert.equal(amb.webhooksChamados().length, 2);
  const [e] = amb.execs();
  assert.equal(e.status, 'erro');
  assert.equal(e.erro, 'webhook falhou (HTTP 500)');
  assert.ok(!JSON.stringify(r).includes('webhook.exemplo') && !JSON.stringify(r).includes(CHAVE_RADAR));

  const nf = criarAmbiente({ webhooks: { [URL_RADAR]: 404 } });
  assert.equal(nf.post(disparo('tok-falso-robertta', 'radar-diario')).codigo, 'webhook-falhou');
  assert.equal(nf.webhooksChamados().length, 1);

  const lanca = criarAmbiente({ webhooks: { [URL_RADAR]: 'lanca' } });
  assert.equal(lanca.post(disparo('tok-falso-robertta', 'radar-diario')).codigo, 'webhook-falhou');
  assert.equal(lanca.execs()[0].erro, 'webhook falhou (sem resposta)');
  assert.ok(!JSON.stringify(lanca.logs).includes('webhook.exemplo'));

  const volta = criarAmbiente({ webhooks: { [URL_RADAR]: [500, 200] } });
  assert.equal(volta.post(disparo('tok-falso-robertta', 'radar-diario')).ok, true);
  assert.equal(volta.execs()[0].status, 'pedido');
});

test('webhook 2xx: payload completo, POST JSON com o Bearer da propriedade; resposta {ok, id_execucao, status:"pedido"}', () => {
  const amb = criarAmbiente();
  const r = amb.post(disparo('tok-falso-gabriel', 'radar-selecao', { id_lote: 'S47-manual-2', dados: { observacao: 'focar em sono' } }));
  assert.equal(r.ok, true);
  assert.equal(r.status, 'pedido');
  assert.match(r.id_execucao, /^EX-20261118-100000-[0-9a-f]{4}$/);
  const [w] = amb.webhooksChamados();
  assert.equal(w.url, URL_RADAR);
  assert.equal(w.params.method, 'post');
  assert.equal(w.params.contentType, 'application/json');
  assert.equal(w.params.muteHttpExceptions, true);
  assert.deepEqual(json(w.params.headers), { Authorization: `Bearer ${CHAVE_RADAR}` });
  const p = JSON.parse(w.params.payload);
  // EXATAMENTE estes campos, nesta ordem
  assert.deepEqual(Object.keys(p), ['rotina', 'id_execucao', 'chave_idem', 'origem', 'quem', 'id_alvo', 'id_lote', 'dados']);
  assert.deepEqual(p, {
    rotina: 'radar-selecao', id_execucao: r.id_execucao, chave_idem: p.chave_idem, origem: 'manual-app', quem: GABRIEL,
    id_alvo: '', id_lote: 'S47-manual-2', dados: { observacao: 'focar em sono' },
  });
  assert.match(p.chave_idem, /^chave-teste-/);
});

test('webhook por bot: Radar (3 rotinas), Roteirista e Diretor, cada um com URL e KEY próprias', () => {
  const props = { ...PROPS, WEBHOOK_DIRETOR_URL: 'https://webhook.exemplo.test/diretor', WEBHOOK_DIRETOR_KEY: 'chave-falsa-diretor' };
  const amb = criarAmbiente({ props });
  amb.post(disparo('tok-falso-robertta', 'radar-enviar', { id_lote: 'S47-manual-1', dados: { ids: 'S47-01,S47-02' } }));
  amb.post(decisao('tok-falso-robertta', 'S47-01', { versao: 2 }));
  amb.post(disparo('tok-falso-robertta', 'diretor-retrospectiva'));
  const ws = amb.webhooksChamados();
  assert.deepEqual(ws.map((w) => [w.url, w.params.headers.Authorization]), [
    [URL_RADAR, `Bearer ${CHAVE_RADAR}`],
    [URL_ROTEIRISTA, `Bearer ${CHAVE_ROTEIRISTA}`],
    ['https://webhook.exemplo.test/diretor', 'Bearer chave-falsa-diretor'],
  ]);
  const ps = ws.map((w) => JSON.parse(w.params.payload));
  assert.deepEqual(ps[0].dados, { ids: 'S47-01,S47-02' });
  assert.deepEqual(ps[1].dados, { id: 'S47-01', versao: 2, decisao: 'aprovar', pedido: '', motivo: '' });
  assert.deepEqual(ps[2].dados, {});
  for (const p of ps) assert.deepEqual(Object.keys(p), ['rotina', 'id_execucao', 'chave_idem', 'origem', 'quem', 'id_alvo', 'id_lote', 'dados']);
});

/* ----------------------------------------------------------------- Execuções */

test('Execuções: as 16 colunas, id e início no horário de São Paulo, tudo gravado como texto', () => {
  const amb = criarAmbiente({ agora: '2026-11-18 10:12' });
  amb.ctx.agora_ = () => new Date('2026-11-18T13:12:33Z');
  const r = amb.post(disparo('tok-falso-gabriel', 'radar-diario'));
  const l = amb.aba.linhas[1];
  assert.equal(l.length, 16);
  const reg = Object.fromEntries(CAB.map((c, i) => [c, l[i]]));
  assert.match(reg.id_execucao, /^EX-20261118-101233-[0-9a-f]{4}$/);
  assert.equal(reg.id_execucao, r.id_execucao);
  assert.equal(reg.bot, 'radar');
  assert.equal(reg.rotina, 'radar-diario');
  assert.equal(reg.origem, 'manual-app');
  assert.equal(reg.quem, GABRIEL);
  assert.equal(reg.inicio, '2026-11-18 10:12:33'); // texto (não virou data da planilha)
  assert.equal(lerDataHoraApp(reg.inicio).toISOString(), '2026-11-18T13:12:33.000Z');
  assert.equal(reg.status, 'pedido');
  assert.equal(reg.teste, 'não');
  for (const c of ['etapa_evento', 'fim', 'resumo', 'erro', 'link', 'id_alvo', 'id_lote']) assert.equal(reg[c], '', c);
  // o app lê a linha como uma execução 'pedido'
  const app = C.lerExecucoes(amb.aba.linhas).execucoes[0];
  assert.equal(app.status, 'pedido');
  assert.equal(app.inicioData.toISOString(), '2026-11-18T13:12:33.000Z');
});

test('fórmula injetada no pedido não vira fórmula: o texto vai como dado ao bot e nenhuma célula é fórmula', () => {
  const amb = criarAmbiente();
  const ataque = '=IMPORTXML("https://mal.exemplo.test","//a")';
  assert.equal(amb.post(decisao('tok-falso-robertta', 'S47-01', { versao: 3, decisao: 'mudar', pedido: ataque })).ok, true);
  assert.equal(amb.post(disparo('tok-falso-robertta', 'diretor-retrospectiva', { dados: { observacao: '+SUM(1)' } })).codigo, 'webhook-nao-configurado');
  assert.deepEqual(amb.aba.formulas, []);
  assert.equal(JSON.parse(amb.webhooksChamados()[0].params.payload).dados.pedido, ataque);
  const cel = amb.pure('textoCelula');
  assert.equal(cel('=1+1'), "'=1+1");
  assert.equal(cel('+1'), "'+1");
  assert.equal(cel('-1'), "'-1");
  assert.equal(cel('@x'), "'@x");
  assert.equal(cel("'já"), "''já");
  assert.equal(cel(''), '');
  // linhaNaOrdem protege todas as células de texto
  const lo = amb.pure('linhaNaOrdem')(['resumo', 'erro'], { resumo: 0, erro: 1 }, { resumo: '=HYPERLINK("x")', erro: '@me' });
  assert.deepEqual(json(lo), ["'=HYPERLINK(\"x\")", "'@me"]);
});

test('cabeçalho com sinônimos, outra ordem, maiúsculas e coluna extra: lê a trava e grava na coluna certa', () => {
  const cab = ['Quando', 'Resultado', 'Rotina', 'ID Execução', 'Chave Idem', 'Bot', 'Gatilho', 'Quem disparou', 'Id', 'Teste', 'Detalhe', 'Coluna da Robertta', 'Lote'];
  const amb = criarAmbiente({
    linhas: [['Execuções dos bots'], cab, [new Date('2026-11-18T12:50:00Z'), 'Rodando', 'Roteirista decisao', 'EX-ant', 'c1', 'Roteirista', 'App', 'x@y', 'S47-01', 'não', '', 'nota', '']],
  });
  const t = amb.pure('lerExecucoes')(amb.aba.linhas);
  assert.equal(t.linhaCabecalho, 1);
  assert.equal(t.execucoes[0].status, 'rodando');
  assert.equal(t.execucoes[0].origem, 'manual-app');
  assert.equal(t.execucoes[0].inicioData.toISOString(), '2026-11-18T12:50:00.000Z'); // Date da planilha
  assert.equal(amb.post(decisao('tok-falso-robertta', 'S47-01', {})).codigo, 'rodando');
  const r = amb.post(decisao('tok-falso-robertta', 'S47-02', { versao: 4 }));
  assert.equal(r.ok, true);
  const nova = amb.aba.linhas[3];
  assert.equal(nova.length, cab.length);
  const em = (nome) => nova[cab.indexOf(nome)];
  assert.equal(em('ID Execução'), r.id_execucao);
  assert.equal(em('Resultado'), 'pedido');
  assert.equal(em('Rotina'), 'roteirista-decisao');
  assert.equal(em('Gatilho'), 'manual-app');
  assert.equal(em('Quem disparou'), ROBERTTA);
  assert.equal(em('Id'), 'S47-02');
  assert.equal(em('Detalhe'), 'aprovar v4');
  assert.equal(em('Quando'), '2026-11-18 10:00:00');
  assert.equal(em('Coluna da Robertta'), '');
});

test('aba Execuções ausente: a ponte cria (insertSheet) com as 16 colunas e congela a linha 1; vazia: escreve o cabeçalho', () => {
  const sem = criarAmbiente({ nomeAba: 'Outra' });
  const r = sem.post(disparo('tok-falso-robertta', 'radar-diario'));
  assert.equal(r.ok, true);
  const nova = sem.abas['Execuções'];
  assert.equal(nova.criada, true);
  assert.equal(nova.congeladas, 1);
  assert.deepEqual(json(nova.linhas[0]), CAB);
  assert.equal(nova.linhas[1][0], r.id_execucao);
  assert.deepEqual(json(sem.abas.Outra.linhas), [CAB]); // a outra aba não foi tocada

  const vazia = criarAmbiente({ linhas: [] });
  assert.equal(vazia.post(disparo('tok-falso-robertta', 'radar-diario')).ok, true);
  assert.equal(vazia.aba.criada, undefined);
  assert.equal(vazia.aba.congeladas, 1);
  assert.deepEqual(json(vazia.aba.linhas[0]), CAB);
  assert.equal(vazia.execs().length, 1);

  const comNome = criarAmbiente({ nomeAba: 'Outra', props: { ...PROPS, ABA_EXECUCOES: 'Registro' } });
  assert.equal(comNome.post(disparo('tok-falso-robertta', 'radar-diario')).ok, true);
  assert.equal(comNome.abas.Registro.criada, true);
});

test('aba Execuções sem colunas essenciais → planilha-sem-execucoes com os cabeçalhos esperados', () => {
  const r = criarAmbiente({ linhas: [['titulo qualquer']] }).post(disparo('tok-falso-robertta', 'radar-diario'));
  assert.equal(r.codigo, 'planilha-sem-execucoes');
  assert.match(r.mensagem, /id_execucao, chave_idem, bot, rotina, origem, quem, id_alvo, id_lote, etapa_evento, inicio, fim, status, resumo, erro, link, teste/);

  const faltando = criarAmbiente({ linhas: [['id_execucao', 'rotina', 'status', 'inicio']] });
  const f = faltando.post(disparo('tok-falso-robertta', 'radar-diario'));
  assert.equal(f.codigo, 'planilha-sem-execucoes');
  assert.match(f.mensagem, /Faltam colunas na aba Execuções \(chave_idem, bot, origem, quem, id_alvo, teste\)/);
  assert.equal(faltando.webhooksChamados().length, 0);

  const outroNome = criarAmbiente({ nomeAba: 'Registro', props: { ...PROPS, ABA_EXECUCOES: 'Registro' } });
  assert.equal(outroNome.post(disparo('tok-falso-robertta', 'radar-diario')).ok, true);
});

test('lock ocupado → "ocupado" sem gravar; erro inesperado → "erro-interno", lock solto e log sem segredo', () => {
  const ocupado = criarAmbiente({ lockOk: false });
  const r = ocupado.post(disparo('tok-falso-robertta', 'radar-diario'));
  assert.equal(r.codigo, 'ocupado');
  assert.equal(ocupado.aba.linhas.length, 1);

  const quebra = criarAmbiente({ abrirLanca: 'falhou com tok-falso-robertta em https://planilha.exemplo.test?access_token=tok-falso-robertta' });
  const e = quebra.post(disparo('tok-falso-robertta', 'radar-diario'));
  assert.deepEqual(e, { ok: false, codigo: 'erro-interno', mensagem: 'A ponte teve um erro. Tente de novo.' });
  const log = JSON.stringify(quebra.logs);
  assert.ok(log.includes('erro interno'));
  assert.ok(!log.includes('tok-falso') && !log.includes('planilha.exemplo'));
});

/* ----------------------------------------------------------------- o token nunca sai */

test('o token NUNCA aparece em célula, log, resposta, webhook (corpo e headers) nem no cache', () => {
  const amb = criarAmbiente({ webhooks: { [URL_ROTEIRISTA]: 500 } });
  amb.post(disparo('tok-falso-gabriel', 'radar-diario', { id_lote: 'S47-manual-1', dados: { observacao: 'ok' } }));
  amb.post(disparo('tok-falso-gabriel', 'radar-diario')); // rodando
  amb.post(decisao('tok-falso-robertta', 'S47-01', { decisao: 'mudar', pedido: 'mais curto' })); // webhook 500
  amb.post(disparo('tok-falso-robertta', 'diretor-retrospectiva')); // sem webhook
  amb.post(disparo('tok-falso-aud-errado', 'radar-diario'));
  amb.post(disparo('tok-falso-sem-email', 'radar-selecao'));
  amb.post(decisao('tok-falso-gabriel', 'S47-02', {}));
  amb.post('{"acao":"disparar","access_token":"tok-falso-robertta","x":1}');
  const tudo = tudoQueSai(amb);
  assert.ok(!tudo.includes('tok-falso'), 'token vazou');
  // só o Google recebeu o token
  const comToken = amb.chamadas.filter((c) => JSON.stringify(c).includes('tok-falso'));
  assert.ok(comToken.length > 0);
  assert.ok(comToken.every((c) => c.url.startsWith('https://oauth2.googleapis.com/tokeninfo?') || c.url === 'https://openidconnect.googleapis.com/v1/userinfo'));
  // e nenhuma chave de webhook volta nas respostas nem nos logs
  const fora = JSON.stringify({ r: amb.respostas.map((r) => r.conteudo), l: amb.logs });
  for (const s of [CHAVE_RADAR, CHAVE_ROTEIRISTA, URL_RADAR, URL_ROTEIRISTA, 'planilha-falsa']) assert.ok(!fora.includes(s), s);
});

test('redigir: tira token, Bearer, access_token= e URLs', () => {
  const r = criarAmbiente().pure('redigir');
  assert.equal(r('a tok-falso-x b', ['tok-falso-x']), 'a [omitido] b');
  assert.equal(r('Authorization: Bearer abc.def'), 'Authorization: Bearer [omitido]');
  assert.ok(!r('veja https://x.test/a?access_token=zzz').includes('zzz'));
});

/* ----------------------------------------------------------------- configurar */

test('configurar(): diz o que falta sem imprimir valores secretos', () => {
  const amb = criarAmbiente({ props: { CLIENT_ID: CLIENT, PLANILHA_ID: 'planilha-falsa', EMAILS_DECIDIR: ROBERTTA, WEBHOOK_RADAR_URL: URL_RADAR, WEBHOOK_RADAR_KEY: CHAVE_RADAR, WEBHOOK_DIRETOR_URL: 'http://inseguro.test' } });
  const r = amb.ctx.configurar();
  assert.equal(r.ok, false);
  assert.ok(r.faltas.some((f) => f.startsWith('diretor:')));
  assert.ok(r.avisos.some((a) => a.startsWith('roteirista:')));
  const log = JSON.stringify(amb.logs);
  for (const s of [CHAVE_RADAR, URL_RADAR, ROBERTTA, 'inseguro.test', 'planilha-falsa', CLIENT]) assert.ok(!log.includes(s), s);
  assert.ok(log.includes('radar: webhook configurado.'));

  const vazio = criarAmbiente({ props: {} }).ctx.configurar();
  assert.equal(vazio.ok, false);
  assert.ok(vazio.faltas.some((f) => f.startsWith('CLIENT_ID')));
});

/* ----------------------------------------------------------------- configuração inicial (Setup.gs) */

const CODIGO_SETUP = 'codigo-falso-de-uso-unico-0123456789';
const HASH_SETUP = createHash('sha256').update(CODIGO_SETUP, 'utf8').digest('hex');
const configurar = (props, codigo = CODIGO_SETUP) => ({ acao: 'configurar', codigo, propriedades: props });
const NOVAS = {
  PLANILHA_ID: 'planilha-nova-falsa', WEBHOOK_RADAR_URL: 'https://webhook.exemplo.test/novo-radar', WEBHOOK_RADAR_KEY: 'chave-falsa-nova', EMAILS_DECIDIR: ROBERTTA,
};

test('acao configurar: sem Setup.gs é ação desconhecida; código errado e propriedade fora da lista são recusados', () => {
  const sem = criarAmbiente();
  const desconhecida = sem.post({ acao: 'qualquer-coisa', access_token: 'tok-falso-robertta' });
  const r = sem.post(configurar(NOVAS));
  assert.deepEqual(r, desconhecida);
  assert.deepEqual(r, { ok: false, codigo: 'pedido-invalido', mensagem: 'Ação desconhecida.' });
  assert.equal(sem.gravacoesDeProps.length, 0);

  const amb = criarAmbiente({ setupHash: HASH_SETUP });
  assert.equal(amb.post(configurar(NOVAS, 'codigo-errado-de-uso-unico-000000')).codigo, 'configuracao-recusada');
  assert.equal(amb.post(configurar(NOVAS, 'curto')).codigo, 'configuracao-recusada');
  assert.equal(amb.post(configurar({ ...NOVAS, WEBHOOK_URL_RADAR: 'https://x.test' })).codigo, 'pedido-invalido');
  assert.equal(amb.post(configurar({ OUTRA: 'x' })).codigo, 'pedido-invalido');
  assert.equal(amb.post(configurar({ WEBHOOK_DIRETOR_URL: 'http://inseguro.test/d' })).codigo, 'pedido-invalido');
  assert.equal(amb.post(configurar({ PLANILHA_ID: 5 })).codigo, 'pedido-invalido');
  assert.equal(amb.post(configurar({ PLANILHA_ID: 'a'.repeat(2001) })).codigo, 'pedido-invalido');
  assert.equal(amb.post(configurar({})).codigo, 'pedido-invalido');
  assert.equal(amb.post({ ...configurar(NOVAS), access_token: 'tok-falso-robertta' }).codigo, 'pedido-invalido');
  assert.equal(amb.gravacoesDeProps.length, 0);
  // hash mal formado em Setup.gs = sem Setup
  assert.equal(criarAmbiente({ setupHash: 'abc' }).post(configurar(NOVAS)).mensagem, 'Ação desconhecida.');
});

test('acao configurar: grava só as da lista sem apagar as outras, devolve só os nomes, nada em log', () => {
  const amb = criarAmbiente({ setupHash: HASH_SETUP.toUpperCase() });
  const r = amb.post(configurar(NOVAS));
  assert.deepEqual(r, { ok: true, gravadas: ['EMAILS_DECIDIR', 'PLANILHA_ID', 'WEBHOOK_RADAR_KEY', 'WEBHOOK_RADAR_URL'] });
  assert.equal(amb.gravacoesDeProps.length, 1);
  assert.equal(amb.gravacoesDeProps[0].apagarOutras, false);
  assert.equal(amb.propsVivas.PLANILHA_ID, 'planilha-nova-falsa');
  assert.equal(amb.propsVivas.CLIENT_ID, CLIENT); // as outras ficaram
  const fora = JSON.stringify({ r: amb.respostas.map((x) => x.conteudo), l: amb.logs });
  for (const v of [...Object.values(NOVAS), CODIGO_SETUP, HASH_SETUP]) assert.ok(!fora.includes(v), v);
  assert.equal(amb.logs.length, 0);
  // não mexe na planilha nem fala com ninguém
  assert.equal(amb.chamadas.length, 0);
  assert.equal(amb.lock.pedidos, 0);
  // e as outras ações continuam iguais com Setup.gs presente
  assert.equal(amb.post(disparo('tok-falso-gabriel', 'diretor-retrospectiva')).codigo, 'webhook-nao-configurado');
  assert.equal(amb.pure('iguaisTempoConstante')('abc', 'abc'), true);
  assert.equal(amb.pure('iguaisTempoConstante')('abc', 'abd'), false);
  assert.equal(amb.pure('iguaisTempoConstante')('abc', 'abcd'), false);
});

test('autorizar(): só abre a planilha e faz um GET; não grava nada', () => {
  const amb = criarAmbiente();
  amb.ctx.autorizar();
  assert.deepEqual(amb.chamadas.map((c) => c.url), ['https://www.google.com']);
  assert.equal(amb.chamadas[0].params.muteHttpExceptions, true);
  assert.deepEqual(json(amb.aba.linhas), [CAB]);
  assert.equal(amb.gravacoesDeProps.length, 0);
});

/* ----------------------------------------------------------------- radar-diario: quantidade */

test('radar-diario: dados.quantidade opcional; inteiro de 1 a 15 vai ao webhook como número; fora disso, falha clara', () => {
  const amb = criarAmbiente();
  const r = amb.post(disparo('tok-falso-robertta', 'radar-diario', { dados: { quantidade: 7 } }));
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(amb.webhooksChamados()[0].params.payload).dados, { quantidade: 7 });
  assert.equal(amb.execs()[0].resumo, '7 candidatos');

  const texto = criarAmbiente();
  assert.equal(texto.post(disparo('tok-falso-gabriel', 'radar-diario', { dados: { quantidade: '12' } })).ok, true);
  assert.deepEqual(JSON.parse(texto.webhooksChamados()[0].params.payload).dados, { quantidade: 12 }); // sempre inteiro

  const sem = criarAmbiente();
  assert.equal(sem.post(disparo('tok-falso-robertta', 'radar-diario')).ok, true); // ausente: o bot usa o padrão dele
  assert.deepEqual(JSON.parse(sem.webhooksChamados()[0].params.payload).dados, {});

  for (const q of [0, 16, 2.5, -1, '', 'cinco', '3,0', true]) {
    const a = criarAmbiente();
    const x = a.post(disparo('tok-falso-robertta', 'radar-diario', { dados: { quantidade: q } }));
    assert.equal(x.ok, false, String(q));
    assert.equal(x.codigo, 'quantidade-invalida', String(q));
    assert.match(x.mensagem, /inteiro de 1 a 15/);
    assert.equal(a.aba.linhas.length, 1, 'nada gravado');
    assert.equal(a.webhooksChamados().length, 0);
  }
  // as outras rotinas não mudam (a quantidade é só do radar-diario)
  const sel = criarAmbiente();
  assert.equal(sel.post(disparo('tok-falso-robertta', 'radar-selecao', { dados: { quantidade: 99 } })).ok, true);
});

/* ----------------------------------------------------------------- radar-candidato */

const CAND = '2026-11-14-01';
const pedidoCandidato = (token, dados, extra = {}) => ({
  acao: 'disparar', rotina: 'radar-candidato', id_alvo: dados.id_candidato ?? CAND, id_lote: '',
  chave_idem: `${C.chaveIdemCandidato(dados.id_candidato ?? CAND, dados.destino, [])}-${++n}`, dados, access_token: token, ...extra,
});
/** Ambiente com Decisões (cabeçalho em outra ordem, maiúsculas e uma coluna extra) e Candidatos. */
function ambienteCandidato({ decisoes = null, candidatos = true, ...o } = {}) {
  const amb = criarAmbiente(o);
  const cabDec = ['Data', 'Quem', 'Decisão', 'Semana', 'Pauta', 'Motivo', 'ID Pauta', 'Rede', 'Observação interna', 'ID Candidato', 'id_lote', 'Origem'];
  amb.abas['Decisões'] = criarAba('Decisões', decisoes || [cabDec]);
  if (candidatos) {
    amb.abas.Candidatos = criarAba('Candidatos', [
      ['id', 'data', 'plataforma', 'link', 'criador', 'Visualizações', 'mediana do criador', 'outlier (x)', 'tema', 'Ângulo', 'nota', 'status', 'id_execucao', 'origem'],
      [CAND, '2026-11-14', 'Instagram', 'https://instagram.com/p/x', '@p', '1000', '100', '10', 'sono', 'Insônia de domingo', '80', 'novo', 'EX-A', 'automatica'],
    ]);
  }
  return amb;
}
/** Decisões lida como o app lê (pelo cabeçalho). */
const decisoesDoApp = (amb) => S.lerDecisoes(amb.abas['Decisões'].linhas).decisoes;

test('radar-candidato: Gabriel recusado; T, id errado, destino inválido e campos extras recusados sem gravar nada', () => {
  const casos = [
    ['tok-falso-gabriel', { id_candidato: CAND, destino: 'decidir' }, {}, 'sem-permissao'],
    ['tok-falso-robertta', { id_candidato: 'T2026-11-14-01', destino: 'roteirista' }, {}, 'teste-recusado'],
    ['tok-falso-robertta', { id_candidato: 'S47-01', destino: 'decidir' }, {}, 'id-invalido'],
    ['tok-falso-robertta', { id_candidato: CAND, destino: 'decidir' }, { id_alvo: '2026-11-14-02' }, 'id-invalido'],
    ['tok-falso-robertta', { id_candidato: CAND, destino: 'publicar' }, {}, 'destino-invalido'],
    ['tok-falso-robertta', { id_candidato: CAND, destino: 'decidir', prioridade: 'alta' }, {}, 'pedido-invalido'],
    ['tok-falso-robertta', { id_candidato: CAND, destino: 'decidir', motivo: 3 }, {}, 'pedido-invalido'],
    ['tok-falso-robertta', { destino: 'decidir' }, { id_alvo: '' }, 'id-invalido'],
  ];
  for (const [tok, dados, extra, codigo] of casos) {
    const amb = ambienteCandidato();
    const r = amb.post(pedidoCandidato(tok, dados, extra));
    assert.equal(r.ok, false, JSON.stringify(dados));
    assert.equal(r.codigo, codigo, JSON.stringify(dados));
    assert.equal(amb.aba.linhas.length, 1, 'nada em Execuções');
    assert.equal(amb.abas['Decisões'].linhas.length, 1, 'nada em Decisões');
    assert.equal(amb.webhooksChamados().length, 0);
  }
  const g = ambienteCandidato().post(pedidoCandidato('tok-falso-gabriel', { id_candidato: CAND, destino: 'decidir' }));
  assert.equal(g.mensagem, 'Só a conta da Robertta decide.');
});

test('radar-candidato "decidir": não grava Decisões; Execuções com id_alvo = candidato; payload exato ao Radar', () => {
  const amb = ambienteCandidato();
  const ped = pedidoCandidato('tok-falso-robertta', { id_candidato: CAND, destino: 'decidir' }, { id_lote: 'S47-manual-1' });
  const r = amb.post(ped);
  assert.equal(r.ok, true);
  assert.equal(r.status, 'pedido');
  assert.equal(r.decisao, undefined);
  assert.equal(amb.abas['Decisões'].linhas.length, 1);
  const [e] = amb.execs();
  assert.deepEqual([e.rotina, e.bot, e.id_alvo, e.teste, e.resumo], ['radar-candidato', 'radar', CAND, false, `candidato ${CAND} → Para decidir`]);
  const [w] = amb.webhooksChamados();
  assert.equal(w.url, URL_RADAR);
  assert.deepEqual(json(w.params.headers), { Authorization: `Bearer ${CHAVE_RADAR}` });
  const p = JSON.parse(w.params.payload);
  assert.deepEqual(Object.keys(p), ['rotina', 'id_execucao', 'chave_idem', 'origem', 'quem', 'id_alvo', 'id_lote', 'dados']);
  assert.deepEqual(p, {
    rotina: 'radar-candidato', id_execucao: r.id_execucao, chave_idem: ped.chave_idem, origem: 'manual-app', quem: ROBERTTA,
    id_alvo: CAND, id_lote: 'S47-manual-1', dados: { id_candidato: CAND, destino: 'decidir' }, // motivo vazio não vai
  });
  // com motivo: uma linha, até 300
  const m = ambienteCandidato();
  m.post(pedidoCandidato('tok-falso-robertta', { id_candidato: CAND, destino: 'decidir', motivo: ` forte\n\nesta\tsemana ${'x'.repeat(400)}` }));
  const dm = JSON.parse(m.webhooksChamados()[0].params.payload).dados;
  assert.deepEqual(Object.keys(dm), ['id_candidato', 'destino', 'motivo']);
  assert.ok(dm.motivo.startsWith('forte esta semana x'));
  assert.ok(dm.motivo.length <= 300 && !/\n|\t/.test(dm.motivo));
});

test('radar-candidato "roteirista": UMA linha em Decisões pelo cabeçalho, gravada ANTES do webhook; payload certo', () => {
  const amb = ambienteCandidato();
  const ordem = [];
  const fetchOriginal = amb.ctx.UrlFetchApp.fetch;
  amb.ctx.UrlFetchApp.fetch = (url, params) => {
    if (url.startsWith('https://webhook.')) ordem.push(`webhook (Decisões com ${amb.abas['Decisões'].linhas.length} linhas)`);
    return fetchOriginal(url, params);
  };
  const ped = pedidoCandidato('tok-falso-robertta', { id_candidato: CAND, destino: 'roteirista', motivo: 'tema forte' }, { id_lote: 'S47-manual-2' });
  const r = amb.post(ped);
  assert.equal(r.ok, true);
  assert.equal(r.decisao, 'gravada');
  assert.deepEqual(ordem, ['webhook (Decisões com 2 linhas)']); // a aprovação já estava lá quando o Radar foi chamado
  const linhas = amb.abas['Decisões'].linhas;
  assert.equal(linhas.length, 2);
  const cab = linhas[0];
  const col = (nome) => linhas[1][cab.indexOf(nome)];
  assert.equal(col('Decisão'), 'aprovada');
  assert.equal(col('ID Candidato'), CAND);
  assert.equal(col('ID Pauta'), ''); // a pauta ainda não existe
  assert.equal(col('Origem'), 'manual-app');
  assert.equal(col('Quem'), ROBERTTA);
  assert.equal(col('Data'), '2026-11-18 10:00'); // São Paulo, como o app grava (texto, não data)
  assert.equal(col('Semana'), 'S47');
  assert.equal(col('Pauta'), 'Insônia de domingo'); // o ângulo do candidato
  assert.equal(col('Motivo'), 'tema forte');
  assert.equal(col('id_lote'), 'S47-manual-2');
  assert.equal(col('Observação interna'), ''); // coluna que a ponte não conhece fica vazia
  assert.equal(amb.abas['Decisões'].formulas.length, 0);
  // o app lê a linha como aprovação do candidato
  const [d] = decisoesDoApp(amb);
  assert.deepEqual([d.decisao, d.id_candidato, d.id_pauta, d.origem], ['aprovada', CAND, '', 'manual-app']);
  assert.equal(S.aprovacaoDoCandidato(decisoesDoApp(amb), CAND)._linha, 2);
  const p = JSON.parse(amb.webhooksChamados()[0].params.payload);
  assert.equal(p.rotina, 'radar-candidato');
  assert.equal(p.id_alvo, CAND);
  assert.deepEqual(p.dados, { id_candidato: CAND, destino: 'roteirista', motivo: 'tema forte' });
  assert.equal(amb.execs()[0].resumo, `candidato ${CAND} → Roteirista`);

  // sem a aba Candidatos: a pauta em Decisões é o id
  const semCand = ambienteCandidato({ candidatos: false });
  assert.equal(semCand.post(pedidoCandidato('tok-falso-robertta', { id_candidato: CAND, destino: 'roteirista' })).ok, true);
  assert.equal(decisoesDoApp(semCand)[0].pauta, CAND);
});

test('radar-candidato "roteirista": não duplica Decisões (já aprovado → informa); mesma chave = repetido; trava por candidato', () => {
  const cabDec = ['semana', 'pauta', 'decisao', 'motivo', 'id_pauta', 'rede', 'id_candidato', 'id_lote', 'data', 'quem', 'origem'];
  const ja = ambienteCandidato({ decisoes: [cabDec, ['S47', 'x', 'Aprovada', '', '', '', CAND, '', '2026-11-17 10:00', ROBERTTA, 'manual-app']] });
  const r = ja.post(pedidoCandidato('tok-falso-robertta', { id_candidato: CAND, destino: 'roteirista' }));
  assert.equal(r.ok, true);
  assert.equal(r.decisao, 'ja-existia');
  assert.equal(ja.abas['Decisões'].linhas.length, 2, 'nenhuma linha nova');
  assert.equal(ja.webhooksChamados().length, 1); // o pedido segue para o Radar

  const amb = ambienteCandidato();
  const ped = pedidoCandidato('tok-falso-robertta', { id_candidato: CAND, destino: 'roteirista' });
  assert.equal(amb.post(ped).ok, true);
  const rep = amb.post({ ...ped }); // mesma chave (dois toques)
  assert.equal(rep.repetido, true);
  assert.equal(amb.abas['Decisões'].linhas.length, 2);
  assert.equal(amb.webhooksChamados().length, 1);
  // outra chave para o mesmo candidato: a trava segura (pedido aberto)
  assert.equal(amb.post(pedidoCandidato('tok-falso-robertta', { id_candidato: CAND, destino: 'decidir' })).codigo, 'rodando');
  // outro candidato não fica preso
  assert.equal(amb.post(pedidoCandidato('tok-falso-robertta', { id_candidato: '2026-11-14-02', destino: 'decidir' })).ok, true);
  // depois de um erro, pedir de novo não grava outra aprovação
  amb.aba.linhas[1][CAB.indexOf('status')] = 'erro';
  const denovo = amb.post(pedidoCandidato('tok-falso-robertta', { id_candidato: CAND, destino: 'roteirista' }));
  assert.equal(denovo.decisao, 'ja-existia');
  assert.equal(amb.abas['Decisões'].linhas.length, 2);
});

test('radar-candidato "roteirista": Decisões sem as colunas novas (ou ausente) falha antes de gravar e de repassar', () => {
  const antigas = ambienteCandidato({ decisoes: [['semana', 'pauta', 'decisao', 'motivo'], ['S46', 'velha', 'aprovada', '']] });
  const r = antigas.post(pedidoCandidato('tok-falso-robertta', { id_candidato: CAND, destino: 'roteirista' }));
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'decisoes-sem-colunas');
  assert.match(r.mensagem, /id_pauta, rede, id_candidato, id_lote, data, quem, origem/);
  assert.match(r.mensagem, /Nada foi pedido ao Radar/);
  assert.equal(antigas.aba.linhas.length, 1, 'nada em Execuções');
  assert.equal(antigas.abas['Decisões'].linhas.length, 2);
  assert.equal(antigas.webhooksChamados().length, 0);

  const sem = criarAmbiente();
  assert.equal(sem.post(pedidoCandidato('tok-falso-robertta', { id_candidato: CAND, destino: 'roteirista' })).codigo, 'decisoes-sem-colunas');
  assert.equal(sem.webhooksChamados().length, 0);
  // "decidir" não precisa de Decisões
  assert.equal(criarAmbiente().post(pedidoCandidato('tok-falso-robertta', { id_candidato: CAND, destino: 'decidir' })).ok, true);
});

test('radar-candidato "roteirista": se a escrita em Decisões falha, não chama o webhook e fecha Execuções com erro', () => {
  const amb = ambienteCandidato();
  amb.abas['Decisões'].sheet.getRange = () => ({ setValues() { throw new Error('Service Spreadsheets failed'); }, setValue() { throw new Error('x'); } });
  const r = amb.post(pedidoCandidato('tok-falso-robertta', { id_candidato: CAND, destino: 'roteirista' }));
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'decisoes-falhou');
  assert.match(r.mensagem, /nada foi pedido ao Radar/);
  assert.match(r.id_execucao, /^EX-/);
  assert.equal(amb.webhooksChamados().length, 0);
  const [e] = amb.execs();
  assert.equal(e.status, 'erro');
  assert.equal(e.erro, 'não consegui gravar a aprovação em Decisões');
});

test('limite de radar-candidato: 15 por hora por padrão; a propriedade da rotina vence; LIMITE_POR_HORA = 0 fecha também', () => {
  const lim = criarAmbiente().pure('limitePorHora');
  assert.equal(lim({}, 'radar-candidato'), 15);
  assert.equal(lim({ LIMITE_POR_HORA: '2' }, 'radar-candidato'), 15);
  assert.equal(lim({ LIMITE_POR_HORA_RADAR_CANDIDATO: '3' }, 'radar-candidato'), 3);
  assert.equal(lim({ LIMITE_POR_HORA: '0' }, 'radar-candidato'), 0);
  assert.equal(lim({ LIMITE_POR_HORA: '0' }, 'radar-diario'), 0);
  assert.equal(lim({}, 'radar-diario'), 4);
});

test('guardas: Decisões só para radar-candidato com destino roteirista; T nunca', () => {
  const g = criarAmbiente().pure('conferirGravacao');
  const op = (destino, rotina = 'radar-candidato') => ({ rotina, destino, nomeDecisoes: 'Decisões' });
  assert.equal(g('Decisões', CAND, 'Execuções', op('roteirista')).ok, true);
  assert.equal(g('decisoes', CAND, 'Execuções', op('roteirista')).ok, true);
  assert.equal(g('Decisões', CAND, 'Execuções', op('decidir')).codigo, 'aba-nao-permitida');
  assert.equal(g('Decisões', CAND, 'Execuções', op('roteirista', 'radar-enviar')).codigo, 'aba-nao-permitida');
  assert.equal(g('Desempenho', CAND, 'Execuções', op('roteirista')).codigo, 'aba-nao-permitida');
  assert.equal(g('Decisões', 'T2026-11-14-01', 'Execuções', op('roteirista')).codigo, 'teste-recusado');
  assert.equal(g('Decisões', CAND, 'Execuções').codigo, 'aba-nao-permitida'); // sem opções: como antes
});

/* ----------------------------------------------------------------- paridade com o app */

test('paridade: catálogo, colunas, sinônimos, status e motivos iguais aos de js/controle.js', () => {
  const amb = criarAmbiente();
  const R = amb.pure('ROTINAS');
  assert.deepEqual(Object.keys(R).sort(), Object.keys(C.ROTINAS).sort());
  for (const [k, v] of Object.entries(C.ROTINAS)) {
    assert.deepEqual(json({ bot: R[k].bot, grupo: R[k].grupo, disparavel: R[k].disparavel, precisaId: R[k].precisaId, agenda: R[k].agenda, rotulo: R[k].rotulo, soDecide: R[k].soDecide, travaPorId: R[k].travaPorId }),
      json({ bot: v.bot, grupo: v.grupo, disparavel: v.disparavel, precisaId: v.precisaId, agenda: v.agenda, rotulo: v.rotulo, soDecide: v.soDecide, travaPorId: v.travaPorId }), k);
    assert.equal(amb.pure('grupoDeTrava')(k, '2026-11-14-01'), C.grupoDeTrava(k, '2026-11-14-01'), k);
  }
  assert.deepEqual(json(amb.pure('COLUNAS_EXECUCOES')), C.COLUNAS_EXECUCOES);
  assert.deepEqual(json(amb.pure('STATUS_EXECUCAO')), C.STATUS_EXECUCAO);
  assert.deepEqual(json(amb.pure('MOTIVOS_ROTEIRO')), [...C.MOTIVOS_ROTEIRO]);
  assert.equal(amb.pure('QUANTIDADE_MIN'), C.QUANTIDADE_MIN);
  assert.equal(amb.pure('QUANTIDADE_MAX'), C.QUANTIDADE_MAX);
  assert.equal(amb.pure('MAX_MOTIVO_CANDIDATO'), C.MAX_MOTIVO_CANDIDATO);
  assert.deepEqual(json(amb.pure('DESTINOS_CANDIDATO')), Object.keys(C.DESTINOS_CANDIDATO));
  assert.deepEqual(json(amb.pure('COLUNAS_DECISOES')), [...S.COLUNAS_DECISOES]);
  assert.equal(String(amb.pure('ID_CANDIDATO_RE')), String(ID_CANDIDATO_RE));
  for (const d of ['2026-11-18 10:00', '2026-01-01 00:30', '2026-12-31 23:50', '2027-01-03 12:00', '2026-11-15 23:59']) {
    assert.equal(amb.pure('prefixoSemana')(sp(d)), prefixoSemana(sp(d)), d);
    assert.equal(amb.pure('dataHoraPlanilha')(sp(d)), dataHoraPlanilha(sp(d)), d);
  }
  assert.equal(amb.pure('TRAVA_MS'), C.TRAVA_MS);
  assert.equal(amb.pure('PROTECAO_ANTES_MS'), C.PROTECAO_ANTES_MS);
  assert.equal(amb.pure('PROTECAO_SEM_LINHA_MS'), C.PROTECAO_SEM_LINHA_MS);
  assert.equal(amb.pure('novoIdExecucao')(new Date('2026-11-18T13:12:33Z'), '7f3a'), C.novoIdExecucao(new Date('2026-11-18T13:12:33Z'), '7f3a'));
  for (const id of ['T01', 'T01-01', 'S47-01', 'R001', '', 'x']) assert.equal(amb.pure('campoTeste')(id), C.campoTeste(id), id);
});

test('paridade: lerDataHora igual à do app', () => {
  const f = criarAmbiente().pure('lerDataHora');
  for (const v of ['2026-11-18 06:05', '2026-11-18T06:05:30', '18/11/2026 06:05', '2026-11-18T09:05:00.000Z', '2026-11-18', 46344.25, '46344.25', '', 'ontem', '2026-13-01 10:00', new Date('2026-11-18T09:00:00Z')]) {
    const a = f(v);
    const b = lerDataHoraApp(v);
    assert.equal(a ? a.toISOString() : null, b ? b.toISOString() : null, String(v));
  }
});

test('paridade: trava e janela de proteção decidem igual ao app numa semana inteira, de 10 em 10 min', () => {
  const amb = criarAmbiente();
  const linhas = [CAB,
    linha({ id_execucao: 'EX-1', bot: 'radar', rotina: 'radar-diario', origem: 'agendada', inicio: '2026-11-16 07:03', fim: '2026-11-16 07:40', status: 'ok' }),
    linha({ id_execucao: 'EX-2', bot: 'radar', rotina: 'radar-diario', origem: 'agendada', inicio: '2026-11-17 07:01', status: 'rodando' }),
    linha({ id_execucao: 'EX-3', bot: 'radar', rotina: 'radar-selecao', origem: 'agendada', inicio: '2026-11-15 09:02', status: 'erro' }),
    linha({ id_execucao: 'EX-4', bot: 'diretor', rotina: 'diretor-retrospectiva', origem: 'agendada', inicio: '2026-11-16 08:00', status: 'pedido' }),
    linha({ id_execucao: 'EX-5', bot: 'roteirista', rotina: 'roteirista-decisao', origem: 'manual-app', id_alvo: 'S47-01', inicio: '2026-11-19 10:00', status: 'rodando' }),
    linha({ id_execucao: 'EX-6', bot: 'radar', rotina: 'radar-nova', origem: 'chat', inicio: '2026-11-20 15:00', status: 'pedido' }),
  ];
  const daPonte = amb.pure('lerExecucoes')(linhas).execucoes;
  const doApp = C.lerExecucoes(linhas).execucoes;
  const travaP = amb.pure('avaliarTrava');
  const protP = amb.pure('avaliarProtecao');
  const inicio = sp('2026-11-14 00:00').getTime();
  let comparados = 0;
  for (let t = inicio; t < inicio + 8 * 86400000; t += 10 * 60000) {
    const agora = new Date(t);
    for (const [rotina, id] of [['radar-diario', ''], ['radar-selecao', ''], ['radar-enviar', ''], ['roteirista-decisao', 'S47-01'], ['roteirista-decisao', 'S47-02'], ['diretor-retrospectiva', '']]) {
      const a = travaP(daPonte, rotina, id, agora);
      const b = C.avaliarTrava(doApp, rotina, id, agora);
      assert.equal(`${a.livre}|${a.motivo}|${a.linha?.id_execucao}`, `${b.livre}|${b.motivo}|${b.linha?.id_execucao}`, `trava ${rotina} ${agora.toISOString()}`);
      const p = protP(daPonte, rotina, agora);
      const q = C.avaliarProtecao(doApp, rotina, agora);
      assert.equal(`${p.livre}|${p.rotinaAgendada}|${p.ate?.toISOString()}`, `${q.livre}|${q.rotinaAgendada}|${q.ate?.toISOString()}`, `proteção ${rotina} ${agora.toISOString()}`);
      if (!p.livre) assert.equal(amb.pure('textoProtecao')(p, agora), C.textoProtecao(q, agora));
      comparados++;
    }
  }
  assert.ok(comparados > 6000);
});

/* ----------------------------------------------------------------- contrato com js/integra.js */

// Cópia fiel de dadosLimpos e do corpo que chamarPonte manda (js/integra.js não roda no Node:
// importa o navegador). O teste abaixo confere no código-fonte que o formato continua o mesmo.
function dadosLimpos(dados) {
  const out = {};
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return out;
  for (const [k, v] of Object.entries(dados)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 4000);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}
const texto = (v, max) => String(v ?? '').trim().slice(0, max);
const corpoDoApp = (corpo, token) => JSON.stringify({ ...corpo, access_token: token });
const corpoDisparar = ({ rotina, id_alvo = '', id_lote = '', chave_idem, dados = {} }) => ({
  acao: 'disparar', rotina, id_alvo: texto(id_alvo, 20), id_lote: texto(id_lote, 40), chave_idem: texto(chave_idem, 80), dados: dadosLimpos(dados),
});
const corpoDecidir = ({ id, versao, decisao: d, pedido = '', motivo = '', chave_idem }) => ({
  acao: 'decidir-roteiro', rotina: 'roteirista-decisao', id_alvo: id, chave_idem: texto(chave_idem, 80),
  dados: dadosLimpos({ id, versao: Number(versao), decisao: d, pedido: String(pedido || ''), motivo: String(motivo || '') }),
});

/** O que chamarPonte faz com a resposta (HTTP 200 do ContentService). */
function comoOAppLe(j) {
  if (!j || typeof j !== 'object') return { lanca: 'resposta-invalida' };
  if (j.ok === false) return { lanca: texto(j.codigo, 60) || 'recusado', mensagem: texto(j.mensagem, 500) || 'A ponte recusou o pedido.' };
  return { volta: j };
}

test('contrato: o formato do corpo em js/integra.js continua o que a ponte espera', () => {
  assert.match(INTEGRA, /'Content-Type': 'text\/plain;charset=utf-8'/);
  assert.match(INTEGRA, /body: JSON\.stringify\(\{ \.\.\.corpo, access_token: token \}\)/);
  assert.match(INTEGRA, /acao: 'disparar', rotina, id_alvo: id, id_lote: texto\(id_lote, 40\), chave_idem: texto\(chave_idem, 80\), dados: dadosLimpos\(dados\)/);
  assert.match(INTEGRA, /acao: 'decidir-roteiro',\s+rotina: 'roteirista-decisao',\s+id_alvo: id,\s+chave_idem: texto\(chave_idem, 80\),\s+dados: dadosLimpos\(\{ id, versao: v, decisao, pedido: String\(pedido \|\| ''\), motivo: String\(motivo \|\| ''\) \}\)/);
  assert.match(INTEGRA, /if \(j\.ok === false\) throw new ErroIntegra\(texto\(j\.mensagem, 500\) \|\| 'A ponte recusou o pedido\.', texto\(j\.codigo, 60\) \|\| 'recusado'\)/);
  // e dadosLimpos da cópia é a mesma regra da ponte
  assert.match(INTEGRA, /if \(!\/\^\[a-z\]\[a-z0-9_\]\{0,39\}\$\/\.test\(k\)\) continue;/);
  assert.match(INTEGRA, /out\[k\] = v\.slice\(0, 4000\)/);
});

test('contrato: a ponte aceita os corpos de disparar (com e sem "marcar como travada") e de decidirRoteiro', () => {
  const amb = criarAmbiente({
    linhas: [CAB, linha({ id_execucao: 'EX-velha', bot: 'diretor', rotina: 'diretor-retrospectiva', origem: 'manual-app', inicio: '2026-11-18 06:00', status: 'rodando' })],
    props: { ...PROPS, WEBHOOK_DIRETOR_URL: 'https://webhook.exemplo.test/diretor', WEBHOOK_DIRETOR_KEY: 'chave-falsa-diretor' },
  });
  const a = comoOAppLe(amb.post(corpoDoApp(corpoDisparar({ rotina: 'radar-diario', chave_idem: C.novaChaveIdem(), dados: {} }), 'tok-falso-gabriel')));
  assert.equal(typeof a.volta.id_execucao, 'string');
  assert.equal(a.volta.ok, true);

  const lote = C.idLote({ semana: 47, existentes: [] });
  assert.equal(comoOAppLe(amb.post(corpoDoApp(corpoDisparar({ rotina: 'radar-selecao', id_lote: lote, chave_idem: C.novaChaveIdem() }), 'tok-falso-robertta'))).lanca, 'rodando');

  // "Parece travada" → o app manda marcar_travada + id_execucao_travada (acoes.js 'rodar-confirmar')
  const recusa = comoOAppLe(amb.post(corpoDoApp(corpoDisparar({ rotina: 'diretor-retrospectiva', chave_idem: C.novaChaveIdem() }), 'tok-falso-gabriel')));
  assert.equal(recusa.lanca, 'parece-travada');
  // o id que o app manda é o da linha que avaliarTrava (controle.js) mostrou na janela
  const execApp = C.lerExecucoes(amb.aba.linhas).execucoes;
  const travaApp = C.avaliarTrava(execApp, 'diretor-retrospectiva', '', sp(QUARTA_10));
  const marcar = { marcar_travada: true, id_execucao_travada: String(travaApp.linha?.id_execucao || '') };
  const ok = comoOAppLe(amb.post(corpoDoApp(corpoDisparar({ rotina: 'diretor-retrospectiva', chave_idem: C.novaChaveIdem(), dados: marcar }), 'tok-falso-gabriel')));
  assert.equal(ok.volta.status, 'pedido');
  assert.equal(C.lerExecucoes(amb.aba.linhas).execucoes.find((e) => e.id_execucao === 'EX-velha').status, 'travada');

  // decidirRoteiro com o payload de planejarDecisaoRoteiro (recusar com observação)
  const plano = C.planejarDecisaoRoteiro({ id: 'S47-05', versao: 2, decisao: 'recusar', motivo: 'ética', observacao: 'tema delicado' });
  const dec = comoOAppLe(amb.post(corpoDoApp(corpoDecidir({ ...plano.payload, chave_idem: C.novaChaveIdem() }), 'tok-falso-robertta')));
  assert.equal(dec.volta.ok, true);
  const ult = C.lerExecucoes(amb.aba.linhas).execucoes.at(-1);
  assert.equal(ult.resumo, 'recusar v2 (ética)');
  const mudar = C.planejarDecisaoRoteiro({ id: 'T01-01', versao: 1, decisao: 'mudar', pedido: 'Trocar o fim.\n\nE o gancho.' });
  assert.equal(comoOAppLe(amb.post(corpoDoApp(corpoDecidir({ ...mudar.payload, chave_idem: C.novaChaveIdem() }), 'tok-falso-robertta'))).volta.teste, true);
});

test('contrato: toda recusa tem codigo curto e mensagem em português que o app mostra', () => {
  const amb = criarAmbiente();
  const M = amb.pure('MENSAGENS');
  for (const [codigo, msg] of Object.entries(M)) {
    assert.match(codigo, /^[a-z-]{2,60}$/);
    assert.ok(msg.length > 5 && msg.length <= 500, codigo);
  }
  for (const c of ['token-invalido', 'sem-permissao', 'rotina-desconhecida', 'id-invalido', 'rodando', 'parece-travada', 'protecao', 'limite', 'teste-recusado', 'webhook-nao-configurado', 'webhook-falhou', 'pedido-invalido', 'ocupado', 'planilha-sem-execucoes']) {
    assert.ok(c in M, c);
  }
  // códigos que o app já usa do lado dele valem igual na ponte
  for (const c of ['sem-chave', 'versao-invalida', 'decisao-invalida', 'falta-pedido']) {
    assert.ok(INTEGRA.includes(`'${c}'`), c);
    assert.ok(c in M, c);
  }
  // as respostas reais passam pelo leitor do app
  for (const corpo of [disparo('tok-falso-outra', 'radar-diario'), 'x', disparo('tok-falso-robertta', 'motor-editar')]) {
    const lido = comoOAppLe(amb.post(corpo));
    assert.ok(lido.lanca && lido.mensagem);
    assert.ok(lido.lanca in M);
  }
});

/* ----------------------------------------------------------------- lote 2: repetições */

const enviar = (id, resumo, status, o = {}) => linha({
  id_execucao: `EX-${id}`, chave_idem: `chave-${id}-xxxxxxxx`, bot: 'radar', rotina: 'radar-enviar', origem: 'manual-app', quem: ROBERTTA,
  inicio: '2026-11-18 07:30', fim: status === 'pedido' || status === 'rodando' ? '' : '2026-11-18 07:50', status, resumo, teste: 'não', ...o,
});
const decidiu = (id, resumo, status, o = {}) => linha({
  id_execucao: `EX-${id}`, chave_idem: `chave-${id}-xxxxxxxx`, bot: 'roteirista', rotina: 'roteirista-decisao', origem: 'manual-app', quem: ROBERTTA,
  id_alvo: 'S47-04', inicio: '2026-11-18 09:30', fim: status === 'pedido' || status === 'rodando' ? '' : '2026-11-18 09:40', status, resumo, teste: 'não', ...o,
});
const pedirEnvio = (ids, dados = {}) => disparo('tok-falso-robertta', 'radar-enviar', { id_lote: 'S47-manual-1', dados: { ids, ...dados } });
const linhasNovas = (amb, antes) => amb.aba.linhas.length - antes;

test('ponte: radar-enviar recusa id já enviado (ok) — ja-enviada lista os ids, nada é gravado nem repassado; a travada marcada libera', () => {
  for (const resumo of ['enviar S47-01, S47-02', 'pauta S47-01 (lote S47-manual-1) enviada ao Roteirista; aprovação confirmada em Decisões (x)']) {
    const amb = criarAmbiente({ linhas: [CAB, enviar('a', resumo, 'ok')] });
    const antes = amb.aba.linhas.length;
    const r = amb.post(pedirEnvio('S47-03,S47-01'));
    assert.equal(r.ok, false);
    assert.equal(r.codigo, 'ja-enviada');
    assert.deepEqual(json(r.ids), ['S47-01']);
    assert.match(r.mensagem, /Já foi enviada ao Roteirista \(ou está indo\): S47-01\./);
    assert.equal(linhasNovas(amb, antes), 0, 'nada gravado');
    assert.equal(amb.webhooksChamados().length, 0, 'nada repassado');
    assert.equal(comoOAppLe(r).lanca, 'ja-enviada');
  }
  const dois = criarAmbiente({ linhas: [CAB, enviar('b', 'enviar S47-01, S47-02', 'ok')] }).post(pedirEnvio('S47-02,S47-01'));
  assert.match(dois.mensagem, /Já foram enviadas ao Roteirista \(ou estão indo\): S47-01, S47-02\./);
  // outra pauta passa
  const outra = criarAmbiente({ linhas: [CAB, enviar('c', 'enviar S47-01', 'ok')] });
  const antes = outra.aba.linhas.length;
  assert.notEqual(outra.post(pedirEnvio('S47-05')).codigo, 'ja-enviada');
  assert.equal(linhasNovas(outra, antes), 1);
  // aberta há mais de 2 h com o id: sem marcar, parece-travada; marcando como travada, libera
  const ambV = criarAmbiente({ linhas: [CAB, enviar('d', 'enviar S47-01', 'rodando', { inicio: '2026-11-18 07:00' })] });
  assert.equal(ambV.post(pedirEnvio('S47-01')).codigo, 'parece-travada');
  const marcada = ambV.post(pedirEnvio('S47-01', { marcar_travada: true, id_execucao_travada: 'EX-d' }));
  assert.notEqual(marcada.codigo, 'ja-enviada');
  assert.equal(C.lerExecucoes(ambV.aba.linhas).execucoes.find((e) => e.id_execucao === 'EX-d').status, 'travada');
  // a pedido/rodando recente segura pela trava do grupo (rodando) antes de chegar aqui
  assert.equal(criarAmbiente({ linhas: [CAB, enviar('r', 'enviar S47-01', 'pedido', { inicio: '2026-11-18 09:50' })] }).post(pedirEnvio('S47-01')).codigo, 'rodando');
  // e a regra pura também conta a aberta (pedido/rodando/aguardando)
  for (const status of ['pedido', 'rodando', 'aguardando']) {
    const execs = criarAmbiente().pure('lerExecucoes')([CAB, enviar('z', 'enviar S47-01', status)]).execucoes;
    assert.equal(criarAmbiente().pure('envioRepetido')(execs, 'S47-01').codigo, 'ja-enviada', status);
  }
});

test('ponte: radar-enviar com erro / travada / recusado-pela-trava libera; parcial libera só os ids que não aparecem como enviados; teste não conta', () => {
  for (const status of ['erro', 'travada', 'recusado-pela-trava']) {
    const amb = criarAmbiente({ linhas: [CAB, enviar('e', 'enviar S47-01', status)] });
    const antes = amb.aba.linhas.length;
    assert.notEqual(amb.post(pedirEnvio('S47-01')).codigo, 'ja-enviada', status);
    assert.equal(linhasNovas(amb, antes), 1, status);
  }
  const parcial = () => criarAmbiente({ linhas: [CAB, enviar('p', 'S47-01 enviada ao Roteirista; S47-02 falhou', 'parcial')] });
  const r1 = parcial().post(pedirEnvio('S47-01,S47-02'));
  assert.equal(r1.codigo, 'ja-enviada');
  assert.deepEqual(json(r1.ids), ['S47-01']);
  assert.notEqual(parcial().post(pedirEnvio('S47-02')).codigo, 'ja-enviada');
  // parcial com o resumo da ponte (ninguém confirmou o envio): libera tudo
  assert.notEqual(criarAmbiente({ linhas: [CAB, enviar('q', 'enviar S47-01, S47-02', 'parcial')] }).post(pedirEnvio('S47-01')).codigo, 'ja-enviada');
  // linha de teste não segura pauta de verdade (como em js/envios.js)
  assert.notEqual(criarAmbiente({ linhas: [CAB, enviar('t', 'enviar S47-01', 'ok', { teste: 'sim' })] }).post(pedirEnvio('S47-01')).codigo, 'ja-enviada');
});

test('ponte: roteirista-decisao recusa "mudar vN" repetido (ok recente) e qualquer decisão depois de aprovar/recusar concluído; erro e 2 h liberam', () => {
  const mudar = (versao) => decisao('tok-falso-robertta', 'S47-04', { decisao: 'mudar', versao, pedido: 'trocar o fim' });
  const amb = criarAmbiente({ linhas: [CAB, decidiu('m', 'mudar v2', 'ok')] });
  const antes = amb.aba.linhas.length;
  const r = amb.post(mudar(2));
  assert.equal(r.codigo, 'ja-pedida');
  assert.match(r.mensagem, /A mudança na v2 do S47-04 já foi pedida\. Espere a v3 chegar \(ou 2 h\)/);
  assert.equal(linhasNovas(amb, antes), 0);
  assert.equal(amb.webhooksChamados().length, 0);
  assert.notEqual(amb.post(mudar(3)).codigo, 'ja-pedida');
  // resumo sobrescrito pelo Roteirista ("S47-04 v3 gravado") = mudar v2
  assert.equal(criarAmbiente({ linhas: [CAB, decidiu('g', 'S47-04 v3 gravado: abertura nova', 'ok')] }).post(mudar(2)).codigo, 'ja-pedida');
  // 2 h depois do fim sem a v3: pode pedir de novo (o app desbloqueia igual)
  assert.notEqual(criarAmbiente({ agora: '2026-11-18 11:45', linhas: [CAB, decidiu('t', 'mudar v2', 'ok')] }).post(mudar(2)).codigo, 'ja-pedida');
  for (const status of ['erro', 'parcial', 'travada']) {
    assert.notEqual(criarAmbiente({ linhas: [CAB, decidiu('x', 'mudar v2', status)] }).post(mudar(2)).codigo, 'ja-pedida', status);
  }
  for (const resumo of ['aprovar v2', 'S47-04 v2 aprovada: gravado S47-04 - Título.md', 'recusar v2 (ética)']) {
    const a = criarAmbiente({ linhas: [CAB, decidiu('d', resumo, 'ok')] });
    for (const d of [mudar(2), decisao('tok-falso-robertta', 'S47-04', { versao: 3 }), decisao('tok-falso-robertta', 'S47-04', { decisao: 'recusar', motivo: 'tom' })]) {
      const res = a.post(d);
      assert.equal(res.codigo, 'ja-decidido', resumo);
      assert.match(res.mensagem, /O roteiro S47-04 já foi (aprovado|recusado) \(v2\)/);
    }
    assert.notEqual(a.post(decisao('tok-falso-robertta', 'S47-05', {})).codigo, 'ja-decidido');
  }
  assert.notEqual(criarAmbiente({ linhas: [CAB, decidiu('f', 'aprovar v2', 'erro')] }).post(decisao('tok-falso-robertta', 'S47-04', {})).codigo, 'ja-decidido');
});

test('ponte: cliques repetidos com a chave estável do app = um pedido só; outra janela (chave nova) cai na trava por id', () => {
  const amb = criarAmbiente();
  const plano = C.planejarDecisaoRoteiro({ id: 'S47-04', versao: 2, decisao: 'mudar', pedido: 'trocar o fim' });
  const chaveApp = D.chaveIdemDecisao(plano.payload, C.lerExecucoes(amb.aba.linhas).execucoes);
  const corpo = corpoDoApp(corpoDecidir({ ...plano.payload, chave_idem: chaveApp }), 'tok-falso-robertta');
  amb.post(corpo);
  assert.equal(amb.post(corpo).repetido, true);
  assert.equal(C.lerExecucoes(amb.aba.linhas).execucoes.length, 1);
  const outra = corpoDoApp(corpoDecidir({ ...plano.payload, chave_idem: 'outra-chave-123456' }), 'tok-falso-robertta');
  assert.equal(amb.post(outra).codigo, 'rodando');
  const execs = C.lerExecucoes(amb.aba.linhas).execucoes;
  assert.equal(execs.length, 1);
  assert.equal(execs[0].resumo, 'mudar v2');
  assert.equal(execs[0].chave_idem, chaveApp);
});

test('paridade lote 2: leitura do resumo, ids enviados e recusas de decisão iguais no app e na ponte', () => {
  const amb = criarAmbiente();
  const resumos = ['mudar v2', 'aprovar v3', 'recusar v1 (ética)', 'S46-01 v2 gravado: x', 'S46-01 v2 aprovada: gravado y', 'rodar de novo; EX-1 marcada como travada; mudar v4', '', 'qualquer coisa', 'v1 gravado'];
  for (const s of resumos) assert.deepEqual(json(amb.pure('lerDecisaoDoResumo')(s)), json(D.lerDecisaoDoResumo(s)), s);
  const textos = ['pauta S46-01 (lote S46-manual-1) enviada ao Roteirista; ok', 'S46-01, S46-02 enviadas. S46-03 falhou', 'enviar S46-01', 'S46-04 não enviada', 's46-05 enviada\nS46-06 erro'];
  for (const t of textos) {
    assert.deepEqual(json(amb.pure('idsEnviadosNoTexto')(t)), E.idsEnviadosNoTexto(t), t);
    assert.deepEqual(json(amb.pure('idsNoTexto')(t)), E.idsNoTexto(t), t);
  }
  const cenarios = [
    [decidiu('1', 'mudar v2', 'ok')], [decidiu('2', 'mudar v2', 'rodando')], [decidiu('3', 'mudar v2', 'erro')],
    [decidiu('4', 'aprovar v2', 'ok')], [decidiu('5', 'recusar v1 (tom)', 'ok')], [decidiu('6', 'S47-04 v3 gravado: z', 'ok')],
    [decidiu('7', 'mudar v2', 'ok', { inicio: '2026-11-18 06:00', fim: '2026-11-18 06:30' })], [decidiu('8', 'mudar v2', 'ok', { id_alvo: 'S47-09' })], [],
  ];
  const agora = sp('2026-11-18 10:00');
  for (const ls of cenarios) {
    const app = C.lerExecucoes([CAB, ...ls]).execucoes;
    const ponte = amb.pure('lerExecucoes')([CAB, ...ls]).execucoes;
    for (const [qual, versao] of [['mudar', 2], ['mudar', 3], ['aprovar', 2], ['recusar', 2]]) {
      const a = D.bloqueioDaDecisao(app, { id: 'S47-04', decisao: qual, versao, agora });
      const p = amb.pure('decisaoRepetida')(ponte, 'S47-04', { decisao: qual, versao }, agora);
      assert.equal(p ? p.codigo : 'livre', a.livre ? 'livre' : a.codigo, `${ls[0]?.[12]} ${ls[0]?.[11]} ${qual} v${versao}`);
      if (p) assert.equal(p.mensagem, a.mensagem);
    }
  }
  const M = amb.pure('MENSAGENS');
  for (const c of ['ja-enviada', 'ja-pedida', 'ja-decidido']) assert.ok(c in M, c);
});
