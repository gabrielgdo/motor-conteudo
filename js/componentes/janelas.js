// Avisos rápidos, avisos fixos (sessão expirada, sem internet, nova versão), janelas, cópia e a
// janela "Sobre o app".

import { $, esc, ic } from '../util.js';
import { estado } from '../estado.js';

/* ---- Avisos ---- */

/** Aviso rápido (some sozinho). No máximo dois na tela, sem contar os fixos. */
export function avisar(texto) {
  const pilha = $('#avisos');
  if (!pilha) return;
  const a = document.createElement('div');
  a.className = 'aviso';
  a.textContent = texto;
  const rapidos = [...pilha.querySelectorAll('.aviso:not(.fixo)')];
  while (rapidos.length > 1) rapidos.shift().remove();
  pilha.appendChild(a);
  setTimeout(() => a.remove(), 4800);
}

/**
 * Aviso que fica até ser resolvido. Com `acao`, vira um botão (data-acao) que a pessoa toca.
 * Uma chave por assunto: chamar de novo só troca o texto.
 */
export function avisoFixo(chave, texto, { acao = '', icone = 'info', calmo = false } = {}) {
  const pilha = $('#avisos');
  if (!pilha) return null;
  let a = pilha.querySelector(`[data-aviso="${chave}"]`);
  if (!a) {
    a = document.createElement(acao ? 'button' : 'div');
    if (acao) { a.type = 'button'; a.dataset.acao = acao; }
    a.dataset.aviso = chave;
    pilha.prepend(a);
  }
  a.className = `aviso fixo${calmo ? ' calmo' : ''}`;
  a.innerHTML = `${ic(icone, 18)}<span></span>`;
  a.lastChild.textContent = texto;
  return a;
}

export function removerAviso(chave) {
  $('#avisos')?.querySelector(`[data-aviso="${chave}"]`)?.remove();
}

/* ---- Janelas ---- */

export function abrirJanela(html, classe = 'janela') {
  const d = $('#dialogo');
  d.className = classe;
  d.innerHTML = html;
  if (!d.open) d.showModal();
}
export function fecharJanela() {
  const d = $('#dialogo');
  if (d.open) d.close();
  estado.erros = {};
}
/** `titulo` e `corpo`/`rodape` são HTML (escape os dados antes). */
export const moldura = (titulo, corpo, rodape = '') => `<div class="dlg"><header class="dlg-cab"><h2 id="dlg-titulo">${titulo}</h2><button type="button" class="redondo" data-acao="fechar-janela" aria-label="Fechar">${ic('fechar')}</button></header><div class="dlg-corpo">${corpo}</div>${rodape ? `<footer class="dlg-rodape">${rodape}</footer>` : ''}</div>`;

/** Confirmação de "Sair" (botão da ilha, link do Início ou a busca rápida). */
export function janelaSair(email) {
  return moldura('Sair da conta?', `<p>Você volta para a tela de entrada. Para usar de novo, entre com Google.</p>${email ? `<p class="conta-atual">${ic('sair', 18)}<span>Conta conectada: <strong>${esc(email)}</strong></span></p>` : ''}`,
    '<button type="button" class="botao calmo" data-acao="fechar-janela">Ficar</button><button type="button" class="botao primario" data-acao="confirmar-sair">Sair</button>');
}

/* ---- Área de transferência e downloads ---- */

/** Copia um texto. Aceita também uma Promise de texto (ex.: arquivo ainda baixando): no Safari, o
    ClipboardItem com Promise mantém a permissão do toque enquanto o texto chega. */
export async function copiarTexto(texto) {
  if (texto && typeof texto.then === 'function') {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      try {
        const blob = Promise.resolve(texto).then((t) => new Blob([String(t)], { type: 'text/plain' }));
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
        return true;
      } catch { /* cai no jeito comum abaixo */ }
    }
    texto = await texto;
  }
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Sem permissão da área de transferência: usa o jeito antigo.
    const t = document.createElement('textarea');
    t.value = texto;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* sem cópia */ }
    t.remove();
    return ok;
  }
}

/** Salva um Blob com o nome dado (download do navegador). */
export function salvarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000); // tempo para o navegador (ou a pergunta do iPhone) pegar o arquivo
}

/* ---- Sobre o app ---- */

export function janelaSobre() {
  const instalar = document.querySelector('.login-porta details');
  return moldura('Sobre o app', `<div class="sobre pilha">
    <p>O Motor de Conteúdo é outra porta para o mesmo fluxo dos bots: cada vídeo, da pauta à postagem, num só lugar. Os arquivos continuam no Google Drive, e o chat com os bots continua existindo.</p>
    <div><h3>O que o app faz hoje</h3><ul>
      <li>Mostra o que espera por você e em que etapa está cada roteiro da semana</li>
      <li>Mostra os roteiros, com a versão do Instagram, a do TikTok e os textos extras</li>
      <li>Toca as prévias dos vídeos, com o tempo exato do ponto em que você quer um ajuste</li>
      <li>Deixa baixar os pacotes prontos, com os arquivos no tamanho original</li></ul></div>
    <div><h3>O que chega nas próximas etapas</h3><ul>
      <li>Aprovar um roteiro ou uma prévia, ou pedir ajuste, gravando a decisão direto no Drive</li>
      <li>Enviar a gravação pelo app, em pedaços, sem perder nada se a internet cair</li>
      <li>Escolher as pautas e ver os resultados de cada vídeo, a partir da planilha Radar</li></ul></div>
    <p class="pequeno apagado">O app não publica nada nas redes: a postagem continua com você.</p>
    ${instalar ? `<details>${instalar.innerHTML}</details>` : ''}</div>`);
}
