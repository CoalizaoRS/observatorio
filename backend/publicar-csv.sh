#!/usr/bin/env bash
#
# Publica os CSVs consolidados de indicadores junto com o site (GitHub Pages): copia
# indicadores/_consolidado/*.csv (e os CSVs de apoio) para site/indicadores/dados/ e gera
# o manifest.json (índice). O painel lê os CSVs do próprio domínio.
#
# A publicação de fato acontece pelo fluxo normal do repositório: commit dos CSVs numa
# branch, PR e merge na main — o workflow pages.yml põe o site no ar.
#
# Também PODA de site/indicadores/dados os *.csv que não existem mais no _consolidado
# (ex.: indicador removido).
#
# Uso:
#   npm run consolidar && ./publicar-csv.sh
#
set -euo pipefail

BACK_DIR="$(cd "$(dirname "$0")" && pwd)"
DESTINO="$BACK_DIR/../site/indicadores/dados"
CONS="$BACK_DIR/indicadores/_consolidado"

ls "$CONS"/*.csv >/dev/null 2>&1 || { echo "[publicar] nada em $CONS — rode 'npm run consolidar' antes." >&2; exit 1; }
mkdir -p "$DESTINO"

# 1) Monta a lista nova num diretório temporário e substitui o destino (poda incluída).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$CONS"/*.csv "$TMP"/
cp "$BACK_DIR"/indicadores/familias.csv "$TMP"/ 2>/dev/null || true
cp "$BACK_DIR"/vagas_abrigos.csv "$TMP"/ 2>/dev/null || true
for f in "$DESTINO"/*.csv; do
    [ -e "$f" ] || continue
    [ -e "$TMP/$(basename "$f")" ] || { rm "$f"; echo "  ✗ removido (obsoleto): $(basename "$f")"; }
done
cp "$TMP"/*.csv "$DESTINO"/
echo "[publicar] $(ls -1 "$DESTINO"/*.csv | wc -l | tr -d ' ') CSV(s) em site/indicadores/dados"

# 2) manifest.json (índice para quem consome os dados).
python3 - "$DESTINO" > "$DESTINO/manifest.json" <<'PY'
import json, os, sys, glob
d = sys.argv[1]
desc = {
 '_resumo.csv':'Matriz município × valor de cada indicador (P1..P7)',
 'P1.csv':'P1 — % população em área de risco (semáforo verde/vermelho)',
 'P2.csv':'P2 — Capacidade de abrigamento (semáforo)',
 'P3.csv':'P3 — Simulados de evacuação (semáforo)',
 'P4.csv':'P4 — Rotas de evacuação (semáforo)',
 'P5.csv':'P5 — Cobertura de sistemas de alerta (semáforo)',
 'P6.csv':'P6 — Plano de contingência atualizado (semáforo)',
 'P7.csv':'P7 — NUPDECs ativos (semáforo)',
 'familias.csv':'Estimativa de famílias em áreas de risco (legado)',
 'vagas_abrigos.csv':'Vagas em abrigos (dados de apoio)',
}
files = sorted(os.path.basename(f) for f in glob.glob(os.path.join(d, '*.csv')))
base = 'https://observatoriodaresiliencia.org/indicadores/dados'
m = {'base_url': base, 'regras_versao': 'planilha IRM · aba simplificado (semáforo)', 'count': len(files),
     'arquivos': [{'nome': f, 'descricao': desc.get(f, ''), 'url': f'{base}/{f}'} for f in files]}
print(json.dumps(m, ensure_ascii=False, indent=2))
PY
echo "[publicar] manifest.json gerado"

echo
echo "[publicar] pronto. Para pôr no ar: commit de site/indicadores/dados numa branch, PR e merge na main."
git -C "$BACK_DIR/.." status --short -- site/indicadores/dados
