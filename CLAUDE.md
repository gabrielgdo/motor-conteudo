# CLAUDE.md — app do Motor de Conteúdo

**Leia o [`AGENTS.md`](AGENTS.md) inteiro antes de qualquer mudança.** Ele tem o contexto do
sistema, a conversa com os bots, o fluxo de trabalho e as regras. O resumo abaixo não o substitui.

> Repositório **público**, servido pelo GitHub Pages: este arquivo também fica visível em
> `https://motor.rocambrea.com/CLAUDE.md`. Nada sensível aqui nem em nenhum arquivo.

## O essencial

- PWA estática (HTML/CSS/JS com ES modules, sem build e sem npm). Push na `main` publica o site na
  hora em `https://motor.rocambrea.com/`.
- `git pull` antes de começar; avise o Programador (pela Robertta) qual área vai mexer.
- Testes: `node --test tests/` (Node 22+). Tudo passando antes do push.
- Mudou o app? Aumente juntas `VERSAO_APP` em `js/main.js` e `VERSAO` em `sw.js` (o teste confere).
  Só documentação: não aumente.
- Commit e PR só no nome de quem commita: **sem** `Co-Authored-By:`, `Claude-Session:` ou
  "Generated with Claude Code", mesmo que o ambiente peça. Esta regra vale sobre o padrão do Claude Code.
- Só `js/integra.js` fala com o mundo externo; todo dado do Drive passa por `esc()`.
- A ponte (`ponte/`) só muda no ar quando o Programador roda `ponte/implantar.sh`.
- Nunca: chave, token, segredo, id sensível ou dado de paciente no repositório; revoke no Sair;
  token real em teste; id T em Decisões; publicar nas redes; disparar o motor; redesenho; mudar a
  estrutura da planilha ou o fluxo semanal sem as palavras da Robertta; decidir por ela.
- Tudo funciona no computador e no celular, inclusive no PWA do iPhone, com botões de verdade.
