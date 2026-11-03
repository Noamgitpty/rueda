"""Contrôle indépendant des vecteurs TA01–TA11 du PRD (16 A.8.1, version 5, révision P2P US-057).

Écrit à partir du texte des règles, pas du code testé :
- TA01–TA06 (configuration « PA1 » : ITBMS 7 % sur le loyer seul, ni trip fee ni protection) : 08 BR-CXL-01,
  BR-CXL-06 (j = 1 si > 2 jours, ½ sinon), BR-CXL-08 (no-show j = 2) ; taxe remboursée au prorata de la base
  taxable remboursée ; jambe `HOST` = allocHost(retenu HT × 3/4) (plan ESTÁNDAR, égalité exacte → plateforme) ;
  jambe `PLATFORM` = conservé TTC − `HOST` (08 E7).
- TA08, TA10, TA11 (remplacés en version 5) : renvoient aux vecteurs par jambe TJ de 08 E7. Le script relit les
  lignes TJ01, TJ02a, TJ02b, TJ03, TJ05a, TJ05b, TJ08a, TJ10b de 08, contrôle leurs invariants (Σ jambes = total,
  capture + void = autorisation, Σ variations = − remboursement) et vérifie que chaque montant cité dans la ligne
  TA correspondante de 16 figure bien dans ces lignes TJ (aucun montant inventé).
- Aucun montant de la version 4 (commission de 12 %, mandat, variante d'agence) ne doit subsister dans TA08–TA11.
Usage : python -I -X utf8 tools/check_ta_consolidation.py
"""
import math
import re
import sys
from fractions import Fraction as F
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
prd = (ROOT / "16_PRODUCT_REQUIREMENTS_DOCUMENT.md").read_text(encoding="utf-8")
s08 = (ROOT / "08_BUSINESS_RULES.md").read_text(encoding="utf-8")
errors = []


def rhu(x):
    return int(math.floor(F(x) + F(1, 2)))


def alloc_host(x, share=F(3, 4)):
    v = F(x) * share
    f = math.floor(v)
    return f + 1 if v - f > F(1, 2) else f


def money(m):
    s = "-" if m < 0 else ""
    m = abs(m)
    return f"{s}{m // 100},{m % 100:02d}"


def settle(days, rent, j):
    tax = rhu(F(rent) * 7 / 100)
    retained = rhu(F(rent, days) * j)
    base_ref = rent - retained
    tax_ref = rhu(F(tax) * base_ref / rent)
    kept = retained + tax - tax_ref
    host = alloc_host(retained)
    return dict(total=rent + tax, tax=tax, retained=retained, refund=base_ref + tax_ref, tax_ref=tax_ref,
                kept=kept, host=host, platform=kept - host)


def check(label, got, exp):
    ok = got == exp
    print(f"  {'OK ' if ok else 'KO '} {label}: {money(got)} (attendu {money(exp)})")
    if not ok:
        errors.append(label)


def ta_row(k):
    m = re.search(rf"(?m)^\| {k} \|.*$", prd)
    if not m:
        errors.append(f"{k} absent du PRD")
        return ""
    return m.group(0)


def nums(text):
    return set(re.findall(r"(?<![\d,])\d{1,3}(?:[  ]\d{3})*,\d{2}(?!\d)|(?<![\d,])\d{1,3}(?:[  ]\d{3})+(?![\d,])", text))


print("TA01–TA06 — recalcul des jambes HOST et PLATFORM (configuration PA1)")
cases = {"TA01": (3, 12000, 0), "TA02": (3, 12000, 1), "TA03": (3, 12000, 2), "TA05": (2, 8000, F(1, 2)), "TA06": (1, 4501, F(1, 2))}
expected = {  # valeurs écrites dans 16 A.8.1 (version 5)
    "TA01": dict(refund=12840, host=0, platform=0),
    "TA02": dict(retained=4000, refund=8560, tax_ref=560, kept=4280, host=3000, platform=1280),
    "TA03": dict(retained=8000, refund=4280, tax_ref=280, kept=8560, host=6000, platform=2560),
    "TA05": dict(retained=2000, refund=6420, tax_ref=420, kept=2140, host=1500, platform=640),
    "TA06": dict(retained=2251, refund=2407, tax_ref=157, kept=2409, host=1688, platform=721),
}
for k, args in cases.items():
    s = settle(*args)
    row = ta_row(k)
    for f, v in expected[k].items():
        check(f"{k} {f}", s[f], v)
        if money(v) not in row:
            errors.append(f"{k} : {money(v)} absent de la ligne du PRD")
            print(f"  KO  {k} : {money(v)} absent de la ligne du PRD")
    check(f"{k} équilibre remboursement + conservé = total", s["refund"] + s["kept"], s["total"])
row4 = ta_row("TA04")
for need in ("128,40", "host_penalty", "host_ledger"):
    if need not in row4:
        errors.append(f"TA04 : « {need} » absent")
print(f"  {'OK ' if all(n in row4 for n in ('128,40', 'host_penalty', 'host_ledger')) else 'KO '} TA04 : remboursement intégral, pénalité de l'hôte au host_ledger")

print("Lignes TJ de 08 E7")
tj = {}
for m in re.finditer(r"(?m)^\| (TJ\d{2}[a-z]?) \| [^|]* \| [^|]* \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|", s08):
    def p(x):
        x = x.strip().replace(" ", "").replace(" ", "").replace("+", "").replace("−", "-")
        return int(round(float(x.replace(",", ".")) * 100)) if "," in x else int(x)
    tj[m.group(1)] = [p(m.group(i)) for i in range(2, 7)]
for k in ("TJ01", "TJ02a", "TJ02b", "TJ03", "TJ05a", "TJ05b", "TJ08a", "TJ10b"):
    if k not in tj:
        errors.append(f"{k} absent de 08")
        print(f"  KO  {k} absent de 08")
        continue
    h, i, t, pl, tot = tj[k]
    check(f"{k} Σ jambes = total", h + i + t + pl, tot)
check("TJ03 = TJ02a (capture partielle = jambes retenues)", sum(tj["TJ03"][:4]), sum(tj["TJ02a"][:4]))
check("TA10 capture + void = autorisation (69,22 + 187,44)", tj["TJ03"][4] + (-tj["TJ02b"][4]), tj["TJ01"][4])
check("TA11 Σ variations = − remboursement 138,22", tj["TJ05b"][4], -13822)
check("TA11 jambe HOST retenue (inéligible)", tj["TJ05a"][0], 0)

print("Montants cités par TA08, TA10, TA11 : tous issus des lignes TJ")
for k, refs in {"TA08": ("TJ01", "TJ02a", "TJ02b", "TJ08a", "TJ08b", "TJ10a", "TJ10b", "TJ10c"),
                "TA10": ("TJ01", "TJ02a", "TJ02b", "TJ03"),
                "TA11": ("TJ01", "TJ05a", "TJ05b")}.items():
    row = ta_row(k)
    allowed = set()
    for r in refs:
        line = re.search(rf"(?m)^\| {r} \|.*$", s08)
        if line:
            allowed |= {n.replace(" ", " ") for n in nums(line.group(0))}
    used = {n.replace(" ", " ") for n in nums(row)}
    allowed |= {"0,00"}
    extra = sorted(used - allowed)
    print(f"  {'OK ' if not extra else 'KO '} {k} : {len(used)} montants cités" + (f" ; hors TJ : {extra}" if extra else ""))
    if extra:
        errors.append(f"{k} montants hors TJ")
    for v4 in ("4,80", "9,60", "34,20", "commission 12", "REFUND_GUEST", "AGENCY_KEEPS"):
        if v4 in row and "sans objet" not in row.split(v4)[0][-200:]:
            errors.append(f"{k} cite encore « {v4} » (version 4)")
            print(f"  KO  {k} cite encore « {v4} »")
print("RÉSULTAT :", "OK" if not errors else f"ÉCHEC {errors}")
sys.exit(1 if errors else 0)
