// PAUTAS: estado honesto de "em breve" (a seleção vem da aba Seleção da planilha Radar, etapa 3).
// Sem dado falso: só o cabeçalho da tela e o que ela vai fazer. Contador da navegação = 0.

import { cab, vazio } from './pecas.js';

export function vPautas() {
  return `
  ${cab('Pautas', 'As sugestões do Radar para a semana, da maior nota para a menor.')}
  <div class="painel" style="max-width:58.75rem">${vazio('Em breve, aqui',
    'Nesta tela você vai escolher as pautas da semana a partir da aba Seleção da planilha Radar: aprovar, recusar com um motivo e confirmar. O Radar passa as escolhidas ao Roteirista. Até lá, a escolha continua como hoje, na conversa com o Radar.')}</div>`;
}
