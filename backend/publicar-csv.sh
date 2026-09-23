#!/usr/bin/env bash
#
# Publica os CSVs consolidados de indicadores no Azure Blob Storage (container público
# "indicadores" da conta "plancon") e atualiza a cópia embutida no backend (dados/csv),
# que é servida pelo proxy em GET /api/csv/:nome.
#
# Além de subir os CSVs, gera/atualiza o manifest.json (índice p/ o front-end) e PODA do
# Blob os *.csv que não existem mais localmente (mantém o Blob em sincronia — ex.: após
# renomear P8A -> P8, o P8A.csv é removido do Blob).
#
# Pré-requisitos: az CLI logado (`az login`). A chave da conta é obtida via az.
#
# Uso:
#   ./publicar-csv.sh
#   ACCOUNT=plancon CONTAINER=indicadores RG=CoalizãoRS ./publicar-csv.sh
#
set -euo pipefail

RG="${RG:-CoalizãoRS}"
ACCOUNT="${ACCOUNT:-plancon}"
CONTAINER="${CONTAINER:-indicadores}"
# Cache curto: o front revalida os CSVs a cada ~2 min (evita servir dados velhos após deploy).
CACHE="${CACHE:-public, max-age=120}"

BACK_DIR="$(cd "$(dirname "$0")" && pwd)"
CSV_LOCAL="$BACK_DIR/dados/csv"
BASE="https://${ACCOUNT}.blob.core.windows.net/${CONTAINER}"

echo "[publicar] conta=$ACCOUNT container=$CONTAINER rg=$RG"

# 1) Atualiza a cópia local embutida na imagem (dados/csv) a partir do _consolidado.
mkdir -p "$CSV_LOCAL"
cp "$BACK_DIR"/indicadores/_consolidado/*.csv "$CSV_LOCAL"/ 2>/dev/null || true
cp "$BACK_DIR"/indicadores/familias.csv "$CSV_LOCAL"/ 2>/dev/null || true
cp "$BACK_DIR"/vagas_abrigos.csv "$CSV_LOCAL"/ 2>/dev/null || true
echo "[publicar] $(ls -1 "$CSV_LOCAL"/*.csv | wc -l | tr -d ' ') CSV(s) em dados/csv"

# 2) Gera o manifest.json (índice) a partir dos CSVs locais.
python3 - "$CSV_LOCAL" "$BASE" > "$CSV_LOCAL/../manifest.json" <<'PY'
import json, os, sys, glob
csv_dir, base = sys.argv[1], sys.argv[2]
desc = {
 '_resumo.csv':'Matriz município × valor de cada indicador (P1..P7)',
 'P1.csv':'P1 — % população em área de risco (semáforo verde/vermelho)',
 'P2.csv':'P2 — Capacidade de abrigamento (semáforo)',
 'P3.csv':'P3 — Simulados de evacuação (semáforo)',
 'P4.csv':'P4 — Rotas de evacuação (semáforo)',
 'P5.csv':'P5 — Cobertura de sistemas de alerta (semáforo)',
 'P6.csv':'P6 — Plano de contingência atualizado (semáforo)',
 'P7.csv':'P7 — NUPDECs ativos (semáforo)',
 'P8.csv':'P8 — Investimento em Defesa Civil (R$/hab)',
 'familias.csv':'Estimativa de famílias em áreas de risco (legado)',
 'vagas_abrigos.csv':'Vagas em abrigos (dados de apoio)',
}
files = sorted(os.path.basename(f) for f in glob.glob(os.path.join(csv_dir, '*.csv')))
m = {'container':'indicadores','base_url':base,
     'regras_versao':'planilha IRM · aba simplificado (semáforo)','count':len(files),
     'arquivos':[{'nome':f,'descricao':desc.get(f,''),'url':f'{base}/{f}'} for f in files]}
print(json.dumps(m, ensure_ascii=False, indent=2))
PY
echo "[publicar] manifest.json gerado ($(python3 -c "import json;print(json.load(open('$CSV_LOCAL/../manifest.json'))['count'])") arquivos)"

# 3) Garante o container público e CORS de leitura.
KEY="$(az storage account keys list -n "$ACCOUNT" -g "$RG" --query '[0].value' -o tsv)"
az storage container create --name "$CONTAINER" --account-name "$ACCOUNT" --account-key "$KEY" \
    --public-access blob -o none
az storage cors clear --services b --account-name "$ACCOUNT" --account-key "$KEY" 2>/dev/null || true
az storage cors add --services b --methods GET HEAD --origins "*" --allowed-headers "*" \
    --exposed-headers "*" --max-age 3600 --account-name "$ACCOUNT" --account-key "$KEY"

# 4) Sobe cada CSV com Content-Type correto + o manifest.json.
for f in "$CSV_LOCAL"/*.csv; do
    nome="$(basename "$f")"
    az storage blob upload --container-name "$CONTAINER" --file "$f" --name "$nome" \
        --content-type "text/csv; charset=utf-8" --content-cache-control "$CACHE" --overwrite \
        --account-name "$ACCOUNT" --account-key "$KEY" --only-show-errors -o none
    echo "  ✓ $nome"
done
az storage blob upload --container-name "$CONTAINER" --file "$CSV_LOCAL/../manifest.json" \
    --name "manifest.json" --content-type "application/json; charset=utf-8" --content-cache-control "$CACHE" --overwrite \
    --account-name "$ACCOUNT" --account-key "$KEY" --only-show-errors -o none
echo "  ✓ manifest.json"

# 5) Poda: remove do Blob os *.csv que não existem mais localmente.
LOCAL_LIST="$(cd "$CSV_LOCAL" && ls -1 *.csv)"
for b in $(az storage blob list --container-name "$CONTAINER" --account-name "$ACCOUNT" \
              --account-key "$KEY" --query "[?ends_with(name,'.csv')].name" -o tsv); do
    if ! grep -qxF "$b" <<< "$LOCAL_LIST"; then
        az storage blob delete --container-name "$CONTAINER" --name "$b" \
            --account-name "$ACCOUNT" --account-key "$KEY" --only-show-errors -o none
        echo "  ✗ removido do Blob (obsoleto): $b"
    fi
done

echo "[publicar] pronto. Ex.: $BASE/_resumo.csv"
