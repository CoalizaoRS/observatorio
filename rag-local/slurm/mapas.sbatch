#!/bin/bash
# P4: leitura dos mapas de "Rota de fuga" com o Gemma 3 multimodal (só GPU; sem servidor de embeddings).
#   sbatch ~/observatorio-rag/rag-local/slurm/mapas.sbatch
# Resultado: Garage rag-cache/p4-mapas/<Município>.json
#SBATCH --job-name=rag-mapas
#SBATCH --partition=LAD_geral
#SBATCH --exclude=pantanal02
#SBATCH --nodes=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=06:00:00
#SBATCH --output=logs/%x.%j.out

set -euo pipefail

CHAT_MODEL=gemma-3-12b-it-Q4_K_M.gguf
MMPROJ=gemma-3-12b-it-mmproj-f16.gguf
REPO=ggml-org/gemma-3-12b-it-GGUF
ALVOS=${ALVOS:-rag-local/listas/p4_mapas.json}

RAG=$HOME/observatorio-rag
TMP=/tmp/rag-$USER-$SLURM_JOB_ID
PY=$RAG/venv/bin/python
SYNC="$PY $RAG/rag-local/s3sync.py"
export PATH=$RAG/bin:$PATH
mkdir -p "$TMP/models" "$TMP/saida"
PID=
trap '[ -n "$PID" ] && kill $PID 2>/dev/null; rm -rf "$TMP"' EXIT

echo "== $(date -Is) nó $(hostname)"
USO=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1)
[ "$USO" -gt 500 ] && { echo "GPU já em uso (${USO} MiB) — abortando"; exit 2; }

$SYNC get rag-cache "models/$CHAT_MODEL" "$TMP/models/$CHAT_MODEL"
if ! $SYNC exists rag-cache "models/$MMPROJ"; then
  curl -fsSL -o "$TMP/models/$MMPROJ" "https://huggingface.co/$REPO/resolve/main/mmproj-model-f16.gguf"
  $SYNC put "$TMP/models/$MMPROJ" rag-cache "models/$MMPROJ"
fi
[ -f "$TMP/models/$MMPROJ" ] || $SYNC get rag-cache "models/$MMPROJ" "$TMP/models/$MMPROJ"

llama-server --host 127.0.0.1 --port 8090 -ngl 99 -m "$TMP/models/$CHAT_MODEL" --mmproj "$TMP/models/$MMPROJ" \
  --jinja -c 8192 -np 1 >"$TMP/chat.log" 2>&1 &
PID=$!
for _ in $(seq 120); do curl -sf http://127.0.0.1:8090/health >/dev/null && break; sleep 2; done
curl -sf http://127.0.0.1:8090/health >/dev/null || { echo "llama-server não subiu:"; tail -20 "$TMP/chat.log"; exit 1; }
nvidia-smi --query-gpu=memory.used,memory.total --format=csv

$PY "$RAG/rag-local/mapas_p4.py" --alvos "$RAG/$ALVOS" --saida "$TMP/saida"
$SYNC push "$TMP/saida" rag-cache p4-mapas
echo "== $(date -Is) concluído"
