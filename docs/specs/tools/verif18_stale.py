# -*- coding: utf-8 -*-
"""VERIF_18 - recherche de contenus perimes (versions anterieures) dans les documents relus.
Lancer : python -I -X utf8 tools/verif18_stale.py   (lecture seule ; ecrit verification/verif18_stale_output.txt).
Les occurrences situees dans des journaux de correction (annexes, 'historique', 'remplace', 'corrige VERIF') sont marquees [JOURNAL] ;
les autres sont [CORPS] et a traiter."""
import re, os
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = ['04_FEATURE_INVENTORY.csv', '04_FEATURE_INVENTORY_README.md', '08_BUSINESS_RULES.md', '10b_UX_UI_ANALYSIS.md',
         '11_EDGE_CASES_AND_FAILURES.md', '16_PRODUCT_REQUIREMENTS_DOCUMENT.md', '17_DATA_MODEL_AND_ARCHITECTURE.md',
         '18_MVP_AND_ROADMAP.md', '22_OPEN_QUESTIONS.md', 'sources/SRC_VEHICLE_DATA.md']
PATTERNS = {
 'tests C1-C12 (devrait etre C1-C20)': r'C1\s?[–-]\s?C12\b',
 'RLS-1 a RLS-12 (devrait etre RLS-1 a RLS-20)': r'RLS-1 à RLS-12',
 'tests C1-C16': r'C1\s?[–-]\s?C16\b',
 '147 lignes P0-A (devrait etre 149)': r'\b147 lignes|\b147 \(E1|= 147\b|\*\*147\*\*',
 '160 lignes P0 (devrait etre 162)': r'\b160 lignes|\b160\/160|pour les 160\b|P0 = 160',
 '658 fonctionnalites (devrait etre 661)': r'\b658\b',
 'P2 = 109 (devrait etre 110)': r'P2 \(109|\| 109 \||P2     109|\*\*109\*\*',
 'MANUEL = 59 (devrait etre 55)': r'\b59 lignes|MANUEL 59',
 'Beta 76 lignes construites': r'\b76 lignes construites|76 construites|\(76 lignes',
 'vecteurs T01-T65 (devrait etre T01-T68)': r'T01\s?[–-]\s?T65',
 'mode b : sous 2 h, sinon annulation automatique': r'sous 2 h, sinon annulation automatique|aucune confirmation sous 2 h',
 'hold 2 h 10': r'2 ?h ?10|2 h \+ 10 min',
 'Panama seul / Panama City pour le lancement': r'Panamá City|Panama City',
 'bascule Paraguay / Paraguay en P2': r'bascule|Paraguay \(P2|Paraguay pro-first|P2, ou P0-A',
 'ACH Xpress sans qualification P0-B': r'ACH Xpress',
 'liberation du depot 80 h': r'80 ?h\b',
 'retention 12 mois (preuve)': r'conservation ≥ 12 mois',
 'marge +1 j de PAY-036': r'\+ 1 j\)',
}
out = []
for k, rx in PATTERNS.items():
    out.append(f'### {k}')
    n = 0
    for f in FILES:
        for i, l in enumerate(open(os.path.join(R, f), encoding='utf-8-sig').read().split('\n'), 1):
            m = re.search(rx, l)
            if m:
                tag = '[JOURNAL]' if re.search(r'historique|remplace|v1 |version 1|corrigé VERIF|Annexe|ancien|avant :|retiré|^\| (A|C|F|N|M|B|R)\d|^\| C-v|C0[48]-', l) else '[CORPS]'
                n += 1
                s = max(0, m.start() - 60)
                out.append(f'- {f}:{i} {tag} …{l[s:m.end()+60]}…'.replace('\n', ' '))
    out.append(f'  => {n} occurrence(s)')
txt = '\n'.join(out)
print(txt)
open(os.path.join(R, 'verification', 'verif18_stale_output.txt'), 'w', encoding='utf-8').write(txt)
