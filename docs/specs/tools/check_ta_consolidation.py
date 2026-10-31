"""Contrôle indépendant des vecteurs TA10 et TA11 du PRD (16 A.8.1), écrit à partir du texte des règles.

Règles appliquées (texte de 08 et de 16 A.8.1, configuration P0-A) :
- loyer HT par jour = loyer / jours ; ITBMS 7 % sur le loyer seul, roundHalfUp ;
- annulation guest hors fenêtre (BR-CXL-01, BR-CXL-06) : j = 1 si durée > 2 jours ; no-show (BR-CXL-08) : j = 2 si > 2 jours ;
- retenue HT = roundHalfUp(loyer/jour × j) ; taxe remboursée au prorata de la base remboursée ; commission 12 % de la retenue HT ;
- PAY-006 (P0-A, autorisation non capturée) : capture partielle = dû TTC conservé, void = autorisé − capturé, remboursement en fonds 0 ;
- agence inéligible en P0-A (08 BR-CXL-08 variante P0-A) : REFUND_GUEST (défaut) / PROTOCOL_PENALTY / AGENCY_KEEPS.
Puis compare aux montants écrits dans les lignes TA10 / TA11 du PRD. Usage : python -I tools/check_ta_consolidation.py
"""
import math
import re
import sys
from fractions import Fraction as F
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent


def rhu(x):
    return int(math.floor(F(x) + F(1, 2)))


def money(m):
    return f"{m // 100},{m % 100:02d}"


def settle(days, rent, j):
    tax = rhu(F(rent) * 7 / 100)
    total = rent + tax
    retained = rhu(F(rent, days) * j)
    base_ref = rent - retained
    tax_ref = rhu(F(tax) * base_ref / rent)
    refund = base_ref + tax_ref
    kept_ttc = retained + (tax - tax_ref)
    comm = rhu(F(retained) * 12 / 100)
    return dict(total=total, tax=tax, retained=retained, refund=refund, tax_ref=tax_ref, kept=kept_ttc, comm=comm)


errors = []


def check(label, got, exp):
    ok = got == exp
    print(f"  {'OK ' if ok else 'KO '} {label}: {money(got)} (attendu {money(exp)})")
    if not ok:
        errors.append(label)


print("TA10 — PA1, autorisation 128,40 non capturée, annulation guest à T−10 h (j = 1)")
s = settle(3, 12000, 1)
auth = s["total"]
capture = s["kept"]
void = auth - capture
check("autorisé", auth, 12840)
check("capture partielle", capture, 4280)
check("void", void, 8560)
check("remboursement en fonds", 0, 0)
check("commission", s["comm"], 480)
check("équilibre capture + void", capture + void, auth)
check("variante capture faite : remboursement", s["refund"], 8560)

print("TA11 — PA1, no-show (j = 2), agence inéligible")
ns = settle(3, 12000, 2)
# REFUND_GUEST : retenue 0
check("REFUND_GUEST retenu", 0, 0)
check("REFUND_GUEST remboursement", ns["total"], 12840)
check("REFUND_GUEST commission", 0, 0)
# PROTOCOL_PENALTY
check("PROTOCOL_PENALTY retenu", ns["retained"], 8000)
check("PROTOCOL_PENALTY remboursement", ns["refund"], 4280)
check("PROTOCOL_PENALTY ITBMS remboursé", ns["tax_ref"], 280)
check("PROTOCOL_PENALTY conservé TTC", ns["kept"], 8560)
check("PROTOCOL_PENALTY pénalité (= retenue HT)", ns["retained"], 8000)
# AGENCY_KEEPS
check("AGENCY_KEEPS commission", ns["comm"], 960)

print("Comparaison avec le texte de 16 A.8.1")
prd = (ROOT / "16_PRODUCT_REQUIREMENTS_DOCUMENT.md").read_text(encoding="utf-8")
row = {k: re.search(rf"(?m)^\| {k} \|.*$", prd) for k in ("TA10", "TA11")}
for k, m in row.items():
    if not m:
        errors.append(f"{k} absent du PRD")
        print(f"  KO  {k} absent")
        continue
    nums = set(re.findall(r"\d+,\d{2}", m.group(0)))
    need = {"TA10": {"128,40", "42,80", "85,60", "0,00", "4,80", "40,00", "2,80"},
            "TA11": {"128,40", "8,40", "0,00", "80,00", "42,80", "2,80", "85,60", "9,60"}}[k]
    miss = need - nums
    print(f"  {'OK ' if not miss else 'KO '} {k} : montants écrits {sorted(nums)}" + (f" ; manquants {sorted(miss)}" if miss else ""))
    if miss:
        errors.append(k)
for ref in ("TA10", "TA11"):
    n = len(re.findall(rf"\b{ref}\b", prd))
    print(f"  {ref} cité {n} fois dans le PRD")
e08 = (ROOT / "08_BUSINESS_RULES.md").read_text(encoding="utf-8")
print(f"  08 cite « 16 TA11 » : {'oui' if '16 TA11' in e08 else 'non'}")
if "16 TA11" not in e08:
    errors.append("08 ne cite pas TA11")
print("RÉSULTAT :", "OK" if not errors else f"ÉCHEC {errors}")
sys.exit(1 if errors else 0)
