# Recalcul independant TA01-TA09 a partir du texte du PRD (unites mineures, entiers)
from fractions import Fraction as F
import math
def rhu(x): x=F(x); return int(math.floor(x+F(1,2)))
def trip(days,rent_minor):
    tax=rhu(F(rent_minor)*7/100); return rent_minor,tax,rent_minor+tax
def cancel(days,rent,j_days_charged_frac,rate=12):
    r,tax,tot=trip(days,rent)
    daily=F(r,days)
    retained=rhu(daily*j_days_charged_frac)
    refbase=r-retained
    reftax=rhu(F(tax)*refbase/r) if r else 0
    refund=refbase+reftax
    kept_tax=tax-reftax
    kept=retained+kept_tax
    comm=rhu(F(retained)*rate/100)
    return dict(total=tot,tax=tax,retained=retained,refund=refund,reftax=reftax,kept=kept,comm=comm,balance=refund+retained+kept_tax==tot)
exp={}
a=cancel(3,12000,0); print('TA01',a); assert a['refund']==12840 and a['comm']==0
a=cancel(3,12000,1); print('TA02',a); assert (a['retained'],a['refund'],a['reftax'],a['kept'],a['comm'])==(4000,8560,560,4280,480) and a['balance']
a=cancel(3,12000,2); print('TA03',a); assert (a['retained'],a['refund'],a['reftax'],a['comm'])==(8000,4280,280,960)
a=cancel(2,8000,F(1,2)); print('TA05',a); assert a['total']==8560 and (a['retained'],a['refund'],a['reftax'],a['comm'])==(2000,6420,420,240)
a=cancel(1,4501,F(1,2)); print('TA06',a); assert a['tax']==315 and (a['retained'],a['reftax'],a['refund'],a['kept'],a['comm'])==(2251,157,2407,2409,270) and a['total']==4816
# TA06 check: refbase = 4501-2251=2250; 315*2250/4501=157.46
# TA07
def billed(minutes,tol=29): return max(1,math.ceil(F(minutes-tol,1440)))
print('TA07',billed(3*1440+29),billed(3*1440+30),billed(240)); assert (billed(3*1440+29),billed(3*1440+30),billed(240))==(3,4,1)
# TA08
rents=[12000,8000,4501,4000]; c=[rhu(F(x)*12/100) for x in rents]; print('TA08',c,sum(c)); assert c==[1440,960,540,480] and sum(c)==3420
# TA04 boundaries
def agency_pen(hours_before): return 'le24h' if hours_before<=24 else 'gt24h'
print('TA04',agency_pen(30),agency_pen(24),agency_pen(24.0001))
# TA09 trivially credit cap 0
print('TA09 refus si 1000 > 0:',1000>0)
print('OK')
