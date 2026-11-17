// Leitura de roteiros (formato do Roteirista: cabeçalho --- + seções ##). Puro: sem rede, sem DOM.
//
// Porta fiel de bin/roteiro.py (função `ler`): `lerRoteiro(texto, nomeArquivo)` devolve o mesmo
// objeto, com as mesmas chaves e os mesmos valores (paridade testada em tests/roteiro.test.mjs
// contra a saída real do Python). Só lê campos e seções conhecidos: o arquivo é DADO, não ordem.
//
// Para a paridade, as regex usam a semântica do Python 3 (`re` com str):
//   - `\s` do Python ≠ `\s` do JS (o JS aceita U+FEFF e não aceita \x1c-\x1f/\x85) → classe S;
//   - `\d` do Python aceita qualquer dígito Unicode → \p{Nd} (flag u);
//   - str.strip()/str.splitlines() reimplementados (pyStrip/pySplitlines);
//   - o arquivo é lido em modo texto (universal newlines: \r\n e \r viram \n).
// Única aproximação conhecida: unicodedata.combining(c) (classe combinante ≠ 0) é feito com
// \p{Mn}, que coincide para acentos latinos (só difere em marcas raras de outras escritas).
//
// Campos extras (o Python descarta; o app precisa): duracao_estimada, checklist_cfp,
// fontes_detalhe, stories_detalhe, valido_ate, status, formato.

// Conteúdo da classe `\s` do Python (str.isspace), para usar dentro e fora de [...].
const S_IN = '\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const S = `[${S_IN}]`;

/** Compila uma regex escrita como no Python: troca `\s` e `\d` pelas classes do Python (flag u). */
function re(src, flags = '') {
  let out = '';
  let emClasse = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1];
      i++;
      if (n === 's') out += emClasse ? S_IN : S;
      else if (n === 'd') out += '\\p{Nd}';
      else out += c + n;
      continue;
    }
    if (c === '[' && !emClasse) emClasse = true;
    else if (c === ']' && emClasse) emClasse = false;
    out += c;
  }
  return new RegExp(out, 'u' + flags);
}

const ID_SRC = '(S\\d{2}-\\d{2}|T\\d{2}(?:-\\d{2})?|R\\d{3})';
const RE_ID_INICIO = re('^' + ID_SRC);
const RE_ID_INTEIRO = re('^' + ID_SRC + '$');
const RE_ID_TESTE = re('^T\\d{2}(-\\d{2})?$');

// Iguais a CAMPOS de roteiro.py (que já inclui valido_ate, status, formato e extras).
export const CAMPOS = new Set(['id', 'titulo', 'plataformas', 'extras', 'duracao_alvo', 'formato', 'cta',
  'valido_ate', 'status', 'teste', 'bruto', 'voz', 'serie', 'tema_sensivel']);
export const SECOES = new Set(['ganchos', 'gancho', 'falas', 'notas de intenção para a edição',
  'notas de intencao para a edicao', 'legendas', 'legenda do post', 'carrossel', 'threads', 'stories',
  'fontes', 'referências', 'referencias', 'checklist cfp', 'versão teleprompter', 'versao teleprompter',
  'texto na tela', 'roteiro para gravar', 'entrega', 'aberturas alternativas', 'versão tiktok',
  'versao tiktok', 'apoio visual']);
const SO_IG = new Set(['GANCHO IG', 'FECHAMENTO IG']);
const SO_TT = new Set(['GANCHO TT', 'FECHAMENTO TT']);
export const DURACAO_PADRAO = '45 a 60 s';
const SEM_CTA = new Set(['nenhum', 'nenhuma', 'sem cta', 'nao', '-']);

/** Nome da estrutura sem o código interno ("E3 distinção" → "distinção"); texto livre fica como está. */
export function formatoLegivel(formato) {
  return String(formato ?? '').replace(/\s+/g, ' ').trim().replace(/^E\d{1,2}(?:\s*[-–—:.]\s*|\s+)/i, '').trim();
}

/**
 * O `cta` do cabeçalho ("instagram enviar; tiktok comentar") → [{rede: 'instagram'|'tiktok'|'', texto}], um por trecho
 * separado por ";". Trecho sem rede conhecida vai com rede ''. Vazio ou "nenhum" → [].
 */
export function fechosDoCta(cta) {
  const out = [];
  for (const parte of String(cta ?? '').split(';')) {
    const p = parte.replace(/\s+/g, ' ').trim();
    if (!p || SEM_CTA.has(normalizar(p).trim())) continue;
    const m = p.match(/^(instagram|ig|tiktok|tik tok|tt)\b\s*[:\-–—]?\s*(.*)$/i);
    if (m) out.push({ rede: /^(ig|instagram)$/i.test(m[1]) ? 'instagram' : 'tiktok', texto: m[2].trim() });
    else out.push({ rede: '', texto: p });
  }
  return out;
}
// "Duração estimada: 48 s", "**Duracao:** 50 s", "_Duração estimada_: ..." (linha ignorada)
const DURACAO_RE = re('^[\\s*_>(\\[-]*dura[cç][aã]o(?:\\s+estimada)?\\s*[*_]*\\s*[:–—-]', 'i');

/* ------------------------------------------------- utilitários do Python */

const RE_ESPACO_PY = new RegExp(S);
const ehEspacoPy = (c) => RE_ESPACO_PY.test(c);

/** str.strip() (sem argumento) ou str.strip(chars). */
function pyStrip(s, chars) {
  const tira = chars === undefined ? ehEspacoPy : (c) => chars.includes(c);
  let i = 0;
  let j = s.length;
  while (i < j && tira(s[i])) i++;
  while (j > i && tira(s[j - 1])) j--;
  return s.slice(i, j);
}

function pyLstrip(s) {
  let i = 0;
  while (i < s.length && ehEspacoPy(s[i])) i++;
  return s.slice(i);
}

function pyRstrip(s, chars) {
  let j = s.length;
  while (j > 0 && chars.includes(s[j - 1])) j--;
  return s.slice(0, j);
}

/** str.splitlines(): quebra em \n \r \r\n \v \f \x1c \x1d \x1e \x85 \u2028 \u2029; sem item final vazio. */
function pySplitlines(s) {
  const out = [];
  const reQuebra = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/g;
  let ini = 0;
  let m;
  while ((m = reQuebra.exec(s))) {
    out.push(s.slice(ini, m.index));
    ini = m.index + m[0].length;
  }
  if (ini < s.length) out.push(s.slice(ini));
  return out;
}

/** normalizar() de roteiro.py: minúsculas, NFD e sem marcas combinantes. */
export function normalizar(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
}

/** Path(caminho).name */
function nomeBase(caminho) {
  const partes = String(caminho ?? '').split('/').filter((x) => x !== '');
  return partes.length ? partes[partes.length - 1] : '';
}

/* --------------------------------------------------- helpers de roteiro.py */

/** Parágrafos separados por linha em branco; linhas internas juntas com espaço; sem duração. */
export function paragrafos(txt) {
  const out = [];
  let atual = [];
  for (const linha of [...pySplitlines(txt), '']) {
    const s = pyStrip(linha);
    if (DURACAO_RE.test(s)) continue;
    if (s) atual.push(s);
    else if (atual.length) {
      out.push(atual.join(' '));
      atual = [];
    }
  }
  return out;
}

const RE_ITEM_LISTA = re('^\\**(?:\\d+[.)]|[-*•])\\**\\s+(.*)$');

/** Itens numerados ou com marcador, sem a numeração; sem marcador nenhum, os parágrafos. */
export function lista(txt) {
  const out = [];
  for (const linha of pySplitlines(txt)) {
    const s = pyStrip(linha);
    const mm = s.match(RE_ITEM_LISTA);
    if (mm) out.push(pyStrip(mm[1]));
    else if (out.length && s) out[out.length - 1] += ' ' + s;
  }
  const filtrados = out.filter((x) => x);
  return filtrados.length ? filtrados : paragrafos(txt);
}

/** itens(txt, padrao) de roteiro.py: o último grupo da regex é o texto do item. */
function itens(txt, padrao) {
  const lst = [];
  for (const linha of pySplitlines(txt)) {
    const s = pyStrip(linha);
    const mm = s.match(padrao);
    if (mm) lst.push(pyStrip(mm[mm.length - 1] ?? ''));
    else if (lst.length && s) lst[lst.length - 1] += ' ' + s;
  }
  return lst;
}

const RE_CABECALHO = re('^\\s*---\\s*\\n([^]*?)\\n---\\s*\\n?([^]*)$');
const RE_SECAO = re('^##\\s+(.+?)\\s*$');
const RE_ROTULO = re('^\\[([A-ZÇÃÕÁÉÍÓÚ0-9 ]+)\\]\\s*(.*)$');
const RE_GANCHO_TITULO = re('^#+\\s*\\**(Instagram|TikTok)\\**\\s*:?\\s*()$', 'i');
const RE_GANCHO_REDE = re('^[-*]?\\s*\\**(Instagram|TikTok|IG|TT)\\**\\s*:\\**\\s*(.*)$', 'i');
const RE_GANCHO_SPLIT = re('(?:^|\\s)\\d+[.)]\\s+');
const RE_GANCHO_ITEM = re('^(?:\\d+[.)]|[-*•])\\s+(.*)$');
const RE_GANCHO_TIPO = re('^\\[([^\\]]*)\\]\\s*(.*)$');
const RE_LEGENDA = re('^\\s*(Instagram|TikTok)\\s*:\\s*(.*)$', 'i');
const RE_FONTE = re('^[-*•]\\s*(.*)$');
const RE_SLIDE = re('^(Slide\\s*\\d+\\s*:|###\\s*Slide\\s*\\d+)\\s*(.*)$');
const RE_STORY = re('^(\\d+[.)]|###\\s*Story\\s*\\d+)\\s*(.*)$');

/* ---------------------------------------------------------- lerRoteiro */

/**
 * Lê o texto de um roteiro .md e devolve o mesmo objeto que `roteiro.py` (mais os extras).
 * `nomeArquivo` é o nome no Drive (só o nome é usado, como Path(caminho).name).
 */
export function lerRoteiro(texto, nomeArquivo = '') {
  // read_text em modo texto: universal newlines.
  const t = String(texto ?? '').replace(/\r\n?/g, '\n');
  const cab = {};
  let corpo = t;
  const m = t.match(RE_CABECALHO);
  if (m) {
    for (const linha of pySplitlines(m[1])) {
      if (linha.includes(':') && !pyLstrip(linha).startsWith('#')) {
        const i = linha.indexOf(':');
        const k = pyStrip(linha.slice(0, i)).toLowerCase();
        const v = linha.slice(i + 1);
        if (CAMPOS.has(k)) cab[k] = pyStrip(v.split('  #')[0].split(' # ')[0]);
      }
    }
    corpo = m[2];
  }
  const tem = (k) => Object.hasOwn(cab, k);
  const get = (k, padrao) => (tem(k) ? cab[k] : padrao);

  const bruto = new Map();
  let atual = null;
  for (const linha of pySplitlines(corpo)) {
    const mm = linha.match(RE_SECAO);
    if (mm) {
      const nome = pyStrip(mm[1]).toLowerCase();
      atual = SECOES.has(nome) ? nome : null;
      if (atual) bruto.set(atual, []);
    } else if (atual) {
      bruto.get(atual).push(linha);
    }
  }
  const sec = new Map([...bruto].map(([k, v]) => [k, pyStrip(v.join('\n'))]));
  const secao = (k) => sec.get(k) ?? '';

  // falas com rótulos [GANCHO IG] ... ; texto sem rótulo continua o bloco anterior
  let blocos = [];
  const falasTxt = secao('falas');
  if (sec.has('gancho') && !/\[GANCHO/.test(falasTxt)) {
    blocos.push({ rotulo: 'GANCHO', texto: sec.get('gancho') });
  }
  for (const linha of pySplitlines(falasTxt)) {
    const s = pyStrip(linha);
    if (!s) continue;
    const mm = s.match(RE_ROTULO);
    if (mm) blocos.push({ rotulo: pyStrip(mm[1]), texto: pyStrip(mm[2]) });
    else if (blocos.length) {
      const b = blocos[blocos.length - 1];
      b.texto = pyStrip(b.texto + ' ' + s);
    } else blocos.push({ rotulo: 'FALA', texto: s });
  }

  const rotulos = new Set(blocos.map((b) => b.rotulo));
  const blocosRede = (rede) => blocos.filter((b) => {
    const r = b.rotulo;
    if (rede === 'ig' && SO_TT.has(r)) return false;
    // no TikTok, o gancho/fechamento de IG só sai se houver a versão TT correspondente
    if (rede === 'tt' && SO_IG.has(r) && rotulos.has(r.replace(' IG', ' TT'))) return false;
    return true;
  });
  const falas = (rede) => pyStrip(blocosRede(rede).map((b) => b.texto).join(' '));
  const aberturaAntiga = (rede) => {
    const bs = blocosRede(rede);
    const b = bs.find((x) => x.rotulo.startsWith('GANCHO')) ?? bs[0];
    return b ? b.texto : '';
  };

  const novo = sec.has('roteiro para gravar');
  let parIg; let parTt; let ttProprio; let falasD; let duasAberturas; let abertura; let teleprompter;
  if (novo) {
    parIg = paragrafos(sec.get('roteiro para gravar'));
    const ttTxt = sec.get('versão tiktok') || secao('versao tiktok');
    parTt = paragrafos(ttTxt);
    const inicioTt = normalizar(parTt.join(' ')).replace(/^[^a-z0-9]+/, '');
    ttProprio = parTt.length > 0 && !inicioTt.startsWith('mesmo roteiro');
    if (!ttProprio) parTt = parIg;
    blocos = [
      ...parIg.map((p) => ({ rotulo: 'FALA', texto: p })),
      ...(ttProprio ? parTt.map((p) => ({ rotulo: 'FALA TT', texto: p })) : []),
    ];
    const falaIg = parIg.join(' ');
    const falaTt = parTt.join(' ');
    falasD = { ig: falaIg, tt: falaTt, todas: falaIg + (ttProprio ? ' ' + falaTt : '') };
    duasAberturas = ttProprio && parTt.length > 0 && parTt[0] !== (parIg.length ? parIg[0] : null);
    abertura = { ig: parIg.length ? parIg[0] : '', tt: parTt.length ? parTt[0] : '' };
    teleprompter = parIg.join('\n\n');
  } else {
    parIg = []; parTt = []; ttProprio = false;
    falasD = { ig: falas('ig'), tt: falas('tt'), todas: blocos.map((b) => b.texto).join(' ') };
    duasAberturas = blocos.some((b) => SO_TT.has(b.rotulo));
    abertura = { ig: aberturaAntiga('ig'), tt: aberturaAntiga('tt') };
    teleprompter = sec.get('versão teleprompter') || secao('versao teleprompter');
  }

  const apoioTxt = secao('apoio visual');
  const cta = get('cta', '');
  const ctaNorm = pyStrip(pyRstrip(pyStrip(pyStrip(pyStrip(normalizar(cta)), '\'"')), '.!;,'));

  // ganchos por rede; "[tipo]" inicial é texto livre só para rastreio (nunca vai para falas)
  const ganchos = { instagram: [], tiktok: [] };
  let redeG = null;
  const addGancho = (rede, s0) => {
    const s = pyStrip(s0);
    if (!s) return;
    const mt = s.match(RE_GANCHO_TIPO);
    ganchos[rede].push(mt ? { tipo: pyStrip(mt[1]), texto: pyStrip(mt[2]) } : { tipo: '', texto: s });
  };
  for (const linha of pySplitlines(secao('ganchos'))) {
    const s = pyStrip(linha);
    if (!s) continue;
    let mm = s.match(RE_GANCHO_TITULO) || s.match(RE_GANCHO_REDE);
    if (mm) {
      redeG = ['instagram', 'ig'].includes(mm[1].toLowerCase()) ? 'instagram' : 'tiktok';
      for (const item of mm[2].split(RE_GANCHO_SPLIT)) addGancho(redeG, item);
    } else if (redeG && (mm = s.match(RE_GANCHO_ITEM))) {
      addGancho(redeG, mm[1]);
    } else if (redeG && ganchos[redeG].length) {
      const g = ganchos[redeG][ganchos[redeG].length - 1];
      g.texto = pyStrip(g.texto + ' ' + s);
    }
  }

  let legendas = {};
  for (const linha of pySplitlines(secao('legendas'))) {
    const mm = linha.match(RE_LEGENDA);
    if (mm) legendas[mm[1].toLowerCase() === 'instagram' ? 'instagram' : 'tiktok'] = pyStrip(mm[2]);
  }
  if (!Object.keys(legendas).length && sec.get('legenda do post')) {
    legendas = { instagram: sec.get('legenda do post'), tiktok: sec.get('legenda do post') };
  }

  const fontes = itens(sec.get('fontes') || sec.get('referências') || secao('referencias'), RE_FONTE);
  const plats = get('plataformas', 'instagram, tiktok').split(/[,;]/)
    .filter((p) => pyStrip(p)).map((p) => pyStrip(p).toLowerCase());
  const nome = nomeBase(nomeArquivo);
  const mid = nome.match(RE_ID_INICIO);
  const idNome = mid ? mid[1] : null;
  const stories = itens(secao('stories'), RE_STORY);

  return {
    arquivo: nome,
    id_no_nome: idNome,
    cabecalho: cab,
    id: get('id') || idNome,
    titulo: get('titulo', ''),
    plataformas: plats.map((p) => (p.startsWith('insta') ? 'ig' : p.startsWith('tik') ? 'tt' : p)),
    teste: ['sim', 'true', 'yes'].includes(get('teste', '').toLowerCase()) || RE_ID_TESTE.test(get('id', '')),
    bruto: get('bruto', '').toLowerCase(),
    blocos,
    falas: falasD,
    duas_aberturas: duasAberturas,
    notas_intencao: sec.get('notas de intenção para a edição') || sec.get('notas de intencao para a edicao')
      || apoioTxt,
    texto_na_tela: secao('texto na tela'),
    ganchos,
    legendas,
    carrossel: itens(secao('carrossel'), RE_SLIDE),
    threads: secao('threads'),
    stories,
    fontes,
    id_valido: RE_ID_INTEIRO.test(get('id') || idNome || ''),
    id_confere: !mid || !get('id') || idNome === get('id'),
    formato_roteiro: novo ? 'novo' : 'etiquetas',
    paragrafos: { ig: parIg, tt: parTt },
    abertura,
    tt_proprio: ttProprio,
    entrega: secao('entrega'),
    aberturas_alternativas: lista(secao('aberturas alternativas')),
    apoio_visual: lista(apoioTxt).slice(0, 3),
    teleprompter,
    cta,
    sem_cta: SEM_CTA.has(ctaNorm),
    duracao_alvo: get('duracao_alvo') || DURACAO_PADRAO,

    // ---- extras (não existem em roteiro.py)
    duracao_estimada: duracaoEstimada(sec.get('roteiro para gravar') ?? ''),
    checklist_cfp: checklist(secao('checklist cfp')),
    fontes_detalhe: fontes.map(fonteDetalhe),
    stories_detalhe: stories.map(storyDetalhe),
    valido_ate: get('valido_ate', ''),
    status: get('status', ''),
    formato: get('formato', ''),
  };
}

/* ------------------------------------------------------------- extras */

/** Valor da 1ª linha "Duração estimada: 48 s" (ou "Duração: ...") da seção, sem o rótulo; ou ''. */
function duracaoEstimada(txt) {
  for (const linha of pySplitlines(txt)) {
    const s = pyStrip(linha);
    const mm = s.match(DURACAO_RE);
    if (mm) return pyStrip(pyStrip(s.slice(mm[0].length)), '*_ ');
  }
  return '';
}

const RE_CHECK = re('^(?:[-*•]\\s*)?\\[([ xX✓✔]?)\\]\\s*(.*)$');
const RE_CHECK_SEM_CAIXA = re('^(?:\\d+[.)]|[-*•])\\s+(.*)$');

/** Itens de "## Checklist CFP": [{texto, marcado}]. Item sem caixa conta como não marcado. */
function checklist(txt) {
  const out = [];
  for (const linha of pySplitlines(txt)) {
    const s = pyStrip(linha);
    if (!s) continue;
    let mm = s.match(RE_CHECK);
    if (mm) { out.push({ texto: pyStrip(mm[2]), marcado: pyStrip(mm[1]) !== '' }); continue; }
    mm = s.match(RE_CHECK_SEM_CAIXA);
    if (mm) { out.push({ texto: pyStrip(mm[1]), marcado: false }); continue; }
    if (out.length) out[out.length - 1].texto = pyStrip(out[out.length - 1].texto + ' ' + s);
  }
  return out;
}

const RE_CHECAGEM = re('\\s*\\[\\s*checagem\\s*:\\s*([^\\]]*)\\]\\s*$', 'i');

/** "Autor, ano ... [checagem: não encontrada]" → {ref, checagem: 'nao-encontrada'}. */
export function fonteDetalhe(item) {
  const mm = item.match(RE_CHECAGEM);
  if (!mm) return { ref: pyStrip(item), checagem: '' };
  const c = normalizar(pyStrip(mm[1])).replace(/\s+/g, ' ');
  let checagem = '';
  if (c.startsWith('confirmad')) checagem = 'confirmada';
  else if (c.startsWith('divergent')) checagem = 'divergente';
  else if (/^nao[ -]encontrad/.test(c)) checagem = 'nao-encontrada';
  return { ref: pyStrip(item.slice(0, mm.index)), checagem };
}

const RE_TIPO_STORY = re('^\\(\\s*(enquete|caixinha|leva ao v[ií]deo)\\s*\\)\\s*', 'i');

/** "(enquete) Pergunta" → {tipo: 'enquete', texto: 'Pergunta'}; tipos: enquete | caixinha | leva ao vídeo | ''. */
export function storyDetalhe(item) {
  // roteiro.py deixa um espaço inicial nos itens "### Story N" (texto na linha seguinte).
  const s = pyStrip(item);
  const mm = s.match(RE_TIPO_STORY);
  if (!mm) return { tipo: '', texto: s };
  const t = normalizar(mm[1]);
  return { tipo: t === 'leva ao video' ? 'leva ao vídeo' : t, texto: s.slice(mm[0].length) };
}
