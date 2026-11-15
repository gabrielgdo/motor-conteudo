// Testes do envio do vídeo bruto pelo app (ponto 7): nome final e extensões, bloqueio com bruto já
// em 3-Brutos (nunca sobrescreve), trava contra clique repetido e entre abas, renovação do token
// dentro do toque, "concluído" só depois de os metadados conferirem (tamanho/pasta/lixeira), retomada
// pela sessão salva e escape na tela. O upload de verdade (js/upload.js) roda com fetch e
// XMLHttpRequest falsos; o Drive (pasta, listagem, metadados) é falso. Nada sai para a rede.
import { test as testeSolto, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/** Storage falso, com a mesma interface do localStorage. */
class StorageFalso {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

const ROBERTTA = 'robertta.c.alonso@gmail.com';
// Os falsos entram só durante estes testes e saem depois (o index.js roda todos os arquivos num
// processo só: sair.test.mjs e outros têm os seus).
const localFalso = new StorageFalso();
const windowFalso = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
const GLOBAIS = ['window', 'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest'];
let originais = null;
const sessao = () => localStorage.setItem('motor.sessao', JSON.stringify({ access_token: 'tok-falso', expires_at: Date.now() + 55 * 60000, email: ROBERTTA }));

/* ---- fetch falso (POST de início da sessão retomável e DELETE do cancelar) ---- */
let pedidosFetch = [];
const fetchFalso = async (url, op = {}) => {
  pedidosFetch.push({ url: String(url), metodo: op.method || 'GET', headers: op.headers || {}, corpo: op.body });
  if (op.method === 'POST' && /uploadType=resumable/.test(url)) {
    return { ok: true, status: 200, headers: { get: (h) => (h === 'Location' ? 'https://upload.falso/sessao/1' : null) } };
  }
  return { ok: true, status: 204, headers: { get: () => null } };
};

/* ---- XMLHttpRequest falso: o teste decide a resposta de cada PUT ---- */
let puts = [];
let responderPut = null; // (put) => {status, range?, corpo?}
class XhrFalso {
  constructor() { this.headers = {}; this.upload = {}; this.status = 0; this.responseText = ''; this.resp = {}; }
  open(metodo, url) { this.metodo = metodo; this.url = url; }
  setRequestHeader(k, v) { this.headers[k] = v; }
  getResponseHeader(h) { return h === 'Range' ? (this.resp.range ?? null) : null; }
  abort() { this.abortado = true; setTimeout(() => this.onabort?.(), 0); }
  send(corpo) {
    const put = { url: this.url, contentRange: this.headers['Content-Range'], tamanho: corpo ? corpo.size : 0, auth: this.headers.Authorization };
    puts.push(put);
    setTimeout(() => {
      if (this.abortado) return;
      this.resp = responderPut(put);
      this.status = this.resp.status;
      this.responseText = this.resp.corpo || '';
      if (corpo) this.upload.onprogress?.({ loaded: corpo.size });
      this.onload?.();
    }, 0);
  }
}

function instalar() {
  originais = Object.fromEntries(GLOBAIS.map((g) => [g, Object.getOwnPropertyDescriptor(globalThis, g)]));
  const por = (g, v) => Object.defineProperty(globalThis, g, { value: v, writable: true, configurable: true });
  por('window', windowFalso); por('localStorage', localFalso); por('sessionStorage', new StorageFalso());
  por('fetch', fetchFalso); por('XMLHttpRequest', XhrFalso);
}
function restaurar() {
  for (const g of GLOBAIS) {
    const d = originais?.[g];
    if (d) Object.defineProperty(globalThis, g, d); else delete globalThis[g];
  }
  originais = null;
}

const { criarUpload, chaveSessao, PEDACO } = await import('../js/upload.js');
const {
  criarEnviador, nomeFinalDoBruto, brutosDoId, conferirGravado, reservaAtiva, textoProgresso, travaDoNavegador,
  EXTENSOES_VIDEO, PREFIXO_RESERVA, MARGEM_TOKEN_MS,
} = await import('../js/envio-video.js');

const PASTA = 'pasta-3brutos';
/** "Arquivo" do input: só o que o upload usa (name, size, type, lastModified, slice). */
const arquivoFalso = (name, size, lastModified = 1700000000000) => ({
  name, size, type: 'video/quicktime', lastModified, slice: (a, b) => ({ size: Math.min(b, size) - a }),
});

/** Drive falso + enviador montado com o upload.js de verdade. */
function montar({ existentes = [], meta = null, podeEnviar = true, validade = 55 * 60000, trava, storage = localStorage, falhasMeta = 0 } = {}) {
  const d = {
    chamadas: [], listagens: 0, metas: 0, renovacoes: 0, uploads: 0, estados: [], progresso: [],
    existentes, meta,
  };
  const enviar = criarEnviador({
    podeEnviar: () => podeEnviar,
    validadeToken: () => validade,
    renovarInterativo: () => { d.renovacoes++; d.chamadas.push('renovar'); return Promise.resolve({}); },
    pastaBrutos: async () => PASTA,
    listarBrutos: async (p) => { assert.equal(p, PASTA); d.listagens++; d.chamadas.push('listar'); return d.existentes; },
    metadados: async (id, campos) => {
      d.metas++;
      d.chamadas.push('metadados');
      assert.match(campos, /size/); assert.match(campos, /parents/); assert.match(campos, /trashed/);
      if (d.metas <= falhasMeta) throw new Error('rede');
      return typeof d.meta === 'function' ? d.meta(id) : d.meta;
    },
    criarUpload: (op) => { d.uploads++; d.chamadas.push('upload'); d.opUpload = op; return criarUpload(op); },
    trava,
    storage,
    esperar: () => Promise.resolve(),
  });
  const aoEstado = (fase, msg) => { d.estados.push(fase); d.chamadas.push(`estado:${fase}`); d.ultimaMsg = msg; };
  const aoProgresso = (p) => d.progresso.push(p);
  return { d, enviar: (id, arquivo) => enviar({ id, arquivo, aoEstado, aoProgresso }) };
}

/** PUT de um pedaço só: termina com 200 e o arquivo criado. */
const respostaFinal = (fileId = 'f-1', name = 'S46-01.mov') => () => ({ status: 200, corpo: JSON.stringify({ id: fileId, name }) });

// Os casos ficam num describe: os ganchos (instalar/restaurar os falsos) valem só para eles.
const casos = [];
const test = (nome, fn) => casos.push([nome, fn]);

function prepararCaso() {
  instalar();
  localStorage.m.clear();
  sessao();
  pedidosFetch = [];
  puts = [];
  responderPut = respostaFinal();
}

/* ----------------------------------------------------------- nome final */

test('nome final: <id>.<ext minúscula>; só mp4, mov e m4v; id conferido', () => {
  assert.deepEqual([...EXTENSOES_VIDEO], ['mp4', 'mov', 'm4v']);
  assert.deepEqual(nomeFinalDoBruto('S46-01', 'IMG_1234.MOV'), { ok: true, nome: 'S46-01.mov', ext: 'mov' });
  assert.equal(nomeFinalDoBruto('S46-01', 'video.final.MP4').nome, 'S46-01.mp4');
  assert.equal(nomeFinalDoBruto('T03', 'clip.m4v').nome, 'T03.m4v');
  assert.equal(nomeFinalDoBruto('R001', 'a.Mov').nome, 'R001.mov');
  for (const ruim of ['filme.avi', 'foto.HEIC', 'semextensao', '.mov', '', 'video.mov.zip']) {
    const r = nomeFinalDoBruto('S46-01', ruim);
    assert.equal(r.ok, false, ruim);
    assert.equal(r.codigo, 'extensao');
    assert.match(r.mensagem, /\.mp4, \.mov ou \.m4v/);
  }
  for (const id of ['', 'S46', '../S46-01', 'S46-01/x', null]) assert.equal(nomeFinalDoBruto(id, 'a.mov').codigo, 'id-invalido', String(id));
  // Nunca o nome do bruto sintético de teste (`<id> bruto.mp4`).
  assert.doesNotMatch(nomeFinalDoBruto('T03', 'x.mp4').nome, / bruto/);
});

test('brutosDoId: só os vídeos de 3-Brutos que começam pelo id (ignora pastas e outros ids)', () => {
  const lista = [
    { id: '1', name: 'S46-01.mov' }, { id: '2', name: 'S46-01 bruto.mp4' }, { id: '3', name: 'S46-02.mov' },
    { id: '4', name: 'S46-01 notas.txt' }, { id: '5', name: 'S46-01.mp4', mimeType: 'application/vnd.google-apps.folder' },
    { id: '6', name: 'IMG_1.MOV' },
  ];
  assert.deepEqual(brutosDoId(lista, 'S46-01').map((a) => a.id), ['1', '2']);
  assert.deepEqual(brutosDoId(null, 'S46-01'), []);
});

/* --------------------------------------------- bloqueio com bruto existente */

test('bloqueia com bruto do id já em 3-Brutos: explica (Diretor / apagar no Drive) e não envia nada', async () => {
  const { d, enviar } = montar({ existentes: [{ id: 'velho', name: 'S46-01.MP4', size: '999' }] });
  const ctl = enviar('S46-01', arquivoFalso('IMG_9.MOV', 1000));
  await assert.rejects(ctl.promessa, (e) => {
    assert.equal(e.codigo, 'ja-existe');
    assert.match(e.message, /Já existe um vídeo de S46-01 em 3-Brutos \(S46-01\.MP4\)/);
    assert.match(e.message, /não substitui/);
    assert.match(e.recuperacao, /fale com o Diretor/);
    assert.match(e.recuperacao, /apague o vídeo antigo de 3-Brutos no Drive/);
    return true;
  });
  assert.equal(d.uploads, 0, 'nunca abre o envio (não sobrescreve)');
  assert.equal(puts.length + pedidosFetch.length, 0);
  assert.equal(d.estados.at(-1), 'erro');
  assert.equal(localStorage.getItem(`${PREFIXO_RESERVA}S46-01`), null, 'a reserva sai no fim');
});

test('mesmo vídeo já em 3-Brutos (nome e tamanho iguais): reconhece como enviado, sem enviar de novo', async () => {
  const { d, enviar } = montar({ existentes: [{ id: 'f-9', name: 'S46-01.mov', size: '1000' }] });
  const res = await enviar('S46-01', arquivoFalso('IMG_9.MOV', 1000)).promessa;
  assert.equal(res.jaEstava, true);
  assert.equal(res.arquivo.id, 'f-9');
  assert.equal(d.uploads, 0);
});

test('recusas antes de qualquer rede: conta que não decide, extensão, arquivo vazio', async () => {
  for (const [op, arquivo, codigo] of [
    [{ podeEnviar: false }, arquivoFalso('a.mov', 10), 'sem-permissao'],
    [{}, arquivoFalso('a.avi', 10), 'extensao'],
    [{}, arquivoFalso('a.mov', 0), 'vazio'],
    [{}, null, 'sem-arquivo'],
  ]) {
    const { d, enviar } = montar(op);
    const ctl = enviar('S46-01', arquivo);
    assert.equal(ctl.recusado, true);
    await assert.rejects(ctl.promessa, (e) => e.codigo === codigo);
    assert.equal(d.listagens + d.uploads + d.renovacoes, 0, codigo);
  }
});

/* -------------------------------------------------- trava contra envio duplo */

test('clique repetido: o segundo envio do mesmo id é recusado na hora; só um upload', async () => {
  const { d, enviar } = montar({ meta: { id: 'f-1', name: 'S46-01.mov', size: '1000', parents: [PASTA], trashed: false } });
  const a = arquivoFalso('IMG.MOV', 1000);
  const primeiro = enviar('S46-01', a);
  const segundo = enviar('S46-01', a);
  assert.equal(segundo.recusado, true);
  await assert.rejects(segundo.promessa, (e) => e.codigo === 'em-andamento' && /já está em andamento/.test(e.message));
  assert.ok(reservaAtiva(localStorage.getItem(`${PREFIXO_RESERVA}S46-01`)), 'reserva gravada enquanto envia');
  await primeiro.promessa;
  assert.equal(d.uploads, 1);
  // Terminado, pode enviar outro (aqui: o Drive já tem o mesmo arquivo → reconhece).
  d.existentes = [{ id: 'f-1', name: 'S46-01.mov', size: '1000' }];
  assert.equal((await enviar('S46-01', a).promessa).jaEstava, true);
});

test('outra aba: reserva no localStorage ou navigator.locks ocupado bloqueiam o envio', async () => {
  localStorage.setItem(`${PREFIXO_RESERVA}S46-01`, JSON.stringify({ ate: Date.now() + 60000 }));
  const m1 = montar();
  await assert.rejects(m1.enviar('S46-01', arquivoFalso('a.mov', 10)).promessa, (e) => e.codigo === 'em-andamento' && /outra janela/.test(e.message));
  assert.equal(m1.d.listagens, 0);
  // Reserva vencida (aba fechada no meio) não segura para sempre.
  assert.equal(reservaAtiva(JSON.stringify({ ate: Date.now() - 1 })), false);
  assert.equal(reservaAtiva('lixo{'), false);
  localStorage.removeItem(`${PREFIXO_RESERVA}S46-01`);

  const nomes = [];
  const locksOcupado = { request: (nome, op, fn) => { nomes.push([nome, op.ifAvailable]); return fn(null); } };
  const m2 = montar({ trava: travaDoNavegador(locksOcupado) });
  await assert.rejects(m2.enviar('S46-01', arquivoFalso('a.mov', 10)).promessa, (e) => e.codigo === 'em-andamento');
  assert.deepEqual(nomes, [['motor-envio-S46-01', true]]);
  assert.equal(m2.d.uploads, 0);
});

/* ------------------------------------------------ token renovado no toque */

test('token perto de vencer: renova DENTRO do toque (antes de qualquer espera); com folga, não', async () => {
  const meta = { id: 'f-1', name: 'S46-01.mov', size: '10', parents: [PASTA], trashed: false };
  const m = montar({ validade: MARGEM_TOKEN_MS - 1, meta });
  const ctl = m.enviar('S46-01', arquivoFalso('a.mov', 10));
  assert.equal(m.d.renovacoes, 1, 'renovarInterativo chamado de forma síncrona, ainda no clique');
  await ctl.promessa;
  assert.equal(m.d.chamadas[0], 'renovar');
  const m2 = montar({ validade: MARGEM_TOKEN_MS + 60000, meta });
  await m2.enviar('S46-01', arquivoFalso('a.mov', 10)).promessa;
  assert.equal(m2.d.renovacoes, 0);
});

/* ---------------------------------- concluído só depois de os metadados conferirem */

test('concluído só depois de metadados conferirem tamanho, pasta 3-Brutos e fora da lixeira', async () => {
  const { d, enviar } = montar({ meta: { id: 'f-1', name: 'S46-01.mov', size: '1000', parents: [PASTA], trashed: false } });
  const res = await enviar('S46-01', arquivoFalso('IMG.MOV', 1000)).promessa;
  assert.deepEqual(res.arquivo, { id: 'f-1', name: 'S46-01.mov', size: 1000 });
  assert.equal(res.nome, 'S46-01.mov');
  assert.equal(res.duplicados, false);
  // O upload criou o arquivo com o nome final e na pasta 3-Brutos.
  const inicio = pedidosFetch.find((p) => p.metodo === 'POST');
  assert.deepEqual(JSON.parse(inicio.corpo), { name: 'S46-01.mov', parents: [PASTA] });
  assert.equal(inicio.headers['X-Upload-Content-Length'], '1000');
  // Ordem: o upload termina → "conferindo" → metadados → relê a pasta → só então "concluido".
  const c = d.chamadas;
  assert.ok(c.indexOf('estado:conferindo') < c.indexOf('metadados'));
  assert.ok(c.indexOf('metadados') < c.indexOf('estado:concluido'));
  assert.equal(c.filter((x) => x === 'estado:concluido').length, 1);
  assert.equal(d.listagens, 2, 'lista antes (bloqueio) e depois (duplicado)');
  assert.equal(d.progresso.at(-1).enviados, 1000);
  assert.equal(localStorage.getItem(chaveSessao('S46-01', arquivoFalso('IMG.MOV', 1000))), null, 'sessão retomável apagada no fim');
});

test('metadados diferentes = erro (nunca "concluido"): tamanho, pasta, lixeira, sem resposta', async () => {
  const base = { id: 'f-1', name: 'S46-01.mov', size: '1000', parents: [PASTA], trashed: false };
  for (const [meta, codigo, re] of [
    [{ ...base, size: '999' }, 'tamanho', /tamanho no Drive \(999 bytes\) não é o do vídeo \(1000 bytes\)/],
    [{ ...base, parents: ['outra-pasta'] }, 'pasta', /não ficou na pasta 3-Brutos/],
    [{ ...base, trashed: true }, 'lixeira', /lixeira/],
    [{ ...base, name: 'S46-01 (1).mov' }, 'nome', /nome/],
  ]) {
    const { d, enviar } = montar({ meta });
    await assert.rejects(enviar('S46-01', arquivoFalso('IMG.MOV', 1000)).promessa, (e) => {
      assert.equal(e.codigo, codigo);
      assert.match(e.message, re);
      assert.match(e.recuperacao, /apague/);
      return true;
    });
    assert.ok(!d.estados.includes('concluido'), codigo);
    assert.equal(d.estados.at(-1), 'erro');
  }
  // Metadados sem resposta (3 tentativas): erro com recuperação, sem "concluido".
  const m = montar({ meta: base, falhasMeta: 3 });
  await assert.rejects(m.enviar('S46-01', arquivoFalso('IMG.MOV', 1000)).promessa, (e) => e.codigo === 'conferencia' && /Enviar de novo/.test(e.recuperacao));
  assert.equal(m.d.metas, 3);
  assert.ok(!m.d.estados.includes('concluido'));
  // Uma falha passageira e depois confere: conclui.
  const m2 = montar({ meta: base, falhasMeta: 1 });
  assert.equal((await m2.enviar('S46-01', arquivoFalso('IMG.MOV', 1000)).promessa).ok, true);
});

test('conferirGravado: regras puras', () => {
  const ok = { id: 'x', name: 'S46-01.mov', size: '5', parents: [PASTA], trashed: false };
  assert.deepEqual(conferirGravado(ok, { total: 5, pastaId: PASTA, nome: 'S46-01.mov' }), { ok: true });
  assert.equal(conferirGravado(null, { total: 5, pastaId: PASTA }).ok, false);
  assert.equal(conferirGravado({ ...ok, size: undefined }, { total: 5, pastaId: PASTA }).codigo, 'tamanho');
  assert.equal(conferirGravado({ ...ok, parents: undefined }, { total: 5, pastaId: PASTA }).codigo, 'pasta');
});

test('aviso de duplicado: outro bruto do id apareceu durante o envio', async () => {
  const { d, enviar } = montar({ meta: { id: 'f-1', name: 'S46-01.mov', size: '10', parents: [PASTA], trashed: false } });
  d.meta = (id) => { d.existentes = [{ id, name: 'S46-01.mov', size: '10' }, { id: 'g', name: 'S46-01.mp4', size: '7' }]; return { id, name: 'S46-01.mov', size: '10', parents: [PASTA], trashed: false }; };
  assert.equal((await enviar('S46-01', arquivoFalso('a.mov', 10)).promessa).duplicados, true);
});

/* -------------------------------------------------------------- retomada */

test('retomada: com a sessão salva, pergunta ao Drive onde parou e continua dali (sem abrir outra)', async () => {
  const total = PEDACO + 1000;
  const a = arquivoFalso('IMG.MOV', total);
  localStorage.setItem(chaveSessao('S46-01', a), JSON.stringify({ uri: 'https://upload.falso/sessao/antiga', data: Date.now() - 60000 }));
  responderPut = (p) => (p.contentRange === `bytes */${total}`
    ? { status: 308, range: `bytes=0-${PEDACO - 1}` }
    : { status: 200, corpo: JSON.stringify({ id: 'f-1', name: 'S46-01.mov' }) });
  const { d, enviar } = montar({ meta: { id: 'f-1', name: 'S46-01.mov', size: String(total), parents: [PASTA], trashed: false } });
  const res = await enviar('S46-01', a).promessa;
  assert.equal(res.ok, true);
  assert.equal(pedidosFetch.filter((p) => p.metodo === 'POST').length, 0, 'não abre sessão nova');
  assert.equal(puts[0].url, 'https://upload.falso/sessao/antiga');
  assert.equal(puts[0].contentRange, `bytes */${total}`);
  assert.equal(puts[1].contentRange, `bytes ${PEDACO}-${total - 1}/${total}`, 'continua do byte em que parou');
  assert.equal(puts[1].tamanho, 1000);
  assert.ok(d.progresso.some((p) => p.enviados === PEDACO));
});

test('erro de rede/recusa no envio: mensagem clara e recuperação ("continua de onde parou")', async () => {
  responderPut = () => ({ status: 403 });
  const { d, enviar } = montar({ meta: null });
  await assert.rejects(enviar('S46-01', arquivoFalso('a.mov', 10)).promessa, (e) => {
    assert.equal(e.codigo, 'envio');
    assert.match(e.message, /O envio parou\. O Google recusou o envio \(403\)\./);
    assert.match(e.recuperacao, /continua de onde parou/);
    return true;
  });
  assert.equal(d.metas, 0);
  assert.ok(!d.estados.includes('concluido'));
});

test('cancelar antes de o upload começar: nada é enviado', async () => {
  const { d, enviar } = montar();
  const ctl = enviar('S46-01', arquivoFalso('a.mov', 10));
  ctl.cancelar();
  await assert.rejects(ctl.promessa, (e) => e.codigo === 'cancelado');
  assert.equal(d.uploads, 0);
  assert.equal(d.estados.at(-1), 'cancelado');
});

test('textoProgresso: bytes enviados/total, velocidade e tempo restante', () => {
  const fmt = (n) => `${n}B`;
  assert.deepEqual(textoProgresso({ enviados: 250, total: 1000, velocidade: 50, restante: 15 }, fmt), { pct: 25, feito: '250B de 1000B', velocidade: '50B/s', restante: '15 s' });
  assert.equal(textoProgresso({ enviados: 0, total: 1000, velocidade: 0, restante: null }, fmt).restante, 'calculando…');
  assert.equal(textoProgresso({ enviados: 1000, total: 1000 }, fmt).pct, 100);
  assert.equal(textoProgresso({ enviados: 10, total: 4000, restante: 3700 }, fmt).restante, '1 h 1 min');
  assert.equal(textoProgresso({}, fmt).pct, 0);
});

/* ---------------------------------------------------------------- tela */

test('tela: nome final visível, escape do nome do arquivo, botão de verdade, conta que não decide', async () => {
  const { blocoEnvioDireto } = await import('../js/telas/enviar.js');
  const { estado } = await import('../js/estado.js');
  const { ALLOWED } = await import('../js/config.js');
  const MAL = '<img src=x onerror=alert(1)>.MOV';
  estado.arquivo = { nome: MAL, total: 2048, file: arquivoFalso(MAL, 2048) };
  const h = blocoEnvioDireto('S46-01', { email: ALLOWED[0] });
  assert.ok(!h.includes('<img'), 'nome do arquivo escapado');
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;\.MOV/);
  assert.match(h, /como <strong class="envio-nome">S46-01\.mov<\/strong>/);
  assert.match(h, /<button type="button" class="botao primario cheio" data-acao="envio-enviar" data-id="S46-01">/);
  assert.match(h, /Mantenha o app aberto até terminar/);
  estado.arquivo = { nome: 'clip.avi', total: 10, file: arquivoFalso('clip.avi', 10) };
  const ruim = blocoEnvioDireto('S46-01', { email: ALLOWED[0] });
  assert.match(ruim, /só aceita vídeo \.mp4, \.mov ou \.m4v/);
  assert.doesNotMatch(ruim, /envio-enviar/);
  estado.arquivo = null;
  const sem = blocoEnvioDireto('S46-01', { email: ALLOWED[0] });
  assert.match(sem, /<button type="button" class="botao primario" data-acao="envio-escolher">/);
  const gabriel = blocoEnvioDireto('S46-01', { email: ALLOWED[1] });
  assert.match(gabriel, /Só a conta da Robertta envia o vídeo pelo app/);
  assert.doesNotMatch(gabriel, /envio-escolher|envio-enviar/);
});

describe('envio do vídeo pelo app (ponto 7)', () => {
  beforeEach(prepararCaso);
  afterEach(restaurar);
  for (const [nome, fn] of casos) testeSolto(nome, fn);
});
