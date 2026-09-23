// Mapa canônico: nome oficial do município -> blob_url(s) EXATOS (como armazenados no campo filtrável blob_url).
// 264 municípios, um container por CREPDEC:
//   crepdec01  70 · Região Metropolitana
//   crepdec02  70 · Planalto / Alto Uruguai / Nordeste
//   crepdec03  49 · Santa Maria / Centro / Alto Jacuí
//   crepdec04  22 · Zona Sul / Litoral Sul
//   crepdec08  53 · Vale do Taquari / Vale do Rio Pardo

export const MUNICIPIOS: Record<string, string[]> = {
  "Alto Feliz": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20ALTO%20FELIZ.pdf"],
  "Alvorada": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON_ALVORADA_2024.pdf"],
  "Arambaré": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20ARAMBARE%CC%81.pdf"],
  "Araricá": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20ARARICA%CC%81.pdf"],
  "Arroio dos Ratos": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20ARROIO%20DOS%20RATOS.pdf"],
  "Barra do Ribeiro": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON_BARRADORIBEIRO_2024.pdf"],
  "Barão": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20BARA%CC%83O.pdf"],
  "Barão do Triunfo": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20BARA%CC%83O%20DO%20TRIUNFO.pdf"],
  "Bom Princípio": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20BOM%20PRINCI%CC%81PIO.docx"],
  "Brochier": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20BROCHIER.pdf", "https://plancon.blob.core.windows.net/crepdec01/PLANCON_BROCHIER_2024.pdf"],
  "Butiá": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON-DE%20BUTIA%CC%81.pdf"],
  "Cachoeirinha": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20CACHOEIRINHA.pdf"],
  "Camaquã": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20CAMAQUA%CC%83.pdf"],
  "Campo Bom": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20CAMPO%20BOM.pdf"],
  "Canoas": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20CANOAS.pdf"],
  "Capela de Santana": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON_CAPELADESANTANA_2024.pdf"],
  "Cerro Grande do Sul": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20CERRO%20GRANDE%20DO%20SUL.pdf"],
  "Charqueadas": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20CHARQUEADAS.pdf"],
  "Chuvisca": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20CHUVISCA.doc"],
  "Cristal": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20CRISTAL.pdf"],
  "Dois Irmãos": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20DOIS%20IRMA%CC%83OS.pdf"],
  "Dom Feliciano": ["https://plancon.blob.core.windows.net/crepdec01/Plano%20de%20Continge%CC%82ncia%20Dom%20Feliciano.pdf"],
  "Eldorado do Sul": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20ELDORADO%20DO%20SUL%202025.pdf", "https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20ELDORADO%20DO%20SUL%202025%20P2.pdf"],
  "Esteio": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20ESTEIO.docx"],
  "Estância Velha": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20ESTANCIA%20VELHA.docx"],
  "Feliz": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON_FELIZ_2024.pdf"],
  "Glorinha": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20GLORINHA.pdf"],
  "Gravataí": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20GRAVATAI%CC%81.docx"],
  "Guaíba": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON_GUAI%CC%81BA_11_2023.pdf"],
  "Harmonia": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20HARMONIA.pdf"],
  "Igrejinha": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20IGREJINHA.pdf"],
  "Ivoti": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20IVOTI.pdf"],
  "Lindolfo Collor": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON_LINDOLFOCOLOR_2023.pdf"],
  "Linha Nova": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20LINHA%20NOVA.docx"],
  "Maratá": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20MARATA%CC%81.pdf"],
  "Mariana Pimentel": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20MARIANA%20PIMENTEL.pdf"],
  "Minas do Leão": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20MINAS%20DO%20LEA%CC%83O.doc"],
  "Montenegro": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20MONTENEGRO.pdf"],
  "Morro Reuter": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20Morro%20Reiter.pdf"],
  "Nova Hartz": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20NOVA%20HARTZ%20-%202025.doc"],
  "Nova Santa Rita": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON_NOVASANTARITA_2024.pdf"],
  "Novo Hamburgo": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20NOVO%20HAMBURGO.pdf", "https://plancon.blob.core.windows.net/crepdec01/PLANCON_NOVOHAMBURGO_2023.pdf"],
  "Pareci Novo": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON_PARECINOVO_REVISA%CC%83O2025.pdf"],
  "Parobé": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20PAROBE%CC%81.pdf"],
  "Porto Alegre": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20PORTO%20ALEGRE.pdf"],
  "Portão": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20PORTA%CC%83O.pdf", "https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20PORTA%CC%83O%20COMPLETO.pdf"],
  "Presidente Lucena": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20PRESIDENTE%20LUCENA.pdf"],
  "Riozinho": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20RIOZINHO.pdf"],
  "Rolante": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20Rolante%20-%20parte%20I.pdf", "https://plancon.blob.core.windows.net/crepdec01/PLANCON%20Rolante%20-%20parte%20II.pdf"],
  "Salvador do Sul": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON_SALVADORDOSUL_2023.pdf"],
  "Santa Maria do Herval": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON_SANTAMARIADOHERVAL_2023.pdf"],
  "Santo Antônio da Patrulha": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20Santo%20Anto%CC%82nio%20da%20Patrulha.pdf"],
  "Sapiranga": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON_SAPIRANGA_2024.pdf"],
  "Sapucaia do Sul": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20SAPUCAIA%20DO%20SUL%202025.pdf"],
  "Sentinela do Sul": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20SENTINELA%20DO%20SUL.pdf"],
  "Sertão Santana": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20SERTA%CC%83O%20SANTANA.pdf"],
  "São Jerônimo": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20SA%CC%83O%20JERO%CC%82NIMO.pdf"],
  "São José do Hortêncio": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20HIDRO%20-%20SA%CC%83O%20JOSE%CC%81%20DO%20HORTE%CC%82NCIO.pdf", "https://plancon.blob.core.windows.net/crepdec01/PLANCON%20METEOR%20-%20SA%CC%83O%20JOSE%CC%81%20DO%20HORTE%CC%82NCIO.pdf"],
  "São José do Sul": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON_SA%CC%83OJOSE%CC%81DOSUL_2024.pdf"],
  "São Leopoldo": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20SA%CC%83O%20LEOPOLDO.pdf"],
  "São Pedro da Serra": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20SA%CC%83O%20PEDRO%20DA%20SERRA-%202025.pdf"],
  "São Sebastião do Caí": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20SA%CC%83O%20SEBASTIA%CC%83O%20DO%20CAI.pdf"],
  "São Vendelino": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20SA%CC%83O%20VENDELINO.pdf", "https://plancon.blob.core.windows.net/crepdec01/PLANCON%20Sa%CC%83o%20Vendelino.pdf"],
  "Tapes": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20TAPES.PDF"],
  "Taquara": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20TAQUARA%20%202024.pdf"],
  "Triunfo": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20TRIUNFO.pdf"],
  "Três Coroas": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20-%20TE%CC%82S%20COROAS.docx"],
  "Tupandi": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON_TUPANDI_2024.pdf"],
  "Vale Real": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20VALE%20REAL.pdf"],
  "Viamão": ["https://plancon.blob.core.windows.net/crepdec01/PLANCON%20VIAMA%CC%82O.pdf"],
  // --- CREPDEC 08 (Vale do Taquari / Vale do Rio Pardo) — 53 municípios, container crepdec08 ---
  "Anta Gorda": ["https://plancon.blob.core.windows.net/crepdec08/anta-gorda.pdf"],
  "Arroio do Meio": ["https://plancon.blob.core.windows.net/crepdec08/arroio-do-meio.pdf"],
  "Arvorezinha": ["https://plancon.blob.core.windows.net/crepdec08/arvorezinha.pdf"],
  "Bom Retiro do Sul": ["https://plancon.blob.core.windows.net/crepdec08/bom-retiro-do-sul.pdf"],
  "Candelária": ["https://plancon.blob.core.windows.net/crepdec08/candelaria.pdf"],
  "Canudos do Vale": ["https://plancon.blob.core.windows.net/crepdec08/canudos-do-vale.pdf"],
  "Capitão": ["https://plancon.blob.core.windows.net/crepdec08/capitao.pdf"],
  "Colinas": ["https://plancon.blob.core.windows.net/crepdec08/colinas.pdf"],
  "Coqueiro Baixo": ["https://plancon.blob.core.windows.net/crepdec08/coqueiro-baixo.pdf"],
  "Cruzeiro do Sul": ["https://plancon.blob.core.windows.net/crepdec08/cruzeiro-do-sul.pdf"],
  "Dois Lajeados": ["https://plancon.blob.core.windows.net/crepdec08/dois-lajeados.pdf"],
  "Doutor Ricardo": ["https://plancon.blob.core.windows.net/crepdec08/doutor-ricardo.pdf"],
  "Encantado": ["https://plancon.blob.core.windows.net/crepdec08/encantado.pdf"],
  "Encruzilhada do Sul": ["https://plancon.blob.core.windows.net/crepdec08/encruzilhada-do-sul.pdf"],
  "Estrela": ["https://plancon.blob.core.windows.net/crepdec08/estrela.pdf"],
  "Estrela Velha": ["https://plancon.blob.core.windows.net/crepdec08/estrela-velha.pdf"],
  "Fazenda Vilanova": ["https://plancon.blob.core.windows.net/crepdec08/fazenda-vilanova.pdf"],
  "Forquetinha": ["https://plancon.blob.core.windows.net/crepdec08/forquetinha.pdf"],
  "Herveiras": ["https://plancon.blob.core.windows.net/crepdec08/herveiras.pdf"],
  "Ibarama": ["https://plancon.blob.core.windows.net/crepdec08/ibarama.pdf"],
  "Ilópolis": ["https://plancon.blob.core.windows.net/crepdec08/ilopolis.pdf"],
  "Imigrante": ["https://plancon.blob.core.windows.net/crepdec08/imigrante.pdf"],
  "Lagoa Bonita do Sul": ["https://plancon.blob.core.windows.net/crepdec08/lagoa-bonita-do-sul.pdf"],
  "Lajeado": ["https://plancon.blob.core.windows.net/crepdec08/lajeado.pdf"],
  "Marques de Souza": ["https://plancon.blob.core.windows.net/crepdec08/marques-de-souza.pdf"],
  "Mato Leitão": ["https://plancon.blob.core.windows.net/crepdec08/mato-leitao.pdf"],
  "Nova Bréscia": ["https://plancon.blob.core.windows.net/crepdec08/nova-brescia.pdf"],
  "Pantano Grande": ["https://plancon.blob.core.windows.net/crepdec08/pantano-grande.pdf"],
  "Passa Sete": ["https://plancon.blob.core.windows.net/crepdec08/passa-sete.pdf"],
  "Passo do Sobrado": ["https://plancon.blob.core.windows.net/crepdec08/passo-do-sobrado.pdf"],
  "Paverama": ["https://plancon.blob.core.windows.net/crepdec08/paverama.pdf"],
  "Pouso Novo": ["https://plancon.blob.core.windows.net/crepdec08/pouso-novo.pdf"],
  "Poço das Antas": ["https://plancon.blob.core.windows.net/crepdec08/poco-das-antas.pdf"],
  "Progresso": ["https://plancon.blob.core.windows.net/crepdec08/progresso.pdf"],
  "Putinga": ["https://plancon.blob.core.windows.net/crepdec08/putinga.pdf"],
  "Relvado": ["https://plancon.blob.core.windows.net/crepdec08/relvado.pdf"],
  "Rio Pardo": ["https://plancon.blob.core.windows.net/crepdec08/rio-pardo.pdf"],
  "Roca Sales": ["https://plancon.blob.core.windows.net/crepdec08/roca-sales.pdf"],
  "Santa Clara do Sul": ["https://plancon.blob.core.windows.net/crepdec08/santa-clara-do-sul.pdf"],
  "Santa Cruz do Sul": ["https://plancon.blob.core.windows.net/crepdec08/santa-cruz-do-sul.pdf"],
  "Segredo": ["https://plancon.blob.core.windows.net/crepdec08/segredo.pdf"],
  "Sério": ["https://plancon.blob.core.windows.net/crepdec08/serio.pdf"],
  "Sobradinho": ["https://plancon.blob.core.windows.net/crepdec08/sobradinho.pdf"],
  "Tabaí": ["https://plancon.blob.core.windows.net/crepdec08/tabai.pdf"],
  "Taquari": ["https://plancon.blob.core.windows.net/crepdec08/taquari.pdf"],
  "Teutônia": ["https://plancon.blob.core.windows.net/crepdec08/teutonia.pdf"],
  "Travesseiro": ["https://plancon.blob.core.windows.net/crepdec08/travesseiro.pdf"],
  "Tunas": ["https://plancon.blob.core.windows.net/crepdec08/tunas.pdf"],
  "Vale Verde": ["https://plancon.blob.core.windows.net/crepdec08/vale-verde.pdf"],
  "Venâncio Aires": ["https://plancon.blob.core.windows.net/crepdec08/venancio-aires.pdf"],
  "Vera Cruz": ["https://plancon.blob.core.windows.net/crepdec08/vera-cruz.pdf"],
  "Vespasiano Corrêa": ["https://plancon.blob.core.windows.net/crepdec08/vespasiano-correa.pdf"],
  "Westfália": ["https://plancon.blob.core.windows.net/crepdec08/westfalia.pdf"],
  // --- CREPDEC 02 (Planalto / Alto Uruguai / Nordeste) — 70 municípios, container crepdec02 ---
  "Água Santa": ["https://plancon.blob.core.windows.net/crepdec02/agua-santa.pdf"],
  "Alto Alegre": ["https://plancon.blob.core.windows.net/crepdec02/alto-alegre.pdf"],
  "Áurea": ["https://plancon.blob.core.windows.net/crepdec02/aurea.pdf"],
  "Barão de Cotegipe": ["https://plancon.blob.core.windows.net/crepdec02/barao-de-cotegipe.pdf"],
  "Barracão": ["https://plancon.blob.core.windows.net/crepdec02/barracao.pdf"],
  "Barros Cassal": ["https://plancon.blob.core.windows.net/crepdec02/barros-cassal.pdf"],
  "Cacique Doble": ["https://plancon.blob.core.windows.net/crepdec02/cacique-doble.pdf"],
  "Camargo": ["https://plancon.blob.core.windows.net/crepdec02/camargo.pdf"],
  "Campos Borges": ["https://plancon.blob.core.windows.net/crepdec02/campos-borges.pdf"],
  "Capão Bonito do Sul": ["https://plancon.blob.core.windows.net/crepdec02/capao-bonito-do-sul.pdf"],
  "Carazinho": ["https://plancon.blob.core.windows.net/crepdec02/carazinho.pdf"],
  "Carlos Gomes": ["https://plancon.blob.core.windows.net/crepdec02/carlos-gomes.pdf"],
  "Casca": ["https://plancon.blob.core.windows.net/crepdec02/casca-seca-estiagem.pdf", "https://plancon.blob.core.windows.net/crepdec02/casca-vendaval-granizo.pdf"],
  "Caseiros": ["https://plancon.blob.core.windows.net/crepdec02/caseiros.docx"],
  "Centenário": ["https://plancon.blob.core.windows.net/crepdec02/centenario.pdf"],
  "Charrua": ["https://plancon.blob.core.windows.net/crepdec02/charrua.pdf"],
  "Ciríaco": ["https://plancon.blob.core.windows.net/crepdec02/ciriaco.pdf"],
  "Coxilha": ["https://plancon.blob.core.windows.net/crepdec02/coxilha.pdf"],
  "David Canabarro": ["https://plancon.blob.core.windows.net/crepdec02/david-canabarro.pdf"],
  "Erebango": ["https://plancon.blob.core.windows.net/crepdec02/erebango.pdf"],
  "Erechim": ["https://plancon.blob.core.windows.net/crepdec02/erechim.pdf"],
  "Ernestina": ["https://plancon.blob.core.windows.net/crepdec02/ernestina.pdf"],
  "Espumoso": ["https://plancon.blob.core.windows.net/crepdec02/espumoso.pdf"],
  "Estação": ["https://plancon.blob.core.windows.net/crepdec02/estacao.docx"],
  "Floriano Peixoto": ["https://plancon.blob.core.windows.net/crepdec02/floriano-peixoto.pdf"],
  "Fontoura Xavier": ["https://plancon.blob.core.windows.net/crepdec02/fontoura-xavier.pdf"],
  "Gaurama": ["https://plancon.blob.core.windows.net/crepdec02/gaurama.pdf"],
  "Gentil": ["https://plancon.blob.core.windows.net/crepdec02/gentil.pdf"],
  "Getúlio Vargas": ["https://plancon.blob.core.windows.net/crepdec02/getulio-vargas.pdf"],
  "Gramado Xavier": ["https://plancon.blob.core.windows.net/crepdec02/gramado-xavier.pdf"],
  "Ibiaçá": ["https://plancon.blob.core.windows.net/crepdec02/ibiaca.pdf"],
  "Ibiraiaras": ["https://plancon.blob.core.windows.net/crepdec02/ibiraiaras.pdf"],
  "Ibirapuitã": ["https://plancon.blob.core.windows.net/crepdec02/ibirapuita.pdf"],
  "Ipiranga do Sul": ["https://plancon.blob.core.windows.net/crepdec02/ipiranga-do-sul.pdf"],
  "Itapuca": ["https://plancon.blob.core.windows.net/crepdec02/itapuca.pdf"],
  "Jacuizinho": ["https://plancon.blob.core.windows.net/crepdec02/jacuizinho.pdf"],
  "Lagoa Vermelha": ["https://plancon.blob.core.windows.net/crepdec02/lagoa-vermelha.docx"],
  "Lagoão": ["https://plancon.blob.core.windows.net/crepdec02/lagoao.pdf"],
  "Machadinho": ["https://plancon.blob.core.windows.net/crepdec02/machadinho.pdf"],
  "Marau": ["https://plancon.blob.core.windows.net/crepdec02/marau.pdf"],
  "Marcelino Ramos": ["https://plancon.blob.core.windows.net/crepdec02/marcelino-ramos.pdf"],
  "Mato Castelhano": ["https://plancon.blob.core.windows.net/crepdec02/mato-castelhano.pdf"],
  "Maximiliano de Almeida": ["https://plancon.blob.core.windows.net/crepdec02/maximiliano-de-almeida.pdf"],
  "Mormaço": ["https://plancon.blob.core.windows.net/crepdec02/mormaco.pdf"],
  "Muliterno": ["https://plancon.blob.core.windows.net/crepdec02/muliterno.pdf"],
  "Nicolau Vergueiro": ["https://plancon.blob.core.windows.net/crepdec02/nicolau-vergueiro.pdf"],
  "Nova Alvorada": ["https://plancon.blob.core.windows.net/crepdec02/nova-alvorada.pdf"],
  "Paim Filho": ["https://plancon.blob.core.windows.net/crepdec02/paim-filho.pdf"],
  "Passo Fundo": ["https://plancon.blob.core.windows.net/crepdec02/passo-fundo.pdf"],
  "Sananduva": ["https://plancon.blob.core.windows.net/crepdec02/sananduva.pdf"],
  "Santa Cecília do Sul": ["https://plancon.blob.core.windows.net/crepdec02/santa-cecilia-do-sul.pdf"],
  "Santo Antônio do Palma": ["https://plancon.blob.core.windows.net/crepdec02/santo-antonio-do-palma.pdf"],
  "Santo Antônio do Planalto": ["https://plancon.blob.core.windows.net/crepdec02/santo-antonio-do-planalto.pdf"],
  "Santo Expedito do Sul": ["https://plancon.blob.core.windows.net/crepdec02/santo-expedito-do-sul.pdf"],
  "São Domingos do Sul": ["https://plancon.blob.core.windows.net/crepdec02/sao-domingos-do-sul.pdf"],
  "São João da Urtiga": ["https://plancon.blob.core.windows.net/crepdec02/sao-joao-da-urtiga.pdf"],
  "São José do Herval": ["https://plancon.blob.core.windows.net/crepdec02/sao-jose-do-herval.pdf"],
  "São José do Ouro": ["https://plancon.blob.core.windows.net/crepdec02/sao-jose-do-ouro.pdf"],
  "Sertão": ["https://plancon.blob.core.windows.net/crepdec02/sertao.pdf"],
  "Severiano de Almeida": ["https://plancon.blob.core.windows.net/crepdec02/severiano-de-almeida.docx"],
  "Soledade": ["https://plancon.blob.core.windows.net/crepdec02/soledade.pdf"],
  "Tapejara": ["https://plancon.blob.core.windows.net/crepdec02/tapejara.pdf"],
  "Tio Hugo": ["https://plancon.blob.core.windows.net/crepdec02/tio-hugo.pdf"],
  "Três Arroios": ["https://plancon.blob.core.windows.net/crepdec02/tres-arroios.pdf"],
  "Tupanci do Sul": ["https://plancon.blob.core.windows.net/crepdec02/tupanci-do-sul.pdf"],
  "Vanini": ["https://plancon.blob.core.windows.net/crepdec02/vanini.pdf"],
  "Viadutos": ["https://plancon.blob.core.windows.net/crepdec02/viadutos.pdf"],
  "Victor Graeff": ["https://plancon.blob.core.windows.net/crepdec02/victor-graeff.pdf"],
  "Vila Lângaro": ["https://plancon.blob.core.windows.net/crepdec02/vila-langaro.pdf"],
  "Vila Maria": ["https://plancon.blob.core.windows.net/crepdec02/vila-maria.pdf"],
  // --- CREPDEC 03 (Santa Maria / Centro / Alto Jacuí) — 49 municípios, container crepdec03 ---
  "Agudo": ["https://plancon.blob.core.windows.net/crepdec03/agudo.pdf"],
  "Boa Vista do Cadeado": ["https://plancon.blob.core.windows.net/crepdec03/boa-vista-do-cadeado.pdf"],
  "Boa Vista do Incra": ["https://plancon.blob.core.windows.net/crepdec03/boa-vista-do-incra.pdf"],
  "Cacequi": ["https://plancon.blob.core.windows.net/crepdec03/cacequi-enxurrada.pdf", "https://plancon.blob.core.windows.net/crepdec03/cacequi-estiagem.pdf"],
  "Cachoeira do Sul": ["https://plancon.blob.core.windows.net/crepdec03/cachoeira-do-sul.pdf"],
  "Capão do Cipó": ["https://plancon.blob.core.windows.net/crepdec03/capao-do-cipo.pdf"],
  "Cerro Branco": ["https://plancon.blob.core.windows.net/crepdec03/cerro-branco.pdf"],
  "Colorado": ["https://plancon.blob.core.windows.net/crepdec03/colorado.pdf"],
  "Cruz Alta": ["https://plancon.blob.core.windows.net/crepdec03/cruz-alta.pdf"],
  "Dilermando de Aguiar": ["https://plancon.blob.core.windows.net/crepdec03/dilermando-de-aguiar.pdf"],
  "Dona Francisca": ["https://plancon.blob.core.windows.net/crepdec03/dona-francisca.pdf"],
  "Faxinal do Soturno": ["https://plancon.blob.core.windows.net/crepdec03/faxinal-do-soturno.pdf"],
  "Formigueiro": ["https://plancon.blob.core.windows.net/crepdec03/formigueiro.pdf"],
  "Fortaleza dos Valos": ["https://plancon.blob.core.windows.net/crepdec03/fortaleza-dos-valos.pdf"],
  "Ibirubá": ["https://plancon.blob.core.windows.net/crepdec03/ibiruba.pdf"],
  "Itaara": ["https://plancon.blob.core.windows.net/crepdec03/itaara.pdf"],
  "Ivorá": ["https://plancon.blob.core.windows.net/crepdec03/ivora.pdf"],
  "Jaguari": ["https://plancon.blob.core.windows.net/crepdec03/jaguari.pdf"],
  "Jari": ["https://plancon.blob.core.windows.net/crepdec03/jari.pdf"],
  "Júlio de Castilhos": ["https://plancon.blob.core.windows.net/crepdec03/julio-de-castilhos.pdf"],
  "Lagoa dos Três Cantos": ["https://plancon.blob.core.windows.net/crepdec03/lagoa-dos-tres-cantos.pdf"],
  "Mata": ["https://plancon.blob.core.windows.net/crepdec03/mata.pdf"],
  "Não-Me-Toque": ["https://plancon.blob.core.windows.net/crepdec03/nao-me-toque.pdf"],
  "Nova Esperança do Sul": ["https://plancon.blob.core.windows.net/crepdec03/nova-esperanca-do-sul.pdf"],
  "Nova Palma": ["https://plancon.blob.core.windows.net/crepdec03/nova-palma.pdf"],
  "Novo Cabrais": ["https://plancon.blob.core.windows.net/crepdec03/novo-cabrais.doc"],
  "Paraíso do Sul": ["https://plancon.blob.core.windows.net/crepdec03/paraiso-do-sul.pdf"],
  "Pinhal Grande": ["https://plancon.blob.core.windows.net/crepdec03/pinhal-grande.pdf"],
  "Quevedos": ["https://plancon.blob.core.windows.net/crepdec03/quevedos.pdf"],
  "Quinze de Novembro": ["https://plancon.blob.core.windows.net/crepdec03/quinze-de-novembro.pdf"],
  "Restinga Sêca": ["https://plancon.blob.core.windows.net/crepdec03/restinga-seca.pdf"],
  "Saldanha Marinho": ["https://plancon.blob.core.windows.net/crepdec03/saldanha-marinho.pdf"],
  "Salto do Jacuí": ["https://plancon.blob.core.windows.net/crepdec03/salto-do-jacui.pdf"],
  "Santa Bárbara do Sul": ["https://plancon.blob.core.windows.net/crepdec03/santa-barbara-do-sul.pdf"],
  "Santa Maria": ["https://plancon.blob.core.windows.net/crepdec03/santa-maria.pdf"],
  "Santiago": ["https://plancon.blob.core.windows.net/crepdec03/santiago.pdf"],
  "São Francisco de Assis": ["https://plancon.blob.core.windows.net/crepdec03/sao-francisco-de-assis.pdf"],
  "São João do Polêsine": ["https://plancon.blob.core.windows.net/crepdec03/sao-joao-do-polesine.pdf"],
  "São Martinho da Serra": ["https://plancon.blob.core.windows.net/crepdec03/sao-martinho-da-serra.pdf"],
  "São Pedro do Sul": ["https://plancon.blob.core.windows.net/crepdec03/sao-pedro-do-sul.pdf"],
  "São Sepé": ["https://plancon.blob.core.windows.net/crepdec03/sao-sepe.pdf"],
  "São Vicente do Sul": ["https://plancon.blob.core.windows.net/crepdec03/sao-vicente-do-sul.pdf"],
  "Selbach": ["https://plancon.blob.core.windows.net/crepdec03/selbach.pdf"],
  "Silveira Martins": ["https://plancon.blob.core.windows.net/crepdec03/silveira-martins.pdf"],
  "Tapera": ["https://plancon.blob.core.windows.net/crepdec03/tapera.pdf"],
  "Toropi": ["https://plancon.blob.core.windows.net/crepdec03/toropi.pdf"],
  "Tupanciretã": ["https://plancon.blob.core.windows.net/crepdec03/tupancireta.pdf"],
  "Unistalda": ["https://plancon.blob.core.windows.net/crepdec03/unistalda.pdf"],
  "Vila Nova do Sul": ["https://plancon.blob.core.windows.net/crepdec03/vila-nova-do-sul.pdf"],
  // --- CREPDEC 04 (Zona Sul / Litoral Sul) — 22 municípios, container crepdec04 ---
  "Amaral Ferrador": ["https://plancon.blob.core.windows.net/crepdec04/amaral-ferrador.pdf"],
  "Arroio do Padre": ["https://plancon.blob.core.windows.net/crepdec04/arroio-do-padre.pdf"],
  "Arroio Grande": ["https://plancon.blob.core.windows.net/crepdec04/arroio-grande.pdf"],
  "Canguçu": ["https://plancon.blob.core.windows.net/crepdec04/cangucu.pdf"],
  "Capão do Leão": ["https://plancon.blob.core.windows.net/crepdec04/capao-do-leao.docx"],
  "Cerrito": ["https://plancon.blob.core.windows.net/crepdec04/cerrito.pdf"],
  "Chuí": ["https://plancon.blob.core.windows.net/crepdec04/chui.pdf"],
  "Herval": ["https://plancon.blob.core.windows.net/crepdec04/herval.pdf"],
  "Jaguarão": ["https://plancon.blob.core.windows.net/crepdec04/jaguarao.docx"],
  "Morro Redondo": ["https://plancon.blob.core.windows.net/crepdec04/morro-redondo.pdf"],
  "Pedras Altas": ["https://plancon.blob.core.windows.net/crepdec04/pedras-altas.pdf"],
  "Pedro Osório": ["https://plancon.blob.core.windows.net/crepdec04/pedro-osorio.pdf"],
  "Pelotas": ["https://plancon.blob.core.windows.net/crepdec04/pelotas.pdf"],
  "Pinheiro Machado": ["https://plancon.blob.core.windows.net/crepdec04/pinheiro-machado.pdf"],
  "Piratini": ["https://plancon.blob.core.windows.net/crepdec04/piratini.pdf"],
  "Rio Grande": ["https://plancon.blob.core.windows.net/crepdec04/rio-grande.pdf"],
  "Santa Vitória do Palmar": ["https://plancon.blob.core.windows.net/crepdec04/santa-vitoria-do-palmar.pdf"],
  "Santana da Boa Vista": ["https://plancon.blob.core.windows.net/crepdec04/santana-da-boa-vista.pdf"],
  "São José do Norte": ["https://plancon.blob.core.windows.net/crepdec04/sao-jose-do-norte.pdf"],
  "São Lourenço do Sul": ["https://plancon.blob.core.windows.net/crepdec04/sao-lourenco-do-sul.pdf"],
  "Tavares": ["https://plancon.blob.core.windows.net/crepdec04/tavares.pdf"],
  "Turuçu": ["https://plancon.blob.core.windows.net/crepdec04/turucu.pdf"],
};

// Grafias alternativas aceitas (arquivo tem typo ou variação): alias -> nome canônico
export const ALIASES: Record<string, string> = {
  "Morro Reiter": "Morro Reuter",
  "Tres Coroas": "Três Coroas",
};
// ---------------------------------------------------------------------------
// Detecção de município no texto do usuário (determinística, sem depender do LLM).
// ---------------------------------------------------------------------------

/** Remove acentos, baixa caixa e reduz pontuação a espaços. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')     // pontuação -> espaço
    .replace(/\s+/g, ' ')
    .trim();
}

// Índice normalizado: "porto alegre" -> "Porto Alegre" (inclui aliases).
const NORM_TO_CANON: Record<string, string> = (() => {
  const idx: Record<string, string> = {};
  for (const canon of Object.keys(MUNICIPIOS)) idx[normalize(canon)] = canon;
  for (const [alias, canon] of Object.entries(ALIASES)) idx[normalize(alias)] = canon;
  return idx;
})();

// Nomes candidatos ordenados do mais longo para o mais curto (casa "Alto Feliz" antes de "Feliz").
const CANDIDATES = Object.keys(NORM_TO_CANON).sort((a, b) => b.length - a.length);

export interface MunicipioMatch {
  canonical: string;
  urls: string[];
}

/**
 * Detecta os municípios citados no texto. Casa por palavra inteira e descarta
 * matches contidos em outro maior (ex.: "Feliz" dentro de "Alto Feliz").
 * Retorna lista vazia se nenhum município for reconhecido.
 */
export function detectMunicipios(text: string): MunicipioMatch[] {
  const hay = ` ${normalize(text)} `;
  const matchedNorms: string[] = [];
  for (const cand of CANDIDATES) {
    if (hay.includes(` ${cand} `)) {
      // ignora se já casou um nome maior que contém este
      if (matchedNorms.some((m) => m.includes(cand))) continue;
      matchedNorms.push(cand);
    }
  }
  // dedup por canônico (aliases podem apontar para o mesmo)
  const seen = new Set<string>();
  const out: MunicipioMatch[] = [];
  for (const n of matchedNorms) {
    const canon = NORM_TO_CANON[n];
    if (seen.has(canon)) continue;
    seen.add(canon);
    out.push({ canonical: canon, urls: MUNICIPIOS[canon] });
  }
  return out;
}

/**
 * Monta o filterAddOn OData para restringir a busca aos blob_url dos municípios dados.
 * Usa search.in com igualdade exata — imune aos nomes inconsistentes dos arquivos.
 */
export function buildFilterAddOn(matches: MunicipioMatch[]): string | null {
  const urls = matches.flatMap((m) => m.urls);
  if (urls.length === 0) return null;
  return `search.in(blob_url, '${urls.join('|')}', '|')`;
}
