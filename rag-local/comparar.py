"""Compara indicadores do RAG do LAD/PUCRS com os do Azure (grupo de controle).

Uso: python3 comparar.py <dir-azure> <dir-local> <lista.txt>
  <dir-azure>/<Município>.json e <dir-local>/<Município>.json no formato de extrair.ts.

Mostra, por indicador, a concordância do valor (semáforo ou número) e lista as
divergências com as evidências citadas por cada lado, para revisão manual.
"""
import json, sys
from pathlib import Path


def carrega(d, m):
    p = Path(d) / f"{m}.json"
    return json.load(open(p))["indicadores"] if p.exists() else None


def main(dir_azure, dir_local, lista):
    cidades = [l.strip() for l in open(lista) if l.strip()]
    por_ind, divergencias = {}, []
    for m in cidades:
        az, lo = carrega(dir_azure, m), carrega(dir_local, m)
        if not az or not lo:
            print(f"! {m}: falta resultado ({'azure' if not az else 'local'})")
            continue
        for ind in sorted(set(az) & set(lo)):
            va, vl = az[ind].get("valor"), lo[ind].get("valor")
            igual = str(va).strip().lower() == str(vl).strip().lower()
            ok, tot = por_ind.get(ind, (0, 0))
            por_ind[ind] = (ok + igual, tot + 1)
            if not igual:
                divergencias.append((m, ind, va, vl, az[ind].get("evidencia", ""), lo[ind].get("evidencia", "")))

    print("\nConcordância por indicador (azure × local)")
    total_ok = total = 0
    for ind, (ok, tot) in sorted(por_ind.items()):
        print(f"  {ind}: {ok}/{tot}")
        total_ok += ok; total += tot
    if total:
        print(f"  TOTAL: {total_ok}/{total} ({100 * total_ok / total:.0f}%)")

    print("\nDivergências")
    for m, ind, va, vl, ea, el in divergencias:
        print(f"\n- {m} · {ind}: azure={va!r} local={vl!r}")
        print(f"    azure: {str(ea)[:220]}")
        print(f"    local: {str(el)[:220]}")


if __name__ == "__main__":
    main(*sys.argv[1:])
