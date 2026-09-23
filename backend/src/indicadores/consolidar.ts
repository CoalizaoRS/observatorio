/**
 * Consolida os arquivos por cidade (<Município>.json) em CSVs agregados, no estilo
 * do indicadores/familias.csv original:
 *   - indicadores/_consolidado/_resumo.csv     → matriz município × valor de cada indicador
 *   - indicadores/_consolidado/<Pn>.csv        → detalhe de um indicador em todas as cidades
 *                                                (valor, unidade, componentes, evidência, confiança)
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

  // 1) Matriz resumo: município × valor de cada indicador
  const cabResumo = ['municipio', ...INDICADORES.map((i) => `${i.id} (${i.unidade})`)];
  const linhasResumo = [cabResumo.map(csv).join(',')];
  for (const c of cidades) {
    const linha = [c.municipio, ...INDICADORES.map((i) => c.indicadores?.[i.id]?.valor ?? '')];
    linhasResumo.push(linha.map(csv).join(','));
  }
  await fs.writeFile(path.join(CONS_DIR, '_resumo.csv'), linhasResumo.join('\n') + '\n', 'utf-8');

  // 2) Um CSV por indicador com detalhe e componentes
  for (const ind of INDICADORES) {
    const compKeys = ind.campos.filter((k) => k.nome !== 'valor').map((k) => k.nome);
    const cab = ['municipio', 'valor', 'unidade', ...compKeys, 'evidencia', 'confianca', 'erro'];
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
      ];
      linhas.push(linha.map(csv).join(','));
    }
    await fs.writeFile(path.join(CONS_DIR, `${ind.id}.csv`), linhas.join('\n') + '\n', 'utf-8');
  }

  console.log(`[Consolidar] ${cidades.length} cidade(s) → ${CONS_DIR}`);
  console.log(`[Consolidar]   _resumo.csv + ${INDICADORES.length} CSV(s) por indicador.`);
}

main().catch((e) => {
  console.error('[Consolidar] Erro:', e);
  process.exit(1);
});
