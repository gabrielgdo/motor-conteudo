// RESULTADOS: estado honesto de "em breve" (os números vêm da aba Desempenho da planilha Radar,
// etapa 3; o gráfico já está em componentes/grafico.js). Sem dado falso.

import { cab, vazio } from './pecas.js';

export function vResultados() {
  return `
  ${cab('Resultados', 'Os números de cada vídeo, por rede.')}
  <div class="painel" style="max-width:58.75rem">${vazio('Em breve, aqui',
    'Nesta tela vão aparecer os números de cada vídeo no Instagram e no TikTok (visualizações, retenção, envios e salvamentos), lidos da aba Desempenho da planilha Radar, com os vencedores destacados. Até lá, os números seguem como hoje, na retrospectiva com o Diretor.')}</div>`;
}
