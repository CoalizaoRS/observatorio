# observatorio

Observatório da Resiliência Climática do RS.

## Estrutura do repositório

- **/** — o site estático (`index.html`, `assets/`, `indicadores/`), publicado
  via GitHub Pages no domínio [observatoriodaresiliencia.org](https://observatoriodaresiliencia.org)
  (ver `CNAME`).
- **`backend/`** — API Node/Express (proxy seguro para o Azure AI Search) que
  serve o chat do site e os indicadores em CSV. Inclui também os scripts de
  extração/consolidação dos indicadores (`backend/src/indicadores/`) e o
  Dockerfile/scripts de deploy no Azure Container Apps.
- **`monitor/`** — monitor automatizado que varre os sites oficiais dos 497
  municípios do RS em busca de atualizações no Plano de Contingência e avisa
  por e-mail. Roda diariamente via `.github/workflows/monitor.yml`. Ver
  `monitor/README.md`.

## Desenvolvimento

Cada subprojeto (`backend/`, `monitor/`) é autocontido, com suas próprias
instruções de instalação/execução no respectivo README.
