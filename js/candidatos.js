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
// Ids de teste (T…) ficam fora da tela, como no resto do app. "Para decidir" continua vindo só da
// aba Seleção: um candidato só aparece lá depois que o Radar o transforma em pauta.

import { lerTabela, lerDataHora, hojeISO, idCandidatoValido, ehCandidatoTeste, chaveDeCabecalho } from './parse.js';
import { avaliarTrava } from './controle.js';
import { normalizarDecisao, STATUS_PAUTA, estadoDasPautas, aprovacaoDoCandidato } from './selecao.js';

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

/** Contador do chip: candidatos sem os de teste (null enquanto a aba não foi lida). */
export function contarCandidatos(lidos) {
  if (!lidos?.candidatos) return null;
  return lidos.candidatos.filter((c) => !c.teste).length;
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
