/**
 * Servidor Proxy Seguro - Observatório da Resiliência Climática
 * Desenvolvido em Node.js utilizando Express.
 *
 * Este servidor atua como um intermediário seguro (Proxy). Ele recebe as requisições
 * do front-end, anexa a chave da Azure e efetua a chamada ao Azure AI Search,
 * protegendo as credenciais contra exposição pública.
 *
 * Filtro determinístico por município: detecta a cidade citada no prompt e restringe
 * a busca aos documentos (blob_url) daquele município via `filterAddOn`, eliminando a
 * mistura de dados entre cidades. Ver src/municipios.ts.
 */

import express from 'express';
import cors from 'cors';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { detectMunicipios, buildFilterAddOn, MUNICIPIOS } from './municipios';
import { SEARCH_BASE, SEARCH_KB, SEARCH_KS, SEARCH_KEY, SEARCH_INDEX, INDEX_API_VERSION, RETRIEVE_ENDPOINT } from './config';

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração de CORS para permitir requisições seguras do seu front-end
// Em produção, substitua '*' pela origem exata do seu domínio
app.use(cors({
    origin: '*'
}));

app.use(express.json());

const systemPrompt = `
Você é um assistente especializado nos Planos de Contingência (PLANCON) dos municípios do Rio Grande do Sul.
Responda de forma sucinta, em português do Brasil, usando exclusivamente os documentos recuperados.
Se a busca trouxer mais de um município, separe os dados de cada um em listas distintas e nunca misture dados entre municípios.
`;

// Configuração da Azure AI Search: ver ./config.ts (compartilhada com o pipeline
// de indicadores em indicadores/retrieve.ts).

// Rota de saúde para verificar se o servidor está online
app.get('/health', (req, res) => {
    res.json({ status: "healthy", service: "Observatório Proxy Backend" });
});

// --- Entrega de indicadores em CSV ---------------------------------------
// Os CSVs consolidados (gerados por src/indicadores/consolidar.ts) são embutidos na
// imagem em ./dados/csv e entregues por nome. Também estão disponíveis publicamente no
// blob (CSV_BLOB_BASE) para consumo direto pelo front-end.
const CSV_DIR = path.join(__dirname, '../dados/csv');
const CSV_BLOB_BASE = process.env.CSV_BLOB_BASE || "https://plancon.blob.core.windows.net/indicadores";

// Lista os CSVs disponíveis (nome + URL local no proxy e URL pública no blob).
app.get('/api/csv', async (req, res) => {
    try {
        const arquivos = (await fsp.readdir(CSV_DIR))
            .filter(f => f.toLowerCase().endsWith('.csv'))
            .sort();
        res.json({
            count: arquivos.length,
            arquivos: arquivos.map(nome => ({
                nome,
                url_local: `/api/csv/${encodeURIComponent(nome)}`,
                url_blob: `${CSV_BLOB_BASE}/${encodeURIComponent(nome)}`
            }))
        });
    } catch (error) {
        const err = error as Error;
        res.status(500).json({ error: { message: "Falha ao listar CSVs.", details: err.message } });
    }
});

// Entrega um CSV pelo nome. Sanitiza o nome (sem barras, sem "..", só *.csv) para
// impedir path traversal — só arquivos do diretório CSV_DIR podem ser servidos.
app.get('/api/csv/:nome', async (req, res) => {
    const bruto = req.params.nome;
    const nome = path.basename(bruto);
    if (nome !== bruto || !/^[\w.\-]+\.csv$/i.test(nome)) {
        return res.status(400).json({ error: { message: "Nome de arquivo inválido. Use algo como 'P1.csv' ou '_resumo.csv'." } });
    }
    try {
        const conteudo = await fsp.readFile(path.join(CSV_DIR, nome));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.send(conteudo);
    } catch {
        return res.status(404).json({ error: { message: `CSV não encontrado: ${nome}` } });
    }
});

// Máximo de mensagens do histórico reencaminhadas à Azure (controla custo de tokens).
const MAX_HISTORY = 12;

type Turn = { role: "user" | "assistant"; text: string };

/**
 * Normaliza o corpo da requisição para um histórico de turnos.
 * Aceita tanto o formato single-turn { prompt } quanto multi-turno { messages: [{role, text}] }.
 * Também aceita content em array (formato Azure) — extrai o texto.
 */
function parseHistory(body: any): Turn[] {
    const textOf = (m: any): string => {
        if (typeof m?.text === "string") return m.text;
        if (typeof m?.content === "string") return m.content;
        if (Array.isArray(m?.content)) {
            return m.content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join(" ").trim();
        }
        return "";
    };
    if (Array.isArray(body?.messages) && body.messages.length > 0) {
        return body.messages
            .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && textOf(m).trim())
            .map((m: any) => ({ role: m.role, text: textOf(m).trim() }));
    }
    if (typeof body?.prompt === "string" && body.prompt.trim()) {
        return [{ role: "user", text: body.prompt.trim() }];
    }
    return [];
}

// ---------------------------------------------------------------------------
// Enriquecimento das referências com a URL do documento no blob.
// O retrieve devolve, para cada referência, apenas `docKey` (== campo-chave `uid` do
// índice) — sem o `blob_url`. Resolvemos o blob_url consultando o índice POR CHAVE
// (`uid` não é filterable, então não dá para filtrar em lote). Referências do mesmo
// documento compartilham o mesmo prefixo do docKey (diferindo só no sufixo de página),
// então deduplicamos por documento e fazemos 1 GET por documento.
// ---------------------------------------------------------------------------

/** Nome legível do documento a partir do blob_url (basename decodificado). */
function nomeDoDocumento(blobUrl: string): string {
    const base = blobUrl.split('/').pop() || blobUrl;
    try { return decodeURIComponent(base); } catch { return base; }
}

/** "Parent key" do docKey: remove o sufixo de página (`_pages_N` / `_normalized_images_N`). */
function parentKeyDeDocKey(docKey: string): string {
    return docKey.replace(/_(?:pages|normalized_images)_\d+$/, '');
}

/** Resolve o blob_url de um docKey via GET-por-chave no índice. Nunca lança; null em erro. */
async function blobUrlDeDocKey(docKey: string): Promise<string | null> {
    try {
        const url = `${SEARCH_BASE}/indexes/${SEARCH_INDEX}/docs('${encodeURIComponent(docKey)}')` +
                    `?api-version=${INDEX_API_VERSION}&$select=blob_url`;
        const resp = await fetch(url, { headers: { 'api-key': SEARCH_KEY } });
        if (!resp.ok) return null;
        const doc: any = await resp.json();
        return typeof doc?.blob_url === "string" ? doc.blob_url : null;
    } catch {
        return null;
    }
}

/**
 * Adiciona `blob_url` e `documentName` a cada item de `references` (in-place).
 * Otimização: se o escopo tem um único documento, atribui direto sem nenhuma chamada.
 * Caso contrário, resolve por documento (1 GET por doc distinto, em paralelo).
 */
async function enriquecerReferencias(refs: any[], urlsCandidatas: string[]): Promise<void> {
    if (!Array.isArray(refs) || refs.length === 0) return;

    const aplicar = (ref: any, blobUrl: string | null) => {
        if (blobUrl) {
            ref.blob_url = blobUrl;
            ref.documentName = nomeDoDocumento(blobUrl);
        }
    };

    // Escopo de documento único (caso comum: município com 1 PDF) → sem lookup.
    if (urlsCandidatas.length === 1) {
        for (const ref of refs) aplicar(ref, urlsCandidatas[0]);
        return;
    }

    // Múltiplos documentos possíveis → resolve por documento (dedup por parent key).
    const porParent = new Map<string, any[]>();
    for (const ref of refs) {
        const docKey = ref?.docKey;
        if (typeof docKey !== "string") continue;
        const parent = parentKeyDeDocKey(docKey);
        (porParent.get(parent) ?? porParent.set(parent, []).get(parent)!).push(ref);
    }

    await Promise.all([...porParent.values()].map(async (grupo) => {
        const blobUrl = await blobUrlDeDocKey(grupo[0].docKey);
        for (const ref of grupo) aplicar(ref, blobUrl);
    }));
}

// Endpoint intermédio para processar a busca (retrieve) de forma segura.
// Contrato ÚNICO (mesmo layout na 1ª chamada e nas seguintes — o front só faz crescer `messages`):
//   entrada: { municipio?: string|string[], messages: [{ role:"user"|"assistant", text }] }
//            (na 1ª chamada, `messages` tem só um turno "user"; deve terminar sempre em "user")
//   saída:   resposta da Azure + `municipios: string[]` (município(s) resolvido(s), p/ o front travar)
//            ou { municipioRequired: true, ... } quando nenhum município foi informado/detectado
//   legado:  { prompt } ainda é aceito como atalho de turno único (equivale a um único "user")
app.post('/api/retrieve', async (req, res) => {
    const history = parseHistory(req.body);

    if (history.length === 0 || history[history.length - 1].role !== "user") {
        return res.status(400).json({
            error: {
                message: "Requisição inválida.",
                details: "Envie { \"prompt\": \"...\" } ou { \"messages\": [...] } terminando em uma mensagem de role \"user\"."
            }
        });
    }

    const lastUser = history[history.length - 1].text;

    // Resolução do município, em ordem de prioridade:
    // 1) o parâmetro `municipio` enviado pelo cliente (seleção prévia no dropdown ou trava da
    //    sessão) — é uma escolha deliberada, então tem prioridade e vale já na primeira consulta;
    // 2) cidade citada na última mensagem do usuário (permite fluxo só por texto / troca de cidade
    //    quando o cliente NÃO envia o parâmetro);
    // 3) qualquer cidade citada no histórico completo (última menção).
    // Um `municipio` inválido/desconhecido não trava a busca: cai para os fallbacks de texto.
    let matches: ReturnType<typeof detectMunicipios> = [];
    if (req.body?.municipio) {
        const selecionado = Array.isArray(req.body.municipio) ? req.body.municipio.join(" ") : String(req.body.municipio);
        matches = detectMunicipios(selecionado);
    }
    if (matches.length === 0) {
        matches = detectMunicipios(lastUser);
    }
    if (matches.length === 0) {
        const allUserText = history.filter(m => m.role === "user").map(m => m.text).join(" ");
        matches = detectMunicipios(allUserText);
    }

    // Sem município reconhecido -> pede para especificar, sem chamar a busca.
    if (matches.length === 0) {
        console.log(`[Proxy] Nenhum município reconhecido. Solicitando especificação.`);
        const exemplos = ["Porto Alegre", "Canoas", "São Leopoldo", "Gravataí", "Novo Hamburgo"];
        return res.status(200).json({
            municipioRequired: true,
            municipios: [],
            municipiosDisponiveis: Object.keys(MUNICIPIOS).sort(),
            response: [{
                content: [{
                    type: "text",
                    text: `Por favor, especifique o município da sua pergunta. Ex.: ${exemplos.join(", ")}. ` +
                          `A base cobre ${Object.keys(MUNICIPIOS).length} municípios do Rio Grande do Sul.`
                }]
            }]
        });
    }

    const filterAddOn = buildFilterAddOn(matches);
    const municipios = matches.map(m => m.canonical);

    try {
        console.log(`[Proxy] Município(s): ${municipios.join(", ")} | turnos: ${history.length} | filtro: ${filterAddOn}`);

        // Monta o array de mensagens para a Azure: system + histórico (limitado) com content em array.
        // O filtro restringe os DOCUMENTOS ao município, mas o modelo também precisa SABER o escopo
        // pelo texto — senão, com prompts curtos como "Abrigos", ele pede a cidade. Por isso
        // injetamos o(s) município(s) como prefixo na última mensagem do usuário (o turno atual).
        const scope = municipios.join(", ");
        const trimmed = history.slice(-MAX_HISTORY);
        const payload: any = {
            messages: [
                { role: "system", content: [{ type: "text", text: systemPrompt }] },
                ...trimmed.map((m, i) => {
                    const isCurrentUserTurn = i === trimmed.length - 1 && m.role === "user";
                    const text = isCurrentUserTurn
                        ? `Município da consulta: ${scope}.\n\n${m.text}`
                        : m.text;
                    return { role: m.role, content: [{ type: "text", text }] };
                })
            ]
        };

        // Restringe a busca aos blob_url do(s) município(s) resolvido(s).
        if (filterAddOn) {
            payload.knowledgeSourceParams = [{
                knowledgeSourceName: SEARCH_KS,
                kind: "searchIndex",
                filterAddOn
            }];
        }

        // Chamada de servidor para servidor (CORS não se aplica aqui).
        const response = await fetch(RETRIEVE_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': SEARCH_KEY
            },
            body: JSON.stringify(payload)
        });

        const data: any = await response.json();

        if (response.ok) {
            console.log(`[Proxy] Resposta recebida da Azure com sucesso (Status ${response.status}).`);
            // Ecoa o(s) município(s) resolvido(s) para o front-end travar nos próximos turnos.
            if (data && typeof data === "object") {
                data.municipios = municipios;
                // Anexa blob_url + documentName a cada referência (para link no front).
                if (Array.isArray(data.references)) {
                    await enriquecerReferencias(data.references, matches.flatMap(m => m.urls));
                }
            }
        } else {
            console.warn(`[Proxy] A Azure retornou um erro (Status ${response.status}):`, data);
        }
        return res.status(response.status).json(data);

    } catch (error) {
        const err = error as Error;
        console.error("[Proxy] Erro interno ao processar a requisição de busca:", error);
        return res.status(500).json({
            error: {
                message: "Falha interna no servidor proxy ao comunicar com a Azure AI Search.",
                details: err.message
            }
        });
    }
});

// Inicialização do Servidor
app.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(`  OBSERVATÓRIO DA RESILIÊNCIA CLIMÁTICA - BACKEND PROXY ONLINE  `);
    console.log(`  Porta de escuta: http://localhost:${PORT}                      `);
    console.log(`  KB: ${SEARCH_KB} | KS: ${SEARCH_KS}                            `);
    console.log(`================================================================`);
});
