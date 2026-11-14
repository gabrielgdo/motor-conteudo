# SPEC — Plataforma do Motor de Conteúdo (ETAPA 1)

PWA estático para a Robertta Cambrea (psicóloga) operar o fluxo de conteúdo (Reels/TikTok) sem
conversar com os bots. HTML/CSS/JS puro, **sem build, sem npm, sem frameworks**. ES modules
(`<script type="module">`). Publicado no GitHub Pages em `https://gabrielgdo.github.io/motor-conteudo/`
(depois também `https://motor.rocambrea.com/`), então **todos os caminhos são relativos** (`./`).
Toda a interface em **português do Brasil**. **Nenhum segredo no repo** (o client_id OAuth é público).

## 1. Arquivos
```
index.html                 shell único (SPA, rotas por hash)
manifest.webmanifest       name "Motor de Conteúdo", short_name "Motor", display standalone,
                           start_url "./", scope "./", background_color #F3E8E2, theme_color #6E1F2C,
                           ícones 192 e 512 (purpose any e maskable)
sw.js                      service worker (ver §9)
css/app.css
js/app.js                  boot, roteador, layout, navegação
js/config.js               constantes (client_id, ids de pastas, e-mails permitidos, escopos)
js/auth.js                 Google Identity Services (token model)
js/drive.js                cliente da Drive API v3 (fetch com Bearer; renova token em 401)
js/sheet.js                leitura/escrita da planilha do Radar (ver §8)
js/model.js                monta o "estado do motor" a partir das listagens (puro, testável)
js/parse.js                funções puras: nomes de arquivo, frontmatter, gerador de YAML, datas
js/upload.js               upload resumível
js/ui.js                   helpers de DOM (el(), escape, toast, modal, confirmação)
js/views/inicio.js, videos.js, enviar.js, prontos.js, embreve.js, login.js
icons/icon-192.png, icons/icon-512.png, icons/apple-touch-icon.png (180), icons/favicon.png (32)
tools/make_icons.py        gera os PNGs com Pillow (fica no repo)
tests/parse.test.mjs, tests/model.test.mjs   testes com `node --test tests/` (sem dependências)
vendor/xlsx.full.min.js    SheetJS 0.20.3 (já está no repo; carregar sob demanda só no §8)
README.md                  o que é, estrutura, como rodar local (python3 -m http.server), como publicar
.nojekyll
```

## 2. Configuração (js/config.js)
- CLIENT_ID = `262963421281-10ojh3kr71geqvmd73jv5978qib9h0b7.apps.googleusercontent.com`
- SCOPES = `openid email https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets`
- ALLOWED = `robertta.c.alonso@gmail.com`, `gabrielgomesdeoliveira17@gmail.com` (comparar em minúsculas)
- ROOT_FOLDER = `1MlsVb3L2_ZqpYWqY6DSjkcVH-V-sqjwI` ("Motor de Conteúdo")
- REVISAO_FOLDER = `1shgllr5h7S-tVqJ86bJd-ZuwCSQjk6KX` (4-Revisao)
- Demais subpastas (0-Base, 1-Radar, 2-Roteiros, 3-Brutos, 5-Prontos, _motor) resolvidas **pelo nome**
  dentro de ROOT_FOLDER via API (cache em memória na sessão).
- RADAR_SHEET = `1CcMx96g4qLcvzbWLX1qBv4SwPNJ8bdYEhYC7Ng2-D9c`
- TIMEZONE = `America/Sao_Paulo` (mostrar datas/horas nesse fuso, formato `dd/mm HH:mm`).

## 3. Login (js/auth.js, views/login.js)
- Carregar `https://accounts.google.com/gsi/client` (async). Usar `google.accounts.oauth2.initTokenClient`
  (token model; nada de redirect, nada de client secret).
- Tela de login: logo/ícone, título "Motor de Conteúdo" em Lora, botão grande vinho "Entrar com Google".
- Após o token: GET `https://www.googleapis.com/oauth2/v3/userinfo` → e-mail. Se não estiver em ALLOWED:
  revogar o token (`google.accounts.oauth2.revoke`), limpar a sessão e mostrar mensagem amigável:
  "Esta conta (<email>) não tem acesso ao Motor de Conteúdo. Entre com a conta da Robertta ou do Gabriel."
- Guardar `{access_token, expires_at, email}` em **sessionStorage** (nunca localStorage). Guardar só o e-mail
  em localStorage (`motor.email`) para usar como `login_hint`.
- Renovação silenciosa: 2 min antes de expirar, ou ao receber 401, chamar
  `tokenClient.requestAccessToken({prompt: '', login_hint: email})`. Se falhar (popup bloqueado / erro),
  mostrar faixa "Sua sessão expirou — toque para entrar de novo" que chama requestAccessToken com prompt ''.
  Requisições pendentes devem esperar a renovação e repetir **uma** vez.
- Botão "Sair" no menu (revoga e limpa).
- Erros de GIS (popup_closed etc.) viram mensagens em português; nunca erro sem tratamento no console.

## 4. Layout e visual
- Cores: fundo #F3E8E2, cards #FFFCFA, texto #241C18, vinho #6E1F2C (ação principal; texto branco),
  rosé #EFD6CE (destaques, chips, badges), verde-escuro #24443A (concluído). Variáveis CSS.
- Google Fonts: Lora (títulos, 500/600) e Montserrat (texto, 400/500/600), com `display=swap`.
- Elegante e calmo: muito respiro, cantos 16–20px, sombras suaves, botões de toque ≥ 48px de altura,
  botão principal grande e arredondado. Sem bibliotecas de ícones externas: ícones SVG inline simples.
- **Celular (< 900px)**: barra de navegação inferior fixa com 6 abas (ícone + rótulo curto), respeitando
  `env(safe-area-inset-bottom)`; cabeçalho simples no topo com o título da tela.
- **Computador (≥ 900px)**: menu lateral fixo à esquerda (logo, abas, e-mail logado, Sair); conteúdo com
  largura máxima confortável.
- Abas: Início, Pautas, Roteiros, Vídeos, Prontos, Resultados. Pautas, Roteiros e Resultados mostram
  uma tela "Em breve" bonita com uma frase do que virá (Pautas: aprovar a seleção do Radar; Roteiros: ler,
  aprovar e pedir mudanças nos roteiros, com teleprompter; Resultados: desempenho dos posts).
- Rotas por hash: `#/inicio` (padrão), `#/pautas`, `#/roteiros`, `#/videos`, `#/videos/<id>`, `#/enviar`,
  `#/enviar/<id>`, `#/prontos`, `#/prontos/<id>`, `#/resultados`.
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
  `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `theme-color`, apple-touch-icon.
- Estados de carregamento (skeleton ou "Carregando…") e de erro com botão "Tentar de novo" em toda tela.
  Botão "Atualizar" no cabeçalho recarrega as listagens.
- **Segurança**: conteúdo vindo do Drive é dado, nunca HTML. Nada de `innerHTML` com texto do Drive;
  usar `textContent`/helper `el()` que escapa. Links só `https:` (validar antes de pôr em `href`).

## 5. Contrato com o motor (nomes de arquivo) — VER `formatos-referencia.md` NESTE REPO
Ids válidos: regex `^(S\d{2}-\d{2}|T\d{2}(-\d{2})?|R\d{3})$`. Ids `T…` são testes (mostrar chip "teste").
Pastas e nomes (todos dentro de "Motor de Conteúdo"):
- `2-Roteiros/rascunhos*/` (pode haver "rascunhos (1)"; olhar todas as pastas cujo nome começa com
  "rascunhos"): `<id> rascunho v<N>.md` (aceitar também `<id> <qualquer coisa> rascunho v<N>.md`) e
  `<id> fontes.md`.
- `2-Roteiros/<id> - <título>.md` = roteiro **aprovado**. `2-Roteiros/arquivo/` = ignorar.
- `3-Brutos/`: vídeos (mp4, mov, m4v, qualquer caixa). Um bruto "pertence" a um id se o nome começa com
  `<id> ` ou `<id>.`. Brutos sem id no nome (ex. IMG_1234.MOV) contam como "bruto sem id".
- `4-Revisao/`: `<id> IG v<N>.mp4`, `<id> TT v<N>.mp4`, `<id> storyboard IG v<N>.jpg`,
  `<id> storyboard TT v<N>.jpg`, `<id> notas v<N>.md`, `<id> ajustes v<N>.md` (N = versão base pedida),
  `<id> aprovado.md`, `<id> limpar.md`.
- `5-Prontos/<id> - <título>/` (pacote): `<id> IG.mp4`, `<id> IG sem musica.mp4`, `<id> TT.mp4`,
  `<id> TT sem musica.mp4`, `capa-instagram.jpg`, `capa-tiktok.jpg`, `carrossel/01.png…`,
  `stories/01.png…`, `threads.txt`, `legenda-instagram.txt`, `legenda-tiktok.txt`, `creditos.md`.
  Opcional (pode não existir): `agenda.md`/`agenda.txt`/`horarios.md`/`horarios.txt` com dia e horário
  sugeridos por rede (mostrar o texto como está).
- `5-Prontos/vencedores/<id> vencedor.md` = vencedor.

Frontmatter do roteiro (entre `---`): `id, titulo, plataformas, extras, duracao_alvo, formato, cta,
valido_ate, status, teste, bruto` (chave: valor; ignorar comentários `# …` no fim da linha).

## 6. Modelo (js/model.js, puro)
Entrada: listagens (arrays `{id, name, mimeType, createdTime, modifiedTime, size, parents, webViewLink}`) de
2-Roteiros (+ rascunhos* e seus arquivos), 3-Brutos, 4-Revisao, 5-Prontos (+ subpastas de pacotes,
recursivo 1 nível para carrossel/stories), vencedores, mais o conjunto de ids "postados" (§8).
Saída: `Map id → projeto`:
```
{ id, titulo, teste, rascunhos:[{v, file}], ultimoRascunho, fontes, roteiro (arquivo aprovado|null),
  frontmatter (do aprovado, carregado sob demanda), brutos:[file], previas:{ versoes:[{v, ig, tt,
  sbIg, sbTt, notas, created}], atual:N }, ajustes:[{v,file}], aprovado:file|null, pacote:{folder,
  files}|null, vencedor:bool, postado:{data}|null, etapa }
```
- `etapa` (texto curto): "rascunho v2 em checagem" / "roteiro para aprovar" / "aprovado, falta gravar" /
  "gravação enviada" / "prévia v1 para ver" / "ajustes v1 pedidos, motor trabalhando" /
  "aprovado, finalizando" / "pacote pronto" / "postado em dd/mm".
- **Roteiro para aprovar** = id com rascunho e **sem** roteiro aprovado (o rascunho continua na pasta
  depois de aprovado: nesse caso NÃO conta).
- **Prévia nova** = id cuja maior versão N tem IG ou TT em 4-Revisao, sem `<id> aprovado.md` e sem
  `<id> ajustes v<M>.md` com M ≥ N.
- **Ajustes em andamento** = existe `ajustes vN` e ainda não existe a versão N+1.
- **Pacote pronto sem Postei** = pasta em 5-Prontos (exceto `vencedores`) cujo id não está nos postados.
- **Roteiro aprovado sem bruto** = roteiro aprovado sem bruto do id em 3-Brutos, sem prévia em 4-Revisao e
  sem pacote em 5-Prontos.
- Semana: ids `S<WW>-NN` com WW = semana ISO atual (fuso de São Paulo).
Cache: listar tudo uma vez por carregamento de tela (Promise.all), com cache em memória de 60 s.
Usar `files.list` com `q="'<pasta>' in parents and trashed=false"`, `fields=nextPageToken,files(id,name,
mimeType,createdTime,modifiedTime,size,webViewLink,parents)`, `pageSize=1000`, `supportsAllDrives=true`,
`includeItemsFromAllDrives=true`, paginando.

## 7. Telas
### 7.1 Início (`#/inicio`)
- Saudação ("Bom dia, Robertta" conforme a hora; para o Gabriel, "Olá, Gabriel").
- **Esperando você**: cards com contador e link:
  - Roteiros para aprovar (→ `#/roteiros`; listar os ids/títulos no card, já que a tela é "em breve")
  - Prévias novas (→ `#/videos/<id>` se só uma, senão `#/videos`)
  - Pacotes prontos para postar (→ `#/prontos`)
  - "Seleção do Radar" aparece desativado com "em breve".
  Se tudo zerado: mensagem calma "Nada esperando por você agora."
- Botão grande vinho **Enviar gravação** (→ `#/enviar`).
- **Progresso da semana** (semana ISO atual): 5 etapas com barra e "n de total": pautas (ids da semana com
  rascunho ou roteiro), roteiros (aprovados), gravação (com bruto, prévia ou pacote), revisão (com
  aprovado.md ou pacote), postagem (postados). Etapa completa em verde-escuro. Sem ids da semana:
  "Ainda não há pautas desta semana."
- **Computador**: tabela "Roteiros da semana" com colunas id, título, roteiro (rascunho vN / aprovado),
  gravação (✓ data / —), vídeos (prévia vN / ajustes / aprovado / pronto / postado), valido_ate (do
  frontmatter). Linhas = ids da semana + ids de teste ativos (chip "teste"). Clicar abre a tela do vídeo.
  No celular, a mesma informação em cards compactos.
  O frontmatter vem do roteiro aprovado (ou do último rascunho) via `files.get?alt=media`; carregar só
  para as linhas da tabela.

### 7.2 Vídeos (`#/videos`, `#/videos/<id>`)
- Lista: todos os ids com prévia em 4-Revisao, mais recentes primeiro, com chip de estado
  ("nova", "ajustes pedidos", "aprovado").
- Detalhe `<id>`:
  - Título + chip de estado + seletor de versão (v1, v2…; padrão = atual).
  - Vídeos **IG e TT lado a lado** (no celular, um embaixo do outro, ou abas IG/TT) em
    `<iframe src="https://drive.google.com/file/d/<fileId>/preview" allow="autoplay" allowfullscreen>`
    em proporção 9:16; link "abrir no Drive" embaixo de cada um. Storyboards (se houver) como link.
  - **Resumo das mudanças**: conteúdo de `<id> notas v<N>.md` da versão selecionada, mostrado como texto
    pré-formatado com quebras (markdown simples: títulos `#`, listas e tabelas `|` podem virar texto/tabela
    HTML seguro, mas sem innerHTML do conteúdo cru). Se não houver, "Sem resumo para esta versão".
  - Botões (só quando a versão atual é "nova"; nas anteriores, só leitura):
    - **Aprovar os dois** (vinho) → confirmação ("Aprovar a versão vN do IG e do TT?") com campo opcional
      Observações → cria `4-Revisao/<id> aprovado.md` (§7.5). Bloquear se já existir.
    - **Pedir ajuste** (contorno vinho) → formulário com itens (botão "+ outro ajuste", remover item):
      versão (segmentado: IG / TT / Ambas → `ig`/`tt`/`ambas`), momento (texto, placeholder "0:00-0:03",
      opcional), o que mudar (obrigatório), como (opcional); campo Observações geral. Enviar → cria
      `4-Revisao/<id> ajustes v<N>.md` com N = versão atual. Bloquear se já existir esse arquivo.
    - Depois de gravar: toast "Enviado ao motor" e recarregar o estado.
  - **Histórico**: linha do tempo com `createdTime` (fuso SP) de: rascunhos vN, relatório de fontes,
    roteiro aprovado, bruto, cada prévia vN, cada ajustes vN, aprovado, pacote pronto, vencedor.

### 7.3 Enviar gravação (`#/enviar`, `#/enviar/<id>`)
- Passo 1: escolher um **roteiro aprovado sem bruto** (lista de cards com id e título). Se nenhum:
  explicar e deixar a opção "Enviar mesmo assim, sem roteiro" desativada nesta etapa.
- Passo 2: escolher o arquivo (`<input type="file" accept="video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v">`).
  Aceitar só extensões mp4/mov/m4v (qualquer caixa); outras → mensagem.
  Mostrar nome, tamanho em MB/GB.
- **Nome no Drive**: `<id> bruto.<extensão original como veio>` (ex. `S46-03 bruto.MOV`). Nenhuma
  compressão, nenhuma conversão. Antes de começar, listar 3-Brutos: se já houver bruto do id, bloquear.
- Aviso fixo: "Mantenha o app aberto e a tela ligada até terminar."
- Upload (§7.4) com barra de progresso, % , MB enviados/total, velocidade e tempo restante; botões Pausar /
  Continuar / Cancelar. Ao terminar: tela de sucesso em verde-escuro "Gravação enviada. O motor vai
  começar a edição em alguns minutos." e link para Início.
- `beforeunload` avisa se houver upload em andamento. Usar `navigator.wakeLock` se disponível.

### 7.4 Upload resumível (js/upload.js)
- Iniciar: `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name`
  com headers `Authorization`, `Content-Type: application/json; charset=UTF-8`,
  `X-Upload-Content-Type: <file.type || video/mp4>`, `X-Upload-Content-Length: <size>`, body
  `{name, parents:[<id de 3-Brutos>]}`. A URI da sessão vem no header `Location`.
- Enviar em pedaços de **8 MiB** (múltiplo de 256 KiB) com **XMLHttpRequest** `PUT <sessão>` e
  `Content-Range: bytes a-b/total` (último pedaço pode ser menor). `xhr.upload.onprogress` para progresso.
  Resposta 308 → próximo offset = (fim do header `Range`)+1 (sem `Range` → 0). 200/201 → concluído.
- Falha de rede / 5xx / timeout: esperar com backoff (1, 2, 4, 8… até 60 s, sem limite de tentativas enquanto
  a página estiver aberta; voltar imediatamente no evento `online`), consultar o status com
  `PUT` vazio e `Content-Range: bytes */total` e continuar do offset confirmado. 401 → renovar token e repetir.
  404/410 → sessão expirou: avisar e recomeçar do zero.
- Guardar a sessão em localStorage (`motor.upload.<id>.<name>.<size>.<lastModified>` → URI + data) para
  retomar se a página recarregar e ela escolher o mesmo arquivo (válida por 6 dias); apagar ao concluir.
- Testável: separar o cálculo de offsets/ETA em funções puras.

### 7.5 Formato dos arquivos gravados (YAML exato — o motor lê assim)
Arquivo texto `text/markdown`, criado com upload multipart
(`POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`),
parents = [REVISAO_FOLDER]. Todo valor de texto livre vai entre aspas duplas com `\` e `"` escapados e
quebras de linha trocadas por espaço. Linhas exatamente assim:
```
---
id: S46-01
versao_aprovada: 2
decisao: aprovar
observacoes: "postar na quinta"
---
```
```
---
id: S46-01
versao_base: 1
decisao: ajustar
ajustes:
  - versao: tt
    tempo: "0:00-0:03"
    pedido: "deixar o gancho mais impactante"
    como: "texto maior e zoom in na palavra \"nunca\""
  - versao: ambas
    tempo: "0:12"
    pedido: "tirar o zoom"
observacoes: "texto livre"
---
```
Omitir `tempo`/`como` quando vazios; `observacoes: ""` quando vazio. Funções geradoras em parse.js com
testes que conferem a saída byte a byte com os exemplos acima.

### 7.6 Prontos (`#/prontos`, `#/prontos/<id>`)
- Lista de pacotes (pastas de 5-Prontos exceto `vencedores`), mais recentes primeiro: título, chip
  "Vencedor" (rosé com estrela) se houver `vencedores/<id> vencedor.md`, chip "Postado em dd/mm" (verde) ou
  "Para postar".
- Detalhe: 
  - Vídeos IG e TT (iframe preview do Drive) e capas (imagem via `files.get?alt=media` → blob → objectURL).
  - Legenda Instagram e legenda TikTok (texto de `legenda-*.txt`) com botão **Copiar** cada
    (`navigator.clipboard.writeText`, fallback textarea + execCommand); Threads (`threads.txt`) com Copiar.
  - Carrossel e Stories: miniaturas em grade (blob URLs, carregadas sob demanda).
  - Dia e horário sugeridos por rede: se existir arquivo de agenda (§5), mostrar; e mostrar as
    `observacoes` de `4-Revisao/<id> aprovado.md`, se houver ("Nota da aprovação: …").
  - Lista de arquivos com botão **Baixar** cada (fetch alt=media com token → blob → `<a download>`),
    e **Baixar tudo** (sequencial, um por vez, com progresso "3 de 14"; carrossel/ stories com prefixo
    `carrossel-01.png`). Também link "Abrir pasta no Drive".
  - Botão **Postei** (vinho; verde "Postado em dd/mm" se já postado) → modal com data (input date, padrão
    hoje em SP) → grava na planilha (§8) → toast e atualiza.

## 8. Planilha do Radar (js/sheet.js)
O arquivo RADAR_SHEET hoje **é um .xlsx guardado no Drive** (mimeType
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`), não uma Planilha Google nativa.
Abas: Candidatos, Decisões, **Desempenho** (cabeçalho: `id | data do post | visualizações | retenção média |
envios | salvamentos | seguidores ganhos`), Medianas.
- **Postei** grava na aba **Desempenho**: procura a linha com o `id` (coluna "id"); se existir, preenche
  "data do post" (`AAAA-MM-DD`); se não, acrescenta linha `[id, data]` no fim. Localizar colunas pelo
  texto do cabeçalho (sem acento/minúsculas), não por posição.
- Ler postados = ids com "data do post" preenchida na Desempenho.
- Implementar os dois caminhos, escolhidos pelo mimeType (`files.get?fields=mimeType,modifiedTime`):
  - Planilha nativa (`application/vnd.google-apps.spreadsheet`): Sheets API v4 (`values.get Desempenho!A:G`,
    `values.update`/`values.append` com `valueInputOption=RAW`).
  - .xlsx: carregar `vendor/xlsx.full.min.js` sob demanda (script tag, só aqui), baixar
    (`alt=media`), `XLSX.read(buf, {type:'array', cellStyles:true, cellDates:false})`, alterar só as células
    da Desempenho, `XLSX.write(wb, {bookType:'xlsx', type:'array'})`, e antes de subir conferir de novo o
    `modifiedTime`: se mudou, refazer leitura+alteração (até 3 vezes). Subir com
    `PATCH https://www.googleapis.com/upload/drive/v3/files/<id>?uploadType=media&supportsAllDrives=true`.
- Falha → mensagem clara, sem marcar como postado.

## 9. Service worker (sw.js)
- Cache versionado (`motor-shell-v1`) **só do shell**: index.html, css, js (todos os módulos), manifest,
  ícones. Instalar com `cache.addAll` da lista; `activate` apaga caches antigos; `skipWaiting` +
  `clients.claim`.
- `fetch`: interceptar **apenas** GET da mesma origem que esteja na lista do shell (ou navegação → servir
  index.html do cache se offline; network-first para navegação). **Nunca** interceptar googleapis.com,
  accounts.google.com, drive.google.com, fonts, nem nada de outra origem; `vendor/xlsx.full.min.js` também
  não entra no cache.
- Registrar em app.js com caminho relativo `./sw.js`. Quando houver SW novo, mostrar faixa "Nova versão —
  toque para atualizar".

## 10. Ícones (tools/make_icons.py, Pillow)
Simples e elegante: quadrado com fundo vinho #6E1F2C, um círculo/onda rosé #EFD6CE e uma letra "M" em serifa
(usar DejaVu Serif ou outra fonte serifada disponível; se não houver, desenhar o M com polígonos), margem segura
para maskable (conteúdo no círculo central de 80%). Gerar 512, 192, 180 (apple-touch-icon) e 32 (favicon).
Rodar o script e deixar os PNGs no repo.

## 11. Qualidade
- Nenhum erro no console ao abrir a tela de login sem estar logado (inclusive se o GIS demorar).
- `node --test tests/` passando: parse de nomes (rascunho/prévia/ajustes/pacote/bruto), frontmatter,
  geradores YAML (byte a byte), regras do modelo (roteiro para aprovar, prévia nova, ajustes em andamento,
  pacote sem postei, aprovado sem bruto) com o cenário real atual abaixo, e semana ISO.
- Cenário real atual (para teste): `2-Roteiros/T01-01 - Padrões familiares herdados não são destino.md`,
  `2-Roteiros/rascunhos/T01-01 rascunho v1.md`, `… rascunho v2.md`, `… T01-01 fontes.md`,
  `3-Brutos/T01-01 bruto.mp4`, 4-Revisao vazio, 5-Prontos só com `vencedores/` → T01-01 NÃO é roteiro para
  aprovar, não é "sem bruto", etapa "gravação enviada".
- Código legível, comentado em português onde não for óbvio. Sem dependências externas além de GIS,
  Google Fonts e o SheetJS vendorizado.
