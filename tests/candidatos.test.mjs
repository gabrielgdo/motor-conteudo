// Testes do chip Candidatos da tela Pautas (js/candidatos.js e htmlCandidatos/htmlPautas de
// js/telas/pautas.js), sem DOM: leitura da aba Candidatos pelo cabeçalho (com e sem as colunas
// id_execucao e origem), ordem, destaque da última rodada, escape e links, estados do cartão
// (Execuções, Seleção, Decisões), a conta que não decide, estados honestos da aba, "Mostrar mais",
// os campos das janelas e a pauta que ficou para decidir depois de "Mandar ao Roteirista".
// Datas fixas; textos e ids fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED, FLAGS } from '../js/config.js';
FLAGS.ponte = false;
import { lerDataHora } from '../js/parse.js';
import { lerExecucoes, COLUNAS_EXECUCOES } from '../js/controle.js';
import { lerSelecao, lerDecisoes, paraDecidir, estadoDasPautas, aprovacaoDoCandidato } from '../js/selecao.js';
import { lerCandidatos, ordenarCandidatos, contarCandidatos, ultimaRodada, estadoDoCandidato, rotuloOrigem } from '../js/candidatos.js';
import {
  htmlPautas, htmlCandidatos, campoQuantidade, campoMotivoCandidato, extrasDoCandidato, textoDoPedidoCandidato,
  pautasParaDecidir, aprovadasParaEnviar, LIMITE_CANDIDATOS, MENSAGEM_CANDIDATOS_AUSENTE, NOTA_SO_ROBERTTA,
  numeroCompacto, numeroDaPlanilha, linhaDosNumeros, tomDaVerificacao,
} from '../js/telas/pautas.js';
import { janelaRodar, classeJanelaRodar } from '../js/componentes/execucao.js';
import { hrefWeb } from '../js/util.js';

const ROBERTTA = ALLOWED[0];
const GABRIEL = ALLOWED[1];
const AGORA = lerDataHora('2026-11-18 10:30');
const sp = (s) => String(s).replace(/\u00a0/g, ' '); // Intl usa espaço inseparável

/* ------------------------------------------------------------ fixtures */

// O cabeçalho real da aba (com acento, espaço e parênteses) + as colunas M e N.
const CAB_REAL = ['id', 'data', 'plataforma', 'link', 'criador', 'Visualizações', 'mediana do criador', 'outlier (x)', 'tema', 'Ângulo', 'nota', 'status'];
const CAB_NOVO = [...CAB_REAL, 'id_execucao', 'origem'];
const CHAVES = ['id', 'data', 'plataforma', 'link', 'criador', 'visualizacoes', 'mediana', 'outlier', 'tema', 'angulo', 'nota', 'status', 'id_execucao', 'origem'];
const cand = (o, cab = CAB_NOVO) => {
  const v = {
    data: '2026-11-17', plataforma: 'Instagram', link: `https://www.instagram.com/p/${o.id}/`, criador: '@perfil.ficticio',
    visualizacoes: '120000', mediana: '15000', outlier: '8', tema: 'sono', angulo: `Ângulo ${o.id}`, nota: '82', status: 'novo', ...o,
  };
  return cab.map((_, i) => v[CHAVES[i]] ?? '');
};
const aba = (linhas, cab = CAB_NOVO) => ({ fase: 'pronto', abaAusente: false, ...lerCandidatos([cab, ...linhas.map((o) => cand(o, cab))]) });

function execucoes(...linhas) {
  return lerExecucoes([COLUNAS_EXECUCOES, ...linhas.map((o) => COLUNAS_EXECUCOES.map((c) => o[c] ?? ''))]).execucoes;
}
const dadosExec = (lista) => ({ fase: 'pronto', execucoes: lista, abaAusente: false });
const rd = (o) => ({ bot: 'radar', rotina: 'radar-diario', origem: 'agendada', quem: 'cron', status: 'ok', teste: 'não', ...o });
const rc = (o) => ({ bot: 'radar', rotina: 'radar-candidato', origem: 'manual-app', quem: ROBERTTA, teste: 'não', ...o });

const CAB_SELECAO = ['id_pauta', 'id_candidato', 'semana', 'titulo', 'tema', 'rede', 'estado_verificacao', 'nota_v2', 'status', 'id_lote'];
const CAB_DECISOES = ['semana', 'pauta', 'decisao', 'motivo', 'id_pauta', 'rede', 'id_candidato', 'id_lote', 'data', 'quem', 'origem'];
function dadosPautas({ pautas = [], decisoes = [] } = {}) {
  const selecao = lerSelecao([CAB_SELECAO, ...pautas.map((o) => CAB_SELECAO.map((c) => ({ semana: 'S47', titulo: `Pauta ${o.id_pauta}`, rede: 'ig', nota_v2: '80', status: 'proposta', ...o })[c] ?? ''))]);
  const dec = lerDecisoes([CAB_DECISOES, ...decisoes.map((o) => CAB_DECISOES.map((c) => ({ semana: 'S47', data: '2026-11-18 09:12', origem: 'manual-app', quem: ROBERTTA, ...o })[c] ?? ''))]);
  return { fase: 'pronto', selecao, decisoes: dec, colunasProntas: true, decisoesAusente: false };
}

/** Os cartões do HTML, por id (o trecho de <article> de cada um). */
function cartoes(html) {
  const out = {};
  for (const m of html.matchAll(/<article class="painel pauta candidato[^"]*" aria-labelledby="cand-([^"]+)">([\s\S]*?)<\/article>/g)) out[m[1]] = m[0];
  return out;
}
const ordemDosCartoes = (html) => [...html.matchAll(/aria-labelledby="cand-([^"]+)"/g)].map((m) => m[1]);

/* ------------------------------------------------------------ leitura e ordem */

test('lerCandidatos: pelo cabeçalho (acento, caixa, outra ordem), com e sem as colunas id_execucao e origem', () => {
  const novo = lerCandidatos([CAB_NOVO, cand({ id: '2026-11-17-01', id_execucao: 'EX-B', origem: 'manual-app' })]);
  assert.equal(novo.temIdExecucao, true);
  const [c] = novo.candidatos;
  assert.equal(c.visualizacoes, '120000');
  assert.equal(c.mediana_do_criador, '15000');
  assert.equal(c.outlier_x, '8');
  assert.equal(c.angulo, 'Ângulo 2026-11-17-01');
  assert.equal(c.id_execucao, 'EX-B');
  assert.equal(c.origem, 'manual-app');
  assert.equal(c.idOk, true);

  // outra ordem e maiúsculas: casa pelo nome, nunca pela posição
  const embaralhado = ['ORIGEM', 'Tema', 'ID', 'Data', 'Id Execução', 'Criador'];
  const e = lerCandidatos([embaralhado, ['automatica', 'luto', '2026-11-16-02', '2026-11-16', 'EX-A', '@x']]).candidatos[0];
  assert.deepEqual([e.id, e.tema, e.origem, e.id_execucao, e.criador], ['2026-11-16-02', 'luto', 'automatica', 'EX-A', '@x']);

  const antigo = lerCandidatos([CAB_REAL, cand({ id: '2026-11-17-01' }, CAB_REAL)]);
  assert.equal(antigo.temIdExecucao, false);
  assert.equal(antigo.candidatos[0].id_execucao, '');
  assert.equal(antigo.candidatos[0].origem, '');
});

test('ordem: mais recente primeiro (data, depois id); contador sem os de teste', () => {
  const lidos = aba([
    { id: '2026-11-15-01', data: '2026-11-15' },
    { id: '2026-11-17-02', data: '2026-11-17' },
    { id: 'T2026-11-18-01', data: '2026-11-18' },
    { id: '2026-11-17-10', data: '2026-11-17' },
    { id: '2026-11-17-01', data: '2026-11-17' },
  ]);
  assert.deepEqual(ordenarCandidatos(lidos.candidatos).map((c) => c.id), ['T2026-11-18-01', '2026-11-17-10', '2026-11-17-02', '2026-11-17-01', '2026-11-15-01']);
  assert.equal(contarCandidatos(lidos), 4);
  assert.equal(contarCandidatos({}), null);
  const h = htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA });
  assert.deepEqual(ordemDosCartoes(h), ['2026-11-17-10', '2026-11-17-02', '2026-11-17-01', '2026-11-15-01']); // o T fica fora
  assert.ok(!h.includes('T2026-11-18-01'));
  // o chip vem ANTES de Para decidir, com a contagem sem T, em qualquer filtro
  for (const filtro of ['candidatos', 'decidir', 'todas']) {
    const x = htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro, agora: AGORA });
    const i = x.indexOf('Candidatos (4)');
    assert.ok(i > 0, filtro);
    assert.ok(i < x.indexOf('Para decidir ('), filtro);
  }
  // enquanto a aba não foi lida: o chip aparece sem número
  assert.match(htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: { fase: 'carregando' }, email: ROBERTTA, agora: AGORA }), />Candidatos</);
});

/* ------------------------------------------------------------ última rodada */

test('destaque "Nova rodada": com id_execucao, os da execução radar-diario ok/parcial mais recente', () => {
  const lidos = aba([
    { id: '2026-11-17-01', data: '2026-11-17', id_execucao: 'EX-B' },
    { id: '2026-11-17-02', data: '2026-11-17', id_execucao: 'EX-B' },
    { id: '2026-11-17-03', data: '2026-11-17', id_execucao: 'EX-A' }, // mesmo dia, outra rodada
    { id: '2026-11-16-01', data: '2026-11-16', id_execucao: 'EX-0' },
  ]);
  const ex = execucoes(
    rd({ id_execucao: 'EX-0', inicio: '2026-11-16 07:00', status: 'ok' }),
    rd({ id_execucao: 'EX-A', inicio: '2026-11-17 07:00', status: 'ok' }),
    rd({ id_execucao: 'EX-B', inicio: '2026-11-17 15:00', status: 'parcial', origem: 'manual-app' }),
    rd({ id_execucao: 'EX-C', inicio: '2026-11-18 07:00', status: 'erro' }), // erro não conta
    rd({ id_execucao: 'EX-T', inicio: '2026-11-18 08:00', status: 'ok', id_alvo: 'T01', teste: 'sim' }), // teste não conta
  );
  const r = ultimaRodada({ candidatos: lidos.candidatos, temIdExecucao: true, execucoes: ex });
  assert.equal(r.modo, 'execucao');
  assert.equal(r.idExecucao, 'EX-B');
  assert.deepEqual([...r.ids].sort(), ['2026-11-17-01', '2026-11-17-02']);

  const h = htmlPautas({ dados: dadosPautas(), exec: dadosExec(ex), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA });
  const c = cartoes(h);
  assert.match(c['2026-11-17-01'], /class="painel pauta candidato nova"/);
  assert.match(c['2026-11-17-01'], /Nova rodada/);
  assert.doesNotMatch(c['2026-11-17-03'], /Nova rodada/);
  assert.match(h, /os 2 candidatos da última rodada do Radar diário/);
});

test('destaque sem a coluna id_execucao (ou sem execução terminada): a data mais recente, dito com honestidade', () => {
  const linhas = [
    { id: '2026-11-17-01', data: '2026-11-17' },
    { id: '2026-11-17-02', data: '2026-11-17' },
    { id: '2026-11-16-01', data: '2026-11-16' },
  ];
  const semColuna = aba(linhas, CAB_REAL);
  const r = ultimaRodada({ candidatos: semColuna.candidatos, temIdExecucao: false, execucoes: [] });
  assert.equal(r.modo, 'data');
  assert.equal(r.motivo, 'sem-coluna');
  assert.deepEqual([...r.ids].sort(), ['2026-11-17-01', '2026-11-17-02']);
  const h = htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: semColuna, email: ROBERTTA, filtro: 'candidatos', agora: AGORA });
  assert.match(h, /ainda não tem a coluna id_execucao/);
  assert.match(h, /podem ser de mais de uma rodada/);
  assert.match(cartoes(h)['2026-11-17-02'], /Nova rodada/);
  assert.doesNotMatch(cartoes(h)['2026-11-16-01'], /Nova rodada/);
  // o cartão funciona sem as colunas novas: sem origem nem id da rodada
  assert.doesNotMatch(cartoes(h)['2026-11-16-01'], /Rodada (pelo app|automática)/);

  const comColunaSemExec = aba(linhas.map((l) => ({ ...l, id_execucao: 'EX-X' })));
  const r2 = ultimaRodada({ candidatos: comColunaSemExec.candidatos, temIdExecucao: true, execucoes: [] });
  assert.equal(r2.motivo, 'sem-execucao');
  const h2 = htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: comColunaSemExec, email: ROBERTTA, filtro: 'candidatos', agora: AGORA });
  assert.match(h2, /Não achei uma rodada do Radar diário terminada/);
});

test('origem no cartão, discreta: "pelo app" / "automática"', () => {
  assert.equal(rotuloOrigem('manual-app'), 'pelo app');
  assert.equal(rotuloOrigem('Manual-App'), 'pelo app');
  assert.equal(rotuloOrigem('automatica'), 'automática');
  assert.equal(rotuloOrigem('Automática'), 'automática');
  assert.equal(rotuloOrigem(''), '');
  const lidos = aba([{ id: '2026-11-17-01', origem: 'manual-app', id_execucao: 'EX-B' }, { id: '2026-11-17-02', origem: 'automatica' }]);
  const c = cartoes(htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA }));
  // linha discreta id · data · origem; o id_execucao sai da linha e fica nos Detalhes
  assert.match(c['2026-11-17-01'], /class="linha-id pequeno">2026-11-17-01 · [^<]*rodada pelo app</);
  assert.doesNotMatch(c['2026-11-17-01'], /class="linha-id pequeno">[^<]*EX-B/);
  assert.match(c['2026-11-17-01'], /<details><summary>Detalhes<\/summary><dl>.*<dt>Execução<\/dt><dd>EX-B<\/dd>/s);
  assert.match(c['2026-11-17-02'], /rodada automática/);
});

/* ------------------------------------------------------------ segurança */

test('escape de tudo que vem da planilha; link só http/https, em nova aba com noopener', () => {
  const MAL = '<script>alert(1)</script>';
  const lidos = aba([
    { id: '2026-11-17-01', tema: MAL, angulo: `<img src=x onerror=alert(1)>`, criador: `"><b>x</b>`, status: MAL, plataforma: MAL, nota: '90', link: 'javascript:alert(1)' },
    { id: '2026-11-17-02', link: 'https://www.tiktok.com/@perfil/video/1?a=1&b="x"' },
    { id: '2026-11-17-03', link: 'data:text/html,<script>alert(1)</script>' },
    { id: '2026-11-17-04', link: 'https://usuario:senha@exemplo.com/post' },
    { id: '<b>2026</b>' },
  ]);
  const h = htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA });
  assert.ok(!h.includes('<script>'));
  assert.ok(!h.includes('<img src=x'));
  assert.ok(!h.includes('<b>x</b>'));
  assert.ok(!h.includes('<b>2026</b>'));
  assert.ok(!/href="(javascript|data):/i.test(h));
  assert.match(cartoes(h)['2026-11-17-01'], /O link não é http nem https: o app não abre/);
  const tt = cartoes(h)['2026-11-17-02'];
  assert.match(tt, /<a href="https:\/\/www\.tiktok\.com\/@perfil\/video\/1\?a=1&amp;b=%22x%22" target="_blank" rel="noopener noreferrer">/);
  assert.match(tt, /Abrir o post \(tiktok\.com\)/);
  assert.equal(hrefWeb('https://usuario:senha@exemplo.com/post'), '');
  assert.equal(hrefWeb('HTTP://exemplo.com/a'), 'http://exemplo.com/a');
  assert.equal(hrefWeb('ftp://exemplo.com'), '');
  // id fora do formato: aparece (escapado), mas sem botões
  assert.match(h, /Id fora do formato AAAA-MM-DD-NN/);
  assert.equal((h.match(/data-acao="candidato-pedir"/g) || []).length, 8); // 4 candidatos válidos × 2
});

/* ------------------------------------------------------------ estados do cartão */

test('estados do cartão: livre, pedido em andamento, erro, virou pauta, aprovado, enviado ao Roteirista', () => {
  const ids = ['01', '02', '03', '04', '05', '06', '07', '08'].map((n) => `2026-11-17-${n}`);
  const lidos = aba(ids.map((id) => ({ id })));
  const ex = execucoes(
    rc({ id_execucao: 'EX-1', id_alvo: ids[1], inicio: '2026-11-18 10:00', status: 'rodando' }),
    rc({ id_execucao: 'EX-2', id_alvo: ids[2], inicio: '2026-11-18 09:00', status: 'erro', erro: 'fonte <fora> do ar' }),
    rc({ id_execucao: 'EX-3', id_alvo: ids[6], inicio: '2026-11-18 06:00', status: 'pedido' }), // 4h30 aberto
    rc({ id_execucao: 'EX-4', id_alvo: ids[7], inicio: '2026-11-18 09:00', status: 'ok' }),
  );
  const dados = dadosPautas({
    pautas: [
      { id_pauta: 'S47-03', id_candidato: ids[3], status: 'proposta' },
      { id_pauta: 'S47-04', id_candidato: ids[5], status: 'enviada ao Roteirista' },
    ],
    decisoes: [{ pauta: 'Ângulo', decisao: 'aprovada', id_candidato: ids[4], id_pauta: '' }],
  });
  const fontes = { selecao: dados.selecao, decisoes: dados.decisoes, execucoes: ex, agora: AGORA };
  assert.deepEqual(ids.map((id) => estadoDoCandidato({ id }, fontes).tipo),
    ['livre', 'andamento', 'erro', 'pauta', 'aprovado', 'pauta', 'parece-travada', 'concluido']);
  assert.deepEqual(ids.map((id) => estadoDoCandidato({ id }, fontes).podePedir), [true, false, true, false, false, false, true, false]);

  const h = htmlPautas({ dados, exec: dadosExec(ex), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA });
  const c = cartoes(h);
  const botoes = (x) => (x.match(/data-acao="candidato-pedir"[^>]*>/g) || []);
  assert.equal(botoes(c[ids[0]]).length, 2);
  assert.ok(botoes(c[ids[0]]).every((b) => !b.includes('disabled')));
  // o principal só MOVE (estado no app, sem o Radar); o pedido ao Radar é ação secundária
  assert.match(c[ids[0]], /type="button" class="botao primario" data-acao="candidato-mover" data-id="2026-11-17-01" data-valor="para-decidir">Passar para Para decidir</);
  assert.match(c[ids[0]], /class="botao calmo" data-acao="candidato-pedir" data-id="2026-11-17-01" data-valor="decidir">Pedir pauta completa ao Radar</);
  assert.match(c[ids[0]], /class="botao contorno" [^>]*data-valor="roteirista"[^>]*>Mandar ao Roteirista</);
  assert.match(c[ids[1]], /Pedido em andamento \(rodando/);
  assert.equal(botoes(c[ids[1]]).length, 0);
  assert.match(c[ids[2]], /O último pedido deu erro: fonte &lt;fora&gt; do ar\./);
  assert.equal(botoes(c[ids[2]]).length, 2); // tentar de novo
  assert.match(c[ids[3]], /Virou pauta S47-03/);
  assert.match(c[ids[3]], /Para decidir/);
  assert.equal(botoes(c[ids[3]]).length, 0);
  assert.match(c[ids[4]], />Aprovado</);
  assert.equal(botoes(c[ids[4]]).length, 0);
  assert.match(c[ids[5]], /Virou pauta S47-04/);
  assert.match(c[ids[5]], /A pauta S47-04 foi enviada ao Roteirista/);
  // no máximo 2 selos por cartão (estado + plataforma), seja qual for o estado
  for (const id of ids) assert.ok((c[id].match(/class="selo /g) || []).length <= 2, id);
  assert.match(c[ids[2]], /<span class="selo alerta">Erro<\/span>/);
  assert.match(c[ids[1]], /<span class="selo espera">Em andamento<\/span>/);
  assert.match(c[ids[6]], /parece travado/);
  assert.match(c[ids[7]], /ainda não apareceu na aba Seleção/);
  // a lista de pautas continua igual (o chip Para decidir conta só a Seleção)
  assert.match(h, /Para decidir \(1\)/);
});

test('"Mandar ao Roteirista" com a verificação reprovada: aprovado, mas a pauta ficou para decidir (cartão e Para decidir)', () => {
  const id = '2026-11-17-01';
  const lidos = aba([{ id }]);
  const ex = execucoes(rc({ id_execucao: 'EX-1', id_alvo: id, inicio: '2026-11-18 09:00', fim: '2026-11-18 09:20', status: 'parcial', resumo: 'pauta S47-05 criada; verificação reprovada (fonte sem DOI)' }));
  const dados = dadosPautas({
    pautas: [{ id_pauta: 'S47-05', id_candidato: id, status: 'proposta', estado_verificacao: 'reprovada' }, { id_pauta: 'S47-06', status: 'proposta' }],
    decisoes: [{ pauta: `Ângulo ${id}`, decisao: 'aprovada', id_candidato: id, id_pauta: '', data: '2026-11-18 09:00' }],
  });
  // a decisão ligada só por id_candidato NÃO decide a pauta: ela continua proposta e em Para decidir
  assert.equal(estadoDasPautas(dados.selecao, dados.decisoes).get('S47-05').status, 'proposta');
  assert.deepEqual(paraDecidir(dados.selecao, dados.decisoes).map((p) => p.id_pauta), ['S47-05', 'S47-06']);
  assert.deepEqual(pautasParaDecidir(dados.selecao, dados.decisoes).map((p) => p.id_pauta), ['S47-05', 'S47-06']);
  assert.deepEqual(aprovadasParaEnviar(dados.selecao, dados.decisoes), []); // não vai ao Roteirista sem decisão nova
  assert.equal(aprovacaoDoCandidato(dados.decisoes, id).id_candidato, id);

  const e = estadoDoCandidato({ id }, { selecao: dados.selecao, decisoes: dados.decisoes, execucoes: ex, agora: AGORA });
  assert.equal(e.tipo, 'pauta');
  assert.equal(e.ficouParaDecidir, true);
  const h = htmlPautas({ dados, exec: dadosExec(ex), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA });
  assert.match(cartoes(h)[id], /Aprovado, mas a pauta S47-05 ficou para decidir: a verificação das fontes não passou/);
  assert.match(cartoes(h)[id], /O Radar disse: pauta S47-05 criada; verificação reprovada \(fonte sem DOI\)/);

  // ainda rodando: não afirma que a verificação falhou
  const rodando = execucoes(rc({ id_execucao: 'EX-1', id_alvo: id, inicio: '2026-11-18 10:20', status: 'rodando' }));
  const e2 = estadoDoCandidato({ id }, { selecao: dados.selecao, decisoes: dados.decisoes, execucoes: rodando, agora: AGORA });
  assert.equal(e2.ficouParaDecidir, false);
  assert.match(cartoes(htmlPautas({ dados, exec: dadosExec(rodando), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA }))[id], /O Radar ainda está terminando o pedido/);

  // Para decidir: a pauta aparece, com o aviso, e pode ser decidida de novo
  const para = htmlPautas({ dados, exec: dadosExec(ex), candidatos: lidos, email: ROBERTTA, filtro: 'decidir', agora: AGORA });
  assert.match(para, /Para decidir \(2\)/);
  const s5 = para.slice(para.indexOf('id="p-S47-05"'), para.indexOf('id="p-S47-06"'));
  assert.match(s5, /Você mandou o candidato 2026-11-17-01 ao Roteirista em [^,]+, mas a verificação das fontes não passou/);
  assert.match(s5, /Verificação: reprovada\./);
  assert.match(s5, /data-acao="pauta-decidir" data-id="S47-05" data-valor="aprovada"/);
  const s6 = para.slice(para.indexOf('id="p-S47-06"'));
  assert.doesNotMatch(s6, /Você mandou o candidato/);

  // depois que ela aprova a pauta (linha com id_pauta), o aviso some e a pauta vai para Decididas
  const depois = dadosPautas({
    pautas: [{ id_pauta: 'S47-05', id_candidato: id, status: 'proposta' }],
    decisoes: [{ decisao: 'aprovada', id_candidato: id, id_pauta: '' }, { decisao: 'aprovada', id_candidato: id, id_pauta: 'S47-05', origem: 'app' }],
  });
  assert.deepEqual(paraDecidir(depois.selecao, depois.decisoes), []);
  assert.doesNotMatch(htmlPautas({ dados: depois, exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'todas', agora: AGORA }), /Você mandou o candidato/);
});

test('Gabriel vê os candidatos com os botões desligados e a nota "Só a conta da Robertta decide."', () => {
  const lidos = aba([{ id: '2026-11-17-01' }, { id: '2026-11-17-02' }]);
  const h = htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: GABRIEL, filtro: 'candidatos', agora: AGORA });
  assert.ok(h.includes(NOTA_SO_ROBERTTA));
  const bs = h.match(/<button[^>]*data-acao="candidato-pedir"[^>]*>/g);
  assert.equal(bs.length, 4);
  assert.ok(bs.every((b) => / disabled/.test(b)));
  // Robertta sem internet: desligados, com o motivo
  const off = htmlCandidatos({ candidatos: { ...lidos, offline: true }, dados: dadosPautas(), exec: dadosExec([]), email: ROBERTTA, agora: AGORA });
  assert.match(off, /Sem internet: dá para pedir quando a conexão voltar/);
  assert.ok(off.match(/<button[^>]*data-acao="candidato-pedir"[^>]*>/g).every((b) => / disabled/.test(b)));
  // sem as colunas novas em Decisões: só "Mandar ao Roteirista" desliga
  const semCol = htmlCandidatos({ candidatos: lidos, dados: { ...dadosPautas(), colunasProntas: false }, exec: dadosExec([]), email: ROBERTTA, agora: AGORA });
  assert.ok(!/data-valor="decidir" disabled/.test(semCol));
  assert.match(semCol, /data-valor="roteirista" disabled/);
});

/* ------------------------------------------------------------ estados da aba */

test('aba Candidatos: lendo, sem internet, erro, ausente, vazia, só testes', () => {
  const h = (candidatos) => htmlCandidatos({ candidatos, dados: dadosPautas(), exec: dadosExec([]), email: ROBERTTA, agora: AGORA });
  assert.match(h({ fase: 'carregando' }), /aria-busy="true"/);
  assert.match(h({ fase: 'carregando' }), /Lendo a aba Candidatos/);
  assert.match(h({ fase: 'vazio', offline: true }), /Sem internet/);
  const erro = h({ fase: 'erro', erro: { message: '<b>falhou</b>' } });
  assert.match(erro, /role="alert"/);
  assert.match(erro, /&lt;b&gt;falhou/);
  assert.match(erro, /data-acao="candidatos-recarregar"/);
  assert.ok(h({ fase: 'pronto', candidatos: [], abaAusente: true }).includes(MENSAGEM_CANDIDATOS_AUSENTE));
  assert.match(h(aba([])), /Nenhum candidato na aba Candidatos/);
  assert.match(h(aba([{ id: 'T2026-11-17-01' }])), /Só há candidatos de teste \(T\)/);
  // Seleção ausente não impede ver os candidatos
  const semSelecao = htmlPautas({ dados: { fase: 'erro', erro: { codigo: 'aba-ausente' } }, exec: dadosExec([]), candidatos: aba([{ id: '2026-11-17-01' }]), email: ROBERTTA, filtro: 'candidatos', agora: AGORA });
  assert.match(semSelecao, /cand-2026-11-17-01/);
});

test('lista longa: 30 cartões e "Mostrar mais" (botão); com mais visíveis, todos', () => {
  const linhas = Array.from({ length: 35 }, (_, i) => ({ id: `2026-11-17-${String(i + 1).padStart(2, '0')}` }));
  const lidos = aba(linhas);
  assert.equal(LIMITE_CANDIDATOS, 30);
  const h = htmlCandidatos({ candidatos: lidos, dados: dadosPautas(), exec: dadosExec([]), email: ROBERTTA, agora: AGORA });
  assert.equal(ordemDosCartoes(h).length, 30);
  assert.match(h, /<button type="button" class="botao calmo" data-acao="candidatos-mais">Mostrar mais \(faltam 5\)<\/button>/);
  const todos = htmlCandidatos({ candidatos: lidos, dados: dadosPautas(), exec: dadosExec([]), email: ROBERTTA, visiveis: 60, agora: AGORA });
  assert.equal(ordemDosCartoes(todos).length, 35);
  assert.ok(!todos.includes('candidatos-mais'));
});

/* ------------------------------------------------------------ janelas */

test('janelas: campo de quantidade (number 1–15, padrão 5) e motivo opcional; texto do que vai acontecer', () => {
  const q = campoQuantidade();
  assert.match(q, /type="number"/);
  assert.match(q, /inputmode="numeric" min="1" max="15" step="1"/);
  assert.match(q, /value="5"/);
  assert.match(q, /data-modelo="rd-quantidade"/);
  const m = campoMotivoCandidato();
  assert.match(m, /maxlength="300"/);
  assert.match(m, /\(opcional\)/);

  // os campos aparecem com a ponte ligada (e o confirmar possível); desligada, não
  const ligada = janelaRodar({ rotina: 'radar-diario', email: ROBERTTA, agora: AGORA, dados: dadosExec([]), ligada: true, campos: q });
  assert.match(ligada, /rd-quantidade/);
  const desligada = janelaRodar({ rotina: 'radar-diario', email: ROBERTTA, agora: AGORA, dados: dadosExec([]), ligada: false, campos: q });
  assert.doesNotMatch(desligada, /rd-quantidade/);

  const c = { id: '2026-11-17-01', angulo: '<i>ângulo</i>', criador: '@x' };
  const ex = extrasDoCandidato(c, 'roteirista');
  assert.match(ex[1].texto, /cria a pauta na aba Seleção, verifica as fontes e começa o rascunho/);
  assert.match(ex[1].texto, /é gravada em Decisões e em 1-Radar\/decisoes da semana/);
  assert.match(extrasDoCandidato(c, 'decidir')[1].texto, /pauta proposta na aba Seleção, verifica as fontes, e ela aparece em Para decidir/);
  const j = janelaRodar({
    rotina: 'radar-candidato', idAlvo: c.id, email: ROBERTTA, agora: AGORA, dados: dadosExec([]), ligada: true, extras: ex,
    titulo: 'Mandar ao Roteirista?', rotuloConfirmar: 'Mandar ao Roteirista', campos: m,
  });
  assert.match(j, /Mandar ao Roteirista\?/);
  assert.match(j, /&lt;i&gt;ângulo&lt;\/i&gt;/);
  assert.match(j, /data-acao="rodar-confirmar"[^>]*>[^<]*Mandar ao Roteirista/);
  assert.match(j, /rc-motivo/);
  // Gabriel: a janela não oferece o confirmar
  const g = janelaRodar({ rotina: 'radar-candidato', idAlvo: c.id, email: GABRIEL, agora: AGORA, dados: dadosExec([]), ligada: true, extras: ex });
  assert.doesNotMatch(g, /data-acao="rodar-confirmar"/);
  assert.match(g, /Só a conta da Robertta decide/);

  assert.match(textoDoPedidoCandidato('roteirista', { decisao: 'gravada' }), /aprovação gravada em Decisões/);
  assert.match(textoDoPedidoCandidato('roteirista', { decisao: 'ja-existia' }), /já estava em Decisões/);
  assert.match(textoDoPedidoCandidato('decidir', {}), /aparece em Para decidir/);
  assert.match(textoDoPedidoCandidato('decidir', { repetido: true }), /já tinha chegado/);
});

/* ------------------------------------------------------------ legibilidade (Ponto 1) */

test('Para decidir: tema em texto, verificação como selo com tom, linha Prazo · Verificação · Lote legível', () => {
  assert.equal(tomDaVerificacao('reprovada'), 'alerta');
  assert.equal(tomDaVerificacao('pendente'), 'alerta');
  assert.equal(tomDaVerificacao('aprovada'), 'ok');
  assert.equal(tomDaVerificacao('outra coisa'), 'neutro');
  const dados = dadosPautas({ pautas: [
    { id_pauta: 'S47-01', tema: 'Sono <e> sonhos', estado_verificacao: 'reprovada', id_lote: 'L1' },
    { id_pauta: 'S47-02', estado_verificacao: 'aprovada' },
  ] });
  const h = htmlPautas({ dados, exec: dadosExec([]), candidatos: aba([]), email: ROBERTTA, filtro: 'decidir', agora: AGORA });
  const p1 = h.match(/aria-labelledby="p-S47-01">[\s\S]*?<\/article>/)[0];
  assert.match(p1, /<p class="subtitulo">Sono &lt;e&gt; sonhos<\/p>/);
  assert.doesNotMatch(p1, /class="selo[^"]*">Sono/);
  assert.match(p1, /class="linha-id pequeno">.*Verificação <span class="selo alerta">reprovada<\/span>.*Lote L1/s);
  assert.doesNotMatch(p1, /meta pequeno apagado/);
  assert.match(h, /aria-labelledby="p-S47-02">[\s\S]*?<span class="selo ok">aprovada<\/span>/);
});

test('números do cartão: pt-BR compacto quando é número, texto original (escapado) quando não é', () => {
  assert.equal(sp(numeroCompacto('120000')), '120 mil');
  assert.equal(sp(numeroCompacto('120.000')), '120 mil');
  assert.equal(sp(numeroCompacto(' 1500000 ')), '1,5 mi');
  assert.equal(sp(numeroCompacto('950')), '950');
  assert.equal(numeroDaPlanilha('8x'), 8);
  assert.equal(numeroDaPlanilha('2,5'), 2.5);
  assert.equal(sp(numeroCompacto('cerca de 2 mil')), 'cerca de 2 mil');
  assert.equal(numeroDaPlanilha('1e9'), null);
  assert.equal(numeroDaPlanilha(''), null);
  assert.deepEqual(linhaDosNumeros({ visualizacoes: '120000', mediana_do_criador: '15000', outlier_x: '8', criador: '@a' }).map(sp),
    ['120 mil visualizações', 'mediana 15 mil', '8× a mediana', '@a']);
  assert.deepEqual(linhaDosNumeros({ visualizacoes: 'muitas', outlier_x: 'alto' }), ['Visualizações: muitas', 'outlier altox']);
  // no cartão: o texto livre passa por esc()
  const lidos = aba([{ id: '2026-11-17-01', visualizacoes: '<b>mil</b>', mediana: '15000', outlier: '8' }]);
  const c = cartoes(htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA }))['2026-11-17-01'];
  assert.match(c, /<p class="candidato-numeros">/);
  assert.match(c, /Visualizações: &lt;b&gt;mil&lt;\/b&gt;/);
  assert.match(c, /mediana 15\s?mil/u);
  assert.match(c, /8× a mediana/);
  assert.ok(!c.includes('<b>mil</b>'));
});

test('cartão: tema como subtítulo em texto, no máximo 2 selos (estado + plataforma), status nos Detalhes', () => {
  const lidos = aba([{ id: '2026-11-17-01', tema: 'Um tema <longo> da planilha', status: 'novo', plataforma: 'TikTok' }]);
  const h = htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA });
  const c = cartoes(h)['2026-11-17-01'];
  assert.match(c, /<p class="subtitulo">Um tema &lt;longo&gt; da planilha<\/p>/);
  assert.doesNotMatch(c, /class="selo[^"]*">Um tema/);
  const selos = c.match(/class="selo [^"]*">[^<]*/g) || [];
  assert.ok(selos.length <= 2, selos.join());
  assert.match(c, /class="selo neutro">TikTok/);
  assert.doesNotMatch(c, /class="selo[^"]*">novo/);
  assert.match(c, /<dt>Status na planilha<\/dt><dd>novo<\/dd>/);
});

test('janela do candidato: larga, na ordem resumo → o que vai acontecer → Motivo → Como funciona (custo e limites visíveis)', () => {
  assert.equal(classeJanelaRodar('radar-candidato'), 'janela larga');
  assert.equal(classeJanelaRodar('radar-diario'), 'janela');
  const c = { id: '2026-11-17-01', angulo: 'Ângulo <x>', tema: 'sono', criador: '@a', visualizacoes: '120000', plataforma: 'Instagram' };
  const h = janelaRodar({
    rotina: 'radar-candidato', idAlvo: c.id, email: ROBERTTA, agora: AGORA, dados: dadosExec([]), ligada: true,
    extras: extrasDoCandidato(c, 'decidir'), campos: campoMotivoCandidato(),
  });
  assert.ok(!h.includes('<x>'));
  assert.match(h, /class="titulo-resumo">Ângulo &lt;x&gt;</);
  assert.match(h, /120\s?mil visualizações/u);
  const ordem = [/class="resumo-candidato"/, /O que vai acontecer/, /rc-motivo/, /class="como-funciona"/, /<dt>Custo<\/dt>/, /<dt>Limites<\/dt>/].map((re) => h.search(re));
  assert.ok(ordem.every((p) => p >= 0), String(ordem));
  assert.deepEqual([...ordem].sort((a, b) => a - b), ordem);
  assert.match(h, /class="confirmacao lado-a-lado"><div><dt>Tempo<\/dt>.*<dt>Custo<\/dt>/s);
  assert.match(h, /class="confirmacao letra-menor"><div><dt>Limites<\/dt>/);
  // sem ponte: tudo continua visível (custo e limites), sem o campo Motivo
  const sem = janelaRodar({ rotina: 'radar-candidato', idAlvo: c.id, email: ROBERTTA, agora: AGORA, dados: dadosExec([]), ligada: false, extras: extrasDoCandidato(c, 'decidir'), campos: campoMotivoCandidato() });
  assert.match(sem, /<dt>Custo<\/dt>/);
  assert.doesNotMatch(sem, /rc-motivo/);
  // as outras janelas continuam como eram
  const d = janelaRodar({ rotina: 'radar-diario', email: ROBERTTA, agora: AGORA, dados: dadosExec([]), ligada: true });
  assert.doesNotMatch(d, /como-funciona/);
});

/* ------------------------------------------------------------ Ficha (opção A) */

const RADAR_CAND = 'PÚBLICO/SITUAÇÃO: adultos que esperam ser deixados. PERGUNTA: por que o medo de ser abandonado faz ler sinais neutros como rejeição? ENTREGA: distinguir o medo do risco real. REFERÊNCIAS (consultado só o resumo): (1) Meta-análise 2023, https://doi.org/10.1/x - sustenta; (2) Li & Chan 2012 - sustenta; (3) Revisão Exeter (http://hdl.handle.net/1/2) - transversal. LIMITES: correlacional; sem promessa de cura. ORIGENS: post no X <b>12/11</b>.';

test('ficha do candidato: pergunta no título, tema antes, entrega à vista, números limpos, seções recolhidas', () => {
  const lidos = aba([{ id: '2026-11-17-01', tema: 'Relacionamentos', angulo: RADAR_CAND,
    visualizacoes: '230.111 impressões, 929 salvamentos (X, coleta 14/11/2026)', mediana: 'N/D (sem mediana)', outlier: 'N/D', criador: '@perfil' }]);
  const c = cartoes(htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA }))['2026-11-17-01'];
  assert.match(c, /<h2 id="cand-2026-11-17-01">Por que o medo de ser abandonado faz ler sinais neutros como rejeição\?<\/h2>/);
  assert.ok(c.indexOf('<p class="subtitulo">Relacionamentos</p>') < c.indexOf('<h2'));
  assert.match(c, /<p class="ficha-entrega"><b>Entrega:<\/b> distinguir o medo do risco real\.<\/p>/);
  const linha = c.match(/<p class="candidato-numeros">([\s\S]*?)<\/p>/)[1].replace(/ /g, ' ');
  assert.match(linha, /<b>230,1 mil<\/b> impressões/);
  assert.match(linha, /<b>929<\/b> salvamentos/);
  assert.match(linha, /@perfil/);
  assert.doesNotMatch(linha, /N\/D/);
  const refs = c.match(/<details class="ficha-secao"><summary>Referências <small>consultado só o resumo<\/small><\/summary>[\s\S]*?<\/details>/)[0];
  assert.equal((refs.match(/<li>/g) || []).length, 3);
  assert.match(refs, /<a href="https:\/\/doi\.org\/10\.1\/x"/);
  assert.doesNotMatch(refs, /href="http:/);
  assert.match(c, /<details class="ficha-secao"><summary>Limites<\/summary>/);
  assert.match(c, /<details class="ficha-secao"><summary>Para quem<\/summary>/);
  assert.match(c, /post no X &lt;b&gt;12\/11&lt;\/b&gt;/);
  assert.ok(!c.includes('<b>12/11</b>'));
  const num = c.match(/<summary>Números e origem<\/summary>[\s\S]*?<\/details>/)[0];
  assert.match(num, /<dt>Visualizações<\/dt><dd>230\.111 impressões, 929 salvamentos \(X, coleta 14\/11\/2026\)<\/dd>/);
  assert.match(num, /<dt>Mediana<\/dt><dd>N\/D \(sem mediana\)<\/dd>/);
  assert.ok(c.lastIndexOf('<details><summary>Detalhes</summary>') > c.lastIndexOf('ficha-secao'));
  assert.ok(!c.includes('PÚBLICO/SITUAÇÃO'));
});

test('ficha do candidato antigo (ângulo curto, número puro): igual a antes, sem seções', () => {
  const lidos = aba([{ id: '2026-11-17-01', angulo: 'Ângulo curto', visualizacoes: '120000' }]);
  const c = cartoes(htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA }))['2026-11-17-01'];
  assert.match(c, /<h2 id="cand-2026-11-17-01">Ângulo curto<\/h2>/);
  assert.match(c.replace(/ /g, ' '), /120 mil visualizações · <\/?span[^>]*>?|120 mil visualizações/);
  assert.doesNotMatch(c, /ficha-secao|ficha-entrega/);
});

test('ficha: com visualizações em frase, mediana e outlier numéricos continuam na linha; N/D sai', () => {
  const lidos = aba([{ id: '2026-11-17-01', angulo: 'PERGUNTA: p? ENTREGA: e', visualizacoes: '230.111 impressões', mediana: '15000', outlier: '8', criador: '@a' }]);
  const c = cartoes(htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA }))['2026-11-17-01'];
  const linha = c.match(/<p class="candidato-numeros">([\s\S]*?)<\/p>/)[1].replace(/ /g, ' ').replace(/<[^>]+>/g, '');
  assert.equal(linha, '230,1 mil impressões · mediana 15 mil · 8× a mediana · @a');
});

test('criador com @: nome de usuário solto ganha @; com @, URL ou frase fica como está', async () => {
  const { comArroba } = await import('../js/telas/pautas.js');
  assert.equal(comArroba('thomytalks'), '@thomytalks');
  assert.equal(comArroba(' perfil.ficticio_2 '), '@perfil.ficticio_2');
  assert.equal(comArroba('@ja.tem'), '@ja.tem');
  assert.equal(comArroba(''), '');
  assert.equal(comArroba('https://x.com/a'), 'https://x.com/a');
  assert.equal(comArroba('post no X publicado em 12/11'), 'post no X publicado em 12/11');
  assert.deepEqual(linhaDosNumeros({ visualizacoes: '120000', criador: 'thomytalks' }).map(sp), ['120 mil visualizações', '@thomytalks']);
  const lidos = aba([{ id: '2026-11-17-01', criador: 'thomytalks', visualizacoes: '230.111 impressões' }]);
  const c = cartoes(htmlPautas({ dados: dadosPautas(), exec: dadosExec([]), candidatos: lidos, email: ROBERTTA, filtro: 'candidatos', agora: AGORA }))['2026-11-17-01'];
  assert.match(c.match(/<p class="candidato-numeros">[\s\S]*?<\/p>/)[0], /@thomytalks/);
});
