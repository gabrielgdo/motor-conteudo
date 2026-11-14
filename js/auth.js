// Login com Google Identity Services (token model: popup, sem redirect, sem client secret).
// Sessão {access_token, expires_at, email} em sessionStorage; só o e-mail em localStorage (login_hint).
// Ao sair, tudo isso é apagado (sair, limparArmazenamento) e o próximo login abre a escolha de conta.

import { CLIENT_ID, SCOPES, ALLOWED, GIS_URL } from './config.js';

const CHAVE_SESSAO = 'motor.sessao';
const CHAVE_EMAIL = 'motor.email';
const MARGEM_RENOVACAO = 2 * 60 * 1000; // renovar 2 min antes de expirar

/** Preferência de tema (js/visual.js e o script do index.html): fica ao sair da conta. */
export const CHAVE_TEMA = 'motor-tema';
/** Prefixo das sessões de envio retomável (js/upload.js): ficam ao sair, para o envio poder continuar. */
export const PREFIXO_UPLOAD = 'motor.upload.';

let gisPromise = null;
let tokenClient = null;
let pedidoAtual = null; // {resolve, reject} do requestAccessToken em andamento
let renovacao = null; // promessa compartilhada da renovação em andamento
let renovacaoCtl = null; // {resolve, reject} dessa promessa
let timerRenovacao = null;
let geracao = 0; // sobe a cada "Sair": respostas de pedidos anteriores são descartadas
let depoisDeSair = false; // o próximo "Entrar com Google" abre a escolha de conta

export class ErroAuth extends Error {
  constructor(mensagem, codigo = 'erro') {
    super(mensagem);
    this.codigo = codigo;
  }
}

/** Rejeição de tudo o que estava pendente quando ela saiu (não vira aviso nem mensagem). */
const erroSaiu = () => new ErroAuth('Você saiu da conta.', 'saiu');

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
  try { sessionStorage.removeItem(CHAVE_SESSAO); } catch { /* sem armazenamento */ }
  clearTimeout(timerRenovacao);
  timerRenovacao = null;
}

/* ------------------------------------------------- limpeza ao sair (puro) */

/** Chave do app (motor.*, motor-*, motor_*) que deve sumir ao sair: tudo menos o tema e os envios retomáveis. */
export function chaveParaApagar(chave) {
  const k = String(chave ?? '');
  return /^motor[.\-_]/.test(k) && k !== CHAVE_TEMA && !k.startsWith(PREFIXO_UPLOAD);
}

/**
 * Apaga de um Storage (sessionStorage, localStorage ou um falso, nos testes) as chaves do app
 * ligadas a sessão, conta e dados. Devolve as chaves apagadas. Nunca lança.
 */
export function limparArmazenamento(storage) {
  if (!storage) return [];
  const chaves = [];
  try {
    for (let i = 0; i < storage.length; i++) chaves.push(storage.key(i));
  } catch { return []; }
  const apagar = chaves.filter(chaveParaApagar);
  for (const k of apagar) { try { storage.removeItem(k); } catch { /* segue com as outras */ } }
  return apagar;
}

/**
 * Desliga a conta no Google sem esperar resposta: revoga o token (se o GIS estiver carregado) e
 * desliga a seleção automática. GIS ausente, que lança ou sem rede não impede a saída.
 */
export function desligarGoogle(google, token) {
  try {
    const oauth2 = google?.accounts?.oauth2;
    if (token && typeof oauth2?.revoke === 'function') oauth2.revoke(token, () => {});
  } catch { /* sem GIS ou sem rede: sai do mesmo jeito */ }
  try {
    const id = google?.accounts?.id;
    if (typeof id?.disableAutoSelect === 'function') id.disableAutoSelect();
  } catch { /* idem */ }
}

/** Opções do requestAccessToken no "Entrar com Google": depois de sair (ou sem e-mail lembrado), escolha de conta. */
export function opcoesDeEntrada(hint, aposSair = false) {
  return hint && !aposSair ? { prompt: '', login_hint: hint } : { prompt: 'select_account' };
}

function armazenamento(nome) {
  try { return globalThis[nome] || null; } catch { return null; } // o acesso pode lançar (SecurityError)
}

function googleDaJanela() {
  try { return typeof window !== 'undefined' ? window.google : undefined; } catch { return undefined; }
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
async function pedirToken(opcoes, ger = geracao) {
  await carregarGis();
  if (ger !== geracao) throw erroSaiu(); // saiu enquanto o script do Google carregava
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
async function aceitarToken(resp, emailEsperado, ger = geracao) {
  if (ger !== geracao) throw erroSaiu();
  const oauth2 = window.google.accounts.oauth2;
  if (!oauth2.hasGrantedAllScopes(resp,
    'https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets')) {
    revogar(resp.access_token);
    throw new ErroAuth('Para usar o Motor é preciso marcar as permissões do Google Drive e das Planilhas. Entre de novo e aceite todas.', 'escopos');
  }
  const email = await buscarEmail(resp.access_token);
  if (ger !== geracao) { revogar(resp.access_token); throw erroSaiu(); } // saiu enquanto confirmava a conta
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
  const ger = geracao;
  const resp = await pedirToken(opcoesDeEntrada(emailLembrado(), depoisDeSair), ger);
  const sessao = await aceitarToken(resp, '', ger);
  depoisDeSair = false;
  return sessao;
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

async function tentarRenovar(ger = geracao) {
  const email = emailAtual() || emailLembrado();
  if (!email) throw erroSaiu();
  const resp = await pedirToken({ prompt: '', login_hint: email }, ger);
  return aceitarToken(resp, email, ger);
}

/**
 * Renova o token silenciosamente. Todas as chamadas simultâneas compartilham a mesma promessa.
 * Se a tentativa silenciosa falhar, emite 'motor:sessao-expirada' (o app mostra a faixa) e a
 * promessa continua pendente até `renovarInterativo()` dar certo ou `sair()` ser chamado.
 * Sem sessão (depois de sair), rejeita na hora com o código 'saiu': nada renova sozinho.
 */
export function renovar() {
  if (renovacao) return renovacao;
  if (!lerSessao()) return Promise.reject(erroSaiu());
  const ger = geracao;
  novaRenovacao();
  tentarRenovar(ger).then(
    (s) => { if (ger === geracao) finalizarRenovacao(s); },
    (e) => {
      if (ger !== geracao || e?.codigo === 'saiu') return; // saiu no meio: sair() já rejeitou
      if (e?.codigo === 'nao_permitido') { falharRenovacao(e); return; }
      emitir('motor:sessao-expirada');
    },
  );
  return renovacao;
}

function novaRenovacao() {
  renovacao = new Promise((resolve, reject) => { renovacaoCtl = { resolve, reject }; });
  renovacao.catch(() => {}); // quem espera recebe o erro; sem ninguém esperando, não vira erro solto
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
  if (!lerSessao()) throw erroSaiu();
  const ger = geracao;
  if (!renovacao) novaRenovacao();
  try {
    const s = await tentarRenovar(ger);
    if (ger !== geracao) throw erroSaiu();
    finalizarRenovacao(s);
    return s;
  } catch (e) {
    if (e?.codigo === 'nao_permitido' && ger === geracao) falharRenovacao(e);
    throw e;
  }
}

/**
 * "Sair": revoga o token e desliga a seleção automática no Google (sem esperar resposta), cancela
 * o timer e qualquer renovação ou pedido de token pendente (rejeitados com o código 'saiu', sem o
 * aviso "sessão expirou") e apaga do sessionStorage e do localStorage as chaves de sessão, conta e
 * dados (ficam o tema e as sessões de envio retomável). O próximo login abre a escolha de conta.
 * Nunca lança.
 */
export function sair() {
  geracao++;
  depoisDeSair = true;
  const s = lerSessao();
  desligarGoogle(googleDaJanela(), s?.access_token);
  limparSessao();
  if (pedidoAtual) {
    const p = pedidoAtual;
    pedidoAtual = null;
    try { p.reject(erroSaiu()); } catch { /* ignorar */ }
  }
  if (renovacao || renovacaoCtl) falharRenovacao(erroSaiu());
  limparArmazenamento(armazenamento('sessionStorage'));
  limparArmazenamento(armazenamento('localStorage'));
}
