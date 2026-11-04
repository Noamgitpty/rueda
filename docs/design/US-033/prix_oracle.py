"""Montants du prototype US-033 recalculés par l'oracle de 08 (docs/specs/tools/check_legs.py).

Usage (depuis la racine du dépôt) : python -I -X utf8 docs/design/US-033/prix_oracle.py
Code retour 1 si un montant de apps/web/app/proto/data/scenario.json diffère de l'oracle.

Règles appliquées (08) :
- la protection Básica est obligatoire et payante (BR-PROT-02 [NOUS] : « Básica obligatoire », BR-PRICE-11 [NOUS] :
  prix = % x prix journalier net, vendu pour l'assureur partenaire, jambe INSURER d'E7) ; aucun plan « inclus » ;
- marché en USD : trip de référence A de 08 sans Extras, assistance, conducteur additionnel ni livraison
  (P 120,00, F 18,00, protection 30,00 = 25 % de P, taxe de test 7 % sur P et F par ligne = 9,66) ;
- marché en PYG : trip de référence D de 08 sans livraison (P 1 000 000, F 125 500, protection 150 000,
  taxe de test 10 % sur P et F = 112 550) ;
- plans Estándar et Total : 40 % et 65 % de P (rapports de BR-PRICE-11, Standard et Premier) ;
- franchises USD : 3 000 / 500 / 0 (BR-PROT-02 : Minimum, Standard, Premier) ; en PYG : valeurs fictives en
  attendant la grille de l'assureur (OQ-P2P-12) ;
- autres voitures : mêmes rapports que le trip de référence de leur marché, calculés par `trip()` de l'oracle.
Le total et la taxe viennent de `trip()` de check_legs.py (taxe = somme des taxes de ligne arrondies, roundHalfUp).
"""
import contextlib
import io
import json
import sys
from fractions import Fraction as Fr
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ORACLE = ROOT / "docs" / "specs" / "tools" / "check_legs.py"
SCENARIO = ROOT / "apps" / "web" / "app" / "proto" / "data" / "scenario.json"

ns = {"__file__": str(ORACLE), "__name__": "check_legs_import"}
with contextlib.redirect_stdout(io.TextIOWrapper(io.BytesIO(), encoding="utf-8")):
    try:
        exec(compile(ORACLE.read_text(encoding="utf-8"), str(ORACLE), "exec"), ns)
    except SystemExit:
        pass
trip, g1, rhu = ns["trip"], ns["g1"], ns["rhu"]

# Configuration de test de 08 par marché (trips de référence A et D) : taux, rapport F / P, rapport Básica / P.
CONFIG = {
    "istmo": {"cur": "USD", "tax": "0.07", "fee": Fr(3, 20), "basic": Fr(1, 4)},
    "guarani": {"cur": "PYG", "tax": "0.10", "fee": Fr(251, 2000), "basic": Fr(3, 20)},
}
PLAN_SHARE = {"ESTANDAR": Fr(2, 5), "TOTAL": Fr(13, 20)}


def priced(market_id, rent, protection=None):
    c = CONFIG[market_id]
    fee = rhu(Fr(rent) * c["fee"])
    pr = rhu(Fr(rent) * c["basic"]) if protection is None else protection
    t = trip("proto", c["cur"], 3, {"g": g1(c["tax"], ["P", "PP", "PH", "F"])}, P=rent, F=fee, Pr=pr)
    return {"rent": rent, "fee": fee, "protection": pr, "tax": sum(t["taxPaid"].values()), "total": t["total"]}


errors = []
data = json.loads(SCENARIO.read_text(encoding="utf-8"))
for m in data["markets"]:
    f = m["featured"]
    rent = int(f["lines"]["rentMinor"])
    days = m["days"]
    base = priced(m["id"], rent)
    expect = {("lines", "tripFeeMinor"): base["fee"]}
    for plan in f["plans"]:
        pr = base["protection"] if plan["id"] == "BASICA" else rhu(Fr(rent) * PLAN_SHARE[plan["id"]])
        p = priced(m["id"], rent, pr)
        expect[(plan["id"], "priceMinor")] = p["protection"]
        expect[(plan["id"], "taxMinor")] = p["tax"]
        expect[(plan["id"], "totalMinor")] = p["total"]
    ch = priced(m["id"], int(f["changed"]["rentMinor"]))
    got = {("lines", "tripFeeMinor"): int(f["lines"]["tripFeeMinor"])}
    for k, v in (("tripFeeMinor", "fee"), ("protectionMinor", "protection"), ("taxMinor", "tax"), ("totalMinor", "total")):
        expect[("changed", k)] = ch[v]
        got[("changed", k)] = int(f["changed"][k])
    for plan in f["plans"]:
        for k in ("priceMinor", "taxMinor", "totalMinor"):
            got[(plan["id"], k)] = int(plan[k])
    for car in m["cars"]:
        per_day = int(car["perDayMinor"])
        car_rent = rent if car["id"] == f["carId"] else per_day * days
        expect[(car["id"], "totalMinor")] = priced(m["id"], car_rent)["total"]
        got[(car["id"], "totalMinor")] = int(car["totalMinor"])
        expect[(car["id"], "perDayMinor")] = rhu(Fr(car_rent, days))
        got[(car["id"], "perDayMinor")] = per_day
    for key, value in expect.items():
        status = "OK" if got.get(key) == value else "ÉCART"
        if status != "OK":
            errors.append(key)
        print(f"{m['id']:8} {'.'.join(key):28} oracle {value:>10}  scénario {got.get(key)!s:>10}  {status}")

print("RÉSULTAT :", "OK" if not errors else f"{len(errors)} ÉCART(S)")
sys.exit(1 if errors else 0)
