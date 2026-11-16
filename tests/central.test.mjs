// Central (js/central.js): formatos dos pedidos, "motor ouvindo", sessão guardada, nonce e o cliente HTTP
// contra uma central falsa (fetch injetado). Mais a linha "Central" do Início (js/saude.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  arquivoDoPedido, motorOuvindo, sessaoDe, criarCentral, CHAVE_SESSAO, FORMATOS, MOTOR_OUVINDO_MS,
} from '../js/central.js';
import { htmlCentral } from '../js/saude.js';
import { chaveParaApagar } from '../js/auth.js';

function armazenamento() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test('arquivoDoPedido: os quatro formatos e nada fora deles', () => {
  assert.equal(arquivoDoPedido('decisao_previa', 'S47-01 aprovado.md'), '4-Revisao/S47-01 aprovado.md');
  assert.equal(arquivoDoPedido('decisao_previa', 'T05 ajustes v2.md'), '4-Revisao/T05 ajustes v2.md');
  assert.equal(arquivoDoPedido('decisao_roteiro', 'S47-01 decisao v1.md'), '2-Roteiros/rascunhos/S47-01 decisao v1.md');
  assert.equal(arquivoDoPedido('busca', 'pedido-busca.md'), '1-Radar/pedido-busca.md');
  assert.equal(arquivoDoPedido('decisoes_semana', 'decisoes S47.md'), '1-Radar/decisoes S47.md');
  assert.equal(arquivoDoPedido('decisao_gancho', 'S47-01 gancho v2.md'), '2-Roteiros/rascunhos/S47-01 gancho v2.md');
  for (const [t, n] of [['decisao_previa', '../x aprovado.md'], ['decisao_previa', 'S47-01 rascunho.md'],
    ['busca', 'outro.md'], ['qualquer', 'x.md'], ['decisao_roteiro', 'S47 01 decisao v1.md'],
    ['decisao_gancho', 'S47-01 ganchos v1.md'], ['decisao_gancho', 'S47-01 gancho.md'], ['decisao_roteiro', 'S47-01 gancho v1.md']]) {
    assert.throws(() => arquivoDoPedido(t, n), undefined, `${t} ${n}`);
  }
});

test('formatos iguais aos do banco e do motor', () => {
  const sql = readFileSync(new URL('../js/central.js', import.meta.url), 'utf8');
  assert.ok(sql.includes('arquivo_do_tipo'));
  assert.deepEqual(Object.keys(FORMATOS).sort(), ['busca', 'decisao_gancho', 'decisao_previa', 'decisao_roteiro', 'decisoes_semana', 'retrospectiva']);
});

// O combinado da escolha do gancho (GC3), escrito igual nos três lugares: aqui, no bin/central.py do motor e na
// regra arquivo_do_tipo do banco (central/migracoes/ do motor). O motor é outro repositório: com MOTOR_REELS_DIR
// apontando para ele, o teste abaixo compara os três de verdade (o tests/teste_central.py do motor faz o mesmo).
const GANCHO = '^2-Roteiros/rascunhos/[A-Za-z0-9-]+ gancho v[0-9]+\\.md$';
const fonteJs = (re) => re.source.replace(/\\\//g, '/');

test('decisao_gancho: o regex combinado, igual ao do motor e do banco', () => {
  assert.equal(fonteJs(FORMATOS.decisao_gancho), GANCHO);
});

const MOTOR = process.env.MOTOR_REELS_DIR || '';
test('formatos: os três lugares batem (com o motor ao lado, MOTOR_REELS_DIR)', { skip: !(MOTOR && existsSync(path.join(MOTOR, 'bin', 'central.py'))) && 'sem MOTOR_REELS_DIR' }, () => {
  const py = readFileSync(path.join(MOTOR, 'bin', 'central.py'), 'utf8');
  const doMotor = Object.fromEntries([...py.matchAll(/^\s*"(\w+)": re\.compile\(r"([^"]+)"\),?\s*$/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(doMotor).sort(), Object.keys(FORMATOS).sort());
  for (const [tipo, re] of Object.entries(FORMATOS)) assert.equal(fonteJs(re), doMotor[tipo], tipo);
  const pasta = path.join(MOTOR, 'central', 'migracoes');
  const sql = readdirSync(pasta).filter((n) => n.endsWith('.sql')).sort()
    .map((n) => readFileSync(path.join(pasta, n), 'utf8')).filter((s) => s.includes('add constraint arquivo_do_tipo')).at(-1);
  const doBanco = Object.fromEntries([...sql.matchAll(/tipo = '(\w+)'\s+and arquivo ~ '([^']+)'/g)].map((m) => [m[1], m[2]]));
  for (const [tipo, re] of Object.entries(doBanco)) assert.equal(fonteJs(FORMATOS[tipo]), re, tipo);
  assert.equal(doBanco.decisao_gancho, GANCHO);
  const tipos = sql.match(/add constraint pedidos_tipo_check\s+check \(tipo in \(([^)]*)\)\)/)[1].match(/\w+/g);
  assert.deepEqual([...tipos].sort(), Object.keys(FORMATOS).sort());
});

test('motorOuvindo: só com sinal de vida recente', () => {
  const agora = Date.parse('2026-11-16T10:00:00Z');
  assert.equal(motorOuvindo({ atualizado_em: '2026-11-16T09:59:10Z' }, agora), true);
  assert.equal(motorOuvindo({ atualizado_em: new Date(agora - MOTOR_OUVINDO_MS - 1000).toISOString() }, agora), false);
  assert.equal(motorOuvindo(null, agora), false);
  assert.equal(motorOuvindo({ atualizado_em: 'lixo' }, agora), false);
  const dezMin = new Date(agora - 10 * 60 * 1000).toISOString();
  assert.equal(motorOuvindo({ atualizado_em: dezMin, dados: { central: { modo: 'grok' } } }, agora), false);
  assert.equal(motorOuvindo({ atualizado_em: dezMin, dados: { central: { modo: 'modal' } } }, agora), true);
});

test('sessaoDe: confere o e-mail e ignora lixo', () => {
  const st = armazenamento();
  assert.equal(sessaoDe(st, 'a@b.c'), null);
  st.setItem(CHAVE_SESSAO, '{quebrado');
  assert.equal(sessaoDe(st, 'a@b.c'), null);
  st.setItem(CHAVE_SESSAO, JSON.stringify({ access_token: 'x', refresh_token: 'r', email: 'a@b.c' }));
  assert.ok(sessaoDe(st, 'A@B.C'));
  assert.equal(sessaoDe(st, 'outra@b.c'), null);
});

test('a sessão da central some no "Sair" (chave motor.*)', () => {
  assert.equal(chaveParaApagar(CHAVE_SESSAO), true);
});

/* central falsa: registra as chamadas e responde como o Auth e o PostgREST */
function centralFalsa({ expiraEm = 3600, falhar = null } = {}) {
  const chamadas = [];
  const fetch = async (url, op) => {
    const u = new URL(url);
    const corpo = op.body ? JSON.parse(op.body) : null;
    chamadas.push({ metodo: op.method, caminho: u.pathname + u.search, cab: op.headers, corpo });
    const resp = (status, dados) => ({ ok: status < 300, status, text: async () => (dados === undefined ? '' : JSON.stringify(dados)) });
    if (falhar) return falhar(u, op);
    if (u.pathname === '/functions/v1/entrar-com-google') {
      return resp(200, { access_token: 'A1', refresh_token: 'R1', expires_in: expiraEm, user: { email: 'Ela@Teste.br' } });
    }
    if (u.pathname === '/auth/v1/token') return resp(200, { access_token: 'A2', refresh_token: 'R2', expires_in: 3600 });
    if (u.pathname === '/rest/v1/motor_estado') return resp(200, [{ atualizado_em: '2026-11-16T10:00:00Z', dados: {} }]);
    if (u.pathname === '/rest/v1/pedidos' && op.method === 'POST') return resp(201, [{ id: 'uuid-1' }]);
    if (u.pathname === '/rest/v1/pedidos') return resp(200, [{ status: 'entregue', motivo: 'gravado', entregue_em: 'x' }]);
    return resp(404, { message: 'não' });
  };
  return { fetch, chamadas };
}

test('cliente: entra com o token Google do app, guarda a sessão e envia o pedido com a chave pública', async () => {
  const st = armazenamento();
  const f = centralFalsa();
  const c = criarCentral({ url: 'https://x.supabase.co/', chave: 'sb_publishable_t', fetch: f.fetch, storage: st, agora: () => 1000 });
  const r = await c.entrarComGoogle('ya29.token');
  assert.equal(r.email, 'ela@teste.br');
  assert.equal(f.chamadas[0].caminho, '/functions/v1/entrar-com-google');
  assert.deepEqual(f.chamadas[0].corpo, { access_token: 'ya29.token' });
  await assert.rejects(c.entrarComGoogle(null), (e) => e.codigo === 'sem-google');
  assert.equal(f.chamadas[0].cab.apikey, 'sb_publishable_t');
  assert.ok(sessaoDe(st, 'ela@teste.br'));
  const p = await c.enviarPedido({ tipo: 'decisao_previa', conteudo_id: 'S47-01', arquivo: '4-Revisao/S47-01 aprovado.md', conteudo: 'id: S47-01' });
  assert.equal(p.id, 'uuid-1');
  const post = f.chamadas.at(-1);
  assert.equal(post.cab.Authorization, 'Bearer A1');
  assert.equal(post.cab.Prefer, 'return=representation');
  assert.equal(post.corpo.quem, 'ela@teste.br');
  assert.equal(post.corpo.arquivo, '4-Revisao/S47-01 aprovado.md');
});

test('cliente: a escolha do gancho vai como decisao_gancho para 2-Roteiros/rascunhos', async () => {
  const f = centralFalsa();
  const st = armazenamento();
  st.setItem(CHAVE_SESSAO, JSON.stringify({ access_token: 'A1', refresh_token: 'R', email: 'ela@teste.br', expira: 9e15 }));
  const c = criarCentral({ url: 'https://x', chave: 'k', fetch: f.fetch, storage: st, agora: () => 0 });
  const arquivo = arquivoDoPedido('decisao_gancho', 'S47-01 gancho v1.md');
  const r = await c.enviarPedido({ tipo: 'decisao_gancho', conteudo_id: 'S47-01', arquivo, conteudo: '---\nescolha: 2\n---\n' });
  assert.equal(r.id, 'uuid-1');
  assert.equal(f.chamadas.at(-1).corpo.tipo, 'decisao_gancho');
  assert.equal(f.chamadas.at(-1).corpo.arquivo, '2-Roteiros/rascunhos/S47-01 gancho v1.md');
  await assert.rejects(c.enviarPedido({ tipo: 'decisao_gancho', arquivo: '2-Roteiros/rascunhos/S47-01 ganchos v1.md', conteudo: 'x' }));
  assert.equal(f.chamadas.length, 1);
});

test('cliente: recusa caminho fora do formato e pedido vazio sem chamar a central', async () => {
  const f = centralFalsa();
  const st = armazenamento();
  st.setItem(CHAVE_SESSAO, JSON.stringify({ access_token: 'A', refresh_token: 'R', email: 'e@x', expira: 9e15 }));
  const c = criarCentral({ url: 'https://x', chave: 'k', fetch: f.fetch, storage: st });
  await assert.rejects(c.enviarPedido({ tipo: 'busca', arquivo: '4-Revisao/x aprovado.md', conteudo: 'x' }));
  await assert.rejects(c.enviarPedido({ tipo: 'busca', arquivo: '1-Radar/pedido-busca.md', conteudo: '  ' }));
  assert.equal(f.chamadas.length, 0);
});

test('cliente: token perto de vencer é renovado antes do pedido', async () => {
  let agora = 0;
  const f = centralFalsa({ expiraEm: 60 });
  const st = armazenamento();
  const c = criarCentral({ url: 'https://x', chave: 'k', fetch: f.fetch, storage: st, agora: () => agora });
  await c.entrarComGoogle('t');
  agora = 30 * 1000;
  await c.estadoMotor();
  assert.ok(f.chamadas.some((x) => x.caminho.includes('grant_type=refresh_token')));
  assert.equal(f.chamadas.at(-1).cab.Authorization, 'Bearer A2');
});

test('cliente: refresh recusado esquece a sessão; sem rede vira erro "rede"', async () => {
  const st = armazenamento();
  st.setItem(CHAVE_SESSAO, JSON.stringify({ access_token: 'A', refresh_token: 'R', email: 'e@x', expira: 0 }));
  const recusa = centralFalsa({ falhar: async () => ({ ok: false, status: 400, text: async () => '{"error_description":"invalid"}' }) });
  const c = criarCentral({ url: 'https://x', chave: 'k', fetch: recusa.fetch, storage: st, agora: () => 1e6 });
  await assert.rejects(c.estadoMotor());
  assert.equal(st.getItem(CHAVE_SESSAO), null);
  const semRede = criarCentral({ url: 'https://x', chave: 'k', fetch: async () => { throw new TypeError('offline'); }, storage: armazenamento() });
  await assert.rejects(semRede.entrarComGoogle('t'), (e) => e.codigo === 'rede');
});

test('htmlCentral: conectando, tentar de novo, ligada com o motor ouvindo ou não', () => {
  assert.match(htmlCentral({ conectada: false, conectando: true }), /Conectando/);
  assert.doesNotMatch(htmlCentral({ conectada: false, conectando: true }), /data-acao/);
  assert.match(htmlCentral({ conectada: false }), /data-acao="central-conectar"/);
  assert.match(htmlCentral({ conectada: true, ouvindo: true }), /em segundos/);
  assert.match(htmlCentral({ conectada: true, ouvindo: false }), /pelo Drive/);
  assert.doesNotMatch(htmlCentral({ conectada: true, ouvindo: true }), /data-acao/);
});
