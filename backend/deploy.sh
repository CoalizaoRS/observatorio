#!/usr/bin/env bash
#
# deploy.sh — pipeline completo de publicação dos indicadores + backend.
#
# Encadeia:
#   1. npm run consolidar        (gera indicadores/_consolidado/*.csv)         [--skip-consolidar]
#   2. ./publicar-csv.sh         (sincroniza dados/csv e sobe ao Blob público)  [--skip-publish]
#   3. docker buildx build+push  (imagem linux/amd64 no ACR, próxima tag vN)     [--skip-build]
#   4. az containerapp update    (aponta o Container App para a nova imagem)     [--skip-deploy]
#   5. smoke test                (/health e /api/csv na URL pública)
#
# Pré-requisitos: az CLI logado (`az login`) e Docker em execução.
#
# Uso:
#   ./deploy.sh                       # pipeline completo, tag auto-incrementada
#   ./deploy.sh --tag v9              # força a tag da imagem
#   ./deploy.sh --skip-consolidar     # pula a reconsolidação dos CSVs
#   ./deploy.sh --skip-build --skip-deploy   # só consolida e publica no Blob
#
set -euo pipefail

# --- Configuração (sobrescrevível por env) ---------------------------------
RG="${RG:-CoalizãoRS}"
ACR="${ACR:-observatorioragacr}"
IMAGE="${IMAGE:-observatorio-backend}"
APP="${APP:-observatorio-backend}"
ACR_LOGIN="${ACR}.azurecr.io"

SKIP_CONSOLIDAR=0; SKIP_PUBLISH=0; SKIP_BUILD=0; SKIP_DEPLOY=0
TAG_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-consolidar) SKIP_CONSOLIDAR=1 ;;
    --skip-publish)    SKIP_PUBLISH=1 ;;
    --skip-build)      SKIP_BUILD=1 ;;
    --skip-deploy)     SKIP_DEPLOY=1 ;;
    --tag)             TAG_OVERRIDE="$2"; shift ;;
    *) echo "argumento desconhecido: $1" >&2; exit 2 ;;
  esac
  shift
done

BACK_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BACK_DIR"

log() { printf '\n\033[1;36m[deploy]\033[0m %s\n' "$*"; }

# --- 1. Consolidar ---------------------------------------------------------
if [[ $SKIP_CONSOLIDAR -eq 0 ]]; then
  log "1/5 Consolidando CSVs (npm run consolidar)…"
  npm run --silent consolidar
else
  log "1/5 Consolidação pulada (--skip-consolidar)."
fi

# --- 2. Publicar no Blob ---------------------------------------------------
if [[ $SKIP_PUBLISH -eq 0 ]]; then
  log "2/5 Publicando CSVs no Blob público (./publicar-csv.sh)…"
  RG="$RG" ./publicar-csv.sh
else
  log "2/5 Publicação no Blob pulada (--skip-publish)."
fi

# --- Descobrir a próxima tag de imagem -------------------------------------
if [[ -n "$TAG_OVERRIDE" ]]; then
  TAG="$TAG_OVERRIDE"
else
  CURRENT_IMG="$(az containerapp show -n "$APP" -g "$RG" \
    --query 'properties.template.containers[0].image' -o tsv)"
  CURTAG="${CURRENT_IMG##*:}"           # ex.: v8
  if [[ "$CURTAG" =~ ^v([0-9]+)$ ]]; then
    TAG="v$(( ${BASH_REMATCH[1]} + 1 ))"
  else
    echo "Não consegui inferir a tag a partir de '$CURTAG'. Use --tag vN." >&2
    exit 1
  fi
  log "Imagem atual: $CURRENT_IMG  →  nova tag: $TAG"
fi

REF="${ACR_LOGIN}/${IMAGE}:${TAG}"

# --- 3. Build + push (linux/amd64) -----------------------------------------
if [[ $SKIP_BUILD -eq 0 ]]; then
  log "3/5 Build+push da imagem $REF (linux/amd64)…"
  az acr login -n "$ACR"
  docker buildx build --platform linux/amd64 -t "$REF" --push .
else
  log "3/5 Build pulado (--skip-build)."
fi

# --- 4. Update do Container App --------------------------------------------
if [[ $SKIP_DEPLOY -eq 0 ]]; then
  log "4/5 Atualizando Container App '$APP' → ${REF}…"
  az containerapp update -n "$APP" -g "$RG" --image "$REF" \
    --query '{revisao:properties.latestRevisionName, imagem:properties.template.containers[0].image}' -o json
else
  log "4/5 Deploy pulado (--skip-deploy)."
fi

# --- 5. Smoke test ---------------------------------------------------------
FQDN="$(az containerapp show -n "$APP" -g "$RG" \
  --query 'properties.configuration.ingress.fqdn' -o tsv)"

if [[ $SKIP_DEPLOY -eq 0 && -n "$FQDN" ]]; then
  log "5/5 Smoke test em https://$FQDN …"
  # aguarda a nova revisão responder (até ~60s)
  for i in $(seq 1 20); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "https://$FQDN/health" || true)"
    [[ "$code" == "200" ]] && break
    sleep 3
  done
  h="$(curl -s -o /dev/null -w '%{http_code}' "https://$FQDN/health" || true)"
  c="$(curl -s -o /dev/null -w '%{http_code}' "https://$FQDN/api/csv" || true)"
  r="$(curl -s -o /dev/null -w '%{http_code}' "https://$FQDN/api/csv/_resumo.csv" || true)"
  echo "   /health=$h  /api/csv=$c  /api/csv/_resumo.csv=$r"
  if [[ "$h" == "200" && "$c" == "200" && "$r" == "200" ]]; then
    log "✅ Deploy OK. URL: https://$FQDN"
  else
    echo "   ⚠️  Alguma rota não respondeu 200 — verifique a revisão." >&2
    exit 1
  fi
else
  log "5/5 Smoke test pulado."
fi
