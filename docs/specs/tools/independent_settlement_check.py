"""Verification independante de BR-CXL (08_BUSINESS_RULES.md) - VERIF_09, etendue par la passe de correction VERIF_09.
Ecrit a partir du TEXTE des regles (tables BR-CXL-01/02/06/08/13/14, table de decision, couche d'execution
monetaire E1-E6), sans reprendre tools/verify_cxl_tests.py ni les noms de fonctions du pseudo-code de 08.
Arithmetique exacte (Fraction), montants entiers en unites mineures (USD x100, PYG x1).
Lancer : python -I independent_settlement_check.py
Les valeurs attendues sont recopiees des tableaux T01-T48 de 08 (calculees a la main), elles ne sont PAS
calculees ici. Temps en minutes relatives au depart T=0 (t['booked'] <= 0 = reservation avant le depart).

Changements de la passe de correction (2026-10-30) :
- taxe payee = somme des taxes de LIGNE arrondies (decision VERIF_09-m01), et non taux x base agregee ;
- lignes negatives PP (promo plateforme) et PH (promo hote) qui suivent la retention de P (VERIF_09-M02) ;
- eligibilite hote explicite (VERIF_09-M07, T25) ; fin anticipee (VERIF_09-M06) ;
- couche d'encaissement : plafonnement par l'encaisse, dette guest, part hote payable a l'encaissement,
  repartition par moyen de paiement, segments, delta de requalification (VERIF_09-M01, M02, M04) ;
- penalites par devise (PYG PROPOSE, VERIF_09-m08).
"""
from fractions import Fraction as Fr
import math
import random
import sys

NOSHOW_GRACE = 60                 # noShowGraceMinutes [NOUS]
LAST_MIN_THRESHOLD = 25 * 60      # lastMinuteThreshold [NOUS]
GRACE_MIN = 29                    # graceMinutes (BR-BOOK-03)
HR = 60
DAY = 24 * HR


def rhu(q):
    """roundHalfUp d'un rationnel (demi-unite vers +infini, aussi pour les negatifs)."""
    return math.floor(Fr(q) + Fr(1, 2))


def alloc_host(m, pct):
    """x = m*pct ; floor si frac(x) <= 1/2, sinon ceil (egalite exacte -> plateforme)."""
    x = Fr(m) * Fr(pct)
    fl = math.floor(x)
    return fl if (x - fl) <= Fr(1, 2) else fl + 1


# P trip price (liste), PP promo plateforme (<=0), PH promo hote (<=0), F trip fee, Pr protection,
# X extras, R assistance renforcee, AD cond. additionnel, D livraison
LINES = ['P', 'PP', 'PH', 'F', 'Pr', 'X', 'R', 'AD', 'D']
PER_DAY = ['P', 'PP', 'PH', 'F', 'Pr', 'R', 'AD']     # lignes journalieres (fin anticipee)


def mk_trip(name, cur, days, rate, P, F, Pr, X, R, AD, D, taxrate, share=Fr(3, 4), groups=None, PP=0, PH=0):
    t = dict(name=name, cur=cur, days=days, rate=rate, share=share, P=P, PP=PP, PH=PH, F=F, Pr=Pr, X=X, R=R,
             AD=AD, D=D)
    t['groups'] = groups or {'g': (taxrate, ['P', 'PP', 'PH', 'F'])}   # config de test : P (+promos) et F taxables
    t['taxPaid'] = {}
    for g, (rate_g, lines) in t['groups'].items():
        t['taxPaid'][g] = sum(rhu(Fr(t[l]) * Fr(rate_g)) for l in lines)   # taxe PAR LIGNE puis somme
    t['total'] = sum(t[l] for l in LINES) + sum(t['taxPaid'].values())
    t['booked'] = -5 * 24 * HR
    return t


# motif -> (qualification, type de compensation hote financee par la plateforme)
REASONS = {
    'GUEST_CANCELLED': ('VOLUNTARY', None),
    'GUEST_NO_SHOW': ('NOSHOW', None),
    'HOST_CANCELLED_DUE_TO_GUEST': ('NOSHOW', None),
    'PLATFORM_INCOMPLETE_STEPS': ('FAULT', None),
    'GUEST_FRAUD_PROVEN': ('FAULT', None),
    'HOST_CANCELLED': ('FULL', None),
    'HOST_NO_SHOW': ('FULL', None),
    'CLEANLINESS_SAFETY_VALID': ('FULL', None),
    'MUTUAL_AGREEMENT_PROVEN': ('FULL', None),
    'TRANSPORT_DELAY_VALID': ('FULL', 'GOODFAITH'),
    'EXTENUATING_CIRCUMSTANCE_APPROVED': ('FULL', None),
    'PLATFORM_TRUST_SAFETY': ('FULL', 'LATE'),
    'HOST_ACCOUNT_CLOSED': ('FULL', None),
    'SAFETY_RECALL': ('FULL', None),
    'VEHICLE_RESTRICTED': ('FULL', None),
    'SWAP_REFUSED': ('FULL', None),
    'PLATFORM_REVIEW_DELAY': ('FULL', 'LATE'),
    'PSP_FAILURE': ('FULL', 'LATE'),
    'RISK_SUSPENSION_UNPROVEN': ('FULL', 'LATE'),
    'REGIONAL_EVENT': ('FULL', None),
    'PAYMENT_CAPTURE_FAILED': ('FULL', None),
}
# fin anticipee (SM-1 TERMINATED_EARLY) : motif -> jours restants rembourses ?
TERMINATIONS = {
    'TERM_BREAKDOWN_NOT_GUEST': True,
    'TERM_PLATFORM_NOT_GUEST': True,
    'TERM_GUEST_FAULT': False,
    'TERM_PAYMENT_FAILURE': False,
    'TERM_ACCIDENT_PENDING': False,
}

PENALTY = {   # (annulation > 24 h, annulation <= 24 h, no-show hote, proprete/securite), unites majeures
    'USD': (25, 50, 150, 50),
    'PYG': (200000, 400000, 1200000, 400000),   # PROPOSE, a valider
}


def qualify(ev):
    r = ev['reason']
    if r == 'GUEST_CANCELLED' and ev['req'] >= NOSHOW_GRACE and not ev.get('checkin'):
        return 'GUEST_NO_SHOW', 'LATE_GUEST_CXL'
    if r == 'HOST_CANCELLED_DUE_TO_GUEST' and not ev.get('evidence'):
        return 'HOST_CANCELLED', None
    return r, ev.get('origin')


def eligible(qual, reason, origin, ev):
    if 'host_eligible' in ev:                      # surcharge explicite (sondes, fuzz)
        return ev['host_eligible']
    if qual != 'NOSHOW':
        return True
    if reason == 'HOST_CANCELLED_DUE_TO_GUEST':     # preuve validee
        return True
    if origin == 'LATE_GUEST_CXL':                 # le guest a lui-meme annule apres noShowAt (T25)
        return not ev.get('host_no_show_reported', False)
    return ev.get('host_msg_traced', True)         # declaration hote ou automatique : message + 15 min traces


def free_until(t):
    last_minute = (0 - t['booked']) < LAST_MIN_THRESHOLD
    return min(t['booked'] + 60, 0) if last_minute else -24 * HR


def penalty(t, reason, ev):
    p = PENALTY[t['cur']]
    if reason == 'HOST_CANCELLED':
        return p[0] if (0 - ev['req']) > 24 * HR else p[1]
    if reason == 'HOST_NO_SHOW':
        return p[2]
    if reason == 'CLEANLINESS_SAFETY_VALID':
        return p[3]
    return 0


def host_part_of(t, j):
    d = t['days']
    return (alloc_host(rhu(Fr(t['P']) * j / d), t['share']) + rhu(Fr(t['PH']) * j / d)
            + alloc_host(rhu(Fr(t['D']) / 2), t['share']))


def settle(t, refund, comp, host_ok):
    taxref = {}
    for g, (rate_g, lines) in t['groups'].items():
        paid = sum(t[l] for l in lines)
        ref = sum(refund.get(l, 0) for l in lines)
        taxref[g] = rhu(Fr(t['taxPaid'][g]) * ref / paid) if paid else 0      # garde base nulle (m02)
    retained = {l: t[l] - refund.get(l, 0) for l in LINES}
    from_guest = 0
    if host_ok:
        from_guest = (alloc_host(retained['P'], t['share']) + retained['PH'] + alloc_host(retained['D'], t['share'])
                      + alloc_host(retained['X'], t['share']))
    host = from_guest + comp
    guest = sum(refund.get(l, 0) for l in LINES) + sum(taxref.values())
    ret_tax = sum(t['taxPaid'].values()) - sum(taxref.values())
    return dict(guest=guest, tax=sum(taxref.values()), host=host, host_guest=from_guest, comp=comp,
                net=sum(retained.values()) - host, retained=sum(retained.values()), ret_tax=ret_tax, refund=refund)


def full_refund(t):
    return {l: t[l] for l in LINES}


def compute(t, ev):
    if ev['reason'] in TERMINATIONS:
        return compute_termination(t, ev)
    reason, origin = qualify(ev)
    qual, comp_kind = REASONS[reason]
    out = None
    if qual == 'FULL':
        comp = 0
        if comp_kind == 'LATE' and ev['req'] > free_until(t):
            comp = host_part_of(t, Fr(1) if t['days'] > 2 else Fr(1, 2))
        elif comp_kind == 'GOODFAITH' and ev.get('goodfaith'):
            comp = host_part_of(t, Fr(2) if t['days'] > 2 else Fr(3, 4))
        out = settle(t, full_refund(t), comp, False)
    else:
        if qual == 'VOLUNTARY':
            if t['rate'] == 'NR' and ev['req'] <= min(t['booked'] + 24 * HR, 0):
                out = settle(t, full_refund(t), 0, False)
            elif t['rate'] == 'R' and ev['req'] <= free_until(t):
                out = settle(t, full_refund(t), 0, False)
        if out is None:
            ok = eligible(qual, reason, origin, ev)
            if t['rate'] == 'NR':
                ref = {} if ev.get('ad_approved') else {'AD': t['AD']}
                out = settle(t, ref, 0, ok)
            else:
                j = (Fr(2) if t['days'] > 2 else Fr(3, 4)) if qual == 'NOSHOW' else (Fr(1) if t['days'] > 2 else Fr(1, 2))
                d = t['days']
                ret = {l: rhu(Fr(t[l]) * j / d) for l in ('P', 'PP', 'PH', 'F')}
                ret['D'] = rhu(Fr(t['D']) / 2)
                out = settle(t, {l: t[l] - ret.get(l, 0) for l in LINES}, 0, ok)
    out['pen'] = penalty(t, reason, ev)
    out['reason'] = reason
    assert out['guest'] + out['retained'] + out['ret_tax'] == t['total'], 'INVARIANT remboursement+retenu+taxe retenue'
    return out


def compute_termination(t, ev):
    d = t['days']
    used = min(d, max(1, math.ceil(Fr(ev['term_at'] - GRACE_MIN, DAY))))
    rem = d - used
    refund = {}
    if TERMINATIONS[ev['reason']]:
        refund = {l: rhu(Fr(t[l]) * rem / d) for l in PER_DAY}
    out = settle(t, refund, 0, True)
    out['pen'] = 0
    out['reason'] = ev['reason']
    out['used'] = used
    assert out['guest'] + out['retained'] + out['ret_tax'] == t['total']
    return out


# ---------- couche d'encaissement (E1) ----------
def cash(t, out, captured=0, authorized=0, capture_ok=True, mit_ok=True, later_paid=0):
    """Mouvements reels. owed = ce que le guest doit garder paye apres reglement."""
    owed = t['total'] - out['guest']
    r = dict(owed=owed, capture=0, void=0, cash_refund=0, debt=0)
    if captured >= owed:
        r['cash_refund'] = captured - owed
        r['void'] = authorized
    else:
        need = owed - captured
        if authorized >= need and capture_ok:
            r['capture'] = need
            r['void'] = authorized - need
        elif mit_ok:
            r['capture'] = need
            r['void'] = authorized
        else:
            r['debt'] = need
            r['void'] = authorized
    collected = captured + r['capture'] + later_paid
    r['debt'] = max(0, r['debt'] - later_paid)
    ratio = Fr(min(collected, owed), owed) if owed else Fr(1)
    r['host_payable'] = math.floor(out['host_guest'] * ratio) + out['comp']
    r['host_pending'] = out['host'] - r['host_payable']
    return r


# ---------- repartition par moyen de paiement (E2) ----------
ABSORB_ORDER = ['credit_promo', 'credit_cash', 'ext_nonnative', 'ext_native']


def split_refund(tenders, refund_total):
    """tenders = [(id, kind, montant, seq)] ; la retenue est absorbee dans ABSORB_ORDER,
    puis par capture la plus recente d'abord ; chaque moyen recoit (paye - absorbe)."""
    k = sum(a for _, _, a, _ in tenders) - refund_total
    assert k >= 0
    order = sorted(tenders, key=lambda x: (ABSORB_ORDER.index(x[1]), -x[3]))
    res = {}
    for tid, kind, amt, seq in order:
        take = min(amt, k)
        k -= take
        res[tid] = amt - take
    assert k == 0 and sum(res.values()) == refund_total
    return res


A = mk_trip('A', 'USD', 3, 'R', 12000, 1800, 3000, 1500, 900, 1500, 4000, Fr(7, 100))
B = mk_trip('B', 'USD', 2, 'R', 8000, 1200, 2000, 1000, 600, 1000, 4000, Fr(7, 100))
C = mk_trip('C', 'USD', 3, 'NR', 10000, 1500, 3000, 1500, 900, 1500, 4000, Fr(7, 100))
C['booked'] = -10 * 24 * HR
D = mk_trip('D', 'PYG', 3, 'R', 1000000, 125500, 150000, 0, 0, 0, 50000, Fr(1, 10))
assert (A['total'], B['total'], C['total'], D['total']) == (25666, 18444, 23205, 1438050), 'totaux des trips'
# nouveaux trips de reference (08, T28-T48)
D2 = mk_trip('D2', 'PYG', 3, 'R', 1000002, 125500, 150000, 0, 0, 0, 50000, Fr(1, 10))
E1 = mk_trip('E1', 'USD', 30, 'R', 120000, 12000, 0, 0, 0, 0, 0, Fr(7, 100))      # segment de 30 j d'un trip de 60 j
G = mk_trip('G', 'USD', 2, 'R', 1005, 1005, 0, 0, 0, 0, 0, Fr(7, 100))
H = mk_trip('H', 'USD', 1, 'R', 4501, 675, 1200, 0, 0, 0, 1501, Fr(7, 100))
AP = mk_trip('AP', 'USD', 3, 'R', 12000, 1800, 3000, 1500, 900, 1500, 4000, Fr(7, 100), PP=-2000)
A2G = mk_trip('A2G', 'USD', 3, 'R', 12000, 1800, 3000, 1500, 900, 1500, 4000, None,
              groups={'p': (Fr(7, 100), ['P', 'PP', 'PH']), 'f': (Fr(10, 100), ['F', 'D'])})
assert (D2['total'], E1['total'], G['total'], H['total'], AP['total'], A2G['total']) == \
    (1438052, 141240, 2150, 8239, 23526, 26120), 'totaux des nouveaux trips'
assert G['taxPaid']['g'] == 140 and rhu(Fr(2010) * Fr(7, 100)) == 141, 'taxe par ligne != agregee'


def bk(t, booked):
    u = dict(t)
    u['booked'] = booked
    return u


# (id, trip, evenement, attendu = (remb. guest TTC, taxes remb., gains hote, net plateforme HT, penalite majeure))
VECT = [
    ('T01', A, dict(reason='GUEST_CANCELLED', req=-2 * 1440), (25666, 966, 0, 0, 0)),
    ('T02', A, dict(reason='GUEST_CANCELLED', req=-24 * HR), (25666, 966, 0, 0, 0)),
    ('T03', A, dict(reason='GUEST_CANCELLED', req=-10 * HR), (18744, 644, 4500, 2100, 0)),
    ('T04', B, dict(reason='GUEST_CANCELLED', req=-10 * HR), (13983, 483, 3000, 1300, 0)),
    ('T05', A, dict(reason='GUEST_NO_SHOW', req=70), (13822, 322, 7500, 3700, 0)),
    ('T06', A, dict(reason='GUEST_NO_SHOW', req=72 * HR), (13822, 322, 7500, 3700, 0)),
    ('T07', A, dict(reason='HOST_CANCELLED_DUE_TO_GUEST', req=10, evidence=True), (13822, 322, 7500, 3700, 0)),
    ('T08', A, dict(reason='HOST_CANCELLED_DUE_TO_GUEST', req=10, evidence=False), (25666, 966, 0, 0, 50)),
    ('T09', B, dict(reason='GUEST_NO_SHOW', req=70), (12753, 403, 3750, 1700, 0)),
    ('T10', C, dict(reason='GUEST_CANCELLED', req=C['booked'] + 5 * HR), (23205, 805, 0, 0, 0)),
    ('T11', C, dict(reason='GUEST_CANCELLED', req=C['booked'] + 3 * 1440, ad_approved=True), (0, 0, 11625, 10775, 0)),
    ('T12', C, dict(reason='GUEST_CANCELLED', req=C['booked'] + 3 * 1440, ad_approved=False), (1500, 0, 11625, 9275, 0)),
    ('T13', C, dict(reason='HOST_CANCELLED_DUE_TO_GUEST', req=10, evidence=True, ad_approved=False), (1500, 0, 11625, 9275, 0)),
    ('T14', A, dict(reason='HOST_CANCELLED', req=-30 * HR), (25666, 966, 0, 0, 25)),
    ('T15', A, dict(reason='HOST_CANCELLED', req=-24 * HR), (25666, 966, 0, 0, 50)),
    ('T16', bk(A, -3 * 1440), dict(reason='PLATFORM_INCOMPLETE_STEPS', req=-2 * HR), (18744, 644, 4500, 2100, 0)),
    ('T17', A, dict(reason='PLATFORM_REVIEW_DELAY', req=-2 * HR), (25666, 966, 4500, -4500, 0)),
    ('T18', A, dict(reason='PLATFORM_TRUST_SAFETY', req=-10 * HR), (25666, 966, 4500, -4500, 0)),
    ('T19', A, dict(reason='PLATFORM_TRUST_SAFETY', req=-30 * HR), (25666, 966, 0, 0, 0)),
    ('T20', A, dict(reason='TRANSPORT_DELAY_VALID', req=-5 * HR, goodfaith=True), (25666, 966, 7500, -7500, 0)),
    ('T21', A, dict(reason='TRANSPORT_DELAY_VALID', req=-5 * HR, goodfaith=False), (25666, 966, 0, 0, 0)),
    ('T22', A, dict(reason='HOST_ACCOUNT_CLOSED', req=-10 * HR), (25666, 966, 0, 0, 0)),
    ('T23', bk(A, -30), dict(reason='GUEST_CANCELLED', req=20), (18744, 644, 4500, 2100, 0)),
    ('T24', bk(A, -(24 * HR + 30)), dict(reason='GUEST_CANCELLED', req=-(24 * HR + 30) + 50), (25666, 966, 0, 0, 0)),
    ('T25', A, dict(reason='GUEST_CANCELLED', req=75), (13822, 322, 7500, 3700, 0)),
    ('T26', A, dict(reason='HOST_NO_SHOW', req=31), (25666, 966, 0, 0, 150)),
    ('T27', D, dict(reason='GUEST_CANCELLED', req=-10 * HR), (1000367, 75033, 268750, 131416, 0)),
    # ---- ajoutes par la passe de correction VERIF_09 (reglement economique) ----
    ('T30', E1, dict(reason='GUEST_CANCELLED', req=-10 * HR), (136532, 8932, 3000, 1400, 0)),
    ('T31', E1, dict(reason='HOST_CANCELLED', req=-48 * HR), (141240, 9240, 0, 0, 25)),
    ('T35', AP, dict(reason='GUEST_CANCELLED', req=-10 * HR), (17318, 551, 4500, 1433, 0)),
    ('T37', A, dict(reason='TERM_BREAKDOWN_NOT_GUEST', term_at=20 * HR), (13444, 644, 7125, 4775, 0)),
    ('T38', C, dict(reason='GUEST_NO_SHOW', req=72 * HR, host_msg_traced=False, ad_approved=True), (0, 0, 0, 22400, 0)),
    ('T39', A, dict(reason='GUEST_NO_SHOW', req=72 * HR, host_msg_traced=False), (13822, 322, 0, 11200, 0)),
    ('T40', D2, dict(reason='GUEST_CANCELLED', req=-10 * HR), (1000368, 75033, 268750, 131417, 0)),
    ('T41', D, dict(reason='GUEST_NO_SHOW', req=70), (587683, 37517, 518750, 256584, 0)),
    ('T42', H, dict(reason='GUEST_NO_SHOW', req=70), (3335, 91, 3095, 1538, 0)),
    ('T43', G, dict(reason='GUEST_CANCELLED', req=-10 * HR), (1613, 105, 188, 314, 0)),
    ('T44', A2G, dict(reason='GUEST_CANCELLED', req=-10 * HR), (18980, 880, 4500, 2100, 0)),
    ('T45', A, dict(reason='GUEST_FRAUD_PROVEN', req=-48 * HR), (18744, 644, 4500, 2100, 0)),
    ('T46', C, dict(reason='PLATFORM_INCOMPLETE_STEPS', req=-2 * HR, ad_approved=False), (1500, 0, 11625, 9275, 0)),
    ('T47', A, dict(reason='PAYMENT_CAPTURE_FAILED', req=-24 * HR), (25666, 966, 0, 0, 0)),
    ('T48', D, dict(reason='HOST_CANCELLED', req=-30 * HR), (1438050, 112550, 0, 0, 200000)),
]


def run_vectors():
    bad = 0
    for tid, t, ev, exp in VECT:
        o = compute(t, ev)
        got = (o['guest'], o['tax'], o['host'], o['net'], o['pen'])
        ok = got == exp
        bad += (not ok)
        print(tid, 'OK   ' if ok else 'ECART', got, '' if ok else ('attendu %s' % (exp,)))
    return bad


def check(label, got, exp):
    ok = got == exp
    print(label, 'OK   ' if ok else 'ECART', got, '' if ok else ('attendu %s' % (exp,)))
    return 0 if ok else 1


def run_execution_vectors():
    """Vecteurs de la couche d'execution (E1-E4) : encaissement, moyens de paiement, segments, delta."""
    bad = 0
    t03 = compute(A, dict(reason='GUEST_CANCELLED', req=-10 * HR))
    # T28 : Pay now, autorisation 256,66 non capturee a T-10 h -> capture partielle du du, void du reste
    a28 = bk(A, -30 * HR)
    o28 = compute(a28, dict(reason='GUEST_CANCELLED', req=-10 * HR))
    c = cash(a28, o28, captured=0, authorized=25666)
    bad += check('T28', (o28['guest'], c['capture'], c['void'], c['cash_refund'], c['debt'], c['host_payable']),
                 (18744, 6922, 18744, 0, 0, 4500))
    # T29 : capture impossible (autorisation expiree) et debit MIT refuse -> dette guest, hote en attente
    c = cash(a28, o28, captured=0, authorized=25666, capture_ok=False, mit_ok=False)
    bad += check('T29', (c['capture'], c['cash_refund'], c['debt'], c['host_payable'], c['host_pending']),
                 (0, 0, 6922, 0, 4500))
    # T32 : dette de T29 partiellement payee (30,00) -> part hote payable au prorata, arrondi inferieur
    c = cash(a28, o28, captured=0, authorized=25666, capture_ok=False, mit_ok=False, later_paid=3000)
    bad += check('T32', (c['debt'], c['host_payable'], c['host_pending']), (3922, 1950, 2550))
    # T30 / T31 : trip de 60 j en 2 segments E1, seul le segment 1 encaisse (141 240)
    o30 = compute(E1, dict(reason='GUEST_CANCELLED', req=-10 * HR))
    c30 = cash(E1, o30, captured=E1['total'])
    o31 = compute(E1, dict(reason='HOST_CANCELLED', req=-48 * HR))
    c31 = cash(E1, o31, captured=E1['total'])
    whole = mk_trip('E60', 'USD', 60, 'R', 240000, 24000, 0, 0, 0, 0, 0, Fr(7, 100))
    old = compute(whole, dict(reason='HOST_CANCELLED', req=-48 * HR))['guest']
    bad += check('T30', (c30['cash_refund'], o30['host'], 0), (136532, 3000, 0))           # segment 2 : rien encaisse, echeance annulee
    bad += check('T31', (c31['cash_refund'], old, old > E1['total']), (141240, 282480, True))
    # T33 : moyens multiples, reglement T03 (remb. 187,44)
    ten = [('promo', 'credit_promo', 2000, 1), ('cash', 'credit_cash', 3000, 2), ('yappy', 'ext_nonnative', 5666, 3),
           ('card', 'ext_native', 15000, 4)]
    s = split_refund(ten, t03['guest'])
    bad += check('T33', (s['card'], s['yappy'], s['cash'], s['promo']), (15000, 3744, 0, 0))
    o34 = compute(A, dict(reason='HOST_CANCELLED', req=-30 * HR))
    s = split_refund(ten, o34['guest'])
    bad += check('T34', (s['card'], s['yappy'], s['cash'], s['promo'], o34['pen']), (15000, 5666, 3000, 2000, 25))
    # T36 : requalification SM-7, version 1 = T08, version 2 = T07 ; delta = v2 - v1
    v1 = compute(A, dict(reason='HOST_CANCELLED_DUE_TO_GUEST', req=10, evidence=False))
    v2 = compute(A, dict(reason='HOST_CANCELLED_DUE_TO_GUEST', req=10, evidence=True))
    delta = tuple(v2[k] - v1[k] for k in ('guest', 'tax', 'host', 'net', 'pen'))
    bad += check('T36', delta, (-11844, -644, 7500, 3700, -50))
    # T47 : rien encaisse (Pay later non debite) -> aucun mouvement
    o47 = compute(A, dict(reason='PAYMENT_CAPTURE_FAILED', req=-24 * HR))
    c = cash(A, o47, captured=0)
    bad += check('T47', (c['owed'], c['cash_refund'], c['debt'], c['capture']), (0, 0, 0, 0))
    return bad


def show(o):
    return {k: o[k] for k in ('guest', 'tax', 'host', 'net', 'retained', 'ret_tax')}


def probes():
    print('--- sondes de bord ---')
    for d in (1, 2, 3, 4):
        t = mk_trip('x', 'USD', d, 'R', 10000, 1500, 0, 0, 0, 0, 0, Fr(7, 100))
        p = compute(t, dict(reason='GUEST_CANCELLED', req=-10 * HR))
        n = compute(t, dict(reason='GUEST_NO_SHOW', req=70))
        print('jours=%d  P retenu (annulation tardive)=%d/10000  P retenu (no-show)=%d/10000'
              % (d, t['P'] - p['refund']['P'], t['P'] - n['refund']['P']))
    t = mk_trip('odd', 'USD', 3, 'R', 10001, 1501, 0, 0, 0, 0, 4001, Fr(7, 100))
    print('centimes impairs  :', show(compute(t, dict(reason='GUEST_CANCELLED', req=-10 * HR))))
    t = mk_trip('pyg', 'PYG', 2, 'R', 332501, 40000, 0, 0, 0, 0, 25001, Fr(1, 10))
    o = compute(t, dict(reason='GUEST_CANCELLED', req=-10 * HR))
    print('PYG demi-unite    :', show(o), 'P retenu', t['P'] - o['refund']['P'])
    t = mk_trip('zero', 'USD', 3, 'R', 0, 0, 3000, 0, 0, 0, 0, Fr(7, 100))
    print('base taxable nulle (garde m02) :', compute(t, dict(reason='GUEST_CANCELLED', req=-10 * HR))['guest'])
    o = compute(C, dict(reason='GUEST_NO_SHOW', req=70, host_eligible=False, ad_approved=True))
    print('NR no-show, hote non eligible : host', o['host'], 'net', o['net'])
    # biais d'allocHost (m06) : borne 1,5 unite par reglement (3 lignes)
    worst = 0
    for m in range(1, 4000):
        for pct in (Fr(7, 10), Fr(3, 4), Fr(8, 10)):
            worst = max(worst, abs(alloc_host(m, pct) - Fr(m) * pct))
    print('ecart max allocHost par ligne =', worst, '(<= 1/2, donc <= 3/2 sur P, D, Extras)')


def fuzz(n=20000, seed=7):
    rnd = random.Random(seed)
    worst = 0
    for _ in range(n):
        cur = rnd.choice(['USD', 'PYG'])
        P = rnd.randint(1000, 90000) * (1 if cur == 'USD' else 10) + rnd.randint(0, 99)
        F = rnd.randint(100, 20000) + rnd.randint(0, 99)
        t = mk_trip('f', cur, rnd.choice([1, 2, 3, 4, 7, 30]), rnd.choice(['R', 'NR']), P, F, rnd.randint(0, 9999),
                    rnd.randint(0, 5000), rnd.randint(0, 2000), rnd.randint(0, 3000), rnd.randint(0, 9999),
                    rnd.choice([Fr(7, 100), Fr(1, 10), Fr(5, 100)]),
                    share=rnd.choice([Fr(7, 10), Fr(3, 4), Fr(8, 10), Fr(9, 10)]),
                    PP=-rnd.randint(0, P // 5), PH=-rnd.randint(0, P // 10))
        t['booked'] = -rnd.randint(5, 20) * 1440
        if rnd.random() < .1:
            ev = dict(reason=rnd.choice(list(TERMINATIONS)), term_at=rnd.randint(1, t['days'] * 1440))
        else:
            ev = dict(reason=rnd.choice(list(REASONS)), req=rnd.randint(-8 * 1440, 100), goodfaith=rnd.random() < .5,
                      ad_approved=rnd.random() < .5, evidence=True, host_msg_traced=rnd.random() < .8)
        o = compute(t, ev)
        assert 0 <= o['guest'] <= t['total'], (t, ev, o)
        assert o['tax'] <= sum(t['taxPaid'].values())
        if o['reason'] in TERMINATIONS or REASONS[o['reason']][0] != 'FULL':
            # la promo plateforme retenue (PP <= 0) est un cout marketing de la plateforme : le net peut
            # devenir negatif de ce seul fait ; hors promo plateforme, la part hote ne depasse jamais le retenu
            ret_pp = t['PP'] - o['refund'].get('PP', 0)
            assert o['host'] <= o['retained'] - ret_pp and o['net'] - ret_pp >= 0, 'part hote > retenu'
        else:
            worst = min(worst, o['net'])
        # couche d'encaissement : jamais plus rembourse qu'encaisse
        cap = rnd.choice([0, t['total'], t['total'] // 2])
        c = cash(t, o, captured=cap, authorized=0, mit_ok=rnd.random() < .5)
        assert c['cash_refund'] <= cap and c['host_payable'] <= o['host'] and c['host_pending'] >= 0
    print('fuzz OK (%d cas, invariants respectes) ; pire net plateforme (motifs FULL) = %d unites mineures' % (n, worst))


if __name__ == '__main__':
    bad = run_vectors()
    bad += run_execution_vectors()
    probes()
    fuzz()
    print('\nECARTS sur T01-T48 :', bad)
    sys.exit(1 if bad else 0)
