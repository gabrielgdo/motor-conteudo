// Ponto de entrada para `node --test tests/`.
// No Node ≥ 22 um diretório passado ao --test carrega o index.js dele; este arquivo só importa os
// testes de verdade, que também rodam sozinhos com `node --test tests/*.test.mjs`.
import('./parse.test.mjs');
import('./model.test.mjs');
import('./roteiro.test.mjs');
import('./etapas.test.mjs');
import('./dados.test.mjs');
import('./parte2.test.mjs');
import('./sw.test.mjs');
import('./sair.test.mjs');
import('./versao.test.mjs');
