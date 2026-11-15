// Desempenho (js/desempenho.js) e a tela Resultados: leitura da aba, vídeos esperando números, plano de gravação
// (cabeçalho "rede" criado se faltar, linha do "Postei" reaproveitada, linha nova) e o markdown da retrospectiva.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerDesempenho, esperandoNumeros, planejarNumeros, limparNumero, retrospectivaMaisNova, normalizarRede } from '../js/desempenho.js';
import { mdSimples, htmlResultados } from '../js/telas/resultados.js';

const CAB = ['id', 'data do post', 'visualizações', 'retenção média', 'envios', 'salvamentos', 'seguidores ganhos'];
const aba = (linhas, cab = CAB) => ({ linhas: [cab, ...linhas], cabecalho: cab, linhaCabecalho: 0 });
const AGORA = new Date('2026-11-15T12:00:00-03:00');

test('limparNumero: formatos brasileiros e porcentagem', () => {
  assert.equal(limparNumero('12.300'), '12300');
  assert.equal(limparNumero('12,3 mil'), '12300');
  assert.equal(limparNumero('1,2 mi'), '1200000');
  assert.equal(limparNumero('42%', { porcentagem: true }), '42');
  assert.equal(limparNumero('41,5', { porcentagem: true }), '41.5');
  assert.equal(limparNumero(''), '');
  assert.equal(limparNumero('muito'), null);
  assert.equal(normalizarRede('ig'), 'Instagram');
  assert.equal(normalizarRede('TikTok'), 'TikTok');
});

test('esperandoNumeros: só postados há 7 dias ou mais, por rede que falta, sem testes', () => {
  const lido = lerDesempenho(aba([
    ['S46-01', '2026-11-05'],
    ['S46-02', '2026-11-06', '1000', '40', '', '', '', 'Instagram'],
    ['S47-01', '2026-11-14'],
    ['T05', '2026-11-01'],
  ], [...CAB, 'rede']));
  const e = esperandoNumeros(lido, AGORA);
  assert.deepEqual(e.map((v) => [v.id, v.redes.join('+')]), [['S46-01', 'Instagram+TikTok'], ['S46-02', 'TikTok']]);
});

test('planejarNumeros: sem coluna rede, cria o cabeçalho e preenche a linha do Postei', () => {
  const lido = lerDesempenho(aba([['S46-01', '2026-11-05']]));
  const p = planejarNumeros(lido, { id: 'S46-01', rede: 'Instagram', valores: { visualizacoes: '12,3 mil', retencao: '42%', envios: '80' } });
  assert.equal(p.ok, true);
  assert.deepEqual(p.cabecalhoRede, { linha: 1, coluna: 7, valor: 'rede' });
  assert.equal(p.novaLinha, null);
  const porColuna = Object.fromEntries(p.celulas.map((c) => [c.coluna, [c.linha, c.valor]]));
  assert.deepEqual(porColuna[7], [2, 'Instagram']);
  assert.deepEqual(porColuna[2], [2, '12300']);
  assert.deepEqual(porColuna[3], [2, '42']);
});

test('planejarNumeros: a outra rede vira linha nova com a data do post; mesma rede atualiza', () => {
  const lido = lerDesempenho(aba([['S46-01', '2026-11-05', '12300', '42', '80', '', '', 'Instagram']], [...CAB, 'rede']));
  const tt = planejarNumeros(lido, { id: 'S46-01', rede: 'TikTok', valores: { visualizacoes: '800' } });
  assert.equal(tt.cabecalhoRede, null);
  assert.deepEqual(tt.novaLinha, ['S46-01', '2026-11-05', '800', '', '', '', '', 'TikTok']);
  const ig = planejarNumeros(lido, { id: 'S46-01', rede: 'Instagram', valores: { visualizacoes: '13000' } });
  assert.ok(ig.celulas.every((c) => c.linha === 2));
});

test('planejarNumeros: recusa sem visualizações, número inválido e rede desconhecida', () => {
  const lido = lerDesempenho(aba([['S46-01', '2026-11-05']]));
  assert.equal(planejarNumeros(lido, { id: 'S46-01', rede: 'Instagram', valores: {} }).ok, false);
  assert.equal(planejarNumeros(lido, { id: 'S46-01', rede: 'Instagram', valores: { visualizacoes: 'muito' } }).ok, false);
  assert.equal(planejarNumeros(lido, { id: 'S46-01', rede: 'YouTube', valores: { visualizacoes: '1' } }).ok, false);
});

test('retrospectivaMaisNova e mdSimples (escapado)', () => {
  assert.equal(retrospectivaMaisNova([{ name: '2026-11-08 retrospectiva.md' }, { name: '2026-11-15 retrospectiva.md' }, { name: '2026-11-15 pedido.md' }]).name, '2026-11-15 retrospectiva.md');
  const h = mdSimples('# Retrospectiva\n\n| rede | vídeos |\n|---|---|\n| Instagram | 4 |\n\n1. [IG] gancho <b>curto</b>\n2. outro');
  assert.match(h, /<table class="retro-tabela">/);
  assert.match(h, /<td>Instagram<\/td>/);
  assert.match(h, /<ol class="retro-lista"><li>\[IG\] gancho &lt;b&gt;curto&lt;\/b&gt;<\/li>/);
});

test('htmlResultados: formulário para o que falta e botão da retrospectiva (sem o Diretor)', () => {
  const lido = lerDesempenho(aba([['S46-01', '2026-11-05']]));
  const h = htmlResultados({ fase: 'ok', lido, retro: null, agora: AGORA });
  assert.match(h, /data-acao="salvar-numeros" data-id="S46-01" data-valor="Instagram"/);
  assert.match(h, /data-acao="pedir-retrospectiva"/);
  assert.doesNotMatch(h, /diretor-retrospectiva|Fazer retrospectiva agora/);
});
