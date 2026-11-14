// Helpers de DOM. Regra: conteúdo vindo do Drive é DADO — sempre textContent, nunca innerHTML.

import { blocosMarkdown } from './parse.js';

/** Só aceita https: (externo) ou rotas internas "#/…"/"./…". Caso contrário devolve null. */
export function hrefSeguro(url) {
  const s = String(url || '').trim();
  if (s.startsWith('#/') || s.startsWith('./')) return s;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * el('div', {class:'x', onclick: fn, href: '…'}, 'texto', outroNó, [lista]).
 * Strings viram nós de texto (escapadas). `text` define textContent. `href`/`src` passam por
 * hrefSeguro (exceto blob: em src/href de download, que são gerados aqui).
 */
export function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'href' || k === 'src') {
      const s = String(v);
      const ok = s.startsWith('blob:') ? s : hrefSeguro(s);
      if (ok) n.setAttribute(k, ok);
    } else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, String(v));
  }
  anexar(n, ...filhos);
  return n;
}

/** Anexa filhos ignorando null/undefined/false (o append nativo os viraria texto). */
export function anexar(n, ...filhos) {
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    n.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
}

export function limpar(n) {
  while (n.firstChild) n.firstChild.remove();
  return n;
}

/** Escapa texto para uso raro em atributos/strings (preferir el()). */
export function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------------------------------------------------------- ícones */

// Ícones SVG inline simples (traços 24×24). Conteúdo estático do app, nunca do Drive.
const ICONES = {
  inicio: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h5v-5h3v5h5V10',
  pautas: 'M5 4h14v16H5zM8.5 8.5h7M8.5 12h7M8.5 15.5h4',
  roteiros: 'M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8zM14 3v5h5M8.5 13h7M8.5 16.5h5',
  videos: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h9A1.5 1.5 0 0 1 16 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 17.5zM16 10l4-2.5v9L16 14',
  prontos: 'M4 7.5 12 3l8 4.5v9L12 21l-8-4.5zM4 7.5l8 4.5 8-4.5M12 12v9',
  resultados: 'M4 20h16M7 16.5v-5M12 16.5V7M17 16.5v-8',
  enviar: 'M12 16V4M7 9l5-5 5 5M5 15v4.5h14V15',
  atualizar: 'M19.5 12A7.5 7.5 0 1 1 17 6.4M19.5 4v4.5H15',
  sair: 'M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 16.5 14.5 12 10 7.5M14.5 12H4',
  voltar: 'M15 5l-7 7 7 7',
  estrela: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  copiar: 'M9 9h10.5v10.5H9zM15 9V4.5H4.5V15H9',
  baixar: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  externo: 'M14 4h6v6M20 4l-9 9M18 14v5.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5H10',
  mais: 'M12 5v14M5 12h14',
  fechar: 'M6 6l12 12M18 6 6 18',
  pausar: 'M8 5v14M16 5v14',
  play: 'M7 4.5v15l12-7.5z',
};

export function icone(nome, classe = 'icone') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', classe);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONES[nome] || '');
  svg.append(p);
  return svg;
}

/* ------------------------------------------------------- componentes */

export function chip(texto, tipo = '') {
  return el('span', { class: `chip ${tipo ? 'chip-' + tipo : ''}` }, texto);
}

export function botao(texto, { tipo = 'principal', icone: ic, onclick, disabled, attrs = {} } = {}) {
  return el('button', { type: 'button', class: `btn btn-${tipo}`, onclick, disabled, ...attrs },
    ic ? icone(ic) : null, el('span', {}, texto));
}

export function carregando(texto = 'Carregando…') {
  return el('div', { class: 'estado-carregando', role: 'status' },
    el('div', { class: 'skeleton' }), el('div', { class: 'skeleton curto' }), el('div', { class: 'skeleton' }),
    el('p', { class: 'suave' }, texto));
}

export function erroBloco(mensagem, aoTentar) {
  return el('div', { class: 'card estado-erro', role: 'alert' },
    el('p', {}, mensagem || 'Algo deu errado.'),
    aoTentar ? botao('Tentar de novo', { tipo: 'contorno', icone: 'atualizar', onclick: aoTentar }) : null);
}

/* ------------------------------------------------------------- toast */

export function toast(mensagem, tipo = 'ok', ms = 3500) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = el('div', { id: 'toasts', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const t = el('div', { class: `toast toast-${tipo}` }, mensagem);
  box.append(t);
  setTimeout(() => { t.classList.add('saindo'); setTimeout(() => t.remove(), 400); }, ms);
}

/* ------------------------------------------------------------- modal */

/**
 * Abre um modal. `corpo` é um nó; `acoes` = [{texto, tipo, valor, aoClicar?}].
 * Devolve Promise com o `valor` da ação escolhida (ou null ao fechar). Se `aoClicar` devolver
 * false (ou Promise<false>), o modal continua aberto.
 */
export function modal({ titulo, corpo, acoes = [] }) {
  return new Promise((resolve) => {
    const anterior = document.activeElement;
    const fechar = (valor) => {
      fundo.remove();
      document.removeEventListener('keydown', aoTecla);
      anterior?.focus?.();
      resolve(valor);
    };
    const aoTecla = (e) => { if (e.key === 'Escape') fechar(null); };
    const botoes = acoes.map((a) => {
      const b = botao(a.texto, {
        tipo: a.tipo || 'principal',
        onclick: async () => {
          if (a.aoClicar) {
            b.disabled = true;
            let ok;
            try { ok = await a.aoClicar(); } finally { b.disabled = false; }
            if (ok === false) return;
          }
          fechar(a.valor);
        },
      });
      return b;
    });
    const caixa = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
      el('div', { class: 'modal-topo' },
        el('h2', {}, titulo),
        el('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Fechar', onclick: () => fechar(null) }, icone('fechar'))),
      corpo ? el('div', { class: 'modal-corpo' }, corpo) : null,
      el('div', { class: 'modal-acoes' }, botoes));
    const fundo = el('div', { class: 'modal-fundo', onclick: (e) => { if (e.target === fundo) fechar(null); } }, caixa);
    document.body.append(fundo);
    document.addEventListener('keydown', aoTecla);
    (caixa.querySelector('textarea, input, select') || botoes[botoes.length - 1])?.focus();
  });
}

/** Confirmação simples: Promise<boolean>. */
export async function confirmar(titulo, mensagem, { sim = 'Confirmar', nao = 'Cancelar' } = {}) {
  const v = await modal({
    titulo,
    corpo: mensagem ? el('p', {}, mensagem) : null,
    acoes: [{ texto: nao, tipo: 'texto', valor: false }, { texto: sim, tipo: 'principal', valor: true }],
  });
  return v === true;
}

/* ------------------------------------------------------- utilidades */

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = el('textarea', { readonly: true, style: { position: 'fixed', top: '-1000px', opacity: '0' } });
    ta.value = texto;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** Dispara o download de um blob com o nome dado. */
export function salvarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: nome, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Link externo seguro (só https). Se o link for inválido, devolve só o texto. */
export function linkExterno(texto, url) {
  const href = hrefSeguro(url);
  if (!href) return el('span', { class: 'suave' }, texto);
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'link' }, texto, icone('externo', 'icone mini'));
}

/** Iframe de prévia do Drive (proporção 9:16). */
export function iframeDrive(fileId, titulo) {
  return el('div', { class: 'video-916' },
    el('iframe', {
      src: `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`,
      allow: 'autoplay', allowfullscreen: true, loading: 'lazy', title: titulo,
    }));
}

/** Renderiza markdown simples com segurança (blocos → elementos com textContent). */
export function markdownSeguro(texto) {
  const box = el('div', { class: 'markdown' });
  for (const b of blocosMarkdown(texto)) {
    if (b.tipo === 'titulo') box.append(el(b.nivel <= 2 ? 'h3' : 'h4', {}, limparEnfase(b.texto)));
    else if (b.tipo === 'lista') box.append(el('ul', {}, b.itens.map((i) => el('li', {}, limparEnfase(i)))));
    else if (b.tipo === 'tabela') {
      const [cab, ...linhas] = b.linhas;
      box.append(el('div', { class: 'tabela-rolagem' }, el('table', {},
        el('thead', {}, el('tr', {}, (cab || []).map((c) => el('th', {}, limparEnfase(c))))),
        el('tbody', {}, linhas.map((l) => el('tr', {}, l.map((c) => el('td', {}, limparEnfase(c)))))))));
    } else {
      const p = el('p');
      b.linhas.forEach((l, i) => { if (i) p.append(el('br')); p.append(limparEnfase(l)); });
      box.append(p);
    }
  }
  return box;
}

// Remove marcadores de ênfase (**x**, __x__, `x`) — mostramos como texto simples.
function limparEnfase(s) {
  return String(s).replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`([^`]+)`/g, '$1');
}

/** Campo de formulário com rótulo. */
export function campo(rotulo, controle, ajuda) {
  return el('label', { class: 'campo' }, el('span', { class: 'campo-rotulo' }, rotulo), controle,
    ajuda ? el('span', { class: 'campo-ajuda' }, ajuda) : null);
}
