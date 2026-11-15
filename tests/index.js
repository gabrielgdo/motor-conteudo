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
import('./controle.test.mjs');
import('./selecao.test.mjs');
import('./revisao.test.mjs');
import('./telas.test.mjs');
import('./candidatos.test.mjs');
import('./sessao.test.mjs');
import('./versao.test.mjs');
import('./ponte.test.mjs');
import('./andamento.test.mjs');
import('./saude.test.mjs');
import('./envios.test.mjs');
import('./tele.test.mjs');
import('./decisoes-roteiro.test.mjs');
import('./envio.test.mjs');
import('./telacheia.test.mjs');
import('./estado-candidato.test.mjs');
import('./ficha.test.mjs');
import('./nav.test.mjs');
import('./pedidos-motor.test.mjs');
import('./central.test.mjs');
