// CENTRAL (Supabase, desde 15/11/2026): o caminho rápido dos pedidos do app até o motor.
// O app grava o pedido na tabela `pedidos`; o bin/central.py do motor recebe em segundos, grava o MESMO
// arquivo de sempre no Drive e acorda o vigia. O Drive continua sendo a reserva: sem sessão na central,
// sem o motor ouvindo (sinal de vida com mais de 3 min) ou com qualquer erro, o app grava o arquivo no
// Drive como antes. Só o integra.js importa este módulo (é ele que fala com o mundo externo).
//
// Login automático: o app manda o token do Google que já tem (login do app) para a função
// entrar-com-google da central, que confere no Google se o token é do app e se a conta tem acesso, e
// devolve a sessão. Ninguém toca em nada. A sessão fica no localStorage como `motor.central.sessao` (o
// "Sair" apaga, como as outras chaves motor.*). As regras de quem pode o quê ficam no banco (RLS): só a
// conta da Robertta decide; a do Gabriel só pede busca.

export const CHAVE_SESSAO = 'motor.central.sessao';
export const MOTOR_OUVINDO_MS = 3 * 60 * 1000; // o motor grava o sinal de vida a cada ~60 s
const FOLGA_TOKEN_MS = 2 * 60 * 1000;

/** Os mesmos formatos da regra arquivo_do_tipo no banco e do bin/central.py. */
export const FORMATOS = {
  busca: /^1-Radar\/pedido-busca\.md$/,
  decisoes_semana: /^1-Radar\/decisoes [A-Za-z0-9-]+\.md$/,
  decisao_roteiro: /^2-Roteiros\/rascunhos\/[A-Za-z0-9-]+ decisao v[0-9]+\.md$/,
  decisao_previa: /^4-Revisao\/[A-Za-z0-9-]+ (aprovado|ajustes v[0-9]+)\.md$/,
};
const PASTAS = { busca: '1-Radar', decisoes_semana: '1-Radar', decisao_roteiro: '2-Roteiros/rascunhos', decisao_previa: '4-Revisao' };

export class ErroCentral extends Error {
  constructor(mensagem, codigo = 'erro', status = 0) { super(mensagem); this.codigo = codigo; this.status = status; }
}

/** Caminho no Drive do arquivo de um pedido (tipo + nome do arquivo). Lança se sair dos formatos. */
export function arquivoDoPedido(tipo, nome) {
  if (!PASTAS[tipo]) throw new ErroCentral(`Tipo de pedido desconhecido: ${tipo}`, 'tipo');
  const arquivo = `${PASTAS[tipo]}/${String(nome || '').trim()}`;
  if (!FORMATOS[tipo].test(arquivo)) throw new ErroCentral(`Nome fora do formato combinado: ${nome}`, 'formato');
  return arquivo;
}

/** O motor está ouvindo a central? (linha de motor_estado com sinal de vida recente) */
export function motorOuvindo(estado, agora = Date.now()) {
  const t = Date.parse(estado?.atualizado_em || '');
  return Number.isFinite(t) && agora - t < MOTOR_OUVINDO_MS && agora - t > -MOTOR_OUVINDO_MS;
}

/** Sessão guardada válida para este e-mail? (o token se renova sozinho; aqui basta haver refresh_token) */
export function sessaoDe(storage, email = '') {
  let s = null;
  try { s = JSON.parse(storage?.getItem(CHAVE_SESSAO) || 'null'); } catch { s = null; }
  if (!s || typeof s !== 'object' || !s.refresh_token || !s.access_token) return null;
  if (email && String(s.email || '').toLowerCase() !== String(email).toLowerCase()) return null;
  return s;
}

/**
 * Cliente da central. Tudo injetável para os testes: fetch, storage e relógio.
 * → {sessao, entrarComGoogle, esquecer, estadoMotor, enviarPedido, pedido}
 */
export function criarCentral({ url, chave, fetch: f = globalThis.fetch, storage = null, agora = () => Date.now() } = {}) {
  const base = String(url || '').replace(/\/+$/, '');

  function guardar(s, email) {
    const sessao = {
      access_token: s.access_token, refresh_token: s.refresh_token, email: String(email || s.user?.email || '').toLowerCase(),
      expira: agora() + Number(s.expires_in || 3600) * 1000,
    };
    try { storage?.setItem(CHAVE_SESSAO, JSON.stringify(sessao)); } catch { /* sem storage: vale só nesta página */ }
    memoria = sessao;
    return sessao;
  }
  let memoria = null;
  const atual = () => memoria || sessaoDe(storage);

  async function http(metodo, caminho, corpo, { token = null, prefer = '' } = {}) {
    const cab = { apikey: chave, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (token) cab.Authorization = `Bearer ${token}`;
    if (prefer) cab.Prefer = prefer;
    let r;
    try {
      r = await f(base + caminho, { method: metodo, headers: cab, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    } catch (e) {
      throw new ErroCentral('Sem conexão com a central.', 'rede');
    }
    const txt = await r.text();
    let dados = null;
    try { dados = txt ? JSON.parse(txt) : null; } catch { dados = null; }
    if (!r.ok) throw new ErroCentral(dados?.erro || dados?.message || dados?.msg || dados?.error_description || `HTTP ${r.status}`, 'http', r.status);
    return dados;
  }

  async function token() {
    const s = atual();
    if (!s) throw new ErroCentral('Sem sessão na central.', 'sem-sessao');
    if (s.expira - agora() > FOLGA_TOKEN_MS) return s.access_token;
    try {
      const novo = await http('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token });
      return guardar(novo, s.email).access_token;
    } catch (e) {
      if (e.status === 400 || e.status === 401) esquecer();
      throw e;
    }
  }

  async function rest(metodo, caminho, corpo, prefer = '') {
    return http(metodo, `/rest/v1/${caminho}`, corpo, { token: await token(), prefer });
  }

  function esquecer() {
    memoria = null;
    try { storage?.removeItem(CHAVE_SESSAO); } catch { /* nada */ }
  }

  return {
    sessao: atual,
    esquecer,
    /** Token de acesso do Google (o do login do app) → sessão, pela função entrar-com-google. → {email} */
    async entrarComGoogle(tokenGoogle) {
      if (!tokenGoogle) throw new ErroCentral('Sem o login do Google no app.', 'sem-google');
      const s = await http('POST', '/functions/v1/entrar-com-google', { access_token: tokenGoogle });
      return { email: guardar(s).email };
    },
    /** Linha de motor_estado → {atualizado_em, dados} ou null. */
    async estadoMotor() {
      const l = await rest('GET', 'motor_estado?id=eq.1&select=atualizado_em,dados');
      return Array.isArray(l) && l[0] ? l[0] : null;
    },
    /** Grava um pedido (status novo). → {id} */
    async enviarPedido({ tipo, conteudo_id = null, arquivo, conteudo }) {
      if (!FORMATOS[tipo]?.test(arquivo || '')) throw new ErroCentral(`Caminho fora do formato: ${arquivo}`, 'formato');
      if (!String(conteudo || '').trim()) throw new ErroCentral('Pedido sem conteúdo.', 'vazio');
      const s = atual();
      const l = await rest('POST', 'pedidos?select=id', { tipo, conteudo_id, arquivo, conteudo, quem: s?.email || '' }, 'return=representation');
      if (!Array.isArray(l) || !l[0]?.id) throw new ErroCentral('A central não confirmou o pedido.', 'sem-id');
      return { id: l[0].id };
    },
    /** Situação de um pedido → {status, motivo, entregue_em} ou null. */
    async pedido(id) {
      const l = await rest('GET', `pedidos?id=eq.${encodeURIComponent(id)}&select=status,motivo,entregue_em`);
      return Array.isArray(l) && l[0] ? l[0] : null;
    },
  };
}
