/**
 * PONTE do Motor de Conteúdo (Google Apps Script, runtime V8) — item CM-05 do plano.
 *
 * O app (motor.rocambrea.com) manda um POST text/plain com JSON; a ponte:
 *   1. lê e valida o pedido (só campos conhecidos, tamanhos, tipos);
 *   2. confere o token de acesso do Google (aud/azp = CLIENT_ID, e-mail verificado, escopo email)
 *      e descarta o token (nunca vai para log, planilha, resposta nem webhook);
 *   3. confere a permissão (EMAILS_DISPARAR / EMAILS_DECIDIR) e a rotina (lista FECHADA);
 *   4. sob LockService: idempotência (chave_idem), trava por grupo, janela de proteção, limite por
 *      hora, e grava a linha 'pedido' na aba Execuções (e, SÓ em radar-candidato com destino
 *      'roteirista', a aprovação na aba Decisões, uma vez por candidato);
 *   5. fora do lock: repassa ao webhook da rotina (Bearer da propriedade). Falhou → linha 'erro'.
 *
 * Organização deste arquivo (um só, funções globais, sem import/export):
 *   PARTE A — lógica PURA: recebe tudo por parâmetro, não toca nenhum serviço do Apps Script.
 *             É a parte coberta pelos testes de tests/ponte.test.mjs.
 *   PARTE B — camada fina de serviços (SpreadsheetApp, PropertiesService, LockService,
 *             UrlFetchApp, CacheService, ContentService, Utilities) e os pontos de entrada
 *             doPost / doGet / configurar.
 *
 * Nenhum segredo aqui: URLs e chaves dos webhooks, CLIENT_ID, listas de e-mail e o id da
 * planilha ficam nas PROPRIEDADES DO SCRIPT (ver ponte/README.md).
 * Funções terminadas em "_" são internas (o Apps Script não as expõe para execução manual).
 */

/* ======================================================================================
 * PARTE A — LÓGICA PURA
 * ==================================================================================== */

/* ------------------------------------------------------------------ constantes */

const VERSAO_PONTE = '1';
const SERVICO_PONTE = 'ponte-motor';
const FUSO = 'America/Sao_Paulo';

/** Tamanho máximo do corpo do pedido (caracteres). */
const MAX_CORPO = 20000;
const MAX_TOKEN = 4096;
const MAX_CHAVES_DADOS = 30;
const MAX_TEXTO_DADOS = 4000;

const CAMPOS_PEDIDO = ['acao', 'rotina', 'id_alvo', 'id_lote', 'chave_idem', 'dados', 'access_token'];
const ACOES_PONTE = ['disparar', 'decidir-roteiro'];

const ID_RE = /^(S\d{2}-\d{2}|T\d{2}(-\d{2})?|R\d{3})$/; // igual a js/parse.js (idValido)
const ID_CANDIDATO_RE = /^T?\d{4}-\d{2}-\d{2}-\d{1,3}$/; // igual a js/parse.js (idCandidatoValido): 2026-11-14-01
const CHAVE_DADOS_RE = /^[a-z][a-z0-9_]{0,39}$/; // igual a dadosLimpos em js/integra.js
const CHAVE_IDEM_RE = /^[A-Za-z0-9_-]{8,80}$/; // o app manda um UUID
const ID_LOTE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/; // S47-semanal, S47-manual-2
const ID_EXECUCAO_RE = /^[A-Za-z0-9_-]{0,60}$/;

/** As 16 colunas da aba Execuções, na ordem de js/controle.js (COLUNAS_EXECUCOES). */
const COLUNAS_EXECUCOES = [
  'id_execucao', 'chave_idem', 'bot', 'rotina', 'origem', 'quem', 'id_alvo', 'id_lote',
  'etapa_evento', 'inicio', 'fim', 'status', 'resumo', 'erro', 'link', 'teste',
];

/** Nomes sugeridos pelos bots → colunas unificadas (igual a SINONIMOS_EXECUCOES do app). */
const SINONIMOS_EXECUCOES = {
  quem_disparou: 'quem',
  gatilho: 'origem',
  quando: 'inicio',
  resultado: 'status',
  detalhe: 'resumo',
  id: 'id_alvo',
  evento: 'etapa_evento',
  etapa: 'etapa_evento',
};

/** Sem estas, a ponte não consegue aplicar trava, idempotência nem registrar o teste. */
const ESSENCIAIS_EXECUCOES = ['id_execucao', 'chave_idem', 'bot', 'rotina', 'origem', 'quem', 'id_alvo', 'inicio', 'status', 'teste'];

const STATUS_EXECUCAO = ['pedido', 'rodando', 'ok', 'parcial', 'erro', 'aguardando', 'travada', 'recusado-pela-trava'];
const ABERTOS = ['pedido', 'rodando'];
// Fecham a rodada agendada para a janela de proteção (igual a controle.js).
const FECHADOS = ['ok', 'parcial', 'erro', 'travada'];

const TRAVA_MS = 2 * 60 * 60 * 1000;
const PROTECAO_ANTES_MS = 60 * 60 * 1000;
const PROTECAO_SEM_LINHA_MS = 2 * 60 * 60 * 1000;
const HORA_MS = 60 * 60 * 1000;
const LIMITE_POR_HORA_PADRAO = 4;

const TODO_DIA = [0, 1, 2, 3, 4, 5, 6];

/**
 * Catálogo FECHADO, espelhando js/controle.js (ROTINAS). Só as `disparavel` passam.
 *   grupo         grupo de trava; com `travaPorId`, vira '<grupo>|<id>' (roteirista por roteiro,
 *                 radar-candidato por candidato: um não trava o outro, o mesmo não vai duas vezes)
 *   acao          a única acao do pedido que aceita a rotina
 *   soDecide      só quem está em EMAILS_DECIDIR (decisões e "enviar adiante", PLANO 13)
 *   agenda        {dias (0 = domingo), hora, minuto} no fuso de São Paulo, ou null
 *   limitePorHora padrão da rotina (LIMITE_POR_HORA_<ROTINA> ainda vale por cima); sem ele, o geral
 */
const ROTINAS = Object.freeze({
  'radar-diario': {
    bot: 'radar', rotulo: 'Radar diário', grupo: 'radar', disparavel: true, precisaId: false, acao: 'disparar', soDecide: false, travaPorId: false,
    agenda: { dias: TODO_DIA, hora: 7, minuto: 0 },
  },
  'radar-selecao': {
    bot: 'radar', rotulo: 'Seleção de pautas', grupo: 'radar', disparavel: true, precisaId: false, acao: 'disparar', soDecide: false, travaPorId: false,
    agenda: { dias: [0], hora: 9, minuto: 0 },
  },
  'radar-enviar': {
    bot: 'radar', rotulo: 'Enviar ao Roteirista', grupo: 'radar', disparavel: true, precisaId: false, acao: 'disparar', soDecide: true, travaPorId: false,
    agenda: null,
  },
  // Um candidato da aba Candidatos vira pauta (Para decidir) ou vai ao Roteirista. Sem agenda.
  'radar-candidato': {
    bot: 'radar', rotulo: 'Candidato do Radar', grupo: 'radar-candidato', disparavel: true, precisaId: true, acao: 'disparar', soDecide: true, travaPorId: true,
    agenda: null, limitePorHora: 15,
  },
  'roteirista-decisao': {
    bot: 'roteirista', rotulo: 'Decisão de roteiro', grupo: 'roteirista', disparavel: true, precisaId: true, acao: 'decidir-roteiro', soDecide: true, travaPorId: true,
    agenda: null,
  },
  'diretor-retrospectiva': {
    bot: 'diretor', rotulo: 'Retrospectiva', grupo: 'diretor|retrospectiva', disparavel: true, precisaId: false, acao: 'disparar', soDecide: false, travaPorId: false,
    agenda: { dias: [1], hora: 8, minuto: 0 },
  },
  // O app NUNCA dispara o motor: ele grava o arquivo de entrada e o vigia faz o resto.
  'motor-checar-fontes': { bot: 'motor', rotulo: 'Checar fontes', grupo: 'motor', disparavel: false, precisaId: true, acao: '', soDecide: false, travaPorId: false, agenda: null },
  'motor-editar': { bot: 'motor', rotulo: 'Editar a prévia', grupo: 'motor', disparavel: false, precisaId: true, acao: '', soDecide: false, travaPorId: false, agenda: null },
  'motor-revisar': { bot: 'motor', rotulo: 'Aplicar os ajustes', grupo: 'motor', disparavel: false, precisaId: true, acao: '', soDecide: false, travaPorId: false, agenda: null },
  'motor-finalizar': { bot: 'motor', rotulo: 'Finalizar o pacote', grupo: 'motor', disparavel: false, precisaId: true, acao: '', soDecide: false, travaPorId: false, agenda: null },
});

/* radar-diario: quantos candidatos a rodada manual grava (dados.quantidade, opcional). */
const QUANTIDADE_MIN = 1;
const QUANTIDADE_MAX = 15;

/* radar-candidato: em `dados` só valem estes (mais os dois campos de trava). */
const CAMPOS_PEDIDO_CANDIDATO = ['id_candidato', 'destino', 'motivo'];
const DESTINOS_CANDIDATO = ['decidir', 'roteirista'];
const MAX_MOTIVO_CANDIDATO = 300;

/** As 11 colunas da aba Decisões (igual a COLUNAS_DECISOES de js/selecao.js). */
const COLUNAS_DECISOES = ['semana', 'pauta', 'decisao', 'motivo', 'id_pauta', 'rede', 'id_candidato', 'id_lote', 'data', 'quem', 'origem'];

const DECISOES_ROTEIRO = ['aprovar', 'mudar', 'recusar'];
const MOTIVOS_ROTEIRO = ['tom', 'clareza', 'fundamentação', 'ética', 'desalinhamento']; // controle.js
const CAMPOS_DECISAO_ROTEIRO = ['id', 'versao', 'decisao', 'pedido', 'motivo', 'marcar_travada', 'id_execucao_travada'];

/** Campos de controle que a ponte usa e NÃO repassa ao bot. */
const CAMPOS_SO_DA_PONTE = ['marcar_travada', 'id_execucao_travada'];

/**
 * A ponte grava na aba Execuções e, numa única exceção, em Decisões: o pedido radar-candidato com
 * destino 'roteirista' grava UMA linha de aprovação por candidato (abaGravavelPelaPonte). Desempenho
 * nunca. Toda gravação passa por conferirGravacao: ids T nunca vão para Decisões nem Desempenho.
 */
const ABAS_PROIBIDAS_PARA_TESTE = ['decisoes', 'desempenho'];

/** Mensagens curtas para a Robertta (integra.js mostra `mensagem` e usa `codigo`). */
const MENSAGENS = {
  'pedido-invalido': 'O pedido chegou num formato que a ponte não aceita.',
  'token-invalido': 'Não consegui confirmar sua conta Google. Saia e entre de novo no app.',
  'verificacao-indisponivel': 'Não consegui falar com o Google para confirmar sua conta. Tente de novo em instantes.',
  'sem-permissao': 'Esta conta não pode fazer este pedido.',
  'rotina-desconhecida': 'Rotina fora da lista da ponte.',
  'id-invalido': 'Id inválido.',
  'sem-chave': 'Falta a chave do pedido.',
  'versao-invalida': 'Versão inválida.',
  'decisao-invalida': 'A decisão precisa ser aprovar, mudar ou recusar.',
  'falta-pedido': 'Diga o que mudar.',
  'motivo-invalido': 'O motivo da recusa precisa ser tom, clareza, fundamentação, ética ou desalinhamento.',
  'rodando': 'Já tem uma rodada em andamento.',
  'parece-travada': 'Parece travada: há uma rodada aberta há mais de 2 h.',
  'protecao': 'Perto da rodada agendada: o disparo manual está fechado agora.',
  'limite': 'Muitos pedidos desta rotina na última hora. Espere um pouco.',
  'teste-recusado': 'Ids de teste (T) não vão para Decisões nem Desempenho.',
  'aba-nao-permitida': 'A ponte só grava na aba Execuções (e em Decisões só para mandar um candidato ao Roteirista).',
  'quantidade-invalida': 'A quantidade de candidatos precisa ser um número inteiro de 1 a 15.',
  'destino-invalido': 'O destino do candidato precisa ser "decidir" (Para decidir) ou "roteirista".',
  'decisoes-sem-colunas': 'A aba Decisões não tem as colunas novas (id_pauta, rede, id_candidato, id_lote, data, quem, origem). Nada foi pedido ao Radar.',
  'decisoes-falhou': 'Não consegui gravar a aprovação na aba Decisões, então nada foi pedido ao Radar. Tente de novo em instantes.',
  'ocupado': 'A ponte está atendendo outro pedido. Tente de novo em instantes.',
  'planilha-sem-execucoes': 'A aba Execuções não foi encontrada (ou está sem os cabeçalhos esperados).',
  'ponte-sem-configuracao': 'A ponte ainda não está configurada.',
  'webhook-nao-configurado': 'O pedido foi registrado, mas este bot ainda não tem webhook na ponte. Nada rodou.',
  'webhook-falhou': 'O pedido foi registrado, mas o bot não respondeu. Nada rodou; tente de novo mais tarde.',
  'repetido-com-erro': 'Este mesmo pedido já falhou antes. Feche a janela e peça de novo.',
  'configuracao-recusada': 'Código de configuração inválido.',
  'erro-interno': 'A ponte teve um erro. Tente de novo.',
};

/* ------------------------------------------------------------------ respostas */

/** {ok:false, codigo, mensagem, ...extras} com a mensagem padrão do código. */
function falha(codigo, mensagem, extras) {
  return Object.assign({ ok: false, codigo: codigo, mensagem: mensagem || MENSAGENS[codigo] || MENSAGENS['erro-interno'] }, extras || {});
}

/* ------------------------------------------------------------------ ids e textos */

function idValido(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

function ehTeste(id) {
  return idValido(id) && id.charAt(0) === 'T';
}

/** Id de candidato da aba Candidatos (AAAA-MM-DD-NN; com T na frente, de teste). */
function idCandidatoValido(id) {
  return typeof id === 'string' && ID_CANDIDATO_RE.test(id);
}

/** Qualquer id que começa com T é de teste (roteiro T01-01, candidato T2026-11-14-01). */
function ehIdDeTeste(id) {
  return /^T/i.test(String(id == null ? '' : id).trim());
}

/** 'sim' para id T, senão 'não' (igual a campoTeste em controle.js). */
function campoTeste(idAlvo) {
  return ehTeste(String(idAlvo || '').trim()) ? 'sim' : 'não';
}

const minusc = function (s) { return String(s == null ? '' : s).trim().toLowerCase(); };
const dois = function (n) { return String(n).padStart(2, '0'); };

/** Texto comparável: sem acento, minúsculas, espaços simples. */
function normalizarCabecalho(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "Id Execução" → "id_execucao", "quem disparou" → "quem_disparou". */
function chaveDeCabecalho(s) {
  return normalizarCabecalho(s).replace(/[\s\-–—]+/g, '_').replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_').replace(/^_|_$/g, '');
}

const comHifen = function (v) { return normalizarCabecalho(v).replace(/[\s_]+/g, '-'); };

const ORIGENS = { agendada: 'agendada', agendado: 'agendada', cron: 'agendada', 'manual-app': 'manual-app', manual: 'manual-app', app: 'manual-app', chat: 'chat', vigia: 'vigia' };

function normalizarOrigem(v) {
  const k = comHifen(v);
  return ORIGENS[k] || k;
}

const SIM = ['sim', 's', 'yes', 'true', 'verdadeiro', '1', 'x'];

/**
 * Valor que vai para uma célula. Todo texto vai com um apóstrofo na frente: a planilha guarda como
 * texto puro (o apóstrofo não aparece) e nada vira fórmula (=, +, -, @), número ou data.
 */
function textoCelula(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s === '' ? '' : "'" + s;
}

/** Tira segredos de um texto antes de qualquer log (o token nunca deve aparecer). */
function redigir(texto, segredos) {
  let s = String(texto == null ? '' : texto);
  (segredos || []).forEach(function (seg) {
    if (seg && String(seg).length >= 4) s = s.split(String(seg)).join('[omitido]');
  });
  return s
    .replace(/(access_token=)[^&\s"']+/gi, '$1[omitido]')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[omitido]')
    .replace(/https?:\/\/\S+/gi, '[url omitida]');
}

/* ------------------------------------------------------------------ datas (São Paulo) */

const ehData = function (v) { return Object.prototype.toString.call(v) === '[object Date]'; };

function tempoDe(v) {
  if (v && typeof v.getTime === 'function') return v.getTime();
  if (typeof v === 'number') return v;
  return new Date(v).getTime();
}

let formatadorFuso_ = null;

/** Data → {ano, mes, dia, hora, minuto, segundo, diaSemana} em São Paulo, ou null. */
function momentoNoFuso(data) {
  const t = tempoDe(data);
  if (!Number.isFinite(t)) return null;
  let p = null;
  try {
    if (!formatadorFuso_) {
      formatadorFuso_ = new Intl.DateTimeFormat('en-GB', {
        timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      });
    }
    const q = {};
    formatadorFuso_.formatToParts(new Date(t)).forEach(function (x) { q[x.type] = Number(x.value); });
    if (q.year > 1900 && q.hour >= 0 && q.hour <= 23) p = { year: q.year, month: q.month, day: q.day, hour: q.hour, minute: q.minute, second: q.second };
  } catch (e) {
    p = null;
  }
  if (!p) {
    // Sem Intl com fusos: São Paulo está em UTC−3 o ano todo desde 2019.
    const d = new Date(t - 3 * HORA_MS);
    p = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
  }
  const diaSemana = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute, segundo: p.second, diaSemana: diaSemana };
}

/** Data e hora "de parede" em São Paulo → Date (aceita dia/hora fora do intervalo). */
function dataNoFuso(ano, mes, dia, hora, minuto, segundo) {
  const alvo = Date.UTC(ano, mes - 1, dia, hora || 0, minuto || 0, segundo || 0);
  let t = alvo;
  for (let i = 0; i < 3; i++) {
    const p = momentoNoFuso(t);
    const visto = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
    if (visto === alvo) break;
    t += alvo - visto;
  }
  return new Date(t);
}

/**
 * Célula de data e hora → Date (ou null). Igual a lerDataHora de js/parse.js: Date, serial da
 * planilha, ISO com Z/deslocamento, "AAAA-MM-DD[ HH:MM[:SS]]" e "dd/mm/aaaa[ HH:MM[:SS]]"
 * (sem fuso escrito, vale São Paulo).
 */
function lerDataHora(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (ehData(valor)) return Number.isFinite(valor.getTime()) ? new Date(valor.getTime()) : null;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor <= 0) return null;
    const dia = new Date(Date.UTC(1899, 11, 30) + Math.round(valor * 86400000));
    return dataNoFuso(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), dia.getUTCHours(), dia.getUTCMinutes(), dia.getUTCSeconds());
  }
  const s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) {
    const b = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (b) m = [b[0], b[3], b[2], b[1], b[4], b[5], b[6]];
  }
  if (m) {
    const n = m.slice(1).map(function (x) { return Number(x || 0); });
    if (n[1] < 1 || n[1] > 12 || n[2] < 1 || n[2] > 31 || n[3] > 23 || n[4] > 59 || n[5] > 59) return null;
    return dataNoFuso(n[0], n[1], n[2], n[3], n[4], n[5]);
  }
  if (/^\d+(\.\d+)?$/.test(s)) return lerDataHora(Number(s));
  return null;
}

/** Date → "AAAA-MM-DD HH:MM:SS" em São Paulo (lerDataHora do app lê esse formato). */
function textoDataHora(data) {
  const p = momentoNoFuso(data);
  return p ? p.ano + '-' + dois(p.mes) + '-' + dois(p.dia) + ' ' + dois(p.hora) + ':' + dois(p.minuto) + ':' + dois(p.segundo) : '';
}

/** Date → "AAAA-MM-DD HH:MM" em São Paulo: o formato da coluna `data` de Decisões que o app grava
 *  (dataHoraPlanilha de js/parse.js). */
function dataHoraPlanilha(data) {
  const p = momentoNoFuso(data);
  return p ? p.ano + '-' + dois(p.mes) + '-' + dois(p.dia) + ' ' + dois(p.hora) + ':' + dois(p.minuto) : '';
}

/** Semana ISO 8601 da data em São Paulo como o app escreve: "S47" (prefixoSemana de js/parse.js). */
function prefixoSemana(data) {
  const p = momentoNoFuso(data);
  const d = new Date(Date.UTC(p.ano, p.mes - 1, p.dia));
  const diaSemana = d.getUTCDay() || 7; // segunda = 1 … domingo = 7
  d.setUTCDate(d.getUTCDate() + 4 - diaSemana); // quinta-feira da mesma semana
  const anoIso = d.getUTCFullYear();
  const semana = Math.ceil(((d.getTime() - Date.UTC(anoIso, 0, 1)) / 86400000 + 1) / 7);
  return 'S' + dois(semana);
}

/** "7h03", "9h". */
function horaCurta(data) {
  const p = momentoNoFuso(data);
  if (!p) return '';
  return p.minuto ? p.hora + 'h' + dois(p.minuto) : p.hora + 'h';
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "hoje", "amanhã", "ontem", "no domingo", "na segunda". */
function diaRelativo(data, agora) {
  const a = momentoNoFuso(agora);
  const d = momentoNoFuso(data);
  const dias = Math.round((Date.UTC(d.ano, d.mes - 1, d.dia) - Date.UTC(a.ano, a.mes - 1, a.dia)) / 86400000);
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  if (dias === -1) return 'ontem';
  return (d.diaSemana === 0 || d.diaSemana === 6 ? 'no ' : 'na ') + DIAS[d.diaSemana];
}

/** "18/11 às 7h03". */
function diaEHora(data) {
  const p = momentoNoFuso(data);
  return p ? dois(p.dia) + '/' + dois(p.mes) + ' às ' + horaCurta(data) : '';
}

/* ------------------------------------------------------------------ pedido */

const ehObjetoPlano = function (v) { return !!v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.toString.call(v) === '[object Object]'; };

/** `dados`: objeto plano, chaves simples, valores texto (≤ 4000) / número / booleano. */
function validarDados(dados) {
  if (dados === undefined || dados === null) return { ok: true, dados: {} };
  if (!ehObjetoPlano(dados)) return falha('pedido-invalido', 'O campo "dados" precisa ser um objeto simples.');
  const chaves = Object.keys(dados);
  if (chaves.length > MAX_CHAVES_DADOS) return falha('pedido-invalido', 'O campo "dados" tem itens demais.');
  const out = {};
  for (let i = 0; i < chaves.length; i++) {
    const k = chaves[i];
    const v = dados[k];
    if (!CHAVE_DADOS_RE.test(k)) return falha('pedido-invalido', 'Há um item com nome inválido em "dados".');
    if (typeof v === 'string') {
      if (v.length > MAX_TEXTO_DADOS) return falha('pedido-invalido', 'Um texto em "dados" passou de 4000 caracteres.');
      out[k] = v;
    } else if (typeof v === 'number') {
      if (!Number.isFinite(v)) return falha('pedido-invalido', 'Há um número inválido em "dados".');
      out[k] = v;
    } else if (typeof v === 'boolean') {
      out[k] = v;
    } else {
      return falha('pedido-invalido', 'Em "dados" só valem texto, número e sim/não.');
    }
  }
  return { ok: true, dados: out };
}

/**
 * Corpo do POST (texto) → {ok:true, pedido} | falha. Só os campos conhecidos; tipos e tamanhos
 * conferidos. O token fica em `pedido.access_token` só até ser validado (doPost o tira de lá).
 * `opcoes.setup`: true só quando Setup.gs define PONTE_SETUP_HASH; sem ele, 'configurar' tem a
 * mesma resposta de uma ação desconhecida.
 */
function lerPedido(texto, opcoes) {
  if (typeof texto !== 'string' || !texto.trim()) return falha('pedido-invalido', 'O pedido chegou vazio.');
  if (texto.length > MAX_CORPO) return falha('pedido-invalido', 'O pedido é grande demais.');
  let j;
  try {
    j = JSON.parse(texto);
  } catch (e) {
    return falha('pedido-invalido', 'O pedido não é um JSON válido.');
  }
  if (!ehObjetoPlano(j)) return falha('pedido-invalido');
  if (j.acao === 'configurar') {
    if (!(opcoes && opcoes.setup)) return falha('pedido-invalido', 'Ação desconhecida.');
    return lerPedidoDeConfiguracao(j);
  }
  const extras = Object.keys(j).filter(function (k) { return CAMPOS_PEDIDO.indexOf(k) < 0; });
  if (extras.length) return falha('pedido-invalido', 'O pedido tem campos que a ponte não conhece.');
  const textos = ['acao', 'rotina', 'id_alvo', 'id_lote', 'chave_idem', 'access_token'];
  for (let i = 0; i < textos.length; i++) {
    const v = j[textos[i]];
    if (v !== undefined && v !== null && typeof v !== 'string') return falha('pedido-invalido', 'O campo "' + textos[i] + '" precisa ser texto.');
  }
  const acao = String(j.acao || '');
  if (ACOES_PONTE.indexOf(acao) < 0) return falha('pedido-invalido', 'Ação desconhecida.');
  const token = String(j.access_token || '');
  if (token.length < 10 || token.length > MAX_TOKEN || /\s/.test(token)) return falha('token-invalido');
  const d = validarDados(j.dados);
  if (!d.ok) return d;
  const chave = String(j.chave_idem || '').trim();
  if (!chave) return falha('sem-chave');
  if (!CHAVE_IDEM_RE.test(chave)) return falha('pedido-invalido', 'A chave do pedido está num formato inválido.');
  const idLote = String(j.id_lote || '').trim();
  if (idLote && !ID_LOTE_RE.test(idLote)) return falha('pedido-invalido', 'O lote está num formato inválido.');
  return {
    ok: true,
    pedido: {
      acao: acao,
      rotina: String(j.rotina || '').trim(),
      id_alvo: String(j.id_alvo || '').trim(),
      id_lote: idLote,
      chave_idem: chave,
      dados: d.dados,
      access_token: token,
    },
  };
}

/* ------------------------------------------------------------------ token do Google */

const ESCOPOS_EMAIL = ['email', 'https://www.googleapis.com/auth/userinfo.email'];

const verdadeiro = function (v) { return v === true || String(v).toLowerCase() === 'true'; };

/**
 * Resposta do tokeninfo (e, se ele não trouxer o e-mail, a do userinfo) → {ok:true, email} | falha.
 * Exige aud ou azp = CLIENT_ID, expires_in > 0, escopo com e-mail e e-mail verificado.
 * Nenhuma mensagem de erro repete o que o Google mandou.
 */
function avaliarTokenInfo(info, clientId, userinfo) {
  if (!clientId) return falha('ponte-sem-configuracao');
  if (!ehObjetoPlano(info) || info.error || info.error_description) return falha('token-invalido');
  if (String(info.aud || '') !== clientId && String(info.azp || '') !== clientId) return falha('token-invalido', 'Este login não veio do app Motor de Conteúdo.');
  const expira = Number(info.expires_in);
  if (!Number.isFinite(expira) || expira <= 0) return falha('token-invalido', 'Sua sessão venceu. Entre de novo no app.');
  const escopos = String(info.scope || '').split(/\s+/);
  if (!escopos.some(function (s) { return ESCOPOS_EMAIL.indexOf(s) >= 0; })) return falha('token-invalido', 'O login não deu acesso ao e-mail da conta.');
  let email = minusc(info.email);
  let verificado = verdadeiro(info.email_verified);
  if (!email) {
    if (!ehObjetoPlano(userinfo) || userinfo.error) return falha('token-invalido');
    if (info.sub && userinfo.sub && String(info.sub) !== String(userinfo.sub)) return falha('token-invalido');
    email = minusc(userinfo.email);
    verificado = verdadeiro(userinfo.email_verified);
  }
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) return falha('token-invalido');
  if (!verificado) return falha('token-invalido', 'O e-mail desta conta Google não está verificado.');
  return { ok: true, email: email, expiraEm: expira };
}

/* ------------------------------------------------------------------ permissões */

/** "a@x.com, B@y.com" → ['a@x.com', 'b@y.com'] (vazio = ninguém). */
function listaDeEmails(texto) {
  return String(texto || '').split(/[,;\s]+/).map(minusc).filter(function (e) { return e.indexOf('@') > 0; });
}

/**
 * Pode fazer o pedido? disparar = quem está em EMAILS_DISPARAR ou EMAILS_DECIDIR; decidir-roteiro
 * e rotinas `soDecide` (enviar adiante) = só EMAILS_DECIDIR. Listas vazias: ninguém.
 */
function conferirPermissao(acao, rotina, email, listas) {
  const e = minusc(email);
  const decidem = (listas && listas.decidir) || [];
  const disparam = ((listas && listas.disparar) || []).concat(decidem);
  if (!e) return falha('sem-permissao');
  const def = rotinaConhecida(rotina) ? ROTINAS[rotina] : null;
  if (acao === 'decidir-roteiro' || (def && def.soDecide)) {
    return decidem.indexOf(e) >= 0 ? { ok: true } : falha('sem-permissao', 'Só a conta da Robertta decide.');
  }
  return disparam.indexOf(e) >= 0 ? { ok: true } : falha('sem-permissao', 'Esta conta não pode disparar rodadas.');
}

/* ------------------------------------------------------------------ rotina e decisão */

function rotinaConhecida(rotina) {
  return Object.prototype.hasOwnProperty.call(ROTINAS, rotina);
}

/** Grupo de trava (com o id nas rotinas `travaPorId`), ou ''. */
function grupoDeTrava(rotina, idAlvo) {
  if (!rotinaConhecida(rotina)) return '';
  const def = ROTINAS[rotina];
  return def.travaPorId ? def.grupo + '|' + String(idAlvo || '').trim() : def.grupo;
}

/** Motivo da lista curta (aceita sem acento e com outra caixa) ou ''. */
function motivoDeRoteiro(v) {
  const s = normalizarCabecalho(v);
  for (let i = 0; i < MOTIVOS_ROTEIRO.length; i++) if (normalizarCabecalho(MOTIVOS_ROTEIRO[i]) === s) return MOTIVOS_ROTEIRO[i];
  return '';
}

const umaLinha = function (s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(); };

/**
 * Decisão de roteiro (dados de decidirRoteiro no app) → {ok:true, dados, resumo} | falha.
 * dados.id = id_alvo; versão inteira ≥ 1; decisão aprovar | mudar | recusar; mudar exige pedido;
 * recusar: se vier motivo, ele começa por um da lista ("clareza" ou "clareza: observação").
 * Ao bot vão exatamente {id, versao, decisao, pedido, motivo}, com o motivo como o app mandou.
 */
function validarDecisaoRoteiro(pedido) {
  const d = pedido.dados || {};
  const extras = Object.keys(d).filter(function (k) { return CAMPOS_DECISAO_ROTEIRO.indexOf(k) < 0; });
  if (extras.length) return falha('pedido-invalido', 'A decisão de roteiro tem campos que a ponte não conhece.');
  if (String(d.id || '') !== pedido.id_alvo) return falha('id-invalido', 'O id da decisão não confere com o roteiro.');
  const v = typeof d.versao === 'number' ? d.versao : (/^\d+$/.test(String(d.versao || '')) ? Number(d.versao) : NaN);
  if (!Number.isInteger(v) || v < 1) return falha('versao-invalida', 'Versão inválida: ' + umaLinha(d.versao).slice(0, 20));
  const decisao = String(d.decisao || '');
  if (DECISOES_ROTEIRO.indexOf(decisao) < 0) return falha('decisao-invalida');
  const textoPedido = typeof d.pedido === 'string' ? d.pedido : '';
  if (decisao === 'mudar' && !textoPedido.trim()) return falha('falta-pedido');
  let motivo = '';
  const motivoTexto = typeof d.motivo === 'string' ? d.motivo : '';
  const motivoBruto = umaLinha(motivoTexto);
  if (decisao === 'recusar' && motivoBruto) {
    const i = motivoBruto.indexOf(':');
    const cabeca = i >= 0 ? motivoBruto.slice(0, i) : motivoBruto;
    motivo = motivoDeRoteiro(cabeca);
    if (!motivo) return falha('motivo-invalido');
  }
  const resumo = decisao === 'recusar' ? 'recusar v' + v + (motivo ? ' (' + motivo + ')' : '') : decisao + ' v' + v;
  return {
    ok: true,
    dados: { id: pedido.id_alvo, versao: v, decisao: decisao, pedido: textoPedido, motivo: motivoTexto },
    resumo: resumo,
  };
}

/**
 * radar-diario: dados.quantidade opcional; se vier, inteiro de 1 a 15 (número, ou texto só com
 * dígitos). → {ok:true, valor} | falha 'quantidade-invalida'.
 */
function lerQuantidade(v) {
  let n = NaN;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) n = Number(v);
  if (!Number.isInteger(n) || n < QUANTIDADE_MIN || n > QUANTIDADE_MAX) return falha('quantidade-invalida');
  return { ok: true, valor: n };
}

/**
 * radar-candidato (pedido de um candidato da aba Candidatos) → {ok:true, dados, resumo} | falha.
 * dados.id_candidato no formato de candidato, igual ao id_alvo e não de teste (T); destino
 * 'decidir' | 'roteirista'; motivo opcional (texto), numa linha só e com até 300 caracteres. Nenhum
 * outro campo (além dos dois de trava). Ao bot vão exatamente {id_candidato, destino, motivo?}
 * (motivo só quando não vazio).
 */
function validarPedidoCandidato(pedido) {
  const d = pedido.dados || {};
  const extras = Object.keys(d).filter(function (k) { return CAMPOS_PEDIDO_CANDIDATO.indexOf(k) < 0 && CAMPOS_SO_DA_PONTE.indexOf(k) < 0; });
  if (extras.length) return falha('pedido-invalido', 'O pedido do candidato tem campos que a ponte não conhece.');
  const id = typeof d.id_candidato === 'string' ? d.id_candidato.trim() : '';
  if (!idCandidatoValido(id)) return falha('id-invalido', 'Id de candidato inválido.');
  if (id !== pedido.id_alvo) return falha('id-invalido', 'O id do candidato não confere com o pedido.');
  if (ehIdDeTeste(id)) return falha('teste-recusado', 'Candidato de teste (T) não vira pauta pelo app.');
  const destino = typeof d.destino === 'string' ? d.destino : '';
  if (DESTINOS_CANDIDATO.indexOf(destino) < 0) return falha('destino-invalido');
  if (d.motivo !== undefined && typeof d.motivo !== 'string') return falha('pedido-invalido', 'O motivo precisa ser texto.');
  const motivo = umaLinha(d.motivo).slice(0, MAX_MOTIVO_CANDIDATO).trim();
  const dados = { id_candidato: id, destino: destino };
  if (motivo) dados.motivo = motivo; // vazio: o campo não vai ao bot
  return {
    ok: true,
    dados: dados,
    resumo: 'candidato ' + id + (destino === 'roteirista' ? ' → Roteirista' : ' → Para decidir'),
  };
}

/**
 * Depois do token e antes do lock: rotina, permissão, ids e dados.
 * → {ok:true, def, rotina, dadosBot, resumo, marcarTravada, idTravada, gravaDecisao} | falha.
 * `gravaDecisao`: radar-candidato com destino 'roteirista' (a aprovação vai para Decisões).
 */
function conferirPedido(pedido, email, listas) {
  let rotina = pedido.rotina;
  if (pedido.acao === 'decidir-roteiro') {
    if (rotina && rotina !== 'roteirista-decisao') return falha('rotina-desconhecida', 'A decisão de roteiro só vai para o Roteirista.');
    rotina = 'roteirista-decisao';
  }
  const perm = conferirPermissao(pedido.acao, rotina, email, listas);
  if (!perm.ok) return perm;
  if (!rotinaConhecida(rotina)) return falha('rotina-desconhecida');
  const def = ROTINAS[rotina];
  if (!def.disparavel) return falha('rotina-desconhecida', 'O app não dispara o motor: ele roda sozinho quando o arquivo de entrada chega.');
  if (def.acao !== pedido.acao) return falha('rotina-desconhecida', 'A decisão de roteiro vai por "decidir-roteiro".');
  // radar-candidato: o id_alvo é o id do candidato (AAAA-MM-DD-NN), não um id de roteiro.
  const idOk = rotina === 'radar-candidato' ? idCandidatoValido : idValido;
  if (pedido.id_alvo && !idOk(pedido.id_alvo)) return falha('id-invalido', 'Id inválido: ' + umaLinha(pedido.id_alvo).slice(0, 20));
  if (def.precisaId && !pedido.id_alvo) return falha('id-invalido', rotina === 'radar-candidato' ? 'Falta o id do candidato.' : 'Falta o id do roteiro.');
  const d = pedido.dados || {};
  const marcarTravada = d.marcar_travada === true;
  const idTravada = typeof d.id_execucao_travada === 'string' ? d.id_execucao_travada.trim() : '';
  if (!ID_EXECUCAO_RE.test(idTravada)) return falha('pedido-invalido');
  let dadosBot;
  let resumo = '';
  let gravaDecisao = false;
  if (pedido.acao === 'decidir-roteiro') {
    const dec = validarDecisaoRoteiro(pedido);
    if (!dec.ok) return dec;
    dadosBot = dec.dados;
    resumo = dec.resumo;
  } else if (rotina === 'radar-candidato') {
    const cand = validarPedidoCandidato(pedido);
    if (!cand.ok) return cand;
    dadosBot = cand.dados;
    resumo = cand.resumo;
    gravaDecisao = cand.dados.destino === 'roteirista';
  } else {
    dadosBot = {};
    Object.keys(d).forEach(function (k) { if (CAMPOS_SO_DA_PONTE.indexOf(k) < 0) dadosBot[k] = d[k]; });
    if (rotina === 'radar-enviar' && dadosBot.ids !== undefined) {
      const ids = String(dadosBot.ids).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!ids.length || !ids.every(idValido)) return falha('id-invalido', 'Há id inválido na lista de pautas.');
      resumo = 'enviar ' + ids.join(', ');
    }
    if (rotina === 'radar-diario' && dadosBot.quantidade !== undefined) {
      const q = lerQuantidade(dadosBot.quantidade);
      if (!q.ok) return q;
      dadosBot.quantidade = q.valor; // sempre inteiro para o bot
      resumo = q.valor + (q.valor === 1 ? ' candidato' : ' candidatos');
    }
  }
  return {
    ok: true, def: def, rotina: rotina, dadosBot: dadosBot, resumo: resumo.slice(0, 200), marcarTravada: marcarTravada, idTravada: idTravada,
    gravaDecisao: gravaDecisao,
  };
}

/* ------------------------------------------------------------------ aba Execuções */

/**
 * Cabeçalho → {coluna canônica: índice}. O nome canônico vence o sinônimo; repetida, vale a primeira.
 * Sem `colunas`, as de Execuções (com os sinônimos dos bots).
 */
function indicesDoCabecalho(cabecalho, colunas, sinonimos) {
  const cols = colunas || COLUNAS_EXECUCOES;
  const sins = colunas ? (sinonimos || {}) : SINONIMOS_EXECUCOES;
  const exatos = {};
  const porSinonimo = {};
  (cabecalho || []).forEach(function (celula, i) {
    const k = chaveDeCabecalho(celula);
    if (cols.indexOf(k) >= 0) { if (!(k in exatos)) exatos[k] = i; return; }
    const s = sins[k];
    if (s && cols.indexOf(s) >= 0 && !(s in porSinonimo)) porSinonimo[s] = i;
  });
  return Object.assign({}, porSinonimo, exatos);
}

const celulaTexto = function (v) {
  if (v === null || v === undefined) return '';
  if (ehData(v)) return textoDataHora(v);
  return String(v).trim();
};

const TEXTO_CABECALHOS = 'A aba Execuções precisa de uma linha de cabeçalho com: ' + COLUNAS_EXECUCOES.join(', ') + '.';

/**
 * Matriz da aba (alinhada à A1) → {ok:true, linhaCabecalho (0-based), cabecalho, indices,
 * execucoes} | falha 'planilha-sem-execucoes'. Cabeçalho: a primeira das 10 primeiras linhas com
 * 3+ colunas conhecidas (como o app). Cada execução: as 16 colunas como texto normalizado,
 * `inicioData` (Date ou null) e `_linha` (1-based).
 */
function lerExecucoes(linhas) {
  const ls = Array.isArray(linhas) ? linhas : [];
  for (let r = 0; r < Math.min(ls.length, 10); r++) {
    const indices = indicesDoCabecalho(ls[r] || []);
    if (Object.keys(indices).length < 3) continue;
    const faltam = ESSENCIAIS_EXECUCOES.filter(function (c) { return !(c in indices); });
    if (faltam.length) return falha('planilha-sem-execucoes', 'Faltam colunas na aba Execuções (' + faltam.join(', ') + '). ' + TEXTO_CABECALHOS);
    const execucoes = [];
    for (let i = r + 1; i < ls.length; i++) {
      const linha = ls[i] || [];
      if (!linha.some(function (v) { return celulaTexto(v) !== ''; })) continue;
      const e = { _linha: i + 1 };
      COLUNAS_EXECUCOES.forEach(function (c) { e[c] = c in indices ? celulaTexto(linha[indices[c]]) : ''; });
      e.bot = normalizarCabecalho(e.bot);
      e.rotina = comHifen(e.rotina);
      e.origem = normalizarOrigem(e.origem);
      e.quem = e.quem.toLowerCase();
      e.status = comHifen(e.status);
      e.teste = SIM.indexOf(normalizarCabecalho(e.teste)) >= 0 || ehTeste(e.id_alvo);
      e.inicioData = 'inicio' in indices ? lerDataHora(linha[indices.inicio]) : null;
      execucoes.push(e);
    }
    return { ok: true, linhaCabecalho: r, cabecalho: (ls[r] || []).slice(), indices: indices, execucoes: execucoes };
  }
  return falha('planilha-sem-execucoes', 'A aba Execuções está sem cabeçalho. ' + TEXTO_CABECALHOS);
}

/** Registro {coluna: valor} → linha na ORDEM REAL do cabeçalho (texto protegido com apóstrofo). */
function linhaNaOrdem(cabecalho, indices, registro) {
  const linha = (cabecalho || []).map(function () { return ''; });
  Object.keys(indices).forEach(function (c) {
    if (registro[c] !== undefined && registro[c] !== null) linha[indices[c]] = textoCelula(registro[c]);
  });
  return linha;
}

/* ------------------------------------------------------------------ aba Decisões (só radar-candidato) */

/** 'aprovada' | 'recusada' (igual a normalizarDecisao de js/selecao.js) ou o texto normalizado. */
function normalizarDecisao(v) {
  const s = normalizarCabecalho(v);
  if (/^aprov/.test(s) || s === 'sim' || s === 'ok') return 'aprovada';
  if (/^recus/.test(s) || s === 'nao') return 'recusada';
  return s;
}

/**
 * Matriz da aba Decisões → {ok:true, linhaCabecalho, cabecalho, indices, decisoes} | falha
 * 'decisoes-sem-colunas'. Cabeçalho: a primeira das 10 primeiras linhas com 3+ colunas conhecidas
 * (como o app); precisa ter as 11 colunas (as antigas e as novas), em qualquer ordem.
 */
function lerDecisoes(linhas) {
  const ls = Array.isArray(linhas) ? linhas : [];
  for (let r = 0; r < Math.min(ls.length, 10); r++) {
    const indices = indicesDoCabecalho(ls[r] || [], COLUNAS_DECISOES, {});
    if (Object.keys(indices).length < 3) continue;
    const faltam = COLUNAS_DECISOES.filter(function (c) { return !(c in indices); });
    if (faltam.length) {
      return falha('decisoes-sem-colunas', 'A aba Decisões ainda não tem as colunas ' + faltam.join(', ') + '. Nada foi pedido ao Radar; peça ao Programador para criá-las.');
    }
    const decisoes = [];
    for (let i = r + 1; i < ls.length; i++) {
      const linha = ls[i] || [];
      if (!linha.some(function (v) { return celulaTexto(v) !== ''; })) continue;
      const d = { _linha: i + 1 };
      COLUNAS_DECISOES.forEach(function (c) { d[c] = celulaTexto(linha[indices[c]]); });
      decisoes.push(d);
    }
    return { ok: true, linhaCabecalho: r, cabecalho: (ls[r] || []).slice(), indices: indices, decisoes: decisoes };
  }
  return falha('decisoes-sem-colunas', 'A aba Decisões está sem cabeçalho. Ela precisa de: ' + COLUNAS_DECISOES.join(', ') + '. Nada foi pedido ao Radar.');
}

/**
 * Título da pauta para Decisões a partir da aba Candidatos: o ângulo do candidato, senão o tema,
 * senão '' (quem chama usa o id). Lê pelo cabeçalho (id ou id_candidato, ângulo, tema).
 */
function tituloDoCandidato(linhas, id) {
  const ls = Array.isArray(linhas) ? linhas : [];
  const cols = ['id', 'angulo', 'tema'];
  for (let r = 0; r < Math.min(ls.length, 10); r++) {
    const ind = indicesDoCabecalho(ls[r] || [], cols, { id_candidato: 'id' });
    if (!('id' in ind) || Object.keys(ind).length < 2) continue;
    for (let i = r + 1; i < ls.length; i++) {
      const linha = ls[i] || [];
      if (celulaTexto(linha[ind.id]) !== id) continue;
      const t = ('angulo' in ind ? celulaTexto(linha[ind.angulo]) : '') || ('tema' in ind ? celulaTexto(linha[ind.tema]) : '');
      return umaLinha(t).slice(0, 300);
    }
    return '';
  }
  return '';
}

/**
 * A linha de aprovação que radar-candidato (destino 'roteirista') grava em Decisões, ou nada se o
 * candidato já tem uma aprovação lá (idempotente: por id_candidato + decisão aprovada).
 *   o = {decisoes (lerDecisoes), idCandidato, motivo, email, agora, idLote, titulo}
 * → {tipo:'ja-existe', linha} | {tipo:'gravar', registro}. O registro segue o que o app grava:
 * semana "S47" e data "AAAA-MM-DD HH:MM" em São Paulo, origem 'manual-app', id_pauta vazio (a
 * pauta ainda não existe; o Radar a cria).
 */
function planejarDecisaoCandidato(o) {
  const id = String(o.idCandidato || '').trim();
  const existente = (o.decisoes || []).filter(function (d) {
    return String(d.id_candidato || '').trim() === id && normalizarDecisao(d.decisao) === 'aprovada';
  })[0];
  if (existente) return { tipo: 'ja-existe', linha: existente._linha };
  return {
    tipo: 'gravar',
    registro: {
      semana: prefixoSemana(o.agora),
      pauta: String(o.titulo || '').trim() || id,
      decisao: 'aprovada',
      motivo: umaLinha(o.motivo).slice(0, MAX_MOTIVO_CANDIDATO),
      id_pauta: '',
      rede: '',
      id_candidato: id,
      id_lote: String(o.idLote || '').trim(),
      data: dataHoraPlanilha(o.agora),
      quem: minusc(o.email),
      origem: 'manual-app',
    },
  };
}

/* ------------------------------------------------------------------ trava e proteção */

// Linha do Radar com rotina que a ponte não conhece ainda conta no grupo radar (navegador único).
function grupoDaLinha(e) {
  if (rotinaConhecida(e.rotina)) return grupoDeTrava(e.rotina, e.id_alvo);
  return e.bot === 'radar' ? 'radar' : '';
}

function maisNovaPrimeiro(a, b) {
  const ta = a.inicioData ? a.inicioData.getTime() : -Infinity;
  const tb = b.inicioData ? b.inicioData.getTime() : -Infinity;
  if (tb !== ta) return tb > ta ? 1 : -1;
  return (b._linha || 0) - (a._linha || 0);
}

/**
 * Há rodada pedido/rodando do mesmo grupo? (igual a avaliarTrava de controle.js)
 *   < 2 h → {livre:false, motivo:'rodando', desde, origem, linha}
 *   ≥ 2 h ou sem início → {livre:false, motivo:'parece-travada', linha (a mais nova), linhas}
 *   senão {livre:true}. Origem 'agendada': sempre livre (a agendada nunca é bloqueada).
 */
function avaliarTrava(execucoes, rotina, idAlvo, agora, opcoes) {
  if (!rotinaConhecida(rotina)) return { livre: false, motivo: 'rotina-desconhecida' };
  if (opcoes && opcoes.origem === 'agendada') return { livre: true };
  const grupo = grupoDeTrava(rotina, idAlvo);
  const t = tempoDe(agora);
  const abertas = (execucoes || []).filter(function (e) { return ABERTOS.indexOf(e.status) >= 0 && grupoDaLinha(e) === grupo; }).sort(maisNovaPrimeiro);
  const recente = abertas.filter(function (e) { return e.inicioData && t - e.inicioData.getTime() < TRAVA_MS; })[0];
  if (recente) return { livre: false, motivo: 'rodando', desde: recente.inicioData, origem: recente.origem, linha: recente };
  if (abertas.length) return { livre: false, motivo: 'parece-travada', linha: abertas[0], linhas: abertas };
  return { livre: true };
}

const ROTULO_ORIGEM = { agendada: 'agendada', 'manual-app': 'pelo app', chat: 'pelo chat', vigia: 'pelo vigia' };

/** "Rodando desde 7h03 (agendada)." / "Parece travada: …". */
function textoTrava(res) {
  if (!res || res.livre) return '';
  if (res.motivo === 'rodando') {
    const o = ROTULO_ORIGEM[res.origem] || res.origem;
    return 'Rodando desde ' + horaCurta(res.desde) + (o ? ' (' + o + ')' : '') + '.';
  }
  if (res.motivo === 'parece-travada') {
    const d = res.linha && res.linha.inicioData;
    return 'Parece travada: está como "' + ((res.linha && res.linha.status) || 'rodando') + '"' + (d ? ' desde ' + diaEHora(d) : '') + ', há mais de 2 h. Para rodar de novo, marque como travada.';
  }
  return '';
}

/** Horários agendados de ontem, hoje e amanhã (São Paulo). */
function horariosPerto(agenda, agora) {
  const p = momentoNoFuso(agora);
  const out = [];
  [-1, 0, 1].forEach(function (d) {
    const diaSemana = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + d)).getUTCDay();
    if (agenda.dias.indexOf(diaSemana) >= 0) out.push(dataNoFuso(p.ano, p.mes, p.dia + d, agenda.hora, agenda.minuto, 0));
  });
  return out;
}

// A linha agendada daquele horário: mesma rotina, origem agendada, início perto do horário.
function linhaAgendada(execucoes, rotina, horario) {
  const h = horario.getTime();
  return (execucoes || []).filter(function (e) {
    return e.rotina === rotina && e.origem === 'agendada' && e.inicioData
      && e.inicioData.getTime() >= h - PROTECAO_ANTES_MS && e.inicioData.getTime() <= h + PROTECAO_SEM_LINHA_MS;
  }).sort(maisNovaPrimeiro)[0] || null;
}

/**
 * Janela de proteção (igual a avaliarProtecao de controle.js): o manual fica fechado de 60 min
 * antes do horário agendado até a linha agendada fechar (ok/parcial/erro/travada); sem linha, até
 * 2 h depois do horário. No grupo radar vale para as três rotinas do Radar.
 * → {livre:true} | {livre:false, motivo:'protecao', rotinaAgendada, horario, ate, linha}.
 */
function avaliarProtecao(execucoes, rotina, agora, opcoes) {
  if (!rotinaConhecida(rotina)) return { livre: false, motivo: 'rotina-desconhecida' };
  if (opcoes && opcoes.origem === 'agendada') return { livre: true };
  const def = ROTINAS[rotina];
  const alvos = def.grupo === 'radar'
    ? Object.keys(ROTINAS).filter(function (r) { return ROTINAS[r].grupo === 'radar' && ROTINAS[r].agenda; })
    : (def.agenda ? [rotina] : []);
  const t = tempoDe(agora);
  const bloqueios = [];
  alvos.forEach(function (r) {
    horariosPerto(ROTINAS[r].agenda, agora).forEach(function (horario) {
      if (t < horario.getTime() - PROTECAO_ANTES_MS) return;
      const linha = linhaAgendada(execucoes, r, horario);
      if (linha) {
        if (FECHADOS.indexOf(linha.status) >= 0) return;
        bloqueios.push({ livre: false, motivo: 'protecao', rotinaAgendada: r, horario: horario, ate: null, linha: linha });
      } else {
        const ate = new Date(horario.getTime() + PROTECAO_SEM_LINHA_MS);
        if (t >= ate.getTime()) return;
        bloqueios.push({ livre: false, motivo: 'protecao', rotinaAgendada: r, horario: horario, ate: ate, linha: null });
      }
    });
  });
  if (!bloqueios.length) return { livre: true };
  return bloqueios.sort(function (a, b) { return b.horario - a.horario; })[0];
}

/** "Perto da rodada agendada (Radar diário, hoje às 7h): o disparo manual fica fechado até 9h. …" */
function textoProtecao(res, agora) {
  if (!res || res.livre || res.motivo !== 'protecao') return '';
  const def = ROTINAS[res.rotinaAgendada];
  const quando = diaRelativo(res.horario, agora) + ' às ' + horaCurta(res.horario);
  const fim = res.ate ? 'até ' + horaCurta(res.ate) : 'até ela terminar';
  const porque = def.grupo === 'radar' ? ' O navegador do Radar faz uma tarefa por vez.' : '';
  return 'Perto da rodada agendada (' + def.rotulo + ', ' + quando + '): o disparo manual fica fechado ' + fim + '.' + porque;
}

/** Disparos manuais (origem manual-app) da rotina iniciados na última hora, qualquer status. */
function contarDisparosNaHora(execucoes, rotina, agora) {
  const t = tempoDe(agora);
  return (execucoes || []).filter(function (e) {
    return e.rotina === rotina && e.origem === 'manual-app' && e.inicioData
      && t - e.inicioData.getTime() < HORA_MS && e.inicioData.getTime() <= t + 60000;
  }).length;
}

/**
 * Limite por hora da rotina: LIMITE_POR_HORA_<ROTINA>, senão o padrão da rotina no catálogo
 * (radar-candidato: 15, um por candidato escolhido), senão LIMITE_POR_HORA, senão 4.
 */
function limitePorHora(props, rotina) {
  const ler = function (k) {
    const v = props ? props[k] : undefined;
    return v !== undefined && v !== null && /^\s*\d+\s*$/.test(String(v)) ? Number(v) : null;
  };
  const daRotina = ler('LIMITE_POR_HORA_' + nomeDePropriedade(rotina));
  if (daRotina !== null) return daRotina;
  const geral = ler('LIMITE_POR_HORA');
  if (geral === 0) return 0; // LIMITE_POR_HORA = 0 fecha tudo, inclusive as rotinas com padrão próprio
  const doCatalogo = rotinaConhecida(rotina) ? ROTINAS[rotina].limitePorHora : undefined;
  if (Number.isInteger(doCatalogo)) return doCatalogo;
  return geral !== null ? geral : LIMITE_POR_HORA_PADRAO;
}

/* ------------------------------------------------------------------ registro e plano */

/** "EX-AAAAMMDD-HHMMSS-xxxx" na hora de São Paulo (igual a novoIdExecucao do app). */
function novoIdExecucao(agora, sufixo) {
  const p = momentoNoFuso(agora);
  return 'EX-' + p.ano + dois(p.mes) + dois(p.dia) + '-' + dois(p.hora) + dois(p.minuto) + dois(p.segundo) + '-' + sufixo;
}

/** As 16 colunas da linha do pedido manual. */
function montarRegistroExecucao(o) {
  return {
    id_execucao: o.idExecucao,
    chave_idem: o.chaveIdem,
    bot: ROTINAS[o.rotina].bot,
    rotina: o.rotina,
    origem: 'manual-app',
    quem: minusc(o.email),
    id_alvo: o.idAlvo || '',
    id_lote: o.idLote || '',
    etapa_evento: '',
    inicio: textoDataHora(o.agora),
    fim: '',
    status: 'pedido',
    resumo: o.resumo || '',
    erro: '',
    link: '',
    teste: campoTeste(o.idAlvo),
  };
}

/**
 * O que fazer com um pedido já conferido, dadas as Execuções lidas SOB O LOCK.
 *   o = {conferido, pedido, email, execucoes, agora, limite, idExecucao}
 * → {tipo:'repetido', resposta} | {tipo:'recusa', resposta}
 *   | {tipo:'gravar', registro, travadas:[linhas a marcar 'travada']}.
 * Ordem: chave_idem → trava → janela de proteção → limite por hora.
 * Nada é gravado aqui; a camada de serviços aplica o plano.
 */
function planejarExecucao(o) {
  const c = o.conferido;
  const p = o.pedido;
  const execs = o.execucoes || [];
  const existente = execs.filter(function (e) { return e.chave_idem && e.chave_idem === p.chave_idem; })[0];
  if (existente) {
    if (existente.rotina !== c.rotina) return { tipo: 'recusa', resposta: falha('pedido-invalido', 'Esta chave de pedido já foi usada em outra rotina.') };
    if (existente.status === 'erro') return { tipo: 'recusa', resposta: falha('repetido-com-erro', null, { id_execucao: existente.id_execucao, status: 'erro' }) };
    return { tipo: 'repetido', resposta: { ok: true, repetido: true, id_execucao: existente.id_execucao, status: existente.status } };
  }

  const trava = avaliarTrava(execs, c.rotina, p.id_alvo, o.agora);
  let travadas = [];
  if (!trava.livre) {
    if (trava.motivo === 'rodando') {
      return { tipo: 'recusa', resposta: falha('rodando', textoTrava(trava), { desde: textoDataHora(trava.desde), origem: trava.origem }) };
    }
    const idAberta = String(trava.linha.id_execucao || '');
    const extra = { id_execucao_travada: idAberta, desde: trava.linha.inicioData ? textoDataHora(trava.linha.inicioData) : '' };
    if (!c.marcarTravada) return { tipo: 'recusa', resposta: falha('parece-travada', textoTrava(trava), extra) };
    if (c.idTravada !== idAberta) {
      return { tipo: 'recusa', resposta: falha('parece-travada', 'A rodada aberta mudou desde que a janela abriu. Feche e abra de novo para conferir.', extra) };
    }
    travadas = trava.linhas;
  }

  // Marcar como travada também fecha a linha que segura a janela de proteção (como no app).
  const depois = execs.map(function (e) { return travadas.indexOf(e) >= 0 ? Object.assign({}, e, { status: 'travada' }) : e; });
  const protecao = avaliarProtecao(depois, c.rotina, o.agora);
  if (!protecao.livre) {
    return { tipo: 'recusa', resposta: falha('protecao', textoProtecao(protecao, o.agora), { ate: protecao.ate ? textoDataHora(protecao.ate) : '' }) };
  }

  const n = contarDisparosNaHora(execs, c.rotina, o.agora);
  if (n >= o.limite) {
    return { tipo: 'recusa', resposta: falha('limite', 'Já foram ' + n + ' pedidos de "' + c.def.rotulo + '" na última hora (o limite é ' + o.limite + '). Espere um pouco.') };
  }

  let resumo = c.resumo;
  if (travadas.length) resumo = ('rodar de novo; ' + (travadas[0].id_execucao || 'a anterior') + ' marcada como travada' + (resumo ? '; ' + resumo : '')).slice(0, 200);
  const registro = montarRegistroExecucao({
    idExecucao: o.idExecucao, chaveIdem: p.chave_idem, rotina: c.rotina, email: o.email,
    idAlvo: p.id_alvo, idLote: p.id_lote, agora: o.agora, resumo: resumo,
  });
  return { tipo: 'gravar', registro: registro, travadas: travadas };
}

/* ------------------------------------------------------------------ guardas de gravação */

/**
 * Ids T (teste: qualquer id que começa com T, de roteiro ou de candidato) nunca vão para Decisões
 * nem Desempenho (PLANO 6 e 13). Toda gravação nessas abas passa aqui.
 * → {ok:true} | falha 'teste-recusado'.
 */
function podeGravarNaAba(aba, id) {
  const a = chaveDeCabecalho(aba);
  if (ABAS_PROIBIDAS_PARA_TESTE.indexOf(a) >= 0 && ehIdDeTeste(id)) return falha('teste-recusado');
  return { ok: true };
}

/**
 * Onde a ponte grava: a aba Execuções (ABA_EXECUCOES) sempre; a aba Decisões (ABA_DECISOES) SÓ no
 * pedido radar-candidato com destino 'roteirista' (`opcoes` = {rotina, destino, nomeDecisoes}).
 */
function abaGravavelPelaPonte(aba, nomeExecucoes, opcoes) {
  if (!aba) return false;
  const a = chaveDeCabecalho(aba);
  if (a === chaveDeCabecalho(nomeExecucoes || 'Execuções')) return true;
  const o = opcoes || {};
  return o.rotina === 'radar-candidato' && o.destino === 'roteirista' && a === chaveDeCabecalho(o.nomeDecisoes || 'Decisões');
}

/** As duas guardas juntas (usadas antes de toda escrita na planilha). */
function conferirGravacao(aba, id, nomeExecucoes, opcoes) {
  const t = podeGravarNaAba(aba, id);
  if (!t.ok) return t;
  return abaGravavelPelaPonte(aba, nomeExecucoes, opcoes) ? { ok: true } : falha('aba-nao-permitida');
}

/* ------------------------------------------------------------------ webhook */

/** 'radar-diario' → 'RADAR_DIARIO'. */
function nomeDePropriedade(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function urlHttpsValida(url) {
  return /^https:\/\/[^\s/?#]+[^\s]*$/i.test(String(url || ''));
}

/** Os três webhooks, um por bot. */
const WEBHOOKS_POR_BOT = { radar: 'WEBHOOK_RADAR', roteirista: 'WEBHOOK_ROTEIRISTA', diretor: 'WEBHOOK_DIRETOR' };

/**
 * Webhook do bot da rotina: WEBHOOK_<BOT>_URL + WEBHOOK_<BOT>_KEY (RADAR para as três do Radar,
 * ROTEIRISTA para roteirista-decisao, DIRETOR para diretor-retrospectiva).
 * → {url, chave} | null (não configurado, sem chave ou sem https).
 */
function escolherWebhook(props, rotina) {
  const p = props || {};
  const base = rotinaConhecida(rotina) ? WEBHOOKS_POR_BOT[ROTINAS[rotina].bot] : '';
  if (!base) return null;
  const url = String(p[base + '_URL'] || '').trim();
  const chave = String(p[base + '_KEY'] || '').trim();
  if (!url || !chave || !urlHttpsValida(url)) return null;
  return { url: url, chave: chave };
}

/**
 * Corpo JSON enviado ao webhook do bot, EXATAMENTE estes campos:
 * {rotina, id_execucao, chave_idem, origem:'manual-app', quem, id_alvo, id_lote, dados}.
 */
function montarPayloadWebhook(o) {
  const r = o.registro;
  return {
    rotina: r.rotina,
    id_execucao: r.id_execucao,
    chave_idem: r.chave_idem,
    origem: 'manual-app',
    quem: r.quem,
    id_alvo: r.id_alvo,
    id_lote: r.id_lote,
    dados: Object.assign({}, o.dadosBot),
  };
}

/** HTTP 2xx? */
function respostaHttpOk(codigo) {
  return codigo >= 200 && codigo < 300;
}

/** Vale tentar de novo? (rede, 429 e 5xx; 4xx não). */
function vaiTentarDeNovo(codigo) {
  return codigo === 0 || codigo === 429 || codigo >= 500;
}

/* ------------------------------------------------------------------ configuração */

/* ------------------------------------------------------------------ configuração inicial (Setup.gs) */

/**
 * A ação 'configurar' só existe quando o arquivo ponte/Setup.gs (NÃO versionado; o script de
 * implantação o gera e apaga) define a constante global PONTE_SETUP_HASH = sha256 hex de um
 * código aleatório de uso único. O código é a autenticação (sem access_token). Nada vai para log.
 */
const CAMPOS_CONFIGURAR = ['acao', 'codigo', 'propriedades'];
const PROPRIEDADES_CONFIGURAVEIS = [
  'PLANILHA_ID', 'CLIENT_ID', 'EMAILS_DISPARAR', 'EMAILS_DECIDIR', 'ABA_EXECUCOES', 'ABA_DECISOES', 'ABA_CANDIDATOS', 'LIMITE_POR_HORA',
  'WEBHOOK_RADAR_URL', 'WEBHOOK_RADAR_KEY', 'WEBHOOK_ROTEIRISTA_URL', 'WEBHOOK_ROTEIRISTA_KEY',
  'WEBHOOK_DIRETOR_URL', 'WEBHOOK_DIRETOR_KEY',
];
const MAX_VALOR_PROPRIEDADE = 2000;

/** Corpo {acao:'configurar', codigo, propriedades:{...}} → {ok:true, pedido} | falha. */
function lerPedidoDeConfiguracao(j) {
  const extras = Object.keys(j).filter(function (k) { return CAMPOS_CONFIGURAR.indexOf(k) < 0; });
  if (extras.length) return falha('pedido-invalido', 'O pedido tem campos que a ponte não conhece.');
  if (typeof j.codigo !== 'string' || j.codigo.length < 16 || j.codigo.length > 200) return falha('configuracao-recusada');
  const props = j.propriedades;
  if (!ehObjetoPlano(props) || !Object.keys(props).length) return falha('pedido-invalido', 'Faltam as propriedades.');
  const nomes = Object.keys(props);
  for (let i = 0; i < nomes.length; i++) {
    const k = nomes[i];
    const v = props[k];
    if (PROPRIEDADES_CONFIGURAVEIS.indexOf(k) < 0) return falha('pedido-invalido', 'Propriedade fora da lista: ' + String(k).slice(0, 40) + '.');
    if (typeof v !== 'string' || v.length > MAX_VALOR_PROPRIEDADE) return falha('pedido-invalido', 'O valor de ' + k + ' precisa ser texto de até 2000 caracteres.');
    if (/_URL$/.test(k) && !urlHttpsValida(v.trim())) return falha('pedido-invalido', k + ' precisa ser um endereço https.');
  }
  const copia = {};
  nomes.forEach(function (k) { copia[k] = props[k]; });
  return { ok: true, pedido: { acao: 'configurar', codigo: j.codigo, propriedades: copia } };
}

/** Comparação de textos em tempo constante (para o hash do código). */
function iguaisTempoConstante(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  let dif = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) dif |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return dif === 0;
}

/** Propriedades do script → configuração (sem nunca devolver valores secretos para fora). */
function lerConfiguracao(props) {
  const p = props || {};
  return {
    clientId: String(p.CLIENT_ID || '').trim(),
    planilhaId: String(p.PLANILHA_ID || '').trim(),
    abaExecucoes: String(p.ABA_EXECUCOES || '').trim() || 'Execuções',
    abaDecisoes: String(p.ABA_DECISOES || '').trim() || 'Decisões',
    abaCandidatos: String(p.ABA_CANDIDATOS || '').trim() || 'Candidatos',
    listas: { disparar: listaDeEmails(p.EMAILS_DISPARAR), decidir: listaDeEmails(p.EMAILS_DECIDIR) },
  };
}

/* ======================================================================================
 * PARTE B — SERVIÇOS DO APPS SCRIPT (camada fina)
 * ==================================================================================== */

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo?access_token=';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const CACHE_TOKEN_MAX_S = 120;
const ESPERA_LOCK_MS = 10000;

/** Relógio (os testes trocam esta função). */
function agora_() {
  return new Date();
}

/** 4 hex aleatórios para o id_execucao. */
function sufixoAleatorio_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 4).toLowerCase();
}

/** Resposta JSON do app da Web. */
function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Log sem segredo: só texto fixo + detalhe redigido (sem token, URL ou Bearer). */
function registrar_(nivel, texto, segredos) {
  try {
    const s = redigir(texto, segredos).slice(0, 500);
    if (nivel === 'erro') console.error('ponte: ' + s);
    else console.info('ponte: ' + s);
  } catch (e) { /* log nunca derruba a ponte */ }
}

/** Saúde: sem dados. */
function doGet() {
  return responder_({ ok: true, servico: SERVICO_PONTE });
}

/** Pedido do app (text/plain com JSON). Sempre responde JSON. */
function doPost(e) {
  let token = '';
  try {
    const r = processarPedido_(e, function (t) { token = t; });
    return responder_(r);
  } catch (erro) {
    registrar_('erro', 'erro interno: ' + (erro && erro.name ? erro.name + ': ' : '') + (erro && erro.message ? erro.message : String(erro)), [token]);
    return responder_(falha('erro-interno'));
  }
}

/** Hash do código de uso único definido em Setup.gs (não versionado), ou '' sem ele. */
function hashDeSetup_() {
  // typeof não quebra com identificador não declarado: sem Setup.gs, devolve ''.
  const h = typeof PONTE_SETUP_HASH === 'undefined' ? '' : String(PONTE_SETUP_HASH || '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(h) ? h : '';
}

/** acao 'configurar': confere o código e grava só as propriedades da lista. Sem log, sem valores. */
function aplicarConfiguracao_(pedido, hashEsperado) {
  try {
    if (!iguaisTempoConstante(hashHex_(pedido.codigo), hashEsperado)) return falha('configuracao-recusada');
    PropertiesService.getScriptProperties().setProperties(pedido.propriedades, false);
    return { ok: true, gravadas: Object.keys(pedido.propriedades).sort() };
  } catch (e) {
    return falha('erro-interno'); // de propósito sem log: a mensagem poderia ter valores
  }
}

function processarPedido_(e, guardarTokenParaRedigir) {
  const texto = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  const hashSetup = hashDeSetup_();
  const lido = lerPedido(texto, { setup: !!hashSetup });
  if (!lido.ok) return lido;
  if (lido.pedido.acao === 'configurar') return aplicarConfiguracao_(lido.pedido, hashSetup);
  const pedido = lido.pedido;
  const token = pedido.access_token;
  delete pedido.access_token; // daqui em diante o token só existe nesta variável
  guardarTokenParaRedigir(token);

  const props = PropertiesService.getScriptProperties().getProperties();
  const cfg = lerConfiguracao(props);
  if (!cfg.clientId || !cfg.planilhaId) return falha('ponte-sem-configuracao');

  const ident = validarToken_(token, cfg.clientId);
  if (!ident.ok) return ident;

  const conferido = conferirPedido(pedido, ident.email, cfg.listas);
  if (!conferido.ok) return conferido;

  // ---- sob o lock: ler Execuções, decidir e gravar
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(ESPERA_LOCK_MS)) return falha('ocupado');
  let plano;
  let decisao = null;
  const agora = agora_();
  try {
    const aba = garantirExecucoes_(cfg);
    const tabela = lerExecucoes(aba.getDataRange().getValues());
    if (!tabela.ok) return tabela;
    plano = planejarExecucao({
      conferido: conferido, pedido: pedido, email: ident.email, execucoes: tabela.execucoes, agora: agora,
      limite: limitePorHora(props, conferido.rotina), idExecucao: novoIdExecucao(agora, sufixoAleatorio_()),
    });
    if (plano.tipo !== 'gravar') return plano.resposta;
    const guarda = conferirGravacao(aba.getName(), plano.registro.id_alvo, cfg.abaExecucoes);
    if (!guarda.ok) return guarda;
    // radar-candidato → Roteirista: confere Decisões ANTES de gravar qualquer coisa (sem as colunas,
    // nada é gravado nem repassado).
    if (conferido.gravaDecisao) {
      decisao = prepararDecisaoCandidato_(cfg, conferido, pedido, ident.email, agora);
      if (!decisao.ok) return decisao;
    }
    plano.travadas.forEach(function (linha) { marcarTravada_(aba, tabela.indices, linha, plano.registro.id_execucao); });
    aba.getRange(aba.getLastRow() + 1, 1, 1, tabela.cabecalho.length)
      .setValues([linhaNaOrdem(tabela.cabecalho, tabela.indices, plano.registro)]);
    // A aprovação vai para Decisões ANTES do webhook (sem ela o Radar recusa o pedido). Se a escrita
    // falhar, nada é repassado: a linha de Execuções fecha com erro, fora do lock, logo abaixo.
    if (decisao && decisao.tipo === 'gravar') {
      try {
        decisao.aba.getRange(decisao.aba.getLastRow() + 1, 1, 1, decisao.tabela.cabecalho.length)
          .setValues([linhaNaOrdem(decisao.tabela.cabecalho, decisao.tabela.indices, decisao.registro)]);
      } catch (err) {
        decisao = { ok: false, tipo: 'falhou' };
      }
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  if (decisao && decisao.tipo === 'falhou') {
    fecharComErro_(cfg, plano.registro.id_execucao, 'não consegui gravar a aprovação em Decisões');
    registrar_('info', plano.registro.rotina + ' ' + plano.registro.id_execucao + ': Decisões não gravada, nada repassado');
    return falha('decisoes-falhou', null, { id_execucao: plano.registro.id_execucao, status: 'erro' });
  }
  // 'gravada' (linha nova em Decisões) | 'ja-existia' (o candidato já estava aprovado lá) | ''
  const situacaoDecisao = !decisao ? '' : (decisao.tipo === 'gravar' ? 'gravada' : 'ja-existia');
  const comDecisao = situacaoDecisao ? { decisao: situacaoDecisao } : {};
  const notaDecisao = situacaoDecisao ? ' A aprovação ficou em Decisões; ao pedir de novo, ela não é gravada outra vez.' : '';

  // ---- fora do lock: repassar ao bot
  const registro = plano.registro;
  const webhook = escolherWebhook(props, registro.rotina);
  if (!webhook) {
    fecharComErro_(cfg, registro.id_execucao, 'webhook não configurado');
    registrar_('info', registro.rotina + ' ' + registro.id_execucao + ': webhook não configurado');
    return falha('webhook-nao-configurado', notaDecisao ? MENSAGENS['webhook-nao-configurado'] + notaDecisao : null,
      Object.assign({ id_execucao: registro.id_execucao, status: 'erro' }, comDecisao));
  }
  const payload = montarPayloadWebhook({
    registro: registro, agora: agora, planilhaId: cfg.planilhaId, abaExecucoes: cfg.abaExecucoes, dadosBot: conferido.dadosBot,
  });
  const envio = enviarWebhook_(webhook, payload);
  if (!envio.ok) {
    fecharComErro_(cfg, registro.id_execucao, 'webhook falhou' + (envio.codigo ? ' (HTTP ' + envio.codigo + ')' : ' (sem resposta)'));
    registrar_('info', registro.rotina + ' ' + registro.id_execucao + ': webhook falhou ' + envio.codigo);
    return falha('webhook-falhou', notaDecisao ? MENSAGENS['webhook-falhou'] + notaDecisao : null,
      Object.assign({ id_execucao: registro.id_execucao, status: 'erro' }, comDecisao));
  }
  registrar_('info', registro.rotina + ' ' + registro.id_execucao + ': pedido entregue');
  return Object.assign({ ok: true, id_execucao: registro.id_execucao, status: 'pedido', rotina: registro.rotina, teste: registro.teste === 'sim' }, comDecisao);
}

/**
 * Sob o lock, só para radar-candidato com destino 'roteirista': abre a aba Decisões (ABA_DECISOES),
 * confere a guarda (Decisões só nesta rotina e destino; nunca id T) e as 11 colunas, e planeja a
 * linha de aprovação (ou nada, se o candidato já está aprovado). O título vem da aba Candidatos
 * (ângulo ou tema), se ela existir; senão, o id. Nada é gravado aqui.
 * → {ok:true, aba, tabela, tipo:'gravar', registro} | {ok:true, aba, tabela, tipo:'ja-existe'} | falha.
 */
function prepararDecisaoCandidato_(cfg, conferido, pedido, email, agora) {
  const planilha = SpreadsheetApp.openById(cfg.planilhaId);
  const abaDec = planilha.getSheetByName(cfg.abaDecisoes);
  if (!abaDec) return falha('decisoes-sem-colunas', 'A aba "' + cfg.abaDecisoes + '" não foi encontrada na planilha Radar. Nada foi pedido ao Radar.');
  const id = conferido.dadosBot.id_candidato;
  const guarda = conferirGravacao(abaDec.getName(), id, cfg.abaExecucoes, { rotina: conferido.rotina, destino: conferido.dadosBot.destino, nomeDecisoes: cfg.abaDecisoes });
  if (!guarda.ok) return guarda;
  const tabela = lerDecisoes(abaDec.getDataRange().getValues());
  if (!tabela.ok) return tabela;
  let titulo = '';
  try {
    const abaCand = planilha.getSheetByName(cfg.abaCandidatos);
    if (abaCand) titulo = tituloDoCandidato(abaCand.getDataRange().getValues(), id);
  } catch (e) {
    titulo = ''; // sem a aba Candidatos, o título é o id
  }
  const plano = planejarDecisaoCandidato({
    decisoes: tabela.decisoes, idCandidato: id, motivo: conferido.dadosBot.motivo, email: email, agora: agora, idLote: pedido.id_lote, titulo: titulo,
  });
  return Object.assign({ ok: true, aba: abaDec, tabela: tabela }, plano);
}

/* ------------------------------------------------------------------ token */

function hashHex_(texto) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

/** GET que nunca lança nem deixa a URL (com o token) chegar a um log. → {codigo, json}. */
function buscarJson_(url, params) {
  try {
    const r = UrlFetchApp.fetch(url, Object.assign({ method: 'get', muteHttpExceptions: true, followRedirects: false }, params || {}));
    let json = null;
    try { json = JSON.parse(r.getContentText()); } catch (e) { json = null; }
    return { codigo: r.getResponseCode(), json: json };
  } catch (e) {
    return { codigo: 0, json: null };
  }
}

/**
 * Confere o token de acesso no Google (tokeninfo; userinfo se faltar o e-mail). O resultado bom
 * fica até 2 min no CacheService pela chave SHA-256 do token (nunca o token).
 */
function validarToken_(token, clientId) {
  let cache = null;
  let chave = '';
  try {
    cache = CacheService.getScriptCache();
    chave = 'tok:' + hashHex_(token + '|' + clientId);
    const guardado = cache.get(chave);
    if (guardado) {
      const g = JSON.parse(guardado);
      if (g && g.email) return { ok: true, email: g.email };
    }
  } catch (e) {
    cache = null;
  }
  const info = buscarJson_(TOKENINFO_URL + encodeURIComponent(token));
  if (info.codigo === 0 || info.codigo >= 500) return falha('verificacao-indisponivel');
  if (info.codigo !== 200) return falha('token-invalido');
  let userinfo = null;
  if (info.json && !info.json.email) {
    const u = buscarJson_(USERINFO_URL, { headers: { Authorization: 'Bearer ' + token } });
    if (u.codigo === 0 || u.codigo >= 500) return falha('verificacao-indisponivel');
    userinfo = u.codigo === 200 ? u.json : null;
  }
  const res = avaliarTokenInfo(info.json, clientId, userinfo);
  if (res.ok && cache) {
    try {
      const ttl = Math.min(CACHE_TOKEN_MAX_S, Math.floor(res.expiraEm) - 5);
      if (ttl > 0) cache.put(chave, JSON.stringify({ email: res.email }), ttl);
    } catch (e) { /* cache é opcional */ }
  }
  return res.ok ? { ok: true, email: res.email } : res;
}

/* ------------------------------------------------------------------ planilha */

function abrirExecucoes_(cfg) {
  return SpreadsheetApp.openById(cfg.planilhaId).getSheetByName(cfg.abaExecucoes);
}

/**
 * Sob o lock: a aba Execuções, criada se não existir (cabeçalho com as 16 colunas e a linha 1
 * congelada). Existindo e vazia, recebe o cabeçalho.
 */
function garantirExecucoes_(cfg) {
  const planilha = SpreadsheetApp.openById(cfg.planilhaId);
  let aba = planilha.getSheetByName(cfg.abaExecucoes);
  if (!aba) aba = planilha.insertSheet(cfg.abaExecucoes);
  if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, COLUNAS_EXECUCOES.length).setValues([COLUNAS_EXECUCOES.slice()]);
    aba.setFrozenRows(1);
    SpreadsheetApp.flush();
  }
  return aba;
}

/**
 * Rode UMA vez no editor para dar o consentimento dos escopos (planilhas e chamadas externas).
 * Não muda nada: só abre a planilha (se PLANILHA_ID existir) e faz um GET qualquer.
 */
function autorizar() {
  const id = PropertiesService.getScriptProperties().getProperty('PLANILHA_ID');
  if (id) SpreadsheetApp.openById(id);
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  console.log('Autorização concluída.');
}

/** Linha aberta antiga → status 'travada' (nada é apagado; `erro` só é preenchido se estiver vazio). */
function marcarTravada_(aba, indices, linha, idNovo) {
  aba.getRange(linha._linha, indices.status + 1).setValue(textoCelula('travada'));
  if ('erro' in indices && !linha.erro) {
    aba.getRange(linha._linha, indices.erro + 1).setValue(textoCelula('marcada como travada pelo app (' + idNovo + ')'));
  }
}

/** Depois de soltar o lock: a linha do pedido vira 'erro' (erro curto, sem URL nem chave). */
function fecharComErro_(cfg, idExecucao, erroCurto) {
  const lock = LockService.getScriptLock();
  const comLock = lock.tryLock(ESPERA_LOCK_MS);
  try {
    const aba = abrirExecucoes_(cfg);
    if (!aba || !conferirGravacao(aba.getName(), '', cfg.abaExecucoes).ok) return;
    const tabela = lerExecucoes(aba.getDataRange().getValues());
    if (!tabela.ok) return;
    const linha = tabela.execucoes.filter(function (x) { return x.id_execucao === idExecucao; })[0];
    if (!linha || linha.status !== 'pedido') return; // o bot já mexeu nela: não sobrescreve
    aba.getRange(linha._linha, tabela.indices.status + 1).setValue(textoCelula('erro'));
    if ('erro' in tabela.indices) aba.getRange(linha._linha, tabela.indices.erro + 1).setValue(textoCelula(erroCurto));
    if ('fim' in tabela.indices) aba.getRange(linha._linha, tabela.indices.fim + 1).setValue(textoCelula(textoDataHora(agora_())));
    SpreadsheetApp.flush();
  } catch (e) {
    registrar_('erro', 'não consegui marcar ' + idExecucao + ' como erro');
  } finally {
    if (comLock) lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ webhook */

/** POST JSON com Bearer, até 2 tentativas. → {ok, codigo}. Nunca loga URL nem chave. */
function enviarWebhook_(webhook, payload) {
  let codigo = 0;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const r = UrlFetchApp.fetch(webhook.url, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + webhook.chave },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
        followRedirects: false,
      });
      codigo = r.getResponseCode();
    } catch (e) {
      codigo = 0;
    }
    if (respostaHttpOk(codigo)) return { ok: true, codigo: codigo };
    if (!vaiTentarDeNovo(codigo)) break;
    if (tentativa < 2) Utilities.sleep(1500);
  }
  return { ok: false, codigo: codigo };
}

/* ------------------------------------------------------------------ conferência manual */

/**
 * Rode no editor para conferir a instalação. Só VALIDA: diz o que falta, sem imprimir valores
 * (nem URL, nem chave, nem e-mail). Devolve {ok, faltas, avisos}.
 */
function configurar() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const cfg = lerConfiguracao(props);
  const faltas = [];
  const avisos = [];
  if (!cfg.clientId) faltas.push('CLIENT_ID (o client_id OAuth do app; o mesmo de js/config.js)');
  if (!cfg.planilhaId) faltas.push('PLANILHA_ID (id da planilha Radar)');
  if (!cfg.listas.decidir.length) faltas.push('EMAILS_DECIDIR (vazia: ninguém decide)');
  if (!cfg.listas.disparar.length) avisos.push('EMAILS_DISPARAR vazia: só quem está em EMAILS_DECIDIR dispara.');
  console.log('E-mails: ' + cfg.listas.decidir.length + ' em EMAILS_DECIDIR, ' + cfg.listas.disparar.length + ' em EMAILS_DISPARAR.');
  Object.keys(WEBHOOKS_POR_BOT).forEach(function (bot) {
    const base = WEBHOOKS_POR_BOT[bot];
    const rotina = Object.keys(ROTINAS).filter(function (r) { return ROTINAS[r].bot === bot && ROTINAS[r].disparavel; })[0];
    if (escolherWebhook(props, rotina)) console.log(bot + ': webhook configurado.');
    else if (props[base + '_URL'] || props[base + '_KEY']) faltas.push(bot + ': webhook sem chave ou sem https (' + base + '_URL + ' + base + '_KEY)');
    else avisos.push(bot + ': sem webhook (' + base + '_URL + ' + base + '_KEY).');
  });
  if (cfg.planilhaId) {
    try {
      const aba = abrirExecucoes_(cfg);
      if (!aba) faltas.push('a aba "' + cfg.abaExecucoes + '" não existe. ' + TEXTO_CABECALHOS);
      else {
        const t = lerExecucoes(aba.getDataRange().getValues());
        if (!t.ok) faltas.push(t.mensagem);
        else {
          const ausentes = COLUNAS_EXECUCOES.filter(function (c) { return !(c in t.indices); });
          if (ausentes.length) avisos.push('Colunas opcionais ausentes em Execuções: ' + ausentes.join(', ') + '.');
          console.log('Aba Execuções ok (' + t.execucoes.length + ' linhas).');
        }
      }
    } catch (e) {
      faltas.push('não consegui abrir a planilha (confira PLANILHA_ID e o acesso da conta que implanta)');
    }
  }
  faltas.forEach(function (f) { console.log('FALTA: ' + f); });
  avisos.forEach(function (a) { console.log('AVISO: ' + a); });
  console.log(faltas.length ? 'Configuração incompleta.' : 'Configuração ok.');
  return { ok: !faltas.length, faltas: faltas, avisos: avisos };
}
