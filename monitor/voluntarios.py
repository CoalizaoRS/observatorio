"""P10: procura canais de cadastro de voluntários no site da prefeitura.

Uso: python voluntarios.py alvos.csv saida.json  (alvos = sites lidos pelo P9; ver voluntarios_revisao.py)
Respeita robots.txt, 1 requisição/s por site, até MAX_PAGINAS páginas por site.
"""
import csv, json, re, sys, time, unicodedata
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse, quote
from urllib import robotparser

import requests, urllib3
from bs4 import BeautifulSoup

urllib3.disable_warnings()
UA = 'Mozilla/5.0 (compatible; ObservatorioResilienciaRS-P10/1.0; +https://github.com/CoalizaoRS/observatorio)'
H = {'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9'}
MAX_PAGINAS = 40
VOL = re.compile(r'volunt[aá]ri|voluntariado|(?:quer|quero|deseja)\\s+(?:ser\\s+)?volunt', re.I)
PRIORIDADE = [
    (VOL, 10),
    (re.compile(r'defesa[\s_-]*civil', re.I), 5),
    (re.compile(r'assist[eê]ncia[\s_-]*social|desenvolvimento[\s_-]*social|cidadania', re.I), 3),
    (re.compile(r'carta[\s_-]*de[\s_-]*servi|servi[cç]os|cadastr|inscri', re.I), 2),
]
RECRUTA = re.compile(r'(seja|quero ser|torne-se|torne se|cadastr\w*|inscri\w*|inscrev\w*|banco|rede|programa|chamamento|convoca\w*|formul[aá]rio|procura-se|precisa-se)\W+(?:\w+\W+){0,4}?volunt[aá]ri|volunt[aá]ri\w*\W+(?:\w+\W+){0,4}?(cadastr|inscri|inscrev|formul|interessad)|voluntariado|(?:quer|quero|deseja)\s+(?:ser\s+)?volunt', re.I)
RUIDO = re.compile(r'parcerias?\s+volunt|aposentadoria\s+volunt|demiss[aã]o\s+volunt|desligamento\s+volunt|pdv|voluntariamente|transfer[eê]ncias?\s+volunt|ades[aã]o\s+volunt|incentivo', re.I)
FORM_EXT = re.compile(r'docs\.google\.com/forms|forms\.gle|forms\.office\.com|typeform|jotform|wa\.me/|api\.whatsapp|chat\.whatsapp', re.I)
ESTADUAL = re.compile(r'defesacivil\.rs\.gov\.br|sisdc|volunt[aá]rios?\.rs\.gov\.br|rs\.gov\.br/.*volunt', re.I)
NAO_HTML = re.compile(r'\.(pdf|jpe?g|png|gif|docx?|xlsx?|zip|rar|mp4|mp3)(\?|$)', re.I)


def norm(s):
    return unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()


def prioridade(texto):
    return max([p for rx, p in PRIORIDADE if rx.search(texto)] or [0])


def varrer(site):
    base = site.rstrip('/')
    host = urlparse(base).netloc.removeprefix('www.')
    rp = robotparser.RobotFileParser()
    try:
        raiz = '{0.scheme}://{0.netloc}'.format(urlparse(base))  # robots.txt fica sempre na raiz do domínio
        r = requests.get(raiz + '/robots.txt', headers=H, timeout=15, verify=False)
        rp.parse(r.text.splitlines() if r.ok else [])
    except Exception:
        rp.parse([])
    pode = lambda u: rp.can_fetch(UA, u)

    fila = [(100, 0, base + '/')]
    # sitemap: URLs com "volunt" entram com prioridade máxima
    try:
        r = requests.get(base + '/sitemap.xml', headers=H, timeout=15, verify=False)
        locs = re.findall(r'<loc>\s*(.*?)\s*</loc>', r.text) if r.ok else []
        if r.ok and '<sitemapindex' in r.text:
            filhos = locs[:8]
            locs = []
            for u in filhos:
                time.sleep(1)
                locs += re.findall(r'<loc>\s*(.*?)\s*</loc>', requests.get(u, headers=H, timeout=15, verify=False).text)
        for u in locs[:20000]:
            if VOL.search(u):
                fila.append((50, 1, u))
    except Exception:
        pass
    vistos, paginas, achados, bloqueados, erros = set(), 0, [], 0, []
    busca_feita = False
    while fila and paginas < MAX_PAGINAS:
        fila.sort(key=lambda x: (-x[0], x[1]))
        pri, prof, url = fila.pop(0)
        url = url.split('#')[0]
        if url in vistos:
            continue
        vistos.add(url)
        if not pode(url):
            bloqueados += 1
            continue
        try:
            time.sleep(1)
            r = requests.get(url, headers=H, timeout=20, verify=False)
        except Exception as e:
            erros.append(f'{url}: {type(e).__name__}')
            continue
        paginas += 1
        if 'html' not in r.headers.get('content-type', ''):
            continue
        soup = BeautifulSoup(r.text, 'html.parser')
        html = r.text
        # meta refresh (portais que redirecionam para o site novo)
        mr = re.search(r'http-equiv=["\']?refresh["\']?[^>]*url=\'?"?([^"\'>]+)', html, re.I)
        if mr and prof == 0:
            novo = urljoin(r.url, mr.group(1).strip())
            host = urlparse(novo).netloc.removeprefix('www.')
            fila.append((100, 0, novo))
            continue
        if prof == 0 and not busca_feita:
            host = urlparse(r.url).netloc.removeprefix('www.')
            for f in BeautifulSoup(html, 'html.parser').find_all('form'):
                campo = next((i.get('name') for i in f.find_all('input') if i.get('name') and re.fullmatch(r'q|s|keys|searchabletext|busca|pesquisa|termo|e_campo_busca|search|texto', i.get('name'), re.I)), None)
                if campo and f.get('method', 'get').lower() == 'get':
                    busca_feita = True
                    fila.append((60, 1, urljoin(r.url, f.get('action') or '/') + ('&' if '?' in (f.get('action') or '') else '?') + campo + '=volunt%C3%A1rio'))
                    break
        for s in soup(['script', 'style', 'noscript']):
            s.decompose()
        texto = ' '.join(soup.get_text(' ').split())
        hits = [m.start() for m in VOL.finditer(texto)]
        links = []
        for a in soup.find_all('a', href=True):
            href = urljoin(url, a['href'])
            t = ' '.join(a.get_text(' ').split())
            links.append((href, t))
        if hits:
            forms = []
            for f in soup.find_all('form'):
                campos = [i.get('name') or i.get('id') or i.get('type') for i in f.find_all(['input', 'textarea', 'select']) if i.get('type') not in ('hidden', 'submit', 'button')]
                acao = f.get('action', '')
                if len(campos) >= 2 and not re.search(r'busca|search|pesquis|login|newsletter', acao + ' '.join(map(str, campos)), re.I):
                    forms.append({'action': acao, 'campos': campos[:15]})
            externos = sorted({h for h, _ in links if FORM_EXT.search(h)})
            iframes = [i.get('src', '') for i in soup.find_all('iframe') if FORM_EXT.search(i.get('src', ''))]
            ctx_all = [texto[max(0, i - 160): i + 200] for i in hits]
            recruta = [c for c in ctx_all if RECRUTA.search(c) and not RUIDO.search(c[120:240])]
            achados.append({
                'recrutamento': recruta[:4],
                'encerrado': bool(re.search(r'encerrad|esgotad|finalizad', ' '.join(recruta), re.I)),
                'url': url,
                'titulo': (soup.title.get_text(strip=True) if soup.title else '')[:150],
                'n_mencoes': len(hits),
                'contextos': [texto[max(0, i - 160): i + 200] for i in hits[:4]],
                'forms': forms,
                'links_form_externos': externos[:10] + iframes[:5],
                'links_estaduais': sorted({h for h, t in links if ESTADUAL.search(h) and VOL.search(h + ' ' + t)})[:10],
                'anos': sorted(set(re.findall(r'\b(20[12]\d)\b', texto)))[-6:],
            })
        if prof >= 3:
            continue
        for href, t in links:
            p = urlparse(href)
            if p.scheme not in ('http', 'https') or not p.netloc.removeprefix('www.').endswith(host) or NAO_HTML.search(p.path):
                continue
            pr = prioridade(t + ' ' + href)
            if pr == 0 and prof == 0 and not re.search(r'noticia|news|/20\d\d/|galeria|foto|video|licita|concurso|edital|transparen|login', href, re.I):
                pr = 1  # páginas do menu principal: cobertura mínima quando o menu não usa os termos
            if pr > 0 and href.split('#')[0] not in vistos:
                fila.append((pr - prof, prof + 1, href))
    return {'paginas': paginas, 'bloqueados_robots': bloqueados, 'erros': erros[:5], 'achados': achados}


def main():
    amostra = list(csv.DictReader(open(sys.argv[1])))
    def um(m):
        t0 = time.time()
        try:
            r = varrer(m['site'])
        except Exception as e:
            r = {'erro': repr(e)}
        r.update(m, segundos=round(time.time() - t0))
        print(f"{m['municipio']}: {r.get('paginas')} pág., {len(r.get('achados', []))} com menção", flush=True)
        return r
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(um, amostra))
    json.dump(res, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
