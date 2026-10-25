/**
 * Reaplica as regras `calcular` de definicoes.ts aos arquivos já gerados, SEM chamar modelo:
 * usa os `componentes` gravados e o `valor` gravado no lugar do semáforo do modelo. Serve para
 * mudanças de regra (ex.: P2 determinístico) valerem também para resultados já publicados.
 *
 * Uso:
 *   npm run recalcular -- --indicadores P2              # só mostra o que mudaria
 *   npm run recalcular -- --indicadores P2 --gravar     # grava nos <Município>.json
 *   opções: --dir <pasta> (default backend/indicadores)
 *
 * Limitação: o `valor` gravado já passou pela regra antiga; regras que dependem do semáforo
 * original do modelo só são reaplicáveis quando a regra antiga não o alterou.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { INDICADORES } from './definicoes';

function parseArgs(argv: string[]) {
  const out = { dir: path.resolve(__dirname, '../../indicadores'), indicadores: [] as string[], gravar: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') out.dir = path.resolve(argv[++i]);
    else if (a === '--indicador' || a === '--indicadores') out.indicadores = argv[++i].split(',').map((s) => s.trim().toUpperCase());
    else if (a === '--gravar') out.gravar = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const defs = INDICADORES.filter((d) => args.indicadores.includes(d.id) && d.calcular);
  if (defs.length === 0) throw new Error('informe --indicadores com indicadores que tenham regra calcular (ex.: P2)');

  const arquivos = (await fs.readdir(args.dir)).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  const mudancas: Record<string, number> = {};
  const semCampos: Record<string, number> = {};
  let alterados = 0;
  for (const f of arquivos) {
    const p = path.join(args.dir, f);
    const dados = JSON.parse(await fs.readFile(p, 'utf-8'));
    let mudou = false;
    for (const d of defs) {
      const r = dados.indicadores?.[d.id];
      if (!r || r.erro) continue;
      // resultado gerado antes de a regra ganhar campos novos: não dá para recalcular, só reextrair
      const faltando = d.campos.filter((k) => k.nome !== 'valor' && !(k.nome in (r.componentes ?? {})));
      if (faltando.length) {
        semCampos[d.id] = (semCampos[d.id] || 0) + 1;
        continue;
      }
      const novo = d.calcular!({ ...r.componentes, valor: r.valor, evidencia: r.evidencia });
      if (novo === null || novo === r.valor) continue;
      const chave = `${d.id}: ${r.valor} → ${novo}`;
      mudancas[chave] = (mudancas[chave] || 0) + 1;
      console.log(`  ${dados.municipio} · ${chave}`);
      r.valor = novo;
      mudou = true;
    }
    if (mudou) {
      alterados++;
      if (args.gravar) await fs.writeFile(p, JSON.stringify(dados, null, 2) + '\n', 'utf-8');
    }
  }

  console.log(`\n[Recalcular] ${arquivos.length} arquivo(s), ${alterados} com mudança${args.gravar ? ' (gravados)' : ' (simulação; use --gravar)'}`);
  for (const [k, n] of Object.entries(mudancas).sort()) console.log(`  ${k}: ${n}`);
  for (const [k, n] of Object.entries(semCampos).sort()) console.log(`  ${k}: ${n} arquivo(s) sem os campos da regra atual — reextraia`);
}

main().catch((e) => {
  console.error('[Recalcular] Erro:', e.message);
  process.exit(1);
});
