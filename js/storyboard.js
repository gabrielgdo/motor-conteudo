// STORYBOARD ANTES DAS PRÉVIAS (puro, sem DOM nem rede). Pedido dela de 15/11/2026: antes de qualquer prévia em vídeo,
// o motor entrega quadros parados da mesma composição que vira vídeo ("<id> storyboard vN/" com ig-01.jpg… e
// "<id> storyboard vN.md" em 4-Revisao); ela aprova ou pede mudança por quadro, e só com o storyboard aprovado o motor
// renderiza as prévias v1. A decisão vira "4-Revisao/<id> decisao storyboard vN.md" (pela central, tipo
// decisao_storyboard, com o Drive como reserva) e vale a primeira decisão VÁLIDA de cada versão (como no motor: um
// arquivo inválido antes não bloqueia uma decisão válida depois; decisaoValida).
//
//   lerStoryboard(texto)              o .md do motor → {id, versao, redes, notas, mudancas, quadros:{ig:[…], tt:[…]}}
//   estadoDoStoryboard(r, {local})    em que pé está a decisão (decidir | aprovado | ajustar | sem-texto)
//   planejarDecisaoStoryboard(…)      nome e conteúdo do arquivo da decisão, conferindo se ela já existe
//   lerDecisaoStoryboard(texto)       a decisão gravada (para mostrar o que ela pediu)
//   decisaoValida(lida, {id, versao}) a decisão lida vale sozinha? (os critérios do motor)
//
// Os arquivos são DADOS: só a lista fechada de campos é lida (formatos.md do motor) e tudo vai para a tela por esc().

import { idValido, yamlTexto } from './parse.js';
import { isoBrasilia } from './pedidos-motor.js';
import { quemDecide } from './ganchos.js';

export const DECISOES_STORYBOARD = Object.freeze(['aprovar', 'ajustar']);
export const REDES_STORYBOARD = Object.freeze(['ig', 'tt', 'ambas']);
/** Depois de 2 h sem resposta do motor, a espera ganha o tom de alerta; o registro otimista deixa de valer. */
export const ESPERA_STORYBOARD_MS = 2 * 60 * 60 * 1000;
const MAX_CAMPO = 400;
const MAX_PEDIDO = 1000;
const REDE_DA_SECAO = { instagram: 'ig', tiktok: 'tt' };
const RE_ARQUIVO = /^(ig|tt)-\d{2}\.jpe?g$/i;

const ms = (d) => (d instanceof Date ? d.getTime() : d == null || d === '' ? NaN : new Date(d).getTime());
const limpo = (v, max = MAX_CAMPO) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function nomeDecisaoStoryboard(id, versao) {
  return `${String(id ?? '').trim()} decisao storyboard v${Number(versao) || 0}.md`;
}

/** Valor de uma linha `chave: valor` sem as aspas de YAML. */
function valor(v) {
  let s = String(v ?? '').trim();
  if (s.length >= 2 && s[0] === s[s.length - 1] && (s[0] === '"' || s[0] === "'")) {
    s = s.slice(1, -1);
    if (s.includes('\\')) s = s.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return s.trim();
}

/**
 * `<id> storyboard vN.md` → {id, versao, redes, notas, mudancas, quadros}. Cabeçalho: só id, versao e redes. Corpo: só
 * "## Para você conferir" (itens "- "), "## O que mudou" (tabela) e as seções "## Instagram" / "## TikTok" com
 * "### Quadro N" e, em cada uma, as linhas arquivo, tempo, acontece, na tela e por que. Quadro sem arquivo válido
 * (ig-NN.jpg / tt-NN.jpg da própria rede) fica de fora.
 */
export function lerStoryboard(texto) {
  const out = { id: '', versao: 0, redes: [], notas: [], mudancas: [], quadros: { ig: [], tt: [] } };
  const s = String(texto ?? '');
  const fm = s.match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  let corpo = s;
  if (fm) {
    corpo = s.slice(fm[0].length);
    for (const linha of fm[1].split(/\r?\n/)) {
      const m = linha.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const k = m[1].toLowerCase();
      const v = valor(m[2]);
      if (k === 'id' && !out.id) out.id = v.slice(0, 20);
      else if (k === 'versao' && !out.versao) out.versao = Number(v.replace(/^v/i, '')) || 0;
      else if (k === 'redes' && !out.redes.length) out.redes = v.split(/[,;\s]+/).map((x) => x.toLowerCase()).filter((x) => x === 'ig' || x === 'tt');
    }
  }
  let secao = '';
  let rede = '';
  let quadro = null;
  const vistos = { ig: new Set(), tt: new Set() };
  for (const bruta of corpo.split(/\r?\n/)) {
    const linha = bruta.trim();
    const h2 = linha.match(/^##\s+(.+?)\s*$/);
    if (h2 && !linha.startsWith('###')) {
      const nome = h2[1].toLowerCase();
      rede = REDE_DA_SECAO[nome] || '';
      secao = rede ? 'quadros' : nome.startsWith('para você conferir') || nome.startsWith('para voce conferir') ? 'notas'
        : nome.startsWith('o que mudou') ? 'mudancas' : '';
      quadro = null;
      continue;
    }
    const h3 = linha.match(/^###\s+Quadro\s+(\d+)\s*$/i);
    if (h3) {
      const n = Number(h3[1]);
      quadro = secao === 'quadros' && n >= 1 && n <= 30 && !vistos[rede].has(n) ? { n, arquivo: '', tempo: '', acontece: '', naTela: '', porque: '' } : null;
      if (quadro) { vistos[rede].add(n); out.quadros[rede].push(quadro); }
      continue;
    }
    if (/^#/.test(linha)) { quadro = null; continue; }
    if (secao === 'notas') {
      const m = linha.match(/^[-*•]\s+(.*)$/);
      if (m && out.notas.length < 5) out.notas.push(limpo(m[1]));
      continue;
    }
    if (secao === 'mudancas') {
      if (/^\|.*\|$/.test(linha)) {
        const cel = linha.slice(1, -1).split('|').map((c) => limpo(c, 300));
        if (cel.length >= 5 && !cel.every((c) => /^:?-+:?$/.test(c)) && cel[0].toLowerCase() !== 'rede' && out.mudancas.length < 30) {
          out.mudancas.push({ rede: cel[0], quadro: cel[1], pedido: cel[2], feito: cel[3], ok: !cel[4].startsWith('⚠') });
        }
      }
      continue;
    }
    if (secao !== 'quadros' || !quadro) continue;
    const c = linha.match(/^(arquivo|tempo|acontece|na\s+tela|por\s*qu[eê])\s*:\s*(.*)$/i);
    if (!c) continue;
    const k = /^na/i.test(c[1]) ? 'naTela' : /^por/i.test(c[1]) ? 'porque' : c[1].toLowerCase();
    if (!quadro[k]) quadro[k] = limpo(valor(c[2]), k === 'tempo' ? 12 : MAX_CAMPO);
  }
  for (const r of ['ig', 'tt']) {
    out.quadros[r] = out.quadros[r].filter((q) => RE_ARQUIVO.test(q.arquivo) && q.arquivo.toLowerCase().startsWith(`${r}-`))
      .sort((a, b) => a.n - b.n);
  }
  if (!out.redes.length) out.redes = ['ig', 'tt'].filter((r) => out.quadros[r].length);
  return out;
}

/** "m:ss.s" (o tempo de um quadro) → segundos; NaN se não der. */
export function segundosDoQuadro(tempo) {
  const m = String(tempo ?? '').trim().match(/^(\d+):(\d{1,2}(?:[.,]\d+)?)$/);
  return m ? Number(m[1]) * 60 + Number(m[2].replace(',', '.')) : NaN;
}

/** O quadro de uma lista mais perto do tempo t (segundos), ou null. */
export function quadroMaisPerto(lista = [], t = NaN) {
  if (!Number.isFinite(t)) return null;
  let melhor = null;
  for (const q of lista || []) {
    const d = Math.abs(segundosDoQuadro(q.tempo) - t);
    if (Number.isFinite(d) && (!melhor || d < melhor.d)) melhor = { q, d };
  }
  return melhor ? melhor.q : null;
}

/**
 * Os pedidos em que vira um pedido feito num quadro. "Só nesta rede": um, para o quadro tocado. "Nos dois vídeos": esse
 * e outro para o quadro da outra rede mais perto no tempo (os números dos quadros não batem entre as redes: no T01, o
 * quadro 5 do Instagram é o fechamento e o 5 do TikTok é um corte). Assim o motor sempre recebe rede e quadro exatos,
 * e a confirmação mostra os dois.
 */
export function pedidosDoQuadro(quadros = {}, rede, n, pedido, ambas = false) {
  const q = (quadros?.[rede] || []).find((x) => x.n === Number(n));
  const texto = limpo(pedido, MAX_PEDIDO);
  if (!q || !texto || !['ig', 'tt'].includes(rede)) return [];
  const out = [{ rede, quadro: q.n, tempo: q.tempo, pedido: texto }];
  if (ambas) {
    const outra = rede === 'ig' ? 'tt' : 'ig';
    const par = quadroMaisPerto(quadros?.[outra], segundosDoQuadro(q.tempo));
    if (par) out.push({ rede: outra, quadro: par.n, tempo: par.tempo, pedido: texto });
  }
  return out;
}

/** A decisão gravada (só os campos combinados) → {id, versao, decisao, ajustes:[{rede, quadro, tempo, pedido}],
    observacoes, quem}. */
export function lerDecisaoStoryboard(texto) {
  const out = { id: '', versao: 0, decisao: '', ajustes: [], observacoes: '', quem: '' };
  const m = String(texto ?? '').match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return out;
  let dentro = false;
  let atual = null;
  for (const linha of m[1].split(/\r?\n/)) {
    if (/^ajustes\s*:\s*(\[\s*\])?\s*$/.test(linha)) { dentro = true; continue; }
    if (dentro && linha && !/^[\s-]/.test(linha)) dentro = false;
    if (dentro) {
      const a = linha.match(/^\s*(-\s+)?([A-Za-z_]+)\s*:\s*(.*)$/);
      if (!a) continue;
      if (a[1] || !atual) { atual = {}; out.ajustes.push(atual); }
      const k = a[2].toLowerCase();
      if (['rede', 'quadro', 'tempo', 'pedido'].includes(k) && !(k in atual)) atual[k] = limpo(valor(a[3]), MAX_PEDIDO);
      continue;
    }
    const c = linha.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
    if (!c) continue;
    const k = c[1].toLowerCase();
    const v = valor(c[2]);
    if (k === 'id' && !out.id) out.id = v.slice(0, 20);
    else if (k === 'versao' && !out.versao) out.versao = Number(v.replace(/^v/i, '')) || 0;
    else if (k === 'decisao' && !out.decisao) out.decisao = DECISOES_STORYBOARD.includes(v.toLowerCase()) ? v.toLowerCase() : '';
    else if (k === 'observacoes' && !out.observacoes) out.observacoes = limpo(v, MAX_PEDIDO);
    else if (k === 'quem' && !out.quem) out.quem = limpo(v, 200).toLowerCase();
  }
  out.ajustes = out.ajustes.filter((a) => REDES_STORYBOARD.includes(String(a.rede || '').toLowerCase()) && a.pedido)
    .map((a) => ({ rede: a.rede.toLowerCase(), quadro: Number(a.quadro) || null, tempo: a.tempo || '', pedido: a.pedido }));
  return out;
}

/**
 * A decisão lida (lerDecisaoStoryboard) vale sozinha? Os critérios do motor (storyboard.invalida): id e versão do
 * conteúdo iguais aos do nome (ou vazios), decisão aprovar|ajustar, ajustar com algum pedido, quem que decide. Só uma
 * decisão válida conta para "a primeira de cada versão".
 */
export function decisaoValida(lida, { id, versao } = {}) {
  if (!lida || typeof lida !== 'object') return false;
  if (lida.id && lida.id !== id) return false;
  if (lida.versao && Number(lida.versao) !== Number(versao)) return false;
  if (!DECISOES_STORYBOARD.includes(lida.decisao)) return false;
  if (lida.decisao === 'ajustar' && !(lida.ajustes || []).length && !lida.observacoes) return false;
  return quemDecide(lida.quem, id);
}

/** O registro otimista {versao, decisao, desde} ainda vale para esta versão do storyboard? */
function localValido(local, versao, t) {
  if (!local || Number(local.versao) !== Number(versao) || !DECISOES_STORYBOARD.includes(String(local.decisao))) return false;
  const desde = ms(local.desde);
  return !Number.isFinite(desde) || t - desde < ESPERA_STORYBOARD_MS;
}

/**
 * Em que pé está o storyboard de um roteiro na etapa 'storyboard'. `r.storyboard` (js/dados.js): {versao, lido, erro,
 * temDecisao, decisaoEm, decisao:{decisao, ajustes, observacoes}|null, quadros, …}. `local`:
 * estado.storyboardsEnviados[id] = {versao, decisao, desde}, logo depois de enviar (até a decisão aparecer no Drive).
 * → {estado, bloqueia, texto, tom, explicacao}. Textos puros: esc() na tela.
 *   decidir    a vez é dela (aprovar ou pedir mudança nos quadros)
 *   aprovado   ela aprovou: o motor renderiza as prévias v1 (IG e TT)
 *   ajustar    ela pediu mudanças: o motor faz o storyboard v(N+1)
 *   sem-texto  o storyboard não foi lido (ou não trouxe quadros): nada a decidir agora
 */
export function estadoDoStoryboard(r, { local = null, agora = new Date() } = {}) {
  const sb = r?.storyboard || {};
  const v = Number(sb.versao) || 0;
  const t = ms(agora);
  const doDrive = sb.temDecisao ? String(sb.decisao?.decisao || '') : '';
  const otimista = !sb.temDecisao && localValido(local, v, t);
  if (sb.temDecisao || otimista) {
    const decisao = sb.temDecisao ? doDrive : String(local.decisao);
    const desde = sb.temDecisao ? ms(sb.decisaoEm) : ms(local?.desde);
    const demorou = Number.isFinite(desde) && t - desde >= ESPERA_STORYBOARD_MS;
    const atraso = demorou ? ' Já passou de 2 h sem resposta do motor: se algo falhou, o Gabriel recebe o aviso.' : '';
    const tom = demorou ? 'alerta' : 'espera';
    if (decisao === 'ajustar') {
      return {
        estado: 'ajustar', bloqueia: true, tom, texto: 'Mudanças enviadas',
        explicacao: `O motor está refazendo os quadros (storyboard v${v + 1}); ele aparece aqui para você ver de novo. Nenhum vídeo foi renderizado ainda.${atraso}`,
      };
    }
    if (decisao === 'aprovar') {
      return {
        estado: 'aprovado', bloqueia: true, tom, texto: `Storyboard v${v} aprovado`,
        explicacao: `O motor está renderizando as prévias v1 do Instagram e do TikTok ao mesmo tempo; elas aparecem aqui para você revisar.${atraso}`,
      };
    }
    return { estado: 'aprovado', bloqueia: true, tom, texto: 'Decisão enviada', explicacao: `O motor está trabalhando.${atraso}` };
  }
  const n = (sb.quadros?.ig?.length || 0) + (sb.quadros?.tt?.length || 0);
  if (!sb.lido || !n) {
    return {
      estado: 'sem-texto', bloqueia: true, tom: 'alerta', texto: 'Storyboard ilegível agora',
      explicacao: sb.erro ? 'O Google Drive não entregou o storyboard agora.' : 'O storyboard não trouxe quadros que eu consiga ler.',
    };
  }
  return { estado: 'decidir', bloqueia: false, tom: 'acao', texto: `Aprovar o storyboard v${v}`, explicacao: '' };
}

/** Roteiros na etapa 'storyboard' em que a vez é dela (para o Início e o número da navegação). */
export function storyboardsParaDecidir(roteiros = [], locais = {}, agora = new Date()) {
  return (roteiros || []).filter((r) => r?.etapa === 'storyboard'
    && estadoDoStoryboard(r, { local: locais?.[r.id] || null, agora }).estado === 'decidir');
}

/** Conteúdo do arquivo da decisão (lista fechada de campos; textos entre aspas, sem quebra de linha). */
export function textoDecisaoStoryboard({ id, versao, decisao, ajustes = [], observacoes = '', quem = '', quando = null } = {}) {
  const linhas = ['---', `id: ${String(id).trim()}`, `versao: ${Number(versao) || 0}`, `decisao: ${decisao}`];
  if (decisao === 'ajustar' && ajustes.length) {
    linhas.push('ajustes:');
    for (const a of ajustes) {
      linhas.push(`  - rede: ${a.rede}`);
      if (a.quadro) linhas.push(`    quadro: ${Number(a.quadro)}`);
      if (String(a.tempo || '').trim()) linhas.push(`    tempo: ${yamlTexto(a.tempo)}`);
      linhas.push(`    pedido: ${yamlTexto(String(a.pedido).slice(0, MAX_PEDIDO))}`);
    }
  }
  linhas.push(`observacoes: ${yamlTexto(String(observacoes || '').slice(0, MAX_PEDIDO))}`, `quem: ${String(quem || '').trim().toLowerCase()}`,
    `quando: ${isoBrasilia(quando || new Date())}`, '---');
  return linhas.join('\n') + '\n';
}

/**
 * Plano da decisão: nome e conteúdo de `<id> decisao storyboard vN.md`. `existentes`: os arquivos de 4-Revisao lidos
 * agora (vale a primeira decisão de cada versão, como na central). → {ok:true, nome, conteudo, payload} |
 * {ok:false, motivo, mensagem}.
 */
export function planejarDecisaoStoryboard({ id, versao, decisao, ajustes = [], observacoes = '', email = '', existentes = [], agora = new Date() } = {}) {
  if (!idValido(id)) return { ok: false, motivo: 'id-invalido', mensagem: `Id inválido: ${id}` };
  const v = Number(versao);
  if (!Number.isInteger(v) || v < 1) return { ok: false, motivo: 'versao-invalida', mensagem: `Versão inválida: ${versao}` };
  if (!DECISOES_STORYBOARD.includes(decisao)) return { ok: false, motivo: 'decisao-invalida', mensagem: 'No storyboard, a decisão é aprovar ou pedir mudanças.' };
  const lista = decisao === 'ajustar' ? (ajustes || []).map((a) => ({
    rede: String(a?.rede || '').toLowerCase(), quadro: Number(a?.quadro) || null, tempo: limpo(a?.tempo, 20), pedido: limpo(a?.pedido, MAX_PEDIDO),
  })) : [];
  if (lista.some((a) => !REDES_STORYBOARD.includes(a.rede) || !a.pedido)) {
    return { ok: false, motivo: 'dados-invalidos', mensagem: 'Cada pedido precisa dizer a rede e o que mudar.' };
  }
  const obs = limpo(observacoes, MAX_PEDIDO);
  if (decisao === 'ajustar' && !lista.length && !obs) return { ok: false, motivo: 'sem-pedido', mensagem: 'Diga o que mudar em pelo menos um quadro.' };
  const nome = nomeDecisaoStoryboard(id, v);
  if ((existentes || []).some((f) => String(f?.name ?? f ?? '').trim().toLowerCase() === nome.toLowerCase())) {
    return { ok: false, motivo: 'ja-decidido', mensagem: `A decisão do storyboard v${v} de ${id} já está no Drive (vale a primeira). Atualize a tela.` };
  }
  return {
    ok: true, nome,
    conteudo: textoDecisaoStoryboard({ id, versao: v, decisao, ajustes: lista, observacoes: obs, quem: email, quando: agora }),
    payload: { id, versao: v, decisao, ajustes: lista, observacoes: obs },
  };
}

/** Aviso depois de a decisão sair (pela central ou pelo Drive). */
export function textoDaDecisaoStoryboardAceita(id, { decisao, versao, ajustes = [] } = {}, viaCentral = false) {
  const por = viaCentral ? 'pela central: ele recebe em segundos' : 'pelo Drive: ele pega o arquivo em alguns minutos';
  if (decisao === 'ajustar') {
    const n = ajustes.length;
    return `${id}: ${n === 1 ? '1 pedido de mudança enviado' : `${n} pedidos de mudança enviados`} ao motor ${por}. O storyboard v${Number(versao) + 1} aparece aqui quando ficar pronto.`;
  }
  return `${id}: storyboard v${versao} aprovado e enviado ao motor ${por}. Ele renderiza as prévias do Instagram e do TikTok.`;
}
