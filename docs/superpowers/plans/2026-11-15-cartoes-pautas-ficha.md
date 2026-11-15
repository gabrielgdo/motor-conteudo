# Cartões de Pautas no formato Ficha — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cartões de candidato e de pauta legíveis: título curto, entrega à vista, números limpos, o resto em seções recolhidas.

**Architecture:** Um módulo puro novo, `js/telas/ficha.js`, separa o texto do Radar pelos rótulos em MAIÚSCULAS, tira os números de frases livres e devolve HTML já escapado para os trechos. `cartaoCandidato` e `cartao` em `js/telas/pautas.js` passam a montar a Ficha com ele. CSS só nas classes de Pautas que já existem.

**Tech Stack:** HTML/CSS/JS com ES modules, sem build; testes `node --test tests/` (Node 22+).

**Spec:** `docs/superpowers/specs/2026-11-15-cartoes-pautas-ficha-design.md`

## Global Constraints

- Só layout: nada de mudar `js/integra.js`, ponte, colunas, chamadas, estados, regras de decisão, botões ou textos de estado.
- Todo dado da planilha passa por `esc()` (`js/util.js`). Links: só `hrefSeguro` (https); http fica como texto.
- Peças visuais existentes (`.painel`, `.pauta`, `.selo`, `.botao`, `details`/`summary` de `.pauta`), medidas em rem, mesma densidade. Sem ladrilhos de números.
- Celular de 360 a 430 px e PWA do iPhone: nada cortado nem sobreposto.
- `VERSAO_APP` (`js/main.js`) e `VERSAO` (`sw.js`) de v20 para v21, juntas; `./js/telas/ficha.js` em `ARQUIVOS` do `sw.js`.
- Commits sem `Co-Authored-By:`, `Claude-Session:` ou assinatura de agente. Push só no fim, depois do Gabriel conferir.

## Review Focus

- Candidato antigo com `angulo` curto e sem rótulos: o título continua igual ao de hoje (teste na Task 1 e na Task 2).
- Texto com rótulo malicioso ou HTML no meio (`PERGUNTA: <img onerror>`) e link `javascript:`/`http:`: nada vira HTML ativo (Task 1).
- Palavras em MAIÚSCULAS que não são rótulo (`CFP/CRP.`, `DOI 10.1002`, `X`): não cortam o texto (Task 1).
- `visualizacoes` numérico ("120000"): a linha de números fica como hoje, `120 mil visualizações · mediana 15 mil · 8× a mediana · @a` (Task 2, testes atuais continuam).
- Pauta com campo vazio: a seção não aparece, sem `<details>` vazio (Task 3).

---

### Task 1: Módulo `js/telas/ficha.js`

**Files:**
- Create: `js/telas/ficha.js`
- Create: `tests/ficha.test.mjs`
- Modify: `tests/index.js` (acrescentar `import('./ficha.test.mjs');`)
- Modify: `sw.js` (acrescentar `'./js/telas/ficha.js',` depois de `'./js/telas/pecas.js',`)

**Interfaces:**
- Produces:
  - `separarTextoRadar(texto: string) -> Array<{ chave: string, rotulo: string, nota: string, texto: string }>`
    `chave`: rótulo original em maiúsculas sem a nota (`'PÚBLICO/SITUAÇÃO'`), `''` para o trecho antes do primeiro rótulo. `rotulo`: nome para a tela. `nota`: o parêntese do rótulo sem os parênteses (`'consultado só o resumo, não o texto integral'`) ou `''`. `texto`: aparado. Texto vazio → `[]`. Sem rótulos → `[{ chave: '', rotulo: '', nota: '', texto }]`.
  - `fichaDoTexto(texto: string, { limiteTitulo = 160 } = {}) -> { titulo: string, entrega: string, secoes: Array<{ rotulo, nota, texto }> }`
  - `numerosDoTexto(texto: string) -> Array<{ valor: string, rotulo: string }>` (valor compacto pt-BR)
  - `referenciasEmLista(texto: string) -> string[]`
  - `htmlTextoRadar(texto: string) -> string` (HTML seguro: parágrafos, links https)
  - `ROTULOS_RADAR` (mapa chave → rótulo da tela)

- [ ] **Step 1: Escrever os testes que falham** em `tests/ficha.test.mjs`. Fixture `RADAR` = o texto do print (abaixo, encurtado é aceitável desde que mantenha todos os rótulos e as três referências):

```js
const RADAR = "PÚBLICO/SITUAÇÃO: adultos que querem se vincular, mas vivem à espera de que a pessoa desista deles. PERGUNTA: por que o medo de ser abandonado(a) faz ler sinais neutros do parceiro como rejeição, e o que isso faz com a relação? ENTREGA: distinguir o medo de abandono (sensibilidade à rejeição) do risco real de a relação acabar. ORIGENS: sinal editorial = post no X de 12/11/2026; sem documento CFP/CRP. DATAS: coleta 14/11/2026; pauta perene. REFERÊNCIAS (consultado só o resumo, não o texto integral): (1) Rejection sensitivity and romantic relationships, 2023, https://doi.org/10.1016/j.paid.2023.112186 (60 estudos) - sustenta com limites; (2) Li & Chan 2012, https://onlinelibrary.wiley.com/doi/10.1002/ejsp.1842 (DOI 10.1002/ejsp.1842; 73 estudos) - sustenta com limites; (3) Rejection sensitivity and adult attachment (http://hdl.handle.net/10871/127156) - só estudos transversais. LIMITES: correlacional; autorrelato; sem promessa de cura. Recorte novo frente a 2026-11-10-05.";
```

```js
test('separa nos rótulos do Radar, com nota no parêntese', () => {
  const p = separarTextoRadar(RADAR);
  assert.deepEqual(p.map((x) => x.chave), ['PÚBLICO/SITUAÇÃO', 'PERGUNTA', 'ENTREGA', 'ORIGENS', 'DATAS', 'REFERÊNCIAS', 'LIMITES']);
  assert.equal(p[5].nota, 'consultado só o resumo, não o texto integral');
  assert.match(p[3].texto, /sem documento CFP\/CRP\.$/);           // CFP/CRP não é rótulo
  assert.match(p[5].texto, /DOI 10\.1002\/ejsp\.1842/);             // DOI não é rótulo
  assert.match(p[6].texto, /Recorte novo frente a 2026-11-10-05\.$/);
  assert.equal(p[0].rotulo, 'Para quem');
});
test('sem rótulos: uma parte só; vazio: nada', () => {
  assert.deepEqual(separarTextoRadar('Ângulo curto'), [{ chave: '', rotulo: '', nota: '', texto: 'Ângulo curto' }]);
  assert.deepEqual(separarTextoRadar('  '), []);
});
test('ficha: pergunta vira título (primeira letra maiúscula), entrega à parte, seções na ordem', () => {
  const f = fichaDoTexto(RADAR);
  assert.match(f.titulo, /^Por que o medo de ser abandonado\(a\)/);
  assert.match(f.entrega, /^distinguir o medo/);
  assert.deepEqual(f.secoes.map((s) => s.rotulo), ['Para quem', 'Referências', 'Limites', 'Origem', 'Datas']);
});
test('ficha sem rótulos: curto fica inteiro; longo vira primeira frase + Resumo', () => {
  assert.deepEqual(fichaDoTexto('Ângulo curto'), { titulo: 'Ângulo curto', entrega: '', secoes: [] });
  const longo = 'Primeira frase com sentido. ' + 'x'.repeat(200);
  const f = fichaDoTexto(longo);
  assert.equal(f.titulo, 'Primeira frase com sentido.');
  assert.deepEqual(f.secoes.map((s) => s.rotulo), ['Resumo']);
});
test('números tirados da frase livre, compactos', () => {
  const n = numerosDoTexto('Visualizações: 230.111 impressões, 16.000 curtidas, 4.618 reposts, 929 salvamentos (X, coleta 14/11/2026)');
  assert.deepEqual(n.map((x) => [x.valor.replace(/ /g, ' '), x.rotulo]),
    [['230,1 mil', 'impressões'], ['16 mil', 'curtidas'], ['4,6 mil', 'reposts'], ['929', 'salvamentos']]);
  assert.deepEqual(numerosDoTexto('muitas'), []);
});
test('referências numeradas viram lista', () => {
  const r = referenciasEmLista(separarTextoRadar(RADAR)[5].texto);
  assert.equal(r.length, 3);
  assert.match(r[1], /^Li & Chan 2012/);
  assert.deepEqual(referenciasEmLista('sem numeração'), ['sem numeração']);
});
test('htmlTextoRadar: escapa tudo, link só https', () => {
  const h = htmlTextoRadar('veja https://a.org/x?y=1&z=2, http://b.org e <img src=x onerror=alert(1)> javascript:alert(1)');
  assert.match(h, /<a href="https:\/\/a\.org\/x\?y=1&amp;z=2" target="_blank" rel="noopener noreferrer">/);
  assert.doesNotMatch(h, /href="http:/);
  assert.ok(!h.includes('<img'));
  assert.doesNotMatch(h, /href="javascript/);
});
test('rótulo malicioso continua texto', () => {
  const f = fichaDoTexto('PERGUNTA: <b>oi</b>? ENTREGA: x');
  assert.equal(f.titulo, '<b>oi</b>?'); // texto puro: quem monta o HTML escapa
});
```

O valor esperado de `230.111` sai de `Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })` — se a saída real for `230 mil`, ajuste o teste para o que o `Intl` do Node devolve e não o formatador.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/ficha.test.mjs`
Expected: FAIL (`Cannot find module .../js/telas/ficha.js`)

- [ ] **Step 3: Implementar `js/telas/ficha.js`** (importa só `esc` e `hrefSeguro` de `../util.js`).
  - Rótulo: regex `/(^|[\s.;])([A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][A-ZÁÂÃÀÉÊÍÓÔÕÚÇ\/ ]{2,}[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ])(\s*\(([^)]*)\))?:\s/gu` — ao menos 4 letras, termina em dois-pontos (por isso `CFP/CRP.` e `DOI 10…` não casam).
  - `ROTULOS_RADAR = { 'PÚBLICO/SITUAÇÃO': 'Para quem', PERGUNTA: 'Pergunta', ENTREGA: 'Entrega', ORIGENS: 'Origem', DATAS: 'Datas', 'REFERÊNCIAS': 'Referências', LIMITES: 'Limites' }`; chave desconhecida → primeira letra maiúscula, resto minúsculo.
  - `fichaDoTexto`: título = PERGUNTA (primeira letra maiúscula); senão o trecho sem rótulo, inteiro se ≤ `limiteTitulo`, senão até o primeiro `.`, `?` ou `!` seguido de espaço (o resto vira seção `Resumo`). Ordem das seções: `Para quem, Referências, Limites, Origem, Datas`, depois as desconhecidas na ordem do texto; PERGUNTA e ENTREGA nunca viram seção.
  - `numerosDoTexto`: `/(\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?)\s+(impressões|visualizações|views|curtidas|comentários|reposts|compartilhamentos|salvamentos)/giu`, na ordem do texto, sem repetir rótulo.
  - `referenciasEmLista`: corta em `/\(\d+\)\s/`, apara e tira `;` final; sem numeração → `[texto]`.
  - `htmlTextoRadar`: escapa tudo; troca URLs `https?://` (sem a pontuação final `).,;`) por `<a>` quando `hrefSeguro` aceitar, senão deixa o texto escapado.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/ficha.test.mjs` → PASS; `node --test tests/` → só a falha antiga de `roteiro.test.mjs` (CRLF).

- [ ] **Step 5: Commit**

```bash
git add js/telas/ficha.js tests/ficha.test.mjs tests/index.js sw.js
git commit -m "Pautas: módulo ficha.js separa o texto do Radar pelos rótulos e tira os números da frase"
```

### Task 2: Cartão de candidato na Ficha

**Files:**
- Modify: `js/telas/pautas.js` (`cartaoCandidato`, ~linha 476)
- Modify: `css/app.css` (bloco de `.pauta.candidato`, ~linha 743)
- Test: `tests/candidatos.test.mjs` (novo teste no bloco "legibilidade")

**Interfaces:**
- Consumes: `fichaDoTexto`, `numerosDoTexto`, `referenciasEmLista`, `htmlTextoRadar` da Task 1.

- [ ] **Step 1: Teste que falha** — `test('ficha do candidato: pergunta no título, entrega à vista, números limpos, seções recolhidas')` com `aba([{ id: '2026-11-17-01', tema: 'Relacionamentos', angulo: RADAR, visualizacoes: '230.111 impressões, 929 salvamentos (X, coleta 14/11/2026)', mediana: 'N/D (sem mediana)', outlier: 'N/D' }])`, filtro `'candidatos'`. Asserts:
  - `<h2 id="cand-2026-11-17-01">Por que o medo` e o h2 sem `PÚBLICO`;
  - `<p class="subtitulo">Relacionamentos</p>` aparece **antes** do `<h2`;
  - `class="ficha-entrega"` com `Entrega` em `<b>`;
  - `class="candidato-numeros"` com `<b>230,1 mil</b> impressões` (o formato do Task 1) e sem `N/D`;
  - `<details class="ficha-secao"><summary>Referências` com `<ol` de 3 `<li>`; `<details class="ficha-secao"><summary>Limites`;
  - seção `Números e origem` com `<dt>Visualizações</dt>` (texto completo, escapado) e `<dt>Mediana</dt>`;
  - `<details><summary>Detalhes</summary>` continua no fim.
  Mais um caso: `angulo: 'Ângulo curto'`, `visualizacoes: '120000'` → h2 `Ângulo curto`, linha `120 mil visualizações · mediana …` como hoje, nenhum `ficha-secao`.

- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/candidatos.test.mjs` → FAIL no teste novo.

- [ ] **Step 3: Implementar em `cartaoCandidato`**
  - `const f = fichaDoTexto(c.angulo || '')`; título = `f.titulo || c.tema || \`Candidato ${id}\``. Subtítulo (tema) vem **antes** do h2 quando houver título próprio.
  - `f.entrega` → `<p class="ficha-entrega"><b>Entrega:</b> ${htmlTextoRadar(f.entrega)}</p>`.
  - Números: `const n = numerosDoTexto(c.visualizacoes)`. Com `n.length`: linha `candidato-numeros` com `<b>${esc(valor)}</b> ${esc(rotulo)}` unidos por ` · `, mais `@criador` se `criador` for curto (≤ 40 caracteres e sem espaço); e seção `Números e origem` com `item('Visualizações', …)`, `item('Mediana', …)`, `item('Outlier', …)`, `item('Criador', …)`. Sem `n.length`: `linhaDosNumeros(c)` como hoje.
  - Seções: cada `f.secoes` vira `<details class="ficha-secao"><summary>${esc(rotulo)}${nota ? ` <small>${esc(nota)}</small>` : ''}</summary><div class="ficha-corpo">…</div></details>`; `Referências` usa `<ol class="ficha-refs">` com `htmlTextoRadar` em cada item; as outras, `<p>${htmlTextoRadar(texto)}</p>`.
  - Ordem no cartão: topo (anel, tema, h2, selos) → entrega → números → link do post → estado → seções → rodapé `linha-id` → Detalhes → falha → ações.

- [ ] **Step 4: CSS** — junto de `.pauta.candidato h2`:
  `.ficha-entrega{margin:0;max-width:62ch;color:var(--tinta-2)}` `.ficha-entrega b{color:var(--tinta);font-weight:600}` `.candidato-numeros b{font-weight:600}`
  `.ficha-secoes{display:grid}` (envolve as seções) `.ficha-secao{border-top:1px solid var(--fio)}` `.ficha-secao summary{padding:.75rem 0;min-height:2.75rem}` (cor e peso já vêm de `.pauta details summary`) `.ficha-secao summary small{font-weight:500;color:var(--tinta-3)}` `.ficha-corpo{padding:0 0 .875rem;max-width:68ch;color:var(--tinta-2);overflow-wrap:break-word}` `.ficha-refs{margin:0;padding-left:1.25rem;display:grid;gap:.5rem}`.

- [ ] **Step 5: Rodar** — `node --test tests/` → só a falha antiga do CRLF. Os testes atuais (`subtitulo`, `≤ 2 selos`, `Detalhes`, `120 mil visualizações`, ordem dos botões) continuam passando sem edição.

- [ ] **Step 6: Commit**

```bash
git add js/telas/pautas.js css/app.css tests/candidatos.test.mjs
git commit -m "Pautas: cartão de candidato na Ficha (pergunta no título, entrega à vista, números limpos, seções recolhidas)"
```

### Task 3: Cartão de pauta na Ficha + versão

**Files:**
- Modify: `js/telas/pautas.js` (`cartao`, ~linha 159)
- Modify: `js/main.js:57`, `sw.js:15` (v20 → v21)
- Test: `tests/telas.test.mjs`

**Interfaces:**
- Consumes: `htmlTextoRadar` da Task 1; as classes `ficha-secao`, `ficha-corpo`, `ficha-secoes` da Task 2.

- [ ] **Step 1: Teste que falha** — `test('pauta na Ficha: pergunta e por que agora à vista, o resto em seções, campo vazio some')` com uma pauta `{ id_pauta: 'S47-01', titulo: 'T', pergunta_central: 'P?', por_que_agora: 'Agora', fundamentacao: 'REFERÊNCIAS: (1) a https://x.org (2) b', restricao_principal: '', publico_situacao: 'Adultos' }`, filtro `'decidir'`. Asserts: `<dt>Pergunta central</dt>` e `<dt>Por que agora</dt>` fora de `<details>`; `<details class="ficha-secao"><summary>Fundamentação` com `<a href="https://x.org"`; `summary>Público e situação`; sem `summary>Restrição principal`; `summary>Dados da pauta` com `Semana`/`Data da seleção`/`Candidato` quando presentes; sem `Mais sobre esta pauta`.

- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/telas.test.mjs` → FAIL no teste novo.

- [ ] **Step 3: Implementar em `cartao`** — o `<dl>` visível fica só com Pergunta central e Por que agora; o `<details>` "Mais sobre esta pauta" sai. No lugar, um `<div class="ficha-secoes">` com uma `ficha-secao` por campo preenchido, nesta ordem: Fundamentação, Restrição principal, Público e situação, Entrega, Sinal social, Contribuição junguiana, Ganchos opcionais (corpo `<p>${htmlTextoRadar(v)}</p>`), e por fim "Dados da pauta" (`<dl>` com `item('Semana')`, `item('Data da seleção')`, `item('Candidato')`), só se algum existir. Nenhum `<details>` vazio. Linha de prazo, decisão, notas e botões não mudam.

- [ ] **Step 4: Versão** — `js/main.js`: `'motor-app-v21'`; `sw.js`: `` `${PREFIXO}v21` ``.

- [ ] **Step 5: Rodar** — `node --test tests/` → só a falha antiga do CRLF (`sw.test.mjs` confere a versão e o `ficha.js` em `ARQUIVOS`).

- [ ] **Step 6: Conferir na tela** — `python -m http.server 8000` (ou o que o README indica em "Rodar localmente"), Pautas com login, larguras 1280, 430 e 360 px, temas noite e dia: título curto, nada cortado, seções abrem e fecham, botões iguais aos de antes. Mostrar ao Gabriel antes do push.

- [ ] **Step 7: Commit**

```bash
git add js/telas/pautas.js js/main.js sw.js tests/telas.test.mjs
git commit -m "Pautas: cartão de pauta na Ficha (pergunta e por que agora à vista, o resto em seções); v21"
```

Push na `main` só depois do Gabriel conferir.
