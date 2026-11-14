// Testes do controle manual (js/controle.js): aba Execuções lida pelo cabeçalho, trava, janela de
// proteção, tempos, ids, lotes, permissões; os auxiliares de planilha e datas de js/parse.js; e a
// ponte desligada em js/integra.js. Datas fixas (quarta 18/11/2026; domingo 15/11; segunda 16/11),
// nada depende do relógio. Ids T e textos fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED } from '../js/config.js';
import {
  lerDataHora, dataHoraPlanilha, horaCurta, momentoNoFuso, alinharAoA1, linhaNaOrdem, lerTabela, chaveDeCabecalho, letraColuna,
} from '../js/parse.js';
import {
  lerExecucoes, ROTINAS, ROTINAS_DISPARAVEIS, grupoDeTrava, avaliarTrava, textoTrava, avaliarProtecao, textoProtecao,
  avaliarDisparo, estatisticasTempo, janelaConfirmacao, proximaAgendada, textoProximaAgendada, novaChaveIdem,
  novoIdExecucao, idLote, podeDecidir, podeDisparar, campoTeste, novaExecucao, linhaExecucao, COLUNAS_EXECUCOES,
} from '../js/controle.js';

const ROBERTTA = ALLOWED[0];
const GABRIEL = ALLOWED[1];
const sp = (s) => lerDataHora(s); // 'AAAA-MM-DD HH:MM' no horário de São Paulo

const CAB = ['id_execucao', 'chave_idem', 'bot', 'rotina', 'origem', 'quem', 'id_alvo', 'id_lote', 'etapa_evento', 'inicio', 'fim', 'status', 'resumo', 'erro', 'link', 'teste'];

/** Linhas de Execuções a partir de objetos parciais (cabeçalho canônico). */
function aba(...registros) {
  return [CAB, ...registros.map((r) => CAB.map((c) => r[c] ?? ''))];
}
const execs = (...registros) => lerExecucoes(aba(...registros)).execucoes;

/* --------------------------------------------------------- parse: datas */

test('lerDataHora: sem fuso vale São Paulo; ISO com Z; dd/mm/aaaa; serial; vazio', () => {
  assert.equal(sp('2026-11-18 06:05').toISOString(), '2026-11-18T09:05:00.000Z');
  assert.equal(sp('2026-11-18T06:05:30').toISOString(), '2026-11-18T09:05:30.000Z');
  assert.equal(lerDataHora('18/11/2026 06:05').toISOString(), '2026-11-18T09:05:00.000Z');
  assert.equal(lerDataHora('2026-11-18T09:05:00.000Z').toISOString(), '2026-11-18T09:05:00.000Z');
  assert.equal(lerDataHora('2026-11-18').toISOString(), '2026-11-18T03:00:00.000Z');
  // 46344 = 18/11/2026; 0,25 = 6h
  assert.equal(lerDataHora(46344.25).toISOString(), '2026-11-18T09:00:00.000Z');
  assert.equal(lerDataHora(''), null);
  assert.equal(lerDataHora('ontem'), null);
  assert.equal(lerDataHora('2026-13-01 10:00'), null);
});

test('dataHoraPlanilha, horaCurta e momentoNoFuso no fuso de São Paulo', () => {
  const d = new Date('2026-11-18T13:12:33Z');
  assert.equal(dataHoraPlanilha(d), '2026-11-18 10:12');
  assert.equal(horaCurta(d), '10h12');
  assert.equal(horaCurta(sp('2026-11-18 07:03')), '7h03');
  assert.equal(horaCurta(sp('2026-11-18 09:00')), '9h');
  const p = momentoNoFuso(new Date('2026-11-16T02:30:00Z')); // domingo 23h30 em São Paulo
  assert.deepEqual([p.dia, p.hora, p.minuto, p.diaSemana], [15, 23, 30, 0]);
});

/* ----------------------------------------------------- parse: planilha */

test('chaveDeCabecalho e lerTabela: acentos, maiúsculas, espaços e sinônimos', () => {
  assert.equal(chaveDeCabecalho('  ID  Execução '), 'id_execucao');
  assert.equal(chaveDeCabecalho('Quem disparou'), 'quem_disparou');
  const t = lerTabela([[], ['Nome', 'Quando', 'Nome'], ['a', '1', 'b'], ['', '', ''], ['c', '2', 'd']],
    { colunas: ['nome', 'inicio'], sinonimos: { quando: 'inicio' } });
  assert.equal(t.encontrado, true);
  assert.equal(t.linhaCabecalho, 1);
  assert.deepEqual(t.indices, { nome: 0, inicio: 1 }); // repetida: vale a primeira
  assert.deepEqual(t.registros, [{ _linha: 3, nome: 'a', inicio: '1' }, { _linha: 5, nome: 'c', inicio: '2' }]);
});

test('linhaNaOrdem: segue o cabeçalho real; desconhecidas e repetidas ficam vazias', () => {
  const cab = ['Motivo', 'Coluna da Robertta', 'decisão', 'Motivo'];
  assert.deepEqual(linhaNaOrdem(cab, { decisao: 'aprovada', motivo: 'x', sobra: 'y' }, ['decisao', 'motivo']), ['x', '', 'aprovada', '']);
});

test('alinharAoA1: usa o range devolvido pelo Sheets; letraColuna', () => {
  assert.deepEqual(alinharAoA1([['a', 'b']], "'Seleção'!B3:C3"), [[], [], ['', 'a', 'b']]);
  assert.deepEqual(alinharAoA1([['a']], "'Aba!x'!A1:A1"), [['a']]);
  assert.deepEqual(alinharAoA1(undefined, ''), []);
  assert.equal(letraColuna(0), 'A');
  assert.equal(letraColuna(25), 'Z');
  assert.equal(letraColuna(26), 'AA');
});

/* ------------------------------------------------------------ Execuções */

test('lerExecucoes: cabeçalho tolerante com os sinônimos dos bots e colunas a mais', () => {
  const linhas = [
    ['ID Execução', 'Bot', 'Rotina', 'Gatilho', 'Quem disparou', 'id', 'Evento', 'Quando', 'Fim', 'Resultado', 'Detalhe', 'Teste', 'Anotação'],
    ['EX-20261118-070300-ab12', 'Radar', 'Radar Diario', 'Agendada', 'cron', '', '', '2026-11-18 07:03', '2026-11-18 07:40', 'OK', '12 candidatos', 'não', 'x'],
    ['EX-20261118-101233-7f3a', 'motor', 'motor-editar', 'vigia', '', 'T01-01', 'previa', '18/11/2026 10:12:33', '', 'Recusado pela trava', '', '', ''],
  ];
  const { encontrado, execucoes } = lerExecucoes(linhas);
  assert.equal(encontrado, true);
  const [a, b] = execucoes;
  assert.equal(a.id_execucao, 'EX-20261118-070300-ab12');
  assert.equal(a.bot, 'radar');
  assert.equal(a.rotina, 'radar-diario');
  assert.equal(a.origem, 'agendada');
  assert.equal(a.quem, 'cron');
  assert.equal(a.status, 'ok');
  assert.equal(a.resumo, '12 candidatos');
  assert.equal(a.inicioData.toISOString(), '2026-11-18T10:03:00.000Z');
  assert.equal(a.fimData.toISOString(), '2026-11-18T10:40:00.000Z');
  assert.equal(a.teste, false);
  assert.equal(a._linha, 2);
  assert.equal(b.id_alvo, 'T01-01');
  assert.equal(b.etapa_evento, 'previa');
  assert.equal(b.status, 'recusado-pela-trava');
  assert.equal(b.teste, true, 'id T é teste mesmo sem a coluna preenchida');
  assert.equal(b.fimData, null);
});

test('lerExecucoes: aba sem cabeçalho reconhecível → lista vazia', () => {
  assert.deepEqual(lerExecucoes([['a', 'b'], ['1', '2']]).execucoes, []);
  assert.deepEqual(lerExecucoes([]).execucoes, []);
});

/* ------------------------------------------------------------- catálogo */

test('catálogo fechado: grupos de trava, agenda, disparáveis; o motor é só leitura', () => {
  assert.deepEqual(ROTINAS_DISPARAVEIS, ['radar-diario', 'radar-selecao', 'radar-enviar', 'roteirista-decisao', 'diretor-retrospectiva']);
  for (const r of ['radar-diario', 'radar-selecao', 'radar-enviar']) assert.equal(grupoDeTrava(r), 'radar');
  assert.equal(grupoDeTrava('roteirista-decisao', 'S47-01'), 'roteirista|S47-01');
  assert.equal(grupoDeTrava('diretor-retrospectiva'), 'diretor|retrospectiva');
  for (const r of ['motor-checar-fontes', 'motor-editar', 'motor-revisar', 'motor-finalizar']) {
    assert.equal(ROTINAS[r].disparavel, false);
    assert.equal(grupoDeTrava(r), 'motor');
  }
  assert.deepEqual(ROTINAS['radar-diario'].agenda, { dias: [0, 1, 2, 3, 4, 5, 6], hora: 7, minuto: 0 });
  assert.deepEqual(ROTINAS['radar-selecao'].agenda, { dias: [0], hora: 9, minuto: 0 });
  assert.deepEqual(ROTINAS['diretor-retrospectiva'].agenda, { dias: [1], hora: 8, minuto: 0 });
  assert.equal(ROTINAS['roteirista-decisao'].agenda, null);
  assert.equal(grupoDeTrava('apagar-tudo'), '');
  for (const r of ROTINAS_DISPARAVEIS) {
    const c = ROTINAS[r].confirmacao;
    assert.ok(c.oQue && c.produz && c.custo && c.semanal, r);
    assert.equal(c.custo, 'Usa a cota do seu plano Grok Bot; custo por rodada não conhecido.');
  }
  assert.ok(ROTINAS['radar-diario'].confirmacao.limites.includes('X: 30 leituras/min e 1000/dia.'));
  assert.ok(ROTINAS['radar-diario'].confirmacao.limites.includes('O navegador do Radar faz uma tarefa por vez.'));
  assert.equal(ROTINAS['radar-selecao'].confirmacao.semanal, 'Não muda a seleção de domingo; o que você decidir agora não volta no domingo.');
});

/* ---------------------------------------------------------------- trava */

const rodandoDesde = (inicio, extra = {}) => ({ rotina: 'radar-diario', bot: 'radar', origem: 'agendada', status: 'rodando', inicio, ...extra });

test('trava: rodando há menos de 2 h bloqueia o grupo inteiro do Radar', () => {
  const e = execs(rodandoDesde('2026-11-18 07:03'));
  const agora = sp('2026-11-18 08:30');
  for (const r of ['radar-diario', 'radar-selecao', 'radar-enviar']) {
    const t = avaliarTrava(e, r, '', agora);
    assert.equal(t.livre, false, r);
    assert.equal(t.motivo, 'rodando');
    assert.equal(t.origem, 'agendada');
    assert.equal(t.desde.toISOString(), '2026-11-18T10:03:00.000Z');
  }
  assert.equal(textoTrava(avaliarTrava(e, 'radar-diario', '', agora)), 'Rodando desde 7h03 (agendada)');
  assert.equal(avaliarTrava(e, 'diretor-retrospectiva', '', agora).livre, true, 'outro grupo não trava');
});

test('trava: 2 h ou mais → parece travada (também sem início registrado); ok/erro não travam', () => {
  const agora = sp('2026-11-18 09:03');
  const t = avaliarTrava(execs(rodandoDesde('2026-11-18 07:03')), 'radar-selecao', '', agora);
  assert.equal(t.livre, false);
  assert.equal(t.motivo, 'parece-travada');
  assert.equal(t.linha.inicio, '2026-11-18 07:03');
  assert.match(textoTrava(t), /^Parece travada/);
  assert.equal(avaliarTrava(execs(rodandoDesde('')), 'radar-diario', '', agora).motivo, 'parece-travada');
  assert.equal(avaliarTrava(execs(rodandoDesde('2026-11-18 08:50', { status: 'pedido' })), 'radar-diario', '', agora).motivo, 'rodando');
  for (const status of ['ok', 'parcial', 'erro', 'travada']) {
    assert.equal(avaliarTrava(execs(rodandoDesde('2026-11-18 08:50', { status })), 'radar-diario', '', agora).livre, true, status);
  }
});

test('trava: Roteirista é uma por pauta', () => {
  const e = execs({ rotina: 'roteirista-decisao', bot: 'roteirista', origem: 'manual-app', status: 'rodando', id_alvo: 'S47-01', inicio: '2026-11-18 10:00' });
  const agora = sp('2026-11-18 10:20');
  assert.equal(avaliarTrava(e, 'roteirista-decisao', 'S47-01', agora).motivo, 'rodando');
  assert.equal(avaliarTrava(e, 'roteirista-decisao', 'S47-02', agora).livre, true);
});

test('agendada nunca é bloqueada (nem pela trava nem pela janela de proteção)', () => {
  const e = execs(rodandoDesde('2026-11-18 06:50', { origem: 'manual-app' }));
  const agora = sp('2026-11-18 07:00');
  assert.equal(avaliarTrava(e, 'radar-diario', '', agora, { origem: 'agendada' }).livre, true);
  assert.equal(avaliarProtecao(e, 'radar-diario', agora, { origem: 'agendada' }).livre, true);
  assert.equal(avaliarTrava(e, 'radar-diario', '', agora).livre, false, 'o manual cede');
});

/* ---------------------------------------------------- janela de proteção */

test('proteção: 6h05 de um dia útil recusa o diário e também a seleção e o enviar (navegador único)', () => {
  const agora = sp('2026-11-18 06:05'); // quarta
  for (const r of ['radar-diario', 'radar-selecao', 'radar-enviar']) {
    const p = avaliarProtecao([], r, agora);
    assert.equal(p.livre, false, r);
    assert.equal(p.motivo, 'protecao');
    assert.equal(p.rotinaAgendada, 'radar-diario');
    assert.equal(p.horario.toISOString(), '2026-11-18T10:00:00.000Z');
    assert.equal(p.ate.toISOString(), '2026-11-18T12:00:00.000Z', 'sem linha agendada: até 2 h depois');
  }
  assert.match(textoProtecao(avaliarProtecao([], 'radar-selecao', agora), agora), /Radar diário, hoje às 7h/);
  assert.equal(avaliarProtecao([], 'radar-diario', sp('2026-11-18 05:59')).livre, true, 'antes de 60 min');
  assert.equal(avaliarProtecao([], 'roteirista-decisao', agora).livre, true, 'sem agenda, sem proteção');
});

test('proteção: 12h livre; sem linha agendada, libera 2 h depois do horário', () => {
  assert.equal(avaliarProtecao([], 'radar-diario', sp('2026-11-18 12:00')).livre, true);
  assert.equal(avaliarProtecao([], 'radar-selecao', sp('2026-11-18 12:00')).livre, true);
  assert.equal(avaliarProtecao([], 'radar-diario', sp('2026-11-18 08:59')).livre, false);
  assert.equal(avaliarProtecao([], 'radar-diario', sp('2026-11-18 09:00')).livre, true);
});

test('proteção: domingo 8h30 recusa (seleção às 9h), mesmo com o diário das 7h já fechado', () => {
  const agora = sp('2026-11-15 08:30');
  const e = execs({ rotina: 'radar-diario', bot: 'radar', origem: 'agendada', status: 'ok', inicio: '2026-11-15 07:02', fim: '2026-11-15 07:41' });
  const p = avaliarProtecao(e, 'radar-selecao', agora);
  assert.equal(p.livre, false);
  assert.equal(p.rotinaAgendada, 'radar-selecao');
  assert.equal(avaliarProtecao(e, 'radar-diario', agora).livre, false, 'a do grupo radar também');
  assert.equal(avaliarProtecao([], 'radar-selecao', sp('2026-11-18 08:30')).livre, false, 'quarta 8h30: o diário sem linha');
});

test('proteção: depois que a linha agendada daquele horário fecha, libera', () => {
  const agora = sp('2026-11-18 07:45');
  const aberta = { rotina: 'radar-diario', bot: 'radar', origem: 'agendada', status: 'rodando', inicio: '2026-11-18 07:02' };
  const p = avaliarProtecao(execs(aberta), 'radar-selecao', agora);
  assert.equal(p.livre, false);
  assert.equal(p.ate, null, 'espera a linha fechar');
  for (const status of ['ok', 'parcial', 'erro']) {
    assert.equal(avaliarProtecao(execs({ ...aberta, status, fim: '2026-11-18 07:40' }), 'radar-selecao', agora).livre, true, status);
  }
  // A linha agendada de ontem não conta para hoje.
  const ontem = { ...aberta, status: 'ok', inicio: '2026-11-17 07:02', fim: '2026-11-17 07:40' };
  assert.equal(avaliarProtecao(execs(ontem), 'radar-diario', agora).livre, false);
  // Linha manual não fecha a agendada.
  assert.equal(avaliarProtecao(execs({ ...aberta, origem: 'manual-app', status: 'ok' }), 'radar-diario', agora).livre, false);
});

test('proteção da retrospectiva: segunda 7h30 recusa; terça livre', () => {
  assert.equal(avaliarProtecao([], 'diretor-retrospectiva', sp('2026-11-16 07:30')).livre, false);
  assert.equal(avaliarProtecao([], 'diretor-retrospectiva', sp('2026-11-17 07:30')).livre, true);
  assert.equal(avaliarProtecao([], 'radar-diario', sp('2026-11-16 08:30')).livre, false, 'o diário às 7h ainda sem linha');
});

test('próxima agendada', () => {
  assert.equal(proximaAgendada('radar-diario', sp('2026-11-18 12:00')).toISOString(), '2026-11-19T10:00:00.000Z');
  assert.equal(textoProximaAgendada('radar-diario', sp('2026-11-18 12:00')), 'A próxima rodada agendada é amanhã às 7h.');
  assert.equal(textoProximaAgendada('radar-diario', sp('2026-11-18 06:00')), 'A próxima rodada agendada é hoje às 7h.');
  assert.equal(textoProximaAgendada('radar-selecao', sp('2026-11-18 12:00')), 'A próxima rodada agendada é no domingo às 9h.');
  assert.equal(textoProximaAgendada('diretor-retrospectiva', sp('2026-11-18 12:00')), 'A próxima rodada agendada é na segunda às 8h.');
  assert.equal(proximaAgendada('roteirista-decisao', sp('2026-11-18 12:00')), null);
});

/* -------------------------------------------------------------- disparo */

test('avaliarDisparo: motor não, Gabriel dispara mas não decide roteiro, conta de fora não', () => {
  const agora = sp('2026-11-18 12:00');
  assert.equal(avaliarDisparo({ rotina: 'motor-editar', idAlvo: 'T01', email: ROBERTTA, agora }).motivo, 'nao-disparavel');
  assert.equal(avaliarDisparo({ rotina: 'radar-diario', email: GABRIEL, agora }).pode, true);
  assert.equal(avaliarDisparo({ rotina: 'radar-diario', email: 'alguem@example.com', agora }).motivo, 'sem-permissao');
  assert.equal(avaliarDisparo({ rotina: 'roteirista-decisao', idAlvo: 'S47-01', email: GABRIEL, agora }).motivo, 'sem-permissao');
  assert.equal(avaliarDisparo({ rotina: 'roteirista-decisao', idAlvo: '', email: ROBERTTA, agora }).motivo, 'falta-id');
  assert.equal(avaliarDisparo({ rotina: 'roteirista-decisao', idAlvo: 'S47-01', email: ROBERTTA, agora }).pode, true);
  assert.equal(avaliarDisparo({ rotina: 'radar-diario', email: ROBERTTA, agora: sp('2026-11-18 06:30') }).motivo, 'protecao');
  assert.equal(avaliarDisparo({ rotina: 'x', email: ROBERTTA, agora }).motivo, 'rotina-desconhecida');
});

/* ---------------------------------------------------------------- tempo */

const okDe = (inicio, minutos, extra = {}) => {
  const i = sp(inicio);
  const f = new Date(i.getTime() + minutos * 60000);
  return { rotina: 'radar-diario', bot: 'radar', origem: 'agendada', status: 'ok', inicio, fim: dataHoraPlanilha(f), ...extra };
};

test('tempo: com menos de 3 rodadas ok, exatamente "ainda sem medição"', () => {
  const e = execs(okDe('2026-11-16 07:00', 30), okDe('2026-11-17 07:00', 40),
    { rotina: 'radar-diario', status: 'erro', inicio: '2026-11-18 07:00', fim: '2026-11-18 07:05', origem: 'agendada' });
  const t = estatisticasTempo(e, 'radar-diario');
  assert.equal(t.medido, false);
  assert.equal(t.texto, 'ainda sem medição');
  assert.equal(t.ultima.status, 'erro');
  assert.equal(t.ultima.origem, 'agendada');
  assert.equal(t.ultima.quandoTexto, '18/11 07:00');
  assert.equal(estatisticasTempo([], 'radar-selecao').texto, 'ainda sem medição');
  assert.equal(estatisticasTempo([], 'radar-selecao').ultima, null);
});

test('tempo: com 3 ou mais, média das últimas N (até 10); testes e rodadas sem fim ficam de fora', () => {
  const e3 = execs(okDe('2026-11-16 07:00', 10), okDe('2026-11-17 07:00', 20), okDe('2026-11-18 07:00', 30),
    okDe('2026-11-18 10:00', 500, { id_alvo: 'T01', teste: 'sim' }), { rotina: 'radar-diario', status: 'ok', inicio: '2026-11-18 11:00' });
  assert.equal(estatisticasTempo(e3, 'radar-diario').texto, 'média de 20 min nas últimas 3 rodadas');
  // 12 rodadas: as 10 mais novas têm 10 min; as 2 mais velhas, 100 min.
  const doze = [];
  for (let d = 1; d <= 12; d++) doze.push(okDe(`2026-11-${String(d).padStart(2, '0')} 07:00`, d <= 2 ? 100 : 10));
  const t = estatisticasTempo(execs(...doze), 'radar-diario');
  assert.equal(t.n, 10);
  assert.equal(t.texto, 'média de 10 min nas últimas 10 rodadas');
});

test('janela de confirmação: itens na ordem do PLANO, com tempo, custo, limites, conflito e semanal', () => {
  const agora = sp('2026-11-18 12:00');
  const j = janelaConfirmacao('radar-selecao', { execucoes: [], email: ROBERTTA, agora });
  assert.deepEqual(j.itens.map((i) => i.chave), ['oque', 'produz', 'tempo', 'custo', 'limites', 'conflitos', 'semanal']);
  assert.equal(j.itens[2].texto, 'ainda sem medição');
  assert.deepEqual(j.itens[5].lista, ['A próxima rodada agendada é no domingo às 9h.']);
  assert.equal(j.disparo.pode, true);
  const travada = janelaConfirmacao('radar-selecao', { execucoes: execs(rodandoDesde('2026-11-18 11:30', { origem: 'manual-app' })), email: ROBERTTA, agora });
  assert.equal(travada.disparo.pode, false);
  assert.equal(travada.itens.find((i) => i.chave === 'conflitos').lista[0], 'Rodando desde 11h30 (pelo app)');
  assert.equal(janelaConfirmacao('x'), null);
});

/* ------------------------------------------------------------------ ids */

test('novaChaveIdem e novoIdExecucao (hora de São Paulo)', () => {
  assert.match(novaChaveIdem(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(novaChaveIdem(), novaChaveIdem());
  assert.equal(novoIdExecucao(new Date('2026-11-18T13:12:33Z'), '7f3a'), 'EX-20261118-101233-7f3a');
  assert.match(novoIdExecucao(new Date('2026-11-18T13:12:33Z')), /^EX-20261118-101233-[0-9a-f]{4}$/);
});

test('idLote: semanal, manual-1, manual-2 (olhando Execuções e Seleção), sem reaproveitar número', () => {
  assert.equal(idLote({ semana: 47, tipo: 'semanal' }), 'S47-semanal');
  assert.equal(idLote({ semana: 'S47', existentes: [] }), 'S47-manual-1');
  assert.equal(idLote({ semana: 47, existentes: ['S47-semanal', 'S47-manual-1'] }), 'S47-manual-2');
  assert.equal(idLote({ semana: 'S47', existentes: [{ id_lote: 'S47-manual-1' }, { id_lote: ' S47-manual-3 ' }, 'S46-manual-9'] }), 'S47-manual-4');
  assert.equal(idLote({ semana: 5, existentes: ['S05-manual-1'] }), 'S05-manual-2');
  assert.throws(() => idLote({ semana: 'x' }));
});

/* ------------------------------------------------------------ permissões */

test('permissões: só ALLOWED[0] decide; as duas contas disparam; minúsculas', () => {
  assert.equal(podeDecidir(ROBERTTA), true);
  assert.equal(podeDecidir(ROBERTTA.toUpperCase()), true);
  assert.equal(podeDecidir(GABRIEL), false);
  assert.equal(podeDecidir(''), false);
  assert.equal(podeDisparar(GABRIEL.toUpperCase()), true);
  assert.equal(podeDisparar(ROBERTTA), true);
  assert.equal(podeDisparar('alguem@example.com'), false);
  assert.equal(podeDisparar(''), false);
});

/* --------------------------------------------------- registro e testes T */

test('ids T: teste = sim em Execuções; registro na ordem do cabeçalho real', () => {
  assert.equal(campoTeste('T01-01'), 'sim');
  assert.equal(campoTeste('S47-01'), 'não');
  const agora = new Date('2026-11-18T13:12:33Z');
  const r = novaExecucao({ rotina: 'roteirista-decisao', idAlvo: 'T01', email: ROBERTTA.toUpperCase(), agora, chaveIdem: 'c-1', idExecucao: 'EX-1' });
  assert.deepEqual(Object.keys(r), COLUNAS_EXECUCOES);
  assert.equal(r.teste, 'sim');
  assert.equal(r.bot, 'roteirista');
  assert.equal(r.origem, 'manual-app');
  assert.equal(r.quem, ROBERTTA);
  assert.equal(r.status, 'pedido');
  assert.equal(r.inicio, '2026-11-18 10:12:33');
  const cab = ['Quando', 'Rotina', 'Coluna nova', 'Teste', 'quem_disparou'];
  assert.deepEqual(linhaExecucao(cab, r), ['2026-11-18 10:12:33', 'roteirista-decisao', '', 'sim', ROBERTTA]);
});

/* ------------------------------------------------------ ponte desligada */

test('ponte desligada: disparar e decidirRoteiro lançam codigo ponte-desligada', async () => {
  const { Integra } = await import('../js/integra.js');
  for (const chamada of [
    () => Integra.ponte.disparar({ rotina: 'radar-diario', chave_idem: 'c-1' }),
    () => Integra.ponte.decidirRoteiro({ id: 'T01', versao: 1, decisao: 'aprovar', chave_idem: 'c-2' }),
  ]) {
    await assert.rejects(chamada, (e) => e.codigo === 'ponte-desligada' && e.message === 'O disparo pelo app ainda não está ligado.');
  }
});
