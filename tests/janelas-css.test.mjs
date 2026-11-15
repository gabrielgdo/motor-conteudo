// Janelas no Safari (WebKit): `.dlg` com height:100% contra a altura automática do <dialog> dava 0 e a janela
// abria só com a borda (2 px), parecendo travada (15/11/2026, conferido no WebKit do Playwright). Só a gaveta e a
// tela cheia, que têm altura fixa, podem usar 100%.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

test('.dlg sem height:100% (no Safari a janela sumia)', () => {
  const regra = CSS.match(/(^|\n)\.dlg\{([^}]*)\}/);
  assert.ok(regra, 'falta a regra .dlg');
  assert.doesNotMatch(regra[2], /(^|;)\s*height\s*:\s*100%/);
});

test('gaveta e tela cheia continuam com a altura toda', () => {
  assert.match(CSS, /dialog\.gaveta \.dlg,dialog\.telacheia \.dlg\{height:100%\}/);
});
