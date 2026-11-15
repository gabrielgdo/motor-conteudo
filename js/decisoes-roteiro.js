// Decisão sobre um roteiro (rotina roteirista-decisao): regra PURA, sem DOM e sem rede.
//
//   estadoDaDecisaoRoteiro({execucoes, projeto, agora, local}) → o estado da última decisão do id,
//   lido das linhas roteirista-decisao (resumo + status) e dos rascunhos do Drive:
//     livre            nenhuma decisão registrada (ou a última não diz nada)
//     em-revisao       "mudar vN" na fila / processando, ou `ok` há menos de 2 h sem a v(N+1)
//     revisada         a v(N+1) (ou mais nova) já está no Drive
//     sem-versao-nova  "mudar vN" `ok` há 2 h ou mais e a v(N+1) não chegou: desbloqueia, com aviso
//     aprovacao        "aprovar vN" aberta, ou `ok` até o "<id> - <título>.md" aparecer
//     aprovado         "aprovar vN" `ok` e o roteiro final já no Drive
//     recusado         "recusar vN" aberta ou `ok`
//     falhou           última linha `erro` / `parcial` / `travada` / `recusado-pela-trava`
//     parece-travada   última linha aberta há 2 h ou mais (ou sem início registrado)
//   `bloqueia`: Aprovar / Pedir mudança / Recusar ficam desligados (com `explicacao`).
//
// O resumo vem da ponte ("mudar v2", "aprovar v2", "recusar v2 (ética)", às vezes com o prefixo
// "rodar de novo; … marcada como travada; ") ou, quando termina, SOBRESCRITO pelo Roteirista:
// "S46-01 v2 gravado: …" (a v2 nasceu de um "mudar v1") e "S46-01 v2 aprovada: gravado …".
//
// As recusas da ponte (ja-pedida / ja-decidido em ponte/Code.gs, planejarExecucao) seguem
// bloqueioDaDecisao daqui; tests/ponte.test.mjs confere a paridade.

import { horaCurta, formatarDataHora } from './parse.js';

export const LIMITE_ABERTA_MS = 2 * 60 * 60 * 1000; // = TRAVA_MS (controle.js)
const ABERTOS = new Set(['pedido', 'rodando', 'aguardando']);
const FALHAS = new Set(['erro', 'parcial', 'travada', 'recusado-pela-trava']);
export const ESTADOS_DECISAO = Object.freeze(['livre', 'em-revisao', 'revisada', 'sem-versao-nova', 'aprovacao', 'aprovado', 'recusado', 'falhou', 'parece-travada']);
const BLOQUEIAM = new Set(['em-revisao', 'aprovacao', 'aprovado', 'recusado']);

const ms = (d) => (d instanceof Date ? d.getTime() : d == null || d === '' ? NaN : new Date(d).getTime());
const texto = (v) => String(v ?? '').trim();
const mesmoId = (a, b) => texto(a).toUpperCase() === texto(b).toUpperCase() && texto(a) !== '';

/**
 * Resumo de uma linha roteirista-decisao → {decisao:'aprovar'|'mudar'|'recusar', versao, nova?} ou null.
 * `nova`: a versão que o Roteirista gravou ("v2 gravado" = mudar v1, nova 2).
 */
export function lerDecisaoDoResumo(resumo) {
  const s = texto(resumo).toLowerCase();
  if (!s) return null;
  let m = s.match(/\baprovar v(\d+)\b/) || s.match(/\bv(\d+) aprovad[ao]s?\b/);
  if (m) return { decisao: 'aprovar', versao: Number(m[1]) };
  m = s.match(/\brecusar v(\d+)\b/) || s.match(/\bv(\d+) recusad[ao]s?\b/);
  if (m) return { decisao: 'recusar', versao: Number(m[1]) };
  m = s.match(/\bmudar v(\d+)\b/);
  if (m) return { decisao: 'mudar', versao: Number(m[1]) };
  m = s.match(/\bv(\d+) gravad[ao]s?\b/);
  if (m && Number(m[1]) > 1) return { decisao: 'mudar', versao: Number(m[1]) - 1, nova: Number(m[1]) };
  return null;
}

const maisNovaPrimeiro = (a, b) => (ms(b.inicioData) || -Infinity) - (ms(a.inicioData) || -Infinity) || (b._linha || 0) - (a._linha || 0);

/** Linhas roteirista-decisao do id (também as de teste: o id T só casa com T), mais nova primeiro. */
export function linhasDaDecisao(execucoes, id) {
  return (execucoes || []).filter((e) => e && e.rotina === 'roteirista-decisao' && mesmoId(e.id_alvo, id)).sort(maisNovaPrimeiro);
}

/** Quando a linha fechou (fim; sem fim, o início). */
const fimDe = (l) => (Number.isFinite(ms(l?.fimData)) ? ms(l.fimData) : ms(l?.inicioData));

/**
 * A ponte aceitaria esta decisão? Mesma regra de ponte/Code.gs (decisaoRepetida):
 *   ja-decidido  já há "aprovar"/"recusar" `ok` para o id (qualquer versão)
 *   ja-pedida    "mudar vN" para o mesmo N, aberto ou `ok` há menos de 2 h
 * A linha aberta de qualquer decisão também trava pela trava por id (avaliarTrava), que vem antes.
 * → {livre:true} | {livre:false, codigo, mensagem, linha}.
 */
export function bloqueioDaDecisao(execucoes, { id, decisao, versao, agora = new Date() } = {}) {
  const t = ms(agora);
  const linhas = linhasDaDecisao(execucoes, id);
  for (const l of linhas) {
    const d = lerDecisaoDoResumo(l.resumo);
    if (d && l.status === 'ok' && (d.decisao === 'aprovar' || d.decisao === 'recusar')) {
      return { livre: false, codigo: 'ja-decidido', mensagem: mensagemJaDecidido(id, d), linha: l };
    }
  }
  if (decisao === 'mudar') {
    const v = Number(versao);
    for (const l of linhas) {
      const d = lerDecisaoDoResumo(l.resumo);
      if (!d || d.decisao !== 'mudar' || d.versao !== v) continue;
      const aberta = ABERTOS.has(l.status);
      const okRecente = l.status === 'ok' && Number.isFinite(fimDe(l)) && t - fimDe(l) < LIMITE_ABERTA_MS;
      if (aberta || okRecente) return { livre: false, codigo: 'ja-pedida', mensagem: mensagemJaPedida(id, v), linha: l };
    }
  }
  return { livre: true };
}

export const mensagemJaDecidido = (id, d) => `O roteiro ${id} já foi ${d.decisao === 'aprovar' ? 'aprovado' : 'recusado'} (v${d.versao}). Uma nova decisão não vai ao Roteirista.`;
export const mensagemJaPedida = (id, v) => `A mudança na v${v} do ${id} já foi pedida. Espere a v${v + 1} chegar (ou 2 h) antes de pedir de novo.`;

/**
 * chave_idem ESTÁVEL da decisão: `roteirista-decisao-<id>-<decisão>-v<N>-<n>`, n = 1 + as linhas
 * roteirista-decisao do id (também as de teste). Dois toques ou dois aparelhos mandam a mesma
 * chave e a ponte não duplica; depois de uma falha, a linha a mais muda o n (chave nova).
 */
export function chaveIdemDecisao({ id, decisao, versao } = {}, execucoes = []) {
  const n = 1 + linhasDaDecisao(execucoes, id).length;
  return `roteirista-decisao-${texto(id).toUpperCase()}-${decisao}-v${Number(versao) || 0}-${n}`.replace(/[^A-Za-z0-9-]/g, '').slice(0, 80);
}

/** Versões do rascunho do projeto (números, em ordem). Aceita `versoesRoteiro`, `rascunhos` ou `versaoRoteiro`. */
export function versoesDo(projeto) {
  const lista = Array.isArray(projeto?.versoesRoteiro) ? projeto.versoesRoteiro
    : Array.isArray(projeto?.rascunhos) ? projeto.rascunhos.map((r) => (typeof r === 'number' ? r : r?.v))
      : projeto?.versaoRoteiro ? [projeto.versaoRoteiro] : [];
  return [...new Set(lista.map(Number).filter((v) => Number.isInteger(v) && v >= 1))].sort((a, b) => a - b);
}

/** O roteiro final ("<id> - <título>.md") já está no Drive? */
const temFinal = (projeto) => !!(projeto?.temFinal || (projeto?.etapa && !['rascunho'].includes(projeto.etapa)));

/** O registro otimista {desde, chave, decisao, versao} ainda vale? (sem linha com a chave e dentro de 2 h) */
function localValido(local, execucoes, t) {
  if (!local || !local.decisao) return false;
  const desde = ms(local.desde);
  if (Number.isFinite(desde) && t - desde >= LIMITE_ABERTA_MS) return false;
  const chave = texto(local.chave);
  return !(chave && (execucoes || []).some((e) => texto(e?.chave_idem) === chave));
}

function textoDaFalha(l) {
  if (l.status === 'recusado-pela-trava') return texto(l.erro) || 'outra decisão deste roteiro estava em andamento.';
  if (l.status === 'travada') return texto(l.erro) || 'a rodada parou sem terminar.';
  return texto(l.erro) || (l.status === 'parcial' ? 'o Roteirista terminou só uma parte.' : 'o Roteirista não conseguiu terminar.');
}

/**
 * Estado da decisão do roteiro → {estado, bloqueia, decisao, versao, nova, fase, desde, texto,
 * explicacao, linha, otimista}. Textos puros: esc() na tela.
 *   projeto: o roteiro (id, versoesRoteiro|rascunhos|versaoRoteiro, temFinal|etapa)
 *   local:   estado.decisoesEnviadas[id] = {desde, chave, decisao, versao} logo depois de a ponte aceitar
 */
export function estadoDaDecisaoRoteiro({ execucoes = [], projeto = {}, agora = new Date(), local = null } = {}) {
  const t = ms(agora);
  const id = texto(projeto?.id);
  const versoes = versoesDo(projeto);
  const ultimaV = versoes.length ? versoes[versoes.length - 1] : 0;
  const linhas = linhasDaDecisao(execucoes, id);
  const livre = { estado: 'livre', bloqueia: false, decisao: '', versao: 0, nova: 0, fase: '', desde: null, texto: '', explicacao: '', linha: null, otimista: false };

  // Registro otimista: vale como uma linha `pedido` até a releitura de Execuções trazer a linha.
  let ultima = linhas[0] || null;
  let otimista = false;
  if (localValido(local, execucoes, t)) {
    const desdeLocal = ms(local.desde);
    const linhaDepois = ultima && Number.isFinite(ms(ultima.inicioData)) && ms(ultima.inicioData) >= desdeLocal - 60_000;
    if (!linhaDepois) {
      ultima = { rotina: 'roteirista-decisao', id_alvo: id, status: 'pedido', resumo: `${local.decisao} v${local.versao}`, inicioData: Number.isFinite(desdeLocal) ? new Date(desdeLocal) : null, _otimista: true };
      otimista = true;
    }
  }

  // Aprovar / recusar concluído vence tudo (a ponte recusa qualquer decisão depois: ja-decidido).
  const concluida = linhas.find((l) => l.status === 'ok' && ['aprovar', 'recusar'].includes(lerDecisaoDoResumo(l.resumo)?.decisao));
  if (concluida) {
    const d = lerDecisaoDoResumo(concluida.resumo);
    const base = { ...livre, decisao: d.decisao, versao: d.versao, desde: concluida.fimData || concluida.inicioData || null, linha: concluida, bloqueia: true };
    if (d.decisao === 'recusar') return { ...base, estado: 'recusado', texto: `Recusado (v${d.versao})`, explicacao: `Você recusou a v${d.versao}. Este roteiro não recebe outra decisão pelo app.` };
    if (temFinal(projeto)) return { ...base, estado: 'aprovado', texto: `Aprovado (v${d.versao})`, explicacao: `Você aprovou a v${d.versao}.` };
    return { ...base, estado: 'aprovacao', fase: 'ok', texto: `Aprovado (v${d.versao}): o Roteirista está fechando`, explicacao: `Você aprovou a v${d.versao}. O Roteirista está gravando o roteiro final; ele aparece em "Para gravar".` };
  }

  if (!ultima) return livre;
  const d = lerDecisaoDoResumo(ultima.resumo);
  const base = { ...livre, decisao: d?.decisao || '', versao: d?.versao || 0, linha: ultima._otimista ? null : ultima, otimista };
  const inicio = ms(ultima.inicioData);
  // A versão nova pode chegar antes de a linha fechar: "Revisada" já vale.
  const revisada = d?.decisao === 'mudar' && ultimaV > d.versao;
  if (revisada) {
    return { ...base, estado: 'revisada', nova: ultimaV, desde: ultima.fimData || ultima.inicioData || null, texto: `Revisada (v${ultimaV}, a partir da v${d.versao})` };
  }

  if (ABERTOS.has(ultima.status)) {
    const velha = !otimista && (!Number.isFinite(inicio) || t - inicio >= LIMITE_ABERTA_MS);
    const desde = ultima.inicioData || null;
    if (velha) {
      return { ...base, estado: 'parece-travada', desde, texto: desde ? `Parece travada: aberta desde ${formatarDataHora(desde)}` : 'Parece travada: a rodada não registrou o fim', explicacao: 'A decisão anterior não terminou em 2 h. Ao confirmar outra, você pode marcá-la como travada.' };
    }
    const fase = ultima.status === 'rodando' ? 'processando' : 'na-fila';
    const h = desde ? horaCurta(desde) : '';
    const comoVai = fase === 'processando' ? `Processando${h ? ` desde ${h}` : ''}` : `Na fila${h ? ` desde ${h}` : ''}`;
    if (d?.decisao === 'aprovar') {
      return { ...base, estado: 'aprovacao', fase, desde, bloqueia: true, texto: `Aprovado (v${d.versao}): o Roteirista está fechando`, explicacao: `Você aprovou a v${d.versao}. ${comoVai}.` };
    }
    if (d?.decisao === 'recusar') {
      return { ...base, estado: 'recusado', fase, desde, bloqueia: true, texto: `Recusa enviada (v${d.versao})`, explicacao: `Você recusou a v${d.versao}. ${comoVai}.` };
    }
    const n = d?.versao || ultimaV || 1;
    return { ...base, estado: 'em-revisao', fase, desde, bloqueia: true, versao: n, nova: n + 1, texto: `Em revisão: preparando a v${n + 1}`, explicacao: `Você pediu mudança na v${n}. ${comoVai}. Os botões voltam quando a v${n + 1} chegar.` };
  }

  if (ultima.status === 'ok') {
    if (d?.decisao !== 'mudar') return livre;
    const fim = fimDe(ultima);
    const n = d.versao;
    if (Number.isFinite(fim) && t - fim < LIMITE_ABERTA_MS) {
      return { ...base, estado: 'em-revisao', fase: 'ok', desde: ultima.fimData || ultima.inicioData || null, bloqueia: true, nova: n + 1, texto: `Em revisão: preparando a v${n + 1}`, explicacao: `O Roteirista terminou o pedido de mudança na v${n}; a v${n + 1} ainda não apareceu no Drive. Os botões voltam quando ela chegar (ou em 2 h).` };
    }
    return { ...base, estado: 'sem-versao-nova', desde: ultima.fimData || ultima.inicioData || null, nova: n + 1, texto: `O Roteirista terminou, mas a v${n + 1} não chegou`, explicacao: `A mudança na v${n} foi pedida há mais de 2 h e a v${n + 1} não apareceu no Drive. Você pode pedir de novo ou decidir a v${ultimaV || n}.` };
  }

  if (FALHAS.has(ultima.status)) {
    const oQue = d?.decisao === 'aprovar' ? 'A aprovação falhou' : d?.decisao === 'recusar' ? 'A recusa falhou' : 'A revisão falhou';
    return { ...base, estado: 'falhou', desde: ultima.fimData || ultima.inicioData || null, texto: `${oQue}: ${textoDaFalha(ultima)}`, explicacao: 'Nada mudou no roteiro. Você pode pedir de novo.' };
  }
  return livre;
}

/**
 * Itens da janela de confirmação: a decisão e, quando a versão decidida não é a mais nova, o aviso
 * claro "Você está decidindo a v2 (existe a v3, mais nova)" (decisões do coordenador, item 4).
 */
export function extrasDaDecisao(plano, versoes = []) {
  const v = Number(plano?.payload?.versao);
  const lista = (versoes || []).map(Number).filter(Number.isFinite);
  const ultima = lista.length ? Math.max(...lista) : v;
  const itens = [{ chave: 'decisao', rotulo: 'Sua decisão', texto: plano?.resumo || '' }];
  if (Number.isFinite(ultima) && v < ultima) {
    itens.push({ chave: 'versao', rotulo: 'Atenção: não é a versão mais nova', texto: `Você está decidindo a v${v} (existe a v${ultima}, mais nova).` });
  }
  return itens;
}

/** Aviso depois de a ponte aceitar a decisão (a tela vai para Roteiros). */
export function textoDaDecisaoAceita(id, payload = {}) {
  const v = Number(payload.versao) || '';
  if (payload.decisao === 'aprovar') return `${id}: aprovação da v${v} enviada ao Roteirista. Ele fecha o roteiro final.`;
  if (payload.decisao === 'mudar') return `${id}: pedido de mudança na v${v} enviado. Em revisão: o Roteirista prepara a v${v + 1}.`;
  return `${id}: recusa da v${v} enviada ao Roteirista.`;
}

/** Tom do selo de cada estado (classes de selo do app). */
export const TOM_DECISAO = Object.freeze({
  'em-revisao': 'acao', revisada: 'ok', 'sem-versao-nova': 'alerta', aprovacao: 'ok', aprovado: 'ok', recusado: 'neutro', falhou: 'alerta', 'parece-travada': 'alerta',
});
