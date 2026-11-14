// ENVIAR GRAVAÇÃO (#/enviar e #/enviar/<id>). Provisória nesta parte: o envio retomável em
// pedaços (Integra.drive.enviarVideo) chega na parte 2.

import { porEtapa } from '../dados.js';
import { cab, comDados, emPreparo, vazio, gradeSimples } from './pecas.js';

export function vEnviar() {
  return `${cab('Enviar gravação', 'O vídeo vai direto para a edição, no tamanho original.')}
  ${comDados(() => {
    const lista = porEtapa('aprovado');
    return `${emPreparo('O envio pelo app chega na próxima atualização. Até lá, coloque o vídeo na pasta 3-Brutos do Drive, sem precisar renomear: o motor reconhece o roteiro pela fala.')}
    ${lista.length ? `<h2 style="margin-bottom:.875rem">Esperando gravação</h2>${gradeSimples(lista)}`
      : `<div class="painel">${vazio('Nenhum roteiro esperando gravação', 'Aprove um roteiro e ele aparece aqui para receber o vídeo.')}</div>`}`;
  })}`;
}
