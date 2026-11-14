// Testes do "Sair" (js/auth.js): limpeza do armazenamento (fica o tema e os envios retomáveis),
// Google desligado sem lançar (GIS ausente ou com erro), renovações canceladas sem o aviso de
// "sessão expirou" e a escolha de conta no primeiro login depois de sair.
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Storage falso, com a mesma interface do sessionStorage/localStorage. */
class StorageFalso {
  constructor(inicial = {}) { this.m = new Map(Object.entries(inicial)); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  chaves() { return [...this.m.keys()].sort(); }
}

// O auth.js usa window, sessionStorage e localStorage só quando chamado: o ambiente falso é montado
// antes de cada teste.
const eventos = [];
globalThis.window = { dispatchEvent: (ev) => { eventos.push(ev.type); return true; } };
globalThis.sessionStorage = new StorageFalso();
globalThis.localStorage = new StorageFalso();

const auth = await import('../js/auth.js');
const { limparArmazenamento, chaveParaApagar, opcoesDeEntrada, desligarGoogle, PREFIXO_UPLOAD, CHAVE_TEMA } = auth;
const { chaveSessao } = await import('../js/upload.js');

const EMAIL = 'robertta.c.alonso@gmail.com';
const sessaoValida = (minutos = 60) => JSON.stringify({ access_token: 'tok-1', expires_at: Date.now() + minutos * 60000, email: EMAIL });

/** GIS falso: guarda as opções de cada requestAccessToken e deixa o teste decidir a resposta. */
function gisFalso() {
  const g = {
    pedidos: [], revogados: [], autoSelectDesligado: 0, cliente: null,
    accounts: {
      oauth2: {
        initTokenClient(cfg) { g.cliente = cfg; return { requestAccessToken: (op) => { g.pedidos.push(op); g.aoPedir?.(op); } }; },
        revoke(token, cb) { g.revogados.push(token); cb?.(); },
        hasGrantedAllScopes: () => true,
      },
      id: { disableAutoSelect() { g.autoSelectDesligado++; } },
    },
  };
  return g;
}
// O auth.js cria o tokenClient uma vez (com o primeiro GIS que encontra): os testes de pedido de token
// usam este mesmo GIS falso.
const G = gisFalso();

/* ---------------------------------------------------------- armazenamento (puro) */

test('limparArmazenamento: apaga sessão, conta e dados do app; mantém o tema e os envios retomáveis', () => {
  const upload = chaveSessao('S46-01', { name: 'S46-01.mov', size: 123, lastModified: 456 });
  assert.ok(upload.startsWith(PREFIXO_UPLOAD));
  const local = new StorageFalso({
    'motor.email': EMAIL,
    'motor-tema': 'dia',
    [upload]: '{"uri":"https://x","data":1}',
    'motor.cache.listagens': '[]',
    'motor-demo': '1',
    'motorista': 'não é do app',
    'outra.coisa': 'x',
  });
  const sessao = new StorageFalso({ 'motor.sessao': sessaoValida(), 'motor.filtros': '{}' });

  assert.deepEqual(limparArmazenamento(local).sort(), ['motor-demo', 'motor.cache.listagens', 'motor.email']);
  assert.deepEqual(local.chaves(), [CHAVE_TEMA, 'motorista', 'outra.coisa', upload].sort());
  assert.equal(local.getItem('motor-tema'), 'dia');

  assert.deepEqual(limparArmazenamento(sessao).sort(), ['motor.filtros', 'motor.sessao']);
  assert.equal(sessao.length, 0);
});

test('limparArmazenamento: sem Storage, Storage que lança ou removeItem que falha não quebram', () => {
  assert.deepEqual(limparArmazenamento(null), []);
  assert.deepEqual(limparArmazenamento({ get length() { throw new Error('SecurityError'); } }), []);
  const teimoso = new StorageFalso({ 'motor.email': 'a', 'motor.sessao': 'b' });
  const remover = teimoso.removeItem.bind(teimoso);
  teimoso.removeItem = (k) => { if (k === 'motor.email') throw new Error('bloqueado'); remover(k); };
  assert.doesNotThrow(() => limparArmazenamento(teimoso));
  assert.equal(teimoso.getItem('motor.sessao'), null); // a falha de uma chave não impede as outras
});

test('chaveParaApagar: só chaves do app (motor. / motor- / motor_), nunca o tema nem o upload', () => {
  for (const k of ['motor.sessao', 'motor.email', 'motor-demo', 'motor_x']) assert.ok(chaveParaApagar(k), k);
  for (const k of ['motor-tema', 'motor.upload.S46-01.a.mov.1.2', 'motorista', 'tema', '', null]) assert.ok(!chaveParaApagar(k), String(k));
});

/* ------------------------------------------------------------- prompt (puro) */

test('opcoesDeEntrada: com e-mail lembrado usa login_hint; depois de sair (ou sem e-mail) abre a escolha de conta', () => {
  assert.deepEqual(opcoesDeEntrada(EMAIL), { prompt: '', login_hint: EMAIL });
  assert.deepEqual(opcoesDeEntrada(EMAIL, true), { prompt: 'select_account' });
  assert.deepEqual(opcoesDeEntrada('', false), { prompt: 'select_account' });
  assert.ok(!('login_hint' in opcoesDeEntrada(EMAIL, true)));
});

/* --------------------------------------------------------- Google (puro) */

test('desligarGoogle: revoga o token e desliga a seleção automática; GIS ausente ou que lança não quebra', () => {
  const g = gisFalso();
  desligarGoogle(g, 'tok-9');
  assert.deepEqual(g.revogados, ['tok-9']);
  assert.equal(g.autoSelectDesligado, 1);

  assert.doesNotThrow(() => desligarGoogle(undefined, 'tok'));
  assert.doesNotThrow(() => desligarGoogle({}, 'tok'));
  assert.doesNotThrow(() => desligarGoogle({ accounts: { oauth2: {} } }, 'tok')); // só o id carregou, ou nada
  assert.doesNotThrow(() => desligarGoogle({ get accounts() { throw new Error('GIS quebrado'); } }, 'tok'));

  // revoke lançando (sem rede) não impede desligar a seleção automática
  let desligou = false;
  desligarGoogle({ accounts: { oauth2: { revoke() { throw new Error('rede'); } }, id: { disableAutoSelect() { desligou = true; } } } }, 'tok');
  assert.ok(desligou);
  // disableAutoSelect lançando também não quebra
  assert.doesNotThrow(() => desligarGoogle({ accounts: { id: { disableAutoSelect() { throw new Error('x'); } } } }, 'tok'));
});

/* ------------------------------------------------------------- sair() */

test('sair: sem GIS (window.google ausente) não lança e limpa o armazenamento', () => {
  delete window.google;
  sessionStorage.setItem('motor.sessao', sessaoValida());
  localStorage.setItem('motor.email', EMAIL);
  localStorage.setItem('motor-tema', 'dia');
  assert.doesNotThrow(() => auth.sair());
  assert.equal(sessionStorage.getItem('motor.sessao'), null);
  assert.equal(localStorage.getItem('motor.email'), null);
  assert.equal(localStorage.getItem('motor-tema'), 'dia');
  assert.equal(auth.estaLogado(), false);
});

test('sair: revoke lançando, window.google que lança ao ser lido e armazenamento bloqueado não impedem sair', () => {
  sessionStorage.setItem('motor.sessao', sessaoValida());
  window.google = { accounts: { oauth2: { revoke() { throw new Error('sem rede'); } } } };
  assert.doesNotThrow(() => auth.sair());
  assert.equal(sessionStorage.getItem('motor.sessao'), null);

  Object.defineProperty(window, 'google', { configurable: true, get() { throw new Error('bloqueado'); } });
  assert.doesNotThrow(() => auth.sair());
  delete window.google;

  const ss = globalThis.sessionStorage;
  const ls = globalThis.localStorage;
  globalThis.sessionStorage = { getItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); }, get length() { throw new Error('x'); } };
  delete globalThis.localStorage;
  try {
    assert.doesNotThrow(() => auth.sair());
  } finally {
    globalThis.sessionStorage = ss;
    globalThis.localStorage = ls;
  }
});

test('sair: revoga o token atual e desliga a seleção automática, sem esperar a resposta', () => {
  const g = gisFalso();
  g.accounts.oauth2.revoke = (token) => { g.revogados.push(token); }; // nunca chama o callback
  window.google = g;
  sessionStorage.setItem('motor.sessao', sessaoValida());
  auth.sair();
  assert.deepEqual(g.revogados, ['tok-1']);
  assert.equal(g.autoSelectDesligado, 1);
  assert.equal(auth.estaLogado(), false);
});

test('sair: renovação pendente é rejeitada com "saiu", sem o aviso de sessão expirada; depois nada renova', async () => {
  const g = G;
  g.pedidos.length = 0;
  window.google = g;
  sessionStorage.setItem('motor.sessao', sessaoValida(1));
  localStorage.setItem('motor.email', EMAIL);
  eventos.length = 0;

  const pendente = auth.renovar();
  await new Promise((r) => setImmediate(r)); // o pedido silencioso chega ao GIS e fica sem resposta
  assert.equal(g.pedidos.length, 1);
  auth.sair();
  await assert.rejects(pendente, (e) => e.codigo === 'saiu');
  await new Promise((r) => setImmediate(r));
  assert.ok(!eventos.includes('motor:sessao-expirada'), `eventos: ${eventos}`);

  // Uma resposta atrasada do Google não recria a sessão
  g.cliente.callback({ access_token: 'tok-atrasado', expires_in: 3600 });
  assert.equal(auth.estaLogado(), false);

  // Depois de sair, renovar (ex.: um 401 atrasado do Drive) rejeita na hora, sem pedir token
  await assert.rejects(auth.renovar(), (e) => e.codigo === 'saiu');
  await assert.rejects(auth.renovarInterativo(), (e) => e.codigo === 'saiu');
  assert.equal(g.pedidos.length, 1);
  assert.ok(!eventos.includes('motor:sessao-expirada'));
});

test('sair: o timer de renovação agendado é cancelado', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const g = G;
  g.pedidos.length = 0;
  window.google = g;
  // Controle: sem sair, o timer dispara e pede um token silencioso.
  sessionStorage.setItem('motor.sessao', sessaoValida(10));
  assert.ok(auth.retomarSessao()); // agenda a renovação para 2 min antes de expirar
  t.mock.timers.tick(9 * 60 * 1000);
  await new Promise((r) => setImmediate(r));
  assert.equal(g.pedidos.length, 1);
  auth.sair(); // encerra a renovação desse controle

  // Agora com sair: a sessão volta ao armazenamento só para provar que é o cancelamento do timer
  // (e não a falta de sessão) que impede a renovação.
  g.pedidos.length = 0;
  sessionStorage.setItem('motor.sessao', sessaoValida(10));
  auth.retomarSessao();
  auth.sair();
  sessionStorage.setItem('motor.sessao', sessaoValida(10));
  t.mock.timers.tick(60 * 60 * 1000);
  await new Promise((r) => setImmediate(r));
  assert.equal(g.pedidos.length, 0);
  sessionStorage.removeItem('motor.sessao');
});

test('entrar: o primeiro login depois de sair abre a escolha de conta (select_account, sem login_hint)', async () => {
  const g = G;
  g.aoPedir = () => g.cliente.callback({ error: 'popup_closed' }); // ela fecha a janela do Google
  window.google = g;

  localStorage.setItem('motor.email', EMAIL);
  sessionStorage.setItem('motor.sessao', sessaoValida());
  auth.sair(); // zera o estado dos testes anteriores e apaga motor.email
  assert.equal(localStorage.getItem('motor.email'), null);
  await assert.rejects(auth.entrar(), (e) => e.codigo === 'popup_closed');
  assert.deepEqual(g.pedidos.at(-1), { prompt: 'select_account' });

  // Mesmo que outra aba grave o e-mail de novo, o primeiro login após sair continua com a escolha de conta
  localStorage.setItem('motor.email', EMAIL);
  await assert.rejects(auth.entrar(), (e) => e.codigo === 'popup_closed');
  assert.equal(g.pedidos.at(-1).prompt, 'select_account');
  assert.ok(!('login_hint' in g.pedidos.at(-1)));
  g.aoPedir = null;
});

/* ------------------------------------------------- estado das telas (js/estado.js) */

test('reiniciarEstado: volta o estado da tela ao começo e apaga rascunhos e a lista de ajustes (mesmos objetos)', async () => {
  const { estado, rascunho, reiniciarEstado } = await import('../js/estado.js');
  estado.logada = true;
  estado.rota = { nome: 'videos', id: 'S46-01' };
  estado.pendentes['S46-01 v2'] = [{ pedido: 'cortar o começo' }];
  estado.versaoVista['S46-01'] = 1;
  estado.extra = 'algo de uma tela';
  rascunho['aj-pedido'] = 'texto digitado';
  const [e, r] = [estado, rascunho];
  reiniciarEstado();
  assert.equal(estado, e);
  assert.equal(rascunho, r);
  assert.equal(estado.logada, false);
  assert.deepEqual(estado.rota, { nome: 'inicio', id: null });
  assert.deepEqual(estado.pendentes, {});
  assert.deepEqual(estado.versaoVista, {});
  assert.ok(!('extra' in estado));
  assert.deepEqual(rascunho, {});
});
