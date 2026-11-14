# Motor de Conteúdo — app (PWA)

PWA estática para a Robertta acompanhar o fluxo semanal de vídeos (Reels/TikTok): o que espera
por ela, os roteiros, as prévias e os pacotes prontos. É outra porta para o mesmo fluxo dos bots;
os dados ficam no Google Drive (pasta "Motor de Conteúdo") e na planilha Radar.

- HTML/CSS/JS puro com ES modules: **sem build, sem npm, sem framework**.
- Publicado em `https://motor.rocambrea.com/` (GitHub Pages, branch `main`, raiz do repositório).
  Todos os caminhos são relativos (`./`).
- Login com Google (Google Identity Services, token model). Só as contas de `js/config.js` entram.
- Nenhum segredo no repositório (o client_id OAuth é público). O app nunca publica nas redes.
- Referência visual e de textos: o protótipo aprovado (ver [`SPEC.md`](SPEC.md)).
- Contrato de nomes de arquivo com o motor: [`formatos-referencia.md`](formatos-referencia.md).

## Estrutura

```
index.html              casca única: véu, login, ilha/conteúdo/doca, janelas, avisos
manifest.webmanifest    PWA (id, start_url e scope "./", standalone, tema Noite #0F0809)
sw.js                   service worker: cache "motor-app-vN" só dos arquivos do app
css/app.css             visual do protótipo em rem (densidade: ver o comentário do topo)
icons/                  ícones gerados por tools/make_icons.py
vendor/xlsx.full.min.js SheetJS 0.20.3, carregado só ao ler a planilha .xlsx (fora do cache do SW)
js/
  main.js               início: escutas, tema, sessão retomada ou login, service worker
  config.js             client_id, escopos, contas, pastas, planilha, regras (CONFIG, nomeDe)
  integra.js            o ÚNICO módulo que fala com o mundo externo (usa auth/drive/sheet)
  auth.js               GIS, sessão em sessionStorage, renovação silenciosa, limpeza ao sair
  drive.js              Drive API v3 (listagens com cache, textos, blobs)
  sheet.js              planilha Radar: "data do post" (nativa ou .xlsx); abas Seleção, Decisões e
                        Execuções (só nativa): lerAba, acrescentarLinhas, atualizarCelula
  controle.js           controle manual (puro): aba Execuções, catálogo fechado de rotinas, trava,
                        janela de proteção, tempos, ids de execução e de lote, permissões
  selecao.js            pautas (puro): abas Seleção e Decisões, motivos, planejarDecisoes
  revisao.js            decisão da prévia em 4-Revisao (puro): planejarArquivoRevisao
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
                        downloads (arquivos dos pacotes), grafico, execucao (faixa de execução e
                        janelas "Rodar agora?"/"Detalhes" do controle manual)
  upload.js             envio retomável em pedaços (já testado), guardado para a etapa 2:
                        ainda não é importado pelo app nem está no cache do SW
tests/                  node --test (sem dependências), com fixtures/roteiros
tools/make_icons.py     gera os PNGs de icons/ (precisa do Pillow)
```

Rotas: `#/inicio #/pautas #/roteiros #/roteiros/<id> #/videos #/videos/<id> #/enviar #/enviar/<id>
#/prontos #/resultados` (são os links que o Diretor manda nos avisos).

## Etapas

**Etapa 1 (esta, só leitura: nada é gravado no Drive)**

- **Início**: pendências, gravação, ciclo e esteira da semana atual, com dados reais do Drive.
- **Roteiros**: lista com filtros e detalhe com as abas Instagram, TikTok, Extras e Fontes, nos
  dois formatos de roteiro (o novo, de parágrafos, e o antigo, com etiquetas). Teleprompter para
  os aprovados e gravados.
- **Vídeos**: os players tocam os arquivos reais das prévias de 4-Revisao. Cada vídeo é baixado
  inteiro pela Drive API (`files/{id}?alt=media` com o token) e tocado por uma URL de Blob, com
  progresso em %. No máximo 4 vídeos ficam guardados na sessão (ao sair da conta, todos são
  liberados). A linha do tempo usa a duração real; os pinos são os ajustes da sessão e, nas
  versões anteriores, os pedidos de `<id> ajustes vN.md`. "Copiar a lista" no lugar de enviar.
- **Enviar gravação**: escolha do roteiro e o passo a passo para pôr o vídeo em 3-Brutos pelo app
  do Google Drive com o nome `<id>.<extensão>`.
- **Prontos**: um cartão por pacote de 5-Prontos; copiar a legenda, baixar cada arquivo ou todos.
- **Pautas** e **Resultados**: "em breve", sem dado falso (na branch `controle-manual`, Pautas
  passa a funcionar e Resultados ganha a faixa da retrospectiva: ver abaixo).
- **Sair da conta**: botão redondo na ilha, ao lado do tema, a partir de 720px de largura
  (tablet e computador); no celular, link "Sair" junto da data do Início (a ilha não comporta mais
  um botão de 360 a 430px). Também na busca rápida. Sempre com a confirmação "Sair da conta?".
  Ao sair: o token é revogado e a seleção automática do Google é desligada (sem esperar resposta;
  sem GIS ou sem rede, sai do mesmo jeito); a renovação agendada ou pendente é cancelada (sem o
  aviso de sessão expirada) e nada relê o Drive nem renova sozinho; saem do sessionStorage e do
  localStorage todas as chaves `motor.*`/`motor-*`, **menos** `motor-tema` (o tema) e
  `motor.upload.*` (envios retomáveis); dados em memória, vídeos (URLs de Blob revogadas),
  downloads em andamento, estado das telas, rascunhos e a lista de ajustes são esquecidos; a tela
  volta para a entrada sem rota no endereço. O app não usa IndexedDB. O próximo "Entrar com
  Google" abre a escolha de conta (`prompt: 'select_account'`, sem `login_hint`).

**Etapa 2**: gravar no Drive. Aprovar/pedir mudança no roteiro; aprovar (`<id> aprovado.md`) ou
pedir ajustes (`<id> ajustes vN.md`) nas prévias; envio da gravação pelo app (`js/upload.js`);
"Postei" na aba Desempenho; ponte no Apps Script para avisar o Radar e o Roteirista.

**Etapa 3**: Pautas (abas Seleção e Decisões da planilha Radar) e Resultados (aba Desempenho).

## Controle manual (branch controle-manual)

Proposta completa: `PLANO.md` do controle manual (fora do repositório). Nenhuma tela nova: cada
etapa ganha no máximo uma **faixa de execução** de uma linha
(`[Radar diário] · última: hoje 7h12 · ok · média 14 min · [Rodar agora] [Detalhes]`), uma janela
de confirmação (`moldura()`) e avisos. O fluxo semanal não muda; o app nunca publica nas redes.

**O que existe**

- Regras puras: `js/controle.js` (aba Execuções, catálogo fechado de rotinas, trava, "parece
  travada", janela de proteção, tempos, ids, permissões, decisão de roteiro), `js/selecao.js`
  (Seleção e Decisões, primeira decisão vale, idempotência) e `js/revisao.js` (arquivo da prévia).
- `js/componentes/execucao.js`: a faixa, "Detalhes" (últimas linhas de Execuções) e "Rodar agora?"
  (o que roda e com o quê, o que produz e onde, tempo ou "ainda sem medição", custo, limites,
  conflitos, proteção e efeito no semanal). A `chave_idem` nasce quando a janela abre; o confirmar
  desabilita no toque.
- Execuções, Seleção e Decisões são lidas sob demanda (`js/dados.js`: `execucoesLidas`,
  `pautasLidas`), uma vez por sessão e de novo a cada "Atualizar", sem travar a tela.
- **Pautas**: faixas do Radar diário e da Seleção ("Fazer seleção agora", com o lote
  `S<sem>-manual-<n>` que vai nascer), filtros Para decidir / Decididas / Todas, cartão do desenho
  aprovado, Aprovar / Recusar (5 motivos + observação), "Confirmar decisões (n)" com o resultado por
  pauta, "Mudar decisão" (até a pauta ir ao Roteirista) e "Enviar ao Roteirista (n aprovadas)".
  Contador na navegação e cartão "Escolher as pautas da semana" no Início.
- **Roteiros** (rascunho): Aprovar / Pedir mudança / Recusar (tom, clareza, fundamentação, ética,
  desalinhamento) → `Integra.ponte.decidirRoteiro`; faixa da rotina do id e bloco Histórico.
- **Vídeos**: Aprovar grava `<id> aprovado.md` e "Enviar ajustes" grava `<id> ajustes vN.md` em
  4-Revisao (conferindo os nomes logo antes); "Copiar a lista" continua como ação secundária. Faixa
  do motor (só leitura) e o Histórico com as linhas de Execuções do id.
- **Resultados**: os números continuam "em breve"; a faixa "Fazer retrospectiva agora" fica no
  mesmo painel.
- Só a conta da Robertta (`ALLOWED[0]`) decide; a outra conta vê tudo, pode pedir rodadas (quando a
  ponte ligar) e vê os botões de decisão desabilitados com a nota. Ids T: selo "Teste"; nunca vão
  para Decisões.

**Flags** (`js/config.js`, `FLAGS`)

- `ponte: false` (e `PONTE_URL = ''`): "Rodar agora", "Enviar ao Roteirista" e a decisão de
  roteiro mostram a janela inteira, mas no lugar do confirmar aparece "O disparo pelo app ainda
  não está ligado. Por enquanto, peça ao bot no chat." (ou "responda ao Roteirista no chat").
- `decisoesPeloApp: true`: grava as decisões de pauta em Decisões e o status na Seleção.
- `revisaoPeloApp: true`: grava a decisão da prévia em 4-Revisao; `false` volta ao "Copiar a lista".

**O que falta (fora do app)**

- CM-01 / CM-02: criar na planilha Radar a aba **Execuções** e as colunas novas de **Decisões**
  (`id_pauta, rede, id_candidato, id_lote, data, quem, origem`, no fim). Até lá: "ainda sem
  registro" nas faixas e decidir pautas desligado, com a explicação. A aba **Seleção** também
  precisa existir (o Radar grava as pautas nela, CM-03); sem ela, a tela de Pautas diz isso.
- CM-05: a ponte no Apps Script (token, lista de e-mails, rotinas, `LockService`, `chave_idem`,
  janela de proteção, Execuções). Depois, `FLAGS.ponte = true` e `PONTE_URL`.
- CM-03 / CM-04 / CM-09 / CM-12: as rotinas por webhook do Radar (diário e seleção manuais,
  enviar ao Roteirista), do Roteirista (decisão do app) e do Diretor (retrospectiva agora).
- CM-13 / CM-14: o motor publicando o andamento em `_motor/` e a importação para Execuções
  (bot = motor). Até lá, a faixa do motor diz "o motor ainda não publica o andamento no app".

**Versão do cache:** esta branch subiu para `motor-app-v6` (`sw.js` e `js/main.js`). A correção do
Sair na `main` também mexe nessa versão: no merge, **reconcilie** e use um número acima dos dois.

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

Node 22+ (com um diretório, o `--test` carrega `tests/index.js`, que importa todos os testes).
Cobrem o leitor de roteiro (paridade com o `roteiro.py`), as regras de etapa, o mapeamento puro
projeto + roteiro → objeto das telas (`montarRoteiro`), as funções puras de `js/parse.js` e
`js/model.js` (nomes de arquivo, YAML, datas, pedido de ajustes, horários do pacote), as partes
puras do `js/upload.js`, o "Sair" (`tests/sair.test.mjs`: chaves apagadas e mantidas, GIS ausente
ou com erro, renovação cancelada, escolha de conta no login seguinte), o controle manual
(`tests/controle.test.mjs`, `selecao.test.mjs`, `revisao.test.mjs`: Execuções, trava, janela de
proteção, tempos, lotes, permissões, decisões de pauta e de prévia, ponte desligada), as telas do
controle manual sem DOM (`tests/telas.test.mjs`: faixa, janela "Rodar agora?" a partir do
catálogo, Detalhes, Pautas com conteúdo malicioso escapado, contagem, conta que não decide,
estados honestos, decisão de roteiro, janela da prévia, Histórico) e o PWA (`tests/sw.test.mjs`: todo arquivo da lista do `sw.js` existe,
todo módulo do app está nela, versão do cache igual à do `js/main.js`, manifest, nenhum caminho
para fora da raiz).

## Publicar

O GitHub Pages publica a raiz da branch `main` em `https://motor.rocambrea.com/` (o domínio está
nas configurações do Pages, não num arquivo CNAME). O `.nojekyll` impede o processamento pelo Jekyll.

1. Rode `node --test tests/`.
2. **Aumente a versão do cache** em `sw.js` (`VERSAO`, hoje `motor-app-v6` → `motor-app-v7`…) e, igual,
   em `js/main.js` (`VERSAO_APP`); o teste confere que as duas batem. É a mudança no `sw.js` que
   faz o navegador instalar o SW novo e o app aberto mostrar "Nova versão do app. Toque para
   atualizar.". Se criar um arquivo novo do app, inclua-o na lista `ARQUIVOS` do `sw.js` (o teste
   avisa se faltar um módulo ou se a lista apontar para um arquivo que não existe).
3. Commit e push na `main`. O Pages publica em um ou dois minutos.

### Quem já tinha o app instalado

O app instalado no iPhone continua o mesmo (mesmo endereço, `start_url`/`scope`/`id` `./`), então
não precisa reinstalar. Na próxima abertura com internet, o navegador vê que o `sw.js` mudou e
instala o novo: ele assume na hora (`skipWaiting` + `clients.claim`) e apaga os caches antigos
(`motor-shell-` do app anterior, `motor-novo-` da prévia e versões anteriores de `motor-app-`).
O SW busca a navegação e os arquivos do app na rede primeiro, sem o cache HTTP; o cache do SW só
serve sem internet.
