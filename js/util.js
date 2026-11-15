// Utilitários: escape, datas no fuso de São Paulo, formatos, ícones. Puro (só `$` toca o DOM).

import { TIMEZONE } from './config.js';
import { hojeISO, horaNoFuso } from './parse.js';

export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);

/** Escapa texto para entrar em HTML (conteúdo e atributos). Todo dado do Drive passa por aqui. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Só links https (o resto vira ''): para href de conteúdo externo. */
export function hrefSeguro(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

/** Links de post de rede social (aba Candidatos): só http e https, sem usuário/senha no endereço;
    o resto (javascript:, data:, mailto:…) vira ''. */
export function hrefWeb(url) {
  try {
    const u = new URL(String(url || '').trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (u.username || u.password) return '';
    return u.href;
  } catch {
    return '';
  }
}

/* ---------------------------------------------------------------- datas */

export const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** 'AAAA-MM-DD' → número do dia (UTC), para contas de dias sem fuso nem horário de verão. */
function diaNumero(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN;
}
const deNumero = (n) => new Date(n * 864e5);
const ehIso = (iso) => Number.isFinite(diaNumero(iso));

/** Hoje em São Paulo ('AAAA-MM-DD'). */
export const hoje = (agora = new Date()) => hojeISO(agora);

/** '2026-11-14' → '14 de nov' */
export function dataCurta(iso) {
  if (!ehIso(iso)) return '';
  const d = deNumero(diaNumero(iso));
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()].slice(0, 3)}`;
}

/** '2026-11-14' → 'sábado, 14 de novembro' */
export function dataLonga(iso) {
  if (!ehIso(iso)) return '';
  const d = deNumero(diaNumero(iso));
  return `${DIAS[d.getUTCDay()]}, ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

/** Dias de hoje (São Paulo) até a data; negativo se já passou. */
export const diasAte = (iso, agora = new Date()) => diaNumero(iso) - diaNumero(hoje(agora));

/** Período da semana ISO (segunda a domingo) que contém `agora`: '9 a 15 de novembro'. */
export function periodoDaSemana(agora = new Date()) {
  const n = diaNumero(hoje(agora));
  const dow = deNumero(n).getUTCDay() || 7;
  const seg = deNumero(n - (dow - 1));
  const dom = deNumero(n - (dow - 1) + 6);
  const mes = (d) => MESES[d.getUTCMonth()];
  if (seg.getUTCMonth() === dom.getUTCMonth()) return `${seg.getUTCDate()} a ${dom.getUTCDate()} de ${mes(dom)}`;
  return `${seg.getUTCDate()} de ${mes(seg)} a ${dom.getUTCDate()} de ${mes(dom)}`;
}

let fmtHora = null;
/** Hora e minuto em São Paulo: '9h10', '16h' (minuto zero some). */
export function horaCurta(instante) {
  const d = instante instanceof Date ? instante : new Date(instante);
  if (Number.isNaN(d.getTime())) return '';
  fmtHora ||= new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(fmtHora.formatToParts(d).map((x) => [x.type, x.value]));
  const h = Number(p.hour);
  return p.minute === '00' ? `${h}h` : `${h}h${p.minute}`;
}

/**
 * Quando algo aconteceu, no estilo do app (fuso de São Paulo):
 * 'hoje, 9h10' · 'ontem, 18h20' · 'quarta, 16h42' (até 6 dias) · '3 de nov, 16h42'.
 */
export function quando(instante, agora = new Date()) {
  const d = instante instanceof Date ? instante : new Date(instante);
  if (Number.isNaN(d.getTime())) return '';
  const dia = hoje(d);
  const dif = diaNumero(hoje(agora)) - diaNumero(dia);
  const hora = horaCurta(d);
  if (dif === 0) return `hoje, ${hora}`;
  if (dif === 1) return `ontem, ${hora}`;
  if (dif > 1 && dif < 7) return `${DIAS[deNumero(diaNumero(dia)).getUTCDay()]}, ${hora}`;
  return `${dataCurta(dia)}, ${hora}`;
}

/** 'Bom dia' / 'Boa tarde' / 'Boa noite' pela hora de São Paulo. */
export function saudacao(agora = new Date()) {
  const h = horaNoFuso(agora);
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** 'AAAA-MM-DD' | 'atemporal' | '' (ou texto livre) → selo de validade do roteiro. */
export function validade(r, agora = new Date()) {
  const v = String(r?.valido_ate || '').trim();
  if (!v || v.toLowerCase() === 'atemporal') return { texto: 'Atemporal', tom: 'neutro', perto: false };
  if (!ehIso(v)) return { texto: `Vale até ${v}`, tom: 'neutro', perto: false };
  const d = diasAte(v, agora);
  const dia = dataCurta(v);
  if (d < 0) return { texto: `Venceu em ${dia}`, tom: 'alerta', perto: true };
  if (d <= 2) return { texto: `Até ${dia} (${d === 0 ? 'hoje' : d === 1 ? 'amanhã' : d + ' dias'})`, tom: 'alerta', perto: true };
  return { texto: `Vale até ${dia}`, tom: 'neutro', perto: false };
}

/* -------------------------------------------------------------- formatos */

export const relogio = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const numero = (n) => Math.round(n).toLocaleString('pt-BR');

export function tamanho(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1073741824) return (b / 1073741824).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' GB';
  if (b >= 1048576) return Math.round(b / 1048576) + ' MB';
  return Math.max(1, Math.round(b / 1024)) + ' KB';
}

export const NOME_REDE = { ig: 'Instagram', tt: 'TikTok', ambos: 'Instagram e TikTok', ambas: 'As duas versões' };

export const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Fator entre o rem real e 16px (0,8 no computador, 1 no celular): para medidas feitas em JS. */
export function escala() {
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return px > 0 ? px / 16 : 1;
}

/** px de referência → rem (para style inline). */
export const rem = (px) => `${+(px / 16).toFixed(4)}rem`;

/* ---------------------------------------------------------------- ícones */

/* Ícones em SVG, desenhados com traço na cor do texto */
export const ICONES = {
  inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  pautas: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  roteiros: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  videos: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10.5 9.5v5l4-2.5z"/>',
  prontos: '<path d="M12 4v11M7 10l5 5 5-5M4 19h16"/>',
  resultados: '<path d="M5 20V11M12 20V4M19 20v-6M2 20h20"/>',
  enviar: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  voltar: '<path d="M15 6l-6 6 6 6"/>',
  seta: '<path d="M9 6l6 6-6 6"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pausa: '<path d="M8 5v14M16 5v14"/>',
  copiar: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  alerta: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  estrela: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
  sair: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"/>',
  tele: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M7 9h10M7 13h6"/>',
  lixo: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  camera: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  lua: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  atualizar: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v3h3M4 13a8 8 0 0 0 14.6 4.5M20 20v-3h-3"/>',
  semRede: '<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01M3 3l18 18"/>',
};

/** Ícone em SVG. O tamanho vem em px de referência e é aplicado em rem (acompanha a densidade). */
export const ic = (nome, t = 20) => `<svg class="ic" width="${t}" height="${t}" style="width:${rem(t)};height:${rem(t)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome] || ''}</svg>`;
