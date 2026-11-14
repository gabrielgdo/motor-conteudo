// VÍDEOS (#/videos e #/videos/<id>): as prévias do Instagram e do TikTok lado a lado, tocando os
// arquivos reais de 4-Revisao (componentes/players.js), a linha do tempo dos ajustes com a duração
// real e o painel de revisão. Aprovar e enviar ajustes pelo app chegam na etapa 2: a lista de
// ajustes funciona em memória e pode ser copiada para colar no chat do Diretor.

import { esc, ic, relogio, NOME_REDE } from '../util.js';
import { estado } from '../estado.js';
import { porEtapa, rot, ultima, anexo } from '../dados.js';
import { parseAjustes, segundosDoTempo } from '../parse.js';
import { Players } from '../componentes/players.js';
import { cab, selo, vt, passoDe, naoAchei, comDados, vazio, campo, segmento, rodapeAtualizado, voltar } from './pecas.js';

const enc = encodeURIComponent;
const SEM_VIDEO = ['rascunho', 'mudanca', 'recusado', 'aprovado', ''];

export function vVideos() {
  return `${cab('Vídeos', 'As prévias do Instagram e do TikTok, para aprovar ou pedir ajuste.')}
  ${comDados(() => {
    const revisar = porEtapa('previa'); const andando = porEtapa('recebido', 'ajustes', 'video-aprovado');
    const item = (r) => { const [texto, tom] = passoDe(r); const v = ultima(r); return `<li><a class="painel dupla luz" href="#/videos/${enc(r.id)}">
    <span class="mini" aria-hidden="true"><i></i><i></i></span>
    <span><span class="id">${esc(r.id)}</span><h3 ${vt(r.id)}>${esc(r.titulo)}</h3><span class="meta">${selo(texto, tom)}${r.teste ? selo('Teste') : ''}${v?.quando ? `<span class="apagado pequeno">chegou ${esc(v.quando)}</span>` : ''}</span></span></a></li>`; };
    return `
  <div class="pilha" style="gap:1.875rem">
    <section aria-labelledby="t-revisar"><h2 id="t-revisar" style="margin-bottom:.875rem">Para revisar</h2>
      ${revisar.length ? `<ul class="duplas">${revisar.map(item).join('')}</ul>` : `<div class="painel">${vazio('Nenhuma prévia esperando', 'Quando o motor terminar uma edição, as duas versões aparecem aqui.')}</div>`}</section>
    ${andando.length ? `<section aria-labelledby="t-andando"><h2 id="t-andando" style="margin-bottom:.875rem">Com o motor de edição</h2><ul class="duplas">${andando.map(item).join('')}</ul></section>` : ''}
  </div>
  ${rodapeAtualizado()}`;
  })}`;
}

/* ---- Ajustes ---- */

/** Ajustes que ela juntou nesta sessão, por roteiro e versão (só em memória nesta etapa). */
export function pendentesDe(r, v) {
  const chave = `${r.id} v${v ? v.n : 0}`;
  estado.pendentes ||= {};
  return (estado.pendentes[chave] ||= []);
}

/** Pedidos lidos de "<id> ajustes vN.md" da versão: {fase, lista}. */
function pedidosDoArquivo(v) {
  if (!v?.ajustes) return { fase: 'nenhum', lista: [] };
  const a = anexo(v.ajustes);
  if (a.fase !== 'pronto') return { fase: a.fase, lista: [] };
  return { fase: 'pronto', lista: parseAjustes(a.texto)?.ajustes || [] };
}

const textoPedido = (a) => `<strong>${NOME_REDE[a.versao] || NOME_REDE.ambas}${a.tempo ? `, em ${esc(a.tempo)}` : ''}:</strong> ${esc(a.pedido)}${a.como ? ` <span class="apagado">(${esc(a.como)})</span>` : ''}`;

function listaPedidos(pedidos) {
  if (pedidos.fase === 'carregando') return '<p class="apagado pequeno">Lendo o pedido de ajustes…</p>';
  if (pedidos.fase === 'erro') return `<p class="apagado pequeno">Não consegui ler o pedido de ajustes agora. <button type="button" class="discreto" data-acao="anexo-tentar">Tentar de novo</button></p>`;
  if (!pedidos.lista.length) return '';
  return `<ul class="pedidos">${pedidos.lista.map((a) => `<li><div>${textoPedido(a)}</div></li>`).join('')}</ul>`;
}

/* Linha do tempo: cada ajuste com momento marcado vira um pino na posição certa.
   D = a maior duração real entre IG e TT; antes de os vídeos dizerem a duração, só o trilho. */
function linhaDoTempo(v, pedidos) {
  const D = Math.max(Players.duracaoDe(v.ig), Players.duracaoDe(v.tt));
  const comMomento = pedidos.map((a) => ({ ...a, ...segundosDoTempo(a.tempo) })).filter((a) => a.de !== null);
  const pinos = D ? comMomento.filter((a) => a.de <= D) : [];
  const semMomento = pedidos.length - comMomento.length;
  const passo = D <= 90 ? 10 : D <= 300 ? 30 : 60;
  const marcas = []; if (D) for (let s = 0; s <= D; s += passo) marcas.push(s);
  const letra = { ig: 'IG', tt: 'TT', ambas: '2' };
  const pct = (s) => ((s / D) * 100).toFixed(1);
  const n = comMomento.length;
  return `<div class="tempo" id="linha-tempo" role="img" aria-label="Linha do tempo dos ajustes: ${n ? esc(comMomento.map((a) => `${a.tempo}, ${NOME_REDE[a.versao]}`).join('; ')) : 'nenhum ajuste marcado'}">
    <div class="tempo-topo"><span>Ajustes na linha do tempo</span><span>${n ? `${n} ${n === 1 ? 'marcado' : 'marcados'}${semMomento ? `, ${semMomento} sem momento` : ''}` : 'nenhum marcado ainda'}</span></div>
    <div class="tempo-trilho">
      ${marcas.map((s) => `<span class="tempo-marca" style="left:${pct(s)}%">${relogio(s)}</span>`).join('')}
      ${pinos.map((a) => `${a.ate ? `<span class="pino-faixa" style="left:${pct(a.de)}%;width:${((Math.max(0, Math.min(D, a.ate) - a.de) / D) * 100).toFixed(1)}%"></span>` : ''}<span class="pino ${a.versao}" style="left:${pct(a.de)}%" title="${esc(`${a.tempo}: ${a.pedido}`)}">${letra[a.versao]}</span>`).join('')}
    </div>
  </div>`;
}

/* ---- Painel de revisão ---- */

function resumoDoMotor(v) {
  if (!v?.notas) return '';
  const a = anexo(v.notas);
  if (a.fase === 'carregando') return '<p class="apagado pequeno">Lendo o resumo do motor…</p>';
  if (a.fase === 'erro') return `<p class="apagado pequeno">Não consegui ler o resumo do motor agora. <button type="button" class="discreto" data-acao="anexo-tentar">Tentar de novo</button></p>`;
  const texto = a.texto.trim();
  return texto ? `<div class="pequeno resumo-motor"><strong>Resumo do motor:</strong> ${esc(texto)}</div>` : '';
}

function painelRevisao(r, v, ehAtual) {
  const atual = ultima(r);
  if (v && !ehAtual) {
    const pedidos = pedidosDoArquivo(v);
    return `<section class="painel pilha ordem-2"><h2>Versão anterior</h2>
    <p class="nota calma">${ic('info')}<span>Você está vendo a v${v.n}. A atual é a v${atual.n}.</span></p>
    ${pedidos.fase !== 'nenhum' && (pedidos.lista.length || pedidos.fase !== 'pronto') ? `<div><h3 style="margin-bottom:.625rem">O que você pediu nesta versão</h3>${listaPedidos(pedidos)}</div>` : ''}
    <button type="button" class="botao contorno" data-acao="video-versao" data-id="${esc(r.id)}" data-valor="${atual.n}">Voltar para a v${atual.n}</button></section>`;
  }
  if (r.etapa === 'previa' && v) {
    const pend = pendentesDe(r, v);
    return `
    <section class="painel pilha ordem-2" aria-labelledby="t-aprovar"><h2 id="t-aprovar">Está bom assim?</h2>
      ${resumoDoMotor(v)}
      <p class="nota calma">${ic('info')}<span>Aprovar e enviar ajustes pelo app chega na próxima etapa. Por enquanto, mande ao Diretor no chat.</span></p>
    </section>
    <section class="painel pilha ordem-2" aria-labelledby="t-ajuste"><h2 id="t-ajuste">Pedir ajuste</h2>
      ${segmento('aj-versao', 'Em qual versão?', [['ig', 'Instagram'], ['tt', 'TikTok'], ['ambas', 'As duas']], 'ambas')}
      ${campo({ modelo: 'aj-tempo', rotulo: 'Em que momento', opcional: true, exemplo: '0:12 ou 0:12-0:15', dica: 'O botão embaixo de cada vídeo preenche este campo.' })}
      ${campo({ modelo: 'aj-pedido', rotulo: 'O que mudar', tipo: 'textarea', linhas: 2, exemplo: 'Ex.: tirar o zoom' })}
      ${campo({ modelo: 'aj-como', rotulo: 'Como você imagina', opcional: true, exemplo: 'Ex.: deixar o enquadramento parado' })}
      <button type="button" class="botao contorno" data-acao="ajuste-adicionar" data-id="${esc(r.id)}">Adicionar à lista</button>
      ${pend.length ? `<ul class="pedidos" aria-label="Ajustes na lista">${pend.map((a, i) => `<li><div>${textoPedido(a)}</div><button type="button" class="redondo" data-acao="ajuste-remover" data-id="${esc(r.id)}" data-valor="${i}" aria-label="Tirar este ajuste da lista">${ic('lixo', 18)}</button></li>`).join('')}</ul>
      <button type="button" class="botao primario cheio" data-acao="ajustes-copiar" data-id="${esc(r.id)}">${ic('copiar')} Copiar a lista</button>` : ''}
    </section>`;
  }
  const textos = {
    recebido: ['Gravação recebida', 'O motor está editando a primeira prévia. O Diretor avisa pelo Grok quando ela chegar.'],
    previa: ['Prévia a caminho', 'O motor ainda não entregou os vídeos desta prévia.'],
    ajustes: ['Ajustes enviados', `O motor está refazendo. A v${v ? v.n + 1 : 2} chega pelo aviso do Diretor.`],
    'video-aprovado': ['Vídeos aprovados', 'O motor está montando o pacote final: vídeos, capas, legendas, carrossel, Stories e Threads.'],
    pronto: ['Pacote pronto', 'Os arquivos finais estão em Prontos.'],
  }[r.etapa] || ['Com o motor', 'O Diretor avisa quando houver novidade.'];
  return `<section class="painel pilha ordem-2"><h2>${textos[0]}</h2><p>${textos[1]}</p>
    ${r.etapa === 'ajustes' && v ? listaPedidos(pedidosDoArquivo(v)) : ''}
    ${r.etapa === 'pronto' ? '<a class="botao primario" href="#/prontos">Abrir em Prontos</a>' : ''}
  </section>`;
}

/** Versão que está na tela (a escolhida nos chips, ou a atual). */
function versaoVista(r) {
  const versoes = r.video.versoes; const atual = ultima(r);
  const n = versoes.some((x) => x.n === estado.versaoVista[r.id]) ? estado.versaoVista[r.id] : atual?.n;
  const v = versoes.find((x) => x.n === n);
  return { v, atual, ehAtual: !v || v.n === atual.n };
}

/** Pinos da versão vista: a lista desta sessão (prévia atual) ou os pedidos do arquivo de ajustes. */
function pinosDe(r, v, ehAtual) {
  if (!v) return [];
  if (ehAtual && r.etapa === 'previa') return pendentesDe(r, v);
  return pedidosDoArquivo(v).lista;
}

/** HTML da linha do tempo da tela atual (o roteador refaz só ela quando chega a duração de um vídeo). */
export function linhaDoTempoAtual(id) {
  const r = rot(id);
  if (!r || SEM_VIDEO.includes(r.etapa)) return '';
  const { v, ehAtual } = versaoVista(r);
  return v ? linhaDoTempo(v, pinosDe(r, v, ehAtual)) : '';
}

export function vVideo(id) {
  return comDados(() => {
    const r = rot(id);
    if (!r || SEM_VIDEO.includes(r.etapa)) return `${voltar('videos', 'Vídeos')}${naoAchei('videos')}`;
    const versoes = r.video.versoes; const [texto, tom] = passoDe(r);
    const { v, atual, ehAtual } = versaoVista(r);
    const marcar = r.etapa === 'previa' && ehAtual;
    const player = (rede) => Players.html(`${r.id}-${rede}-v${v.n}`, rede, v[rede], { marcar });
    return `
  ${voltar('videos', 'Vídeos')}
  ${cab(r.titulo, '', r.id)}
  <div class="meta" style="margin:-.875rem 0 1.625rem">${selo(texto, tom)}${r.teste ? selo('Teste') : ''}</div>
  <div class="revisao">
    <div class="revisao-a">
      ${v ? `<section class="painel palco ordem-1" aria-label="Vídeos da versão ${v.n}">
        ${versoes.length > 1 ? `<div class="versoes" role="group" aria-label="Escolher a versão"><span class="pequeno apagado">Versão</span>${versoes.map((x) => `<button type="button" class="chip" data-acao="video-versao" data-id="${esc(r.id)}" data-valor="${x.n}" aria-pressed="${x.n === v.n}">v${x.n}${x.n === atual.n ? ' (atual)' : ''}</button>`).join('')}</div>` : ''}
        <div class="players">${player('ig')}${player('tt')}</div>
        ${linhaDoTempo(v, pinosDe(r, v, ehAtual))}
      </section>` : ''}
      ${r.video.historico.length ? `<section class="painel ordem-3" aria-labelledby="t-historia"><h2 id="t-historia">Histórico</h2>
        <ol class="historia">${r.video.historico.map(([quando, t]) => `<li><time>${esc(quando)}</time>${esc(t)}</li>`).join('')}</ol></section>` : ''}
    </div>
    <div class="revisao-b">${painelRevisao(r, v, ehAtual)}</div>
  </div>
  ${rodapeAtualizado()}`;
  });
}
