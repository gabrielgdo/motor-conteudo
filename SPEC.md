# SPEC — app do Motor de Conteúdo

**Referência visual, de textos, de telas e de rotas:** o protótipo aprovado
(`prototipo.html`, um arquivo só, guardado fora do repositório). O app reproduz o visual dele
(tema Noite/Dia, véu em WebGL, ilha e doca, View Transitions, busca rápida com Ctrl K), sem os
dados de exemplo, sem o painel Bastidores e sem os botões que só existiam para simular os bots.

**Densidade:** no computador (≥ 1080px), a 100% de zoom, o app fica igual ao protótipo visto a 80%
(medidas em rem e `html{font-size:80%}`); no celular e no tablet, igual ao protótipo.

**Regras que não mudam:** só `js/integra.js` fala com o mundo externo; todo dado do Drive passa por
`esc()` antes de entrar no HTML; links externos só com https; datas sempre do relógio real no fuso
America/Sao_Paulo; o app nunca publica nas redes; nenhum segredo no repositório.

**Publicação:** raiz da branch `main` em `https://motor.rocambrea.com/`, no lugar do app antigo.
PWA com `id`/`start_url`/`scope` `./` (a mesma identidade do app já instalado) e service worker
com cache `motor-app-vN` (rede primeiro, reserva offline, nunca Drive/Sheets nem outra origem).

## Etapa 1 (esta: só leitura)
- Login real com Google (GIS), sessão retomada, renovação silenciosa e o aviso de sessão expirada.
- Dados reais do Drive e "data do post" da planilha Radar; estados carregando, erro e sem internet.
- Início, Roteiros (abas e teleprompter), Vídeos (players com os arquivos reais e linha do tempo),
  Enviar gravação (passo a passo pelo app do Drive) e Prontos (legendas e downloads).
- Pautas e Resultados: "em breve".

## Etapa 2 (gravar no Drive)
- Roteiros: aprovar ou pedir mudança.
- Vídeos: aprovar (`<id> aprovado.md`) ou pedir ajustes (`<id> ajustes vN.md`) em 4-Revisao.
- Enviar gravação: envio retomável em pedaços para 3-Brutos (`js/upload.js`).
- Prontos: "Postei" na aba Desempenho.
- Ponte no Apps Script para disparar o Radar, o Roteirista e o Diretor (`Integra.ponte.disparar`,
  `Integra.ponte.decidirRoteiro`), atrás de `FLAGS.ponte` e `PONTE_URL` (`js/config.js`).

## Controle manual (branch controle-manual)
- Sem tela nova: faixa de execução de uma linha (`js/componentes/execucao.js`), janela de
  confirmação com custos e limites (`moldura()`) e avisos. Ver o README.
- Pautas (Seleção/Decisões) e decisões de prévia em 4-Revisao já gravam; disparos e decisão de
  roteiro ficam atrás de `FLAGS.ponte` (desligada: a janela explica e manda pedir no chat).

## Etapa 3
- Pautas a partir das abas Seleção e Decisões da planilha Radar.
- Resultados a partir da aba Desempenho (números por vídeo e por rede, vencedores).
