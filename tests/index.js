// Ponto de entrada para `node --test tests/`.
// No Node ≥ 22 o argumento "tests/" é tratado como caminho/glob e, por ser um diretório, o Node
// carrega tests/index.js. Este arquivo só importa os testes de verdade (que também rodam sozinhos
// com `node --test tests/*.test.mjs`).
import('./parse.test.mjs');
import('./model.test.mjs');
