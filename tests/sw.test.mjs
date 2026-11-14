// Testes do PWA na raiz: a lista de arquivos do sw.js (um 404 no cache.addAll quebra a instalação
// do service worker e deixa o SW antigo no lugar), a versão do cache, o manifest e os caminhos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const ler = (rel) => readFileSync(path.join(RAIZ, rel), 'utf8');
const SW = ler('sw.js');

/** Os caminhos de `const ARQUIVOS = [...]` no sw.js, como estão escritos ('./js/main.js'). */
function arquivosDoSw() {
  const m = SW.match(/const ARQUIVOS = \[([\s\S]*?)\];/);
  assert.ok(m, 'sw.js precisa ter "const ARQUIVOS = [...]"');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** './' → 'index.html'; './js/a.js' → 'js/a.js' (relativo à raiz do repositório). */
const noDisco = (p) => (p === './' ? 'index.html' : path.posix.normalize(p));

/** Os módulos alcançados a partir de js/main.js pelos imports estáticos (caminhos relativos à raiz). */
function modulosDoApp(entrada = 'js/main.js', vistos = new Set()) {
  if (vistos.has(entrada)) return vistos;
  vistos.add(entrada);
  const fonte = ler(entrada);
  for (const [, alvo] of fonte.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+'([^']+)'/gm)) {
    assert.ok(alvo.startsWith('./') || alvo.startsWith('../'), `${entrada}: import não relativo "${alvo}"`);
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(entrada), alvo));
    assert.ok(!rel.startsWith('..'), `${entrada}: "${alvo}" sai da raiz do app`);
    assert.ok(existsSync(path.join(RAIZ, rel)), `${entrada}: "${alvo}" não existe (${rel})`);
    modulosDoApp(rel, vistos);
  }
  return vistos;
}

test('sw.js: todo arquivo da lista existe (senão o addAll falha e o SW não instala)', () => {
  const lista = arquivosDoSw();
  assert.ok(lista.length > 10);
  assert.equal(new Set(lista).size, lista.length, 'arquivo repetido na lista');
  for (const p of lista) {
    assert.ok(p.startsWith('./'), `caminho não relativo: ${p}`);
    const f = path.join(RAIZ, noDisco(p));
    assert.ok(existsSync(f) && statSync(f).isFile(), `não existe: ${p}`);
  }
});

test('sw.js: tem todos os módulos do app e os arquivos que o index.html carrega', () => {
  const lista = new Set(arquivosDoSw().map(noDisco));
  for (const m of modulosDoApp()) assert.ok(lista.has(m), `${m} é importado pelo app mas falta no ARQUIVOS do sw.js`);
  const html = ler('index.html');
  const refs = [...html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)].map((x) => noDisco(x[1]));
  assert.ok(refs.includes('js/main.js'), 'index.html precisa carregar ./js/main.js');
  for (const r of refs) {
    assert.ok(existsSync(path.join(RAIZ, r)), `index.html aponta para ${r}, que não existe`);
    assert.ok(lista.has(r), `${r} (do index.html) falta no ARQUIVOS do sw.js`);
  }
  // Fora do cache de propósito: o SheetJS (grande, sob demanda) e o envio da etapa 2.
  assert.ok(!lista.has('vendor/xlsx.full.min.js'));
  assert.ok(!lista.has('js/upload.js'));
});

test('sw.js: versão nova do cache, igual à do js/main.js, e limpeza dos caches antigos', () => {
  const prefixo = SW.match(/const PREFIXO = '([^']+)'/)?.[1];
  const sufixo = SW.match(/const VERSAO = `\$\{PREFIXO\}([^`]+)`/)?.[1];
  assert.equal(prefixo, 'motor-app-');
  assert.match(sufixo || '', /^v\d+$/);
  const versao = prefixo + sufixo;
  assert.equal(ler('js/main.js').match(/const VERSAO_APP = '([^']+)'/)?.[1], versao, 'VERSAO_APP (js/main.js) ≠ VERSAO (sw.js)');
  const antigos = SW.match(/const CACHES_ANTIGOS = \[([^\]]*)\]/)?.[1] || '';
  for (const p of ["'motor-shell-'", "'motor-novo-'", 'PREFIXO']) assert.ok(antigos.includes(p), `CACHES_ANTIGOS sem ${p}`);
  assert.match(SW, /skipWaiting\(\)/);
  assert.match(SW, /clients\.claim\(\)/);
  assert.match(SW, /url\.origin !== self\.location\.origin\) return/);
  assert.match(ler('js/main.js'), /register\('\.\/sw\.js', \{ scope: '\.\/' \}\)/);
});

test('manifest: mesma identidade do app instalado (raiz), tema Noite e ícones que existem', () => {
  const m = JSON.parse(ler('manifest.webmanifest'));
  assert.equal(m.id, './');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.name, 'Motor de Conteúdo');
  assert.equal(m.short_name, 'Motor');
  assert.equal(m.display, 'standalone');
  assert.equal(m.theme_color, '#0F0809');
  assert.equal(m.background_color, '#0F0809');
  const tamanhos = new Set(m.icons.map((i) => i.sizes));
  assert.ok(tamanhos.has('192x192') && tamanhos.has('512x512'));
  for (const i of m.icons) assert.ok(existsSync(path.join(RAIZ, noDisco(i.src))), `ícone não existe: ${i.src}`);
});

test('nenhum arquivo do app aponta para a antiga subpasta novo/ nem para fora da raiz', () => {
  const arquivos = [...arquivosDoSw().map(noDisco), 'sw.js'].filter((f) => !f.endsWith('.png'));
  for (const f of arquivos) {
    const fonte = ler(f);
    assert.ok(!/novo\//.test(fonte), `${f} ainda cita novo/`);
    // '../' só nos imports de js/telas e js/componentes, que voltam para js/ (conferido acima).
    const semImports = fonte.replace(/^\s*(?:import|export)\s[^'"]*?from\s+'\.\.\/[^']+';?$/gm, '');
    assert.ok(!semImports.includes('../'), `${f} tem um caminho "../"`);
  }
});
