# Motor de Conteúdo — app (PWA)

PWA estática para a Robertta acompanhar e conduzir o fluxo semanal de vídeos (Reels/TikTok): pautas
e candidatos, roteiros, envio da gravação, prévias, andamento do motor de edição e pacotes prontos.
É outra porta para o mesmo fluxo dos bots; os dados ficam no Google Drive (pasta "Motor de
Conteúdo") e na planilha Radar.

> **Este repositório é público** e o GitHub Pages serve **todos** os arquivos dele em
> `https://motor.rocambrea.com/<arquivo>` (inclusive `README.md`, `AGENTS.md` e `CLAUDE.md`).
> Nada de chave, token, segredo, dado de paciente, id de bot, endereço de webhook ou detalhe
> operacional sensível aqui, nem em código, nem em teste, nem em documentação.

- HTML/CSS/JS puro com ES modules: **sem build, sem npm, sem framework**.
- Publicado em `https://motor.rocambrea.com/` (GitHub Pages, branch `main`, raiz do repositório).
  Todos os caminhos são relativos (`./`).
- Login com Google (Google Identity Services, token model). Só as contas de `js/config.js` entram.
- Nenhum segredo no repositório (o client_id OAuth é público). O app nunca publica nas redes.
- Referência visual e de textos: o protótipo aprovado (ver [`SPEC.md`](SPEC.md)).
- Contrato de nomes de arquivo com o motor: [`formatos-referencia.md`](formatos-referencia.md).
- A ponte com os bots (Google Apps Script): [`ponte/README.md`](ponte/README.md).
- **Agentes (Claude Code, Codex, Grok Bot):** leiam [`AGENTS.md`](AGENTS.md) antes de mexer em
  qualquer coisa. O [`CLAUDE.md`](CLAUDE.md) aponta para ele.

## Como o app se encaixa no sistema

```
Robertta (app no navegador ou PWA no iPhone)
   │  lê e grava arquivos no Drive "Motor de Conteúdo" e abas da planilha Radar (com o token dela)
   │  pede rodadas e decisões aos bots ──► ponte (Apps Script) ──► rotinas por webhook dos bots
   ▼
Drive: 1-Radar · 2-Roteiros · 3-Brutos · 4-Revisao · 5-Prontos · _motor
   ▲
   │  Motor Reels (editor de vídeo, outro repositório, roda no computador do Grok) lê e grava aqui
   │  e publica o andamento em _motor/andamento/<id>.json, que o app mostra
```

- **Radar** pesquisa os temas candidatos e grava na planilha. **Roteirista** escreve os roteiros.
  **Diretor** coordena e recebe os avisos do motor. **Programador** mantém o app, a ponte e o motor.
  Cada bot é um assistente separado da Robertta, com o seu chat e as suas rotinas.
- O app **nunca dispara o motor** e nunca publica nada nas redes. Ele só grava arquivos no Drive
  (a gravação em 3-Brutos, a decisão da prévia em 4-Revisao, o estado do candidato em
  `_motor/app/candidatos/`), linhas nas abas da planilha e pedidos pela ponte.
- Detalhes, regras e cuidados: [`AGENTS.md`](AGENTS.md).

## Estrutura

```
index.html              casca única: véu, login, ilha/conteúdo/doca, janelas, avisos
manifest.webmanifest    PWA (id, start_url e scope "./", standalone, tema Noite #0F0809)
sw.js                   service worker: cache "motor-app-vN" só dos arquivos do app (lista ARQUIVOS)
css/app.css             visual do protótipo em rem (densidade: ver o comentário do topo)
icons/                  ícones gerados por tools/make_icons.py
vendor/xlsx.full.min.js SheetJS 0.20.3, carregado só ao ler a planilha .xlsx (fora do cache do SW)
privacidade.html        política de privacidade
js/
  main.js               início: escutas, tema, sessão retomada ou login, service worker, VERSAO_APP
  config.js             client_id, escopos, contas, pastas, planilha, flags, endereço da ponte
  integra.js            o ÚNICO módulo que fala com o mundo externo (usa auth/drive/sheet/ponte)
  auth.js               GIS, sessão em localStorage, renovação silenciosa, limpeza ao sair (nunca revoga)
  drive.js              Drive API v3 (listagens com cache, textos, blobs, pastas do app em _motor)
  sheet.js              planilha Radar: "data do post"; abas Seleção, Decisões, Execuções, Candidatos
  controle.js           controle manual (puro): Execuções, catálogo fechado de rotinas, trava,
                        janela de proteção, tempos, ids de execução e de lote, permissões
  selecao.js            pautas (puro): Seleção e Decisões, motivos, primeira decisão vale
  candidatos.js         candidatos do Radar (puro) e o estado no app (_motor/app/candidatos/<id>.json)
  envios.js             envios ao Roteirista (puro): estado real de cada pauta mandada
  decisoes-roteiro.js   decisão de roteiro (puro): estados, bloqueios ja-pedida / ja-decidido
  revisao.js            decisão da prévia em 4-Revisao (puro): planejarArquivoRevisao
  andamento.js          andamento do Motor Reels (puro): lê _motor/andamento/<id>.json
  envio-video.js        envio do bruto pelo app para 3-Brutos como <id>.<ext> (regras e passo a passo)
  upload.js             envio retomável em pedaços de 8 MiB para o Drive
  model.js              listagens do Drive → projetos (puro)
  parse.js              nomes de arquivo, YAML, datas no fuso de São Paulo, pedido de ajustes (puro)
  roteiro.js            leitor de roteiro (porta do roteiro.py do motor, puro)
  etapas.js             etapa de cada projeto no vocabulário das telas (puro)
  dados.js              monta os dados das telas; estados carregando/erro/offline
  estado.js             estado da tela (rota, filtros), rascunhos e registros otimistas
  util.js               esc, datas, formatos, ícones
  acoes.js              o que cada data-acao faz; passagem login ⇄ app
  saida.js              a ordem segura do "Sair" (puro) e a marca de saída
  versao.js             nova versão: recarregar sozinho ou avisar, com anti-laço (puro)
  roteador.js           rotas por hash, navegação, View Transitions, foco
  visual.js             véu WebGL, tema Noite/Dia, luz dos cartões
  telas/                uma por tela (inicio, pautas, roteiros, videos, enviar, prontos, resultados) + pecas
  componentes/          janelas, paleta (Ctrl K), tele (teleprompter), players, telacheia (prévia em
                        tela cheia), downloads, grafico, execucao (faixa e janelas do controle manual)
ponte/                  a ponte no Google Apps Script (Code.gs, appsscript.json, implantar.sh, README)
tests/                  node --test (sem dependências), com fixtures/roteiros
tools/make_icons.py     gera os PNGs de icons/ (precisa do Pillow)
```

Rotas: `#/inicio #/pautas #/roteiros #/roteiros/<id> #/videos #/videos/<id> #/enviar #/enviar/<id>
#/prontos #/resultados` (são os links que o Diretor manda nos avisos).

## O que o app faz hoje (v24)

- **Faixa “Motor” no Início** (v24): sinal de vida do motor (`_motor/saude.json`): funcionando, trabalhando, em pausa ou sem sinal, com a idade das coletas e o último erro.

- **Início**: pendências, gravação, ciclo e esteira da semana atual, com dados reais do Drive.
- **Pautas**: faixas do Radar diário e da Seleção ("Rodar agora" pela ponte), Candidatos do Radar
  (excluir com Desfazer, mover para Para decidir, recusar, aprovar e mandar ao Roteirista, pedir a
  pauta completa ao Radar), Para decidir / Decididas / Todas, Aprovar / Recusar com motivo,
  "Confirmar decisões" e "Enviar ao Roteirista".
- **Roteiros**: lista, detalhe com as abas Instagram, TikTok, Extras e Fontes (formato novo e
  antigo), abas de versão, decisão presa à versão vista (Aprovar / Pedir mudança / Recusar) com
  estado explícito (Em revisão, Na fila, Processando, Revisada, Aprovado, falhou com "Pedir de
  novo"), seção "Com o Roteirista" e teleprompter ("Do começo" rola de verdade).
- **Vídeos**: players com os arquivos reais das prévias de 4-Revisao (baixados pela Drive API e
  tocados por URL de Blob, no máximo 4 na sessão), tela cheia com fundo desfocado, linha do tempo
  com pinos de ajuste, Aprovar (`<id> aprovado.md`) e "Enviar ajustes" (`<id> ajustes vN.md`), e o
  **andamento real do motor** (`_motor/andamento/<id>.json`, relido a cada 60 s só enquanto a página
  do vídeo estiver visível).
- **Enviar gravação**: envio do vídeo pelo próprio app para 3-Brutos como `<id>.<extensão>`,
  retomável, com progresso real, trava contra envio duplo e conferência no Drive no fim.
- **Prontos**: um cartão por pacote de 5-Prontos; copiar a legenda, baixar cada arquivo ou todos.
- **Resultados**: os números ainda estão "em breve"; já tem a faixa "Fazer retrospectiva agora".
- **Sessão que fica**: a sessão (`motor.sessao`) fica em localStorage; fechar e reabrir o app
  (também o instalado no iPhone) não pede login enquanto o token vale. Com o token vencido, a
  entrada mostra "Continuar como <nome>" e "Usar outra conta".
- **Sair da conta**: botão redondo na ilha, em todas as telas e larguras, sempre com a confirmação
  "Sair da conta?". O Sair **só limpa a sessão local** (chaves `motor.*`/`motor-*`, menos o tema e os
  envios retomáveis; vídeos, downloads, estado e rascunhos em memória) e recarrega a página.
  **Ele nunca revoga o acesso no Google**: o app e o rclone do Motor Reels usam o mesmo projeto do
  Google, e revogar derrubava a autorização do Drive do motor (v12). `tests/sair.test.mjs` e
  `tests/sessao.test.mjs` garantem isso.
- **Nova versão**: ao abrir, ao voltar a ficar visível e no `pageshow` do bfcache, a página procura
  um `sw.js` novo. Versão diferente: recarrega sozinha uma vez se não houver trabalho em andamento;
  senão, mostra "Nova versão do app. Toque para atualizar." (`js/versao.js`).
- **Permissões**: só a conta da Robertta (`ALLOWED[0]`) decide. A outra conta permitida vê tudo,
  pode pedir rodadas e vê os botões de decisão desabilitados. Ids que começam com T são testes:
  selo "Teste", e nunca vão para Decisões nem Desempenho.

**Flags** (`js/config.js`, `FLAGS`): `ponte` (disparos e decisões pela ponte; ligada desde a v10),
`decisoesPeloApp` (grava as decisões de pauta) e `revisaoPeloApp` (grava a decisão da prévia; com
`false` volta ao "Copiar a lista"). Com a ponte desligada, as janelas explicam e mandam pedir ao bot
no chat.

**Ainda não feito:** "Postei" na aba Desempenho e os números de Resultados (etapas 3 e 4). A
proposta completa do controle manual (`PLANO.md`) fica fora do repositório.

## Trabalhar junto (Robertta, Programador e agentes)

A Robertta pode clonar este repositório e pedir mudanças ao Claude Code na máquina dela. O
Programador (o bot que mantém o app) também trabalha aqui. Para não atrapalhar um ao outro:

1. **Sempre `git pull` antes de começar.**
2. **Avise o Programador qual parte vai mexer**, para ele não pegar a mesma ao mesmo tempo.
3. **Rode `node --test tests/`** antes de subir. Tudo tem de passar.
4. **Mudou algo do app? Aumente juntas** a `VERSAO_APP` em `js/main.js` e a `VERSAO` em `sw.js`
   (o teste confere que batem). Sem isso o iPhone fica na versão antiga.
5. **Push na `main` publica o site na hora.** Não suba nada pela metade.
6. **A ponte só muda quando alguém roda** `bash ponte/implantar.sh criar && bash ponte/implantar.sh
   configurar`. Isso fica com o Programador: editar `ponte/Code.gs` e dar push não muda a ponte no ar.
7. Nunca coloque chave, token ou dado de paciente em nenhum arquivo.
8. **Commit só no nome de quem commita.** Agentes (Claude Code, Codex…) não põem coautor nem
   assinatura: nada de `Co-Authored-By:`, `Claude-Session:` ou "Generated with Claude Code" no
   commit ou no PR. No GitHub aparece só a pessoa, nunca "e claude".

## Regras que não mudam

- Nenhuma chave, segredo, token ou dado de paciente no código ou no repositório.
- Conteúdo lido do Drive ou da planilha é dado: sempre passa por `esc()` antes de virar HTML.
- O app nunca publica nada nas redes e nunca dispara o motor.
- Tudo funciona e fica bonito no computador e no celular, inclusive no PWA instalado no iPhone.
  Ações são botões de verdade, não links de texto. A identidade visual fica; nada de redesenho.
- O Sair só limpa a sessão local e nunca revoga o acesso no Google (há teste que proíbe o revoke).
- Testes nunca usam tokens reais.
- Ids T são de teste e nunca vão para Decisões.
- Mudança na estrutura da planilha só com as palavras explícitas da Robertta. O fluxo semanal
  automático não muda sem ela.
- Uma versão de roteiro aprovada é final; rascunhos posteriores não contam como decididos.
- Decisão registrada no app pela conta da Robertta é dela; aprovação de bot ou agente não é.

## Rodar localmente

Na raiz do repositório:

```sh
python3 -m http.server 8000
# abrir http://localhost:8000/
```

Para o login funcionar, `http://localhost:8000` precisa estar em "Origens JavaScript autorizadas"
do client OAuth no Google Cloud Console.

## Testes

```sh
node --test tests/
```

Node 22+ (com um diretório, o `--test` carrega `tests/index.js`, que importa todos os testes). Não há
`npm test` nem `package.json`: o comando é este. Em 15/11/2026 eram 371 testes, todos passando.
Cobrem o leitor de roteiro (paridade com o `roteiro.py`), as regras de etapa, o mapeamento puro
projeto + roteiro → objeto das telas (`montarRoteiro`), as funções puras de `js/parse.js` e
`js/model.js` (nomes de arquivo, YAML, datas, pedido de ajustes, horários do pacote), as partes
puras do `js/upload.js`, o "Sair" (`tests/sair.test.mjs`: nunca chama o revoke do Google, chaves apagadas e mantidas, GIS ausente
ou com erro, renovação cancelada, escolha de conta no login seguinte, a ordem do sair e a marca de
saída, a decisão "recarregar sozinho ou avisar" e o anti-laço), a sessão que fica (`tests/sessao.test.mjs`),
a versão (`tests/versao.test.mjs`), o controle manual
(`tests/controle.test.mjs`, `selecao.test.mjs`, `revisao.test.mjs`: Execuções, trava, janela de
proteção, tempos, lotes, permissões, decisões de pauta e de prévia, ponte desligada), as telas do
controle manual sem DOM (`tests/telas.test.mjs`: faixa, janela "Rodar agora?" a partir do
catálogo, Detalhes, Pautas com conteúdo malicioso escapado, contagem, conta que não decide,
estados honestos, decisão de roteiro, janela da prévia, Histórico) e o PWA (`tests/sw.test.mjs`: todo arquivo da lista do `sw.js` existe,
todo módulo do app está nela, versão do cache igual à do `js/main.js`, manifest, nenhum caminho
para fora da raiz).

## Publicar

O GitHub Pages publica a raiz da branch `main` em `https://motor.rocambrea.com/` (domínio no arquivo
`CNAME` e nas configurações do Pages). O `.nojekyll` impede o processamento pelo Jekyll. **Todo push
na `main` vai ao ar em um ou dois minutos**, e todo arquivo do repositório fica acessível no site
(inclusive este README, o `AGENTS.md` e o `CLAUDE.md`).

1. Rode `node --test tests/`.
2. **Aumente a versão do cache** em `sw.js` (`VERSAO`, hoje `motor-app-v19` → `motor-app-v20`…) e, igual,
   em `js/main.js` (`VERSAO_APP`); o teste confere que as duas batem. É a mudança no `sw.js` que
   faz o navegador instalar o SW novo e o app aberto recarregar sozinho uma vez (ou, com trabalho
   em andamento, mostrar "Nova versão do app. Toque para atualizar."). Se criar um arquivo novo do app, inclua-o na lista `ARQUIVOS` do `sw.js` (o teste
   avisa se faltar um módulo ou se a lista apontar para um arquivo que não existe).
3. Commit e push na `main`. O Pages publica em um ou dois minutos.

Mudança só de documentação (README, AGENTS, CLAUDE, SPEC, `ponte/README.md`) **não** aumenta a
versão: esses arquivos não estão no `ARQUIVOS` do `sw.js` e não mudam o app instalado.

### Quem já tinha o app instalado

O app instalado no iPhone continua o mesmo (mesmo endereço, `start_url`/`scope`/`id` `./`), então
não precisa reinstalar. Na próxima abertura com internet, o navegador vê que o `sw.js` mudou e
instala o novo: ele assume na hora (`skipWaiting` + `clients.claim`) e apaga os caches antigos
(`motor-shell-` do app anterior, `motor-novo-` da prévia e versões anteriores de `motor-app-`).
O SW busca a navegação e os arquivos do app na rede primeiro, sem o cache HTTP; o cache do SW só
serve sem internet.

Uma página aberta com uma versão até a v5 não tem a recarga automática (ela chegou na v6): nela, a
atualização aparece como a faixa "Nova versão do app. Toque para atualizar." ao voltar para o app.
Basta tocar na faixa uma vez (ou fechar o app no seletor de apps do iPhone e abrir de novo). Da v6
em diante, a troca de versão acontece sozinha.
