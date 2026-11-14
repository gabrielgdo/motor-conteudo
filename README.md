# Motor de Conteúdo — plataforma (PWA)

App web estático para a Robertta operar o fluxo de conteúdo (Reels/TikTok) sem conversar com os
bots: ver o que está esperando por ela, enviar gravações, revisar prévias (aprovar ou pedir
ajustes) e pegar os pacotes prontos para postar.

- HTML/CSS/JS puro com ES modules — **sem build, sem npm, sem frameworks**.
- Login com Google (Google Identity Services, token model). Só as contas permitidas em
  `js/config.js` entram.
- Os dados ficam no Google Drive (pasta "Motor de Conteúdo") e na planilha do Radar. O app só lê
  as listagens e grava arquivos pequenos (`aprovado.md`, `ajustes vN.md`), o bruto da gravação e a
  "data do post" na aba Desempenho.
- Nenhum segredo no repositório (o client_id OAuth é público por natureza).

O contrato de nomes de arquivo com o motor está em [`formatos-referencia.md`](formatos-referencia.md);
a especificação desta etapa, em [`SPEC.md`](SPEC.md).

## Estrutura

```
index.html              shell único (SPA, rotas por hash: #/inicio, #/videos/<id>, …)
manifest.webmanifest    PWA (ícones 192/512, any + maskable)
sw.js                   service worker: cache só do shell, nunca de APIs do Google
css/app.css             visual (cores, tipografia, layout celular/computador)
js/app.js               boot, roteador, layout, navegação, faixas (sessão / nova versão)
js/config.js            constantes: client_id, ids de pastas, e-mails permitidos, escopos
js/auth.js              login GIS, sessão em sessionStorage, renovação silenciosa
js/drive.js             cliente da Drive API v3 (listagens com cache de 60 s, upload multipart)
js/sheet.js             planilha do Radar (Planilha Google nativa ou .xlsx via SheetJS)
js/model.js             monta o estado de cada id a partir das listagens (puro)
js/parse.js             funções puras: nomes de arquivo, frontmatter, YAML, datas
js/upload.js            upload resumível em pedaços de 8 MiB
js/ui.js                helpers de DOM (el(), toast, modal…) — nunca innerHTML com dados
js/views/               telas: inicio, videos, enviar, prontos, embreve, login
icons/                  ícones gerados por tools/make_icons.py
tools/make_icons.py     gera os PNGs com Pillow
tests/                  testes com node --test (sem dependências)
vendor/xlsx.full.min.js SheetJS 0.20.3, carregado só ao ler/gravar a planilha .xlsx
```

## Rodar localmente

```sh
python3 -m http.server 8000
# abrir http://localhost:8000/
```

Para o login funcionar, a origem (`http://localhost:8000`) precisa estar em
"Origens JavaScript autorizadas" do client OAuth no Google Cloud Console.

## Testes

```sh
node --test tests/
```

Cobrem nomes de arquivo, frontmatter, os geradores de YAML (comparação byte a byte), as regras do
modelo (com o cenário real atual) e a semana ISO. Node 18+; nenhuma dependência.

## Ícones

```sh
python3 tools/make_icons.py
```

Precisa do Pillow. Usa uma fonte serifada do sistema (DejaVu Serif etc.) ou, se não houver,
desenha o "M" com polígonos.

## Publicar

O site é publicado pelo GitHub Pages a partir da branch `main` (raiz do repositório), em
`https://gabrielgdo.github.io/motor-conteudo/` (e depois `https://motor.rocambrea.com/`).
Todos os caminhos são relativos (`./`), então funciona nos dois endereços.

1. Faça as mudanças e rode `node --test tests/`.
2. **Aumente a versão do cache em `sw.js`** (`motor-shell-v1` → `motor-shell-v2`…). É isso que faz
   o app aberto mostrar a faixa "Nova versão — toque para atualizar". Se adicionar um arquivo JS
   novo, inclua-o também na lista `SHELL` do `sw.js`.
3. Commit e push na `main`. O Pages publica em um ou dois minutos.

O arquivo `.nojekyll` impede o GitHub Pages de processar o site com Jekyll.
