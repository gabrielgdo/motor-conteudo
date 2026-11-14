// Tela Prontos: pacotes finais, legendas para copiar, downloads e botão "Postei".

import { el, chip, botao, icone, toast, modal, campo, linkExterno, iframeDrive, salvarBlob, copiarTexto } from '../ui.js';
import { classificarArquivoPacote, dataCurta, hojeISO, extrairFrontmatter, formatarDataHora } from '../parse.js';
import { baixarTexto, baixarBlob, linkDrive, invalidarCache } from '../drive.js';
import { marcarPostado } from '../sheet.js';
import { projetosComPacote } from '../model.js';

export async function render(ctx) {
  const id = ctx.params[0];
  return id ? detalhe(ctx, id) : lista(ctx);
}

function chipsPacote(p) {
  return [
    p.vencedor ? el('span', { class: 'chip chip-rose' }, icone('estrela', 'icone mini'), 'Vencedor') : null,
    p.postado ? chip(p.postado.data ? `Postado em ${dataCurta(p.postado.data)}` : 'Postado', 'verde') : chip('Para postar'),
  ];
}

/* --------------------------------------------------------------- lista */

async function lista(ctx) {
  ctx.titulo('Prontos');
  const { projetos, postadosErro } = await ctx.estado();
  if (!ctx.ativo()) return;
  const ps = projetosComPacote(projetos);
  if (!ps.length) {
    ctx.mostrar(el('div', { class: 'card vazio' }, el('p', {}, 'Nenhum pacote pronto ainda.'),
      el('p', { class: 'suave' }, 'Quando o motor finalizar um vídeo aprovado, o pacote aparece aqui.')));
    return;
  }
  ctx.mostrar(
    postadosErro ? el('p', { class: 'aviso' }, postadosErro) : null,
    el('div', { class: 'lista' }, ps.map((p) =>
      el('a', { href: `#/prontos/${encodeURIComponent(p.id)}`, class: 'card item-lista' },
        el('div', { class: 'item-principal' },
          el('div', { class: 'item-titulo' }, el('strong', {}, p.id), p.titulo ? ` · ${p.titulo}` : ''),
          el('div', { class: 'suave pequeno' }, `Pronto em ${formatarDataHora(p.pacote.folder.createdTime)}`)),
        el('div', { class: 'item-chips' }, p.teste ? chip('teste') : null, chipsPacote(p))))));
}

/* ------------------------------------------------------------- detalhe */

// Nome do arquivo no download: carrossel/01.png → carrossel-01.png
function nomeDownload(f) {
  return f.sub ? `${f.sub}-${f.name}` : f.name;
}

async function detalhe(ctx, id) {
  ctx.titulo(id);
  const { projetos } = await ctx.estado();
  if (!ctx.ativo()) return;
  const p = projetos.get(id);
  const voltar = el('a', { href: '#/prontos', class: 'voltar' }, icone('voltar'), 'Prontos');
  if (!p?.pacote) {
    ctx.mostrar(voltar, el('div', { class: 'card vazio' }, el('p', {}, `Não encontrei o pacote de ${id}.`)));
    return;
  }
  if (p.titulo) ctx.titulo(`${id} · ${p.titulo}`);

  // Blob URLs criados nesta tela são liberados ao sair.
  const urls = [];
  ctx.aoSair(() => urls.forEach((u) => URL.revokeObjectURL(u)));
  const imagemBlob = (arquivo, alt, classe) => {
    const img = el('img', { alt, class: classe, loading: 'lazy' });
    const box = el('div', { class: `${classe}-box carregando-img` }, img);
    const carregar = () => baixarBlob(arquivo.id).then((b) => {
      const u = URL.createObjectURL(b);
      urls.push(u);
      img.src = u;
      box.classList.remove('carregando-img');
    }, () => { box.classList.remove('carregando-img'); box.append(el('span', { class: 'suave pequeno' }, 'não carregou')); });
    // Carrega sob demanda quando aparecer na tela.
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver((entradas) => {
        if (entradas.some((e) => e.isIntersecting)) { obs.disconnect(); carregar(); }
      }, { rootMargin: '200px' });
      obs.observe(box);
      ctx.aoSair(() => obs.disconnect());
    } else carregar();
    return box;
  };

  const arquivos = p.pacote.files.map((f) => ({ ...f, ...classificarArquivoPacote(f.name, f.sub) }));
  const um = (tipo) => arquivos.find((f) => f.tipo === tipo) || null;
  const varios = (tipo) => arquivos.filter((f) => f.tipo === tipo).sort((a, b) => a.ordem - b.ordem || a.name.localeCompare(b.name));

  const videos = el('div', { class: 'videos-lado' },
    ...[['Instagram', um('ig')], ['TikTok', um('tt')]].map(([rotulo, f]) => el('div', { class: 'video-bloco' },
      el('h4', {}, rotulo),
      f ? iframeDrive(f.id, `${rotulo} – ${f.name}`) : el('div', { class: 'video-916 vazio-video' }, 'Sem vídeo'),
      f ? linkExterno('abrir no Drive', linkDrive(f)) : null)));

  const capas = [['Capa Instagram', um('capaIg')], ['Capa TikTok', um('capaTt')]].filter(([, f]) => f);
  const blocoCapas = capas.length
    ? el('section', { class: 'card' }, el('h3', {}, 'Capas'),
      el('div', { class: 'grade-capas' }, capas.map(([rotulo, f]) =>
        el('figure', {}, imagemBlob(f, rotulo, 'capa'), el('figcaption', { class: 'suave pequeno' }, rotulo)))))
    : null;

  const blocoTexto = (titulo, f) => {
    if (!f) return null;
    const pre = el('pre', { class: 'texto-pre' }, 'Carregando…');
    let texto = '';
    baixarTexto(f).then((t) => { texto = t; pre.textContent = t || '(vazio)'; }, () => { pre.textContent = 'Não foi possível carregar.'; });
    return el('section', { class: 'card bloco-texto' },
      el('div', { class: 'bloco-texto-topo' }, el('h3', {}, titulo),
        botao('Copiar', {
          tipo: 'contorno', icone: 'copiar',
          onclick: async () => toast(texto && (await copiarTexto(texto)) ? 'Copiado' : 'Não foi possível copiar', texto ? 'ok' : 'erro'),
        })),
      pre);
  };

  const grade = (titulo, tipo, classe) => {
    const fs = varios(tipo);
    if (!fs.length) return null;
    return el('section', { class: 'card' }, el('h3', {}, `${titulo} (${fs.length})`),
      el('div', { class: `grade-miniaturas ${classe}` }, fs.map((f) => imagemBlob(f, `${titulo} ${f.name}`, 'miniatura'))));
  };

  // Agenda sugerida + nota da aprovação
  const agenda = um('agenda');
  const blocoAgenda = el('section', { class: 'card' }, el('h3', {}, 'Quando postar'));
  if (agenda) {
    const pre = el('pre', { class: 'texto-pre' }, 'Carregando…');
    baixarTexto(agenda).then((t) => { pre.textContent = t; }, () => { pre.textContent = 'Não foi possível carregar.'; });
    blocoAgenda.append(pre);
  }
  const nota = el('p', {});
  if (p.aprovado) {
    baixarTexto(p.aprovado).then((t) => {
      const obs = extrairFrontmatter(t)?.observacoes;
      if (obs) nota.textContent = `Nota da aprovação: ${obs}`;
    }, () => {});
    blocoAgenda.append(nota);
  }
  if (!agenda && !p.aprovado) blocoAgenda.append(el('p', { class: 'suave' }, 'Sem sugestão de dia e horário para este pacote.'));
  else if (!agenda) blocoAgenda.append(el('p', { class: 'suave pequeno' }, 'Sem arquivo de agenda neste pacote.'));

  // Lista de arquivos com download
  const progressoTudo = el('span', { class: 'suave pequeno', role: 'status' });
  const ordenados = [...arquivos].sort((a, b) => (a.sub || '').localeCompare(b.sub || '') || a.name.localeCompare(b.name));
  const baixar = async (f) => salvarBlob(await baixarBlob(f.id), nomeDownload(f));
  const baixarTudoBtn = botao('Baixar tudo', {
    tipo: 'contorno', icone: 'baixar',
    onclick: async () => {
      baixarTudoBtn.disabled = true;
      let falhas = 0;
      for (let i = 0; i < ordenados.length; i++) {
        if (!ctx.ativo()) return;
        progressoTudo.textContent = `${i + 1} de ${ordenados.length}`;
        try { await baixar(ordenados[i]); } catch { falhas++; }
      }
      progressoTudo.textContent = falhas ? `Concluído, com ${falhas} ${falhas === 1 ? 'falha' : 'falhas'}.` : 'Concluído.';
      baixarTudoBtn.disabled = false;
    },
  });
  const blocoArquivos = el('section', { class: 'card' },
    el('div', { class: 'bloco-texto-topo' }, el('h3', {}, 'Arquivos'), el('div', { class: 'acoes-linha' }, progressoTudo, baixarTudoBtn)),
    el('ul', { class: 'lista-arquivos' }, ordenados.map((f) => {
      const b = botao('Baixar', { tipo: 'texto', icone: 'baixar' });
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await baixar(f); } catch (e) { toast(e?.message || 'Não foi possível baixar.', 'erro'); } finally { b.disabled = false; }
      });
      return el('li', {}, el('span', { class: 'nome-arquivo' }, nomeDownload(f)), b);
    })),
    linkExterno('Abrir pasta no Drive', linkDrive(p.pacote.folder)));

  // Postei
  const posteiBtn = p.postado
    ? botao(p.postado.data ? `Postado em ${dataCurta(p.postado.data)}` : 'Postado', { tipo: 'verde', icone: 'check', onclick: () => postei(ctx, p) })
    : botao('Postei', { tipo: 'principal', icone: 'check', onclick: () => postei(ctx, p) });
  posteiBtn.classList.add('btn-grande');

  ctx.mostrar(
    voltar,
    el('div', { class: 'cabecalho-detalhe' },
      el('h2', {}, p.titulo || p.id),
      el('div', { class: 'item-chips' }, el('span', { class: 'suave' }, p.id), p.teste ? chip('teste') : null, chipsPacote(p))),
    el('div', { class: 'acoes-decisao' }, posteiBtn),
    videos,
    blocoCapas,
    blocoAgenda,
    blocoTexto('Legenda Instagram', um('legendaIg')),
    blocoTexto('Legenda TikTok', um('legendaTt')),
    blocoTexto('Threads', um('threads')),
    grade('Carrossel', 'carrossel', 'carrossel'),
    grade('Stories', 'stories', 'stories'),
    blocoArquivos);
}

async function postei(ctx, p) {
  const data = el('input', { type: 'date', value: p.postado?.data || hojeISO(), max: '2100-12-31', required: true });
  const erro = el('p', { class: 'erro-texto', role: 'alert' });
  await modal({
    titulo: `Postei ${p.id}`,
    corpo: el('div', {}, campo('Data do post', data), erro),
    acoes: [
      { texto: 'Cancelar', tipo: 'texto', valor: false },
      {
        texto: 'Salvar', tipo: 'principal', valor: true,
        aoClicar: async () => {
          erro.textContent = '';
          if (!/^\d{4}-\d{2}-\d{2}$/.test(data.value)) { erro.textContent = 'Escolha a data do post.'; return false; }
          try {
            await marcarPostado(p.id, data.value);
          } catch (e) {
            erro.textContent = `Não foi possível gravar na planilha do Radar: ${e?.message || 'erro desconhecido'}`;
            return false;
          }
          toast(`Postado em ${dataCurta(data.value)}`);
          invalidarCache();
          ctx.recarregar();
          return true;
        },
      },
    ],
  });
}
