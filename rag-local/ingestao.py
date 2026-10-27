"""Ingestão dos PLANCONs do Garage para o índice do RAG do LAD/PUCRS (um arquivo por município).

Etapas (cada uma pula o que já está feito):
  texto   baixa cada documento do bucket `plancon` e extrai o texto para <cache>/texto/<chave>.txt
          (PDF por página com OCR em português nas páginas sem texto; DOCX com tabelas).
          Arquivos .doc não têm extrator no cluster: o texto vem pré-extraído (textutil, macOS).
  indice  divide o texto em trechos, gera embeddings no llama-server e grava
          <cache>/indice/<Município>.json  {fontes, dim, trechos[], vetores(base64 float32)}

Uso:
  python ingestao.py texto  --cache DIR [--cidades A,B] [--procs 8]
  python ingestao.py indice --cache DIR --emb-url http://127.0.0.1:8091 [--cidades A,B]
"""
import argparse, base64, hashlib, json, os, re, sys, time, unicodedata
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
import s3sync  # noqa: E402

TESSDATA = Path.home() / "observatorio-rag" / "tessdata"
OCR_MIN_CHARS = 80          # página com menos texto que isso é tratada como digitalizada...
OCR_MAX_CHARS_IMAGEM = 600  # ...ou, se uma imagem cobre a maior parte dela, com até isto de texto
OCR_COBERTURA = 0.5         # (PDFs "escaneados" com cabeçalho/rodapé em texto, ex.: Canoas)
TRECHO_CHARS = 1400         # ~400 tokens
SOBREPOSICAO = 200
LOTE_EMB = 16
INDICE_VERSAO = 2           # mudar força reindexação (v2: deduplicação de documentos e trechos)


def carregar_municipios(cidades=None):
    mapa = json.load(open(AQUI / "municipios.json"))
    if cidades:
        faltando = set(cidades) - set(mapa)
        if faltando:
            sys.exit(f"Municípios sem documento no mapa: {sorted(faltando)}")
        mapa = {c: mapa[c] for c in cidades}
    return mapa


def caminho_texto(cache, key):
    # NFC no cache: as chaves do bucket misturam NFC e NFD (nomes vindos do macOS)
    return Path(cache) / "texto" / f"{unicodedata.normalize('NFC', key)}.txt"


# ---------------------------------------------------------------------------
# Etapa 1: extração de texto
# ---------------------------------------------------------------------------
def cobertura_imagens(pagina):
    import pymupdf

    area = abs(pagina.rect) or 1
    return sum(abs(pymupdf.Rect(i["bbox"]) & pagina.rect) for i in pagina.get_image_info()) / area


PALAVRAS_COMUNS = set("de da do das dos que para com em no na os as um uma por se ao ou município plano defesa civil".split())


def qualidade(texto):
    """Fração de palavras muito comuns do português: ~0,2 em texto real, <0,05 em OCR ilegível (letras soltas não contam: o OCR de ruído produz muitas)."""
    palavras = re.findall(r"[a-záéíóúâêôãõç]+", texto.lower())
    return sum(p in PALAVRAS_COMUNS for p in palavras) / max(1, len(palavras))


TEXTO_ILEGIVEL = 0.08  # abaixo disso o texto é lixo (camada de OCR ruim embutida no PDF, página girada)


def precisa_ocr(pagina, texto):
    if len(texto) < OCR_MIN_CHARS:
        return bool(pagina.get_images())
    if qualidade(texto) < TEXTO_ILEGIVEL and pagina.get_images():
        return True  # PDF escaneado com camada de texto ilegível (ex.: Riozinho, Humaitá)
    return len(texto) < OCR_MAX_CHARS_IMAGEM and cobertura_imagens(pagina) > OCR_COBERTURA


def ocr_pagina(pagina):
    """OCR em português; se sair ilegível, tenta a página girada (escaneamentos de lado/invertidos)."""
    melhor, rot0 = "", pagina.rotation
    for giro in (0, 90, 270, 180):
        pagina.set_rotation((rot0 + giro) % 360)
        tp = pagina.get_textpage_ocr(language="por", dpi=300, full=True, tessdata=str(TESSDATA))
        texto = pagina.get_text(textpage=tp).strip()
        if qualidade(texto) > qualidade(melhor):
            melhor = texto
        if qualidade(melhor) >= TEXTO_ILEGIVEL:
            break
    pagina.set_rotation(rot0)
    return melhor


def extrair_pdf(dados):
    import pymupdf

    paginas, ocr = [], 0
    with pymupdf.open(stream=dados, filetype="pdf") as doc:
        for i, pagina in enumerate(doc, 1):
            texto = pagina.get_text().strip()
            if precisa_ocr(pagina, texto):
                texto = ocr_pagina(pagina)
                ocr += 1
            if texto:
                paginas.append(f"[página {i}]\n{texto}")
    return "\n\n".join(paginas), ocr


def extrair_docx(dados):
    import io
    import docx

    d = docx.Document(io.BytesIO(dados))
    partes = [p.text for p in d.paragraphs if p.text.strip()]
    for t in d.tables:
        for linha in t.rows:
            celulas = [c.text.strip() for c in linha.cells]
            partes.append(" | ".join(dict.fromkeys(c for c in celulas if c)))
    return "\n".join(partes), 0


def extrair_um(cache, key):
    destino = caminho_texto(cache, key)
    if destino.exists():
        anterior = destino.read_text()
        if len(anterior) < 2000 or qualidade(anterior) >= TEXTO_ILEGIVEL:
            return key, "cache", 0
        # texto em cache ilegível: extrai de novo (o índice se refaz sozinho, pelo hash do texto)
    ext = key.rsplit(".", 1)[-1].lower()
    if ext not in ("pdf", "docx"):
        return key, f"sem extrator para .{ext} (precisa de texto pré-extraído)", 0
    t0 = time.time()
    obj = s3sync.client().get_object(Bucket="plancon", Key=key)["Body"].read()
    texto, ocr = (extrair_pdf if ext == "pdf" else extrair_docx)(obj)
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(texto)
    return key, f"{len(texto)} chars, {ocr} pág. OCR, {time.time() - t0:.0f}s", ocr


def etapa_texto(args):
    os.environ["TESSDATA_PREFIX"] = str(TESSDATA)
    chaves = sorted({k for ks in carregar_municipios(args.cidades).values() for k in ks})
    print(f"[texto] {len(chaves)} documento(s), {args.procs} processo(s)", flush=True)
    problemas = 0
    with ProcessPoolExecutor(args.procs) as ex:
        futuros = {ex.submit(extrair_um, args.cache, k): k for k in chaves}
        for n, f in enumerate(as_completed(futuros), 1):
            try:
                key, status, _ = f.result()
            except Exception as e:  # um documento ruim não derruba a ingestão
                key, status = futuros[f], f"ERRO {e}"
            if status.startswith(("ERRO", "sem extrator")):
                problemas += 1
            if status != "cache":
                print(f"[texto] {n}/{len(chaves)} {key}: {status}", flush=True)
    print(f"[texto] concluído; {problemas} documento(s) com problema", flush=True)


# ---------------------------------------------------------------------------
# Etapa 2: trechos + embeddings
# ---------------------------------------------------------------------------
def dividir(texto):
    """Trechos de ~TRECHO_CHARS respeitando parágrafos, com a página de origem."""
    trechos, atual, pagina, pag_atual = [], "", None, None
    for bloco in re.split(r"\n\s*\n", texto):
        m = re.match(r"\[página (\d+)\]\n?", bloco)
        if m:
            pagina = int(m.group(1))
            bloco = bloco[m.end():]
        bloco = re.sub(r"[ \t]+", " ", bloco).strip()
        if not bloco:
            continue
        if atual and len(atual) + len(bloco) > TRECHO_CHARS:
            trechos.append((atual, pag_atual))
            atual = atual[-SOBREPOSICAO:]
        if not atual:
            pag_atual = pagina
        atual = f"{atual}\n{bloco}" if atual else bloco
        while len(atual) > TRECHO_CHARS * 1.5:  # parágrafo gigante (tabelas, OCR sem quebras)
            trechos.append((atual[:TRECHO_CHARS], pag_atual))
            atual = atual[TRECHO_CHARS - SOBREPOSICAO:]
    if atual.strip():
        trechos.append((atual, pag_atual))
    return trechos


def embeddings(url, textos):
    import urllib.request

    req = urllib.request.Request(
        f"{url}/v1/embeddings",
        data=json.dumps({"input": textos}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        dados = sorted(json.load(r)["data"], key=lambda d: d["index"])
    v = np.array([d["embedding"] for d in dados], dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def etapa_indice(args):
    mapa = carregar_municipios(args.cidades)
    pasta = Path(args.cache) / "indice"
    pasta.mkdir(parents=True, exist_ok=True)
    feitos = 0
    for municipio, chaves in mapa.items():
        textos = {k: caminho_texto(args.cache, k) for k in chaves}
        textos = {k: p.read_text() for k, p in textos.items() if p.exists()}
        fontes = {k: hashlib.sha1(t.encode()).hexdigest() for k, t in textos.items()}
        arq = pasta / f"{municipio}.json"
        if arq.exists():
            atual = json.load(open(arq))
            if atual.get("fontes") == fontes and atual.get("versao") == INDICE_VERSAO:
                continue
        # Há municípios com o mesmo plano em .doc/.pdf ou em cópias "1": trechos repetidos
        # tomariam as vagas do top-k. Remove documentos idênticos e trechos repetidos.
        trechos, vistos = [], set()
        for k in sorted(textos, key=lambda k: (k.lower().endswith(".doc"), k)):  # prefere PDF/DOCX (têm página)
            for t, pag in dividir(textos[k]):
                h = hashlib.sha1(re.sub(r"\W+", "", t.lower()).encode()).hexdigest()
                if h not in vistos:
                    vistos.add(h)
                    trechos.append({"arquivo": k, "pagina": pag, "texto": t})
        if not trechos:
            print(f"[indice] {municipio}: sem texto — pulando", flush=True)
            continue
        vetores = np.concatenate([
            embeddings(args.emb_url, [t["texto"] for t in trechos[i:i + LOTE_EMB]])
            for i in range(0, len(trechos), LOTE_EMB)
        ])
        arq.write_text(json.dumps({
            "municipio": municipio,
            "versao": INDICE_VERSAO,
            "fontes": fontes,
            "dim": int(vetores.shape[1]),
            "trechos": trechos,
            "vetores": base64.b64encode(vetores.tobytes()).decode(),
        }, ensure_ascii=False))
        feitos += 1
        print(f"[indice] {municipio}: {len(trechos)} trechos de {len(textos)} doc(s)", flush=True)
    print(f"[indice] concluído; {feitos} município(s) (re)indexado(s)", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("etapa", choices=["texto", "indice"])
    ap.add_argument("--cache", required=True)
    ap.add_argument("--cidades", type=lambda s: [unicodedata.normalize("NFC", c.strip()) for c in s.split(",") if c.strip()])
    ap.add_argument("--procs", type=int, default=8)
    ap.add_argument("--emb-url", default="http://127.0.0.1:8091")
    args = ap.parse_args()
    (etapa_texto if args.etapa == "texto" else etapa_indice)(args)


if __name__ == "__main__":
    main()
