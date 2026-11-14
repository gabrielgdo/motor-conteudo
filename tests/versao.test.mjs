// Testes da nova versão (js/versao.js): recarregar sozinho ou avisar, e o marcador anti-laço.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirAtualizacao, aplicarAtualizacao, marcarRecarga, lerRecarga, numeroDaVersao, CHAVE_RECARGA } from '../js/versao.js';

class StorageFalso {
  constructor(inicial = {}) { this.m = new Map(Object.entries(inicial)); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

const V5 = 'motor-app-v5';
const V6 = 'motor-app-v6';
const V7 = 'motor-app-v7';

test('decidirAtualizacao: mesma versão → nada; outra versão e livre → recarregar; ocupada → avisar', () => {
  assert.equal(decidirAtualizacao({ versaoPagina: V6, versaoSw: V6 }), 'nada');
  assert.equal(decidirAtualizacao({ versaoPagina: V6, versaoSw: V6, ocupada: true }), 'nada');
  assert.equal(decidirAtualizacao({ versaoPagina: V5, versaoSw: V6 }), 'recarregar');
  assert.equal(decidirAtualizacao({ versaoPagina: V5, versaoSw: V6, ocupada: true }), 'avisar');
});

test('decidirAtualizacao: já recarregou para esta versão → avisar (sem laço); para outra → pode recarregar', () => {
  assert.equal(decidirAtualizacao({ versaoPagina: V5, versaoSw: V6, jaRecarregouPara: V6 }), 'avisar');
  assert.equal(decidirAtualizacao({ versaoPagina: V5, versaoSw: V6, jaRecarregouPara: V5 }), 'recarregar');
  assert.equal(decidirAtualizacao({ versaoPagina: V6, versaoSw: V7, jaRecarregouPara: V6 }), 'recarregar');
});

test('decidirAtualizacao: página mais nova que o SW (o novo ainda instalando) → nada; formato desconhecido → recarregar', () => {
  assert.equal(decidirAtualizacao({ versaoPagina: V6, versaoSw: V5 }), 'nada');
  assert.equal(decidirAtualizacao({ versaoPagina: 'motor-app-v10', versaoSw: 'motor-app-v9' }), 'nada'); // número, não texto
  assert.equal(decidirAtualizacao({ versaoPagina: 'motor-app-v9', versaoSw: 'motor-app-v10' }), 'recarregar');
  assert.equal(decidirAtualizacao({ versaoPagina: V6, versaoSw: 'motor-shell-x' }), 'recarregar');
  assert.equal(numeroDaVersao('motor-app-v12'), 12);
  assert.equal(numeroDaVersao(null), null);
});

test('decidirAtualizacao: SW que não respondeu (null) → avisar, nunca recarregar', () => {
  assert.equal(decidirAtualizacao({ versaoPagina: V6, versaoSw: null }), 'avisar');
  assert.equal(decidirAtualizacao({ versaoPagina: V6, versaoSw: '' }), 'avisar');
});

test('marcador anti-laço: grava e lê; armazenamento que lança ou não guarda → false/null', () => {
  const s = new StorageFalso();
  assert.equal(lerRecarga(s), null);
  assert.equal(marcarRecarga(s, V6), true);
  assert.equal(lerRecarga(s), V6);
  assert.equal(s.getItem(CHAVE_RECARGA), V6);
  const lanca = { getItem() { throw new Error('x'); }, setItem() { throw new Error('QuotaExceeded'); } };
  assert.equal(marcarRecarga(lanca, V6), false);
  assert.equal(lerRecarga(lanca), null);
  const esquece = { getItem: () => null, setItem() {} }; // finge gravar
  assert.equal(marcarRecarga(esquece, V6), false);
  assert.equal(marcarRecarga(null, V6), false);
  assert.equal(lerRecarga(undefined), null);
});

/** Uma rodada da página: pergunta a versão e aplica a decisão (recarregar/avisar são falsos). */
function rodada(storage, { versaoPagina = V5, versaoSw = V6, ocupada = false } = {}) {
  const feito = [];
  const d = aplicarAtualizacao({ versaoPagina, versaoSw, ocupada }, storage, {
    recarregar: () => feito.push('recarregar'),
    avisar: () => feito.push('avisar'),
  });
  return { d, feito };
}

test('aplicarAtualizacao: recarrega UMA vez; se a página voltar com a versão velha, só avisa', () => {
  const s = new StorageFalso();
  assert.deepEqual(rodada(s), { d: 'recarregar', feito: ['recarregar'] });
  assert.equal(lerRecarga(s), V6);
  // "depois da recarga" a página ainda veio velha (cache HTTP): aviso, nunca outra recarga
  assert.deepEqual(rodada(s), { d: 'avisar', feito: ['avisar'] });
  assert.deepEqual(rodada(s), { d: 'avisar', feito: ['avisar'] });
  // a página nova (v6) com o SW v6: nada
  assert.deepEqual(rodada(s, { versaoPagina: V6 }), { d: 'nada', feito: [] });
  // a versão seguinte pode recarregar de novo, uma vez
  assert.deepEqual(rodada(s, { versaoPagina: V6, versaoSw: V7 }), { d: 'recarregar', feito: ['recarregar'] });
  assert.deepEqual(rodada(s, { versaoPagina: V6, versaoSw: V7 }), { d: 'avisar', feito: ['avisar'] });
});

test('aplicarAtualizacao: ocupada não grava o marcador (recarrega quando ficar livre); sem armazenamento só avisa', () => {
  const s = new StorageFalso();
  assert.deepEqual(rodada(s, { ocupada: true }), { d: 'avisar', feito: ['avisar'] });
  assert.equal(lerRecarga(s), null);
  assert.deepEqual(rodada(s), { d: 'recarregar', feito: ['recarregar'] }); // ao voltar ao app, já livre
  const quebrado = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.deepEqual(rodada(quebrado), { d: 'avisar', feito: ['avisar'] });
  assert.deepEqual(rodada(null), { d: 'avisar', feito: ['avisar'] });
});
