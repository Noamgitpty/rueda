# -*- coding: utf-8 -*-
"""VERIF_18 - controle croise des identifiants.
Lancer depuis n'importe ou : python -I -X utf8 tools/verif18_crossref.py
Ne modifie aucun fichier relu ; ecrit verification/verif18_crossref_output.txt."""
import re, csv, collections, os
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def rd(f): return open(os.path.join(R, f), encoding='utf-8-sig').read()
NAMES = ['08_BUSINESS_RULES.md','10b_UX_UI_ANALYSIS.md','11_EDGE_CASES_AND_FAILURES.md','16_PRODUCT_REQUIREMENTS_DOCUMENT.md','17_DATA_MODEL_AND_ARCHITECTURE.md','18_MVP_AND_ROADMAP.md','22_OPEN_QUESTIONS.md','04_FEATURE_INVENTORY_README.md','04_FEATURE_INVENTORY.csv','sources/SRC_VEHICLE_DATA.md']
F = {k: rd(k) for k in NAMES}
rows = list(csv.DictReader(open(os.path.join(R,'04_FEATURE_INVENTORY.csv'), encoding='utf-8-sig')))
FEAT = {r['feature_id'] for r in rows}
def lines(f): return F[f].split('\n')
def defs(f, rx):
    out = {}
    for i, l in enumerate(lines(f), 1):
        m = re.match(rx, l)
        if m: out.setdefault(m.group(1), i)
    return out
f08, f10, f11, f16, f17, f18, f22 = NAMES[:7]
D = {}
D['BR'] = defs(f08, r'^#{2,4} (BR-[A-Z]+-\d+)')
D['SM'] = defs(f08, r'^#{2,4} (SM-\w+)')
D['EC'] = defs(f11, r'^#{2,4} (EC-\d+[a-z]?)')
D['T'] = defs(f08, r'^\| (T\d+) ')
D['TA'] = defs(f16, r'^\| (TA\d+) ')
D['OQ'] = defs(f22, r'^\|\s*\**(OQ-[A-Z]+-\d+)')
D['UXQ'] = defs(f22, r'^\|\s*\**(UXQ-\d+)')
D['DEC'] = defs(f22, r'^\|\s*\**(DEC-FONDATEUR-\d+)')
D['ADR'] = defs(f17, r'^\|\s*\**(ADR-\d+)')
D['C'] = defs(f17, r'^\| (C\d+) \|')
D['RLS'] = defs(f17, r'^\|\s*\**(RLS-\d+)')
D['L0'] = defs(f17, r'^\|\s*\**(L0-\d+)')
D['SCR'] = {**defs(f10, r'^\| (S\d\d) \|'), **defs(f10, r'^\| (A\d\d) \|')}
D['OQ08'] = defs(f08, r'^- \*\*(OQ-[A-Z]+-\d+)\*\*')
RX = {
 'BR': r'\bBR-[A-Z]+-\d+\b', 'SM': r'\bSM-[0-9A-Za-z]+\b', 'EC': r'\bEC-\d+[a-z]?\b',
 'TA': r'\bTA\d{2}\b',
 'OQ': r'\bOQ-[A-Z]+-\d+\b', 'UXQ': r'\bUXQ-\d+\b', 'DEC': r'\bDEC-FONDATEUR-\d+\b',
 'ADR': r'\bADR-\d+\b', 'RLS': r'\bRLS-\d+\b', 'L0': r'\bL0-\d+\b',
 'FEAT': r'\b(?:ACC|SRC|LST|CAL|BKG|VER|PRC|PAY|NTF|MSG|REV|TRP|PRT|CLM|HST|ADM|SUP|LEG|FIN|FLT|HDB|PYO|SHA|MKT)-\d{3}\b',
}
cites = collections.defaultdict(lambda: collections.defaultdict(list))
for f, t in F.items():
    for i, l in enumerate(t.split('\n'), 1):
        for k, rx in RX.items():
            for m in re.findall(rx, l):
                cites[k][m].append((f, i))
out = []
def P(s=''):
    out.append(s); print(s)
P('## 1. Identifiants cites mais non definis')
known = {'BR': D['BR'], 'SM': D['SM'], 'EC': D['EC'], 'TA': D['TA'], 'OQ': {**D['OQ'], **D['OQ08']},
         'UXQ': {**D['UXQ'], **defs(f10, r'^\| (UXQ-\d+) ')}, 'DEC': D['DEC'], 'ADR': D['ADR'],
         'RLS': D['RLS'], 'L0': D['L0'], 'FEAT': {k: 0 for k in FEAT}}
for k, dd in known.items():
    miss = {i: v for i, v in cites[k].items() if i not in dd}
    P(f'- {k} : {len(cites[k])} distincts cites, {len(dd)} definis, {len(miss)} cites sans definition')
    for i, v in sorted(miss.items())[:40]:
        P(f'    * {i} : ' + ', '.join(f'{a[:3]}:{b}' for a, b in v[:5]))
# T : T\d\d(\d) dans 08/16/17/18/11/22 hors TA
tcite = collections.defaultdict(list)
for f in [f08, f11, f16, f17, f18, f22, f10]:
    for i, l in enumerate(lines(f), 1):
        for m in re.findall(r'(?<![A-Za-z0-9-])(T\d{2})(?![0-9A-Za-z-])', l):
            tcite[m].append((f[:3], i))
P(f'- T (vecteurs de 08) : {len(D["T"])} definis (max {max(D["T"], key=lambda x:int(x[1:]))}) ; tokens T<nn> cites hors definition inconnus : '
  + str({i: v[:2] for i, v in tcite.items() if i not in D['T']}))
P('## 2. Definis mais jamais cites hors definition')
def outside(kind, ident, deffile, defline):
    return [(f, l) for f, l in cites[kind][ident] if not (f == deffile and l == defline)]
for k, dd, df in [('OQ', known['OQ'], f22), ('ADR', D['ADR'], f17), ('RLS', D['RLS'], f17), ('L0', D['L0'], f17), ('UXQ', D['UXQ'], f22), ('SM', D['SM'], f08), ('TA', D['TA'], f16)]:
    orph = [i for i in dd if not outside(k, i, df, dd[i])]
    P(f'- {k} sans aucune citation hors ligne de definition : {len(orph)} -> {orph[:40]}')
tor = [t for t in D['T'] if t not in tcite or not [1 for f, l in tcite[t] if not (f == '08_' and l == D['T'][t])]]
P(f'- T sans citation hors ligne de definition (dans 08/11/16/17/18/22/10b) : {len(tor)} -> {tor}')
csv_br = set()
for r in rows:
    csv_br |= set(re.findall(RX['BR'], r['regles_liees'] + ' ' + r['notes'] + ' ' + r['dependances']))
p16 = set(re.findall(RX['BR'], F[f16])); p11 = set(re.findall(RX['BR'], F[f11]))
p17 = set(re.findall(RX['BR'], F[f17])); p18 = set(re.findall(RX['BR'], F[f18]))
nb = [b for b in D['BR'] if b not in csv_br]
P(f'- BR definies : {len(D["BR"])} ; non citees dans 04 (regles_liees/notes/dependances) : {len(nb)} -> {sorted(nb)}')
nb2 = [b for b in nb if b not in p16]
P(f'  dont non citees non plus dans 16 : {len(nb2)} -> {sorted(nb2)}')
nb3 = [b for b in nb2 if b not in p11 and b not in p17 and b not in p18]
P(f'  dont non citees dans 11/17/18 non plus : {len(nb3)} -> {sorted(nb3)}')
p0 = [r['feature_id'] for r in rows if r['priorite_produit'].startswith('P0')]
sheets = set(re.findall(r'^#{3,4} (?:\*\*)?([A-Z]{2,4}-\d{3})', F[f16], re.M))
P(f'- Features P0 : {len(p0)} ; sans fiche titree dans 16 : {[x for x in p0 if x not in sheets]}')
nobr = [r['feature_id'] for r in rows if r['priorite_produit'].startswith('P0') and not re.search(RX['BR'], r['regles_liees'])]
P(f'- Features P0 sans BR en regles_liees : {len(nobr)} -> {nobr}')
ecl = lines(f11); starts = sorted(D['EC'].items(), key=lambda x: x[1]); nobr_ec = []
for n, (ec, ln) in enumerate(starts):
    end = starts[n+1][1] if n+1 < len(starts) else len(ecl)
    if not re.search(RX['BR'], '\n'.join(ecl[ln:end])): nobr_ec.append(ec)
P(f'- EC (11) sans aucune BR dans leur section : {len(nobr_ec)} -> {nobr_ec}')
ecu = [e for e in D['EC'] if not [1 for f, l in cites['EC'][e] if f != f11]]
P(f'- EC (11) jamais cites ailleurs (04/08/16/17/18/22/10b) : {len(ecu)} -> {ecu}')
ct = collections.Counter()
for f in [f17, f16, f18, f22, f08]:
    for i, l in enumerate(lines(f), 1):
        if 'C-v3' in l: continue
        for m in re.findall(r'(?<![A-Za-z0-9-])C(\d{1,2})(?![0-9A-Za-z-])', l):
            if f'C{int(m)}' not in D['C']: ct[(f[:3], f'C{m}')] += 1
P(f'- C-tests : {len(D["C"])} definis ; tokens C<n> non definis (bruit possible) : {dict(ct)}')
for f in [f16, f18, f17, f22]:
    s = set(re.findall(r'(?<![A-Za-z0-9-])S\d{2}(?![0-9])', F[f]))
    P(f'- ecrans S cites dans {f[:3]} inconnus de 10b : {sorted(x for x in s if x not in D["SCR"])}')
for f in [f16, f18]:
    s = set(re.findall(r'(?<![A-Za-z0-9-])A\d{2}(?![0-9])', F[f]))
    P(f'- ecrans A cites dans {f[:3]} inconnus de 10b : {sorted(x for x in s if x not in D["SCR"])}')
used = set(re.findall(r'(?<![A-Za-z0-9-])([SA]\d{2})(?![0-9])', F[f16]))
P(f'- ecrans de 10b jamais cites par 16 : {sorted(x for x in D["SCR"] if x not in used)}')
open(os.path.join(R, 'verification', 'verif18_crossref_output.txt'), 'w', encoding='utf-8').write('\n'.join(out))
