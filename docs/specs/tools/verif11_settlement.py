# VERIF_11 - implementation independante ecrite a partir du TEXTE de 08_BUSINESS_RULES.md uniquement.
# Entiers en unites mineures, Fractions exactes, aucun flottant. Temps en minutes relatives a trip.start = 0.
from fractions import Fraction as Fr
from math import floor, ceil
import random

H = 60; DAY = 24 * 60
NOSHOW_GRACE = 60; LASTMIN = 25 * H; GRACE_MIN = 29
# 25/50/150/50 USD lus en unites MAJEURES (08 ne precise pas l'unite) -> converties en cents
HOST_PENALTY = {'USD': dict(cxlEarly=2500, cxlLate=5000, hostNoShow=15000, cleanliness=5000),
                'PYG': dict(cxlEarly=200000, cxlLate=400000, hostNoShow=1200000, cleanliness=400000)}
COMP_MODE = 'TURO_MODEL'


def rhu(q):
    return floor(Fr(q) + Fr(1, 2))


def allocHost(m, pct):
    x = Fr(m) * Fr(pct)
    f = x - floor(x)
    return floor(x) if f <= Fr(1, 2) else ceil(x)


LINES = ['tripPrice', 'promoPlatform', 'promoHost', 'tripFee', 'protection', 'extras', 'enhancedRoadside',
         'additionalDriverFee', 'youngDriverFee', 'deliveryFee']
PER_DAY = ['tripPrice', 'promoPlatform', 'promoHost', 'tripFee', 'protection', 'enhancedRoadside',
           'additionalDriverFee', 'youngDriverFee']

R = {}


def row(n, q, hc='NONE', st='', pk='NONE'):
    R[n] = dict(q=q, hc=hc, st=st, pk=pk)


row('GUEST_CANCELLED', 'VOLUNTARY', st='CANCELLED_BY_GUEST')
row('GUEST_NO_SHOW', 'NO_SHOW', st='NO_SHOW_GUEST')
row('HOST_CANCELLED_DUE_TO_GUEST', 'NO_SHOW', st='NO_SHOW_GUEST')
row('PLATFORM_INCOMPLETE_STEPS', 'FAULT_PRE_START', st='CANCELLED_BY_PLATFORM')
row('GUEST_FRAUD_PROVEN', 'FAULT_PRE_START', st='CANCELLED_BY_PLATFORM')
row('HOST_CANCELLED', 'FULL', st='CANCELLED_BY_HOST', pk='HOST_CXL')
row('HOST_NO_SHOW', 'FULL', st='NO_SHOW_HOST', pk='HOST_NO_SHOW')
row('CLEANLINESS_SAFETY_VALID', 'FULL', st='REFUSED_AT_PICKUP', pk='CLEANLINESS')
row('MUTUAL_AGREEMENT_PROVEN', 'FULL', st='CANCELLED_BY_GUEST')
row('TRANSPORT_DELAY_VALID', 'FULL', hc='NO_SHOW_IF_GOOD_FAITH', st='CANCELLED_BY_GUEST')
row('EXTENUATING_CIRCUMSTANCE_APPROVED', 'FULL', st='CANCELLED_BY_GUEST')
row('PLATFORM_TRUST_SAFETY', 'FULL', hc='LATE_CXL_AFTER_FREE_WINDOW', st='CANCELLED_BY_PLATFORM')
row('HOST_ACCOUNT_CLOSED', 'FULL', st='CANCELLED_BY_PLATFORM')
row('SAFETY_RECALL', 'FULL', st='CANCELLED_BY_PLATFORM')
row('VEHICLE_RESTRICTED', 'FULL', st='CANCELLED_BY_PLATFORM')
row('SWAP_REFUSED', 'FULL', st='CANCELLED_BY_HOST')
row('PLATFORM_REVIEW_DELAY', 'FULL', hc='LATE_CXL_AFTER_FREE_WINDOW', st='CANCELLED_BY_PLATFORM')
row('PSP_FAILURE', 'FULL', hc='LATE_CXL_AFTER_FREE_WINDOW', st='CANCELLED_BY_PLATFORM')
row('RISK_SUSPENSION_UNPROVEN', 'FULL', hc='LATE_CXL_AFTER_FREE_WINDOW', st='CANCELLED_BY_PLATFORM')
row('REGIONAL_EVENT', 'FULL', st='CANCELLED_BY_PLATFORM')
row('PAYMENT_CAPTURE_FAILED', 'FULL', st='CANCELLED_BY_PLATFORM')
TERM = {'TERM_BREAKDOWN_NOT_GUEST': True, 'TERM_PLATFORM_NOT_GUEST': True, 'TERM_GUEST_FAULT': False,
        'TERM_PAYMENT_FAILURE': False, 'TERM_ACCIDENT_PENDING': False}
NO_SHOW_SUB = {'INVALID_LICENSE', 'IDENTITY_NOT_VERIFIED', 'OTHER_DRIVER_SENT', 'LICENSE_NOT_UPLOADED_1H'}
PICKUP_SUB = {'INVALID_LICENSE', 'IDENTITY_NOT_VERIFIED', 'OTHER_DRIVER_SENT'}


class Rejected(Exception):
    pass


def mk(**kw):
    t = dict(currency='USD', rateType='REFUNDABLE', days=3, start=0, bookedAt=-5 * DAY, tripPrice=0, promoPlatform=0,
             promoHost=0, tripFee=0, protection=0, extras=0, enhancedRoadside=0, additionalDriverFee=0,
             youngDriverFee=0, deliveryFee=0, taxGroups=[], hostShare=Fr(3, 4), deliveryShare=Fr(3, 4),
             extrasShare=Fr(3, 4), addDriverApproved=False, checkinValidated=False, hostMsgAt=None)
    t.update(kw)
    t['taxPaid'] = [sum(rhu(t[l] * g[0]) for l in g[1]) for g in t['taxGroups']]
    t['total'] = sum(t[l] for l in LINES) + sum(t['taxPaid'])
    return t


def lines(t):
    return [l for l in LINES if t[l] != 0]


def allLines(t):
    return {l: t[l] for l in lines(t)}


def noShowAt(t):
    return t['start'] + NOSHOW_GRACE


def freeUntil(t):
    lm = (t['start'] - t['bookedAt']) < LASTMIN
    return min(t['bookedAt'] + 60, t['start']) if lm else t['start'] - 24 * H


def qualify(t, ev):
    ev = dict(ev)
    if ev['reason'] == 'GUEST_CANCELLED' and ev['at'] >= noShowAt(t) and not t['checkinValidated']:
        ev['reason'] = 'GUEST_NO_SHOW'; ev['origin'] = 'LATE_GUEST_CANCELLATION'; return ev
    if ev['reason'] == 'HOST_CANCELLED_DUE_TO_GUEST' and not (ev.get('sub') in NO_SHOW_SUB and ev.get('evidence')):
        ev['reason'] = 'HOST_CANCELLED'; ev['origin'] = 'REQUALIFIED_NO_EVIDENCE'; return ev
    if ev['reason'] == 'GUEST_NO_SHOW' and ev['at'] < noShowAt(t) and ev.get('sub') not in PICKUP_SUB:
        raise Rejected('REJECTED_TOO_EARLY')
    return ev


def penaltyDays(t, q):
    if q == 'NO_SHOW':
        return Fr(2) if t['days'] > 2 else Fr(3, 4)
    return Fr(1) if t['days'] > 2 else Fr(1, 2)


def hostMessageTraced(t, at):
    m = t['hostMsgAt']
    return m is not None and t['start'] - H <= m <= at - 15


def hostEligible(t, r, ev):
    if ev.get('origin') == 'TERMINATION':
        return True
    if r['q'] in ('VOLUNTARY', 'FAULT_PRE_START'):
        return True
    if r['q'] == 'FULL':
        return False
    if ev['reason'] == 'HOST_CANCELLED_DUE_TO_GUEST':
        return True
    if ev.get('origin') == 'LATE_GUEST_CANCELLATION':
        return not ev.get('hostNoShowReportBefore', False)
    return hostMessageTraced(t, ev['at']) and noShowAt(t) <= ev['at'] <= t['start'] + 72 * H


def hostPartOf(t, j):
    return (allocHost(rhu(t['tripPrice'] * j / t['days']), t['hostShare'])
            + rhu(t['promoHost'] * j / t['days'])
            + allocHost(rhu(Fr(t['deliveryFee'], 2)), t['deliveryShare']))


def compensation(t, r, ev):
    if COMP_MODE == 'NONE':
        return 0
    if r['hc'] == 'LATE_CXL_AFTER_FREE_WINDOW' and ev['at'] > freeUntil(t):
        return hostPartOf(t, Fr(1) if t['days'] > 2 else Fr(1, 2))
    if r['hc'] == 'NO_SHOW_IF_GOOD_FAITH' and ev.get('goodFaith') and ev.get('goodFaithSupport'):
        return hostPartOf(t, Fr(2) if t['days'] > 2 else Fr(3, 4))
    return 0


def penalty(t, r, ev):
    f = HOST_PENALTY[t['currency']]
    if ev.get('feesWaived'):
        return 0
    if r['pk'] == 'HOST_CXL':
        return f['cxlEarly'] if (t['start'] - ev['at']) > 24 * H else f['cxlLate']
    if r['pk'] == 'HOST_NO_SHOW':
        return f['hostNoShow']
    if r['pk'] == 'CLEANLINESS':
        return f['cleanliness']
    return 0


def settle(t, r, ev, refund, hostComp, version):
    taxRefund = []
    for g, paid in zip(t['taxGroups'], t['taxPaid']):
        base = sum(t[l] for l in g[1])
        taxRefund.append(0 if base == 0 else rhu(Fr(paid) * sum(refund.get(l, 0) for l in g[1]) / base))
    retained = {l: t[l] - refund.get(l, 0) for l in lines(t)}
    g_ = lambda k: retained.get(k, 0)
    if hostEligible(t, r, ev):
        hostFrom = (allocHost(g_('tripPrice'), t['hostShare']) + g_('promoHost')
                    + allocHost(g_('deliveryFee'), t['deliveryShare']) + allocHost(g_('extras'), t['extrasShare']))
    else:
        hostFrom = 0
    s = dict(version=version, reason=ev['reason'], origin=ev.get('origin'), refund=refund, retained=retained,
             taxRefundByGroup=taxRefund, taxRefund=sum(taxRefund), retainedTax=sum(t['taxPaid']) - sum(taxRefund),
             guestRefund=sum(refund.values()) + sum(taxRefund), hostFromGuest=hostFrom, hostCompensation=hostComp,
             hostEarnings=hostFrom + hostComp, platformNet=sum(retained.values()) - (hostFrom + hostComp),
             penalty=penalty(t, r, ev), state=r['st'], total=t['total'])
    assert s['guestRefund'] + sum(retained.values()) + s['retainedTax'] == t['total'], 'balance'
    return s


def computeCancellation(t, event, version=1):
    ev = qualify(t, event); r = R[ev['reason']]
    if r['q'] == 'FULL':
        return settle(t, r, ev, allLines(t), compensation(t, r, ev), version)
    if r['q'] == 'VOLUNTARY':
        if t['rateType'] == 'NON_REFUNDABLE' and ev['at'] <= min(t['bookedAt'] + 24 * H, t['start']):
            return settle(t, r, ev, allLines(t), 0, version)
        if t['rateType'] == 'REFUNDABLE' and ev['at'] <= freeUntil(t):
            return settle(t, r, ev, allLines(t), 0, version)
    refund = {}
    if t['rateType'] == 'NON_REFUNDABLE':
        if not t['addDriverApproved'] and t['additionalDriverFee']:
            refund['additionalDriverFee'] = t['additionalDriverFee']
        return settle(t, r, ev, refund, 0, version)
    j = penaltyDays(t, r['q'])
    ret = {l: rhu(t[l] * j / t['days']) for l in ['tripPrice', 'promoPlatform', 'promoHost', 'tripFee']}
    ret['deliveryFee'] = rhu(Fr(t['deliveryFee'], 2))
    for l in lines(t):
        refund[l] = t[l] - ret.get(l, 0)
    return settle(t, r, ev, refund, 0, version)


def computeTermination(t, event, version=1):
    refundOK = TERM[event['reason']]
    used = min(t['days'], max(1, ceil(Fr(event['at'] - t['start'] - GRACE_MIN, DAY))))
    rem = t['days'] - used
    refund = {}
    if refundOK:
        for l in PER_DAY:
            if t[l] != 0:
                refund[l] = rhu(t[l] * Fr(rem, t['days']))
    ev = dict(event, origin='TERMINATION')
    r = dict(q='TERMINATION', hc='NONE', st='RETURNED', pk='NONE')
    return settle(t, r, ev, refund, 0, version)


# ---------------- Execution E1..E4 -----------------
def execute(s, collectedCum, authValid=0, mitOK=True):
    owed = s['total'] - s['guestRefund']
    out = dict(owed=owed, capture=0, mit=0, void=0, cashRefund=0, debt=0)
    if collectedCum >= owed:
        out['cashRefund'] = collectedCum - owed
    else:
        need = owed - collectedCum
        cap = min(need, authValid)
        out['capture'] = cap; out['void'] = authValid - cap
        need -= cap
        if need > 0:
            if mitOK:
                out['mit'] = need
            else:
                out['debt'] = need
    out['collectedAfter'] = collectedCum + out['capture'] + out['mit'] - out['cashRefund']
    return out


def hostPayable(s, collectedCum, owed):
    if owed == 0:
        return s['hostCompensation']   # garde division par zero : NON specifiee dans 08
    return floor(Fr(s['hostFromGuest'] * min(collectedCum, owed), owed)) + s['hostCompensation']


CAT = {'promo': 0, 'cash': 1, 'external_nonnative': 2, 'external_native': 3}


def allocateTenders(tenders, K):
    res = {}; left = K
    for tid, cat, paid, rec in sorted(tenders, key=lambda x: (CAT[x[1]], -x[3])):
        a = min(paid, left); left -= a; res[tid] = paid - a
    assert left == 0, 'retention > total des moyens'
    return res


# ---------------- Ledger -----------------
def ledger_entries(t, s, tag):
    e = []

    def E(d, c, a):
        if a:
            e.append((tag, d, c, a))
    refundHT = sum(s['refund'].values()); fee = s['retained'].get('tripFee', 0)
    E('guest_funds_held', 'refund_payable', refundHT); E('tax_payable', 'refund_payable', s['taxRefund'])
    E('guest_funds_held', 'host_payable', s['hostFromGuest']); E('guest_funds_held', 'platform_revenue_fee', fee)
    comm = sum(s['retained'].values()) - s['hostFromGuest'] - fee
    E('guest_funds_held', 'platform_revenue_commission', comm)
    E('platform_compensation_expense', 'host_payable', s['hostCompensation'])
    E('host_ledger', 'platform_penalty_revenue', s['penalty'])
    return e


def capture_entries(t):
    ht = sum(t[l] for l in LINES); tax = sum(t['taxPaid'])
    return [('cap', 'psp_clearing', 'guest_funds_held', ht), ('cap', 'psp_clearing', 'tax_payable', tax)]


def reverse(es):
    return [(tag + '_rev', c, d, a) for (tag, d, c, a) in es]


def balances(es):
    b = {}
    for _, d, c, a in es:
        b[d] = b.get(d, 0) + a; b[c] = b.get(c, 0) - a
    return b


# ---------------- Vecteurs -----------------
def A(**k):
    base = dict(days=3, tripPrice=12000, tripFee=1800, protection=3000, extras=1500, enhancedRoadside=900,
                additionalDriverFee=1500, deliveryFee=4000,
                taxGroups=[(Fr(7, 100), ['tripPrice', 'promoPlatform', 'tripFee'])])
    base.update(k)
    return mk(**base)


TA = A()
TB = mk(days=2, tripPrice=8000, tripFee=1200, protection=2000, extras=1000, enhancedRoadside=600,
        additionalDriverFee=1000, deliveryFee=4000, taxGroups=[(Fr(7, 100), ['tripPrice', 'tripFee'])])
TC = mk(rateType='NON_REFUNDABLE', bookedAt=-10 * DAY, days=3, tripPrice=10000, tripFee=1500, protection=3000,
        extras=1500, enhancedRoadside=900, additionalDriverFee=1500, deliveryFee=4000,
        taxGroups=[(Fr(7, 100), ['tripPrice', 'tripFee'])])
TCa = dict(TC); TCa['addDriverApproved'] = True
TD = mk(currency='PYG', days=3, tripPrice=1000000, tripFee=125500, protection=150000, deliveryFee=50000,
        taxGroups=[(Fr(1, 10), ['tripPrice', 'tripFee'])])
TE = mk(days=30, tripPrice=120000, tripFee=12000, taxGroups=[(Fr(7, 100), ['tripPrice', 'tripFee'])])
TAP = A(promoPlatform=-2000)
TA2G = mk(days=3, tripPrice=12000, tripFee=1800, protection=3000, extras=1500, enhancedRoadside=900,
          additionalDriverFee=1500, deliveryFee=4000,
          taxGroups=[(Fr(7, 100), ['tripPrice']), (Fr(1, 10), ['tripFee', 'deliveryFee'])])
TD2 = mk(currency='PYG', days=3, tripPrice=1000002, tripFee=125500, protection=150000, deliveryFee=50000,
         taxGroups=[(Fr(1, 10), ['tripPrice', 'tripFee'])])
TG = mk(days=2, tripPrice=1005, tripFee=1005, taxGroups=[(Fr(7, 100), ['tripPrice', 'tripFee'])])
TH = mk(days=1, tripPrice=4501, tripFee=675, protection=1200, deliveryFee=1501,
        taxGroups=[(Fr(7, 100), ['tripPrice', 'tripFee'])])


def ev(reason, at, **k):
    return dict(reason=reason, at=at, **k)


def M(t, **k):
    return dict(t, **k)


TAm = M(TA, hostMsgAt=0); TBm = M(TB, hostMsgAt=0); TDm = M(TD, hostMsgAt=0); THm = M(TH, hostMsgAt=0)

V = []


def add(i, t, e, exp, kind='c'):
    V.append((i, t, e, exp, kind))


add('T01', TA, ev('GUEST_CANCELLED', -2 * DAY), (25666, 966, 0, 0, 0))
add('T02', TA, ev('GUEST_CANCELLED', -24 * H), (25666, 966, 0, 0, 0))
add('T03', TA, ev('GUEST_CANCELLED', -10 * H), (18744, 644, 4500, 2100, 0))
add('T04', TB, ev('GUEST_CANCELLED', -10 * H), (13983, 483, 3000, 1300, 0))
add('T05', TAm, ev('GUEST_NO_SHOW', 70, origin='HOST_DECLARATION'), (13822, 322, 7500, 3700, 0))
add('T06', TAm, ev('GUEST_NO_SHOW', 72 * H, origin='SYSTEM_AUTO_72H'), (13822, 322, 7500, 3700, 0))
add('T07', TA, ev('HOST_CANCELLED_DUE_TO_GUEST', 10, sub='INVALID_LICENSE', evidence=True), (13822, 322, 7500, 3700, 0))
add('T08', TA, ev('HOST_CANCELLED_DUE_TO_GUEST', 10, sub='INVALID_LICENSE', evidence=False), (25666, 966, 0, 0, 5000))
add('T09', TBm, ev('GUEST_NO_SHOW', 70, origin='HOST_DECLARATION'), (12753, 403, 3750, 1700, 0))
add('T10', TC, ev('GUEST_CANCELLED', -10 * DAY + 5 * H), (23205, 805, 0, 0, 0))
add('T11', TCa, ev('GUEST_CANCELLED', -10 * DAY + 3 * DAY), (0, 0, 11625, 10775, 0))
add('T12', TC, ev('GUEST_CANCELLED', -10 * DAY + 3 * DAY), (1500, 0, 11625, 9275, 0))
add('T13', TC, ev('HOST_CANCELLED_DUE_TO_GUEST', 10, sub='INVALID_LICENSE', evidence=True), (1500, 0, 11625, 9275, 0))
add('T14', TA, ev('HOST_CANCELLED', -30 * H), (25666, 966, 0, 0, 2500))
add('T15', TA, ev('HOST_CANCELLED', -24 * H), (25666, 966, 0, 0, 5000))
add('T16', M(TA, bookedAt=-3 * DAY), ev('PLATFORM_INCOMPLETE_STEPS', -2 * H), (18744, 644, 4500, 2100, 0))
add('T17', TA, ev('PLATFORM_REVIEW_DELAY', -2 * H), (25666, 966, 4500, -4500, 0))
add('T18', TA, ev('PLATFORM_TRUST_SAFETY', -10 * H), (25666, 966, 4500, -4500, 0))
add('T19', TA, ev('PLATFORM_TRUST_SAFETY', -30 * H), (25666, 966, 0, 0, 0))
add('T20', TA, ev('TRANSPORT_DELAY_VALID', -10 * H, goodFaith=True, goodFaithSupport=True), (25666, 966, 7500, -7500, 0))
add('T21', TA, ev('TRANSPORT_DELAY_VALID', -10 * H, goodFaith=False), (25666, 966, 0, 0, 0))
add('T22', TA, ev('HOST_ACCOUNT_CLOSED', -10 * H), (25666, 966, 0, 0, 0))
add('T23', M(TA, bookedAt=-30), ev('GUEST_CANCELLED', 20), (18744, 644, 4500, 2100, 0))
add('T24', M(TA, bookedAt=-(24 * H + 30)), ev('GUEST_CANCELLED', -(24 * H + 30) + 50), (25666, 966, 0, 0, 0))
add('T25', TA, ev('GUEST_CANCELLED', 75), (13822, 322, 7500, 3700, 0))
add('T26', TA, ev('HOST_NO_SHOW', 31), (25666, 966, 0, 0, 15000))
add('T27', TD, ev('GUEST_CANCELLED', -10 * H), (1000367, 75033, 268750, 131416, 0))
add('T30', TE, ev('GUEST_CANCELLED', -10 * H), (136532, 8932, 3000, 1400, 0))
add('T31', TE, ev('HOST_CANCELLED', -48 * H), (141240, 9240, 0, 0, 2500))
add('T35', TAP, ev('GUEST_CANCELLED', -10 * H), (17318, 551, 4500, 1433, 0))
add('T37', TA, ev('TERM_BREAKDOWN_NOT_GUEST', 20 * H), (13444, 644, 7125, 4775, 0), 't')
add('T38', M(TCa, hostMsgAt=None), ev('GUEST_NO_SHOW', 72 * H, origin='SYSTEM_AUTO_72H'), (0, 0, 0, 22400, 0))
add('T39', TA, ev('GUEST_NO_SHOW', 72 * H, origin='SYSTEM_AUTO_72H'), (13822, 322, 0, 11200, 0))
add('T40', TD2, ev('GUEST_CANCELLED', -10 * H), (1000368, 75033, 268750, 131417, 0))
add('T41', TDm, ev('GUEST_NO_SHOW', 70, origin='HOST_DECLARATION'), (587683, 37517, 518750, 256584, 0))
add('T42', THm, ev('GUEST_NO_SHOW', 70, origin='HOST_DECLARATION'), (3335, 91, 3095, 1538, 0))
add('T43', TG, ev('GUEST_CANCELLED', -10 * H), (1613, 105, 188, 314, 0))
add('T44', TA2G, ev('GUEST_CANCELLED', -10 * H), (18980, 880, 4500, 2100, 0))
add('T45', TA, ev('GUEST_FRAUD_PROVEN', -48 * H), (18744, 644, 4500, 2100, 0))
add('T46', TC, ev('PLATFORM_INCOMPLETE_STEPS', -2 * H), (1500, 0, 11625, 9275, 0))
add('T47', TA, ev('PAYMENT_CAPTURE_FAILED', -24 * H), (25666, 966, 0, 0, 0))
add('T48', TD, ev('HOST_CANCELLED', -30 * H), (1438050, 112550, 0, 0, 200000))


def run_vec(t, e, kind):
    return computeTermination(t, e) if kind == 't' else computeCancellation(t, e)


def main():
    fails = 0; n = 0; res = {}
    for i, t, e, exp, kind in V:
        s = run_vec(t, e, kind); res[i] = s
        got = (s['guestRefund'], s['taxRefund'], s['hostEarnings'], s['platformNet'], s['penalty'])
        n += 1
        if got != exp:
            fails += 1; print('ECART', i, 'attendu', exp, 'obtenu', got)
    s1 = computeCancellation(TA, ev('HOST_CANCELLED_DUE_TO_GUEST', 10, sub='INVALID_LICENSE', evidence=False), 1)
    s2 = computeCancellation(TA, ev('HOST_CANCELLED_DUE_TO_GUEST', 10, sub='INVALID_LICENSE', evidence=True), 2)
    d = (s2['guestRefund'] - s1['guestRefund'], s2['taxRefund'] - s1['taxRefund'], s2['hostEarnings'] - s1['hostEarnings'],
         s2['platformNet'] - s1['platformNet'], s2['penalty'] - s1['penalty'])
    n += 1
    if d != (-11844, -644, 7500, 3700, -5000):
        fails += 1; print('ECART T36', d)
    s3 = res['T03']
    x = execute(s3, 0, authValid=25666); n += 1
    if not (x['owed'] == 6922 and x['capture'] == 6922 and x['void'] == 18744 and x['cashRefund'] == 0
            and hostPayable(s3, 6922, 6922) == 4500):
        fails += 1; print('ECART T28', x)
    x = execute(s3, 0, authValid=0, mitOK=False); n += 1
    if not (x['debt'] == 6922 and hostPayable(s3, 0, 6922) == 0):
        fails += 1; print('ECART T29', x)
    n += 1
    hp = hostPayable(s3, 3000, 6922)
    if hp != 1950:
        fails += 1; print('ECART T32', hp)
    ten = [('promo', 'promo', 2000, 1), ('cash', 'cash', 3000, 2), ('yappy', 'external_nonnative', 5666, 3),
           ('card', 'external_native', 15000, 4)]
    n += 1
    a = allocateTenders(ten, 25666 - 18744)
    if a != {'promo': 0, 'cash': 0, 'yappy': 3744, 'card': 15000}:
        fails += 1; print('ECART T33', a)
    n += 1
    a = allocateTenders(ten, 0)
    if a != {'promo': 2000, 'cash': 3000, 'yappy': 5666, 'card': 15000}:
        fails += 1; print('ECART T34', a)
    print('Vecteurs executes:', n, '| ecarts:', fails)
    return res


def fuzz(N=20000, seed=11):
    rnd = random.Random(seed); viol = {}

    def bad(k, info):
        viol.setdefault(k, []).append(info)
    reasons = list(R.keys())
    for _ in range(N):
        days = rnd.choice([1, 2, 3, 5, 30]); cur = rnd.choice(['USD', 'PYG'])
        t = mk(currency=cur, days=days, rateType=rnd.choice(['REFUNDABLE', 'NON_REFUNDABLE']),
               bookedAt=-rnd.choice([30, 6 * H, 24 * H + 30, 3 * DAY, 10 * DAY]),
               tripPrice=rnd.randint(500, 500000) * (1 if cur == 'USD' else 7), tripFee=rnd.randint(50, 50000),
               protection=rnd.choice([0, rnd.randint(1, 30000)]), extras=rnd.choice([0, rnd.randint(1, 9999)]),
               enhancedRoadside=rnd.choice([0, rnd.randint(1, 900)]),
               additionalDriverFee=rnd.choice([0, rnd.randint(1, 900)]),
               deliveryFee=rnd.choice([0, rnd.randint(1, 9999)]),
               promoPlatform=-rnd.choice([0, rnd.randint(1, 3000)]), promoHost=-rnd.choice([0, rnd.randint(1, 3000)]),
               addDriverApproved=rnd.random() < .5, hostMsgAt=rnd.choice([None, 0]),
               hostShare=rnd.choice([Fr(3, 4), Fr(7, 10)]),
               taxGroups=rnd.choice([[(Fr(7, 100), ['tripPrice', 'promoPlatform', 'promoHost', 'tripFee'])],
                                     [(Fr(7, 100), ['tripPrice', 'promoPlatform', 'promoHost']),
                                      (Fr(1, 10), ['tripFee', 'deliveryFee'])]]))
        if t['total'] <= 0:
            continue
        r = rnd.choice(reasons + ['TERM'])
        try:
            if r == 'TERM':
                tr = rnd.choice(list(TERM)); s = computeTermination(t, ev(tr, rnd.randint(0, days * DAY + 2 * H)))
            else:
                e = ev(r, rnd.choice([-10 * DAY, -2 * DAY, -30 * H, -24 * H, -10 * H, -30, 20, 75, 70, 72 * H]),
                       sub='INVALID_LICENSE', evidence=rnd.random() < .5, goodFaith=True, goodFaithSupport=True,
                       origin=rnd.choice(['HOST_DECLARATION', 'SYSTEM_AUTO_72H']))
                s = computeCancellation(t, e)
        except Rejected:
            continue
        except AssertionError:
            bad('balance', r); continue
        if s['guestRefund'] > t['total']: bad('refund>total', r)
        if any(v < 0 for k, v in s['refund'].items() if k not in ('promoPlatform', 'promoHost')): bad('refund_ligne_negative', r)
        if s['hostFromGuest'] < 0: bad('hostFromGuest<0', (r, s['hostFromGuest']))
        if s['hostFromGuest'] > sum(s['retained'].values()) + 1: bad('host>retained', r)
        if s['platformNet'] < 0 and s['hostCompensation'] == 0: bad('platformNet<0 sans compensation', (r, s['platformNet']))
        if s['retainedTax'] < 0 or s['taxRefund'] < 0: bad('tax<0', r)
        owed = t['total'] - s['guestRefund']
        for coll in (0, owed // 3, owed, t['total']):
            hp = hostPayable(s, coll, owed)
            if hp > s['hostEarnings']: bad('hostPayable>hostEarnings', r)
            x = execute(s, coll, 0, True)
            if x['cashRefund'] > coll: bad('cashRefund>collected', r)
            if coll >= owed and x['collectedAfter'] != owed: bad('collected_final!=owed', r)
        es = capture_entries(t) + ledger_entries(t, s, 'v1')
        b = balances(es)
        if sum(b.values()) != 0: bad('ledger_desequilibre', r)
        if b.get('guest_funds_held', 0) != 0: bad('guest_funds_held_non_solde', (r, b.get('guest_funds_held')))
        if -b.get('tax_payable', 0) != s['retainedTax'] and b.get('tax_payable', 0) != -s['retainedTax']: bad('tax_payable_residuel', r)
    return viol


def idem_check():
    s = computeCancellation(TA, ev('GUEST_CANCELLED', -10 * H), 1)
    s2 = computeCancellation(TA, ev('GUEST_CANCELLED', -10 * H), 1)
    x1 = execute(s, 25666)
    x2 = execute(s, x1['collectedAfter'])
    return s == s2, x1['cashRefund'], x2['cashRefund'], x2['capture'] + x2['mit']


if __name__ == '__main__':
    main()
    v = fuzz()
    print('Fuzz 20000 :', {k: len(x) for k, x in v.items()} or 'aucune violation')
    for k, x in v.items():
        print(' ', k, x[:2])
    print('Idempotence (pur, 1er remb, 2e remb, 2e debit):', idem_check())
    s1 = computeCancellation(TA, ev('HOST_CANCELLED_DUE_TO_GUEST', 10, sub='X', evidence=False), 1)
    s2 = computeCancellation(TA, ev('HOST_CANCELLED_DUE_TO_GUEST', 10, sub='INVALID_LICENSE', evidence=True), 2)
    es = capture_entries(TA) + ledger_entries(TA, s1, 'v1')
    es += [('exec', 'refund_payable', 'psp_clearing', s1['guestRefund'])]
    es += reverse(ledger_entries(TA, s1, 'v1')) + ledger_entries(TA, s2, 'v2')
    b = balances(es)
    print('T36 ledger: somme', sum(b.values()), '| guest_funds_held', b['guest_funds_held'],
          '| refund_payable(debit>0)', b['refund_payable'], '| host_payable', b['host_payable'],
          '| penalty_rev', b.get('platform_penalty_revenue', 0), '| host_ledger', b.get('host_ledger', 0))
