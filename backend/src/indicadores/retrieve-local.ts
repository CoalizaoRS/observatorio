/**
 * RAG no laboratório LAD/PUCRS: substitui o endpoint `retrieve` do Azure AI Search
 * quando RAG_PROVIDER=local. Mesma interface de ./retrieve.ts — devolve { text, tokens }.
 *
 * - Índice: um arquivo por município em RAG_INDEX_DIR/<Município>.json, gerado por
 *   rag-local/ingestao.py (trechos dos PLANCONs + embeddings normalizados, float32 base64).
 *   A busca é sempre restrita ao município (equivalente ao filterAddOn por blob_url).
 * - Recuperação híbrida: similaridade de cosseno (embedding da pergunta) + BM25 sobre os
 *   trechos, combinados por Reciprocal Rank Fusion. O BM25 ajuda com termos exatos
 *   (NUPDEC, sirene, número de vagas) que o embedding às vezes dilui.
 * - Síntese: llama-server (API compatível com OpenAI) com saída restrita a JSON.
 *
 * Configuração por ambiente:
 *   RAG_INDEX_DIR   pasta com os índices por município
 *   RAG_EMB_URL     llama-server de embeddings (default http://127.0.0.1:8091)
 *   RAG_CHAT_URL    llama-server de chat       (default http://127.0.0.1:8090)
 *   RAG_TOP_K       trechos enviados ao modelo  (default 12; municípios com até
 *                   RAG_DOC_INTEIRO trechos mandam o documento inteiro, default 20)
 *   RAG_MAX_CHARS   teto de caracteres de contexto (default 26000 ≈ 8k tokens, cabe no
 *                   slot de 12k do llama-server com o prompt e a resposta)
 *   RAG_VIZINHOS    os N melhores trechos levam junto o trecho seguinte (default 4)
 *   RAG_THINKING    1 liga o modo de raciocínio do Qwen3 (melhor nos semáforos, ~3x mais lento)
 */

import { readFileSync } from 'fs';
import * as path from 'path';
import type { RetrieveResult } from './retrieve';

const INDEX_DIR = process.env.RAG_INDEX_DIR || '';
const EMB_URL = process.env.RAG_EMB_URL || 'http://127.0.0.1:8091';
const CHAT_URL = process.env.RAG_CHAT_URL || 'http://127.0.0.1:8090';
const TOP_K = Number(process.env.RAG_TOP_K) || 12;
const DOC_INTEIRO = Number(process.env.RAG_DOC_INTEIRO) || 20;
const THINKING = process.env.RAG_THINKING === '1';
const MAX_CHARS = Number(process.env.RAG_MAX_CHARS) || 26000;
const MAX_ANCORAS = 6; // trechos-âncora (IndicadorDef.ancoras) que entram fora do ranking
const VIZINHOS = Number(process.env.RAG_VIZINHOS ?? 4); // quantos dos melhores trechos levam o seguinte junto

// Qwen3-Embedding recupera melhor com a instrução no lado da consulta (documentos vão sem).
const INSTRUCAO_BUSCA =
  'Instruct: Dada uma pergunta sobre o plano de contingência de proteção e defesa civil de um município, ' +
  'recupere os trechos do plano que contêm a informação pedida\nQuery: ';

const SISTEMA =
  'Você é um analista de defesa civil que lê Planos de Contingência (PLANCON) de municípios do Rio Grande do Sul. ' +
  'Responda usando EXCLUSIVAMENTE os trechos do PLANCON fornecidos. Se a informação não estiver nos trechos, ' +
  'trate-a como não informada ("N/A"). Nunca invente números. A "evidencia" deve ser uma citação literal de um trecho.';

interface Trecho {
  arquivo: string;
  pagina: number | null;
  texto: string;
}

interface Indice {
  trechos: Trecho[];
  vetores: Float32Array;
  dim: number;
  bm25: Bm25;
}

// ---------------------------------------------------------------------------
// Índice por município (carregado sob demanda e mantido em memória)
// ---------------------------------------------------------------------------
const indices = new Map<string, Indice>();

function carregaIndice(municipio: string): Indice {
  const cache = indices.get(municipio);
  if (cache) return cache;
  if (!INDEX_DIR) throw new Error('RAG_INDEX_DIR não definido');
  const bruto = JSON.parse(readFileSync(path.join(INDEX_DIR, `${municipio}.json`), 'utf-8'));
  const buf = Buffer.from(bruto.vetores, 'base64');
  const vetores = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const indice: Indice = { trechos: bruto.trechos, vetores, dim: bruto.dim, bm25: new Bm25(bruto.trechos.map((t: Trecho) => t.texto)) };
  indices.set(municipio, indice);
  return indice;
}

// ---------------------------------------------------------------------------
// BM25 mínimo (sem acentos, caixa baixa)
// ---------------------------------------------------------------------------
const STOP = new Set('a o e de da do das dos em no na nos nas um uma para por com que se ou ao aos as os ser sao qual quais como sobre plano municipio'.split(' '));

function tokens(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

class Bm25 {
  private docs: Map<string, number>[];
  private lens: number[];
  private df = new Map<string, number>();
  private avg: number;

  constructor(textos: string[]) {
    this.docs = textos.map((t) => {
      const tf = new Map<string, number>();
      for (const tk of tokens(t)) tf.set(tk, (tf.get(tk) || 0) + 1);
      return tf;
    });
    this.lens = this.docs.map((d) => [...d.values()].reduce((a, b) => a + b, 0));
    for (const d of this.docs) for (const tk of d.keys()) this.df.set(tk, (this.df.get(tk) || 0) + 1);
    this.avg = this.lens.reduce((a, b) => a + b, 0) / Math.max(1, this.lens.length);
  }

  scores(consulta: string): number[] {
    const n = this.docs.length;
    const q = [...new Set(tokens(consulta))];
    return this.docs.map((d, i) =>
      q.reduce((s, tk) => {
        const f = d.get(tk);
        if (!f) return s;
        const idf = Math.log(1 + (n - this.df.get(tk)! + 0.5) / (this.df.get(tk)! + 0.5));
        return s + (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (this.lens[i] / this.avg)));
      }, 0)
    );
  }
}

// ---------------------------------------------------------------------------
// Chamadas ao llama-server
// ---------------------------------------------------------------------------
async function postJson(url: string, body: unknown): Promise<any> {
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${url}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

async function embedConsultas(textos: string[]): Promise<Float32Array[]> {
  const data = await postJson(`${EMB_URL}/v1/embeddings`, { input: textos.map((t) => INSTRUCAO_BUSCA + t) });
  return (data.data as any[])
    .sort((a, b) => a.index - b.index)
    .map((d) => {
      const v = Float32Array.from(d.embedding as number[]);
      const norma = Math.hypot(...v) || 1;
      return v.map((x) => x / norma);
    });
}

/**
 * Consultas de busca a partir do prompt montado por extrair.ts: a pergunta e o critério
 * de classificação viram consultas SEPARADAS. Juntas, o critério (que lista também o que
 * NÃO conta, ex.: "população total") puxava justamente os trechos errados; separado, ele
 * traz os trechos do amarelo/verde (ex.: voluntários no P7) que a pergunta sozinha não traz.
 */
function consultasDeBusca(prompt: string): string[] {
  const fim = prompt.indexOf('Responda SOMENTE');
  const corpo = fim > 0 ? prompt.slice(0, fim) : prompt;
  const [pergunta, criterio] = corpo.split(/\n\s*Critério de classificação:\s*/);
  return [pergunta.replace(/^Pergunta:\s*/, '').trim(), criterio?.trim()].filter((c): c is string => !!c);
}

function rankDe(scores: ArrayLike<number>): number[] {
  const ordem = Array.from(scores, (s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  const rank = new Array<number>(scores.length);
  ordem.forEach(([, i], r) => (rank[i] = r));
  return rank;
}

export async function retrieveLocal(municipio: string, pergunta: string, ancoras?: RegExp): Promise<RetrieveResult> {
  // Texto de OCR ruidoso rende bem menos caracteres por token que o normal; se estourar o
  // contexto do llama-server, tenta de novo com menos texto em vez de perder o indicador.
  for (let limite = MAX_CHARS; ; limite = Math.floor(limite * 0.7)) {
    try {
      return await consulta(municipio, pergunta, limite, ancoras);
    } catch (e) {
      if (!/exceed_context_size/.test((e as Error).message) || limite < 4000) throw e;
    }
  }
}

async function consulta(municipio: string, pergunta: string, MAX_CHARS: number, ancoras?: RegExp): Promise<RetrieveResult> {
  const indice = carregaIndice(municipio);
  const n = indice.trechos.length;
  const totalChars = indice.trechos.reduce((s, t) => s + t.texto.length, 0);
  let escolhidos: number[];
  if (n <= DOC_INTEIRO && totalChars <= MAX_CHARS) {
    escolhidos = Array.from({ length: n }, (_, i) => i); // documento pequeno: vai inteiro
  } else {
    const consultas = consultasDeBusca(pergunta);
    const rankings = (await embedConsultas(consultas)).map((q) => {
      const cos = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        const base = i * indice.dim;
        for (let j = 0; j < indice.dim; j++) s += q[j] * indice.vetores[base + j];
        cos[i] = s;
      }
      return rankDe(cos);
    });
    rankings.push(rankDe(indice.bm25.scores(consultas.join(' '))));
    const ordenados = Array.from({ length: n }, (_, i) => [rankings.reduce((s, r) => s + 1 / (60 + r[i]), 0), i] as const)
      .sort((a, b) => b[0] - a[0])
      .map(([, i]) => i);
    // Candidatos, em ordem de prioridade:
    //  1. primeiro e último trecho de cada arquivo: capa e fecho trazem a data do plano (P6) e o
    //     carimbo de impressão do SEGIRD, que a busca semântica raramente recupera;
    //  2. os VIZINHOS mais bem ranqueados vêm junto com o seguinte, porque listas e tabelas (ex.:
    //     "11. ENDEREÇO DOS ABRIGOS:" no fim de um trecho) continuam no próximo sem repetir o título;
    //  3. o restante do ranking.
    const fixos: number[] = [];
    indice.trechos.forEach((t, i) => {
      if (i === 0 || indice.trechos[i - 1].arquivo !== t.arquivo) fixos.push(i);
      if (i === n - 1 || indice.trechos[i + 1].arquivo !== t.arquivo) fixos.push(i);
    });
    // trechos-âncora do indicador (os com mais ocorrências primeiro), logo depois dos fixos
    const comAncora = ancoras
      ? indice.trechos
          .map((t, i) => [(t.texto.match(new RegExp(ancoras.source, 'gi')) || []).length, i] as const)
          .filter(([q]) => q > 0)
          .sort((a, b) => b[0] - a[0])
          .slice(0, MAX_ANCORAS)
          .map(([, i]) => i)
      : [];
    fixos.push(...comAncora);
    const candidatos = [
      ...fixos,
      ...ordenados.slice(0, VIZINHOS).flatMap((i) => (i + 1 < n && indice.trechos[i + 1].arquivo === indice.trechos[i].arquivo ? [i, i + 1] : [i])),
      ...ordenados,
    ];
    // Até TOP_K trechos do ranking (mais os fixos), sem estourar o contexto (trechos de OCR podem ser bem maiores que a média)
    const vistos = new Set<number>();
    let chars = 0;
    let doRanking = 0;
    for (const i of candidatos) {
      if (vistos.has(i)) continue;
      const fixo = doRanking === 0 && fixos.includes(i);
      if (!fixo && doRanking >= TOP_K) break;
      if (chars + indice.trechos[i].texto.length > MAX_CHARS) continue;
      vistos.add(i);
      chars += indice.trechos[i].texto.length;
      if (!fixo) doRanking++;
    }
    escolhidos = [...vistos].sort((a, b) => a - b); // ordem do documento ajuda o modelo a ler tabelas e seções em sequência
  }

  const contexto = escolhidos
    .map((i, k) => {
      const t = indice.trechos[i];
      const origem = `${path.basename(t.arquivo)}${t.pagina ? `, p. ${t.pagina}` : ''}`;
      return `[Trecho ${k + 1} — ${origem}]\n${t.texto}`;
    })
    .join('\n\n');

  const data = await postJson(`${CHAT_URL}/v1/chat/completions`, {
    messages: [
      { role: 'system', content: SISTEMA },
      {
        role: 'user',
        content: `Município da consulta: ${municipio}.\n\nTrechos do PLANCON:\n\n${contexto}\n\n---\n\n${pergunta}`,
      },
    ],
    // Com raciocínio, a gramática JSON só pode valer para a resposta final; o llama-server
    // separa o <think> em reasoning_content e extrair.ts já recorta o JSON do texto.
    ...(THINKING
      ? { temperature: 0.6, top_p: 0.95, max_tokens: 4096 }
      : { temperature: 0.1, max_tokens: 1024, response_format: { type: 'json_object' } }),
    chat_template_kwargs: { enable_thinking: THINKING },
  });
  const text: string = data?.choices?.[0]?.message?.content ?? '';
  const tokensUsados = (data?.usage?.prompt_tokens || 0) + (data?.usage?.completion_tokens || 0);
  return { text, tokens: tokensUsados };
}
