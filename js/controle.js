// CONTROLE MANUAL (puro: sem DOM, sem rede, testável com `node --test`).
//
//   lerExecucoes(linhas)        aba Execuções → objetos (cabeçalho tolerante, datas de São Paulo)
//   ROTINAS                     catálogo FECHADO: bot, rótulo, grupo de trava, agenda, textos da
//                               janela de confirmação (PLANO 5.2 e 10)
//   avaliarTrava / avaliarProtecao / avaliarDisparo   podem disparar agora? (agora injetado)
//   estatisticasTempo           "média de X min nas últimas N rodadas" | "ainda sem medição"
//   janelaConfirmacao           os itens da janela "Rodar agora?"
//   novaChaveIdem, novoIdExecucao, idLote, novaExecucao   ids e registro de uma rodada
//   podeDecidir / podeDisparar  só ALLOWED[0] decide; qualquer conta de ALLOWED vê e dispara
//
// Quem cede é sempre o manual: rodadas agendadas nunca são bloqueadas (a trava e a janela de
// proteção só valem para o disparo manual). A ponte no Apps Script aplica as mesmas regras sob
// LockService; aqui elas servem para a tela avisar antes de pedir.

import { ALLOWED } from './config.js';
import {
  lerTabela, linhaNaOrdem, lerDataHora, momentoNoFuso, dataNoFuso, horaCurta, formatarDataHora,
  normalizarCabecalho, ehTeste,
} from './parse.js';

/* ------------------------------------------------------ aba Execuções */

export const COLUNAS_EXECUCOES = [
  'id_execucao', 'chave_idem', 'bot', 'rotina', 'origem', 'quem', 'id_alvo', 'id_lote',
  'etapa_evento', 'inicio', 'fim', 'status', 'resumo', 'erro', 'link', 'teste',
];

// Nomes sugeridos pelos bots (Radar: quem_disparou; Diretor: quando, gatilho, resultado, detalhe,
// id, evento/etapa) → colunas unificadas da seção 5.1.
export const SINONIMOS_EXECUCOES = {
  quem_disparou: 'quem',
  gatilho: 'origem',
  quando: 'inicio',
  resultado: 'status',
  detalhe: 'resumo',
  id: 'id_alvo',
  evento: 'etapa_evento',
  etapa: 'etapa_evento',
};

export const STATUS_EXECUCAO = ['pedido', 'rodando', 'ok', 'parcial', 'erro', 'aguardando', 'travada', 'recusado-pela-trava'];
const ABERTOS = new Set(['pedido', 'rodando']);
// Fecham a rodada agendada para a janela de proteção. `travada` também: é o caminho explícito
// ("Marcar como travada e rodar de novo") para sair de uma rodada que nunca terminou.
const FECHADOS = new Set(['ok', 'parcial', 'erro', 'travada']);

const comHifen = (v) => normalizarCabecalho(v).replace(/[\s_]+/g, '-');

const ORIGENS = { agendada: 'agendada', agendado: 'agendada', cron: 'agendada', 'manual-app': 'manual-app', manual: 'manual-app', app: 'manual-app', chat: 'chat', vigia: 'vigia' };

function normalizarOrigem(v) {
  const k = comHifen(v);
  return ORIGENS[k] || k;
}

const SIM = new Set(['sim', 's', 'yes', 'true', 'verdadeiro', '1', 'x']);

/**
 * Linhas da aba Execuções (matriz alinhada à A1) → {encontrado, cabecalho, execucoes}.
 * Cada execução tem as 16 colunas como texto (status, origem e rotina normalizados), `teste`
 * booleano (coluna "sim" ou id T), `inicioData`/`fimData` (Date ou null) e `_linha`.
 */
export function lerExecucoes(linhas) {
  const t = lerTabela(linhas, { colunas: COLUNAS_EXECUCOES, sinonimos: SINONIMOS_EXECUCOES, minimo: 3 });
  const execucoes = t.registros.map((r) => ({
    ...r,
    bot: normalizarCabecalho(r.bot),
    rotina: comHifen(r.rotina),
    origem: normalizarOrigem(r.origem),
    quem: r.quem.toLowerCase(),
    status: comHifen(r.status),
    teste: SIM.has(normalizarCabecalho(r.teste)) || ehTeste(r.id_alvo),
    inicioData: lerDataHora(r.inicio),
    fimData: lerDataHora(r.fim),
  }));
  return { encontrado: t.encontrado, cabecalho: t.cabecalho, execucoes };
}

/* ----------------------------------------------------- catálogo fechado */

const CUSTO_BOT = 'Usa a cota do seu plano Grok Bot; custo por rodada não conhecido.';
const CUSTO_MOTOR = 'Usa o Claude Code (modelo opus) com o login da sua conta Claude e conta no limite de 5 h do plano Pro. Se esse limite estourar, a rodada conta como falha.';
const LIMITE_X = 'X: 30 leituras/min e 1000/dia.';
const LIMITE_NAVEGADOR = 'O navegador do Radar faz uma tarefa por vez.';

const TODO_DIA = [0, 1, 2, 3, 4, 5, 6];

/**
 * Rotinas que o app conhece. Só as `disparavel` podem ir à ponte; as do motor são só para leitura
 * (o app nunca dispara o motor: ele grava o arquivo de entrada e o vigia faz o resto).
 * `grupo`: grupo de trava (PLANO 5.2); 'roteirista' vira `roteirista|<id>` em grupoDeTrava.
 * `agenda`: {dias (0 = domingo), hora, minuto} no fuso de São Paulo, ou null.
 */
export const ROTINAS = Object.freeze({
  'radar-diario': {
    bot: 'radar', rotulo: 'Radar diário', grupo: 'radar', disparavel: true, precisaId: false,
    agenda: { dias: TODO_DIA, hora: 7, minuto: 0 },
    confirmacao: {
      oQue: 'Radar diário: pesquisa os temas ativos (sinais das últimas 48 h no X, nos perfis de referência do Instagram e do TikTok, Trends, estudos e CFP/CRP), verifica as fontes e faz a triagem.',
      produz: 'Grava os candidatos na aba Candidatos da planilha Radar. Não cria arquivo no Drive.',
      custo: CUSTO_BOT,
      limites: [LIMITE_X, LIMITE_NAVEGADOR],
      semanal: 'Entra no mesmo dia do diário das 7h, sem repetir candidato (pelo id e pelo link). Não muda a seleção de domingo.',
    },
  },
  'radar-selecao': {
    bot: 'radar', rotulo: 'Seleção de pautas', grupo: 'radar', disparavel: true, precisaId: false,
    agenda: { dias: [0], hora: 9, minuto: 0 },
    confirmacao: {
      oQue: 'Seleção manual do Radar: escolhe pautas entre os candidatos, com as mesmas regras da seleção de domingo.',
      produz: 'Grava as pautas na aba Seleção (status “proposta”), num lote próprio (S<semana>-manual-<n>), e manda os cartões no chat do Radar.',
      custo: CUSTO_BOT,
      limites: [LIMITE_X, LIMITE_NAVEGADOR],
      semanal: 'Não muda a seleção de domingo; o que você decidir agora não volta no domingo.',
    },
  },
  'radar-enviar': {
    bot: 'radar', rotulo: 'Enviar ao Roteirista', grupo: 'radar', disparavel: true, precisaId: false,
    agenda: null,
    confirmacao: {
      oQue: 'O Radar lê as pautas aprovadas do lote e manda uma mensagem só ao Roteirista.',
      produz: 'Marca essas pautas como “enviada ao Roteirista” na aba Seleção; o Roteirista grava os rascunhos em 2-Roteiros/rascunhos.',
      custo: CUSTO_BOT,
      limites: [LIMITE_NAVEGADOR],
      semanal: 'As pautas enviadas entram na fila de roteiros; a seleção de domingo já desconta a fila.',
    },
  },
  'roteirista-decisao': {
    bot: 'roteirista', rotulo: 'Decisão de roteiro', grupo: 'roteirista', disparavel: true, precisaId: true,
    agenda: null,
    confirmacao: {
      oQue: 'Leva ao Roteirista a sua decisão sobre esta versão do roteiro (aprovar, pedir mudança ou recusar).',
      produz: 'Ao aprovar, o Roteirista grava “<id> - <título>.md” em 2-Roteiros; ao pedir mudança, um rascunho novo (vN+1) em 2-Roteiros/rascunhos.',
      custo: CUSTO_BOT,
      limites: ['O Roteirista trabalha um pedido por vez.'],
      semanal: 'Não muda o fluxo da semana: vale igual à decisão que você daria no chat do Roteirista.',
    },
  },
  'diretor-retrospectiva': {
    bot: 'diretor', rotulo: 'Retrospectiva', grupo: 'diretor|retrospectiva', disparavel: true, precisaId: false,
    agenda: { dias: [1], hora: 8, minuto: 0 },
    confirmacao: {
      oQue: 'O Diretor pede os números dos vídeos com 7 dias ou mais e faz a retrospectiva.',
      produz: 'Grava os números na aba Desempenho (por rede), os 3 aprendizados e, quando houver, “<id> vencedor.md” em 5-Prontos/vencedores.',
      custo: CUSTO_BOT,
      limites: [],
      semanal: 'A retrospectiva de segunda às 8h continua; se ela já rodou nesta semana, esta é uma rodada a mais.',
    },
  },
  'motor-checar-fontes': motor('Checar fontes', 'Confere as referências do rascunho (Crossref e PubMed).', '“<id> fontes.md” em 2-Roteiros.'),
  'motor-editar': motor('Editar a prévia', 'Edita o bruto de 3-Brutos seguindo o roteiro aprovado.', 'As prévias “<id> IG vN.mp4” e “<id> TT vN.mp4” em 4-Revisao.'),
  'motor-revisar': motor('Aplicar os ajustes', 'Aplica o pedido “<id> ajustes vN.md” na prévia.', 'Uma prévia nova (vN+1) em 4-Revisao.'),
  'motor-finalizar': motor('Finalizar o pacote', 'Monta o pacote final a partir da prévia aprovada.', 'A pasta “<id> - <título>” em 5-Prontos.'),
});

function motor(rotulo, oQue, produz) {
  return {
    bot: 'motor', rotulo, grupo: 'motor', disparavel: false, precisaId: true, agenda: null,
    confirmacao: { oQue, produz, custo: CUSTO_MOTOR, limites: [], semanal: 'Roda sozinho quando o arquivo de entrada chega (o vigia passa a cada 5 min).' },
  };
}

export const rotinaConhecida = (rotina) => Object.prototype.hasOwnProperty.call(ROTINAS, rotina);
export const ROTINAS_DISPARAVEIS = Object.keys(ROTINAS).filter((r) => ROTINAS[r].disparavel);

/** Grupo de trava de uma rotina (com o id, para o Roteirista), ou '' se a rotina não é do catálogo. */
export function grupoDeTrava(rotina, idAlvo = '') {
  const def = rotinaConhecida(rotina) ? ROTINAS[rotina] : null;
  if (!def) return '';
  return def.grupo === 'roteirista' ? `roteirista|${String(idAlvo || '').trim()}` : def.grupo;
}

// Grupo de uma linha de Execuções. Linha do Radar com um nome de rotina que o app não conhece
// ainda conta no grupo `radar` (o navegador é um só).
function grupoDaLinha(e) {
  if (rotinaConhecida(e.rotina)) return grupoDeTrava(e.rotina, e.id_alvo);
  return e.bot === 'radar' ? 'radar' : '';
}

/* ---------------------------------------------------------------- trava */

export const TRAVA_MS = 2 * 60 * 60 * 1000;

const msDe = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const maisNovaPrimeiro = (a, b) => (b.inicioData?.getTime() ?? -Infinity) - (a.inicioData?.getTime() ?? -Infinity) || (b._linha || 0) - (a._linha || 0);

/**
 * Há rodada `pedido`/`rodando` do mesmo grupo de trava?
 *   < 2 h      → {livre:false, motivo:'rodando', desde, origem, linha}
 *   ≥ 2 h      → {livre:false, motivo:'parece-travada', linha, linhas} (sem início registrado também)
 *   senão      → {livre:true}
 * `opcoes.origem = 'agendada'`: sempre livre (a agendada nunca é bloqueada).
 */
export function avaliarTrava(execucoes, rotina, idAlvo = '', agora = new Date(), { origem = 'manual-app' } = {}) {
  if (!rotinaConhecida(rotina)) return { livre: false, motivo: 'rotina-desconhecida' };
  if (origem === 'agendada') return { livre: true };
  const grupo = grupoDeTrava(rotina, idAlvo);
  const t = msDe(agora);
  const abertas = (execucoes || []).filter((e) => ABERTOS.has(e.status) && grupoDaLinha(e) === grupo).sort(maisNovaPrimeiro);
  const recente = abertas.find((e) => e.inicioData && t - e.inicioData.getTime() < TRAVA_MS);
  if (recente) return { livre: false, motivo: 'rodando', desde: recente.inicioData, origem: recente.origem, linha: recente };
  if (abertas.length) return { livre: false, motivo: 'parece-travada', linha: abertas[0], linhas: abertas };
  return { livre: true };
}

const ROTULO_ORIGEM = { agendada: 'agendada', 'manual-app': 'pelo app', chat: 'pelo chat', vigia: 'pelo vigia' };

/** "Rodando desde 7h03 (agendada)" / "Parece travada: …" / ''. */
export function textoTrava(res) {
  if (!res || res.livre) return '';
  if (res.motivo === 'rodando') {
    const o = ROTULO_ORIGEM[res.origem] || res.origem;
    return `Rodando desde ${horaCurta(res.desde)}${o ? ` (${o})` : ''}`;
  }
  if (res.motivo === 'parece-travada') {
    const d = res.linha?.inicioData;
    return `Parece travada: está como “${res.linha?.status || 'rodando'}”${d ? ` desde ${formatarDataHora(d)}` : ''}, há mais de 2 h.`;
  }
  return '';
}

/* ---------------------------------------------------- janela de proteção */

export const PROTECAO_ANTES_MS = 60 * 60 * 1000;
export const PROTECAO_SEM_LINHA_MS = 2 * 60 * 60 * 1000;

/** Horários agendados (Date) de ontem, hoje e amanhã no fuso de São Paulo. */
function horariosPerto(agenda, agora) {
  const p = momentoNoFuso(agora);
  const out = [];
  for (const d of [-1, 0, 1]) {
    const diaSemana = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + d)).getUTCDay();
    if (agenda.dias.includes(diaSemana)) out.push(dataNoFuso(p.ano, p.mes, p.dia + d, agenda.hora, agenda.minuto));
  }
  return out;
}

// A linha agendada daquele horário: mesma rotina, origem agendada, início perto do horário.
function linhaAgendada(execucoes, rotina, horario) {
  const h = horario.getTime();
  return (execucoes || []).filter((e) => e.rotina === rotina && e.origem === 'agendada' && e.inicioData
    && e.inicioData.getTime() >= h - PROTECAO_ANTES_MS && e.inicioData.getTime() <= h + PROTECAO_SEM_LINHA_MS)
    .sort(maisNovaPrimeiro)[0] || null;
}

/**
 * O disparo manual de uma rotina agendada é recusado de 60 min antes do horário até a linha
 * agendada daquele horário fechar (ok/parcial/erro, ou marcada como travada); sem linha agendada
 * registrada, até 2 h depois do horário. No grupo `radar` vale para as três rotinas do Radar
 * (navegador único). → {livre:true} | {livre:false, motivo:'protecao', rotinaAgendada, horario,
 * ate (Date, ou null quando espera a linha fechar), linha}.
 */
export function avaliarProtecao(execucoes, rotina, agora = new Date(), { origem = 'manual-app' } = {}) {
  if (!rotinaConhecida(rotina)) return { livre: false, motivo: 'rotina-desconhecida' };
  if (origem === 'agendada') return { livre: true };
  const def = ROTINAS[rotina];
  const alvos = def.grupo === 'radar'
    ? Object.keys(ROTINAS).filter((r) => ROTINAS[r].grupo === 'radar' && ROTINAS[r].agenda)
    : (def.agenda ? [rotina] : []);
  const t = msDe(agora);
  const bloqueios = [];
  for (const r of alvos) {
    for (const horario of horariosPerto(ROTINAS[r].agenda, agora)) {
      if (t < horario.getTime() - PROTECAO_ANTES_MS) continue;
      const linha = linhaAgendada(execucoes, r, horario);
      if (linha) {
        if (FECHADOS.has(linha.status)) continue;
        bloqueios.push({ livre: false, motivo: 'protecao', rotinaAgendada: r, horario, ate: null, linha });
      } else {
        const ate = new Date(horario.getTime() + PROTECAO_SEM_LINHA_MS);
        if (t >= ate.getTime()) continue;
        bloqueios.push({ livre: false, motivo: 'protecao', rotinaAgendada: r, horario, ate, linha: null });
      }
    }
  }
  if (!bloqueios.length) return { livre: true };
  // A mais próxima de começar (ou a que começou por último) explica melhor.
  return bloqueios.sort((a, b) => b.horario - a.horario)[0];
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const NO_DIA = (d) => (d === 0 || d === 6 ? `no ${DIAS[d]}` : `na ${DIAS[d]}`);

/** "hoje", "amanhã", "ontem" ou "no domingo"/"na segunda" (relativo a `agora`, em São Paulo). */
function diaRelativo(data, agora) {
  const a = momentoNoFuso(agora);
  const d = momentoNoFuso(data);
  const dias = Math.round((Date.UTC(d.ano, d.mes - 1, d.dia) - Date.UTC(a.ano, a.mes - 1, a.dia)) / 86400000);
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  if (dias === -1) return 'ontem';
  return NO_DIA(d.diaSemana);
}

/** Texto da janela de proteção para a tela. */
export function textoProtecao(res, agora = new Date()) {
  if (!res || res.livre || res.motivo !== 'protecao') return '';
  const def = ROTINAS[res.rotinaAgendada];
  const quando = `${diaRelativo(res.horario, agora)} às ${horaCurta(res.horario)}`;
  const fim = res.ate ? `até ${horaCurta(res.ate)}` : 'até ela terminar';
  const porque = def.grupo === 'radar' ? ' O navegador do Radar faz uma tarefa por vez.' : '';
  return `Perto da rodada agendada (${def.rotulo}, ${quando}): o disparo manual fica fechado ${fim}.${porque}`;
}

/** Próximo horário agendado da rotina depois de `agora` (Date), ou null se ela não tem agenda. */
export function proximaAgendada(rotina, agora = new Date()) {
  const def = rotinaConhecida(rotina) ? ROTINAS[rotina] : null;
  if (!def?.agenda) return null;
  const p = momentoNoFuso(agora);
  const t = msDe(agora);
  for (let d = 0; d <= 8; d++) {
    const diaSemana = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + d)).getUTCDay();
    if (!def.agenda.dias.includes(diaSemana)) continue;
    const h = dataNoFuso(p.ano, p.mes, p.dia + d, def.agenda.hora, def.agenda.minuto);
    if (h.getTime() > t) return h;
  }
  return null;
}

/** "A próxima rodada agendada é amanhã às 7h." ou '' sem agenda. */
export function textoProximaAgendada(rotina, agora = new Date()) {
  const h = proximaAgendada(rotina, agora);
  return h ? `A próxima rodada agendada é ${diaRelativo(h, agora)} às ${horaCurta(h)}.` : '';
}

/* ------------------------------------------------------------ permissões */

const minusc = (s) => String(s || '').trim().toLowerCase();

/** Só a conta da Robertta (ALLOWED[0]) decide (pautas, roteiros, prévias). */
export function podeDecidir(email) {
  return !!minusc(email) && minusc(email) === minusc(ALLOWED[0]);
}

/** Qualquer conta de ALLOWED vê e dispara rodadas. */
export function podeDisparar(email) {
  const e = minusc(email);
  return !!e && ALLOWED.some((a) => minusc(a) === e);
}

/* ------------------------------------------------------ disparo (tudo junto) */

/**
 * Pode disparar agora? Junta catálogo, permissão, id, trava e janela de proteção.
 * → {pode:true} | {pode:false, motivo, mensagem, trava?, protecao?}.
 * Motivos: rotina-desconhecida, nao-disparavel, sem-permissao, falta-id, rodando,
 * parece-travada, protecao.
 */
export function avaliarDisparo({ execucoes = [], rotina, idAlvo = '', email, agora = new Date() } = {}) {
  if (!rotinaConhecida(rotina)) return { pode: false, motivo: 'rotina-desconhecida', mensagem: 'Rotina desconhecida.' };
  const def = ROTINAS[rotina];
  if (!def.disparavel) return { pode: false, motivo: 'nao-disparavel', mensagem: 'O app não dispara o motor: ele roda sozinho quando o arquivo de entrada chega.' };
  if (!podeDisparar(email)) return { pode: false, motivo: 'sem-permissao', mensagem: 'Esta conta não pode disparar rodadas.' };
  if (rotina === 'roteirista-decisao' && !podeDecidir(email)) return { pode: false, motivo: 'sem-permissao', mensagem: 'Só a conta da Robertta decide.' };
  if (def.precisaId && !String(idAlvo || '').trim()) return { pode: false, motivo: 'falta-id', mensagem: 'Falta o id do roteiro.' };
  const trava = avaliarTrava(execucoes, rotina, idAlvo, agora);
  // Travada primeiro: "Marcar como travada" também fecha a linha que segura a janela de proteção.
  if (!trava.livre) return { pode: false, motivo: trava.motivo, mensagem: textoTrava(trava), trava };
  const protecao = avaliarProtecao(execucoes, rotina, agora);
  if (!protecao.livre) return { pode: false, motivo: 'protecao', mensagem: textoProtecao(protecao, agora), protecao };
  return { pode: true };
}

/* ------------------------------------------------------------- tempos */

/**
 * Tempo das rodadas `ok` (com início e fim, sem as de teste) da rotina, das mais novas para as
 * mais velhas, no máximo 10. Com 3 ou mais: "média de X min nas últimas N rodadas"; com menos:
 * "ainda sem medição". `ultima`: a rodada mais recente (qualquer status) para a faixa.
 */
export function estatisticasTempo(execucoes, rotina) {
  const daRotina = (execucoes || []).filter((e) => e.rotina === rotina).sort(maisNovaPrimeiro);
  const medidas = daRotina.filter((e) => e.status === 'ok' && !e.teste && e.inicioData && e.fimData
    && e.fimData.getTime() >= e.inicioData.getTime()).slice(0, 10);
  const u = daRotina[0];
  const ultima = u ? {
    quando: u.inicioData, quandoTexto: u.inicioData ? formatarDataHora(u.inicioData) : '', status: u.status, origem: u.origem, linha: u,
  } : null;
  if (medidas.length < 3) return { medido: false, n: medidas.length, mediaMin: null, texto: 'ainda sem medição', ultima };
  const mediaMs = medidas.reduce((s, e) => s + (e.fimData - e.inicioData), 0) / medidas.length;
  const mediaMin = Math.max(1, Math.round(mediaMs / 60000));
  return { medido: true, n: medidas.length, mediaMin, texto: `média de ${mediaMin} min nas últimas ${medidas.length} rodadas`, ultima };
}

/* ------------------------------------------------- janela de confirmação */

/**
 * Itens da janela "Rodar agora?" (PLANO 10), na ordem: o que roda, o que produz, tempo, custo,
 * limites, conflitos, efeito no semanal. → {titulo, rotina, teste, disparo, itens:[{chave, rotulo, texto|lista}]}.
 */
export function janelaConfirmacao(rotina, { execucoes = [], idAlvo = '', email = '', agora = new Date() } = {}) {
  if (!rotinaConhecida(rotina)) return null;
  const def = ROTINAS[rotina];
  const c = def.confirmacao;
  const disparo = avaliarDisparo({ execucoes, rotina, idAlvo, email, agora });
  const conflito = disparo.pode ? '' : disparo.mensagem;
  const proxima = textoProximaAgendada(rotina, agora);
  const itens = [
    { chave: 'oque', rotulo: 'O que vai rodar', texto: c.oQue },
    { chave: 'produz', rotulo: 'O que vai produzir e onde', texto: c.produz },
    { chave: 'tempo', rotulo: 'Tempo', texto: estatisticasTempo(execucoes, rotina).texto },
    { chave: 'custo', rotulo: 'Custo', texto: c.custo },
  ];
  if (c.limites.length) itens.push({ chave: 'limites', rotulo: 'Limites', lista: [...c.limites] });
  if (conflito || proxima) itens.push({ chave: 'conflitos', rotulo: 'Conflitos', lista: [conflito, proxima].filter(Boolean) });
  itens.push({ chave: 'semanal', rotulo: 'Efeito no semanal', texto: c.semanal });
  return { titulo: `${def.rotulo}: rodar agora?`, rotina, teste: ehTeste(idAlvo), disparo, itens };
}

/* --------------------------------------------------------------- ids */

function hexAleatorio(bytes) {
  const c = globalThis.crypto;
  const a = new Uint8Array(bytes);
  if (c?.getRandomValues) c.getRandomValues(a);
  else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Chave de idempotência do disparo (criada quando a janela de confirmação abre). */
export function novaChaveIdem() {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const h = hexAleatorio(16).split('');
  h[12] = '4'; // versão 4
  h[16] = '89ab'[parseInt(h[16], 16) & 3]; // variante RFC 4122
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const dois = (n) => String(n).padStart(2, '0');

/** `EX-AAAAMMDD-HHMMSS-xxxx` com a hora de São Paulo (`sufixo`: 4 hex; aleatório se não vier). */
export function novoIdExecucao(agora = new Date(), sufixo = hexAleatorio(2)) {
  const p = momentoNoFuso(agora);
  return `EX-${p.ano}${dois(p.mes)}${dois(p.dia)}-${dois(p.hora)}${dois(p.minuto)}${dois(p.segundo)}-${sufixo}`;
}

/** 47, '47', 'S47' → 'S47' (ou '' se não der). */
export function codigoSemana(semana) {
  const m = String(semana ?? '').trim().match(/^S?(\d{1,2})$/i);
  return m ? `S${dois(Number(m[1]))}` : '';
}

/**
 * Id do lote de seleção: `S<sem>-semanal` (domingo) ou `S<sem>-manual-<n>`, com n = o maior n já
 * usado na semana + 1 (olhando os id_lote de Execuções e Seleção; aceita textos ou objetos com
 * `id_lote`). Um número nunca é reaproveitado, mesmo com buraco.
 */
export function idLote({ semana, tipo = 'manual', existentes = [] } = {}) {
  const cod = codigoSemana(semana);
  if (!cod) throw new Error(`Semana inválida: ${semana}`);
  if (tipo === 'semanal') return `${cod}-semanal`;
  if (tipo !== 'manual') throw new Error(`Tipo de lote inválido: ${tipo}`);
  const re = new RegExp(`^${cod}-manual-(\\d+)$`, 'i');
  let maior = 0;
  for (const x of existentes || []) {
    const v = typeof x === 'string' ? x : x?.id_lote;
    const m = String(v || '').trim().match(re);
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  return `${cod}-manual-${maior + 1}`;
}

/* -------------------------------------------------- registro de uma rodada */

/** 'sim' para id T (teste), senão 'não'. Teste nunca vai para Decisões nem Desempenho. */
export const campoTeste = (idAlvo) => (ehTeste(String(idAlvo || '').trim()) ? 'sim' : 'não');

/** Registro de um disparo manual (o que a ponte grava em Execuções), com as 16 colunas. */
export function novaExecucao({ rotina, idAlvo = '', idLote = '', email = '', agora = new Date(), chaveIdem = novaChaveIdem(), idExecucao = novoIdExecucao(agora), etapa = '' } = {}) {
  if (!rotinaConhecida(rotina)) throw new Error(`Rotina desconhecida: ${rotina}`);
  const p = momentoNoFuso(agora);
  return {
    id_execucao: idExecucao,
    chave_idem: chaveIdem,
    bot: ROTINAS[rotina].bot,
    rotina,
    origem: 'manual-app',
    quem: minusc(email),
    id_alvo: String(idAlvo || '').trim(),
    id_lote: String(idLote || '').trim(),
    etapa_evento: etapa,
    inicio: `${p.ano}-${dois(p.mes)}-${dois(p.dia)} ${dois(p.hora)}:${dois(p.minuto)}:${dois(p.segundo)}`,
    fim: '',
    status: 'pedido',
    resumo: '',
    erro: '',
    link: '',
    teste: campoTeste(idAlvo),
  };
}

/** Registro → linha na ordem do cabeçalho real da aba Execuções. */
export function linhaExecucao(cabecalho, registro) {
  return linhaNaOrdem(cabecalho, registro, COLUNAS_EXECUCOES, SINONIMOS_EXECUCOES);
}
