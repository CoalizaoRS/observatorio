#!/bin/bash
# Instala o ambiente do RAG local no cluster pantanal (LAD/PUCRS), sem sudo:
#   - llama.cpp (llama-server) compilado com CUDA para a Tesla M40 (sm_52)
#   - Python 3.12 + dependências da ingestão (via uv)
#   - Node 24 LTS (para o pipeline de indicadores em TypeScript)
#   - modelos GGUF baixados do Hugging Face e guardados no Garage (rag-cache/models/)
#
# Quota do /home é 10 GB: compilação e downloads acontecem no /tmp local do nó;
# no home ficam só os binários e ambientes (~2 GB). Modelos vivem no Garage.
#
# Uso (no nó de login):  sbatch ~/observatorio-rag/rag-local/slurm/instalar.sbatch
#SBATCH --job-name=rag-instalar
#SBATCH --partition=LAD_geral
#SBATCH --exclude=pantanal02
#SBATCH --nodes=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=01:30:00
#SBATCH --output=%x.%j.out

set -euo pipefail

LLAMA_TAG=v0.7.0
NODE_VERSION=v24.22.0
PYTHON_VERSION=3.12
CHAT_REPO=Qwen/Qwen3-8B-GGUF
CHAT_FILE=Qwen3-8B-Q4_K_M.gguf
EMB_REPO=Qwen/Qwen3-Embedding-0.6B-GGUF
EMB_FILE=Qwen3-Embedding-0.6B-Q8_0.gguf

RAG=$HOME/observatorio-rag
TMP=/tmp/rag-$USER-$SLURM_JOB_ID
mkdir -p "$RAG/bin" "$TMP"
trap 'rm -rf "$TMP"' EXIT
export UV_CACHE_DIR=$TMP/uv-cache UV_PYTHON_INSTALL_DIR=$RAG/python UV_INSTALL_DIR=$RAG/bin
export PATH=$RAG/bin:$RAG/node/bin:/usr/local/cuda-12.2/bin:$PATH

echo "== nó: $(hostname)"; nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv

# --- uv + Python ------------------------------------------------------------
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | env INSTALLER_NO_MODIFY_PATH=1 sh
fi
uv venv --python "$PYTHON_VERSION" --allow-existing "$RAG/venv"
uv pip install --python "$RAG/venv/bin/python" -r "$RAG/rag-local/requirements.txt" cmake

# --- Node -------------------------------------------------------------------
if [ ! -x "$RAG/node/bin/node" ]; then
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" | tar -xJ -C "$TMP"
  rm -rf "$RAG/node"; mv "$TMP/node-$NODE_VERSION-linux-x64" "$RAG/node"
fi
node --version

# --- llama.cpp (CUDA, sm_52) ------------------------------------------------
set +u; source /LADAPPs/GCC/gcc-12.2.0-vars.sh; set -u   # o script da LAD usa variáveis não definidas
rm -rf "$TMP/llama.cpp"
git clone --depth 1 --branch "$LLAMA_TAG" https://github.com/ggml-org/llama.cpp "$TMP/llama.cpp"
"$RAG/venv/bin/cmake" -S "$TMP/llama.cpp" -B "$TMP/llama.cpp/build" \
  -DCMAKE_C_COMPILER="$GCC_HOME/bin/gcc" -DCMAKE_CXX_COMPILER="$GCC_HOME/bin/g++" \
  -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=52 -DCMAKE_CUDA_HOST_COMPILER="$GCC_HOME/bin/g++" \
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_CUDA_FLAGS="-Xcompiler=-fPIC" \
  -DCMAKE_EXE_LINKER_FLAGS="-static-libstdc++ -static-libgcc" \
  -DBUILD_SHARED_LIBS=OFF -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release
"$RAG/venv/bin/cmake" --build "$TMP/llama.cpp/build" --target llama-server -j "$SLURM_CPUS_PER_TASK"
install -m 755 "$TMP/llama.cpp/build/bin/llama-server" "$RAG/bin/llama-server"
llama-server --version
ldd "$RAG/bin/llama-server" | grep -E "stdc|cuda|not found" || true

# --- Dados de idioma do OCR (Tesseract embutido no PyMuPDF) ------------------
mkdir -p "$RAG/tessdata"
for lang in por osd; do
  [ -s "$RAG/tessdata/$lang.traineddata" ] || \
    curl -fsSL -o "$RAG/tessdata/$lang.traineddata" "https://github.com/tesseract-ocr/tessdata/raw/main/$lang.traineddata"
done

# --- Modelos -> Garage (rag-cache/models/) ----------------------------------
for spec in "$CHAT_REPO/$CHAT_FILE" "$EMB_REPO/$EMB_FILE"; do
  f=$(basename "$spec"); repo=$(dirname "$spec")
  "$RAG/venv/bin/python" "$RAG/rag-local/s3sync.py" exists rag-cache "models/$f" && continue
  curl -fsSL -o "$TMP/$f" "https://huggingface.co/$repo/resolve/main/$f"
  "$RAG/venv/bin/python" "$RAG/rag-local/s3sync.py" put "$TMP/$f" "rag-cache" "models/$f"
done

# --- Teste rápido na GPU: sobe o modelo de embeddings e gera um vetor ---------
[ -f "$TMP/$EMB_FILE" ] || "$RAG/venv/bin/python" "$RAG/rag-local/s3sync.py" get rag-cache "models/$EMB_FILE" "$TMP/$EMB_FILE"
llama-server -m "$TMP/$EMB_FILE" --embedding --pooling last -ngl 99 --port 18090 --host 127.0.0.1 >"$TMP/emb.log" 2>&1 &
PID=$!
for i in $(seq 60); do curl -sf http://127.0.0.1:18090/health >/dev/null && break; sleep 2; done
curl -s http://127.0.0.1:18090/v1/embeddings -H 'Content-Type: application/json' \
  -d '{"input":"Plano de contingência municipal"}' | "$RAG/venv/bin/python" -c 'import json,sys; print("dim do embedding:", len(json.load(sys.stdin)["data"][0]["embedding"]))'
grep -iE "CUDA0|offloaded" "$TMP/emb.log" | head -3 || true
kill $PID

du -sh "$RAG"
echo "== instalação concluída"
