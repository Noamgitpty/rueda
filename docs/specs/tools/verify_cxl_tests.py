from fractions import Fraction as Fr
import math
def rhu(q): q=Fr(q); return math.floor(q+Fr(1,2))
def alloc(m,pct):
    x=Fr(m)*pct; f=x-math.floor(x)
    return math.floor(x) if f<=Fr(1,2) else math.ceil(x)
H=Fr(3,4)
LINES=['P','F','Pr','X','R','AD','D']
def trip(P,F,Pr,X,R,AD,D,rate,days,taxpct,nr=False):
    t=dict(P=P,F=F,Pr=Pr,X=X,R=R,AD=AD,D=D,days=days,nr=nr)
    t['tax']=rhu(Fr(P+F)*taxpct); return t
A=trip(12000,1800,3000,1500,900,1500,4000,None,3,Fr(7,100))
B=trip(8000,1200,2000,1000,600,1000,4000,None,2,Fr(7,100))
C=trip(10000,1500,3000,1500,900,1500,4000,None,3,Fr(7,100),nr=True)
D=trip(1000000,125500,150000,0,0,0,50000,None,3,Fr(1,10))
def settle(t,refund,comp=0,elig=True):
    taxable=t['P']+t['F']; rtax=rhu(Fr(t['tax'])*(refund.get('P',0)+refund.get('F',0))/taxable)
    ret={l:t[l]-refund.get(l,0) for l in LINES}
    host=(alloc(ret['P'],H)+alloc(ret['D'],H)+alloc(ret['X'],H)) if elig else 0
    host+=comp
    g=sum(refund.values())+rtax
    tot=sum(t[l] for l in LINES)+t['tax']
    assert g+sum(ret.values())+(t['tax']-rtax)==tot
    return g,rtax,host,sum(ret.values())-host
def full(t,comp=0): return settle(t,{l:t[l] for l in LINES},comp)
def partial(t,noshow):
    d=t['days']; j=(Fr(2) if d>2 else Fr(3,4)) if noshow else (Fr(1) if d>2 else Fr(1,2))
    ret={'P':rhu(t['P']*j/d),'F':rhu(t['F']*j/d),'D':rhu(Fr(t['D'],2))}
    return settle(t,{l:t[l]-ret.get(l,0) for l in LINES})
def nr(t,adApproved): return settle(t,{} if adApproved else {'AD':t['AD']})
def hostpart(t,j): d=t['days']; return alloc(rhu(t['P']*j/d),H)+alloc(rhu(Fr(t['D'],2)),H)
tests={'T01':full(A),'T03':partial(A,False),'T04':partial(B,False),'T05':partial(A,True),'T09':partial(B,True),
'T10':full(C),'T11':nr(C,True),'T12':nr(C,False),'T17':full(A,hostpart(A,1)),'T20':full(A,hostpart(A,2)),'T27':partial(D,False)}
for k,v in tests.items(): print(k,v)
