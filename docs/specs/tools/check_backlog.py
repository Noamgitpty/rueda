"""Contrôle de 19_DEVELOPMENT_BACKLOG.md (python -I tools/check_backlog.py).

Vérifie :
  1. structure de chaque story (rubriques obligatoires, valeurs admises, préfixe d'ID cohérent avec le lot,
     sauf stories listées comme déplacées vers un lot postérieur, ou remontées vers un lot antérieur,
     sans renumérotation, 19 §1.1) ;
  2. couverture : chaque feature_id P0-A (et P0-B s'il en reste) de 04 est portée par au moins une story active ;
  3. features citées : existent dans 04 ; aucune story active ne cite une ligne `HORS` de 04 ;
  4. dépendances : existent, sans auto-dépendance, graphe acyclique ;
  5. ordre des lots : aucune story ne dépend d'une story d'un lot postérieur ;
  6. règles Bêta : OUI seulement en L0-L4, une story OUI ne dépend que de stories OUI,
     PRÉALABLE (LC) ne dépend que de L0-L4, toute ligne Bêta construite (OUI / SIMPLIFIÉ de 04)
     est portée par au moins une story Bêta ;
  7. règle design : toute story « Revue design : OUI » hors E0-D dépend (transitivement) de US-032 ;
  8. références : vecteurs T01-T68, TJ01-TJ21 (lignes de la table TJ de 08), TA01-TA11, tests C1-C20, RLS-1..28, L0-01..10,
     identifiants OQ/UXQ (22), BR (08), EC (11), ADR (17), SM (08) existent.
Affiche ensuite les comptes par lot, les points et le chemin critique (plus long chemin pondéré).

Révision P2P (US-058, 2026-11-02) : lot `HORS` pour les stories hors produit (DEC-FONDATEUR-13) : elles gardent
leur identifiant, n'ont ni estimation, ni feature, ni dépendance ; elles sont ignorées par la couverture, les points
et le graphe, et aucune story active ne peut en dépendre. L'ancien lot LB (P0-B) est supprimé : ses stories sont
remontées (liste « Stories remontées sans renumérotation » de 19 §1.1) ou hors produit. Les lignes `HORS` de 04
(`phase_mvp`) sont ignorées par la couverture, et une story active ne peut pas en citer. La rubrique « Bêta pilote »
devient « Tranche bêta ».
Revue QA du bloc S2 / S5 / S6 (US-057, 2026-11-03) : contrôle aussi les comptes de 21_COVERAGE_MATRIX.csv
(FINAL-FEAT-INV, FINAL-E0 à E18) contre 04 et 19, et lit les listes « déplacées » et « remontées » de 19 §1.1 comme
verif19_backlog.py (la parenthèse est une justification).
"""
import csv
import os
import re
import sys
from pathlib import Path
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8")
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(name):
    with open(os.path.join(BASE, name), encoding="utf-8") as f:
        return f.read()


LOTS = ["L0", "L1", "L2", "L3", "L4", "L5", "LC", "HORS"]
RANK = {l: i for i, l in enumerate(LOTS)}
# lot de naissance d'un identifiant (centaine) ; « LB » (US-7xx) n'est plus un lot valide, mais reste le lot de
# naissance des stories remontées de l'ancien lot P0-B (rang le plus tardif).
BORN = {"0": "L0", "1": "L1", "2": "L2", "3": "L3", "4": "L4", "5": "L5", "6": "LC", "7": "LB"}
BORN_RANK = {"L0": 0, "L1": 1, "L2": 2, "L3": 3, "L4": 4, "L5": 5, "LC": 6, "LB": 7}
FIELDS = ["Epic", "Récit", "Features", "Références", "Critères d'acceptation", "Notes techniques",
          "Dépendances", "Estimation", "Lot", "Tranche bêta", "Revue design", "Bloqué par (défaut)"]

errors, warnings = [], []
doc = read("19_DEVELOPMENT_BACKLOG.md")
_mv = re.search(r"^- \*\*Stories déplacées sans renumérotation\*\* :(.*)$", doc, re.M)
MOVED = set(re.findall(r"US-\d{3}", _mv.group(1).split("(")[0])) if _mv else set()
_up = re.search(r"^- \*\*Stories remontées sans renumérotation\*\* :(.*)$", doc, re.M)
RAISED = set(re.findall(r"US-\d{3}", _up.group(1).split("(")[0])) if _up else set()  # même lecture que verif19_backlog.py : la parenthèse est une justification

# ---------- parsing ----------
stories = {}
order = []
cur = None
for line in doc.split("\n"):
    m = re.match(r"^#### (US-\d{3}) — (.+)$", line)
    if m:
        cur = m.group(1)
        if cur in stories:
            errors.append(f"identifiant en double : {cur}")
        stories[cur] = {"title": m.group(2), "fields": {}, "text": line + "\n"}
        order.append(cur)
        continue
    if line.startswith("### ") or line.startswith("## "):
        cur = None
        continue
    if cur:
        stories[cur]["text"] += line + "\n"
        fm = re.match(r"^- \*\*(.+?)\*\* : ?(.*)$", line)
        if fm:
            stories[cur]["fields"][fm.group(1)] = fm.group(2).strip()

for sid in order:
    s = stories[sid]
    f = s["fields"]
    for k in FIELDS:
        if k not in f:
            errors.append(f"{sid} : rubrique manquante « {k} »")
    lot = f.get("Lot", "")
    if lot not in RANK:
        errors.append(f"{sid} : lot inconnu « {lot} »")
        lot = "L5"
    s["lot"] = lot
    s["hors"] = lot == "HORS"
    born = BORN[sid[3]]
    if s["hors"]:
        # story hors produit : rubriques présentes, mais ni estimation, ni feature, ni dépendance
        s["pts"] = 0
        s["beta"] = f.get("Tranche bêta", "")
        s["design"] = f.get("Revue design", "")
        s["features"], s["deps"], s["epic"] = [], [], ""
        if f.get("Estimation", "") != "—":
            errors.append(f"{sid} : story HORS avec une estimation « {f.get('Estimation')} » (attendu « — »)")
        if re.findall(r"\b[A-Z0-9]{2,4}-\d{3}\b", f.get("Features", "")) or re.findall(r"US-\d{3}", f.get("Dépendances", "")):
            errors.append(f"{sid} : story HORS avec des features ou des dépendances")
        if s["beta"] != "NON":
            errors.append(f"{sid} : story HORS dont la tranche bêta n'est pas NON")
        if "hors produit" not in (s["title"] + f.get("Récit", "")).lower():
            errors.append(f"{sid} : story HORS sans la mention « hors produit »")
        continue
    if BORN_RANK[lot] != BORN_RANK[born]:
        # 19 §1.1 : une story déplacée vers un lot postérieur (« Stories déplacées sans renumérotation », VERIF_19)
        # ou remontée vers un lot antérieur (« Stories remontées sans renumérotation », révision P2P) garde son
        # identifiant si elle est listée ; sinon, erreur.
        if sid in MOVED and BORN_RANK[lot] > BORN_RANK[born]:
            warnings.append(f"{sid} : déplacée sans renumérotation de {born} vers {lot} (19 §1.1)")
        elif sid in RAISED and BORN_RANK[lot] < BORN_RANK[born]:
            warnings.append(f"{sid} : remontée sans renumérotation de {born} vers {lot} (19 §1.1)")
        else:
            errors.append(f"{sid} : préfixe incohérent avec le lot {lot}")
    m = re.match(r"^(\d+) pts?$", f.get("Estimation", ""))
    if not m or int(m.group(1)) not in (1, 2, 3, 5, 8, 13):
        errors.append(f"{sid} : estimation invalide « {f.get('Estimation')} »")
        s["pts"] = 0
    else:
        s["pts"] = int(m.group(1))
    s["beta"] = f.get("Tranche bêta", "")
    if s["beta"] not in ("OUI", "NON", "PRÉALABLE"):
        errors.append(f"{sid} : valeur Bêta invalide « {s['beta']} »")
    s["design"] = f.get("Revue design", "")
    if s["design"] not in ("OUI", "NON"):
        errors.append(f"{sid} : valeur Revue design invalide")
    s["features"] = re.findall(r"\b[A-Z0-9]{2,4}-\d{3}\b", f.get("Features", ""))
    s["deps"] = re.findall(r"US-\d{3}", f.get("Dépendances", ""))
    s["epic"] = f.get("Epic", "")
    ac = s["text"]
    if "Given" not in ac or "Then" not in ac:
        errors.append(f"{sid} : critères sans Given / Then")
    if not f.get("Récit", "").startswith("En tant qu"):
        errors.append(f"{sid} : récit hors format « En tant que… »")

# ---------- 04 ----------
with open(os.path.join(BASE, "04_FEATURE_INVENTORY.csv"), encoding="utf-8") as fh:
    inv = {r["feature_id"]: r for r in csv.DictReader(fh)}
p0a = [k for k, r in inv.items() if r["phase_mvp"] == "P0-A"]
p0b = [k for k, r in inv.items() if r["phase_mvp"] == "P0-B"]
hors04 = [k for k, r in inv.items() if r["phase_mvp"] == "HORS"]
active = [s for s in order if not stories[s]["hors"]]
hors_st = [s for s in order if stories[s]["hors"]]
covered = defaultdict(list)
for sid in active:
    for fid in stories[sid]["features"]:
        if fid not in inv:
            errors.append(f"{sid} : feature inconnue de 04 : {fid}")
        elif inv[fid]["phase_mvp"] == "HORS":
            errors.append(f"{sid} : story active qui cite la ligne hors produit {fid}")
        else:
            covered[fid].append(sid)
            if inv[fid]["phase_mvp"] not in ("P0-A", "P0-B"):
                warnings.append(f"{sid} : {fid} n'est pas P0 ({inv[fid]['phase_mvp']})")
miss_a = [x for x in p0a if x not in covered]
miss_b = [x for x in p0b if x not in covered]
for x in miss_a + miss_b:
    errors.append(f"feature non couverte : {x}")
# Révision P2P : l'ancien lot LB est supprimé (règles « P0-B ⇒ LB » et « P0-A seulement en LB » sans objet).

# Bêta construit
beta_built = [k for k in p0a if inv[k]["beta_pilote"].startswith(("OUI", "SIMPLIFI"))]
for fid in beta_built:
    want = ("PRÉALABLE",) if inv[fid]["lot_p0a"] == "C" else ("OUI",)
    if not any(stories[s]["beta"] in want for s in covered.get(fid, [])):
        errors.append(f"{fid} (Bêta {inv[fid]['beta_pilote']}, lot {inv[fid]['lot_p0a']}) sans story {want[0]}")
# lignes du lot C de 04 : portées par le lot LC
for fid in p0a:
    if inv[fid]["lot_p0a"] == "C" and not any(stories[s]["lot"] == "LC" for s in covered.get(fid, [])):
        errors.append(f"{fid} (lot C de 04) non portée par le lot LC")
beta_manual = [k for k in p0a if inv[k]["beta_pilote"] == "MANUEL"]
manual_in_beta = [k for k in beta_manual if any(stories[s]["beta"] == "OUI" for s in covered.get(k, []))]
early = []
for fid in p0a:
    lp = inv[fid]["lot_p0a"]
    for sid in covered.get(fid, []):
        if stories[sid]["lot"] in ("L0", "L1", "L2", "L3", "L4") and lp.isdigit() and RANK[stories[sid]["lot"]] < int(lp):
            early.append((fid, sid))

# ---------- dépendances ----------
for sid in active:
    for d in stories[sid]["deps"]:
        if d not in stories:
            errors.append(f"{sid} : dépendance inexistante {d}")
        elif d == sid:
            errors.append(f"{sid} : auto-dépendance")
        elif stories[d]["hors"]:
            errors.append(f"{sid} : dépend de la story hors produit {d}")
        else:
            if RANK[stories[d]["lot"]] > RANK[stories[sid]["lot"]]:
                errors.append(f"inversion de lot : {sid} ({stories[sid]['lot']}) dépend de {d} ({stories[d]['lot']})")
            if stories[sid]["beta"] == "OUI" and stories[d]["beta"] != "OUI":
                errors.append(f"règle Bêta : {sid} (OUI) dépend de {d} ({stories[d]['beta']})")
            if stories[sid]["beta"] == "PRÉALABLE" and stories[d]["lot"] not in ("L0", "L1", "L2", "L3", "L4", "LC"):
                errors.append(f"règle LC : {sid} dépend de {d} ({stories[d]['lot']})")
    lot, beta = stories[sid]["lot"], stories[sid]["beta"]
    exp = "OUI" if lot in ("L0", "L1", "L2", "L3", "L4") else ("PRÉALABLE" if lot == "LC" else "NON")
    if beta != exp:
        errors.append(f"{sid} : tranche bêta « {beta} » incohérente avec le lot {lot} (attendu {exp})")

# cycle detection + topological order
state, topo, cyc = {}, [], []


def visit(n, stack):
    state[n] = 1
    for d in stories[n]["deps"]:
        if d not in stories:
            continue
        if state.get(d) == 1:
            cyc.append(stack + [n, d])
        elif state.get(d) is None:
            visit(d, stack + [n])
    state[n] = 2
    topo.append(n)


sys.setrecursionlimit(10000)
for n in active:
    if state.get(n) is None:
        visit(n, [])
for c in cyc:
    errors.append("cycle : " + " -> ".join(c))

# ---------- design ----------
anc_cache = {}


def ancestors(n):
    if n in anc_cache:
        return anc_cache[n]
    res = set()
    for d in stories[n]["deps"]:
        if d in stories:
            res.add(d)
            res |= ancestors(d)
    anc_cache[n] = res
    return res


if not cyc:
    for sid in active:
        s = stories[sid]
        if s["design"] == "OUI" and s["epic"] != "E16" and "US-032" not in ancestors(sid):
            errors.append(f"règle design : {sid} (revue design) ne dépend pas de US-032")

# ---------- références ----------
t22, t08, t11, t17 = read("22_OPEN_QUESTIONS.md"), read("08_BUSINESS_RULES.md"), read("11_EDGE_CASES_AND_FAILURES.md"), read("17_DATA_MODEL_AND_ARCHITECTURE.md")
t16 = read("16_PRODUCT_REQUIREMENTS_DOCUMENT.md")
stext = "".join(stories[s]["text"] for s in order)
tj08 = set(re.findall(r"^\| (TJ\d{2}[a-z]?) \|", t08, re.M))
tjbase = {x[:4] for x in tj08}
bad = set()
for v in re.findall(r"\bT(\d{2})\b", stext):
    if not 1 <= int(v) <= 73:  # T69-T73 : révisé 2026-11-12, caution comme Turo (US-063)
        bad.add("T" + v)
for v in re.findall(r"\bTA(\d{2})\b", stext):
    if not 1 <= int(v) <= 11:
        bad.add("TA" + v)
for v in re.findall(r"\bRLS-(\d+)\b", stext):
    if not 1 <= int(v) <= 28:
        bad.add("RLS-" + v)
for v in re.findall(r"\b(TJ\d{2}[a-z]?)\b", stext):
    if (v not in tj08) if len(v) == 5 else (v not in tjbase):
        bad.add(v)
for v in re.findall(r"\bL0-(\d{2})\b", stext):
    if not 1 <= int(v) <= 10:
        bad.add("L0-" + v)
for v in re.findall(r"(?<![\w-])C(\d{1,2})\b", stext):
    if not 0 <= int(v) <= 20:
        bad.add("C" + v)
for v in set(re.findall(r"\b(?:OQ-[A-Z]+-\d{2}|UXQ-\d{2})\b", stext)):
    if v not in t22:
        bad.add(v)
for v in set(re.findall(r"\bBR-[A-Z]+(?:-\d{2})?\b", stext)):
    if v not in t08 and v not in t16:
        bad.add(v)
for v in set(re.findall(r"\bEC-\d{2}\b", stext)):
    if v not in t11:
        bad.add(v)
for v in set(re.findall(r"\bADR-\d{3}\b", stext)):
    if v not in t17:
        bad.add(v)
for v in set(re.findall(r"\bSM-\d+b?\b", stext)):
    if "### " + v + " " not in t08:
        bad.add(v)
for v in sorted(bad):
    errors.append(f"référence introuvable : {v}")

# ---------- statistiques ----------
print("Fichier : 19_DEVELOPMENT_BACKLOG.md")
print(f"Stories : {len(order)} dont {len(active)} actives et {len(hors_st)} hors produit ; rubriques et valeurs contrôlées")
print()
print("Par lot (stories / points) :")
tot = 0
for l in LOTS:
    ss = [s for s in order if stories[s]["lot"] == l]
    p = sum(stories[s]["pts"] for s in ss)
    tot += p
    print(f"  {l:3} {len(ss):3} stories  {p:4} pts")
print(f"  total {len(order)} stories  {tot} pts")
bp = sum(stories[s]["pts"] for s in order if stories[s]["beta"] == "OUI")
print(f"Tranche bêta (L0-L4) : {sum(1 for s in order if stories[s]['beta'] == 'OUI')} stories, {bp} pts ; "
      f"bêta P2P complète (L0-L5) : {sum(stories[s]['pts'] for s in order if stories[s]['lot'] in LOTS[:6])} pts")
print(f"Stories avec revue design : {sum(1 for s in order if stories[s]['design'] == 'OUI')}")
print()
print(f"Couverture P0-A : {len(p0a) - len(miss_a)}/{len(p0a)} ; P0-B : {len(p0b) - len(miss_b)}/{len(p0b)} ; "
      f"lignes HORS de 04 ignorées : {len(hors04)}")
print(f"Lignes construites de la tranche (OUI / SIMPLIFIÉ de 04) portées par une story de la tranche (ou PRÉALABLE pour le lot C) : "
      f"{sum(1 for k in beta_built if any(stories[s]['beta'] in ('OUI', 'PRÉALABLE') for s in covered.get(k, [])))}/{len(beta_built)}")
print(f"Lignes MANUEL de 04 dont l'outil de console est construit dans la tranche : {len(manual_in_beta)}/{len(beta_manual)}")
print(f"Dépendances : {sum(len(stories[s]['deps']) for s in active)} ; cycles : {len(cyc)}")
print(f"Information : {len(early)} couples (feature, story) construits plus tôt que le lot_p0a de 04 (écarts assumés §2)")

if not cyc:
    def longest(target):
        best = {}
        for n in topo:  # topo = dépendances d'abord
            prev = [best[d] for d in stories[n]["deps"] if d in best]
            b = max(prev, key=lambda x: x[0]) if prev else (0, [])
            best[n] = (b[0] + stories[n]["pts"], b[1] + [n])
        return best[target] if target else max(best.values(), key=lambda x: x[0])

    for label, tgt in (("fin du build de la tranche (US-404)", "US-404"), ("mise en service (US-607)", "US-607"),
                       ("bêta P2P complète (plus long chemin)", None)):
        if tgt is None or tgt in stories:
            p, path = longest(tgt)
            print(f"Chemin critique vers {label} : {p} pts, {len(path)} stories")
            print("  " + " -> ".join(path))

# ---------- 21_COVERAGE_MATRIX.csv : comptes recalculés depuis 04 et 19 (revue QA du bloc S2 / S5 / S6, US-057, 2026-11-03) ----------
# Lecture indépendante du parsing ci-dessus : FINAL-FEAT-INV (total et phases de 04), FINAL-E0 à E18 (« N stories / M pts » de 19,
# « K lignes P0 » du README de 04 §4), aucune version périmée (« 16 v4 », « 17 v5 », « 19 v2 », « à réviser (S3 à S6) »).
def _coverage21():
    import collections
    S = Path(__file__).resolve().parent.parent
    _c21_err = []
    inv = list(csv.DictReader(open(S / "04_FEATURE_INVENTORY.csv", encoding="utf-8")))
    ph = collections.Counter(r["phase_mvp"] for r in inv)
    readme = (S / "04_FEATURE_INVENTORY_README.md").read_text(encoding="utf-8")
    lines = {m.group(1): int(m.group(2)) for m in re.finditer(r"(?m)^\| (E\d+) [^|]*\| P0-A \| (\d+) \|", readme)}
    bl = (S / "19_DEVELOPMENT_BACKLOG.md").read_text(encoding="utf-8")
    st = collections.defaultdict(lambda: [0, 0])
    for p in re.split(r"(?m)^(?=#### US-\d{3} )", bl)[1:]:
        e = re.search(r"(?m)^- \*\*Epic\*\* : (E\d+)", p)
        lot = re.search(r"(?m)^- \*\*Lot\*\* : (\S+)", p)
        est = re.search(r"(?m)^- \*\*Estimation\*\* : (\d+)", p)
        if lot and lot.group(1) == "HORS":
            continue
        if not e or not lot:
            _c21_err.append(f"story active sans Epic ou Lot : {p.splitlines()[0][:40]}")
            continue
        st[e.group(1)][0] += 1
        st[e.group(1)][1] += int(est.group(1)) if est else 0
    cov = {r["id"]: r for r in csv.DictReader(open(S / "21_COVERAGE_MATRIX.csv", encoding="utf-8"))}
    print(f"04 : {len(inv)} lignes ; " + ", ".join(f"{k} {ph[k]}" for k in ("P0-A", "P0-B", "P1", "P2", "P3", "HORS")))
    print("19 (stories actives / points) : " + ", ".join(f"{k} {v[0]}/{v[1]}" for k, v in sorted(st.items(), key=lambda kv: int(kv[0][1:]))))
    fi = cov.get("FINAL-FEAT-INV")
    if not fi:
        _c21_err.append("FINAL-FEAT-INV absente de 21")
    else:
        txt = fi["resultat"]
        need = [f"{len(inv)} lignes"] + [f"{k} {ph[k]}" for k in ("P0-A", "P1", "P2", "P3", "HORS")]
        miss = [n for n in need if not re.search(rf"(?<![\d]){re.escape(n)}(?![\d])", txt)]
        stale = [s for s in ("à ajouter à check_inventory", "à aligner (S5, S6)", "dont 24 HORS PRODUIT") if s in " ".join(fi.values())]
        if ph["P0-B"] and "P0-B" not in txt:
            miss.append(f"P0-B {ph['P0-B']}")
        print(f"FINAL-FEAT-INV : manquants {miss} ; tâches faites encore citées {stale}")
        _c21_err += [f"FINAL-FEAT-INV {m}" for m in miss + stale]
    for e in sorted(st, key=lambda x: int(x[1:])):
        r = cov.get(f"FINAL-{e}")
        if not r:
            _c21_err.append(f"FINAL-{e} absente de 21")
            continue
        n, pts = st[e]
        want = f"{n} stories / {pts} pts"
        ok_s = want in r["resultat"]
        ok_l = e == "E0" or re.search(rf"(?<!\d){lines.get(e, -1)} lignes P0", r["resultat"]) is not None
        stale = [s for s in ("16 v4", "17 v5", "19 v2", "à réviser (S3 à S6)") if s in r["source"] + r["resultat"]]
        if not ok_s:
            _c21_err.append(f"FINAL-{e} : « {want} » absent")
        if not ok_l:
            _c21_err.append(f"FINAL-{e} : « {lines.get(e)} lignes P0 » absent")
        if stale:
            _c21_err.append(f"FINAL-{e} : versions périmées {stale}")
        print(f"  FINAL-{e} : {'OK ' if ok_s and ok_l and not stale else 'KO '} {want}" + ("" if e == "E0" else f", {lines.get(e)} lignes P0"))
    missing_e = [e for e in lines if e not in st]
    if missing_e:
        _c21_err.append(f"epics de 04 sans story active dans 19 : {missing_e}")

    return _c21_err


print()
print("Matrice de couverture 21 (comptes contre 04 et 19) :")
errors += [f"21 : {e}" for e in _coverage21()]

print()
for w in warnings:
    print("AVERTISSEMENT : " + w)
for e in errors:
    print("ERREUR : " + e)
print("RÉSULTAT : " + ("OK" if not errors else f"ÉCHEC ({len(errors)} erreur(s))"))
sys.exit(1 if errors else 0)
