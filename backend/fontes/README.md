# Fontes externas aos planos

| Arquivo | Uso | Origem |
|---|---|---|
| `sgb_areas_risco.csv` | P1 (critério S5): município com setorização de risco do SGB fica verde | Setorização de áreas de risco geológico alto/muito alto do Serviço Geológico do Brasil (SGB/CPRM), agregada por município |

Colunas de `sgb_areas_risco.csv`: `municipio` (nome do painel), `setores` (nº de setores de risco
alto/muito alto), `domicilios` e `pessoas` (estimativas do SGB nos setores), `percentual_pop`
(pessoas ÷ população do Censo 2022, em %) e `ano` (ano ou faixa de anos da setorização).
