#!/usr/bin/env python3
"""
Coleta do indicador P9 — Plano de Contingência público e acessível.

Para cada município, navega no site oficial a partir da página inicial, como um cidadão
faria, e registra quantos cliques são necessários até o PDF do Plano de Contingência:

  1. Resolve o site (mesma regra do monitor.py: overrides.json > www.<slug>.rs.gov.br).
  2. Navegação guiada: segue primeiro os links com termos do plano/Defesa Civil e, depois,
     menus genéricos (documentos, publicações, legislação…), até MAX_CLIQUES de profundidade
     e MAX_PAGINAS páginas. Cada documento candidato é baixado e só vale se o texto tiver
     "Plano de Contingência" e o nome do município (OCR como fallback, igual ao monitor).
  3. Se a navegação não achar, tenta a busca interna do site (formulário GET da página
     inicial) com "plano de contingência".
  4. Grava o resultado em acessibilidade.json: via (navegacao | busca_interna |
     nao_encontrado), nº de cliques, o caminho clicado (evidência) e os metadados do PDF.

A cor é decidida no backend (definicoes.ts, P9), não aqui.

Coleta educada: 1 requisição por vez em cada site, com intervalo, identificação própria
no User-Agent e respeito ao robots.txt.

Uso:
    python acessibilidade.py --municipio "Agudo"          # um município (teste)
    python acessibilidade.py --limit 5                     # os 5 primeiros
    python acessibilidade.py                               # todos (retoma: pula os já coletados)
    python acessibilidade.py --refazer                     # recoleta todos
    python acessibilidade.py --situacao acesso_recusado    # recoleta só os que recusaram o acesso
"""
import argparse
import concurrent.futures
import gzip
import hashlib
import heapq
import io
import json
import re
import threading
import time
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlencode, urljoin, urlparse, urldefrag, parse_qs

import requests
import urllib3
from bs4 import BeautifulSoup
from pypdf import PdfReader

from monitor import (
    MUNICIPIOS_FILE, OVERRIDES_FILE, TESSERACT_DISPONIVEL, SITE_URL_CANDIDATES_TEMPLATE,
    load_json, normalizar_texto, ocr_pdf_texto,
)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_DIR = Path(__file__).resolve().parent
SAIDA = BASE_DIR / "acessibilidade.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; ObservatorioResilienciaRS-P9/1.0; "
        "+https://github.com/CoalizaoRS/observatorio)"
    ),
    "Accept-Language": "pt-BR,pt;q=0.9",
}

MAX_CLIQUES = 8          # profundidade máxima (o critério corta em 5; acima disso é amarelo)
MAX_PAGINAS = 80         # páginas HTML visitadas por site
PRAZO_SITE = 8 * 60      # segundos de navegação por site (sites lentos param aqui)
MAX_DOCUMENTOS = 15      # documentos candidatos baixados por site
INTERVALO = 1.0          # segundos entre requisições ao mesmo site
TIMEOUT = 15
MAX_PDF_BYTES = 60 * 1024 * 1024
PAGINAS_TEXTO = 12       # páginas do PDF lidas para validar
WORKERS = 12             # sites em paralelo (cada site é sequencial)
MAX_PAGINAS_ALVO = 150   # páginas na busca do caminho até um plano já localizado pelo sitemap
MAX_SITEMAPS = 15        # arquivos de sitemap lidos por site (índices aninhados incluídos)
MAX_URLS_SITEMAP = 50000

# Relevância do link (texto + href normalizados). Só links com relevância > 0 são seguidos.
# "contigencia" (sem n) é grafia comum nos nomes de arquivo (ex.: Agudo)
FORTE = re.compile(r"conti?ngen|contigen|plancon|plcon|plano municipal de protecao|plano de protecao e defesa")
DEFESA = re.compile(r"defesa civil|defesa-civil|defesacivil|protecao civil|\bcomdec\b|compdec|\bcpdc\b|\bcmdc\b|riscos? e desastres")
GENERICO = re.compile(
    r"documento|publica|legisla|download|arquivo|plano|transparencia|secretaria|servico|"
    r"seguranca|meio ambiente|governo|prefeitura|institucional|acesso a informacao|"
    r"orgaos|estrutura|departamento|setor|leis|decreto|normativ|relatorio|biblioteca|central"
)
EXT_DOC = re.compile(r"\.pdf($|\?)", re.I)
EXT_IGNORAR = re.compile(r"\.(jpe?g|png|gif|svg|webp|mp4|mp3|zip|rar|docx?|xlsx?|pptx?|odt|ods|css|js|ico)($|\?)", re.I)
REDES = re.compile(r"facebook|instagram|twitter|x\.com|youtube|whatsapp|linkedin|tiktok|flickr|google\.com/maps", re.I)
DOWNLOAD_HOSTS = re.compile(r"drive\.google\.com|docs\.google\.com|dropbox|onedrive|sharepoint|cdn|amazonaws|storage", re.I)


def agora():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def dominio_base(host: str) -> str:
    """Domínio do município: <slug>.rs.gov.br (ou os dois últimos rótulos fora de .gov.br)."""
    partes = host.lower().split(".")
    if host.endswith(".gov.br") and len(partes) >= 4:
        return ".".join(partes[-4:])
    return ".".join(partes[-2:])


class Resposta:
    """Resposta do navegador com a mesma interface usada de requests.Response."""

    def __init__(self, status, url, headers, corpo: bytes, texto: str | None = None):
        self.status_code, self.url, self.headers, self.content = status, url, headers, corpo
        self.text = texto if texto is not None else corpo.decode("utf-8", "replace")

    def iter_content(self, _n):
        yield self.content


class Site:
    """Sessão com um site: intervalo entre requisições, robots.txt e, quando a página inicial
    é montada em JavaScript, um navegador (com a mesma identificação)."""

    def __init__(self, base: str):
        self.base = base
        self.dominio = dominio_base(urlparse(base).hostname or "")
        self.s = requests.Session()
        self.s.headers.update(HEADERS)
        self.ultimo = 0.0
        self.requisicoes = 0
        self.bloqueados_robots = 0
        self.vetadas: list[str] = []
        self.robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self.pw = self.navegador = self.contexto = None
        self.slug = ""

    def usa_navegador(self):
        from playwright.sync_api import sync_playwright
        self.pw = sync_playwright().start()
        self.navegador = self.pw.chromium.launch()
        self.contexto = self.navegador.new_context(user_agent=HEADERS["User-Agent"], locale="pt-BR", ignore_https_errors=True)

    def fecha(self):
        if self.navegador:
            self.navegador.close()
            self.pw.stop()

    def permitido(self, url: str) -> bool:
        p = urlparse(url)
        raiz = f"{p.scheme}://{p.netloc}"
        if raiz not in self.robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = self.s.get(raiz + "/robots.txt", timeout=TIMEOUT, verify=False)
                rp.parse(r.text.splitlines() if r.status_code < 400 else [])
            except Exception:
                rp.parse([])
            self.robots[raiz] = rp
        ok = self.robots[raiz].can_fetch(HEADERS["User-Agent"], url)
        if not ok:
            self.bloqueados_robots += 1
            self.vetadas.append(url)
        return ok

    def _espera(self):
        espera = INTERVALO - (time.time() - self.ultimo)
        if espera > 0:
            time.sleep(espera)
        self.ultimo = time.time()
        self.requisicoes += 1

    def _get(self, url: str, stream: bool):
        self._espera()
        if not self.contexto:
            return self.s.get(url, timeout=TIMEOUT, verify=False, allow_redirects=True, stream=stream)
        if stream:  # documento: requisição direta, com os cookies do navegador
            r = self.contexto.request.get(url, timeout=TIMEOUT * 4000)
            return Resposta(r.status, r.url, r.headers, r.body())
        pag = self.contexto.new_page()
        try:
            r = pag.goto(url, wait_until="domcontentloaded", timeout=TIMEOUT * 2000)
            try:
                pag.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            if r is None:
                return None
            return Resposta(r.status, pag.url, r.headers, b"", pag.content())
        finally:
            pag.close()

    def get(self, url: str, stream: bool = False):
        if not self.permitido(url):
            return None
        try:
            return self._get(url, stream)
        except Exception:
            return None


def relevancia(texto: str, href: str) -> int:
    t = normalizar_texto(f"{texto} {href}")
    if FORTE.search(t):
        return 3
    if DEFESA.search(t):
        return 2
    if GENERICO.search(t):
        return 1
    return 0


def eh_documento(url: str, texto: str) -> bool:
    if EXT_DOC.search(url):
        return True
    t = normalizar_texto(texto)
    # links de download sem extensão (drive, cdn, /download?id=…) com texto do plano
    return bool(FORTE.search(t) or FORTE.search(normalizar_texto(url))) and (
        DOWNLOAD_HOSTS.search(url) or re.search(r"download|arquivo|anexo|file|documento", url, re.I)
    )


def url_drive(url: str) -> str:
    m = re.search(r"drive\.google\.com/file/d/([^/]+)", url) or re.search(r"[?&]id=([^&]+)", url)
    if "drive.google.com" in url and m:
        return f"https://drive.google.com/uc?export=download&id={m.group(1)}"
    return url


def texto_pdf(dados: bytes) -> tuple[str, dict]:
    meta = {}
    partes = []
    try:
        r = PdfReader(io.BytesIO(dados))
        info = r.metadata or {}
        for k in ("/CreationDate", "/ModDate", "/Title"):
            if info.get(k):
                meta[k.strip("/").lower()] = str(info.get(k))
        meta["paginas"] = len(r.pages)
        for i, p in enumerate(r.pages):
            if i >= PAGINAS_TEXTO:
                break
            try:
                partes.append(p.extract_text() or "")
            except Exception:
                pass
    except Exception as e:
        meta["erro"] = f"PDF ilegível: {e}"
    txt = " ".join(partes)
    if len(txt.strip()) < 50 and TESSERACT_DISPONIVEL and "erro" not in meta:
        txt = ocr_pdf_texto(dados)
        meta["ocr"] = True
    return txt, meta


# "Plano de contingência" também nomeia planos da COVID-19, da dengue, de energia, decretos de
# contingenciamento de gastos etc. O PLANCON de Defesa Civil fala de desastres naturais.
OUTRO_PLANO = re.compile(r"covid|coronav|pandemi|dengue|influenza|energia eletrica|contingenciamento|racionamento|vacina")
OUTRO_NOME = re.compile(r"covid|corona|dengue|energia|contingenciamento|racionamento|cartilha|\bata\b|protocolo|vacina")
DESASTRE = re.compile(r"inundac|enchente|enxurrad|alagament|deslizament|moviment\w* de massa|estiagem|seca|vendava|granizo|"
                      r"tempestade|desastre|area de risco|defesa civil|desabrigad|desalojad|cobrade|ciclone")


def eh_plancon_defesa_civil(texto: str, nome: str) -> bool:
    if OUTRO_NOME.search(nome):
        return False
    outro = len(OUTRO_PLANO.findall(texto))
    desastre = len(DESASTRE.findall(texto))
    return desastre >= 5 and outro * 2 < desastre


def valida_documento(site: Site, url: str, municipio: str) -> dict | None:
    """Baixa o candidato; devolve metadados se for o plano de contingência do município."""
    r = site.get(url_drive(url), stream=True)
    if r is None or r.status_code >= 400:
        return None
    ctype = r.headers.get("Content-Type", "")
    dados = b""
    try:
        for bloco in r.iter_content(64 * 1024):
            dados += bloco
            if len(dados) > MAX_PDF_BYTES:
                return None
    except requests.exceptions.RequestException:
        return None
    if not dados.startswith(b"%PDF"):
        return None
    txt, meta = texto_pdf(dados)
    norm = normalizar_texto(txt)
    if "plano de contingencia" not in norm and "plancon" not in norm:
        return None
    if not eh_plancon_defesa_civil(norm, normalizar_texto(f"{r.url} {meta.get('title', '')}")):
        return None
    nome_ok = normalizar_texto(municipio) in norm
    return {
        "url": r.url,
        "sha256": hashlib.sha256(dados).hexdigest(),
        "tamanho": len(dados),
        "content_type": ctype,
        "last_modified": r.headers.get("Last-Modified"),
        "nome_municipio_no_texto": nome_ok,
        **meta,
    }


def links(html: str, base: str):
    soup = BeautifulSoup(html, "html.parser")
    vistos = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        url = urldefrag(urljoin(base, href))[0]
        if url in vistos:
            continue
        vistos.add(url)
        texto = a.get_text(" ", strip=True) or a.get("title", "") or a.get("aria-label", "")
        yield url, texto[:120]
    return soup


def mesmo_site(site: Site, url: str) -> bool:
    """Domínio da prefeitura ou portal do fornecedor com o nome do município no host
    (ex.: pmsantoangelo.abase.com.br, santoangelo.gespamweb.com.br)."""
    host = urlparse(url).hostname or ""
    return host.endswith(site.dominio) or (len(site.slug) >= 4 and site.slug in host.replace("-", ""))


def chave_url(url: str) -> str:
    p = urlparse(unquote(url))
    return f"{(p.hostname or '').removeprefix('www.')}{p.path.rstrip('/')}?{p.query}".lower()


def segmentos(url: str) -> list[str]:
    p = urlparse(unquote(url))
    return [(p.hostname or "").removeprefix("www.")] + [x for x in p.path.lower().split("/") if x]


def proximidade(url: str, alvos: list[str]) -> int:
    """Nº de segmentos iniciais (host + pastas) em comum com o destino mais próximo."""
    s = segmentos(url)
    melhor = 0
    for a in alvos:
        t = segmentos(a)
        n = 0
        while n < min(len(s), len(t)) and s[n] == t[n]:
            n += 1
        melhor = max(melhor, n)
    return melhor


def navega(site: Site, home_url: str, home_html: str, municipio: str, alvo: dict | None = None) -> dict:
    """Busca guiada pela relevância. Devolve o menor caminho encontrado até o plano.

    Com `alvo` (plano já localizado pelo sitemap: {"doc": url, "pagina": url|None, "documento": meta}),
    a busca prioriza os links cujo endereço se aproxima do destino e aceita o PDF do alvo sem
    baixá-lo de novo. Os cliques são sempre contados a partir da página inicial."""
    destinos = [u for u in ((alvo or {}).get("pagina"), (alvo or {}).get("doc")) if u]
    chave_doc = chave_url(alvo["doc"]) if alvo else None
    limite = MAX_PAGINAS_ALVO if alvo else MAX_PAGINAS
    # fila: (-relevância acumulada, cliques, ordem, url, caminho)
    fila = []
    ordem = 0
    visitadas = {home_url}
    docs_testados: dict[str, dict | None] = {}
    paginas = 0
    melhor = None

    def processa(url_pag, html, caminho, rel_pag=0):
        nonlocal ordem, melhor
        cliques = len(caminho)
        candidatos = []
        for url, texto in links(html, url_pag):
            if REDES.search(url):
                continue
            rel = relevancia(texto, url)
            passo = caminho + [{"url": url, "texto": texto}]
            if alvo and chave_url(url) == chave_doc:
                if not melhor or len(passo) < len(melhor["caminho"]):
                    melhor = {"caminho": passo, "documento": alvo["documento"]}
                continue
            if eh_documento(url, texto):
                # PDF com termo do plano, ou qualquer PDF numa página da Defesa Civil/do plano
                if rel >= 2 or rel_pag >= 2 or FORTE.search(normalizar_texto(texto + " " + url)):
                    candidatos.append((rel, url, passo))
                continue
            if EXT_IGNORAR.search(url) or not mesmo_site(site, url) or url in visitadas:
                continue
            prox = proximidade(url, destinos) if destinos else 0
            # com destino conhecido, a proximidade do endereço pesa mais que as palavras do link
            prio = rel + 2 * max(prox - 1, 0)
            if prio > 0 and cliques + 1 < MAX_CLIQUES:
                visitadas.add(url)
                ordem += 1
                heapq.heappush(fila, (-prio, cliques + 1, ordem, url, passo, rel))
        for rel, url, passo in sorted(candidatos, key=lambda x: -x[0]):
            if melhor and len(passo) >= len(melhor["caminho"]):
                continue
            if url not in docs_testados and len([d for d in docs_testados.values()]) < MAX_DOCUMENTOS:
                docs_testados[url] = valida_documento(site, url, municipio)
            doc = docs_testados.get(url)
            if doc:
                melhor = {"caminho": passo, "documento": doc}

    processa(home_url, home_html, [])
    inicio = time.time()
    while fila and paginas < limite and time.time() - inicio < PRAZO_SITE:
        _, cliques, _, url, caminho, rel = heapq.heappop(fila)
        if melhor and cliques + 1 >= len(melhor["caminho"]):
            continue  # não há como achar caminho mais curto por aqui
        r = site.get(url)
        paginas += 1
        if r is None or r.status_code >= 400 or "html" not in r.headers.get("Content-Type", "html"):
            continue
        processa(r.url, r.text, caminho, rel)

    return {"melhor": melhor, "paginas": paginas, "documentos_testados": len(docs_testados),
            "prazo_esgotado": time.time() - inicio >= PRAZO_SITE}


def le_sitemaps(site: Site, home_url: str) -> list[str]:
    """URLs listadas nos sitemaps do site (robots.txt + endereços usuais; índices aninhados)."""
    raiz = f"{urlparse(home_url).scheme}://{urlparse(home_url).netloc}"
    site.permitido(raiz + "/")  # carrega o robots.txt
    rp = site.robots.get(raiz)
    fila = list((rp.site_maps() or []) if rp else []) + [raiz + p for p in ("/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml")]
    vistos, urls = set(), []
    lidos = 0
    while fila and lidos < MAX_SITEMAPS and len(urls) < MAX_URLS_SITEMAP:
        u = fila.pop(0)
        if u in vistos:
            continue
        vistos.add(u)
        r = site.get(u, stream=True)
        if r is None or r.status_code >= 400:
            continue
        lidos += 1
        try:
            corpo = b"".join(r.iter_content(256 * 1024))
        except Exception:
            continue
        if corpo[:2] == b"\x1f\x8b":
            try:
                corpo = gzip.decompress(corpo)
            except Exception:
                continue
        texto = corpo.decode("utf-8", "replace")
        if "<loc>" not in texto:
            continue
        locs = [x.strip() for x in re.findall(r"<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*</loc>", texto, re.S)]
        if "<sitemapindex" in texto:
            fila.extend(locs)
        else:
            urls.extend(locs)
    return urls[:MAX_URLS_SITEMAP]


def descobre_por_sitemap(site: Site, home_url: str, municipio: str) -> dict:
    """Usa o sitemap só para localizar o plano (o destino); os cliques são medidos depois."""
    urls = le_sitemaps(site, home_url)
    info = {"urls_sitemap": len(urls)}
    if not urls:
        return info
    norm = [(u, normalizar_texto(unquote(u))) for u in urls]
    docs = [u for u, n in norm if eh_documento(u, "") and FORTE.search(n)]
    paginas = [u for u, n in norm if not EXT_DOC.search(u) and not EXT_IGNORAR.search(u) and (FORTE.search(n) or DEFESA.search(n))]
    paginas.sort(key=lambda u: 0 if FORTE.search(normalizar_texto(unquote(u))) else 1)
    for u in docs[:6]:
        doc = valida_documento(site, u, municipio)
        if doc:
            info["alvo"] = {"doc": u, "pagina": None, "documento": doc}
            return info
    for pg in paginas[:8]:
        r = site.get(pg)
        if r is None or r.status_code >= 400:
            continue
        for u, t in links(r.text, r.url):
            if eh_documento(u, t):
                doc = valida_documento(site, u, municipio)
                if doc:
                    info["alvo"] = {"doc": u, "pagina": r.url, "documento": doc}
                    return info
    return info


def busca_interna(site: Site, home_url: str, home_html: str, municipio: str) -> dict:
    """Usa o formulário de busca (GET) da página inicial com 'plano de contingência'."""
    soup = BeautifulSoup(home_html, "html.parser")
    for form in soup.find_all("form"):
        if (form.get("method") or "get").lower() != "get":
            continue
        campo = form.find("input", attrs={"type": "search"}) or form.find(
            "input", attrs={"name": re.compile(r"^(q|s|busca|pesquisa|search|termo|query|keyword|texto|palavra)", re.I)}
        )
        if not campo or not campo.get("name"):
            continue
        params = {i.get("name"): i.get("value", "") for i in form.find_all("input", attrs={"type": "hidden"}) if i.get("name")}
        params[campo["name"]] = "plano de contingência"
        acao = urljoin(home_url, form.get("action") or home_url)
        url = acao + ("&" if "?" in acao else "?") + urlencode(params)
        r = site.get(url)
        if r is None or r.status_code >= 400:
            return {"formulario": acao, "achou": False, "erro": f"HTTP {getattr(r, 'status_code', 'sem resposta')}"}
        # resultado: documento direto ou uma página de resultado que leva a ele (1 nível)
        passo0 = [{"url": url, "texto": "busca interna: plano de contingência"}]
        cands = [(u, t) for u, t in links(r.text, r.url) if FORTE.search(normalizar_texto(t + " " + u))]
        for u, t in cands[:8]:
            if eh_documento(u, t):
                doc = valida_documento(site, u, municipio)
                if doc:
                    return {"formulario": acao, "achou": True, "caminho": passo0 + [{"url": u, "texto": t}], "documento": doc}
            elif mesmo_site(site, u):
                rp = site.get(u)
                if rp is None or rp.status_code >= 400:
                    continue
                for u2, t2 in links(rp.text, rp.url):
                    if eh_documento(u2, t2) and FORTE.search(normalizar_texto(t2 + " " + u2)):
                        doc = valida_documento(site, u2, municipio)
                        if doc:
                            return {"formulario": acao, "achou": True,
                                    "caminho": passo0 + [{"url": u, "texto": t}, {"url": u2, "texto": t2}], "documento": doc}
        return {"formulario": acao, "achou": False}
    return {"formulario": None, "achou": False}


def n_links(html: str, url: str) -> int:
    return sum(1 for _ in links(html, url))


def resolve_site(m: dict, overrides: dict):
    """Primeiro com cliente HTTP simples; se a página inicial responde mas vem quase sem links
    (montada em JavaScript), repete com navegador. Site que recusa o acesso (4xx/5xx) ou veta
    no robots.txt não é contornado: fica registrado para conferência manual."""
    ov = overrides.get(m["nome"], {})
    if ov.get("skip"):
        return None, None, None
    cands = ([ov["site_base"]] if ov.get("site_base") else []) + [t.format(slug=m["slug"]) for t in SITE_URL_CANDIDATES_TEMPLATE]
    for url in cands:
        site = Site(url)
        r = site.get(url)
        if r is None and site.bloqueados_robots:
            return None, "robots", url
        if r is None or r.status_code >= 400 or not r.text:
            if r is not None and r.status_code in (401, 403, 429):
                return None, "recusado", url
            continue
        if n_links(r.text, r.url) < 10:
            site.usa_navegador()
            r2 = site.get(url)
            if r2 is not None and r2.status_code < 400:
                r = r2
        site.dominio = dominio_base(urlparse(r.url).hostname or "")
        site.slug = m["slug"].replace("-", "")
        return site, r, url
    return None, None, cands[0]


def coleta(m: dict, overrides: dict, anterior: dict | None = None) -> dict:
    t0 = time.time()
    res = {"codigo_ibge": m["codigo_ibge"], "coletado_em": agora()}
    site, home, base = resolve_site(m, overrides)
    res["site_base"] = base
    if site is None:
        status = {"robots": "robots_veta", "recusado": "acesso_recusado"}.get(home, "inacessivel")
        res.update(site_status=status, via="nao_encontrado")
        return res
    try:
        res["site_status"] = "ok"
        res["home"] = home.url
        if site.contexto:
            res["navegador"] = True
        if anterior:
            # só a etapa do sitemap: a navegação anterior (sem plano) é mantida
            nav = {"melhor": None, "paginas": anterior.get("paginas_visitadas", 0),
                   "documentos_testados": anterior.get("documentos_testados", 0),
                   "prazo_esgotado": anterior.get("prazo_esgotado", False)}
            if anterior.get("busca_interna"):
                res["busca_interna"] = anterior["busca_interna"]
            if anterior.get("documentos_vetados_robots"):
                res["documentos_vetados_robots"] = anterior["documentos_vetados_robots"]
        else:
            nav = navega(site, home.url, home.text, m["nome"])
        res["paginas_visitadas"] = nav["paginas"]
        res["documentos_testados"] = nav["documentos_testados"]
        if nav["prazo_esgotado"]:
            res["prazo_esgotado"] = True
        if not nav["melhor"]:
            # plano não achado navegando: o sitemap diz onde ele está, e a busca do caminho
            # a partir da página inicial é refeita mirando esse destino
            sm = descobre_por_sitemap(site, home.url, m["nome"])
            res["sitemap"] = {"urls": sm["urls_sitemap"]}
            if sm.get("alvo"):
                alvo = sm["alvo"]
                res["sitemap"].update(doc=alvo["doc"], pagina=alvo["pagina"])
                nav2 = navega(site, home.url, home.text, m["nome"], alvo)
                res["paginas_visitadas"] += nav2["paginas"]
                if nav2["melhor"]:
                    nav = nav2
                    res["descoberto_por"] = "sitemap"
                else:
                    res.update(via="sitemap", documento=alvo["documento"],
                               caminho=[{"url": alvo["pagina"] or alvo["doc"], "texto": "localizado pelo sitemap"}])
        if nav["melhor"]:
            res.update(via="navegacao", cliques=len(nav["melhor"]["caminho"]), caminho=nav["melhor"]["caminho"],
                       documento=nav["melhor"]["documento"])
        elif res.get("via") == "sitemap":
            pass
        else:
            bi = busca_interna(site, home.url, home.text, m["nome"])
            res["busca_interna"] = {k: bi[k] for k in ("formulario", "achou") if k in bi}
            if bi.get("achou"):
                res.update(via="busca_interna", caminho=bi["caminho"], documento=bi["documento"])
            else:
                res["via"] = "nao_encontrado"
        res["requisicoes"] = site.requisicoes
        if site.bloqueados_robots:
            res["urls_vetadas_robots"] = site.bloqueados_robots
            # documentos candidatos que o robots.txt não deixou baixar: conferência manual
            docs = [u for u in site.vetadas if EXT_DOC.search(u) or FORTE.search(normalizar_texto(u))]
            if docs:
                res["documentos_vetados_robots"] = list(dict.fromkeys(res.get("documentos_vetados_robots", []) + docs))[:10]
        res["segundos"] = round(time.time() - t0, 1)
        return res
    finally:
        site.fecha()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--municipio", action="append")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--refazer", action="store_true")
    ap.add_argument("--nao-encontrados", action="store_true", help="recoleta os sites acessíveis em que o plano não foi achado")
    ap.add_argument("--so-sitemap", action="store_true",
                    help="com --nao-encontrados: mantém a navegação já feita e roda só a etapa do sitemap")
    ap.add_argument("--lentos", action="store_true", help="recoleta só os que esgotaram o prazo sem achar o plano")
    ap.add_argument("--situacao", action="append",
                    help="recoleta só os já coletados com esta situação (ex.: acesso_recusado, inacessivel)")
    ap.add_argument("--workers", type=int, default=WORKERS)
    ap.add_argument("--prazo", type=int, help="minutos de navegação por site (padrão 8)")
    a = ap.parse_args()
    if a.prazo:
        global PRAZO_SITE
        PRAZO_SITE = a.prazo * 60

    municipios = load_json(MUNICIPIOS_FILE, [])
    overrides = load_json(OVERRIDES_FILE, {})
    estado = load_json(SAIDA, {})
    if a.municipio:
        alvo = {normalizar_texto(x) for x in a.municipio}
        municipios = [m for m in municipios if normalizar_texto(m["nome"]) in alvo]
    elif a.nao_encontrados:
        municipios = [m for m in municipios if estado.get(m["nome"], {}).get("site_status") == "ok"
                      and estado[m["nome"]].get("via") == "nao_encontrado"]
    elif a.lentos:
        municipios = [m for m in municipios if estado.get(m["nome"], {}).get("prazo_esgotado")
                      and estado[m["nome"]].get("via") == "nao_encontrado"]
    elif a.situacao:
        municipios = [m for m in municipios if estado.get(m["nome"], {}).get("site_status") in a.situacao]
    elif not a.refazer:
        municipios = [m for m in municipios if m["nome"] not in estado]
    if a.limit:
        municipios = municipios[: a.limit]
    print(f"[P9] {len(municipios)} município(s), {a.workers} em paralelo")

    trava = threading.Lock()

    def tarefa(m):
        try:
            ant = estado.get(m["nome"]) if a.so_sitemap else None
            r = coleta(m, overrides, ant)
            if ant and r.get("site_status") != "ok":
                r = ant  # site fora do ar agora: não apaga a coleta anterior
        except Exception as e:
            r = {"codigo_ibge": m["codigo_ibge"], "coletado_em": agora(), "via": "erro", "erro": repr(e)[:300]}
        with trava:
            estado[m["nome"]] = r
            with open(SAIDA, "w", encoding="utf-8") as f:
                json.dump(estado, f, ensure_ascii=False, indent=2, sort_keys=True)
        extra = f"{r.get('cliques')} clique(s)" if r.get("via") == "navegacao" else ""
        print(f"  {m['nome']}: {r.get('site_status', '-')} · {r['via']} {extra} · {r.get('paginas_visitadas', 0)} pág · {r.get('segundos', 0)}s", flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as ex:
        list(ex.map(tarefa, municipios))


if __name__ == "__main__":
    main()
