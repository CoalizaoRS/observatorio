/**
 * Consolida os arquivos por cidade (<Município>.json) em CSVs agregados, no estilo
 * do indicadores/familias.csv original:
 *   - indicadores/_consolidado/_resumo.csv     → matriz município × valor de cada indicador
 *   - indicadores/_consolidado/<Pn>.csv        → detalhe de um indicador em todas as cidades
 *                                                (valor, unidade, componentes, evidência, confiança,
 *                                                origem: azure | gemma | manual;
 *                                                fonte_plano: Prepara RS | Site Municipal, url_plano)
 *
 * Ajustes manuais (indicadores/_ajustes_manuais.json) são aplicados POR CIMA dos resultados
 * automáticos na consolidação — os <Município>.json continuam sendo a saída dos modelos, e uma
 * reextração não apaga a revisão. Cada ajuste:
 *   { "municipio": "Capitão", "indicador": "P4", "valor": "verde",
 *     "evidencia": "<trecho literal>", "pagina": 25, "justificativa": "...",
 *     "revisado_por": "...", "data": "2026-10-25" }
 * O ajuste vale para o plano revisado: "fonte_plano" (default "Prepara RS"). Se o município passou
 * a usar um plano de outra fonte, o ajuste é ignorado (com aviso) até ser revisto sobre o plano novo.
 *
 * Fonte do plano: documentos com chave site-municipal/… vieram do site da prefeitura (monitor,
 * rag-local/fontes_site_municipal.json); os demais, do Prepara RS.
 *
 * Uso:  npm run consolidar
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { INDICADORES } from './definicoes';

const OUT_DIR = path.resolve(__dirname, '../../indicadores');
const CONS_DIR = path.join(OUT_DIR, '_consolidado');

/** Escapa um campo para CSV (aspas duplas + escape de aspas internas). */
function csv(v: any): string {
  const s = v === null || v === undefined ? '' : String(v);
  return `"${s.replace(/"/g, '""').replace(/\s+/g, ' ').trim()}"`;
}

const AJUSTES = path.join(OUT_DIR, '_ajustes_manuais.json');
const FONTES_SITE = path.resolve(__dirname, '../../../rag-local/fontes_site_municipal.json');

interface Ajuste {
  municipio: string;
  indicador: string;
  valor: string;
  evidencia: string;
  pagina?: number | string;
  justificativa: string;
  revisado_por: string;
  data: string;
  fonte_plano?: string;
}

/** Prepara RS | Site Municipal, a partir dos documentos de fato processados para o município. */
function fontePlano(c: any): string {
  const docs: string[] = c?.fonte_documentos ?? [];
  return docs.some((d) => d.startsWith('site-municipal/')) ? 'Site Municipal' : 'Prepara RS';
}

/** azure | gemma | manual, a partir do método gravado no indicador (ou no arquivo). */
function origem(r: any, c: any): string {
  const m = String(r?.metodo ?? c?.metodo ?? '');
  if (/revis[ãa]o manual/i.test(m)) return 'manual';
  if (/azure/i.test(m)) return 'azure';
  if (/llama\.cpp|gemma|qwen/i.test(m)) return 'gemma';
  return '';
}

async function carregaAjustes(): Promise<Ajuste[]> {
  try {
    return JSON.parse(await fs.readFile(AJUSTES, 'utf-8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`_ajustes_manuais.json inválido: ${(e as Error).message}`);
  }
}

async function main() {
  await fs.mkdir(CONS_DIR, { recursive: true });

  const arquivos = (await fs.readdir(OUT_DIR)).filter(
    (f) => f.endsWith('.json') && !f.startsWith('_')
  );
  if (arquivos.length === 0) {
    console.log('[Consolidar] Nenhum <cidade>.json encontrado. Rode "npm run extrair" antes.');
    return;
  }

  const cidades: any[] = [];
  for (const f of arquivos.sort()) {
    try {
      cidades.push(JSON.parse(await fs.readFile(path.join(OUT_DIR, f), 'utf-8')));
    } catch {
      console.warn(`[Consolidar] ignorando arquivo inválido: ${f}`);
    }
  }

  // URL do plano publicado no site da prefeitura (os do Prepara RS não têm link público)
  const fontesSite: Record<string, { url: string; situacao: string }> = JSON.parse(
    await fs.readFile(FONTES_SITE, 'utf-8').catch(() => '{}')
  );
  const urlPlano = (c: any) => (fontePlano(c) === 'Site Municipal' ? fontesSite[c.municipio]?.url ?? '' : '');

  // Ajustes manuais por cima do resultado automático (o valor automático fica registrado)
  const ajustes = await carregaAjustes();
  let ignorados = 0;
  for (const a of ajustes) {
    const c = cidades.find((x) => x.municipio === a.municipio);
    const r = c?.indicadores?.[a.indicador];
    if (!r) throw new Error(`ajuste manual sem resultado correspondente: ${a.municipio} · ${a.indicador}`);
    const fonteAjuste = a.fonte_plano ?? 'Prepara RS';
    if (fonteAjuste !== fontePlano(c)) {
      console.warn(`[Consolidar] ajuste ignorado: ${a.municipio} · ${a.indicador} foi revisado sobre o plano do ${fonteAjuste}; o plano agora vem do ${fontePlano(c)} — revisar`);
      ignorados++;
      continue;
    }
    Object.assign(r, {
      valor_automatico: r.valor,
      metodo_automatico: r.metodo ?? c.metodo,
      valor: a.valor,
      evidencia: `${a.evidencia}${a.pagina ? ` (p. ${a.pagina})` : ''} — Revisão manual: ${a.justificativa}`,
      confianca: 'alta',
      metodo: `revisão manual (${a.revisado_por}, ${a.data})`,
    });
  }
  if (ajustes.length) console.log(`[Consolidar] ${ajustes.length - ignorados} ajuste(s) manual(is) aplicado(s).`);

  // 1) Matriz resumo: município × valor de cada indicador
  const cabResumo = ['municipio', ...INDICADORES.map((i) => `${i.id} (${i.unidade})`), 'fonte_plano', 'url_plano'];
  const linhasResumo = [cabResumo.map(csv).join(',')];
  for (const c of cidades) {
    const linha = [c.municipio, ...INDICADORES.map((i) => c.indicadores?.[i.id]?.valor ?? ''), fontePlano(c), urlPlano(c)];
    linhasResumo.push(linha.map(csv).join(','));
  }
  await fs.writeFile(path.join(CONS_DIR, '_resumo.csv'), linhasResumo.join('\n') + '\n', 'utf-8');

  // 2) Um CSV por indicador com detalhe e componentes
  for (const ind of INDICADORES) {
    const compKeys = ind.campos.filter((k) => k.nome !== 'valor').map((k) => k.nome);
    const cab = ['municipio', 'valor', 'unidade', ...compKeys, 'evidencia', 'confianca', 'erro', 'origem', 'fonte_plano', 'url_plano'];
    const linhas = [cab.map(csv).join(',')];
    for (const c of cidades) {
      const r = c.indicadores?.[ind.id];
      if (!r) continue;
      const linha = [
        c.municipio,
        r.valor,
        r.unidade,
        ...compKeys.map((k) => r.componentes?.[k] ?? ''),
        r.evidencia,
        r.confianca,
        r.erro ?? '',
        origem(r, c),
        fontePlano(c),
        urlPlano(c),
      ];
      linhas.push(linha.map(csv).join(','));
    }
    await fs.writeFile(path.join(CONS_DIR, `${ind.id}.csv`), linhas.join('\n') + '\n', 'utf-8');
  }

  const porFonte: Record<string, number> = {};
  for (const c of cidades) porFonte[fontePlano(c)] = (porFonte[fontePlano(c)] || 0) + 1;
  console.log(`[Consolidar] fonte dos planos: ${Object.entries(porFonte).map(([f, n]) => `${f} ${n}`).join(', ')}`);
  console.log(`[Consolidar] ${cidades.length} cidade(s) → ${CONS_DIR}`);
  console.log(`[Consolidar]   _resumo.csv + ${INDICADORES.length} CSV(s) por indicador.`);
}

main().catch((e) => {
  console.error('[Consolidar] Erro:', e);
  process.exit(1);
});
