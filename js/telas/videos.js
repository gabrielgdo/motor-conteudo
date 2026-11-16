// VÍDEOS (#/videos e #/videos/<id>): antes das prévias, o storyboard (quadros parados, desde 15/11/2026; ver
// telas/storyboard.js); depois, as prévias do Instagram e do TikTok lado a lado, tocando os
// arquivos reais de 4-Revisao (componentes/players.js), a linha do tempo dos ajustes com a duração
// real e o painel de revisão. Com FLAGS.revisaoPeloApp, "Aprovar" grava `<id> aprovado.md` e
// "Enviar ajustes" grava `<id> ajustes vN.md` em 4-Revisao (js/revisao.js confere os nomes logo
// antes), sempre com a janela de confirmação; "Copiar a lista" continua como ação secundária.
// Sem a flag, volta ao jeito anterior (copiar a lista para o chat do Diretor). A faixa do motor e o
// Histórico leem a aba Execuções (bot = motor).
// Pergunta de regra (plano de mídia, §6): quando as notas da prévia trazem "## Regra que esbarra no seu pedido", o
// resumo do motor mostra o texto sem a seção e as perguntas aparecem com os 3 botões (js/componentes/regras.js). As
// respostas vão no arquivo de ajustes (`regras`); a aprovação não tem esse campo, então "Aprovar" com uma resposta que
// libera o pedido vira "Refazer a prévia com o seu pedido" (ajustar). "Copiar a lista" nunca leva as respostas.

import { esc, ic, relogio, NOME_REDE } from '../util.js';
import { FLAGS } from '../config.js';
import { estado } from '../estado.js';
import { Integra } from '../integra.js';
import { porEtapa, rot, ultima, anexo, execucoesLidas } from '../dados.js';
import { parseAjustes, segundosDoTempo } from '../parse.js';
import { lerPerguntasRegra, semSecaoRegras, chaveRespostas, regrasRespondidas } from '../regras.js';
import { blocoRegras, listaRespostas, avisoViraPedido, algumaLibera } from '../componentes/regras.js';
import { podeDecidir, ROTINAS, estatisticasTempo } from '../controle.js';
import { nomeArquivoRevisao } from '../revisao.js';
import { Players } from '../componentes/players.js';
import { moldura } from '../componentes/janelas.js';
import { faixaExecucao, historicoComExecucoes, blocoHistorico, linhasDe } from '../componentes/execucao.js';
import { resumirAndamento, htmlAndamento } from '../andamento.js';
import { cab, selo, vt, passoDe, naoAchei, comDados, vazio, campo, segmento, rodapeAtualizado, voltar } from './pecas.js';
import { painelQuadros, painelDecisaoStoryboard } from './storyboard.js';
import { estadoDoStoryboard } from '../storyboard.js';

const enc = encodeURIComponent;
const SEM_VIDEO = ['ganchos', 'rascunho', 'mudanca', 'recusado', 'aprovado', ''];

export function vVideos() {
  return `${cab('Vídeos', 'As prévias do Instagram e do TikTok, para aprovar ou pedir ajuste.')}
  ${comDados(() => {
    // o storyboard que espera por ela entra em "Para revisar"; o já decidido fica com o motor
    const sbVez = (r) => estadoDoStoryboard(r, { local: estado.storyboardsEnviados?.[r.id] || null }).estado === 'decidir';
    const revisar = [...porEtapa('storyboard').filter(sbVez), ...porEtapa('previa')];
    const andando = [...porEtapa('recebido'), ...porEtapa('storyboard').filter((r) => !sbVez(r)), ...porEtapa('ajustes', 'video-aprovado')];
    const item = (r) => { const [texto, tom] = passoDe(r); const v = ultima(r); return `<li><a class="painel dupla luz" href="#/videos/${enc(r.id)}">
    <span class="mini" aria-hidden="true"><i></i><i></i></span>
    <span><span class="id">${esc(r.id)}</span><h3 ${vt(r.id)}>${esc(r.titulo)}</h3><span class="meta">${selo(texto, tom)}${r.teste ? selo('Teste') : ''}${v?.quando ? `<span class="apagado pequeno">chegou ${esc(v.quando)}</span>` : ''}</span></span></a></li>`; };
    return `
  <div class="pilha" style="gap:1.875rem">
    <section aria-labelledby="t-revisar"><h2 id="t-revisar" style="margin-bottom:.875rem">Para revisar</h2>
      ${revisar.length ? `<ul class="duplas">${revisar.map(item).join('')}</ul>` : `<div class="painel">${vazio('Nada esperando por você', 'Quando o motor terminar o storyboard ou uma prévia, ele aparece aqui.')}</div>`}</section>
    ${andando.length ? `<section aria-labelledby="t-andando"><h2 id="t-andando" style="margin-bottom:.875rem">Com o motor de edição</h2><ul class="duplas">${andando.map(item).join('')}</ul></section>` : ''}
  </div>
  ${rodapeAtualizado()}`;
  })}`;
}

/* ---- Ajustes ---- */

/** Ajustes que ela juntou nesta sessão, por roteiro e versão (só em memória nesta etapa). */
export function pendentesDe(r, v) {
  const chave = `${r.id} v${v ? v.n : 0}`;
  estado.pendentes ||= {};
  return (estado.pendentes[chave] ||= []);
}

/** As perguntas de regra das notas da versão ("## Regra que esbarra no seu pedido"), ou [] enquanto as notas não chegam. */
export function perguntasDaPrevia(r, v) {
  if (!v?.notas) return [];
  const a = anexo(v.notas);
  return a?.fase === 'pronto' ? lerPerguntasRegra(a.texto, r.id) : [];
}

/** Pedidos lidos de "<id> ajustes vN.md" da versão: {fase, lista}. */
function pedidosDoArquivo(v) {
  if (!v?.ajustes) return { fase: 'nenhum', lista: [] };
  const a = anexo(v.ajustes);
  if (a.fase !== 'pronto') return { fase: a.fase, lista: [] };
  return { fase: 'pronto', lista: parseAjustes(a.texto)?.ajustes || [] };
}

const textoPedido = (a) => `<strong>${NOME_REDE[a.versao] || NOME_REDE.ambas}${a.tempo ? `, em ${esc(a.tempo)}` : ''}:</strong> ${esc(a.pedido)}${a.como ? ` <span class="apagado">(${esc(a.como)})</span>` : ''}`;

function listaPedidos(pedidos) {
  if (pedidos.fase === 'carregando') return '<p class="apagado pequeno">Lendo o pedido de ajustes…</p>';
  if (pedidos.fase === 'erro') return `<p class="apagado pequeno">Não consegui ler o pedido de ajustes agora. <button type="button" class="discreto" data-acao="anexo-tentar">Tentar de novo</button></p>`;
  if (!pedidos.lista.length) return '';
  return `<ul class="pedidos">${pedidos.lista.map((a) => `<li><div>${textoPedido(a)}</div></li>`).join('')}</ul>`;
}

/* Linha do tempo: cada ajuste com momento marcado vira um pino na posição certa.
   D = a maior duração real entre IG e TT; antes de os vídeos dizerem a duração, só o trilho. */
function linhaDoTempo(v, pedidos) {
  const D = Math.max(Players.duracaoDe(v.ig), Players.duracaoDe(v.tt));
  const comMomento = pedidos.map((a) => ({ ...a, ...segundosDoTempo(a.tempo) })).filter((a) => a.de !== null);
  const pinos = D ? comMomento.filter((a) => a.de <= D) : [];
  const semMomento = pedidos.length - comMomento.length;
  const passo = D <= 90 ? 10 : D <= 300 ? 30 : 60;
  const marcas = []; if (D) for (let s = 0; s <= D; s += passo) marcas.push(s);
  const letra = { ig: 'IG', tt: 'TT', ambas: '2' };
  const pct = (s) => ((s / D) * 100).toFixed(1);
  const n = comMomento.length;
  return `<div class="tempo" id="linha-tempo" role="img" aria-label="Linha do tempo dos ajustes: ${n ? esc(comMomento.map((a) => `${a.tempo}, ${NOME_REDE[a.versao]}`).join('; ')) : 'nenhum ajuste marcado'}">
    <div class="tempo-topo"><span>Ajustes na linha do tempo</span><span>${n ? `${n} ${n === 1 ? 'marcado' : 'marcados'}${semMomento ? `, ${semMomento} sem momento` : ''}` : 'nenhum marcado ainda'}</span></div>
    <div class="tempo-trilho">
      ${marcas.map((s) => `<span class="tempo-marca" style="left:${pct(s)}%">${relogio(s)}</span>`).join('')}
      ${pinos.map((a) => `${a.ate ? `<span class="pino-faixa" style="left:${pct(a.de)}%;width:${((Math.max(0, Math.min(D, a.ate) - a.de) / D) * 100).toFixed(1)}%"></span>` : ''}<span class="pino ${a.versao}" style="left:${pct(a.de)}%" title="${esc(`${a.tempo}: ${a.pedido}`)}">${letra[a.versao]}</span>`).join('')}
    </div>
  </div>`;
}

/* ---- Painel de revisão ---- */

function resumoDoMotor(v) {
  if (!v?.notas) return '';
  const a = anexo(v.notas);
  if (a.fase === 'carregando') return '<p class="apagado pequeno">Lendo o resumo do motor…</p>';
  if (a.fase === 'erro') return `<p class="apagado pequeno">Não consegui ler o resumo do motor agora. <button type="button" class="discreto" data-acao="anexo-tentar">Tentar de novo</button></p>`;
  // a seção de regras vira as perguntas com botões (o bloco cru, com o id da pergunta, não aparece)
  const texto = semSecaoRegras(a.texto);
  return texto ? `<div class="pequeno resumo-motor"><strong>Resumo do motor:</strong> ${esc(texto)}</div>` : '';
}

/* ---- Andamento do motor (_motor/andamento/<id>.json, via Integra.motor.andamento) ----
   Lido ao abrir a página do vídeo; relido a cada 60 s só enquanto a página estiver visível e houver
   etapa em andamento. Sair da rota esquece a leitura e para o relógio. */
const INTERVALO_ANDAMENTO_MS = 60 * 1000;
const andamentos = new Map(); // id → {fase: 'carregando'|'ok'|'sem-arquivo'|'indisponivel', dados, lendo, timer, esperandoVisivel}
const temNavegador = () => typeof window !== 'undefined' && typeof document !== 'undefined' && typeof location !== 'undefined';

/** Id do vídeo na rota atual (#/videos/<id>), ou null. */
function idDaRota() {
  const m = String(location.hash || '').match(/^#\/?videos\/([^/?#]+)/);
  try { return m ? decodeURIComponent(m[1]) : null; } catch { return null; }
}
const avisarTela = () => window.dispatchEvent(new CustomEvent('motor:anexo')); // main.js redesenha a tela

function esquecerAndamento(id) {
  const l = andamentos.get(id);
  if (l) clearTimeout(l.timer);
  andamentos.delete(id);
}

function agendarAndamento(id, l) {
  clearTimeout(l.timer);
  if (l.fase !== 'ok' || !resumirAndamento(l.dados).emAndamento) return; // nada andando: não relê sozinho
  l.timer = setTimeout(() => {
    if (andamentos.get(id) !== l) return;
    if (idDaRota() !== id) { esquecerAndamento(id); return; }
    if (document.visibilityState === 'visible') lerAndamentoDe(id);
    else l.esperandoVisivel = true; // relê quando a página voltar a ficar visível
  }, INTERVALO_ANDAMENTO_MS);
}

function lerAndamentoDe(id) {
  let l = andamentos.get(id);
  if (!l) { l = { fase: 'carregando', dados: null }; andamentos.set(id, l); }
  if (l.lendo) return;
  l.lendo = true;
  Promise.resolve().then(() => Integra.motor.andamento(id))
    .catch((e) => ({ estado: 'indisponivel', erro: e?.message || '' }))
    .then((r) => {
      if (andamentos.get(id) !== l) return; // saiu da página antes de a leitura voltar
      l.lendo = false;
      if (r?.estado === 'ok') { l.fase = 'ok'; l.dados = r.dados; }
      else if (r?.estado === 'sem-arquivo') { l.fase = 'sem-arquivo'; l.dados = null; }
      else { l.fase = 'indisponivel'; l.dados = null; }
      agendarAndamento(id, l);
      avisarTela();
    });
}

if (temNavegador()) {
  window.addEventListener('hashchange', () => {
    const atual = idDaRota();
    for (const id of [...andamentos.keys()]) if (id !== atual) esquecerAndamento(id);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    for (const [id, l] of andamentos) {
      if (l.esperandoVisivel && idDaRota() === id) { l.esperandoVisivel = false; lerAndamentoDe(id); }
    }
  });
  // "Tentar de novo" do andamento (a ação não está em acoes.js: fica junto da leitura, aqui).
  document.addEventListener('click', (ev) => {
    const el = ev.target?.closest?.('[data-acao="andamento-tentar"]');
    if (!el || !el.dataset.id) return;
    const l = andamentos.get(el.dataset.id);
    if (l && !l.lendo) l.fase = 'carregando';
    lerAndamentoDe(el.dataset.id);
    avisarTela();
  });
}

/** Leitura do andamento para o desenho da tela (dispara a primeira leitura do id). */
function andamentoNaTela(id) {
  if (!temNavegador() || idDaRota() !== id) return { fase: 'carregando' };
  if (!andamentos.has(id)) lerAndamentoDe(id);
  const l = andamentos.get(id);
  return l.fase === 'ok' ? { fase: 'ok', andamento: resumirAndamento(l.dados, new Date()) } : { fase: l.fase };
}

/** Faixa do motor para o id (só leitura): o andamento publicado pelo motor e, se houver, a última
    linha de Execuções com bot = motor (com "Detalhes"). */
const faixaMotor = (r, exec) => {
  const registro = linhasDe(exec?.execucoes, { bot: 'motor', idAlvo: r.id }).length
    ? faixaExecucao({ bot: 'motor', rotulo: 'Registro do motor', idAlvo: r.id, dados: exec })
    : '';
  return `${htmlAndamento(andamentoNaTela(r.id), r.id)}${registro}`;
};

const NOTA_SO_ROBERTTA = 'Só a conta da Robertta decide.';

function painelRevisao(r, v, ehAtual) {
  const atual = ultima(r);
  const exec = execucoesLidas();
  const pelaApp = FLAGS.revisaoPeloApp;
  const decide = podeDecidir(Integra.email());
  if (v && !ehAtual) {
    const pedidos = pedidosDoArquivo(v);
    return `<section class="painel pilha ordem-2"><h2>Versão anterior</h2>
    <p class="nota calma">${ic('info')}<span>Você está vendo a v${v.n}. A atual é a v${atual.n}.</span></p>
    ${pedidos.fase !== 'nenhum' && (pedidos.lista.length || pedidos.fase !== 'pronto') ? `<div><h3 style="margin-bottom:.625rem">O que você pediu nesta versão</h3>${listaPedidos(pedidos)}</div>` : ''}
    <button type="button" class="botao contorno" data-acao="video-versao" data-id="${esc(r.id)}" data-valor="${atual.n}">Voltar para a v${atual.n}</button></section>`;
  }
  if (r.etapa === 'previa' && v) {
    const pend = pendentesDe(r, v);
    const id = esc(r.id);
    const perguntas = perguntasDaPrevia(r, v);
    const chave = chaveRespostas('pv', r.id, v.n);
    const respostas = estado.respostasRegra?.[chave] || {};
    // "Mudar a regra" ou "Só neste vídeo": a aprovação não leva a resposta e o pedido ficaria de fora; vai como ajuste
    const vira = algumaLibera(perguntas, respostas, r.id);
    const soManter = !vira && regrasRespondidas(perguntas, respostas, r.id).length > 0;
    const aprovar = pelaApp ? `
      ${vira ? avisoViraPedido(true, `a prévia v${v.n + 1}`)
    : `<p class="apagado pequeno">Aprovar grava “${esc(nomeArquivoRevisao(r.id, 'aprovar', v.n))}” em 4-Revisao, e o motor monta o pacote final.</p>`}
      ${soManter ? '<p class="pequeno apagado">“Manter” não precisa ir com a aprovação: a regra continua como está.</p>' : ''}
      <button type="button" class="botao primario cheio" data-acao="previa-aprovar" data-id="${id}"${decide ? '' : ' disabled'}>${ic('check')} ${vira ? 'Refazer a prévia com o seu pedido' : `Aprovar a v${v.n}`}</button>
      ${decide ? '' : `<p class="pequeno apagado">${NOTA_SO_ROBERTTA}</p>`}`
      : `<p class="nota calma">${ic('info')}<span>Aprovar e enviar ajustes pelo app chega na próxima etapa. Por enquanto, mande ao Diretor no chat.</span></p>`;
    // "Copiar a lista" (Cole no chat do Diretor) nunca leva as respostas sobre a regra: chat não responde por ela
    const semRegrasNoChat = perguntas.length ? '<p class="pequeno apagado">A lista copiada não leva as respostas sobre a regra: elas só valem enviadas pelo app.</p>' : '';
    const listaPronta = pend.length ? (pelaApp
      ? `<button type="button" class="botao primario cheio" data-acao="ajustes-enviar" data-id="${id}"${decide ? '' : ' disabled'}>${ic('enviar')} Enviar ${pend.length === 1 ? 'o ajuste' : `os ${pend.length} ajustes`}</button>
      <button type="button" class="botao calmo cheio" data-acao="ajustes-copiar" data-id="${id}">${ic('copiar')} Copiar a lista</button>
      ${semRegrasNoChat}
      ${decide ? '' : `<p class="pequeno apagado">${NOTA_SO_ROBERTTA}</p>`}`
      : `<button type="button" class="botao primario cheio" data-acao="ajustes-copiar" data-id="${id}">${ic('copiar')} Copiar a lista</button>${semRegrasNoChat}`) : '';
    const regras = perguntas.length
      ? blocoRegras({ perguntas, respostas, chave, pode: decide && pelaApp, depois: 'A resposta vai junto quando você enviar os ajustes ou refizer a prévia.' }) : '';
    return `
    <section class="painel pilha ordem-2" aria-labelledby="t-aprovar"><h2 id="t-aprovar">Está bom assim?</h2>
      ${faixaMotor(r, exec)}
      ${resumoDoMotor(v)}
      ${regras}
      ${aprovar}
    </section>
    <section class="painel pilha ordem-2" aria-labelledby="t-ajuste"><h2 id="t-ajuste">Pedir ajuste</h2>
      ${segmento('aj-versao', 'Em qual versão?', [['ig', 'Instagram'], ['tt', 'TikTok'], ['ambas', 'As duas']], 'ambas')}
      ${campo({ modelo: 'aj-tempo', rotulo: 'Em que momento', opcional: true, exemplo: '0:12 ou 0:12-0:15', dica: 'O botão embaixo de cada vídeo preenche este campo.' })}
      ${campo({ modelo: 'aj-pedido', rotulo: 'O que mudar', tipo: 'textarea', linhas: 2, exemplo: 'Ex.: tirar o zoom' })}
      ${campo({ modelo: 'aj-como', rotulo: 'Como você imagina', opcional: true, exemplo: 'Ex.: deixar o enquadramento parado' })}
      <button type="button" class="botao contorno" data-acao="ajuste-adicionar" data-id="${esc(r.id)}">Adicionar à lista</button>
      ${pend.length ? `<ul class="pedidos" aria-label="Ajustes na lista">${pend.map((a, i) => `<li><div>${textoPedido(a)}</div><button type="button" class="redondo" data-acao="ajuste-remover" data-id="${esc(r.id)}" data-valor="${i}" aria-label="Tirar este ajuste da lista">${ic('lixo', 18)}</button></li>`).join('')}</ul>
      ${listaPronta}` : ''}
    </section>`;
  }
  const textos = {
    recebido: ['Gravação recebida', 'O motor está preparando a gravação e montando o storyboard: quadros parados para você aprovar antes de qualquer vídeo.'],
    previa: ['Prévia a caminho', 'O motor ainda não entregou os vídeos desta prévia.'],
    ajustes: ['Ajustes enviados', `O motor está refazendo. A v${v ? v.n + 1 : 2} chega pelo aviso do Diretor.`],
    'video-aprovado': ['Vídeos aprovados', 'O motor está montando o pacote final: vídeos, capas, legendas, carrossel, Stories e Threads.'],
    pronto: ['Pacote pronto', 'Os arquivos finais estão em Prontos.'],
  }[r.etapa] || ['Com o motor', 'O Diretor avisa quando houver novidade.'];
  return `<section class="painel pilha ordem-2"><h2>${textos[0]}</h2><p>${textos[1]}</p>
    ${r.etapa === 'pronto' ? '' : faixaMotor(r, exec)}
    ${r.etapa === 'ajustes' && v ? listaPedidos(pedidosDoArquivo(v)) : ''}
    ${r.etapa === 'pronto' ? '<a class="botao primario" href="#/prontos">Abrir em Prontos</a>' : ''}
  </section>`;
}

/** Versão que está na tela (a escolhida nos chips, ou a atual). */
function versaoVista(r) {
  const versoes = r.video.versoes; const atual = ultima(r);
  const n = versoes.some((x) => x.n === estado.versaoVista[r.id]) ? estado.versaoVista[r.id] : atual?.n;
  const v = versoes.find((x) => x.n === n);
  return { v, atual, ehAtual: !v || v.n === atual.n };
}

/** Pinos da versão vista: a lista desta sessão (prévia atual) ou os pedidos do arquivo de ajustes. */
function pinosDe(r, v, ehAtual) {
  if (!v) return [];
  if (ehAtual && r.etapa === 'previa') return pendentesDe(r, v);
  return pedidosDoArquivo(v).lista;
}

/** HTML da linha do tempo da tela atual (o roteador refaz só ela quando chega a duração de um vídeo). */
export function linhaDoTempoAtual(id) {
  const r = rot(id);
  if (!r || SEM_VIDEO.includes(r.etapa)) return '';
  const { v, ehAtual } = versaoVista(r);
  return v ? linhaDoTempo(v, pinosDe(r, v, ehAtual)) : '';
}

/** Detalhe na etapa 'storyboard': os quadros à esquerda, "Está bom assim?" à direita e o histórico. */
function vStoryboard(r) {
  const opts = { email: Integra.email(), local: estado.storyboardsEnviados?.[r.id] || null, agora: new Date() };
  const [texto, tom] = passoDe(r);
  return `
  ${voltar('videos', 'Vídeos')}
  ${cab(r.titulo, '', r.id)}
  <div class="meta" style="margin:-.875rem 0 1.625rem">${selo(texto, tom)}${r.teste ? selo('Teste') : ''}</div>
  <div class="revisao">
    <div class="revisao-a">
      <section class="painel pilha ordem-1" aria-labelledby="t-storyboard">${painelQuadros(r, opts)}</section>
      ${blocoHistorico(historicoComExecucoes(r.eventos, execucoesLidas().execucoes, r.id), 'ordem-3')}
    </div>
    <div class="revisao-b">${painelDecisaoStoryboard(r, { ...opts, faixa: faixaMotor(r, execucoesLidas()) })}</div>
  </div>
  ${rodapeAtualizado()}`;
}

export function vVideo(id) {
  return comDados(() => {
    const r = rot(id);
    if (!r || SEM_VIDEO.includes(r.etapa)) return `${voltar('videos', 'Vídeos')}${naoAchei('videos')}`;
    if (r.etapa === 'storyboard') return vStoryboard(r);
    const versoes = r.video.versoes; const [texto, tom] = passoDe(r);
    const { v, atual, ehAtual } = versaoVista(r);
    const marcar = r.etapa === 'previa' && ehAtual;
    const player = (rede) => Players.html(`${r.id}-${rede}-v${v.n}`, rede, v[rede], { marcar });
    return `
  ${voltar('videos', 'Vídeos')}
  ${cab(r.titulo, '', r.id)}
  <div class="meta" style="margin:-.875rem 0 1.625rem">${selo(texto, tom)}${r.teste ? selo('Teste') : ''}</div>
  <div class="revisao">
    <div class="revisao-a">
      ${v ? `<section class="painel palco ordem-1" aria-label="Vídeos da versão ${v.n}">
        ${versoes.length > 1 ? `<div class="versoes" role="group" aria-label="Escolher a versão"><span class="pequeno apagado">Versão</span>${versoes.map((x) => `<button type="button" class="chip" data-acao="video-versao" data-id="${esc(r.id)}" data-valor="${x.n}" aria-pressed="${x.n === v.n}">v${x.n}${x.n === atual.n ? ' (atual)' : ''}</button>`).join('')}</div>` : ''}
        <div class="players">${player('ig')}${player('tt')}</div>
        ${linhaDoTempo(v, pinosDe(r, v, ehAtual))}
      </section>` : ''}
      ${blocoHistorico(historicoComExecucoes(r.eventos, execucoesLidas().execucoes, r.id), 'ordem-3')}
    </div>
    <div class="revisao-b">${painelRevisao(r, v, ehAtual)}</div>
  </div>
  ${rodapeAtualizado()}`;
  });
}

/* ---- Janela de confirmação da prévia ---- */

/**
 * "Aprovar a prévia?" / "Enviar os ajustes?" (puro). Diz o arquivo que vai nascer em 4-Revisao, o
 * que o motor faz com ele (tempo e custo do catálogo) e que a decisão vale a partir dali.
 *   id, versao (a prévia vista), decisao ('aprovar' | 'ajustar'), ajustes, teste, execucoes,
 *   enviando, erro (mensagem, ex.: "já decidido (arquivo criado às 10h12)"),
 *   regras, perguntas (as respostas dela às perguntas de regra), virou ("Aprovar" virou ajuste por causa delas),
 *   pedidoRegras (o pedido que vai em observações quando não há ajuste na lista e ela não escreve outra)
 */
export function janelaPrevia({
  id, versao, decisao, ajustes = [], teste = false, execucoes = [], enviando = false, erro = '',
  regras = [], perguntas = [], virou = false, pedidoRegras = '',
} = {}) {
  const nome = nomeArquivoRevisao(id, decisao, versao);
  const aprovar = decisao === 'aprovar';
  const rotina = aprovar ? 'motor-finalizar' : 'motor-revisar';
  const c = ROTINAS[rotina].confirmacao;
  const tempo = estatisticasTempo(execucoes, rotina);
  const n = ajustes.length;
  const oQue = n === 1 ? 'o ajuste abaixo' : n ? `os ${n} ajustes abaixo` : 'o pedido que esperava a regra';
  const itens = [
    ['O que vai acontecer', aprovar
      ? `O app grava “${nome}” em 4-Revisao. O motor pega o arquivo em 1 a 6 min e monta o pacote final; depois disso, uma mudança vira ajuste do vídeo final.`
      : `O app grava “${nome}” em 4-Revisao com ${oQue}. O motor pega o arquivo em 1 a 6 min e faz a v${Number(versao) + 1}; depois disso, um ajuste novo entra na próxima versão.`],
    ['O que o motor produz', c.produz.replace(/<id>/g, id)],
    ['Tempo', tempo.medido ? `${tempo.texto}, mais 1 a 6 min até o vigia ver o arquivo` : 'ainda sem medição (mais 1 a 6 min até o vigia ver o arquivo)'],
    ['Custo', c.custo],
    ['Se já tiver sido decidido', 'Logo antes de gravar, o app confere 4-Revisao: se a decisão já existir (pelo app ou pelo Diretor), nada é gravado.'],
  ];
  if (virou) itens.unshift(['Por que vai como ajuste', 'Você escolheu fazer o pedido que esperava a regra. Aprovando agora, ele ficaria de fora; por isso o app manda como pedido de ajuste, e você aprova a versão nova depois.']);
  if (!aprovar && !n && pedidoRegras) itens.splice(1, 0, ['O pedido que vai junto', `${pedidoRegras} (se você não escrever outra observação)`]);
  const lista = aprovar || !n ? '' : `<ul class="pedidos">${ajustes.map((a) => `<li><div>${textoPedido(a)}</div></li>`).join('')}</ul>`;
  const corpo = `${teste ? `<p class="meta">${selo('Teste')}<span class="pequeno apagado">Id de teste: o motor trata como teste.</span></p>` : ''}
    <dl class="confirmacao">${itens.map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>
    ${lista}
    ${aprovar ? '' : listaRespostas(perguntas, regras)}
    ${campo({ modelo: 'pv-obs', rotulo: aprovar ? 'Observações para o pacote final' : 'Observações', opcional: true, exemplo: aprovar ? 'Ex.: capa com o rosto' : 'Ex.: manter a música' })}
    ${erro ? `<p class="nota atencao" role="alert">${ic('alerta')}<span>${esc(erro)}</span></p>` : ''}`;
  const quais = n === 1 ? 'o ajuste' : n ? `os ${n} ajustes` : 'o pedido';
  const rodape = `<button type="button" class="botao calmo" data-acao="fechar-janela">${erro ? 'Fechar' : 'Cancelar'}</button>${erro ? '' : `<button type="button" class="botao primario" data-acao="previa-gravar" data-id="${esc(id)}" data-valor="${esc(decisao)}"${enviando ? ' disabled aria-busy="true"' : ''}>${enviando ? 'Gravando…' : aprovar ? `Aprovar a v${Number(versao)}` : `Enviar ${quais}`}</button>`}`;
  return moldura(aprovar ? `Aprovar a prévia v${Number(versao)}?` : `Enviar ${quais} da v${Number(versao)}?`, corpo, rodape);
}
