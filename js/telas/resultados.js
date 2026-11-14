// RESULTADOS: os números ainda são "em breve" (vêm da aba Desempenho da planilha Radar, etapa 3; o
// gráfico já está em componentes/grafico.js). Sem dado falso. No mesmo painel, acima, a faixa da
// retrospectiva do Diretor ("Fazer retrospectiva agora", pela ponte).

import { execucoesLidas } from '../dados.js';
import { faixaExecucao } from '../componentes/execucao.js';
import { cab, vazio } from './pecas.js';

export function htmlResultados({ exec = {}, agora = new Date() } = {}) {
  return `
  ${cab('Resultados', 'Os números de cada vídeo, por rede.')}
  <div class="painel" style="max-width:58.75rem">
    ${faixaExecucao({ rotina: 'diretor-retrospectiva', dados: exec, agora, botao: { texto: 'Fazer retrospectiva agora' } })}
    ${vazio('Em breve, aqui',
    'Nesta tela vão aparecer os números de cada vídeo no Instagram e no TikTok (visualizações, retenção, envios e salvamentos), lidos da aba Desempenho da planilha Radar, com os vencedores destacados. Até lá, os números seguem como hoje, na retrospectiva com o Diretor.')}
  </div>`;
}

export function vResultados() {
  return htmlResultados({ exec: execucoesLidas(), agora: new Date() });
}
