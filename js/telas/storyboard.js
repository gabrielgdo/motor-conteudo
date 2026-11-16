// STORYBOARD NA TELA DO VÍDEO (#/videos/<id> na etapa 'storyboard', desde 15/11/2026). Antes de qualquer prévia em
// vídeo, o motor entrega quadros parados da mesma montagem que vira vídeo. Aqui:
//   - à esquerda, os quadros em grade, uma seção por rede (Instagram, TikTok), cada um com o tempo, o que acontece, o
//     texto na tela e o porquê; tocar na imagem amplia; "Pedir mudança" abre, no próprio quadro, o campo do pedido
//     (só nesta rede ou nas duas) e "Adicionar à lista"; no quadro em que uma peça de motion entra (desde
//     16/11/2026), a tira dela numa fileira de miniaturas embaixo da imagem (tocar abre a tela cheia, que desliza pela
//     tira; componentes/telacheia.js) e, se a peça foi feita para este vídeo, o selo "novo" (a legenda no topo diz o
//     que ele quer dizer);
//   - à direita, as perguntas de regra, se o storyboard trouxer (um pedido dela esbarrou numa regra: "Mudar a regra",
//     "Só neste vídeo" ou "Manter"; js/componentes/regras.js), e "Está bom assim?": a faixa do motor, a lista de
//     pedidos (com "tirar"), observações, "Enviar os pedidos" e "Aprovar o storyboard" (desligado enquanto houver
//     pedido na lista; com uma resposta que libera o pedido, vira "Refazer o storyboard com o seu pedido", porque
//     aprovado o pedido ficaria de fora; numa pergunta da reserva, o pedido já foi feito e uma nota diz isso); depois
//     de enviar, o estado (mudanças enviadas ou aprovado) com o que ela pediu.
// Tudo o que vem do Drive passa por esc(); as imagens são endereços blob: gerados no app (componentes/quadros.js).

import { esc, ic, NOME_REDE } from '../util.js';
import { estado } from '../estado.js';
import { podeDecidir } from '../controle.js';
import { estadoDoStoryboard, nomeDecisaoStoryboard, quadroMaisPerto, segundosDoQuadro } from '../storyboard.js';
import { chaveRespostas } from '../regras.js';
import { blocoRegras, listaRespostas, avisoViraPedido, algumaLibera, notaPedidoJaFeito } from '../componentes/regras.js';
import { Quadros } from '../componentes/quadros.js';
import { moldura } from '../componentes/janelas.js';
import { campo, segmento, selo, vazio, linkDoDrive } from './pecas.js';

const REDES = [['ig', 'Instagram'], ['tt', 'TikTok']];
const NOTA_SO_ROBERTTA = 'Só a conta da Robertta decide.';

/** A lista de pedidos que ela está juntando para esta versão do storyboard (só em memória). */
export function pedidosDoStoryboard(r) {
  const chave = `${r.id} sb${r.storyboard?.versao || 0}`;
  estado.sbPendentes ||= {};
  return (estado.sbPendentes[chave] ||= []);
}

const nomeRede = (rede) => (rede === 'ambas' ? 'Instagram e TikTok' : NOME_REDE[rede] || rede);
export const textoPedidoStoryboard = (a) => `<strong>${esc(nomeRede(a.rede))}${a.quadro ? `, quadro ${Number(a.quadro)}` : ''}${a.tempo ? ` (${esc(a.tempo)})` : ''}:</strong> ${esc(a.pedido)}`;

/** O que o selo "novo" quer dizer (na dica do selo, no leitor de tela e na legenda do topo). */
export const LEGENDA_NOVO = 'peça nova, feita para este vídeo';

/** O selo "novo" (puro): discreto, com a explicação na dica e para o leitor de tela (`explicar`; na legenda do topo,
    o texto ao lado já explica). */
export const seloNovo = (explicar = true) => (explicar
  ? `<span class="selo neutro novo" title="${LEGENDA_NOVO}">novo<span class="vh">: ${LEGENDA_NOVO}</span></span>`
  : '<span class="selo neutro novo">novo</span>');

/** Uma miniatura da tira: botão que abre a tela cheia nela; a imagem que falta (ou falhou) diz isso, sem botão. */
function miniatura(r, rede, q, it, i, total) {
  const st = Quadros.estado(it.file);
  if (st === 'sem-arquivo' || st === 'erro') {
    const msg = `Imagem ${i + 1} de ${total} da animação ${st === 'erro' ? 'não baixou' : 'ainda não chegou ao Drive'}`;
    return `<span class="tira-item falta" role="img" aria-label="${esc(msg)}" title="${esc(msg)}">${ic('alerta', 14)}</span>`;
  }
  const url = Quadros.url(it.file, { depois: true }); // os quadros baixam primeiro
  const rotulo = `Animação do quadro ${q.n} do ${NOME_REDE[rede]}, imagem ${i + 1} de ${total}: ver em tela cheia`;
  return `<button type="button" class="tira-item" data-acao="sb-tira" data-id="${esc(r.id)}" data-valor="${rede}:${q.n}:${i}" aria-label="${esc(rotulo)}">${url ? `<img src="${esc(url)}" alt="" width="540" height="960" decoding="async">` : ''}</button>`;
}

/**
 * A tira da peça de motion que entra no quadro (puro; '' sem tira): o rótulo "Animação" (com o selo "novo", se a
 * peça foi feita para este vídeo) e as imagens da peça numa fileira que rola de lado. Imagem que não chegou: o aviso e
 * "Tentar de novo".
 */
export function tiraDoQuadro(r, rede, q) {
  const itens = q?.tira || [];
  if (!itens.length) return '';
  const total = itens.length;
  const falta = itens.some((it) => ['sem-arquivo', 'erro'].includes(Quadros.estado(it.file)));
  return `<div class="tira">
    <p class="tira-rotulo">Animação${q.novo ? ` ${seloNovo()}` : ''}</p>
    <ol class="tira-lista" aria-label="${esc(`Animação do quadro ${q.n} do ${NOME_REDE[rede]}, ${total} imagens`)}">${itens.map((it, i) => `<li>${miniatura(r, rede, q, it, i, total)}</li>`).join('')}</ol>
    ${falta ? `<p class="pequeno apagado">Falta imagem da animação. <button type="button" class="discreto" data-acao="sb-tentar">Tentar de novo</button></p>` : ''}
  </div>`;
}

function imagem(r, rede, q) {
  const st = Quadros.estado(q.file);
  const alt = `Quadro ${q.n} do ${rede === 'ig' ? 'Instagram' : 'TikTok'}, ${q.tempo}${q.naTela ? `: ${q.naTela}` : ''}`;
  const ampliado = estado.sbAmpliado?.[r.id] === `${rede}:${q.n}`;
  if (st === 'sem-arquivo' || st === 'erro') {
    // a imagem ainda não subiu (o motor sobe os arquivos fora de ordem) ou o download falhou: "Tentar de novo" relê
    // a pasta no Drive e baixa outra vez
    const msg = st === 'erro' ? 'Não consegui baixar a imagem.' : 'A imagem deste quadro ainda não chegou ao Drive.';
    return `<div class="quadro-img vazio-img" role="img" aria-label="${esc(alt)}"><span class="pequeno">${esc(msg)}</span>
      <button type="button" class="botao calmo" data-acao="sb-tentar">${ic('atualizar', 16)} Tentar de novo</button></div>`;
  }
  const url = Quadros.url(q.file);
  const dentro = url ? `<img src="${esc(url)}" alt="${esc(alt)}" width="540" height="960" decoding="async">`
    : '<span class="pequeno apagado">Baixando…</span>';
  return `<button type="button" class="quadro-img" data-acao="sb-ampliar" data-id="${esc(r.id)}" data-valor="${rede}:${q.n}" aria-pressed="${ampliado}" aria-label="${esc(ampliado ? 'Voltar ao tamanho da grade' : 'Ver maior')}">${dentro}<span class="quadro-tempo">${q.n} · ${esc(q.tempo)}</span></button>`;
}

function formQuadro(r, rede, q) {
  const id = esc(r.id);
  const m = `sb-pedido-${r.id}`;
  const outra = rede === 'ig' ? 'tt' : 'ig';
  const par = quadroMaisPerto(r.storyboard?.quadros?.[outra], segundosDoQuadro(q.tempo));
  const opcoes = [[rede, `Só no ${rede === 'ig' ? 'Instagram' : 'TikTok'}`]];
  if (par) opcoes.push(['ambas', 'Nos dois vídeos']);
  return `<div class="quadro-pedido pilha" style="gap:.625rem">
    ${segmento(`sb-rede-${r.id}`, 'Mudar em', opcoes, rede)}
    ${par ? `<p class="pequeno apagado">Nos dois vídeos: vale também para o quadro ${par.n} do ${outra === 'ig' ? 'Instagram' : 'TikTok'} (${esc(par.tempo)}), o mais perto no tempo.</p>` : ''}
    ${campo({ modelo: m, rotulo: `O que mudar no quadro ${q.n}`, tipo: 'textarea', linhas: 2, exemplo: 'Ex.: o texto está grande demais, tirar o zoom' })}
    <div class="decisao">
      <button type="button" class="botao contorno" data-acao="sb-adicionar" data-id="${id}" data-valor="${rede}:${q.n}">${ic('check', 18)} Adicionar à lista</button>
      <button type="button" class="botao calmo" data-acao="sb-cancelar" data-id="${id}">Cancelar</button>
    </div>
  </div>`;
}

/** A grade de quadros de uma rede (puro). */
function gradeDaRede(r, rede, rotulo, { pode, pedidos }) {
  const qs = r.storyboard?.quadros?.[rede] || [];
  if (!qs.length) return '';
  const aberto = estado.sbQuadro?.[r.id];
  return `<section class="pilha" aria-label="Quadros do ${esc(rotulo)}" style="gap:.75rem">
    <h3 style="margin:0">${esc(rotulo)} <span class="apagado pequeno">${qs.length} quadros</span></h3>
    <ol class="quadros">${qs.map((q) => {
      const ampliado = estado.sbAmpliado?.[r.id] === `${rede}:${q.n}`;
      const pedido = pedidos.some((a) => Number(a.quadro) === q.n && (a.rede === rede || a.rede === 'ambas'));
      const editando = aberto === `${rede}:${q.n}`;
      return `<li class="quadro${ampliado || editando ? ' ampliado' : ''}${pedido ? ' com-pedido' : ''}">
        ${imagem(r, rede, q)}
        ${tiraDoQuadro(r, rede, q)}
        <dl class="quadro-dados">
          ${q.acontece ? `<div><dt>Acontece</dt><dd>${esc(q.acontece)}</dd></div>` : ''}
          ${q.naTela ? `<div><dt>Na tela</dt><dd>${esc(q.naTela)}</dd></div>` : ''}
          ${q.porque ? `<div><dt>Por quê</dt><dd>${esc(q.porque)}</dd></div>` : ''}
        </dl>
        ${pedido ? `<p class="meta">${selo('Pedido na lista', 'espera')}</p>` : ''}
        ${editando ? formQuadro(r, rede, q) : pode ? `<button type="button" class="botao calmo cheio" data-acao="sb-quadro" data-id="${esc(r.id)}" data-valor="${rede}:${q.n}">Pedir mudança neste quadro</button>` : ''}
      </li>`;
    }).join('')}</ol>
  </section>`;
}

/** Os quadros do storyboard, por rede (puro). */
export function painelQuadros(r, { email = '', local = null, agora = new Date() } = {}) {
  const sb = r.storyboard || {};
  const st = estadoDoStoryboard(r, { local, agora });
  if (st.estado === 'sem-texto') {
    const link = linkDoDrive(sb.arquivo, 'abrir o storyboard no Drive');
    return vazio('Não consegui ler o storyboard', `${esc(st.explicacao)}${link ? ` Você pode ${link}.` : ''}`,
      `<button type="button" class="botao contorno" data-acao="sb-tentar">${ic('atualizar', 18)} Tentar de novo</button>`);
  }
  const pode = podeDecidir(email) && !st.bloqueia;
  const pedidos = pedidosDoStoryboard(r);
  const notas = sb.notas?.length ? `<div class="pilha" style="gap:.375rem"><h3 style="margin:0">Para você conferir</h3><ul class="pedidos">${sb.notas.map((n) => `<li><div>${esc(n)}</div></li>`).join('')}</ul></div>` : '';
  const novo = ['ig', 'tt'].some((rede) => (sb.quadros?.[rede] || []).some((q) => q.novo && q.tira?.length));
  const legenda = novo ? `<p class="pequeno apagado legenda-novo">${seloNovo(false)} ${esc(LEGENDA_NOVO.charAt(0).toUpperCase() + LEGENDA_NOVO.slice(1))}.</p>` : '';
  const mudou = sb.mudancas?.length ? `<div class="pilha" style="gap:.375rem"><h3 style="margin:0">O que mudou desde a v${Number(sb.versao) - 1}</h3><ul class="pedidos">${sb.mudancas.map((x) => `<li><div>${x.ok ? '' : `${selo('Não aplicado', 'alerta')} `}<strong>${esc(x.rede)}${x.quadro ? `, quadro ${esc(x.quadro)}` : ''}:</strong> ${esc(x.pedido)} <span class="apagado">→ ${esc(x.feito)}</span></div></li>`).join('')}</ul></div>` : '';
  return `
    <h2 id="t-storyboard">Storyboard v${Number(sb.versao) || 1}</h2>
    <p class="apagado pequeno">Quadros parados da mesma montagem que vira vídeo: a legenda e as animações como vão sair. Nenhum vídeo foi renderizado ainda; as prévias só saem depois que você aprovar.</p>
    ${legenda}${notas}${mudou}
    ${REDES.map(([rede, rotulo]) => gradeDaRede(r, rede, rotulo, { pode, pedidos })).join('')}`;
}

/** O painel "Está bom assim?" (puro). `faixa`: o HTML da faixa do motor (andamento), feito pela tela do vídeo. */
export function painelDecisaoStoryboard(r, { email = '', local = null, agora = new Date(), faixa = '' } = {}) {
  const sb = r.storyboard || {};
  const st = estadoDoStoryboard(r, { local, agora });
  const decide = podeDecidir(email);
  const id = esc(r.id);
  const v = Number(sb.versao) || 1;
  if (st.estado !== 'decidir') {
    const dec = sb.decisao || null;
    const pediu = dec?.ajustes?.length ? `<div><h3 style="margin-bottom:.625rem">O que você pediu</h3><ul class="pedidos">${dec.ajustes.map((a) => `<li><div>${textoPedidoStoryboard(a)}</div></li>`).join('')}</ul></div>` : '';
    const respondeu = listaRespostas(sb.regras, dec?.regras);
    return `<section class="painel pilha ordem-2" aria-labelledby="t-sb-estado"><h2 id="t-sb-estado">${esc(st.texto)}</h2>
      <p class="meta">${selo(st.estado === 'sem-texto' ? 'Sem leitura' : st.estado === 'ajustar' ? 'Com o motor' : 'Renderizando', st.tom)}</p>
      <p class="pequeno" role="status">${esc(st.explicacao)}</p>
      ${faixa}
      ${pediu}
      ${dec?.observacoes ? `<p class="pequeno apagado">${esc(dec.observacoes)}</p>` : ''}
      ${respondeu}
    </section>`;
  }
  const pedidos = pedidosDoStoryboard(r);
  const n = pedidos.length;
  const chave = chaveRespostas('sb', r.id, v);
  const respostas = estado.respostasRegra?.[chave] || {};
  // "Mudar a regra" ou "Só neste vídeo": aprovado, o pedido que esperava a regra ficaria de fora; vai como mudança
  const vira = !n && algumaLibera(sb.regras, respostas, r.id);
  const regras = (sb.regras || []).length ? `<section class="painel pilha ordem-2" aria-label="Regra que esbarrou no seu pedido">
      ${blocoRegras({ perguntas: sb.regras, respostas, chave, pode: decide, depois: 'A resposta vai junto com a sua decisão do storyboard.' })}
    </section>` : '';
  return `${regras}
    <section class="painel pilha ordem-2" aria-labelledby="t-sb-aprovar"><h2 id="t-sb-aprovar">Está bom assim?</h2>
      ${faixa}
      <p class="apagado pequeno">${vira ? '' : 'Aprovar manda o motor renderizar as prévias v1 do Instagram e do TikTok. '}Para mudar algo, toque em “Pedir mudança neste quadro” no quadro que quer mudar.</p>
      ${n ? `<div class="pilha" style="gap:.5rem"><h3 style="margin:0">Pedidos de mudança (${n})</h3>
        <ul class="pedidos" aria-label="Pedidos de mudança">${pedidos.map((a, i) => `<li><div>${textoPedidoStoryboard(a)}</div><button type="button" class="redondo" data-acao="sb-remover" data-id="${id}" data-valor="${i}" aria-label="Tirar este pedido da lista">${ic('lixo', 18)}</button></li>`).join('')}</ul></div>` : ''}
      ${campo({ modelo: `sb-obs-${r.id}`, rotulo: n ? 'Mais alguma coisa (vale para o vídeo todo)' : 'Pedido geral', tipo: 'textarea', linhas: 2, opcional: true, exemplo: 'Ex.: menos texto na tela', attrs: decide ? '' : 'disabled' })}
      <button type="button" class="botao primario cheio" data-acao="sb-enviar" data-id="${id}"${decide ? '' : ' disabled'}>${ic('enviar')} ${n ? `Enviar ${n === 1 ? 'o pedido' : `os ${n} pedidos`} de mudança` : 'Enviar o pedido geral'}</button>
      ${decide ? avisoViraPedido(vira, `o storyboard v${v + 1}`) : ''}
      ${decide && !n ? notaPedidoJaFeito(sb.regras, respostas, r.id) : ''}
      <button type="button" class="botao ${n ? 'calmo' : 'primario'} cheio" data-acao="sb-aprovar" data-id="${id}"${decide && !n ? '' : ' disabled'}>${ic('check')} ${vira ? 'Refazer o storyboard com o seu pedido' : `Aprovar o storyboard v${v}`}</button>
      ${n && decide ? '<p class="pequeno apagado">Envie ou tire os pedidos da lista antes de aprovar.</p>' : ''}
      ${decide ? '' : `<p class="pequeno apagado">${NOTA_SO_ROBERTTA}</p>`}
    </section>`;
}

/** Janela de confirmação (puro): "Aprovar o storyboard?" ou "Enviar os pedidos de mudança?". `regras`, `perguntas` e
    `virou`: as respostas dela às perguntas de regra (e se o "Aprovar" virou pedido de mudança por causa delas). */
export function janelaStoryboard({ id, versao, decisao, ajustes = [], observacoes = '', regras = [], perguntas = [], virou = false, teste = false, enviando = false, erro = '' } = {}) {
  const v = Number(versao) || 1;
  const aprovar = decisao === 'aprovar';
  const nome = nomeDecisaoStoryboard(id, v);
  const itens = aprovar
    ? [['O que vai acontecer', `O app manda a aprovação ao motor (“${nome}”). Ele renderiza as prévias v1 do Instagram e do TikTok ao mesmo tempo, confere e avisa quando estiverem prontas.`],
      ['Depois', 'Nas prévias em vídeo, você ainda pode pedir ajustes, como antes.']]
    : [['O que vai acontecer', `O app manda os pedidos ao motor (“${nome}”). Ele muda a montagem e faz o storyboard v${v + 1}, só com quadros; nenhum vídeo é renderizado.`],
      ['Depois', `O storyboard v${v + 1} aparece aqui para você ver de novo.`]];
  if (virou) itens.unshift(['Por que vai como pedido de mudança', 'Você escolheu fazer o pedido que esperava a regra. Aprovando agora, ele ficaria de fora; por isso o app manda como pedido de mudança, e você aprova o storyboard novo depois.']);
  itens.push(['Se já tiver sido decidido', `Vale a primeira decisão do storyboard v${v}: logo antes de enviar, o app confere 4-Revisao.`]);
  const lista = aprovar ? '' : `<ul class="pedidos">${ajustes.map((a) => `<li><div>${textoPedidoStoryboard(a)}</div></li>`).join('')}${observacoes ? `<li><div><strong>Geral:</strong> ${esc(observacoes)}</div></li>` : ''}</ul>`;
  const corpo = `${teste ? `<p class="meta">${selo('Teste')}<span class="pequeno apagado">Id de teste: o motor trata como teste.</span></p>` : ''}
    <dl class="confirmacao">${itens.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
    ${lista}
    ${listaRespostas(perguntas, regras)}
    ${erro ? `<p class="nota atencao" role="alert">${ic('alerta')}<span>${esc(erro)}</span></p>` : ''}`;
  const rotulo = aprovar ? `Aprovar o storyboard v${v}` : `Enviar ${ajustes.length === 1 ? 'o pedido' : ajustes.length ? `os ${ajustes.length} pedidos` : 'o pedido geral'}`;
  const rodape = `<button type="button" class="botao calmo" data-acao="fechar-janela">${erro ? 'Fechar' : 'Cancelar'}</button>${erro ? ''
    : `<button type="button" class="botao primario" data-acao="sb-gravar" data-id="${esc(id)}"${enviando ? ' disabled aria-busy="true"' : ''}>${enviando ? 'Enviando…' : esc(rotulo)}</button>`}`;
  return moldura(esc(aprovar ? `Aprovar o storyboard v${v}?` : 'Enviar os pedidos de mudança?'), corpo, rodape);
}
