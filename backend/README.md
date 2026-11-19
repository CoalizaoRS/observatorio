# Backend — pipeline de indicadores do Observatório da Resiliência Climática

Scripts Node/TypeScript que extraem os indicadores dos Planos de Contingência, consolidam
os resultados em CSV e os publicam junto com o site (`site/indicadores/dados`). Não há
servidor: o painel lê os CSVs direto do próprio domínio.

## Extração/consolidação de indicadores

`src/indicadores/` contém o pipeline que extrai, cidade a cidade, os indicadores do plano
(P1 a P7) com busca nos trechos do plano (RAG) e um modelo de linguagem, e gera os CSVs
consumidos pelo painel. A extração roda no LAD/PUCRS com `RAG_PROVIDER=local`
(`retrieve-local.ts`), pelos jobs de `rag-local/slurm/`. O cliente do Azure (`retrieve.ts`,
padrão quando `RAG_PROVIDER` não é definido) ficou só como referência: o serviço foi desligado
em 10/11/2026. P9 e P10 não passam pelo modelo: vêm das coletas do monitor nos sites das
prefeituras. Ver `src/indicadores/README.md` para os detalhes; resumo dos comandos:

```bash
RAG_PROVIDER=local npm run extrair   # gera/atualiza backend/indicadores/<Município>.json (P1–P7)
npm run p9 -- --gravar       # P9 a partir de monitor/acessibilidade.json
npm run p10 -- --gravar      # P10 a partir de monitor/voluntarios.json
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
a cópia de referência atual fica no armazenamento do projeto, fora do git, com a mesma
estrutura de pastas deste repo.

**Atenção ao rodar `npm run extrair` sem os JSONs locais**: sem `--force`, o
extrator pula todo município que já tem `backend/indicadores/<Município>.json`
(processamento incremental). Num checkout limpo esses arquivos não existem —
rodar `npm run extrair` nesse estado reprocessa **todos** os municípios do
zero (uma chamada ao modelo por indicador por cidade, horas de GPU),
mesmo sem passar `--force`. Copie os JSONs da cópia de referência para
`backend/indicadores/` **antes** de rodar `npm run extrair`, a não ser que a
intenção seja mesmo reprocessar tudo.
