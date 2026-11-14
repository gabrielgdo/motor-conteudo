// Cliente mínimo da Drive API v3 (fetch com Bearer). Em 401 renova o token e repete uma vez.

import { ROOT_FOLDER, REVISAO_FOLDER, PASTAS, CACHE_MS } from './config.js';
import { getToken, renovar } from './auth.js';
import { MIME_PASTA, ehPasta } from './model.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const CAMPOS = 'nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,size,webViewLink,parents)';

export class ErroDrive extends Error {
  constructor(mensagem, status = 0) {
    super(mensagem);
    this.status = status;
  }
}

function mensagemStatus(status) {
  if (status === 403) return 'O Google recusou o acesso a este arquivo ou pasta (403). Confira se a conta tem permissão.';
  if (status === 404) return 'Arquivo ou pasta não encontrado no Drive.';
  if (status === 429) return 'Muitas requisições ao Google agora. Espere um pouco e tente de novo.';
  if (status >= 500) return 'O Google Drive está instável agora. Tente de novo em instantes.';
  return `Erro ao falar com o Google Drive (${status}).`;
}

async function tokenAtual() {
  return getToken() || renovar();
}

/**
 * fetch autenticado. Em 401 renova o token e repete uma única vez.
 * Devolve a Response (ok) ou lança ErroDrive.
 */
export async function api(url, opcoes = {}) {
  let tentativa = 0;
  for (;;) {
    const token = await tokenAtual();
    const headers = { ...(opcoes.headers || {}), Authorization: `Bearer ${token}` };
    let r;
    try {
      r = await fetch(url, { ...opcoes, headers });
    } catch {
      throw new ErroDrive('Sem conexão com a internet (ou o Google não respondeu). Tente de novo.', 0);
    }
    if (r.status === 401 && tentativa === 0) {
      tentativa++;
      await renovar();
      continue;
    }
    if (!r.ok) throw new ErroDrive(mensagemStatus(r.status), r.status);
    return r;
  }
}

async function json(url, opcoes) {
  return (await api(url, opcoes)).json();
}

/* ---------------------------------------------------------- listagem */

/** Lista os filhos (não apagados) de uma pasta, paginando. */
export async function listar(pastaId) {
  const arquivos = [];
  let pageToken = '';
  do {
    const p = new URLSearchParams({
      q: `'${pastaId}' in parents and trashed=false`,
      fields: CAMPOS,
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) p.set('pageToken', pageToken);
    const r = await json(`${API}/files?${p}`);
    arquivos.push(...(r.files || []));
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return arquivos;
}

let pastasCache = null;
let geracao = 0; // sobe em esquecerTudo (saída da conta): uma leitura de pastas em andamento não volta a guardar nada
let pastasArquivos = {}; // chave (PASTAS) → arquivo da pasta (com webViewLink), depois de pastas()

/** A pasta (como veio da listagem) já resolvida por pastas(), ou null. Síncrono, para as telas. */
export function pastaConhecida(chave) {
  return pastasArquivos[chave] || null;
}

/** Ids das subpastas de "Motor de Conteúdo", resolvidas pelo nome (cache na sessão). */
export async function pastas() {
  if (pastasCache) return pastasCache;
  const ger = geracao;
  const filhos = (await listar(ROOT_FOLDER)).filter(ehPasta);
  if (ger !== geracao) throw new ErroDrive('Você saiu da conta.', 0);
  const porNome = new Map(filhos.map((f) => [f.name.trim(), f.id]));
  const arquivoPorNome = new Map(filhos.map((f) => [f.name.trim(), f]));
  pastasArquivos = Object.fromEntries(Object.entries(PASTAS).map(([chave, nome]) => [chave, arquivoPorNome.get(nome) || null]));
  const out = { revisao: REVISAO_FOLDER };
  for (const [chave, nome] of Object.entries(PASTAS)) out[chave] = porNome.get(nome) || null;
  for (const chave of ['roteiros', 'brutos', 'prontos']) {
    if (!out[chave]) throw new ErroDrive(`Não encontrei a pasta "${PASTAS[chave]}" dentro de "Motor de Conteúdo".`, 404);
  }
  pastasCache = out;
  return out;
}

let listagensCache = null; // {quando, promessa}

/** Todas as listagens que o modelo precisa, com cache de 60 s. */
export function carregarListagens(forcar = false) {
  if (!forcar && listagensCache && Date.now() - listagensCache.quando < CACHE_MS) return listagensCache.promessa;
  const promessa = buscarListagens();
  listagensCache = { quando: Date.now(), promessa };
  promessa.catch(() => { if (listagensCache?.promessa === promessa) listagensCache = null; });
  return promessa;
}

export function invalidarCache() {
  listagensCache = null;
}

/** Ao sair da conta: esquece também as pastas resolvidas e os textos baixados. */
export function esquecerTudo() {
  geracao++;
  listagensCache = null;
  pastasCache = null;
  pastasArquivos = {};
  textoCache.clear();
}

async function buscarListagens() {
  const ids = await pastas();
  const [roteirosRaiz, brutos, revisao, prontos] = await Promise.all([
    listar(ids.roteiros), listar(ids.brutos), listar(ids.revisao), listar(ids.prontos),
  ]);

  const pastasRascunho = roteirosRaiz.filter((f) => ehPasta(f) && f.name.trim().toLowerCase().startsWith('rascunhos'));
  const pastaVencedores = prontos.find((f) => ehPasta(f) && f.name.trim().toLowerCase() === 'vencedores');
  const pastasPacote = prontos.filter((f) => ehPasta(f) && f !== pastaVencedores);

  const [rascunhos, vencedores, pacotesArr] = await Promise.all([
    Promise.all(pastasRascunho.map((p) => listar(p.id))).then((a) => a.flat()),
    pastaVencedores ? listar(pastaVencedores.id) : Promise.resolve([]),
    Promise.all(pastasPacote.map((p) => listarPacote(p.id))),
  ]);
  const pacotes = {};
  pastasPacote.forEach((p, i) => { pacotes[p.id] = pacotesArr[i]; });

  return { roteiros: roteirosRaiz, rascunhos, brutos, revisao, prontos, pacotes, vencedores };
}

/** Arquivos de um pacote; as subpastas (carrossel/stories) entram com `sub` = nome da subpasta. */
async function listarPacote(pastaId) {
  const filhos = await listar(pastaId);
  const subs = filhos.filter(ehPasta);
  const netos = await Promise.all(subs.map((s) => listar(s.id).then((fs) =>
    fs.filter((f) => !ehPasta(f)).map((f) => ({ ...f, sub: s.name.trim().toLowerCase() })))));
  return [...filhos.filter((f) => !ehPasta(f)).map((f) => ({ ...f, sub: '' })), ...netos.flat()];
}

/* ----------------------------------------------------- conteúdo */

const textoCache = new Map(); // `${id}:${modifiedTime}` → Promise<string>

/** Conteúdo de um arquivo como texto (cache por id+modifiedTime). */
export function baixarTexto(arquivo) {
  const id = typeof arquivo === 'string' ? arquivo : arquivo.id;
  const chave = `${id}:${typeof arquivo === 'string' ? '' : arquivo.modifiedTime || ''}`;
  if (!textoCache.has(chave)) {
    const p = api(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`).then((r) => r.text());
    p.catch(() => textoCache.delete(chave));
    textoCache.set(chave, p);
  }
  return textoCache.get(chave);
}

/**
 * Conteúdo binário como Blob. Com `aoProgresso(recebido, total)`, lê o corpo em stream e avisa a
 * cada pedaço; `total` vem do Content-Length (ou de `tamanho`, o size da listagem; 0 se nenhum).
 * O arquivo inteiro fica na memória (é o jeito de um <video> tocar um arquivo privado sem iframe).
 */
export async function baixarBlob(id, { aoProgresso = null, tamanho = 0, sinal = undefined } = {}) {
  const r = await api(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { signal: sinal });
  if (!aoProgresso || !r.body?.getReader) return r.blob();
  const total = Number(r.headers.get('Content-Length')) || Number(tamanho) || 0;
  const tipo = r.headers.get('Content-Type') || '';
  const leitor = r.body.getReader();
  const partes = [];
  let recebido = 0;
  aoProgresso(0, total);
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      partes.push(value);
      recebido += value.byteLength;
      aoProgresso(recebido, total);
    }
  } catch {
    throw new ErroDrive('A conexão caiu no meio do download. Tente de novo.', 0);
  }
  return new Blob(partes, { type: tipo });
}

export async function baixarArrayBuffer(id) {
  return (await api(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`)).arrayBuffer();
}

export async function metadados(id, campos = 'id,name,mimeType,modifiedTime') {
  const p = new URLSearchParams({ fields: campos, supportsAllDrives: 'true' });
  return json(`${API}/files/${encodeURIComponent(id)}?${p}`);
}

/** Cria um arquivo de texto (upload multipart) e devolve {id, name}. */
export async function criarArquivoTexto(nome, conteudo, pastaId, mime = 'text/markdown') {
  const fronteira = 'motor' + Math.random().toString(36).slice(2);
  const meta = { name: nome, parents: [pastaId], mimeType: mime };
  const corpo =
    `--${fronteira}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${fronteira}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n${conteudo}\r\n--${fronteira}--`;
  return json(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${fronteira}` },
    body: corpo,
  });
}

/** Substitui o conteúdo de um arquivo existente (upload simples). */
export async function substituirConteudo(id, dados, mime) {
  return json(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&supportsAllDrives=true&fields=id,modifiedTime`, {
    method: 'PATCH',
    headers: { 'Content-Type': mime },
    body: dados,
  });
}

/** Link do Drive para a pasta/arquivo (fallback quando webViewLink não vier). */
export function linkDrive(arquivo) {
  if (arquivo?.webViewLink) return arquivo.webViewLink;
  if (!arquivo?.id) return '';
  return arquivo.mimeType === MIME_PASTA
    ? `https://drive.google.com/drive/folders/${encodeURIComponent(arquivo.id)}`
    : `https://drive.google.com/file/d/${encodeURIComponent(arquivo.id)}/view`;
}

export { UPLOAD as URL_UPLOAD };
