// REGRA QUE ESBARRA NO PEDIDO DELA (puro, sem DOM nem rede). Plano de mídia, §6 (16/11/2026): quando um pedido dela
// esbarra numa regra que ela pode mudar, o motor faz o que a regra deixa e pergunta, numa seção que o bin/regras.py
// escreve no storyboard, nas notas da prévia e no rascunho (nos ganchos, quando houver):
//
//   ## Regra que esbarra no seu pedido
//   ### S47-01-R1
//   pedido: "pôr a pergunta num cartão" (IG, quadro 4)
//   regra: estilo/limites.md:28 — "Nunca caixa, tarja, cartão ou faixa com texto"
//   feito agora: a pergunta em Lora solta com sombra, no mesmo lugar
//   texto novo: "[ambos] Cartão com texto só quando ela pedir no storyboard; o resto continua em letra solta."
//   pergunta: mudar a regra, fazer só neste vídeo ou manter?
//
// Ela responde no app ("Mudar a regra", "Só neste vídeo", "Manter") e a resposta vai no campo `regras` da decisão
// seguinte (storyboard, ajustes da prévia, roteiro ou gancho), só com o id da pergunta e a resposta:
//
//   regras:
//     - id: S47-01-R1
//       resposta: mudar        # mudar | so_neste | manter
//
// O arquivo é DADO: só a lista fechada de linhas é lida e tudo vai para a tela por esc(). O id da pergunta nunca
// aparece na tela.
//
//   lerPerguntasRegra(texto, id)   a seção → [{rid, pedido, onde, arquivo, linha, regra, feito, novo, pergunta, motivo}]
//   semSecaoRegras(texto)          o texto sem a seção (o resumo do motor não mostra o bloco cru)
//   regrasRespondidas(…)           as respostas dela às perguntas da tela → [{id, resposta}]
//   decisaoComRegras(…)            aprovar com um pedido liberado vira pedido de mudança (e o que vai no arquivo)
//   regrasValidas(regras, id)      só as respostas que podem ir num arquivo (pergunta deste roteiro, resposta da lista)
//   linhasRegras(regras, id)       as linhas YAML do campo `regras` (nenhuma, se ela não respondeu)
//   lerRegrasYaml(texto)           o campo lido de volta, como o motor lê (fila_roteiro.ler_regras)
//   problemaRegras(regras, id)     '' ou o motivo, como o motor confere (fila_roteiro.problema_regras)
//   regraLegivel(pergunta)         a regra, onde ela mora e o texto novo em português simples

export const RESPOSTAS_REGRA = Object.freeze(['mudar', 'so_neste', 'manter']);
export const ROTULO_RESPOSTA = Object.freeze({ mudar: 'Mudar a regra', so_neste: 'Só neste vídeo', manter: 'Manter' });
/** O que cada resposta faz, em uma linha (a tela mostra embaixo dos botões). */
export const EFEITO_RESPOSTA = Object.freeze({
  mudar: 'A regra muda (para os próximos vídeos também) e o motor faz o seu pedido.',
  so_neste: 'A regra continua como está; só neste vídeo o motor faz o seu pedido.',
  manter: 'A regra continua como está e o pedido fica como o motor fez.',
});

const TITULO = /^##\s+Regra que esbarra no seu pedido\s*$/i;
const RID = /^(S\d{2}-\d{2}|T\d{2}(?:-\d{2})?|R\d{3})-R(\d+)$/;
// a pergunta de sempre (bin/regras.py: PERGUNTA e o fim de cada DE_NOVO); numa pergunta feita de novo, o porquê vem antes
const PERGUNTA = /\s*mudar a regra, fazer s[óo] neste v[íi]deo ou manter\?\s*$/i;
const MAX = { pedido: 1000, onde: 120, arquivo: 120, texto: 800, feito: 400, pergunta: 400 };
const MAX_PEDIDO = 1000;   // observacoes (storyboard e prévia) e pedido (roteiro)

const linha1 = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '');

/** O id de uma pergunta (`<id>-R<n>`) e, com `id`, de uma pergunta deste roteiro. */
export function ridValido(rid, id = '') {
  const m = String(rid ?? '').match(RID);
  return !!m && (!id || m[1] === id);
}
const numeroDoRid = (rid) => Number(String(rid).match(RID)?.[2]) || 0;

/** `"<pedido>" (<onde>)` → {pedido, onde}; sem o formato, o texto todo é o pedido. */
function lerPedido(v) {
  const m = v.match(/^"(.*)"\s*\(([^()]*)\)\s*$/);
  if (m) return { pedido: linha1(m[1], MAX.pedido), onde: linha1(m[2], MAX.onde) };
  return { pedido: linha1(v.replace(/^"(.*)"$/, '$1'), MAX.pedido), onde: '' };
}

/** `<arquivo>:<linha> — "<texto>"` → {arquivo, linha, regra}; sem o formato, o texto todo é a regra. */
function lerRegra(v) {
  const m = v.match(/^(\S+?):(\d+)\s+[—–-]\s+"(.*)"\s*$/);
  if (m) return { arquivo: linha1(m[1], MAX.arquivo), linha: Number(m[2]) || 0, regra: linha1(m[3], MAX.texto) };
  return { arquivo: '', linha: 0, regra: linha1(v, MAX.texto) };
}

/**
 * A seção "## Regra que esbarra no seu pedido" (de um storyboard, das notas, de um rascunho ou dos ganchos) → as
 * perguntas, na ordem do arquivo. Só os blocos `### <id>-R<n>` (com `id`, só os deste roteiro; um id repetido vale uma
 * vez) e só as linhas pedido, regra, feito agora, texto novo e pergunta. Bloco sem pedido, regra ou texto novo fica de
 * fora (não dá para responder). `motivo`: numa pergunta feita de novo, o porquê que o motor escreveu antes da pergunta.
 */
export function lerPerguntasRegra(texto, id = '') {
  const out = [];
  const vistos = new Set();
  let dentro = false;
  let atual = null;
  for (const bruta of String(texto ?? '').replace(/^﻿/, '').split(/\r?\n/)) {
    const l = bruta.trim();
    if (/^#{1,2}\s/.test(l)) { dentro = TITULO.test(l); atual = null; continue; }
    if (!dentro) continue;
    const h3 = l.match(/^###\s+(\S+)\s*$/);
    if (h3) {
      atual = null;
      if (ridValido(h3[1], id) && !vistos.has(h3[1])) {
        vistos.add(h3[1]);
        atual = { rid: h3[1], pedido: '', onde: '', arquivo: '', linha: 0, regra: '', feito: '', novo: '', pergunta: '', motivo: '' };
        out.push(atual);
      }
      continue;
    }
    if (/^#/.test(l)) { atual = null; continue; }
    if (!atual) continue;
    const c = l.match(/^(pedido|regra|feito agora|texto novo|pergunta)\s*:\s*(.*)$/i);
    if (!c) continue;
    const k = c[1].toLowerCase();
    const v = c[2].trim();
    if (k === 'pedido' && !atual.pedido) Object.assign(atual, lerPedido(v));
    else if (k === 'regra' && !atual.regra) Object.assign(atual, lerRegra(v));
    else if (k === 'feito agora' && !atual.feito) atual.feito = linha1(v, MAX.feito);
    else if (k === 'texto novo' && !atual.novo) atual.novo = linha1(v.replace(/^"(.*)"$/, '$1'), MAX.texto);
    else if (k === 'pergunta' && !atual.pergunta) atual.pergunta = linha1(v, MAX.pergunta);
  }
  for (const q of out) q.motivo = q.pergunta.replace(PERGUNTA, '').trim();
  return out.filter((q) => q.pedido && q.regra && q.novo);
}

/** O texto sem a seção de regras (do título até o próximo "## " ou "# "): o resumo do motor na tela. */
export function semSecaoRegras(texto) {
  const out = [];
  let pulando = false;
  for (const linha of String(texto ?? '').split(/\r?\n/)) {
    const l = linha.trim();
    if (TITULO.test(l)) { pulando = true; continue; }
    if (pulando && /^#{1,2}\s/.test(l)) pulando = false;
    if (!pulando) out.push(linha);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** "IG, quadro 4" → "Instagram, quadro 4"; "ajustes v2" → "ajustes da prévia v2"; o resto, como veio. */
export function ondeLegivel(onde) {
  const s = String(onde ?? '').trim();
  let m = s.match(/^(IG|TT),\s*quadro\s+(\d+)$/i);
  if (m) return `${m[1].toUpperCase() === 'IG' ? 'Instagram' : 'TikTok'}, quadro ${m[2]}`;
  m = s.match(/^ajustes\s+v(\d+)$/i);
  if (m) return `ajustes da prévia v${m[1]}`;
  return s;
}

const NOME_DO_ARQUIVO = {
  'estilo/limites.md': 'Limites do estilo',
  'estilo/regras-de-edicao.md': 'Regras de edição',
  'roteiro/regras.md': 'Regras do roteiro',
};
const ARQUIVO_FIXO = 'estilo/travas.json';

function json(v) {
  try { return JSON.parse(v); } catch { return undefined; }
}

/** As regras fixas do estilo (`<chave> = <valor em JSON>`), em português simples: nada de chave nem de JSON. */
function regraFixa(q) {
  const m = q.regra.match(/^([\w.-]+)\s*=\s*([\s\S]*)$/);
  const chave = m ? m[1] : '';
  const valor = m ? json(m[2]) : undefined;
  const sai = !!chave && q.novo === `${chave} sai da trava`;
  const mn = q.novo.match(/^([\w.-]+)\s*=\s*([\s\S]*)$/);
  const novo = mn && mn[1] === chave ? json(mn[2]) : undefined;
  if (chave.startsWith('removidos.')) {
    const oQue = linha1(valor && typeof valor === 'object' && valor.o_que ? valor.o_que : chave.slice('removidos.'.length), 200);
    return {
      literal: false,
      onde: 'Recursos que o motor deixou de usar',
      texto: `O motor não usa ${oQue}.`,
      novo: sai || novo === null ? `O motor volta a poder usar ${oQue}.` : `${oQue}: ${linha1(mn ? mn[2] : q.novo, MAX.texto)}`,
    };
  }
  if (chave === 'musica.permitida' && typeof valor === 'boolean') {
    const texto = (b) => (b ? 'Os vídeos podem ter música.' : 'Os vídeos saem sem música.');
    return { literal: false, onde: 'Música nos vídeos', texto: texto(valor), novo: typeof novo === 'boolean' ? texto(novo) : linha1(q.novo, MAX.texto) };
  }
  return {
    literal: true,
    onde: 'Configuração fixa do estilo',
    texto: q.regra,
    novo: sai ? `${chave} deixa de valer` : q.novo.replace(/\btravas?\b/gi, 'regra'),
  };
}

/**
 * Como a tela mostra a regra: {literal, onde, texto, novo}. Os arquivos de texto aparecem com o nome e a linha
 * ("Limites do estilo (estilo/limites.md, linha 28)") e o texto exato (literal: entre aspas); a configuração fixa do
 * estilo, em palavras (literal: false).
 */
export function regraLegivel(q) {
  if (q?.arquivo === ARQUIVO_FIXO) return regraFixa(q);
  const nome = NOME_DO_ARQUIVO[q?.arquivo];
  const lugar = q?.arquivo ? `${q.arquivo}${q.linha ? `, linha ${q.linha}` : ''}` : '';
  return { literal: true, onde: nome ? `${nome} (${lugar})` : lugar, texto: q?.regra || '', novo: q?.novo || '' };
}

/* ------------------------------------------------------------------ respostas e decisão */

/** Chave das respostas dela na memória (estado.respostasRegra): uma por decisão (tipo, roteiro e versão). */
export const chaveRespostas = (tipo, id, versao) => `${tipo}:${String(id ?? '').trim()}:v${Number(versao) || 0}`;

/** A resposta libera o pedido que esperava a regra? ("Mudar a regra" e "Só neste vídeo" sim; "Manter" não.) */
export const liberaPedido = (resposta) => resposta === 'mudar' || resposta === 'so_neste';

/** As respostas dela às perguntas que estão na tela → [{id, resposta}], na ordem das perguntas. Só as respondidas. */
export function regrasRespondidas(perguntas = [], respostas = {}, id = '') {
  const out = [];
  for (const q of perguntas || []) {
    const r = respostas?.[q?.rid];
    if (RESPOSTAS_REGRA.includes(r) && ridValido(q.rid, id) && !out.some((x) => x.id === q.rid)) out.push({ id: q.rid, resposta: r });
  }
  return out;
}

/**
 * O pedido que vai junto quando nada mais vai (o arquivo precisa de um pedido): os pedidos que esperavam a regra e que
 * a resposta dela libera. '' se nenhuma resposta libera.
 */
export function textoDoPedidoDasRegras(perguntas = [], regras = []) {
  const livres = (regras || []).filter((r) => liberaPedido(r.resposta))
    .map((r) => (perguntas || []).find((q) => q.rid === r.id)).filter(Boolean);
  if (!livres.length) return '';
  const um = livres.length === 1;
  const lista = livres.map((q) => `"${q.pedido}"${q.onde ? ` (${q.onde})` : ''}`).join('; ');
  const texto = `${um ? 'Fazer o pedido que esperava' : 'Fazer os pedidos que esperavam'} a resposta sobre a regra: ${lista}.`;
  return texto.length <= MAX_PEDIDO ? texto : `Fazer os ${livres.length} pedidos que esperavam a resposta sobre a regra.`;
}

/**
 * O que vai de fato numa decisão com as respostas dela. `alvo`: 'storyboard' | 'previa' | 'roteiro' | 'gancho'.
 * "Aprovar" com alguma resposta que libera o pedido ("Mudar a regra" ou "Só neste vídeo") vira pedido de mudança
 * (ajustar no storyboard e na prévia, mudar no roteiro): aprovado, o pedido não sairia nesta versão (o motor o deixaria
 * como pendência nas notas) e, na prévia, a aprovação nem leva o campo `regras`. A escolha do gancho não vira nada.
 * → {decisao, regras (as que vão no arquivo), virou, pedido (o texto de textoDoPedidoDasRegras)}.
 */
export function decisaoComRegras({ decisao, perguntas = [], respostas = {}, id = '', alvo = '' } = {}) {
  const regras = regrasRespondidas(perguntas, respostas, id);
  const virou = alvo !== 'gancho' && decisao === 'aprovar' && regras.some((r) => liberaPedido(r.resposta));
  const final = virou ? (alvo === 'roteiro' ? 'mudar' : 'ajustar') : decisao;
  // a aprovação da prévia (<id> aprovado.md) não tem o campo: só "Manter" chega aqui, e manter não muda nada
  const noArquivo = alvo === 'previa' && final === 'aprovar' ? [] : regras;
  return { decisao: final, regras: noArquivo, virou, pedido: textoDoPedidoDasRegras(perguntas, regras) };
}

/** Os itens a mais da janela de confirmação ({chave, rotulo, texto|lista}, texto puro: a janela escapa). */
export function extrasDasRegras(perguntas = [], regras = [], virou = false) {
  const itens = [];
  if (virou) {
    itens.push({ chave: 'regra-virou', rotulo: 'Por que vai como pedido de mudança',
      texto: 'Você escolheu fazer o pedido que esperava a regra. Aprovando agora, ele ficaria de fora; por isso o app manda como pedido de mudança, e você aprova a versão nova depois.' });
  }
  const lista = (regras || []).map((r) => {
    const q = (perguntas || []).find((x) => x.rid === r.id);
    return q ? `${ROTULO_RESPOSTA[r.resposta]}: “${q.pedido}”` : '';
  }).filter(Boolean);
  if (lista.length) itens.push({ chave: 'regras', rotulo: 'Suas respostas sobre a regra', lista });
  return itens;
}

/* ------------------------------------------------------------------ YAML */

/** As respostas que podem ir num arquivo: pergunta deste roteiro, resposta da lista, uma vez cada, em ordem → [{id, resposta}]. */
export function regrasValidas(regras = [], id = '') {
  const vistas = new Set();
  return (regras || []).filter((r) => {
    const valida = ridValido(r?.id, id) && RESPOSTAS_REGRA.includes(r?.resposta) && !vistas.has(r.id);
    if (valida) vistas.add(r.id);
    return valida;
  }).map((r) => ({ id: r.id, resposta: r.resposta })).sort((a, b) => numeroDoRid(a.id) - numeroDoRid(b.id));
}

/** As linhas do campo `regras` (formatos.md do motor): só id e resposta; nenhuma linha sem resposta válida. */
export function linhasRegras(regras = [], id = '') {
  const ok = regrasValidas(regras, id);
  if (!ok.length) return [];
  return ['regras:', ...ok.flatMap((r) => [`  - id: ${r.id}`, `    resposta: ${r.resposta}`])];
}

function valorYaml(v) {
  const s = String(v ?? '').trim();
  const q = s.match(/^"((?:[^"\\]|\\.)*)"/) || s.match(/^'([^']*)'/);
  if (q) return q[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
  return s.replace(/\s+#.*$/, '').trim();
}

/** O campo `regras` de uma decisão → [{id, resposta}], como o motor lê (resposta sem acento, "só neste" → so_neste). */
export function lerRegrasYaml(texto) {
  const fm = String(texto ?? '').match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  const itens = [];
  let dentro = false;
  let atual = null;
  for (const linha of fm ? fm[1].split(/\r?\n/) : []) {
    if (/^regras\s*:\s*(\[\s*\])?\s*(#.*)?$/.test(linha)) { dentro = true; atual = null; continue; }
    if (dentro && linha.trim() && !/^[ \t-]/.test(linha)) dentro = false;
    if (!dentro) continue;
    const m = linha.match(/^\s*(-\s+)?([A-Za-z_]+)\s*:\s*(.*)$/);
    if (!m) continue;
    if (m[1] || !atual) { atual = {}; itens.push(atual); }
    const k = m[2].toLowerCase();
    if ((k === 'id' || k === 'resposta') && !(k in atual)) atual[k] = valorYaml(m[3]);
  }
  return itens.map((it) => ({
    id: String(it.id || '').trim(),
    resposta: semAcento(String(it.resposta || '').trim().toLowerCase()).replace(/[\s-]+/g, '_'),
  }));
}

/** '' se cada resposta é de uma pergunta deste roteiro e é mudar, so_neste ou manter; senão o motivo (como o motor). */
export function problemaRegras(regras = [], id = '') {
  for (const r of regras || []) {
    if (!ridValido(r?.id, id)) return 'regras: id de pergunta inválido';
    if (!RESPOSTAS_REGRA.includes(r?.resposta)) return 'regras: resposta fora de mudar|so_neste|manter';
  }
  return '';
}
