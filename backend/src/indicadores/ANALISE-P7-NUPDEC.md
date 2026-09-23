# P7 (NUPDECs ativos) — auditoria e correção pendente

**Data:** 10/08/2026 · **Status:** diagnóstico fechado, correção **não aplicada** (revertida por decisão)
**Dado em produção:** inalterado, permanece o publicado em 30/07/2026 — **com o defeito descrito abaixo**

---

## 1. O defeito

Reportado a partir de **Água Santa**, marcado verde sem atender ao critério. Confirmado e sistemático.

Critério vigente:

- **VERDE** — o plano LISTA NUPDEC(s)/NUDEC(s) já existentes e formalizados
- **AMARELO** — menciona voluntários / grupos comunitários não formalizados
- **VERMELHO** — nada, ou apenas núcleos a serem organizados no futuro

Auditoria dos 29 municípios com P7 = verde, cruzando o conteúdo indexado **e** os PDFs originais:

| | Municípios |
|---|---:|
| P7 = verde publicado | 29 |
| **Sem nenhuma ocorrência de NUPDEC / NUDEC / núcleo no documento** | **16 (55%)** |

Os 16: Capão do Cipó, Ibiaçá, Ibiraiaras, Jaguari, Marques de Souza, Mato Castelhano, Nova Palma, Nova Santa Rita, Novo Hamburgo, Pedras Altas, Pinhal Grande, Pouso Novo, Santa Bárbara do Sul, São José do Herval, Vera Cruz, Água Santa.

**Não é falha de indexação.** Oito deles têm texto plenamente extraível — Novo Hamburgo tem 70.987 caracteres e zero ocorrências do termo.

### Causa raiz

1. **O guard confia no contador sem exigir respaldo textual.** Em `definicoes.ts`, `calcular` retorna verde sempre que `n_nupdecs >= 1`, sem checar a evidência e ignorando o `valor` do modelo. Um contador alucinado vira verde.
2. **O modelo confunde órgão com núcleo.** COMDEC / COMPDEC / Coordenadoria Municipal de Proteção e Defesa Civil existe em praticamente todo município e era contada como NUPDEC. Assinatura inconfundível: **todos os 16 falsos-positivos têm exatamente `n_nupdecs = 1`**. A evidência gravada em Água Santa são as atribuições de plantão do *Coordenador Municipal de Defesa Civil*.

---

## 2. Tentativas de correção e por que cada uma falhou

Três abordagens foram testadas em 07–10/08/2026. **Todas revertidas.** Registradas aqui para não serem repetidas.

| # | Mudança | Corrigiu | Quebrou |
|---|---|---|---|
| 1 | Âncora textual no guard (verde só se a evidência contiver `nupdec\|nudec\|núcleo`) + instrução anti-COMDEC na pergunta | os 16 falsos-verdes | **74 amarelos → vermelho.** A instrução "se não houver NUPDEC, devolva N/A na evidência" fez o modelo tratar o indicador como binário NUPDEC sim/não e parar de reportar voluntários |
| 2 | Semáforo decidido pelos componentes, não pelo `valor` do modelo | amarelos restaurados | `grupos_comunitarios` é **texto livre**; respostas como *"há abrigos, mas não há voluntários"* eram lidas como "tem grupos" → **5 de 10 promoções amostradas eram falsas** |
| 3 | `grupos_comunitarios` convertido para enum `sim/nao/N/A` | prosa ambígua deixou de promover | a descrição do campo citava "brigadas" como exemplo de voluntariado: **Brigada Militar e Corpo de Bombeiros** — órgãos presentes na tabela de contatos de todo plano — passaram a contar. Selbach, Westfália, Arvorezinha e Doutor Ricardo viraram amarelo por isso |

### Problema estrutural, não alcançável por prompt

O indicador é **instável entre execuções idênticas**, sobre o mesmo documento e a mesma configuração:

- **Harmonia** — `n_nupdecs` = 9 numa rodada, 0 na seguinte
- **Cruzeiro do Sul** — oscilou entre 1, 6 e 0; o plano diz que os NUPDECs *"devem ser formados e capacitados"* (futuro), mas traz uma tabela com "responsável por cada NUPDEC"

Ajustes de prompt e de guard estavam perseguindo ruído.

---

## 3. Sinal determinístico disponível

A pergunta central do P7 tem resposta objetiva no texto. Varredura do índice nos 264 municípios (10/08/2026):

| Sinal no documento indexado | Municípios | Consequência lógica |
|---|---:|---|
| Contém `NUPDEC` / `NUDEC` / `núcleo comunitário` | **19** | únicos que *podem* ser verde; resta decidir existente × planejado |
| Sem NUPDEC, com voluntariado real (excluindo Brigada Militar e bombeiros militares) | **186** | amarelo por definição |
| Nenhum dos dois | **59** | vermelho por definição |

O dado publicado traz **29 verdes, mas apenas 19 documentos contêm a palavra** — consistente com os 16 falsos-positivos auditados.

**Ressalva:** nos PLANCONs escaneados o índice guarda uma verbalização em inglês gerada por IA, e o termo em português pode ter se perdido. O filtro inclui variantes em inglês (`community protection nucleus`, `volunteer`, `scout`), mas parte dos 59 "vermelhos" pode ser falso-negativo por essa via. Requer verificação caso a caso.

---

## 4. Caminho recomendado (não implementado)

Modelo **híbrido**: o semáforo sai do texto, o LLM julga só o que é ambíguo.

1. Pré-filtro determinístico sobre o índice define a faixa possível de cada município.
2. Sem a palavra NUPDEC no documento, verde é impossível — **não se pergunta ao modelo**.
3. O LLM adjudica apenas os **19** casos com o termo presente, decidindo existente × "devem ser formados". Nesse volume cabe esforço de raciocínio maior ou votação em 3 passes para eliminar a variância.

Vantagens: reprodutível entre rodadas, auditável (o gatilho é uma ocorrência textual citável) e cerca de 10× mais barato que reprocessar 264 municípios.

Implica **mudança de metodologia do indicador** — decisão do responsável pelo Observatório.

---

## 5. Estado do repositório

- `definicoes.ts` — **revertido** ao estado que gerou o dado publicado. Um comentário no `calcular` do P7 aponta para este documento.
- `indicadores/<Município>.json` — bloco P7 **restaurado** a partir do `P7.csv` publicado em 30/07; cada registro traz `obs` marcando a restauração. O campo `tokens` do P7 reflete os reprocessamentos revertidos e não é confiável (telemetria, não dado).
- `indicadores/_consolidado/*.csv` — reconsolidados e conferidos **byte a byte** contra os 8 CSVs publicados: idênticos.
- Blob e Container App — **não foram tocados** em nenhum momento desta investigação.
