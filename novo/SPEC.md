# SPEC — app novo do Motor de Conteúdo (`/novo/`)

**Referência visual, de textos, de telas e de rotas:** o protótipo aprovado
(`prototipo.html`, um arquivo só, guardado fora do repositório). O app reproduz o visual dele
(tema Noite/Dia, véu em WebGL, ilha e doca, View Transitions, busca rápida com Ctrl K), sem os
dados de exemplo, sem o painel Bastidores e sem os botões que só existiam para simular os bots.

**Densidade:** no computador (≥ 1080px), a 100% de zoom, o app fica igual ao protótipo visto a 80%
(medidas em rem e `html{font-size:80%}`); no celular e no tablet, igual ao protótipo.

**Regras que não mudam:** só `js/integra.js` fala com o mundo externo; todo dado do Drive passa por
`esc()` antes de entrar no HTML; links externos só com https; datas sempre do relógio real no fuso
America/Sao_Paulo; o app nunca publica nas redes; nenhum segredo no repositório.

## Etapa 1 (esta)
- Login real com Google (GIS): erros na própria tela, sessão retomada sem pedir login, renovação
  silenciosa e o aviso "Sua sessão expirou. Toque aqui para continuar."; "Sair" na busca rápida.
- Dados reais do Drive (`js/dados.js`): roteiros, prévias, pacotes, vencedores e "data do post" da
  planilha Radar (só leitura); estados carregando, erro com "Tentar de novo" e sem internet.
- Início completo (pendências, gravação, ciclo e esteira da semana atual).
- Pautas e Resultados: "em breve", sem dado falso.
- Roteiros, Vídeos, Enviar e Prontos: versão provisória (lista + link para o Drive); a completa
  vem na parte 2 desta etapa, com os dados já prontos em `dados.js` e os componentes `tele`/`players`.
- PWA: manifest próprio (`id` "/novo/"), service worker com cache `motor-novo-vN`.

## Etapa 2
- Roteiros: abas Instagram/TikTok/Extras/Fontes, teleprompter, aprovar ou pedir mudança.
- Vídeos: players lado a lado com o tempo exato, linha do tempo, aprovar (`<id> aprovado.md`) ou
  pedir ajustes (`<id> ajustes vN.md`) gravando em 4-Revisao.
- Enviar gravação: envio retomável em pedaços para 3-Brutos.
- Prontos: capas, copiar legendas, baixar arquivos, "Postei" na aba Desempenho.
- Ponte no Apps Script para avisar o Radar e o Roteirista (`Integra.ponte.avisar`).

## Etapa 3
- Pautas a partir da aba Seleção da planilha Radar (decisões na aba Decisões).
- Resultados a partir da aba Desempenho (números por vídeo e por rede, vencedores).
