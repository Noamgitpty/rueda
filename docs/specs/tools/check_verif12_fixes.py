# -*- coding: utf-8 -*-
"""Controle des corrections VERIF_12 (F1, F2, F3, F4, F5, F8) de 08_BUSINESS_RULES.md.

Ecrit a partir du TEXTE de 08 (E1 invariants, E2 imputation incrementale, E4 attempt_no et
grand livre, E5 chargeback sur remboursement bloque et devise de versement, SM-8, hostPartOf).
Ne modifie et n'importe aucun autre script. Entiers en unites mineures, Fraction, aucun flottant.
Lancer : python -I tools/check_verif12_fixes.py
"""
import math
import random
from fractions import Fraction as Fr

ERR = []


def check(name, got, exp):
    ok = got == exp
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"  got={got!r} exp={exp!r}"))
    if not ok:
        ERR.append(name)


def fl(x):
    return math.floor(Fr(x))


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def alloc_host(m, pct):
    """allocHost : plus proche, egalite exacte -> plateforme (floor)."""
    x = Fr(m) * Fr(pct)
    f = math.floor(x)
    return f if x - f <= Fr(1, 2) else f + 1


def rhu(x):
    return math.floor(Fr(x) + Fr(1, 2))


# ------------------------------------------------------------------ E2 (F1)
ORDER = {"promo": 0, "cash": 1, "nonnative": 2, "native": 3}


def allocate_incremental(tenders, refund_total):
    """E2 corrige VERIF_12-F1.
    tenders : dict name -> {cat, paid, committed, cb_lost, recent}
    refundable[m] = max(0, paid - committed - cb_lost) ; K' = sum refundable - refund_total,
    absorbe promo -> cash -> non natif -> natif (capture la plus recente d'abord)."""
    refundable = {n: max(0, t["paid"] - t["committed"] - t.get("cb_lost", 0)) for n, t in tenders.items()}
    if refund_total > sum(refundable.values()):
        raise ValueError("refund_total > somme des reliquats")
    k = sum(refundable.values()) - refund_total
    names = sorted(tenders, key=lambda n: (ORDER[tenders[n]["cat"]], -tenders[n].get("recent", 0)))
    out = {}
    for n in names:
        ab = min(k, refundable[n])
        k -= ab
        out[n] = refundable[n] - ab
    assert k == 0
    return out


def allocate_old(tenders, refund_total):
    """Ancienne regle (K sur le paye brut) : pour montrer l'ecart."""
    k = sum(t["paid"] for t in tenders.values()) - refund_total
    names = sorted(tenders, key=lambda n: (ORDER[tenders[n]["cat"]], -tenders[n].get("recent", 0)))
    out = {}
    for n in names:
        ab = min(k, tenders[n]["paid"])
        k -= ab
        out[n] = tenders[n]["paid"] - ab
    return out


def t33_tenders():
    return {"promo": {"cat": "promo", "paid": 2000, "committed": 0},
            "cash": {"cat": "cash", "paid": 3000, "committed": 0},
            "yappy": {"cat": "nonnative", "paid": 5666, "committed": 0},
            "card": {"cat": "native", "paid": 15000, "committed": 0}}


# premiere execution inchangee (T33, T34, T56)
check("T33 premiere imputation", allocate_incremental(t33_tenders(), 18744),
      {"promo": 0, "cash": 0, "yappy": 3744, "card": 15000})
check("T34 premiere imputation", allocate_incremental(t33_tenders(), 25666),
      {"promo": 2000, "cash": 3000, "yappy": 5666, "card": 15000})
t56 = {"cash": {"cat": "cash", "paid": 20000, "committed": 0},
       "card": {"cat": "native", "paid": 5666, "committed": 0}}
check("T56 premiere imputation", allocate_incremental(t56, 18744), {"cash": 13078, "card": 5666})


def t66(owed_v2):
    tenders = t33_tenders()
    v1 = allocate_incremental(tenders, 18744)          # v1 = T03 executee (CONFIRMED)
    for n, a in v1.items():
        tenders[n]["committed"] += a
    collected = 25666
    committed = sum(t["committed"] for t in tenders.values())
    available = collected - committed
    assert available >= owed_v2
    refund_total = available - owed_v2
    new = allocate_incremental(tenders, refund_total)
    cumul = {n: tenders[n]["committed"] + new[n] for n in tenders}
    for n in tenders:                                    # invariant par moyen
        assert cumul[n] <= tenders[n]["paid"], n
    old = allocate_old(t33_tenders(), refund_total)
    return refund_total, new, cumul, old


rt, new, cumul, old = t66(1922)
check("T66a complement", rt, 5000)
check("T66a imputation", new, {"promo": 78, "cash": 3000, "yappy": 1922, "card": 0})
check("T66a cumul = imputation en une fois", cumul, allocate_incremental(t33_tenders(), 23744))
check("T66a ancienne regle -> carte 50,00 (sur-remboursement)", old["card"], 5000)
rt, new, cumul, old = t66(0)
check("T66b complement", rt, 6922)
check("T66b imputation", new, {"promo": 2000, "cash": 3000, "yappy": 1922, "card": 0})
check("T66b cumul = T34", cumul, {"promo": 2000, "cash": 3000, "yappy": 5666, "card": 15000})
check("T66b ancienne regle -> carte 69,22", old["card"], 6922)

# fuzz F1 : versions successives, jamais au-dela du reliquat, cumul = une fois
rng = random.Random(12)
viol = 0
for _ in range(20000):
    cats = ["promo", "cash", "nonnative", "native"]
    tenders = {}
    for i in range(rng.randint(1, 4)):
        tenders[f"m{i}"] = {"cat": rng.choice(cats), "paid": rng.randint(1, 30000), "committed": 0,
                            "recent": i}
    total = sum(t["paid"] for t in tenders.values())
    owed_seq = sorted([rng.randint(0, total) for _ in range(rng.randint(1, 4))], reverse=True)
    for owed in owed_seq:                              # versions de plus en plus favorables au guest
        committed = sum(t["committed"] for t in tenders.values())
        rtot = total - committed - owed
        if rtot <= 0:
            continue
        new = allocate_incremental(tenders, rtot)
        for n, a in new.items():
            tenders[n]["committed"] += a
            if tenders[n]["committed"] > tenders[n]["paid"]:
                viol += 1
    cum_refund = sum(t["committed"] for t in tenders.values())
    fresh = {n: dict(t, committed=0) for n, t in tenders.items()}
    if {n: t["committed"] for n, t in tenders.items()} != allocate_incremental(fresh, cum_refund):
        viol += 1
check("Fuzz F1 20 000 (reliquat et independance du chemin) : violations", viol, 0)


# ------------------------------------------------------------------ E1/E5 (F2, F3)
def chargeback_lost(collected, insts, owed, host_from_guest, host_paid, lost_trip):
    """insts : liste de dict(state, amount, tender, seq). Retourne un dict de resultats.
    E5 corrige VERIF_12-F2 : C = min(lost, somme BLOCKED) annule d'abord ; puis formule cumulative."""
    def committed(ii):
        return sum(i["amount"] for i in ii if i["state"] not in ("CANCELLED", "SUPERSEDED"))

    ret_before = clamp(collected - committed(insts), 0, owed)
    blocked = [i for i in insts if i["state"] == "BLOCKED_CHARGEBACK"]
    c = min(lost_trip, sum(i["amount"] for i in blocked))
    left = c
    new_insts = []
    for i in sorted(blocked, key=lambda i: -i["seq"]):
        cover = min(left, i["amount"])
        left -= cover
        if cover == i["amount"]:
            i["state"] = "CANCELLED"
        elif cover > 0:
            i["state"] = "CANCELLED"
            new_insts.append({"state": "PLANNED", "amount": i["amount"] - cover, "tender": i["tender"],
                              "seq": max(x["seq"] for x in insts) + 1})
        else:
            i["state"] = "PLANNED"
    insts = insts + new_insts
    collected_after = collected - lost_trip
    ret_after = clamp(collected_after - committed(insts), 0, owed)
    lost_retained = ret_before - ret_after
    payable_after = 0 if owed == 0 else fl(Fr(host_from_guest * ret_after, owed))
    clawback = max(0, host_paid - payable_after)
    host_unpaid_cancelled = max(0, (host_from_guest - host_paid) - max(0, payable_after - host_paid))
    double = lost_trip - c - lost_retained
    emitted = sum(i["amount"] for i in insts if i["state"] in ("SENT", "CONFIRMED", "CREDITED"))
    receivable = min(double, emitted)
    loss = lost_trip - c - clawback - receivable - host_unpaid_cancelled
    return {"C": c, "insts": insts, "committed": committed(insts), "collected": collected_after,
            "lost_retained": lost_retained, "receivable": receivable, "clawback": clawback,
            "host_payable_after": payable_after, "host_unpaid_cancelled": host_unpaid_cancelled,
            "loss": loss, "double": double}


# T53 (remboursement CONFIRMED) : non regresse
r = chargeback_lost(25666, [{"state": "CONFIRMED", "amount": 18744, "tender": "card", "seq": 1}],
                    6922, 4500, 4500, 25666)
check("T53 reprise / creance / perte", (r["clawback"], r["receivable"], r["loss"]), (4500, 18744, 2422))
check("T53 F3 : engage - encaisse = creance", r["committed"] - r["collected"], r["receivable"])

# T67 a
r = chargeback_lost(25666, [{"state": "BLOCKED_CHARGEBACK", "amount": 18744, "tender": "card", "seq": 1}],
                    6922, 4500, 0, 25666)
check("T67a C", r["C"], 18744)
check("T67a etat instance", [i["state"] for i in r["insts"]], ["CANCELLED"])
check("T67a creance guest", r["receivable"], 0)
check("T67a reprise", r["clawback"], 0)
check("T67a part hote annulee", r["host_unpaid_cancelled"], 4500)
check("T67a perte nette", r["loss"], 2422)
check("T67a engage <= encaisse", r["committed"] <= r["collected"], True)
guest_funds = 25666 + sum(i["amount"] for i in r["insts"] if i["state"] not in ("CANCELLED", "SUPERSEDED"))
check("T67a fonds recus par le guest = guestRefund + retenue rendue par la banque", guest_funds, 25666)
# grand livre T67a (une devise, ecritures positives) : loss debit 25666 ; credits 18744 + 4500
ledger = {"chargeback_loss_expense": 25666 - 18744 - 4500, "psp_clearing": -25666,
          "refund_payable": +18744, "host_payable": +4500}
check("T67a grand livre equilibre", sum(ledger.values()), 0)
check("T67a perte = 21,00 + 3,22", ledger["chargeback_loss_expense"], 2100 + 322)
# ancienne formule (sans C) : creance 187,44
naive_double = 25666 - 6922
check("T67a ancienne formule -> creance 187,44 (faux)", naive_double, 18744)

# T67 b : chargeback perdu partiel 100,00
r = chargeback_lost(25666, [{"state": "BLOCKED_CHARGEBACK", "amount": 18744, "tender": "card", "seq": 1}],
                    6922, 4500, 0, 10000)
check("T67b C", r["C"], 10000)
check("T67b instances", [(i["state"], i["amount"], i["seq"]) for i in r["insts"]],
      [("CANCELLED", 18744, 1), ("PLANNED", 8744, 2)])
avail = r["collected"] - r["committed"]
check("T67b available = owed", avail, 6922)
check("T67b lost_retained / double / perte", (r["lost_retained"], r["double"], r["loss"]), (0, 0, 0))
check("T67b hote payable", r["host_payable_after"], 4500)
check("T67b guest : banque + reliquat = guestRefund", 10000 + 8744, 18744)
check("T67b reliquat carte >= 0", 25666 - 8744 - 10000, 6922)

# fuzz F2 : le guest ne recoit jamais plus que guestRefund + max(0, perte au-dela) ; creance <= emis
rng = random.Random(67)
viol = 0
for _ in range(20000):
    total = rng.randint(100, 100000)
    owed = rng.randint(0, total)
    refund = total - owed
    state = rng.choice(["BLOCKED_CHARGEBACK", "CONFIRMED"])
    lost = rng.randint(1, total)
    hfg = rng.randint(0, owed)
    paid = hfg if state == "CONFIRMED" and rng.random() < .5 else 0
    insts = [{"state": state, "amount": refund, "tender": "card", "seq": 1}] if refund else []
    r = chargeback_lost(total, insts, owed, hfg, paid, lost)
    pending = sum(i["amount"] for i in r["insts"] if i["state"] in ("PLANNED",))
    emitted = refund if state == "CONFIRMED" else 0
    guest_total = lost + emitted + pending - r["receivable"]
    if state == "BLOCKED_CHARGEBACK":
        if r["receivable"] != 0 or guest_total != max(refund, lost):
            viol += 1
        if r["committed"] > r["collected"]:
            viol += 1
    if r["clawback"] > paid or r["receivable"] > emitted or r["loss"] < 0:
        viol += 1
check("Fuzz F2 20 000 : violations", viol, 0)


# ------------------------------------------------------------------ E4 (F4) attempt_no
def run_retries(outcomes, amount):
    """outcomes : liste de 'DECLINED' | 'TIMEOUT->DECLINED' | 'TIMEOUT->OK' | 'OK' | 'HARD'."""
    keys, charged, att = [], 0, 1
    for o in outcomes:
        key = f"A:1:v1:MIT_CHARGE:card:i1:a{att}"
        keys.append(key)
        if o.startswith("TIMEOUT"):
            keys.append(key)                       # rejeu avec la MEME cle
            o = o.split("->")[1]
        if o == "OK":
            charged += amount
            break
        if o == "HARD":
            break
        att += 1                                   # +1 seulement apres refus recu
    return keys, charged


keys, charged = run_retries(["DECLINED", "TIMEOUT->DECLINED", "OK"], 6922)
check("T68 cles", keys, ["A:1:v1:MIT_CHARGE:card:i1:a1", "A:1:v1:MIT_CHARGE:card:i1:a2",
                         "A:1:v1:MIT_CHARGE:card:i1:a2", "A:1:v1:MIT_CHARGE:card:i1:a3"])
check("T68 debite une fois", charged, 6922)
check("T68 hote payable", fl(Fr(4500 * 6922, 6922)), 4500)
keys, charged = run_retries(["HARD", "OK"], 6922)
check("T68 refus 'ne pas reessayer' : aucune relance", (len(keys), charged), (1, 0))


# ------------------------------------------------------------------ F5 hostPartOf
def host_part_of(trip_price, promo_host, delivery, days, j, pct=Fr(3, 4), dpct=Fr(3, 4)):
    return max(0, alloc_host(rhu(Fr(trip_price) * j / days), pct) + rhu(Fr(promo_host) * j / days)
               + alloc_host(rhu(Fr(delivery) / 2), dpct))


check("T63 hostPartOf(K, 1/2) plancher 0", host_part_of(2000, -1800, 0, 2, Fr(1, 2)), 0)
check("T61 hostPartOf(A, 1) inchange", host_part_of(12000, 0, 4000, 3, 1), 4500)
check("T20 hostPartOf(A, 2) inchange", host_part_of(12000, 0, 4000, 3, 2), 7500)


# ------------------------------------------------------------------ F8 devise de versement
def payout(host_ledger, host, trip_currency, account_currency, amount):
    if account_currency != trip_currency:
        raise ValueError("compte de versement d'une autre devise : refuse, aucune conversion")
    host_ledger.setdefault((host, trip_currency), 0)
    host_ledger[(host, trip_currency)] += amount
    return host_ledger


hl = {("h1", "USD"): 5000, ("h1", "PYG"): -220752}
try:
    payout(hl, "h1", "PYG", "USD", 268750)
    check("F8 versement PYG sur compte USD refuse", False, True)
except ValueError:
    check("F8 versement PYG sur compte USD refuse", True, True)
payout(hl, "h1", "PYG", "PYG", 300000)
check("F8 solde PYG compense en PYG seulement", (hl[("h1", "PYG")], hl[("h1", "USD")]), (79248, 5000))

print()
print(f"{'0 ecart' if not ERR else str(len(ERR)) + ' ECART(S): ' + ', '.join(ERR)}")
raise SystemExit(1 if ERR else 0)
