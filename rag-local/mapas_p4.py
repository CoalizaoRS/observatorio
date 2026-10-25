"""P4 (rotas de evacuação): lê com o Gemma 3 (visão) as páginas de mapa dos PLANCONs.

Nos planos do modelo SEGIRD a seção "Rota de fuga" de cada cenário é só uma imagem (mapa),
que o OCR não lê; o texto do índice fica só com o título. Este script renderiza essas páginas
e pergunta ao llama-server (Gemma 3 + mmproj) se há um TRAJETO de evacuação específico.

Uso (dentro do job, com o llama-server multimodal na porta 8090):
  python mapas_p4.py --alvos listas/p4_mapas.json --saida <dir> --chat-url http://127.0.0.1:8090
O arquivo de alvos lista {municipio, arquivo (chave no bucket plancon), paginas[]}.
Grava <dir>/<Município>.json com a resposta por página e o veredito do município.
"""
import argparse, base64, json, subprocess, sys, tempfile, unicodedata, urllib.request
from pathlib import Path

import pymupdf

PROMPT = (
    "Esta é uma página do Plano de Contingência de Proteção e Defesa Civil do município de {m} (RS).\n"
    "Pergunta: a página mostra uma ROTA DE EVACUAÇÃO/FUGA ESPECÍFICA — um TRAJETO desenhado no mapa (linha, seta) "
    "ligando a área de risco a um ponto de encontro/local seguro, OU ruas/vias nomeadas descritas como rota?\n"
    "NÃO contam: mapa só com a área de risco (polígono/mancha) sem trajeto; localização do município; fotos de eventos; "
    "tabelas; o título \"Rota de fuga\" sem mapa ou com mapa sem trajeto.\n"
    'Responda SOMENTE em JSON: {{"tipo_pagina": "mapa_com_rota|mapa_sem_rota|foto|texto_tabela|outro", '
    '"rota_especifica": "sim|nao", "descricao": "o que a página mostra, em uma frase", '
    '"ruas_ou_pontos": "ruas, vias e pontos de encontro legíveis no mapa (ou N/A)"}}'
)


def pergunta(chat_url, municipio, png):
    corpo = {
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}},
            {"type": "text", "text": PROMPT.format(m=municipio)},
        ]}],
        "temperature": 0.1, "max_tokens": 400, "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(chat_url + "/v1/chat/completions", json.dumps(corpo).encode(),
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        txt = json.load(r)["choices"][0]["message"]["content"]
    try:
        return json.loads(txt[txt.index("{"): txt.rindex("}") + 1])
    except ValueError:
        return {"erro": "JSON não parseável", "bruto": txt[:300]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--alvos", required=True)
    ap.add_argument("--saida", required=True)
    ap.add_argument("--chat-url", default="http://127.0.0.1:8090")
    ap.add_argument("--dpi", type=int, default=110)
    a = ap.parse_args()
    saida = Path(a.saida); saida.mkdir(parents=True, exist_ok=True)
    sync = [sys.executable, str(Path(__file__).with_name("s3sync.py"))]

    for alvo in json.load(open(a.alvos)):
        m = alvo["municipio"]
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "plano.pdf"
            subprocess.run(sync + ["get", "plancon", alvo["arquivo"], str(pdf)], check=True, stdout=subprocess.DEVNULL)
            doc = pymupdf.open(pdf)
            paginas = []
            for n in alvo["paginas"]:
                if not 1 <= n <= doc.page_count:
                    continue
                png = doc[n - 1].get_pixmap(dpi=a.dpi).tobytes("png")
                r = pergunta(a.chat_url, m, png)
                r["pagina"] = n
                paginas.append(r)
                print(f"  {m} p.{n}: {r.get('tipo_pagina')} rota={r.get('rota_especifica')} | {str(r.get('descricao'))[:90]}", flush=True)
        rotas = [p for p in paginas if str(p.get("rota_especifica")).lower() == "sim"]
        res = {"municipio": m, "arquivo": alvo["arquivo"], "rota_em_mapa": "sim" if rotas else "nao",
               "paginas_com_rota": [p["pagina"] for p in rotas], "paginas": paginas}
        nome = unicodedata.normalize("NFC", m)
        (saida / f"{nome}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
        print(f"✓ {m}: rota em mapa = {res['rota_em_mapa']} {res['paginas_com_rota']}", flush=True)


if __name__ == "__main__":
    main()
