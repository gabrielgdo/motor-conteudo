// ROTEIROS (#/roteiros e #/roteiros/<id>): a lista com os filtros e o detalhe com as abas
// Instagram, TikTok, Extras e Fontes, como no desenho aprovado. No rascunho, o aside "Sua decisão"
// leva ao Roteirista (pela ponte, Integra.ponte.decidirRoteiro) aprovar, pedir mudança ou recusar
// com motivo; acima, a faixa da rotina roteirista-decisao do id. O bloco Histórico junta o Drive e
// as linhas de Execuções do id.

import { esc, ic, NOME_REDE, validade } from '../util.js';
import { estado } from '../estado.js';
import { Integra } from '../integra.js';
import { ativos, rot, falasDe, execucoesLidas, pautasLidas, roteiros } from '../dados.js';
import { enviosAoRoteirista, textoDoEnvio } from '../envios.js';
import { podeDecidir, DECISOES_ROTEIRO, MOTIVOS_ROTEIRO } from '../controle.js';
import { faixaExecucao, historicoComExecucoes, blocoHistorico } from '../componentes/execucao.js';
import { cab, selo, vt, chipFiltro, passoDe, destinoDe, naoAchei, comDados, linkDoDrive, vazio, rodapeAtualizado, voltar, campo, segmento } from './pecas.js';

const enc = encodeURIComponent;
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/** Resumo das fontes no tom do desenho aprovado, sem afirmar checagem que não aconteceu. */
export function resumoFontes(r) {
  const n = r.fontes.length;
  if (!r.lido) return '';
  if (!n) return 'Sem fontes listadas';
  // Rascunho cujo relatório de fontes da última versão ainda não chegou: nada de "conferida".
  if (r.etapa === 'rascunho' && !r.fontesConferidas) return `${plural(n, 'fonte', 'fontes')}, em checagem`;
  const conta = (c) => r.fontes.filter((f) => f.checagem === c).length;
  const conf = conta('confirmada'); const div = conta('divergente'); const nao = conta('nao-encontrada');
  const checadas = conf + div + nao;
  if (!checadas) return plural(n, 'fonte', 'fontes');
  const partes = [checadas === n ? plural(n, 'fonte conferida', 'fontes conferidas') : `${plural(n, 'fonte', 'fontes')}, ${plural(conf, 'confirmada', 'confirmadas')}`];
  if (div) partes.push(plural(div, 'divergente', 'divergentes'));
  if (nao) partes.push(plural(nao, 'não encontrada', 'não encontradas'));
  return partes.join(', ');
}

const TOM_ENVIO = { 'na-fila': 'neutro', processando: 'acao', 'parece-travada': 'alerta', enviada: 'ok', falhou: 'alerta' };

/**
 * Seção "Com o Roteirista" (puro): as pautas enviadas (ou indo) que ainda não têm rascunho no
 * Drive, com o estado real de Execuções (js/envios.js). Na falha (ou se parecer travada), "Tentar
 * de novo" é um <button> de verdade (só para a conta que decide). Todo texto vem da planilha: esc().
 */
export function htmlComRoteirista(envios = [], { decide = false } = {}) {
  const lista = (envios || []).filter((e) => e.estado !== 'rascunho-chegou' && !/^T/i.test(String(e.id_pauta || '')));
  if (!lista.length) return '';
  return `<section class="painel" aria-labelledby="t-com-roteirista" style="margin:1rem 0 1.25rem">
    <h2 id="t-com-roteirista" style="margin-bottom:.75rem">Com o Roteirista</h2>
    <ul class="com-roteirista" style="list-style:none;margin:0;padding:0;display:grid;gap:.75rem">${lista.map((e) => {
      const repetir = decide && (e.estado === 'falhou' || e.estado === 'parece-travada');
      return `
      <li style="display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .75rem">
        <span class="meta"><span class="id">${esc(e.id_pauta)}</span>${selo(textoDoEnvio(e), TOM_ENVIO[e.estado] || 'neutro')}</span>
        ${e.titulo ? `<span>${esc(e.titulo)}</span>` : ''}
        ${repetir ? `<button type="button" class="botao contorno menor" data-acao="pautas-enviar" data-id="${esc(e.id_pauta)}">${ic('atualizar', 16)} Tentar de novo</button>` : ''}
      </li>`; }).join('')}</ul>
    <p class="apagado pequeno" style="margin-top:.75rem">O rascunho aparece na lista abaixo quando o Roteirista gravar no Drive.</p>
  </section>`;
}

export function vRoteiros() {
  const envios = enviosAoRoteirista({
    selecao: pautasLidas().selecao || null, decisoes: pautasLidas().decisoes || null,
    execucoes: execucoesLidas().execucoes || [], projetos: roteiros(), agora: new Date(), locais: estado.enviosLocais || {},
  });
  return `${cab('Roteiros', 'Cada roteiro traz a versão do Instagram, a do TikTok e os textos extras.')}
  ${htmlComRoteirista(envios, { decide: podeDecidir(Integra.email()) })}
  ${comDados(() => {
    const f = estado.filtroRoteiros; const todos = ativos();
    const lista = f === 'aprovar' ? todos.filter((r) => r.etapa === 'rascunho') : f === 'gravar' ? todos.filter((r) => r.etapa === 'aprovado') : todos;
    const nAprovar = todos.filter((r) => r.etapa === 'rascunho').length; const nGravar = todos.filter((r) => r.etapa === 'aprovado').length;
    return `
  <div class="filtros" role="group" aria-label="Filtrar roteiros">
    ${chipFiltro('filtroRoteiros', 'aprovar', `Para aprovar (${nAprovar})`, f)}${chipFiltro('filtroRoteiros', 'gravar', `Para gravar (${nGravar})`, f)}${chipFiltro('filtroRoteiros', 'todos', 'Todos', f)}
  </div>
  ${lista.length ? `<ul class="folhas">${lista.map((r) => { const [texto, tom] = passoDe(r); const v = validade(r); const abertura = r.ganchos.ig[0]; const fontes = resumoFontes(r); return `
    <li><a class="painel folha luz" href="#/roteiros/${enc(r.id)}">
      <span class="meta"><span class="id">${esc(r.id)}</span>${selo(texto, tom)}${r.teste ? selo('Teste') : ''}</span>
      <h3 ${vt(r.id)}>${esc(r.titulo)}</h3>
      ${abertura ? `<blockquote>${esc(abertura)}</blockquote>` : r.erroTexto ? '<p class="apagado pequeno">Não consegui ler o texto deste roteiro agora.</p>' : ''}
      <span class="meta">${v.perto && r.lido ? selo(v.texto, 'alerta') : ''}${fontes ? `<span class="apagado pequeno">${esc(fontes)}</span>` : ''}</span>
    </a></li>`; }).join('')}</ul>`
    : `<div class="painel">${f === 'todos'
      ? vazio('Nenhum roteiro ainda', 'Os rascunhos novos do Roteirista aparecem aqui, já com as fontes conferidas.')
      : vazio(f === 'aprovar' ? 'Nenhum roteiro para aprovar' : 'Nenhum roteiro esperando gravação', f === 'aprovar' ? 'Os rascunhos novos do Roteirista aparecem aqui, já com as fontes conferidas.' : 'Aprove um roteiro para ele entrar na fila de gravação.')}</div>`}
  ${rodapeAtualizado()}`;
  })}`;
}

/* ---- Abas do detalhe ---- */

function linhaPalavras(r, falas) {
  const palavras = falas.reduce((n, f) => n + f.texto.split(/\s+/).filter(Boolean).length, 0);
  const tamanho = r.duracaoEstimada ? `Duração estimada: ${r.duracaoEstimada} · ${palavras} palavras.` : `${palavras} palavras, perto de ${Math.round(palavras / 2.5)} s de fala.`;
  const daRede = falas.filter((f) => f.rede).length;
  const destaque = !daRede ? 'As falas são iguais nas duas redes.'
    : daRede === falas.length ? 'O TikTok tem texto próprio: as falas destacadas só existem nesta rede.'
      : 'As falas destacadas só existem nesta rede; o resto é igual nas duas.';
  return `<p class="apagado pequeno" style="margin-bottom:1.375rem">${esc(tamanho)} ${destaque}</p>`;
}

function painelFalas(r, rede) {
  const falas = falasDe(r, rede);
  const outros = r.ganchos[rede].slice(1);
  const legenda = r.legendas[rede];
  if (!falas.length) return vazio('Sem falas para esta rede', 'O texto deste roteiro não traz falas que eu consiga ler.');
  return `
  ${linhaPalavras(r, falas)}
  <div class="falas">${falas.map((f) => `<div class="fala ${f.rede ? 'da-rede' : ''}"><p class="fala-parte">${esc(f.parte)}${f.rede ? ` do ${NOME_REDE[f.rede]}` : ''}</p><p class="fala-texto">${esc(f.texto)}</p></div>`).join('')}</div>
  ${outros.length ? `<div class="bloco"><h3>Outras aberturas possíveis</h3><ul class="mudancas">${outros.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}
  ${r.entrega ? `<div class="bloco"><h3>Entrega</h3><p class="texto-pronto">${esc(r.entrega)}</p></div>` : ''}
  ${legenda ? `<div class="bloco"><div class="bloco-cab"><h3>Legenda do ${NOME_REDE[rede]}</h3><button type="button" class="botao calmo menor" data-acao="copiar" data-id="${esc(r.id)}" data-valor="${rede}">${ic('copiar', 18)} Copiar</button></div>
    <p class="texto-pronto post">${esc(legenda)}</p></div>` : ''}`;
}

function painelExtras(r) {
  const partes = [];
  if (r.carrossel.length) partes.push(['Carrossel', `<ol class="slides">${r.carrossel.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`]);
  if (r.threads) partes.push(['Threads', `<p class="texto-pronto post">${esc(r.threads)}</p>`]);
  if (r.stories.length) {
    partes.push(['Stories', `<ul class="mudancas">${r.stories.map(([tipo, texto]) => `<li><strong>${esc(tipo)}:</strong> ${esc(texto)}</li>`).join('')}</ul>
    <p class="dica" style="margin-top:.5rem">A enquete e a caixinha você coloca no próprio Instagram.</p>`]);
  }
  if (!partes.length) return vazio('Sem textos extras', 'Este roteiro não traz carrossel, Threads nem Stories.');
  // A primeira parte fica solta, como o Carrossel no desenho aprovado; as outras, em blocos.
  return partes.map(([titulo, corpo], i) => (i === 0
    ? `<h3 style="margin-bottom:.625rem">${titulo}</h3>${corpo}`
    : `<div class="bloco"><h3>${titulo}</h3>${corpo}</div>`)).join('');
}

const SELO_CHECAGEM = { confirmada: ['Confirmada', 'ok'], divergente: ['Divergente', 'alerta'], 'nao-encontrada': ['Não encontrada', 'alerta'] };

function painelFontes(r) {
  return `
  <p class="apagado pequeno">O motor confere cada referência na Crossref e no PubMed antes de o roteiro chegar a você.</p>
  ${r.fontes.length ? `<ul class="fontes">${r.fontes.map((f) => { const s = SELO_CHECAGEM[f.checagem]; return `<li><p>${esc(f.ref)}</p>${s ? `<div class="meta">${selo(s[0], s[1])}</div>` : ''}</li>`; }).join('')}</ul>`
    : '<p style="margin-top:.875rem">Este roteiro não lista fontes.</p>'}
  ${r.checklist.length ? `<div class="bloco"><h3>Cuidados do Conselho de Psicologia</h3><ul class="conferido">${r.checklist.map((c) => (c.marcado
    ? `<li>${ic('check', 18)}<span>${esc(c.texto)}<span class="vh"> (conferido)</span></span></li>`
    : `<li class="nao"><span class="sem-check" aria-hidden="true"></span><span>${esc(c.texto)}<span class="vh"> (não marcado)</span></span></li>`)).join('')}</ul></div>` : ''}
  ${r.notas.length ? `<div class="bloco"><h3>Notas para a edição</h3><ul class="mudancas">${r.notas.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}`;
}

/* ---- Detalhe ---- */

/**
 * Decisão do rascunho no aside (puro: recebe a conta, a escolha e as Execuções).
 * Aprovar / Pedir mudança (campo do pedido) / Recusar (motivo da lista curta + observação) e o
 * botão que abre a confirmação. A conta que não decide vê tudo desabilitado, com a nota.
 */
export function decisaoDoRascunho(r, { email = '', escolha = '', exec = {}, erros = {}, agora = new Date() } = {}) {
  const fontes = resumoFontes(r);
  const decide = podeDecidir(email);
  const dis = decide ? '' : ' disabled';
  const id = esc(r.id);
  // Como no desenho aprovado: três botões largos, um embaixo do outro (aprovar, pedir mudança, recusar).
  const CLASSE = { aprovar: 'contorno sim', mudar: 'contorno mudar', recusar: 'calmo nao' };
  const botao = (valor, extra = '') => `<button type="button" class="botao ${CLASSE[valor]} cheio" data-acao="roteiro-escolher" data-id="${id}" data-valor="${valor}" aria-pressed="${escolha === valor}"${dis}>${extra}${esc(DECISOES_ROTEIRO[valor])}</button>`;
  let detalhe = '';
  if (decide && escolha === 'mudar') {
    detalhe = campo({ modelo: `rp-${r.id}`, rotulo: 'O que mudar', tipo: 'textarea', linhas: 3, exemplo: 'Ex.: abrir com a pergunta, sem o dado' });
  } else if (decide && escolha === 'recusar') {
    detalhe = `${segmento(`rm-${r.id}`, 'Por que recusar?', MOTIVOS_ROTEIRO.map((m) => [m, m.charAt(0).toUpperCase() + m.slice(1)]), '')}
      ${erros[`rm-${r.id}`] ? `<p class="erro">${esc(erros[`rm-${r.id}`])}</p>` : ''}
      ${campo({ modelo: `ro-${r.id}`, rotulo: 'Observação', opcional: true, exemplo: 'Ex.: a tese não se sustenta' })}`;
  }
  return `
    <h2>Sua decisão</h2>
    <p class="apagado pequeno">Rascunho v${r.versaoRoteiro}.${fontes ? ` ${esc(fontes)}.` : ''}</p>
    ${r.fontesConferidas ? '' : `<p class="meta">${selo('Em checagem de fontes', 'espera')}</p>`}
    ${faixaExecucao({ rotina: 'roteirista-decisao', rotulo: 'Decisão pelo app', idAlvo: r.id, dados: exec, agora })}
    <div class="decisao empilhada" role="group" aria-label="Decisão sobre o rascunho v${r.versaoRoteiro}">
      ${botao('aprovar', ic('check', 18))}${botao('mudar')}${botao('recusar')}
    </div>
    ${decide ? '' : `<p class="pequeno apagado">${esc('Só a conta da Robertta decide.')}</p>`}
    ${detalhe}
    ${decide && escolha ? `<button type="button" class="botao primario cheio" data-acao="roteiro-confirmar" data-id="${id}">${esc(escolha === 'aprovar' ? `Aprovar a v${r.versaoRoteiro}` : escolha === 'mudar' ? 'Pedir a mudança' : 'Recusar o rascunho')}</button>` : ''}`;
}

function acoesDe(r) {
  if (r.etapa === 'rascunho') {
    return decisaoDoRascunho(r, {
      email: Integra.email(), escolha: estado.decisaoRoteiro[r.id] || '', exec: execucoesLidas(), erros: estado.erros, agora: new Date(),
    });
  }
  const aprovado = r.etapa === 'aprovado';
  const tele = r.falas.length || r.teleprompter
    ? `<button type="button" class="botao ${aprovado ? 'primario' : 'contorno'} cheio" data-acao="tele-abrir" data-id="${esc(r.id)}">${ic('tele')} Abrir o teleprompter</button>`
    : '';
  return `
    <h2>${aprovado ? 'Pronto para gravar' : 'Roteiro gravado'}</h2>
    <p class="apagado pequeno">${aprovado ? 'Grave as duas aberturas em sequência e depois o resto. O motor separa as versões.' : 'O vídeo deste roteiro está em Vídeos.'}</p>
    <div class="pilha" style="gap:.625rem">
      ${tele}
      ${aprovado ? `<a class="botao contorno cheio" href="#/enviar/${enc(r.id)}">${ic('enviar')} Enviar a gravação</a>` : `<a class="botao calmo cheio" href="${destinoDe(r)}">Ver o vídeo</a>`}
    </div>`;
}

export function vRoteiro(id) {
  return comDados(() => {
    const r = rot(id);
    if (!r || r.arquivado) return `${voltar('roteiros', 'Roteiros')}${naoAchei('roteiros')}`;
    const abas = [['ig', 'Instagram'], ['tt', 'TikTok'], ['extras', 'Extras'], ['fontes', 'Fontes']];
    const aba = abas.some(([valor]) => valor === estado.abaRoteiro) ? estado.abaRoteiro : 'ig';
    const v = validade(r); const [texto, tom] = passoDe(r);
    let painel;
    if (!r.lido) {
      painel = r.erroTexto
        ? vazio('Não consegui ler o texto deste roteiro', `O Google Drive não entregou o arquivo agora.${linkDoDrive(r.arquivoRoteiro) ? ` Você pode ${linkDoDrive(r.arquivoRoteiro, 'abrir o roteiro no Drive')}.` : ''}`, `<button type="button" class="botao contorno" data-acao="atualizar">${ic('atualizar', 18)} Tentar de novo</button>`)
        : vazio('O texto deste roteiro não está no Drive', 'O arquivo do roteiro não apareceu em 2-Roteiros.');
    } else painel = aba === 'extras' ? painelExtras(r) : aba === 'fontes' ? painelFontes(r) : painelFalas(r, aba);
    return `
  ${voltar('roteiros', 'Roteiros')}
  ${cab(r.titulo, '', r.id)}
  <div class="meta" style="margin:-.875rem 0 1.625rem">${selo(texto, tom)}${r.lido ? selo(v.texto, v.tom) : ''}${r.formato ? selo(r.formato) : ''}${r.teste ? selo('Teste') : ''}</div>
  <div class="roteiro-grade">
    <section class="painel" aria-label="Conteúdo do roteiro">
      <div class="abas" role="tablist" aria-label="Partes do roteiro">${abas.map(([valor, nome]) => `<button type="button" class="aba" role="tab" id="aba-${valor}" aria-selected="${aba === valor}" aria-controls="painel-roteiro" tabindex="${aba === valor ? 0 : -1}" data-acao="aba" data-valor="${valor}">${nome}</button>`).join('')}</div>
      <div role="tabpanel" id="painel-roteiro" aria-labelledby="aba-${aba}">${painel}</div>
    </section>
    <aside class="painel pilha fixo" aria-label="Ações do roteiro">${acoesDe(r)}</aside>
    ${blocoHistorico(historicoComExecucoes(r.eventos, execucoesLidas().execucoes, r.id), 'roteiro-historia')}
  </div>
  ${rodapeAtualizado()}`;
  });
}
