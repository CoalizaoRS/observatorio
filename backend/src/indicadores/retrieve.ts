/**
 * Cliente do endpoint agêntico "knowledgebases/{kb}/retrieve" do Azure AI Search —
 * o MESMO backend de RAG usado pelo proxy (../index.ts). A recuperação é restrita
 * aos documentos do município via `filterAddOn` (city-based retrieval), o que mantém
 * o contexto pequeno e reduz o consumo de tokens do modelo de síntese (gpt-5-mini).
 *
 * Configuração por variáveis de ambiente (com defaults do serviço do Observatório):
 *   AZURE_SEARCH_BASE, AZURE_SEARCH_KB, AZURE_SEARCH_KS, AZURE_SEARCH_API_VERSION,
 *   AZURE_SEARCH_KEY  (obrigatória — sem default; defina no ambiente/secret)
 */

const SEARCH_BASE = process.env.AZURE_SEARCH_BASE || 'https://observatorio-rag.search.windows.net';
const SEARCH_KB = process.env.AZURE_SEARCH_KB || 'kb-plancon-filtered';
const SEARCH_KS = process.env.AZURE_SEARCH_KS || 'plancon-si-ks';
const SEARCH_API_VERSION = process.env.AZURE_SEARCH_API_VERSION || '2026-05-01-preview';
const SEARCH_KEY = process.env.AZURE_SEARCH_KEY || '';

if (!SEARCH_KEY) {
  console.warn('[extrair/consolidar] ATENÇÃO: AZURE_SEARCH_KEY não definido. As chamadas de retrieve vão falhar até configurar a variável de ambiente.');
}

const RETRIEVE_ENDPOINT = `${SEARCH_BASE}/knowledgebases/${SEARCH_KB}/retrieve?api-version=${SEARCH_API_VERSION}`;

export interface RetrieveResult {
  /** Texto sintetizado pelo modelo (esperado: um objeto JSON). */
  text: string;
  /** Tokens consumidos nesta chamada (planejamento + síntese), para telemetria de custo. */
  tokens: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Executa uma consulta ao RAG restrita a `filterAddOn` (documentos do município).
 * Injeta o município como prefixo da mensagem — como faz o proxy — para que o modelo
 * saiba o escopo mesmo com perguntas curtas. Faz retry com backoff em 429/5xx.
 */
export async function retrieve(
  municipio: string,
  filterAddOn: string,
  pergunta: string,
  opts: { tentativas?: number } = {}
): Promise<RetrieveResult> {
  const tentativas = opts.tentativas ?? 4;

  const userText = `Município da consulta: ${municipio}.\n\n${pergunta}`;
  const payload = {
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    knowledgeSourceParams: [
      { knowledgeSourceName: SEARCH_KS, kind: 'searchIndex', filterAddOn },
    ],
  };

  let ultimoErro = '';
  for (let i = 0; i < tentativas; i++) {
    let resp: Response;
    try {
      resp = await fetch(RETRIEVE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': SEARCH_KEY },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      ultimoErro = `rede: ${(e as Error).message}`;
      await sleep(1000 * (i + 1));
      continue;
    }

    if (resp.status === 429 || resp.status >= 500) {
      ultimoErro = `HTTP ${resp.status}`;
      const espera = Number(resp.headers.get('retry-after')) * 1000 || 2000 * (i + 1);
      await sleep(espera);
      continue;
    }

    const data: any = await resp.json();
    if (!resp.ok) {
      throw new Error(`Retrieve falhou (HTTP ${resp.status}): ${JSON.stringify(data).slice(0, 400)}`);
    }

    const text: string = data?.response?.[0]?.content?.[0]?.text ?? '';
    const tokens: number = Array.isArray(data?.activity)
      ? data.activity.reduce(
          (s: number, a: any) => s + (a?.inputTokens || 0) + (a?.outputTokens || 0),
          0
        )
      : 0;
    return { text, tokens };
  }

  throw new Error(`Retrieve esgotou tentativas para "${municipio}": ${ultimoErro}`);
}

export const CONFIG = { SEARCH_BASE, SEARCH_KB, SEARCH_KS, SEARCH_API_VERSION, RETRIEVE_ENDPOINT };
