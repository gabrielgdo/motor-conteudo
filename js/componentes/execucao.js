// FAIXA DE EXECUÇÃO e as janelas do controle manual (PLANO 4.7, 10 e 11). Só monta HTML (sem DOM,
// sem rede: testável no node); as ações ficam em js/acoes.js e os dados chegam de js/dados.js
// (execucoesLidas: a aba Execuções lida uma vez por sessão e a cada "Atualizar").
//
//   faixaExecucao(...)     uma linha dentro do painel que já existe:
//                          [Radar diário] · última: hoje 7h12 · ok · média 14 min · [Rodar agora] [Detalhes]
//   janelaDetalhes(...)    moldura() com as últimas linhas daquela rotina (ou do motor, por id)
//   janelaRodar(...)       moldura() "Rodar agora?": o que roda, o que produz, tempo, custo, limites,
//                          conflitos (trava, "parece travada", janela de proteção) e efeito no semanal
//   historicoComExecucoes  o Histórico do Drive junto com as linhas de Execuções do id
//
// Todo texto vindo da planilha passa por esc(); links só https (hrefSeguro).

import { esc, ic, quando, hrefSeguro } from '../util.js';
import { FLAGS, PONTE_URL } from '../config.js';
import { ROTINAS, rotinaConhecida, estatisticasTempo, janelaConfirmacao } from '../controle.js';
import { lerDataHora } from '../parse.js';
import { moldura } from './janelas.js';

/* ------------------------------------------------------------ status */

export const ROTULO_STATUS = {
  pedido: 'pedido', rodando: 'rodando', ok: 'ok', parcial: 'parcial', erro: 'erro',
  aguardando: 'aguardando', travada: 'travada', 'recusado-pela-trava': 'recusado pela trava',
};
// Os tons de selo que já existem (css: .selo.ok/.alerta/.espera/.neutro).
const TOM_STATUS = {
  ok: 'ok', parcial: 'alerta', erro: 'alerta', travada: 'alerta',
  pedido: 'espera', rodando: 'espera', aguardando: 'espera', 'recusado-pela-trava': 'neutro',
};
const ROTULO_ORIGEM = { agendada: 'agendada', 'manual-app': 'pelo app', chat: 'pelo chat', vigia: 'pelo vigia' };

const selo = (texto, tom = 'neutro') => `<span class="selo ${tom}">${esc(texto)}</span>`;
export const seloStatus = (status) => selo(ROTULO_STATUS[status] || status || 'sem status', TOM_STATUS[status] || 'neutro');

/** A ponte está ligada (flag e endereço https)? */
export const ponteLigada = () => !!FLAGS.ponte && /^https:\/\/\S+$/.test(String(PONTE_URL || ''));

export const NOTA_PONTE_DESLIGADA = 'O disparo pelo app ainda não está ligado. Por enquanto, peça ao bot no chat.';

/* ------------------------------------------------------------ linhas */

const msDe = (e) => e.inicioData?.getTime?.() ?? -Infinity;
const novaPrimeiro = (a, b) => msDe(b) - msDe(a) || (b._linha || 0) - (a._linha || 0);

/**
 * Linhas de Execuções de uma rotina (`rotina`), de um bot num id (`bot` + `idAlvo`) ou só de um id
 * (`idAlvo`), da mais nova para a mais velha.
 */
export function linhasDe(execucoes, { rotina = '', bot = '', idAlvo = '' } = {}) {
  return (execucoes || []).filter((e) => (!rotina || e.rotina === rotina)
    && (!bot || e.bot === bot)
    && (!idAlvo || e.id_alvo === idAlvo)).sort(novaPrimeiro);
}

const rotuloDaRotina = (rotina) => (rotinaConhecida(rotina) ? ROTINAS[rotina].rotulo : rotina || 'rodada');

/* ------------------------------------------------------------ faixa */

/**
 * A faixa de uma rotina, dentro de um painel que já existe.
 *   rotina      rotina do catálogo (radar-diario…) ou '' com `bot` (faixa do motor, por id)
 *   rotulo      nome na faixa (padrão: o rótulo do catálogo)
 *   idAlvo      id do roteiro (roteirista-decisao, motor)
 *   dados       execucoesLidas(): {fase, erro, execucoes, abaAusente}
 *   botao       {texto, acao, valor, id, desabilitado, titulo} do "Rodar agora", ou null (só leitura)
 *   semRegistro texto quando não há linha (padrão "ainda sem registro")
 *   agora       Date
 */
export function faixaExecucao({ rotina = '', bot = '', rotulo = '', idAlvo = '', dados = {}, botao = null, semRegistro = 'ainda sem registro', agora = new Date() } = {}) {
  const nome = rotulo || rotuloDaRotina(rotina);
  const filtro = { rotina, bot, idAlvo };
  const linhas = linhasDe(dados.execucoes, filtro);
  const itens = [];
  if (dados.fase === 'carregando' || dados.fase === 'vazio') itens.push('<span class="faixa-item apagado">lendo o registro…</span>');
  else if (dados.fase === 'erro' && !dados.execucoes) {
    itens.push(`<span class="faixa-item apagado">${dados.offline ? 'sem internet' : 'o registro não respondeu'}</span>`);
  } else if (dados.abaAusente || !linhas.length) {
    itens.push(`<span class="faixa-item apagado">${esc(semRegistro)}</span>`);
  } else {
    const u = linhas[0];
    const q = u.inicioData ? quando(u.inicioData, agora).replace(', ', ' ') : 'sem hora';
    const qual = !rotina && bot ? `${esc(rotuloDaRotina(u.rotina))}, ` : '';
    itens.push(`<span class="faixa-item"><span class="faixa-rot">última: </span>${qual}${esc(q)}</span>`);
    itens.push(`<span class="faixa-item">${seloStatus(u.status)}</span>`);
    if (rotina) {
      const t = estatisticasTempo(dados.execucoes, rotina);
      itens.push(`<span class="faixa-item faixa-media">${t.medido ? `média ${t.mediaMin} min` : 'ainda sem medição'}</span>`);
    }
  }
  const botoes = [];
  if (botao) {
    botoes.push(`<button type="button" class="botao contorno menor" data-acao="${esc(botao.acao || 'rodar-abrir')}" data-valor="${esc(botao.valor ?? rotina)}"${botao.id ? ` data-id="${esc(botao.id)}"` : ''}${botao.desabilitado ? ' disabled' : ''}${botao.titulo ? ` title="${esc(botao.titulo)}"` : ''}>${esc(botao.texto || 'Rodar agora')}</button>`);
  }
  if (linhas.length) {
    botoes.push(`<button type="button" class="botao calmo menor" data-acao="execucao-detalhes" data-valor="${esc(rotina || `bot:${bot}`)}"${idAlvo ? ` data-id="${esc(idAlvo)}"` : ''} aria-label="Detalhes: ${esc(nome)}">Detalhes</button>`);
  }
  return `<div class="faixa" role="group" aria-label="${esc(nome)}: andamento">
    <p class="faixa-texto"><strong class="faixa-nome">${esc(nome)}</strong>${itens.join('')}</p>
    ${botoes.length ? `<span class="faixa-botoes">${botoes.join('')}</span>` : ''}
  </div>`;
}

/* ---------------------------------------------------------- detalhes */

/** "Detalhes": as últimas 10 linhas (quando, origem, quem, status, resumo, erro, link). */
export function janelaDetalhes({ rotina = '', bot = '', idAlvo = '', rotulo = '', dados = {}, agora = new Date() } = {}) {
  const nome = rotulo || (rotina ? rotuloDaRotina(rotina) : bot === 'motor' ? 'Motor de edição' : 'Rodadas');
  const linhas = linhasDe(dados.execucoes, { rotina, bot, idAlvo }).slice(0, 10);
  const corpo = linhas.length ? `<ol class="registro">${linhas.map((e) => {
    const href = hrefSeguro(e.link);
    const origem = ROTULO_ORIGEM[e.origem] || e.origem;
    return `<li>
      <div class="registro-topo"><span>${esc(e.inicioData ? quando(e.inicioData, agora) : (e.inicio || 'sem hora'))}</span>${seloStatus(e.status)}</div>
      <p class="pequeno apagado">${[!rotina ? rotuloDaRotina(e.rotina) : '', origem, e.quem, e.id_alvo, e.id_lote, e.teste ? 'teste' : ''].filter(Boolean).map(esc).join(' · ')}</p>
      ${e.resumo ? `<p class="pequeno">${esc(e.resumo)}</p>` : ''}
      ${e.erro ? `<p class="pequeno erro-texto">${esc(e.erro)}</p>` : ''}
      ${href ? `<p class="pequeno"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Abrir o link</a></p>` : ''}
    </li>`;
  }).join('')}</ol>` : `<p class="apagado">${dados.abaAusente ? 'A aba Execuções ainda não existe na planilha Radar: ainda sem registro.' : 'Ainda sem registro desta rotina.'}</p>`;
  return moldura(esc(`${nome}: últimas rodadas`), `${corpo}<p class="pequeno apagado">Da aba Execuções da planilha Radar.</p>`,
    '<button type="button" class="botao calmo" data-acao="fechar-janela">Fechar</button>');
}

/* ------------------------------------------------------------ rodar */

const ROTULO_CONFIRMAR = {
  'radar-diario': 'Rodar agora',
  'radar-selecao': 'Fazer seleção agora',
  'radar-enviar': 'Enviar ao Roteirista',
  'radar-candidato': 'Confirmar o pedido',
  'roteirista-decisao': 'Enviar a decisão',
  'diretor-retrospectiva': 'Fazer retrospectiva agora',
};

const itemHTML = (it) => `<div><dt>${esc(it.rotulo)}</dt><dd>${it.lista
  ? `<ul class="mudancas">${it.lista.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
  : esc(it.texto)}</dd></div>`;

/** Classe do <dialog> da janela "rodar": a do candidato é larga (~42rem) para o texto não virar coluna. */
export function classeJanelaRodar(rotina) {
  return rotina === 'radar-candidato' ? 'janela larga' : 'janela';
}

/** Resumo do candidato no topo da janela (título, tema, números); sem `resumo`, o texto do item. */
function resumoHTML(it) {
  const r = it.resumo;
  if (!r) return `<div class="resumo-candidato"><p class="pequeno apagado">${esc(it.rotulo)}</p><p>${esc(it.texto)}</p></div>`;
  return `<div class="resumo-candidato">
    <p class="titulo-resumo">${esc(r.titulo || it.texto)}</p>
    ${r.tema ? `<p class="subtitulo">${esc(r.tema)}</p>` : ''}
    ${r.numeros ? `<p class="pequeno">${esc(r.numeros)}</p>` : ''}
    ${r.id ? `<p class="linha-id pequeno">${esc(r.id)}</p>` : ''}
  </div>`;
}

/**
 * Corpo da janela de um candidato, na ordem de leitura: resumo → o que vai acontecer (e conflitos)
 * → Motivo → "Como funciona" (o que roda e produz; tempo e custo lado a lado; limites e semanal em
 * letra menor). Tudo continua visível: custo e limites são obrigatórios na confirmação.
 */
function corpoDoCandidato(itens, htmlCampos) {
  const por = (k) => itens.filter((x) => x.chave === k);
  const conhecidas = ['candidato', 'destino', 'conflitos', 'oque', 'produz', 'tempo', 'custo', 'limites', 'semanal'];
  const outros = itens.filter((x) => !conhecidas.includes(x.chave));
  const dl = (lista, classe = 'confirmacao') => (lista.length ? `<dl class="${classe}">${lista.map(itemHTML).join('')}</dl>` : '');
  return `${por('candidato').map(resumoHTML).join('')}
    ${dl([...por('destino'), ...outros, ...por('conflitos')])}
    ${htmlCampos}
    <section class="como-funciona" aria-label="Como funciona">
      <h3>Como funciona</h3>
      ${dl([...por('oque'), ...por('produz')])}
      ${dl([...por('tempo'), ...por('custo')], 'confirmacao lado-a-lado')}
      ${dl([...por('limites'), ...por('semanal')], 'confirmacao letra-menor')}
    </section>`;
}

/**
 * Itens da janela "Rodar agora?" (controle.janelaConfirmacao) mais os extras da tela (o lote que
 * vai nascer, as pautas que vão…), e o aviso de quando a aba Execuções não existe.
 */
export function itensDaJanela(rotina, { execucoes = [], semRegistro = '', idAlvo = '', email = '', agora = new Date(), extras = [] } = {}) {
  const j = janelaConfirmacao(rotina, { execucoes, idAlvo, email, agora });
  if (!j) return null;
  const itens = [...extras, ...j.itens].map((x) => ({ ...x, lista: x.lista ? [...x.lista] : undefined }));
  if (semRegistro) {
    const aviso = semRegistro;
    const c = itens.find((x) => x.chave === 'conflitos');
    if (c) c.lista.push(aviso);
    else itens.splice(itens.findIndex((x) => x.chave === 'semanal'), 0, { chave: 'conflitos', rotulo: 'Conflitos', lista: [aviso] });
  }
  return { ...j, itens };
}

/**
 * Janela "Rodar agora?".
 *   rotina, idAlvo, email, agora, dados (execucoesLidas)
 *   extras          itens a mais no começo ({rotulo, texto|lista})
 *   etapa           'confirmar' | 'travada' (segunda confirmação de "Marcar como travada")
 *   enviando        o confirmar foi tocado (fica desabilitado)
 *   erro            mensagem da ponte
 *   ligada          a ponte está ligada (padrão: ponteLigada())
 *   notaDesligada   o texto calmo no lugar do confirmar com a ponte desligada
 *   acao            data-acao do confirmar (padrão 'rodar-confirmar')
 *   podeTravar      oferece "Marcar como travada e rodar de novo" (padrão: true)
 *   titulo          título no lugar de "<rótulo>: rodar agora?" (texto puro; a janela escapa)
 *   rotuloConfirmar texto do botão de confirmar (padrão: o da rotina)
 *   campos          HTML já montado (e escapado) dos campos da janela: a quantidade do Radar
 *                   diário, o motivo do candidato. Só aparece com a ponte ligada e o confirmar possível.
 */
export function janelaRodar({
  rotina, idAlvo = '', email = '', agora = new Date(), dados = {}, extras = [], etapa = 'confirmar', enviando = false,
  erro = '', ligada = ponteLigada(), notaDesligada = NOTA_PONTE_DESLIGADA, acao = 'rodar-confirmar', podeTravar = true,
  titulo = '', rotuloConfirmar: rotuloPedido = '', campos = '',
} = {}) {
  const semRegistro = dados.abaAusente ? 'Sem a aba Execuções, o app não consegue ver se há uma rodada em andamento.'
    : !dados.execucoes ? 'O registro de Execuções não foi lido: o app não consegue ver se há uma rodada em andamento.' : '';
  const j = itensDaJanela(rotina, { execucoes: dados.execucoes || [], semRegistro, idAlvo, email, agora, extras });
  if (!j) return moldura('Rotina desconhecida', '<p>O app não conhece esta rotina.</p>', '<button type="button" class="botao calmo" data-acao="fechar-janela">Fechar</button>');
  const d = j.disparo;
  // O motivo que segura o botão aparece em destaque (nota) e sai da lista de conflitos.
  if (!d.pode && d.mensagem) {
    const c = j.itens.find((x) => x.chave === 'conflitos');
    if (c) {
      c.lista = c.lista.filter((x) => x !== d.mensagem);
      if (!c.lista.length) j.itens.splice(j.itens.indexOf(c), 1);
    }
  }
  const rotuloConfirmar = rotuloPedido || ROTULO_CONFIRMAR[rotina] || 'Rodar agora';
  const notas = [];
  if (j.teste) notas.push(`<p class="meta">${selo('Teste')}<span class="pequeno apagado">Id de teste: a rodada vai com teste = sim.</span></p>`);
  let confirmar = '';
  if (!d.pode && d.motivo === 'rodando') {
    notas.push(`<p class="nota atencao">${ic('alerta')}<span>${esc(d.mensagem)}. O botão volta quando ela terminar.</span></p>`);
    confirmar = `<button type="button" class="botao primario" disabled>${esc(rotuloConfirmar)}</button>`;
  } else if (!d.pode && d.motivo === 'parece-travada') {
    if (etapa === 'travada') {
      notas.push(`<p class="nota atencao" role="alert">${ic('alerta')}<span>Tem certeza? A rodada antiga fica marcada como “travada” na aba Execuções (nada é apagado) e uma nova começa agora. Se ela ainda estiver rodando de verdade, as duas podem disputar o mesmo bot.</span></p>`);
      confirmar = `<button type="button" class="botao primario" data-acao="${esc(acao)}" data-valor="travada"${enviando || !ligada ? ' disabled' : ''}>Sim, marcar como travada e rodar</button>`;
    } else {
      notas.push(`<p class="nota atencao">${ic('alerta')}<span>${esc(d.mensagem)}</span></p>`);
      if (podeTravar) confirmar = `<button type="button" class="botao contorno" data-acao="rodar-travada"${!ligada ? ' disabled' : ''}>Marcar como travada e rodar de novo</button>`;
    }
  } else if (!d.pode) {
    notas.push(`<p class="nota ${d.motivo === 'sem-permissao' ? 'calma' : 'atencao'}">${ic(d.motivo === 'sem-permissao' ? 'info' : 'alerta')}<span>${esc(d.mensagem)}</span></p>`);
    confirmar = `<button type="button" class="botao primario" disabled>${esc(rotuloConfirmar)}</button>`;
  } else {
    confirmar = `<button type="button" class="botao primario" data-acao="${esc(acao)}"${enviando ? ' disabled aria-busy="true"' : ''}>${esc(enviando ? 'Enviando…' : rotuloConfirmar)}</button>`;
  }
  if (erro) notas.push(`<p class="nota atencao" role="alert">${ic('alerta')}<span>${esc(erro)}</span></p>`);
  // Ponte desligada: mostra tudo, mas no lugar do confirmar fica a nota calma (sem botão ativo).
  if (!ligada) {
    notas.push(`<p class="nota calma">${ic('info')}<span>${esc(notaDesligada)}</span></p>`);
    if (!/disabled/.test(confirmar)) confirmar = '';
  }
  // As notas (o que segura o botão, a ponte desligada) vêm antes dos detalhes: no celular a janela
  // rola, e o motivo de não haver botão ativo precisa estar à vista.
  const comCampos = campos && ligada && (d.pode || d.motivo === 'parece-travada');
  const htmlCampos = comCampos ? `<div class="pilha campos-janela">${campos}</div>` : '';
  const corpo = rotina === 'radar-candidato'
    ? `${notas.join('')}${corpoDoCandidato(j.itens, htmlCampos)}`
    : `${notas.join('')}<dl class="confirmacao">${j.itens.map(itemHTML).join('')}</dl>${htmlCampos}`;
  return moldura(esc(titulo || j.titulo), corpo, `<button type="button" class="botao calmo" data-acao="fechar-janela">${confirmar ? 'Cancelar' : 'Fechar'}</button>${confirmar}`);
}

/* ---------------------------------------------------------- histórico */

/** Texto de uma linha de Execuções no Histórico: "Decisão de roteiro pelo app: ok (resumo)". */
export function textoDaExecucao(e) {
  const origem = ROTULO_ORIGEM[e.origem] ? ` ${ROTULO_ORIGEM[e.origem]}` : '';
  const status = ROTULO_STATUS[e.status] || e.status || 'sem status';
  const extra = e.erro || e.resumo;
  return `${rotuloDaRotina(e.rotina)}${origem}: ${status}${extra ? ` (${extra})` : ''}`;
}

/**
 * Histórico do Drive ([{quando: ISO|Date, texto}]) + linhas de Execuções do id, em ordem
 * cronológica → [[quandoTexto, texto]] (o formato do bloco Histórico de Vídeos). Texto puro: a
 * tela escapa.
 */
export function historicoComExecucoes(eventos, execucoes, idAlvo, agora = new Date()) {
  const todos = [];
  for (const e of eventos || []) {
    const d = e.quando instanceof Date ? e.quando : lerDataHora(e.quando);
    if (d) todos.push({ t: d.getTime(), q: quando(d, agora), texto: e.texto, o: 0 });
  }
  for (const e of linhasDe(execucoes, { idAlvo })) {
    if (!idAlvo) break;
    const d = e.fimData || e.inicioData;
    todos.push({ t: d ? d.getTime() : -Infinity, q: d ? quando(d, agora) : (e.inicio || ''), texto: textoDaExecucao(e), o: 1 });
  }
  return todos.sort((a, b) => a.t - b.t || a.o - b.o).map((x) => [x.q, x.texto]);
}

/** O bloco Histórico (o mesmo de Vídeos), ou '' sem nada para mostrar. */
export function blocoHistorico(linhas, classe = '') {
  if (!linhas.length) return '';
  return `<section class="painel ${classe}" aria-labelledby="t-historia"><h2 id="t-historia">Histórico</h2>
    <ol class="historia">${linhas.map(([q, t]) => `<li><time>${esc(q)}</time>${esc(t)}</li>`).join('')}</ol></section>`;
}
