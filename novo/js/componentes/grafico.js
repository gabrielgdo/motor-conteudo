// Gráfico de colunas agrupadas (tela Resultados, etapa 3), feito em HTML e CSS. Uma escala só,
// legenda sempre visível, valor em texto só na maior coluna; os outros valores estão na dica (ao
// passar o dedo ou o teclado) e na tabela da tela.
// Densidade: a ALTURA (210 "px de referência") vira --folga em rem, e a dica é posicionada com a
// escala real do rem (0,8 no computador), para ficar igual ao desenho aprovado a 80% de zoom.

import { $, esc, numero, NOME_REDE, rem, escala } from '../util.js';

export const METRICAS = {
  views: { rotulo: 'Visualizações', agrega: 'soma', sufixo: '' },
  retencao: { rotulo: 'Retenção média', agrega: 'media', sufixo: '%' },
  envios: { rotulo: 'Envios', agrega: 'soma', sufixo: '' },
  salvos: { rotulo: 'Salvamentos', agrega: 'soma', sufixo: '' },
};
const ALTURA = 210; // a mesma altura de .g-eixo/.g-plano no CSS (13.125rem)

function tetoRedondo(v) {
  if (v <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(v)); const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 4 ? 4 : f <= 8 ? 8 : 10) * p;
}

/** `desempenho`: [{id, rede, data, views, retencao, envios, salvos, seguidores}]; `metrica`: chave de METRICAS. */
export function grafico(desempenho, metrica = 'views') {
  const m = METRICAS[metrica];
  const semanas = [...new Set(desempenho.map((d) => d.id.split('-')[0]))].sort();
  const valorDe = (rede, s) => {
    const v = desempenho.filter((d) => d.rede === rede && d.id.startsWith(s + '-')).map((d) => d[metrica]);
    if (!v.length) return null;
    const soma = v.reduce((a, b) => a + b, 0);
    return m.agrega === 'media' ? soma / v.length : soma;
  };
  const series = { ig: semanas.map((s) => valorDe('ig', s)), tt: semanas.map((s) => valorDe('tt', s)) };
  const maior = Math.max(1, ...series.ig.filter((x) => x !== null), ...series.tt.filter((x) => x !== null));
  const teto = tetoRedondo(maior);
  const noEixo = (v) => (m.sufixo ? `${v}${m.sufixo}` : teto >= 10000 ? (v ? `${(v / 1000).toLocaleString('pt-BR')} mil` : '0') : numero(v));
  const marcas = [0, 0.25, 0.5, 0.75, 1];
  const barra = (rede, i) => {
    const v = series[rede][i];
    if (v === null) return '';
    const h = v / teto; const texto = `${numero(v)}${m.sufixo}`; const sem = esc(semanas[i].slice(1));
    return `<button type="button" class="g-barra ${rede}" style="height:${(h * 100).toFixed(1)}%;--folga:${rem(ALTURA * (1 - h))};animation-delay:${i * 60}ms" data-dica-valor="${texto}" data-dica-rotulo="${NOME_REDE[rede]}, semana ${sem}" aria-label="${NOME_REDE[rede]}, semana ${sem}: ${texto}">${v === maior ? `<span class="g-valor">${texto}</span>` : ''}</button>`;
  };
  return `<div class="grafico" id="grafico">
    <div class="g-legenda"><span><i class="amostra ig"></i>Instagram</span><span><i class="amostra tt"></i>TikTok</span></div>
    <div class="g-area">
      <div class="g-eixo" aria-hidden="true">${marcas.map((f) => `<span style="bottom:${f * 100}%">${noEixo(teto * f)}</span>`).join('')}</div>
      <div class="g-plano">${marcas.slice(1).map((f) => `<div class="g-grade" style="bottom:${f * 100}%"></div>`).join('')}
        <div class="g-grupos">${semanas.map((s, i) => `<div class="g-grupo">${barra('ig', i)}${barra('tt', i)}</div>`).join('')}</div></div>
    </div>
    <div class="g-rotulos" aria-hidden="true">${semanas.map((s) => `<span>Semana ${esc(s.slice(1))}</span>`).join('')}</div>
    <div class="g-dica" id="g-dica" hidden></div>
  </div>`;
}

/* Dica do gráfico: aparece com o ponteiro ou com o foco do teclado */
function mostrarDica(barra) {
  const dica = $('#g-dica'); const caixa = $('#grafico');
  if (!dica || !caixa) return;
  dica.innerHTML = '<strong></strong><span></span>';
  dica.firstChild.textContent = barra.dataset.dicaValor;
  dica.lastChild.textContent = barra.dataset.dicaRotulo;
  const b = barra.getBoundingClientRect(); const c = caixa.getBoundingClientRect();
  dica.hidden = false;
  const metade = dica.offsetWidth / 2;
  dica.style.left = Math.max(metade, Math.min(c.width - metade, b.left + b.width / 2 - c.left)) + 'px';
  dica.style.top = b.top - c.top - 8 * escala() + 'px'; // 8 px de referência, na escala real
}

export function ligarGrafico() {
  ['pointerover', 'focusin'].forEach((tipo) => document.addEventListener(tipo, (ev) => { const b = ev.target.closest?.('.g-barra'); if (b) mostrarDica(b); }));
  ['pointerout', 'focusout'].forEach((tipo) => document.addEventListener(tipo, (ev) => { if (ev.target.closest?.('.g-barra') && $('#g-dica')) $('#g-dica').hidden = true; }));
}
