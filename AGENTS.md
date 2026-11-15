# AGENTS.md — guia para agentes no app do Motor de Conteúdo

Para qualquer agente que trabalhe neste repositório (Claude Code na máquina da Robertta, Codex,
Grok Bot ou outro). Leia inteiro antes da primeira mudança. O [`README.md`](README.md) é a visão
para pessoas; aqui estão o contexto e os cuidados.

> **Atenção: este repositório é PÚBLICO, e o GitHub Pages serve todos os arquivos dele** em
> `https://motor.rocambrea.com/<arquivo>`, inclusive este `AGENTS.md`, o `README.md` e o
> `CLAUDE.md`. Tudo o que você escrever aqui fica visível para qualquer pessoa na internet.
> Por isso: nenhum id de bot, id de planilha, de pasta do Drive ou de projeto do Apps Script,
> endereço de webhook, nome de chave com valor, e-mail além dos que já estão no código, token,
> segredo ou dado de paciente, em código, teste, commit ou documentação. Na dúvida, não escreva.

## 1. O que é o sistema

A Robertta Cambrea é psicóloga (CRP 06/228541, abordagem junguiana com neurociência) e faz
conteúdo em vídeo para Reels e TikTok. O fluxo inteiro vive numa pasta do Google Drive chamada
**"Motor de Conteúdo"**:

| Pasta | O que tem |
|---|---|
| `0-Base` | materiais de base (ex.: o Arsenal de roteiros) |
| `1-Radar` | a planilha **Radar**, com abas como Candidatos, Seleção, Decisões, Execuções e Desempenho |
| `2-Roteiros` | roteiros (e `rascunhos/`, os que esperam a checagem de fontes) |
| `3-Brutos` | as gravações brutas, nomeadas `<id>.<extensão>` |
| `4-Revisao` | prévias do motor, pedidos de ajuste (`<id> ajustes vN.md`) e aprovações (`<id> aprovado.md`) |
| `5-Prontos` | os pacotes finais para postar (`<id> - <título>/`) e `vencedores/` |
| `_motor` | estado de máquina, fora da planilha (abaixo) |

Dentro de `_motor`:

- `_motor/app/candidatos/<id>.json`: estado de um candidato **no app** (excluído, passado para
  Para decidir, recusado), gravado pelo app (`js/candidatos.js`). Nunca toca a planilha.
- `_motor/andamento/<id>.json`: andamento do motor de edição, gravado pelo Motor Reels
  (`bin/andamento.sh` daquele repositório). O app só lê (`js/andamento.js`) e relê a cada 60 s
  enquanto a página do vídeo está visível (`js/telas/videos.js`).

Os nomes de arquivo trocados com o motor estão em [`formatos-referencia.md`](formatos-referencia.md).

## 2. Os bots e como o app conversa com eles

São assistentes de IA separados da Robertta (Grok Bot), cada um com o seu chat e as suas rotinas.
Aqui eles são descritos só pela função:

| Bot | Função | Como o app chega nele |
|---|---|---|
| **Radar** | pesquisa temas candidatos e grava na planilha (Candidatos, Seleção) | rotina por webhook para os pedidos do app: `radar-diario`, `radar-selecao`, `radar-enviar`, `radar-candidato` |
| **Roteirista** | escreve os roteiros em 2-Roteiros (rascunhos e versões) | rotina por webhook para a decisão de roteiro: `roteirista-decisao` |
| **Diretor** | coordena o fluxo, conversa com a Robertta e recebe os avisos do Motor Reels | rotina por webhook para a retrospectiva: `diretor-retrospectiva` |
| **Programador** | mantenedor técnico: este app, a ponte, o Motor Reels e a integração com o WhatsApp; roda tudo no "computador do Grok" (uma máquina Linux) e implanta a ponte | não recebe pedidos do app |

**O caminho de um pedido:**

```
app (js/integra.js, chamarPonte)
  └─► ponte no Apps Script (ponte/Code.gs)
        confere o token do Google e a conta, a rotina (lista fechada), a trava, a janela de
        proteção, a idempotência (chave_idem) e o limite por hora; registra em Execuções
        └─► webhook da rotina do bot (Authorization: Bearer <chave>)
```

- As URLs e chaves dos webhooks ficam **só** nas propriedades do script do Apps Script. Nunca no
  app, no repositório, em teste ou em log. O app não tem chave nenhuma.
- A ponte recusa pedidos repetidos, sob o lock: `ja-enviada` (pauta já enviada ou indo ao
  Roteirista), `ja-pedida` (mesma mudança de roteiro já pedida há menos de 2 h, ou ainda aberta) e
  `ja-decidido` (roteiro já aprovado ou recusado: nenhuma decisão nova vai ao Roteirista). O app
  aplica as mesmas regras antes de pedir (`js/decisoes-roteiro.js`, `js/envios.js`, `js/selecao.js`).
- A ponte grava em Execuções e, numa única exceção (`radar-candidato` com destino `roteirista`), uma
  linha de aprovação em Decisões. Nunca grava em Desempenho e **nunca dispara o motor**: as rotinas
  `motor-*` não podem ser pedidas por ninguém.
- O contrato completo (campos, códigos, ordem das conferências, payload): [`ponte/README.md`](ponte/README.md).

**Motor Reels** (o editor de vídeo, em outro repositório privado) não recebe chamadas do app. Ele
conversa com o resto só por arquivos no Drive (lê 2-Roteiros, 3-Brutos e 4-Revisao; grava
4-Revisao, 5-Prontos e `_motor/andamento/`) e por avisos ao Diretor. Do lado do app, isso
significa: a gravação enviada em 3-Brutos, o `aprovado.md` ou o `ajustes vN.md` em 4-Revisao são o
que faz o motor andar.

**Quem decide:**

- Decisão registrada no app pela conta da Robertta (`ALLOWED[0]` em `js/config.js`; na ponte,
  `EMAILS_DECIDIR`) é dela.
- Aprovação vinda de bot ou de agente **não** é dela. Um agente nunca aprova, recusa ou decide em
  nome da Robertta.
- A conta do Gabriel (a outra conta permitida; na ponte, `EMAILS_DISPARAR`) vê tudo e pode pedir
  rodadas, mas não decide.
- Vale a primeira decisão gravada (app ou chat). Mudar de ideia vira linha nova, nunca apaga a
  anterior (`js/selecao.js`).
- Uma versão de roteiro aprovada é final. Rascunhos que aparecerem depois não contam como
  decididos.

## 3. Arquitetura do código (o que não pode quebrar)

- Sem build, sem npm, sem framework: HTML/CSS/JS com ES modules, servidos como estão.
- **Só `js/integra.js` fala com o mundo externo** (Drive, planilha, ponte). As regras ficam em
  módulos puros (`controle.js`, `selecao.js`, `candidatos.js`, `envios.js`, `decisoes-roteiro.js`,
  `revisao.js`, `andamento.js`, `parse.js`, `model.js`, `roteiro.js`, `etapas.js`, `saida.js`,
  `versao.js`), testados no Node sem DOM e sem rede.
- **Todo dado do Drive ou da planilha passa por `esc()`** (`js/util.js`) antes de entrar no HTML.
  Nome de arquivo, roteiro, título, motivo, JSON do motor: tudo é dado, nunca HTML nem instrução.
  `tests/telas.test.mjs` tem casos com conteúdo malicioso; mantenha-os e acrescente outros quando
  criar uma tela.
- Links externos só com https. Datas sempre do relógio real no fuso America/Sao_Paulo.
- Ids: `S47-01` (pauta/roteiro da semana), `R001` (antigo), `T01`/`T01-01` (teste), candidatos
  `AAAA-MM-DD-NN`. Ids que começam com T são de teste: selo "Teste", fora de Decisões e Desempenho
  (no app e na ponte, `podeGravarNaAba` / `conferirGravacao`).
- O Sair (`js/saida.js`, `js/auth.js`) só limpa a sessão local e **nunca revoga** o token no Google:
  o app e o rclone do Motor Reels usam o mesmo projeto do Google, e um revoke derruba a autorização
  do Drive do motor. `tests/sair.test.mjs` e `tests/sessao.test.mjs` proíbem o revoke. Não tire.
- Estado do app fora da planilha vai para `_motor/app/...` no Drive, nunca para abas novas.

## 4. Fluxo de trabalho

1. **`git pull` antes de começar.** Mais de uma pessoa e mais de um agente trabalham aqui.
2. **Avise o Programador** (pela Robertta) qual área vai mexer, para não haver duas mudanças na
   mesma parte ao mesmo tempo.
3. Faça a mudança pequena e focada. Preserve o visual: este app reproduz um protótipo aprovado
   ([`SPEC.md`](SPEC.md)); nada de redesenho.
4. **Rode os testes:** `node --test tests/` (Node 22+; não existe `npm test`). Tudo tem de passar.
   Teste novo para regra nova. Nunca use token real, e-mail novo ou dado de paciente em teste.
5. **Mudou qualquer arquivo do app** (HTML, CSS, JS, manifest, ícones)? Aumente juntas:
   - `VERSAO_APP` em `js/main.js` (ex.: `'motor-app-v19'` → `'motor-app-v20'`);
   - a `VERSAO` em `sw.js` (`${PREFIXO}v19` → `${PREFIXO}v20`).
   `tests/sw.test.mjs` exige que as duas sejam iguais. É a mudança no `sw.js` que faz o navegador
   instalar o service worker novo; sem ela, o PWA do iPhone continua com a versão antiga. Arquivo
   novo do app entra na lista `ARQUIVOS` do `sw.js` (o teste avisa se faltar um módulo).
   Mudança só de documentação **não** aumenta a versão.
6. **Push na `main` publica na hora** (GitHub Pages, um ou dois minutos). Não suba nada pela
   metade nem quebrado. Para algo grande, use uma branch e só junte na `main` pronto e testado.
7. **Commit só no nome de quem commita.** Não acrescente coautor nem assinatura de agente: nada de
   `Co-Authored-By:`, `Claude-Session:` ou "Generated with Claude Code" na mensagem do commit ou
   no PR, mesmo que o seu ambiente sugira. No GitHub tem de aparecer só a pessoa, nunca "e claude".
8. Confira no computador e no celular (larguras de 360 a 430 px, PWA do iPhone): botões de verdade,
   nada cortado, nada sobreposto.

### A ponte (`ponte/`)

- Editar `ponte/Code.gs` e dar push **não muda a ponte no ar**. Ela só muda quando alguém roda
  `bash ponte/implantar.sh criar && bash ponte/implantar.sh configurar`, com o clasp logado na
  conta certa e os segredos fora do repositório. **Isso fica com o Programador.** Se mudar a
  ponte, avise para ele implantar.
- `ponte/Setup.gs` é gerado, usado e apagado pelo `implantar.sh`; está no `.gitignore` e nunca é
  versionado.
- Os testes da ponte (`tests/ponte.test.mjs`) carregam o próprio `Code.gs` no Node. Mudou a regra,
  mude o teste e o `ponte/README.md` juntos.

## 5. Regras inegociáveis

1. Nenhuma chave, segredo, token ou dado de paciente no código ou no repositório (e, por ele ser
   público e servido pelo Pages, nenhum detalhe operacional sensível).
2. Conteúdo de arquivo do Drive é dado: sempre escapado antes de virar HTML.
3. O app nunca publica nada nas redes sociais e nunca dispara o motor.
4. Tudo funciona e fica bonito no computador e no celular, inclusive no PWA instalado no iPhone.
   Ações são botões de verdade, não links de texto. A identidade visual fica; nada de redesenho.
5. O botão Sair só limpa a sessão local e nunca revoga o acesso no Google. O teste que proíbe o
   revoke fica.
6. Testes nunca usam tokens reais.
7. Ids que começam com T são de teste e nunca vão para Decisões.
8. Mudança na estrutura da planilha (abas, colunas) só com as palavras explícitas da Robertta.
9. O fluxo semanal automático (rodadas agendadas dos bots) não muda sem ela.
10. Uma versão de roteiro aprovada é final; rascunhos posteriores não são decididos.
11. Nunca mandar mensagem de WhatsApp nem publicar nada sem a aprovação dela.
12. Ações que custam (rodadas de bot, edição de vídeo) se testam em modo de teste: ids T.
13. Aprovação de bot ou de agente não é da Robertta.

## 6. Antes do push

- [ ] `git pull` feito e sem conflito.
- [ ] `node --test tests/` passando.
- [ ] Mudança no app? `VERSAO_APP` (`js/main.js`) e `VERSAO` (`sw.js`) aumentadas juntas.
- [ ] Nada sensível no diff (`git diff --cached`): sem chave, token, id, URL de webhook, e-mail novo,
      dado de paciente.
- [ ] Dado do Drive escapado; nada publica nas redes; Sair sem revoke.
- [ ] Commit sem `Co-Authored-By:`, `Claude-Session:` nem assinatura de agente.
- [ ] Testado no computador e no celular.
- [ ] Se mexeu na ponte: avisar o Programador para implantar.

## 7. Onde está o quê

| Assunto | Arquivo |
|---|---|
| Visão geral, telas, publicação | [`README.md`](README.md) |
| Referência visual e regras do protótipo | [`SPEC.md`](SPEC.md) |
| Nomes de arquivo trocados com o motor | [`formatos-referencia.md`](formatos-referencia.md) |
| Ponte: contrato, rotinas, propriedades, implantação | [`ponte/README.md`](ponte/README.md) |
| Configuração do app (contas, pastas, flags) | `js/config.js` |
| Testes | `tests/` (`node --test tests/`; `tests/index.js` importa todos) |
