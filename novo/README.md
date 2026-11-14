# Motor de Conteúdo — app novo (`/novo/`)

PWA estática para a Robertta acompanhar o fluxo semanal de vídeos (Reels/TikTok): o que espera
por ela, os roteiros, as prévias e os pacotes prontos. É outra porta para o mesmo fluxo dos bots;
os dados ficam no Google Drive (pasta "Motor de Conteúdo") e na planilha Radar.

- HTML/CSS/JS puro com ES modules: **sem build, sem npm, sem framework**.
- Publicado em `https://motor.rocambrea.com/novo/`. Todos os caminhos são relativos (`./`).
- O app antigo continua na raiz do repositório e **não é alterado** por este.
- Login com Google (Google Identity Services, token model). Só as contas de `js/config.js` entram.
- Nenhum segredo no repositório (o client_id OAuth é público). O app nunca publica nas redes.
- Referência visual e de textos: o protótipo aprovado (ver [`SPEC.md`](SPEC.md)).
- Contrato de nomes de arquivo com o motor: [`../formatos-referencia.md`](../formatos-referencia.md).

## Estrutura

```
index.html              casca única: véu, login, ilha/conteúdo/doca, janelas, avisos
manifest.webmanifest    PWA (id "/novo/", start_url e scope "./", standalone, tema Noite #0F0809)
sw.js                   service worker: cache "motor-novo-vN" só dos arquivos do app, só dentro de /novo/
css/app.css             visual do protótipo em rem (densidade: ver o comentário do topo)
icons/                  ícones (cópia de ../icons, gerados por ../tools/make_icons.py)
vendor/xlsx.full.min.js SheetJS 0.20.3, carregado só ao ler a planilha .xlsx (fora do cache do SW)
js/
  main.js               início: escutas, tema, sessão retomada ou login, service worker
  config.js             client_id, escopos, contas, pastas, planilha, regras (CONFIG, nomeDe)
  integra.js            o ÚNICO módulo que fala com o mundo externo (usa auth/drive/sheet)
  auth.js               GIS, sessão em sessionStorage, renovação silenciosa
  drive.js              Drive API v3 (listagens com cache, textos, blobs)
  sheet.js              planilha Radar: "data do post" (nativa ou .xlsx), só leitura nesta etapa
  model.js              listagens do Drive → projetos (puro)
  parse.js              nomes de arquivo, YAML, datas no fuso de São Paulo, pedido de ajustes (puro)
  roteiro.js            leitor de roteiro (porta do roteiro.py do motor, puro)
  etapas.js             etapa de cada projeto no vocabulário das telas (puro)
  dados.js              monta os roteiros no formato das telas; estados carregando/erro/offline
  estado.js             estado da tela (rota, filtros) e rascunho dos campos
  util.js               esc, datas, formatos, ícones
  acoes.js              o que cada data-acao faz; passagem login ⇄ app
  roteador.js           rotas por hash, navegação, View Transitions, foco
  visual.js             véu WebGL, tema Noite/Dia, luz dos cartões
  telas/                uma por tela (inicio, pautas, roteiros, videos, enviar, prontos, resultados) + pecas
  componentes/          janelas (avisos, Sobre), paleta (Ctrl K), tele (teleprompter), players,
                        downloads (arquivos dos pacotes), grafico
tests/                  node --test (roteiro, etapas, dados, parte2) com fixtures/roteiros
```

### O que cada tela faz nesta etapa (só leitura: nada é gravado no Drive)

- **Roteiros**: lista com os filtros e o detalhe com as abas Instagram, TikTok, Extras e Fontes,
  nos dois formatos de roteiro (o novo, de parágrafos, e o antigo, com etiquetas). Teleprompter de
  verdade para os aprovados e gravados. Aprovar/pedir mudança/recusar: etapa 2 (nota no lugar).
- **Vídeos**: os players tocam os arquivos reais das prévias de 4-Revisao. Cada vídeo é baixado
  inteiro pela Drive API (`files/{id}?alt=media` com o token) e tocado por uma URL de Blob, com
  progresso em %. No máximo 4 vídeos ficam guardados na sessão (os mais antigos são revogados; ao
  sair da conta, todos). A linha do tempo usa a duração real; os pinos são os ajustes da lista da
  sessão e, nas versões anteriores, os pedidos de `<id> ajustes vN.md`. "Copiar a lista" no lugar de
  enviar ao motor (etapa 2).
- **Enviar gravação**: escolha do roteiro e o passo a passo para pôr o vídeo em 3-Brutos pelo app
  do Google Drive com o nome `<id>.<extensão>` (o envio pelo app é etapa 2).
- **Prontos**: um cartão por pacote de 5-Prontos; copiar a legenda (do `legenda-*.txt` do pacote),
  baixar cada arquivo original ou todos, um por um. "Postei" é etapa 2.

Rotas: `#/inicio #/pautas #/roteiros #/roteiros/<id> #/videos #/videos/<id> #/enviar #/enviar/<id>
#/prontos #/resultados` (são os links que o Diretor manda nos avisos).

## Rodar localmente

Na raiz do repositório:

```sh
python3 -m http.server 8000
# abrir http://localhost:8000/novo/
```

Para o login funcionar, `http://localhost:8000` precisa estar em "Origens JavaScript autorizadas"
do client OAuth no Google Cloud Console.

## Testes

Na raiz do repositório:

```sh
node --test tests/ novo/tests/
```

`novo/tests/` cobre o leitor de roteiro (paridade com o `roteiro.py`), as regras de etapa, o
mapeamento puro projeto + roteiro → objeto das telas (`montarRoteiro` em `js/dados.js`) e as
funções puras da parte 2 em `js/parse.js` (pedido de ajustes, tempos da linha do tempo, texto de
"Copiar a lista", nome de download, horários do pacote).

## Publicar

O GitHub Pages publica a branch `main`; esta pasta sai em `https://motor.rocambrea.com/novo/`.

1. Rode `node --test tests/ novo/tests/`.
2. **Aumente a versão do cache em `novo/sw.js`** (`motor-novo-v1` → `motor-novo-v2`…). É isso que
   faz o app aberto mostrar o aviso "Nova versão do app. Toque para atualizar.". Se criar um
   arquivo novo, inclua-o também na lista `ARQUIVOS` do `sw.js`.
3. Commit e push na `main`.

O SW do app novo só apaga caches com o prefixo `motor-novo-` e nunca intercepta pedidos fora de
`/novo/` nem de outra origem (Google, fontes): os caches `motor-shell-` do app da raiz ficam intactos.
