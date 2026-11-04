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

Espace hôte (seconde demande de fusion de US-033, bloc `host` de chaque marché) :
- part de l'hôte = plan de gains `ESTÁNDAR` à 75 % (BR-PROT-06 [NOUS], `host_default_plan`), figée sur chaque trip
  (`hostSharePctFrozen`) ; le script vérifie qu'elle vaut `SHARE` de check_legs.py ;
- jambes de chaque trip (HOST, INSURER, TAX_THIRD_PARTY, PLATFORM) : `legs(t, *settle(t, "CAPTURE"))` de check_legs.py,
  avec `insurer_premium_share` = 70 % (VALEUR DE TEST de check_legs.py, fixée plus tard par le contrat d'assureur) ;
  la somme des jambes est le total payé par le voyageur ;
- loyer d'un trip de n jours = prix par jour x n (trip de 3 jours : loyer du trip de référence) ; frais, protection
  Básica et taxe : mêmes rapports que plus haut ;
- gains du mois = somme des jambes HOST des trips terminés ; estimateur A01 = `allocHost(prix par jour x jours, part)` ;
- pénalité d'annulation de l'hôte (BR-CXL-13 [NOUS], plus de 24 h avant le départ) : 25 dans la devise du pays en
  USD ; en PYG, VALEUR FICTIVE (paramètre par devise non fixé dans 08) ; devis de dommage : montant fictif.
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
legs, settle, alloc_host, SHARE = ns["legs"], ns["settle"], ns["alloc_host"], ns["SHARE"]

# Configuration de test de 08 par marché (trips de référence A et D) : taux, rapport F / P, rapport Básica / P.
CONFIG = {
    "istmo": {"cur": "USD", "tax": "0.07", "fee": Fr(3, 20), "basic": Fr(1, 4)},
    "guarani": {"cur": "PYG", "tax": "0.10", "fee": Fr(251, 2000), "basic": Fr(3, 20)},
}
PLAN_SHARE = {"ESTANDAR": Fr(2, 5), "TOTAL": Fr(13, 20)}


def priced(market_id, rent, protection=None, days=3):
    c = CONFIG[market_id]
    fee = rhu(Fr(rent) * c["fee"])
    pr = rhu(Fr(rent) * c["basic"]) if protection is None else protection
    t = trip("proto", c["cur"], days, {"g": g1(c["tax"], ["P", "PP", "PH", "F"])}, P=rent, F=fee, Pr=pr)
    cap = legs(t, *settle(t, "CAPTURE")[:3])
    return {"rent": rent, "fee": fee, "protection": pr, "tax": sum(t["taxPaid"].values()), "total": t["total"],
            "host": cap["HOST"], "insurer": cap["INSURER"], "taxThird": cap["TAX_THIRD_PARTY"],
            "platform": cap["PLATFORM"], "legsTotal": cap["TOTAL"]}


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
    h = m["host"]
    expect[("host", "sharePct")] = int(SHARE * 100)
    got[("host", "sharePct")] = h["sharePct"]
    per_day_host = int(next(c for c in m["cars"] if c["id"] == h["carId"])["perDayMinor"])
    for i, v in enumerate(h["estimateMinor"], start=1):
        expect[("estimate", str(i))] = alloc_host(per_day_host * i, Fr(h["sharePct"], 100))
        got[("estimate", str(i))] = int(v)
    month = 0
    for ht in h["trips"]:
        ht_rent = rent if ht["days"] == days else per_day_host * ht["days"]
        p = priced(m["id"], ht_rent, days=ht["days"])
        assert p["legsTotal"] == p["total"], "jambes != total"
        for k, v in (("rentMinor", "rent"), ("tripFeeMinor", "fee"), ("protectionMinor", "protection"),
                     ("taxMinor", "tax"), ("totalMinor", "total"), ("hostMinor", "host"),
                     ("insurerMinor", "insurer"), ("taxThirdMinor", "taxThird"), ("platformMinor", "platform")):
            expect[(ht["id"], k)] = p[v]
            got[(ht["id"], k)] = int(ht[k])
        if ht["status"] in ("sent", "scheduled", "onHold"):
            month += p["host"]
    expect[("host", "monthEarningsMinor")] = month
    got[("host", "monthEarningsMinor")] = int(h["monthEarningsMinor"])
    if m["id"] == "istmo":
        expect[("host", "cancelPenaltyMinor")] = 2500
        got[("host", "cancelPenaltyMinor")] = int(h["cancelPenaltyMinor"])
    for key, value in expect.items():
        status = "OK" if got.get(key) == value else "ÉCART"
        if status != "OK":
            errors.append(key)
        print(f"{m['id']:8} {'.'.join(key):28} oracle {value:>10}  scénario {got.get(key)!s:>10}  {status}")

print("RÉSULTAT :", "OK" if not errors else f"{len(errors)} ÉCART(S)")
sys.exit(1 if errors else 0)
