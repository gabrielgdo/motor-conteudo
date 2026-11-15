// Testes da camada manual nas telas (parte B), sem DOM: as funções que montam o HTML recebem os
// dados prontos. Cobrem a faixa de execução, a janela "Rodar agora?" a partir do catálogo (com a
// ponte desligada e ligada, trava, "parece travada", proteção), Detalhes (escape e links), Pautas
// (escape de conteúdo malicioso, contagem, filtros, conta que não decide, estados honestos),
// decisões de pauta e de roteiro, a janela da prévia e o Histórico com Execuções. Datas fixas;
// textos fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED, FLAGS } from '../js/config.js';
// Estes testes cobrem o app com a ponte desligada (o padrão antigo); a ponte ligada é testada em ponte.test.mjs.
FLAGS.ponte = false;
import { lerDataHora } from '../js/parse.js';
import { lerExecucoes, COLUNAS_EXECUCOES, planejarDecisaoRoteiro, MOTIVOS_ROTEIRO } from '../js/controle.js';
import { lerSelecao, lerDecisoes, MENSAGEM_COLUNAS_DECISOES } from '../js/selecao.js';
import {
  faixaExecucao, janelaRodar, janelaDetalhes, historicoComExecucoes, NOTA_PONTE_DESLIGADA, ponteLigada,
} from '../js/componentes/execucao.js';
import {
  htmlPautas, pautasParaDecidir, contarParaDecidir, aprovadasParaEnviar, loteDaProximaSelecao, pedidosDaTela,
  resultadosDaGravacao, janelaDecisoes, bloqueioDeDecisao, MENSAGEM_SELECAO_AUSENTE, NOTA_SO_ROBERTTA,
} from '../js/telas/pautas.js';
import { decisaoDoRascunho } from '../js/telas/roteiros.js';
import { janelaPrevia } from '../js/telas/videos.js';
import { htmlResultados } from '../js/telas/resultados.js';

const ROBERTTA = ALLOWED[0];
const GABRIEL = ALLOWED[1];
const AGORA = lerDataHora('2026-11-18 10:30'); // quarta, semana ISO 47
const MAL = '<img src=x onerror=alert(1)>';

/* ------------------------------------------------------------ fixtures */

function execucoes(...linhas) {
  return lerExecucoes([COLUNAS_EXECUCOES, ...linhas.map((o) => COLUNAS_EXECUCOES.map((c) => o[c] ?? ''))]).execucoes;
}
const ex = (o) => ({ bot: 'radar', rotina: 'radar-diario', origem: 'agendada', quem: 'cron', status: 'ok', teste: 'não', ...o });
const TRES_OK = [
  ex({ id_execucao: 'EX-1', inicio: '2026-11-16 07:00', fim: '2026-11-16 07:14' }),
  ex({ id_execucao: 'EX-2', inicio: '2026-11-17 07:00', fim: '2026-11-17 07:14' }),
  ex({ id_execucao: 'EX-3', inicio: '2026-11-18 07:12', fim: '2026-11-18 07:26' }),
];
const dadosExec = (lista) => ({ fase: 'pronto', execucoes: lista, abaAusente: false });

const CAB_SELECAO = [
  'id_pauta', 'id_candidato', 'semana', 'data_selecao', 'titulo', 'tema', 'rede', 'publico_situacao', 'pergunta_central',
  'entrega', 'por_que_agora', 'sinal_social', 'fundamentacao', 'contribuicao_junguiana', 'estado_verificacao',
  'restricao_principal', 'nota_v2', 'prazo', 'ganchos_opcionais', 'status', 'id_lote',
];
const pauta = (o) => {
  const v = { semana: 'S47', titulo: `Pauta ${o.id_pauta}`, tema: 'tema fictício', rede: 'ig', status: 'proposta', id_lote: 'S47-manual-1', nota_v2: '80', ...o };
  return CAB_SELECAO.map((c) => v[c] ?? '');
};
const CAB_DECISOES = ['semana', 'pauta', 'decisao', 'motivo', 'id_pauta', 'rede', 'id_candidato', 'id_lote', 'data', 'quem', 'origem'];
const decisao = (o) => CAB_DECISOES.map((c) => ({ semana: 'S47', data: '2026-11-18 10:12', origem: 'chat', ...o })[c] ?? '');

function dadosPautas({ pautas, decisoes = [], cabDecisoes = CAB_DECISOES, decisoesAusente = false } = {}) {
  const selecao = lerSelecao([CAB_SELECAO, ...pautas.map(pauta)]);
  const dec = lerDecisoes(decisoesAusente ? [] : [cabDecisoes, ...decisoes.map(decisao)]);
  return { fase: 'pronto', selecao, decisoes: dec, colunasProntas: !decisoesAusente && cabDecisoes === CAB_DECISOES, decisoesAusente };
}

const PAUTAS = [
  { id_pauta: 'S47-01', nota_v2: '91' },
  { id_pauta: 'S47-02', nota_v2: '72' },
  { id_pauta: 'S47-03', status: 'aprovada' },
  { id_pauta: 'S47-04', status: 'enviada ao Roteirista' },
  { id_pauta: 'T01', status: 'proposta' },
];

/* --------------------------------------------------------------- faixa */

test('faixa: aba Execuções ausente → "ainda sem registro", sem dado falso e sem Detalhes', () => {
  const h = faixaExecucao({ rotina: 'radar-diario', dados: { fase: 'pronto', execucoes: [], abaAusente: true }, agora: AGORA, botao: { texto: 'Rodar agora' } });
  assert.match(h, /Radar diário/);
  assert.match(h, /ainda sem registro/);
  assert.doesNotMatch(h, /média|última/);
  assert.doesNotMatch(h, /execucao-detalhes/);
  assert.match(h, /<button type="button" class="botao contorno menor" data-acao="rodar-abrir" data-valor="radar-diario">Rodar agora<\/button>/);
});

test('faixa: última rodada, selo do status e média com 3 rodadas ok', () => {
  const h = faixaExecucao({ rotina: 'radar-diario', dados: dadosExec(execucoes(...TRES_OK)), agora: AGORA, botao: { texto: 'Rodar agora' } });
  assert.match(h, /última: <\/span>hoje 7h12/);
  assert.match(h, /<span class="selo ok">ok<\/span>/);
  assert.match(h, /média 14 min/);
  assert.match(h, /data-acao="execucao-detalhes" data-valor="radar-diario"/);
  // Com menos de 3 rodadas: "ainda sem medição".
  const h2 = faixaExecucao({ rotina: 'radar-diario', dados: dadosExec(execucoes(TRES_OK[2])), agora: AGORA });
  assert.match(h2, /ainda sem medição/);
  // Erro tem o tom de alerta que já existe.
  const h3 = faixaExecucao({ rotina: 'radar-diario', dados: dadosExec(execucoes(ex({ inicio: '2026-11-18 07:00', status: 'erro' }))), agora: AGORA });
  assert.match(h3, /<span class="selo alerta">erro<\/span>/);
});

test('faixa do motor: só leitura; sem linha → "o motor ainda não publica o andamento no app"', () => {
  const semLinha = faixaExecucao({ bot: 'motor', rotulo: 'Motor de edição', idAlvo: 'S47-01', dados: dadosExec([]), semRegistro: 'o motor ainda não publica o andamento no app', agora: AGORA });
  assert.match(semLinha, /o motor ainda não publica o andamento no app/);
  assert.doesNotMatch(semLinha, /rodar-abrir/);
  const lista = execucoes({ bot: 'motor', rotina: 'motor-editar', origem: 'vigia', id_alvo: 'S47-01', inicio: '2026-11-18 09:00', status: 'rodando' });
  const h = faixaExecucao({ bot: 'motor', rotulo: 'Motor de edição', idAlvo: 'S47-01', dados: dadosExec(lista), agora: AGORA });
  assert.match(h, /Editar a prévia, hoje 9h/);
  assert.match(h, /<span class="selo espera">rodando<\/span>/);
  assert.match(h, /data-valor="bot:motor" data-id="S47-01"/);
  assert.doesNotMatch(h, /rodar-abrir/);
});

/* ------------------------------------------------- janela "Rodar agora?" */

test('janela: textos do catálogo (o que roda, produz, tempo, custo, limites, semanal) e ponte desligada', () => {
  assert.equal(FLAGS.ponte, false);
  assert.equal(ponteLigada(), false);
  const h = janelaRodar({ rotina: 'radar-diario', email: GABRIEL, agora: AGORA, dados: dadosExec([]) });
  assert.match(h, /Radar diário: rodar agora\?/);
  assert.doesNotMatch(h, /undefined|\[object|NaN/);
  assert.match(h, /<dt>O que vai rodar<\/dt><dd>Radar diário: pesquisa os temas ativos/);
  assert.match(h, /<dt>O que vai produzir e onde<\/dt><dd>Grava os candidatos na aba Candidatos/);
  assert.match(h, /<dt>Tempo<\/dt><dd>ainda sem medição<\/dd>/);
  assert.match(h, /<dt>Custo<\/dt><dd>Usa a cota do seu plano Grok Bot/);
  assert.match(h, /X: 30 leituras\/min e 1000\/dia\./);
  assert.match(h, /A próxima rodada agendada é amanhã às 7h\./);
  assert.match(h, /<dt>Efeito no semanal<\/dt>/);
  // No lugar do confirmar, a nota calma; nenhum botão de confirmar ativo.
  assert.ok(h.includes(NOTA_PONTE_DESLIGADA));
  assert.doesNotMatch(h, /data-acao="rodar-confirmar"/);
  // A conta do Gabriel pode disparar (quando ligar): nada de "sem permissão".
  assert.doesNotMatch(h, /não pode disparar/);
});

test('janela: ponte ligada → confirmar ativo; tocado → desabilitado ("Enviando…")', () => {
  const h = janelaRodar({ rotina: 'radar-diario', email: ROBERTTA, agora: AGORA, dados: dadosExec([]), ligada: true });
  assert.match(h, /<button type="button" class="botao primario" data-acao="rodar-confirmar">Rodar agora<\/button>/);
  const h2 = janelaRodar({ rotina: 'radar-diario', email: ROBERTTA, agora: AGORA, dados: dadosExec([]), ligada: true, enviando: true });
  assert.match(h2, /data-acao="rodar-confirmar" disabled aria-busy="true">Enviando…/);
});

test('janela: trava "Rodando desde 7h03 (agendada)" com o botão desabilitado', () => {
  const agora = lerDataHora('2026-11-18 07:40');
  const lista = execucoes(ex({ inicio: '2026-11-18 07:03', status: 'rodando' }));
  const h = janelaRodar({ rotina: 'radar-diario', email: ROBERTTA, agora, dados: dadosExec(lista), ligada: true });
  assert.match(h, /Rodando desde 7h03 \(agendada\)/);
  assert.match(h, /<button type="button" class="botao primario" disabled>Rodar agora<\/button>/);
  assert.doesNotMatch(h, /data-acao="rodar-confirmar"/);
});

test('janela: "Parece travada" pede a segunda confirmação para marcar e rodar de novo', () => {
  const lista = execucoes(ex({ id_execucao: 'EX-VELHA', inicio: '2026-11-18 07:03', status: 'rodando' }));
  const h = janelaRodar({ rotina: 'radar-diario', email: ROBERTTA, agora: AGORA, dados: dadosExec(lista), ligada: true });
  assert.match(h, /Parece travada/);
  assert.match(h, /data-acao="rodar-travada">Marcar como travada e rodar de novo/);
  assert.doesNotMatch(h, /data-acao="rodar-confirmar"/);
  const h2 = janelaRodar({ rotina: 'radar-diario', email: ROBERTTA, agora: AGORA, dados: dadosExec(lista), ligada: true, etapa: 'travada' });
  assert.match(h2, /Tem certeza\?/);
  assert.match(h2, /data-acao="rodar-confirmar" data-valor="travada">Sim, marcar como travada e rodar/);
  // Ponte desligada: a opção aparece, mas desabilitada, e a nota calma no lugar do confirmar.
  const h3 = janelaRodar({ rotina: 'radar-diario', email: ROBERTTA, agora: AGORA, dados: dadosExec(lista) });
  assert.match(h3, /data-acao="rodar-travada" disabled/);
  assert.ok(h3.includes(NOTA_PONTE_DESLIGADA));
});

test('janela: proteção perto da rodada agendada (o manual volta às 9h)', () => {
  const h = janelaRodar({ rotina: 'radar-selecao', email: ROBERTTA, agora: lerDataHora('2026-11-18 06:30'), dados: dadosExec([]), ligada: true });
  assert.match(h, /Perto da rodada agendada \(Radar diário, hoje às 7h\): o disparo manual fica fechado até 9h\./);
  assert.match(h, /<button type="button" class="botao primario" disabled>Fazer seleção agora<\/button>/);
});

test('janela: sem a aba Execuções, avisa que não dá para ver rodada em andamento; extras do lote', () => {
  const h = janelaRodar({
    rotina: 'radar-selecao', email: ROBERTTA, agora: AGORA, dados: { fase: 'pronto', execucoes: [], abaAusente: true },
    extras: [{ chave: 'lote', rotulo: 'Lote que vai nascer', texto: 'S47-manual-2' }],
  });
  assert.match(h, /Sem a aba Execuções, o app não consegue ver se há uma rodada em andamento\./);
  assert.match(h, /<dt>Lote que vai nascer<\/dt><dd>S47-manual-2<\/dd>/);
});

test('lote da próxima seleção: maior número já usado + 1 (Execuções e Seleção)', () => {
  const d = dadosPautas({ pautas: [{ id_pauta: 'S47-01', id_lote: 'S47-manual-1' }] });
  const lista = execucoes(ex({ rotina: 'radar-selecao', origem: 'manual-app', id_lote: 'S47-manual-3', inicio: '2026-11-17 15:00' }));
  assert.equal(loteDaProximaSelecao({ execucoes: [], selecao: d.selecao, agora: AGORA }), 'S47-manual-2');
  assert.equal(loteDaProximaSelecao({ execucoes: lista, selecao: d.selecao, agora: AGORA }), 'S47-manual-4');
  assert.equal(loteDaProximaSelecao({ agora: AGORA }), 'S47-manual-1');
});

/* ------------------------------------------------------------ detalhes */

test('Detalhes: escapa o que vem da planilha; link só https', () => {
  const lista = execucoes(
    ex({ inicio: '2026-11-18 07:12', resumo: MAL, erro: '"><script>x()</script>', quem: 'a@b', link: 'javascript:alert(1)' }),
    ex({ inicio: '2026-11-17 07:12', link: 'https://drive.google.com/file/d/abc' }),
  );
  const h = janelaDetalhes({ rotina: 'radar-diario', dados: dadosExec(lista), agora: AGORA });
  assert.ok(!h.includes('<img'));
  assert.ok(!h.includes('<script'));
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!h.includes('javascript:'));
  assert.match(h, /href="https:\/\/drive\.google\.com\/file\/d\/abc" target="_blank" rel="noopener noreferrer"/);
  assert.match(h, /agendada · cron/);
});

/* -------------------------------------------------------------- pautas */

test('Pautas: título malicioso vindo da planilha sai escapado no HTML (e os outros campos também)', () => {
  const d = dadosPautas({ pautas: [{ id_pauta: 'S47-01', titulo: MAL, tema: MAL, pergunta_central: MAL, fundamentacao: '"onmouseover="x', id_lote: MAL }] });
  const h = htmlPautas({ dados: d, exec: dadosExec([]), email: ROBERTTA, agora: AGORA });
  assert.ok(!h.includes('<img'), 'nenhuma tag <img> do conteúdo');
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!h.includes('"onmouseover="x'));
  assert.match(h, /aria-label="Decisão sobre &lt;img src=x onerror=alert\(1\)&gt;"/);
});

test('Pautas: contagem para decidir (proposta, sem decisão, sem testes) e filtros', () => {
  const d = dadosPautas({ pautas: PAUTAS, decisoes: [{ id_pauta: 'S47-02', decisao: 'recusada', motivo: 'timing' }] });
  assert.deepEqual(pautasParaDecidir(d.selecao, d.decisoes).map((p) => p.id_pauta), ['S47-01']);
  assert.equal(contarParaDecidir(d), 1);
  assert.equal(contarParaDecidir({ fase: 'carregando' }), 0);
  assert.deepEqual(aprovadasParaEnviar(d.selecao, d.decisoes).map((p) => p.id_pauta), ['S47-03']);

  const para = htmlPautas({ dados: d, exec: dadosExec([]), email: ROBERTTA, agora: AGORA });
  const todasH = htmlPautas({ dados: d, exec: dadosExec(execucoes(...TRES_OK)), email: ROBERTTA, filtro: 'todas', pendentes: { 'S47-01': 'recusada' }, agora: AGORA });
  assert.doesNotMatch(para + todasH, /undefined|\[object|NaN/);
  assert.match(para, /Para decidir \(2\)/); // S47-01 e o teste T01 (que aparece, mas não se decide)
  assert.match(para, /Decididas \(3\)/);
  assert.match(para, /Todas \(5\)/);
  assert.match(para, /id="p-S47-01"/);
  assert.doesNotMatch(para, /id="p-S47-03"/);
  // Teste: selo e a nota; sem botões de decisão.
  assert.match(para, /<span class="selo neutro">Teste<\/span>/);
  assert.match(para, /teste não vai para Decisões/);
  assert.doesNotMatch(para, /data-acao="pauta-decidir" data-id="T01"/);
  // Com aprovadas e nada pendente, a barra oferece "Enviar ao Roteirista".
  assert.match(para, /data-acao="pautas-enviar">Enviar ao Roteirista \(1 aprovada\)/);

  const decididas = htmlPautas({ dados: d, exec: dadosExec([]), email: ROBERTTA, filtro: 'decididas', agora: AGORA });
  assert.match(decididas, /id="p-S47-02"/);
  assert.match(decididas, /Decidida pelo chat hoje às 10h12 · timing/);
  assert.match(decididas, /data-acao="pauta-mudar" data-id="S47-02"/);
  // Enviada ao Roteirista: sem "Mudar decisão".
  assert.doesNotMatch(decididas, /data-acao="pauta-mudar" data-id="S47-04"/);
  assert.match(decididas, /Já foi para o Roteirista/);
});

test('Pautas: Aprovar/Recusar com aria-pressed; recusar mostra os 5 motivos; barra "Confirmar decisões (n)"', () => {
  const d = dadosPautas({ pautas: PAUTAS });
  const h = htmlPautas({ dados: d, exec: dadosExec([]), email: ROBERTTA, pendentes: { 'S47-01': 'aprovada', 'S47-02': 'recusada' }, agora: AGORA });
  assert.match(h, /data-id="S47-01" data-valor="aprovada" aria-pressed="true"/);
  assert.match(h, /data-id="S47-02" data-valor="recusada" aria-pressed="true"/);
  for (const m of ['repetição', 'recorte', 'timing', 'desalinhamento', 'fundamentação']) assert.ok(h.includes(`name="pm-S47-02" data-modelo="pm-S47-02" value="${m}"`), m);
  assert.match(h, /id="c-po-S47-02"/);
  assert.match(h, /data-acao="pautas-confirmar">Confirmar decisões \(2\)/);
  assert.match(h, /<i class="aprovada"><\/i><i class="recusada"><\/i>/);
});

test('Pautas: a conta que não decide vê tudo, com os botões desabilitados e a nota', () => {
  const d = dadosPautas({ pautas: PAUTAS });
  const h = htmlPautas({ dados: d, exec: dadosExec([]), email: GABRIEL, agora: AGORA });
  assert.match(h, /data-acao="pauta-decidir" data-id="S47-01" data-valor="aprovada" aria-pressed="false" disabled/);
  assert.ok(h.includes(NOTA_SO_ROBERTTA));
  assert.match(h, /data-acao="pautas-enviar" disabled/);
  // As faixas continuam (disparar é permitido à segunda conta).
  assert.match(h, /data-acao="rodar-abrir" data-valor="radar-diario">Rodar agora/);
  assert.match(h, /data-acao="rodar-abrir" data-valor="radar-selecao" title="Lote S47-manual-2">Fazer seleção agora/);
});

test('Pautas: estados honestos (aba Seleção ausente, carregando, offline, erro, colunas novas ausentes, Decisões ausente)', () => {
  const ausente = htmlPautas({ dados: { fase: 'erro', erro: { codigo: 'aba-ausente', message: 'x' } }, exec: dadosExec([]), email: ROBERTTA, agora: AGORA });
  assert.ok(ausente.includes(MENSAGEM_SELECAO_AUSENTE));
  assert.match(ausente, /Radar diário/); // as faixas aparecem mesmo assim

  assert.match(htmlPautas({ dados: { fase: 'carregando' }, exec: {}, email: ROBERTTA }), /aria-busy="true"/);
  assert.match(htmlPautas({ dados: { fase: 'carregando', offline: true }, exec: {}, email: ROBERTTA }), /Sem internet/);
  const erro = htmlPautas({ dados: { fase: 'erro', erro: { message: MAL } }, exec: {}, email: ROBERTTA });
  assert.match(erro, /Não consegui ler a planilha Radar/);
  assert.match(erro, /data-acao="pautas-recarregar"/);
  assert.ok(!erro.includes('<img'));

  const semColunas = dadosPautas({ pautas: PAUTAS, cabDecisoes: ['semana', 'pauta', 'decisao', 'motivo'] });
  const h = htmlPautas({ dados: semColunas, exec: dadosExec([]), email: ROBERTTA, agora: AGORA });
  assert.ok(h.includes(MENSAGEM_COLUNAS_DECISOES));
  assert.match(h, /data-acao="pauta-decidir" data-id="S47-01" data-valor="aprovada" aria-pressed="false" disabled/);

  const semDecisoes = dadosPautas({ pautas: PAUTAS, decisoesAusente: true });
  assert.match(bloqueioDeDecisao({ email: ROBERTTA, dados: semDecisoes }), /aba Decisões não foi encontrada/);
  assert.equal(bloqueioDeDecisao({ email: ROBERTTA, dados: dadosPautas({ pautas: PAUTAS }) }), '');
  assert.equal(bloqueioDeDecisao({ email: GABRIEL, dados: dadosPautas({ pautas: PAUTAS }) }), NOTA_SO_ROBERTTA);
});

test('Pautas: pedidos da tela (recusa sem motivo é erro; ids T e fora da Seleção ficam de fora)', () => {
  const d = dadosPautas({ pautas: PAUTAS });
  const { pedidos, erros } = pedidosDaTela(
    { 'S47-01': 'aprovada', 'S47-02': 'recusada', T01: 'aprovada', 'S99-01': 'aprovada' },
    { 'po-S47-01': '  ótima  ', 'pm-S47-02': '' },
    d.selecao,
  );
  assert.deepEqual(pedidos.map((p) => p.id_pauta), ['S47-01', 'S47-02']);
  assert.equal(pedidos[0].observacao, 'ótima');
  assert.deepEqual(Object.keys(erros), ['pm-S47-02']);
  const ok = pedidosDaTela({ 'S47-02': 'recusada' }, { 'pm-S47-02': 'timing' }, d.selecao);
  assert.deepEqual(ok.erros, {});
  assert.equal(ok.pedidos[0].motivo, 'timing');
});

test('Pautas: resultado por pauta (gravada / já estava assim / já decidida pelo chat / erro) e a janela', () => {
  const res = resultadosDaGravacao({
    resultados: [
      { id_pauta: 'S47-01', acao: 'gravar', motivo: 'nova', mensagem: 'aprovada' },
      { id_pauta: 'S47-02', acao: 'nada', motivo: 'ja-estava', mensagem: 'já estava assim' },
      { id_pauta: 'S47-03', acao: 'recusado', motivo: 'ja-decidido', mensagem: 'já decidido pelo chat às 10h12' },
      { id_pauta: 'S47-05', acao: 'erro', motivo: 'x', mensagem: 'Não encontrei a pauta.' },
      { id_pauta: 'S47-06', acao: 'gravar', motivo: 'mudanca', mensagem: 'muda de aprovada para recusada', mudanca: true },
    ],
    falhasSelecao: [{ id_pauta: 'S47-01', erro: new Error('x') }],
  });
  assert.match(res['S47-01'].mensagem, /^Gravada\. O status na Seleção não atualizou/);
  assert.equal(res['S47-02'].mensagem, 'Já estava assim.');
  assert.equal(res['S47-03'].mensagem, 'Não gravada: já decidido pelo chat às 10h12.');
  assert.equal(res['S47-05'].mensagem, 'Erro: Não encontrei a pauta.');
  assert.equal(res['S47-06'].mensagem, 'Gravada: muda de aprovada para recusada.');

  const itens = [{ id_pauta: 'S47-01', titulo: MAL, decisao: 'aprovada' }, { id_pauta: 'S47-02', titulo: 'B', decisao: 'recusada', motivo: 'timing', observacao: 'agora não', de: 'aprovada' }];
  const antes = janelaDecisoes({ itens });
  assert.match(antes, /Confirmar as 2 decisões\?/);
  assert.match(antes, /Onde grava:<\/strong> Decisões e status na Seleção da planilha Radar; o Radar e o domingo passam a considerar estas decisões/);
  assert.match(antes, /Recusar \(timing: agora não\) · muda de aprovada/);
  assert.match(antes, /data-acao="pautas-gravar">Gravar as 2 decisões/);
  assert.ok(!antes.includes('<img'));
  const depois = janelaDecisoes({ itens, resultados: res });
  assert.match(depois, /Decisões gravadas/);
  assert.match(depois, /Já estava assim\./);
  assert.doesNotMatch(depois, /pautas-gravar/);
});

/* ------------------------------------------------------------ roteiros */

test('decisão de roteiro: payload para a ponte (aprovar, pedir mudança, recusar com motivo)', () => {
  assert.deepEqual(planejarDecisaoRoteiro({ id: 'S47-04', versao: 2, decisao: 'aprovar', pedido: 'ignorado' }).payload,
    { id: 'S47-04', versao: 2, decisao: 'aprovar', pedido: '', motivo: '' });
  const m = planejarDecisaoRoteiro({ id: 'S47-04', versao: '2', decisao: 'mudar', pedido: '  abrir com a pergunta\r\n\r\n\r\nsem o dado\u0007 ' });
  assert.equal(m.ok, true);
  assert.equal(m.payload.pedido, 'abrir com a pergunta\n\nsem o dado');
  assert.equal(m.payload.versao, 2);
  assert.deepEqual(planejarDecisaoRoteiro({ id: 'S47-04', versao: 2, decisao: 'mudar', pedido: '  ' }).erros, { pedido: 'Escreva o que mudar.' });
  const r = planejarDecisaoRoteiro({ id: 'T01-01', versao: 1, decisao: 'recusar', motivo: 'Etica', observacao: 'linha\n dois' });
  assert.equal(r.payload.motivo, 'ética: linha dois');
  assert.match(r.resumo, /Recusar o rascunho v1 \(ética: linha dois\)/);
  assert.deepEqual(Object.keys(planejarDecisaoRoteiro({ id: 'S47-04', versao: 1, decisao: 'recusar', motivo: 'chato' }).erros), ['motivo']);
  assert.deepEqual(Object.keys(planejarDecisaoRoteiro({ id: '../x', versao: 0, decisao: 'talvez' }).erros).sort(), ['decisao', 'id', 'versao']);
  assert.deepEqual([...MOTIVOS_ROTEIRO], ['tom', 'clareza', 'fundamentação', 'ética', 'desalinhamento']);
});

test('Roteiros: aside "Sua decisão" (faixa da rotina do id; desabilitado para a conta que não decide)', () => {
  const r = { id: 'S47-04', versaoRoteiro: 2, lido: true, fontes: [], etapa: 'rascunho', fontesConferidas: true };
  const lista = execucoes({ bot: 'roteirista', rotina: 'roteirista-decisao', origem: 'manual-app', id_alvo: 'S47-04', inicio: '2026-11-18 09:00', status: 'ok', resumo: MAL });
  const h = decisaoDoRascunho(r, { email: ROBERTTA, escolha: 'recusar', exec: dadosExec(lista), agora: AGORA });
  assert.match(h, /Decisão pelo app/);
  assert.match(h, /data-acao="roteiro-escolher" data-id="S47-04" data-valor="recusar" aria-pressed="true"/);
  for (const m of MOTIVOS_ROTEIRO) assert.ok(h.includes(`value="${m}"`), m);
  assert.match(h, /data-acao="roteiro-confirmar" data-id="S47-04">Recusar o rascunho/);
  assert.doesNotMatch(h, /chega na próxima etapa/);
  const g = decisaoDoRascunho(r, { email: GABRIEL, escolha: '', exec: dadosExec([]), agora: AGORA });
  assert.match(g, /data-valor="aprovar" aria-pressed="false" disabled/);
  assert.match(g, /Só a conta da Robertta decide\./);
  assert.doesNotMatch(g, /roteiro-confirmar/);
});

test('Roteiros: confirmação pela ponte desligada diz para responder ao Roteirista no chat', () => {
  const nota = 'O disparo pelo app ainda não está ligado. Por enquanto, responda ao Roteirista no chat.';
  const h = janelaRodar({
    rotina: 'roteirista-decisao', idAlvo: 'S47-04', email: ROBERTTA, agora: AGORA, dados: dadosExec([]),
    extras: [{ chave: 'decisao', rotulo: 'Sua decisão', texto: 'Aprovar o rascunho v2' }], notaDesligada: nota, podeTravar: false,
  });
  assert.ok(h.includes(nota));
  assert.match(h, /<dt>Sua decisão<\/dt><dd>Aprovar o rascunho v2<\/dd>/);
  assert.doesNotMatch(h, /rodar-confirmar/);
});

/* ------------------------------------------------------- vídeos e histórico */

test('Vídeos: janela da prévia diz o arquivo, o tempo do motor e escapa o pedido', () => {
  const a = janelaPrevia({ id: 'S47-01', versao: 2, decisao: 'aprovar' });
  assert.match(a, /Aprovar a prévia v2\?/);
  assert.match(a, /“S47-01 aprovado\.md” em 4-Revisao\. O motor pega o arquivo em 1 a 6 min/);
  assert.match(a, /depois disso, uma mudança vira ajuste do vídeo final/);
  assert.match(a, /data-acao="previa-gravar" data-id="S47-01" data-valor="aprovar">Aprovar a v2/);
  const j = janelaPrevia({ id: 'T01-01', versao: 1, decisao: 'ajustar', teste: true, ajustes: [{ versao: 'ig', tempo: '0:12', pedido: MAL }] });
  assert.match(j, /“T01-01 ajustes v1\.md”/);
  assert.match(j, /faz a v2/);
  assert.match(j, /<span class="selo neutro">Teste<\/span>/);
  assert.ok(!j.includes('<img'));
  const ja = janelaPrevia({ id: 'S47-01', versao: 2, decisao: 'aprovar', erro: 'já decidido (arquivo criado às 10h12).' });
  assert.match(ja, /já decidido \(arquivo criado às 10h12\)\./);
  assert.doesNotMatch(ja, /previa-gravar/);
});

test('Histórico: Drive + linhas de Execuções do id, em ordem; só do id', () => {
  const lista = execucoes(
    { bot: 'motor', rotina: 'motor-editar', origem: 'vigia', id_alvo: 'S47-01', inicio: '2026-11-18 08:00', fim: '2026-11-18 08:22', status: 'ok' },
    { bot: 'motor', rotina: 'motor-editar', origem: 'vigia', id_alvo: 'S47-02', inicio: '2026-11-18 08:30', status: 'erro', erro: 'outro id' },
  );
  const h = historicoComExecucoes([
    { quando: '2026-11-18T10:00:00.000Z', texto: 'Gravação enviada (S47-01.mp4)' }, // 7h em São Paulo
    { quando: '2026-11-18T12:00:00.000Z', texto: 'Prévia v1 pronta' }, // 9h
  ], lista, 'S47-01', AGORA);
  assert.deepEqual(h, [
    ['hoje, 7h', 'Gravação enviada (S47-01.mp4)'],
    ['hoje, 8h22', 'Editar a prévia pelo vigia: ok'],
    ['hoje, 9h', 'Prévia v1 pronta'],
  ]);
  assert.deepEqual(historicoComExecucoes([], lista, '', AGORA), []);
});

test('Resultados: a faixa da retrospectiva fica dentro do mesmo painel do "Em breve"', () => {
  const h = htmlResultados({ exec: { fase: 'pronto', execucoes: [], abaAusente: true }, agora: AGORA });
  assert.match(h, /<div class="painel" style="max-width:58.75rem">\s*<div class="faixa"/);
  assert.match(h, /data-acao="rodar-abrir" data-valor="diretor-retrospectiva">Fazer retrospectiva agora/);
  assert.match(h, /Em breve, aqui/);
  assert.match(h, /ainda sem registro/);
});
