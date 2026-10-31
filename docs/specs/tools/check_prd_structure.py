"""Contrôle structurel du PRD (16) — script de l'auteur, versionné (VERIF_15-F10).

Vérifie : couverture des 160 lignes P0 de 04 par les fiches ; 24 rubriques dans l'ordre ; Given/When/Then équilibrés ;
lignes P1–P3 en partie C ; existence de chaque identifiant cité (feature_id, BR, SM, EC, T, TA, OQ, UXQ, écrans 10b, ADR) ;
absence des noms de la version 1 écartés par 17 ; matrice D.1 identique à sa régénération depuis les fiches.
Usage : python -I tools/check_prd_structure.py
"""
import csv
import re
import sys
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
R = Path(__file__).resolve().parent.parent
rd = lambda f: (R / f).read_text(encoding="utf-8")
prd = rd("16_PRODUCT_REQUIREMENTS_DOCUMENT.md")
rows = list(csv.DictReader(open(R / "04_FEATURE_INVENTORY.csv", encoding="utf-8")))
by = {r["feature_id"]: r for r in rows}
p0 = {i for i, r in by.items() if r["priorite_produit"] == "P0"}
err = []
iB, iC, iD = prd.index("# PARTIE B"), prd.index("# PARTIE C"), prd.index("# PARTIE D")
B, C = prd[iB:iC], prd[iC:iD]
H = ["FEATURE ID", "Nom", "Module", "Persona", "Objectif", "Description", "Déclencheur", "Prérequis", "Parcours principal",
     "Parcours alternatifs", "Règles métier", "États", "Erreurs", "Données", "Notifications", "Permissions", "Dépendances",
     "Critères d'acceptation", "Source", "Confiance", "Priorité produit", "Bêta pilote", "Complexité", "Améliorations possibles"]
blocks = [b for b in re.split(r"(?m)^(?=#### |## )", B) if b.startswith("#### ")]
cov = Counter()
bad_h, bad_gwt = [], []
for b in blocks:
    t = b.split("\n")[0]
    if re.findall(r"(?m)^- \*\*([^*]+)\*\* :", b) != H:
        bad_h.append(t)
    ids = re.findall(r"\b[A-Z0-9]{2,4}-\d{3}\b", re.search(r"- \*\*FEATURE ID\*\* : (.*)", b).group(1))
    cov.update(ids)
    ac = re.search(r"- \*\*Critères d'acceptation\*\* : (.*)", b).group(1)
    g, w, th = (len(re.findall(rf"\b{k}\b", ac)) for k in ("Given", "When", "Then"))
    if not g or not (g == w == th):
        bad_gwt.append((t[:50], g, w, th))
miss = sorted(p0 - set(cov)); dup = sorted(k for k, v in cov.items() if v > 1); extra = sorted(set(cov) - p0)
print(f"P0 dans 04 : {len(p0)} ; fiches : {len(blocks)} ; feature_id couverts : {len(set(cov) & p0)} ; manquants : {miss} ; doublons : {dup} ; hors P0 : {extra}")
print(f"Fiches au format incomplet ou désordonné (24 rubriques) : {bad_h}")
print(f"Critères Given/When/Then déséquilibrés : {bad_gwt}")
err += ["couverture"] * bool(miss or dup or extra) + ["rubriques"] * bool(bad_h) + ["GWT"] * bool(bad_gwt)
np0 = [i for i in by if i not in p0]
cmiss = [i for i in np0 if not re.search(rf"(?m)^\| {re.escape(i)} \|", C)]
print(f"Lignes P1-P3 : {len(np0)} ; absentes de la partie C : {len(cmiss)}")
err += ["partie C"] * bool(cmiss)
# existence des identifiants cités
s08, s11, s22, s10b, s17 = rd("08_BUSINESS_RULES.md"), rd("11_EDGE_CASES_AND_FAILURES.md"), rd("22_OPEN_QUESTIONS.md"), rd("10b_UX_UI_ANALYSIS.md"), rd("17_DATA_MODEL_AND_ARCHITECTURE.md")
src = {
    "BR": (r"BR-[A-Z]+-\d+[a-z]?", set(re.findall(r"BR-[A-Z]+-\d+[a-z]?", s08))),
    "SM": (r"\bSM-\d+b?\b", set(re.findall(r"\bSM-\d+b?\b", s08))),
    "EC": (r"\bEC-\d+\b", set(re.findall(r"\bEC-\d+\b", s11 + s08))),
    "T": (r"\bT\d{2}\b", set(re.findall(r"\bT\d{2}\b", s08))),
    "TA": (r"\bTA\d{2}\b", set(re.findall(r"(?m)^\| (TA\d{2}) \|", prd[:iB]))),
    "OQ": (r"\bOQ-[A-Z]+-\d+\b", set(re.findall(r"\bOQ-[A-Z]+-\d+\b", s22))),
    "UXQ": (r"\bUXQ-\d+\b", set(re.findall(r"(?m)^\| (UXQ-\d+) \|", s22))),
    "écran": (r"\b(?:S(?:0[1-9]|1[0-7])|A(?:0[1-9]|1[0-3])|O01)\b", set(re.findall(r"(?m)^\| (S\d\d|A\d\d|O01) \|", s10b))),
    "ADR": (r"\bADR-\d{3}\b", set(re.findall(r"\bADR-\d{3}\b", s17))),
    "DEC": (r"\bDEC-FONDATEUR-\d+\b", set(re.findall(r"\bDEC-FONDATEUR-\d+\b", s22))),
}
for k, (pat, known) in src.items():
    used = Counter(re.findall(pat, prd))
    unk = sorted(u for u in used if u not in known)
    print(f"{k} : {len(used)} distincts cités ; inconnus : {unk}")
    if unk:
        err.append(k)
fu = set(re.findall(r"\b(?:ACC|VER|SRC|LST|CAL|FLT|BKG|PRC|PAY|TRP|MSG|NTF|REV|HST|HDB|CLM|PRT|ADM|SUP|FIN|PYO|LEG|I18N)-\d{3}\b", prd))
print(f"feature_id cités inconnus de 04 : {sorted(fu - set(by))}")
err += ["feature"] * bool(fu - set(by))
# noms écartés par 17 (hors table de correspondance A.8.2, journal et contradictions)
body = prd[:prd.index("### A.8.2")] + prd[prd.index("### A.8.1"):prd.index("## D.4") if "## D.4" in prd else len(prd)]
OLD = [r"\bERR_[A-Z]", r"\bcompany(?:_id|\.|\()", r"payment_intent", r"fleet_policy", r"framework_contract", r"psp_gate", r"identity_key",
       r"upload_queue", r"\bAGENCY_COUNTER\b(?!_)", r"`OPS`", r"`SUPPORT`", r"\bhold\(", r"late_grace_minutes", r"billing_day_tolerance_minutes", r"2 h 10"]
left = {p: len(re.findall(p, body)) for p in OLD if re.findall(p, body)}
print(f"Noms de la version 1 encore présents : {left}")
err += ["noms"] * bool(left)
# D.1 = régénération
sys.path.insert(0, str(Path(__file__).resolve().parent))
d2 = prd[prd.index("## D.2"):prd.index("## D.3")]
d2oq = {m.group(1): set(re.findall(r"\bOQ-[A-Z]+-\d+\b|\bUXQ-\d+\b", m.group(2))) for m in re.finditer(r"(?m)^\| ([A-Z0-9]{2,4}-\d{3}) \| (.*?) \|", d2)}
f = lambda s: ", ".join(sorted(s)) if s else "—"
exp = {}
for b in blocks:
    ids = re.findall(r"\b[A-Z0-9]{2,4}-\d{3}\b", re.search(r"- \*\*FEATURE ID\*\* : (.*)", b).group(1))
    brs = set(re.findall(r"BR-[A-Z]+(?:-\d+)?(?: bis)?", b)); ecs = set(re.findall(r"\bEC-\d+\b", b))
    vec = set(re.findall(r"\bT\d{2}\b|\bTA\d{2}\b", b)); oqs = set(re.findall(r"\bOQ-[A-Z]+-\d+\b|\bUXQ-\d+\b", b))
    for i in ids:
        br = brs | {x.strip() for x in re.split(r"[;,]", by[i]["regles_liees"]) if x.strip().startswith("BR-")}
        exp[i] = (by[i]["phase_mvp"], f(br), f(ecs), f(vec), f(oqs | d2oq.get(i, set())))
d1 = prd[prd.index("## D.1"):prd.index("## D.2")]
got = {m.group(1): (m.group(2), m.group(3), m.group(4), m.group(5), m.group(6))
       for m in re.finditer(r"(?m)^\| ([A-Z0-9]{2,4}-\d{3}) \| (.*?) \| .*? \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$", d1)}
d1bad = sorted(i for i in exp if got.get(i) != exp[i])
print(f"D.1 : {len(got)} lignes ; écarts avec la régénération : {d1bad}")
err += ["D.1"] * bool(d1bad)
scr = sum(1 for b in blocks if re.search(r"écrans 10b : ", b))
print(f"Fiches avec rubrique Source citant les écrans 10b : {scr}/{len(blocks)}")
err += ["écrans"] * (scr != len(blocks))
print("RÉSULTAT :", "OK" if not err else f"ÉCHEC {err}")
sys.exit(1 if err else 0)
