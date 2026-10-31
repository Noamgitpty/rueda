"""Contrôle indépendant des vecteurs T66, T67 (a/b) et T68 de 08_BUSINESS_RULES.md (VERIF_18-F11).

Écrit à partir du TEXTE des règles de 08 (pas de la logique de `check_verif12_fixes.py`) :
- E2, règle d'imputation incrémentale : refundable[m] = max(0, payé[m] − refund_committed[m] − chargeback_perdu_net[m]) ;
  K' = Σ refundable − refund_total absorbé dans l'ordre crédit promo → crédit cash → externes non natifs → externes natifs ;
  chaque moyen reçoit refundable[m] − absorbé[m] (T66) ;
- E5, chargeback perdu pendant un remboursement bloqué : C = min(lost_trip, Σ BLOCKED_CHARGEBACK) annulé d'abord,
  `refund_payable` éteint de C, reliquat d'une instance partiellement couverte recréé en PLANNED (instance_seq + 1),
  puis formule cumulative : retainedCollected = clamp(collected − refund_committed ; 0 ; owed), lost_retained = avant − après,
  double remboursement = lost_trip − C − lost_retained, créance guest seulement sur l'émis ; part hôte proportionnelle
  à la retenue encaissée restante (T67) ;
- E4, attempt_no des encaissements : + 1 seulement après un refus reçu ; un timeout rejoue la même clé (T68).
Les montants sont recalculés en unités mineures (entiers, Fraction) puis comparés aux montants écrits dans les lignes
T66–T68 de 08 (regex). Usage : python -I tools/check_t66_68.py — code retour 1 en cas d'écart.
"""
import re
import sys
from fractions import Fraction
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
TXT = (ROOT / "08_BUSINESS_RULES.md").read_text(encoding="utf-8")
errors = []


def row(t):
    m = re.search(rf"(?m)^\| {t} \|.*$", TXT)
    if not m:
        errors.append(f"{t} introuvable")
        return ""
    return m.group(0)


def amt(s):
    """'187,44' -> 18744 (unités mineures)."""
    return int(s.replace(",", ""))


def fmt(m):
    return f"{m // 100},{m % 100:02d}"


def check(label, got, exp):
    ok = got == exp
    f = lambda v: fmt(v) if isinstance(v, int) and not isinstance(v, bool) else v
    print(f"  {'OK' if ok else 'KO'} {label} : {f(got)} (attendu {f(exp)})")
    if not ok:
        errors.append(label)


def written(label, text, pattern, exp):
    """Le montant écrit (groupe 1 du motif) dans la ligne de 08 égale la valeur recalculée."""
    m = re.search(pattern, text)
    if not m:
        print(f"  KO {label} : motif absent de 08 ({pattern})")
        errors.append(label)
        return
    check(label + " [écrit dans 08]", amt(m.group(1)), exp)


def has(label, text, token):
    ok = token in text
    print(f"  {'OK' if ok else 'KO'} {label} : « {token} » {'présent' if ok else 'ABSENT'}")
    if not ok:
        errors.append(label)


# Données de base reprises du texte : T03 (owed = retenue TTC 69,22, guestRefund 187,44, hôte 45,00), T33 (moyens).
PAID = {"promo": 2000, "cash": 3000, "yappy": 5666, "card": 15000}
ORDER = ["promo", "cash", "yappy", "card"]  # crédit promo → crédit cash → externe non natif → externe natif
TOTAL = sum(PAID.values())
OWED_T03 = 6922


def impute(refund_total, committed, cb=None):
    cb = cb or {}
    refundable = {m: max(0, PAID[m] - committed.get(m, 0) - cb.get(m, 0)) for m in ORDER}
    k = sum(refundable.values()) - refund_total
    assert k >= 0
    out = {}
    for m in ORDER:
        a = min(k, refundable[m])
        k -= a
        out[m] = refundable[m] - a
    return out


# ---------------------------------------------------------------- T66
print("T66 — imputation incrémentale (E2)")
t66 = row("T66")
v1 = impute(TOTAL - OWED_T03, {})
check("T66 v1 (= T33) carte", v1["card"], 15000)
check("T66 v1 (= T33) Yappy", v1["yappy"], 3744)
committed = {m: v for m, v in v1.items() if v}
available = TOTAL - sum(committed.values())
check("T66 available", available, 6922)
written("T66 available", t66, r"`available` = 256,66 − 187,44 = (\d+,\d\d)", available)
# (a) owed = 19,22
rt_a = available - 1922
a = impute(rt_a, committed)
check("T66a complément", rt_a, 5000)
written("T66a complément", t66, r"\(a\) complément \*\*(\d+,\d\d)\*\*", rt_a)
written("T66a Yappy", t66, r"Yappy \*\*(\d+,\d\d)\*\* \(`…:v2", a["yappy"])
written("T66a cash", t66, r"crédit cash \*\*(\d+,\d\d)\*\* recréé", a["cash"])
written("T66a promo", t66, r"crédit promo \*\*(\d+,\d\d)\*\* réémis", a["promo"])
written("T66a carte", t66, r"\*\*carte (\d+,\d\d)\*\* ;", a["card"])
cumul = {m: v1[m] + a[m] for m in ORDER}
once = impute(TOTAL - 1922, {})
check("T66a cumul par moyen = imputation en une fois", cumul, once)
written("T66a cumul total", t66, r"promo 0,78 = (\d+,\d\d) = imputation", sum(cumul.values()))
# ancienne règle (K sur le payé brut) : carte sur-remboursée
old = impute(rt_a, {})
written("T66a ancienne règle : carte", t66, r"\*\*carte (\d+,\d\d)\*\* alors", old["card"])
# (b) FULL : owed = 0
b = impute(available, committed)
written("T66b complément", t66, r"\(b\) complément (\d+,\d\d) =", available)
check("T66b Yappy / cash / promo / carte", (b["yappy"], b["cash"], b["promo"], b["card"]), (1922, 3000, 2000, 0))
check("T66b cumul = T34", {m: v1[m] + b[m] for m in ORDER}, PAID)
written("T66b ancienne règle : carte de trop", t66, r"ancienne règle : carte (\d+,\d\d) de trop", impute(available, {})["card"])

# ---------------------------------------------------------------- T67
print("T67 — chargeback perdu sur remboursement bloqué (E5, SM-8)")
t67 = row("T67")
COLLECTED, BLOCKED, HOST = 25666, 18744, 4500


def chargeback(lost):
    c = min(lost, BLOCKED)
    residual = BLOCKED - c  # reliquat recréé en PLANNED (instance_seq + 1)
    committed_after = BLOCKED - c
    collected_after = COLLECTED - lost
    owed = COLLECTED - BLOCKED
    clamp = lambda x: max(0, min(x, owed))
    rc_before = clamp(COLLECTED - BLOCKED)
    rc_after = clamp(collected_after - committed_after)
    lost_retained = rc_before - rc_after
    double = lost - c - lost_retained
    issued = 0  # rien n'était émis (instance BLOCKED_CHARGEBACK)
    receivable = min(double, issued)
    host_payable = int(Fraction(HOST) * rc_after / rc_before)  # ⌊ hôte × retenue restante / retenue ⌋
    loss = lost - c - (HOST - host_payable) if lost == COLLECTED else lost_retained - (HOST - host_payable)
    return dict(C=c, residual=residual, rc_before=rc_before, rc_after=rc_after, lost_retained=lost_retained,
                double=double, receivable=receivable, host_payable=host_payable, loss=max(0, loss),
                collected_after=collected_after)


ra = chargeback(COLLECTED)
check("T67a C", ra["C"], 18744)
written("T67a C", t67, r"\(a\) C = min\(256,66 ; 187,44\) = (\d+,\d\d)", ra["C"])
written("T67a instance annulée", t67, r"`CANCELLED` \((\d+,\d\d)\)", ra["C"])
written("T67a guest_receivable", t67, r"\*\*`guest_receivable` (\d+,\d\d)\*\*", ra["receivable"])
written("T67a retainedCollected avant", t67, r"avant clamp\(256,66 − 187,44\) = (\d+,\d\d)", ra["rc_before"])
written("T67a lost_retained", t67, r"`lost_retained` (\d+,\d\d) ; double", ra["lost_retained"])
written("T67a double remboursement", t67, r"256,66 − 187,44 − 69,22 = (\d+)", ra["double"] // 100)
check("T67a part hôte payable (jamais versée)", ra["host_payable"], 0)
written("T67a perte nette", t67, r"`chargeback_loss_expense` net \*\*(\d+,\d\d)\*\*", ra["loss"])
written("T67a perte (détail)", t67, r"\(part hôte annulée\) = (\d+,\d\d)", ra["loss"])
rb = chargeback(10000)
check("T67b C", rb["C"], 10000)
written("T67b C", t67, r"\(b\) C = min\(100,00 ; 187,44\) = (\d+,\d\d)", rb["C"])
written("T67b reliquat i2", t67, r"\*\*i2 = (\d+,\d\d)\*\*", rb["residual"])
check("T67b guest reçoit en tout = guestRefund", 10000 + rb["residual"], BLOCKED)
written("T67b collected", t67, r"`collected` (\d+,\d\d), engagé", rb["collected_after"])
check("T67b lost_retained", rb["lost_retained"], 0)
check("T67b part hôte libérée", rb["host_payable"], HOST)
written("T67b perte nette", t67, r"perte nette (\d+,\d\d) \|", rb["loss"])
check("T67b reliquat carte ≥ 0", COLLECTED - rb["residual"] - 10000 >= 0, True)
for tok in ["`BLOCKED_CHARGEBACK`", "`refund_payable` éteint", "`…:v1:REFUND:card:i2:a1`", "aucun débit MIT"]:
    has("T67 jeton", t67, tok)

# ---------------------------------------------------------------- T68
print("T68 — attempt_no des débits (E4)")
t68 = row("T68")
# (jour de la tentative, réponses successives : un timeout est rejoué avec la même clé jusqu'à un statut)
events = [("J0", ["REFUS"]), ("J+3", ["TIMEOUT", "REFUS"]), ("J+7", ["ACCEPTE"])]
attempt, keys, debited, last_status = 0, [], 0, None
for day, responses in events:
    if attempt == 0 or last_status == "REFUS":  # + 1 seulement après un refus reçu (relance J+3, J+7)
        attempt += 1
    keys.append(f"a{attempt}")
    for res in responses:  # rejeu sur TIMEOUT : même clé, aucune incrémentation
        if res == "ACCEPTE":
            debited += 6922
        if res != "TIMEOUT":
            last_status = res
check("T68 clés de tentative", keys, ["a1", "a2", "a3"])
check("T68 débité une fois", debited, 6922)
written("T68 montant débité", t68, r"\*\*(\d+,\d\d) débités une fois\*\*", debited)
hp = (4500 * 6922) // 6922
written("T68 hôte payable", t68, r"hôte payable (\d+,\d\d)", hp)
for tok in ["une seule instance `MIT_CHARGE` i1", "`…:v1:MIT_CHARGE:card:i1:a1`", "`…:a2`", "`…:a3`", "la même** clé a2",
            "le *timeout* ne l'incrémente pas", "aucune relance, dette directe"]:
    has("T68 jeton", t68, tok)
has("E4 règle attempt_no des encaissements", TXT, "**`attempt_no` des encaissements**")

print("\nRÉSULTAT :", "OK" if not errors else f"{len(errors)} ÉCART(S)")
for e in errors:
    print("  -", e)
sys.exit(1 if errors else 0)
