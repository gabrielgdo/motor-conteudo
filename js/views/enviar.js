// Tela Enviar gravação: escolher roteiro aprovado sem bruto → escolher arquivo → upload resumível.

import { el, chip, botao, icone, toast, confirmar, limpar, anexar } from '../ui.js';
import { formatarBytes, ehVideo, nomeBruto, parseBruto } from '../parse.js';
import { listar, pastas, invalidarCache } from '../drive.js';
import { aprovadosSemBruto } from '../model.js';
import { criarUpload, formatarDuracao, chaveSessao, sessaoValida } from '../upload.js';

const ACCEPT = 'video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v';

export async function render(ctx) {
  ctx.titulo('Enviar gravação');
  const { projetos } = await ctx.estado();
  if (!ctx.ativo()) return;
  const candidatos = aprovadosSemBruto(projetos);
  const idParam = ctx.params[0];
  const escolhido = idParam ? candidatos.find((p) => p.id === idParam) : null;

  if (idParam && !escolhido) {
    ctx.mostrar(voltar(), el('div', { class: 'card vazio' },
      el('p', {}, `${idParam} não está na lista de roteiros aprovados aguardando gravação.`),
      el('p', { class: 'suave' }, 'Talvez a gravação já tenha sido enviada, ou o roteiro ainda não foi aprovado.'),
      el('a', { href: '#/enviar', class: 'btn btn-contorno' }, 'Ver roteiros disponíveis')));
    return;
  }
  if (escolhido) { passoArquivo(ctx, escolhido); return; }

  // Passo 1
  if (!candidatos.length) {
    ctx.mostrar(voltar(), el('div', { class: 'card vazio' },
      el('h3', {}, 'Nenhum roteiro aguardando gravação'),
      el('p', {}, 'Aparecem aqui os roteiros já aprovados que ainda não têm gravação, prévia ou pacote.'),
      botao('Enviar mesmo assim, sem roteiro', { tipo: 'contorno', disabled: true }),
      el('p', { class: 'suave pequeno' }, 'Enviar sem roteiro vai ficar disponível numa próxima etapa.')));
    return;
  }
  ctx.mostrar(voltar(),
    el('p', { class: 'passo' }, 'Passo 1 de 2 · Qual roteiro você gravou?'),
    el('div', { class: 'lista' }, candidatos.map((p) =>
      el('a', { href: `#/enviar/${encodeURIComponent(p.id)}`, class: 'card item-lista' },
        el('div', { class: 'item-principal' },
          el('div', { class: 'item-titulo' }, el('strong', {}, p.id), p.titulo ? ` · ${p.titulo}` : '')),
        el('div', { class: 'item-chips' }, p.teste ? chip('teste') : null)))));
}

function voltar(href = '#/inicio', texto = 'Início') {
  return el('a', { href, class: 'voltar' }, icone('voltar'), texto);
}

function passoArquivo(ctx, p) {
  const input = el('input', { type: 'file', accept: ACCEPT, class: 'input-arquivo', id: 'arquivo-video' });
  const info = el('div', { class: 'arquivo-info' });
  const erro = el('p', { class: 'erro-texto', role: 'alert' });
  const iniciarBtn = botao('Enviar gravação', { tipo: 'principal', icone: 'enviar', disabled: true });
  iniciarBtn.classList.add('btn-grande', 'btn-largo');
  let arquivo = null;

  input.addEventListener('change', () => {
    erro.textContent = '';
    limpar(info);
    arquivo = input.files?.[0] || null;
    iniciarBtn.disabled = true;
    if (!arquivo) return;
    if (!ehVideo(arquivo.name)) {
      erro.textContent = 'Escolha um vídeo .mp4, .mov ou .m4v.';
      arquivo = null;
      return;
    }
    let salva = null;
    try { salva = JSON.parse(localStorage.getItem(chaveSessao(p.id, arquivo)) || 'null'); } catch { /* ignore */ }
    anexar(info,
      el('dl', { class: 'mini-dados' },
        el('dt', {}, 'Arquivo'), el('dd', {}, arquivo.name),
        el('dt', {}, 'Tamanho'), el('dd', {}, formatarBytes(arquivo.size)),
        el('dt', {}, 'Nome no Drive'), el('dd', {}, nomeBruto(p.id, arquivo.name))),
      sessaoValida(salva) ? el('p', { class: 'aviso' }, 'Encontrei um envio interrompido deste arquivo — ele continua de onde parou.') : null);
    iniciarBtn.disabled = false;
  });

  iniciarBtn.addEventListener('click', async () => {
    if (!arquivo) return;
    iniciarBtn.disabled = true;
    erro.textContent = '';
    try {
      const ids = await pastas();
      const brutos = await listar(ids.brutos);
      if (brutos.some((f) => parseBruto(f.name)?.id === p.id)) {
        erro.textContent = `Já existe uma gravação de ${p.id} em 3-Brutos. Não vou enviar outra por cima.`;
        return;
      }
      if (!ctx.ativo()) return;
      telaUpload(ctx, p, arquivo, ids.brutos);
    } catch (e) {
      erro.textContent = e?.message || 'Não foi possível conferir a pasta 3-Brutos.';
      iniciarBtn.disabled = false;
    }
  });

  ctx.titulo(`Enviar · ${p.id}`);
  ctx.mostrar(voltar('#/enviar', 'Roteiros'),
    el('p', { class: 'passo' }, 'Passo 2 de 2 · Escolha o vídeo'),
    el('div', { class: 'card' },
      el('h3', {}, p.id, p.titulo ? ` · ${p.titulo}` : ''),
      el('label', { for: 'arquivo-video', class: 'btn btn-contorno btn-largo seletor-arquivo' }, icone('videos'), el('span', {}, 'Escolher vídeo')),
      input,
      info,
      erro,
      el('p', { class: 'aviso' }, 'Mantenha o app aberto e a tela ligada até terminar.'),
      iniciarBtn));
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',');
}

function telaUpload(ctx, p, arquivo, pastaBrutos) {
  const nome = nomeBruto(p.id, arquivo.name);
  const barra = el('div', { class: 'barra-cheia', style: { width: '0%' } });
  const pct = el('span', { class: 'upload-pct' }, '0%');
  const detalhes = el('p', { class: 'suave' }, `0 de ${mb(arquivo.size)} MB`);
  const vel = el('p', { class: 'suave pequeno' }, '');
  const status = el('p', { class: 'upload-status', role: 'status', 'aria-live': 'polite' }, 'Preparando…');
  const pausarBtn = botao('Pausar', { tipo: 'contorno', icone: 'pausar' });
  const cancelarBtn = botao('Cancelar', { tipo: 'texto' });
  let wakeLock = null;

  const pedirWakeLock = async () => {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch { wakeLock = null; }
  };
  const aoVisivel = () => { if (document.visibilityState === 'visible' && up.emAndamento()) pedirWakeLock(); };
  const soltar = () => {
    document.removeEventListener('visibilitychange', aoVisivel);
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
  };

  const up = criarUpload({
    arquivo, id: p.id, nome, pastaId: pastaBrutos,
    aoProgresso: ({ enviados, total, velocidade, restante }) => {
      const pc = total ? Math.floor((enviados / total) * 100) : 0;
      barra.style.width = `${pc}%`;
      pct.textContent = `${pc}%`;
      detalhes.textContent = `${mb(enviados)} de ${mb(total)} MB`;
      vel.textContent = velocidade ? `${mb(velocidade)} MB/s · faltam ${formatarDuracao(restante)}` : '';
    },
    aoEstado: (estado, msg) => {
      const textos = {
        iniciando: 'Preparando o envio…',
        enviando: 'Enviando…',
        pausado: 'Pausado.',
        'aguardando-rede': msg,
        reiniciando: msg,
        concluido: 'Concluído.',
        cancelado: 'Envio cancelado.',
        erro: msg,
      };
      status.textContent = textos[estado] || '';
      status.classList.toggle('erro-texto', estado === 'erro');
    },
  });

  pausarBtn.addEventListener('click', () => {
    if (pausarBtn.dataset.pausado) {
      delete pausarBtn.dataset.pausado;
      pausarBtn.lastChild.textContent = 'Pausar';
      up.continuar();
    } else {
      pausarBtn.dataset.pausado = '1';
      pausarBtn.lastChild.textContent = 'Continuar';
      up.pausar();
    }
  });
  cancelarBtn.addEventListener('click', async () => {
    if (await confirmar('Cancelar envio?', 'O que já foi enviado será descartado.', { sim: 'Cancelar envio', nao: 'Continuar enviando' })) up.cancelar();
  });

  ctx.protegerSaida(() => (up.emAndamento() ? 'O envio da gravação ainda está em andamento. Sair agora interrompe o envio.' : null));
  ctx.aoSair(() => { if (up.emAndamento()) up.cancelar(); soltar(); });
  document.addEventListener('visibilitychange', aoVisivel);

  ctx.mostrar(
    el('div', { class: 'card upload' },
      el('h3', {}, nome),
      el('p', { class: 'aviso' }, 'Mantenha o app aberto e a tela ligada até terminar.'),
      el('div', { class: 'upload-topo' }, pct, detalhes),
      el('div', { class: 'barra grande' }, barra),
      vel,
      status,
      el('div', { class: 'acoes-form' }, cancelarBtn, pausarBtn)));

  pedirWakeLock();
  up.iniciar().then(() => {
    soltar();
    ctx.protegerSaida(null);
    invalidarCache();
    if (!ctx.ativo()) { toast('Gravação enviada.'); return; }
    ctx.mostrar(el('div', { class: 'card sucesso' },
      icone('check', 'icone grande'),
      el('h2', {}, 'Gravação enviada.'),
      el('p', {}, 'O motor vai começar a edição em alguns minutos.'),
      el('a', { href: '#/inicio', class: 'btn btn-claro' }, 'Voltar ao início')));
  }, (e) => {
    soltar();
    ctx.protegerSaida(null);
    if (e?.tipo === 'cancelado') {
      if (ctx.ativo()) ctx.mostrar(el('div', { class: 'card vazio' }, el('p', {}, 'Envio cancelado.'),
        el('a', { href: `#/enviar/${encodeURIComponent(p.id)}`, class: 'btn btn-contorno' }, 'Escolher o vídeo de novo')));
      return;
    }
    pausarBtn.disabled = true;
    cancelarBtn.disabled = true;
    status.textContent = `Não foi possível enviar: ${e?.message || 'erro desconhecido'}`;
    status.after(botao('Tentar de novo', { tipo: 'contorno', icone: 'atualizar', onclick: () => ctx.recarregar() }));
  });
}
