// Monta o "estado do motor" a partir das listagens do Drive. Puro: sem rede, sem DOM.
//
// Entrada (todas opcionais; arquivos no formato do files.list:
//   {id, name, mimeType, createdTime, modifiedTime, size, parents, webViewLink}):
//   roteiros    – filhos diretos de 2-Roteiros
//   rascunhos   – arquivos de todas as pastas 2-Roteiros/rascunhos*
//   brutos      – filhos de 3-Brutos
//   revisao     – filhos de 4-Revisao
//   prontos     – filhos diretos de 5-Prontos (pastas de pacote + "vencedores")
//   pacotes     – { <folderId>: [arquivos do pacote; os de carrossel/ e stories/ trazem `sub`] }
//   vencedores  – filhos de 5-Prontos/vencedores
//   postados    – Map id → 'AAAA-MM-DD' (ou Set de ids)
// Saída de montarProjetos: Map id → projeto.

import {
  parseRascunho, parseFontes, parseRoteiroAprovado, parseRevisao, parseBruto, parsePacote,
  parseVencedor, parseGanchos, parseEscolhaGancho, ehTeste, dataCurta, formatarData,
} from './parse.js';

export const MIME_PASTA = 'application/vnd.google-apps.folder';

export function ehPasta(f) {
  return f?.mimeType === MIME_PASTA;
}

// Compara datas ISO do Drive (strings comparáveis lexicograficamente, mas usamos Date por segurança).
function tempo(iso) {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? 0 : t;
}

function maisRecente(a, b) {
  if (!a) return b;
  if (!b) return a;
  return tempo(b.modifiedTime || b.createdTime) > tempo(a.modifiedTime || a.createdTime) ? b : a;
}

function novoProjeto(id) {
  return {
    id,
    titulo: '',
    teste: ehTeste(id),
    rascunhos: [],
    ultimoRascunho: null,
    // Ganchos antes do roteiro (desde 15/11/2026): "<id> ganchos vN.md" (o motor propõe 3) e "<id> gancho vN.md"
    // (a escolha dela), em rascunhos*. [{v, file}] em ordem de versão.
    ganchos: [],
    ultimosGanchos: null,
    escolhasGancho: [],
    fontes: null,
    roteiro: null,
    frontmatter: null,
    brutos: [],
    previas: { versoes: [], atual: null },
    ajustes: [],
    aprovado: null,
    limpar: null,
    pacote: null,
    vencedor: false,
    vencedorArquivo: null,
    postado: null,
    etapa: '',
  };
}

export function montarProjetos({
  roteiros = [], rascunhos = [], brutos = [], revisao = [], prontos = [], pacotes = {},
  vencedores = [], postados = new Map(),
} = {}) {
  const projetos = new Map();
  const proj = (id) => {
    if (!projetos.has(id)) projetos.set(id, novoProjeto(id));
    return projetos.get(id);
  };

  // 2-Roteiros (raiz): roteiros aprovados. Pastas (rascunhos*, arquivo/) são ignoradas aqui.
  for (const f of roteiros) {
    if (ehPasta(f)) continue;
    const r = parseRoteiroAprovado(f.name);
    if (!r) continue;
    const p = proj(r.id);
    if (maisRecente(p.roteiro, f) === f) {
      p.roteiro = f;
      p.titulo = r.titulo;
    }
  }

  // Rascunhos, ganchos, escolhas de gancho e relatórios de fontes (todas as pastas rascunhos*). Mesma versão em duas
  // pastas duplicadas: fica a mais recente.
  const rascPorId = new Map();
  const ganchosPorId = new Map();
  const escolhasPorId = new Map();
  const porVersao = (mapa, x, f) => {
    if (!mapa.has(x.id)) mapa.set(x.id, new Map());
    const porV = mapa.get(x.id);
    porV.set(x.v, maisRecente(porV.get(x.v), f));
  };
  for (const f of rascunhos) {
    if (ehPasta(f)) continue;
    const r = parseRascunho(f.name);
    if (r) { porVersao(rascPorId, r, f); continue; }
    const g = parseGanchos(f.name);
    if (g) { porVersao(ganchosPorId, g, f); continue; }
    const e = parseEscolhaGancho(f.name);
    if (e) { porVersao(escolhasPorId, e, f); continue; }
    const fo = parseFontes(f.name);
    if (fo) {
      const p = proj(fo.id);
      p.fontes = maisRecente(p.fontes, f);
    }
  }
  const emOrdem = (porV) => [...porV].map(([v, file]) => ({ v, file })).sort((a, b) => a.v - b.v);
  for (const [id, porV] of rascPorId) {
    const p = proj(id);
    p.rascunhos = emOrdem(porV);
    p.ultimoRascunho = p.rascunhos[p.rascunhos.length - 1];
  }
  for (const [id, porV] of ganchosPorId) {
    const p = proj(id);
    p.ganchos = emOrdem(porV);
    p.ultimosGanchos = p.ganchos[p.ganchos.length - 1];
  }
  // Escolha sem os ganchos (arquivados ou apagados) não cria projeto: não há o que mostrar.
  for (const [id, porV] of escolhasPorId) if (projetos.has(id)) proj(id).escolhasGancho = emOrdem(porV);

  // 3-Brutos: só os que começam com o id.
  for (const f of brutos) {
    if (ehPasta(f)) continue;
    const b = parseBruto(f.name);
    if (b?.id) proj(b.id).brutos.push(f);
  }

  // 4-Revisao.
  const versoesPorId = new Map();
  for (const f of revisao) {
    if (ehPasta(f)) continue;
    const r = parseRevisao(f.name);
    if (!r) continue;
    const p = proj(r.id);
    if (r.tipo === 'aprovado') { p.aprovado = maisRecente(p.aprovado, f); continue; }
    if (r.tipo === 'limpar') { p.limpar = maisRecente(p.limpar, f); continue; }
    if (r.tipo === 'ajustes') { p.ajustes.push({ v: r.v, file: f }); continue; }
    if (!versoesPorId.has(r.id)) versoesPorId.set(r.id, new Map());
    const porV = versoesPorId.get(r.id);
    if (!porV.has(r.v)) porV.set(r.v, { v: r.v, ig: null, tt: null, sbIg: null, sbTt: null, notas: null, created: null });
    const ver = porV.get(r.v);
    ver[r.tipo] = maisRecente(ver[r.tipo], f);
  }
  for (const [id, porV] of versoesPorId) {
    const p = proj(id);
    // Só conta como versão de prévia se houver vídeo IG ou TT.
    const versoes = [...porV.values()].filter((x) => x.ig || x.tt).sort((a, b) => a.v - b.v);
    for (const x of versoes) {
      const datas = [x.ig, x.tt].filter(Boolean).map((f) => f.createdTime).filter(Boolean).sort();
      x.created = datas[0] || null;
    }
    p.previas = { versoes, atual: versoes.length ? versoes[versoes.length - 1].v : null };
  }
  for (const p of projetos.values()) p.ajustes.sort((a, b) => a.v - b.v);

  // 5-Prontos: pastas de pacote (exceto "vencedores").
  for (const f of prontos) {
    if (!ehPasta(f) || f.name.trim().toLowerCase() === 'vencedores') continue;
    const pk = parsePacote(f.name);
    if (!pk) continue;
    const p = proj(pk.id);
    if (!p.pacote || maisRecente(p.pacote.folder, f) === f) {
      p.pacote = { folder: f, files: pacotes[f.id] || [] };
      if (!p.titulo && pk.titulo) p.titulo = pk.titulo;
    }
  }

  // Vencedores (pastas `<id>/` dentro de vencedores são ignoradas).
  for (const f of vencedores) {
    if (ehPasta(f)) continue;
    const v = parseVencedor(f.name);
    if (!v) continue;
    const p = proj(v.id);
    p.vencedor = true;
    p.vencedorArquivo = f;
  }

  // Postados (planilha do Radar): só marca projetos que existem no Drive.
  for (const p of projetos.values()) {
    if (postados instanceof Map && postados.has(p.id)) p.postado = { data: postados.get(p.id) };
    else if (postados instanceof Set && postados.has(p.id)) p.postado = { data: '' };
  }

  for (const p of projetos.values()) p.etapa = calcularEtapa(p);
  return projetos;
}

/** Brutos em 3-Brutos que não começam com um id (ex. IMG_1234.MOV). */
export function brutosSemId(brutos = []) {
  return brutos.filter((f) => !ehPasta(f) && parseBruto(f.name) && !parseBruto(f.name).id);
}

/* ------------------------------------------------------------- regras */

/** Rascunho existe e não há roteiro aprovado (o rascunho continua na pasta após aprovar). */
export function ehRoteiroParaAprovar(p) {
  return p.rascunhos.length > 0 && !p.roteiro;
}

/** Ganchos propostos e ainda sem rascunho nem roteiro: a etapa em que ela escolhe o gancho (desde 15/11/2026). */
export function ehGanchosParaEscolher(p) {
  return (p.ganchos || []).length > 0 && !p.rascunhos.length && !p.roteiro;
}

/** A escolha gravada para a versão MAIS NOVA dos ganchos ({v, file}), ou null (a vez é dela). */
export function escolhaDosUltimosGanchos(p) {
  const n = p?.ultimosGanchos?.v;
  if (!n) return null;
  return (p.escolhasGancho || []).find((e) => e.v === n) || null;
}

/** O relatório de fontes da última versão do rascunho já chegou? */
export function checagemConcluida(p) {
  if (!p.ultimoRascunho || !p.fontes) return false;
  const f = p.fontes;
  return tempo(f.modifiedTime || f.createdTime) >= tempo(p.ultimoRascunho.file.createdTime);
}

/** Maior versão N tem IG/TT, sem aprovado.md e sem `ajustes vM` com M ≥ N. */
export function ehPreviaNova(p) {
  const n = p.previas.atual;
  if (!n) return false;
  if (p.aprovado) return false;
  return !p.ajustes.some((a) => a.v >= n);
}

/** Pedido de ajustes vN ainda sem a versão N+1 → devolve {v, file}; senão null. */
export function ajusteEmAndamento(p) {
  const vs = new Set(p.previas.versoes.map((x) => x.v));
  const pendentes = p.ajustes.filter((a) => !vs.has(a.v + 1));
  return pendentes.length ? pendentes[pendentes.length - 1] : null;
}

export function ehPacoteSemPostei(p) {
  return !!p.pacote && !p.postado;
}

/** Roteiro aprovado sem bruto do id, sem prévia e sem pacote. */
export function ehAprovadoSemBruto(p) {
  return !!p.roteiro && p.brutos.length === 0 && p.previas.versoes.length === 0 && !p.pacote;
}

/** Estado do vídeo para os chips: 'aprovado' | 'ajustes' | 'nova' | null. */
export function estadoVideo(p) {
  if (p.aprovado || p.pacote) return 'aprovado';
  if (ajusteEmAndamento(p)) return 'ajustes';
  if (ehPreviaNova(p)) return 'nova';
  return null;
}

export function calcularEtapa(p) {
  if (p.postado) return p.postado.data ? `postado em ${dataCurta(p.postado.data)}` : 'postado';
  if (p.pacote) return 'pacote pronto';
  if (p.aprovado) return 'aprovado, finalizando';
  if (p.previas.atual) {
    const aj = ajusteEmAndamento(p);
    if (aj) return `ajustes v${aj.v} pedidos, motor trabalhando`;
    return `prévia v${p.previas.atual} para ver`;
  }
  if (p.brutos.length) return 'gravação enviada';
  if (p.roteiro) return 'aprovado, falta gravar';
  if (p.ultimoRascunho) {
    return checagemConcluida(p) ? 'roteiro para aprovar' : `rascunho v${p.ultimoRascunho.v} em checagem`;
  }
  if (p.ultimosGanchos) {
    return escolhaDosUltimosGanchos(p) ? 'gancho escolhido, motor escrevendo' : 'ganchos para escolher';
  }
  return '';
}

/* ------------------------------------------------------- agregações */

function lista(projetos) {
  return projetos instanceof Map ? [...projetos.values()] : [...projetos];
}

export function ordenarPorId(arr) {
  return arr.sort((a, b) => a.id.localeCompare(b.id));
}

/** O que está esperando por ela (tela Início). */
export function resumoEsperando(projetos) {
  const ps = lista(projetos);
  return {
    roteirosParaAprovar: ordenarPorId(ps.filter(ehRoteiroParaAprovar)),
    previasNovas: ps.filter(ehPreviaNova),
    pacotesSemPostei: ps.filter(ehPacoteSemPostei),
  };
}

export function aprovadosSemBruto(projetos) {
  return ordenarPorId(lista(projetos).filter(ehAprovadoSemBruto));
}

/** Projetos da semana: ids `S<WW>-NN` com o prefixo dado (ex. "S46"). */
export function projetosDaSemana(projetos, prefixo) {
  const re = new RegExp(`^${prefixo}-\\d{2}$`);
  return ordenarPorId(lista(projetos).filter((p) => re.test(p.id)));
}

/** Ids de teste ainda ativos (sem `<id> limpar.md`). */
export function testesAtivos(projetos) {
  return ordenarPorId(lista(projetos).filter((p) => p.teste && !p.limpar));
}

export const ETAPAS_SEMANA = [
  { chave: 'pautas', rotulo: 'Pautas', feito: (p) => p.rascunhos.length > 0 || (p.ganchos || []).length > 0 || !!p.roteiro },
  { chave: 'roteiros', rotulo: 'Roteiros', feito: (p) => !!p.roteiro },
  { chave: 'gravacao', rotulo: 'Gravação', feito: (p) => p.brutos.length > 0 || p.previas.versoes.length > 0 || !!p.pacote },
  { chave: 'revisao', rotulo: 'Revisão', feito: (p) => !!p.aprovado || !!p.pacote },
  { chave: 'postagem', rotulo: 'Postagem', feito: (p) => !!p.postado },
];

/** Progresso da semana: {total, etapas:[{chave, rotulo, feitos, total, completa}]}. */
export function progressoSemana(projetos, prefixo) {
  const ps = projetosDaSemana(projetos, prefixo);
  const total = ps.length;
  return {
    total,
    etapas: ETAPAS_SEMANA.map((e) => {
      const feitos = ps.filter(e.feito).length;
      return { chave: e.chave, rotulo: e.rotulo, feitos, total, completa: total > 0 && feitos === total };
    }),
  };
}

/** Projetos com prévia em 4-Revisao, mais recentes primeiro. */
export function projetosComPrevia(projetos) {
  const ultima = (p) => tempo(p.previas.versoes[p.previas.versoes.length - 1]?.created);
  return lista(projetos).filter((p) => p.previas.versoes.length > 0).sort((a, b) => ultima(b) - ultima(a));
}

/** Pacotes de 5-Prontos, mais recentes primeiro. */
export function projetosComPacote(projetos) {
  const t = (p) => tempo(p.pacote.folder.createdTime || p.pacote.folder.modifiedTime);
  return lista(projetos).filter((p) => p.pacote).sort((a, b) => t(b) - t(a));
}

/** Linha do tempo do projeto: [{quando (ISO), texto, file?}], em ordem cronológica. */
export function historico(p) {
  const ev = [];
  const add = (file, texto) => { if (file?.createdTime) ev.push({ quando: file.createdTime, texto, file }); };
  for (const g of p.ganchos || []) add(g.file, `Ganchos v${g.v}`);
  for (const e of p.escolhasGancho || []) add(e.file, `Gancho escolhido (v${e.v})`);
  for (const r of p.rascunhos) add(r.file, `Rascunho v${r.v}`);
  add(p.fontes, 'Relatório de fontes');
  add(p.roteiro, 'Roteiro aprovado');
  for (const b of p.brutos) add(b, `Gravação enviada (${b.name})`);
  for (const v of p.previas.versoes) {
    if (v.created) ev.push({ quando: v.created, texto: `Prévia v${v.v}`, file: v.ig || v.tt });
  }
  for (const a of p.ajustes) add(a.file, `Ajustes v${a.v} pedidos`);
  add(p.aprovado, 'Vídeo aprovado');
  if (p.pacote) add(p.pacote.folder, 'Pacote pronto');
  add(p.vencedorArquivo, 'Vencedor');
  return ev.sort((a, b) => tempo(a.quando) - tempo(b.quando));
}

/** Data `dd/mm` da gravação (primeiro bruto), ou ''. */
export function dataGravacao(p) {
  const datas = p.brutos.map((b) => b.createdTime).filter(Boolean).sort();
  return datas.length ? formatarData(datas[0]) : '';
}
