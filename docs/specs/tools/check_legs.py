"""Oracle des jambes explicites (08, E7 « Jambes explicites », vecteurs TJ01-TJ12) — US-055, révision P2P (S3).

Écrit à partir du TEXTE de 08 (E7, settle, E1 « Part hôte et encaissement », BR-CXL-06 / 08, BR-PRICE-12 / 14),
sans reprendre le code des autres oracles ni le code testé :
- roundHalfUp(q) = floor(q + 1/2) ; allocHost(m, pct) = floor(x) si frac(x) <= 1/2, sinon ceil(x)
  (égalité exacte -> plateforme) ;
- lignes retenues d'un règlement : capture = toutes ; VOLUNTARY / NO_SHOW (tarif remboursable) = P, F retenus
  roundHalfUp(l x j / days), D retenu roundHalfUp(D / 2), le reste remboursé ; FULL = rien de retenu ;
- taxe payée = somme des taxes de ligne arrondies ; taxe remboursée par groupe = roundHalfUp(taxPaid x base
  remboursée / base) ; taxe retenue = taxe payée - taxe remboursée ;
- jambes (E7) : HOST = hostFromGuest (0 si hôte inéligible) ; INSURER = roundHalfUp(Pr retenu x part prime)
  + roundHalfUp(R retenu x part assistance) ; TAX_THIRD_PARTY = taxe retenue des groupes « pour compte de tiers » ;
  PLATFORM = complément ; un ordre de remboursement porte la VARIATION SIGNÉE de chaque jambe
  (jambe retenue - jambe capturée) ; somme des variations = - remboursement du guest ; une variation positive
  est une réaffectation vers cette jambe (cas de l'hôte inéligible, TJ05b) ;
- encaissement partiel (E1, E7) : cumul payé par jambe non plateforme = floor(jambe x encaissé / owed),
  la plateforme prend le complément ; montant d'un ordre = cumul après - cumul avant.
Les valeurs attendues sont calculées ici, puis comparées aux lignes « | TJxx | » écrites dans 08.
Usage : python -I -X utf8 tools/check_legs.py [--print]   (--print : imprime les lignes calculées)
Code retour 1 en cas d'écart.
"""
import math
import re
import sys
from fractions import Fraction as Fr
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
errors = []


def rhu(q):
    return math.floor(Fr(q) + Fr(1, 2))


def alloc_host(m, pct):
    x = Fr(m) * Fr(pct)
    fl = math.floor(x)
    return fl if (x - fl) <= Fr(1, 2) else fl + 1


LINES = ["P", "PP", "PH", "F", "Pr", "X", "R", "AD", "D"]
SHARE = Fr(3, 4)          # hostSharePctFrozen = deliverySharePct = extrasSharePct (plan ESTÁNDAR, valeur de test)
INS_PR = Fr(7, 10)        # insurer_premium_share : VALEUR DE TEST (fixée par le contrat d'assureur)
INS_R = Fr(1, 2)          # insurer_roadside_share : VALEUR DE TEST


def trip(name, cur, days, groups, **lines):
    t = {"name": name, "cur": cur, "days": days, "groups": groups}
    for l in LINES:
        t[l] = lines.get(l, 0)
    t["taxPaid"] = {g: sum(rhu(Fr(t[l]) * rate) for l in ls) for g, (rate, ls, _tp) in groups.items()}
    t["total"] = sum(t[l] for l in LINES) + sum(t["taxPaid"].values())
    return t


def g1(rate, lines, third=False):
    return (Fr(rate), lines, third)


TRIPS = {
    # trips de référence de 08 (T01-T48), configuration de test : P (et promos) et F taxables
    "A": trip("A", "USD", 3, {"g": g1("0.07", ["P", "PP", "PH", "F"])},
              P=12000, F=1800, Pr=3000, X=1500, R=900, AD=1500, D=4000),
    "D": trip("D", "PYG", 3, {"g": g1("0.10", ["P", "PP", "PH", "F"])}, P=1000000, F=125500, Pr=150000, D=50000),
    "D2": trip("D2", "PYG", 3, {"g": g1("0.10", ["P", "PP", "PH", "F"])}, P=1000002, F=125500, Pr=150000, D=50000),
    # trips ajoutés par US-055 (cas à une unité mineure)
    "J": trip("J", "PYG", 3, {"g": g1("0.10", ["F", "Pr"])}, P=1000001, F=150000, Pr=400001),
    "J3": trip("J3", "PYG", 3, {"h": g1("0.10", ["P"], third=True), "g": g1("0.10", ["F", "Pr"])},
               P=1000001, F=150000, Pr=400001),
    "K2": trip("K2", "USD", 1, {"g": g1("0.07", ["F", "Pr"])}, P=1002, F=500, Pr=1005),
}


def settle(t, kind, j=None, eligible=True):
    """Retourne (retenu par ligne, taxe retenue par groupe, hostFromGuest, remboursement guest TTC)."""
    if kind == "CAPTURE":
        ret = {l: t[l] for l in LINES}
    elif kind == "FULL":
        ret = {l: 0 for l in LINES}
    else:  # VOLUNTARY / NO_SHOW, tarif remboursable, j jours de pénalité
        ret = {l: 0 for l in LINES}
        for l in ["P", "PP", "PH", "F"]:
            ret[l] = rhu(Fr(t[l]) * Fr(j) / t["days"])
        ret["D"] = rhu(Fr(t["D"]) / 2)
    refund = {l: t[l] - ret[l] for l in LINES}
    tax_ret = {}
    for g, (_rate, ls, _tp) in t["groups"].items():
        base = sum(t[l] for l in ls)
        tr = 0 if base == 0 else rhu(Fr(t["taxPaid"][g]) * sum(refund[l] for l in ls) / base)
        tax_ret[g] = t["taxPaid"][g] - tr
    host = max(0, alloc_host(ret["P"], SHARE) + ret["PH"] + alloc_host(ret["D"], SHARE)
               + alloc_host(ret["X"], SHARE)) if eligible else 0
    guest_refund = sum(refund.values()) + sum(t["taxPaid"][g] - tax_ret[g] for g in t["groups"])
    return ret, tax_ret, host, guest_refund


def legs(t, ret, tax_ret, host):
    ins = rhu(Fr(ret["Pr"]) * INS_PR) + rhu(Fr(ret["R"]) * INS_R)
    tax3 = sum(v for g, v in tax_ret.items() if t["groups"][g][2])
    total = sum(ret.values()) + sum(tax_ret.values())
    plat = total - host - ins - tax3
    return {"HOST": host, "INSURER": ins, "TAX_THIRD_PARTY": tax3, "PLATFORM": plat, "TOTAL": total}


def diff(a, b):
    return {k: a[k] - b[k] for k in a}


def partial(leg_set, owed, cum_before, cum_after):
    """Encaissement partiel : cumul payé par jambe non plateforme = floor(jambe x encaissé / owed)."""
    def cum(c):
        out = {k: (leg_set[k] * c) // owed for k in ("HOST", "INSURER", "TAX_THIRD_PARTY")}
        out["PLATFORM"] = c - sum(out.values())
        out["TOTAL"] = c
        return out
    return diff(cum(cum_after), cum(cum_before))


EXPECTED = {}     # id -> (devise, jambes)
REFUNDS = {"TJ02b", "TJ04b", "TJ05b", "TJ06", "TJ08b", "TJ09b", "TJ10b", "TJ11b", "TJ12b"}
KEPT = []         # jambes retenues après règlement : chacune >= 0
CROSS = []        # (libellé, calculé, attendu recopié d'un vecteur T existant de 08)


def capture_and(tid, t, kind, j=None, eligible=True):
    cap = legs(t, *settle(t, "CAPTURE")[:3])
    ret, tax_ret, host, gref = settle(t, kind, j, eligible)
    kept = legs(t, ret, tax_ret, host)
    KEPT.append((tid, kept))
    CROSS.append((f"{tid} somme des variations = - remboursement du guest", sum(diff(kept, cap)[k] for k in
                  ("HOST", "INSURER", "TAX_THIRD_PARTY", "PLATFORM")), -gref))
    return cap, kept, diff(kept, cap), host, gref   # variation signée par jambe (négatif = débit de la jambe)


A, D, D2, J, J3, K2 = (TRIPS[k] for k in ("A", "D", "D2", "J", "J3", "K2"))

capA = legs(A, *settle(A, "CAPTURE")[:3])
EXPECTED["TJ01"] = ("USD", capA)
CROSS.append(("TJ01 total = total payé du trip A (256,66)", capA["TOTAL"], 25666))

_, keptT03, refT03, hT03, gT03 = capture_and("TJ02", A, "VOLUNTARY", 1)
EXPECTED["TJ02a"] = ("USD", keptT03)
EXPECTED["TJ02b"] = ("USD", refT03)
CROSS += [("TJ02 hôte = gains hôte de T03 (45,00)", hT03, 4500), ("TJ02 remboursement = T03 (187,44)", gT03, 18744)]
EXPECTED["TJ03"] = ("USD", keptT03)   # T28 : capture partielle de owed sur l'autorisation = jambes retenues de T03
CROSS.append(("TJ03 capture partielle = owed de T28 (69,22)", keptT03["TOTAL"], 6922))

_, keptT05, refT05, hT05, gT05 = capture_and("TJ04", A, "NO_SHOW", 2, eligible=True)
EXPECTED["TJ04a"] = ("USD", keptT05)
EXPECTED["TJ04b"] = ("USD", refT05)
CROSS += [("TJ04 hôte = T05 (75,00)", hT05, 7500), ("TJ04 remboursement = T05 (138,22)", gT05, 13822)]

_, keptT39, refT39, hT39, gT39 = capture_and("TJ05", A, "NO_SHOW", 2, eligible=False)
EXPECTED["TJ05a"] = ("USD", keptT39)
EXPECTED["TJ05b"] = ("USD", refT39)
CROSS += [("TJ05 hôte = T39 (0,00)", hT39, 0), ("TJ05 remboursement = T39 (138,22)", gT39, 13822)]

_, keptT14, refT14, hT14, gT14 = capture_and("TJ06", A, "FULL")
EXPECTED["TJ06"] = ("USD", refT14)
CROSS.append(("TJ06 remboursement = T14 (256,66)", gT14, 25666))

owedT29 = keptT03["TOTAL"]
EXPECTED["TJ07a"] = ("USD", partial(keptT03, owedT29, 0, 3000))
EXPECTED["TJ07b"] = ("USD", partial(keptT03, owedT29, 3000, 6922))
CROSS.append(("TJ07a hôte payable = T32 (19,50)", EXPECTED["TJ07a"][1]["HOST"], 1950))

capD = legs(D, *settle(D, "CAPTURE")[:3])
_, keptT27, refT27, hT27, gT27 = capture_and("TJ08", D, "VOLUNTARY", 1)
EXPECTED["TJ08a"] = ("PYG", capD)
EXPECTED["TJ08b"] = ("PYG", refT27)
CROSS += [("TJ08 total = trip D (1 438 050)", capD["TOTAL"], 1438050), ("TJ08 hôte = T27 (268 750)", hT27, 268750),
          ("TJ08 remboursement = T27 (1 000 367)", gT27, 1000367)]

capD2 = legs(D2, *settle(D2, "CAPTURE")[:3])
_, keptT40, refT40, hT40, gT40 = capture_and("TJ09", D2, "VOLUNTARY", 1)
EXPECTED["TJ09a"] = ("PYG", capD2)
EXPECTED["TJ09b"] = ("PYG", refT40)
CROSS += [("TJ09 hôte = T40 (268 750, égalité exacte)", hT40, 268750),
          ("TJ09 remboursement = T40 (1 000 368)", gT40, 1000368)]

capJ, keptJ, refJ, _hJ, _gJ = capture_and("TJ10", J, "VOLUNTARY", 1)
EXPECTED["TJ10a"] = ("PYG", capJ)
EXPECTED["TJ10b"] = ("PYG", refJ)
CROSS += [("TJ10 capture = illustration de l'analyse §c.3 (1 605 002)", capJ["TOTAL"], 1605002),
          ("TJ10 HOST capturé (750 001)", capJ["HOST"], 750001), ("TJ10 INSURER capturé (280 001)", capJ["INSURER"], 280001),
          ("TJ10 HOST retenu (égalité exacte 250 000,5 -> 250 000)", keptJ["HOST"], 250000)]
# contre-exemple : prorata calculé par un PSP sur la jambe hôte (interdit)
prorata_host = rhu(Fr(capJ["HOST"]) * (-refJ["TOTAL"]) / capJ["TOTAL"])     # débit de la jambe hôte au prorata
EXPECTED["TJ10c"] = ("PYG", {"PRORATA_HOST": prorata_host, "ECART": prorata_host - (-refJ["HOST"])})

capJ3, keptJ3, refJ3, _h, _g = capture_and("TJ11", J3, "VOLUNTARY", 1)
EXPECTED["TJ11a"] = ("PYG", capJ3)
EXPECTED["TJ11b"] = ("PYG", refJ3)

capK2, keptK2, refK2, _h, _g = capture_and("TJ12", K2, "NO_SHOW", Fr(3, 4))
EXPECTED["TJ12a"] = ("USD", capK2)
EXPECTED["TJ12b"] = ("USD", refK2)

# ------------------------------------------------------------------ invariants
for vid, (_cur, lg) in EXPECTED.items():
    if "TOTAL" not in lg:
        continue
    s = lg["HOST"] + lg["INSURER"] + lg["TAX_THIRD_PARTY"] + lg["PLATFORM"]
    if s != lg["TOTAL"]:
        errors.append(f"{vid} : somme des jambes {s} != total {lg['TOTAL']}")
    if vid not in REFUNDS:   # capture, encaissement : chaque jambe >= 0 ; REFUNDS = variations signées
        neg = [k for k in ("HOST", "INSURER", "TAX_THIRD_PARTY", "PLATFORM") if lg[k] < 0]
        if neg:
            errors.append(f"{vid} : jambe négative {neg}")
for tid, kept in KEPT:
    neg = [k for k in ("HOST", "INSURER", "TAX_THIRD_PARTY", "PLATFORM") if kept[k] < 0]
    if neg:
        errors.append(f"{tid} : jambe retenue négative {neg}")
for lab, got, exp in CROSS:
    ok = got == exp
    print(f"  {'OK' if ok else 'KO'} {lab} : {got} (attendu {exp})")
    if not ok:
        errors.append(lab)


# ------------------------------------------------------------------ format et comparaison avec 08
def fmt(cur, m):
    sgn = "−" if m < 0 else ""          # signe moins typographique (U+2212), comme dans 08
    m = abs(m)
    if cur == "USD":
        return f"{sgn}{m // 100},{m % 100:02d}"
    return sgn + f"{m:,}".replace(",", " ")


def parse(cur, s):
    s = s.replace("*", "").replace(" ", "").replace(" ", "").replace(" ", "").replace("−", "-").strip()
    s = s.lstrip("+")
    if cur == "USD":
        if not re.fullmatch(r"-?\d+,\d\d", s):
            raise ValueError(s)
        return int(s.replace(",", ""))
    if not re.fullmatch(r"-?\d+", s):
        raise ValueError(s)
    return int(s)


COLS = ["HOST", "INSURER", "TAX_THIRD_PARTY", "PLATFORM", "TOTAL"]

if "--print" in sys.argv:
    for vid, (cur, lg) in EXPECTED.items():
        if "TOTAL" in lg:
            print(vid, cur, " | ".join(fmt(cur, lg[c]) for c in COLS))
        else:
            print(vid, cur, " | ".join(f"{k} {fmt(cur, v)}" for k, v in lg.items()))

TXT = (ROOT / "08_BUSINESS_RULES.md").read_text(encoding="utf-8")
rows = {m.group(1): m.group(0) for m in re.finditer(r"(?m)^\| (TJ\d\d[a-z]?) \|.*$", TXT)}
print(f"\nLignes TJ trouvées dans 08 : {len(rows)} ; vecteurs calculés : {len(EXPECTED)}")
for vid, (cur, lg) in EXPECTED.items():
    r = rows.get(vid)
    if r is None:
        print(f"  KO {vid} absent de 08")
        errors.append(f"{vid} absent")
        continue
    cells = [c.strip() for c in r.strip().strip("|").split("|")]
    if "TOTAL" in lg:
        # | id | entrées | opération | HOST | INSURER | TAX_THIRD_PARTY | PLATFORM | montant | détail |
        try:
            got = [parse(cur, c) for c in cells[3:8]]
        except (ValueError, IndexError) as e:
            print(f"  KO {vid} : cellule illisible ({e})")
            errors.append(vid)
            continue
        exp = [lg[c] for c in COLS]
        ok = got == exp
        print(f"  {'OK' if ok else 'KO'} {vid} ({cur}) : " + " / ".join(fmt(cur, v) for v in exp)
              + ("" if ok else f" ; écrit {' / '.join(fmt(cur, v) for v in got)}"))
        if not ok:
            errors.append(vid)
    else:
        need = [fmt(cur, v) for v in lg.values()]
        miss = [n for n in need if n not in r.replace(" ", " ").replace(" ", " ")]
        print(f"  {'OK' if not miss else 'KO'} {vid} ({cur}) : prorata hôte {need[0]}, écart {need[1]}"
              + (f" ; manquants {miss}" if miss else ""))
        if miss:
            errors.append(vid)
extra = sorted(set(rows) - set(EXPECTED))
if extra:
    errors.append(f"lignes TJ non contrôlées : {extra}")

print("\nRÉSULTAT :", "OK" if not errors else f"{len(errors)} ÉCART(S)")
for e in errors:
    print("  -", e)
sys.exit(1 if errors else 0)
