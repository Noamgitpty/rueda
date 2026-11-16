"""Oracle des jambes explicites (08, E7 « Jambes explicites », vecteurs TJ01-TJ21) — US-055 (S3), complété par US-056 (S4).

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
- encaissement partiel (E1, E7 règle 4) : cible cumulative par jambe non plateforme = floor(jambe x encaissé / owed),
  remplie dans l'ordre HOST -> INSURER -> TAX dans la limite de l'ordre, manque reporté ; PLATFORM = reste, plafonné
  à ce qu'il reste de sa jambe ; excédent aux jambes non plateforme dans l'ordre TAX -> INSURER -> HOST, dans la limite
  de leur reste (règle 4 révisée par US-056 : plus aucune réaffectation au solde, aucun incrément négatif ; TJ07, TJ17,
  TJ19 ; balayage de propriété sur 6 jeux de jambes) ;
- règle 5 : capture refusée si PLATFORM < 0, plafond de la promo plateforme par dichotomie (TJ13) ;
- règle 7 : chargeback perdu ventilé par jambe, reprise HOST selon E5, INSURER et TAX_THIRD_PARTY jamais réduites (TJ14) ;
- règle 10 : ventilation en cascade entre opérations (moyens natif -> non natif -> cash -> promo ; jambes
  HOST -> INSURER -> TAX -> PLATFORM) ; remboursements par moyen selon E2 (TJ15, TJ16) ;
- règle 3 bis : variation sur une jambe HOST déjà libérée, avancée par PLATFORM, créance sur l'hôte (TJ18) ;
- US-056 : complément de T66 (b) ventilé en cascade, réémissions en crédit comprises (TJ20) ; crédits plafonnés à la
  jambe PLATFORM de la capture (règle 10, TJ21) ;
- contrôles de forme : identifiant TJ dupliqué, écart de TJ10c écrit exactement dans la ligne.
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
# contre-exemple : ventilation au prorata par un PSP (interdite) : chaque jambe non plateforme débitée au prorata
ratio = Fr(-refJ["TOTAL"], capJ["TOTAL"])
pro = {k: -rhu(capJ[k] * ratio) for k in ("HOST", "INSURER", "TAX_THIRD_PARTY")}
pro["PLATFORM"] = refJ["TOTAL"] - sum(pro.values())
pro["TOTAL"] = refJ["TOTAL"]
EXPECTED["TJ10c"] = ("PYG", pro)
REFUNDS.add("TJ10c")
ECART_TJ10C = -pro["HOST"] - (-refJ["HOST"])
CROSS.append(("TJ10c écart prorata sur la jambe hôte (68 535)", ECART_TJ10C, 68535))

capJ3, keptJ3, refJ3, _h, _g = capture_and("TJ11", J3, "VOLUNTARY", 1)
EXPECTED["TJ11a"] = ("PYG", capJ3)
EXPECTED["TJ11b"] = ("PYG", refJ3)

capK2, keptK2, refK2, _h, _g = capture_and("TJ12", K2, "NO_SHOW", Fr(3, 4))
EXPECTED["TJ12a"] = ("USD", capK2)
EXPECTED["TJ12b"] = ("USD", refK2)

# ------------------------------------------------------------------ révision US-055 (revues) : TJ13 à TJ18
LEGS4 = ("HOST", "INSURER", "TAX_THIRD_PARTY", "PLATFORM")
REFUSED = set()      # captures refusées (LEG_AMOUNT_NEGATIVE) : PLATFORM < 0 attendu
LOSSES = set()       # ventilation d'un chargeback perdu


def mk(leg_vals):
    d = dict(zip(LEGS4, leg_vals))
    d["TOTAL"] = sum(leg_vals)
    return d


# TJ13 : refus d'une jambe négative à la capture (règle 5) ; plafond du code promo plateforme
def promo_trip(cur, rate, P, PP, F, Pr):
    return trip("promo", cur, 3, {"g": g1(rate, ["P", "PP", "PH", "F"])}, P=P, PP=PP, F=F, Pr=Pr)


def cap_legs(t):
    return legs(t, *settle(t, "CAPTURE")[:3])


def max_promo(cur, rate, P, F, Pr):
    """Promo plateforme la plus forte (la plus négative) qui laisse PLATFORM >= 0 à la capture
    (dichotomie : PLATFORM est croissant en PP)."""
    lo, hi = -P, 0
    if cap_legs(promo_trip(cur, rate, P, lo, F, Pr))["PLATFORM"] >= 0:
        return lo
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if cap_legs(promo_trip(cur, rate, P, mid, F, Pr))["PLATFORM"] >= 0:
            hi = mid
        else:
            lo = mid
    return hi


PROMO_CASES = {"TJ13a": ("USD", "0.07", 10000, -9000, 1500, 3000), "TJ13c": ("PYG", "0.10", 1000000, -900000, 150000, 300000)}
PROMO_MAX = {}  # promo plateforme maximale admise, imprimée avec --print
for refused_id, ok_id in (("TJ13a", "TJ13b"), ("TJ13c", "TJ13d")):
    cur, rate, P, PP, F, Pr = PROMO_CASES[refused_id]
    EXPECTED[refused_id] = (cur, cap_legs(promo_trip(cur, rate, P, PP, F, Pr)))
    REFUSED.add(refused_id)
    m = max_promo(cur, rate, P, F, Pr)
    PROMO_MAX[ok_id] = m
    EXPECTED[ok_id] = (cur, cap_legs(promo_trip(cur, rate, P, m, F, Pr)))
    CROSS.append((f"{ok_id} promo maximale − 1 unité => PLATFORM < 0",
                  cap_legs(promo_trip(cur, rate, P, m - 1, F, Pr))["PLATFORM"] < 0, True))


# TJ14 : chargeback perdu, ventilé par jambe (E5, E7 règle 7) : reprise sur HOST seule (formule E5),
# INSURER et TAX_THIRD_PARTY jamais réduites ; le reste est à la charge de la plateforme.
def chargeback(kept, collected, refund_committed, host_paid, lost):
    owed = kept["TOTAL"]
    after = min(max(collected - lost - refund_committed, 0), owed)
    payable_after = 0 if owed == 0 else (kept["HOST"] * after) // owed
    claw = max(0, host_paid - payable_after)
    return mk([-claw, 0, 0, -(lost - claw)])


EXPECTED["TJ14a"] = ("USD", chargeback(keptT03, 25666, 18744, 4500, 25666))      # T53
CROSS.append(("TJ14a reprise = T53 (45,00)", -EXPECTED["TJ14a"][1]["HOST"], 4500))
EXPECTED["TJ14b"] = ("USD", chargeback(capA, 25666, 0, 0, 25666))                 # trip réalisé, rien versé encore
EXPECTED["TJ14c"] = ("PYG", chargeback(keptJ3, 1705002, 1283335, 250000, 1705002))
LOSSES.update({"TJ14a", "TJ14b", "TJ14c"})


# TJ15 / TJ16 : ventilation des jambes entre plusieurs instances (E7 règle 10) : moyens dans l'ordre
# natif -> non natif -> crédit cash -> crédit promo ; jambes dans l'ordre HOST -> INSURER -> TAX_THIRD_PARTY -> PLATFORM.
def cascade(leg_amounts, instances):
    rest = {k: abs(leg_amounts[k]) for k in LEGS4}
    sign = -1 if leg_amounts["TOTAL"] < 0 else 1
    out = []
    for amount in instances:
        need, row = amount, {}
        for k in LEGS4:
            take = min(rest[k], need)
            row[k] = sign * take
            rest[k] -= take
            need -= take
        if need:
            raise ValueError("instances > jambes")
        row["TOTAL"] = sign * amount
        out.append(row)
    if any(rest.values()):
        raise ValueError("jambes non épuisées")
    return out


def e2_refunds(paid, refund_total):
    """E2 (première exécution) : K = Σ payé − refund_total absorbé promo -> cash -> non natif -> natif ;
    renvoie les remboursements dans l'ordre natif, non natif, cash, promo (moyens présents)."""
    K = sum(paid.values()) - refund_total
    out = {}
    for mth in ("promo", "cash", "nonnatif", "natif"):
        a = min(K, paid.get(mth, 0))
        out[mth] = paid.get(mth, 0) - a
        K -= a
    return [out[mth] for mth in ("natif", "nonnatif", "cash", "promo") if mth in paid]


paid33 = {"natif": 15000, "nonnatif": 5666, "cash": 3000, "promo": 2000}        # T33 : carte, Yappy, cash, promo
for sfx, row in zip("abcd", cascade(capA, [paid33[mth] for mth in ("natif", "nonnatif", "cash", "promo")])):
    EXPECTED["TJ15" + sfx] = ("USD", row)
r33 = e2_refunds(paid33, 18744)
CROSS.append(("TJ16 remboursements par moyen = T33 (150,00 ; 37,44 ; 0 ; 0)", r33, [15000, 3744, 0, 0]))
for sfx, row in zip("ab", cascade(refT03, [x for x in r33 if x])):
    EXPECTED["TJ16" + sfx] = ("USD", row)
    REFUNDS.add("TJ16" + sfx)
rD = e2_refunds({"natif": 1000000, "cash": 438050}, 1000367)
CROSS.append(("TJ16c-d remboursements par moyen (1 000 000 ; 367)", rD, [1000000, 367]))
for sfx, row in zip("cd", cascade(refT27, rD)):
    EXPECTED["TJ16" + sfx] = ("PYG", row)
    REFUNDS.add("TJ16" + sfx)


# TJ17 / TJ19 : encaissement partiel (E7 règle 4, révisée par US-056) : remplissage HOST -> INSURER -> TAX dans la
# limite du montant de l'ordre et de la cible cumulative floor(jambe x encaissé / owed) ; manque reporté ; PLATFORM =
# reste, plafonné à ce qu'il reste de sa jambe ; l'excédent va à TAX -> INSURER -> HOST dans la limite de leur reste.
# Au solde, chaque jambe est donc soldée exactement, sans réaffectation et sans incrément négatif.
def partial_seq(leg_set, payments):
    owed = leg_set["TOTAL"]
    carried = {k: 0 for k in LEGS4}
    c, out, naive_neg = 0, [], False
    for amount in payments:
        c1 = c + amount
        tgt = {k: (leg_set[k] * c1) // owed for k in LEGS4[:3]}
        naive = amount - sum(tgt[k] - (leg_set[k] * c) // owed for k in LEGS4[:3])
        naive_neg = naive_neg or naive < 0
        rest, row = amount, {}
        for k in LEGS4[:3]:
            inc = max(0, min(tgt[k] - carried[k], rest))
            row[k] = inc
            rest -= inc
        row["PLATFORM"] = min(rest, leg_set["PLATFORM"] - carried["PLATFORM"])
        rest -= row["PLATFORM"]
        for k in ("TAX_THIRD_PARTY", "INSURER", "HOST"):
            add = min(rest, leg_set[k] - carried[k] - row[k])
            row[k] += add
            rest -= add
        if rest:
            raise ValueError("encaissement supérieur au reste dû")
        row["TOTAL"] = amount
        for k in LEGS4:
            carried[k] += row[k]
        c = c1
        out.append(row)
    return out, carried, naive_neg


def partial_seq_us055(leg_set, payments):
    """Règle 4 dans sa rédaction US-055 (report soldé au solde par réaffectation PLATFORM -> jambe) : sert seulement
    à montrer le résidu fermé par US-056 (incrément PLATFORM négatif au dernier paiement, TJ19)."""
    owed = leg_set["TOTAL"]
    carried = {k: 0 for k in LEGS4}
    c, out = 0, []
    for amount in payments:
        c1 = c + amount
        tgt = {k: (leg_set[k] * c1) // owed for k in LEGS4[:3]}
        rest, row = amount, {}
        for k in LEGS4[:3]:
            inc = max(0, min(tgt[k] - carried[k], rest))
            row[k] = inc
            rest -= inc
        row["PLATFORM"] = rest
        if c1 == owed:
            for k in LEGS4[:3]:
                gap = leg_set[k] - carried[k] - row[k]
                row[k] += gap
                row["PLATFORM"] -= gap
        for k in LEGS4:
            carried[k] += row[k]
        c = c1
        out.append(row)
    return out


seqA, carA, negA = partial_seq(capA, [50, 1, 25666 - 51])
for sfx, row in zip("abc", seqA):
    EXPECTED["TJ17" + sfx] = ("USD", row)
CROSS += [("TJ17a-c l'ancienne règle donnait un incrément PLATFORM négatif", negA, True),
          ("TJ17a-c cumul = jambes TJ01", [carA[k] for k in LEGS4], [capA[k] for k in LEGS4])]
J3_PAYMENTS = [6, 1, 1705002 - 7]
seqJ, carJ, negJ = partial_seq(capJ3, J3_PAYMENTS)
for sfx, row in zip("def", seqJ):
    EXPECTED["TJ17" + sfx] = ("PYG", row)
CROSS += [("TJ17d-f l'ancienne règle donnait un incrément PLATFORM négatif", negJ, True),
          ("TJ17d-f cumul = jambes TJ11a", [carJ[k] for k in LEGS4], [capJ3[k] for k in LEGS4])]
seq7, _c7, _n7 = partial_seq(keptT03, [3000, 3922])
CROSS.append(("TJ07 inchangé par la règle 4 révisée", [seq7[i][k] for i in (0, 1) for k in LEGS4],
              [EXPECTED[v][1][k] for v in ("TJ07a", "TJ07b") for k in LEGS4]))


# TJ19 (US-056) : dernier paiement de 1 ou 2 unités mineures après un encaissement qui a reporté une jambe non
# plateforme ; la rédaction US-055 donnait alors un incrément PLATFORM de -1 ou -2 au solde (revue argent US-055 n° 5).
# La règle révisée plafonne PLATFORM à son reste : l'excédent comble le report tout de suite.
promoN = cap_legs(promo_trip("USD", "0.07", 10000, PROMO_MAX["TJ13b"], 1500, 3000))     # jambes de TJ13b (PLATFORM = 0)
promoNP = cap_legs(promo_trip("PYG", "0.10", 1000000, PROMO_MAX["TJ13d"], 150000, 300000))   # jambes de TJ13d
TJ19_CASES = [("ab", "USD", capA, [25665, 1]), ("cd", "PYG", capJ3, [1705001, 1]), ("ef", "USD", promoN, [1, 9599])]
for sfx, cur, lg, pays in TJ19_CASES:
    rows19, car19, _n = partial_seq(lg, pays)
    old19 = partial_seq_us055(lg, pays)
    for x, row in zip(sfx, rows19):
        EXPECTED["TJ19" + x] = (cur, row)
    CROSS += [(f"TJ19{sfx} cumul = jambes réglées", [car19[k] for k in LEGS4], [lg[k] for k in LEGS4]),
              (f"TJ19{sfx} la rédaction US-055 donnait un incrément PLATFORM négatif",
               any(r["PLATFORM"] < 0 for r in old19), True)]
CROSS.append(("TJ19b rédaction US-055 : PLATFORM = -0,01 au solde", partial_seq_us055(capA, [25665, 1])[1]["PLATFORM"], -1))
CROSS.append(("TJ19d rédaction US-055 : PLATFORM = -2 au solde", partial_seq_us055(capJ3, [1705001, 1])[1]["PLATFORM"], -2))


def sweep(leg_set, firsts):
    """Propriété (règle 4 révisée) : pour chaque premier paiement a, puis le solde (et a, 1 unité, le solde) : aucun
    incrément négatif, cumul = jambes, HOST porté <= floor(HOST x encaissé / owed) (= hostPayable de E1) à chaque pas."""
    owed = leg_set["TOTAL"]
    bad = 0
    for a in firsts:
        seqs = [[a, owed - a]] + ([[a, 1, owed - a - 1]] if owed - a > 1 else [])
        for pays in seqs:
            rows, car, _n = partial_seq(leg_set, pays)
            c, cum_h = 0, 0
            for r in rows:
                c += r["TOTAL"]
                cum_h += r["HOST"]
                if any(r[k] < 0 for k in LEGS4) or cum_h > (leg_set["HOST"] * c) // owed:
                    bad += 1
            if [car[k] for k in LEGS4] != [leg_set[k] for k in LEGS4]:
                bad += 1
    return bad


SWEEP_SETS = [("TJ01", capA), ("TJ11a", capJ3), ("TJ13b", promoN), ("TJ13d", promoNP), ("TJ02a", keptT03), ("TJ12a", capK2)]
for name, lg in SWEEP_SETS:
    o = lg["TOTAL"]
    firsts = sorted(set(range(1, min(o, 1500))) | set(range(max(1, o - 1500), o)))
    CROSS.append((f"balayage règle 4 sur {name} ({len(firsts)} premiers paiements)", sweep(lg, firsts), 0))


# TJ20 (US-056) : T66 (b) : v1 = T03 exécutée (carte 150,00 et Yappy 37,44, TJ16a-b), v2 = motif FULL ; complément de
# 69,22 imputé par E2 (incrémental) puis ventilé en cascade (règle 10), réémissions en crédit comprises.
def e2_incremental(paid, committed, refund_total):
    refundable = {m: max(0, paid.get(m, 0) - committed.get(m, 0)) for m in paid}
    K = sum(refundable.values()) - refund_total
    out = {}
    for mth in ("promo", "cash", "nonnatif", "natif"):
        if mth in paid:
            a = min(K, refundable[mth])
            out[mth] = refundable[mth] - a
            K -= a
    return [out[mth] for mth in ("natif", "nonnatif", "cash", "promo") if mth in paid]


var66 = diff(legs(A, *settle(A, "FULL")[:3]), keptT03)
r66 = e2_incremental(paid33, {"natif": 15000, "nonnatif": 3744}, -var66["TOTAL"])
CROSS.append(("TJ20 complément par moyen = T66 (b) (carte 0 ; Yappy 19,22 ; cash 30,00 ; promo 20,00)", r66,
              [0, 1922, 3000, 2000]))
for sfx, row in zip("abc", cascade(var66, [x for x in r66 if x])):
    EXPECTED["TJ20" + sfx] = ("USD", row)
    REFUNDS.add("TJ20" + sfx)


# TJ21 (US-056) : crédits (cash, promo) plafonnés à la jambe PLATFORM de la capture (règle 10) : le guest du trip A
# demande 120,00 de crédit cash ; seul 99,91 (= PLATFORM de TJ01) est imputé ; le reste est payé par carte.
credit_asked = 12000
credit_used = min(credit_asked, capA["PLATFORM"])
for sfx, row in zip("ab", cascade(capA, [capA["TOTAL"] - credit_used, credit_used])):
    EXPECTED["TJ21" + sfx] = ("USD", row)
CROSS += [("TJ21 crédit imputé = PLATFORM de TJ01 (99,91)", credit_used, 9991),
          ("TJ21b le crédit ne touche que PLATFORM", [EXPECTED["TJ21b"][1][k] for k in LEGS4[:3]], [0, 0, 0])]


# TJ18 : variation négative sur une jambe HOST déjà libérée (règle 3 bis) : la plateforme avance le débit ;
# créance sur l'hôte au host_ledger (SM-6b).
def released(var):
    out = dict(var)
    out["PLATFORM"] = var["PLATFORM"] + var["HOST"]
    out["HOST"] = 0
    return out, -var["HOST"]


keptT08 = legs(A, *settle(A, "FULL")[:3])
varA = diff(keptT08, keptT05)                     # v1 = T05 exécutée (hôte versé), v2 = requalification FULL (T08)
EXPECTED["TJ18a"] = ("USD", varA)
exA, creA = released(varA)
EXPECTED["TJ18b"] = ("USD", exA)
CROSS += [("TJ18a complément au guest (118,44)", -varA["TOTAL"], 11844), ("TJ18b créance sur l'hôte (75,00)", creA, 7500)]
retT41, taxT41, hT41, gT41 = settle(D, "NO_SHOW", 2)
CROSS.append(("TJ18c v1 = T41 (hôte 518 750, remboursement 587 683)", (hT41, gT41), (518750, 587683)))
varD = diff(legs(D, *settle(D, "FULL")[:3]), legs(D, retT41, taxT41, hT41))
EXPECTED["TJ18c"] = ("PYG", varD)
exD, creD = released(varD)
EXPECTED["TJ18d"] = ("PYG", exD)
CROSS.append(("TJ18d créance sur l'hôte (518 750)", creD, 518750))
REFUNDS.update({"TJ18a", "TJ18b", "TJ18c", "TJ18d"})

# ------------------------------------------------------------------ invariants
for vid, (_cur, lg) in EXPECTED.items():
    if "TOTAL" not in lg:
        continue
    s = lg["HOST"] + lg["INSURER"] + lg["TAX_THIRD_PARTY"] + lg["PLATFORM"]
    if s != lg["TOTAL"]:
        errors.append(f"{vid} : somme des jambes {s} != total {lg['TOTAL']}")
    if vid in REFUSED:       # capture refusée : la jambe PLATFORM serait négative
        if not lg["PLATFORM"] < 0:
            errors.append(f"{vid} : refus attendu, PLATFORM >= 0")
    elif vid in LOSSES:      # chargeback perdu : INSURER et TAX_THIRD_PARTY jamais réduites, aucune jambe positive
        if lg["INSURER"] or lg["TAX_THIRD_PARTY"] or lg["HOST"] > 0 or lg["PLATFORM"] > 0:
            errors.append(f"{vid} : ventilation de chargeback non conforme")
    elif vid not in REFUNDS:  # capture, encaissement : chaque jambe >= 0 ; REFUNDS = variations signées
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
    print("PROMO_MAX", PROMO_MAX, "ECART_TJ10C", ECART_TJ10C)
    for vid, (cur, lg) in EXPECTED.items():
        if "TOTAL" in lg:
            print(vid, cur, " | ".join(fmt(cur, lg[c]) for c in COLS))
        else:
            print(vid, cur, " | ".join(f"{k} {fmt(cur, v)}" for k, v in lg.items()))

TXT = (ROOT / "08_BUSINESS_RULES.md").read_text(encoding="utf-8")
rows = {}
for mt in re.finditer(r"(?m)^\| (TJ\d\d[a-z]?) \|.*$", TXT):
    if mt.group(1) in rows:
        errors.append(f"identifiant TJ dupliqué dans 08 : {mt.group(1)}")
    rows[mt.group(1)] = mt.group(0)
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
if not re.search(r"(?m)^\| TJ10c \|.*écart de " + re.escape(fmt("PYG", ECART_TJ10C)) + r" PYG\b", TXT):
    errors.append("TJ10c : l'écart de " + fmt("PYG", ECART_TJ10C) + " PYG n'est pas écrit dans la ligne")
extra = sorted(set(rows) - set(EXPECTED))
if extra:
    errors.append(f"lignes TJ non contrôlées : {extra}")

print("\nRÉSULTAT :", "OK" if not errors else f"{len(errors)} ÉCART(S)")
for e in errors:
    print("  -", e)
sys.exit(1 if errors else 0)
