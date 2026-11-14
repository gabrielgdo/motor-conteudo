// PRONTOS. Provisória nesta parte: capas, cópia de legendas, download de cada arquivo
// (Integra.baixarBlob) e "Postei" chegam na parte 2. dados.js já traz pacote.arquivos com o tipo
// legível, o tamanho e o arquivo do Drive.

import { roteiros } from '../dados.js';
import { cab, selo, comDados, linkDoDrive, emPreparo, vazio, rodapeAtualizado, gradeSimples } from './pecas.js';

export function vProntos() {
  return `${cab('Prontos', 'Pacotes finais para postar, com os arquivos no tamanho original.')}
  ${comDados(() => {
    const lista = roteiros().filter((r) => r.pacote);
    const extra = (r) => `<p class="pequeno">${r.pacote.arquivos.length} ${r.pacote.arquivos.length === 1 ? 'arquivo' : 'arquivos'} · ${linkDoDrive(r.pacote.pasta, 'Abrir a pasta no Drive')}</p>${r.vencedor ? `<span class="meta">${selo('Vencedor', 'forte')}</span>` : ''}`;
    return `${emPreparo('Baixar cada arquivo e copiar as legendas por aqui chega na próxima atualização do app. Por enquanto, os pacotes abrem no Drive.')}
    ${lista.length ? gradeSimples(lista, extra)
      : `<div class="painel">${vazio('Nenhum pacote pronto ainda', 'Quando o motor finalizar um vídeo aprovado, o pacote aparece aqui.')}</div>`}
    ${rodapeAtualizado()}`;
  })}`;
}
