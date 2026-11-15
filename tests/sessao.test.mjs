// Testes da sessão que fica entre aberturas do app (js/auth.js): a sessão em localStorage sobrevive
// a fechar e abrir (módulo novo, sessionStorage vazio), o estado da abertura ('entrar' | 'continuar'
// | 'normal'), o botão "Continuar como …" (rótulo seguro, login_hint, falha sem perder a sessão),
// o "Sair" apagando a sessão do localStorage na hora e a migração da sessão antiga do sessionStorage.
// Só tokens falsos; o GIS e o fetch são falsos: nada sai para a rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALLOWED, nomeDe } from '../js/config.js';
import { esc } from '../js/util.js';

/** Storage falso, com a mesma interface do sessionStorage/localStorage. */
class StorageFalso {
  constructor(inicial = {}) { this.m = new Map(Object.entries(inicial)); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

const EMAIL = ALLOWED[0]; // uma conta permitida (config.js), sem repetir o endereço aqui
const OUTRA = 'pessoa@exemplo.com'; // conta fora de ALLOWED
const MIN = 60 * 1000;
const sessao = (minutos, token = 'token-falso', email = EMAIL, agora = Date.now()) =>
  JSON.stringify({ access_token: token, expires_at: agora + minutos * MIN, email });

/**
 * Monta o ambiente falso do navegador para um teste (e devolve tudo no fim dele): localStorage e
 * sessionStorage falsos, window com um GIS falso e um fetch falso que responde ao userinfo com
 * `ctx.email` e só registra o resto. Os timers ficam falsos (a renovação agendada não segura o processo).
 * Os testes de tests/index.js rodam no mesmo processo: nada fica trocado depois do teste.
 */
function ambiente(t, { local = new StorageFalso(), sess = new StorageFalso() } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const antes = {};
  for (const k of ['window', 'localStorage', 'sessionStorage', 'fetch']) antes[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  t.after(() => {
    for (const [k, d] of Object.entries(antes)) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  });
  const ctx = { email: EMAIL, chamadas: [], pedidos: [], revogados: [], aoPedir: null, cliente: null };
  const gis = {
    accounts: {
      oauth2: {
        initTokenClient(cfg) { ctx.cliente = cfg; return { requestAccessToken: (op) => { ctx.pedidos.push(op); ctx.aoPedir?.(op); } }; },
        revoke(token, cb) { ctx.revogados.push(token); cb?.(); },
        hasGrantedAllScopes: () => true,
      },
      id: { disableAutoSelect() {} },
    },
  };
  const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true, enumerable: true });
  def('window', { google: gis, dispatchEvent: () => true });
  def('localStorage', local);
  def('sessionStorage', sess);
  def('fetch', async (url) => {
    ctx.chamadas.push(String(url));
    if (String(url).endsWith('/oauth2/v3/userinfo')) return { ok: true, json: async () => ({ email: ctx.email }) };
    return { ok: true };
  });
  ctx.responder = (token = 'token-falso') => { ctx.aoPedir = () => ctx.cliente.callback({ access_token: token, expires_in: 3600 }); };
  ctx.fechar = () => { ctx.aoPedir = () => ctx.cliente.callback({ error: 'popup_closed' }); };
  return ctx;
}

/** Um auth.js novo, como numa página recarregada (estado em memória zerado). */
let instancias = 0;
const abrirApp = () => import(`../js/auth.js?abertura=${++instancias}`);

/* ------------------------------------------------- a) sobrevive a fechar e abrir */

test('sessão em localStorage: sobrevive a fechar e abrir o app e volta por lerSessao/getToken', async (t) => {
  const ctx = ambiente(t);
  const antes = await abrirApp();
  ctx.responder('token-falso');
  await antes.entrar();
  assert.ok(localStorage.getItem('motor.sessao'), 'a sessão vai para o localStorage');
  assert.equal(sessionStorage.getItem('motor.sessao'), null);

  // Fecha o app (iPhone: o sessionStorage some) e abre de novo: outro módulo, mesmo localStorage.
  globalThis.sessionStorage = new StorageFalso();
  const depois = await abrirApp();
  assert.equal(depois.getToken(), 'token-falso');
  assert.equal(depois.lerSessao().email, EMAIL);
  assert.equal(depois.estaLogado(), true);
  assert.deepEqual(depois.estadoDeAbertura(), { estado: 'entrar', email: EMAIL });
  assert.equal(depois.retomarSessao()?.access_token, 'token-falso'); // entra direto, sem login
  assert.equal(ctx.pedidos.length, 1); // nenhum pedido novo ao Google na abertura
  // Só o userinfo falso foi "chamado" (nada de rede de verdade)
  assert.ok(ctx.chamadas.every((u) => u.endsWith('/oauth2/v3/userinfo')), ctx.chamadas.join(', '));
});

test('retomarSessao: com o token válido reagenda a renovação (2 min antes de expirar)', async (t) => {
  const ctx = ambiente(t, { local: new StorageFalso({ 'motor.sessao': sessao(10) }) });
  const auth = await abrirApp();
  assert.ok(auth.retomarSessao());
  t.mock.timers.tick(7 * MIN);
  await new Promise((r) => setImmediate(r));
  assert.equal(ctx.pedidos.length, 0);
  t.mock.timers.tick(1.5 * MIN); // 8,5 min: passou da hora de renovar
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ctx.pedidos, [{ prompt: '', login_hint: EMAIL }]);
  auth.encerrarSessao(); // encerra a renovação pendente
});

/* --------------------------------------------- b) estado da abertura (puro) */

test('estadoDeAbertura: válido → entrar; vencido ou dentro da margem → continuar (com o e-mail); sem sessão → normal', async () => {
  const { estadoDeAbertura } = await abrirApp();
  const agora = 1_700_000_000_000;
  const com = (txt) => estadoDeAbertura({ storage: new StorageFalso(txt === undefined ? {} : { 'motor.sessao': txt }), sessao: null, agora });
  assert.deepEqual(com(sessao(60, 'token-falso', EMAIL, agora)), { estado: 'entrar', email: EMAIL });
  assert.deepEqual(com(sessao(3, 'token-falso', EMAIL, agora)), { estado: 'entrar', email: EMAIL });
  assert.deepEqual(com(sessao(1, 'token-falso', EMAIL, agora)), { estado: 'continuar', email: EMAIL }); // vence em 1 min
  assert.deepEqual(com(sessao(2, 'token-falso', EMAIL, agora)), { estado: 'continuar', email: EMAIL }); // na margem exata
  assert.deepEqual(com(sessao(-30, 'token-falso', EMAIL, agora)), { estado: 'continuar', email: EMAIL });
  assert.deepEqual(com(JSON.stringify({ access_token: 'token-falso', email: EMAIL })), { estado: 'continuar', email: EMAIL }); // sem validade
  assert.deepEqual(com(undefined), { estado: 'normal', email: '' });
  assert.deepEqual(com('não é json'), { estado: 'normal', email: '' });
  assert.deepEqual(com(JSON.stringify({ access_token: 'token-falso' })), { estado: 'normal', email: '' }); // sem e-mail
  assert.deepEqual(com(JSON.stringify({ email: EMAIL })), { estado: 'normal', email: '' }); // sem token
  // Armazenamento bloqueado (modo privado, SecurityError) não lança
  const lanca = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.deepEqual(estadoDeAbertura({ storage: lanca, sessao: lanca, agora }), { estado: 'normal', email: '' });
  assert.deepEqual(estadoDeAbertura({ storage: null, sessao: null, agora }), { estado: 'normal', email: '' });
});

test('sessão vencida: não entra no app (retomar e getToken dão null), mas o e-mail fica para o "Continuar"', async (t) => {
  const ctx = ambiente(t, { local: new StorageFalso({ 'motor.sessao': sessao(-5) }) });
  const auth = await abrirApp();
  assert.equal(auth.getToken(), null);
  assert.equal(auth.retomarSessao(), null);
  assert.deepEqual(auth.estadoDeAbertura(), { estado: 'continuar', email: EMAIL });
  t.mock.timers.tick(24 * 60 * MIN);
  await new Promise((r) => setImmediate(r));
  assert.equal(ctx.pedidos.length, 0); // nada foi agendado nem pedido sozinho
  assert.ok(localStorage.getItem('motor.sessao'), 'a sessão vencida continua guardada');
});

test('rotuloContinuar: primeiro nome (NOMES) ou o que vem antes do @; texto puro, seguro em textContent e esc()', async () => {
  const { rotuloContinuar, nomeParaContinuar } = await abrirApp();
  assert.equal(rotuloContinuar(EMAIL), `Continuar como ${nomeDe(EMAIL) || EMAIL.split('@')[0]}`);
  assert.equal(rotuloContinuar('ana.souza@exemplo.com'), 'Continuar como ana.souza');
  assert.equal(rotuloContinuar('  Ana.Souza@Exemplo.com '), 'Continuar como Ana.Souza');
  assert.equal(rotuloContinuar(''), 'Continuar');
  assert.equal(rotuloContinuar(null), 'Continuar');
  assert.equal(rotuloContinuar('@exemplo.com'), 'Continuar');
  // HTML no e-mail continua texto: nada vira tag, nem com esc() nem por textContent
  const mau = '<img src=x onerror="alert(1)">@exemplo.com';
  const rotulo = rotuloContinuar(mau);
  assert.ok(rotulo.startsWith('Continuar como <img'), rotulo); // texto cru, para textContent
  assert.ok(!/[<>"]/.test(esc(rotulo)), esc(rotulo));
  // Caracteres de controle somem; nome muito longo é cortado com reticências
  assert.equal(nomeParaContinuar('ana\u0000\u001f@exemplo.com'), 'ana');
  const longo = nomeParaContinuar(`${'a'.repeat(80)}@exemplo.com`);
  assert.equal(longo.length, 32);
  assert.ok(longo.endsWith('…'));
  // Na tela o rótulo entra por textContent (nunca innerHTML)
  const acoes = readFileSync(new URL('../js/acoes.js', import.meta.url), 'utf8');
  assert.match(acoes, /\$\('#botao-continuar-texto'\)\.textContent = Integra\.rotuloContinuar\(/);
  assert.ok(!/botao-continuar[^\n]*innerHTML/.test(acoes));
});

test('index.html: "Continuar como …" e "Usar outra conta" são <button> de verdade, escondidos até a sessão vencida', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<button type="button" class="google" data-acao="continuar" id="botao-continuar" hidden>/);
  assert.match(html, /<button type="button" class="[^"]*outra-conta[^"]*" data-acao="outra-conta" id="botao-outra-conta" hidden>Usar outra conta<\/button>/);
  assert.match(html, /<button type="button" class="google" data-acao="entrar" id="botao-entrar">/);
  // O script do <head> só esconde a entrada com a sessão do localStorage ainda válida
  assert.match(html, /localStorage\.getItem\('motor\.sessao'\)/);
  assert.match(html, /Number\(s\.expires_at\) > Date\.now\(\) \+ 120000/);
});

/* ------------------------------------------------- "Continuar como …" e "Usar outra conta" */

test('continuar: um toque com login_hint; janela fechada mantém a sessão vencida; deu certo → sessão nova no localStorage', async (t) => {
  const ctx = ambiente(t, { local: new StorageFalso({ 'motor.sessao': sessao(-5, 'token-falso-velho'), 'motor.email': EMAIL }) });
  const auth = await abrirApp();

  ctx.fechar(); // ela fecha a janela do Google
  await assert.rejects(auth.continuar(EMAIL), (e) => e.codigo === 'popup_closed' && /janela de login foi fechada/.test(e.message));
  assert.deepEqual(ctx.pedidos.at(-1), { prompt: '', login_hint: EMAIL });
  assert.deepEqual(auth.estadoDeAbertura(), { estado: 'continuar', email: EMAIL }); // o botão segue valendo

  ctx.responder('token-falso-novo');
  const s = await auth.continuar(); // sem e-mail: usa o da sessão guardada
  assert.deepEqual(ctx.pedidos.at(-1), { prompt: '', login_hint: EMAIL });
  assert.equal(s.access_token, 'token-falso-novo');
  const guardada = JSON.parse(localStorage.getItem('motor.sessao'));
  assert.equal(guardada.access_token, 'token-falso-novo');
  assert.ok(guardada.expires_at > Date.now() + 50 * MIN);
  assert.equal(auth.getToken(), 'token-falso-novo');
  assert.deepEqual(auth.estadoDeAbertura(), { estado: 'entrar', email: EMAIL });
  auth.encerrarSessao();
});

test('continuar: conta fora da lista é recusada (nada gravado, nada revogado no Google)', async (t) => {
  const ctx = ambiente(t, { local: new StorageFalso({ 'motor.sessao': sessao(-5, 'token-falso-velho') }) });
  const auth = await abrirApp();
  ctx.email = OUTRA; // no popup ela escolheu outra conta
  ctx.responder('token-falso-outra');
  await assert.rejects(auth.continuar(EMAIL), (e) => e.codigo === 'nao_permitido');
  assert.deepEqual(ctx.revogados, []); // nunca revoga: o rclone do Motor usa o mesmo projeto do Google
  assert.equal(auth.getToken(), null);
  assert.ok(!String(localStorage.getItem('motor.sessao') || '').includes('token-falso-outra'));
});

test('Usar outra conta: sempre a escolha de conta (select_account, sem login_hint)', async (t) => {
  const ctx = ambiente(t, { local: new StorageFalso({ 'motor.sessao': sessao(-5), 'motor.email': EMAIL }) });
  const auth = await abrirApp();
  ctx.fechar();
  await assert.rejects(auth.entrar({ outraConta: true }), (e) => e.codigo === 'popup_closed');
  assert.deepEqual(ctx.pedidos.at(-1), { prompt: 'select_account' });
  // O "Entrar com Google" normal (sem sair antes) continua com o e-mail lembrado
  await assert.rejects(auth.entrar(), (e) => e.codigo === 'popup_closed');
  assert.deepEqual(ctx.pedidos.at(-1), { prompt: '', login_hint: EMAIL });
});

/* ------------------------------------------------------------- c) Sair */

test('Sair: apaga motor.sessao e motor.email do localStorage na hora; a próxima abertura é a entrada normal', async (t) => {
  ambiente(t);
  for (const minutos of [60, -5]) { // com o token válido e com ele vencido
    const local = new StorageFalso({ 'motor.sessao': sessao(minutos), 'motor.email': EMAIL, 'motor-tema': 'dia' });
    globalThis.localStorage = local;
    globalThis.sessionStorage = new StorageFalso();
    const auth = await abrirApp();
    assert.notEqual(auth.estadoDeAbertura().estado, 'normal');
    assert.equal(auth.encerrarSessao(), 'token-falso');
    // Síncrono: logo depois da chamada, sem esperar nada
    assert.equal(local.getItem('motor.sessao'), null);
    assert.equal(local.getItem('motor.email'), null);
    assert.equal(local.getItem('motor-tema'), 'dia');
    assert.deepEqual(auth.estadoDeAbertura(), { estado: 'normal', email: '' });
    assert.equal(auth.estaLogado(), false);

    // Abre de novo (página nova): entrada normal, com a escolha de conta; nunca o "Continuar"
    const depois = await abrirApp();
    assert.deepEqual(depois.estadoDeAbertura(), { estado: 'normal', email: '' });
    assert.equal(depois.retomarSessao(), null);
    assert.equal(depois.emailLembrado(), '');
    assert.deepEqual(depois.opcoesDeEntrada(depois.emailLembrado(), false), { prompt: 'select_account' });
  }
});

test('Sair pela tela (executarSaida): sessão some do localStorage antes da entrada aparecer e a marca de saída fica', async (t) => {
  const local = new StorageFalso({ 'motor.sessao': sessao(-5), 'motor.email': EMAIL });
  const sess = new StorageFalso();
  ambiente(t, { local, sess });
  const auth = await abrirApp();
  const { executarSaida, tirarSaida } = await import('../js/saida.js');
  const vistos = [];
  executarSaida({
    storage: sess,
    encerrar: () => auth.encerrarSessao(),
    mostrarEntrada: () => vistos.push(auth.estadoDeAbertura().estado),
    desligar: () => {},
    recarregar: () => {},
  });
  assert.deepEqual(vistos, ['normal']);
  assert.equal(local.getItem('motor.sessao'), null);
  assert.deepEqual(tirarSaida(sess), { mensagem: '' }); // a página recarregada fica na entrada normal
});

/* -------------------------------------------- d) migração do sessionStorage */

test('migração: a sessão antiga do sessionStorage vai para o localStorage uma vez e sai do sessionStorage', async () => {
  const { lerSessaoDe, estadoDeAbertura } = await abrirApp();
  const local = new StorageFalso();
  const sess = new StorageFalso({ 'motor.sessao': sessao(30), 'motor.filtros': '{}' });
  assert.equal(lerSessaoDe(local, sess).access_token, 'token-falso');
  assert.equal(sess.getItem('motor.sessao'), null);
  assert.equal(sess.getItem('motor.filtros'), '{}'); // só a sessão muda de lugar
  assert.ok(local.getItem('motor.sessao'));
  // Depois, vem do localStorage (mesmo sem o sessionStorage, como no app reaberto)
  assert.equal(lerSessaoDe(local, null).access_token, 'token-falso');
  assert.equal(estadoDeAbertura({ storage: local, sessao: new StorageFalso() }).estado, 'entrar');

  // Sessão antiga vencida: migra e vira "continuar"
  const l2 = new StorageFalso();
  const s2 = new StorageFalso({ 'motor.sessao': sessao(-10) });
  assert.deepEqual(estadoDeAbertura({ storage: l2, sessao: s2 }), { estado: 'continuar', email: EMAIL });
  assert.ok(l2.getItem('motor.sessao'));
  assert.equal(s2.getItem('motor.sessao'), null);
});

test('migração: o localStorage tem prioridade; localStorage que não grava deixa a sessão no sessionStorage, sem lançar', async () => {
  const { lerSessaoDe } = await abrirApp();
  const local = new StorageFalso({ 'motor.sessao': sessao(30, 'token-falso-novo') });
  const sess = new StorageFalso({ 'motor.sessao': sessao(30, 'token-falso-velho') });
  assert.equal(lerSessaoDe(local, sess).access_token, 'token-falso-novo');
  assert.equal(JSON.parse(local.getItem('motor.sessao')).access_token, 'token-falso-novo');

  // Modo privado: o localStorage lança no setItem → a sessão fica onde estava e continua lida
  const cheio = new StorageFalso();
  cheio.setItem = () => { throw new Error('QuotaExceededError'); };
  const s3 = new StorageFalso({ 'motor.sessao': sessao(30) });
  assert.equal(lerSessaoDe(cheio, s3).access_token, 'token-falso');
  assert.ok(s3.getItem('motor.sessao'));
  // Sem localStorage nenhum (acesso que lança)
  const bloqueado = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.equal(lerSessaoDe(bloqueado, s3).access_token, 'token-falso');
  assert.equal(lerSessaoDe(null, null), null);
});

test('migração pelo app: a sessão antiga do sessionStorage abre o app direto e passa a ficar no localStorage', async (t) => {
  ambiente(t, { sess: new StorageFalso({ 'motor.sessao': sessao(30) }) });
  const auth = await abrirApp();
  assert.ok(auth.retomarSessao());
  assert.ok(localStorage.getItem('motor.sessao'));
  assert.equal(sessionStorage.getItem('motor.sessao'), null);
  assert.equal(auth.getToken(), 'token-falso');
  auth.encerrarSessao();
  assert.equal(localStorage.getItem('motor.sessao'), null);
});

test('gravar a sessão com o localStorage bloqueado: fica no sessionStorage (vale nesta aba), sem lançar', async (t) => {
  const cheio = new StorageFalso();
  cheio.setItem = () => { throw new Error('QuotaExceededError'); };
  const ctx = ambiente(t, { local: cheio });
  const auth = await abrirApp();
  ctx.responder('token-falso');
  await auth.entrar();
  assert.ok(sessionStorage.getItem('motor.sessao'));
  assert.equal(auth.getToken(), 'token-falso');
  auth.encerrarSessao();
  assert.equal(sessionStorage.getItem('motor.sessao'), null);
});
