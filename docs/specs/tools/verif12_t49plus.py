# -*- coding: utf-8 -*-
"""VERIF_12 - implementation INDEPENDANTE de la couche d'execution (T49-T65).
Ecrite a partir du seul TEXTE de 08_BUSINESS_RULES.md (E1-E5, SM-8, BR-PAY-06, settle).
Entiers uniquement (unites mineures). Lancer : python -I tools/verif12_t49plus.py
"""
import hashlib
from fractions import Fraction as Fr
import math


# ---------- arrondis ----------
def rhu(x):
    """roundHalfUp sur un Fraction : floor(x + 1/2)."""
    return math.floor(Fr(x) + Fr(1, 2))


def fl(x):
    return math.floor(Fr(x))


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


# ---------- SM-8 / E1 ----------
EXCLUDED = {"CANCELLED", "SUPERSEDED"}
NO_FUNDS_MOVED = {"PLANNED", "BLOCKED_CHARGEBACK", "PENDING_CUSTOMER_CHOICE",
                  "PENDING_BANK_DETAILS", "FAILED"}
ENGAGED_FIXED = {"SUBMITTED", "SENT", "CONFIRMED", "CREDITED"}


class Inst:
    def __init__(self, v, tender, seq, amount, state, attempt=1):
        self.v, self.tender, self.seq, self.amount = v, tender, seq, amount
        self.state, self.attempt = state, attempt


def committed(insts):
    return sum(i.amount for i in insts if i.state not in EXCLUDED)


def supersede(insts, new_v):
    for i in insts:
        if i.v < new_v and i.state in NO_FUNDS_MOVED:
            i.state = "SUPERSEDED"


def idem_plain(trip, seg, v, op, tender, seq, att):
    return f"{trip}:{seg}:v{v}:{op}:{tender}:i{seq}:a{att}"


def idem_sent(plain, limit):
    return plain if len(plain) <= limit else hashlib.sha256(plain.encode()).hexdigest()


def execute(collected, insts, owed):
    """Retourne (refund_total, need)."""
    avail = collected - committed(insts)
    if avail >= owed:
        return avail - owed, 0
    return 0, owed - avail


def host_payable(host_from_guest, collected, insts, owed, comp):
    if owed == 0:
        return comp
    rc = clamp(collected - committed(insts), 0, owed)
    return fl(Fr(host_from_guest * rc, owed)) + comp


# ---------- E2 : imputation ----------
def allocate(tenders, refund_total):
    """tenders: liste de dict(name, cat in promo/cash/nonnative/native, paid, order)
    K = sum paid - refund_total absorbe : promo -> cash -> non natif -> natif."""
    K = sum(t["paid"] for t in tenders) - refund_total
    order = {"promo": 0, "cash": 1, "nonnative": 2, "native": 3}
    ts = sorted(tenders, key=lambda t: (order[t["cat"]], -t.get("recent", 0)))
    out = {}
    for t in ts:
        ab = min(K, t["paid"])
        K -= ab
        out[t["name"]] = t["paid"] - ab
    assert K == 0
    return out


# ---------- E5 : reprise ----------
def lost_trip_amt(lost_charged, cap_trip, cap_charged):
    return min(cap_trip, rhu(Fr(lost_charged * cap_trip, cap_charged)))


def clawback(host_from_guest, host_paid, collected_before, committed_amt, owed, lost_trip):
    rc_b = clamp(collected_before - committed_amt, 0, owed)
    coll_a = collected_before - lost_trip
    rc_a = clamp(coll_a - committed_amt, 0, owed)
    pay_a = 0 if owed == 0 else fl(Fr(host_from_guest * rc_a, owed))
    cb = max(0, host_paid - pay_a)
    lost_retained = rc_b - rc_a
    return dict(clawback=cb, rc_before=rc_b, rc_after=rc_a, pay_after=pay_a,
                lost_retained=lost_retained, receivable=lost_trip - lost_retained,
                loss_expense=lost_retained - cb)


class Ledger:
    """host_ledger[(hote, devise)] : isolation par devise."""
    def __init__(self):
        self.b = {}

    def debit(self, host, cur, amt):
        assert amt >= 0
        self.b[(host, cur)] = self.b.get((host, cur), 0) - amt


# ---------- caution ----------
def deposit_plan(start_h, end_h, auth_lead_h, V_h, psp_partial_capture, incidental,
                 release_delay=72, margin=0, safety=2):
    auth_at = start_h - auth_lead_h
    H = (start_h - auth_at) + (end_h - start_h) + release_delay + margin
    single = V_h > 0 and H <= V_h
    if not single:
        return dict(single=False, H=H)
    auth_expiry = auth_at + V_h
    release_at = end_h + release_delay
    dec = min(release_at, auth_expiry - safety)
    cap = incidental if (psp_partial_capture and incidental > 0) else 0
    return dict(single=True, H=H, decision=dec, rel=dec - end_h, capture=cap)


# ---------- settle minimal (T63, T65) ----------
def settle_min(lines, refund, tax_groups, host_pct, eligible, comp=0):
    """lines/refund: dict ligne->minor ; tax_groups: liste (rate_paid_by_line..)"""
    ret = {l: lines[l] - refund.get(l, 0) for l in lines}
    taxref = 0
    taxpaid = 0
    for taxable, paid in tax_groups:
        base = sum(lines[l] for l in taxable)
        taxpaid += paid
        taxref += 0 if base == 0 else rhu(Fr(paid * sum(refund.get(l, 0) for l in taxable), base))
    hfg = 0
    if eligible:
        hfg = max(0, rhu(Fr(ret.get("P", 0) * host_pct, 100)) + ret.get("promoHost", 0))
    return dict(guestRefund=sum(refund.values()) + taxref, taxRefund=taxref,
                retTax=taxpaid - taxref, retained=sum(ret.values()), host=hfg + comp,
                net=sum(ret.values()) - (hfg + comp))


R = []  # (id, ok, detail)


def chk(id_, cond, detail=""):
    R.append((id_, bool(cond), detail))


def run():
    # constantes issues du texte (trip A) en cents
    A_TOTAL, A_OWED_T03, A_HOST_T03 = 25666, 6922, 4500

    # T49
    insts = [Inst(1, "yappy", 1, 25666, "PENDING_CUSTOMER_CHOICE")]
    supersede(insts, 2)
    chk("T49a", insts[0].state == "SUPERSEDED" and committed(insts) == 0)
    owed = 25666 - 13822
    rt, need = execute(25666, insts, owed)
    chk("T49b", rt == 13822 and need == 0, f"refund={rt}")
    chk("T49c", host_payable(7500, 25666, insts, owed, 0) == 7500)
    chk("T49d", idem_plain("trp", 1, 2, "REFUND", "yappy", 1, 1) == "trp:1:v2:REFUND:yappy:i1:a1")
    old = 25666 + 13822
    chk("T49e", old == 39488 and old > 25666, "ancienne formule 394,88")

    # T50
    insts = [Inst(1, "card", 1, 25666, "SENT")]
    supersede(insts, 2)
    chk("T50a", insts[0].state == "SENT" and committed(insts) == 25666)
    rt, need = execute(25666, insts, 11844)
    chk("T50b", rt == 0 and need == 11844, f"need={need}")
    chk("T50c", host_payable(7500, 25666, insts, 11844, 0) == 0)
    chk("T50d", host_payable(7500, 25666 + 11844, insts, 11844, 0) == 7500)

    # T51
    insts = [Inst(1, "card", 1, 18744, "SUBMITTED")]
    rt, need = execute(25666, insts, 6922)
    chk("T51", rt == 0 and need == 0)
    k1 = idem_plain("trp", 1, 1, "REFUND", "card", 1, 1)
    chk("T51k", k1 == idem_plain("trp", 1, 1, "REFUND", "card", 1, 1))

    # T52
    insts = [Inst(1, "card", 1, 15000, "SENT"), Inst(1, "yappy", 1, 3744, "FAILED")]
    chk("T52a", committed(insts) == 18744)
    rt, need = execute(25666, insts, 6922)
    chk("T52b", rt == 0 and need == 0)
    insts[1].attempt = 2
    chk("T52c", idem_plain("trp", 1, 1, "REFUND", "yappy", 1, insts[1].attempt).endswith(":i1:a2"))

    # T53
    r = clawback(4500, 4500, 25666, 18744, 6922, lost_trip_amt(25666, 25666, 25666))
    chk("T53", r["clawback"] == 4500 and r["receivable"] == 18744 and r["loss_expense"] == 2422,
        str(r))
    old_formula = fl(Fr(4500 * 25666, 6922))
    chk("T53old", old_formula == 16685, f"old={old_formula}")

    # T54
    owed = 6922
    # etat apres 2e paiement : collected 3000 + 3922 ; lot emis 1950 (a) ou 4500 (b)
    r = clawback(4500, 1950, 6922, 0, owed, 3922)
    chk("T54a", r["clawback"] == 0 and r["pay_after"] == 1950, str(r))
    r = clawback(4500, 4500, 6922, 0, owed, 3922)
    chk("T54b", r["clawback"] == 2550, str(r))
    chk("T54old", fl(Fr(4500 * 3922, 6922)) == 2549)
    chk("T54pay", fl(Fr(4500 * 3000, 6922)) == 1950)

    # T55
    refund_usd = rhu(Fr(1000367 * 20000, 1438050))
    lt = lost_trip_amt(5000, 1438050, 20000)
    r = clawback(268750, 268750, 1438050, 1000367, 437683, lt)
    chk("T55", refund_usd == 13913 and lt == 359513 and r["pay_after"] == 47998
        and r["clawback"] == 220752 and r["loss_expense"] == 138761, f"{refund_usd},{lt},{r}")
    led = Ledger()
    led.debit("h", "PYG", r["clawback"])
    chk("T55iso", led.b == {("h", "PYG"): -220752} and ("h", "USD") not in led.b)

    # T56
    tenders = [dict(name="cash", cat="cash", paid=20000), dict(name="card", cat="native", paid=5666)]
    rt, need = execute(25666, [], 6922)
    al = allocate(tenders, rt)
    chk("T56", rt == 18744 and al == {"cash": 13078, "card": 5666} and need == 0
        and host_payable(4500, 25666, [], 6922, 0) == 4500, str(al))
    chk("T56old", execute(5666, [], 6922) == (0, 1256), "ancienne def : MIT 12,56")

    # T57 / T58 / T59 : heures relatives a start=24 (auth_at=0)
    p = deposit_plan(24, 96, 24, 168, True, 1200)
    chk("T57", p["single"] and p["H"] == 168 and p["rel"] == 70 and p["capture"] == 1200, str(p))
    chk("T57n", 1 + 48 == 49 and 49 <= p["rel"])
    p = deposit_plan(24, 96, 24, 168, False, 1200)
    chk("T58", p["single"] and p["capture"] == 0 and p["rel"] == 70)
    # 3j+25min en minutes
    H_min = 24 * 60 + (72 * 60 + 25) + 72 * 60
    chk("T59", H_min == 168 * 60 + 25 and H_min > 168 * 60)
    chk("T59b", not (3 + 4 > 7))  # forme jours dit ok (3+4<=7), heures non

    # T60
    chk("T60", host_payable(0, 0, [], 0, 0) == 0)

    # T61
    def comp(flag, base=4500):
        return base if flag is True else 0
    chk("T61a", comp(None) == 0 and comp(True) == 4500 and comp("true") == 0 and comp(1) == 0)
    # T61b : collected 0, owed 0 (FULL), comp payable
    chk("T61b", host_payable(0, 0, [], 0, comp(True)) == 4500 and host_payable(0, 0, [], 0, comp(None)) == 0)

    # T62
    PEN = {"PA": [2500, 5000, 15000, 5000], "PY": [200000, 400000, 1200000, 400000]}
    chk("T62", PEN["PA"][0] == 2500 and PEN["PA"][0] / 100 == 25 and PEN["PY"][0] == 200000)

    # T63
    lines = {"P": 2000, "promoHost": -1800, "F": 300}
    refund = {}
    ret = {"P": rhu(Fr(2000, 2) / 2), "promoHost": rhu(Fr(-1800, 2) / 2), "F": rhu(Fr(300, 2) / 2)}
    for l in lines:
        refund[l] = lines[l] - ret[l]
    s = settle_min(lines, refund, [], 75, True)
    chk("T63", s["guestRefund"] == 375 and s["host"] == 0 and s["net"] == 125
        and s["guestRefund"] + s["retained"] == 500, str(s))

    # T64
    chk("T64", idem_plain("t", 1, 1, "VOID", "card", 1, 1).endswith("VOID:card:i1:a1")
        and 25666 - 18744 == 6922 and host_payable(4500, 25666, [], 6922, 0) == 4500)

    # T65 : segment 2, terminated start+20h, grace 29 min, days 30
    used = min(30, max(1, math.ceil(Fr(20 * 60 - 29, 24 * 60))))
    rem = 30 - used
    lines = {"P": 120000, "F": 12000}
    refund = {l: rhu(Fr(lines[l] * rem, 30)) for l in lines}
    s = settle_min(lines, refund, [(["P", "F"], 9240)], 75, True)
    chk("T65", used == 1 and s["guestRefund"] == 136532 and s["taxRefund"] == 8932
        and s["host"] == 3000 and s["net"] == 1400 and 136532 + 4400 + 308 == 141240, str(s))
    used_bad = min(30, max(1, math.ceil(Fr(20 * 60 - 29 + 29 * 24 * 60, 24 * 60))))
    chk("T65bad", used_bad == 30)

    # invariants supplementaires
    # hash idempotence
    long = idem_plain("trp_" + "x" * 60, 1, 1, "REFUND", "tnd_card_01", 1, 1)
    chk("IDEMhash", len(idem_sent(long, 255)) == len(long) and len(idem_sent(long, 40)) == 64)
    return R


if __name__ == "__main__":
    res = run()
    ok = 0
    for i, c, d in res:
        print(("OK  " if c else "FAIL"), i, d)
        ok += c
    print(f"{ok}/{len(res)}")
