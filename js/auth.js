// Login com Google Identity Services (token model: popup, sem redirect, sem client secret).
// Sessão {access_token, expires_at, email} em localStorage: fechar e reabrir o app (também o app
// instalado no iPhone) não pede login de novo enquanto o token vale. Token vencido ao abrir: a
// entrada mostra "Continuar como …" (um toque, login_hint) e "Usar outra conta" (estadoDeAbertura).
// A sessão antiga em sessionStorage (até a v7) passa sozinha para o localStorage na primeira leitura.
// Ao sair, tudo isso é apagado (sair, limparArmazenamento) e o próximo login abre a escolha de conta.

import { CLIENT_ID, SCOPES, ALLOWED, GIS_URL, nomeDe } from './config.js';

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

/** Confere o JSON guardado: devolve a sessão {access_token, expires_at, email} ou null. Nunca lança. */
function sessaoDoTexto(bruto) {
  try {
    const s = JSON.parse(bruto || 'null');
    return s && typeof s === 'object' && s.access_token && s.email ? s : null;
  } catch {
    return null;
  }
}

/**
 * Lê a sessão guardada em `local` (localStorage). Sem nada lá e com a sessão antiga em `sessao`
 * (sessionStorage, até a v7): lê essa uma vez, grava no localStorage e apaga do sessionStorage. Se
 * o localStorage não aceitar (modo privado), a sessão fica no sessionStorage e continua valendo
 * nesta aba. Storages ausentes ou que lançam (SecurityError) valem como vazios. Nunca lança.
 */
export function lerSessaoDe(local, sessao = null) {
  let bruto = null;
  try { bruto = local ? local.getItem(CHAVE_SESSAO) : null; } catch { bruto = null; }
  if (bruto === null && sessao) {
    try { bruto = sessao.getItem(CHAVE_SESSAO); } catch { bruto = null; }
    if (bruto !== null) {
      let movida = false;
      try { if (local) { local.setItem(CHAVE_SESSAO, bruto); movida = true; } } catch { /* fica no sessionStorage */ }
      if (movida) { try { sessao.removeItem(CHAVE_SESSAO); } catch { /* a cópia antiga some no próximo sair */ } }
    }
  }
  return sessaoDoTexto(bruto);
}

/** Sessão guardada (com o token válido ou vencido) ou null. */
export function lerSessao() {
  return lerSessaoDe(armazenamento('localStorage'), armazenamento('sessionStorage'));
}

function gravarSessao(s) {
  const texto = JSON.stringify(s);
  let gravou = false;
  try {
    const local = armazenamento('localStorage');
    if (local) { local.setItem(CHAVE_SESSAO, texto); gravou = true; }
  } catch { /* modo privado: fica no sessionStorage, abaixo */ }
  const sessao = armazenamento('sessionStorage');
  if (gravou) { try { sessao?.removeItem(CHAVE_SESSAO); } catch { /* sem armazenamento */ } }
  else { try { sessao?.setItem(CHAVE_SESSAO, texto); } catch { /* sem armazenamento nenhum */ } }
  try { localStorage.setItem(CHAVE_EMAIL, s.email); } catch { /* modo privado */ }
  agendarRenovacao(s);
}

/** Apaga a sessão dos dois armazenamentos, na hora (síncrono), e cancela o timer de renovação. */
function limparSessao() {
  try { armazenamento('localStorage')?.removeItem(CHAVE_SESSAO); } catch { /* sem armazenamento */ }
  try { armazenamento('sessionStorage')?.removeItem(CHAVE_SESSAO); } catch { /* sem armazenamento */ }
  clearTimeout(timerRenovacao);
  timerRenovacao = null;
}

/** O token da sessão ainda vale além da margem de renovação (abrir o app direto, sem login)? */
function tokenUtil(s, agora = Date.now()) {
  return !!s && Number(s.expires_at) > agora + MARGEM_RENOVACAO;
}

/**
 * O que a abertura do app mostra, pela sessão guardada (os storages e a hora podem vir de fora):
 *  - 'entrar': token válido (além da margem de renovação) → entra direto no app;
 *  - 'continuar': sessão guardada com o token vencido ou quase → "Continuar como …";
 *  - 'normal': sem sessão (nunca entrou, ou saiu) → "Entrar com Google".
 * Devolve { estado, email }. Lê com a migração do sessionStorage. Nunca lança.
 */
export function estadoDeAbertura({ storage = armazenamento('localStorage'), sessao = armazenamento('sessionStorage'), agora = Date.now() } = {}) {
  const s = lerSessaoDe(storage, sessao);
  if (!s) return { estado: 'normal', email: '' };
  return { estado: tokenUtil(s, agora) ? 'entrar' : 'continuar', email: String(s.email) };
}

/** Como chamar a conta no "Continuar como …": o primeiro nome (NOMES, config.js) ou o que vem antes do @. Texto puro. */
export function nomeParaContinuar(email) {
  const e = String(email ?? '').trim();
  const nome = (nomeDe(e) || e.split('@')[0] || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return nome.length > 32 ? `${nome.slice(0, 31)}…` : nome;
}

/** Rótulo do botão principal da entrada com a sessão vencida. Texto puro: vai na tela por textContent (ou esc). */
export function rotuloContinuar(email) {
  const nome = nomeParaContinuar(email);
  return nome ? `Continuar como ${nome}` : 'Continuar';
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

/*
 * O "Sair" NUNCA revoga nada no Google (nem oauth2.revoke do GIS nem oauth2.googleapis.com/revoke).
 * O app e o rclone do Motor (motordrive) usam clientes do mesmo projeto do Google: revogar o token
 * do app derrubava também a autorização do Drive do Motor (invalid_grant). Sair apaga só a sessão
 * local; o token esquecido vence sozinho em até 1 hora.
 */

/**
 * Desliga só a seleção automática de conta do Google (o próximo login abre a escolha de conta).
 * Não revoga o token. GIS ausente ou que lança não impede nada.
 */
export function desligarGoogle(google) {
  try {
    const id = google?.accounts?.id;
    if (typeof id?.disableAutoSelect === 'function') id.disableAutoSelect();
  } catch { /* sem GIS: sai do mesmo jeito */ }
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

/** Token válido agora (ou null, também com a sessão guardada vencida). */
export function getToken() {
  const s = lerSessao();
  return s && s.expires_at > Date.now() + 10_000 ? s.access_token : null;
}

/**
 * Há sessão guardada (mesmo com o token vencido: com o app aberto, a renovação cuida dele)?
 * Para ABRIR o app valem estadoDeAbertura() e retomarSessao(), que exigem o token válido.
 */
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

/** Transforma a resposta do GIS numa sessão, conferindo e-mail e escopos. */
async function aceitarToken(resp, emailEsperado, ger = geracao) {
  if (ger !== geracao) throw erroSaiu();
  const oauth2 = window.google.accounts.oauth2;
  if (!oauth2.hasGrantedAllScopes(resp,
    'https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets')) {
    throw new ErroAuth('Para usar o Motor é preciso marcar as permissões do Google Drive e das Planilhas. Entre de novo e aceite todas.', 'escopos');
  }
  const email = await buscarEmail(resp.access_token);
  if (ger !== geracao) throw erroSaiu(); // saiu enquanto confirmava a conta
  if (!ALLOWED.includes(email)) {
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

/**
 * Login interativo (botão "Entrar com Google"). `outraConta` ("Usar outra conta", na entrada com a
 * sessão vencida): sempre a escolha de conta, como no primeiro login depois de sair.
 */
export async function entrar({ outraConta = false } = {}) {
  const ger = geracao;
  const opcoes = outraConta ? { prompt: 'select_account' } : opcoesDeEntrada(emailLembrado(), depoisDeSair);
  const resp = await pedirToken(opcoes, ger);
  const sessao = await aceitarToken(resp, '', ger);
  depoisDeSair = false;
  return sessao;
}

/**
 * "Continuar como …" (entrada com a sessão guardada vencida): chamado do toque dela (o popup pode
 * abrir), com login_hint na conta da sessão. Aceita só as contas de ALLOWED (aceitarToken) e grava a
 * sessão nova. Se falhar (janela fechada, erro), rejeita com ErroAuth e a sessão vencida continua
 * guardada: o botão segue valendo.
 */
export async function continuar(email = lerSessao()?.email || emailLembrado()) {
  const ger = geracao;
  const resp = await pedirToken(opcoesDeEntrada(email, false), ger);
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

/**
 * Ao abrir o app: com o token guardado ainda válido (além da margem de renovação), reagenda a
 * renovação e devolve a sessão. Vencido ou quase (estado 'continuar') ou sem sessão: null, sem
 * agendar nada (a entrada mostra "Continuar como …" ou "Entrar com Google").
 */
export function retomarSessao() {
  const s = lerSessao();
  if (!tokenUtil(s)) return null;
  agendarRenovacao(s);
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
 * Primeira metade do "Sair", síncrona e sem o Google: cancela o timer e qualquer renovação ou
 * pedido de token pendente (rejeitados com o código 'saiu', sem o aviso "sessão expirou") e apaga,
 * na hora, a sessão (motor.sessao, do localStorage e do sessionStorage) e as outras chaves de conta
 * (motor.email) e dados dos dois armazenamentos (ficam o tema e as sessões de envio retomável). O próximo login abre a escolha de conta. Devolve o token que estava em uso
 * (não é revogado: o Sair nunca revoga no Google) ou null. Nunca lança.
 */
export function encerrarSessao() {
  geracao++;
  depoisDeSair = true;
  let token = null;
  try { token = lerSessao()?.access_token || null; } catch { /* sem armazenamento */ }
  limparSessao();
  if (pedidoAtual) {
    const p = pedidoAtual;
    pedidoAtual = null;
    try { p.reject(erroSaiu()); } catch { /* ignorar */ }
  }
  if (renovacao || renovacaoCtl) { try { falharRenovacao(erroSaiu()); } catch { /* ignorar */ } }
  limparArmazenamento(armazenamento('sessionStorage'));
  limparArmazenamento(armazenamento('localStorage'));
  return token;
}

/** Segunda metade do "Sair": só desliga a seleção automática (NUNCA revoga o token). Nunca lança. */
export function desligarGoogleDaJanela() {
  try { desligarGoogle(googleDaJanela()); } catch { /* sai do mesmo jeito */ }
}

/** "Sair" completo: encerrarSessao() e, depois, desligarGoogleDaJanela(). Nunca lança. */
export function sair() {
  desligarGoogleDaJanela(encerrarSessao());
}
