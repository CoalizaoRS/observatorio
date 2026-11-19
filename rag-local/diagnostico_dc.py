"""P11 (Estrutura da Defesa Civil): lê o "Diagnóstico do Município" da Defesa Civil estadual.

Os diagnósticos chegam como PDF com capturas de tela do sistema, uma ou mais por página.
Cada captura é enviada ao llama-server (Gemma 3 + mmproj), que transcreve a aba e os campos.
Em paralelo, o OCR (Tesseract) lê o campo "Número de agentes na COMPDEC" pela posição na
tela; as duas leituras são comparadas e a divergência vai para a lista de ação.

Dados pessoais (nomes, telefones, e-mails, endereço residencial e coordenadas do coordenador)
são descartados antes de gravar.

Uso (dentro do job, com o llama-server multimodal na porta 8090):
  python diagnostico_dc.py --entrada <dir com PDFs> --saida <dir> [--chat-url http://127.0.0.1:8090]
Grava <dir>/<arquivo>.json.
"""
import argparse, base64, json, re, unicodedata, urllib.request
from pathlib import Path

import pymupdf

TESSDATA = Path.home() / "observatorio-rag" / "tessdata"

PROMPT = (
    "Esta imagem é uma captura de tela do formulário \"Diagnóstico do Município\" do sistema da "
    "Defesa Civil do Rio Grande do Sul. Transcreva TODOS os campos visíveis.\n"
    "Regras:\n"
    "- \"aba\": o nome da aba ativa (a aba destacada na fileira de abas, ou o título da seção).\n"
    "- \"municipio\": o nome do município no título \"Diagnóstico do Município - <nome>\", ou \"\" se não aparecer.\n"
    "- \"campos\": um item por campo, na ordem da tela, com o rótulo exatamente como escrito e o valor "
    "preenchido exatamente como aparece (números e datas copiados dígito a dígito). Campo vazio ou "
    "\"Selecione\" = \"\". Chave liga/desliga: \"sim\" se ligada (azul), \"não\" se desligada (cinza). "
    "Blocos repetidos (várias áreas de risco, abrigos, equipamentos) seguem na ordem, com \"bloco\": 1, 2, ...\n"
    "- NÃO transcreva nomes de pessoas, telefones, e-mails nem endereço residencial: nesses campos use "
    "o valor \"[omitido]\".\n"
    'Responda SOMENTE em JSON: {"aba": "...", "municipio": "...", "campos": '
    '[{"rotulo": "...", "valor": "...", "bloco": 0}]}'
)

# rótulos cujos valores são dados pessoais: descartados mesmo que o modelo os transcreva
PESSOAL = re.compile(
    r"nome|telefone|celular|e-?mail|m[oó]vel|endere[cç]o residencial|"
    r"(latitude|longitude) endere[cç]o coordenador", re.I)


def chat(chat_url, png):
    corpo = {
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}},
            {"type": "text", "text": PROMPT},
        ]}],
        "temperature": 0.0, "max_tokens": 3000, "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(chat_url + "/v1/chat/completions", json.dumps(corpo).encode(),
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        txt = json.load(r)["choices"][0]["message"]["content"]
    try:
        return json.loads(txt[txt.index("{"): txt.rindex("}") + 1])
    except ValueError:
        return {"erro": "JSON não parseável", "bruto_inicio": txt[:200]}


def sem_pessoais(r):
    for c in r.get("campos", []) or []:
        if PESSOAL.search(str(c.get("rotulo", ""))):
            c["valor"] = "[omitido]"
    return r


def palavras_ocr(png):
    """Palavras do OCR com caixa: [(x0, y0, x1, y1, texto)]."""
    img = pymupdf.open(stream=png, filetype="png")
    pdf = pymupdf.open("pdf", img.convert_to_pdf())
    pg = pdf[0]  # a página tem de seguir viva enquanto o textpage é usado
    tp = pg.get_textpage_ocr(language="por", dpi=300, full=True, tessdata=str(TESSDATA))
    return [(w[0], w[1], w[2], w[3], w[4]) for w in pg.get_text("words", textpage=tp)]


def agentes_ocr(palavras):
    """Número logo abaixo do rótulo "Número de agentes na COMPDEC" (mesma coluna)."""
    rot = [w for w in palavras if w[4].lower().startswith("agentes")]
    if not rot:
        return None
    x0, _, _, y1, _ = rot[0]
    # a coluna começa em "Número", à esquerda de "agentes"
    linha = [w for w in palavras if abs(w[3] - y1) < 3 and w[0] < x0]
    inicio = min([w[0] for w in linha if w[4].lower().startswith("n")] or [x0])
    cand = [w for w in palavras if re.fullmatch(r"\d{1,4}", w[4]) and y1 < w[1] < y1 + 40
            and inicio - 10 <= w[0] <= x0 + 200]
    cand.sort(key=lambda w: (w[1], w[0]))
    return int(cand[0][4]) if cand else None


def agentes_modelo(capturas):
    for c in capturas:
        for campo in c.get("campos", []) or []:
            if "agentes" in str(campo.get("rotulo", "")).lower():
                v = re.sub(r"\D", "", str(campo.get("valor", "")))
                return int(v) if v else None
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--entrada", required=True)
    ap.add_argument("--saida", required=True)
    ap.add_argument("--chat-url", default="http://127.0.0.1:8090")
    a = ap.parse_args()
    saida = Path(a.saida); saida.mkdir(parents=True, exist_ok=True)

    for pdf in sorted(Path(a.entrada).glob("*.pdf")):
        doc = pymupdf.open(pdf)
        capturas, ocr_agentes = [], []
        for n, pagina in enumerate(doc, 1):
            for img in pagina.get_images(full=True):
                png = pymupdf.Pixmap(doc, img[0]).tobytes("png")
                r = sem_pessoais(chat(a.chat_url, png))
                r["pagina"] = n
                capturas.append(r)
                ocr = agentes_ocr(palavras_ocr(png))
                if ocr is not None:
                    ocr_agentes.append(ocr)
                print(f"  {pdf.name} p.{n}: aba={r.get('aba')} campos={len(r.get('campos', []) or [])}"
                      f" ocr_agentes={ocr}", flush=True)
        mod = agentes_modelo(capturas)
        ocr = ocr_agentes[0] if ocr_agentes else None
        muni = next((c.get("municipio") for c in capturas if c.get("municipio")), "")
        res = {
            "arquivo": pdf.name,
            "municipio": unicodedata.normalize("NFC", muni or ""),
            "agentes_compdec": mod if mod == ocr else None,
            "agentes_leituras": {"modelo": mod, "ocr": ocr},
            "situacao": "ok" if mod is not None and mod == ocr else "lista_de_acao",
            "capturas": capturas,
        }
        (saida / (pdf.stem + ".json")).write_text(json.dumps(res, ensure_ascii=False, indent=1))
        print(f"✓ {pdf.name}: município={res['municipio']} agentes modelo={mod} ocr={ocr} → {res['situacao']}", flush=True)


if __name__ == "__main__":
    main()
