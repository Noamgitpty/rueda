# check_t49plus.py - controle des vecteurs T49-T65 de 08_BUSINESS_RULES.md (corrections VERIF_11),
# etendu aux vecteurs T69-T73 (revise 2026-11-12, caution comme Turo, US-063) ; la ligne finale compte tous les ecarts.
# Ecrit a partir du TEXTE de 08 (E1-E5, BR-PAY-06, SM-8, section "Jeux de tests d'execution T49-T65").
# Ne modifie ni n'importe tools/verif11_settlement.py ni tools/independent_settlement_check.py.
# Entiers en unites mineures, Fractions exactes, aucun flottant. Lancer : python -I tools/check_t49plus.py
from fractions import Fraction as Fr
from math import floor, ceil

H = 60  # minutes
DAY = 24 * H
FAILS = []


def rhu(q):
    return floor(Fr(q) + Fr(1, 2))


def allocHost(m, pct):
    x = Fr(m) * Fr(pct)
    return floor(x) if x - floor(x) <= Fr(1, 2) else ceil(x)


def check(name, got, exp):
    if got != exp:
        FAILS.append((name, got, exp))
        print('ECART', name, 'obtenu', got, 'attendu', exp)
    else:
        print('OK   ', name, got)


# ---------- SM-8 / E1 ----------
NOT_COMMITTED = {'CANCELLED', 'SUPERSEDED'}
NO_FUNDS_MOVED = {'PLANNED', 'BLOCKED_CHARGEBACK', 'PENDING_CUSTOMER_CHOICE', 'PENDING_BANK_DETAILS', 'FAILED'}


class Inst:
    def __init__(self, version, op, tender, amount, state, seq=1, attempt=1):
        self.version, self.op, self.tender, self.amount, self.state = version, op, tender, amount, state
        self.seq, self.attempt = seq, attempt

    def key(self, trip='A', seg=1):
        return f'{trip}:{seg}:v{self.version}:{self.op}:{self.tender}:i{self.seq}:a{self.attempt}'


def committed(insts):
    return sum(i.amount for i in insts if i.op == 'REFUND' and i.state not in NOT_COMMITTED)


def supersede(insts, new_version):
    for i in insts:
        if i.op == 'REFUND' and i.version < new_version and i.state in NO_FUNDS_MOVED:
            i.state = 'SUPERSEDED'


def execute(collected_total, insts, owed):
    avail = collected_total - committed(insts)
    if avail >= owed:
        return dict(refund_total=avail - owed, need=0)
    return dict(refund_total=0, need=owed - avail)


def retainedCollected(collected_total, insts, owed):
    return max(0, min(collected_total - committed(insts), owed))


def hostPayable(hostFromGuest, hostComp, collected_total, insts, owed):
    if owed == 0:
        return hostComp
    return floor(Fr(hostFromGuest * retainedCollected(collected_total, insts, owed), owed)) + hostComp


def clawback(hostFromGuest, hostPaid, collected_after, insts, owed):
    after = 0 if owed == 0 else floor(Fr(hostFromGuest * retainedCollected(collected_after, insts, owed), owed))
    return max(0, hostPaid - after)


CAT = {'promo': 0, 'cash': 1, 'external_nonnative': 2, 'external_native': 3}


def allocate(tenders, K):  # E2 : (id, categorie, paye, rang de recence) ; plus recent d'abord
    res, left = {}, K
    for tid, cat, paid, rec in sorted(tenders, key=lambda x: (CAT[x[1]], -x[3])):
        a = min(paid, left)
        left -= a
        res[tid] = paid - a
    assert left == 0
    return res


# Valeurs de reglement deja verifiees (T03, T07, T08, T27 : 48/48 par les deux scripts existants)
A_TOTAL = 25666
T03 = dict(guestRefund=18744, hostFromGuest=4500)
T07 = dict(guestRefund=13822, hostFromGuest=7500)
T08 = dict(guestRefund=25666, hostFromGuest=0, penalty=5000)
D_TOTAL = 1438050
T27 = dict(guestRefund=1000367, hostFromGuest=268750)

# T49 : Yappy seul, v1 en attente, v2 remplace
insts = [Inst(1, 'REFUND', 'yappy', 25666, 'PENDING_CUSTOMER_CHOICE')]
old_rule = 25666 + (A_TOTAL - (A_TOTAL - T07['guestRefund']))  # ancienne regle : 256,66 + 138,22
supersede(insts, 2)
owed2 = A_TOTAL - T07['guestRefund']
x = execute(A_TOTAL, insts, owed2)
new = Inst(2, 'REFUND', 'yappy', x['refund_total'], 'PENDING_CUSTOMER_CHOICE')
insts.append(new)
check('T49 etat v1', insts[0].state, 'SUPERSEDED')
check('T49 remb v2 / cle / engage / ancienne regle', (x['refund_total'], new.key(), committed(insts), old_rule),
      (13822, 'A:1:v2:REFUND:yappy:i1:a1', 13822, 39488))
check('T49 hote payable / delta penalite', (hostPayable(7500, 0, A_TOTAL, insts, owed2), 0 - T08['penalty']), (7500, -5000))
assert committed(insts) <= A_TOTAL

# T50 : carte, v1 SENT
insts = [Inst(1, 'REFUND', 'card', 25666, 'SENT')]
supersede(insts, 2)
x = execute(A_TOTAL, insts, owed2)
check('T50 etat v1 / besoin', (insts[0].state, x['need'], x['refund_total']), ('SENT', 11844, 0))
mit = Inst(2, 'MIT_CHARGE', 'card', x['need'], 'PLANNED')
check('T50 cle MIT / hote avant / hote apres', (mit.key(), hostPayable(7500, 0, A_TOTAL, insts, owed2),
                                                hostPayable(7500, 0, A_TOTAL + 11844, insts, owed2)),
      ('A:1:v2:MIT_CHARGE:card:i1:a1', 0, 7500))

# T51 : rejeu avec remboursement SUBMITTED
owed1 = A_TOTAL - T03['guestRefund']
insts = [Inst(1, 'REFUND', 'card', 18744, 'SUBMITTED')]
x = execute(A_TOTAL, insts, owed1)
check('T51 rejeu', (x['refund_total'], x['need'], insts[0].key(), len(insts)), (0, 0, 'A:1:v1:REFUND:card:i1:a1', 1))

# T52 : nouvelle tentative apres FAILED (T33)
ten = [('promo', 'promo', 2000, 1), ('cash', 'cash', 3000, 2), ('yappy', 'external_nonnative', 5666, 3),
       ('card', 'external_native', 15000, 4)]
alloc = allocate(ten, owed1)
insts = [Inst(1, 'REFUND', 'card', alloc['card'], 'CONFIRMED'), Inst(1, 'REFUND', 'yappy', alloc['yappy'], 'FAILED')]
check('T52 engage pendant FAILED', committed(insts), 18744)
insts[1].attempt += 1
insts[1].state = 'SUBMITTED'
x = execute(A_TOTAL, insts, owed1)
check('T52 cle a2 / nouveau remb / engage', (insts[1].key(), x['refund_total'], committed(insts)),
      ('A:1:v1:REFUND:yappy:i1:a2', 0, 18744))

# T53 : chargeback total apres remboursement
insts = [Inst(1, 'REFUND', 'card', 18744, 'CONFIRMED')]
before = retainedCollected(A_TOTAL, insts, owed1)
after_coll = A_TOTAL - 25666
cb = clawback(4500, 4500, after_coll, insts, owed1)
lost_ret = before - retainedCollected(after_coll, insts, owed1)
check('T53 reprise / ancienne / double remb / perte', (cb, floor(Fr(4500 * 25666, 6922)), 25666 - lost_ret, lost_ret - cb),
      (4500, 16685, 18744, 2422))

# T54 : T32 puis 39,22 paye puis chargeback sur 39,22
coll = 3000 + 3922
check('T54 hote payable apres solde', hostPayable(4500, 0, coll, [], owed1), 4500)
after_coll = coll - 3922
pay_after = hostPayable(4500, 0, after_coll, [], owed1)
check('T54a reprise (lot non emis) / ancienne formule', (clawback(4500, 1950, after_coll, [], owed1), pay_after,
                                                         floor(Fr(4500 * 3922, 6922))), (0, 1950, 2549))
check('T54b reprise (lot verse)', clawback(4500, 4500, after_coll, [], owed1), 2550)

# T55 : PYG debite en USD
cap_trip, cap_chg = D_TOTAL, 20000
refund_chg = rhu(Fr(T27['guestRefund'] * cap_chg, cap_trip))
lost_trip = min(cap_trip, rhu(Fr(5000 * cap_trip, cap_chg)))
owedD = D_TOTAL - T27['guestRefund']
insts = [Inst(1, 'REFUND', 'card_usd', T27['guestRefund'], 'CONFIRMED')]
cb = clawback(268750, 268750, D_TOTAL - lost_trip, insts, owedD)
check('T55 remb USD / perdu PYG / owed / reprise / plateforme',
      (refund_chg, lost_trip, owedD, cb, lost_trip - cb), (13913, 359513, 437683, 220752, 138761))

# T56 : credit cash 200 + carte 56,66
alloc = allocate([('cash', 'cash', 20000, 1), ('card', 'external_native', 5666, 2)], owed1)
x = execute(A_TOTAL, [], owed1)
old = execute(5666, [], owed1)
check('T56 remb total / repartition / ancien besoin', (x['refund_total'], alloc, x['need'], old['need']),
      (18744, {'cash': 13078, 'card': 5666}, 0, 1256))
check('T56 hote payable', hostPayable(4500, 0, A_TOTAL, [Inst(1, 'REFUND', 'card', 5666, 'PLANNED'),
                                                       Inst(1, 'REFUND', 'cash', 13078, 'CREDITED')], owed1), 4500)


# T57-T59 : caution (temps en minutes, fin du trip = E)
def deposit(trip_min, V_min, amount, fees, notified_at_rel_end, disputed, partial_capture, safety=2 * H, auth_lead=24 * H):
    Hreq = auth_lead + trip_min + 72 * H + 0
    if Hreq > V_min:
        return dict(single=False, Hreq=Hreq)
    end = trip_min
    auth_expiry = -auth_lead + V_min
    decision = min(end + 72 * H, auth_expiry - safety) - end
    ok = (not disputed) and notified_at_rel_end + 48 * H <= decision
    x = min(fees if ok else 0, amount)
    if x > 0 and partial_capture:
        return dict(single=True, decision_h=Fr(decision, H), capture=x, void=amount - x, mit=fees - x)
    return dict(single=True, decision_h=Fr(decision, H), capture=0, void=amount, mit=fees)


check('T57', deposit(72 * H, 168 * H, 30000, 1200, 1 * H, False, True),
      dict(single=True, decision_h=70, capture=1200, void=28800, mit=0))
check('T58', deposit(72 * H, 168 * H, 30000, 1200, 1 * H, False, False),
      dict(single=True, decision_h=70, capture=0, void=30000, mit=1200))
r59 = deposit(72 * H + 25, 168 * H, 30000, 0, 0, False, True)
deposit_charge_cap_unknown = 0
check('T59 forme heures / forme jours / rail b', (r59['single'], r59['Hreq'] - 168 * H, 3 + 4 <= 7, deposit_charge_cap_unknown > 0),
      (False, 25, True, False))

# T60 : owed = 0
check('T60', hostPayable(0, 0, 0, [], 0), 0)


# T61 : compensation fail-closed
def compensation(param, hostPartOf):
    return hostPartOf if param is True else 0


hp = allocHost(4000, Fr(3, 4)) + allocHost(2000, Fr(3, 4))
check('T61', (compensation(None, hp), compensation('TURO_MODEL', hp), compensation(True, hp),
              hostPayable(0, compensation(True, hp), 0, [], A_TOTAL)), (0, 0, 4500, 4500))

# T62 : penalites en unites mineures
HOST_PENALTY = {'PA': dict(cxlEarly=2500, cxlLate=5000, hostNoShow=15000, cleanliness=5000),
                'PY': dict(cxlEarly=200000, cxlLate=400000, hostNoShow=1200000, cleanliness=400000)}
check('T62', (HOST_PENALTY['PA']['cxlEarly'], HOST_PENALTY['PY']['cxlEarly']), (2500, 200000))

# T63 : plancher hostFromGuest (trip K)
K = dict(tripPrice=2000, promoHost=-1800, tripFee=300)
days, j = 2, Fr(1, 2)
ret = {l: rhu(Fr(K[l]) * j / days) for l in K}
refund = sum(K.values()) - sum(ret.values())
raw = allocHost(ret['tripPrice'], Fr(3, 4)) + ret['promoHost']
host = max(0, raw)
check('T63 remb / hote brut / hote / net / equilibre', (refund, raw, host, sum(ret.values()) - host,
                                                       refund + sum(ret.values()) == sum(K.values())),
      (375, -75, 0, 125, True))

# T65 : fin anticipee au segment 2
P, F_, segdays, taxP, taxF = 120000, 12000, 30, 8400, 840
t = 20 * H
used = min(segdays, max(1, ceil(Fr(t - 29, DAY))))
rem = segdays - used
rP, rF = rhu(Fr(P * rem, segdays)), rhu(Fr(F_ * rem, segdays))
tax = rhu(Fr((taxP + taxF) * (rP + rF), P + F_))
host = allocHost(P - rP, Fr(3, 4))
used_wrong = min(segdays, max(1, ceil(Fr(30 * DAY + t - 29, DAY))))
check('T65 remb / taxe / hote / net / used faux', (rP + rF + tax, tax, host, (P - rP) + (F_ - rF) - host, used_wrong),
      (136532, 8932, 3000, 1400, 30))

# T64 : repli sans capture partielle
need = owed1
ops = [Inst(1, 'VOID', 'card', 25666, 'PLANNED').key(), Inst(1, 'MIT_CHARGE', 'card', need, 'PLANNED').key()]
check('T64', (ops, need, hostPayable(4500, 0, need, [], owed1)),
      (['A:1:v1:VOID:card:i1:a1', 'A:1:v1:MIT_CHARGE:card:i1:a1'], 6922, 4500))

# ---------- T69-T73 : caution conditionnelle (revise 2026-11-12, caution comme Turo, US-063) ----------
# Ecrit a partir du texte de BR-PAY-06 (« Caution conditionnelle », « Fail-closed », « Montant unique ») et de
# la section « Jeux de tests T69-T73 ». None = parametre absent ou donnee inconnue => declencheur vrai.
PROPOSED = dict(always=False, classes={'LUXE'}, age=30, age_classes={'PREMIUM', 'LUXE'}, risk=True, risk_deployed=False)


def deposit_required(p, cls, driver_ages, flagged, stage='CHECKOUT'):
    # stage 'PRE_CHECKOUT' : seuls COUNTRY et CLASS (connus du vehicule) ; AGE et RISK non evalues.
    # risk_deployed False : RISK non evalue (controle non deploye) ; None (absent) ou True : evalue, panne => vrai.
    trig = set()
    if p.get('always') is None or p['always'] is True:
        trig.add('COUNTRY')
    if p.get('classes') is None or cls is None or cls in p['classes']:
        trig.add('CLASS')
    if stage == 'PRE_CHECKOUT':
        return (len(trig) > 0, tuple(sorted(trig)))
    youngest = None if driver_ages is None or None in driver_ages else min(driver_ages)
    in_age_classes = p.get('age_classes') is None or cls is None or cls in p['age_classes']
    if in_age_classes and (p.get('age') is None or youngest is None or youngest < p['age']):
        trig.add('AGE')
    if p.get('risk_deployed') is not False:
        if p.get('risk') is None or (p['risk'] is True and (flagged is None or flagged)):
            trig.add('RISK')
    return (len(trig) > 0, tuple(sorted(trig)))


def deposit_amount(required, amounts, cls):
    # montant unique deposit_amount[pays][classe] ; absent => BLOCK (PARAM_MISSING), jamais 0
    if not required:
        return 0
    return amounts.get(cls, 'PARAM_MISSING')


# T69 : PA, STANDARD, 35 ans, aucun signal ; carburant 12,00 par MIT, 100 % hote
r69 = deposit_required(PROPOSED, 'STANDARD', [35], False)
check('T69 caution / MIT / jambe HOST / PLATFORM', (r69[0], 1200, allocHost(1200, Fr(1)), 1200 - allocHost(1200, Fr(1))),
      (False, 1200, 1200, 0))
# T70 : trip de T59 sans declencheur => mecanisme non evalue, reservation acceptee ; en LUXE = T59
r70 = deposit_required(PROPOSED, 'STANDARD', [40], False)
r59_luxe = deposit_required(PROPOSED, 'LUXE', [40], False)
check('T70 sans caution / T59 en LUXE', (r70[0], r59_luxe), (False, (True, ('CLASS',))))
# T70 c : avant le checkout, AGE et RISK inconnus ne valent pas vrai ; LUXE affiche son montant
AMT_PA_TEST = {'LUXE': 30000}
r70p = deposit_required(PROPOSED, 'PREMIUM', None, None, stage='PRE_CHECKOUT')
r70l = deposit_required(PROPOSED, 'LUXE', None, None, stage='PRE_CHECKOUT')
check('T70 c avant checkout PREMIUM / LUXE', (r70p, r70l, deposit_amount(r70l[0], AMT_PA_TEST, 'LUXE')),
      ((False, ()), (True, ('CLASS',)), 30000))
# T71 : seuil d'age strict, classes de l'age, plus jeune conducteur approuve
check('T71 a/b/c/d', (deposit_required(PROPOSED, 'PREMIUM', [29], False), deposit_required(PROPOSED, 'PREMIUM', [30], False),
                      deposit_required(PROPOSED, 'STANDARD', [22], False), deposit_required(PROPOSED, 'PREMIUM', [45, 26], False)),
      ((True, ('AGE',)), (False, ()), (False, ()), (True, ('AGE',))))
# T72 : fail-closed (PY)
DEPLOYED = dict(PROPOSED, risk_deployed=True)
r72a = deposit_required(dict(DEPLOYED, risk=None), 'STANDARD', [45], False)
r72b = deposit_required(DEPLOYED, 'STANDARD', [45], None)
r72d = deposit_required(PROPOSED, 'STANDARD', [45], None)
check('T72 a/b/c/d', (r72a, r72b, deposit_amount(r72a[0], {}, 'STANDARD'), r72d),
      ((True, ('RISK',)), (True, ('RISK',)), 'PARAM_MISSING', (False, ())))
# T73 : montant unique non cumule (PY, PYG sans decimale) ; caution imposee par le pays
AMT_PY = {'LUXE': 1500000, 'STANDARD': 500000}
r73a = deposit_required(DEPLOYED, 'LUXE', [27], True)
r73b = deposit_required(dict(PROPOSED, always=True), 'STANDARD', [45], False)
check('T73 a/b', (r73a, deposit_amount(r73a[0], AMT_PY, 'LUXE'), r73b, deposit_amount(r73b[0], AMT_PY, 'STANDARD')),
      ((True, ('AGE', 'CLASS', 'RISK')), 1500000, (True, ('COUNTRY',)), 500000))

print('T49-T65 : ecarts =', len(FAILS))
raise SystemExit(1 if FAILS else 0)
