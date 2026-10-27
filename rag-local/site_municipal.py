"""Planos publicados nos sites das prefeituras (fonte "Site Municipal"), vindos do monitor.

O registro rag-local/fontes_site_municipal.json guarda, por município, o plano encontrado pelo
monitor (monitor/state.json) e a triagem feita sobre ele:
  situacao  atualizacao   versão mais nova que a do Prepara RS → SUBSTITUI os documentos do
                          município em municipios.json (chave no bucket `plancon`: site-municipal/…)
            mesma_versao  mesmo plano já recebido via Prepara RS → nada muda
            descartado    não é o PLANCON (falso positivo do monitor)
Os indicadores levam a fonte adiante: fonte_documentos com prefixo site-municipal/ ⇒ "Site Municipal"
(consolidar.ts gera as colunas fonte_plano e url_plano).

Uso:
  python site_municipal.py pendentes [--state ../monitor/state.json] [--baixar DIR]
        planos do monitor ainda sem triagem (novos ou com hash diferente do registrado)
  python site_municipal.py aplicar
        reescreve municipios.json: municípios com situacao=atualizacao passam a usar a chave do site
"""
import argparse, hashlib, json, sys, urllib.parse, urllib.request, ssl
from pathlib import Path

AQUI = Path(__file__).resolve().parent
REGISTRO = AQUI / "fontes_site_municipal.json"
PREFIXO = "site-municipal/"


def carregar():
    return json.loads(REGISTRO.read_text()) if REGISTRO.exists() else {}


def aplicar_mapa(mapa):
    """Sobrepõe as atualizações do site ao mapa município -> chaves (usado também por gerar_municipios)."""
    for muni, e in carregar().items():
        if e["situacao"] == "atualizacao":
            mapa[muni] = [e["chave"]]
    return mapa


def pendentes(args):
    estado = json.loads(Path(args.state).read_text())
    reg = carregar()
    achados = [(m, v["plano"]) for m, v in sorted(estado.items()) if v.get("plano")]
    novos = [(m, p) for m, p in achados if reg.get(m, {}).get("sha256") != p["sha256"]]
    print(f"{len(achados)} plano(s) no monitor, {len(novos)} sem triagem")
    for m, p in novos:
        print(f"  {m}: {p['url']} (detectado {p['first_seen'][:10]}, alterado {p['last_changed'][:10]})")
        if args.baixar:
            destino = Path(args.baixar) / f"{m}.pdf"
            destino.parent.mkdir(parents=True, exist_ok=True)
            url = urllib.parse.quote(p["url"], safe=":/?=&%")
            ctx = ssl._create_unverified_context()  # mesmo critério do monitor (certificados vencidos)
            with urllib.request.urlopen(url, context=ctx, timeout=300) as r:
                dados = r.read()
            ok = hashlib.sha256(dados).hexdigest() == p["sha256"]
            destino.write_bytes(dados)
            print(f"    -> {destino} ({len(dados)} bytes{'' if ok else ', HASH DIFERENTE do monitor'})")


def aplicar(_args):
    caminho = AQUI / "municipios.json"
    mapa = aplicar_mapa(json.loads(caminho.read_text()))
    caminho.write_text(json.dumps(dict(sorted(mapa.items())), ensure_ascii=False, indent=1) + "\n")
    atual = [m for m, e in carregar().items() if e["situacao"] == "atualizacao"]
    print(f"{len(atual)} município(s) com plano do site municipal em {caminho.name}: {', '.join(atual)}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pendentes")
    p.add_argument("--state", default=str(AQUI.parent / "monitor" / "state.json"))
    p.add_argument("--baixar")
    sub.add_parser("aplicar")
    args = ap.parse_args()
    {"pendentes": pendentes, "aplicar": aplicar}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
