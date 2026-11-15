# Ponte do Motor de Conteúdo (Google Apps Script)

A ponte é um app da Web no Google Apps Script (item **CM-05** do plano de controle manual). O app
não guarda nenhuma chave, então os disparos manuais passam por ela. A cada pedido, a ponte:

1. confere quem pediu, pelo token do Google;
2. confere se essa conta pode fazer o pedido e se a rotina está na lista fechada;
3. aplica a trava, a janela de proteção, a idempotência e o limite por hora;
4. registra o pedido na aba **Execuções** da planilha Radar (e, só em `radar-candidato` com destino `roteirista`, a aprovação em **Decisões**);
5. repassa o pedido ao webhook do bot.

A ponte grava em Execuções e, numa única exceção, em Decisões: o pedido `radar-candidato` com destino `roteirista` grava **uma** linha de aprovação por candidato (nunca de id T). Ela **nunca** grava em Desempenho e **nunca** dispara o motor.

| Arquivo | O que é |
|---|---|
| `Code.gs` | O script inteiro. A **parte A** é a lógica pura (testada no Node). A **parte B** é a camada fina de serviços do Apps Script e os pontos de entrada `doPost`, `doGet` e `configurar` |
| `appsscript.json` | Manifesto: fuso de São Paulo, V8, app da Web e escopos mínimos |
| `../tests/ponte.test.mjs` | Testes com `node:test`. Carregam o próprio `Code.gs` com `node:vm` e simulam os serviços do Apps Script |

---

## Contrato

### Pedido

`POST` no endereço do app da Web, com `Content-Type: text/plain` e corpo JSON. O `text/plain` evita
a pré-verificação de CORS. É exatamente o que `chamarPonte` em `js/integra.js` envia.

| Campo | Tipo | Regra |
|---|---|---|
| `acao` | texto | `disparar` ou `decidir-roteiro` |
| `rotina` | texto | Uma das rotinas da lista fechada (abaixo). Em `decidir-roteiro`, só `roteirista-decisao` (ou vazio) |
| `id_alvo` | texto | Vazio, ou um id que passa em `idValido`: `S47-01`, `T01`, `T01-01`, `R001`. Obrigatório para `roteirista-decisao`. Em `radar-candidato`, o id do candidato (`AAAA-MM-DD-NN`, ex.: `2026-11-14-01`), obrigatório |
| `id_lote` | texto | Vazio, ou `^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$` (ex.: `S47-manual-2`) |
| `chave_idem` | texto | Obrigatória, `^[A-Za-z0-9_-]{8,80}$`. O app manda um UUID criado quando a janela de confirmação abre |
| `dados` | objeto | Objeto plano com até 30 itens. Chaves `^[a-z][a-z0-9_]{0,39}$`; valores texto (até 4000), número ou booleano |
| `access_token` | texto | Token de acesso do Google da sessão do app |

Qualquer campo fora dessa lista é recusado com `pedido-invalido`. O corpo vai até 20 000 caracteres.

**Campos de `dados` que a ponte usa e não repassa ao bot:**
- `marcar_travada: true` e `id_execucao_travada` ("Marcar como travada e rodar de novo"; vêm de `acoes.js`, `rodar-confirmar`).

**`radar-diario`:** `dados.quantidade` é opcional. Se vier, é um inteiro de 1 a 15 (número, ou texto só com dígitos); fora disso, `quantidade-invalida` e nada é gravado. Vai ao bot sempre como número. O app manda 5 por padrão; as rodadas agendadas não mudam.

**`radar-candidato`** (só `EMAILS_DECIDIR`): em `dados` só valem `id_candidato`, `destino` e `motivo` (mais os dois campos de trava). Outro campo: `pedido-invalido`.
- `id_candidato` igual a `id_alvo`, no formato de candidato; com `T` na frente: `teste-recusado`.
- `destino` é `decidir` ou `roteirista` (senão `destino-invalido`).
- `motivo` opcional: texto, numa linha só, até 300 caracteres. Vazio não vai ao bot.
- Grupo de trava `radar-candidato|<id>`: um candidato não trava o outro, e o mesmo candidato não é pedido de novo enquanto houver linha aberta. O app manda uma `chave_idem` estável (`radar-candidato-<id>-<destino>-<n>`, com n = 1 + as linhas dele em Execuções).
- Destino `roteirista`: sob o lock, a ponte abre `ABA_DECISOES` (padrão `Decisões`) e exige as 11 colunas (as 4 antigas e `id_pauta, rede, id_candidato, id_lote, data, quem, origem`). Sem elas, ou sem a aba: `decisoes-sem-colunas`, **antes** de gravar qualquer coisa. Se já existe uma linha aprovada com o mesmo `id_candidato`, não grava outra (a resposta traz `decisao: 'ja-existia'`). Senão grava uma linha pelo cabeçalho (resposta com `decisao: 'gravada'`):
  - `semana` "S47" e `data` "AAAA-MM-DD HH:MM" (São Paulo, como o app);
  - `pauta` = ângulo (ou tema) do candidato na `ABA_CANDIDATOS` (padrão `Candidatos`), ou o id;
  - `decisao` `aprovada`, `motivo`, `id_candidato`, `id_lote` do pedido, `quem` (e-mail validado), `origem` `manual-app`;
  - `id_pauta` e `rede` vazios (a pauta ainda não existe).
- A linha de Decisões é gravada **antes** do webhook. Se a escrita falhar: `decisoes-falhou`, a linha de Execuções fecha com `erro` e o webhook **não** é chamado.

**`decidir-roteiro`:** em `dados` só valem `id`, `versao`, `decisao`, `pedido` e `motivo` (mais os dois campos de trava acima).
- `dados.id` precisa ser igual a `id_alvo`.
- `versao` é um inteiro ≥ 1.
- `decisao` é `aprovar`, `mudar` ou `recusar`.
- `mudar` exige `pedido`.
- Em `recusar`, se vier um `motivo`, ele começa por um da lista (tom, clareza, fundamentação, ética, desalinhamento). Pode vir sem acento.
- O `motivo` vai ao bot como o app mandou (ex.: `"clareza: confuso no meio"`); só o `resumo` de Execuções usa a palavra da lista.

### Ação `configurar` (configuração inicial, só com `Setup.gs`)

Ela só existe quando o arquivo `ponte/Setup.gs` está no projeto. Esse arquivo **não é versionado** (está no `.gitignore`): o script de implantação o gera, usa e apaga. Ele só define:

```js
const PONTE_SETUP_HASH = '<sha256 hex de um código aleatório de uso único>';
```

Corpo: `{"acao": "configurar", "codigo": "<o código>", "propriedades": {...}}`, sem `access_token`: o código de uso único é a autenticação.
- Sem `Setup.gs` (ou com um hash mal formado), a resposta é a mesma de uma ação desconhecida.
- `sha256(codigo)` é comparado com `PONTE_SETUP_HASH` em tempo constante. Errado: `configuracao-recusada`.
- Só valem as propriedades da lista fechada: `PLANILHA_ID`, `CLIENT_ID`, `EMAILS_DISPARAR`, `EMAILS_DECIDIR`, `ABA_EXECUCOES`, `ABA_DECISOES`, `ABA_CANDIDATOS`, `LIMITE_POR_HORA`, `WEBHOOK_RADAR_URL`, `WEBHOOK_RADAR_KEY`, `WEBHOOK_ROTEIRISTA_URL`, `WEBHOOK_ROTEIRISTA_KEY`, `WEBHOOK_DIRETOR_URL`, `WEBHOOK_DIRETOR_KEY`. Os valores são texto de até 2000 caracteres, e as `*_URL` precisam ser https. Qualquer coisa fora disso é `pedido-invalido`, e nada é gravado.
- A gravação é `setProperties(obj, false)`, que não apaga as outras propriedades.
- A resposta é `{ok:true, gravadas:[nomes]}`, **nunca** com valores. Nada disso vai para log.

### Resposta

A resposta é sempre JSON (`ContentService`, `MimeType.JSON`, HTTP 200).

| Situação | Corpo |
|---|---|
| Pedido registrado e entregue ao bot | `{ok:true, id_execucao, status:'pedido', rotina, teste}` |
| `chave_idem` repetida | `{ok:true, repetido:true, id_execucao, status}`. Não dispara de novo |
| Recusa ou falha | `{ok:false, codigo, mensagem, ...}` |

Alguns códigos trazem campos extras:
- `rodando`: `desde`, `origem`;
- `parece-travada`: `id_execucao_travada`, `desde`;
- `protecao`: `ate`;
- `webhook-*` e `repetido-com-erro`: `id_execucao`, `status`.

`chamarPonte` mostra `mensagem` e usa `codigo`. As mensagens são curtas e em português.

### Códigos

| `codigo` | Quando |
|---|---|
| `pedido-invalido` | Corpo vazio, não é JSON, tem campo desconhecido, tipo errado, `dados` fora do formato, é grande demais, a ação é desconhecida, ou a chave já foi usada em outra rotina |
| `sem-chave` | Falta a `chave_idem` (o mesmo código do app) |
| `token-invalido` | O Google recusou o token; ou `aud`/`azp` ≠ CLIENT_ID, token vencido, sem escopo de e-mail, ou e-mail não verificado |
| `verificacao-indisponivel` | O Google não respondeu (rede ou 5xx) |
| `ponte-sem-configuracao` | Falta `CLIENT_ID` ou `PLANILHA_ID` |
| `sem-permissao` | O e-mail não está na lista, ou a ação é só de quem decide |
| `rotina-desconhecida` | A rotina está fora da lista, é `motor-*`, ou foi pedida pela ação errada |
| `id-invalido` | `id_alvo` inválido ou ausente quando é obrigatório; `dados.id` ≠ `id_alvo`; ou `dados.ids` inválido |
| `versao-invalida`, `decisao-invalida`, `falta-pedido`, `motivo-invalido` | Validação de `decidir-roteiro` (os três primeiros são os mesmos do app) |
| `ocupado` | Não conseguiu o lock em 10 s |
| `planilha-sem-execucoes` | Faltam colunas essenciais na aba (se ela não existe, a ponte a cria). A mensagem lista os cabeçalhos esperados |
| `configuracao-recusada` | Ação `configurar` com código de uso único errado |
| `rodando` | Há linha `pedido` ou `rodando` do mesmo grupo com menos de 2 h. Ex.: "Rodando desde 9h10 (agendada)." |
| `parece-travada` | A linha aberta tem 2 h ou mais (ou não tem início), e o pedido não veio com `marcar_travada` e o id certo |
| `protecao` | Está na janela de proteção de uma rodada agendada |
| `limite` | Passou do limite de disparos manuais desta rotina na última hora |
| `webhook-nao-configurado` | O pedido foi registrado, mas não há webhook válido. A linha vira `erro` |
| `webhook-falhou` | O webhook não deu 2xx em 2 tentativas. A linha vira `erro` |
| `repetido-com-erro` | A `chave_idem` repetida é de um pedido que terminou em `erro` (é preciso uma chave nova) |
| `teste-recusado`, `aba-nao-permitida` | Guardas de gravação (ver "Ids T"). `teste-recusado` também vale para candidato T em `radar-candidato` |
| `quantidade-invalida` | `radar-diario` com `dados.quantidade` fora de 1..15 ou não inteiro |
| `destino-invalido` | `radar-candidato` com `destino` fora de `decidir` / `roteirista` |
| `decisoes-sem-colunas` | `radar-candidato` → Roteirista sem a aba Decisões ou sem as colunas novas. Nada foi gravado nem repassado |
| `decisoes-falhou` | `radar-candidato` → Roteirista: a escrita em Decisões falhou. A linha de Execuções vira `erro`; nada foi repassado |
| `erro-interno` | Exceção inesperada. Nada de detalhe na resposta; o log fica sem segredos |

### Ordem das conferências

1. Corpo e campos.
2. Token no Google. O token é tirado do pedido logo depois de lido.
3. Permissão.
4. Rotina, ids e decisão.
5. Sob `LockService.getScriptLock()`:
   1. `chave_idem`;
   2. trava;
   3. janela de proteção;
   4. limite por hora;
   5. só em `radar-candidato` → Roteirista: confere Decisões (aba e colunas) e se o candidato já está aprovado;
   6. grava em Execuções e, se for o caso, a aprovação em Decisões.
6. Solta o lock. Se a escrita em Decisões falhou, fecha a linha com `erro` e para aqui. Senão, chama o webhook.
7. Se o webhook falhar, pega o lock de novo e muda a linha para `erro`.

---

## Rotinas (lista fechada, espelho de `js/controle.js`)

| Rotina | Bot | Ação | Grupo de trava | Agenda (São Paulo) | Quem pode |
|---|---|---|---|---|---|
| `radar-diario` | radar | disparar | `radar` | todo dia 7:00 | disparar |
| `radar-selecao` | radar | disparar | `radar` | domingo 9:00 | disparar |
| `radar-enviar` | radar | disparar | `radar` | — | **só decidir** (é "enviar adiante", PLANO 13) |
| `radar-candidato` | radar | disparar | `radar-candidato\|<id do candidato>` | — | **só decidir** |
| `roteirista-decisao` | roteirista | decidir-roteiro | `roteirista\|<id>` | — | **só decidir** |
| `diretor-retrospectiva` | diretor | disparar | `diretor\|retrospectiva` | segunda 8:00 | disparar |
| `motor-*` | motor | — | — | — | **ninguém**: o app nunca dispara o motor |

**Trava:** uma linha `pedido` ou `rodando` do mesmo grupo segura o grupo inteiro.
- Com menos de 2 h, a ponte recusa com `rodando`.
- Com 2 h ou mais, ou sem início, recusa com `parece-travada`. A exceção é o pedido que vem com `dados.marcar_travada === true` e `dados.id_execucao_travada` igual ao id da linha aberta **mais nova** do grupo (a mesma que o app mostra). Nesse caso, as linhas abertas do grupo passam para `travada` e a ponte segue.
  - Nada é apagado. Na linha antiga, a coluna `erro` só é preenchida se estiver vazia: "marcada como travada pelo app (EX-…)".
- Linhas do Radar com uma rotina que a ponte não conhece também contam no grupo `radar`, porque o navegador é um só.

**Janela de proteção:** é a mesma regra de `avaliarProtecao`. O disparo manual fica fechado de 60 min antes do horário agendado até a linha agendada daquele horário fechar (`ok`, `parcial`, `erro` ou `travada`). Se não houver linha agendada, fica fechado até 2 h depois do horário.
- No grupo `radar`, vale para as três rotinas do Radar, perto das 7h todo dia e de domingo 9h.
- Exemplo: às 6h30, `radar-diario` e `radar-enviar` são recusados.

**Limite:** no máximo `LIMITE_POR_HORA` disparos manuais (padrão 4; `radar-candidato`: 15, um por candidato escolhido) por rotina, contando as linhas `manual-app` da rotina na última hora, de qualquer status.

**Rodada agendada nunca é bloqueada.** Na lógica pura, `avaliarTrava` e `avaliarProtecao` aceitam `{origem:'agendada'}` e liberam. Mas o `doPost` **não tem** caminho de origem agendada: o pedido não pode escolher a `origem`, e toda linha que a ponte grava é `manual-app`. As rodadas agendadas só registram em Execuções, direto pelos bots, e não passam pela ponte.

---

## Propriedades do script

Ficam em *Configurações do projeto → Propriedades do script*. **Nenhum valor vai para o repositório.**

| Propriedade | Obrigatória | Descrição |
|---|---|---|
| `CLIENT_ID` | sim | O client_id OAuth do app. É o mesmo de `CLIENT_ID` em `js/config.js` (público por natureza), algo como `262963421281-….apps.googleusercontent.com` |
| `PLANILHA_ID` | sim | Id da planilha Radar (o de `RADAR_SHEET` em `js/config.js`) |
| `ABA_EXECUCOES` | não | Nome da aba (padrão `Execuções`) |
| `ABA_DECISOES` | não | Nome da aba Decisões (padrão `Decisões`), só para `radar-candidato` → Roteirista |
| `ABA_CANDIDATOS` | não | Nome da aba Candidatos (padrão `Candidatos`), lida só para o título da linha de Decisões |
| `EMAILS_DECIDIR` | sim | E-mails que decidem, separados por vírgula (a conta da Robertta). Também podem disparar |
| `EMAILS_DISPARAR` | não | E-mails que **só** disparam (a conta do Gabriel). Vazio: só quem está em `EMAILS_DECIDIR` dispara |
| `LIMITE_POR_HORA` | não | Disparos manuais por rotina por hora (padrão 4; `0` fecha tudo) |
| `LIMITE_POR_HORA_<ROTINA>` | não | Limite de uma rotina, que vence o geral. Ex.: `LIMITE_POR_HORA_ROTEIRISTA_DECISAO` |
| `WEBHOOK_RADAR_URL` / `WEBHOOK_RADAR_KEY` | por bot | Webhook do Radar: `radar-diario`, `radar-selecao`, `radar-enviar` e `radar-candidato` |
| `WEBHOOK_ROTEIRISTA_URL` / `WEBHOOK_ROTEIRISTA_KEY` | por bot | Webhook do Roteirista: `roteirista-decisao` |
| `WEBHOOK_DIRETOR_URL` / `WEBHOOK_DIRETOR_KEY` | por bot | Webhook do Diretor: `diretor-retrospectiva` |

As listas de e-mail são comparadas em minúsculas. Uma lista vazia é ninguém: a ponte falha fechada.

**Webhooks:** são só três, um por bot. A `*_KEY` vai como `Authorization: Bearer <KEY>`. A `*_URL` precisa ser `https://`. Sem a chave, ou sem https, o webhook conta como "não configurado".

**Como preencher sem mostrar os segredos:** pela ação `configurar`, com `Setup.gs` (seção "Ação `configurar`"), ou à mão no editor.

**Conferir:** rode a função `configurar()` no editor. Ela só valida e imprime o que falta, sem nenhum valor: nem URL, nem chave, nem e-mail. Os e-mails aparecem só como contagem.

---

## Aba Execuções

Uma linha de cabeçalho (entre as 10 primeiras), com estas 16 colunas, na ordem de `COLUNAS_EXECUCOES`:

```
id_execucao | chave_idem | bot | rotina | origem | quem | id_alvo | id_lote | etapa_evento | inicio | fim | status | resumo | erro | link | teste
```

**A ponte cria a aba.** Se a aba (`ABA_EXECUCOES`, padrão `Execuções`) não existir, a ponte a cria sob o lock, escreve este cabeçalho na linha 1 e congela a linha 1. Se a aba existir e estiver vazia, a ponte escreve o cabeçalho.

**O que a ponte aceita no cabeçalho:**
- outra ordem, maiúsculas, acentos e espaços ("ID Execução");
- os sinônimos do app: `quem_disparou`→`quem`, `gatilho`→`origem`, `quando`→`inicio`, `resultado`→`status`, `detalhe`→`resumo`, `id`→`id_alvo`, `evento`/`etapa`→`etapa_evento`;
- colunas a mais, que ficam vazias.

**Colunas essenciais** (sem elas: `planilha-sem-execucoes`): `id_execucao`, `chave_idem`, `bot`, `rotina`, `origem`, `quem`, `id_alvo`, `inicio`, `status`, `teste`. As outras são opcionais; se faltarem, o valor delas não é gravado.

**Linha que a ponte grava:**

| Coluna | Valor |
|---|---|
| `id_execucao` | `EX-AAAAMMDD-HHMMSS-xxxx` (hora de São Paulo, igual a `novoIdExecucao`) |
| `chave_idem` | A do app |
| `bot`, `rotina` | Do catálogo |
| `origem` | `manual-app` |
| `quem` | O e-mail validado no Google |
| `id_alvo`, `id_lote` | Os do pedido |
| `etapa_evento`, `fim`, `erro`, `link` | Vazios |
| `inicio` | `AAAA-MM-DD HH:MM:SS` (São Paulo; `lerDataHora` do app lê) |
| `status` | `pedido` |
| `resumo` | Decisão de roteiro: `aprovar v2`, `mudar v3`, `recusar v1 (tom)`. Enviar: `enviar S47-01, S47-02`. Rodar de novo: `rodar de novo; EX-… marcada como travada` |
| `teste` | `sim` para id T, senão `não` |

Todo texto é gravado com um apóstrofo na frente. A planilha guarda o valor como **texto puro**: o apóstrofo não aparece, e nada vira fórmula (`=`, `+`, `-`, `@`), número ou data com formato do local. A linha respeita a ordem real das colunas da aba.

**Ids T:** podem ser disparados, e vão para Execuções com `teste = sim`.
- A guarda `abaGravavelPelaPonte` aceita Execuções sempre, e Decisões **só** com `{rotina: 'radar-candidato', destino: 'roteirista'}`. Qualquer outra aba é recusada.
- A guarda `podeGravarNaAba(aba, id)` recusa ids T (qualquer id que começa com T, de roteiro ou de candidato) em Decisões e Desempenho.
- Toda escrita passa por `conferirGravacao`, que junta as duas guardas. Qualquer gravação futura nessas abas teria de passar por ela também.

---

## Payload enviado ao webhook

`POST` no `WEBHOOK_<BOT>_URL`, com `Content-Type: application/json` e `Authorization: Bearer <WEBHOOK_<BOT>_KEY>`, com `muteHttpExceptions`. São até 2 tentativas: a segunda só acontece em falha de rede, 429 ou 5xx.

O corpo tem **exatamente** estes campos, nesta ordem: `rotina`, `id_execucao`, `chave_idem`, `origem` (sempre `"manual-app"`), `quem`, `id_alvo`, `id_lote`, `dados`. Nada além disso. `dados` são os dados validados do app, sem `marcar_travada` e `id_execucao_travada`.

**Radar** (`WEBHOOK_RADAR_URL`):
- `radar-diario` leva `{quantidade}` (inteiro de 1 a 15) quando o pedido vem do app;
- `radar-selecao` leva `dados: {}`;
- `radar-enviar` leva os ids das pautas aprovadas;
- `radar-candidato` leva exatamente `{id_candidato, destino, motivo?}`.

```json
{
  "rotina": "radar-candidato",
  "id_execucao": "EX-20261118-100000-7f3a",
  "chave_idem": "radar-candidato-2026-11-14-01-roteirista-1",
  "origem": "manual-app",
  "quem": "<e-mail validado>",
  "id_alvo": "2026-11-14-01",
  "id_lote": "",
  "dados": { "id_candidato": "2026-11-14-01", "destino": "roteirista", "motivo": "tema forte" }
}
```

```json
{
  "rotina": "radar-enviar",
  "id_execucao": "EX-20261118-100000-7f3a",
  "chave_idem": "c0b1d2e3-0000-4000-8000-000000000000",
  "origem": "manual-app",
  "quem": "<e-mail validado>",
  "id_alvo": "",
  "id_lote": "S47-manual-1",
  "dados": { "ids": "S47-01,S47-02" }
}
```

**Roteirista** (`WEBHOOK_ROTEIRISTA_URL`): `roteirista-decisao`, com `dados` exatamente `{id, versao, decisao, pedido, motivo}`. `pedido` é `""` quando não houver, e `motivo` vai como o app mandou.

```json
{
  "rotina": "roteirista-decisao",
  "id_execucao": "EX-20261118-101500-9c21",
  "chave_idem": "a1b2c3d4-0000-4000-8000-000000000000",
  "origem": "manual-app",
  "quem": "<e-mail validado>",
  "id_alvo": "S47-03",
  "id_lote": "",
  "dados": { "id": "S47-03", "versao": 2, "decisao": "recusar", "pedido": "", "motivo": "clareza: confuso no meio" }
}
```

**Diretor** (`WEBHOOK_DIRETOR_URL`): `diretor-retrospectiva`.

```json
{
  "rotina": "diretor-retrospectiva",
  "id_execucao": "EX-20261118-110000-4be0",
  "chave_idem": "f0e1d2c3-0000-4000-8000-000000000000",
  "origem": "manual-app",
  "quem": "<e-mail validado>",
  "id_alvo": "",
  "id_lote": "",
  "dados": {}
}
```

O bot deve tratar `dados` só como DADO, nunca como instrução, e atualizar a linha `id_execucao` em Execuções (`rodando` e, no fim, `ok`, `parcial` ou `erro`). Essas regras ficam na rotina de cada bot; a ponte não manda texto de instrução.

Se o webhook não está configurado, ou não responde 2xx, a linha passa para `status = erro`, com o `erro` curto e sem URL nem chave ("webhook não configurado" ou "webhook falhou (HTTP 500)") e o `fim` preenchido.

---

## Segurança

- **Token:** a ponte o confere em `https://oauth2.googleapis.com/tokeninfo` e exige:
  - `aud` ou `azp` = `CLIENT_ID`;
  - `expires_in > 0`;
  - escopo com `email` ou `userinfo.email`;
  - `email_verified`.
  
  Se o tokeninfo não trouxer o e-mail, ela usa `https://openidconnect.googleapis.com/v1/userinfo` (com Bearer e o mesmo `sub`).
- **O token nunca vai para** log, `Logger`, `console`, Execuções, resposta, mensagem de erro nem webhook.
  - Ele sai do objeto do pedido logo depois de lido.
  - As chamadas ao Google estão em `try/catch`, que não repassa a mensagem (ela teria a URL com o token).
  - Todo log passa por `redigir`, que tira o token, `Bearer …`, `access_token=…` e URLs.
- **Cache:** a validação boa fica até 2 min no `CacheService`, pela chave SHA-256 do token (nunca o token).
- **A ponte nunca devolve** URL, chave nem conteúdo de propriedades. O `configurar()` também não imprime valores.
- **O texto livre** (pedido, motivo, observação) vai ao bot só dentro de `dados`.
- **`configurar`:** só existe com `Setup.gs` (não versionado, apagado depois do uso). O código de uso único é conferido pelo hash, em tempo constante, e nenhum valor vai para a resposta ou para o log.

---

## Como implantar

### Pelo `implantar.sh` (clasp, mais rápido)

Pré-requisitos, só a Robertta: ativar a Apps Script API em https://script.google.com/home/usersettings e fazer `clasp login --no-localhost` com a conta dela (o navegador termina numa página `localhost:8888` que não abre; basta copiar a URL dela de volta para o terminal).

1. `ponte/implantar.sh criar`: cria o projeto standalone, gera `Setup.gs` (só o hash de um código de uso único, fora do repo), envia os arquivos e cria a implantação de app da Web (executar como a conta que implanta, acesso "Qualquer pessoa", pelo `appsscript.json`). Imprime o link do editor e a URL `/exec`.
2. A Robertta abre o editor, escolhe a função `autorizar` e clica em Executar, aceitando os escopos (passo que só a dona da conta pode fazer).
3. `ponte/implantar.sh configurar`: lê `~/.config/motor-pwa/webhooks.env` e `js/config.js` dentro do node (nada é impresso), grava as 12 propriedades pela ação `configurar`, apaga `Setup.gs` e o código, reenvia e atualiza a **mesma** implantação (a URL não muda). Só os nomes das propriedades gravadas aparecem.
4. `PONTE_URL` = URL `/exec` e `FLAGS.ponte = true` em `js/config.js`.

### Pelo navegador

1. Crie um projeto no [script.google.com](https://script.google.com) com a conta dona da planilha Radar.
2. Copie `Code.gs`. Em *Configurações do projeto*, marque "Mostrar o arquivo de manifesto `appsscript.json`" no editor e cole o `appsscript.json` daqui.
3. Rode `autorizar()` uma vez no editor, para dar o consentimento dos escopos (planilhas e chamadas externas). Ela não muda nada: só abre a planilha (se `PLANILHA_ID` já existir) e faz um GET em `https://www.google.com`.
4. Preencha as **Propriedades do script**: à mão, ou pela ação `configurar` (o script de implantação gera `Setup.gs`, implanta, manda o `POST` com o código de uso único, e depois apaga `Setup.gs` e reimplanta).
5. A aba **Execuções** pode ser criada antes (CM-01); se não existir, a ponte a cria no primeiro pedido.
6. Rode `configurar()` no editor para ver o que falta (sem valores).
7. Abra *Implantar → Nova implantação → App da Web*:
   - **Executar como:** Eu (a conta que implanta);
   - **Quem pode acessar:** Qualquer pessoa.
8. Copie o endereço `https://script.google.com/macros/s/…/exec`.

**Por que "Qualquer pessoa" é seguro aqui:**
- O app chama a ponte com `fetch` sem cookies de login (`credentials: 'omit'`). Por isso, o acesso "só usuários do Google" não funcionaria.
- A autenticação acontece **dentro** da ponte, a cada pedido: o token é conferido no próprio Google (precisa ter sido emitido para o client_id do app, com o e-mail verificado), e o e-mail tem de estar nas listas.
- Sem um token válido de uma conta da lista, a ponte só responde `doGet` (saúde, sem dados) ou uma recusa.
- A ponte nunca devolve dados da planilha.

**Para atualizar:** em *Gerenciar implantações → editar → Nova versão*, o endereço continua o mesmo.

---

## Como ligar no app (só anotar; não muda nada agora)

Em `js/config.js`:
- `PONTE_URL = 'https://script.google.com/macros/s/…/exec'`;
- `FLAGS.ponte = true`.

Com isso, `Integra.ponte.disparar` e `Integra.ponte.decidirRoteiro` passam a chamar a ponte. Depois, suba a versão do service worker (`sw.js` / `main.js`), como em toda fase.

---

## O que o app precisa mudar

Nada é obrigatório para funcionar. O contrato atual (`chamarPonte`, `disparar`, `decidirRoteiro`, `marcar_travada`) é aceito como está, e há um teste de contrato. São ajustes recomendados:

1. **Chave nova depois de falha da ponte.** Hoje a `chave_idem` vale até a janela fechar. Se a ponte responder `webhook-falhou` ou `webhook-nao-configurado` e a Robertta tocar de novo em confirmar com a mesma chave, a ponte responde `repetido-com-erro` ("Feche a janela e peça de novo"). Isso evita um "ok" falso. Melhor: em `acoes.js` (`rodar-confirmar`), gerar uma `novaChaveIdem()` quando o erro tiver um desses códigos.
2. **"Marcar como travada" na decisão de roteiro.** `decidirRoteiro` não leva `marcar_travada` e `id_execucao_travada`, e a janela só mostra a opção em `disparar` (`podeTravar`). Uma linha `roteirista|<id>` presa há mais de 2 h bloqueia as decisões daquele id até alguém mudar a linha na planilha. A ponte já aceita esses dois campos em `decidir-roteiro`: bastaria o app repassá-los.
3. **Mensagens com `codigo` da ponte.** O app já mostra a `mensagem`. Se quiser tratar casos à parte, os códigos novos são `ocupado`, `limite`, `repetido-com-erro`, `verificacao-indisponivel`, `ponte-sem-configuracao` e `motivo-invalido`. Em `rodando`, `parece-travada` e `protecao`, a resposta traz `desde`, `id_execucao_travada` e `ate`, se a janela quiser atualizar o texto sem reler Execuções.
4. **Limite da decisão de roteiro.** O limite padrão (4 por hora) conta por rotina. Para decidir vários roteiros seguidos, ajuste `LIMITE_POR_HORA_ROTEIRISTA_DECISAO` nas propriedades. Não precisa mudar o app.
