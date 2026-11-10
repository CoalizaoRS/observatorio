# Backend — pipeline de indicadores do Observatório da Resiliência Climática

Scripts Node/TypeScript que extraem os indicadores dos Planos de Contingência, consolidam
os resultados em CSV e os publicam junto com o site (`site/indicadores/dados`). Não há
servidor: o painel lê os CSVs direto do próprio domínio.

## Extração/consolidação de indicadores

`src/indicadores/` contém o pipeline que consulta o RAG (Azure AI Search)
cidade a cidade para extrair os 8 indicadores da Fase de Preparação e gera os
CSVs consumidos pelo painel. Ver `src/indicadores/README.md` para os
detalhes; resumo dos comandos:

```bash
npm run extrair              # gera/atualiza backend/indicadores/<Município>.json
npm run consolidar           # agrega em backend/indicadores/_consolidado/*.csv
./publicar-csv.sh            # copia os CSVs para site/indicadores/dados (publica com o site)
```

`backend/indicadores/` é a saída desse pipeline (não confundir com
`site/indicadores/`, que é uma página do site).

**Os dados gerados pelo pipeline não são versionados neste repositório** — os
CSVs de trabalho (`backend/indicadores/_consolidado/*.csv`,
`backend/indicadores/familias.csv`, `backend/vagas_abrigos.csv`) e também os
JSONs por município (`backend/indicadores/<Município>.json`). São dado
gerado, não código, e mudam a cada rodada do pipeline. Estão no `.gitignore`;
a cópia de referência atual fica em `marfim.lad.pucrs.br:~/observatorio/data/`
(mesma estrutura de pastas deste repo). Planejado migrar para MinIO
self-hosted na PUC (com histórico via DVC ou LakeFS) — até lá, essa cópia no
servidor é a fonte de verdade fora do git.

**Atenção ao rodar `npm run extrair` sem os JSONs locais**: sem `--force`, o
extrator pula todo município que já tem `backend/indicadores/<Município>.json`
(processamento incremental). Num checkout limpo esses arquivos não existem —
rodar `npm run extrair` nesse estado reprocessa **todos** os municípios do
zero (uma chamada ao RAG por indicador por cidade, custa caro em tokens),
mesmo sem passar `--force`. Copie os JSONs da cópia acima para
`backend/indicadores/` **antes** de rodar `npm run extrair`, a não ser que a
intenção seja mesmo reprocessar tudo.
