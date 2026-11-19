/**
 * P10 — Canal de cadastro de voluntários. Não vem do texto do PLANCON: grava nos <Município>.json
 * o resultado da busca no site da prefeitura (monitor/voluntarios.json, gerado por
 * monitor/voluntarios.py e revisado em monitor/voluntarios_revisao.py) e aplica a regra `calcular` de definicoes.ts.
 *
 * Os sites que o P9 não conseguiu ler (monitor/acessibilidade.json) não são consultados de novo:
 * ficam cinza (N/A), fora do indicador.
 *
 * Uso:
 *   npm run p10              # só mostra a distribuição
 *   npm run p10 -- --gravar  # grava o P10 nos <Município>.json
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { INDICADORES } from './definicoes';

const OUT_DIR = path.resolve(__dirname, '../../indicadores');
const MONITOR = path.resolve(__dirname, '../../../monitor');
const P10 = INDICADORES.find((i) => i.id === 'P10')!;

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function lerJson(p: string, padrao: any) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return padrao;
    throw e;
  }
}

const MOTIVO: Record<string, string> = {
  inacessivel: 'site não respondeu na coleta',
  acesso_recusado: 'site recusou o acesso automatizado',
  robots_veta: 'robots.txt do site veta robôs',
};

async function main() {
  const gravar = process.argv.includes('--gravar');
  const coleta: Record<string, any> = await lerJson(path.join(MONITOR, 'voluntarios.json'), {});
  const p9: Record<string, any> = await lerJson(path.join(MONITOR, 'acessibilidade.json'), {});
  const porNome = new Map(Object.entries(coleta).map(([k, v]) => [norm(k), v]));
  const p9PorNome = new Map(Object.entries(p9).map(([k, v]) => [norm(k), v]));

  const arquivos = (await fs.readdir(OUT_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  const dist: Record<string, number> = {};
  for (const f of arquivos) {
    const p = path.join(OUT_DIR, f);
    const dados = JSON.parse(await fs.readFile(p, 'utf-8'));
    const r = porNome.get(norm(dados.municipio));
    const a = p9PorNome.get(norm(dados.municipio));

    let componentes: Record<string, any>;
    let evidencia: string;
    let coletadoEm: string;
    if (r) {
      componentes = {
        situacao_site: r.situacao_site ?? 'ok',
        canal: r.canal ?? 'nenhum',
        url_canal: r.url_canal ?? '',
        paginas_lidas: r.paginas_lidas ?? 0,
        conferencia: r.conferencia ?? '',
      };
      evidencia = r.evidencia ?? '';
      coletadoEm = r.coletado_em ?? '';
    } else {
      // fora da busca do P10: o site não pôde ser lido na coleta do P9
      // site_status 'ok' aqui = o P9 leu o site, mas ficou cinza (leitura incompleta: tempo esgotado,
      // nenhuma página lida ou documentos vetados pelo robots.txt)
      const status = a?.site_status && a.site_status !== 'ok' ? a.site_status : 'leitura_incompleta';
      const motivo = MOTIVO[status] ?? 'leitura do site ficou incompleta na coleta do P9';
      componentes = { situacao_site: status, canal: 'N/A', url_canal: '', paginas_lidas: 0, conferencia: motivo };
      evidencia = `Fora do indicador (site não pôde ser avaliado): ${motivo}.`;
      coletadoEm = a?.coletado_em ?? '';
    }
    const valor = P10.calcular!(componentes);
    dist[String(valor)] = (dist[String(valor)] || 0) + 1;

    dados.indicadores[P10.id] = {
      grupo: P10.grupo,
      nome: P10.nome,
      mede: P10.mede,
      unidade: P10.unidade,
      formula: P10.formula,
      valor,
      componentes,
      evidencia,
      confianca: valor === 'N/A' ? 'baixa' : 'alta',
      tokens: 0,
      metodo: `busca no site da prefeitura (monitor/voluntarios.py + revisão manual, ${coletadoEm})`,
    };
    if (gravar) await fs.writeFile(p, JSON.stringify(dados, null, 2) + '\n', 'utf-8');
  }
  console.log('[P10] distribuição:', dist);
  if (!gravar) console.log('[P10] nada gravado (use --gravar).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
