# observatorio

Observatório da Resiliência Climática do RS.

## Estrutura do repositório

- **`site/`** — o site estático (`index.html`, `assets/`, `indicadores/`,
  `CNAME`), publicado via GitHub Pages no domínio
  [observatoriodaresiliencia.org](https://observatoriodaresiliencia.org).
  Deploy automático pelo workflow `.github/workflows/pages.yml` (build via
  GitHub Actions, não pelo Jekyll clássico) sempre que `site/` muda no
  branch `main`.
- **`backend/`** — API Node/Express (proxy seguro para o Azure AI Search) que
  serve o chat do site e os indicadores em CSV. Inclui também os scripts de
  extração/consolidação dos indicadores (`backend/src/indicadores/`) e o
  Dockerfile/scripts de deploy no Azure Container Apps.
- **`monitor/`** — monitor automatizado que varre os sites oficiais dos 497
  municípios do RS em busca de atualizações no Plano de Contingência e avisa
  por e-mail. Roda diariamente via `.github/workflows/monitor.yml`. Ver
  `monitor/README.md`.

Cada pasta (`site/`, `backend/`, `monitor/`) é isolada e autocontida — evita
colisão de nomes entre os projetos (ex.: `backend/indicadores/` é dado
gerado pelo pipeline do backend; `site/indicadores/` é a página do site) e
faz com que o deploy do site nunca inclua arquivos de `backend/`/`monitor/`.

## Desenvolvimento

Cada subprojeto (`backend/`, `monitor/`) tem suas próprias instruções de
instalação/execução no respectivo README. O site em `site/` é HTML/CSS/JS
estático, sem build — basta abrir `site/index.html` ou servir a pasta com
qualquer servidor estático.
