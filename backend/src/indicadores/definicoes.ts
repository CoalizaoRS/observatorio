/**
 * Definição dos 8 indicadores da Fase de Preparação, conforme a aba "simplificado"
 * da planilha do Observatório:
 *   https://docs.google.com/spreadsheets/d/1ck5WJv7X2ifg9cwEp299d1Een-LmjzvVYTHiyKZVOt8/
 *
 * Nesta aba, a "Forma de Apresentação" da maioria dos indicadores é um SEMÁFORO
 * (verde / amarelo / vermelho) baseado no que o PLANCON menciona — e NÃO uma razão
 * numérica. P8 é a exceção (R$ por habitante). Os números de apoio (população em área
 * de risco, vagas, canais de alerta, ano do plano, NUPDECs, despesa) são extraídos como
 * `componentes` e, quando cabe, uma razão derivada é registrada.
 *
 * A extração é sempre restrita aos documentos do município (city-based retrieval /
 * filterAddOn), reduzindo o contexto recuperado — e o consumo de tokens.
 */

export type TipoCampo = 'numero' | 'texto' | 'enum';

export interface CampoDef {
  nome: string;
  tipo: TipoCampo;
  descricao: string;
  opcoes?: string[];
}

export interface IndicadorDef {
  id: string;          // "P1" ... "P8"
  idAntigo?: string;   // código anterior, para migrar arquivos já gerados
  grupo: string;
  nome: string;        // "Indicador" (redação da aba simplificado)
  mede: string;        // "O que mede"
  unidade: string;     // "semáforo (verde/amarelo/vermelho)" ou "R$/hab" ...
  formula: string;     // "Fórmula (V1)" / critério
  criterio: string;    // regra de classificação (VERDE/AMARELO/VERMELHO) da aba
  pergunta: string;    // pergunta de recuperação (pt-BR)
  campos: CampoDef[];
  /** Deriva o valor final. number|string → valor; 'N/A' → sem valor; null → usar json.valor. */
  calcular?: (campos: Record<string, any>) => number | string | 'N/A' | null;
  /**
   * RAG local: trechos que casam com esta expressão entram sempre no contexto (até um limite).
   * Para termos que a busca semântica dilui em planos longos (ex.: "ROTA 01", "Rotas de fuga").
   */
  ancoras?: RegExp;
  /** Componentes numéricos derivados (ex.: razões de apoio) mesclados aos extraídos. */
  derivar?: (campos: Record<string, any>) => Record<string, any>;
}

/** Converte para número aceitando "1.234", "1.234,56", "R$ 10.000,00", etc. */
export function paraNumero(v: any): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const limpo = v
    .replace(/[^0-9.,-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const n = parseFloat(limpo);
  return isFinite(n) ? n : null;
}

/** Razão a×fator/b arredondada; 'N/A' se faltar componente. */
function razao(a: any, b: any, fator: number, casas = 2): number | 'N/A' {
  const na = paraNumero(a);
  const nb = paraNumero(b);
  if (na === null || nb === null || nb === 0) return 'N/A';
  const p = Math.pow(10, casas);
  return Math.round((na / nb) * fator * p) / p;
}

// A ausência do dado no PLANCON é, por definição da aba, o próprio sinal VERMELHO —
// por isso o semáforo NÃO oferece "N/A": não mencionar = vermelho.
const SEMAFORO = ['verde', 'amarelo', 'vermelho'];

// P2: acima disso o "nº de vagas" extraído é lixo (ex.: 155564 em Tucunduva era área/código).
const VAGAS_MAX = 50000;

// P5: itens de meios_alerta que não são canal de emissão de alerta à população.
const NAO_CANAL = /telefon|e-?mail|of[íi]cio|contato|0800|\(\d{2}\)|\d{4,}-?\d{4}|assessoria|emitir alerta|^\s*alarmes?\s*$/i;

/**
 * meios_alerta vem como array ou texto, e um mesmo item às vezes junta vários canais
 * ("Internet, Radio, Telefone", "mídias sociais e mensagens de telefone"): separa em partes
 * e tira parênteses (que costumam trazer números de contato) antes de filtrar. "/" não separa:
 * "carro de som/alto-falante" é um canal só.
 */
function listaDeMeios(v: any): string[] {
  const itens = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : [];
  return itens
    .flatMap((s) => s.replace(/\([^)]*\)/g, ' ').split(/[;,\n]|\s+(?:e|ou)\s+/))
    .map((s) => s.trim())
    .filter((s) => s && !/^n\/?a$/i.test(s));
}

export const INDICADORES: IndicadorDef[] = [
  {
    id: 'P1',
    grupo: 'G1 · Pessoas e Equidade',
    nome: '% população em área de risco',
    mede: 'Grau de conhecimento da população exposta',
    unidade: 'semáforo (verde/vermelho)',
    formula: 'pessoas estimadas em área de risco ÷ população total',
    criterio:
      'VERDE: SOMENTE se o PLANCON declara um número (ou estimativa) ESPECÍFICO de pessoas/famílias que RESIDEM/VIVEM em ÁREAS DE RISCO. ' +
      'VERMELHO: qualquer outro caso. NÃO contam como população em área de risco: (a) a POPULAÇÃO TOTAL do município (censo/IBGE); ' +
      '(b) o número de pessoas ATINGIDAS / AFETADAS / DESALOJADAS por um evento passado (ex.: "a enchente de 2024 atingiu X pessoas") — ' +
      'afetados por um desastre NÃO é o mesmo que residentes em área de risco. Não há AMARELO.',
    pergunta:
      'O PLANCON declara um número (ou estimativa) ESPECÍFICO de pessoas/famílias que RESIDEM/VIVEM em ÁREAS DE RISCO do município? ' +
      'ATENÇÃO, NÃO conte: (a) a população TOTAL do município ("o município tem X habitantes/IBGE"); ' +
      '(b) pessoas ATINGIDAS/AFETADAS/DESALOJADAS por um evento ("a enchente atingiu X", "X desabrigados") — isso é impacto de um ' +
      'desastre, não quem mora em área de risco. Só vale um número de RESIDENTES em áreas de risco (mapeamento/estimativa). ' +
      'Se o documento só traz população total ou afetados, informe populacao_area_risco = "N/A".',
    campos: [
      { nome: 'valor', tipo: 'enum', descricao: 'VERDE só com nº de RESIDENTES em área de risco; senão VERMELHO', opcoes: ['verde', 'vermelho'] },
      { nome: 'populacao_area_risco', tipo: 'numero', descricao: 'nº/estimativa de pessoas que RESIDEM em áreas de risco ("N/A" se só houver população total OU número de afetados/atingidos por evento)' },
      { nome: 'populacao_total', tipo: 'numero', descricao: 'população total do município (ou "N/A")' },
      { nome: 'tipo_do_numero', tipo: 'texto', descricao: 'a que se refere o número informado: "residentes em area de risco", "populacao total", "afetados por evento" ou "N/A"' },
    ],
    // Determinístico: verde só se há nº de RESIDENTES em área de risco (≠ total, ≠ afetados).
    calcular: (c) => {
      const par = paraNumero(c.populacao_area_risco);
      const tot = paraNumero(c.populacao_total);
      const tipo = String(c.tipo_do_numero || '').toLowerCase();
      if (par === null) return 'vermelho';                    // sem número
      if (tot !== null && par === tot) return 'vermelho';     // usou a população total
      if (/afetad|atingid|desaloj|desabrig|total/.test(tipo)) return 'vermelho'; // não são residentes
      return 'verde';
    },
    derivar: (c) => ({ percentual_pop_risco: razao(c.populacao_area_risco, c.populacao_total, 100) }),
  },
  {
    id: 'P2',
    grupo: 'G1 · Pessoas e Equidade',
    nome: 'Capacidade de abrigamento',
    mede: 'Capacidade de acolhimento em caso de evacuação',
    unidade: 'semáforo (verde/amarelo/vermelho)',
    formula: 'PLANCON LISTA abrigos concretos (nomes/endereços) — e, para verde, também vagas',
    criterio:
      'VERDE: SOMENTE se o PLANCON LISTA/IDENTIFICA abrigos concretos (nomes e/ou endereços de abrigos específicos) E informa o número ' +
      'de vagas/capacidade. ' +
      'AMARELO: menciona a existência de abrigos mas SEM listar abrigos concretos, OU lista abrigos sem número de vagas. ' +
      'VERMELHO: não menciona abrigos. ' +
      'IMPORTANTE: afirmar genericamente "o município possui abrigos" (sem nomear/listar) NÃO é verde.',
    pergunta:
      'O PLANCON LISTA abrigos concretos para acolhimento (com nomes e/ou endereços de abrigos específicos)? Informa o NÚMERO DE VAGAS/' +
      'capacidade? ATENÇÃO: uma afirmação genérica "há abrigos" sem listar abrigos específicos NÃO conta como listagem. ' +
      'Informe os abrigos listados, o total de vagas e a população em área de risco.',
    campos: [
      { nome: 'valor', tipo: 'enum', descricao: 'VERDE só se LISTA abrigos concretos + vagas; existência genérica → AMARELO; nada → VERMELHO', opcoes: SEMAFORO },
      { nome: 'abrigos_listados', tipo: 'enum', descricao: 'o plano LISTA abrigos concretos (nomes/endereços)?', opcoes: ['sim', 'nao', 'N/A'] },
      { nome: 'vagas_abrigos', tipo: 'numero', descricao: 'total de vagas em abrigos (ou "N/A")' },
      { nome: 'populacao_area_risco', tipo: 'numero', descricao: 'população em área de risco (ou "N/A")' },
    ],
    // Semáforo determinístico a partir dos componentes (decisão de 22/10/2026), aplicando o
    // critério à risca: abrigos listados + nº de vagas → verde; listados sem vagas → amarelo.
    // Sem lista, só o modelo distingue "menciona abrigos" (amarelo) de "não menciona" (vermelho),
    // mas nunca é verde. Vagas implausíveis (área em m², códigos) contam como não informadas.
    calcular: (c) => {
      if (String(c.abrigos_listados).toLowerCase() === 'sim') {
        const vagas = paraNumero(c.vagas_abrigos);
        return vagas !== null && vagas > 0 && vagas <= VAGAS_MAX ? 'verde' : 'amarelo';
      }
      return String(c.valor).toLowerCase() === 'verde' ? 'amarelo' : null;
    },
    derivar: (c) => ({ vagas_por_1000_hab_risco: razao(c.vagas_abrigos, c.populacao_area_risco, 1000) }),
  },
  {
    id: 'P3',
    grupo: 'G2 · Material, Infraestrutura e Economia',
    nome: 'Simulados de evacuação',
    mede: 'Exercícios práticos realizados pela população',
    unidade: 'semáforo (verde/vermelho)',
    formula: 'menção no PLANCON a SIMULADO/EXERCÍCIO de evacuação efetivamente REALIZADO (treinamento, não evento real)',
    criterio:
      'VERDE: SOMENTE se o PLANCON descreve um SIMULADO/EXERCÍCIO de evacuação (treinamento planejado) EFETIVAMENTE REALIZADO — ' +
      'com evidência concreta no passado (ex.: "foi realizado o simulado em <data>", ata/relatório, nº de participantes). ' +
      'VERMELHO: qualquer outro caso. NÃO conta como simulado realizado: (a) simulado apenas PREVISTO/OBRIGATÓRIO no futuro ' +
      '("deverá/deverão realizar", "uma vez ao ano", "prevê a Lei"); (b) RESPOSTA A EVENTO REAL — resgates/evacuações durante uma ' +
      'enchente/desastre de verdade (ex.: "resgatados na enchente de 2024") NÃO são simulado/treinamento; (c) a DATA de publicação/' +
      'assinatura do plano ou datas soltas.',
    pergunta:
      'O PLANCON descreve um SIMULADO/EXERCÍCIO de evacuação (treinamento) efetivamente REALIZADO no passado (com data, ata, ' +
      'relatório ou nº de participantes)? ATENÇÃO, NÃO conte como simulado realizado: (a) simulado só previsto/obrigatório ' +
      '("deverão realizar", "prevê a Lei"); (b) RESPOSTA A EVENTO REAL (resgates/evacuação numa enchente ou desastre de verdade — ' +
      'não é treinamento); (c) a data do próprio plano; (d) TAREFAS no infinitivo, como "Realizar simulados" ou "Promover ações de ' +
      'treinamento com simulação" — são atribuições/intenções, não relato de algo que aconteceu. Na EVIDÊNCIA, explique claramente a ' +
      'classificação: para VERDE cite o simulado realizado; para VERMELHO diga o motivo (ex.: "só previsto", "tarefa no infinitivo", ' +
      '"é resposta a evento real, não simulado", "não menciona simulados").',
    campos: [
      { nome: 'valor', tipo: 'enum', descricao: 'VERDE só se há SIMULADO/treinamento REALIZADO; senão VERMELHO', opcoes: ['verde', 'vermelho'] },
      { nome: 'simulado_realizado', tipo: 'enum', descricao: 'o plano RELATA um simulado/exercício JÁ REALIZADO (verbo no passado: "foi realizado", "realizou-se", "participaram")? Tarefa no infinitivo ("realizar", "promover") ou futuro = nao', opcoes: ['sim', 'nao', 'N/A'] },
      { nome: 'data_simulado', tipo: 'texto', descricao: 'data (ou ao menos o ano) do simulado JÁ REALIZADO, como aparece no plano (ou "N/A")' },
      { nome: 'local_simulado', tipo: 'texto', descricao: 'onde o simulado realizado aconteceu (bairro/comunidade/município) (ou "N/A")' },
      { nome: 'apenas_previsto', tipo: 'enum', descricao: 'o plano APENAS prevê/obriga simulados no futuro? ("deverá realizar" = sim)', opcoes: ['sim', 'nao', 'N/A'] },
      { nome: 'evento_real_nao_simulado', tipo: 'enum', descricao: 'a menção é a RESPOSTA A EVENTO REAL (enchente/desastre de verdade), não a um simulado/treinamento?', opcoes: ['sim', 'nao', 'N/A'] },
    ],
    ancoras: /simulad[oa]s?\b|exerc[íi]cios? simulad/i,
    // Semáforo determinístico a partir dos componentes (decisão de 23/10/2026): verde só com simulado
    // relatado como realizado E com data (ano) no passado. Previsto/obrigatório ou evento real → vermelho.
    // Corrige os verdes por "Realizar simulados"/"Promover treinamentos" (tarefas, não fatos).
    calcular: (c) => {
      const previsto = String(c.apenas_previsto).toLowerCase() === 'sim';
      const eventoReal = String(c.evento_real_nao_simulado).toLowerCase() === 'sim';
      const realizado = String(c.simulado_realizado).toLowerCase() === 'sim';
      const ano = Number(String(c.data_simulado ?? '').match(/\b(19|20)\d{2}\b/)?.[0]);
      // âncora na evidência: obrigação/intenção sem nenhum verbo no passado não é simulado realizado
      const ev = String(c.evidencia ?? '');
      // ("devem ser realizados" é obrigação, não passado; o ano de uma lei citada não é data de simulado)
      const soIntencao = /deverá|deverão|devem\b|\brealizar\b|promover|será|serão|vez(es)? ao ano|prev[êe] a lei/i.test(ev) &&
        !/\bfoi\b|\bforam\b|(?<!ser |serem )realizad[oa]s?\b|realizou|executad|ocorreu|participaram/i.test(ev);
      if (previsto || eventoReal || !realizado || soIntencao) return 'vermelho';
      // o ano informado tem de estar no trecho citado (evita data "emprestada" de outra parte do plano)
      if (!ano || ano > new Date().getFullYear() || !ev.includes(String(ano))) return 'vermelho';
      return 'verde';
    },
  },
  {
    id: 'P4',
    grupo: 'G2 · Material, Infraestrutura e Economia',
    nome: 'Rotas de evacuação',
    mede: 'Existência de rotas formalmente definidas',
    unidade: 'semáforo (verde/vermelho)',
    formula: 'menção no PLANCON a rotas de evacuação ESPECÍFICAS (trajetos/mapa/sinalização), não genéricas',
    criterio:
      'VERDE: SOMENTE se o PLANCON descreve um TRAJETO de evacuação ESPECÍFICO e JÁ DEFINIDO — com ruas/vias nomeadas ligando ' +
      'origem a um ponto de encontro/local seguro (ex.: "pela Rua X e Rua Y até o ponto de encontro na Escola Z"), ou um mapa de rotas. ' +
      'VERMELHO: qualquer outro caso. NÃO é rota definida: (a) ruas/áreas "A SEREM DEFINIDAS de acordo com o evento", ' +
      '"principais ruas", "pelas vias principais" (genérico/futuro); (b) apenas o título "Rotas de Fuga" sem trajeto; ' +
      '(c) LISTA DE ABRIGOS com endereços (endereço de abrigo NÃO é rota de evacuação); (d) texto de SISTEMA DE ALERTA.',
    pergunta:
      'O PLANCON descreve um TRAJETO de evacuação ESPECÍFICO e JÁ DEFINIDO — ruas/vias NOMEADAS ligando a área de risco a um ponto ' +
      'de encontro/local seguro (ex.: "pela Rua X até o ponto de encontro na Escola Y")? ATENÇÃO, NÃO conte como rota: ' +
      '(a) "ruas a serem definidas de acordo com o evento" ou "principais ruas" (genérico/futuro); (b) só o título "Rotas de Fuga"; ' +
      '(c) endereços de ABRIGOS (abrigo não é rota); (d) sistema de alerta; (e) rotas de incêndio predial/PPCI; ' +
      '(f) lista de RUAS ATINGIDAS / em área de risco / por cota de inundação (isso é onde está o risco, não o caminho de saída); ' +
      '(g) ponto de encontro das EQUIPES de resposta (não da população). ' +
      'CONTAM como rota definida (rota_definida = "sim"): "Sugestão de rota pelas ruas X e Y em direção ao Parque Z", ' +
      '"Opção 01 — segue pela Rua X em direção à Rua Y", "ROTA 01: siga pela Rua X…", tabelas de rotas com origem/destino, ' +
      '"a evacuação deverá ocorrer pela Estrada X" — o destino pode ser um local seguro, uma via ou uma direção (ex.: "partes altas").',
    campos: [
      { nome: 'valor', tipo: 'enum', descricao: 'VERDE só se há rota ESPECÍFICA descrita (ruas/trajeto/mapa/ponto de encontro); senão VERMELHO', opcoes: ['verde', 'vermelho'] },
      { nome: 'rota_definida', tipo: 'enum', descricao: 'o plano descreve um TRAJETO de evacuação concreto e já definido para a população?', opcoes: ['sim', 'nao', 'N/A'] },
      { nome: 'rota_futura_ou_generica', tipo: 'enum', descricao: 'a menção a rotas é futura/genérica ("a definir conforme o evento", "principais ruas", "não se fez necessária")?', opcoes: ['sim', 'nao', 'N/A'] },
      { nome: 'vias_da_rota', tipo: 'texto', descricao: 'ruas/vias nomeadas que FORMAM o trajeto de saída (não ruas atingidas, não endereço de abrigo) (ou "N/A")' },
      { nome: 'destino_da_rota', tipo: 'texto', descricao: 'ponto de encontro, local seguro ou direção para onde o trajeto leva a POPULAÇÃO (ou "N/A")' },
      { nome: 'rotas_descritas', tipo: 'texto', descricao: 'trecho/descrição da(s) rota(s) específica(s), se houver (ou "N/A")' },
    ],
    ancoras: /rotas? de (fuga|evacua[çc][ãa]o|sa[íi]da)|\bROTA\s*0?\d|op[çc][ãa]o\s*0?\d|evacua[çc][ãa]o\s+(deve|dever[áa])/i,
    // Semáforo determinístico a partir dos componentes (decisão de 23/10/2026): verde só com trajeto
    // definido (não futuro/genérico) e com via nomeada. O destino é registrado, mas não exigido:
    // muitas rotas reais terminam numa direção ("em direção à BR-290", "partes altas").
    // A evidência serve de âncora nos dois sentidos: (1) o "sim" do modelo só vale se o trecho citado
    // fala de trajeto (rota, fuga, evacuação, "para a Rua X"…), não de ruas atingidas; (2) o modelo às
    // vezes cita a rota e responde "nao" — um trecho com "rota" + via nomeada, sem tom futuro, é verde.
    calcular: (c) => {
      const preenchido = (v: any) => !!String(v ?? '').trim() && !/^n\/?a$/i.test(String(v).trim());
      const ev = String(c.evidencia ?? '');
      const generica =
        String(c.rota_futura_ou_generica).toLowerCase() === 'sim' ||
        /ser[áa] (planejad|definid|estabelecid)|ser[ãa]o (planejad|definid|estabelecid)|a definir|a serem definid|definir e revisar|n[ãa]o se fez necess/i.test(ev);
      if (generica) return 'vermelho';
      const via = /\b(rua|r\.|av\.|avenida|estrada|rodovia|travessa|tv\.|rst?[- ]?\d{2,3}|br[- ]?\d{2,3})\s*\S/i.test(ev);
      const falaDeTrajeto = /rota|fuga|evacua|trajeto|percurso|dire[çc][ãa]o|op[çc][ãa]o\s*0?\d|\bsiga\b|\bpara\s+(a\s+)?(rua|av|estrada)/i.test(ev);
      const modeloSim = String(c.rota_definida).toLowerCase() === 'sim' && preenchido(c.vias_da_rota);
      if (modeloSim && falaDeTrajeto) return 'verde';
      if (/\brotas?\b/i.test(ev) && via) return 'verde';
      return 'vermelho';
    },
  },
  {
    id: 'P5',
    grupo: 'G3 · Ambiente e Resiliência Hídrica',
    nome: 'Cobertura de sistemas de alerta',
    mede: 'Alcance dos alertas à população exposta',
    unidade: 'semáforo (verde/amarelo/vermelho)',
    formula: 'quantidade de canais de EMISSÃO DE ALERTA À POPULAÇÃO descritos no PLANCON',
    criterio:
      'Conte APENAS canais usados para EMITIR ALERTA À POPULAÇÃO exposta — ex.: sirenes, SMS/mensagem em massa, ' +
      'alto-falantes/carro de som, aplicativo de celular, rádio (difusão), redes sociais (postagem de alerta), WhatsApp de difusão. ' +
      'NÃO conte: listas de contatos/telefones/e-mails de coordenadores, autoridades ou responsáveis por abrigos; ' +
      'acionamento de Bombeiros/Brigada; telefones institucionais. Isso são contatos internos, não emissão de alerta. ' +
      'VERDE: mais de 3 canais de emissão. AMARELO: 1 a 3 canais. VERMELHO: nenhum canal de emissão de alerta.',
    pergunta:
      'Quais e QUANTOS canais de EMISSÃO DE ALERTA À POPULAÇÃO o PLANCON descreve (sirenes, SMS/mensagem em massa, carro de som/' +
      'alto-falante, aplicativo, rádio, redes sociais de difusão)? ATENÇÃO: NÃO conte listas de contatos/telefones/e-mails de ' +
      'coordenadores, autoridades ou abrigos, nem "acionar Bombeiros/Brigada" — isso é contato interno, não emissão de alerta à população.',
    campos: [
      { nome: 'valor', tipo: 'enum', descricao: 'VERDE >3 canais de emissão, AMARELO 1-3, VERMELHO nenhum', opcoes: SEMAFORO },
      { nome: 'n_canais_alerta', tipo: 'numero', descricao: 'nº de canais de EMISSÃO DE ALERTA à população (exclui contatos internos; 0 se nenhum)' },
      { nome: 'meios_alerta', tipo: 'texto', descricao: 'lista dos canais de emissão à população (ou "N/A")' },
    ],
    // Semáforo determinístico a partir da LISTA de canais (decisão de 23/10/2026): antes de contar,
    // descarta o que o critério exclui e os modelos insistem em contar — telefones, e-mails,
    // números de contato, ofícios, "assessoria", títulos de seção ("Emitir alertas", "Alarme").
    // Sem lista utilizável, cai na contagem n_canais_alerta do modelo.
    calcular: (c) => {
      const meios = listaDeMeios(c.meios_alerta);
      const n = meios.length ? meios.filter((m) => !NAO_CANAL.test(m)).length : paraNumero(c.n_canais_alerta);
      if (n === null) return null;
      if (n > 3) return 'verde';
      if (n >= 1) return 'amarelo';
      return 'vermelho';
    },
  },
  {
    id: 'P6',
    grupo: 'G4 · Governança e Capacidade Institucional',
    nome: 'Plano de contingência atualizado',
    mede: 'Existência de planejamento formal atualizado',
    unidade: 'semáforo (verde/amarelo/vermelho)',
    formula: 'data de publicação/revisão constante no PLANCON (referência: ano corrente)',
    criterio:
      'VERDE: data de publicação/revisão < 2 anos (atualizado). ' +
      'AMARELO: data de publicação/revisão entre 2 e 5 anos. ' +
      'VERMELHO: data > 5 anos, ou não mencionada.',
    pergunta:
      'Qual é a DATA (ano) de PUBLICAÇÃO ou última REVISÃO/atualização do Plano de Contingência informada no próprio documento? ' +
      'Se não houver data, informe "N/A".',
    campos: [
      { nome: 'valor', tipo: 'enum', descricao: 'semáforo (será recalculado a partir do ano, se disponível)', opcoes: SEMAFORO },
      { nome: 'ano_plano', tipo: 'numero', descricao: 'ano de publicação/revisão do plano (ou "N/A")' },
      { nome: 'data_plano', tipo: 'texto', descricao: 'data textual da publicação/revisão (ou "N/A")' },
    ],
    // Classificação determinística a partir do ano; se ausente, usa o semáforo do modelo.
    calcular: (c) => {
      const ano = paraNumero(c.ano_plano);
      if (ano === null) return 'vermelho'; // data não mencionada → VERMELHO
      const atual = new Date().getFullYear();
      const d = atual - ano;
      if (d < 2) return 'verde';
      if (d <= 5) return 'amarelo';
      return 'vermelho';
    },
  },
  {
    id: 'P7',
    grupo: 'G4 · Governança e Capacidade Institucional',
    nome: 'NUPDECs ativos',
    mede: 'Mobilização comunitária organizada',
    unidade: 'semáforo (verde/amarelo/vermelho)',
    formula: 'menção no PLANCON a NUPDEC/NUDEC FORMALIZADO e existente (não a voluntários genéricos)',
    criterio:
      'VERDE: SOMENTE se o PLANCON LISTA/cita NUPDEC(s)/NUDEC(s) (Núcleo Comunitário de Proteção e Defesa Civil) já EXISTENTES e ' +
      'FORMALIZADOS. ' +
      'AMARELO: menciona voluntários / grupos comunitários (escoteiros, jipeiros, voluntários cadastrados/treinados, abrigos ' +
      'voluntários) SEM NUPDEC formalizado. ' +
      'VERMELHO: não menciona voluntários nem NUPDECs. ' +
      'CRÍTICO: NUPDEC que "SERÁ organizado / será criado / a ser constituído" (FUTURO/planejado) NÃO existe → NÃO é verde. ' +
      'Só é verde se o plano LISTA NUPDECs já existentes. Intenção de mobilizar voluntários também não é verde.',
    pergunta:
      'O PLANCON LISTA NUPDEC(s)/NUDEC(s) (Núcleos Comunitários de Proteção e Defesa Civil) já EXISTENTES e formalizados? ' +
      'ATENÇÃO: se o texto diz que os núcleos "SERÃO organizados/criados" (futuro/planejado), eles NÃO existem — conte 0. ' +
      'Se só menciona voluntários/grupos sem NUPDEC formalizado, também conte 0. Informe o número de NUPDECs já EXISTENTES listados.',
    campos: [
      { nome: 'valor', tipo: 'enum', descricao: 'VERDE só se LISTA NUPDEC existente; voluntários → AMARELO; nada/futuro → VERMELHO', opcoes: SEMAFORO },
      { nome: 'n_nupdecs', tipo: 'numero', descricao: 'nº de NUPDECs já EXISTENTES e formalizados listados (0 se só planejados/futuros, só voluntários, ou nenhum)' },
      { nome: 'nupdec_futuro', tipo: 'enum', descricao: 'o plano fala que NUPDECs SERÃO organizados/criados (futuro), sem listar existentes?', opcoes: ['sim', 'nao', 'N/A'] },
      { nome: 'grupos_comunitarios', tipo: 'texto', descricao: 'menção a voluntários/grupos comunitários não formalizados (ou "N/A")' },
    ],
    // Guard: verde só com NUPDEC existente (n>=1) e não-futuro. Futuro/planejado nunca é verde.
    // ATENÇÃO (auditoria de 10/08/2026): este guard confia em n_nupdecs sem exigir âncora textual,
    // e 16 dos 29 "verdes" publicados não têm a palavra NUPDEC/núcleo no PLANCON — o modelo conta a
    // COMDEC/Coordenadoria como núcleo. Correção pendente de decisão; ver ./ANALISE-P7-NUPDEC.md.
    calcular: (c) => {
      const n = paraNumero(c.n_nupdecs);
      const futuro = String(c.nupdec_futuro).toLowerCase() === 'sim';
      if (n !== null && n >= 1 && !futuro) return 'verde';     // NUPDEC existente listado → verde
      const v = String(c.valor).toLowerCase();
      if (v === 'verde') return String(c.grupos_comunitarios || '').trim().replace(/n\/a/i, '') ? 'amarelo' : 'vermelho';
      return null;                                             // amarelo/vermelho do modelo
    },
  },
  // P8 (Investimento em Defesa Civil) REMOVIDO na revisão de 23/07/26: não é extraível do
  // PLANCON em V1 (sem dados). Fica para V2 com fonte SICONFI. São 7 indicadores (P1–P7).
];
