// Upload resumível para o Drive (sessão resumable + PUT em pedaços de 8 MiB via XMLHttpRequest).
// O cálculo de offsets, backoff e ETA fica em funções puras exportadas (testadas em tests/).

import { getToken, renovar, PREFIXO_UPLOAD } from './auth.js';

export const PEDACO = 8 * 1024 * 1024; // 8 MiB (múltiplo de 256 KiB)
export const VALIDADE_SESSAO_MS = 6 * 24 * 60 * 60 * 1000; // 6 dias
const URL_INICIO = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name';
const TIMEOUT_XHR = 5 * 60 * 1000;

/* ------------------------------------------------------- funções puras */

/** Próximo offset a partir do header `Range` de uma resposta 308 ("bytes=0-1234" → 1235; sem → 0). */
export function proximoOffset(range) {
  const m = String(range || '').match(/bytes=\d+-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
}

/** Pedaço a enviar a partir de `offset`: {inicio, fim (inclusivo), contentRange}. */
export function intervaloPedaco(offset, total, tamanho = PEDACO) {
  const inicio = offset;
  const fim = Math.min(offset + tamanho, total) - 1;
  return { inicio, fim, contentRange: `bytes ${inicio}-${fim}/${total}` };
}

/** Content-Range da consulta de status (PUT vazio). */
export function rangeConsulta(total) {
  return `bytes */${total}`;
}

/** Espera antes da tentativa n (0, 1, 2…): 1, 2, 4, 8… s, no máximo 60 s. */
export function esperaBackoff(n) {
  return Math.min(1000 * 2 ** Math.max(0, n), 60000);
}

/**
 * Velocidade média (bytes/s) a partir de amostras [{t (ms), bytes}] numa janela recente.
 */
export function velocidade(amostras, janelaMs = 15000) {
  if (!amostras || amostras.length < 2) return 0;
  const ultima = amostras[amostras.length - 1];
  let primeira = amostras[0];
  for (const a of amostras) { if (ultima.t - a.t <= janelaMs) { primeira = a; break; } }
  const dt = (ultima.t - primeira.t) / 1000;
  return dt > 0 ? Math.max(0, (ultima.bytes - primeira.bytes) / dt) : 0;
}

/** Segundos restantes (ou null se não dá para estimar). */
export function tempoRestante(enviados, total, bytesPorSegundo) {
  if (!bytesPorSegundo || bytesPorSegundo <= 0) return null;
  return Math.max(0, Math.ceil((total - enviados) / bytesPorSegundo));
}

/** 125 → "2 min 5 s"; 3700 → "1 h 2 min". */
export function formatarDuracao(seg) {
  if (seg === null || seg === undefined || !Number.isFinite(seg)) return '—';
  const s = Math.max(0, Math.round(seg));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

/** Chave da sessão no localStorage (o prefixo vem do auth.js, que o preserva ao sair da conta). */
export function chaveSessao(id, arquivo) {
  return `${PREFIXO_UPLOAD}${id}.${arquivo.name}.${arquivo.size}.${arquivo.lastModified}`;
}

/** A sessão salva ainda vale? */
export function sessaoValida(salva, agora = Date.now()) {
  return !!(salva && salva.uri && salva.data && agora - salva.data < VALIDADE_SESSAO_MS);
}

/* ---------------------------------------------------------- uploader */

class ErroUpload extends Error {
  constructor(msg, tipo) { super(msg); this.tipo = tipo; }
}

function lerSalva(chave) {
  try { return JSON.parse(localStorage.getItem(chave) || 'null'); } catch { return null; }
}
function salvar(chave, uri) {
  try { localStorage.setItem(chave, JSON.stringify({ uri, data: Date.now() })); } catch { /* sem espaço */ }
}
function apagar(chave) {
  try { localStorage.removeItem(chave); } catch { /* ignore */ }
}

async function token() {
  return getToken() || renovar();
}

/**
 * Cria um upload. `aoProgresso({enviados, total, velocidade, restante})`,
 * `aoEstado(estado, mensagem?)` com estado em: iniciando, enviando, pausado, aguardando-rede,
 * reiniciando, concluido, cancelado, erro.
 * Retorna {iniciar(): Promise<{id,name}>, pausar(), continuar(), cancelar(), emAndamento()}.
 */
export function criarUpload({ arquivo, id, nome, pastaId, aoProgresso = () => {}, aoEstado = () => {} }) {
  const total = arquivo.size;
  const chave = chaveSessao(id, arquivo);
  const tipo = arquivo.type || 'video/mp4';
  let uri = null;
  let offset = 0;
  let xhrAtual = null;
  let pausado = false;
  let cancelado = false;
  let ativo = false;
  let acordar = null; // resolve da espera atual (pausa/backoff)
  let precisaConsultar = false; // perguntar ao Drive onde parou antes do próximo pedaço
  const amostras = [];

  function progresso(enviados) {
    const t = Date.now();
    amostras.push({ t, bytes: enviados });
    while (amostras.length > 2 && t - amostras[0].t > 20000) amostras.shift();
    const v = velocidade(amostras);
    aoProgresso({ enviados, total, velocidade: v, restante: tempoRestante(enviados, total, v) });
  }

  function esperar(ms) {
    return new Promise((resolve) => {
      const fim = () => { clearTimeout(t); window.removeEventListener('online', fim); acordar = null; resolve(); };
      const t = ms === Infinity ? null : setTimeout(fim, ms);
      window.addEventListener('online', fim);
      acordar = fim;
    });
  }

  async function iniciarSessao() {
    const tk = await token();
    let r;
    try {
      r = await fetch(URL_INICIO, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tk}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': tipo,
          'X-Upload-Content-Length': String(total),
        },
        body: JSON.stringify({ name: nome, parents: [pastaId] }),
      });
    } catch {
      throw new ErroUpload('rede', 'rede');
    }
    if (r.status === 401) { await renovar(); return iniciarSessao(); }
    if (r.status >= 500 || r.status === 429) throw new ErroUpload('servidor', 'rede');
    if (!r.ok) throw new ErroUpload(`O Google recusou o envio (${r.status}).`, 'fatal');
    const loc = r.headers.get('Location');
    if (!loc) throw new ErroUpload('O Google não devolveu o endereço do envio.', 'fatal');
    uri = loc;
    offset = 0;
    salvar(chave, uri);
  }

  // PUT via XHR. Resolve {status, range, corpo} ou rejeita ErroUpload('rede').
  function put(corpo, contentRange, tk, comProgresso) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrAtual = xhr;
      xhr.open('PUT', uri);
      xhr.setRequestHeader('Authorization', `Bearer ${tk}`);
      xhr.setRequestHeader('Content-Range', contentRange);
      xhr.timeout = TIMEOUT_XHR;
      if (comProgresso) xhr.upload.onprogress = (e) => progresso(offset + e.loaded);
      xhr.onload = () => { xhrAtual = null; resolve({ status: xhr.status, range: xhr.getResponseHeader('Range'), corpo: xhr.responseText }); };
      xhr.onerror = () => { xhrAtual = null; reject(new ErroUpload('rede', 'rede')); };
      xhr.ontimeout = () => { xhrAtual = null; reject(new ErroUpload('rede', 'rede')); };
      xhr.onabort = () => { xhrAtual = null; reject(new ErroUpload('interrompido', 'abortado')); };
      xhr.send(corpo);
    });
  }

  // Interpreta a resposta de um PUT. Devolve resultado final (objeto) ou null para continuar.
  async function tratar(res) {
    if (res.status === 200 || res.status === 201) {
      try { return JSON.parse(res.corpo || '{}'); } catch { return {}; }
    }
    if (res.status === 308) { offset = proximoOffset(res.range); return null; }
    if (res.status === 401) { await renovar(); precisaConsultar = !!uri; return null; }
    if (res.status === 404 || res.status === 410) {
      aoEstado('reiniciando', 'A sessão de envio expirou. Recomeçando do zero…');
      apagar(chave);
      uri = null;
      offset = 0;
      return null;
    }
    if (res.status >= 500 || res.status === 429) throw new ErroUpload('servidor', 'rede');
    throw new ErroUpload(`O Google recusou o envio (${res.status}).`, 'fatal');
  }

  async function consultarStatus() {
    const tk = await token();
    return tratar(await put(null, rangeConsulta(total), tk, false));
  }

  async function laco() {
    let falhas = 0;
    precisaConsultar = !!uri; // retomando sessão salva: pergunta onde parou
    for (;;) {
      if (cancelado) throw new ErroUpload('cancelado', 'cancelado');
      if (pausado) { aoEstado('pausado'); await esperar(Infinity); precisaConsultar = !!uri; continue; }
      try {
        if (!uri) { aoEstado('iniciando'); await iniciarSessao(); }
        if (precisaConsultar) {
          precisaConsultar = false;
          const fim = await consultarStatus();
          if (fim) return fim;
          continue; // reavalia (pode ter renovado token, reiniciado sessão ou pausado)
        }
        aoEstado('enviando');
        progresso(offset);
        const { inicio, fim, contentRange } = intervaloPedaco(offset, total);
        const tk = await token();
        const res = await put(arquivo.slice(inicio, fim + 1), contentRange, tk, true);
        const final = await tratar(res);
        falhas = 0;
        if (final) return final;
      } catch (e) {
        if (e.tipo === 'fatal') throw e;
        if (cancelado) throw new ErroUpload('cancelado', 'cancelado');
        if (e.tipo === 'abortado') { precisaConsultar = !!uri; continue; } // pausa
        if (e.tipo !== 'rede') throw e;
        // rede/5xx/timeout: espera com backoff (ou volta já no evento online) e consulta o status
        const ms = esperaBackoff(falhas++);
        aoEstado('aguardando-rede', `Sem conexão estável. Tentando de novo em ${Math.round(ms / 1000)} s…`);
        await esperar(ms);
        precisaConsultar = !!uri;
      }
    }
  }

  return {
    async iniciar() {
      ativo = true;
      const salva = lerSalva(chave);
      if (sessaoValida(salva)) uri = salva.uri; else apagar(chave);
      try {
        const res = await laco();
        apagar(chave);
        progresso(total);
        aoEstado('concluido');
        return res;
      } catch (e) {
        if (e.tipo === 'cancelado') { aoEstado('cancelado'); throw e; }
        aoEstado('erro', e.message);
        throw e;
      } finally {
        ativo = false;
      }
    },
    pausar() {
      if (!ativo || pausado) return;
      pausado = true;
      xhrAtual?.abort();
    },
    continuar() {
      if (!pausado) return;
      pausado = false;
      acordar?.();
    },
    cancelar() {
      cancelado = true;
      apagar(chave);
      xhrAtual?.abort();
      acordar?.();
      // Avisa o Drive para descartar a sessão (melhor esforço).
      if (uri) token().then((tk) => fetch(uri, { method: 'DELETE', headers: { Authorization: `Bearer ${tk}` } })).catch(() => {});
    },
    emAndamento() { return ativo; },
  };
}
