/**
 * Configuração compartilhada do Azure AI Search — usada tanto pelo proxy de
 * chat (index.ts) quanto pelo pipeline de indicadores (indicadores/retrieve.ts).
 * Fonte única de verdade: evita que os dois fiquem dessincronizados quando o
 * endpoint, o knowledge source ou a versão da API mudarem.
 *
 * NÃO coloque a chave no código — AZURE_SEARCH_KEY é lida do ambiente/secret.
 */

export const SEARCH_BASE = process.env.AZURE_SEARCH_BASE || 'https://observatorio-rag.search.windows.net';
export const SEARCH_KB = process.env.AZURE_SEARCH_KB || 'kb-plancon-filtered';
export const SEARCH_KS = process.env.AZURE_SEARCH_KS || 'plancon-si-ks';
export const SEARCH_API_VERSION = process.env.AZURE_SEARCH_API_VERSION || '2026-05-01-preview';
export const SEARCH_KEY = process.env.AZURE_SEARCH_KEY || '';

// Índice de busca subjacente ao knowledge source — usado pelo proxy (index.ts) para
// resolver o blob_url de cada referência (o retrieve não devolve o blob_url).
export const SEARCH_INDEX = process.env.AZURE_SEARCH_INDEX || 'knowledgesource-1783085585361-index';
export const INDEX_API_VERSION = process.env.AZURE_SEARCH_INDEX_API_VERSION || '2024-07-01';

export const RETRIEVE_ENDPOINT = `${SEARCH_BASE}/knowledgebases/${SEARCH_KB}/retrieve?api-version=${SEARCH_API_VERSION}`;

if (!SEARCH_KEY) {
  console.warn('[AzureSearch] ATENÇÃO: AZURE_SEARCH_KEY não definido. As chamadas de busca vão falhar até configurar a variável/secret.');
}
