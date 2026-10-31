# Script independant VERIF_19 (ne reutilise pas check_backlog.py). Executer : python -I tools/verif19_backlog.py
# MAJ 2026-10-30 STRUCTURELLE UNIQUEMENT (redacteur technique) : (1) totaux v1 en dur remplaces par la lecture de 19 §7 ;
# (2) exception centaine = lot pour les stories declarees deplacees vers un lot posterieur (19 §1.1). Aucun controle de fond modifie.
import re, csv, sys, os
from collections import defaultdict, Counter
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
rd = lambda f: open(os.path.join(D, f), encoding='utf-8').read()
bl = rd('19_DEVELOPMENT_BACKLOG.md')
inv = list(csv.DictReader(open(os.path.join(D, '04_FEATURE_INVENTORY.csv'), encoding='utf-8')))
feat = {r['feature_id']: r for r in inv}
txt = {f: rd(f) for f in ['08_BUSINESS_RULES.md', '16_PRODUCT_REQUIREMENTS_DOCUMENT.md', '17_DATA_MODEL_AND_ARCHITECTURE.md', '22_OPEN_QUESTIONS.md', '10b_UX_UI_ANALYSIS.md', '11_EDGE_CASES_AND_FAILURES.md']}
errs = []; warns = []
parts = re.split(r'^#### (US-\d{3}) — (.*)$', bl, flags=re.M)
stories = {}
RUBS = ['Epic', 'Récit', 'Features', 'Références', 'Critères d\'acceptation', 'Notes techniques', 'Dépendances', 'Estimation', 'Lot', 'Bêta pilote', 'Revue design', 'Bloqué par \\(défaut\\)']
for i in range(1, len(parts), 3):
    sid, title, body = parts[i], parts[i + 1], parts[i + 2]
    body = re.split(r'^(?:### |## )', body, flags=re.M)[0]

    def fld(name):
        m = re.search(r'^- \*\*' + name + r'\*\* :[ ]*(.*(?:\n(?!- \*\*).*)*)', body, flags=re.M)
        return m.group(1).strip() if m else None
    stories[sid] = dict(title=title, body=body, **{k: fld(k) for k in RUBS})
print('stories', len(stories))
# MAJ structurelle 2026-10-30 (lead technical writer) : liste des stories deplacees lue dans 19 §1.1
_mv = re.search(r"^- \*\*Stories déplacées sans renumérotation\*\* :(.*)$", bl, re.M)
MOVED = set(re.findall(r'US-\d{3}', _mv.group(1).split('(')[0])) if _mv else set()  # la parenthese est une justification
print('stories deplacees declarees (19 §1.1):', sorted(MOVED))
LOTORD = {'L0': 0, 'L1': 1, 'L2': 2, 'L3': 3, 'L4': 4, 'L5': 5, 'LC': 6, 'LB': 7}
for s, d in stories.items():
    for k in RUBS:
        if d[k] is None:
            errs.append(f'{s}: rubrique {k} absente')
    pm = re.match(r'(\d+) pts?', d['Estimation'] or '')
    d['pts'] = int(pm.group(1)) if pm else 0
    if d['pts'] not in (1, 2, 3, 5, 8, 13):
        errs.append(f'{s}: estimation hors echelle {d["Estimation"]}')
    d['lot'] = (d['Lot'] or '').split()[0]
    if d['lot'] not in LOTORD:
        errs.append(f'{s}: lot {d["Lot"]}'); d['lot'] = 'L0'
    exp = {'0': 'L0', '1': 'L1', '2': 'L2', '3': 'L3', '4': 'L4', '5': 'L5', '6': 'LC', '7': 'LB'}[s[3]]
    if exp != d['lot']:
        # MAJ structurelle 2026-10-30 : exception declaree en 19 §1.1 (deplacement vers un lot POSTERIEUR seulement)
        if s in MOVED and LOTORD[d['lot']] > LOTORD[exp]:
            warns.append(f'{s}: deplacee sans renumerotation {exp} -> {d["lot"]} (19 §1.1)')
        else:
            errs.append(f'{s}: centaine {s[3]} != lot {d["Lot"]}')
    d['feats'] = re.findall(r'\b[A-Z][A-Z0-9]{1,3}-\d{3}\b', d['Features'] or '')
    for f in d['feats']:
        if f not in feat:
            errs.append(f'{s}: feature {f} absente de 04')
    d['deps'] = re.findall(r'US-\d{3}', d['Dépendances'] or '')
for s, d in stories.items():
    for x in d['deps']:
        if x not in stories:
            errs.append(f'{s}: dependance {x} inexistante')
        elif LOTORD[stories[x]['lot']] > LOTORD[d['lot']]:
            errs.append(f'{s} ({d["lot"]}) depend de {x} ({stories[x]["lot"]}) : ordre de lot viole')
color = {}
sys.setrecursionlimit(10000)


def dfs(u, path):
    color[u] = 1
    for v in stories[u]['deps']:
        if v not in stories:
            continue
        if color.get(v) == 1:
            errs.append('cycle: ' + ' -> '.join(path + [u, v])); continue
        if v not in color:
            dfs(v, path + [u])
    color[u] = 2


for s in stories:
    if s not in color:
        dfs(s, [])
refs = defaultdict(set)
for s, d in stories.items():
    t = ' '.join([d['Références'] or '', d['Critères d\'acceptation'] or '', d['Bloqué par \\(défaut\\)'] or '', d['Notes techniques'] or ''])
    for k, pat in [('BR', r'\bBR-[A-Z]+-\d+\b'), ('TA', r'\bTA\d{2}\b'), ('T', r'(?<![A-Z-])T\d{2}\b'), ('OQ', r'\bOQ-[A-Z]+-\d+\b'), ('UXQ', r'\bUXQ-\d+\b'), ('ADR', r'\bADR-\d{3}\b'), ('EC', r'\bEC-\d+\b'), ('SM', r'\bSM-\d\b'), ('DEC', r'\bDEC-FONDATEUR-\d+\b')]:
        for m in re.findall(pat, t):
            refs[k].add((m, s))
    for m in re.findall(r'(?<![A-Za-z-])C(\d{1,2})\b', t):
        refs['C'].add((m, s))
    for m in re.findall(r'\bRLS-(\d{1,2})\b', t):
        refs['RLS'].add((m, s))
    for m in re.findall(r'\bL0-(\d{2})\b', t):
        refs['L0'].add((m, s))
src08 = txt['08_BUSINESS_RULES.md']; src16 = txt['16_PRODUCT_REQUIREMENTS_DOCUMENT.md']; src17 = txt['17_DATA_MODEL_AND_ARCHITECTURE.md']; src22 = txt['22_OPEN_QUESTIONS.md']
chk = {
    'BR': lambda m: m in src08,
    'TA': lambda m: m in src16 or m in src08,
    'T': lambda m: re.search(r'(?<![A-Z-])' + m + r'\b', src08) is not None,
    'C': lambda m: re.search(r'\bC' + m + r'\b', src17) is not None,
    'RLS': lambda m: ('RLS-' + m) in src17,
    'L0': lambda m: ('L0-' + m) in src17,
    'OQ': lambda m: m in src22,
    'UXQ': lambda m: m in src22,
    'ADR': lambda m: re.search(r'\|\s*' + m + r'\s*\|', src17) is not None,
    'EC': lambda m: m in txt['11_EDGE_CASES_AND_FAILURES.md'] or m in src08,
    'SM': lambda m: m in src08,
    'DEC': lambda m: m in src22,
}
for k, st in refs.items():
    bad = sorted({(m, s) for m, s in st if not chk[k](m)})
    print(f'ref {k}: {len({m for m, _ in st})} distincts, inconnus: {bad[:15]}')
    for m, s in bad:
        errs.append(f'{s}: reference {k} {m} introuvable')
for m, s in refs['C']:
    if int(m) > 20 or int(m) < 1:
        errs.append(f'{s}: C{m} hors C1-C20')
for m, s in refs['RLS']:
    if int(m) > 20:
        errs.append(f'{s}: RLS-{m} hors 1..20')
cov = defaultdict(list)
for s, d in stories.items():
    for f in d['feats']:
        cov[f].append(s)
for ph in ('P0-A', 'P0-B'):
    miss = [r['feature_id'] for r in inv if r['phase_mvp'] == ph and r['feature_id'] not in cov]
    print(f'{ph}: {sum(1 for r in inv if r["phase_mvp"] == ph)} lignes, non couvertes: {miss}')
    errs += [f'{f} ({ph}) sans story' for f in miss]
for f, ss in cov.items():
    if feat[f]['phase_mvp'] not in ('P0-A', 'P0-B'):
        warns.append(f'{f} ({feat[f]["phase_mvp"]}) porte par {ss}')
    ph = feat[f]['phase_mvp']
    if ph == 'P0-A' and all(stories[x]['lot'] == 'LB' for x in ss):
        errs.append(f'{f} P0-A uniquement en LB')
late = []
for f, ss in cov.items():
    r = feat[f]
    if r['phase_mvp'] != 'P0-A':
        continue
    lp = r['lot_p0a']
    if lp == 'C':
        continue
    lo = int(lp)
    first = min(LOTORD[stories[x]['lot']] for x in ss)
    if first > lo:
        late.append((f, lp, [stories[x]['lot'] for x in ss]))
print('features P0-A dont la 1re story est APRES le lot_p0a de 04 :', len(late))
for x in late[:60]:
    print('   ', x)
tot = Counter(); cnt = Counter()
for d in stories.values():
    tot[d['lot']] += d['pts']; cnt[d['lot']] += 1
for l in LOTORD:
    print(f'  {l}: {cnt[l]} stories {tot[l]} pts')
print('  total', sum(cnt.values()), sum(tot.values()))
# MAJ structurelle 2026-10-30 : les totaux annonces ne sont plus en dur ; ils sont lus dans 19 §7
# (bloc « Par lot (stories / points) ») et compares au recalcul independant ci-dessus.
_s7 = bl.split('## 7. Validation automatique', 1)[-1]
claimed = {m.group(1): (int(m.group(2)), int(m.group(3))) for m in re.finditer(r'^\s*(L[0-5CB])\s+(\d+) stories\s+(\d+) pts', _s7, re.M)}
_tm = re.search(r'^\s*total (\d+) stories\s+(\d+) pts', _s7, re.M)
if set(claimed) != set(LOTORD) or not _tm:
    errs.append(f'19 §7 : totaux annonces introuvables ou incomplets ({sorted(claimed)})')
for l, (nc, v) in claimed.items():
    if tot[l] != v or cnt[l] != nc:
        errs.append(f'points {l}: calcule {cnt[l]}/{tot[l]} vs annonce {nc}/{v}')
if _tm and (sum(cnt.values()), sum(tot.values())) != (int(_tm.group(1)), int(_tm.group(2))):
    errs.append(f'total calcule {sum(cnt.values())}/{sum(tot.values())} != annonce {_tm.group(1)}/{_tm.group(2)}')
beta = sum(tot[l] for l in ['L0', 'L1', 'L2', 'L3', 'L4'])
print('Beta pts', beta, 'P0-A L0-L5', beta + tot['L5'])
for s, d in stories.items():
    b = (d['Bêta pilote'] or '').split()[0] if d['Bêta pilote'] else ''
    exp = {'L0': 'OUI', 'L1': 'OUI', 'L2': 'OUI', 'L3': 'OUI', 'L4': 'OUI', 'L5': 'NON', 'LB': 'NON', 'LC': 'PRÉALABLE'}[d['lot']]
    if b != exp:
        errs.append(f'{s}: Beta pilote {b} attendu {exp}')
for s, d in stories.items():
    scr = re.findall(r'\b(?:S|A|O)\d{2}\b', d['Références'] or '')
    rv = d['Revue design'] or ''
    if scr and rv.startswith('NON'):
        warns.append(f'{s}: ecrans {scr} cites mais Revue design NON')
    if not scr and rv.startswith('OUI'):
        warns.append(f'{s}: Revue design OUI sans ecran cite ({d["title"][:50]})')
for s, d in stories.items():
    ac = d['Critères d\'acceptation'] or ''
    g = len(re.findall(r'Given', ac)); w = len(re.findall(r'When', ac)); t = len(re.findall(r'Then', ac))
    if not (g and g == w == t):
        warns.append(f'{s}: GWT desequilibre {g}/{w}/{t}')
print('\nL0:')
for s, d in stories.items():
    if d['lot'] == 'L0':
        print(f'  {s} {d["pts"]:>2} {d["title"][:80]} | deps {d["deps"]}')
dep_of = defaultdict(set)
for s, d in stories.items():
    for x in d['deps']:
        dep_of[x].add(s)
print('\nstories L0 sans dependant:', [s for s, d in stories.items() if d['lot'] == 'L0' and not dep_of[s]])
print('\nERREURS', len(errs))
for e in errs:
    print(' -', e)
print('\nAVERTISSEMENTS', len(warns))
for e in warns[:100]:
    print(' -', e)
