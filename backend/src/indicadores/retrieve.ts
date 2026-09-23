/**
 * Cliente do endpoint agêntico "knowledgebases/{kb}/retrieve" do Azure AI Search —
 * o MESMO backend de RAG usado pelo proxy (../index.ts). A recuperação é restrita
 * aos documentos do município via `filterAddOn` (city-based retrieval), o que mantém
 * o contexto pequeno e reduz o consumo de tokens do modelo de síntese (gpt-5-mini).
 *
 * Configuração (endpoint, índice, chave) compartilhada com o proxy via ../config.
 */

import { SEARCH_KS, SEARCH_KEY, RETRIEVE_ENDPOINT } from '../config';

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
