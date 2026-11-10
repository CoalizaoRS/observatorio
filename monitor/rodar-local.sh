#!/usr/bin/env bash
#
# Roda o monitor a partir desta máquina (origem "local") e publica o state.json na main,
# como o workflow do GitHub faz. Útil porque muitos sites de prefeitura recusam acessos de
# fora do Brasil, onde roda o GitHub Actions.
#
# Não mexe na sua cópia de trabalho: usa uma worktree temporária da origin/main.
# Variáveis de e-mail (RESEND_API_KEY, EMAIL_FROM, EMAIL_TO) podem ficar em monitor/.env
# (não versionado). Sem elas, o relatório só é impresso.
#
# Uso:
#   monitor/rodar-local.sh                 # rodada completa + commit/push do state.json
#   monitor/rodar-local.sh --dry-run       # sem e-mail (repassa os argumentos ao monitor.py)
#   SEM_PUSH=1 monitor/rodar-local.sh      # roda e commita na worktree, mas não publica
#
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${VENV:-$REPO/monitor/.venv}"
WT="$(mktemp -d)/observatorio-main"

if [ ! -x "$VENV/bin/python" ]; then
    echo "[local] criando ambiente Python em $VENV"
    python3 -m venv "$VENV"
fi
"$VENV/bin/pip" install -q -r "$REPO/monitor/requirements.txt"

if [ -f "$REPO/monitor/.env" ]; then
    set -a; . "$REPO/monitor/.env"; set +a
fi

git -C "$REPO" fetch -q origin main
git -C "$REPO" worktree add -q --detach "$WT" origin/main
trap 'git -C "$REPO" worktree remove --force "$WT"' EXIT

echo "[local] rodando o monitor (origem: local)"
MONITOR_ORIGEM=local "$VENV/bin/python" "$WT/monitor/monitor.py" "$@"

# PDFs baixados ficam na sua cópia (monitor/changed_pdfs, fora do git)
mkdir -p "$REPO/monitor/changed_pdfs"
cp -R "$WT/monitor/changed_pdfs/." "$REPO/monitor/changed_pdfs/" 2>/dev/null || true

cd "$WT"
git add monitor/state.json
if git diff --cached --quiet; then
    echo "[local] nenhuma mudança em state.json"
    exit 0
fi
git commit -q -m "chore: atualiza state.json (local, $(date -u +%Y-%m-%dT%H:%M:%SZ))"
if [ -n "${SEM_PUSH:-}" ]; then
    echo "[local] SEM_PUSH definido: commit feito só na worktree temporária (descartada ao sair)"
    exit 0
fi
# o workflow pode ter publicado outro state.json enquanto a rodada corria
if ! git pull -q --rebase origin main; then
    git rebase --abort || true
    echo "[local] conflito com um state.json publicado durante a rodada; rode de novo." >&2
    exit 1
fi
git push -q origin HEAD:main
echo "[local] state.json publicado na main"
