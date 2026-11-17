// T8 (roteiros): "por quê, em uma linha" (campo `motivo` do motor) na decisão de roteiro e na de pauta, o `cta` por rede
// na tela do rascunho, o selo do `formato` sem o código E<n> e a proposta do motor (aprovar continua aprovar). Sem DOM
// e sem rede; os YAML são lidos de volta como o motor lê (fila_roteiro.CAMPOS_DECISAO / decisões da semana).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED } from '../js/config.js';
import { lerDataHora } from '../js/parse.js';
import { planejarDecisaoRoteiro } from '../js/controle.js';
import { pedidosDaTela } from '../js/telas/pautas.js';
import { textoDecisaoRoteiro, lerDecisaoRoteiro, textoDecisoesSemana } from '../js/pedidos-motor.js';
import { formatoLegivel, fechosDoCta } from '../js/roteiro.js';
import { camposDoLido } from '../js/dados.js';
import { blocoFecho, decisaoDoRascunho } from '../js/telas/roteiros.js';
import { lerPerguntasRegra, decisaoComRegras, ehProposta, chaveRespostas } from '../js/regras.js';
import { blocoRegras } from '../js/componentes/regras.js';
import { estado } from '../js/estado.js';

const ROBERTTA = ALLOWED[0];
const AGORA = lerDataHora('2026-11-18 10:30');

test('roteiro: por quê obrigatório em mudar e recusar, opcional em aprovar; vai em `motivo`', () => {
  const base = { id: 'S47-04', versao: 2 };
  assert.deepEqual(Object.keys(planejarDecisaoRoteiro({ ...base, decisao: 'mudar', pedido: 'abrir com a pergunta' }).erros), ['porque']);
  const m = planejarDecisaoRoteiro({ ...base, decisao: 'mudar', pedido: 'abrir com a pergunta', observacao: ' o dado\nabre frio ' });
  assert.equal(m.payload.motivo, 'o dado abre frio');
  assert.deepEqual(Object.keys(planejarDecisaoRoteiro({ ...base, decisao: 'recusar', motivo: 'tom' }).erros), ['porque']);
  assert.equal(planejarDecisaoRoteiro({ ...base, decisao: 'recusar', motivo: 'tom', observacao: 'ficou frio' }).payload.motivo, 'tom: ficou frio');
  assert.equal(planejarDecisaoRoteiro({ ...base, decisao: 'aprovar' }).ok, true);
  assert.equal(planejarDecisaoRoteiro({ ...base, decisao: 'aprovar' }).payload.motivo, '');
  assert.equal(planejarDecisaoRoteiro({ ...base, decisao: 'aprovar', observacao: 'ficou na minha voz' }).payload.motivo, 'ficou na minha voz');
});

test('roteiro: o campo "Por quê, em uma linha" aparece nas três escolhas (opcional só em aprovar)', () => {
  const r = { id: 'S47-04', etapa: 'rascunho', versaoRoteiro: 1, versoesRoteiro: [1], temFinal: false, lido: true, fontes: [], fontesConferidas: true };
  const tela = (escolha) => decisaoDoRascunho(r, { email: ROBERTTA, escolha, exec: { execucoes: [] }, agora: AGORA });
  assert.match(tela('aprovar'), /id="c-ro-S47-04"/);
  assert.match(tela('aprovar'), /Por quê, em uma linha <span class="opc">\(opcional\)/);
  for (const e of ['mudar', 'recusar']) {
    assert.match(tela(e), /id="c-ro-S47-04"/);
    assert.doesNotMatch(tela(e), /Por quê, em uma linha <span class="opc">/);
  }
  estado.erros = { 'ro-S47-04': 'Diga por quê, em uma linha.' };
  assert.match(decisaoDoRascunho(r, { email: ROBERTTA, escolha: 'recusar', exec: { execucoes: [] }, agora: AGORA, erros: estado.erros }), /id="c-ro-S47-04"/);
  estado.erros = {};
});

test('YAML da decisão de roteiro: `motivo:` como o motor lê (campos de topo, uma linha)', () => {
  for (const [decisao, extra] of [['mudar', { pedido: 'abrir com a pergunta' }], ['recusar', {}], ['aprovar', {}]]) {
    const plano = planejarDecisaoRoteiro({ id: 'S47-04', versao: 2, decisao, motivo: 'clareza', observacao: 'está longo: "demais"', ...extra });
    const t = textoDecisaoRoteiro({ ...plano.payload, quem: ROBERTTA, quando: new Date('2026-11-18T13:30:00Z') });
    const campos = t.split('\n').filter((l) => /^[a-z_]+:/.test(l)).map((l) => l.split(':')[0]);
    assert.deepEqual(campos, ['id', 'versao', 'decisao', 'pedido', 'motivo', 'quem', 'quando']); // lista fechada do motor
    const l = lerDecisaoRoteiro(t);
    assert.equal(l.decisao, decisao);
    assert.equal(l.motivo, plano.payload.motivo);
    assert.ok(!l.motivo.includes('\n'));
  }
});

test('pauta: recusa exige o por quê; aprovação aceita; o `motivo:` do arquivo da semana leva os dois', () => {
  const selecao = { pautas: [{ id_pauta: 'S47-01' }, { id_pauta: 'S47-02' }] };
  const { erros, pedidos } = pedidosDaTela({ 'S47-01': 'aprovada', 'S47-02': 'recusada' }, { 'pm-S47-02': 'timing' }, selecao);
  assert.deepEqual(Object.keys(erros), ['po-S47-02']);
  assert.equal(pedidos[0].observacao, '');
  const ok = pedidosDaTela({ 'S47-01': 'aprovada', 'S47-02': 'recusada' }, { 'po-S47-01': ' é a dúvida que mais chega ', 'pm-S47-02': 'timing', 'po-S47-02': 'já falamos em outubro' }, selecao);
  assert.deepEqual(ok.erros, {});
  const t = textoDecisoesSemana({ semana: 'S47', quem: ROBERTTA, itens: [
    { id_pauta: 'S47-01', decisao: 'aprovada', motivo: ok.pedidos[0].observacao },
    { id_pauta: 'S47-02', decisao: 'recusada', motivo: `${ok.pedidos[1].motivo}: ${ok.pedidos[1].observacao}` },
  ] });
  assert.match(t, /- id: S47-01\n {2}decisao: aprovada\n {2}motivo: "?é a dúvida que mais chega"?\n/);
  assert.match(t, /- id: S47-02\n {2}decisao: recusada\n {2}motivo: "?timing: já falamos em outubro"?\n/);
});

test('rascunho: `cta` por rede e formato sem o código interno', () => {
  assert.deepEqual(fechosDoCta('instagram enviar; tiktok comentar'), [{ rede: 'instagram', texto: 'enviar' }, { rede: 'tiktok', texto: 'comentar' }]);
  assert.deepEqual(fechosDoCta('nenhum'), []);
  assert.deepEqual(fechosDoCta('salvar para depois'), [{ rede: '', texto: 'salvar para depois' }]);
  assert.equal(formatoLegivel('E3 distinção'), 'distinção');
  assert.equal(formatoLegivel('E12 Jung explica'), 'Jung explica');
  assert.equal(formatoLegivel('Jung explica'), 'Jung explica');
  assert.equal(formatoLegivel('E3'), '');
  const r = camposDoLido({ cta: 'instagram enviar; tiktok comentar', sem_cta: false, formato: 'E3 distinção' });
  const h = blocoFecho(r);
  assert.match(h, /Fecho no Instagram<\/dt><dd>enviar</);
  assert.match(h, /Fecho no TikTok<\/dt><dd>comentar</);
  assert.match(blocoFecho(camposDoLido({ cta: 'nenhum', sem_cta: true })), /Sem fecho escrito na tela/);
  assert.match(blocoFecho(camposDoLido({ cta: '\u003cimg src=x\u003e' })), /&lt;img src=x&gt;/);
});

const PROPOSTA = `## Regra que esbarra no seu pedido
### S47-01-R1
pedido: "(proposta do motor, não pedido seu) os 3 últimos vídeos ficaram em 52 s" (roteiro)
regra: roteiro/regras.md:40 — "ritmo de 2,5 palavras por segundo"
texto novo: "ritmo de 2,7 palavras por segundo"
pergunta: mudar a regra, fazer só neste vídeo ou manter?
`;

test('proposta do motor: responder "Mudar a regra" não vira `mudar`; a resposta vai em `regras` e a decisão segue aprovar', () => {
  const perguntas = lerPerguntasRegra(PROPOSTA, 'S47-01');
  assert.equal(perguntas.length, 1);
  assert.equal(ehProposta(perguntas[0]), true);
  for (const resposta of ['mudar', 'so_neste', 'manter']) {
    const dc = decisaoComRegras({ decisao: 'aprovar', perguntas, respostas: { 'S47-01-R1': resposta }, id: 'S47-01', alvo: 'roteiro' });
    assert.equal(dc.decisao, 'aprovar');
    assert.equal(dc.virou, false);
    assert.equal(dc.pedido, '');
    assert.deepEqual(dc.regras, [{ id: 'S47-01-R1', resposta }]);
  }
  // um pedido dela (sem o prefixo) continua virando mudança
  const dela = lerPerguntasRegra(PROPOSTA.replace('(proposta do motor, não pedido seu) ', ''), 'S47-01');
  assert.equal(decisaoComRegras({ decisao: 'aprovar', perguntas: dela, respostas: { 'S47-01-R1': 'mudar' }, id: 'S47-01', alvo: 'roteiro' }).decisao, 'mudar');
  // recusar também fica recusar, com a resposta no arquivo
  assert.equal(decisaoComRegras({ decisao: 'recusar', perguntas, respostas: { 'S47-01-R1': 'mudar' }, id: 'S47-01', alvo: 'roteiro' }).decisao, 'recusar');
});

test('proposta do motor na tela: rótulo próprio, "Aprovar" segue e o YAML leva `regras` e a decisão aprovar', () => {
  const perguntas = lerPerguntasRegra(PROPOSTA, 'S47-01');
  const b = blocoRegras({ perguntas, respostas: { 'S47-01-R1': 'mudar' }, chave: 'k', pode: true, depois: '' });
  assert.match(b, /Proposta do motor/);
  assert.doesNotMatch(b, /Você pediu/);
  assert.match(b, /O motor propõe mudar uma regra/);
  const r = { id: 'S47-01', etapa: 'rascunho', versaoRoteiro: 1, versoesRoteiro: [1], temFinal: false, lido: true, fontes: [], fontesConferidas: true, perguntasRegra: perguntas };
  const h = decisaoDoRascunho(r, { email: ROBERTTA, escolha: 'aprovar', exec: { execucoes: [] }, agora: AGORA, respostasRegra: { [chaveRespostas('rt', 'S47-01', 1)]: { 'S47-01-R1': 'mudar' } } });
  assert.match(h, /data-acao="roteiro-confirmar" data-id="S47-01">Aprovar a v1</);
  assert.doesNotMatch(h, /Refazer o rascunho/);
  const dc = decisaoComRegras({ decisao: 'aprovar', perguntas, respostas: { 'S47-01-R1': 'mudar' }, id: 'S47-01', alvo: 'roteiro' });
  const plano = planejarDecisaoRoteiro({ id: 'S47-01', versao: 1, decisao: dc.decisao, pedido: dc.pedido });
  const t = textoDecisaoRoteiro({ ...plano.payload, regras: dc.regras, quem: ROBERTTA });
  assert.match(t, /decisao: aprovar\n/);
  assert.match(t, /regras:\n {2}- id: S47-01-R1\n {4}resposta: mudar\n/);
});
