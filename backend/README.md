# Backend — pipeline de indicadores do Observatório da Resiliência Climática

Scripts Node/TypeScript que extraem os indicadores dos Planos de Contingência, consolidam
os resultados em CSV e os publicam junto com o site (`site/indicadores/dados`). Não há
servidor: o painel lê os CSVs direto do próprio domínio.

## Visão geral

- **P1 a P7** vêm do texto do PLANCON. Para cada município e cada indicador, o extrator busca os
  trechos relevantes do plano (RAG restrito aos documentos daquele município, sem mistura entre
  cidades) e pede a um modelo de linguagem um JSON com os componentes e a evidência literal. A cor
  final é calculada em TypeScript pelas regras de `definicoes.ts`.
- **P9 e P10** não passam pelo modelo: vêm das coletas do monitor nos sites das prefeituras
  (`monitor/acessibilidade.json` e `monitor/voluntarios.json`).
- A **ausência** do dado no plano é, por definição, o próprio sinal vermelho (não é N/A). Cinza (N/A)
  fica para o que não pôde ser avaliado, como site inacessível no P9 e no P10.

**Fonte das regras:** aba "simplificado" da
[planilha do Observatório](https://docs.google.com/spreadsheets/d/1ck5WJv7X2ifg9cwEp299d1Een-LmjzvVYTHiyKZVOt8/).
O P8 (investimento em Defesa Civil, R$/hab) foi retirado na revisão de 23/07/2026, porque não é
extraível do plano.

## Arquivos (`src/indicadores/`)

| Arquivo | Papel |
|---|---|
| `definicoes.ts` | Definição de cada indicador: pergunta de recuperação, campos a extrair, regra de cor (`calcular`) e dados complementares (ex.: SGB no P1). |
| `extrair.ts` | Runner da extração: para cada cidade × indicador, recupera os trechos, chama o modelo, valida o JSON e grava `backend/indicadores/<Município>.json`. |
| `retrieve-local.ts` | Recuperação no índice gerado em `rag-local/` (`RAG_PROVIDER=local`). É o modo em uso. |
| `retrieve.ts` | Cliente do Azure AI Search. Ficou só como referência: o serviço foi desligado em 10/11/2026. Ainda é o padrão quando `RAG_PROVIDER` não é definido. |
| `recalcular.ts` | Reaplica as regras aos resultados já gravados, sem chamar o modelo (mudança de regra ou de dado complementar). |
| `p9.ts` | Grava o P9 a partir de `monitor/acessibilidade.json`. |
| `p10.ts` | Grava o P10 a partir de `monitor/voluntarios.json`. |
| `consolidar.ts` | Agrega os arquivos por cidade em CSVs (`backend/indicadores/_consolidado/`), aplicando os ajustes manuais e registrando a fonte do plano. |
| `ANALISE-P7-NUPDEC.md` | Análise de apoio às regras do P7. |

## Comandos

```bash
cd backend
npm install

# P1 a P7 (no LAD/PUCRS, pelos jobs de rag-local/slurm/)
RAG_PROVIDER=local npm run extrair                         # pula cidades já geradas
RAG_PROVIDER=local npm run extrair -- --cidade "Porto Alegre,Canoas"
RAG_PROVIDER=local npm run extrair -- --cidades-arquivo lista.txt   # um município por linha
RAG_PROVIDER=local npm run extrair -- --indicador P1,P4    # só alguns indicadores (merge)
RAG_PROVIDER=local npm run extrair -- --force              # reprocessa cidades já geradas
#   outras opções: --limit N (só as N primeiras cidades), --conc N (concorrência por cidade)

npm run recalcular -- --indicadores P2            # mostra o que mudaria com a regra atual
npm run recalcular -- --indicadores P2 --gravar   # grava

npm run p9 -- --gravar     # P9 a partir da coleta do monitor
npm run p10 -- --gravar    # P10 a partir da coleta do monitor

npm run consolidar         # gera backend/indicadores/_consolidado/_resumo.csv + <Pn>.csv
./publicar-csv.sh          # copia os CSVs para site/indicadores/dados e gera o manifest.json
```

Sem `--gravar`, `p9`, `p10` e `recalcular` só mostram a distribuição.

### Reprocessar só os indicadores cujas regras mudaram

Use `--indicador` com `--force`. O extrator faz **merge** com o arquivo existente de cada cidade:
os indicadores não reprocessados são preservados (valor e evidência), e só os metadados estáticos
(nome, unidade, fórmula) são atualizados conforme a definição vigente, inclusive renomeações de
código (via `idAntigo`). Cada arquivo registra `regras_versao` e
`indicadores_reprocessados_neste_passe`.

### P1 — critério S5 (plano OU setorização do SGB)

- **Plano:** o modelo lista as áreas de risco citadas no PLANCON (`local | ameaça | população | trecho`),
  lendo o plano inteiro em partes (`varredura`). A cor do plano (`cor_plano`) é determinística:
  todas as áreas com população → verde; áreas sem a população de todas (ou o município inteiro em
  risco) → amarelo; nenhuma área → vermelho.
- **SGB:** `complementar` soma os dados de `fontes/sgb_areas_risco.csv` (setores de risco alto e
  muito alto do Serviço Geológico do Brasil; pessoas e % da população são estimativas do SGB).
  Município com setorização → verde.
- O valor final é o melhor dos dois.

Mudou a tabela do SGB? Basta `npm run recalcular -- --indicadores P1 --gravar` e `npm run consolidar`,
sem reextrair. Mudou o plano? Reextraia o P1.

## Revisão manual e fonte do plano

- **Ajustes manuais** (`indicadores/_ajustes_manuais.json`): correções de cor por município e
  indicador, sempre com evidência, página, justificativa, revisor e data. Um ajuste feito sobre o
  plano do Prepara RS deixa de valer quando o município passa a usar o plano do site municipal; o
  `consolidar` avisa, para o ajuste ser revisto.
- **Fonte do plano:** os CSVs têm as colunas `fonte_plano` (Prepara RS ou Site Municipal) e
  `url_plano`, derivadas dos documentos efetivamente processados. A triagem dos planos do site está em
  `rag-local/fontes_site_municipal.json` (ver `monitor/README.md`).

## Publicação

Os CSVs consolidados são publicados **com o site** (GitHub Pages), em `site/indicadores/dados/`:

```
https://observatoriodaresiliencia.org/indicadores/dados/_resumo.csv
https://observatoriodaresiliencia.org/indicadores/dados/P1.csv   ... P10.csv
https://observatoriodaresiliencia.org/indicadores/dados/manifest.json   # índice
```

Depois de `./publicar-csv.sh`: commit de `site/indicadores/dados` numa branch, PR e merge na `main`.
O workflow `pages.yml` põe o site no ar.

## Dados gerados (fora do git)

`backend/indicadores/` é a saída do pipeline (não confundir com `site/indicadores/`, que é a página
do painel). Os JSONs por município e os CSVs de trabalho (`indicadores/_consolidado/*.csv`,
`indicadores/familias.csv`, `vagas_abrigos.csv`) **não são versionados**: são dado gerado e mudam a
cada rodada. A cópia de referência fica no armazenamento do projeto, com a mesma estrutura de pastas.
Só `indicadores/_ajustes_manuais.json` é versionado.

**Atenção ao rodar `npm run extrair` num checkout limpo:** sem `--force`, o extrator pula todo
município que já tem `<Município>.json`. Sem esses arquivos, ele reprocessa **todos** os municípios
do zero (uma chamada ao modelo por indicador por cidade, horas de GPU). Copie antes os JSONs da cópia
de referência para `backend/indicadores/`, a não ser que a intenção seja mesmo reprocessar tudo.

### Formato de `indicadores/<Município>.json`

```jsonc
{
  "municipio": "Agudo",
  "fonte_documentos": ["site-municipal/Agudo/707e34781dac.pdf"],
  "gerado_em": "2026-11-16T09:29:37.168Z",
  "regras_versao": "...",
  "indicadores": {
    "P2": {
      "grupo": "G1 · Pessoas e Equidade",
      "nome": "Capacidade de abrigamento",
      "valor": "verde",                     // verde | amarelo | vermelho | N/A
      "componentes": {
        "abrigos_listados": "sim",
        "vagas_abrigos": "300",
        "populacao_area_risco": "16.041",
        "vagas_por_1000_hab_risco": 18.7
      },
      "evidencia": "Identificação: Ginásio Municipal de Agudo (...) Capacidade: 300 pessoas",
      "confianca": "alta",
      "metodo": "RAG no LAD/PUCRS (...)"
    }
    // ... P1 a P7, P9, P10
  }
}
```

Os componentes extraídos ficam registrados mesmo quando a cor é vermelha ou N/A, com a evidência
literal, para permitir recalcular quando a regra ou um dado complementar mudar.
