import csv,re,sys,collections
R='.'
def rd(f): return open(f,encoding='utf-8').read()
prd=rd('16_PRODUCT_REQUIREMENTS_DOCUMENT.md')
rows=list(csv.DictReader(open('04_FEATURE_INVENTORY.csv',encoding='utf-8')))
print('rows',len(rows),collections.Counter(r['phase_mvp'] for r in rows),collections.Counter(r['priorite_produit'] for r in rows))
p0={r['feature_id']:r for r in rows if r['priorite_produit']=='P0'}
print('P0',len(p0))
# split parts
iB=prd.index('# PARTIE B'); iC=prd.index('# PARTIE C'); iD=prd.index('# PARTIE D')
B=prd[iB:iC]; C=prd[iC:iD]; D=prd[iD:]
H=['FEATURE ID','Nom','Module','Persona','Objectif','Description','Déclencheur','Prérequis','Parcours principal','Parcours alternatifs','Règles métier','États','Erreurs','Données','Notifications','Permissions','Dépendances',"Critères d'acceptation",'Source','Confiance','Priorité produit','Bêta pilote','Complexité','Améliorations possibles']
sheets=re.split(r'(?m)^#### ',B)[1:]
print('sheets',len(sheets))
bad=[];cov=set();sheetids={}
for s in sheets:
    title=s.split('\n')[0]
    heads=re.findall(r'(?m)^- \*\*([^*]+)\*\* :',s)
    if heads!=H: bad.append((title,[h for h in H if h not in heads],[h for h in heads if h not in H], len(heads)))
    m=re.search(r'- \*\*FEATURE ID\*\* : (.*)',s)
    ids=re.findall(r'[A-Z0-9]{2,4}-\d{3}',m.group(1)) if m else []
    sheetids[title]=ids
    cov|=set(ids)
print('sheets with heading problems',len(bad))
for b in bad[:40]: print(' ',b)
print('P0 missing from sheets:',sorted(set(p0)-cov))
print('non-P0 in sheets:',sorted(cov-set(p0)))
# duplicates
cnt=collections.Counter(i for v in sheetids.values() for i in v)
print('dup ids',[k for k,v in cnt.items() if v>1])
# title ids vs FEATURE ID
# Part C coverage
np0=[r['feature_id'] for r in rows if r['priorite_produit']!='P0']
miss=[f for f in np0 if f not in C]
print('non-P0',len(np0),'missing in C',miss)
cn=collections.Counter(re.findall(r'(?m)^\| ([A-Z0-9]{2,4}-\d{3}) ',C))
print('C rows',sum(cn.values()),'dups',[k for k,v in cn.items() if v>1],'extra',[k for k in cn if k not in np0])
for ph in ['P1','P2','P3']:
    print(ph,sum(1 for r in rows if r['priorite_produit']==ph), sum(1 for r in rows if r['phase_mvp']==ph))
# ID existence
def ids_in(files,pat):
    s=set()
    for f in files: s|=set(re.findall(pat,rd(f)))
    return s
src={}
src['BR']=ids_in(['08_BUSINESS_RULES.md'],r'BR-[A-Z]+-\d+[a-z]?')
src['SM']=ids_in(['08_BUSINESS_RULES.md'],r'SM-\d+')
src['EC']=ids_in(['11_EDGE_CASES_AND_FAILURES.md','08_BUSINESS_RULES.md'],r'EC-\d+')
src['T']=ids_in(['08_BUSINESS_RULES.md'],r'\bT\d{2}\b')
src['OQ']=ids_in(['22_OPEN_QUESTIONS.md'],r'OQ-[A-Z]+-\d+')
src['TA']=set(re.findall(r'\bTA\d{2}\b',prd[:iB]))
src['feat']=set(r['feature_id'] for r in rows)
pats={'BR':r'BR-[A-Z]+-\d+[a-z]?','SM':r'SM-\d+','EC':r'EC-\d+','T':r'\bT\d{2}\b','OQ':r'OQ-[A-Z]+-\d+','TA':r'\bTA\d{2}\b'}
for k,p in pats.items():
    used=collections.Counter(re.findall(p,prd))
    unk={u:c for u,c in used.items() if u not in src[k]}
    print(k,'distinct used',len(used),'unknown',unk)
# feature ids cited anywhere not in 04
used=set(re.findall(r'\b(?:ACC|VER|SRC|LST|CAL|FLT|BKG|PRC|PAY|TRP|MSG|NTF|REV|HST|HDB|CLM|PRT|ADM|SUP|FIN|PYO|LEG|I18N)-\d{3}\b',prd))
print('feature refs unknown',sorted(used-src['feat']))
# T ranges
print('T max in 08',sorted(src['T'])[-3:])
print('---- consistency with csv')
byid={r['feature_id']:r for r in rows}
mm=[]
for s in sheets:
    title=s.split('\n')[0]
    ids=re.findall(r'[A-Z0-9]{2,4}-\d{3}',re.search(r'- \*\*FEATURE ID\*\* : (.*)',s).group(1))
    pri=re.search(r'- \*\*Priorité produit\*\* : (.*)',s).group(1)
    bet=re.search(r'- \*\*Bêta pilote\*\* : (.*)',s).group(1)
    for i in ids:
        r=byid[i]
        if not pri.startswith(r['phase_mvp']): mm.append((i,'phase',pri[:40],r['phase_mvp']))
        if r['phase_mvp']=='P0-A':
            lot=r['lot_p0a']
            if f'lot {lot}' not in pri: mm.append((i,'lot',pri[:40],lot))
            b=r['beta_pilote']
            if len(ids)==1 and not bet.upper().startswith(b.replace('É','É')): mm.append((i,'beta',bet[:40],b))
print(len(mm));
for m in mm[:60]: print(m)
# ensure MANUEL sheets describe a procedure (length)
short=[]
for s in sheets:
    bet=re.search(r'- \*\*Bêta pilote\*\* : (.*)',s).group(1)
    if bet.upper().startswith(('MANUEL','SIMPLIFI')) and len(bet)<40: short.append((s.split('\n')[0],bet))
print('short beta procs',len(short),short[:20])
# acceptance criteria: count Given/When/Then
ng=[]
for s in sheets:
    ac=re.search(r"- \*\*Critères d'acceptation\*\* : (.*)",s).group(1)
    g=len(re.findall(r'\bGiven\b',ac)); w=len(re.findall(r'\bWhen\b',ac)); t=len(re.findall(r'\bThen\b',ac))
    if g==0 or not(g==w==t): ng.append((s.split('\n')[0][:60],g,w,t))
print('sheets with non GWT-balanced AC',len(ng))
for x in ng[:40]: print(x)
