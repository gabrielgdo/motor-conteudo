// ENVIAR GRAVAÇÃO (#/enviar e #/enviar/<id>). A escolha do roteiro é a do desenho aprovado; o envio
// retomável pelo app (Integra.drive.enviarVideo) chega na etapa 2. Por enquanto, o painel explica
// como pôr o vídeo em 3-Brutos pelo app do Google Drive, com o nome que o motor reconhece.

import { esc, ic, validade } from '../util.js';
import { rascunho } from '../estado.js';
import { Integra } from '../integra.js';
import { porEtapa } from '../dados.js';
import { cab, selo, comDados, vazio, linkDoDrive } from './pecas.js';

export function vEnviar(idDaRota) {
  return comDados(() => {
    const opcoes = porEtapa('aprovado');
    if (!opcoes.length) return `${cab('Enviar gravação')}<div class="painel">${vazio('Nenhum roteiro esperando gravação', 'Aprove um roteiro e ele aparece aqui para receber o vídeo.', '<a class="botao contorno" href="#/roteiros">Ver os roteiros</a>')}</div>`;
    // Link do tipo #/enviar/S47-02: já chega com o roteiro escolhido.
    if (idDaRota && rascunho['envio-rota'] !== idDaRota && opcoes.some((r) => r.id === idDaRota)) { rascunho['envio-id'] = idDaRota; rascunho['envio-rota'] = idDaRota; }
    if (!opcoes.some((r) => r.id === rascunho['envio-id'])) rascunho['envio-id'] = opcoes[0].id;
    const escolhido = rascunho['envio-id'];
    const pasta = linkDoDrive(Integra.pasta('brutos'), 'Abrir a pasta 3-Brutos');
    return `
  ${cab('Enviar gravação', 'O vídeo vai direto para a edição, no tamanho original.')}
  <div class="envio">
    <section class="painel" aria-labelledby="t-qual">
      <fieldset class="grupo"><legend><h2 id="t-qual" style="margin-bottom:.875rem">Qual roteiro você gravou?</h2></legend>
      <div class="escolhas">${opcoes.map((r) => { const v = validade(r); return `<label class="escolha"><input type="radio" name="envio-id" data-modelo="envio-id" data-redesenhar value="${esc(r.id)}" ${r.id === escolhido ? 'checked' : ''}>
        <span class="escolha-texto"><strong>${esc(r.titulo)}</strong><span class="meta"><span class="id">${esc(r.id)}</span>${v.perto ? selo(v.texto, 'alerta') : ''}${r.teste ? selo('Teste') : ''}</span></span></label>`; }).join('')}</div>
      </fieldset>
    </section>
    <section class="painel pilha" aria-labelledby="t-video">
      <h2 id="t-video">O vídeo</h2>
      <p class="nota calma">${ic('info')}<span>O envio pelo app chega na próxima etapa. Por enquanto, envie o vídeo pelo app do Google Drive para a pasta 3-Brutos, com o nome <strong>${esc(escolhido)}.&lt;extensão&gt;</strong> (ex.: ${esc(escolhido)}.mov). O motor reconhece o roteiro pelo nome.</span></p>
      <div class="botoes">
        <button type="button" class="botao contorno" data-acao="copiar-nome" data-id="${esc(escolhido)}">${ic('copiar', 18)} Copiar o nome</button>
        ${pasta.replace('<a ', '<a class="botao calmo" ')}
      </div>
    </section>
  </div>`;
  });
}
