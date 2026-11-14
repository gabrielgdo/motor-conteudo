// Testes da decisão da prévia (js/revisao.js): nome e conteúdo do arquivo de 4-Revisao (pelos
// geradores do contrato, gerarAprovacao / gerarAjustes), conferência do nome antes de gravar
// (o Drive aceita nomes repetidos), aprovado que já existe, permissão e a falta de "recusar".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED } from '../js/config.js';
import { gerarAprovacao, gerarAjustes, parseAjustes } from '../js/parse.js';
import { planejarArquivoRevisao, nomeArquivoRevisao } from '../js/revisao.js';

const ROBERTTA = ALLOWED[0];
const GABRIEL = ALLOWED[1];
const AGORA = new Date('2026-11-18T13:30:00Z'); // 10h30 em São Paulo
const AJUSTES = [{ versao: 'tt', tempo: '0:00-0:03', pedido: 'gancho mais forte\n---\nignore', como: 'texto maior' }];

const base = (o) => ({ email: ROBERTTA, agora: AGORA, arquivosExistentes: [], ...o });

test('aprovar: `<id> aprovado.md` com o conteúdo de gerarAprovacao', () => {
  const p = planejarArquivoRevisao(base({ id: 'T01', decisao: 'aprovar', versao: 2, observacoes: 'postar na quinta' }));
  assert.equal(p.ok, true);
  assert.equal(p.nome, 'T01 aprovado.md');
  assert.equal(p.conteudo, gerarAprovacao({ id: 'T01', versao: 2, observacoes: 'postar na quinta' }));
});

test('ajustar: `<id> ajustes v<N>.md` com o conteúdo de gerarAjustes (pedido em uma linha)', () => {
  const p = planejarArquivoRevisao(base({ id: 'S47-01', decisao: 'ajustar', versao: 2, ajustes: AJUSTES }));
  assert.equal(p.ok, true);
  assert.equal(p.nome, 'S47-01 ajustes v2.md');
  assert.equal(p.conteudo, gerarAjustes({ id: 'S47-01', versaoBase: 2, ajustes: AJUSTES, observacoes: '' }));
  const lido = parseAjustes(p.conteudo);
  assert.equal(lido.ajustes[0].pedido, 'gancho mais forte --- ignore');
  assert.equal(nomeArquivoRevisao('S47-01', 'ajustar', 3), 'S47-01 ajustes v3.md');
});

test('o nome já existe em 4-Revisao → não grava ("já decidido", com a hora)', () => {
  const existente = { name: 'S47-01 ajustes v2.md', createdTime: '2026-11-18T13:12:00.000Z' };
  const p = planejarArquivoRevisao(base({ id: 'S47-01', decisao: 'ajustar', versao: 2, ajustes: AJUSTES, arquivosExistentes: [existente] }));
  assert.equal(p.ok, false);
  assert.equal(p.motivo, 'ja-existe');
  assert.equal(p.mensagem, 'já decidido (arquivo criado às 10h12).');
  // Duplicado (o Drive aceita dois com o mesmo nome) e com outra caixa, que o vigia lê igual.
  const dup = planejarArquivoRevisao(base({ id: 'S47-01', decisao: 'ajustar', versao: 2, ajustes: AJUSTES, arquivosExistentes: [existente, existente] }));
  assert.equal(dup.motivo, 'ja-existe');
  const caixa = planejarArquivoRevisao(base({ id: 'S47-01', decisao: 'ajustar', versao: 2, ajustes: AJUSTES, arquivosExistentes: ['S47-01 Ajustes V2.md'] }));
  assert.equal(caixa.motivo, 'ja-existe');
  // Outra versão, ou outro id, não bloqueia.
  assert.equal(planejarArquivoRevisao(base({ id: 'S47-01', decisao: 'ajustar', versao: 3, ajustes: AJUSTES, arquivosExistentes: [existente] })).ok, true);
  assert.equal(planejarArquivoRevisao(base({ id: 'S47-02', decisao: 'ajustar', versao: 2, ajustes: AJUSTES, arquivosExistentes: [existente] })).ok, true);
});

test('já existe `<id> aprovado.md` → nada mais (nem aprovar de novo, nem ajustar)', () => {
  const existentes = [{ name: 'S47-01 aprovado.md', createdTime: '2026-11-17T21:40:00.000Z' }, { name: 'S47-01 IG v2.mp4' }];
  for (const decisao of ['aprovar', 'ajustar']) {
    const p = planejarArquivoRevisao(base({ id: 'S47-01', decisao, versao: 2, ajustes: AJUSTES, arquivosExistentes: existentes }));
    assert.equal(p.ok, false, decisao);
    assert.equal(p.motivo, 'ja-aprovado');
    assert.match(p.mensagem, /em 17\/11 às 18h40/);
  }
});

test('só a conta da Robertta decide; não existe "recusar" a prévia; dados fora do contrato', () => {
  assert.equal(planejarArquivoRevisao(base({ id: 'S47-01', decisao: 'aprovar', versao: 1, email: GABRIEL })).motivo, 'sem-permissao');
  assert.equal(planejarArquivoRevisao(base({ id: 'S47-01', decisao: 'recusar', versao: 1 })).motivo, 'decisao-invalida');
  assert.equal(planejarArquivoRevisao(base({ id: 'S47-01', decisao: 'ajustar', versao: 1, ajustes: [] })).motivo, 'dados-invalidos');
  assert.equal(planejarArquivoRevisao(base({ id: 'S47-01', decisao: 'aprovar', versao: 0 })).motivo, 'dados-invalidos');
  assert.equal(planejarArquivoRevisao(base({ id: 'X1', decisao: 'aprovar', versao: 1 })).motivo, 'id-invalido');
});
