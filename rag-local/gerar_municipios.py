"""Gera rag-local/municipios.json: município -> chaves no bucket Garage `plancon`.

Uso: python3 gerar_municipios.py <lista-de-chaves.txt> <geojson-municipios-RS>

- Nomes: os 264 municípios já publicados mantêm a grafia de backend/src/municipios.ts
  (a mesma dos CSVs do painel); os demais usam o nome do IBGE (geojson do mapa).
- Casamento pelo nome do arquivo (sem acentos/pontuação, nome mais longo primeiro);
  arquivos com grafia errada ou sem o município no nome vão em CORRECOES.
- Arquivos .url (links mortos da Casa Militar) não entram: não há conteúdo.
- Planos do site da prefeitura (prefixo site-municipal/) não entram pelo nome do arquivo: vêm do
  registro fontes_site_municipal.json (site_municipal.py), que substitui os do Prepara RS.
"""
import json, re, sys, unicodedata

import site_municipal
from pathlib import Path

AQUI = Path(__file__).resolve().parent
MUNICIPIOS_TS = AQUI.parent / "backend" / "src" / "municipios.ts"

# chave no bucket -> município (conferido manualmente)
CORRECOES = {
    "CREPDEC 01/PLANCON - Morro Reiter.pdf": "Morro Reuter",
    "CREPDEC 01/PLANCON - TÊS COROAS.docx": "Três Coroas",
    "CREPDEC 01/PLANCON_LINDOLFOCOLOR_2023.pdf": "Lindolfo Collor",
    "CREPDEC 03/Plano de Contingência Municipal 2025_Iburubá.pdf": "Ibirubá",
    "CREPDEC 03/Plano de Contingência Municipal 2025_SãoPedro.pdf": "São Pedro do Sul",
    "CREPDEC 03/Plano de Contingência Municipal 2025_SãoPedro1.pdf": "São Pedro do Sul",
    "CREPDEC 04/PLANO DE CONTINGÊNCIA Jguarão 2025 ATUALIZADO.docx": "Jaguarão",
    "CREPDEC 04/Plano de Contingência - SJN (outubro).pdf": "São José do Norte",
    "CREPDEC 05/Boa Vista Buricá.pdf": "Boa Vista do Buricá",
    "CREPDEC 05/Santo Augsto1.pdf": "Santo Augusto",
    "CREPDEC 05/Sçao Valério do Sul.pdf": "São Valério do Sul",
    "CREPDEC 07/Plancom_PinhalzinhodoVale.pdf": "Pinheirinho do Vale",
    "CREPDEC 08/22 Plancon Vernancio Aires .pdf": "Venâncio Aires",
    "CREPDEC 08/CRUZEIRO - PLANCON v09.2025 R (2).pdf": "Cruzeiro do Sul",
    "CREPDEC 09/17 - Plano de Contingência de MAC.pdf": "Monte Alegre dos Campos",
    "CREPDEC 09/PLANO_DE_CONTINGENCIA_2025_DEFESA_CIVIL_OFICIAL_assinado_assinado.pdf": "Vacaria",
    "CREPDEC 09/Plano de Contingência São Valentin do Sul.pdf": "São Valentim do Sul",
    "CREPDEC 09/plano de contingência 2025 Pinto Bandeira.pdf": "Pinto Bandeira",
}
IGNORAR_PREFIXOS = ("teste/", ".DS_Store", "site-municipal/")


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def main(chaves_txt, geojson):
    publicados = re.findall(r'^\s*"([^"]+)":\s*\[', MUNICIPIOS_TS.read_text(), re.M)
    ibge = [f["properties"]["name"] for f in json.load(open(geojson))["features"]]
    # grafia do painel tem precedência sobre a do IBGE quando normalizam igual
    nomes = {norm(n): n for n in ibge}
    nomes.update({norm(n): n for n in publicados})
    nomes[norm("Pinto Bandeira")] = "Pinto Bandeira"  # emancipado em 2013, fora do geojson
    candidatos = sorted(nomes, key=len, reverse=True)

    mapa, sem_municipio = {}, []
    # A chave guardada é a EXATA do bucket (parte vem em NFD, de nomes de arquivo do macOS);
    # a forma NFC só é usada para comparar.
    for key in sorted(k.strip("\n") for k in open(chaves_txt) if k.strip()):
        nfc = unicodedata.normalize("NFC", key)
        if nfc.startswith(IGNORAR_PREFIXOS) or nfc.lower().endswith((".url", ".ds_store")):
            continue
        muni = CORRECOES.get(nfc)
        if muni is None:
            arquivo = norm(nfc.split("/", 1)[1].rsplit(".", 1)[0])
            hit = next((c for c in candidatos if c in arquivo), None)
            muni = nomes[hit] if hit else None
        if muni is None:
            sem_municipio.append(key)
            continue
        mapa.setdefault(muni, []).append(key)

    site_municipal.aplicar_mapa(mapa)

    saida = AQUI / "municipios.json"
    saida.write_text(json.dumps(dict(sorted(mapa.items())), ensure_ascii=False, indent=1) + "\n")
    novos = sorted(set(mapa) - set(publicados))
    print(f"{len(mapa)} municípios com documento ({len(novos)} fora do painel) -> {saida}")
    print(f"publicados sem documento no bucket: {sorted(set(publicados) - set(mapa))}")
    print(f"arquivos sem município identificado: {sem_municipio}")


if __name__ == "__main__":
    main(*sys.argv[1:])
