// Tela Início: saudação, "Esperando você", Enviar gravação, progresso e roteiros da semana.

import { el, chip, icone } from '../ui.js';
import { NOMES } from '../config.js';
import { horaNoFuso, prefixoSemana, parseFrontmatterRoteiro } from '../parse.js';
import { baixarTexto } from '../drive.js';
import {
  resumoEsperando, progressoSemana, projetosDaSemana, testesAtivos, ajusteEmAndamento, dataGravacao,
} from '../model.js';

function saudacao(email) {
  const nome = NOMES[email] || '';
  if (nome === 'Gabriel') return 'Olá, Gabriel';
  const h = horaNoFuso();
  const periodo = h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
  return nome ? `${periodo}, ${nome}` : periodo;
}

function cardEspera({ titulo, n, href, detalhe, desativado }) {
  const conteudo = [
    el('span', { class: 'espera-n' }, desativado ? '—' : String(n)),
    el('span', { class: 'espera-titulo' }, titulo),
    detalhe || null,
    desativado ? chip('em breve') : null,
  ];
  if (desativado) return el('div', { class: 'card espera desativado', 'aria-disabled': 'true' }, conteudo);
  return el('a', { class: `card espera ${n ? 'tem' : ''}`, href }, conteudo);
}

function rotuloRoteiro(p) {
  if (p.roteiro) return 'aprovado';
  if (p.ultimoRascunho) return `rascunho v${p.ultimoRascunho.v}`;
  return '—';
}

function rotuloGravacao(p) {
  return p.brutos.length ? `✓ ${dataGravacao(p)}` : '—';
}

function rotuloVideos(p) {
  if (p.postado) return 'postado';
  if (p.pacote) return 'pronto';
  if (p.aprovado) return 'aprovado';
  if (ajusteEmAndamento(p)) return 'ajustes';
  if (p.previas.atual) return `prévia v${p.previas.atual}`;
  return '—';
}

export async function render(ctx) {
  ctx.titulo('Início');
  const { projetos, brutosSemId, postadosErro } = await ctx.estado();
  if (!ctx.ativo()) return;

  const esp = resumoEsperando(projetos);
  const nPrevias = esp.previasNovas.length;
  const tudoZerado = !esp.roteirosParaAprovar.length && !nPrevias && !esp.pacotesSemPostei.length;

  const listaRoteiros = esp.roteirosParaAprovar.length
    ? el('ul', { class: 'espera-lista' }, esp.roteirosParaAprovar.slice(0, 5).map((p) =>
      el('li', {}, el('strong', {}, p.id), p.titulo ? ` · ${p.titulo}` : '')))
    : null;

  const cards = el('div', { class: 'grade-espera' },
    cardEspera({ titulo: 'Roteiros para aprovar', n: esp.roteirosParaAprovar.length, href: '#/roteiros', detalhe: listaRoteiros }),
    cardEspera({
      titulo: 'Prévias novas', n: nPrevias,
      href: nPrevias === 1 ? `#/videos/${encodeURIComponent(esp.previasNovas[0].id)}` : '#/videos',
    }),
    cardEspera({ titulo: 'Pacotes prontos para postar', n: esp.pacotesSemPostei.length, href: '#/prontos' }),
    cardEspera({ titulo: 'Seleção do Radar', desativado: true }));

  // Progresso da semana
  const prefixo = prefixoSemana();
  const prog = progressoSemana(projetos, prefixo);
  const progresso = prog.total === 0
    ? el('p', { class: 'suave' }, 'Ainda não há pautas desta semana.')
    : el('div', { class: 'progresso' }, prog.etapas.map((e) =>
      el('div', { class: `etapa ${e.completa ? 'completa' : ''}` },
        el('div', { class: 'etapa-topo' },
          el('span', {}, e.rotulo),
          el('span', { class: 'etapa-n' }, e.completa ? icone('check', 'icone mini') : null, `${e.feitos} de ${e.total}`)),
        el('div', { class: 'barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(e.total), 'aria-valuenow': String(e.feitos), 'aria-label': e.rotulo },
          el('div', { class: 'barra-cheia', style: { width: `${Math.round((e.feitos / e.total) * 100)}%` } })))));

  // Roteiros da semana (+ testes ativos)
  const semana = projetosDaSemana(projetos, prefixo);
  const linhas = [...semana, ...testesAtivos(projetos).filter((p) => !semana.includes(p))];
  const tabela = linhas.length ? montarTabela(linhas) : null;

  ctx.mostrar(
    el('section', { class: 'bloco' }, el('h2', { class: 'saudacao' }, saudacao(ctx.email))),
    postadosErro ? el('p', { class: 'aviso' }, postadosErro) : null,
    el('section', { class: 'bloco' },
      el('h3', {}, 'Esperando você'),
      tudoZerado ? el('p', { class: 'calmo' }, 'Nada esperando por você agora.') : null,
      cards),
    el('section', { class: 'bloco' },
      el('a', { href: '#/enviar', class: 'btn btn-principal btn-grande btn-largo' }, icone('enviar'), el('span', {}, 'Enviar gravação')),
      brutosSemId.length
        ? el('p', { class: 'suave pequeno' }, `${brutosSemId.length} ${brutosSemId.length === 1 ? 'gravação sem id' : 'gravações sem id'} em 3-Brutos — o motor reconhece o roteiro pela fala.`)
        : null),
    el('section', { class: 'bloco card' }, el('h3', {}, `Progresso da semana (${prefixo})`), progresso),
    tabela ? el('section', { class: 'bloco' }, el('h3', {}, 'Roteiros da semana'), tabela.no) : null,
  );

  if (tabela) carregarFrontmatters(ctx, linhas, tabela.preencher);
}

function montarTabela(linhas) {
  const celulas = new Map(); // id → {titulo:[nós], valido:[nós]}
  const reg = (id, tipo, no) => {
    if (!celulas.has(id)) celulas.set(id, { titulo: [], valido: [] });
    celulas.get(id)[tipo].push(no);
    return no;
  };
  const link = (p) => `#/videos/${encodeURIComponent(p.id)}`;

  // Computador: tabela
  const tabela = el('div', { class: 'tabela-rolagem so-computador' }, el('table', { class: 'tabela-semana' },
    el('thead', {}, el('tr', {}, ['id', 'título', 'roteiro', 'gravação', 'vídeos', 'válido até'].map((c) => el('th', {}, c)))),
    el('tbody', {}, linhas.map((p) => {
      const tr = el('tr', { class: 'clicavel', tabindex: '0', role: 'link', onclick: () => { location.hash = link(p); }, onkeydown: (e) => { if (e.key === 'Enter') location.hash = link(p); } },
        el('td', {}, el('strong', {}, p.id), p.teste ? chip('teste') : null),
        reg(p.id, 'titulo', el('td', {}, p.titulo || '…')),
        el('td', {}, rotuloRoteiro(p)),
        el('td', {}, rotuloGravacao(p)),
        el('td', {}, rotuloVideos(p)),
        reg(p.id, 'valido', el('td', {}, '…')));
      return tr;
    }))));

  // Celular: cards compactos
  const cards = el('div', { class: 'cards-semana so-celular' }, linhas.map((p) =>
    el('a', { href: link(p), class: 'card card-semana' },
      el('div', { class: 'card-semana-topo' }, el('strong', {}, p.id), p.teste ? chip('teste') : null),
      reg(p.id, 'titulo', el('div', { class: 'card-semana-titulo' }, p.titulo || '…')),
      el('dl', { class: 'mini-dados' },
        el('dt', {}, 'Roteiro'), el('dd', {}, rotuloRoteiro(p)),
        el('dt', {}, 'Gravação'), el('dd', {}, rotuloGravacao(p)),
        el('dt', {}, 'Vídeos'), el('dd', {}, rotuloVideos(p)),
        el('dt', {}, 'Válido até'), reg(p.id, 'valido', el('dd', {}, '…'))))));

  const preencher = (p, fm) => {
    const c = celulas.get(p.id);
    if (!c) return;
    const titulo = p.titulo || fm?.titulo || '—';
    c.titulo.forEach((n) => { n.textContent = titulo; });
    c.valido.forEach((n) => { n.textContent = fm?.valido_ate || '—'; });
  };
  return { no: el('div', {}, tabela, cards), preencher };
}

// Frontmatter do roteiro aprovado (ou do último rascunho), só para as linhas da tabela.
function carregarFrontmatters(ctx, linhas, preencher) {
  for (const p of linhas) {
    const arq = p.roteiro || p.ultimoRascunho?.file;
    if (!arq) { preencher(p, null); continue; }
    baixarTexto(arq).then((txt) => {
      if (!ctx.ativo()) return;
      p.frontmatter = parseFrontmatterRoteiro(txt);
      preencher(p, p.frontmatter);
    }, () => { if (ctx.ativo()) preencher(p, null); });
  }
}
