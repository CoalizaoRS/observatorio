#!/bin/bash
# Pipeline de indicadores com o RAG local, num único job (o cluster permite 1 job por usuário):
#   texto    extrai texto dos PLANCONs (CPU, com OCR)      -> Garage rag-cache/texto/
#   indice   trechos + embeddings por município (GPU)      -> Garage rag-cache/indice/
#   extrair  npm run extrair com RAG_PROVIDER=local (GPU)  -> Garage rag-cache/indicadores/
# Cada etapa reaproveita o que já está no Garage, então o job pode ser reenviado após falha.
#
# Uso (no nó de login, a partir de ~/observatorio-rag — o job roda no diretório de submissão):
#   sbatch --export=ALL,LISTA=rag-local/listas/controle.txt ~/observatorio-rag/rag-local/slurm/rodar.sbatch
#   variáveis opcionais: ETAPAS=texto+indice+extrair  FORCE=1 (refaz indicadores já gerados)
#                        INDICADORES=P2+P6 (só esses; os demais do JSON são mantidos)
#                        CHAT_MODEL=<arquivo .gguf> CHAT_REPO=<repo HF> SAIDA=<prefixo>  (teste de outro modelo)
#   (use + entre etapas: o --export do sbatch separa variáveis por vírgula)
#SBATCH --job-name=rag-indicadores
#SBATCH --partition=LAD_geral
#SBATCH --exclude=pantanal02
#SBATCH --nodes=1
#SBATCH --cpus-per-task=12
#SBATCH --mem=48G
#SBATCH --time=2-00:00:00
#SBATCH --output=logs/%x.%j.out

set -euo pipefail

CHAT_MODEL=${CHAT_MODEL:-Qwen3-8B-Q4_K_M.gguf}
CHAT_REPO=${CHAT_REPO:-Qwen/Qwen3-8B-GGUF}   # baixado do Hugging Face se ainda não estiver no Garage
SAIDA=${SAIDA:-indicadores}               # prefixo dos resultados no Garage (testes de modelo usam outro)
EMB_MODEL=Qwen3-Embedding-0.6B-Q8_0.gguf
CHAT_SLOTS=${CHAT_SLOTS:-2}                      # requisições simultâneas (12k tokens de contexto cada)
ETAPAS=${ETAPAS:-texto+indice+extrair}; ETAPAS=${ETAPAS//+/,}
LISTA=${LISTA:?defina LISTA=<arquivo com um município por linha>}

RAG=$HOME/observatorio-rag
TMP=/tmp/rag-$USER-$SLURM_JOB_ID
CACHE=$TMP/cache
PY=$RAG/venv/bin/python
SYNC="$PY $RAG/rag-local/s3sync.py"
export PATH=$RAG/bin:$RAG/node/bin:$PATH TESSDATA_PREFIX=$RAG/tessdata
mkdir -p "$CACHE" "$TMP/models"

PIDS=()
encerrar() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap encerrar EXIT

etapa() { [[ ",$ETAPAS," == *",$1,"* ]]; }
CIDADES=$(paste -sd, "$RAG/$LISTA")

sobe_servidor() {  # sobe_servidor <porta> <log> <args...>; espera ficar saudável
  local porta=$1 log=$2; shift 2
  llama-server --host 127.0.0.1 --port "$porta" -ngl 99 "$@" >"$log" 2>&1 &
  PIDS+=($!)
  for _ in $(seq 120); do curl -sf "http://127.0.0.1:$porta/health" >/dev/null && return 0; sleep 2; done
  echo "llama-server na porta $porta não subiu:"; tail -20 "$log"; exit 1
}

echo "== $(date -Is) nó $(hostname), etapas: $ETAPAS, lista: $LISTA ($(wc -l <"$RAG/$LISTA") municípios)"
USO=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1)
if [ "$USO" -gt 500 ]; then
  echo "GPU já em uso por outro processo (${USO} MiB) — abortando para não disputar a M40."
  nvidia-smi; exit 2
fi

# --- texto (CPU) -------------------------------------------------------------
$SYNC pull rag-cache texto "$CACHE/texto"
if etapa texto; then
  $PY "$RAG/rag-local/ingestao.py" texto --cache "$CACHE" --cidades "$CIDADES" --procs "$SLURM_CPUS_PER_TASK"
  $SYNC push "$CACHE/texto" rag-cache texto
fi

# --- índice (GPU, modelo de embeddings) ---------------------------------------
$SYNC pull rag-cache indice "$CACHE/indice"
if etapa indice; then
  $SYNC get rag-cache "models/$EMB_MODEL" "$TMP/models/$EMB_MODEL"
  sobe_servidor 8091 "$TMP/emb.log" -m "$TMP/models/$EMB_MODEL" --embedding --pooling last -c 8192 -b 4096 -ub 4096
  $PY "$RAG/rag-local/ingestao.py" indice --cache "$CACHE" --cidades "$CIDADES" --emb-url http://127.0.0.1:8091
  $SYNC push "$CACHE/indice" rag-cache indice
fi

# --- extração dos indicadores (GPU, embeddings + chat) -------------------------
if etapa extrair; then
  [ -f "$TMP/models/$EMB_MODEL" ] || $SYNC get rag-cache "models/$EMB_MODEL" "$TMP/models/$EMB_MODEL"
  curl -sf http://127.0.0.1:8091/health >/dev/null || \
    sobe_servidor 8091 "$TMP/emb.log" -m "$TMP/models/$EMB_MODEL" --embedding --pooling last -c 8192 -b 4096 -ub 4096
  if ! $SYNC exists rag-cache "models/$CHAT_MODEL"; then
    curl -fsSL -o "$TMP/models/$CHAT_MODEL" "https://huggingface.co/$CHAT_REPO/resolve/main/$CHAT_MODEL"
    $SYNC put "$TMP/models/$CHAT_MODEL" rag-cache "models/$CHAT_MODEL"
  fi
  [ -f "$TMP/models/$CHAT_MODEL" ] || $SYNC get rag-cache "models/$CHAT_MODEL" "$TMP/models/$CHAT_MODEL"
  sobe_servidor 8090 "$TMP/chat.log" -m "$TMP/models/$CHAT_MODEL" --jinja -c $((12288 * CHAT_SLOTS)) -np "$CHAT_SLOTS"
  nvidia-smi --query-gpu=memory.used,memory.total --format=csv

  cd "$RAG/backend"
  [ -d node_modules ] || npm ci --no-audit --no-fund
  rm -rf indicadores; mkdir -p indicadores   # sem sobras de outra rodada/modelo
  $SYNC pull rag-cache "$SAIDA" indicadores
  RAG_PROVIDER=local RAG_INDEX_DIR="$CACHE/indice" RAG_CHAT_MODEL="${CHAT_MODEL%.gguf}" \
    npm run extrair -- --cidades-arquivo "$RAG/$LISTA" --conc "$CHAT_SLOTS" ${FORCE:+--force} \
    ${INDICADORES:+--indicadores "${INDICADORES//+/,}"}
  $SYNC push indicadores rag-cache "$SAIDA"
fi

echo "== $(date -Is) concluído"
