// ROTEIROS (lista e detalhe). Provisória nesta parte: a tela completa do desenho aprovado (abas
// Instagram/TikTok/Extras/Fontes, decisão e teleprompter) chega na parte 2. Os dados que ela vai
// usar já estão prontos em dados.js (falas, ganchos, legendas, carrossel, stories, fontes, checklist).

import { esc } from '../util.js';
import { ativos, rot } from '../dados.js';
import { cab, selo, passoDe, naoAchei, comDados, linkDoDrive, emPreparo, vazio, rodapeAtualizado, voltar, gradeSimples } from './pecas.js';

export function vRoteiros() {
  return `${cab('Roteiros', 'Cada roteiro traz a versão do Instagram, a do TikTok e os textos extras.')}
  ${comDados(() => {
    const lista = ativos().filter((r) => ['rascunho', 'aprovado'].includes(r.etapa));
    return `${emPreparo('A leitura completa de cada roteiro, com o teleprompter, chega na próxima atualização do app. Por enquanto, abra o texto no Drive.')}
    ${lista.length ? gradeSimples(lista, (r) => `<p class="pequeno">${linkDoDrive(r.arquivoRoteiro, 'Abrir o roteiro no Drive')}</p>`)
      : `<div class="painel">${vazio('Nenhum roteiro para aprovar ou gravar', 'Os rascunhos novos do Roteirista aparecem aqui, já com as fontes conferidas.')}</div>`}
    ${rodapeAtualizado()}`;
  })}`;
}

export function vRoteiro(id) {
  return comDados(() => {
    const r = rot(id);
    if (!r || r.arquivado) return `${voltar('roteiros', 'Roteiros')}${naoAchei('roteiros')}`;
    const [texto, tom] = passoDe(r);
    return `${voltar('roteiros', 'Roteiros')}
    ${cab(r.titulo, '', r.id)}
    <div class="meta" style="margin:-.875rem 0 1.625rem">${selo(texto, tom)}${r.formato ? selo(r.formato) : ''}</div>
    ${emPreparo('A leitura completa deste roteiro, com o teleprompter, chega na próxima atualização do app.')}
    <div class="painel pilha">${r.erroTexto ? `<p class="apagado pequeno">Não consegui ler o texto deste roteiro agora.</p>` : ''}<p>${linkDoDrive(r.arquivoRoteiro, 'Abrir o roteiro no Drive') || esc('O arquivo do roteiro não está no Drive.')}</p></div>`;
  });
}
