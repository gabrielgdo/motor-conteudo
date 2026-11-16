// PERGUNTAS DE REGRA NA TELA (puro: devolve HTML). Cada pergunta mostra o pedido dela, a regra (onde mora e o texto de
// agora), o que o motor fez dentro da regra e como a regra fica se ela mudar, com 3 botões de verdade: "Mudar a regra",
// "Só neste vídeo" e "Manter" (tocar de novo desfaz). As respostas ficam na memória (estado.respostasRegra) até a
// decisão sair; vão no campo `regras` dela (js/regras.js). Tudo o que vem do Drive passa por esc(); o id da pergunta
// nunca aparece.

import { esc, ic } from '../util.js';
import {
  RESPOSTAS_REGRA, ROTULO_RESPOSTA, EFEITO_RESPOSTA, regraLegivel, ondeLegivel, liberaPedido, regrasRespondidas,
} from '../regras.js';

const CLASSE = { mudar: 'contorno mudar', so_neste: 'contorno sim', manter: 'calmo nao' };
/** O texto exato da regra vai entre aspas; a configuração fixa do estilo, dita em palavras, não. */
const aspas = (t, literal) => (!t ? '' : literal ? `“${esc(t)}”` : esc(t));

/** Uma pergunta (cartão com os dados e os 3 botões). */
function cartao(q, { respostas, chave, pode }) {
  const r = regraLegivel(q);
  const atual = respostas?.[q.rid] || '';
  const onde = ondeLegivel(q.onde);
  const botoes = RESPOSTAS_REGRA.map((v) => `<button type="button" class="botao ${CLASSE[v]}" data-acao="regra-responder" data-chave="${esc(chave)}" data-valor="${esc(`${q.rid}|${v}`)}" aria-pressed="${atual === v}"${pode ? '' : ' disabled'}>${v === atual ? ic('check', 16) : ''}${esc(ROTULO_RESPOSTA[v])}</button>`).join('');
  return `<li class="gancho regra${atual ? ' escolhido' : ''}">
    <dl class="gancho-dados">
      <div><dt>Você pediu</dt><dd>“${esc(q.pedido)}”${onde ? ` <span class="apagado">(${esc(onde)})</span>` : ''}</dd></div>
      <div><dt>A regra hoje</dt><dd>${aspas(r.texto, r.literal)}${r.onde ? ` <span class="apagado">${esc(r.onde)}</span>` : ''}</dd></div>
      ${q.feito ? `<div><dt>O que o motor fez agora</dt><dd>${esc(q.feito)}</dd></div>` : ''}
      <div><dt>Se você mudar, a regra fica</dt><dd>${aspas(r.novo, r.literal)}</dd></div>
    </dl>
    ${q.motivo ? `<p class="nota calma">${ic('info')}<span>${esc(q.motivo.charAt(0).toUpperCase() + q.motivo.slice(1))}</span></p>` : ''}
    <div class="decisao" role="group" aria-label="O que fazer com esta regra">${botoes}</div>
    ${atual ? `<p class="pequeno apagado" role="status">${esc(EFEITO_RESPOSTA[atual])}</p>` : ''}
  </li>`;
}

/**
 * O bloco das perguntas (vazio sem pergunta). `respostas`: {rid: resposta} desta decisão; `chave`: a de
 * chaveRespostas; `pode`: a conta decide e a decisão ainda está aberta; `depois`: o que acontece com a resposta.
 */
export function blocoRegras({ perguntas = [], respostas = {}, chave = '', pode = false, depois = '' } = {}) {
  if (!perguntas?.length) return '';
  const n = perguntas.length;
  return `<div class="pilha" style="gap:.75rem" role="group" aria-labelledby="t-regras-${esc(chave)}">
    <h3 id="t-regras-${esc(chave)}" style="margin:0">${n === 1 ? 'Uma regra esbarrou no seu pedido' : `${n} pedidos esbarraram numa regra`}</h3>
    <p class="apagado pequeno">O motor fez o que a regra deixa. Escolha o que fazer${n === 1 ? '' : ' com cada um'}: mudar a regra, fazer só neste vídeo ou manter como está. ${esc(depois)}</p>
    <ol class="ganchos">${perguntas.map((q) => cartao(q, { respostas, chave, pode })).join('')}</ol>
  </div>`;
}

/** As respostas dela, para a janela de confirmação (vazio sem resposta). */
export function listaRespostas(perguntas = [], regras = []) {
  const itens = (regras || []).map((r) => {
    const q = (perguntas || []).find((x) => x.rid === r.id);
    return q ? `<li><div><strong>${esc(ROTULO_RESPOSTA[r.resposta] || '')}:</strong> “${esc(q.pedido)}”</div></li>` : '';
  }).filter(Boolean);
  return itens.length ? `<div class="pilha" style="gap:.375rem"><h3 style="margin:0">Suas respostas sobre a regra</h3><ul class="pedidos">${itens.join('')}</ul></div>` : '';
}

/**
 * O aviso de que "Aprovar" virou pedido de mudança (vazio quando não virou). `depois`: o que o motor entrega
 * ("o storyboard v3", "a prévia v3", "o rascunho v3").
 */
export function avisoViraPedido(virou, depois) {
  if (!virou) return '';
  return `<p class="nota calma" role="status">${ic('info')}<span>${esc(`Você escolheu fazer o pedido que esperava a regra. Aprovando agora, ele ficaria de fora; por isso o app manda como pedido de mudança: o motor faz ${depois} com ele, e você aprova depois.`)}</span></p>`;
}

/** As respostas desta decisão liberam algum pedido? (para trocar o "Aprovar" na tela) */
export function algumaLibera(perguntas = [], respostas = {}, id = '') {
  return regrasRespondidas(perguntas, respostas, id).some((r) => liberaPedido(r.resposta));
}
