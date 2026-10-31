# -*- coding: utf-8 -*-
"""verif24_stats.py - statistiques de couverture du dossier turo-audit, TOUTES COMPTEES dans les fichiers.
Auteur : auditeur final independant (24_FINAL_AUDIT_AND_GAPS.md). Lecture seule : n'ecrit rien.
Usage : python -I -X utf8 tools/verif24_stats.py
Aucun pourcentage de "completude absolue" n'est calcule : seulement des comptes et des rapports entre comptes
dont numerateur et denominateur sont affiches. Les motifs de comptage sont dans le code (verifiables)."""
import csv, re, glob, os, collections, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def P(*a): return os.path.join(ROOT, *a)
def read(p):
    with open(P(p), encoding='utf-8', errors='replace') as f: return f.read()
def rows(p):
    with open(P(p), encoding='utf-8', newline='') as f: return list(csv.DictReader(f))
def head(t): print('\n' + '=' * 8 + ' ' + t)
def ctr(c, indent='  '):
    for k, v in c.most_common(): print(f'{indent}{k!s:55} {v}')

# ---------- 1. Fonctionnalites (04)
head('1. FONCTIONNALITES (04_FEATURE_INVENTORY.csv)')
feat = rows('04_FEATURE_INVENTORY.csv')
print('  total lignes :', len(feat), '| modules :', len({x["module"] for x in feat}))
print('  par phase_mvp :'); ctr(collections.Counter(x['phase_mvp'] for x in feat), '    ')
print('  par statut de preuve (colonne turo_statut_preuve) :'); ctr(collections.Counter(x['turo_statut_preuve'] for x in feat), '    ')
turo = [x for x in feat if x['turo_statut_preuve'] in ('DIRECTEMENT TESTÉ', 'OBSERVÉ', 'DOCUMENTÉ')]
print(f'  lignes dont la preuve porte sur Turo (teste/observe/documente) : {len(turo)} / {len(feat)}')
print(f'  lignes PROPOSÉ ou INFÉRÉ (conception nous / deduction) : {sum(1 for x in feat if x["turo_statut_preuve"] in ("PROPOSÉ","INFÉRÉ"))}')
# tracabilite fine : OBSERVÉ / DIRECTEMENT TESTÉ avec un EV-xxxx cite ?
ev_re = re.compile(r'EV-\d{4}')
for st in ('DIRECTEMENT TESTÉ', 'OBSERVÉ', 'DOCUMENTÉ'):
    sub = [x for x in feat if x['turo_statut_preuve'] == st]
    with_ev = sum(1 for x in sub if ev_re.search(x['source']))
    print(f'  {st:18}: {len(sub):4} lignes, dont {with_ev:4} citent un EV-xxxx dans la colonne source ({len(sub)-with_ev} sans EV direct)')
print('  P0 (priorite_produit=P0) :', sum(1 for x in feat if x['priorite_produit'] == 'P0'))
print('  beta_pilote :'); ctr(collections.Counter(x['beta_pilote'] or '(vide)' for x in feat), '    ')
print('  risque_legal_financier :'); ctr(collections.Counter(x['risque_legal_financier'] for x in feat), '    ')
print('  lignes P0-A / P0-B sans regles_liees :',
      sum(1 for x in feat if x['phase_mvp'] in ('P0-A', 'P0-B') and not x['regles_liees'].strip()), '/',
      sum(1 for x in feat if x['phase_mvp'] in ('P0-A', 'P0-B')))

print('  par module (prefixe) : TESTE+OBSERVE / DOCUMENTE / PROPOSE+INFERE / BLOQUE+NON EXPLORE  (total) :')
bymod = collections.defaultdict(collections.Counter)
for x in feat:
    k = x['feature_id'].split('-')[0]; st_ = x['turo_statut_preuve']
    g = 'obs' if st_ in ('DIRECTEMENT TESTÉ', 'OBSERVÉ') else 'doc' if st_ == 'DOCUMENTÉ' else 'prop' if st_ in ('PROPOSÉ', 'INFÉRÉ') else 'bloque'
    bymod[k][g] += 1
for k in sorted(bymod):
    c_ = bymod[k]; print(f'    {k:5} {c_["obs"]:4} / {c_["doc"]:4} / {c_["prop"]:4} / {c_["bloque"]:3}   ({sum(c_.values())})')
nobs = sum(1 for x in feat if x['turo_statut_preuve'] in ('DIRECTEMENT TESTÉ', 'OBSERVÉ'))
print(f'  lignes dont la preuve repose sur une OBSERVATION/TEST DIRECT dans l interface : {nobs} / {len(feat)} ; sur la seule documentation lue : {sum(1 for x in feat if x["turo_statut_preuve"]=="DOCUMENTÉ")}')

# ---------- 2. Regles metier (08)
head('2. REGLES METIER (08_BUSINESS_RULES.md)')
t08 = read('08_BUSINESS_RULES.md')
blocks = re.split(r'(?m)^### (?=BR-)', t08)[1:]
br_ids = []; cert = collections.Counter()
for b in blocks:
    m = re.match(r'(BR-[A-Z0-9]+-\d+)', b)
    if not m: continue
    br_ids.append(m.group(1))
    body = b.split('\n### ')[0]
    cm = re.search(r'Certitude\W{0,6}([^\n]{0,160})', body)
    if not cm: cert['(aucune mention "Certitude" dans le bloc)'] += 1; continue
    s = cm.group(1)
    found = [k for k in ('DIRECTEMENT TESTÉ', 'OBSERVÉ', 'DOCUMENTÉ', 'DOC-SEC', 'INFÉRÉ', 'PROPOSÉ', 'À VALIDER') if k in s]
    cert[' + '.join(found) if found else '(autre libelle)'] += 1
print('  titres "### BR-" :', len(br_ids), '| identifiants distincts :', len(set(br_ids)),
      '| doublons :', [k for k, v in collections.Counter(br_ids).items() if v > 1])
print('  par prefixe :', dict(sorted(collections.Counter(i.split('-')[1] for i in br_ids).items())))
print('  par libelle de certitude (premiere mention du bloc) :'); ctr(cert, '    ')
t_ids = sorted({int(x) for x in re.findall(r'(?m)^\| T(\d{2}) \|', t08)})
print(f'  vecteurs T (lignes "| Tnn |" dans 08) : {len(t_ids)} (T{t_ids[0]:02}..T{t_ids[-1]:02}), manquants dans la suite : {[i for i in range(t_ids[0], t_ids[-1]+1) if i not in t_ids]}')
print('  machines a etats SM-n definies :', len(set(re.findall(r'(?m)^#+ .*?\b(SM-\d)\b', t08))) or len(set(re.findall(r'\bSM-\d\b', t08))))

# ---------- 3. Cas limites (11), vecteurs PRD (16), architecture (17)
head('3. CAS LIMITES, VECTEURS, TESTS')
t11 = read('11_EDGE_CASES_AND_FAILURES.md')
ec = re.findall(r'(?m)^### (EC-\d+)', t11)
print('  cas limites EC (titres "### EC-") :', len(ec), '| distincts :', len(set(ec)))
gwt = len(re.findall(r'(?i)\bGiven\b', t11)); print('  occurrences "Given" dans 11 (indice) :', gwt)
t16 = read('16_PRODUCT_REQUIREMENTS_DOCUMENT.md')
ta = sorted(set(re.findall(r'(?m)^\| (TA\d{2}) \|', t16)))
print('  vecteurs TA (16 A.8.1) :', len(ta), ta[:1], '..', ta[-1:])
t17 = read('17_DATA_MODEL_AND_ARCHITECTURE.md')
print('  tests de concurrence C (17) :', len(set(re.findall(r'(?m)^\| (C\d+) \|', t17))),
      '| RLS-n :', len(set(re.findall(r'(?m)^\| (RLS-\d+) \|', t17))),
      '| preuves L0-nn :', len(set(re.findall(r'(?m)^\| (L0-\d\d) \|', t17))),
      '| ADR-nnn :', len(set(re.findall(r'(?m)^\| (ADR-\d{3}) \|', t17))))
fiches = re.findall(r'(?m)^#{3,5} .*?([A-Z]{2,4}-\d{3})', t16)
print('  fiches/titres de features cites en titre dans 16 :', len(set(fiches)))

# ---------- 4. Questions ouvertes (22)
head('4. QUESTIONS ET DECISIONS OUVERTES (22_OPEN_QUESTIONS.md)')
t22 = read('22_OPEN_QUESTIONS.md')
oq = set(re.findall(r'(?m)^\| (OQ-[A-Z]+-\d+) \|', t22)); uxq = set(re.findall(r'(?m)^\| (UXQ-\d+) \|', t22))
dec_all = set(re.findall(r'DEC-FONDATEUR-\d+', t22))
print('  OQ-* definies (lignes de tableau) :', len(oq), '| par famille :', dict(collections.Counter(i.split('-')[1] for i in oq)))
print('  UXQ-* :', len(uxq), '| DEC-FONDATEUR distinctes citees :', len(dec_all))
pris = t22.split('### Décisions prises')[-1] if '### Décisions prises' in t22 else ''
print('  DEC-FONDATEUR dans "Décisions prises" :', sorted(set(re.findall(r'DEC-FONDATEUR-\d+', pris))))
att = t22.split('## Décisions fondateur / produit en attente')[1].split('### Décisions prises')[0] if '## Décisions fondateur / produit en attente' in t22 else ''
att_rows = [l for l in att.splitlines() if l.startswith('| ') and not l.startswith('| ---') and not l.startswith('| Décision')]
print('  lignes de la table "en attente" (avec defaut et echeance) :', len(att_rows))
prio = collections.Counter()
for l in t22.splitlines():
    m = re.match(r'\| (OQ-[A-Z]+-\d+) \|', l)
    if m:
        cells = [c.strip() for c in l.strip('|').split('|')]
        prio[cells[-1] if cells[-1] in ('P0', 'P1', 'P2', 'P3') else '(non P0..P3 en derniere colonne)'] += 1
print('  OQ par priorite (derniere colonne) :'); ctr(prio, '    ')

# ---------- 5. Preuves (20) et matrice de couverture (21)
head('5. REGISTRE DE PREUVES (20) ET MATRICE DE COUVERTURE (21)')
ev = rows('20_EVIDENCE_REGISTER.csv')
print('  entrees de preuve EV :', len(ev), '| par statut :', dict(collections.Counter(x['statut'] for x in ev)))
print('  par type :', dict(collections.Counter(x['type'] for x in ev)))
cov = rows('21_COVERAGE_MATRIX.csv')
print('  lignes de la matrice :', len(cov), '(dont lignes FINAL-* :', sum(1 for x in cov if x['id'].startswith('FINAL')), ')')
print('  par statut exact :'); ctr(collections.Counter(x['statut'] for x in cov), '    ')
simple = collections.Counter()
for x in cov:
    for k in ('DIRECTEMENT TESTÉ', 'OBSERVÉ', 'DOCUMENTÉ', 'INFÉRÉ', 'PROPOSÉ', 'BLOQUÉ', 'NON EXPLORÉ', 'EN COURS'):
        if k in x['statut']: simple[k] += 1
print('  lignes mentionnant chaque statut (une ligne peut en cumuler plusieurs) :', dict(simple))
allsrc = ''
for g in sorted(glob.glob(P('*.md')) + glob.glob(P('*.csv')) + glob.glob(P('sources', '*.md')) + glob.glob(P('verification', '*.md'))):
    b = os.path.basename(g)
    if b.startswith('20_') or b.startswith('24_'): continue   # on exclut le registre lui-meme et ce rapport
    allsrc += open(g, encoding='utf-8', errors='replace').read()
cited = collections.Counter(re.findall(r'EV-\d{4}', allsrc))
defined = {x['evidence_id'] for x in ev}
print('  EV cites ailleurs que dans 20 et 24 (md + csv + sources + verification) :', len(cited), '| cites mais non definis :', sorted(set(cited) - defined), '| definis jamais cites :', sorted(defined - set(cited)))
stale = [x['id'] for x in cov if x['id'] in ('ACC-LOGIN', 'ACC-PROFILE', 'G-SEARCH-08') and x['statut'] == 'BLOQUÉ']
print('  lignes BLOQUÉ potentiellement perimees (connexion et favoris ont ete faits, cf. ACC-PROFILE-OBS) :', stale)

# ---------- 6. Backlog (19)
head('6. BACKLOG (19_DEVELOPMENT_BACKLOG.md)')
t19 = read('19_DEVELOPMENT_BACKLOG.md')
st = re.findall(r'(?m)^#### (US-\d{3}) — (.*)$', t19)
pts = collections.Counter(); n = collections.Counter()
for m in re.finditer(r'(?ms)^#### (US-\d{3}) — .*?(?=^#### US-|^### |^## )', t19):
    blk = m.group(0); lot = 'L' + m.group(1)[3] if m.group(1)[3] != '6' else 'LC'
    if m.group(1)[3] == '7': lot = 'LB'
    if m.group(1) in ('US-036','US-044','US-045'): lot = 'L1'  # deplacees de L0 vers L1 (19 par. 1.1)
    pm = re.search(r'Estimation\W{0,6}\s*(\d+)', blk)
    n[lot] += 1; pts[lot] += int(pm.group(1)) if pm else 0
print('  stories :', len(st), '| par lot (centaine de l\'identifiant) :', dict(sorted(n.items())), '| points :', dict(sorted(pts.items())), '| total points :', sum(pts.values()))
print('  taches fondateur F-nn :', len(set(re.findall(r'(?m)^\| (F-\d\d) \|', t19))))

# ---------- 7. Audits (verification/)
head('7. AUDITS INDEPENDANTS PRECEDENTS (verification/VERIF_*.md) - gravites DECLAREES par chaque rapport')
LOG = read('verification/VERIFICATION_LOG.md')
tot = collections.Counter(); nrep = 0
for f in sorted(glob.glob(P('verification', 'VERIF_*.md'))):
    t = read(os.path.relpath(f, ROOT)); nrep += 1
    top = '\n'.join(t.splitlines()[:60])
    c = m = n_ = None
    mm = re.search(r'(\d+) CRITIQUES?\W+(\d+) MAJEURS?\W+(\d+) MINEURS?', top)
    meth = 'declare (rapport)'
    if mm: c, m, n_ = map(int, mm.groups())
    else:
        mm = re.search(r'CRITIQUE : (\d+)\*\*\W+\*\*MAJEUR : (\d+)\*\*\W+\*\*MINEUR : (\d+)', t)
        if mm: c, m, n_ = map(int, mm.groups())
        else:
            mm = re.search(r'Aucun CRITIQUE\W+(\d+) MAJEURS?[^,]*,\s*(\d+) MINEURS?', top)
            if mm: c, m, n_ = 0, int(mm.group(1)), int(mm.group(2))
            else:
                num = re.search(r'VERIF_(\d\d)', os.path.basename(f)).group(1)
                for l in LOG.splitlines():
                    if ('VERIF_' + num) in l and 'traité' not in l.split('VERIF_' + num)[0][-3:] and 'agent correcteur' not in l:
                        a = re.search(r'(\d+) CRITIQUES?', l); b = re.search(r'(\d+) MAJEURS?', l); d = re.search(r'(\d+) MINEURS?', l)
                        if a and b and d: c, m, n_ = int(a.group(1)), int(b.group(1)), int(d.group(1)); meth = 'declare (VERIFICATION_LOG)'; break
    if c is None:  # repli : lignes de tableau dont une cellule vaut exactement la gravite
        cnt = collections.Counter()
        for l in t.splitlines():
            if l.startswith('|'):
                for cell in (x.strip().strip('*') for x in l.strip('|').split('|')):
                    if cell in ('CRITIQUE', 'MAJEUR', 'MINEUR'): cnt[cell] += 1; break
        c, m, n_ = cnt['CRITIQUE'], cnt['MAJEUR'], cnt['MINEUR']; meth = 'lignes de tableau (repli)'
    tot['CRITIQUE'] += c; tot['MAJEUR'] += m; tot['MINEUR'] += n_
    print(f'  {os.path.basename(f)[:34]:36} C={c:2} M={m:2} m={n_:2}  [{meth}]')
print(f'  {nrep} rapports ; total CRITIQUE={tot["CRITIQUE"]} MAJEUR={tot["MAJEUR"]} MINEUR={tot["MINEUR"]} (somme des gravites declarees ; non dedupliquees entre rapports)')
tools = sorted(glob.glob(P('tools', '*.py')))
print('  scripts dans tools/ :', len(tools), '(dont ce script)')

# ---------- 8. Constats du present audit (si 24 existe)
head('8. CONSTATS DU PRESENT AUDIT (table Partie 1 de 24_FINAL_AUDIT_AND_GAPS.md)')
if os.path.exists(P('24_FINAL_AUDIT_AND_GAPS.md')):
    t24 = read('24_FINAL_AUDIT_AND_GAPS.md')
    part1 = t24.split('## Partie 2')[0]
    cc = collections.Counter()
    for l in part1.splitlines():
        mm = re.match(r'\| (A24-\d+) \| (CRITIQUE|MAJEUR|MINEUR) \|', l)
        if mm: cc[mm.group(2)] += 1
    print('  constats A24-nn :', sum(cc.values()), dict(cc))
else:
    print('  24_FINAL_AUDIT_AND_GAPS.md absent')
print('\nFIN (aucun pourcentage de completude absolue n\'est produit ; voir 24 Partie 3 pour l\'interpretation).')
