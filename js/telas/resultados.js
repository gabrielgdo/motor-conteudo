// RESULTADOS: os números de cada vídeo por rede (aba Desempenho da planilha Radar) e a retrospectiva, que desde
// 15/11/2026 é do motor (skill /retrospectiva), pedida aqui sob demanda e sem notificação: o motor calcula a
// mediana da conta em cada rede, marca os vencedores (3x a mediana) e escreve 3 aprendizados em
// 5-Prontos/retrospectivas/<data> retrospectiva.md, que aparece nesta tela.

import { Integra } from '../integra.js';
import { esc, dataCurta } from '../util.js';
import { cab, vazio, campo } from './pecas.js';
import { esperandoNumeros, NUMEROS, REDES } from '../desempenho.js';

const RELER_MS = 2 * 60 * 1000;
const res = { fase: 'carregando', lido: null, retro: null, erro: '', lendo: false, lidoEm: 0 };
const temNavegador = () => typeof window !== 'undefined' && typeof document !== 'undefined' && typeof window.addEventListener === 'function';

function ler() {
  if (res.lendo || !temNavegador()) return;
  res.lendo = true;
  Promise.all([
    Integra.planilha.lerDesempenho(true),
    Integra.drive.ultimaRetrospectiva().catch(() => null),
  ]).then(([lido, retro]) => { res.fase = 'ok'; res.lido = lido; res.retro = retro; res.erro = ''; })
    .catch((e) => { res.fase = 'erro'; res.erro = e?.message || 'Não consegui ler a aba Desempenho.'; })
    .finally(() => { res.lendo = false; res.lidoEm = Date.now(); window.dispatchEvent(new CustomEvent('motor:anexo')); });
}

/** Depois de salvar números ou pedir a retrospectiva: relê na próxima pintura. */
export function recarregarResultados() { res.lidoEm = 0; ler(); }
if (temNavegador()) window.addEventListener('motor:conta-trocada', () => { res.fase = 'carregando'; res.lido = null; res.retro = null; res.lidoEm = 0; });

export const modeloNumero = (id, rede, chave) => `dn-${id}-${rede}-${chave}`;

/** Markdown simples da retrospectiva (títulos, listas, tabela, parágrafos) → HTML escapado. */
export function mdSimples(md = '') {
  const out = [];
  let lista = null;
  let tabela = null;
  const fechar = () => {
    if (lista) { out.push(`<${lista.tag} class="retro-lista">${lista.itens.join('')}</${lista.tag}>`); lista = null; }
    if (tabela) {
      const [cabeca, ...corpo] = tabela.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l));
      const cels = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => esc(c.trim()));
      out.push(`<div class="tab-rolagem"><table class="retro-tabela"><thead><tr>${cels(cabeca).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${
        corpo.map((l) => `<tr>${cels(l).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      tabela = null;
    }
  };
  for (const linha of String(md).split(/\r?\n/)) {
    const t = linha.trim();
    if (!t) { fechar(); continue; }
    if (t.startsWith('|')) { if (lista) fechar(); (tabela ||= []).push(t); continue; }
    if (tabela) fechar();
    let m;
    if ((m = t.match(/^#{1,2}\s+(.*)$/))) { fechar(); out.push(`<h3 class="retro-titulo">${esc(m[1])}</h3>`); continue; }
    if ((m = t.match(/^#{3,}\s+(.*)$/))) { fechar(); out.push(`<h4>${esc(m[1])}</h4>`); continue; }
    if ((m = t.match(/^(?:[-*]|(\d+)\.)\s+(.*)$/))) {
      const tag = m[1] ? 'ol' : 'ul';
      if (lista && lista.tag !== tag) fechar();
      (lista ||= { tag, itens: [] }).itens.push(`<li>${esc(m[2])}</li>`);
      continue;
    }
    fechar();
    out.push(`<p>${esc(t)}</p>`);
  }
  fechar();
  return out.join('');
}

function formulario(v, rede) {
  const campos = NUMEROS.map(([chave, rotulo]) => campo({
    modelo: modeloNumero(v.id, rede, chave), rotulo, opcional: chave !== 'visualizacoes',
    attrs: `inputmode="decimal" autocomplete="off"`, exemplo: chave === 'retencao' ? 'ex.: 42' : 'ex.: 12300',
  })).join('');
  return `<fieldset class="numeros-rede"><legend><strong>${esc(v.id)}</strong> · ${esc(rede)} <span class="apagado">· postado em ${esc(dataCurta(v.data))}</span></legend>
    <div class="grade-campos duas">${campos}</div>
    <p style="margin-top:.75rem"><button type="button" class="botao" data-acao="salvar-numeros" data-id="${esc(v.id)}" data-valor="${esc(rede)}">Salvar números</button></p></fieldset>`;
}

function tabelaNumeros(lido) {
  const linhas = lido.registros.filter((r) => r.rede && r.numeros.visualizacoes && !/^T\d/i.test(r.id))
    .sort((a, b) => b.data.localeCompare(a.data));
  if (!linhas.length) return '';
  const blocos = REDES.map((rede) => {
    const ls = linhas.filter((r) => r.rede === rede);
    if (!ls.length) return '';
    return `<h3 class="retro-titulo">${esc(rede)}</h3><div class="tab-rolagem"><table class="retro-tabela"><thead><tr><th>vídeo</th><th>postado</th>${
      NUMEROS.map(([, rotulo]) => `<th>${esc(rotulo.replace(' (%)', ''))}</th>`).join('')}</tr></thead><tbody>${
      ls.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(dataCurta(r.data))}</td>${NUMEROS.map(([k]) => `<td>${esc(r.numeros[k])}${k === 'retencao' && r.numeros[k] ? '%' : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }).join('');
  return `<div class="painel" style="max-width:58.75rem;margin-top:1rem"><h2 class="painel-titulo">Números por rede</h2>${blocos}</div>`;
}

export function htmlResultados({ fase = res.fase, lido = res.lido, retro = res.retro, erro = res.erro, agora = new Date() } = {}) {
  const topo = cab('Resultados', 'Os números de cada vídeo, por rede, e a retrospectiva.');
  if (fase === 'carregando') return `${topo}<div class="painel" aria-busy="true"><p class="apagado">Lendo a aba Desempenho…</p></div>`;
  if (fase === 'erro') return `${topo}<div class="painel" role="alert">${vazio('Não consegui ler a aba Desempenho', esc(erro), '<button type="button" class="botao contorno" data-acao="recarregar-resultados">Tentar de novo</button>')}</div>`;
  const esperando = esperandoNumeros(lido, agora);
  const forms = esperando.flatMap((v) => v.redes.map((rede) => formulario(v, rede))).join('');
  const retroHtml = retro
    ? `<p class="apagado pequeno">${esc(retro.nome.replace(' retrospectiva.md', '').split('-').reverse().join('/'))}</p><div class="retro">${mdSimples(retro.texto)}</div>`
    : '<p class="apagado">Ainda não há retrospectiva feita pelo motor.</p>';
  return `${topo}
  <div class="painel" style="max-width:58.75rem">
    <h2 class="painel-titulo">Faltam números</h2>
    ${forms || '<p class="apagado">Nenhum vídeo esperando números. Cada vídeo aparece aqui 7 dias depois do “Postei”.</p>'}
  </div>
  <div class="painel" style="max-width:58.75rem;margin-top:1rem">
    <h2 class="painel-titulo">Retrospectiva</h2>
    <p>O motor calcula a mediana da conta em cada rede, marca os vencedores (3x a mediana) e escreve 3 aprendizados. Leva alguns minutos; o resultado aparece aqui.</p>
    <p style="margin:.75rem 0 1rem"><button type="button" class="botao" data-acao="pedir-retrospectiva">Fazer retrospectiva</button></p>
    ${retroHtml}
  </div>
  ${tabelaNumeros(lido)}`;
}

export function vResultados() {
  if (temNavegador() && !res.lendo && Date.now() - res.lidoEm > RELER_MS) ler();
  return htmlResultados();
}
