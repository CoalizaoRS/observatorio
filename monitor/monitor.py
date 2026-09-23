#!/usr/bin/env python3
"""
Monitor de Planos de Contingência dos municípios do RS.

Para cada município:
  1. Resolve a URL do site oficial (override manual > convenção www.<slug>.rs.gov.br).
  2. Procura, no site, um link para o Plano de Contingência / página da Defesa Civil.
  3. Baixa o documento encontrado e confirma que o texto extraído do PDF contém
     o termo "Plano de Contingência" — sem isso, é tratado como falso positivo
     da busca por palavra-chave e descartado. Quando o PDF não tem texto
     extraível (digitalizado/imagem), tenta OCR (tesseract) antes de desistir.
  4. Verifica se o documento é uma versão nova em relação à última verificação
     (comparando headers HTTP e, quando necessário, o hash do conteúdo).
  5. Atualiza o estado persistido (state.json) e monta um relatório das mudanças.
  6. Opcionalmente envia um e-mail de resumo (digest) quando há mudanças.

Uso:
    python monitor.py                       # roda para todos os municípios
    python monitor.py --limit 10            # roda só os 10 primeiros (teste)
    python monitor.py --municipio "Lajeado" # roda só um município (teste)
    python monitor.py --dry-run             # não envia e-mail, só imprime o relatório
    python monitor.py --validar-existentes  # reavalia o conteúdo dos PDFs já
                                             # baixados em changed_pdfs/ sem
                                             # baixar nada de novo
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
import logging
import os
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import pymupdf
import pytesseract
import requests
from bs4 import BeautifulSoup
from PIL import Image
from pypdf import PdfReader

logging.getLogger("pypdf").setLevel(logging.ERROR)

try:
    pytesseract.get_tesseract_version()
    TESSERACT_DISPONIVEL = True
except Exception:
    TESSERACT_DISPONIVEL = False
    print(
        "[ocr] Binário 'tesseract' não encontrado no PATH — validação de PDFs digitalizados via OCR "
        "ficará desativada (documentos sem texto extraível serão tratados como falso positivo). "
        "Instale o pacote 'tesseract-ocr' (+ 'tesseract-ocr-por') para habilitar.",
        file=sys.stderr,
    )

BASE_DIR = Path(__file__).resolve().parent
MUNICIPIOS_FILE = BASE_DIR / "municipios_rs.json"
OVERRIDES_FILE = BASE_DIR / "overrides.json"
STATE_FILE = BASE_DIR / "state.json"
CHANGED_PDFS_DIR = BASE_DIR / "changed_pdfs"
FALSOS_POSITIVOS_DIR = BASE_DIR / "changed_pdfs" / "falsos_positivos"
NAO_ENCONTRADOS_FILE = BASE_DIR / "changed_pdfs" / "municipios_sem_plano.txt"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}

KEYWORDS = [
    "contingencia", "contingência", "plcon",
    "defesa-civil", "defesa civil", "defesacivil",
    "protecao e defesa civil", "proteção e defesa civil",
    "coordenadoria de defesa civil", "cpdc", "cmdc",
]

REQUEST_TIMEOUT = 12
MAX_WORKERS = 15
MAX_SUBPAGES = 5

TERMO_OBRIGATORIO = "plano de contingencia"
MAX_PAGINAS_VALIDACAO = 60

# OCR só é acionado quando a extração normal não achou o termo e trouxe pouco
# ou nenhum texto (indício de PDF digitalizado). É bem mais lento que a
# extração de texto nativa, por isso o número de páginas é bem menor.
OCR_CHARS_TRIGGER = 50
OCR_MAX_PAGINAS = 10
OCR_DPI = 200
OCR_IDIOMA = "por"

SITE_URL_CANDIDATES_TEMPLATE = [
    "https://www.{slug}.rs.gov.br",
    "https://{slug}.rs.gov.br",
    "http://www.{slug}.rs.gov.br",
]


@dataclass
class MunicipioResult:
    nome: str
    codigo_ibge: int
    site_base: str | None = None
    site_status: str = "unreachable"  # unreachable | ok
    plano_url: str | None = None
    plano_status: str = "not_found"  # not_found | false_positive | new | changed | unchanged
    sha256: str | None = None
    content_length: int | None = None
    last_modified_header: str | None = None
    etag: str | None = None
    termo_encontrado: bool | None = None
    chars_extraidos: int | None = None
    ocr_usado: bool = False
    error: str | None = None
    pdf_bytes: bytes | None = field(default=None, repr=False)


def load_json(path: Path, default):
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path: Path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def probe_site(nome: str, slug: str, override_base: str | None) -> tuple[str | None, requests.Response | None]:
    """Tenta encontrar a URL base funcional do site oficial do município."""
    candidates = [override_base] if override_base else []
    candidates += [t.format(slug=slug) for t in SITE_URL_CANDIDATES_TEMPLATE]

    for url in candidates:
        if not url:
            continue
        try:
            resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT, verify=False, allow_redirects=True)
            if resp.status_code < 400:
                return url, resp
        except requests.exceptions.RequestException:
            continue
    return None, None


def find_plan_link(base_url: str, home_resp: requests.Response) -> str | None:
    """Procura, na home e em subpáginas relevantes, um link para o plano de contingência."""
    try:
        soup = BeautifulSoup(home_resp.text, "html.parser")
    except Exception:
        return None

    candidatos = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        texto = a.get_text(" ", strip=True).lower()
        url_completo = urljoin(base_url, href)
        if any(termo in texto or termo in href.lower() for termo in KEYWORDS):
            if url_completo not in candidatos:
                candidatos.append(url_completo)

    if not candidatos:
        return None

    # PDF direto tem prioridade
    for link in candidatos:
        if link.lower().split("?")[0].endswith(".pdf"):
            return link

    # Caso contrário, entra em até MAX_SUBPAGES páginas internas procurando um PDF
    for link in candidatos[:MAX_SUBPAGES]:
        try:
            sub_resp = requests.get(link, headers=HEADERS, timeout=REQUEST_TIMEOUT, verify=False)
            if sub_resp.status_code >= 400:
                continue
            sub_soup = BeautifulSoup(sub_resp.text, "html.parser")
            for sub_a in sub_soup.find_all("a", href=True):
                sub_href = sub_a["href"]
                sub_texto = sub_a.get_text(" ", strip=True).lower()
                sub_url = urljoin(link, sub_href)
                if sub_url.lower().split("?")[0].endswith(".pdf") and (
                    "pdf" in sub_texto or any(k in sub_texto or k in sub_href.lower() for k in KEYWORDS)
                ):
                    return sub_url
        except requests.exceptions.RequestException:
            continue

    return None


def fetch_pdf_metadata(url: str) -> requests.Response | None:
    """HEAD (com fallback para GET em stream) só para pegar headers, sem baixar o corpo todo."""
    try:
        resp = requests.head(url, headers=HEADERS, timeout=REQUEST_TIMEOUT, verify=False, allow_redirects=True)
        if resp.status_code < 400 and resp.headers:
            return resp
    except requests.exceptions.RequestException:
        pass

    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT, verify=False, stream=True)
        resp.close()
        return resp
    except requests.exceptions.RequestException:
        return None


def download_pdf(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT * 2, verify=False)
        return resp
    except requests.exceptions.RequestException:
        return None


def normalizar_texto(txt: str) -> str:
    nfkd = unicodedata.normalize("NFKD", txt)
    sem_acento = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", sem_acento.lower())


def ocr_pdf_texto(pdf_bytes: bytes, max_paginas: int = OCR_MAX_PAGINAS, dpi: int = OCR_DPI) -> str:
    """Rasteriza as páginas do PDF e roda OCR (tesseract) nelas. Usado só como
    fallback quando não há texto extraível (PDF digitalizado/imagem)."""
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return ""

    matriz = pymupdf.Matrix(dpi / 72, dpi / 72)
    partes = []
    try:
        for i, page in enumerate(doc):
            if i >= max_paginas:
                break
            try:
                pix = page.get_pixmap(matrix=matriz, colorspace=pymupdf.csRGB)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                partes.append(pytesseract.image_to_string(img, lang=OCR_IDIOMA))
            except Exception:
                continue
    finally:
        doc.close()

    return " ".join(partes)


def validar_conteudo_pdf(pdf_bytes: bytes, termo: str = TERMO_OBRIGATORIO) -> dict:
    """Confirma que o PDF baixado de fato contém o termo obrigatório no texto,
    para filtrar falsos positivos da busca por palavra-chave em links/HTML.
    Quando a extração nativa não encontra o termo e trouxe pouco/nenhum texto
    (indício de PDF digitalizado), tenta OCR antes de dar o PDF como inválido."""
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        paginas = reader.pages
    except Exception as e:
        return {"termo_encontrado": False, "chars_extraidos": 0, "erro": f"PDF ilegível: {e}", "ocr_usado": False}

    partes = []
    chars_extraidos = 0
    for i, page in enumerate(paginas):
        if i >= MAX_PAGINAS_VALIDACAO:
            break
        try:
            texto_pagina = page.extract_text() or ""
        except Exception:
            texto_pagina = ""
        partes.append(texto_pagina)
        chars_extraidos += len(texto_pagina)

    texto_normalizado = normalizar_texto(" ".join(partes))
    termo_normalizado = normalizar_texto(termo)
    termo_encontrado = termo_normalizado in texto_normalizado
    ocr_usado = False

    if not termo_encontrado and chars_extraidos < OCR_CHARS_TRIGGER and TESSERACT_DISPONIVEL:
        ocr_usado = True
        texto_ocr = ocr_pdf_texto(pdf_bytes)
        if texto_ocr:
            chars_extraidos = len(texto_ocr)
            termo_encontrado = termo_normalizado in normalizar_texto(texto_ocr)

    return {
        "termo_encontrado": termo_encontrado,
        "chars_extraidos": chars_extraidos,
        "erro": None,
        "ocr_usado": ocr_usado,
    }


def motivo_falso_positivo(validacao: dict) -> str:
    if validacao["erro"]:
        return validacao["erro"]
    motivo = 'termo "Plano de Contingência" não encontrado no texto do PDF'
    if validacao["ocr_usado"]:
        motivo += " (tentativa via OCR também não encontrou o termo)"
    elif validacao["chars_extraidos"] == 0:
        motivo += " (nenhum texto extraído — pode ser PDF digitalizado/imagem; OCR indisponível neste ambiente)" \
            if not TESSERACT_DISPONIVEL else " (nenhum texto extraído — pode ser PDF digitalizado/imagem)"
    return motivo


def metadata_suggests_change(prev: dict, meta_resp: requests.Response) -> bool:
    """Triagem rápida via headers HTTP antes de baixar o PDF inteiro."""
    if not prev or not prev.get("sha256"):
        return True

    novo_etag = meta_resp.headers.get("ETag")
    novo_last_mod = meta_resp.headers.get("Last-Modified")
    novo_len = meta_resp.headers.get("Content-Length")

    if novo_etag and prev.get("etag"):
        return novo_etag != prev["etag"]
    if novo_last_mod and prev.get("last_modified_header"):
        return novo_last_mod != prev["last_modified_header"]
    if novo_len and prev.get("content_length"):
        return str(novo_len) != str(prev["content_length"])

    # Sem headers confiáveis: não dá pra confiar na triagem, baixa e confere hash.
    return True


def process_municipio(m: dict, overrides: dict, state: dict) -> MunicipioResult:
    nome = m["nome"]
    slug = m["slug"]
    override = overrides.get(nome, {})
    if override.get("skip"):
        return MunicipioResult(nome=nome, codigo_ibge=m["codigo_ibge"], site_status="skipped")

    override_base = override.get("site_base")
    prev = state.get(nome, {})

    result = MunicipioResult(nome=nome, codigo_ibge=m["codigo_ibge"])

    base_url, home_resp = probe_site(nome, slug, override_base)
    if not base_url:
        result.error = "site inacessível (home não respondeu em nenhuma variante testada)"
        return result

    result.site_base = base_url
    result.site_status = "ok"

    plano_url = find_plan_link(base_url, home_resp)
    if not plano_url:
        result.plano_status = "not_found"
        return result

    result.plano_url = plano_url

    meta_resp = fetch_pdf_metadata(plano_url)
    prev_plano = prev.get("plano") or {}

    suspeita_mudanca = True
    if meta_resp is not None:
        suspeita_mudanca = metadata_suggests_change(prev_plano, meta_resp)

    if not suspeita_mudanca:
        result.plano_status = "unchanged"
        result.sha256 = prev_plano.get("sha256")
        result.content_length = prev_plano.get("content_length")
        result.last_modified_header = prev_plano.get("last_modified_header")
        result.etag = prev_plano.get("etag")
        return result

    pdf_resp = download_pdf(plano_url)
    if pdf_resp is None or pdf_resp.status_code >= 400 or not pdf_resp.content:
        result.error = "link de plano encontrado, mas download falhou"
        result.plano_status = "not_found"
        return result

    sha256 = hashlib.sha256(pdf_resp.content).hexdigest()
    result.sha256 = sha256
    result.content_length = len(pdf_resp.content)
    result.last_modified_header = pdf_resp.headers.get("Last-Modified")
    result.etag = pdf_resp.headers.get("ETag")

    validacao = validar_conteudo_pdf(pdf_resp.content)
    result.termo_encontrado = validacao["termo_encontrado"]
    result.chars_extraidos = validacao["chars_extraidos"]
    result.ocr_usado = validacao["ocr_usado"]

    if not validacao["termo_encontrado"]:
        result.plano_status = "false_positive"
        result.pdf_bytes = pdf_resp.content
        result.error = motivo_falso_positivo(validacao)
        return result

    if not prev_plano.get("sha256"):
        result.plano_status = "new"
        result.pdf_bytes = pdf_resp.content
    elif prev_plano.get("sha256") != sha256:
        result.plano_status = "changed"
        result.pdf_bytes = pdf_resp.content
    else:
        result.plano_status = "unchanged"

    return result


def build_new_state_entry(prev: dict, r: MunicipioResult) -> dict:
    prev_plano = (prev or {}).get("plano") or {}
    entry = {
        "codigo_ibge": r.codigo_ibge,
        "site_base": r.site_base,
        "site_status": r.site_status,
        "last_checked": now_iso(),
    }
    if r.error:
        entry["last_error"] = r.error

    if r.plano_status == "false_positive":
        entry["plano"] = None
        entry["falso_positivo"] = {
            "url": r.plano_url,
            "motivo": r.error,
            "chars_extraidos": r.chars_extraidos,
            "ocr_tentado": r.ocr_usado,
            "detectado_em": now_iso(),
        }
    elif r.plano_url and r.sha256:
        first_seen = prev_plano.get("first_seen") if prev_plano.get("sha256") else now_iso()
        last_changed = prev_plano.get("last_changed")
        if r.plano_status in ("new", "changed"):
            last_changed = now_iso()

        entry["plano"] = {
            "url": r.plano_url,
            "sha256": r.sha256,
            "content_length": r.content_length,
            "last_modified_header": r.last_modified_header,
            "etag": r.etag,
            "termo_confirmado": True,
            "validado_via_ocr": r.ocr_usado,
            "first_seen": first_seen or now_iso(),
            "last_changed": last_changed or now_iso(),
        }
    else:
        entry["plano"] = None

    return entry


def send_email_digest(changes: list[dict], unreachable_count: int, total: int):
    """Envia o digest via API HTTP do Resend (https://resend.com) — nenhuma
    credencial de e-mail (SMTP) é armazenada, só uma API key escopada."""
    resend_api_key = os.environ.get("RESEND_API_KEY")
    email_from = os.environ.get("EMAIL_FROM")
    email_to = os.environ.get("EMAIL_TO")

    if not all([resend_api_key, email_from, email_to]):
        print("[email] Variáveis RESEND_API_KEY/EMAIL_FROM/EMAIL_TO não configuradas — pulando envio de e-mail.")
        return

    linhas = [
        f"Monitor de Planos de Contingência RS — {len(changes)} atualização(ões) detectada(s)",
        "",
    ]
    for c in changes:
        linhas.append(f"• {c['nome']} [{c['status']}]")
        linhas.append(f"  Documento: {c['plano_url']}")
        linhas.append(f"  Site: {c['site_base']}")
        linhas.append("")

    linhas.append(f"Resumo geral: {total} municípios verificados, {unreachable_count} com site inacessível.")
    corpo = "\n".join(linhas)

    destinatarios = [e.strip() for e in email_to.split(",") if e.strip()]

    try:
        resp = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {resend_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": email_from,
                "to": destinatarios,
                "subject": f"[Planos de Contingência RS] {len(changes)} atualização(ões) detectada(s)",
                "text": corpo,
            },
            timeout=30,
        )
        if resp.status_code >= 400:
            print(f"[email] Falha ao enviar e-mail via Resend (HTTP {resp.status_code}): {resp.text}", file=sys.stderr)
        else:
            print(f"[email] Digest enviado via Resend para {email_to}.")
    except requests.exceptions.RequestException as e:
        print(f"[email] Falha ao enviar e-mail via Resend: {e}", file=sys.stderr)


def escrever_relatorio_sem_plano(municipios: list[dict], state: dict):
    sem_plano = []
    for m in municipios:
        nome = m["nome"]
        e = state.get(nome)
        if not e:
            continue
        if e.get("site_status") != "ok":
            sem_plano.append((nome, "site inacessível"))
        elif not e.get("plano"):
            fp = e.get("falso_positivo")
            if fp:
                sem_plano.append((nome, f"site ok ({e.get('site_base')}), falso positivo: {fp['motivo']} ({fp['url']})"))
            else:
                sem_plano.append((nome, f"site ok ({e.get('site_base')}), plano não encontrado"))

    sem_plano.sort(key=lambda x: x[0])
    with open(NAO_ENCONTRADOS_FILE, "w", encoding="utf-8") as f:
        f.write(f"Municípios sem plano de contingência encontrado — {now_iso()}\n")
        f.write(f"Total: {len(sem_plano)} de {len(municipios)} município(s) verificado(s)\n\n")
        for nome, motivo in sem_plano:
            f.write(f"{nome};{motivo}\n")
    return sem_plano


def revalidar_existentes():
    """Reaplica a checagem de conteúdo (incluindo OCR) aos PDFs já baixados,
    sem acessar a rede. Reconsidera tanto os planos confirmados quanto os já
    descartados como falso positivo em changed_pdfs/falsos_positivos/ — útil
    depois de habilitar/ajustar o OCR, já que documentos digitalizados que
    antes não tinham texto extraível podem agora ser confirmados."""
    municipios = load_json(MUNICIPIOS_FILE, [])
    state = load_json(STATE_FILE, {})
    slug_by_nome = {m["nome"]: m["slug"] for m in municipios}
    FALSOS_POSITIVOS_DIR.mkdir(parents=True, exist_ok=True)

    revalidados = 0
    promovidos = 0
    descartados = 0

    for nome, entry in state.items():
        plano = entry.get("plano")
        fp = entry.get("falso_positivo")
        if not plano and not fp:
            continue

        slug = slug_by_nome.get(nome)
        pdf_path = CHANGED_PDFS_DIR / f"{slug}.pdf" if slug else None
        fp_path = FALSOS_POSITIVOS_DIR / f"{slug}.pdf" if slug else None

        if pdf_path and pdf_path.exists():
            caminho_atual = pdf_path
        elif fp_path and fp_path.exists():
            caminho_atual = fp_path
        else:
            print(f"[validar-existentes] {nome}: PDF não encontrado localmente — pulando, "
                  f"rode uma varredura completa para reobtê-lo.")
            continue

        with open(caminho_atual, "rb") as f:
            pdf_bytes = f.read()

        validacao = validar_conteudo_pdf(pdf_bytes)
        revalidados += 1
        sufixo_ocr = " (via OCR)" if validacao["ocr_usado"] else ""

        if validacao["termo_encontrado"]:
            if fp:
                promovidos += 1
                print(f"[validar-existentes] {nome}: RECUPERADO — termo confirmado{sufixo_ocr}")
                entry["plano"] = {
                    "url": fp.get("url"),
                    "sha256": hashlib.sha256(pdf_bytes).hexdigest(),
                    "content_length": len(pdf_bytes),
                    "last_modified_header": None,
                    "etag": None,
                    "termo_confirmado": True,
                    "validado_via_ocr": validacao["ocr_usado"],
                    "first_seen": now_iso(),
                    "last_changed": now_iso(),
                }
                entry.pop("falso_positivo", None)
                if caminho_atual != pdf_path:
                    caminho_atual.rename(pdf_path)
            else:
                print(f"[validar-existentes] {nome}: OK — termo confirmado{sufixo_ocr}")
                plano["termo_confirmado"] = True
                plano["validado_via_ocr"] = validacao["ocr_usado"]
            continue

        motivo = motivo_falso_positivo(validacao)
        if plano:
            descartados += 1
            print(f"[validar-existentes] {nome}: FALSO POSITIVO — {motivo}")
            entry["plano"] = None
            entry["falso_positivo"] = {
                "url": plano.get("url"),
                "motivo": motivo,
                "chars_extraidos": validacao["chars_extraidos"],
                "ocr_tentado": validacao["ocr_usado"],
                "detectado_em": now_iso(),
            }
            if caminho_atual != fp_path:
                caminho_atual.rename(fp_path)
        else:
            print(f"[validar-existentes] {nome}: continua falso positivo{sufixo_ocr} — {motivo}")
            entry["falso_positivo"].update({
                "motivo": motivo,
                "chars_extraidos": validacao["chars_extraidos"],
                "ocr_tentado": validacao["ocr_usado"],
            })

    save_json(STATE_FILE, state)
    sem_plano = escrever_relatorio_sem_plano(municipios, state)

    print(f"\n=== RESUMO (validar-existentes) ===")
    print(f"PDFs revalidados: {revalidados}")
    print(f"Recuperados (falso positivo -> confirmado via OCR): {promovidos}")
    print(f"Descartados agora como falso positivo: {descartados}")
    print(f"Total sem plano após revalidação: {len(sem_plano)}")
    print(f"Relatório atualizado em: {NAO_ENCONTRADOS_FILE}")
    print(f"PDFs válidos em: {CHANGED_PDFS_DIR} | descartados em: {FALSOS_POSITIVOS_DIR}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None, help="Processa só os N primeiros municípios (teste)")
    parser.add_argument("--municipio", type=str, default=None, help="Processa só um município específico")
    parser.add_argument("--dry-run", action="store_true", help="Não envia e-mail, só imprime o relatório")
    parser.add_argument("--validar-existentes", action="store_true",
                         help="Reavalia o conteúdo dos PDFs já baixados em changed_pdfs/ (sem acessar a rede) "
                              "e sai, sem rodar a varredura normal")
    args = parser.parse_args()

    if args.validar_existentes:
        revalidar_existentes()
        return

    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    municipios = load_json(MUNICIPIOS_FILE, [])
    overrides = load_json(OVERRIDES_FILE, {})
    state = load_json(STATE_FILE, {})

    if args.municipio:
        municipios = [m for m in municipios if m["nome"] == args.municipio]
        if not municipios:
            print(f"Município '{args.municipio}' não encontrado em {MUNICIPIOS_FILE}", file=sys.stderr)
            sys.exit(1)
    elif args.limit:
        municipios = municipios[: args.limit]

    print(f"=== Monitor de Planos de Contingência RS — {len(municipios)} município(s) ===")

    changes = []
    unreachable = 0
    falsos_positivos = 0
    new_state = dict(state)
    CHANGED_PDFS_DIR.mkdir(exist_ok=True)
    FALSOS_POSITIVOS_DIR.mkdir(exist_ok=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(process_municipio, m, overrides, state): m for m in municipios
        }
        done = 0
        for future in concurrent.futures.as_completed(futures):
            m = futures[future]
            done += 1
            try:
                r = future.result()
            except Exception as e:
                print(f"[{done}/{len(municipios)}] {m['nome']}: ERRO INESPERADO — {e}")
                continue

            if r.site_status == "skipped":
                continue

            if r.site_status != "ok":
                unreachable += 1
                print(f"[{done}/{len(municipios)}] {r.nome}: site inacessível")
            elif r.plano_status == "not_found":
                print(f"[{done}/{len(municipios)}] {r.nome}: site ok, plano não encontrado")
            elif r.plano_status == "false_positive":
                falsos_positivos += 1
                print(f"[{done}/{len(municipios)}] {r.nome}: FALSO POSITIVO — {r.error} ({r.plano_url})")
                if r.pdf_bytes:
                    with open(FALSOS_POSITIVOS_DIR / f"{m['slug']}.pdf", "wb") as f:
                        f.write(r.pdf_bytes)
            elif r.plano_status == "unchanged":
                print(f"[{done}/{len(municipios)}] {r.nome}: plano sem alterações")
            else:
                print(f"[{done}/{len(municipios)}] {r.nome}: plano {r.plano_status.upper()} -> {r.plano_url}")
                changes.append({
                    "nome": r.nome,
                    "status": r.plano_status,
                    "plano_url": r.plano_url,
                    "site_base": r.site_base,
                })
                if r.pdf_bytes:
                    safe_name = m["slug"]
                    with open(CHANGED_PDFS_DIR / f"{safe_name}.pdf", "wb") as f:
                        f.write(r.pdf_bytes)

            new_state[r.nome] = build_new_state_entry(state.get(r.nome), r)

    save_json(STATE_FILE, new_state)
    sem_plano = escrever_relatorio_sem_plano(municipios, new_state)

    print("\n=== RESUMO ===")
    print(f"Municípios verificados: {len(municipios)}")
    print(f"Sites inacessíveis: {unreachable}")
    print(f"Falsos positivos descartados (termo ausente no PDF): {falsos_positivos}")
    print(f"Sem plano encontrado (total): {len(sem_plano)}")
    print(f"Atualizações detectadas (termo confirmado): {len(changes)}")
    for c in changes:
        print(f"  - {c['nome']} ({c['status']}): {c['plano_url']}")
    print(f"\nRelatório de municípios sem plano salvo em: {NAO_ENCONTRADOS_FILE}")
    print(f"PDFs válidos salvos em: {CHANGED_PDFS_DIR}")
    print(f"PDFs descartados (falso positivo) salvos em: {FALSOS_POSITIVOS_DIR}")

    if changes and not args.dry_run:
        send_email_digest(changes, unreachable, len(municipios))
    elif changes and args.dry_run:
        print("[dry-run] E-mail não enviado (modo dry-run).")


if __name__ == "__main__":
    main()
