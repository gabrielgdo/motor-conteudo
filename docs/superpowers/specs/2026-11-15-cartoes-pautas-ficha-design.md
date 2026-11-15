# Cartões de Pautas no formato Ficha (opção A)

## Por quê

Na aba Pautas, os cartões estão difíceis de ler. No candidato, a coluna `angulo` vira o título,
mas o Radar escreve nela o resumo inteiro (PÚBLICO/SITUAÇÃO, PERGUNTA, ENTREGA, ORIGENS, DATAS,
REFERÊNCIAS, LIMITES): 40 linhas em serifa grande. A coluna `visualizacoes` vem como frase longa e
aparece crua. O objetivo é decidir mais rápido e com menos esforço, no computador e no celular.

## Abordagens consideradas

- **A · Ficha (escolhida pelo Gabriel):** o cartão de hoje arrumado. Título curto, entrega em
  poucas linhas, números em destaque, o resto em seções que abrem com um toque.
- B · Lista e painel: linhas curtas e detalhe ao lado. Boa no computador, muda a navegação.
- C · Triagem: três blocos fixos (por que agora, entrega, cuidado). Mais nova visualmente.

## Objetivos

- Candidato: título = a PERGUNTA do texto do Radar; tema como linha pequena acima; ENTREGA visível;
  números legíveis; Para quem, Referências, Limites e Origem e datas em seções recolhidas.
- Pautas (Para decidir, Decididas, Todas): mesmo esqueleto. Título, pergunta central e por que
  agora visíveis; Fundamentação, Restrição principal, Público e situação, Entrega, Sinal social,
  Contribuição junguiana, Ganchos e os dados (semana, data, candidato) em seções recolhidas.
- Texto longo de qualquer campo com rótulos em MAIÚSCULAS vira parágrafos com o rótulo em negrito,
  em vez de um bloco corrido.

## Não objetivos / proibido agora

- Nada de arquitetura, backend, ponte, chamadas, colunas novas ou mudança no que o Radar escreve.
  Só a forma de mostrar o que o app já lê.
- Nada de mudar os botões, as regras de quem decide, os estados ou os textos de estado.
- Nada de elementos visuais novos fora do sistema do app: usa `.painel`, `.selo`, `.botao`,
  `.pauta`, o `details` já usado em "Mais sobre esta pauta", as mesmas medidas em rem e a mesma
  densidade (80% no computador). Os números ficam na linha `.candidato-numeros` de hoje, com o
  valor em negrito, sem os ladrilhos do esboço.

## Como

- Módulo puro novo `js/telas/ficha.js` (testado no Node, sem DOM):
  - `separarTextoRadar(texto)` → `{ partes: [{rotulo, texto}], resto }`, cortando nos rótulos em
    MAIÚSCULAS seguidos de dois-pontos (aceita parênteses no rótulo, como
    "REFERÊNCIAS (consultado só o resumo…)"). Sem rótulos: uma parte só, sem rótulo.
  - `tituloDoCandidato(c)`: PERGUNTA, se houver; senão o `angulo` de hoje; se passar de ~160
    caracteres, a primeira frase e o resto vai para uma seção "Resumo".
  - `numerosDoTexto(texto)`: tira "230.111 impressões", "16.000 curtidas", "929 salvamentos"…
    (impressões, visualizações/views, curtidas, comentários, reposts, compartilhamentos,
    salvamentos) e formata compacto ("230 mil"). Se não achar nada, usa `linhaDosNumeros` de hoje.
    A frase completa vai para a seção Origem e datas.
  - Referências numeradas "(1) … (2) …" viram lista. Links só https (http aparece como texto).
- `cartaoCandidato` e `cartao` em `js/telas/pautas.js` passam a montar a Ficha com essas funções.
  Tudo que vem da planilha passa por `esc()`; os testes de conteúdo malicioso continuam e ganham
  casos com rótulos e links maliciosos.
- CSS em `css/app.css`, seção de Pautas: só ajustes nas classes existentes (lista de seções
  recolhidas com fio entre elas, rótulo em negrito nos parágrafos). Celular de 360 a 430 px.
- `VERSAO_APP` e `VERSAO` sobem juntas; `js/telas/ficha.js` entra em `ARQUIVOS` do `sw.js`.

## Fica com quem constrói

- O nome exato das seções e a ordem, dentro do que está acima.
- O limite de caracteres para o título longo.
