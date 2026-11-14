// Testes das pautas (js/selecao.js): abas Seleção e Decisões lidas pelo cabeçalho, estado de cada
// pauta, motivos e o planejamento das decisões (ids T fora, idempotência, primeira decisão vale,
// mudança de ideia, permissão, linha na ordem do cabeçalho real). Datas fixas; textos fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED } from '../js/config.js';
import { lerDataHora } from '../js/parse.js';
import {
  lerSelecao, lerDecisoes, colunasDecisoesProntas, colunasDecisoesFaltando, estadoDasPautas, paraDecidir, decididas,
  planejarDecisoes, textoMotivo, motivoDaLista, normalizarStatusPauta, MOTIVOS_RECUSA, MENSAGEM_COLUNAS_DECISOES, COLUNAS_SELECAO,
} from '../js/selecao.js';

const ROBERTTA = ALLOWED[0];
const GABRIEL = ALLOWED[1];
const AGORA = lerDataHora('2026-11-18 10:30');

// Cabeçalho da Seleção como uma pessoa escreveria (acentos, maiúsculas, espaços) + id_lote no fim.
const CAB_SELECAO = [
  'ID Pauta', 'id_candidato', 'Semana', 'Data Seleção', 'Título', 'Tema', 'Rede', 'Público / Situação',
  'Pergunta central', 'Entrega', 'Por que agora', 'Sinal social', 'Fundamentação', 'Contribuição junguiana',
  'Estado verificação', 'Restrição principal', 'Nota v2', 'Prazo', 'Ganchos opcionais', 'Status', 'id_lote',
];

function linhaSelecao(o) {
  const v = { semana: 'S47', titulo: `Pauta ${o.id_pauta}`, tema: 'tema fictício', rede: 'ambas', status: 'proposta', id_lote: 'S47-manual-1', ...o };
  return [v.id_pauta, v.id_candidato || `C-${v.id_pauta}`, v.semana, '2026-11-17', v.titulo, v.tema, v.rede, '', '', '', '', '', '', '', '', '', '82', '', '', v.status, v.id_lote];
}

// As linhas fora de ordem de propósito: a atualização acha a linha pelo id_pauta, nunca pela posição.
const SELECAO = [
  CAB_SELECAO,
  linhaSelecao({ id_pauta: 'S47-03', status: 'Enviada ao Roteirista' }),
  linhaSelecao({ id_pauta: 'S47-01', rede: 'ig' }),
  linhaSelecao({ id_pauta: 'T01', status: 'proposta' }),
  linhaSelecao({ id_pauta: 'S47-02', rede: 'tt' }),
  linhaSelecao({ id_pauta: 'S47-04', status: 'aprovada' }),
];

const CAB_DECISOES = ['Semana', 'Pauta', 'Decisão', 'Motivo', 'id_pauta', 'rede', 'id_candidato', 'id_lote', 'data', 'quem', 'origem'];
const dec = (o) => {
  const v = { semana: 'S47', pauta: `Pauta ${o.id_pauta}`, motivo: '', rede: '', id_candidato: '', id_lote: '', data: '2026-11-18 09:00', quem: '', origem: 'chat', ...o };
  return [v.semana, v.pauta, v.decisao, v.motivo, v.id_pauta, v.rede, v.id_candidato, v.id_lote, v.data, v.quem, v.origem];
};
const LINHA_ANTIGA = ['S45', 'Uma pauta antiga', 'aprovada', ''];

const sel = () => lerSelecao(SELECAO);
const decisoes = (...linhas) => lerDecisoes([CAB_DECISOES, LINHA_ANTIGA, ...linhas]);

/* ------------------------------------------------------------- leitura */

test('lerSelecao: cabeçalho tolerante, status normalizado, id_lote quando existe', () => {
  const s = sel();
  assert.equal(s.encontrado, true);
  assert.equal(s.temIdLote, true);
  assert.equal(s.pautas.length, 5);
  const p = s.pautas.find((x) => x.id_pauta === 'S47-01');
  assert.equal(p.titulo, 'Pauta S47-01');
  assert.equal(p.publico_situacao, '');
  assert.equal(p.nota_v2, '82');
  assert.equal(p.rede, 'ig');
  assert.equal(p.id_lote, 'S47-manual-1');
  assert.equal(p._linha, 3);
  assert.equal(s.pautas.find((x) => x.id_pauta === 'S47-03').status, 'enviada ao Roteirista');
  assert.equal(normalizarStatusPauta('  APROVADA '), 'aprovada');
  assert.equal(normalizarStatusPauta('Recusada'), 'recusada');
});

test('lerSelecao: sem a coluna id_lote, fica vazio (nada inventado)', () => {
  const s = lerSelecao([COLUNAS_SELECAO, ['S47-01', 'C1', 'S47', '', 'Título', '', 'ig', ...Array(12).fill(''), 'proposta']]);
  assert.equal(s.temIdLote, false);
  assert.equal(s.pautas[0].id_lote, '');
  assert.equal(s.pautas[0].status, 'proposta');
});

test('lerDecisoes e colunasDecisoesProntas', () => {
  const d = decisoes(dec({ id_pauta: 'S47-02', decisao: 'Aprovado' }));
  assert.equal(d.decisoes.length, 2);
  assert.equal(d.decisoes[0].id_pauta, '', 'a linha antiga (só 4 colunas) fica sem id_pauta');
  assert.equal(d.decisoes[1].decisao, 'aprovada');
  assert.equal(colunasDecisoesProntas(CAB_DECISOES), true);
  assert.equal(colunasDecisoesProntas(['semana', 'pauta', 'decisão', 'motivo']), false);
  assert.deepEqual(colunasDecisoesFaltando(['Semana', 'Pauta', 'Decisão', 'Motivo', 'id_pauta']), ['rede', 'id_candidato', 'id_lote', 'data', 'quem', 'origem']);
});

test('estado: a última linha de Decisões vale; senão o status da Seleção; para decidir = proposta sem decisão', () => {
  const s = sel();
  const d = decisoes(dec({ id_pauta: 'S47-02', decisao: 'aprovada' }), dec({ id_pauta: 'S47-02', decisao: 'recusada', motivo: 'timing' }));
  const e = estadoDasPautas(s, d);
  assert.equal(e.get('S47-02').status, 'recusada');
  assert.equal(e.get('S47-02').fonte, 'decisoes');
  assert.equal(e.get('S47-01').status, 'proposta');
  assert.equal(e.get('S47-04').status, 'aprovada');
  assert.equal(e.get('S47-03').status, 'enviada ao Roteirista');
  assert.deepEqual(paraDecidir(s, d).map((p) => p.id_pauta), ['S47-01', 'T01']);
  assert.deepEqual(decididas(s, d).map((p) => p.id_pauta).sort(), ['S47-02', 'S47-03', 'S47-04']);
});

/* ------------------------------------------------------------- motivos */

test('motivos: lista fechada, sem acento também; texto em uma linha, no máximo 500', () => {
  assert.deepEqual(MOTIVOS_RECUSA, ['repetição', 'recorte', 'timing', 'desalinhamento', 'fundamentação']);
  assert.equal(motivoDaLista('Repeticao'), 'repetição');
  assert.equal(motivoDaLista('outro'), '');
  assert.equal(textoMotivo('repetição'), 'repetição');
  assert.equal(textoMotivo('repetição', '  já falamos\ndisso   semana passada '), 'repetição: já falamos disso semana passada');
  assert.equal(textoMotivo('', 'só uma observação'), 'só uma observação');
  assert.equal(textoMotivo('timing', 'x'.repeat(800)).length, 500);
});

/* ---------------------------------------------------------- planejamento */

const planejar = (o) => planejarDecisoes({ selecao: sel(), decisoesVistas: decisoes(), decisoesAgora: decisoes(), email: ROBERTTA, agora: AGORA, ...o });

test('planejar: aprovação nova vira linha completa em Decisões e status na Seleção pela linha do id', () => {
  const p = planejar({ pedidos: [{ id_pauta: 'S47-02', decisao: 'aprovada' }] });
  assert.equal(p.ok, true);
  assert.deepEqual(p.registros, [{
    semana: 'S47', pauta: 'Pauta S47-02', decisao: 'aprovada', motivo: '', id_pauta: 'S47-02', rede: 'tt',
    id_candidato: 'C-S47-02', id_lote: 'S47-manual-1', data: '2026-11-18 10:30', quem: ROBERTTA, origem: 'app',
  }]);
  assert.deepEqual(p.linhas, [['S47', 'Pauta S47-02', 'aprovada', '', 'S47-02', 'tt', 'C-S47-02', 'S47-manual-1', '2026-11-18 10:30', ROBERTTA, 'app']]);
  assert.deepEqual(p.atualizacoes, [{ id_pauta: 'S47-02', linha: 5, coluna: 19, valor: 'aprovada' }]);
  assert.equal(p.resultados[0].acao, 'gravar');
});

test('planejar: a linha segue a ORDEM DO CABEÇALHO REAL, com colunas extras e desconhecidas vazias', () => {
  const cab = ['Semana', 'Pauta', 'Decisão', 'Motivo', 'Anotação da Robertta', 'Origem', 'id_pauta', 'Rede', 'Data', 'Quem', 'id_candidato', 'id_lote', 'Outra'];
  const agoraDec = lerDecisoes([cab]);
  const p = planejar({ decisoesAgora: agoraDec, pedidos: [{ id_pauta: 'S47-01', decisao: 'recusar', motivo: 'recorte', observacao: 'muito amplo' }] });
  assert.deepEqual(p.linhas[0], ['S47', 'Pauta S47-01', 'recusada', 'recorte: muito amplo', '', 'app', 'S47-01', 'ig', '2026-11-18 10:30', ROBERTTA, 'C-S47-01', 'S47-manual-1', '']);
});

test('planejar: colunas novas ausentes → não grava nada, com a mensagem honesta', () => {
  const p = planejar({ decisoesAgora: lerDecisoes([['Semana', 'Pauta', 'Decisão', 'Motivo'], LINHA_ANTIGA]), pedidos: [{ id_pauta: 'S47-01', decisao: 'aprovada' }] });
  assert.equal(p.ok, false);
  assert.equal(p.erro, 'colunas-ausentes');
  assert.equal(p.mensagem, MENSAGEM_COLUNAS_DECISOES);
  assert.equal(p.mensagem, 'A aba Decisões ainda não tem as colunas novas (id_pauta, rede, origem…). Peça ao Programador para criá-las.');
  assert.deepEqual(p.linhas, []);
  assert.deepEqual(p.atualizacoes, []);
});

test('planejar: id T nunca vai para Decisões', () => {
  const p = planejar({ pedidos: [{ id_pauta: 'T01', decisao: 'aprovada' }, { id_pauta: 'T01-02', decisao: 'recusada', motivo: 'timing' }] });
  assert.deepEqual(p.linhas, []);
  assert.deepEqual(p.atualizacoes, []);
  assert.deepEqual(p.resultados.map((r) => [r.acao, r.mensagem]), [['recusado', 'teste não vai para Decisões'], ['recusado', 'teste não vai para Decisões']]);
});

test('planejar: idempotência — a decisão atual já é a pedida → nada a gravar', () => {
  const d = decisoes(dec({ id_pauta: 'S47-02', decisao: 'aprovada', origem: 'app' }));
  const p = planejar({ decisoesVistas: d, decisoesAgora: d, pedidos: [{ id_pauta: 'S47-02', decisao: 'aprovada' }] });
  assert.deepEqual(p.linhas, []);
  assert.equal(p.resultados[0].acao, 'nada');
  assert.equal(p.resultados[0].mensagem, 'já estava assim');
  // Seleção já aprovada sem linha ligada ao id (fluxo antigo): também já estava assim.
  assert.equal(planejar({ pedidos: [{ id_pauta: 'S47-04', decisao: 'aprovada' }] }).resultados[0].motivo, 'ja-estava');
});

test('planejar: vale a primeira decisão — o chat gravou depois que a tela leu', () => {
  const vistas = decisoes();
  const agoraDec = decisoes(dec({ id_pauta: 'S47-01', decisao: 'recusada', motivo: 'timing', data: '2026-11-18 10:12', origem: 'chat' }));
  const p = planejar({ decisoesVistas: vistas, decisoesAgora: agoraDec, pedidos: [{ id_pauta: 'S47-01', decisao: 'aprovada' }] });
  assert.deepEqual(p.linhas, []);
  assert.equal(p.resultados[0].acao, 'recusado');
  assert.equal(p.resultados[0].mensagem, 'já decidido pelo chat às 10h12');
  // Se o chat decidiu a mesma coisa, só "já estava assim".
  assert.equal(planejar({ decisoesVistas: vistas, decisoesAgora: agoraDec, pedidos: [{ id_pauta: 'S47-01', decisao: 'recusada', motivo: 'timing' }] }).resultados[0].mensagem, 'já estava assim');
  // Decidido em outro dia: diz a data.
  const ontem = decisoes(dec({ id_pauta: 'S47-01', decisao: 'recusada', data: '2026-11-17 18:40', origem: 'app' }));
  assert.equal(planejar({ decisoesAgora: ontem, pedidos: [{ id_pauta: 'S47-01', decisao: 'aprovada' }] }).resultados[0].mensagem, 'já decidido pelo app em 17/11 às 18h40');
});

test('planejar: mudança de ideia consciente vira linha nova; bloqueada se já enviada ao Roteirista', () => {
  const d = decisoes(dec({ id_pauta: 'S47-02', decisao: 'aprovada', origem: 'app' }), dec({ id_pauta: 'S47-03', decisao: 'aprovada', origem: 'chat' }));
  const p = planejar({
    decisoesVistas: d, decisoesAgora: d,
    pedidos: [{ id_pauta: 'S47-02', decisao: 'recusada', motivo: 'Desalinhamento' }, { id_pauta: 'S47-03', decisao: 'recusada', motivo: 'timing' }],
  });
  assert.equal(p.linhas.length, 1);
  assert.equal(p.registros[0].decisao, 'recusada');
  assert.equal(p.registros[0].motivo, 'desalinhamento');
  assert.equal(p.resultados[0].acao, 'gravar');
  assert.equal(p.resultados[0].mudanca, true);
  assert.equal(p.resultados[1].acao, 'recusado');
  assert.equal(p.resultados[1].motivo, 'ja-enviada');
  assert.deepEqual(p.atualizacoes.map((a) => a.id_pauta), ['S47-02']);
});

test('planejar: a conta do Gabriel não decide', () => {
  const p = planejar({ email: GABRIEL, pedidos: [{ id_pauta: 'S47-01', decisao: 'aprovada' }] });
  assert.equal(p.ok, false);
  assert.equal(p.erro, 'sem-permissao');
  assert.deepEqual(p.linhas, []);
  assert.equal(p.resultados[0].acao, 'erro');
  assert.equal(planejar({ email: '', pedidos: [{ id_pauta: 'S47-01', decisao: 'aprovada' }] }).erro, 'sem-permissao');
});

test('planejar: recusa sem motivo é erro; motivo fora da lista também; decisão inválida; pauta que não existe', () => {
  const p = planejar({
    pedidos: [
      { id_pauta: 'S47-01', decisao: 'recusada', motivo: '' },
      { id_pauta: 'S47-02', decisao: 'recusada', motivo: 'não gostei' },
      { id_pauta: 'S47-04', decisao: 'talvez' },
      { id_pauta: 'S48-09', decisao: 'aprovada' },
    ],
  });
  assert.deepEqual(p.linhas, []);
  assert.deepEqual(p.resultados.map((r) => r.motivo), ['falta-motivo', 'motivo-invalido', 'decisao-invalida', 'pauta-nao-encontrada']);
  assert.equal(p.resultados[0].mensagem, 'Escolha o motivo da recusa.');
});

test('planejar: pedido repetido no mesmo lote só conta uma vez', () => {
  const p = planejar({ pedidos: [{ id_pauta: 'S47-01', decisao: 'aprovada' }, { id_pauta: 'S47-01', decisao: 'recusada', motivo: 'timing' }] });
  assert.equal(p.linhas.length, 1);
  assert.equal(p.resultados[1].motivo, 'repetido');
});
