// Peças de tela usadas por várias telas (como na seção 5 do desenho aprovado). Todo texto de dado passa por esc().

import { esc, ic, quando, hrefSeguro } from '../util.js';
import { estado, rascunho } from '../estado.js';
import { Integra } from '../integra.js';
import { ultima, postouTudo, estadoDados } from '../dados.js';
import { estadoDosGanchos } from '../ganchos.js';
import { estadoDoStoryboard } from '../storyboard.js';

/* nomeVT liga o título de uma lista ao título do detalhe: na troca de tela, um vira o outro. */
export const vt = (id) => `style="view-transition-name:t-${esc(String(id).replace(/[^\w-]/g, '_'))}"`;
export const cab = (titulo, sub = '', id = '') => `<header class="cab">${id ? `<span class="id">${esc(id)}</span>` : ''}<h1 ${id ? vt(id) : ''}>${esc(titulo)}</h1>${sub ? `<p class="cab-sub">${sub}</p>` : ''}</header>`;
export const selo = (texto, tom = 'neutro') => `<span class="selo ${tom}">${esc(texto)}</span>`;
/** `texto` e `botao` são HTML já montado (escape antes de passar dados). */
export const vazio = (titulo, texto, botao = '') => `<div class="vazio"><strong>${esc(titulo)}</strong><p>${texto}</p>${botao ? `<p style="margin-top:.875rem">${botao}</p>` : ''}</div>`;
export const naoAchei = (volta) => `<div class="painel">${vazio('Não encontrei este item', 'Ele pode ter mudado de etapa ou saído do Drive.', `<a class="botao contorno" href="#/${volta}">Voltar</a>`)}</div>`;
export const chipFiltro = (grupo, valor, rotulo, atual) => `<button type="button" class="chip" data-acao="filtro" data-grupo="${grupo}" data-valor="${valor}" aria-pressed="${atual === valor}">${esc(rotulo)}</button>`;

/* Em que pé está cada roteiro: o texto do selo e para onde o clique leva */
export function passoDe(r) {
  switch (r.etapa) {
    case 'ganchos': {
      const g = estadoDosGanchos(r, { local: estado.ganchosEnviados?.[r.id] || null });
      return [g.estado === 'sem-texto' ? 'Escolher o gancho' : g.texto, g.estado === 'escolher' || g.estado === 'sem-texto' ? 'acao' : g.tom];
    }
    case 'rascunho': return [`Aprovar o rascunho v${r.versaoRoteiro}`, 'acao'];
    case 'mudanca': return ['Com o Roteirista', 'espera'];
    case 'aprovado': return ['Falta gravar', 'acao'];
    case 'recebido': return ['Em edição', 'espera'];
    case 'storyboard': {
      const s = estadoDoStoryboard(r, { local: estado.storyboardsEnviados?.[r.id] || null });
      if (s.estado === 'decidir') return [s.texto, 'acao'];
      if (s.estado === 'sem-texto') return ['Ver o storyboard', 'acao'];
      return [s.estado === 'ajustar' ? 'Storyboard em ajuste' : 'Renderizando as prévias', s.tom];
    }
    case 'previa': return [`Revisar a prévia v${ultima(r).n}`, 'acao'];
    case 'ajustes': return ['Ajustes na edição', 'espera'];
    case 'video-aprovado': return ['Montando o pacote', 'espera'];
    case 'pronto':
      if (!r.pacote?.postadoConhecido) return ['Pacote pronto', 'ok'];
      return postouTudo(r) ? ['Postado', 'ok'] : ['Pronto para postar', 'acao'];
    default: return ['Recusado', 'neutro'];
  }
}
export const destinoDe = (r) => (['ganchos', 'rascunho', 'mudanca', 'aprovado', 'recusado'].includes(r.etapa) ? `#/roteiros/${encodeURIComponent(r.id)}` : r.etapa === 'pronto' ? '#/prontos' : `#/videos/${encodeURIComponent(r.id)}`);

/* Campo de formulário com rótulo, dica e erro ligados por id (acessível a leitores de tela) */
export function campo(o) {
  const id = 'c-' + o.modelo;
  const erro = estado.erros[o.modelo];
  const valor = rascunho[o.modelo] ?? o.valor ?? '';
  const attrs = `id="${id}" data-modelo="${o.modelo}" ${erro ? `aria-invalid="true" aria-describedby="${id}-erro"` : o.dica ? `aria-describedby="${id}-dica"` : ''} ${o.attrs || ''}`;
  let controle;
  if (o.tipo === 'textarea') controle = `<textarea ${attrs} rows="${o.linhas || 3}" placeholder="${esc(o.exemplo || '')}">${esc(valor)}</textarea>`;
  else if (o.tipo === 'select') controle = `<select ${attrs}>${o.opcoes.map(([v, r]) => `<option value="${esc(v)}" ${String(v) === String(valor) ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>`;
  else controle = `<input ${attrs} type="${o.tipo || 'text'}" value="${esc(valor)}" placeholder="${esc(o.exemplo || '')}">`;
  return `<div class="campo"><label for="${id}">${esc(o.rotulo)}${o.opcional ? ' <span class="opc">(opcional)</span>' : ''}</label>${controle}${o.dica ? `<p class="dica" id="${id}-dica">${esc(o.dica)}</p>` : ''}${erro ? `<p class="erro" id="${id}-erro">${esc(erro)}</p>` : ''}</div>`;
}
export function segmento(modelo, legenda, opcoes, padrao) {
  const atual = rascunho[modelo] ?? (rascunho[modelo] = padrao);
  return `<fieldset class="segmento"><legend>${esc(legenda)}</legend><div class="segmento-opcoes">${opcoes.map(([v, r]) =>
    `<label><input type="radio" name="${modelo}" data-modelo="${modelo}" value="${esc(v)}" ${atual === v ? 'checked' : ''}><span>${esc(r)}</span></label>`).join('')}</div></fieldset>`;
}

/* ---- Estados de carregamento e erro ---- */

/** Mensagem de erro amigável para uma falha ao ler o Drive. */
export function mensagemErro(erro) {
  if (estadoDados().offline) return 'Sem internet. Assim que a conexão voltar, o app tenta de novo sozinho.';
  return esc(erro?.message || 'O Google Drive não respondeu agora.');
}

export const painelErro = (erro, titulo = 'Não consegui ler o Drive') => `<div class="painel" role="alert">${vazio(titulo, mensagemErro(erro), `<button type="button" class="botao contorno" data-acao="atualizar">${ic('atualizar', 18)} Tentar de novo</button>`)}</div>`;

export const painelCarregando = (texto = 'Lendo o Drive…') => `<div class="painel" aria-busy="true"><div class="pilha" style="gap:.75rem"><span class="vh">${esc(texto)}</span><span class="esq titulo" style="width:45%"></span><span class="esq linha" style="width:85%"></span><span class="esq linha" style="width:65%"></span></div></div>`;

/** Desenha `fn()` quando há dados; senão, o painel de carregando ou o de erro. */
export function comDados(fn) {
  const { fase, erro } = estadoDados();
  if (fase === 'erro') return painelErro(erro);
  if (fase === 'carregando' || fase === 'vazio') return painelCarregando();
  return fn();
}

/** Link https para um arquivo/pasta do Drive (abre fora do app), ou ''. */
export function linkDoDrive(arquivo, texto = 'Abrir no Drive') {
  const href = hrefSeguro(Integra.linkDrive(arquivo));
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(texto)}</a>` : '';
}

/** Link "voltar" do topo dos detalhes. */
export const voltar = (rota, rotulo) => `<a class="voltar" href="#/${rota}">${ic('voltar', 18)} ${esc(rotulo)}</a>`;

/** Rodapé discreto: quando os dados foram lidos, com o botão de atualizar. */
export function rodapeAtualizado() {
  const e = estadoDados();
  if (!e.carregadoEm) return '';
  const texto = `Lido do Drive ${quando(e.carregadoEm)}.`;
  return `<p class="origem">${ic('info', 16)}<span>${esc(texto)}${e.postadosLidos ? '' : ' A planilha Radar não respondeu, então o que já foi postado não aparece.'} <button type="button" class="discreto" data-acao="atualizar">Atualizar agora</button></span></p>`;
}
