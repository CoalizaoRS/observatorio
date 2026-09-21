# Extração de indicadores (Fase de Preparação)

Scripts que consultam o **mesmo RAG usado pelo backend** (Azure AI Search, endpoint
agêntico `knowledgebases/kb-plancon-filtered/retrieve`) e extraem, **por município**,
os 8 indicadores da Fase de Preparação.

> **Fonte das regras:** aba **"simplificado"** da planilha do Observatório
> (<https://docs.google.com/spreadsheets/d/1ck5WJv7X2ifg9cwEp299d1Een-LmjzvVYTHiyKZVOt8/>).
> Nessa aba, a saída de P1–P7 é um **semáforo** (`verde`/`amarelo`/`vermelho`) baseado
> no que o PLANCON menciona; **P8** é numérico (R$/hab). A **ausência** do dado no
> PLANCON é, por definição, o próprio sinal **vermelho** (não é "N/A"). Números de apoio
> (população em risco, vagas, canais de alerta, ano do plano, NUPDECs, despesa) ficam em
> `componentes`, com razões derivadas quando cabe (`percentual_pop_risco`,
> `vagas_por_1000_hab_risco`).

A recuperação é **restrita aos documentos do município** (city-based retrieval, via
`filterAddOn` sobre `blob_url` — reaproveitando `../municipios.ts`). Isso evita mistura
de dados entre cidades e mantém o contexto pequeno, **reduzindo o consumo de tokens**.

## Arquivos

| Arquivo | Papel |
|---|---|
| `definicoes.ts` | Definição dos 8 indicadores (P1–P8): pergunta de recuperação, campos a extrair e fórmula de cálculo. |
| `retrieve.ts`   | Cliente do endpoint `retrieve` do Azure (config por env; injeta o município no prompt como o proxy faz; retry com backoff). |
| `extrair.ts`    | Runner principal: para cada cidade × indicador, consulta o RAG, faz o parse do JSON e grava `indicadores/<Município>.json`. |
| `consolidar.ts` | Agrega os arquivos por cidade em CSVs (`indicadores/_consolidado/`). |

## Como rodar

## Publicação dos CSVs (Azure Blob + proxy)

Os CSVs consolidados são publicados em um **container público** do Azure Blob Storage e
também servidos pelo **proxy** por nome.

**Blob público** (container `indicadores` na conta `plancon`), uma URL por arquivo:

```
https://plancon.blob.core.windows.net/indicadores/_resumo.csv
https://plancon.blob.core.windows.net/indicadores/P1.csv   ... P8.csv
https://plancon.blob.core.windows.net/indicadores/manifest.json   # índice p/ o front-end
```

`Content-Type: text/csv` e CORS `GET *` já configurados — o front-end pode dar `fetch()`
direto. Para (re)publicar após rodar `npm run consolidar`:

```bash
cd backend && ./publicar-csv.sh          # az login necessário
```

**Proxy (servidor Docker)** entrega os mesmos CSVs por nome (arquivos embutidos na imagem
em `dados/csv`, copiados no Dockerfile):

```
GET /api/csv            -> { count, arquivos:[{ nome, url_local, url_blob }] }
GET /api/csv/_resumo.csv -> text/csv        (nome sanitizado; só *.csv; sem path traversal)
```

Servido em produção pelo Container App `observatorio-backend`
(`https://observatorio-backend.blacksand-ccf12c68.westus2.azurecontainerapps.io`).

### Deploy completo (um comando)

`backend/deploy.sh` encadeia tudo: consolidar → publicar no Blob → build+push
(`linux/amd64` no ACR, tag `vN` auto-incrementada) → `az containerapp update` → smoke test.
Requer `az login` e Docker em execução.

```bash
cd backend
./deploy.sh                     # pipeline completo (tag auto: v8 -> v9 -> ...)
./deploy.sh --tag v9            # força a tag
./deploy.sh --skip-consolidar   # dados já consolidados
./deploy.sh --skip-build --skip-deploy   # só consolida e publica no Blob
```

## Extração

```bash
cd backend
npm run extrair                       # todas as cidades e indicadores (pula as já geradas)
npm run extrair -- --limit 3          # só as 3 primeiras cidades (teste rápido)
npm run extrair -- --cidade "Porto Alegre,Canoas"
npm run extrair -- --indicador P1,P4  # só alguns indicadores (merge — ver abaixo)
npm run extrair -- --force            # reprocessa cidades já geradas
npm run extrair -- --conc 8           # concorrência entre indicadores de uma cidade

npm run consolidar                    # gera indicadores/_consolidado/_resumo.csv + <Pn>.csv
```

### Reprocessar apenas as regras que mudaram (merge incremental)

Quando as regras de alguns campos mudam, reprocesse só esses indicadores com
`--indicador` + `--force`. O runner faz **merge** com o arquivo existente de cada
cidade: os indicadores **não** reprocessados são **preservados** (valor/evidência),
apenas com os metadados estáticos (nome/unidade/fórmula) atualizados conforme a
definição vigente — inclusive **renomeações** de código (via `idAntigo`, ex.: `P8A→P8`).
Cada arquivo registra `regras_versao` e `indicadores_reprocessados_neste_passe`.

```bash
# ex.: as regras de P1,P3,P4,P5,P6 mudaram (planilha IRM PRE v2.2, 05/06/2026)
npm run extrair -- --force --indicador P1,P3,P4,P5,P6
```

## Configuração (variáveis de ambiente)

Herdadas do backend, com defaults do serviço do Observatório:
`AZURE_SEARCH_BASE`, `AZURE_SEARCH_KB`, `AZURE_SEARCH_KS`, `AZURE_SEARCH_API_VERSION`,
`AZURE_SEARCH_KEY`. Sem `AZURE_SEARCH_KEY` definido, usa a *query key* (somente leitura)
do serviço — suficiente para o `retrieve`. Em produção, defina a admin key via env.

## Formato de saída (`indicadores/<Município>.json`)

```jsonc
{
  "municipio": "Alvorada",
  "fonte_documentos": ["https://.../PLANCON_ALVORADA_2024.pdf"],
  "gerado_em": "2026-07-15T19:36:29.242Z",
  "tokens_consumidos": 105754,
  "indicadores": {
    "P2": {
      "nome": "Capacidade de abrigamento",
      "unidade": "vagas/1000 hab expostos",
      "valor": "N/A",                       // razão calculada em TS, ou "N/A" se faltar componente
      "componentes": { "vagas_abrigos": 150, "populacao_areas_risco": "N/A" },
      "evidencia": "Capacidade do Abrigo: 150 pessoas",  // citação literal do documento
      "confianca": "alta",
      "tokens": 13224
    }
    // ... P1, P3, P4, P5, P6, P7, P8
  }
}
```

`valor` é `"N/A"` quando o PLANCON não traz o componente necessário (p.ex. a população
em áreas de risco, denominador de várias razões, raramente consta nos planos — como já
observado em `indicadores/familias.csv`). Os **componentes extraídos** ficam registrados
mesmo assim, com a **evidência literal**, para permitir o cálculo posterior quando o
denominador vier de outra fonte (IBGE, orçamento municipal etc.).
