// Tela Vídeos: lista de prévias e detalhe com aprovação / pedido de ajustes.

import {
  el, chip, botao, icone, toast, modal, campo, linkExterno, iframeDrive, markdownSeguro, limpar,
} from '../ui.js';
import { REVISAO_FOLDER } from '../config.js';
import { formatarDataHora, gerarAprovacao, gerarAjustes, VERSOES_AJUSTE } from '../parse.js';
import { baixarTexto, listar, criarArquivoTexto, linkDrive, invalidarCache } from '../drive.js';
import { projetosComPrevia, estadoVideo, ehPreviaNova, historico } from '../model.js';

const CHIP_ESTADO = {
  nova: ['nova', 'rose'],
  ajustes: ['ajustes pedidos', ''],
  aprovado: ['aprovado', 'verde'],
};

function chipEstado(p) {
  const e = estadoVideo(p);
  return e ? chip(...CHIP_ESTADO[e]) : null;
}

export async function render(ctx) {
  const id = ctx.params[0];
  return id ? detalhe(ctx, id) : lista(ctx);
}

/* --------------------------------------------------------------- lista */

async function lista(ctx) {
  ctx.titulo('Vídeos');
  const { projetos } = await ctx.estado();
  if (!ctx.ativo()) return;
  const ps = projetosComPrevia(projetos);
  if (!ps.length) {
    ctx.mostrar(el('div', { class: 'card vazio' }, el('p', {}, 'Ainda não há prévias em 4-Revisao.'),
      el('p', { class: 'suave' }, 'Quando o motor terminar uma edição, ela aparece aqui.')));
    return;
  }
  ctx.mostrar(el('div', { class: 'lista' }, ps.map((p) => {
    const v = p.previas.versoes[p.previas.versoes.length - 1];
    return el('a', { href: `#/videos/${encodeURIComponent(p.id)}`, class: 'card item-lista' },
      el('div', { class: 'item-principal' },
        el('div', { class: 'item-titulo' }, el('strong', {}, p.id), p.titulo ? ` · ${p.titulo}` : ''),
        el('div', { class: 'suave pequeno' }, `v${v.v} · ${formatarDataHora(v.created)} · ${p.etapa}`)),
      el('div', { class: 'item-chips' }, p.teste ? chip('teste') : null, chipEstado(p)));
  })));
}

/* ------------------------------------------------------------- detalhe */

async function detalhe(ctx, id) {
  ctx.titulo(id);
  const { projetos } = await ctx.estado();
  if (!ctx.ativo()) return;
  const p = projetos.get(id);
  const voltar = el('a', { href: '#/videos', class: 'voltar' }, icone('voltar'), 'Vídeos');

  if (!p || !p.previas.versoes.length) {
    ctx.mostrar(voltar, el('div', { class: 'card vazio' },
      el('p', {}, p ? `${id} ainda não tem prévia em 4-Revisao.` : `Não encontrei o vídeo ${id}.`),
      p ? el('p', { class: 'suave' }, `Etapa: ${p.etapa || '—'}`) : null));
    return;
  }
  if (p.titulo) ctx.titulo(`${id} · ${p.titulo}`);

  let selecionada = p.previas.atual;
  const area = el('div');

  const seletor = el('div', { class: 'segmentado', role: 'tablist', 'aria-label': 'Versão' });
  const desenharSeletor = () => {
    limpar(seletor).append(...p.previas.versoes.map((v) =>
      el('button', {
        type: 'button', role: 'tab', class: v.v === selecionada ? 'ativo' : '', 'aria-selected': String(v.v === selecionada),
        onclick: () => { selecionada = v.v; desenharSeletor(); desenharVersao(); },
      }, `v${v.v}`)));
  };
  const desenharVersao = () => limpar(area).append(versaoView(ctx, p, p.previas.versoes.find((v) => v.v === selecionada)));
  desenharSeletor();
  desenharVersao();

  ctx.mostrar(
    voltar,
    el('div', { class: 'cabecalho-detalhe' },
      el('h2', {}, p.titulo || p.id),
      el('div', { class: 'item-chips' }, el('span', { class: 'suave' }, p.id), p.teste ? chip('teste') : null, chipEstado(p)),
      p.previas.versoes.length > 1 ? seletor : null),
    area,
    historicoView(p));
}

function blocoVideo(rotulo, arquivo) {
  return el('div', { class: 'video-bloco' },
    el('h4', {}, rotulo),
    arquivo ? iframeDrive(arquivo.id, `${rotulo} – ${arquivo.name}`) : el('div', { class: 'video-916 vazio-video' }, 'Sem vídeo nesta versão'),
    arquivo ? linkExterno('abrir no Drive', linkDrive(arquivo)) : null);
}

function versaoView(ctx, p, v) {
  const ehAtual = v.v === p.previas.atual;
  const podeDecidir = ehAtual && ehPreviaNova(p);

  const notas = el('div', { class: 'card notas' }, el('h3', {}, 'Resumo das mudanças'));
  if (v.notas) {
    const corpo = el('p', { class: 'suave' }, 'Carregando…');
    notas.append(corpo);
    baixarTexto(v.notas).then((txt) => {
      corpo.replaceWith(txt.trim() ? markdownSeguro(txt) : el('p', { class: 'suave' }, 'Sem resumo para esta versão'));
    }, () => corpo.replaceWith(el('p', { class: 'suave' }, 'Não foi possível carregar o resumo.')));
  } else {
    notas.append(el('p', { class: 'suave' }, 'Sem resumo para esta versão'));
  }

  const storyboards = [v.sbIg && linkExterno('Storyboard IG', linkDrive(v.sbIg)), v.sbTt && linkExterno('Storyboard TT', linkDrive(v.sbTt))].filter(Boolean);

  const acoes = el('div', { class: 'acoes-decisao' });
  const areaAjuste = el('div');
  if (podeDecidir) {
    acoes.append(
      botao('Aprovar os dois', { tipo: 'principal', icone: 'check', onclick: () => aprovar(ctx, p, v.v) }),
      botao('Pedir ajuste', {
        tipo: 'contorno',
        onclick: () => {
          if (areaAjuste.firstChild) { limpar(areaAjuste); return; }
          areaAjuste.append(formularioAjustes(ctx, p, v.v, () => limpar(areaAjuste)));
          areaAjuste.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      }));
  } else {
    acoes.append(el('p', { class: 'suave' }, ehAtual ? `Etapa: ${p.etapa}` : `Versão anterior (v${v.v}) — só leitura.`));
  }

  return el('div', {},
    el('div', { class: 'videos-lado' }, blocoVideo('Instagram', v.ig), blocoVideo('TikTok', v.tt)),
    storyboards.length ? el('div', { class: 'links-linha' }, storyboards) : null,
    notas,
    acoes,
    areaAjuste);
}

/* ------------------------------------------------------------ ações */

// Confere no Drive (sem cache) se o arquivo já existe em 4-Revisao.
async function existeEmRevisao(nome) {
  const arquivos = await listar(REVISAO_FOLDER);
  return arquivos.some((f) => f.name.trim().toLowerCase() === nome.toLowerCase());
}

async function aprovar(ctx, p, versao) {
  const obs = el('textarea', { rows: '3', placeholder: 'Ex.: postar na quinta' });
  const erro = el('p', { class: 'erro-texto', role: 'alert' });
  await modal({
    titulo: 'Aprovar',
    corpo: el('div', {}, el('p', {}, `Aprovar a versão v${versao} do IG e do TT?`), campo('Observações (opcional)', obs), erro),
    acoes: [
      { texto: 'Cancelar', tipo: 'texto', valor: false },
      {
        texto: 'Aprovar', tipo: 'principal', valor: true,
        aoClicar: async () => {
          const nome = `${p.id} aprovado.md`;
          try {
            if (await existeEmRevisao(nome)) { erro.textContent = 'Este vídeo já foi aprovado.'; return false; }
            await criarArquivoTexto(nome, gerarAprovacao({ id: p.id, versao, observacoes: obs.value }), REVISAO_FOLDER);
          } catch (e) {
            erro.textContent = e?.message || 'Não foi possível enviar. Tente de novo.';
            return false;
          }
          toast('Enviado ao motor');
          invalidarCache();
          ctx.recarregar();
          return true;
        },
      },
    ],
  });
}

function formularioAjustes(ctx, p, versao, fechar) {
  const itens = [];
  const listaItens = el('div', { class: 'ajustes-itens' });
  const obs = el('textarea', { rows: '3', placeholder: 'Algo mais que o motor deve saber (opcional)' });
  const erro = el('p', { class: 'erro-texto', role: 'alert' });
  let contador = 0;

  const renumerar = () => itens.forEach((it, i) => {
    it.numero.textContent = `Ajuste ${i + 1}`;
    it.remover.hidden = itens.length === 1;
  });

  const adicionar = () => {
    const n = ++contador;
    let versaoEscolhida = 'ambas';
    const seg = el('div', { class: 'segmentado', role: 'radiogroup', 'aria-label': 'Versão' });
    const opcoes = { ig: 'IG', tt: 'TT', ambas: 'Ambas' };
    const desenharSeg = () => limpar(seg).append(...VERSOES_AJUSTE.map((v) => el('button', {
      type: 'button', role: 'radio', class: v === versaoEscolhida ? 'ativo' : '', 'aria-checked': String(v === versaoEscolhida),
      onclick: () => { versaoEscolhida = v; desenharSeg(); },
    }, opcoes[v])));
    desenharSeg();
    const tempo = el('input', { type: 'text', placeholder: '0:00-0:03', inputmode: 'text', autocomplete: 'off' });
    const pedido = el('textarea', { rows: '2', required: true, id: `ajuste-pedido-${n}` });
    const como = el('textarea', { rows: '2' });
    const numero = el('h4', {});
    const item = {
      numero,
      pedido,
      ler: () => ({ versao: versaoEscolhida, tempo: tempo.value, pedido: pedido.value, como: como.value }),
    };
    item.remover = el('button', {
      type: 'button', class: 'btn-icone', 'aria-label': 'Remover ajuste',
      onclick: () => { itens.splice(itens.indexOf(item), 1); item.no.remove(); renumerar(); },
    }, icone('fechar'));
    item.no = el('div', { class: 'ajuste-item card' },
      el('div', { class: 'ajuste-topo' }, numero, item.remover),
      campo('Versão', seg),
      campo('Momento (opcional)', tempo),
      campo('O que mudar', pedido),
      campo('Como (opcional)', como));
    itens.push(item);
    listaItens.append(item.no);
    renumerar();
  };
  adicionar();

  const enviarBtn = botao('Enviar ao motor', { tipo: 'principal' });
  enviarBtn.addEventListener('click', async () => {
    erro.textContent = '';
    const ajustes = itens.map((i) => i.ler());
    const vazio = itens.find((i) => !i.pedido.value.trim());
    if (vazio) { erro.textContent = 'Diga o que mudar em cada ajuste.'; vazio.pedido.focus(); return; }
    const nome = `${p.id} ajustes v${versao}.md`;
    enviarBtn.disabled = true;
    try {
      const conteudo = gerarAjustes({ id: p.id, versaoBase: versao, ajustes, observacoes: obs.value });
      if (await existeEmRevisao(nome)) { erro.textContent = `Já existe um pedido de ajustes para a v${versao}.`; return; }
      await criarArquivoTexto(nome, conteudo, REVISAO_FOLDER);
      toast('Enviado ao motor');
      invalidarCache();
      ctx.recarregar();
    } catch (e) {
      erro.textContent = e?.message || 'Não foi possível enviar. Tente de novo.';
    } finally {
      enviarBtn.disabled = false;
    }
  });

  return el('section', { class: 'card form-ajustes' },
    el('h3', {}, `Pedir ajuste na v${versao}`),
    listaItens,
    botao('+ outro ajuste', { tipo: 'texto', onclick: adicionar }),
    campo('Observações', obs),
    erro,
    el('div', { class: 'acoes-form' }, botao('Cancelar', { tipo: 'texto', onclick: fechar }), enviarBtn));
}

/* ------------------------------------------------------------ histórico */

function historicoView(p) {
  const ev = historico(p);
  if (!ev.length) return null;
  return el('section', { class: 'card historico' },
    el('h3', {}, 'Histórico'),
    el('ol', { class: 'linha-tempo' }, ev.map((e) =>
      el('li', {}, el('span', { class: 'quando' }, formatarDataHora(e.quando)), el('span', {}, e.texto)))));
}

