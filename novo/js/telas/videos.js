// VÍDEOS (lista e detalhe). Provisória nesta parte: os players lado a lado, a linha do tempo dos
// ajustes e a decisão chegam na parte 2 (componentes/players.js já está pronto para isso).

import { esc } from '../util.js';
import { porEtapa, rot, ultima } from '../dados.js';
import { cab, selo, passoDe, naoAchei, comDados, linkDoDrive, emPreparo, vazio, rodapeAtualizado, voltar, gradeSimples } from './pecas.js';

export function vVideos() {
  return `${cab('Vídeos', 'As prévias do Instagram e do TikTok, para aprovar ou pedir ajuste.')}
  ${comDados(() => {
    const lista = porEtapa('previa', 'recebido', 'ajustes', 'video-aprovado');
    return `${emPreparo('Os players das prévias, lado a lado, chegam na próxima atualização do app. Por enquanto, as prévias abrem no Drive.')}
    ${lista.length ? gradeSimples(lista, (r) => { const v = ultima(r); return v ? `<p class="pequeno apagado">v${v.n}, chegou ${esc(v.quando)}</p>` : ''; })
      : `<div class="painel">${vazio('Nenhuma prévia esperando', 'Quando o motor terminar uma edição, as duas versões aparecem aqui.')}</div>`}
    ${rodapeAtualizado()}`;
  })}`;
}

export function vVideo(id) {
  return comDados(() => {
    const r = rot(id);
    if (!r || ['rascunho', 'mudanca', 'recusado', 'aprovado'].includes(r.etapa)) return `${voltar('videos', 'Vídeos')}${naoAchei('videos')}`;
    const [texto, tom] = passoDe(r);
    const v = ultima(r);
    const links = v ? [v.ig && linkDoDrive(v.ig, 'Versão do Instagram'), v.tt && linkDoDrive(v.tt, 'Versão do TikTok')].filter(Boolean).join(' · ') : '';
    return `${voltar('videos', 'Vídeos')}
    ${cab(r.titulo, '', r.id)}
    <div class="meta" style="margin:-.875rem 0 1.625rem">${selo(texto, tom)}</div>
    ${emPreparo('Os players com o tempo exato para pedir ajuste chegam na próxima atualização do app.')}
    <div class="pilha">
      ${v ? `<section class="painel pilha"><h2>Prévia v${v.n}</h2><p class="pequeno">${links}</p></section>` : ''}
      ${r.video.historico.length ? `<section class="painel" aria-labelledby="t-historia"><h2 id="t-historia">Histórico</h2>
        <ol class="historia">${r.video.historico.map(([quando, t]) => `<li><time>${esc(quando)}</time>${esc(t)}</li>`).join('')}</ol></section>` : ''}
    </div>`;
  });
}
