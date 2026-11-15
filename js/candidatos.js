// CANDIDATOS (puro: sem DOM, sem rede): a aba Candidatos da planilha Radar, gravada pelo Radar
// diário, mostrada no chip "Candidatos" da tela Pautas.
//
//   lerCandidatos(linhas)        leitura pelo cabeçalho (tolerante a acento, caixa e espaços; nunca
//                                pela posição); colunas novas opcionais: id_execucao, origem
//   ordenarCandidatos(lista)     mais recente primeiro (data, depois id)
//   ultimaRodada(...)            quais candidatos vieram na última rodada do Radar diário
//   estadoDoCandidato(...)       em que pé está o candidato (Execuções, Seleção, Decisões)
//   rotuloOrigem(origem)         "pelo app" | "automática" (coluna origem, discreta no cartão)
//
// Estado do candidato NO APP (pontos 2 e 3): arquivo próprio `_motor/app/candidatos/<id>.json` no
// Drive (dentro de ROOT_FOLDER), nunca a planilha. {versao:1, id, estado, motivo?, historico:[…]}
//   ESTADOS_APP                  candidato | para-decidir | excluido | recusado
//   planejarEstadoCandidato(…)   regra pura de uma mudança (permissão, ids T, pedido em andamento)
//   lerArquivoCandidato(texto)   valida o JSON do arquivo
//   maisNovoPorNome(arquivos)    dois arquivos com o mesmo nome: vale o modifiedTime mais novo
//   mesclarEstadosApp(lidos, locais)  o que veio do Drive + o registro otimista da tela
//   separarCandidatos(…)         Candidatos / Para decidir (sem o Radar) / Excluídos
//   criarArquivosDoApp(deps)     leitura e gravação dos arquivos, com o Drive injetado (integra.js)
// A exclusão e a recusa só tocam esse arquivo: nada em Seleção, Decisões ou outras pastas do Drive.
//
// Ids de teste (T…) ficam fora da tela, como no resto do app. As pautas de "Para decidir" vêm da
// aba Seleção; os candidatos passados para lá pelo app (sem o Radar) aparecem num bloco à parte.

import { lerTabela, lerDataHora, hojeISO, idCandidatoValido, ehCandidatoTeste, chaveDeCabecalho } from './parse.js';
import { avaliarTrava, podeDecidir } from './controle.js';
import { normalizarDecisao, STATUS_PAUTA, estadoDasPautas, aprovacaoDoCandidato, MOTIVOS_RECUSA } from './selecao.js';

export const COLUNAS_CANDIDATOS = [
  'id', 'data', 'plataforma', 'link', 'criador', 'visualizacoes', 'mediana_do_criador', 'outlier_x',
  'tema', 'angulo', 'nota', 'status',
  // opcionais (o Radar passa a gravar): a rodada que achou o candidato e de onde ela veio
  'id_execucao', 'origem',
];

// Nomes parecidos que o Radar pode usar no cabeçalho → coluna do app.
export const SINONIMOS_CANDIDATOS = {
  id_candidato: 'id',
  mediana: 'mediana_do_criador',
  mediana_criador: 'mediana_do_criador',
  outlier: 'outlier_x',
  outlier_vezes: 'outlier_x',
  views: 'visualizacoes',
  visualizacao: 'visualizacoes',
  rede: 'plataforma',
  url: 'link',
  autor: 'criador',
  perfil: 'criador',
  execucao: 'id_execucao',
  rodada: 'id_execucao',
};

/**
 * Linhas da aba Candidatos (matriz alinhada à A1) → {encontrado, cabecalho, temIdExecucao,
 * candidatos}. Cada candidato tem as colunas (texto; '' quando a coluna não existe), `dataData`
 * (Date ou null), `teste`, `idOk` (id no formato AAAA-MM-DD-NN) e `_linha`. Linhas sem id ficam de fora.
 */
export function lerCandidatos(linhas) {
  const t = lerTabela(linhas, { colunas: COLUNAS_CANDIDATOS, sinonimos: SINONIMOS_CANDIDATOS, minimo: 3 });
  const candidatos = t.registros.filter((r) => r.id).map((r) => ({
    ...r,
    dataData: lerDataHora(r.data),
    teste: ehCandidatoTeste(r.id),
    idOk: idCandidatoValido(r.id),
  }));
  return { encontrado: t.encontrado, cabecalho: t.cabecalho, temIdExecucao: 'id_execucao' in t.indices, candidatos };
}

const msData = (c) => c.dataData?.getTime?.() ?? -Infinity;

/** Mais recente primeiro: pela data; na mesma data (ou sem data), pelo id, do maior para o menor. */
export function ordenarCandidatos(lista) {
  return [...(lista || [])].sort((a, b) => msData(b) - msData(a)
    || String(b.id).localeCompare(String(a.id), 'pt-BR', { numeric: true }));
}

/** Os que aparecem na tela (sem os de teste), já na ordem. */
export const candidatosDaTela = (lidos) => ordenarCandidatos((lidos?.candidatos || []).filter((c) => !c.teste));

/**
 * Contador do chip: candidatos sem os de teste e que continuam em Candidatos (fora os passados para
 * Para decidir, excluídos e recusados no app). null enquanto a aba não foi lida.
 */
export function contarCandidatos(lidos, locais = {}) {
  if (!lidos?.candidatos) return null;
  const estados = mesclarEstadosApp(lidos.app?.registros, locais);
  return lidos.candidatos.filter((c) => !c.teste && estadoApp(estados, c.id) === 'candidato').length;
}

const maisNovaPrimeiro = (a, b) => (b.inicioData?.getTime() ?? -Infinity) - (a.inicioData?.getTime() ?? -Infinity) || (b._linha || 0) - (a._linha || 0);

/**
 * Quais candidatos vieram na última rodada do Radar diário.
 *   Com a coluna id_execucao em Candidatos: os candidatos com o id_execucao da execução radar-diario
 *   mais recente com status ok ou parcial em Execuções (sem as de teste) → modo 'execucao'.
 *   Sem a coluna (ou sem essa execução): os da data mais recente → modo 'data', com `motivo`
 *   ('sem-coluna' | 'sem-execucao') para a tela dizer isso de forma honesta.
 *   Sem nada → modo 'nenhum'.
 * → {modo, ids: Set, idExecucao?, quando? (Date), dia? ('AAAA-MM-DD'), motivo?}
 */
export function ultimaRodada({ candidatos = [], temIdExecucao = false, execucoes = [] } = {}) {
  const lista = candidatos || [];
  if (temIdExecucao) {
    const u = (execucoes || []).filter((e) => e.rotina === 'radar-diario' && (e.status === 'ok' || e.status === 'parcial')
      && !e.teste && e.id_execucao).sort(maisNovaPrimeiro)[0];
    if (u) {
      return {
        modo: 'execucao', idExecucao: u.id_execucao, quando: u.inicioData || null,
        ids: new Set(lista.filter((c) => c.id_execucao === u.id_execucao).map((c) => c.id)),
      };
    }
  }
  const dias = lista.map((c) => (c.dataData ? hojeISO(c.dataData) : '')).filter(Boolean).sort();
  const dia = dias[dias.length - 1];
  if (!dia) return { modo: 'nenhum', ids: new Set() };
  return {
    modo: 'data', dia, motivo: temIdExecucao ? 'sem-execucao' : 'sem-coluna',
    ids: new Set(lista.filter((c) => c.dataData && hojeISO(c.dataData) === dia).map((c) => c.id)),
  };
}

const listaPautas = (s) => (Array.isArray(s) ? s : s?.pautas || []);
const listaDecisoes = (d) => (Array.isArray(d) ? d : d?.decisoes || []);

const ABERTOS = new Set(['pedido', 'rodando']);
const COM_ERRO = new Set(['erro', 'parcial', 'travada', 'recusado-pela-trava']);

/** Texto curto (uma linha, até 160) do que a Execução diz: o erro, senão o resumo. */
const textoDaLinha = (l) => String(l?.erro || l?.resumo || '').replace(/\s+/g, ' ').trim().slice(0, 160);

/** Origem da rodada que achou o candidato (coluna `origem`), em poucas palavras: "pelo app" | "automática". */
export function rotuloOrigem(origem) {
  const o = chaveDeCabecalho(origem);
  if (!o) return '';
  if (o === 'manual_app' || o === 'app' || o === 'manual') return 'pelo app';
  if (o.startsWith('automat') || o === 'agendada') return 'automática';
  return String(origem).trim();
}

/**
 * Em que pé está um candidato (para o cartão, e para não pedir duas vezes):
 *   'pauta'          o id_candidato aparece numa pauta da Seleção (a mais nova): {pauta, status (o
 *                    estado calculado da pauta), enviada, aprovacao, ficouParaDecidir, aberto, linha}
 *                    `ficouParaDecidir`: houve "Mandar ao Roteirista" (aprovação do candidato em
 *                    Decisões), mas a pauta continua proposta e o pedido já terminou: o Radar não a
 *                    mandou (a verificação das fontes não passou). `detalhe`: o erro/resumo da Execução.
 *   'andamento'      a linha mais nova de radar-candidato dele em Execuções está pedido/rodando
 *   'parece-travada' idem, aberta há 2 h ou mais (a janela oferece "marcar como travada")
 *   'erro'           a linha mais nova terminou com erro/parcial/travada: {erro, aprovacao} (pode tentar de novo)
 *   'aprovado'       Decisões tem uma linha aprovada com este id_candidato (a pauta ainda não chegou)
 *   'concluido'      a linha mais nova terminou ok, mas a pauta ainda não apareceu na Seleção
 *   'livre'          nada disso
 * `podePedir`: os botões ficam ativos (livre, erro e parece-travada).
 * `estadoPautas` (opcional): o Map de estadoDasPautas já calculado (a tela calcula uma vez só).
 */
export function estadoDoCandidato(candidato, {
  selecao = null, decisoes = null, execucoes = [], agora = new Date(), estadoPautas = null,
} = {}) {
  const id = String(candidato?.id ?? candidato ?? '').trim();
  const linhas = (execucoes || []).filter((e) => e.rotina === 'radar-candidato' && e.id_alvo === id).sort(maisNovaPrimeiro);
  const u = linhas[0];
  const aberto = !!u && ABERTOS.has(u.status);
  const aprovacao = aprovacaoDoCandidato(decisoes, id);

  const pauta = listaPautas(selecao).filter((p) => p.id_candidato === id).sort((a, b) => (b._linha || 0) - (a._linha || 0))[0];
  if (pauta) {
    const mapa = estadoPautas || estadoDasPautas(selecao, decisoes);
    const status = mapa.get(pauta.id_pauta)?.status || pauta.status;
    const ficouParaDecidir = !!aprovacao && status === STATUS_PAUTA.proposta && !aberto;
    return {
      tipo: 'pauta', podePedir: false, pauta, status, enviada: status === STATUS_PAUTA.enviada, aprovacao, aberto,
      ficouParaDecidir, linha: u || null, detalhe: ficouParaDecidir && u ? textoDaLinha(u) : '',
    };
  }

  if (aberto) {
    const trava = avaliarTrava(execucoes, 'radar-candidato', id, agora);
    if (!trava.livre && trava.motivo === 'parece-travada') return { tipo: 'parece-travada', podePedir: true, linha: u, aprovacao };
    return { tipo: 'andamento', podePedir: false, linha: u, aprovacao };
  }
  if (u && COM_ERRO.has(u.status)) return { tipo: 'erro', podePedir: true, linha: u, erro: textoDaLinha(u), aprovacao };
  const decisao = aprovacao || listaDecisoes(decisoes).filter((d) => d.id_candidato === id && normalizarDecisao(d.decisao) === 'aprovada')
    .sort((a, b) => (b._linha || 0) - (a._linha || 0))[0];
  if (decisao) return { tipo: 'aprovado', podePedir: false, decisao, aprovacao: decisao };
  if (u && u.status === 'ok') return { tipo: 'concluido', podePedir: false, linha: u };
  return { tipo: 'livre', podePedir: true };
}

/* ------------------------------------------------- estado no app (Drive) */

export const ESTADOS_APP = Object.freeze(['candidato', 'para-decidir', 'excluido', 'recusado']);
/** Caminho do arquivo, dentro de ROOT_FOLDER (as pastas nascem na primeira gravação). */
export const PASTAS_APP_CANDIDATOS = Object.freeze(['_motor', 'app', 'candidatos']);
export const VERSAO_ARQUIVO_CANDIDATO = 1;
export const MAX_MOTIVO_RECUSA_CANDIDATO = 300;
const MAX_HISTORICO = 50;

export const nomeArquivoCandidato = (id) => `${String(id ?? '').trim()}.json`;
export const caminhoArquivoCandidato = (id) => `${PASTAS_APP_CANDIDATOS.join('/')}/${nomeArquivoCandidato(id)}`;

const linhaUnica = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Texto do arquivo → {ok:true, registro:{id, estado, motivo, historico, quando}} | {ok:false, motivo}.
 * `idEsperado` (opcional): o nome do arquivo tem de bater com o id de dentro. `quando` = o último
 * item do histórico (ISO) ou ''.
 */
export function lerArquivoCandidato(texto, idEsperado = '') {
  let o;
  try { o = JSON.parse(String(texto ?? '')); } catch { return { ok: false, motivo: 'json-invalido' }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, motivo: 'formato' };
  if (o.versao !== VERSAO_ARQUIVO_CANDIDATO) return { ok: false, motivo: 'versao' };
  const id = String(o.id ?? '').trim();
  if (!idCandidatoValido(id)) return { ok: false, motivo: 'id' };
  if (idEsperado && id !== String(idEsperado).trim()) return { ok: false, motivo: 'id-trocado' };
  if (!ESTADOS_APP.includes(o.estado)) return { ok: false, motivo: 'estado' };
  const historico = (Array.isArray(o.historico) ? o.historico : [])
    .filter((h) => h && typeof h === 'object' && ESTADOS_APP.includes(h.estado))
    .map((h) => ({ estado: h.estado, quando: String(h.quando ?? ''), quem: String(h.quem ?? ''), ...(h.motivo ? { motivo: linhaUnica(h.motivo) } : {}) }));
  const ultimo = historico[historico.length - 1];
  return {
    ok: true,
    registro: { id, estado: o.estado, motivo: o.estado === 'recusado' ? linhaUnica(o.motivo) : '', historico, quando: ultimo?.quando || '' },
  };
}

const PASTA_DRIVE = 'application/vnd.google-apps.folder';

/**
 * Arquivos do Drive ([{id, name, modifiedTime, mimeType}]) → Map nome → o de modifiedTime mais
 * novo (o Drive aceita nome repetido: dois aparelhos podem ter criado o mesmo arquivo). Só `.json`.
 */
export function maisNovoPorNome(arquivos = []) {
  const m = new Map();
  for (const f of arquivos || []) {
    const nome = String(f?.name ?? '').trim();
    if (!nome.endsWith('.json') || f.mimeType === PASTA_DRIVE) continue;
    const atual = m.get(nome);
    if (!atual || String(f.modifiedTime || '').localeCompare(String(atual.modifiedTime || '')) > 0) m.set(nome, f);
  }
  return m;
}

const msDe = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : -Infinity; };

/**
 * Registros lidos do Drive (objeto ou Map id → registro) + os locais da tela (estado otimista: id →
 * registro, com `pendente` enquanto grava) → Map id → registro. O local vale enquanto for igual ou
 * mais novo que o lido (o que veio do Drive depois de outra gravação ganha).
 */
export function mesclarEstadosApp(lidos, locais = {}) {
  const m = new Map(lidos instanceof Map ? lidos : Object.entries(lidos || {}));
  for (const [id, r] of Object.entries(locais || {})) {
    if (!r) continue;
    const l = m.get(id);
    if (!l || msDe(r.quando) >= msDe(l.quando)) m.set(id, r);
  }
  return m;
}

/** Estado do candidato no app ('candidato' quando não há arquivo). */
export const estadoApp = (estados, id) => (estados instanceof Map ? estados.get(id) : estados?.[id])?.estado || 'candidato';

/**
 * Lista da tela (candidatosDaTela) + estados do app → {candidatos, paraDecidir, excluidos}. Os
 * candidatos "para decidir" que já viraram pauta na Seleção (tipoDe(c) === 'pauta') saem do bloco: a
 * pauta aparece em Para decidir pela Seleção. `tipoDe` (opcional): c → estadoDoCandidato(c).tipo.
 */
export function separarCandidatos(lista = [], estados = new Map(), tipoDe = null) {
  const out = { candidatos: [], paraDecidir: [], excluidos: [] };
  for (const c of lista || []) {
    const e = estadoApp(estados, c.id);
    if (e === 'excluido' || e === 'recusado') out.excluidos.push(c);
    else if (e === 'para-decidir') { if (!tipoDe || tipoDe(c) !== 'pauta') out.paraDecidir.push(c); }
    else out.candidatos.push(c);
  }
  return out;
}

/** Quantos candidatos estão no bloco "Candidatos para decidir" (o contador soma às pautas). */
export function contarCandidatosParaDecidir(lidos, { locais = {}, selecao = null } = {}) {
  if (!lidos?.candidatos) return 0;
  const ids = new Set(listaPautas(selecao).map((p) => p.id_candidato).filter(Boolean));
  return separarCandidatos(candidatosDaTela(lidos), mesclarEstadosApp(lidos.app?.registros, locais), (c) => (ids.has(c.id) ? 'pauta' : '')).paraDecidir.length;
}

const TEXTO_ESTADO = {
  candidato: 'voltou para Candidatos', 'para-decidir': 'está em Para decidir', excluido: 'foi excluído', recusado: 'foi recusado',
};

/**
 * Mudança de estado de um candidato no app (pura: não lê nem grava nada).
 *   id, para (ESTADOS_APP), email (quem decide), atual (registro já gravado ou null),
 *   situacao (estadoDoCandidato: tipo, pauta…), motivo (recusa), quando (ISO)
 * → {ok:true, conteudo (objeto do arquivo), registro, caminho, aviso, texto, de, toca:[caminho]}
 *   | {ok:false, motivo, mensagem}
 * Regras: só a conta que decide; ids T nunca; id no formato; com pedido ao Radar aberto (andamento,
 * parece-travada) só "voltar para Candidatos" passa; já pauta (ou já aprovado) não vai para Para
 * decidir nem é recusado (excluir passa: só tira o cartão, com o `aviso`); recusa pede motivo. `toca`: o que muda (só o arquivo do app; nada em Seleção, Decisões
 * ou em outras pastas do Drive).
 */
export function planejarEstadoCandidato({ id, para, email = '', atual = null, situacao = null, motivo = '', quando = '' } = {}) {
  const idc = String(id ?? '').trim();
  const nao = (m, mensagem) => ({ ok: false, motivo: m, mensagem });
  if (!podeDecidir(email)) return nao('sem-permissao', 'Só a conta da Robertta muda o estado de um candidato.');
  if (ehCandidatoTeste(idc)) return nao('teste', 'Candidato de teste (T): o app não muda o estado dele.');
  if (!idCandidatoValido(idc)) return nao('id-invalido', 'Id fora do formato AAAA-MM-DD-NN.');
  if (!ESTADOS_APP.includes(para)) return nao('estado-desconhecido', 'Estado desconhecido.');
  const de = atual?.estado || 'candidato';
  if (de === para) return nao('ja-esta', `O candidato ${idc} já está assim.`);
  const tipo = situacao?.tipo || 'livre';
  if (para !== 'candidato' && (tipo === 'andamento' || tipo === 'parece-travada')) {
    return nao('em-andamento', 'Há um pedido ao Radar em andamento para este candidato: espere ele terminar.');
  }
  if (para === 'para-decidir' && tipo === 'pauta') {
    const p = situacao.pauta?.id_pauta;
    return nao('ja-pauta', `Este candidato já virou ${p ? `a pauta ${p}` : 'pauta'}: ela está na aba Seleção.`);
  }
  if ((para === 'para-decidir' || para === 'recusado') && tipo === 'aprovado') return nao('ja-aprovado', 'Este candidato já foi aprovado em Decisões: a pauta chega pela Seleção.');
  if (para === 'recusado' && tipo === 'pauta') {
    const p = situacao.pauta?.id_pauta;
    return nao('ja-pauta', `Este candidato já virou ${p ? `a pauta ${p}` : 'pauta'}: decida a pauta em Para decidir.`);
  }
  const m = linhaUnica(motivo).slice(0, MAX_MOTIVO_RECUSA_CANDIDATO).trimEnd();
  if (para === 'recusado' && !m) return nao('sem-motivo', 'Escolha o motivo da recusa.');
  const q = String(quando || new Date().toISOString());
  const passo = { estado: para, quando: q, quem: String(email).trim().toLowerCase(), ...(para === 'recusado' ? { motivo: m } : {}) };
  const historico = [...(atual?.historico || []), passo].slice(-MAX_HISTORICO);
  const conteudo = { versao: VERSAO_ARQUIVO_CANDIDATO, id: idc, estado: para, ...(para === 'recusado' ? { motivo: m } : {}), historico };
  const caminho = caminhoArquivoCandidato(idc);
  const aviso = para === 'excluido' && tipo === 'pauta' && situacao.pauta?.id_pauta
    ? `Só o cartão saiu de Candidatos: a pauta ${situacao.pauta.id_pauta} continua na Seleção.` : '';
  return {
    ok: true, conteudo, caminho, aviso, toca: [caminho], de,
    registro: { id: idc, estado: para, motivo: para === 'recusado' ? m : '', historico, quando: q },
    texto: `Candidato ${idc} ${TEXTO_ESTADO[para]}.`,
  };
}

/** Motivos da recusa de um candidato: os mesmos da recusa de pauta. */
export const MOTIVOS_RECUSA_CANDIDATO = MOTIVOS_RECUSA;

/* ---------------------------------------- arquivos do app (Drive injetado) */

/**
 * Leitura e gravação de `_motor/app/candidatos/<id>.json`, com o Drive injetado (js/integra.js passa
 * as funções de drive.js; os testes passam falsas). Só toca a pasta `_motor/app/candidatos`.
 *   deps: raiz() → id de ROOT_FOLDER; listar(pastaId) → [{id,name,mimeType,modifiedTime}];
 *         baixarTexto(arquivo) → texto; criarPasta(nome, paiId) → {id};
 *         criarArquivoTexto(nome, texto, pastaId, mime) → {id}; substituirConteudo(id, texto, mime)
 *   ler()   → {registros: {id → registro}, invalidos: n}
 *   gravar({id, para, email, situacao, motivo, quando}) → {registro, aviso, texto, de}: relê o
 *           arquivo do id antes (o histórico continua), planeja e grava; recusa lança Error com `codigo`.
 */
export function criarArquivosDoApp(deps) {
  let pastas = null; // ids das pastas "candidatos" achadas (o Drive aceita nome repetido)
  const lidos = new Map(); // fileId:modifiedTime → registro (não baixa de novo o que não mudou)

  async function filhas(paiId, nome) {
    const filhos = await deps.listar(paiId);
    return filhos.filter((f) => f.mimeType === PASTA_DRIVE && String(f.name).trim() === nome).map((f) => f.id);
  }

  async function achar(criar) {
    if (pastas?.length) return pastas;
    let atual = [await deps.raiz()];
    for (const nome of PASTAS_APP_CANDIDATOS) {
      const prox = (await Promise.all(atual.map((p) => filhas(p, nome)))).flat();
      if (!prox.length) {
        if (!criar) return [];
        prox.push((await deps.criarPasta(nome, atual[0])).id);
      }
      atual = prox;
    }
    pastas = atual;
    return pastas;
  }

  async function arquivos(criar = false) {
    const ps = await achar(criar);
    return { ps, mapa: maisNovoPorNome((await Promise.all(ps.map((p) => deps.listar(p)))).flat()) };
  }

  async function registroDe(arquivo, id) {
    const chave = `${arquivo.id}:${arquivo.modifiedTime || ''}`;
    if (lidos.has(chave)) return lidos.get(chave);
    const v = lerArquivoCandidato(await deps.baixarTexto(arquivo), id);
    const r = v.ok ? v.registro : null;
    lidos.set(chave, r);
    return r;
  }

  return {
    async ler() {
      const { mapa } = await arquivos(false);
      const registros = {};
      let invalidos = 0;
      await Promise.all([...mapa.entries()].map(async ([nome, f]) => {
        const id = nome.slice(0, -'.json'.length);
        if (!idCandidatoValido(id)) return;
        const r = await registroDe(f, id);
        if (r) registros[id] = r; else invalidos += 1;
      }));
      return { registros, invalidos };
    },
    async gravar({ id, para, email, situacao = null, motivo = '', quando = '' } = {}) {
      const idc = String(id ?? '').trim();
      const nome = nomeArquivoCandidato(idc);
      // Recusa antes de qualquer leitura no Drive quando a regra já diz não (sem permissão, id T…).
      const previa = planejarEstadoCandidato({ id: idc, para, email, atual: null, situacao, motivo, quando });
      if (!previa.ok && previa.motivo !== 'ja-esta') { const e = new Error(previa.mensagem); e.codigo = previa.motivo; throw e; }
      const { ps, mapa } = await arquivos(false);
      const existente = mapa.get(nome) || null;
      const atual = existente ? await registroDe(existente, idc) : null;
      const plano = planejarEstadoCandidato({ id: idc, para, email, atual, situacao, motivo, quando });
      if (!plano.ok) { const e = new Error(plano.mensagem); e.codigo = plano.motivo; throw e; }
      const texto = `${JSON.stringify(plano.conteudo, null, 2)}\n`;
      if (existente) await deps.substituirConteudo(existente.id, texto, 'application/json');
      else await deps.criarArquivoTexto(nome, texto, ps[0] || (await achar(true))[0], 'application/json');
      return { registro: plano.registro, aviso: plano.aviso, texto: plano.texto, de: plano.de };
    },
    esquecer() { pastas = null; lidos.clear(); },
  };
}
