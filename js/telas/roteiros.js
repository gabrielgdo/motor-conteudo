// ROTEIROS (#/roteiros e #/roteiros/<id>): a lista com os filtros e o detalhe com as abas
// Instagram, TikTok, Extras e Fontes, como no desenho aprovado. No rascunho, o aside "Sua decisão"
// leva ao Roteirista (pela ponte, Integra.ponte.decidirRoteiro) aprovar, pedir mudança ou recusar
// com motivo; acima, a faixa da rotina roteirista-decisao do id. O bloco Histórico junta o Drive e
// as linhas de Execuções do id.
// Antes do rascunho (etapa 'ganchos', desde 15/11/2026): o detalhe mostra os 3 ganchos que o motor propôs, cada um
// com a fala, o texto de tela e o porquê, e "Escolher o gancho N"; o aside "Sua escolha" tem "Quero outros 3" (com
// observação). Tocar abre a confirmação (janelaGancho); confirmado, o app grava "<id> gancho vN.md" (js/ganchos.js).
// Pergunta de regra (plano de mídia, §6): quando o rascunho (ou os ganchos) traz "## Regra que esbarra no seu pedido",
// o aside mostra as perguntas com "Mudar a regra", "Só neste vídeo" e "Manter" (js/componentes/regras.js); a resposta
// vai com a decisão (`regras`). No rascunho, "Aprovar" com uma resposta que libera o pedido vira pedido de mudança.

import { esc, ic, NOME_REDE, validade } from '../util.js';
import { estado } from '../estado.js';
import { Integra } from '../integra.js';
import { ativos, rot, falasDe, execucoesLidas, pautasLidas, roteiros, anexo, camposDoLido } from '../dados.js';
import { lerRoteiro } from '../roteiro.js';
import { enviosAoRoteirista, textoDoEnvio } from '../envios.js';
import { estadoDaDecisaoRoteiro, bloqueioDaDecisao, versoesDo, TOM_DECISAO } from '../decisoes-roteiro.js';
import { estadoDosGanchos } from '../ganchos.js';
import { nomeEscolhaGancho } from '../pedidos-motor.js';
import { chaveRespostas } from '../regras.js';
import { blocoRegras, listaRespostas, avisoViraPedido, algumaLibera } from '../componentes/regras.js';
import { moldura } from '../componentes/janelas.js';
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

/* ---- Decisão e versões do rascunho (puro, com as Execuções e o registro otimista) ---- */

/** Estado da decisão do roteiro (js/decisoes-roteiro.js); fora do rascunho, só aprovado/recusado contam. */
export function decisaoDe(r, { execucoes = [], agora = new Date(), locais = {} } = {}) {
  return estadoDaDecisaoRoteiro({ execucoes, projeto: r, agora, local: locais?.[r.id] || null });
}

/** Selo do estado da decisão (vazio quando não há nada a dizer). Texto da planilha: esc() no selo. */
export function seloDaDecisao(d) {
  if (!d || d.estado === 'livre' || !d.texto) return '';
  return selo(d.texto, TOM_DECISAO[d.estado] || 'neutro');
}

/** A versão do rascunho que está na tela: a escolhida nas abas (se existir) ou a mais nova. */
export function versaoVistaDe(r, vistas = {}) {
  const versoes = versoesDo(r);
  const n = Number(vistas?.[r.id]);
  if (Number.isInteger(n) && versoes.includes(n)) return n;
  return versoes.length ? versoes[versoes.length - 1] : (r.versaoRoteiro || 1);
}

/** Abas "v1 · v2 · v3" do rascunho (só com mais de uma versão). <button> de verdade. */
export function abasDeVersao(r, vista) {
  const versoes = versoesDo(r);
  if (r.etapa !== 'rascunho' || versoes.length < 2) return '';
  const ultima = versoes[versoes.length - 1];
  return `<div class="filtros" role="group" aria-label="Versões do rascunho" style="margin-bottom:1rem">${versoes.map((v) => `<button type="button" class="chip" data-acao="roteiro-versao" data-id="${esc(r.id)}" data-valor="${v}" aria-pressed="${v === vista}">${esc(`v${v}${v === ultima ? ' (mais nova)' : ''}`)}</button>`).join('')}</div>`;
}

const lidosPorAnexo = new WeakMap();

/**
 * O roteiro com o TEXTO da versão vista: a mais nova é o próprio `r`; uma anterior é baixada com o
 * download de sempre (anexo) e lida por lerRoteiro. → {r, fase:'pronto'|'carregando'|'erro'}.
 * `opcoes.anexoDe`: troca o anexo (testes).
 */
export function roteiroDaVersao(r, vista, { anexoDe = anexo } = {}) {
  if (vista === r.versaoRoteiro) return { r, fase: 'pronto' };
  const arq = (r.arquivosRascunho || []).find((x) => x.v === vista)?.file;
  if (!arq) return { r, fase: 'pronto' };
  const a = anexoDe(arq);
  if (!a || a.fase === 'carregando') return { r, fase: 'carregando' };
  if (a.fase === 'erro') return { r, fase: 'erro' };
  let lido = lidosPorAnexo.get(a);
  if (lido === undefined) {
    try { lido = lerRoteiro(a.texto, arq.name || ''); } catch { lido = null; }
    lidosPorAnexo.set(a, lido);
  }
  if (!lido) return { r, fase: 'erro' };
  return { r: { ...r, ...camposDoLido(lido), versaoVista: vista }, fase: 'pronto' };
}

export function vRoteiros() {
  const execs = execucoesLidas().execucoes || [];
  const agoraLista = new Date();
  const envios = enviosAoRoteirista({
    selecao: pautasLidas().selecao || null, decisoes: pautasLidas().decisoes || null,
    execucoes: execucoesLidas().execucoes || [], projetos: roteiros(), agora: new Date(), locais: estado.enviosLocais || {},
  });
  return `${cab('Roteiros', 'Cada roteiro traz a versão do Instagram, a do TikTok e os textos extras.')}
  ${htmlComRoteirista(envios, { decide: podeDecidir(Integra.email()) })}
  ${comDados(() => {
    const f = estado.filtroRoteiros; const todos = ativos();
    const aDecidir = (r) => r.etapa === 'rascunho' || r.etapa === 'ganchos';
    const lista = f === 'aprovar' ? todos.filter(aDecidir) : f === 'gravar' ? todos.filter((r) => r.etapa === 'aprovado') : todos;
    const nAprovar = todos.filter(aDecidir).length; const nGravar = todos.filter((r) => r.etapa === 'aprovado').length;
    return `
  <div class="filtros" role="group" aria-label="Filtrar roteiros">
    ${chipFiltro('filtroRoteiros', 'aprovar', `Para aprovar (${nAprovar})`, f)}${chipFiltro('filtroRoteiros', 'gravar', `Para gravar (${nGravar})`, f)}${chipFiltro('filtroRoteiros', 'todos', 'Todos', f)}
  </div>
  ${lista.length ? `<ul class="folhas">${lista.map((r) => { const [texto, tom] = passoDe(r); const v = validade(r); const abertura = r.ganchos.ig[0]; const fontes = resumoFontes(r);
    const dec = r.etapa === 'rascunho' ? seloDaDecisao(decisaoDe(r, { execucoes: execs, agora: agoraLista, locais: estado.decisoesEnviadas })) : ''; return `
    <li><a class="painel folha luz" href="#/roteiros/${enc(r.id)}">
      <span class="meta"><span class="id">${esc(r.id)}</span>${selo(texto, tom)}${dec}${r.teste ? selo('Teste') : ''}</span>
      <h3 ${vt(r.id)}>${esc(r.titulo)}</h3>
      ${r.etapa === 'ganchos' ? `<p class="apagado pequeno">${esc(resumoDosGanchos(r))}</p>`
    : abertura ? `<blockquote>${esc(abertura)}</blockquote>` : r.erroTexto ? '<p class="apagado pequeno">Não consegui ler o texto deste roteiro agora.</p>' : ''}
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

export function painelFalas(r, rede) {
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

/** A chave das respostas às perguntas de regra do rascunho (as perguntas vêm do rascunho mais novo). */
export const chaveRegrasDoRascunho = (r) => {
  const versoes = versoesDo(r);
  return chaveRespostas('rt', r.id, versoes.length ? versoes[versoes.length - 1] : (r.versaoRoteiro || 1));
};

/**
 * Decisão do rascunho no aside (puro: recebe a conta, a escolha e as Execuções).
 * Aprovar / Pedir mudança (campo do pedido) / Recusar (motivo da lista curta + observação) e o
 * botão que abre a confirmação. A conta que não decide vê tudo desabilitado, com a nota. Com perguntas de regra no
 * rascunho, elas vêm antes dos botões; "Aprovar" com uma resposta que libera o pedido vira pedido de mudança.
 */
export function decisaoDoRascunho(r, {
  email = '', escolha = '', exec = {}, erros = {}, agora = new Date(), vista = 0, locais = {}, respostasRegra = estado.respostasRegra,
} = {}) {
  const fontes = resumoFontes(r);
  const decide = podeDecidir(email);
  const id = esc(r.id);
  const versoes = versoesDo(r);
  const ultima = versoes.length ? versoes[versoes.length - 1] : (r.versaoRoteiro || 1);
  const v = versoes.includes(Number(vista)) ? Number(vista) : ultima;
  const execucoes = exec?.execucoes || [];
  const d = decisaoDe(r, { execucoes, agora, locais });
  // Revisão em andamento, aprovação a caminho ou roteiro já decidido: os três botões desligam (com a explicação).
  const travado = decide && d.bloqueia;
  // A mesma regra da ponte para a escolha na versão vista (ja-pedida / ja-decidido).
  const repetida = (valor) => (decide && !travado ? bloqueioDaDecisao(execucoes, { id: r.id, decisao: valor, versao: v, agora }) : { livre: true });
  const repMudar = repetida('mudar');
  const desligado = (valor) => !decide || travado || !(valor === 'mudar' ? repMudar : repetida(valor)).livre;
  const esc_ = escolha && !desligado(escolha) ? escolha : '';
  // Como no desenho aprovado: três botões largos, um embaixo do outro (aprovar, pedir mudança, recusar).
  const CLASSE = { aprovar: 'contorno sim', mudar: 'contorno mudar', recusar: 'calmo nao' };
  const ROTULO = { aprovar: `Aprovar a v${v}`, mudar: DECISOES_ROTEIRO.mudar, recusar: DECISOES_ROTEIRO.recusar };
  const botao = (valor, extra = '') => `<button type="button" class="botao ${CLASSE[valor]} cheio" data-acao="roteiro-escolher" data-id="${id}" data-valor="${valor}" aria-pressed="${esc_ === valor}"${desligado(valor) ? ' disabled' : ''}>${extra}${esc(ROTULO[valor])}</button>`;
  let detalhe = '';
  if (esc_ === 'mudar') {
    detalhe = campo({ modelo: `rp-${r.id}`, rotulo: `O que mudar na v${v}`, tipo: 'textarea', linhas: 3, exemplo: 'Ex.: abrir com a pergunta, sem o dado' });
  } else if (esc_ === 'recusar') {
    detalhe = `${segmento(`rm-${r.id}`, 'Por que recusar?', MOTIVOS_ROTEIRO.map((m) => [m, m.charAt(0).toUpperCase() + m.slice(1)]), '')}
      ${erros[`rm-${r.id}`] ? `<p class="erro">${esc(erros[`rm-${r.id}`])}</p>` : ''}
      ${campo({ modelo: `ro-${r.id}`, rotulo: 'Observação', opcional: true, exemplo: 'Ex.: a tese não se sustenta' })}`;
  }
  // Explicação visível do estado (e do porquê de um botão estar desligado).
  const notas = [];
  if (d.estado !== 'livre' && d.explicacao) notas.push(d.explicacao);
  if (decide && !travado && !repMudar.livre) notas.push(repMudar.mensagem);
  const pedirDeNovo = decide && (d.estado === 'falhou' || d.estado === 'sem-versao-nova') && d.decisao
    ? `<button type="button" class="botao contorno menor" data-acao="roteiro-repetir" data-id="${id}" data-valor="${esc(d.decisao)}" data-versao="${Number(d.versao) || v}">${ic('atualizar', 16)} Pedir de novo</button>` : '';
  const antiga = v !== ultima;
  const perguntas = r.perguntasRegra || [];
  const chave = chaveRegrasDoRascunho(r);
  const respostas = respostasRegra?.[chave] || {};
  const vira = esc_ === 'aprovar' && algumaLibera(perguntas, respostas, r.id);
  const regras = blocoRegras({ perguntas, respostas, chave, pode: decide && !travado, depois: 'A resposta vai junto com a sua decisão sobre o rascunho.' });
  return `
    <h2>Sua decisão</h2>
    <p class="apagado pequeno">Rascunho v${v}${antiga ? ` (a mais nova é a v${ultima})` : ''}.${fontes ? ` ${esc(fontes)}${antiga ? ` (na v${ultima})` : ''}.` : ''}</p>
    ${r.fontesConferidas ? '' : `<p class="meta">${selo('Em checagem de fontes', 'espera')}</p>`}
    ${d.estado !== 'livre' && d.texto ? `<p class="meta">${seloDaDecisao(d)}</p>` : ''}
    ${faixaExecucao({ rotina: 'roteirista-decisao', rotulo: 'Decisão pelo app', idAlvo: r.id, dados: exec, agora })}
    ${notas.length || pedirDeNovo ? `<div class="pilha" style="gap:.5rem" role="status">${notas.map((n) => `<p class="pequeno apagado">${esc(n)}</p>`).join('')}${pedirDeNovo ? `<p>${pedirDeNovo}</p>` : ''}</div>` : ''}
    ${regras}
    <div class="decisao empilhada" role="group" aria-label="Decisão sobre o rascunho v${v}">
      ${botao('aprovar', ic('check', 18))}${botao('mudar')}${botao('recusar')}
    </div>
    ${decide ? '' : `<p class="pequeno apagado">${esc('Só a conta da Robertta decide.')}</p>`}
    ${detalhe}
    ${avisoViraPedido(vira, 'um rascunho novo')}
    ${esc_ ? `<button type="button" class="botao primario cheio" data-acao="roteiro-confirmar" data-id="${id}">${esc(vira ? 'Refazer o rascunho com o seu pedido' : esc_ === 'aprovar' ? `Aprovar a v${v}` : esc_ === 'mudar' ? `Pedir a mudança na v${v}` : `Recusar o rascunho v${v}`)}</button>` : ''}`;
}

/* ---- Ganchos antes do roteiro (etapa 'ganchos') ---- */

/** Uma linha para o cartão da lista. */
export function resumoDosGanchos(r, { local = estado.ganchosEnviados?.[r.id] || null, agora = new Date() } = {}) {
  const st = estadoDosGanchos(r, { local, agora });
  const v = r.propostaGanchos?.versao || 1;
  if (st.estado === 'escolher') return `3 ganchos (v${v}) para você escolher; o roteiro nasce do escolhido.`;
  if (st.estado === 'sem-texto') return 'Não consegui ler os ganchos agora.';
  return st.explicacao;
}

/**
 * As 3 opções (puro): fala, texto de tela e porquê de cada uma, com "Escolher o gancho N" (<button> de verdade).
 * A conta que não decide, a escolha já enviada e o arquivo ilegível deixam os botões desligados.
 */
export function painelGanchos(r, { email = '', local = null, agora = new Date() } = {}) {
  const g = r.propostaGanchos || { opcoes: [] };
  const st = estadoDosGanchos(r, { local, agora });
  const id = esc(r.id);
  if (st.estado === 'sem-texto') {
    const link = linkDoDrive(g.arquivo, 'abrir os ganchos no Drive');
    return vazio('Não consegui ler os ganchos', `${esc(st.explicacao)}${link ? ` Você pode ${link}.` : ''}`,
      `<button type="button" class="botao contorno" data-acao="atualizar">${ic('atualizar', 18)} Tentar de novo</button>`);
  }
  const pode = podeDecidir(email) && !st.bloqueia;
  return `
    <h2 id="t-ganchos">Escolha o gancho</h2>
    <p class="apagado pequeno" style="margin-bottom:1.125rem">Ganchos v${Number(g.versao) || 1}. A fala abre o vídeo nos 3 primeiros segundos e o texto aparece na tela; o roteiro nasce do que você escolher.</p>
    <ol class="ganchos">${g.opcoes.map((o) => {
      const escolhido = st.escolha === String(o.n);
      return `
      <li class="gancho${escolhido ? ' escolhido' : ''}">
        <p class="fala-parte">Gancho ${Number(o.n)}${escolhido ? ' · escolhido' : ''}</p>
        <p class="fala-texto">${esc(o.fala)}</p>
        <dl class="gancho-dados">
          ${o.tela ? `<div><dt>Na tela</dt><dd>${esc(o.tela)}</dd></div>` : ''}
          ${o.porque ? `<div><dt>Por quê</dt><dd>${esc(o.porque)}</dd></div>` : ''}
        </dl>
        <button type="button" class="botao contorno sim cheio" data-acao="gancho-escolher" data-id="${id}" data-valor="${Number(o.n)}" aria-pressed="${escolhido}"${pode ? '' : ' disabled'}>${ic('check', 18)} Escolher o gancho ${Number(o.n)}</button>
      </li>`;
    }).join('')}</ol>`;
}

/** O aside "Sua escolha" (puro): o estado, as perguntas de regra (se os ganchos trouxerem), "Quero outros 3" com a
    observação e como funciona. */
export function escolhaDosGanchos(r, { email = '', local = null, agora = new Date(), respostasRegra = estado.respostasRegra } = {}) {
  const st = estadoDosGanchos(r, { local, agora });
  const decide = podeDecidir(email);
  const pode = decide && !st.bloqueia;
  const id = esc(r.id);
  const chave = chaveRespostas('gc', r.id, r.propostaGanchos?.versao || 1);
  const regras = st.estado === 'escolher' ? blocoRegras({
    perguntas: r.propostaGanchos?.regras, respostas: respostasRegra?.[chave] || {}, chave, pode,
    depois: 'A resposta vai junto com a escolha do gancho.',
  }) : '';
  return `
    <h2>Sua escolha</h2>
    ${st.estado === 'escolher' ? '<p class="apagado pequeno">Toque em “Escolher” no gancho que abre melhor o vídeo. Antes de mandar, o app pede confirmação.</p>'
    : `<p class="meta">${selo(st.texto, st.tom)}</p><p class="pequeno apagado" role="status">${esc(st.explicacao)}</p>`}
    ${regras}
    <div class="pilha" style="gap:.625rem">
      <h3 style="margin:0">Nenhum serve?</h3>
      ${campo({ modelo: `go-${r.id}`, rotulo: 'O que você quer nos novos ganchos', tipo: 'textarea', linhas: 2, opcional: true, exemplo: 'Ex.: mais leve, sem pergunta', attrs: pode ? '' : 'disabled' })}
      <button type="button" class="botao calmo cheio" data-acao="gancho-escolher" data-id="${id}" data-valor="outros"${pode ? '' : ' disabled'}>${ic('atualizar', 18)} Quero outros 3</button>
    </div>
    ${decide ? '' : `<p class="pequeno apagado">${esc('Só a conta da Robertta escolhe o gancho.')}</p>`}
    <p class="pequeno apagado">Depois da escolha, o motor escreve o rascunho v1; ele passa pela checagem de fontes e volta aqui para você aprovar, pedir mudança ou recusar.</p>`;
}

/** Janela de confirmação da escolha (puro). `opcao`: o gancho escolhido ({n, fala, tela}); null em "outros". `regras` e
    `perguntas`: as respostas dela às perguntas de regra, que vão junto. */
export function janelaGancho({ id, versao, escolha, opcao = null, observacoes = '', regras = [], perguntas = [], teste = false, enviando = false, erro = '' } = {}) {
  const outros = escolha === 'outros';
  const v = Number(versao) || 1;
  const nome = nomeEscolhaGancho(id, v);
  const itens = outros
    ? [['O que vai acontecer', `O app manda o pedido ao motor (“${nome}”). Ele escreve 3 ganchos novos (v${v + 1}), diferentes destes, levando em conta a sua observação.`],
      ['Sua observação', observacoes || 'nenhuma']]
    : [['O que vai acontecer', `O app manda a sua escolha ao motor (“${nome}”). Ele escreve o rascunho v1 com esta abertura; o rascunho passa pela checagem de fontes e volta para você aprovar.`]];
  itens.push(['Depois', `Vale a primeira escolha dos ganchos v${v}. Se o roteiro não ficar bom, você pede mudança no rascunho.`]);
  const corpo = `${teste ? `<p class="meta">${selo('Teste')}<span class="pequeno apagado">Id de teste: o motor trata como teste.</span></p>` : ''}
    ${opcao ? `<blockquote class="gancho-citado"><p>${esc(opcao.fala)}</p>${opcao.tela ? `<p class="pequeno apagado">Na tela: ${esc(opcao.tela)}</p>` : ''}</blockquote>` : ''}
    <dl class="confirmacao">${itens.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
    ${listaRespostas(perguntas, regras)}
    ${erro ? `<p class="nota atencao" role="alert">${ic('alerta')}<span>${esc(erro)}</span></p>` : ''}`;
  const rotulo = outros ? 'Pedir outros 3' : `Usar o gancho ${Number(escolha)}`;
  const rodape = `<button type="button" class="botao calmo" data-acao="fechar-janela">${erro ? 'Fechar' : 'Cancelar'}</button>${erro ? ''
    : `<button type="button" class="botao primario" data-acao="gancho-confirmar" data-id="${esc(id)}"${enviando ? ' disabled aria-busy="true"' : ''}>${enviando ? 'Enviando…' : esc(rotulo)}</button>`}`;
  return moldura(esc(outros ? 'Pedir outros 3 ganchos?' : `Usar o gancho ${Number(escolha)}?`), corpo, rodape);
}

/** Detalhe na etapa 'ganchos': as opções à esquerda, "Sua escolha" à direita e o histórico. */
function vGanchos(r) {
  const opts = { email: Integra.email(), local: estado.ganchosEnviados?.[r.id] || null, agora: new Date() };
  const [texto, tom] = passoDe(r);
  return `
  ${voltar('roteiros', 'Roteiros')}
  ${cab(r.titulo, '', r.id)}
  <div class="meta" style="margin:-.875rem 0 1.625rem">${selo(texto, tom)}${r.teste ? selo('Teste') : ''}</div>
  <div class="roteiro-grade">
    <section class="painel" aria-labelledby="t-ganchos">${painelGanchos(r, opts)}</section>
    <aside class="painel pilha fixo" aria-label="Sua escolha">${escolhaDosGanchos(r, opts)}</aside>
    ${blocoHistorico(historicoComExecucoes(r.eventos, execucoesLidas().execucoes, r.id), 'roteiro-historia')}
  </div>
  ${rodapeAtualizado()}`;
}

function acoesDe(r) {
  if (r.etapa === 'rascunho') {
    return decisaoDoRascunho(r, {
      email: Integra.email(), escolha: estado.decisaoRoteiro[r.id] || '', exec: execucoesLidas(), erros: estado.erros, agora: new Date(),
      vista: versaoVistaDe(r, estado.versaoRoteiroVista), locais: estado.decisoesEnviadas,
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
    if (r.etapa === 'ganchos') return vGanchos(r);
    const abas = [['ig', 'Instagram'], ['tt', 'TikTok'], ['extras', 'Extras'], ['fontes', 'Fontes']];
    const aba = abas.some(([valor]) => valor === estado.abaRoteiro) ? estado.abaRoteiro : 'ig';
    const v = validade(r); const [texto, tom] = passoDe(r);
    const vista = r.etapa === 'rascunho' ? versaoVistaDe(r, estado.versaoRoteiroVista) : r.versaoRoteiro;
    const doTexto = r.etapa === 'rascunho' ? roteiroDaVersao(r, vista) : { r, fase: 'pronto' };
    const dec = r.etapa === 'rascunho' ? seloDaDecisao(decisaoDe(r, { execucoes: execucoesLidas().execucoes || [], agora: new Date(), locais: estado.decisoesEnviadas })) : '';
    let painel;
    if (doTexto.fase === 'carregando') {
      painel = vazio(`Baixando a v${vista}`, 'O texto desta versão está vindo do Google Drive.');
    } else if (doTexto.fase === 'erro') {
      painel = vazio(`Não consegui ler a v${vista}`, 'O Google Drive não entregou o arquivo desta versão agora.', `<button type="button" class="botao contorno" data-acao="anexo-tentar">${ic('atualizar', 18)} Tentar de novo</button>`);
    } else if (doTexto.r !== r) {
      const rv = doTexto.r;
      painel = aba === 'extras' ? painelExtras(rv) : aba === 'fontes' ? painelFontes(rv) : painelFalas(rv, aba);
      // O relatório de fontes é um arquivo só: a checagem é a da versão mais nova.
      if (aba === 'fontes') painel = `<p class="meta">${selo(r.fontesConferidas ? `Fontes conferidas na v${r.versaoRoteiro}` : `Fontes em checagem na v${r.versaoRoteiro}`, 'espera')}</p>${painel}`;
    } else if (!r.lido) {
      painel = r.erroTexto
        ? vazio('Não consegui ler o texto deste roteiro', `O Google Drive não entregou o arquivo agora.${linkDoDrive(r.arquivoRoteiro) ? ` Você pode ${linkDoDrive(r.arquivoRoteiro, 'abrir o roteiro no Drive')}.` : ''}`, `<button type="button" class="botao contorno" data-acao="atualizar">${ic('atualizar', 18)} Tentar de novo</button>`)
        : vazio('O texto deste roteiro não está no Drive', 'O arquivo do roteiro não apareceu em 2-Roteiros.');
    } else painel = aba === 'extras' ? painelExtras(r) : aba === 'fontes' ? painelFontes(r) : painelFalas(r, aba);
    return `
  ${voltar('roteiros', 'Roteiros')}
  ${cab(r.titulo, '', r.id)}
  <div class="meta" style="margin:-.875rem 0 1.625rem">${selo(texto, tom)}${dec}${r.lido ? selo(v.texto, v.tom) : ''}${r.formato ? selo(r.formato) : ''}${r.teste ? selo('Teste') : ''}</div>
  <div class="roteiro-grade">
    <section class="painel" aria-label="Conteúdo do roteiro">
      ${abasDeVersao(r, vista)}
      <div class="abas" role="tablist" aria-label="Partes do roteiro">${abas.map(([valor, nome]) => `<button type="button" class="aba" role="tab" id="aba-${valor}" aria-selected="${aba === valor}" aria-controls="painel-roteiro" tabindex="${aba === valor ? 0 : -1}" data-acao="aba" data-valor="${valor}">${nome}</button>`).join('')}</div>
      <div role="tabpanel" id="painel-roteiro" aria-labelledby="aba-${aba}">${painel}</div>
    </section>
    <aside class="painel pilha fixo" aria-label="Ações do roteiro">${acoesDe(r)}</aside>
    ${blocoHistorico(historicoComExecucoes(r.eventos, execucoesLidas().execucoes, r.id), 'roteiro-historia')}
  </div>
  ${rodapeAtualizado()}`;
  });
}
