/**
 * P9 — Plano de Contingência público e acessível. Não vem do texto do PLANCON: grava nos
 * <Município>.json o resultado da coleta no site da prefeitura (monitor/acessibilidade.py)
 * e aplica a regra `calcular` de definicoes.ts.
 *
 * Uso:
 *   npm run p9              # só mostra a distribuição
 *   npm run p9 -- --gravar  # grava o P9 nos <Município>.json
 *
 * Site que não pôde ser lido (fora do ar, acesso recusado, robots.txt, página inicial sem links,
 * navegação interrompida) fica cinza (N/A): o município sai do indicador.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { INDICADORES } from './definicoes';

const OUT_DIR = path.resolve(__dirname, '../../indicadores');
const MONITOR = path.resolve(__dirname, '../../../monitor');
// triagem dos planos do site: versao_anterior = o site publica versão mais antiga que a vigente
const TRIAGEM = path.resolve(__dirname, '../../../rag-local/fontes_site_municipal.json');
const P9 = INDICADORES.find((i) => i.id === 'P9')!;

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

function caminhoTexto(c: { texto: string; url: string }[], via: string): string {
  const passos = c.map((p) => (p.texto || p.url).replace(/\s+/g, ' ').trim().slice(0, 80));
  return [via === 'busca_interna' ? 'Início (busca interna)' : 'Início', ...passos.slice(via === 'busca_interna' ? 1 : 0)].join(' → ');
}

async function main() {
  const gravar = process.argv.includes('--gravar');
  const coleta: Record<string, any> = await lerJson(path.join(MONITOR, 'acessibilidade.json'), {});
  const porNome = new Map(Object.entries(coleta).map(([k, v]) => [norm(k), v]));
  const triagem: Record<string, any> = await lerJson(TRIAGEM, {});
  const triagemPorNome = new Map(Object.entries(triagem).map(([k, v]) => [norm(k), v]));

  const arquivos = (await fs.readdir(OUT_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  const dist: Record<string, number> = {};
  let semColeta = 0;
  for (const f of arquivos) {
    const p = path.join(OUT_DIR, f);
    const dados = JSON.parse(await fs.readFile(p, 'utf-8'));
    const r = porNome.get(norm(dados.municipio));
    if (!r) {
      semColeta++;
      continue;
    }
    const doc = r.documento ?? {};

    const conferencia = [
      MOTIVO[r.site_status] ?? '',
      r.via === 'nao_encontrado' && r.documentos_vetados_robots ? `robots.txt vetou documento candidato: ${r.documentos_vetados_robots[0]}` : '',
      r.via === 'erro' ? `erro na coleta: ${r.erro}` : '',
      // nenhuma página interna visitada: endereço errado (domínio estacionado) ou menu só em JavaScript
      r.site_status === 'ok' && r.via === 'nao_encontrado' && !r.paginas_visitadas ? 'página inicial sem links de navegação' : '',
      r.via === 'nao_encontrado' && r.prazo_esgotado ? 'site lento: navegação interrompida antes do fim' : '',
    ].filter(Boolean).join('; ');

    const via = r.via === 'erro' ? 'nao_encontrado' : r.via;
    // só vale para o mesmo arquivo que a triagem comparou (mesmo hash)
    const t = triagemPorNome.get(norm(dados.municipio));
    const anterior = via !== 'nao_encontrado' && t?.situacao === 'versao_anterior' && t.sha256 === doc.sha256;
    if (via !== 'nao_encontrado' && t?.situacao === 'versao_anterior' && !anterior)
      console.warn(`[P9] ${dados.municipio}: triagem versao_anterior é de outro arquivo; refazer a triagem`);
    const componentes = {
      situacao_site: r.site_status ?? 'inacessivel',
      via,
      cliques: r.cliques ?? 'N/A',
      url_documento: doc.url ?? '',
      caminho: r.caminho ? caminhoTexto(r.caminho, via) : '',
      conferencia,
      versao_site: anterior ? t.versao_site ?? '' : '',
      versao_vigente: anterior ? `${t.versao_vigente}, ${t.fonte_vigente}` : '',
    };
    const valor = P9.calcular!(componentes);
    dist[String(valor)] = (dist[String(valor)] || 0) + 1;

    const evidencia =
      via === 'nao_encontrado'
        ? conferencia
          ? `Fora do indicador (site não pôde ser avaliado): ${conferencia}.`
          : `Plano não encontrado no site ${r.home ?? r.site_base} (navegação até ${8} cliques e busca interna).` +
            (r.documento_rejeitado
              ? ` O documento achado (${r.documento_rejeitado.url}) foi rejeitado na revisão manual: ${r.documento_rejeitado.motivo}.`
              : '')
        : via === 'sitemap'
          ? `Plano publicado no site, mas sem caminho de navegação a partir da página inicial (localizado pelo índice do site: ${r.sitemap?.fonte ?? 'sitemap'}). Documento: ${doc.url}`
          : `${componentes.caminho} (${via === 'navegacao' ? `${r.cliques} clique(s)` : 'busca interna'}). Documento: ${doc.url}`;
    const evidenciaFinal = anterior
      ? `Versão no site: ${componentes.versao_site}; versão vigente: ${componentes.versao_vigente}. O site publica uma versão anterior à vigente. ${evidencia}`
      : evidencia;

    dados.indicadores[P9.id] = {
      grupo: P9.grupo,
      nome: P9.nome,
      mede: P9.mede,
      unidade: P9.unidade,
      formula: P9.formula,
      valor,
      componentes,
      evidencia: evidenciaFinal,
      confianca: conferencia ? 'baixa' : 'alta',
      tokens: 0,
      metodo: `coleta no site da prefeitura (monitor/acessibilidade.py, ${r.coletado_em})`,
    };
    if (gravar) await fs.writeFile(p, JSON.stringify(dados, null, 2) + '\n', 'utf-8');
  }
  console.log(`[P9] ${arquivos.length - semColeta} município(s) com coleta; ${semColeta} sem coleta.`);
  console.log('[P9] distribuição:', dist);
  if (!gravar) console.log('[P9] nada gravado (use --gravar).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
