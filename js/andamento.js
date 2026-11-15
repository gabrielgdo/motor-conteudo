// ANDAMENTO DO MOTOR (puro, sem DOM nem rede): lê o `_motor/andamento/<id>.json` que o Motor Reels
// publica no Drive (bin/andamento.sh) e resume para a tela do vídeo. Formato (versao 1):
//   {versao:1, id, atualizado_em, atual: null | {etapa, arquivo, estado:'rodando'|'aguardando', desde, tentativa, de, limite_s},
//    etapas: [{etapa, arquivo, estado, versao, inicio, fim, tentativa, de, duracao_s, erro}],   (últimas 30, a mais nova no fim)
//    eventos: [{evento, id, versao, resumo, erro, quando}]}                                   (últimos 20)
// Lista fechada de estados: o que vier fora dela é descartado. Sem percentuais.
// `htmlAndamento` monta o bloco da tela; todo texto vindo do arquivo passa por esc().

import { esc, horaCurta, hoje, dataCurta } from './util.js';
import { lerDataHora } from './parse.js';

export const VERSAO_ANDAMENTO = 1;
export const ESTADOS_ETAPA = ['ok', 'parou', 'falhou', 'desistiu', 'rodando', 'aguardando'];
export const ESTADOS_ATUAL = ['rodando', 'aguardando', 'na_fila']; // na_fila: aceito, o gravador ainda não emite
export const FOLGA_PARADO_MS = 10 * 60 * 1000; // "parece parado": rodando há mais de limite_s + 10 min
const LIMITE_PADRAO_S = 5400; // o tempo-limite do motor quando o arquivo não traz limite_s
const MAX_TEXTO = 300;

/* Nome da etapa: [no gerúndio (andando), substantivo (lista)]. Etapa desconhecida aparece pelo nome. */
const NOMES_ETAPA = {
  editar: ['Editando', 'Edição'],
  revisar: ['Refazendo com os ajustes', 'Ajustes'],
  ajustar: ['Refazendo com os ajustes', 'Ajustes'],
  finalizar: ['Montando o pacote final', 'Pacote final'],
  limpar: ['Limpando o teste', 'Limpeza do teste'],
};
const maiuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const nomeEtapa = (etapa) => (NOMES_ETAPA[etapa] || [maiuscula(etapa), maiuscula(etapa)])[1];
const gerundio = (etapa) => (NOMES_ETAPA[etapa] || [maiuscula(etapa)])[0];

const ROTULO_ESTADO = {
  ok: 'Concluída', parou: 'Parou', falhou: 'Falhou', desistiu: 'Desistiu',
  rodando: 'Em andamento', aguardando: 'Aguardando', na_fila: 'Na fila',
};

const texto = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXTO) : '');
const inteiro = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
/** ISO com fuso (como o gravador escreve) → Date; qualquer outra coisa → null. */
function data(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null;
  return lerDataHora(v);
}

function lerAtual(a) {
  if (!a || typeof a !== 'object' || !ESTADOS_ATUAL.includes(a.estado)) return null;
  const etapa = texto(a.etapa);
  const desde = data(a.desde);
  if (!etapa || !desde) return null;
  return {
    etapa, arquivo: texto(a.arquivo), estado: a.estado, desde,
    tentativa: inteiro(a.tentativa), de: inteiro(a.de),
    limite_s: Number.isFinite(a.limite_s) && a.limite_s > 0 ? a.limite_s : null,
  };
}

function lerEtapa(e) {
  if (!e || typeof e !== 'object' || !ESTADOS_ETAPA.includes(e.estado)) return null;
  const etapa = texto(e.etapa);
  const inicio = data(e.inicio); const fim = data(e.fim);
  if (!etapa || (!inicio && !fim)) return null;
  return {
    etapa, arquivo: texto(e.arquivo), estado: e.estado, versao: inteiro(e.versao), inicio, fim,
    tentativa: inteiro(e.tentativa), de: inteiro(e.de),
    duracao_s: Number.isFinite(e.duracao_s) && e.duracao_s >= 0 ? e.duracao_s : null, erro: texto(e.erro),
  };
}

function lerEvento(ev, id) {
  if (!ev || typeof ev !== 'object') return null;
  const evento = texto(ev.evento); const quando = data(ev.quando);
  if (!evento || !quando || (ev.id != null && ev.id !== id)) return null;
  return { evento, versao: inteiro(ev.versao), resumo: texto(ev.resumo), erro: texto(ev.erro), quando };
}

/**
 * Texto do arquivo → {ok:true, dados} | {ok:false, motivo}. `dados` já vem limpo: datas como Date,
 * entradas com estado desconhecido ou datas ilegíveis fora. motivo: 'json' | 'versao' | 'id' | 'data'.
 */
export function validarAndamento(conteudo, id) {
  let j;
  try { j = typeof conteudo === 'string' ? JSON.parse(conteudo) : conteudo; } catch { return { ok: false, motivo: 'json' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, motivo: 'json' };
  if (j.versao !== VERSAO_ANDAMENTO) return { ok: false, motivo: 'versao' };
  if (typeof j.id !== 'string' || j.id !== id) return { ok: false, motivo: 'id' };
  const atualizadoEm = data(j.atualizado_em);
  if (!atualizadoEm) return { ok: false, motivo: 'data' };
  const lista = (v) => (Array.isArray(v) ? v : []);
  return {
    ok: true,
    dados: {
      id: j.id, atualizadoEm, atual: lerAtual(j.atual),
      etapas: lista(j.etapas).map(lerEtapa).filter(Boolean),
      eventos: lista(j.eventos).map((ev) => lerEvento(ev, j.id)).filter(Boolean),
    },
  };
}

/** "às 22h46" no mesmo dia de `agora`; "em 13/11 às 22h46" em outro dia (fuso de São Paulo). */
export function as(d, agora = new Date()) {
  if (!d) return '';
  return hoje(d) === hoje(agora) ? `às ${horaCurta(d)}` : `em ${dataCurta(hoje(d))} às ${horaCurta(d)}`;
}
const desdeTexto = (d, agora) => (hoje(d) === hoje(agora) ? `desde ${horaCurta(d)}` : `desde ${dataCurta(hoje(d))}, ${horaCurta(d)}`);
const tentativaTexto = (x) => (x.tentativa && x.de ? `tentativa ${x.tentativa} de ${x.de}` : '');
const juntar = (...p) => p.filter(Boolean).join(' · ');

/** Frase de uma etapa (ou de `atual`) no estado em que está. */
export function fraseDaEtapa(x, agora = new Date()) {
  const erro = x.erro ? `: ${x.erro}` : '';
  switch (x.estado) {
    case 'rodando': return juntar(gerundio(x.etapa), x.desde || x.inicio ? desdeTexto(x.desde || x.inicio, agora) : '', tentativaTexto(x));
    case 'aguardando': return juntar('Aguardando o upload terminar', x.desde ? desdeTexto(x.desde, agora) : '');
    case 'na_fila': return 'Na fila do motor';
    case 'ok': return x.fim ? `Concluída ${as(x.fim, agora)}` : 'Concluída';
    case 'parou': return `Parou${erro}`;
    case 'falhou': return `Falhou${x.tentativa && x.de ? ` (tentativa ${x.tentativa} de ${x.de})` : ''}${erro}`;
    case 'desistiu': {
      const n = x.tentativa || x.de;
      return `Desistiu${n ? ` depois de ${n} ${n === 1 ? 'tentativa' : 'tentativas'}` : ''}`;
    }
    default: return '';
  }
}

/** Tom do selo pelo estado (classes que já existem em .selo). */
const TOM = { ok: 'ok', parou: 'alerta', falhou: 'alerta', desistiu: 'alerta', rodando: 'espera', aguardando: 'espera', na_fila: 'neutro' };

/**
 * Dados validados → resumo para a tela:
 *   {resumo: {etapa, estado, texto, tom, pareceParado, erro}, emAndamento, etapas: [...] (mais nova primeiro),
 *    eventos: [...] (mais novo primeiro, até 5), atualizado: 'atualizado às 22h51'}
 */
export function resumirAndamento(dados, agora = new Date()) {
  const ultima = dados.etapas[dados.etapas.length - 1] || null;
  const base = dados.atual || ultima;
  let resumo = null;
  if (base) {
    const inicio = base.desde || base.inicio;
    const limite = (base.limite_s || LIMITE_PADRAO_S) * 1000;
    const pareceParado = base.estado === 'rodando' && !!inicio && agora - inicio > limite + FOLGA_PARADO_MS;
    resumo = {
      etapa: nomeEtapa(base.etapa), estado: base.estado,
      texto: fraseDaEtapa(base, agora) + (pareceParado ? ' · parece parado' : ''),
      tom: pareceParado ? 'alerta' : TOM[base.estado] || 'neutro', pareceParado,
    };
  }
  const emAndamento = !!dados.atual || ['rodando', 'aguardando'].includes(ultima?.estado);
  const etapas = dados.etapas.slice().reverse().map((e) => ({
    etapa: nomeEtapa(e.etapa), estado: e.estado, rotulo: ROTULO_ESTADO[e.estado], tom: TOM[e.estado] || 'neutro',
    frase: fraseDaEtapa(e, agora), versao: e.versao,
    horario: e.fim && e.estado !== 'rodando' ? horaCurta(e.fim) : e.inicio ? horaCurta(e.inicio) : '',
    dia: (e.fim || e.inicio) && hoje(e.fim || e.inicio) !== hoje(agora) ? dataCurta(hoje(e.fim || e.inicio)) : '',
  }));
  const eventos = dados.eventos.slice(-5).reverse().map((ev) => ({
    evento: ev.evento, resumo: ev.resumo, erro: ev.erro,
    horario: horaCurta(ev.quando), dia: hoje(ev.quando) !== hoje(agora) ? dataCurta(hoje(ev.quando)) : '',
  }));
  return { resumo, emAndamento, etapas, eventos, atualizado: `atualizado ${as(dados.atualizadoEm, agora)}` };
}

/** Texto + id + agora → {ok:true, ...resumo} | {ok:false, motivo}. */
export function lerAndamento(conteudo, id, agora = new Date()) {
  const v = validarAndamento(conteudo, id);
  return v.ok ? { ok: true, ...resumirAndamento(v.dados, agora) } : v;
}

/* ------------------------------------------------------------------ HTML */

const selo = (t, tom = 'neutro') => `<span class="selo ${esc(tom || 'neutro')}">${esc(t)}</span>`;
const quandoHtml = (x) => `${x.dia ? `${esc(x.dia)}, ` : ''}${esc(x.horario)}`;

/**
 * Bloco "Motor de edição" da tela do vídeo. `leitura`:
 *   {fase:'carregando'} | {fase:'sem-arquivo'} | {fase:'indisponivel'} | {fase:'ok', andamento: resultado de resumirAndamento}
 * `id` vai no botão "Tentar de novo".
 */
export function htmlAndamento(leitura = {}, id = '') {
  const faixa = (itens, botao = '') => `<div class="faixa" role="group" aria-label="Motor de edição: andamento">
    <p class="faixa-texto"><strong class="faixa-nome">Motor de edição</strong>${itens}</p>${botao}</div>`;
  if (leitura.fase === 'sem-arquivo') return `<div class="andamento">${faixa('<span class="faixa-item apagado">O motor ainda não registrou andamento para este vídeo</span>')}</div>`;
  if (leitura.fase === 'indisponivel') {
    return `<div class="andamento">${faixa('<span class="faixa-item apagado">Andamento indisponível agora</span>',
      `<span class="faixa-botoes"><button type="button" class="botao contorno menor" data-acao="andamento-tentar" data-id="${esc(id)}">Tentar de novo</button></span>`)}</div>`;
  }
  if (leitura.fase !== 'ok' || !leitura.andamento) return `<div class="andamento">${faixa('<span class="faixa-item apagado">lendo o andamento…</span>')}</div>`;
  const a = leitura.andamento;
  const resumo = a.resumo
    ? `<span class="faixa-item">${selo(a.resumo.etapa, a.resumo.tom)}</span><span class="faixa-item andamento-frase">${esc(a.resumo.texto)}</span>`
    : '<span class="faixa-item apagado">nenhuma etapa registrada ainda</span>';
  const etapas = a.etapas.length ? `<details class="andamento-mais"><summary class="pequeno">Etapas e avisos</summary>
    <ol class="andamento-lista" aria-label="Etapas">${a.etapas.map((e) => `<li><span class="andamento-hora">${quandoHtml(e)}</span><span>${selo(e.rotulo, e.tom)} <strong>${esc(e.etapa)}${e.versao ? ` v${esc(e.versao)}` : ''}</strong> <span class="apagado">${esc(e.frase)}</span></span></li>`).join('')}</ol>
    ${a.eventos.length ? `<ol class="andamento-lista" aria-label="Últimos avisos">${a.eventos.map((ev) => `<li><span class="andamento-hora">${quandoHtml(ev)}</span><span><strong>${esc(ev.evento)}</strong>${ev.resumo ? ` ${esc(ev.resumo)}` : ''}${ev.erro && ev.erro !== ev.resumo ? ` <span class="apagado">${esc(ev.erro)}</span>` : ''}</span></li>`).join('')}</ol>` : ''}
  </details>` : (a.eventos.length ? `<ol class="andamento-lista" aria-label="Últimos avisos">${a.eventos.map((ev) => `<li><span class="andamento-hora">${quandoHtml(ev)}</span><span><strong>${esc(ev.evento)}</strong>${ev.resumo ? ` ${esc(ev.resumo)}` : ''}</span></li>`).join('')}</ol>` : '');
  return `<div class="andamento">${faixa(`${resumo}<span class="faixa-item apagado">${esc(a.atualizado)}</span>`)}${etapas}</div>`;
}
