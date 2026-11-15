#!/usr/bin/env bash
# Implantação da ponte como app da Web do Apps Script, pela conta da Robertta (clasp 3).
# Nenhum segredo neste arquivo nem no repositório: as URLs e chaves dos webhooks são lidas de
# ~/.config/motor-pwa/webhooks.env (600) só dentro do node abaixo e vão direto, por HTTPS, para a
# ação de uso único `configurar` da ponte. Nada é impresso além dos NOMES das propriedades gravadas.
#
# Etapas (rode na ordem):
#   ./implantar.sh criar        cria o projeto (standalone), gera Setup.gs (hash de um código de uso
#                               único), envia os arquivos e cria a implantação (app da Web)
#   [Robertta, no navegador: abrir o editor (link impresso), escolher a função "autorizar", Executar
#    e aceitar os escopos (planilhas e chamadas externas)]
#   ./implantar.sh configurar   grava as propriedades do script pela ação `configurar`, apaga o
#                               Setup.gs, reenvia e atualiza a MESMA implantação (a URL não muda)
#   ./implantar.sh url          mostra a URL /exec (vai em PONTE_URL, js/config.js)
#
# Pré-requisitos (só a Robertta): ativar a Apps Script API em https://script.google.com/home/usersettings
# e fazer `clasp login --no-localhost` com a conta dela.
set -euo pipefail
umask 077

AQUI="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$AQUI/.." && pwd)"
TRAB="${PONTE_TRAB:-$HOME/.config/motor-pwa/ponte-deploy}"   # fora do repo
WEBHOOKS_ENV="${WEBHOOKS_ENV:-$HOME/.config/motor-pwa/webhooks.env}"
TITULO="Ponte Motor de Conteúdo"

mkdir -p "$TRAB"
cd "$TRAB"

copiar_fontes() {
  cp "$AQUI/Code.gs" "$TRAB/Code.gs"
  cp "$AQUI/appsscript.json" "$TRAB/appsscript.json"
  printf '%s\n' '**/*' '!Code.gs' '!Setup.gs' '!appsscript.json' > "$TRAB/.claspignore"
}

id_implantacao() { cat "$TRAB/deployment_id" 2>/dev/null || true; }

case "${1:-}" in
  criar)
    command -v clasp >/dev/null || { echo "Falta o clasp (npm i -g @google/clasp)"; exit 1; }
    copiar_fontes
    if [ ! -f "$TRAB/.clasp.json" ]; then
      clasp create-script --type standalone --title "$TITULO" --rootDir "$TRAB" >/dev/null
      copiar_fontes   # o create pode reescrever o appsscript.json
    fi
    # Código de uso único: só o hash vai para o Setup.gs; o código fica em arquivo 600 fora do repo.
    node -e '
      const c = require("crypto"), fs = require("fs");
      const codigo = c.randomBytes(32).toString("hex");
      fs.writeFileSync(process.argv[1], codigo, { mode: 0o600 });
      const h = c.createHash("sha256").update(codigo).digest("hex");
      fs.writeFileSync(process.argv[2], "// Gerado por implantar.sh; apagado depois da configuração.\nconst PONTE_SETUP_HASH = \x27" + h + "\x27;\n");
    ' "$TRAB/codigo_setup" "$TRAB/Setup.gs"
    clasp push -f >/dev/null
    if [ -z "$(id_implantacao)" ]; then
      clasp create-deployment --description "ponte v1" --json > "$TRAB/deploy.json"
      node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const id=j.deploymentId||(j.deployment&&j.deployment.deploymentId)||"";if(!id)process.exit(1);require("fs").writeFileSync(process.argv[2],id)' "$TRAB/deploy.json" "$TRAB/deployment_id" \
        || { echo "Não achei o deploymentId: rode clasp list-deployments e grave em $TRAB/deployment_id"; exit 1; }
    else
      clasp update-deployment "$(id_implantacao)" --description "ponte (setup)" >/dev/null
    fi
    SID="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".clasp.json","utf8")).scriptId)')"
    echo "Projeto criado e implantado."
    echo "Editor (Robertta roda a função autorizar uma vez): https://script.google.com/d/$SID/edit"
    echo "URL da ponte: https://script.google.com/macros/s/$(id_implantacao)/exec"
    ;;

  configurar)
    [ -f "$TRAB/Setup.gs" ] && [ -f "$TRAB/codigo_setup" ] || { echo "Rode antes: ./implantar.sh criar"; exit 1; }
    [ -f "$WEBHOOKS_ENV" ] || { echo "Falta $WEBHOOKS_ENV"; exit 1; }
    URL="https://script.google.com/macros/s/$(id_implantacao)/exec"
    # Monta o corpo e faz o POST dentro do node: nenhum valor passa por argumento, eco ou log.
    REPO="$REPO" WEBHOOKS_ENV="$WEBHOOKS_ENV" CODIGO_ARQ="$TRAB/codigo_setup" URL="$URL" node -e '
      const fs = require("fs");
      const env = {};
      for (const l of fs.readFileSync(process.env.WEBHOOKS_ENV, "utf8").split(/\r?\n/)) {
        const m = l.match(/^\s*([a-z_]+)\s*=\s*(.*?)\s*$/); if (!m) continue;
        env[m[1]] = m[2].replace(/^["\x27]|["\x27]$/g, "");
      }
      const cfg = fs.readFileSync(process.env.REPO + "/js/config.js", "utf8");
      const allowed = JSON.parse(cfg.match(/export const ALLOWED\s*=\s*(\[[^\]]*\])/)[1].replace(/\x27/g, "\""));
      const clientId = cfg.match(/export const CLIENT_ID\s*=\s*\x27([^\x27]+)\x27/)[1];
      const planilha = cfg.match(/export const RADAR_SHEET\s*=\s*\x27([^\x27]+)\x27/)[1];
      const props = {
        PLANILHA_ID: planilha, CLIENT_ID: clientId,
        EMAILS_DECIDIR: allowed[0], EMAILS_DISPARAR: allowed.join(","),
        ABA_EXECUCOES: "Execuções", LIMITE_POR_HORA: "4",
        WEBHOOK_DIRETOR_URL: env.diretor_url, WEBHOOK_DIRETOR_KEY: env.diretor_key,
      };
      // Radar e Roteirista saíram: só entra o que ainda existir no env (não aborta se faltar).
      if (env.radar_url && env.radar_key) { props.WEBHOOK_RADAR_URL = env.radar_url; props.WEBHOOK_RADAR_KEY = env.radar_key; }
      if (env.roteirista_url && env.roteirista_key) { props.WEBHOOK_ROTEIRISTA_URL = env.roteirista_url; props.WEBHOOK_ROTEIRISTA_KEY = env.roteirista_key; }
      const falta = Object.keys(props).filter((k) => !props[k]);
      if (falta.length) { console.log("Faltam valores para: " + falta.join(", ")); process.exit(1); }
      const corpo = JSON.stringify({ acao: "configurar", codigo: fs.readFileSync(process.env.CODIGO_ARQ, "utf8").trim(), propriedades: props });
      fetch(process.env.URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: corpo, redirect: "follow" })
        .then(async (r) => {
          let j = null; try { j = JSON.parse(await r.text()); } catch {}
          if (!j || j.ok !== true) {
            console.log("A ponte recusou a configuração (HTTP " + r.status + "): " + (j ? (j.codigo || "") + " " + (j.mensagem || "") : "resposta não JSON — a Robertta já rodou autorizar no editor?"));
            process.exit(1);
          }
          console.log("Propriedades gravadas: " + (j.gravadas || []).join(", "));
        })
        .catch(() => { console.log("Sem conexão com a ponte."); process.exit(1); });
    '
    # Fecha a porta da configuração: apaga o Setup.gs e o código, reenvia e atualiza a mesma implantação.
    rm -f "$TRAB/Setup.gs" "$TRAB/codigo_setup"
    copiar_fontes
    clasp push -f >/dev/null
    clasp update-deployment "$(id_implantacao)" --description "ponte v1" >/dev/null
    echo "Setup removido e implantação atualizada: $URL"
    ;;

  url)
    echo "https://script.google.com/macros/s/$(id_implantacao)/exec" ;;

  *)
    sed -n '2,20p' "$0"; exit 1 ;;
esac
