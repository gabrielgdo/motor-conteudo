// Dados do app: monta, a partir do Drive (via Integra), os roteiros no MESMO formato de objeto que
// as telas do desenho aprovado usam. Guarda tudo em memória; nada de dado de exemplo.
//
//   carregar({forcar})  lê listagens + postados, baixa o texto de cada roteiro ativo (até 4 ao
//                       mesmo tempo, cache por fileId + modifiedTime) e monta os objetos.
//   montarRoteiro(...)  a parte pura (projeto de model.js + roteiro lido por roteiro.js → objeto
//                       do desenho aprovado), testada em tests/dados.test.mjs.
//   rot, porEtapa, ativos, ultima, falasDe, semPostar, semana, estadoDados …  atalhos das telas.
//
// Fases: 'vazio' (nada pedido) → 'carregando' (sem nada na tela) | 'atualizando' (com dados) →
// 'pronto' | 'erro' (só quando não há nada para mostrar). Cada mudança emite 'motor:dados'.

import { CONFIG, CACHE_MS } from './config.js';
import { Integra } from './integra.js';
import { montarProjetos, historico, checagemConcluida, escolhaDosUltimosGanchos, decisaoDoUltimoStoryboard } from './model.js';
import { etapaDe } from './etapas.js';
import { lerRoteiro } from './roteiro.js';
import { lerGanchos, escolhaValida } from './ganchos.js';
import { lerEscolhaGancho } from './pedidos-motor.js';
import { lerStoryboard, lerDecisaoStoryboard, decisaoValida } from './storyboard.js';
import { prefixoSemana, semanaIso, classificarArquivoPacote } from './parse.js';
import { lerPerguntasRegra, ridValido } from './regras.js';
import { quando, periodoDaSemana, tamanho } from './util.js';

/* =================================================================== puro */

/** Semana atual (ISO, fuso de São Paulo): {ano, numero, codigo:'S46', periodo:'9 a 15 de novembro'}. */
export function semanaDe(agora = new Date()) {
  const { ano, semana } = semanaIso(agora);
  return { ano, numero: semana, codigo: prefixoSemana(agora), periodo: periodoDaSemana(agora) };
}

/** O arquivo de texto do roteiro: o aprovado, se houver; senão o último rascunho. */
export function arquivoDoRoteiro(p) {
  return p?.roteiro || p?.ultimoRascunho?.file || null;
}

/** Etapas em que o texto do roteiro é baixado (pronto/arquivado ficam só com o pacote). */
export const precisaDoTexto = (etapa) => !!etapa && etapa !== 'pronto' && etapa !== 'arquivado';

// Título pelo nome do arquivo: "<id> - <título>.md", pasta "<id> - <título>" ou
// "<id> <título> rascunho vN.md" (o título no meio é opcional).
function tituloDoNome(p) {
  if (p.titulo) return p.titulo;
  const nome = p.ultimoRascunho?.file?.name || '';
  const meio = nome.slice(p.id.length).replace(/\s*rascunho v\d+\.md$/i, '').replace(/^[\s\-–—]+|[\s\-–—]+$/g, '');
  return meio || '';
}

const PARTES_FIXAS = { GANCHO: 'Gancho', PROMESSA: 'Promessa', VIRADA: 'Virada', FALA: 'Fala', FECHAMENTO: 'Fechamento' };

/** Bloco do formato com etiquetas → fala do desenho aprovado. `rotulos` = todas as etiquetas do roteiro. */
function falaDeBloco({ rotulo, texto }, rotulos) {
  const r = String(rotulo || '').toUpperCase().trim();
  let m = r.match(/^(GANCHO|FECHAMENTO) (IG|TT)$/);
  if (m) {
    const parte = PARTES_FIXAS[m[1]];
    const rede = m[2].toLowerCase();
    // Sem a versão TT, a de IG vale nas duas redes (mesma regra de roteiro.py / formatos.md).
    if (rede === 'ig' && !rotulos.has(`${m[1]} TT`)) return { parte, texto };
    return { parte, rede, texto };
  }
  m = r.match(/^PONTO (\d+)$/);
  if (m) return { parte: `Ponto ${m[1]}`, texto };
  if (PARTES_FIXAS[r]) return { parte: PARTES_FIXAS[r], texto };
  return { parte: r ? r.charAt(0) + r.slice(1).toLowerCase() : 'Fala', texto };
}

function falasDoRoteiro(lido) {
  if (lido.formato_roteiro === 'novo') {
    // Primeiro parágrafo = abertura; os demais, Parte 1, Parte 2...
    const par = (lista, rede) => (lista || []).map((texto, i) => ({
      parte: i === 0 ? 'Abertura' : `Parte ${i}`, ...(rede ? { rede } : {}), texto,
    }));
    return lido.tt_proprio
      ? [...par(lido.paragrafos.ig, 'ig'), ...par(lido.paragrafos.tt, 'tt')]
      : par(lido.paragrafos.ig);
  }
  const rotulos = new Set((lido.blocos || []).map((b) => String(b.rotulo).toUpperCase().trim()));
  return (lido.blocos || []).filter((b) => b.texto).map((b) => falaDeBloco(b, rotulos));
}

const unicos = (lista) => [...new Set(lista.map((s) => String(s || '').trim()).filter(Boolean))];

function ganchosDoRoteiro(lido) {
  if (lido.formato_roteiro === 'novo') {
    const alt = lido.aberturas_alternativas || [];
    return { ig: unicos([lido.abertura?.ig, ...alt]), tt: unicos([lido.abertura?.tt, ...alt]) };
  }
  const ig = unicos((lido.ganchos?.instagram || []).map((g) => g.texto));
  const tt = unicos((lido.ganchos?.tiktok || []).map((g) => g.texto));
  return { ig: ig.length ? ig : unicos([lido.abertura?.ig]), tt: tt.length ? tt : unicos([lido.abertura?.tt]) };
}

/** Linhas de um texto livre, sem marcadores de lista. */
function linhas(txt) {
  return String(txt || '').split('\n')
    .map((l) => l.trim().replace(/^(?:\d+[.)]|[-*•])\s+/, '').trim())
    .filter(Boolean);
}

const maiuscula = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const CHECAGENS = new Set(['confirmada', 'divergente', 'nao-encontrada']);

/** Textos do histórico (model.historico) no tom das telas. */
function textoHistorico(t) {
  let m = t.match(/^Prévia v(\d+)$/);
  if (m) return `Prévia v${m[1]} pronta`;
  m = t.match(/^Rascunho v(\d+)$/);
  if (m) return `Rascunho v${m[1]} do Roteirista`;
  m = t.match(/^Ajustes v(\d+) pedidos$/);
  if (m) return `Ajustes pedidos na v${m[1]}`;
  m = t.match(/^Ganchos v(\d+)$/);
  if (m) return `3 ganchos propostos (v${m[1]})`;
  m = t.match(/^Gancho escolhido \(v(\d+)\)$/);
  if (m) return `Você escolheu nos ganchos v${m[1]}`;
  m = t.match(/^Storyboard v(\d+)$/);
  if (m) return `Storyboard v${m[1]} pronto`;
  m = t.match(/^Decisão do storyboard v(\d+)$/);
  if (m) return `Você decidiu o storyboard v${m[1]}`;
  return { 'Relatório de fontes': 'Fontes conferidas', 'Pacote pronto': 'Pacote final pronto', Vencedor: 'Marcado como vencedor' }[t] || t;
}

export const TIPOS_PACOTE = {
  ig: 'Vídeo do Instagram', tt: 'Vídeo do TikTok',
  igSemMusica: 'Vídeo do Instagram, sem música', ttSemMusica: 'Vídeo do TikTok, sem música',
  capaIg: 'Capa do Instagram', capaTt: 'Capa do TikTok',
  legendaIg: 'Legenda do Instagram', legendaTt: 'Legenda do TikTok',
  carrossel: 'Carrossel', stories: 'Stories', threads: 'Texto do Threads',
  creditos: 'Créditos', agenda: 'Horários sugeridos', outro: 'Outro arquivo',
};
const ORDEM_PACOTE = Object.keys(TIPOS_PACOTE);

function arquivosDoPacote(files) {
  return (files || []).map((f) => {
    const c = classificarArquivoPacote(f.name, f.sub);
    const imagem = c.tipo === 'carrossel' || c.tipo === 'stories';
    return {
      tipo: imagem && c.ordem !== 999 ? `${TIPOS_PACOTE[c.tipo]}, imagem ${c.ordem}` : TIPOS_PACOTE[c.tipo],
      chave: c.tipo,
      ordem: c.ordem ?? 0,
      nome: f.sub ? `${f.sub}/${f.name}` : f.name,
      tam: f.size ? tamanho(f.size) : '',
      file: f,
    };
  }).sort((a, b) => ORDEM_PACOTE.indexOf(a.chave) - ORDEM_PACOTE.indexOf(b.chave)
    || a.ordem - b.ordem || a.nome.localeCompare(b.nome));
}

/**
 * O primeiro arquivo VÁLIDO de uma versão (vale a primeira decisão válida de cada versão, como no motor): `ler(f)` dá
 * o conteúdo lido (ou lança), `valida(lido)` diz se vale sozinho. → {lido, file} | {incerto: true, file} (um arquivo
 * antes do válido não pôde ser lido: não dá para saber qual vale) | null (nenhum válido).
 */
export async function primeiraValida(arquivos, ler, valida) {
  for (const f of arquivos || []) {
    let lido;
    try { lido = await ler(f); } catch { return { incerto: true, file: f }; }
    if (lido == null) return { incerto: true, file: f };
    if (valida(lido)) return { lido, file: f };
  }
  return null;
}

/** Há uma decisão em vigor? Sem o conteúdo (não baixado, erro, ou um arquivo antes do válido que não leu): se existe
    arquivo, conta como decidida (bloqueia), como antes; lido, só a primeira VÁLIDA conta. → {tem, file}. */
function decisaoEmVigor(existe, lido, chaveArq, chaveIncerta) {
  if (!existe) return { tem: false, file: null };
  if (!lido || lido.erro) return { tem: true, file: existe.file };
  if (lido[chaveArq]) return { tem: true, file: lido[chaveArq] };
  if (lido[chaveIncerta]) return { tem: true, file: existe.file };
  return { tem: false, file: null };
}

/**
 * A proposta de ganchos na etapa 'ganchos' (js/ganchos.js lê e decide o estado): a versão mais nova, as 3 opções
 * lidas do arquivo e a escolha em vigor para essa versão: a primeira VÁLIDA (como no motor; js/ganchos.js
 * escolhaValida). `lidoG`: {ganchos: lerGanchos(...)|null, escolha: lerEscolhaGancho(...)|null (a válida),
 * escolhaArq: o arquivo dela|null, escolhaIncerta, erro} ou null (não baixado).
 */
export function propostaDeGanchos(p, lidoG = null) {
  if (!p?.ultimosGanchos) return null;
  const esc = escolhaDosUltimosGanchos(p);
  const g = lidoG?.ganchos || null;
  const vigor = decisaoEmVigor(esc, lidoG, 'escolhaArq', 'escolhaIncerta');
  return {
    versao: p.ultimosGanchos.v,
    arquivo: p.ultimosGanchos.file,
    titulo: g?.titulo || '',
    opcoes: g ? g.opcoes.map((o) => ({ ...o })) : [],
    lido: !!g && g.opcoes.length > 0,
    erro: !!lidoG?.erro,
    temEscolha: vigor.tem,
    escolhaEm: vigor.file?.createdTime || vigor.file?.modifiedTime || null,
    escolha: vigor.tem && lidoG?.escolha ? { escolha: lidoG.escolha.escolha, observacoes: lidoG.escolha.observacoes } : null,
    // perguntas de regra, se o arquivo dos ganchos trouxer a seção (js/regras.js); só as deste roteiro
    regras: perguntasDoId(g?.regras, p.id),
  };
}

/** As perguntas de regra lidas, só as deste roteiro (cópias). */
function perguntasDoId(lista, id) {
  return (lista || []).filter((q) => ridValido(q?.rid, id)).map((q) => ({ ...q }));
}

/**
 * O storyboard na etapa 'storyboard' (js/storyboard.js decide o estado): a versão mais nova, os quadros lidos do .md
 * (cada um com o arquivo da imagem achado na pasta e, se uma peça de motion entra nele, a tira: [{arquivo, file}], com
 * `novo`) e a decisão em vigor para essa versão: a primeira VÁLIDA (como no
 * motor; js/storyboard.js decisaoValida). `lidoS`: {md: lerStoryboard(...)|null, arquivos: [arquivos da pasta],
 * decisao: lerDecisaoStoryboard(...)|null (a válida), decisaoArq: o arquivo dela|null, decisaoIncerta, erro} ou null
 * (não baixado).
 */
export function storyboardDe(p, lidoS = null) {
  if (!p?.ultimoStoryboard) return null;
  const existe = decisaoDoUltimoStoryboard(p);
  const vigor = decisaoEmVigor(existe, lidoS, 'decisaoArq', 'decisaoIncerta');
  const dec = vigor.tem ? { file: vigor.file } : null;
  const md = lidoS?.md || null;
  const porNome = new Map((lidoS?.arquivos || []).map((f) => [String(f.name || '').trim().toLowerCase(), f]));
  const quadros = { ig: [], tt: [] };
  for (const rede of ['ig', 'tt']) {
    for (const q of md?.quadros?.[rede] || []) {
      const tira = (q.tira || []).map((arquivo) => ({ arquivo, file: porNome.get(arquivo.toLowerCase()) || null }));
      quadros[rede].push({ ...q, file: porNome.get(q.arquivo.toLowerCase()) || null, tira, novo: !!q.novo && tira.length > 0 });
    }
  }
  return {
    versao: p.ultimoStoryboard.v,
    arquivo: p.ultimoStoryboard.md,
    pasta: p.ultimoStoryboard.pasta,
    redes: md?.redes || [],
    notas: md ? [...md.notas] : [],
    mudancas: md ? md.mudancas.map((x) => ({ ...x })) : [],
    // "## Regra que esbarra no seu pedido": as perguntas para ela responder com a decisão (js/regras.js)
    regras: perguntasDoId(md?.regras, p.id),
    quadros,
    lido: !!md && quadros.ig.length + quadros.tt.length > 0,
    erro: !!lidoS?.erro,
    temDecisao: !!dec,
    decisaoEm: dec?.file?.createdTime || dec?.file?.modifiedTime || null,
    decisao: dec && lidoS?.decisao ? { ...lidoS.decisao } : (dec ? { decisao: '' } : null),
  };
}

/**
 * Projeto (montarProjetos) + roteiro lido (lerRoteiro, ou null se não foi baixado) → objeto de
 * roteiro do desenho aprovado. `opcoes.postadosLidos`: a planilha Radar foi lida (senão, nada de "postado").
 * `opcoes.ganchosLido`: os ganchos (e a escolha) baixados para a etapa 'ganchos' (propostaDeGanchos).
 * `opcoes.perguntasRegra`: as perguntas de regra do último rascunho (lerPerguntasRegra), para a etapa 'rascunho'.
 */
export function montarRoteiro(p, lido, agora = new Date(), { postadosLidos = true, ganchosLido = null, storyboardLido = null, perguntasRegra = [] } = {}) {
  const etapa = etapaDe(p);
  const propostaGanchos = etapa === 'ganchos' ? propostaDeGanchos(p, ganchosLido) : null;
  const storyboard = etapa === 'storyboard' ? storyboardDe(p, storyboardLido) : null;
  const titulo = String(lido?.cabecalho?.titulo || '').trim() || tituloDoNome(p) || propostaGanchos?.titulo || p.id;
  const sem = semanaDe(agora);
  const ajustesPorV = new Map(p.ajustes.map((a) => [a.v, a.file]));

  const r = {
    id: p.id,
    titulo,
    curto: titulo,
    etapa,
    teste: !!p.teste,
    arquivado: etapa === 'arquivado' || (etapa === 'pronto' && !new RegExp(`^${sem.codigo}-\\d{2}$`).test(p.id)),
    versaoRoteiro: p.ultimoRascunho?.v ?? 1,
    // Todas as versões do rascunho (abas v1 · v2 · v3 no detalhe) e se o roteiro final já existe.
    versoesRoteiro: (p.rascunhos || []).map((x) => x.v),
    arquivosRascunho: (p.rascunhos || []).map((x) => ({ v: x.v, file: x.file })),
    temFinal: !!p.roteiro,
    fontesConferidas: checagemConcluida(p),
    // Etapa 'ganchos' (desde 15/11/2026): as 3 opções para ela escolher; null nas outras etapas.
    propostaGanchos,
    // Etapa 'storyboard' (desde 15/11/2026): os quadros para ela aprovar ou pedir mudança; null nas outras etapas.
    storyboard,
    // Etapa 'rascunho': as perguntas de regra do último rascunho (plano de mídia, §6), para ela responder com a decisão.
    perguntasRegra: etapa === 'rascunho' ? perguntasDoId(perguntasRegra, p.id) : [],
    arquivoRoteiro: arquivoDoRoteiro(p),
    ...camposDoLido(lido),
    video: {
      versoes: p.previas.versoes.map((x) => ({
        n: x.v,
        quando: x.created ? quando(x.created, agora) : '',
        criadoEm: x.created || null,
        ig: x.ig || null,
        tt: x.tt || null,
        notas: x.notas || null,
        storyboard: { ig: x.sbIg || null, tt: x.sbTt || null },
        ajustes: ajustesPorV.get(x.v) || null,
      })),
      pendentes: [],
      historico: historico(p).map((e) => [quando(e.quando, agora), textoHistorico(e.texto)]),
    },
    // O mesmo histórico com a data (ISO), para juntar com as linhas de Execuções do id.
    eventos: historico(p).map((e) => ({ quando: e.quando, texto: textoHistorico(e.texto) })),
    pacote: null,
    vencedor: !!p.vencedor,
  };

  if (p.pacote) {
    const data = postadosLidos && p.postado ? (p.postado.data || null) : null;
    r.pacote = {
      pasta: p.pacote.folder,
      arquivos: arquivosDoPacote(p.pacote.files),
      // A planilha guarda uma "data do post" por vídeo (não por rede): vale para as duas.
      postado: { ig: data, tt: data },
      postadoConhecido: !!postadosLidos,
      sugestao: null,
    };
  }
  return r;
}

/**
 * Os campos de TEXTO do roteiro (falas, ganchos, legendas, extras, fontes) a partir do roteiro
 * lido (lerRoteiro) ou null. montarRoteiro usa para a versão da vez; a tela usa para mostrar uma
 * versão anterior do rascunho (abas v1 · v2 · v3).
 */
export function camposDoLido(lido) {
  return {
    lido: !!lido,
    valido_ate: lido?.valido_ate || '',
    formato: lido?.formato || '',
    formatoRoteiro: lido?.formato_roteiro || '',
    ganchos: lido ? ganchosDoRoteiro(lido) : { ig: [], tt: [] },
    falas: lido ? falasDoRoteiro(lido) : [],
    notas: lido ? (lido.apoio_visual?.length ? [...lido.apoio_visual] : linhas(lido.notas_intencao)) : [],
    entrega: lido?.entrega || '',
    // Formato com etiquetas: a "Versão teleprompter" (se houver). No novo, o teleprompter são as falas.
    teleprompter: lido && lido.formato_roteiro !== 'novo' ? String(lido.teleprompter || '').trim() : '',
    duracaoEstimada: lido?.duracao_estimada || '',
    legendas: { ig: lido?.legendas?.instagram || '', tt: lido?.legendas?.tiktok || '' },
    carrossel: lido?.carrossel ? [...lido.carrossel] : [],
    threads: lido?.threads || '',
    stories: (lido?.stories_detalhe || []).map((s) => [maiuscula(s.tipo) || 'Story', s.texto]),
    fontes: (lido?.fontes_detalhe || []).map((f) => ({ ref: f.ref, checagem: CHECAGENS.has(f.checagem) ? f.checagem : '' })),
    checklist: (lido?.checklist_cfp || []).map((c) => ({ ...c })),
  };
}

/** Ordem das listas: semanas mais novas primeiro (S47 antes de S46), dentro da semana pelo número; depois T e R. */
export function compararIds(a, b) {
  const chave = (id) => {
    const m = String(id).match(/^([STR])(\d+)(?:-(\d+))?/);
    if (!m) return [9, 0, 0, String(id)];
    return [{ S: 0, T: 1, R: 2 }[m[1]], -Number(m[2]), Number(m[3] || 0), String(id)];
  };
  const x = chave(a.id ?? a);
  const y = chave(b.id ?? b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x[3].localeCompare(y[3]);
}

/** Roda `fn` sobre os itens com no máximo `limite` ao mesmo tempo. */
export async function emParalelo(itens, limite, fn) {
  let i = 0;
  const trabalhar = async () => { while (i < itens.length) { const item = itens[i++]; await fn(item); } };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhar));
}

/* ================================================================== estado */

const st = {
  fase: 'vazio',
  roteiros: [],
  semana: semanaDe(),
  postadosLidos: false,
  erro: null,
  carregadoEm: 0,
  offline: false,
  ligado: false,
  promessa: null,
};
const cacheLido = new Map(); // `${fileId}:${modifiedTime}` → roteiro lido
let geracao = 0; // sobe a cada limparDados (saída da conta): leituras em andamento são descartadas

function emitir() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('motor:dados'));
}

async function buscar(forcar, ger = geracao) {
  const agora = new Date();
  const [listagens, post] = await Promise.all([
    Integra.listagens(forcar),
    Integra.postados(forcar).then((m) => ({ m }), (erro) => ({ erro })),
  ]);
  const projetos = montarProjetos({ ...listagens, postados: post.m || new Map() });
  // Fora: testes em limpeza e ids sem etapa (ex.: só o relatório de fontes).
  const lista = [...projetos.values()].filter((p) => !p.limpar && etapaDe(p));

  const lidos = new Map();
  const perguntasLidas = new Map(); // id → as perguntas de regra do texto (o rascunho traz a seção, js/regras.js)
  // Pacotes da semana atual também: o roteiro ainda abre em Roteiros (teleprompter, legendas).
  const daSemanaAtual = new RegExp(`^${semanaDe(agora).codigo}-\\d{2}$`);
  const comTexto = lista.filter((p) => arquivoDoRoteiro(p)
    && (precisaDoTexto(etapaDe(p)) || (etapaDe(p) === 'pronto' && daSemanaAtual.test(p.id))));
  await emParalelo(comTexto, CONFIG.concorrencia, async (p) => {
    const f = arquivoDoRoteiro(p);
    const chave = `${f.id}:${f.modifiedTime || ''}`;
    try {
      if (!cacheLido.has(chave)) {
        const texto = await Integra.baixarTexto(f);
        const lido = lerRoteiro(texto, f.name);
        if (ger !== geracao) return; // saiu da conta enquanto baixava
        cacheLido.set(chave, lido);
        cacheLido.set(`q:${chave}`, lerPerguntasRegra(texto, p.id));
      }
      lidos.set(p.id, cacheLido.get(chave));
      perguntasLidas.set(p.id, cacheLido.get(`q:${chave}`) || []);
    } catch {
      lidos.set(p.id, null);
    }
  });

  // Etapa 'ganchos': o arquivo dos 3 ganchos (a versão mais nova) e a escolha dela para essa versão, se houver.
  const ganchosLidos = new Map();
  const comGanchos = lista.filter((p) => etapaDe(p) === 'ganchos' && p.ultimosGanchos);
  await emParalelo(comGanchos, CONFIG.concorrencia, async (p) => {
    const ler = async (f, interpretar) => {
      const chave = `g:${f.id}:${f.modifiedTime || ''}`;
      if (!cacheLido.has(chave)) {
        const v = interpretar(await Integra.baixarTexto(f));
        if (ger !== geracao) return null;
        cacheLido.set(chave, v);
      }
      return cacheLido.get(chave);
    };
    try {
      const ganchos = await ler(p.ultimosGanchos.file, lerGanchos);
      const esc = escolhaDosUltimosGanchos(p);
      // vale a primeira escolha VÁLIDA da versão (como no motor); os arquivos vêm do mais velho para o mais novo
      const vale = esc ? await primeiraValida(esc.arquivos || [esc.file], (f) => ler(f, lerEscolhaGancho),
        (l) => escolhaValida(l, { id: p.id, versao: esc.v, opcoes: ganchos?.opcoes })) : null;
      ganchosLidos.set(p.id, { ganchos, escolha: vale?.lido || null, escolhaArq: vale?.lido ? vale.file : null,
        escolhaIncerta: !!vale?.incerto, erro: false });
    } catch {
      ganchosLidos.set(p.id, { ganchos: null, escolha: null, escolhaArq: null, escolhaIncerta: false, erro: true });
    }
  });

  // Etapa 'storyboard': o .md mais novo, a lista de quadros da pasta e a decisão dela para essa versão, se houver.
  const storyboardsLidos = new Map();
  const comStoryboard = lista.filter((p) => etapaDe(p) === 'storyboard' && p.ultimoStoryboard);
  await emParalelo(comStoryboard, CONFIG.concorrencia, async (p) => {
    const sb = p.ultimoStoryboard;
    try {
      const chave = `s:${sb.md.id}:${sb.md.modifiedTime || ''}`;
      let lidoSb = cacheLido.get(chave);
      if (!lidoSb) {
        const md = lerStoryboard(await Integra.baixarTexto(sb.md));
        const arquivos = sb.pasta ? await Integra.drive.listarStoryboard(sb.pasta) : [];
        if (ger !== geracao) return;
        lidoSb = { md, arquivos };
        // o motor sobe os arquivos fora de ordem (o .md pode chegar antes das imagens): com quadro (ou imagem da tira)
        // faltando, não guarda (a próxima leitura, o "Atualizar" ou o "Tentar de novo" listam a pasta de novo)
        const nomes = new Set(arquivos.map((f) => String(f.name || '').trim().toLowerCase()));
        const completo = ['ig', 'tt'].every((r) => (md.quadros[r] || []).every((q) => [q.arquivo, ...(q.tira || [])]
          .every((a) => nomes.has(a.toLowerCase()))));
        if (completo) cacheLido.set(chave, lidoSb);
      }
      // vale a primeira decisão VÁLIDA da versão (como no motor); os arquivos vêm do mais velho para o mais novo
      const dec = decisaoDoUltimoStoryboard(p);
      const vale = dec ? await primeiraValida(dec.arquivos || [dec.file], async (f) => {
        const chaveD = `d:${f.id}:${f.modifiedTime || ''}`;
        if (!cacheLido.has(chaveD)) {
          const t = await Integra.baixarTexto(f);
          if (ger !== geracao) return null;
          cacheLido.set(chaveD, lerDecisaoStoryboard(t));
        }
        return cacheLido.get(chaveD);
      }, (l) => decisaoValida(l, { id: p.id, versao: dec.v })) : null;
      if (ger !== geracao) return;
      storyboardsLidos.set(p.id, { ...lidoSb, decisao: vale?.lido || null, decisaoArq: vale?.lido ? vale.file : null,
        decisaoIncerta: !!vale?.incerto, erro: false });
    } catch {
      storyboardsLidos.set(p.id, { md: null, arquivos: [], decisao: null, decisaoArq: null, decisaoIncerta: false, erro: true });
    }
  });

  const postadosLidos = !post.erro;
  const roteiros = lista.map((p) => {
    const r = montarRoteiro(p, lidos.get(p.id) || null, agora, {
      postadosLidos, ganchosLido: ganchosLidos.get(p.id) || null, storyboardLido: storyboardsLidos.get(p.id) || null,
      perguntasRegra: perguntasLidas.get(p.id) || [],
    });
    r.erroTexto = lidos.has(p.id) && !lidos.get(p.id);
    return r;
  }).sort(compararIds);
  return { roteiros, postadosLidos, semana: semanaDe(agora) };
}

/** Lê tudo de novo (com `forcar`, sem usar as listagens guardadas). Nunca rejeita. */
export function carregar({ forcar = false } = {}) {
  if (st.promessa) return st.promessa;
  if (forcar) Integra.invalidar();
  const ger = geracao;
  st.fase = st.roteiros.length ? 'atualizando' : 'carregando';
  st.erro = null;
  emitir();
  // Se ela sair da conta no meio da leitura (limparDados), o resultado é descartado.
  const promessa = buscar(forcar, ger).then((res) => {
    if (ger === geracao) Object.assign(st, res, { fase: 'pronto', erro: null, carregadoEm: Date.now() });
  }, (erro) => {
    if (ger !== geracao) return;
    st.erro = erro;
    st.fase = st.roteiros.length ? 'pronto' : 'erro';
  }).finally(() => {
    if (ger !== geracao) return;
    st.promessa = null;
    emitir();
  });
  st.promessa = promessa;
  // "Atualizar" (e a releitura automática) também relê Execuções e Pautas, na próxima vez que uma
  // tela pedir.
  if (forcar) vencerManual();
  return promessa;
}

/** Liga a releitura automática: ao voltar para a aba depois de CACHE_MS e quando a internet volta. */
export function iniciarDados() {
  if (typeof window === 'undefined') return;
  st.ligado = true;
  st.offline = navigator.onLine === false;
  if (iniciarDados.feito) return;
  iniciarDados.feito = true;
  window.addEventListener('offline', () => { st.offline = true; emitir(); });
  window.addEventListener('online', () => {
    st.offline = false;
    emitir();
    if (st.ligado && Integra.temSessao()) carregar({ forcar: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && st.ligado && Integra.temSessao() && st.fase !== 'carregando'
      && Date.now() - st.carregadoEm > CACHE_MS) carregar({ forcar: true });
  });
}

/** Ao sair: esquece tudo o que foi lido. */
export function limparDados() {
  geracao++;
  Object.assign(st, { fase: 'vazio', roteiros: [], postadosLidos: false, erro: null, carregadoEm: 0, ligado: false, promessa: null });
  cacheLido.clear();
  anexos.clear();
  filaAnexos.length = 0;
  for (const k of Object.keys(manual)) manual[k] = novaLeitura();
  Integra.app?.candidatos?.esquecer?.(); // pastas e estados dos candidatos lidos do Drive
}

/* ------------------------------- controle manual: Execuções e Pautas (planilha Radar) */

// Lidas sob demanda: a primeira tela (ou o contador da navegação) que pede dispara a leitura, uma
// vez por sessão e de novo depois de cada "Atualizar". A tela nunca espera: recebe o que já há
// ({fase:'carregando'} na primeira vez) e se redesenha com o evento 'motor:manual'. Erro não tenta
// de novo sozinho (só com "Atualizar" ou "Tentar de novo"). Sem internet, nada é pedido.
const novaLeitura = () => ({ fase: 'vazio', dados: null, erro: null, lidoEm: 0, vencido: false, promessa: null });
const manual = { execucoes: novaLeitura(), pautas: novaLeitura(), candidatos: novaLeitura() };
const LEITORES = {
  execucoes: (forcar) => Integra.execucoes.ler(forcar),
  pautas: (forcar) => Integra.planilha.lerPautas(forcar),
  candidatos: (forcar) => Integra.candidatos.ler(forcar),
};

function vencerManual() {
  for (const l of Object.values(manual)) if (l.fase !== 'vazio') l.vencido = true;
}

function lerManual(chave, forcar = false) {
  const l = manual[chave];
  if (l.promessa || !st.ligado || st.offline) return l;
  if (!forcar && l.fase !== 'vazio' && !l.vencido) return l;
  const ger = geracao;
  const reler = forcar || l.vencido;
  l.vencido = false;
  l.fase = l.dados ? 'atualizando' : 'carregando';
  l.promessa = LEITORES[chave](reler).then((dados) => {
    if (ger !== geracao) return;
    Object.assign(l, { dados, erro: null, fase: 'pronto', lidoEm: Date.now() });
  }, (erro) => {
    if (ger !== geracao) return;
    l.erro = erro;
    l.fase = l.dados ? 'pronto' : 'erro';
  }).finally(() => {
    if (ger !== geracao) return;
    l.promessa = null;
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('motor:manual'));
  });
  return l;
}

const vistaManual = (l) => ({ fase: l.fase, erro: l.erro, lidoEm: l.lidoEm, offline: st.offline, ...(l.dados || {}) });

/** Aba Execuções: {fase, erro, offline, execucoes?, cabecalho?, abaAusente?}. Dispara a leitura se preciso. */
export const execucoesLidas = () => vistaManual(lerManual('execucoes'));

/** Abas Seleção e Decisões: {fase, erro, offline, selecao?, decisoes?, colunasProntas?, decisoesAusente?}. */
export const pautasLidas = () => vistaManual(lerManual('pautas'));

/** Aba Candidatos: {fase, erro, offline, candidatos?, temIdExecucao?, abaAusente?}. */
export const candidatosLidas = () => vistaManual(lerManual('candidatos'));

/** Relê agora (depois de gravar ou disparar, e no "Tentar de novo"). */
export function relerManual(chave) {
  const l = manual[chave];
  if (!l) return;
  if (l.promessa) { l.vencido = true; return; } // relê assim que a leitura em andamento terminar
  lerManual(chave, true);
}

/* ------------------------------------------- anexos (textos lidos sob demanda) */

// Notas da prévia, pedidos de ajuste, legendas e horários do pacote: baixados só quando uma tela
// precisa. `anexo(arquivo)` devolve na hora {fase: 'carregando'|'pronto'|'erro', texto, erro} e,
// quando o texto chega (ou falha), emite 'motor:anexo' para a tela se redesenhar.
const anexos = new Map(); // `${fileId}:${modifiedTime}` → {fase, texto, erro}
const filaAnexos = []; // downloads esperando a vez (no máximo CONFIG.concorrencia ao mesmo tempo)
let anexosBaixando = 0;

function proximoAnexo() {
  while (anexosBaixando < CONFIG.concorrencia && filaAnexos.length) {
    const { chave, a, arquivo } = filaAnexos.shift();
    if (anexos.get(chave) !== a) continue; // esquecido (saiu da conta) antes da vez
    anexosBaixando++;
    Integra.baixarTexto(arquivo).then((texto) => { a.fase = 'pronto'; a.texto = String(texto || ''); }, (erro) => {
      a.fase = 'erro';
      a.erro = erro;
    }).finally(() => {
      anexosBaixando--;
      if (anexos.get(chave) === a && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('motor:anexo'));
      proximoAnexo();
    });
  }
}

export function anexo(arquivo) {
  if (!arquivo?.id) return null;
  const chave = `${arquivo.id}:${arquivo.modifiedTime || ''}`;
  let a = anexos.get(chave);
  if (!a) {
    a = { fase: 'carregando', texto: '', erro: null };
    anexos.set(chave, a);
    filaAnexos.push({ chave, a, arquivo });
    proximoAnexo();
  }
  return a;
}

/** Texto de um anexo quando ele já chegou; senão espera o download. */
export async function textoDoAnexo(arquivo) {
  const a = anexo(arquivo);
  if (!a) return '';
  if (a.fase === 'pronto') return a.texto;
  return String(await Integra.baixarTexto(arquivo) || '');
}

/** Esquece os anexos que falharam (o próximo desenho tenta de novo). */
export function tentarAnexosDeNovo() {
  for (const [k, a] of anexos) if (a.fase === 'erro') anexos.delete(k);
}

/* ================================================================= atalhos */

export const estadoDados = () => ({
  fase: st.fase, erro: st.erro, offline: st.offline, carregadoEm: st.carregadoEm, postadosLidos: st.postadosLidos,
});
export const temDados = () => st.fase === 'pronto' || st.fase === 'atualizando';
export const roteiros = () => st.roteiros;
export const semana = () => st.semana;
export const rot = (id) => st.roteiros.find((r) => r.id === id);
export const porEtapa = (...etapas) => st.roteiros.filter((r) => etapas.includes(r.etapa));
export const ativos = () => st.roteiros.filter((r) => !r.arquivado);
export const daSemana = () => ativos().filter((r) => new RegExp(`^${st.semana.codigo}-\\d{2}$`).test(r.id));
export const ultima = (r) => r.video.versoes[r.video.versoes.length - 1];
export const falasDe = (r, rede) => r.falas.filter((f) => !f.rede || f.rede === rede);
export const postouTudo = (r) => !!(r.pacote && r.pacote.postado.ig && r.pacote.postado.tt);
/** Pacotes sem "postado" — só quando a planilha foi lida (sem ela, não afirmamos nada). */
export const semPostar = () => (st.postadosLidos ? st.roteiros.filter((r) => r.pacote && !postouTudo(r)) : []);
