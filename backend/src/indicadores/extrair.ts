/**
 * Extrator de indicadores da Fase de Preparação, cidade por cidade, a partir do RAG
 * (Azure AI Search) usado pelo backend. Para CADA município e CADA indicador faz UMA
 * consulta ao endpoint `retrieve`, restrita aos documentos daquele município
 * (city-based retrieval → menos contexto, menos tokens). O modelo devolve um JSON
 * estruturado que é validado/parseado aqui; razões (P1, P2, P5, P7, P8) são
 * calculadas em TypeScript a partir dos componentes extraídos.
 *
 * Saída: um arquivo por cidade em  backend/indicadores/<Município>.json
 *
 * Uso:
 *   npm run extrair                        # todas as cidades e indicadores
 *   npm run extrair -- --limit 3           # só as 3 primeiras cidades (teste)
 *   npm run extrair -- --cidade "Porto Alegre,Canoas"
 *   npm run extrair -- --indicador P1,P4   # só alguns indicadores
 *   npm run extrair -- --force             # reprocessa cidades já geradas
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { MUNICIPIOS, buildFilterAddOn, MunicipioMatch } from '../municipios';
import { INDICADORES, IndicadorDef, CampoDef, paraNumero } from './definicoes';
import { retrieve } from './retrieve';

const OUT_DIR = path.resolve(__dirname, '../../indicadores');

// ---------------------------------------------------------------------------
// Argumentos de linha de comando
// ---------------------------------------------------------------------------
function parseArgs(argv: string[]) {
  const out: { cidades?: string[]; indicadores?: string[]; force: boolean; limit?: number; conc: number } = {
    force: false,
    conc: 4,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a === '--cidade' || a === '--cidades') out.cidades = argv[++i]?.split(',').map((s) => s.trim());
    else if (a === '--indicador' || a === '--indicadores') out.indicadores = argv[++i]?.split(',').map((s) => s.trim().toUpperCase());
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--conc') out.conc = Math.max(1, Number(argv[++i]) || 4);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Montagem do prompt com instrução de saída em JSON estrito
// ---------------------------------------------------------------------------
function descreveCampo(c: CampoDef): string {
  const opc = c.opcoes ? ` (um de: ${c.opcoes.map((o) => `"${o}"`).join(', ')})` : '';
  return `  "${c.nome}": <${c.descricao}${opc}>`;
}

function montaPergunta(ind: IndicadorDef): string {
  const linhas = [...ind.campos.map(descreveCampo)];
  linhas.push('  "evidencia": "<citação curta e LITERAL do documento que fundamenta a resposta, ou \\"N/A\\">"');
  linhas.push('  "confianca": <"alta" | "media" | "baixa">');
  const criterio = ind.criterio ? `Critério de classificação: ${ind.criterio}\n\n` : '';
  return (
    `Pergunta: ${ind.pergunta}\n\n` +
    criterio +
    `Responda SOMENTE com um objeto JSON válido (sem texto antes ou depois, sem markdown), com EXATAMENTE estas chaves:\n` +
    `{\n${linhas.join(',\n')}\n}\n\n` +
    `Regras: use "N/A" quando o documento não informar o dado. NÃO invente números — extraia apenas o que estiver no documento.`
  );
}

// ---------------------------------------------------------------------------
// Parsing robusto do JSON devolvido pelo modelo
// ---------------------------------------------------------------------------
function extraiJson(texto: string): Record<string, any> | null {
  if (!texto) return null;
  let t = texto.trim();
  // remove cercas de código ```json ... ```
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // recorta do primeiro { ao último }
  const ini = t.indexOf('{');
  const fim = t.lastIndexOf('}');
  if (ini === -1 || fim === -1 || fim < ini) return null;
  // O RAG anota as citações com marcadores [ref_id:N], às vezes DEPOIS da aspa que fecha
  // um valor ("evidencia": "..."[ref_id:0],) — o que invalida o JSON. Remove-os sempre.
  const bruto = t.slice(ini, fim + 1).replace(/\s*\[ref_id:[^\]]*\]/g, '');
  try {
    return JSON.parse(bruto);
  } catch {
    // tenta remover vírgulas finais
    try {
      return JSON.parse(bruto.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

interface IndicadorResultado {
  grupo: string;
  nome: string;
  mede: string;
  unidade: string;
  formula: string;
  valor: number | string;      // semáforo, R$/hab, ou "N/A"
  componentes: Record<string, any>;
  evidencia: string;
  confianca: string;
  tokens: number;
  erro?: string;
}

async function extraiIndicador(
  municipio: string,
  filterAddOn: string,
  ind: IndicadorDef
): Promise<IndicadorResultado> {
  const base: Omit<IndicadorResultado, 'valor' | 'componentes' | 'evidencia' | 'confianca' | 'tokens'> = {
    grupo: ind.grupo,
    nome: ind.nome,
    mede: ind.mede,
    unidade: ind.unidade,
    formula: ind.formula,
  };
  // Indicadores de semáforo nunca ficam N/A: ausência de evidência = vermelho (fecha a contagem).
  const ehSemaforo = ind.unidade.startsWith('semáforo');
  const semNA = (v: any) => (ehSemaforo ? 'vermelho' : 'N/A');
  try {
    const { text, tokens } = await retrieve(municipio, filterAddOn, montaPergunta(ind));
    const json = extraiJson(text);
    if (!json) {
      return { ...base, valor: semNA('N/A'), componentes: {}, evidencia: text.slice(0, 300), confianca: 'baixa', tokens, erro: 'JSON não parseável' };
    }

    // Componentes = campos declarados extraídos do documento (+ derivados).
    const componentes: Record<string, any> = {};
    for (const c of ind.campos) if (c.nome !== 'valor') componentes[c.nome] = json[c.nome] ?? 'N/A';
    if (ind.derivar) Object.assign(componentes, ind.derivar(json));

    // Valor final: razão calculada em TS, ou o `valor` retornado pelo modelo.
    let valor: number | string;
    if (ind.calcular) {
      const v = ind.calcular(json);
      valor = v === null ? (json.valor ?? 'N/A') : v;
    } else {
      valor = json.valor ?? 'N/A';
    }
    // normaliza semáforo para minúsculas ("VERDE" -> "verde")
    if (typeof valor === 'string' && /^(verde|amarelo|vermelho|n\/a)$/i.test(valor.trim())) valor = valor.trim().toLowerCase();
    // semáforo fora de {verde,amarelo,vermelho} (ex.: N/A) → vermelho
    if (ehSemaforo && !['verde', 'amarelo', 'vermelho'].includes(String(valor).toLowerCase())) valor = 'vermelho';

    return {
      ...base,
      valor,
      componentes,
      evidencia: typeof json.evidencia === 'string' ? json.evidencia : 'N/A',
      confianca: typeof json.confianca === 'string' ? json.confianca : 'baixa',
      tokens,
    };
  } catch (e) {
    return { ...base, valor: semNA('N/A'), componentes: {}, evidencia: 'N/A', confianca: 'baixa', tokens: 0, erro: (e as Error).message };
  }
}

// pool de concorrência simples
async function pool<T, R>(itens: T[], conc: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(itens.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(conc, itens.length) }, async () => {
    while (i < itens.length) {
      const idx = i++;
      res[idx] = await fn(itens[idx]);
    }
  });
  await Promise.all(workers);
  return res;
}

function nomeArquivo(municipio: string): string {
  return path.join(OUT_DIR, `${municipio}.json`);
}

async function jaGerado(municipio: string): Promise<boolean> {
  try {
    await fs.access(nomeArquivo(municipio));
    return true;
  } catch {
    return false;
  }
}

/** Carrega o arquivo já gerado da cidade (ou null), para permitir merge incremental. */
async function carregaAnterior(municipio: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(nomeArquivo(municipio), 'utf-8'));
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(OUT_DIR, { recursive: true });

  const indicadores = args.indicadores
    ? INDICADORES.filter((i) => args.indicadores!.includes(i.id))
    : INDICADORES;
  if (indicadores.length === 0) throw new Error(`Nenhum indicador corresponde a: ${args.indicadores}`);

  let cidades = Object.keys(MUNICIPIOS).sort();
  if (args.cidades) {
    const alvo = new Set(args.cidades.map((c) => c.toLowerCase()));
    cidades = cidades.filter((c) => alvo.has(c.toLowerCase()));
  }
  if (args.limit) cidades = cidades.slice(0, args.limit);

  console.log(`\n[Extrator] ${cidades.length} cidade(s) × ${indicadores.length} indicador(es)`);
  console.log(`[Extrator] Saída: ${OUT_DIR}`);
  console.log(`[Extrator] Concorrência: ${args.conc} | force: ${args.force}\n`);

  let tokensGlobais = 0;
  let processadas = 0;

  for (const municipio of cidades) {
    if (!args.force && (await jaGerado(municipio))) {
      console.log(`• ${municipio}: já existe (use --force para refazer) — pulando`);
      continue;
    }
    const match: MunicipioMatch = { canonical: municipio, urls: MUNICIPIOS[municipio] };
    const filterAddOn = buildFilterAddOn([match]);
    if (!filterAddOn) {
      console.warn(`• ${municipio}: sem blob_url — pulando`);
      continue;
    }

    const t0 = Date.now();
    const resultados = await pool(indicadores, args.conc, (ind) => extraiIndicador(municipio, filterAddOn, ind));

    const porId: Record<string, IndicadorResultado> = {};
    let tokensPasse = 0;
    for (let k = 0; k < indicadores.length; k++) {
      porId[indicadores[k].id] = resultados[k];
      tokensPasse += resultados[k].tokens;
    }
    tokensGlobais += tokensPasse;

    // Merge com o arquivo existente: indicadores NÃO reprocessados neste passe são
    // preservados (mantendo valor/evidência), mas têm os metadados estáticos
    // atualizados conforme a definição vigente — inclusive renomeações (ex.: P8A→P8).
    const anterior = await carregaAnterior(municipio);
    const mesclado: Record<string, any> = {};
    let tokensCidade = 0;
    for (const ind of INDICADORES) {
      if (porId[ind.id]) {
        mesclado[ind.id] = porId[ind.id];
      } else {
        const prev = anterior?.indicadores?.[ind.id] ?? (ind.idAntigo ? anterior?.indicadores?.[ind.idAntigo] : undefined);
        if (!prev) continue;
        mesclado[ind.id] = {
          grupo: ind.grupo,
          nome: ind.nome,
          mede: ind.mede,
          unidade: ind.unidade,
          formula: ind.formula,
          valor: prev.valor,
          componentes: prev.componentes ?? {},
          evidencia: prev.evidencia,
          confianca: prev.confianca,
          tokens: prev.tokens ?? 0,
          obs: 'valor mantido do passe anterior; regra refinada não reprocessada (métrica idêntica)',
          ...(prev.erro ? { erro: prev.erro } : {}),
        };
      }
      tokensCidade += mesclado[ind.id].tokens ?? 0;
    }

    const doc = {
      municipio,
      fonte_documentos: MUNICIPIOS[municipio],
      gerado_em: new Date().toISOString(),
      regras_versao: 'planilha IRM · aba "simplificado" (semáforo)',
      indicadores_reprocessados_neste_passe: indicadores.map((i) => i.id),
      metodo: 'Azure AI Search retrieve (kb-plancon-filtered) com filtro por município (blob_url)',
      tokens_consumidos: tokensCidade,
      indicadores: mesclado,
    };
    await fs.writeFile(nomeArquivo(municipio), JSON.stringify(doc, null, 2) + '\n', 'utf-8');

    processadas++;
    const resumo = indicadores
      .map((ind) => `${ind.id}=${JSON.stringify(porId[ind.id].valor)}`)
      .join(' ');
    console.log(`✓ ${municipio}  [${((Date.now() - t0) / 1000).toFixed(1)}s, ${tokensCidade} tok]  ${resumo}`);
  }

  console.log(`\n[Extrator] Concluído: ${processadas} cidade(s) gravada(s). Tokens totais: ${tokensGlobais}.`);
}

main().catch((e) => {
  console.error('[Extrator] Erro fatal:', e);
  process.exit(1);
});
