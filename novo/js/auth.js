// Login com Google Identity Services (token model: popup, sem redirect, sem client secret).
// Sessão {access_token, expires_at, email} em sessionStorage; só o e-mail em localStorage (login_hint).

import { CLIENT_ID, SCOPES, ALLOWED, GIS_URL } from './config.js';

const CHAVE_SESSAO = 'motor.sessao';
const CHAVE_EMAIL = 'motor.email';
const MARGEM_RENOVACAO = 2 * 60 * 1000; // renovar 2 min antes de expirar

let gisPromise = null;
let tokenClient = null;
let pedidoAtual = null; // {resolve, reject} do requestAccessToken em andamento
let renovacao = null; // promessa compartilhada da renovação em andamento
let renovacaoCtl = null; // {resolve, reject} dessa promessa
let timerRenovacao = null;

export class ErroAuth extends Error {
  constructor(mensagem, codigo = 'erro') {
    super(mensagem);
    this.codigo = codigo;
  }
}

/* ----------------------------------------------------------- sessão */

export function lerSessao() {
  try {
    const s = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || 'null');
    return s && s.access_token && s.email ? s : null;
  } catch {
    return null;
  }
}

function gravarSessao(s) {
  sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(s));
  try { localStorage.setItem(CHAVE_EMAIL, s.email); } catch { /* modo privado */ }
  agendarRenovacao(s);
}

function limparSessao() {
  sessionStorage.removeItem(CHAVE_SESSAO);
  clearTimeout(timerRenovacao);
}

export function emailLembrado() {
  try { return localStorage.getItem(CHAVE_EMAIL) || ''; } catch { return ''; }
}

export function emailAtual() {
  return lerSessao()?.email || '';
}

/** Token válido agora (ou null). */
export function getToken() {
  const s = lerSessao();
  return s && s.expires_at > Date.now() + 10_000 ? s.access_token : null;
}

export function estaLogado() {
  return !!lerSessao();
}

function emitir(nome, detalhe) {
  window.dispatchEvent(new CustomEvent(nome, { detail: detalhe }));
}

/* --------------------------------------------------------------- GIS */

/** Carrega o script do GIS uma vez. Rejeita com ErroAuth se falhar ou demorar demais. */
export function carregarGis(timeoutMs = 20000) {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_URL;
    s.async = true;
    s.defer = true;
    const t = setTimeout(() => {
      gisPromise = null;
      reject(new ErroAuth('O serviço de login do Google está demorando para responder. Verifique a internet e tente de novo.', 'gis_timeout'));
    }, timeoutMs);
    s.onload = () => {
      clearTimeout(t);
      if (window.google?.accounts?.oauth2) resolve();
      else { gisPromise = null; reject(new ErroAuth('Não foi possível carregar o login do Google.', 'gis_falhou')); }
    };
    s.onerror = () => {
      clearTimeout(t);
      gisPromise = null;
      s.remove();
      reject(new ErroAuth('Não foi possível carregar o login do Google. Verifique a internet e tente de novo.', 'gis_falhou'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

function mensagemErroGis(tipo) {
  switch (tipo) {
    case 'popup_closed':
      return 'A janela de login foi fechada antes de terminar. Tente de novo.';
    case 'popup_failed_to_open':
      return 'O navegador bloqueou a janela de login. Permita pop-ups para este site e tente de novo.';
    case 'access_denied':
      return 'O acesso não foi autorizado. Para usar o Motor, é preciso permitir o acesso ao Drive e às Planilhas.';
    case 'interaction_required':
    case 'login_required':
    case 'consent_required':
      return 'É preciso entrar de novo com a sua conta Google.';
    default:
      return 'Não foi possível entrar com o Google agora. Tente de novo em instantes.';
  }
}

function garantirTokenClient() {
  if (tokenClient) return tokenClient;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (resp) => {
      const p = pedidoAtual;
      pedidoAtual = null;
      if (!p) return;
      if (resp?.error) p.reject(new ErroAuth(mensagemErroGis(resp.error), resp.error));
      else p.resolve(resp);
    },
    error_callback: (err) => {
      const p = pedidoAtual;
      pedidoAtual = null;
      if (p) p.reject(new ErroAuth(mensagemErroGis(err?.type), err?.type || 'erro'));
    },
  });
  return tokenClient;
}

/** Pede um token ao GIS (abre popup se preciso) e devolve a resposta. */
async function pedirToken(opcoes) {
  await carregarGis();
  const client = garantirTokenClient();
  if (pedidoAtual) pedidoAtual.reject(new ErroAuth('Pedido de login substituído.', 'substituido'));
  return new Promise((resolve, reject) => {
    pedidoAtual = { resolve, reject };
    try {
      client.requestAccessToken(opcoes);
    } catch (e) {
      pedidoAtual = null;
      reject(new ErroAuth(mensagemErroGis('erro'), 'erro'));
    }
  });
}

async function buscarEmail(accessToken) {
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new ErroAuth('Não foi possível confirmar a sua conta Google. Tente de novo.', 'userinfo');
  const info = await r.json();
  return String(info.email || '').toLowerCase();
}

function revogar(token) {
  try {
    if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token, () => {});
  } catch { /* ignorar */ }
}

/** Transforma a resposta do GIS numa sessão, conferindo e-mail e escopos. */
async function aceitarToken(resp, emailEsperado) {
  const oauth2 = window.google.accounts.oauth2;
  if (!oauth2.hasGrantedAllScopes(resp,
    'https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets')) {
    revogar(resp.access_token);
    throw new ErroAuth('Para usar o Motor é preciso marcar as permissões do Google Drive e das Planilhas. Entre de novo e aceite todas.', 'escopos');
  }
  const email = await buscarEmail(resp.access_token);
  if (!ALLOWED.includes(email)) {
    revogar(resp.access_token);
    limparSessao();
    throw new ErroAuth(`Esta conta (${email}) não tem acesso ao Motor de Conteúdo. Entre com a conta da Robertta ou do Gabriel.`, 'nao_permitido');
  }
  if (emailEsperado && email !== emailEsperado) {
    // Renovação devolveu outra conta: trata como sessão nova.
    emitir('motor:conta-trocada', { email });
  }
  const sessao = {
    access_token: resp.access_token,
    expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
    email,
  };
  gravarSessao(sessao);
  return sessao;
}

/** Login interativo (botão "Entrar com Google"). */
export async function entrar() {
  const hint = emailLembrado();
  const resp = await pedirToken(hint ? { prompt: '', login_hint: hint } : { prompt: 'select_account' });
  return aceitarToken(resp);
}

/* ------------------------------------------------------- renovação */

function agendarRenovacao(s) {
  clearTimeout(timerRenovacao);
  const espera = Math.max(0, s.expires_at - Date.now() - MARGEM_RENOVACAO);
  timerRenovacao = setTimeout(() => { renovar().catch(() => {}); }, espera);
}

/** Retoma o agendamento após recarregar a página com sessão ainda guardada. */
export function retomarSessao() {
  const s = lerSessao();
  if (s) agendarRenovacao(s);
  return s;
}

async function tentarRenovar() {
  const email = emailAtual() || emailLembrado();
  const resp = await pedirToken({ prompt: '', login_hint: email });
  return aceitarToken(resp, email);
}

/**
 * Renova o token silenciosamente. Todas as chamadas simultâneas compartilham a mesma promessa.
 * Se a tentativa silenciosa falhar, emite 'motor:sessao-expirada' (o app mostra a faixa) e a
 * promessa continua pendente até `renovarInterativo()` dar certo ou `sair()` ser chamado.
 */
export function renovar() {
  if (renovacao) return renovacao;
  renovacao = new Promise((resolve, reject) => { renovacaoCtl = { resolve, reject }; });
  tentarRenovar().then(
    (s) => finalizarRenovacao(s),
    (e) => {
      if (e?.codigo === 'nao_permitido') { falharRenovacao(e); return; }
      emitir('motor:sessao-expirada');
    },
  );
  return renovacao;
}

function finalizarRenovacao(s) {
  const ctl = renovacaoCtl;
  renovacao = null;
  renovacaoCtl = null;
  emitir('motor:sessao-renovada', s);
  ctl?.resolve(s.access_token);
}

function falharRenovacao(e) {
  const ctl = renovacaoCtl;
  renovacao = null;
  renovacaoCtl = null;
  ctl?.reject(e);
}

/** Chamado pelo toque na faixa "Sua sessão expirou" (gesto do usuário → popup permitido). */
export async function renovarInterativo() {
  if (!renovacao) renovacao = new Promise((resolve, reject) => { renovacaoCtl = { resolve, reject }; });
  try {
    const s = await tentarRenovar();
    finalizarRenovacao(s);
    return s;
  } catch (e) {
    if (e?.codigo === 'nao_permitido') falharRenovacao(e);
    throw e;
  }
}

/** Botão "Sair": revoga, limpa a sessão e rejeita pendências. */
export function sair() {
  const s = lerSessao();
  if (s) revogar(s.access_token);
  limparSessao();
  if (renovacaoCtl) falharRenovacao(new ErroAuth('Você saiu da conta.', 'saiu'));
}
