// Testes do estado do candidato NO APP (pontos 2 e 3): `_motor/app/candidatos/<id>.json` no Drive,
// sem o Radar e sem tocar a planilha. Planejador (permissão, ids T, pedido em andamento, pauta já
// criada), leitura/gravação com um Drive falso (pastas criadas na primeira vez, dois arquivos com o
// mesmo nome → vale o modifiedTime mais novo, nada fora da pasta do app), mescla com o estado
// otimista, contadores dos chips e do Início, a tela (Excluir, Excluídos (n) com Restaurar, o bloco
// "Candidatos para decidir" com as 4 ações, gravando, erro com "Tentar de novo"), as janelas,
// desfazer, escape e o layout da v17 (≤ 2 selos, linha-id, Detalhes). Sem rede; ids fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED, FLAGS } from '../js/config.js';
FLAGS.ponte = false;
import { lerExecucoes, COLUNAS_EXECUCOES } from '../js/controle.js';
import { lerSelecao, lerDecisoes } from '../js/selecao.js';
import {
  lerCandidatos, contarCandidatos, contarCandidatosParaDecidir, planejarEstadoCandidato, lerArquivoCandidato,
  maisNovoPorNome, mesclarEstadosApp, separarCandidatos, criarArquivosDoApp, caminhoArquivoCandidato, ESTADOS_APP,
} from '../js/candidatos.js';
import {
  htmlPautas, htmlCandidatos, contarParaDecidir, blocoCandidatosParaDecidir, gruposDeCandidatos,
  janelaExcluirCandidato, janelaRecusarCandidato, textoDoEstadoGravado, NOTA_SO_ROBERTTA,
} from '../js/telas/pautas.js';
import { estadoDoCandidato } from '../js/candidatos.js';

const ROBERTTA = ALLOWED[0];
const GABRIEL = ALLOWED[1];
const AGORA = new Date('2026-11-18T13:30:00Z');
const Q1 = '2026-11-18T12:00:00.000Z';
const Q2 = '2026-11-18T12:05:00.000Z';
const Q3 = '2026-11-18T12:10:00.000Z';

/* ------------------------------------------------------------ fixtures */

const CAB = ['id', 'data', 'plataforma', 'link', 'criador', 'visualizacoes', 'mediana_do_criador', 'outlier_x', 'tema', 'angulo', 'nota', 'status', 'id_execucao', 'origem'];
const cand = (o) => {
  const v = {
    data: '2026-11-17', plataforma: 'Instagram', link: `https://www.instagram.com/p/${o.id}/`, criador: '@perfil.ficticio',
    visualizacoes: '120000', mediana_do_criador: '15000', outlier_x: '8', tema: 'sono', angulo: `Ângulo ${o.id}`, nota: '82', status: 'novo', ...o,
  };
  return CAB.map((c) => v[c] ?? '');
};
const aba = (linhas, registros = {}, extra = {}) => ({
  fase: 'pronto', abaAusente: false, ...lerCandidatos([CAB, ...linhas.map(cand)]), app: { registros, ...extra },
});
const reg = (id, estado, quando = Q1, o = {}) => ({ id, estado, motivo: '', historico: [{ estado, quando, quem: ROBERTTA }], quando, ...o });

const CAB_SELECAO = ['id_pauta', 'id_candidato', 'semana', 'titulo', 'tema', 'rede', 'estado_verificacao', 'nota_v2', 'status', 'id_lote'];
const CAB_DECISOES = ['semana', 'pauta', 'decisao', 'motivo', 'id_pauta', 'rede', 'id_candidato', 'id_lote', 'data', 'quem', 'origem'];
function dadosPautas({ pautas = [], decisoes = [] } = {}) {
  const selecao = lerSelecao([CAB_SELECAO, ...pautas.map((o) => CAB_SELECAO.map((c) => ({ semana: 'S47', titulo: `Pauta ${o.id_pauta}`, rede: 'ig', nota_v2: '80', status: 'proposta', ...o })[c] ?? ''))]);
  const dec = lerDecisoes([CAB_DECISOES, ...decisoes.map((o) => CAB_DECISOES.map((c) => ({ semana: 'S47', data: '2026-11-18 09:12', origem: 'manual-app', quem: ROBERTTA, ...o })[c] ?? ''))]);
  return { fase: 'pronto', selecao, decisoes: dec, colunasProntas: true, decisoesAusente: false };
}
function execucoes(...linhas) {
  return lerExecucoes([COLUNAS_EXECUCOES, ...linhas.map((o) => COLUNAS_EXECUCOES.map((c) => o[c] ?? ''))]).execucoes;
}
const rc = (o) => ({ bot: 'radar', rotina: 'radar-candidato', origem: 'manual-app', quem: ROBERTTA, teste: 'não', ...o });
const dadosExec = (lista) => ({ fase: 'pronto', execucoes: lista, abaAusente: false });

function cartoes(html) {
  const out = {};
  for (const m of html.matchAll(/<article class="painel pauta candidato[^"]*" aria-labelledby="cand-(?:x-)?([^"]+)">([\s\S]*?)<\/article>/g)) out[m[1]] = m[0];
  return out;
}
const botoes = (html, acao) => html.match(new RegExp(`<button[^>]*data-acao="${acao}"[^>]*>[^<]*`, 'g')) || [];

/** Drive falso, em memória: pastas e arquivos por id; registra cada chamada. */
function driveFalso({ arquivos = [], pastas = [] } = {}) {
  const itens = new Map([['RAIZ', { id: 'RAIZ', name: 'Motor de Conteúdo', mimeType: 'application/vnd.google-apps.folder', parents: [] }]]);
  for (const f of [...pastas, ...arquivos]) itens.set(f.id, { mimeType: 'application/json', modifiedTime: Q1, ...f });
  const conteudos = new Map(arquivos.map((f) => [f.id, f.texto]));
  const chamadas = [];
  let n = 0;
  let relogio = Date.parse('2026-11-18T13:00:00Z');
  const tique = () => new Date((relogio += 1000)).toISOString();
  const deps = {
    raiz: async () => 'RAIZ',
    listar: async (pai) => { chamadas.push(['listar', pai]); return [...itens.values()].filter((f) => f.parents?.includes(pai)); },
    baixarTexto: async (f) => { chamadas.push(['baixar', f.id]); return conteudos.get(f.id); },
    criarPasta: async (nome, pai) => {
      const id = `P${++n}`; chamadas.push(['criarPasta', nome, pai]);
      itens.set(id, { id, name: nome, mimeType: 'application/vnd.google-apps.folder', parents: [pai] }); return { id, name: nome };
    },
    criarArquivoTexto: async (nome, texto, pai, mime) => {
      const id = `F${++n}`; chamadas.push(['criar', nome, pai, mime]);
      itens.set(id, { id, name: nome, mimeType: mime, parents: [pai], modifiedTime: tique() }); conteudos.set(id, texto); return { id, name: nome };
    },
    substituirConteudo: async (id, texto, mime) => {
      chamadas.push(['substituir', id, mime]);
      itens.get(id).modifiedTime = tique(); conteudos.set(id, texto); return { id };
    },
  };
  return { deps, chamadas, itens, conteudos };
}
const PASTA = (id, name, parent) => ({ id, name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] });
const pastasProntas = [PASTA('M', '_motor', 'RAIZ'), PASTA('A', 'app', 'M'), PASTA('C', 'candidatos', 'A')];
const arquivoJSON = (id, fid, o, modifiedTime = Q1) => ({ id: fid, name: `${id}.json`, parents: ['C'], modifiedTime, texto: JSON.stringify(o) });

/* ------------------------------------------------------------ planejador */

test('planejador: só a conta que decide; ids T nunca; id fora do formato; estado desconhecido', () => {
  const base = { id: '2026-11-17-01', para: 'excluido', quando: Q1 };
  assert.equal(planejarEstadoCandidato({ ...base, email: GABRIEL }).motivo, 'sem-permissao');
  assert.equal(planejarEstadoCandidato({ ...base, email: '' }).motivo, 'sem-permissao');
  assert.equal(planejarEstadoCandidato({ ...base, email: ROBERTTA, id: 'T2026-11-17-01' }).motivo, 'teste');
  assert.equal(planejarEstadoCandidato({ ...base, email: ROBERTTA, id: 't9' }).motivo, 'teste');
  assert.equal(planejarEstadoCandidato({ ...base, email: ROBERTTA, id: '../x' }).motivo, 'id-invalido');
  assert.equal(planejarEstadoCandidato({ ...base, email: ROBERTTA, para: 'apagado' }).motivo, 'estado-desconhecido');
  assert.deepEqual(ESTADOS_APP, ['candidato', 'para-decidir', 'excluido', 'recusado']);
});

test('planejador: excluir grava só o arquivo do app, no formato {versao:1,id,estado,historico:[{estado,quando,quem}]}', () => {
  const p = planejarEstadoCandidato({ id: '2026-11-17-01', para: 'excluido', email: ROBERTTA.toUpperCase(), quando: Q1 });
  assert.equal(p.ok, true);
  assert.deepEqual(p.conteudo, { versao: 1, id: '2026-11-17-01', estado: 'excluido', historico: [{ estado: 'excluido', quando: Q1, quem: ROBERTTA.toLowerCase() }] });
  assert.equal(p.caminho, '_motor/app/candidatos/2026-11-17-01.json');
  // a única coisa tocada é o arquivo do app: nada em Seleção, Decisões, planilha ou outras pastas
  assert.deepEqual(p.toca, ['_motor/app/candidatos/2026-11-17-01.json']);
  assert.ok(p.toca.every((t) => t.startsWith('_motor/app/candidatos/') && !/Sele|Decis|planilha/i.test(t)));
  assert.equal(p.de, 'candidato');
  assert.equal(p.aviso, '');
  assert.match(p.texto, /foi excluído/);
});

test('planejador: com pedido ao Radar em andamento (ou parecendo travado) recusa mover/excluir/recusar; voltar passa', () => {
  for (const tipo of ['andamento', 'parece-travada']) {
    for (const para of ['excluido', 'para-decidir', 'recusado']) {
      const p = planejarEstadoCandidato({ id: '2026-11-17-01', para, email: ROBERTTA, situacao: { tipo }, motivo: 'timing' });
      assert.equal(p.ok, false, `${tipo} → ${para}`);
      assert.equal(p.motivo, 'em-andamento');
    }
    const volta = planejarEstadoCandidato({ id: '2026-11-17-01', para: 'candidato', email: ROBERTTA, situacao: { tipo }, atual: reg('2026-11-17-01', 'para-decidir') });
    assert.equal(volta.ok, true);
  }
});

test('planejador: já virou pauta → excluir só tira o cartão (avisa que a pauta continua); mover e recusar não', () => {
  const situacao = { tipo: 'pauta', pauta: { id_pauta: 'S47-03' } };
  const ex = planejarEstadoCandidato({ id: '2026-11-17-01', para: 'excluido', email: ROBERTTA, situacao });
  assert.equal(ex.ok, true);
  assert.equal(ex.aviso, 'Só o cartão saiu de Candidatos: a pauta S47-03 continua na Seleção.');
  assert.deepEqual(ex.toca, [caminhoArquivoCandidato('2026-11-17-01')]);
  assert.match(textoDoEstadoGravado(ex), /foi excluído\. Só o cartão saiu de Candidatos: a pauta S47-03 continua na Seleção\./);
  assert.equal(planejarEstadoCandidato({ id: '2026-11-17-01', para: 'para-decidir', email: ROBERTTA, situacao }).motivo, 'ja-pauta');
  assert.equal(planejarEstadoCandidato({ id: '2026-11-17-01', para: 'recusado', email: ROBERTTA, situacao, motivo: 'timing' }).motivo, 'ja-pauta');
  // aprovado em Decisões: não vai para Para decidir nem é recusado no app
  assert.equal(planejarEstadoCandidato({ id: '2026-11-17-01', para: 'para-decidir', email: ROBERTTA, situacao: { tipo: 'aprovado' } }).motivo, 'ja-aprovado');
  assert.equal(planejarEstadoCandidato({ id: '2026-11-17-01', para: 'recusado', email: ROBERTTA, situacao: { tipo: 'aprovado' }, motivo: 'timing' }).motivo, 'ja-aprovado');
});

test('mover / voltar / recusar / desfazer: o histórico continua; recusa pede motivo (uma linha) e fica no arquivo', () => {
  const id = '2026-11-17-02';
  const m = planejarEstadoCandidato({ id, para: 'para-decidir', email: ROBERTTA, quando: Q1 });
  assert.equal(m.ok, true);
  assert.equal(m.conteudo.estado, 'para-decidir');
  assert.equal(planejarEstadoCandidato({ id, para: 'para-decidir', email: ROBERTTA, atual: m.registro }).motivo, 'ja-esta');
  assert.equal(planejarEstadoCandidato({ id, para: 'recusado', email: ROBERTTA, atual: m.registro }).motivo, 'sem-motivo');
  const r = planejarEstadoCandidato({ id, para: 'recusado', email: ROBERTTA, atual: m.registro, motivo: ' timing\n<b>x</b> ', quando: Q2 });
  assert.equal(r.ok, true);
  assert.equal(r.conteudo.motivo, 'timing <b>x</b>');
  assert.equal(r.de, 'para-decidir'); // o "Desfazer" volta para cá
  assert.deepEqual(r.conteudo.historico.map((h) => h.estado), ['para-decidir', 'recusado']);
  // desfazer = gravar o estado de antes (o histórico guarda os três passos)
  const d = planejarEstadoCandidato({ id, para: r.de, email: ROBERTTA, atual: r.registro, quando: Q3 });
  assert.equal(d.ok, true);
  assert.deepEqual(d.conteudo.historico.map((h) => h.estado), ['para-decidir', 'recusado', 'para-decidir']);
  assert.equal(d.conteudo.motivo, undefined);
  const v = planejarEstadoCandidato({ id, para: 'candidato', email: ROBERTTA, atual: d.registro, quando: Q3 });
  assert.equal(v.ok, true);
  assert.match(v.texto, /voltou para Candidatos/);
});

test('lerArquivoCandidato: valida versão, id (e o nome do arquivo), estado; JSON inválido não quebra', () => {
  const ok = lerArquivoCandidato(JSON.stringify({ versao: 1, id: '2026-11-17-01', estado: 'excluido', historico: [{ estado: 'excluido', quando: Q1, quem: ROBERTTA }] }), '2026-11-17-01');
  assert.equal(ok.ok, true);
  assert.equal(ok.registro.quando, Q1);
  assert.equal(lerArquivoCandidato('{', '').motivo, 'json-invalido');
  assert.equal(lerArquivoCandidato('[]').motivo, 'formato');
  assert.equal(lerArquivoCandidato(JSON.stringify({ versao: 2, id: '2026-11-17-01', estado: 'excluido' })).motivo, 'versao');
  assert.equal(lerArquivoCandidato(JSON.stringify({ versao: 1, id: '2026-11-17-01', estado: 'sumido' })).motivo, 'estado');
  assert.equal(lerArquivoCandidato(JSON.stringify({ versao: 1, id: '2026-11-17-01', estado: 'excluido' }), '2026-11-17-09').motivo, 'id-trocado');
});

/* ------------------------------------------------------------ Drive (falso) */

test('dois arquivos com o mesmo id: vale o de modifiedTime mais novo (na leitura e na gravação)', async () => {
  const id = '2026-11-17-01';
  const velho = arquivoJSON(id, 'FV', { versao: 1, id, estado: 'excluido', historico: [{ estado: 'excluido', quando: Q1, quem: ROBERTTA }] }, '2026-11-18T10:00:00.000Z');
  const novo = arquivoJSON(id, 'FN', { versao: 1, id, estado: 'para-decidir', historico: [{ estado: 'para-decidir', quando: Q2, quem: ROBERTTA }] }, '2026-11-18T11:00:00.000Z');
  assert.equal(maisNovoPorNome([velho, novo]).get(`${id}.json`).id, 'FN');
  assert.equal(maisNovoPorNome([novo, velho]).get(`${id}.json`).id, 'FN');
  const f = driveFalso({ pastas: pastasProntas, arquivos: [novo, velho] });
  const app = criarArquivosDoApp(f.deps);
  const lido = await app.ler();
  assert.equal(lido.registros[id].estado, 'para-decidir');
  const g = await app.gravar({ id, para: 'candidato', email: ROBERTTA, quando: Q3 });
  assert.equal(g.de, 'para-decidir');
  assert.deepEqual(f.chamadas.filter((c) => c[0] === 'substituir'), [['substituir', 'FN', 'application/json']]);
  assert.deepEqual(JSON.parse(f.conteudos.get('FN')).historico.map((h) => h.estado), ['para-decidir', 'candidato']);
  assert.equal(JSON.parse(f.conteudos.get('FV')).estado, 'excluido'); // o velho não é tocado
});

test('primeira gravação cria _motor/app/candidatos dentro da raiz; depois substitui o mesmo arquivo; nada fora da pasta', async () => {
  const f = driveFalso();
  const app = criarArquivosDoApp(f.deps);
  assert.deepEqual(await app.ler(), { registros: {}, invalidos: 0 }); // sem pastas: nada criado só para ler
  assert.equal(f.chamadas.filter((c) => c[0] !== 'listar').length, 0);
  const id = '2026-11-17-03';
  const g = await app.gravar({ id, para: 'excluido', email: ROBERTTA, quando: Q1 });
  assert.equal(g.registro.estado, 'excluido');
  assert.deepEqual(f.chamadas.filter((c) => c[0] === 'criarPasta').map((c) => c[1]), ['_motor', 'app', 'candidatos']);
  const criar = f.chamadas.filter((c) => c[0] === 'criar');
  assert.equal(criar.length, 1);
  assert.equal(criar[0][1], `${id}.json`);
  assert.equal(f.itens.get(criar[0][2]).name, 'candidatos');
  const arquivo = [...f.itens.values()].find((x) => x.name === `${id}.json`);
  assert.deepEqual(JSON.parse(f.conteudos.get(arquivo.id)),
    { versao: 1, id, estado: 'excluido', historico: [{ estado: 'excluido', quando: Q1, quem: ROBERTTA.toLowerCase() }] });
  // desfazer: o mesmo arquivo, substituído (não cria outro)
  const d = await app.gravar({ id, para: g.de, email: ROBERTTA, quando: Q2 });
  assert.equal(d.registro.estado, 'candidato');
  assert.equal(f.chamadas.filter((c) => c[0] === 'criar').length, 1);
  assert.equal(f.chamadas.filter((c) => c[0] === 'substituir').length, 1);
  assert.equal((await app.ler()).registros[id].estado, 'candidato');
  // só criou/escreveu nas pastas do app
  const escritos = f.chamadas.filter((c) => ['criar', 'substituir', 'criarPasta'].includes(c[0]));
  assert.ok(escritos.every((c) => c[0] !== 'criar' || f.itens.get(c[2]).name === 'candidatos'));
});

test('gravar recusa antes de tocar o Drive: sem permissão e id T; erro do Drive sobe com a mensagem', async () => {
  const f = driveFalso({ pastas: pastasProntas });
  const app = criarArquivosDoApp(f.deps);
  await assert.rejects(app.gravar({ id: '2026-11-17-01', para: 'excluido', email: GABRIEL }), (e) => e.codigo === 'sem-permissao');
  await assert.rejects(app.gravar({ id: 'T2026-11-17-01', para: 'excluido', email: ROBERTTA }), (e) => e.codigo === 'teste');
  await assert.rejects(app.gravar({ id: '2026-11-17-01', para: 'excluido', email: ROBERTTA, situacao: { tipo: 'andamento' } }), (e) => e.codigo === 'em-andamento');
  assert.equal(f.chamadas.length, 0);
  const quebrado = driveFalso({ pastas: pastasProntas });
  quebrado.deps.criarArquivoTexto = async () => { throw new Error('O Drive recusou (403).'); };
  await assert.rejects(criarArquivosDoApp(quebrado.deps).gravar({ id: '2026-11-17-01', para: 'para-decidir', email: ROBERTTA }), /403/);
});

test('arquivo inválido na pasta: contado, não quebra a leitura dos outros', async () => {
  const f = driveFalso({
    pastas: pastasProntas,
    arquivos: [
      { id: 'X', name: '2026-11-17-01.json', parents: ['C'], texto: '{ não é json' },
      arquivoJSON('2026-11-17-02', 'Y', { versao: 1, id: '2026-11-17-02', estado: 'recusado', motivo: 'timing', historico: [] }),
      { id: 'Z', name: 'leia-me.txt', parents: ['C'], mimeType: 'text/plain', texto: 'x' },
    ],
  });
  const lido = await criarArquivosDoApp(f.deps).ler();
  assert.equal(lido.invalidos, 1);
  assert.deepEqual(Object.keys(lido.registros), ['2026-11-17-02']);
  assert.equal(lido.registros['2026-11-17-02'].motivo, 'timing');
});

/* ------------------------------------------------------------ mescla e contadores */

test('estado otimista: o local vale enquanto for igual ou mais novo; o do Drive mais novo ganha', () => {
  const lidos = { '2026-11-17-01': reg('2026-11-17-01', 'excluido', Q2) };
  assert.equal(mesclarEstadosApp(lidos, { '2026-11-17-01': reg('2026-11-17-01', 'candidato', Q3) }).get('2026-11-17-01').estado, 'candidato');
  assert.equal(mesclarEstadosApp(lidos, { '2026-11-17-01': reg('2026-11-17-01', 'candidato', Q1) }).get('2026-11-17-01').estado, 'excluido');
  assert.equal(mesclarEstadosApp(lidos, { '2026-11-17-01': reg('2026-11-17-01', 'candidato', Q2) }).get('2026-11-17-01').estado, 'candidato');
});

test('contadores: Candidatos tira os movidos/excluídos/recusados; Para decidir (chip e Início) soma os candidatos para decidir', () => {
  const ids = ['01', '02', '03', '04', '05', '06'].map((n) => `2026-11-17-${n}`);
  const lidos = aba([...ids.map((id) => ({ id })), { id: 'T2026-11-17-09' }], {
    [ids[1]]: reg(ids[1], 'para-decidir'), [ids[2]]: reg(ids[2], 'excluido'), [ids[3]]: reg(ids[3], 'recusado', Q1, { motivo: 'timing' }),
    [ids[4]]: reg(ids[4], 'para-decidir'), // já virou pauta: sai do bloco (a pauta conta pela Seleção)
  });
  const dados = dadosPautas({ pautas: [{ id_pauta: 'S47-01' }, { id_pauta: 'S47-02', id_candidato: ids[4] }, { id_pauta: 'T47-01' }] });
  assert.equal(contarCandidatos(lidos), 2); // 01 e 06
  assert.equal(contarCandidatosParaDecidir(lidos, { selecao: dados.selecao }), 1); // 02
  assert.equal(contarParaDecidir(dados, lidos, {}), 2 + 1); // S47-01, S47-02 (sem o T) + 02
  // o estado otimista entra na conta na hora
  const locais = { [ids[0]]: reg(ids[0], 'para-decidir', Q2, { pendente: true }) };
  assert.equal(contarCandidatos(lidos, locais), 1);
  assert.equal(contarParaDecidir(dados, lidos, locais), 4);
  // planilha ainda não lida: o contador mostra só os candidatos para decidir
  assert.equal(contarParaDecidir({ fase: 'carregando' }, lidos, {}), 2); // 02 e 05 (sem Seleção, 05 conta)
  assert.equal(contarParaDecidir({ fase: 'carregando' }, { fase: 'carregando' }, {}), 0);
  // os chips da tela batem com as contas
  const h = htmlPautas({ dados, exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA });
  assert.match(h, />Candidatos \(2\)</);
  // o chip conta a Seleção como antes (o T aparece, mas não se decide: 3) + o candidato para decidir
  assert.match(h, />Para decidir \(4\)</);
  const hd = htmlPautas({ dados, exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'decidir', agora: AGORA });
  assert.match(hd, />Para decidir \(4\)</);
  assert.match(hd, />Candidatos \(2\)</);
  // separarCandidatos sem tipoDe: quem está para decidir fica no bloco
  assert.equal(separarCandidatos([{ id: ids[4] }], mesclarEstadosApp(lidos.app.registros)).paraDecidir.length, 1);
});

/* ------------------------------------------------------------ a tela */

test('cartão de Candidatos: Passar para Para decidir (move, sem Radar) · Mandar ao Roteirista · Pedir pauta completa · Excluir', () => {
  const lidos = aba([{ id: '2026-11-17-01' }]);
  const h = htmlCandidatos({ candidatos: lidos, dados: dadosPautas(), exec: dadosExec([]), email: ROBERTTA, agora: AGORA });
  const c = cartoes(h)['2026-11-17-01'];
  const ordem = [...c.matchAll(/<button type="button" class="([^"]+)" data-acao="([^"]+)"[^>]*>([^<]*)/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(ordem, [
    ['botao primario', 'candidato-mover', 'Passar para Para decidir'],
    ['botao contorno', 'candidato-pedir', 'Mandar ao Roteirista'],
    ['botao calmo', 'candidato-pedir', 'Pedir pauta completa ao Radar'],
    ['discreto excluir', 'candidato-excluir', 'Excluir'],
  ]);
  assert.match(c, /data-acao="candidato-mover" data-id="2026-11-17-01" data-valor="para-decidir"/);
  assert.match(h, /só muda o estado no app, sem chamar o Radar/);
});

test('com pedido ao Radar em andamento: sem Mover nem Excluir; virou pauta: só Excluir; id T fora da tela', () => {
  const ids = ['2026-11-17-01', '2026-11-17-02'];
  const lidos = aba([{ id: ids[0] }, { id: ids[1] }, { id: 'T2026-11-17-03' }]);
  const ex = execucoes(rc({ id_execucao: 'EX-1', id_alvo: ids[0], inicio: '2026-11-18 10:00', status: 'rodando' }));
  const dados = dadosPautas({ pautas: [{ id_pauta: 'S47-03', id_candidato: ids[1] }] });
  const h = htmlCandidatos({ candidatos: lidos, dados, exec: dadosExec(ex), email: ROBERTTA, agora: AGORA });
  const c = cartoes(h);
  assert.equal(botoes(c[ids[0]], 'candidato-mover').length, 0);
  assert.equal(botoes(c[ids[0]], 'candidato-excluir').length, 0);
  assert.equal(botoes(c[ids[1]], 'candidato-mover').length, 0);
  assert.equal(botoes(c[ids[1]], 'candidato-excluir').length, 1);
  assert.ok(!('T2026-11-17-03' in c));
});

test('Gabriel: Excluir e Mover desligados; Drive não lido: mover/excluir esperam, com a explicação', () => {
  const lidos = aba([{ id: '2026-11-17-01' }]);
  const g = htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: GABRIEL, filtro: 'candidatos', agora: AGORA });
  assert.ok(g.includes(NOTA_SO_ROBERTTA));
  assert.match(g, /não exclui/);
  for (const a of ['candidato-mover', 'candidato-excluir', 'candidato-pedir']) assert.ok(botoes(g, a).every((b) => / disabled/.test(b)), a);
  const semApp = aba([{ id: '2026-11-17-01' }], {}, { erro: 'O Drive não respondeu.' });
  const h = htmlCandidatos({ candidatos: semApp, dados: dadosPautas(), exec: dadosExec([]), email: ROBERTTA, agora: AGORA });
  assert.match(h, /O Drive não respondeu\. O estado dos candidatos no Drive não foi lido/);
  assert.ok(botoes(h, 'candidato-mover').every((b) => / disabled/.test(b)));
  assert.ok(botoes(h, 'candidato-excluir').every((b) => / disabled/.test(b)));
  assert.ok(botoes(h, 'candidato-pedir').every((b) => !/ disabled/.test(b))); // o Radar não depende do arquivo
});

test('gravando (otimista): o cartão já está no lugar novo com "Gravando no Drive…"; erro: volta com "Tentar de novo"', () => {
  const id = '2026-11-17-01';
  const lidos = aba([{ id }, { id: '2026-11-17-02' }]);
  const dados = dadosPautas({ pautas: [{ id_pauta: 'S47-01' }] });
  const locais = { [id]: { ...reg(id, 'para-decidir', Q2), pendente: true } };
  const hc = htmlPautas({ dados, exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA, candidatosLocais: locais });
  assert.ok(!(id in cartoes(hc)));
  const hd = htmlPautas({ dados, exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'decidir', agora: AGORA, candidatosLocais: locais });
  assert.match(cartoes(hd)[id], /Gravando no Drive…/);
  assert.equal(botoes(cartoes(hd)[id], 'candidato-[a-z]+').length, 0);
  // a gravação falhou: o local some (o cartão volta) e o erro aparece com "Tentar de novo"
  const erros = { [id]: { mensagem: 'O Drive recusou <403>.', para: 'para-decidir' } };
  const he = htmlPautas({ dados, exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA, errosCandidato: erros });
  const c = cartoes(he)[id];
  assert.match(c, /role="alert"/);
  assert.match(c, /Não gravei no Drive: O Drive recusou &lt;403&gt;\./);
  assert.match(c, /<button type="button" class="botao calmo menor" data-acao="candidato-mover" data-id="2026-11-17-01" data-valor="para-decidir">Tentar de novo</);
});

test('bloco "Candidatos para decidir (sem verificação do Radar)": no chip Para decidir, antes das pautas, com as 4 ações', () => {
  const id = '2026-11-17-02';
  const lidos = aba([{ id: '2026-11-17-01' }, { id, plataforma: 'TikTok' }], { [id]: reg(id, 'para-decidir') });
  const dados = dadosPautas({ pautas: [{ id_pauta: 'S47-01' }] });
  const h = htmlPautas({ dados, exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'decidir', agora: AGORA });
  assert.match(h, /<h2 id="cand-decidir-titulo" class="bloco-titulo">Candidatos para decidir \(sem verificação do Radar\)<\/h2>/);
  assert.ok(h.indexOf('cand-decidir-titulo') < h.indexOf('aria-labelledby="p-S47-01"'));
  const c = cartoes(h)[id];
  const ordem = [...c.matchAll(/<button type="button" class="([^"]+)" data-acao="([^"]+)"[^>]*?(?: data-valor="([^"]*)")?>([^<]*)/g)].map((m) => [m[2], m[3] || '', m[4]]);
  assert.deepEqual(ordem, [
    ['candidato-pedir', 'roteirista', 'Aprovar e mandar ao Roteirista'],
    ['candidato-pedir', 'decidir', 'Pedir pauta completa ao Radar'],
    ['candidato-recusar', '', 'Recusar'],
    ['candidato-mover', 'candidato', 'Voltar para Candidatos'],
  ]);
  assert.doesNotMatch(c, /Nova rodada/); // o destaque é só do chip Candidatos
  // o layout do cartão da v17: ≤ 2 selos, tema em texto, números compactos, linha-id e Detalhes
  assert.ok((c.match(/class="selo /g) || []).length <= 2);
  assert.match(c, /<p class="subtitulo">sono<\/p>/);
  assert.match(c.replace(/\u00a0/g, " "), /120 mil visualizações/);
  assert.match(c, /<p class="linha-id pequeno">2026-11-17-02 · 17\/11<\/p>/);
  assert.match(c, /<details><summary>Detalhes<\/summary>/);
  // só no chip Para decidir; sem candidato para decidir, não aparece
  assert.doesNotMatch(htmlPautas({ dados, exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'todas', agora: AGORA }), /cand-decidir-titulo/);
  assert.equal(blocoCandidatosParaDecidir({ lista: [] }), '');
  // sem pauta na Seleção: o bloco aparece no lugar do "Nada para decidir"
  const so = htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'decidir', agora: AGORA });
  assert.match(so, /cand-decidir-titulo/);
  assert.doesNotMatch(so, /Nada para decidir agora/);
  // aba Seleção ausente: o bloco continua
  const ausente = htmlPautas({ dados: { fase: 'erro', erro: { codigo: 'aba-ausente' } }, exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'decidir', agora: AGORA });
  assert.match(ausente, /cand-decidir-titulo/);
});

test('bloco Para decidir: pedido ao Radar em andamento só deixa Voltar; aprovado em Decisões não tem Recusar', () => {
  const ids = ['2026-11-17-01', '2026-11-17-02'];
  const lidos = aba(ids.map((id) => ({ id })), { [ids[0]]: reg(ids[0], 'para-decidir'), [ids[1]]: reg(ids[1], 'para-decidir') });
  const ex = execucoes(rc({ id_execucao: 'EX-1', id_alvo: ids[0], inicio: '2026-11-18 10:00', status: 'rodando' }));
  const dados = dadosPautas({ decisoes: [{ pauta: 'Ângulo', decisao: 'aprovada', id_candidato: ids[1], id_pauta: '' }] });
  const h = htmlPautas({ dados, exec: dadosExec(ex), candidatos: lidos, email: ROBERTTA, filtro: 'decidir', agora: AGORA });
  const c = cartoes(h);
  assert.deepEqual(botoes(c[ids[0]], 'candidato-[a-z]+').map((b) => b.replace(/^.*>/, '')), ['Voltar para Candidatos']);
  assert.match(c[ids[0]], /Pedido em andamento/);
  assert.deepEqual(botoes(c[ids[1]], 'candidato-[a-z]+').map((b) => b.replace(/^.*>/, '')), ['Voltar para Candidatos']);
});

test('chip discreto "Excluídos (n)": fechado mostra só o botão; aberto lista excluídos e recusados com Restaurar', () => {
  const ids = ['2026-11-17-01', '2026-11-17-02', '2026-11-17-03'];
  const lidos = aba(ids.map((id) => ({ id })), {
    [ids[1]]: reg(ids[1], 'excluido', '2026-11-18T12:12:00.000Z'), [ids[2]]: reg(ids[2], 'recusado', Q1, { motivo: 'timing <b>' }),
  });
  const fechado = htmlCandidatos({ candidatos: lidos, dados: dadosPautas(), exec: dadosExec([]), email: ROBERTTA, agora: AGORA });
  assert.match(fechado, /<button type="button" class="discreto" data-acao="candidatos-excluidos" aria-expanded="false" aria-controls="cand-excluidos">Excluídos \(2\)<\/button>/);
  assert.deepEqual(Object.keys(cartoes(fechado)), [ids[0]]);
  const aberto = htmlCandidatos({ candidatos: lidos, dados: dadosPautas(), exec: dadosExec([]), email: ROBERTTA, agora: AGORA, verExcluidos: true });
  assert.match(aberto, /aria-expanded="true"/);
  const c = cartoes(aberto);
  assert.deepEqual(Object.keys(c).sort(), ids);
  assert.match(c[ids[1]], /Excluído hoje às/);
  assert.match(c[ids[2]], /Recusado hoje às \d+h\d* · timing &lt;b&gt;/);
  for (const id of ids.slice(1)) {
    assert.match(c[id], new RegExp(`<button type="button" class="botao contorno" data-acao="candidato-mover" data-id="${id}" data-valor="candidato">Restaurar</button>`));
  }
  // sem nenhum excluído, o chip some
  assert.doesNotMatch(htmlCandidatos({ candidatos: aba([{ id: ids[0] }]), dados: dadosPautas(), exec: dadosExec([]), email: ROBERTTA, agora: AGORA }), /candidatos-excluidos/);
  // todos fora da lista: vazio honesto + o chip
  const todos = aba([{ id: ids[1] }], { [ids[1]]: reg(ids[1], 'excluido') });
  const v = htmlCandidatos({ candidatos: todos, dados: dadosPautas(), exec: dadosExec([]), email: ROBERTTA, agora: AGORA });
  assert.match(v, /Nenhum candidato esperando aqui/);
  assert.match(v, /Excluídos \(1\)/);
});

test('janelas: Excluir e Recusar dizem que só o arquivo do app muda; pauta continua; erro dentro da janela; tudo escapado', () => {
  const c = { id: '2026-11-17-01', angulo: '<img src=x onerror=alert(1)>', tema: 'tema "aspas"', plataforma: '<b>IG</b>' };
  const ex = janelaExcluirCandidato({ c, situacao: { tipo: 'pauta', pauta: { id_pauta: 'S47-<03>' } } });
  assert.match(ex, /<h2 id="dlg-titulo">Excluir este candidato\?<\/h2>/);
  assert.match(ex, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(ex, /<img/);
  assert.doesNotMatch(ex, /<b>IG/);
  assert.match(ex, /A pauta S47-&lt;03&gt; continua na Seleção/);
  assert.match(ex, /_motor\/app\/candidatos\/2026-11-17-01\.json/);
  assert.match(ex, /Nada em Seleção, Decisões, na planilha ou em outras pastas do Drive é apagado ou alterado/);
  assert.match(ex, /<button type="button" class="botao primario" data-acao="candidato-excluir-confirmar" data-id="2026-11-17-01">Excluir<\/button>/);
  assert.match(ex, /<button type="button" class="botao calmo" data-acao="fechar-janela">Voltar<\/button>/);
  const enviando = janelaExcluirCandidato({ c, enviando: true });
  assert.match(enviando, /disabled aria-busy="true">Excluindo…</);
  const erro = janelaExcluirCandidato({ c, erro: 'Não gravei no Drive: <403>' });
  assert.match(erro, /role="alert"[^]*Não gravei no Drive: &lt;403&gt;/);
  assert.match(erro, />Tentar de novo<\/button>/);
  const rec = janelaRecusarCandidato({ c, erroMotivo: 'Escolha o motivo da recusa.' });
  assert.match(rec, /Recusar este candidato\?/);
  assert.match(rec, /name="rcr-2026-11-17-01"[^>]*value="timing"/);
  assert.match(rec, /Nada vai para Decisões nem para o Radar/);
  assert.match(rec, /Escolha o motivo da recusa\./);
  assert.match(rec, /data-acao="candidato-recusar-confirmar" data-id="2026-11-17-01"/);
  assert.doesNotMatch(rec, /<img/);
});

test('escape: nada vindo da planilha ou do arquivo do app vira HTML no bloco, nos excluídos e no chip', () => {
  const id = '2026-11-17-01';
  const mau = '<script>alert(1)</script>';
  const lidos = aba([{ id, angulo: mau, tema: mau, criador: mau, plataforma: mau, status: mau }, { id: '2026-11-17-02', angulo: mau }], {
    [id]: reg(id, 'para-decidir'), '2026-11-17-02': reg('2026-11-17-02', 'recusado', Q1, { motivo: mau }),
  });
  const hd = htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'decidir', agora: AGORA });
  const hc = htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA, verExcluidos: true });
  for (const h of [hd, hc]) {
    assert.doesNotMatch(h, /<script>/);
    assert.match(h, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  }
});

test('gruposDeCandidatos: null antes de ler; o estado do candidato (Radar) segue o mesmo de antes', () => {
  assert.equal(gruposDeCandidatos({ candidatos: { fase: 'carregando' } }), null);
  const lidos = aba([{ id: '2026-11-17-01' }]);
  const g = gruposDeCandidatos({ candidatos: lidos, dados: dadosPautas() });
  assert.equal(g.candidatos.length, 1);
  assert.equal(estadoDoCandidato(lidos.candidatos[0], {}).tipo, 'livre');
});
