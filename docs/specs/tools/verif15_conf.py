import csv,re,sys,collections
sys.stdout.reconfigure(encoding='utf-8')
rows={r['feature_id']:r for r in csv.DictReader(open('04_FEATURE_INVENTORY.csv',encoding='utf-8'))}
prd=open('16_PRODUCT_REQUIREMENTS_DOCUMENT.md',encoding='utf-8').read()
B=prd[prd.index('# PARTIE B'):prd.index('# PARTIE C')]
sheets=re.split(r'(?m)^#### ',B)[1:]
mp={'OBSERVÉ':'confirmé','DIRECTEMENT TESTÉ':'confirmé','DOCUMENTÉ':'documenté','INFÉRÉ':'inféré','PROPOSÉ':'proposé','BLOQUÉ':'bloqué','NON EXPLORÉ':'non exploré'}
cnt=collections.Counter(); out=[]
for s in sheets:
    ids=re.findall(r'[A-Z0-9]{2,4}-\d{3}',re.search(r'- \*\*FEATURE ID\*\* : (.*)',s).group(1))
    conf=re.search(r'- \*\*Confiance\*\* : (.*)',s).group(1)
    first=conf.lower().split()[0].strip(' ;,(')
    for i in ids:
        ts=rows[i]['turo_statut_preuve']
        key=ts.split()[0] if ts else ''
        exp=mp.get(ts, ts.lower())
        ok = exp in conf.lower()
        cnt[(ts,ok)]+=1
        if not ok: out.append((i,ts,conf[:110]))
print(cnt)
for o in out: print(o)
