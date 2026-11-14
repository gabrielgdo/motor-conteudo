// Ponto de entrada para `node --test novo/tests/` (ou `node --test tests/ novo/tests/`, na raiz).
// No Node ≥ 22 um diretório passado ao --test carrega o index.js dele; este arquivo só importa os
// testes de verdade, que também rodam sozinhos com `node --test novo/tests/*.test.mjs`.
import('./roteiro.test.mjs');
import('./etapas.test.mjs');
import('./dados.test.mjs');
import('./parte2.test.mjs');
