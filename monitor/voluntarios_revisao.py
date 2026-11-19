"""P10: junta a varredura (saida de voluntarios.py: saida_p10_completa.json + saida_refazer.json, fora do repositório) com a revisão manual
e grava monitor/voluntarios.json. Sem revisão manual, um site lido fica 'nenhum'."""
import json, sys
from pathlib import Path

COLETA = '2026-11-19'
# revisão manual de 19/11/2026 (páginas e formulários conferidos um a um)
REVISAO = {
  'Butiá': ('municipal_ativo', 'https://butia.rs.gov.br/defesa-civil-de-butia/', 'Página da Defesa Civil com cadastro de voluntários aberto (formulário por QR-code).'),
  'Canela': ('municipal_ativo', 'https://canela.rs.gov.br/sitenovo/sgg/defesa-civil/', 'Formulário "Cadastro de Voluntários" na página da Defesa Civil.'),
  'Carlos Barbosa': ('municipal_ativo', 'https://www.carlosbarbosa.rs.gov.br/noticias/assistencia-social-realiza-cadastro-municipal-de-voluntarios-para-apoio-em-situacoes-emergenciais', 'Cadastro municipal de voluntários para apoio emergencial e abrigos (formulário online aberto, 12/11/2026).'),
  'Nova Bassano': ('municipal_ativo', 'https://www.novabassano.rs.gov.br/servico/view/5/defesa-civil', 'Página da Defesa Civil convida a se cadastrar como voluntário por formulário.'),
  'Não-Me-Toque': ('municipal_ativo', 'https://naometoque.rs.gov.br/servicos/servicos-secretarias/gabinete/defesa-civil-de-nao-me-toque/', 'Link "Cadastro de Voluntários – Defesa Civil" para formulário aberto.'),
  'Rolante': ('municipal_ativo', 'https://www.rolante.rs.gov.br/site/', 'Menu "Defesa Civil - Cadastro de Voluntários" com formulário aberto.'),
  'Santa Maria': ('municipal_ativo', 'https://www.santamaria.rs.gov.br/cadastro-voluntarios-defesa-civil', 'Formulário de cadastro de voluntários da Defesa Civil no site.'),
  'Santo Cristo': ('municipal_ativo', 'https://www.santocristo.rs.gov.br/site/noticias/bombeiros-voluntarios/86591-novos-voluntarios', 'Bombeiros Voluntários com inscrições "a qualquer tempo" divulgadas no site (contato por telefone ou na sede).'),
  'São José do Norte': ('municipal_ativo', 'https://www.saojosedonorte.rs.gov.br/noticias/defesa-civil-nortense-abre-cadastro-de-voluntarios-para-fortalecer-a-protecao-da-comunidade-em-situacoes', 'Defesa Civil abriu cadastro de voluntários (18/06/2026).'),
  'São José do Sul': ('municipal_ativo', 'https://www.saojosedosul.rs.gov.br/web/noticias/2206/seja-voluntario-da-defesa-civil', '"Seja voluntário da Defesa Civil": cadastro aberto pelo telefone indicado (13/10/2026).'),
  'Taquari': ('municipal_ativo', 'https://www.taquari.rs.gov.br/pagina/id/1095/?cartilha-de-orientacao-de-voluntarios.html', 'Termo de adesão ao corpo de voluntários da Defesa Civil (formulário aberto).'),
  'Canoas': ('encerrado', 'https://canoas.rs.gov.br/voluntariado/', 'Página "Quer ser voluntário?" aponta para formulário que não existe mais.'),
  'Novo Hamburgo': ('encerrado', 'https://www.novohamburgo.rs.gov.br/noticia/inscricoes-abertas-capacitacao-forca-voluntaria-defesa-civil', 'Formulário da Força Voluntária de Defesa Civil não aceita mais respostas.'),
  'Sapucaia do Sul': ('encerrado', 'https://www.sapucaiadosul.rs.gov.br/noticias/inscricoes-para-voluntarios-encerradas/', 'Inscrições de voluntários encerradas (2024).'),
  'Porto Alegre': ('encerrado', '', 'Só notícias de 2024 sobre cadastro de voluntários, encerrado; nenhum canal ativo encontrado.'),
  'Frederico Westphalen': ('encerrado', 'https://www.fredericowestphalen-rs.com.br/noticia/view/3291', 'Plataforma de voluntários de maio de 2024 (enchentes); nenhum canal ativo encontrado.'),
}
TEXTO = {'nenhum': 'Nenhum canal de cadastro de voluntários (emergência/Defesa Civil) encontrado no site.'}

res = {}
lidos = {r['municipio']: r for r in json.load(open('saida_p10_completa.json'))}
for r in json.load(open('saida_refazer.json')):
    if r.get('paginas'):
        lidos[r['municipio']] = r
for m, r in lidos.items():
    pag = r.get('paginas') or 0
    if not pag:
        res[m] = {'situacao_site': 'inacessivel', 'canal': 'N/A', 'url_canal': '', 'paginas_lidas': 0,
                  'conferencia': 'site não respondeu na coleta do P10',
                  'evidencia': 'Fora do indicador (site não pôde ser avaliado): site não respondeu na coleta do P10.',
                  'coletado_em': COLETA}
        continue
    canal, url, nota = REVISAO.get(m, ('nenhum', '', TEXTO['nenhum']))
    res[m] = {'situacao_site': 'ok', 'canal': canal, 'url_canal': url, 'paginas_lidas': pag,
              'conferencia': '', 'evidencia': nota + (f' ({pag} páginas lidas.)' if canal == 'nenhum' else ''),
              'coletado_em': COLETA}
falta = set(REVISAO) - set(res)
assert not falta, falta
saida = Path(sys.argv[1])
saida.write_text(json.dumps(dict(sorted(res.items())), ensure_ascii=False, indent=1) + '\n')
from collections import Counter
print(Counter(v['canal'] for v in res.values()))
