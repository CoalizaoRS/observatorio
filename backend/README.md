# Backend — Observatório da Resiliência Climática

API Node/Express que serve de proxy seguro entre o front-end (`/index.html`)
e o Azure AI Search (chat sobre os Planos de Contingência), além de expor os
indicadores consolidados em CSV.

## Rodando localmente

```bash
cd backend
npm install
AZURE_SEARCH_KEY=... npm run dev   # nodemon em src/index.ts, porta 3000 por padrão
```

Variáveis de ambiente (todas com default, exceto a chave):

- `AZURE_SEARCH_KEY` — obrigatória, sem default (nunca hardcode; passe via
  secret do Container App ou `.env` local não versionado).
- `AZURE_SEARCH_BASE`, `AZURE_SEARCH_KB`, `AZURE_SEARCH_KS`,
  `AZURE_SEARCH_API_VERSION`, `AZURE_SEARCH_INDEX`,
  `AZURE_SEARCH_INDEX_API_VERSION` — endpoint/índice do Azure AI Search.
- `CSV_BLOB_BASE` — URL pública do Blob onde os CSVs também ficam disponíveis.
- `PORT` — porta do servidor (default `3000` local / `8080` na imagem Docker).

## Build e deploy

```bash
npm run build   # tsc -> dist/
npm start       # roda dist/index.js
```

`Dockerfile` builda e serve a imagem de produção (Azure Container Apps).
`deploy.sh` encadeia o pipeline completo (consolidar indicadores → publicar
CSVs no Blob → build/push da imagem → atualizar o Container App → smoke
test); veja o cabeçalho do script para as opções (`--skip-*`, `--tag`).
Requer `az` CLI autenticado e Docker em execução.

## Extração/consolidação de indicadores

`src/indicadores/` contém o pipeline que consulta o RAG (Azure AI Search)
cidade a cidade para extrair os 8 indicadores da Fase de Preparação e gera os
CSVs consumidos por `/api/csv`. Ver `src/indicadores/README.md` para os
detalhes; resumo dos comandos:

```bash
npm run extrair              # gera/atualiza backend/indicadores/<Município>.json
npm run consolidar           # agrega em backend/indicadores/_consolidado/*.csv
./publicar-csv.sh            # sincroniza dados/csv/ e publica no Blob público
```

`backend/indicadores/` é a saída desse pipeline (dados versionados no repo,
não confundir com a pasta `/indicadores` na raiz do repositório, que é uma
página do site).
