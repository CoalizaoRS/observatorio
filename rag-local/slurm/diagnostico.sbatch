#!/bin/bash
# P11: leitura do Diagnóstico do Município (Defesa Civil) com o Gemma 3 multimodal (só GPU).
#   sbatch ~/observatorio-rag/rag-local/slurm/diagnostico.sbatch  (PDFs em ~/observatorio-rag/p11-entrada)
# Resultado: ~/observatorio-rag/p11-saida/<arquivo>.json (sem dados pessoais)
#SBATCH --job-name=rag-p11
#SBATCH --partition=LAD_geral
#SBATCH --exclude=pantanal02
#SBATCH --nodes=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=48G
#SBATCH --time=02:00:00
#SBATCH --output=logs/%x.%j.out

set -euo pipefail

CHAT_MODEL=gemma-3-12b-it-Q4_K_M.gguf
MMPROJ=gemma-3-12b-it-mmproj-f16.gguf
REPO=ggml-org/gemma-3-12b-it-GGUF
ENTRADA=${ENTRADA:-$HOME/observatorio-rag/p11-entrada}

RAG=$HOME/observatorio-rag
# /tmp dos nós às vezes está cheio: usa /dev/shm (RAM) se faltar espaço
livre() { df -BG --output=avail "$1" 2>/dev/null | tail -1 | tr -dc 0-9; }
BASE=/tmp; [ "$(livre /tmp)" -ge 12 ] 2>/dev/null || BASE=/dev/shm
echo "/tmp livre: $(livre /tmp)G; /dev/shm livre: $(livre /dev/shm)G; usando $BASE"
TMP=$BASE/rag-$USER-$SLURM_JOB_ID
PY=$RAG/venv/bin/python
SYNC="$PY $RAG/rag-local/s3sync.py"
export PATH=$RAG/bin:$PATH TESSDATA_PREFIX=$RAG/tessdata
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

$PY "$RAG/rag-local/diagnostico_dc.py" --entrada "$ENTRADA" --saida "$RAG/p11-saida"
echo "== $(date -Is) concluído"
