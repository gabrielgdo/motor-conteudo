// PRONTOS (#/prontos): um cartão por pasta de 5-Prontos (menos "vencedores"), como no desenho
// aprovado. Copiar a legenda, ver os horários sugeridos e baixar cada arquivo original (ou todos).
// "Postei" (data na planilha Radar) chega na etapa 2; o painel de vencedores depende da aba
// Desempenho (etapa 3).

import { esc, ic, dataCurta, NOME_REDE } from '../util.js';
import { roteiros, anexo, postouTudo } from '../dados.js';
import { sugestaoDaAgenda } from '../parse.js';
import { Downloads } from '../componentes/downloads.js';
import { cab, selo, comDados, vazio, rodapeAtualizado } from './pecas.js';

const CHAVE_LEGENDA = { ig: 'legendaIg', tt: 'legendaTt' };

/** Arquivo de legenda do pacote para a rede (legenda-instagram.txt / legenda-tiktok.txt), ou null. */
export const arquivoDeLegenda = (r, rede) => r.pacote?.arquivos.find((a) => a.chave === CHAVE_LEGENDA[rede]) || null;

/** Tem legenda para copiar: o arquivo do pacote ou, sem ele, a legenda do roteiro. */
const temLegenda = (r, rede) => !!(arquivoDeLegenda(r, rede) || r.legendas[rede]);

function sugestoes(r) {
  const agenda = r.pacote.arquivos.find((a) => a.chave === 'agenda');
  if (!agenda) return { ig: '', tt: '' };
  const a = anexo(agenda.file);
  return a.fase === 'pronto' ? sugestaoDaAgenda(a.texto) : { ig: '', tt: '' };
}

function vPacote(r) {
  const p = r.pacote;
  const conhecido = p.postadoConhecido;
  const postouAlgo = p.postado.ig || p.postado.tt;
  const estadoSelo = !conhecido ? '' : postouTudo(r) ? selo('Postado', 'ok') : postouAlgo ? selo('Falta uma rede', 'acao') : selo('Novo', 'acao');
  const sug = sugestoes(r);
  // Pacotes ainda sem postar: as legendas já vêm ao desenhar, para o "Copiar" ser instantâneo (o
  // navegador só deixa copiar logo depois do toque). Nos outros, o texto é baixado no toque.
  if (!(conhecido && postouTudo(r))) ['ig', 'tt'].forEach((rede) => { const a = arquivoDeLegenda(r, rede); if (a) anexo(a.file); });
  const n = p.arquivos.length;
  const idT = `t-${String(r.id).replace(/[^\w-]/g, '_')}`;
  return `<article class="painel pacote" aria-labelledby="${idT}">
    <div class="capas" aria-hidden="true">
      <span class="capa ig"><small>Instagram</small>${esc(r.curto)}</span><span class="capa tt"><small>TikTok</small>${esc(r.curto)}</span>
    </div>
    <div class="pacote-corpo">
      <div><span class="meta" style="margin-bottom:.375rem"><span class="id">${esc(r.id)}</span>${estadoSelo}${r.vencedor ? selo('Vencedor', 'forte') : ''}${r.teste ? selo('Teste') : ''}</span><h2 id="${idT}">${esc(r.titulo)}</h2></div>
      <div>${['ig', 'tt'].map((rede) => `
        <div class="rede"><div class="rede-topo"><strong>${NOME_REDE[rede]}</strong>${conhecido && p.postado[rede] ? selo(`Postado em ${dataCurta(p.postado[rede])}`, 'ok') : sug[rede] ? `<span class="apagado pequeno">Sugestão: ${esc(sug[rede])}</span>` : ''}</div>
          ${temLegenda(r, rede) ? `<div class="botoes"><button type="button" class="botao calmo menor" data-acao="copiar-legenda" data-id="${esc(r.id)}" data-valor="${rede}">${ic('copiar', 18)} Copiar a legenda</button></div>` : ''}</div>`).join('')}
      </div>
      ${n ? `<details class="arquivos"><summary>${n} ${n === 1 ? 'arquivo' : 'arquivos'} do pacote</summary><ul>${p.arquivos.map((a) => `<li><div>${esc(a.tipo)}<span>${esc(a.nome)}${a.tam ? `, ${esc(a.tam)}` : ''}</span></div>${Downloads.botao(r, a)}</li>`).join('')}</ul></details>
      <button type="button" class="botao primario cheio" data-acao="baixar-tudo" data-id="${esc(r.id)}" data-baixar-tudo="${esc(r.id)}" ${Downloads.tudo ? 'disabled' : ''}>${ic('prontos')} ${esc(Downloads.rotuloTudo(r))}</button>`
        : '<p class="apagado pequeno">A pasta deste pacote está vazia no Drive.</p>'}
    </div>
  </article>`;
}

export function vProntos() {
  return `${cab('Prontos', 'Pacotes finais para postar, com os arquivos no tamanho original.')}
  ${comDados(() => {
    // Sem postar primeiro (sem a planilha, nenhum conta como postado).
    const lista = roteiros().filter((r) => r.pacote)
      .map((r, i) => ({ r, i, feito: r.pacote.postadoConhecido && postouTudo(r) ? 1 : 0 }))
      .sort((a, b) => a.feito - b.feito || a.i - b.i).map((x) => x.r);
    return `${lista.length ? `<div class="pacotes">${lista.map(vPacote).join('')}</div>`
      : `<div class="painel">${vazio('Nenhum pacote pronto ainda', 'Quando o motor finalizar um vídeo aprovado, o pacote aparece aqui.')}</div>`}
    ${rodapeAtualizado()}`;
  })}`;
}
