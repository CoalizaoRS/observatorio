# Observatório da Resiliência Climática do RS

Painel público que avalia a **preparação dos municípios do Rio Grande do Sul para desastres
climáticos**, a partir dos Planos de Contingência de Proteção e Defesa Civil (PLANCON) e dos
sites oficiais das prefeituras. Projeto da [CoalizãoRS](https://observatoriodaresiliencia.org).

- Site e painel: [observatoriodaresiliencia.org](https://observatoriodaresiliencia.org)
- Dados abertos (CSV): [observatoriodaresiliencia.org/indicadores/dados](https://observatoriodaresiliencia.org/indicadores/dados/manifest.json)
- Licença: MIT (código). Os dados publicados citam a fonte de cada plano por município.

## Como funciona

```
 PLANCONs (Prepara RS)  ─┐
                         ├─► rag-local/  texto, índice e extração por modelo de linguagem ─┐
 planos nos sites  ──────┘        (planos do site entram após triagem)                    │
        ▲                                                                                   ▼
   monitor/  varre os sites das prefeituras ──► P9, P10 (coleta nos sites) ──► backend/  consolida
                                                                                    │
                                                                                    ▼
                                                            site/indicadores/dados/*.csv ──► painel
```

1. **Planos.** A base são os PLANCONs reunidos pelo programa Prepara RS. Quando o monitor encontra no
   site da prefeitura uma versão mais nova do plano, ela passa por triagem e substitui a do Prepara RS
   (fonte "Site Municipal").
2. **Extração.** Os indicadores que dependem do texto do plano (P1 a P7) são extraídos por um modelo
   de linguagem com busca nos trechos do plano (RAG), processado no LAD/PUCRS. Cada resultado guarda a
   evidência (trecho e página) que justifica a cor.
3. **Coleta nos sites.** P9 e P10 não vêm do plano: são medidos navegando nos sites das prefeituras,
   respeitando o robots.txt.
4. **Revisão.** Casos duvidosos recebem ajuste manual (`backend/indicadores/_ajustes_manuais.json`),
   sempre com justificativa e revisor. Documentos rejeitados na revisão ficam em
   `monitor/documentos_rejeitados.json` e não contam em nenhum indicador.
5. **Publicação.** A consolidação gera um CSV por indicador e um resumo, publicados junto com o site.

## Indicadores

Semáforo por município: verde, amarelo, vermelho, e cinza (N/A) quando não foi possível avaliar.

| Id | Grupo | Indicador | Fonte |
|---|---|---|---|
| P1 | G1 · Pessoas e Equidade | Mapeamento de áreas de risco | plano |
| P2 | G1 · Pessoas e Equidade | Capacidade de abrigamento | plano |
| P3 | G2 · Material, Infraestrutura e Economia | Simulados de evacuação | plano |
| P4 | G2 · Material, Infraestrutura e Economia | Rotas de evacuação | plano |
| P5 | G3 · Ambiente e Resiliência Hídrica | Cobertura de sistemas de alerta | plano |
| P6 | G4 · Governança e Capacidade Institucional | Plano de contingência atualizado | plano |
| P7 | G4 · Governança e Capacidade Institucional | NUPDECs ativos | plano |
| P9 | G4 · Governança e Capacidade Institucional | Plano de Contingência público e acessível | site da prefeitura |
| P10 | G4 · Governança e Capacidade Institucional | Canal de cadastro de voluntários | site da prefeitura |

As regras de cada indicador estão em `backend/src/indicadores/definicoes.ts`. O P8 (investimento em
Defesa Civil) foi retirado em 23/07/2026, porque não é extraível do plano. O P11 (estrutura da
Defesa Civil municipal) está em preparação.

## Estrutura do repositório

| Pasta | O que tem |
|---|---|
| [`site/`](site/) | Site estático (HTML/CSS/JS, sem build): página inicial, painel em `indicadores/`, `blog/` e `publicacoes/`. Os CSVs publicados ficam em `site/indicadores/dados/`. Deploy automático no GitHub Pages pelo workflow `pages.yml` a cada mudança em `site/` no `main`. |
| [`backend/`](backend/) | Pipeline dos indicadores em Node/TypeScript (`src/indicadores/`): extração (`npm run extrair`), P9 e P10 a partir das coletas do monitor (`npm run p9`, `npm run p10`), consolidação (`npm run consolidar`) e cópia para o site (`./publicar-csv.sh`). Não há servidor. Os JSONs por município em `backend/indicadores/` são dado gerado e não são versionados. |
| [`monitor/`](monitor/) | Monitor em Python que varre os sites dos 497 municípios: encontra e valida o PLANCON publicado (`monitor.py`, estado em `state.json`), mede o acesso ao plano para o P9 (`acessibilidade.py`) e busca canais de voluntários para o P10 (`voluntarios.py`). Roda todo dia pelo workflow `monitor.yml`. |
| [`rag-local/`](rag-local/) | Processamento dos planos no LAD/PUCRS: extração de texto com OCR, índice de trechos e jobs SLURM (`slurm/`). Também guarda o mapa município → documentos (`municipios.json`) e a triagem dos planos do site municipal (`fontes_site_municipal.json`, `site_municipal.py`). |

Cada pasta é autocontida, com seu próprio README de instalação e uso. Isso evita colisão de nomes
(`backend/indicadores/` é dado gerado; `site/indicadores/` é a página do painel) e garante que o
deploy do site nunca inclua arquivos das outras pastas.

## Desenvolvimento

- **Site:** abra `site/index.html` ou sirva a pasta `site/` com qualquer servidor estático.
- **Backend:** `cd backend && npm install`; ver `backend/README.md`.
- **Monitor:** `cd monitor && pip install -r requirements.txt`; ver `monitor/README.md`.
- **Atualizar os dados publicados:**
  ```bash
  cd backend
  npm run -s p9 -- --gravar
  npm run -s p10 -- --gravar
  npm run -s consolidar
  ./publicar-csv.sh          # copia os CSVs para site/indicadores/dados
  ```
  O site é atualizado quando a mudança em `site/indicadores/dados` chega ao `main` por PR.

## Release notes

### Publicação de 19/11/2026

PRs [#14](https://github.com/CoalizaoRS/observatorio/pull/14), [#17](https://github.com/CoalizaoRS/observatorio/pull/17)
e [#27](https://github.com/CoalizaoRS/observatorio/pull/27).

**Novos indicadores**
- **P9 · Plano de Contingência público e acessível.** Verde quando o plano é encontrado navegando
  pelo site em até 3 cliques a partir da página inicial; amarelo quando só aparece pela busca
  interna ou pelo índice do site; vermelho quando não é encontrado; cinza quando o site não responde
  ou o robots.txt veta a leitura. Distribuição: verde 42, amarelo 9, vermelho 305, cinza 140.
- **P10 · Canal de cadastro de voluntários.** Verde quando o site da prefeitura tem um canal
  municipal ativo de cadastro de voluntários para emergências; amarelo quando só remete ao cadastro
  estadual; vermelho quando não há canal ou o canal foi encerrado.
  Busca automática com revisão manual. Distribuição: verde 11, vermelho 327, cinza 158.

**Monitor dos sites**
- Validação mais rigorosa: o documento precisa ser o PLANCON de Defesa Civil do próprio município.
  Planos de COVID-19, de dengue, cartilhas e protocolos deixam de contar.
- Navegação profunda nos sites, com páginas em JavaScript.
- O monitor testa os candidatos em ordem: um documento recusado não encerra mais a busca.
- O caminho da página inicial até o plano fica registrado no `state.json`.
- Lista de documentos rejeitados na revisão manual, compartilhada pelo monitor e pelo P9.
- Municípios com plano encontrado no site: de 26 para 54.

**Planos do site municipal**
- Triagem de 37 planos novos: 18 versões mais novas que a do Prepara RS, 16 mesma versão e 3 versões
  mais antigas.
- 28 municípios passam a usar o plano do site da prefeitura (antes eram 10). Os indicadores P1 a P7
  desses 18 municípios foram reextraídos.

**Correções**
- Giruá: o documento encontrado no site era um decreto de apoio ao produtor rural na estiagem, não o
  PLANCON. P9 passa de amarelo para vermelho.

**Pendências conhecidas**
- Alvorada: plano do site (08/2026) ainda sem triagem, porque o site da prefeitura não responde.

**Revisão posterior**
- P9: o vermelho passa a incluir o site que publica versão anterior à vigente localizada em outra
  fonte oficial (ex.: Prepara RS). O card mostra as duas datas. Arambaré e Doutor Ricardo passam de
  verde para vermelho, e Pinheirinho do Vale de amarelo para vermelho. Nova distribuição: verde 40,
  amarelo 8, vermelho 308, cinza 140.
- Arroio do Meio · P4: verde confirmado no plano novo (seção 13.4, rotas de fuga por bairro com
  ponto de encontro). O ajuste manual feito sobre o plano do Prepara RS foi removido.
- Capitão · P4: removido o ajuste antigo, feito sobre o plano do Prepara RS. Fica o ajuste feito
  sobre o plano do site.
