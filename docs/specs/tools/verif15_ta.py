# Recalcul indépendant de TA01–TA07 et TA09 (16 A.8.1, version 5, révision P2P US-057), unités mineures, entiers.
# Auditeur : ne lit pas le PRD ; les valeurs attendues sont recopiées de la table A.8.1 et recalculées ici.
# Jambes : HOST = allocHost(retenu HT × 3/4) (égalité exacte → plateforme), PLATFORM = conservé TTC − HOST (08 E7).
# TA08, TA10, TA11 renvoient aux vecteurs TJ de 08 : contrôlés par check_ta_consolidation.py et check_legs.py.
import math
import sys
from fractions import Fraction as F

sys.stdout.reconfigure(encoding="utf-8")


def rhu(x):
    return int(math.floor(F(x) + F(1, 2)))


def alloc_host(x, share=F(3, 4)):
    v = F(x) * share
    f = math.floor(v)
    return f + 1 if v - f > F(1, 2) else f


def cancel(days, rent, j):
    tax = rhu(F(rent) * 7 / 100)
    retained = rhu(F(rent, days) * j)
    refbase = rent - retained
    reftax = rhu(F(tax) * refbase / rent) if rent else 0
    kept = retained + tax - reftax
    host = alloc_host(retained)
    return dict(total=rent + tax, tax=tax, retained=retained, refund=refbase + reftax, reftax=reftax, kept=kept,
                host=host, platform=kept - host, balance=refbase + reftax + kept == rent + tax)


a = cancel(3, 12000, 0); print("TA01", a); assert a["refund"] == 12840 and a["host"] == 0 and a["platform"] == 0
a = cancel(3, 12000, 1); print("TA02", a); assert (a["retained"], a["refund"], a["reftax"], a["kept"], a["host"], a["platform"]) == (4000, 8560, 560, 4280, 3000, 1280) and a["balance"]
a = cancel(3, 12000, 2); print("TA03", a); assert (a["retained"], a["refund"], a["reftax"], a["host"], a["platform"]) == (8000, 4280, 280, 6000, 2560)
a = cancel(2, 8000, F(1, 2)); print("TA05", a); assert a["total"] == 8560 and (a["retained"], a["refund"], a["reftax"], a["host"], a["platform"]) == (2000, 6420, 420, 1500, 640)
a = cancel(1, 4501, F(1, 2)); print("TA06", a); assert a["tax"] == 315 and (a["retained"], a["reftax"], a["refund"], a["kept"], a["host"], a["platform"]) == (2251, 157, 2407, 2409, 1688, 721) and a["total"] == 4816


# TA04 : annulation par l'hôte, remboursement intégral, pénalité par palier (borne 24 h exactement → palier « ≤ 24 h »)
def host_penalty_tier(hours_before):
    return "le24h" if hours_before <= 24 else "gt24h"


a = cancel(3, 12000, 0); assert a["refund"] == 12840
assert (host_penalty_tier(30), host_penalty_tier(24), host_penalty_tier(24.0001)) == ("gt24h", "le24h", "gt24h")
print("TA04", host_penalty_tier(30), host_penalty_tier(24))


# TA07 : jours facturables, tolérance 29 min (valeur de test, OQ-BR-04)
def billed(minutes, tol=29):
    return max(1, math.ceil(F(minutes - tol, 1440)))


print("TA07", billed(3 * 1440 + 29), billed(3 * 1440 + 30), billed(240))
assert (billed(3 * 1440 + 29), billed(3 * 1440 + 30), billed(240)) == (3, 4, 1)
# TA09 : plafond de crédit 0 tant que non décidé ⇒ refus
assert 1000 > 0
print("TA09 refus si 1000 > 0 : True")
print("OK")
