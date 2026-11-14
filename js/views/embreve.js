// Telas "Em breve" (Pautas, Roteiros, Resultados).

import { el, icone } from '../ui.js';

const TELAS = {
  pautas: {
    titulo: 'Pautas',
    icone: 'pautas',
    frase: 'Em breve você vai aprovar aqui a seleção de pautas do Radar, sem precisar conversar com os bots.',
  },
  roteiros: {
    titulo: 'Roteiros',
    icone: 'roteiros',
    frase: 'Em breve você vai ler, aprovar e pedir mudanças nos roteiros aqui — com teleprompter para gravar.',
  },
  resultados: {
    titulo: 'Resultados',
    icone: 'resultados',
    frase: 'Em breve você vai acompanhar aqui o desempenho de cada post: visualizações, retenção, envios e salvamentos.',
  },
};

export function render(ctx, qual) {
  const t = TELAS[qual];
  ctx.titulo(t.titulo);
  ctx.mostrar(el('section', { class: 'em-breve card' },
    el('div', { class: 'em-breve-icone' }, icone(t.icone)),
    el('h2', {}, 'Em breve'),
    el('p', {}, t.frase),
    el('a', { href: '#/inicio', class: 'btn btn-contorno' }, 'Voltar ao início')));
}
