// Navegação: na troca de tela (View Transitions), a pílula da seção atual desliza da seção antiga
// para a nova, e a ilha/doca não deixam rastro (a foto antiga delas não aparece). Confere o CSS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

test('a pílula da seção atual tem nome próprio na troca e desliza com fundo de pílula', () => {
  assert.match(css, /\.nav-link\[aria-current="page"\]\{[^}]*view-transition-name:nav-atual/);
  const grupo = css.match(/::view-transition-group\(nav-atual\)\{([^}]*)\}/);
  assert.ok(grupo, 'falta o grupo nav-atual');
  assert.match(grupo[1], /border-radius:999px/);
  assert.match(grupo[1], /background:var\(--acento\)/);
  assert.match(grupo[1], /animation-duration:/);
  assert.match(css, /::view-transition-old\(nav-atual\),::view-transition-new\(nav-atual\)\{[^}]*height:100%[^}]*object-fit:none/);
});

test('ilha e doca continuam sem rastro (foto antiga escondida)', () => {
  assert.match(css, /::view-transition-old\(ilha\),::view-transition-old\(doca\)\{display:none\}/);
});
