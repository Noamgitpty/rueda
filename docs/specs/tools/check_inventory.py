"""Contrôle de 04_FEATURE_INVENTORY.csv (à lancer avec `python -I tools/check_inventory.py`).

Vérifie : encodage UTF-8, 19 colonnes (15 d'origine + phase_mvp + lot_p0a, beta_pilote,
risque_legal_financier), tous les champs entre guillemets,
identifiants uniques et bien formés, cohérence priorite_produit / phase_mvp, dépendances existantes,
aucune dépendance inversée (une ligne ne dépend jamais d'une ligne d'une phase plus tardive),
aucun cycle parmi les lignes P0 (et compte des cycles sur tout le graphe), et couverture exacte
des lignes P0 par les epics du README (chaque ligne P0 dans un seul epic).
Révision 5 (VERIF_18-F01) : valeur de lot `C` (connecteurs réels) acceptée et ordonnée après le lot 4.
Révision 3 (corrigé VERIF_10-V10-08, V10-01, V10-13) : identifiants P0 cités dans la description d'une
ligne P0 mais absents de `dependances` (chaque mention doit être une dépendance ou une « Réf. non
bloquante » documentée dans `notes`) ; ordre des lots du P0-A (aucune ligne avant une ligne dont elle
dépend) ; valeurs de `beta_pilote` (une ligne construite dans la Bêta pilote ne dépend jamais d'une ligne
DIFFÉRÉ) ; valeurs de `risque_legal_financier` (évalué pour toute ligne P0) ; estimation par barème
(P0-A, Bêta pilote, P0-B, P1) ; avertissement sur les descriptions P0 de moins de 80 caractères.
Révision 6 (US-058, pivot P2P) : valeur `HORS` de `phase_mvp` et de `priorite_produit` pour les lignes hors produit
(DEC-FONDATEUR-13) ; ordonnée après P3 : aucune ligne du produit ne peut dépendre d'une ligne `HORS` (inversion) ; une
ligne `HORS` n'entre dans aucun epic, aucune estimation ni aucun contrôle propre au P0.
Sortie : rapport texte ; code retour 1 si un contrôle échoue.
"""
import csv
import io
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "04_FEATURE_INVENTORY.csv"
README_PATH = ROOT / "04_FEATURE_INVENTORY_README.md"

EXPECTED = ["feature_id", "module", "sous_module", "nom", "persona", "description_courte",
            "turo_statut_preuve", "source", "regles_liees", "dependances", "priorite_produit",
            "complexite_tech", "effort_ops", "pertinence_latam", "notes", "phase_mvp",
            "lot_p0a", "beta_pilote", "risque_legal_financier"]
ORDER = {"P0-A": 0, "P0-B": 1, "P1": 2, "P2": 3, "P3": 4, "HORS": 5}
errors = []


def fail(msg):
    errors.append(msg)


raw = CSV_PATH.read_bytes()
try:
    text = raw.decode("utf-8")
except UnicodeDecodeError as e:
    print("ÉCHEC encodage UTF-8 :", e)
    sys.exit(1)
if text.startswith("﻿"):
    fail("BOM UTF-8 présent")

rows = list(csv.reader(io.StringIO(text)))
header, data = rows[0], rows[1:]
print(f"Fichier : {CSV_PATH.name} — {len(data)} lignes de données")
if header != EXPECTED:
    fail(f"en-tête inattendu : {header}")
bad_len = [i + 2 for i, r in enumerate(data) if len(r) != len(EXPECTED)]
if bad_len:
    fail(f"lignes avec un nombre de colonnes ≠ {len(EXPECTED)} : {bad_len[:10]}")
print(f"Colonnes : {len(header)} (attendu {len(EXPECTED)}) ; lignes au mauvais format : {len(bad_len)}")

# tous les champs entre guillemets : la ré-écriture QUOTE_ALL doit redonner le fichier à l'identique
buf = io.StringIO()
csv.writer(buf, quoting=csv.QUOTE_ALL, lineterminator="\n").writerows(rows)
quoted_ok = buf.getvalue() == text
if not quoted_ok:
    fail("le fichier n'est pas intégralement entre guillemets (ou fins de ligne non \\n)")
print(f"Tous les champs entre guillemets : {'oui' if quoted_ok else 'NON'}")

recs = [dict(zip(header, r)) for r in data if len(r) == len(EXPECTED)]
ids = [r["feature_id"] for r in recs]
dup = [k for k, v in Counter(ids).items() if v > 1]
if dup:
    fail(f"identifiants en double : {dup}")
badid = [i for i in ids if not re.fullmatch(r"[A-Z0-9]{3,4}-\d{3}", i)]
if badid:
    fail(f"identifiants mal formés : {badid}")
badmod = [r["feature_id"] for r in recs if not r["module"].startswith(r["feature_id"].split("-")[0] + " ")]
if badmod:
    fail(f"module incohérent avec le préfixe : {badmod}")
print(f"Identifiants uniques : {'oui' if not dup else 'NON'} ; mal formés : {len(badid)} ; module/préfixe incohérents : {len(badmod)}")

by = {r["feature_id"]: r for r in recs}
badphase = []
for r in recs:
    ph, pr = r["phase_mvp"], r["priorite_produit"]
    if ph not in ORDER or (pr == "P0") != ph.startswith("P0") or (pr != "P0" and ph != pr):
        badphase.append((r["feature_id"], pr, ph))
if badphase:
    fail(f"priorite_produit / phase_mvp incohérents : {badphase[:10]}")
print(f"Cohérence priorite_produit / phase_mvp : {'oui' if not badphase else 'NON'}")


def deps(r):
    return [d.strip() for d in r["dependances"].split(";") if d.strip()]


unknown, inversions, selfdep = [], [], []
for r in recs:
    for d in deps(r):
        if d == r["feature_id"]:
            selfdep.append(d)
        elif d not in by:
            unknown.append((r["feature_id"], d))
        elif ORDER[by[d]["phase_mvp"]] > ORDER[r["phase_mvp"]]:
            inversions.append((r["feature_id"], r["phase_mvp"], d, by[d]["phase_mvp"]))
if unknown:
    fail(f"dépendances inconnues : {unknown[:10]}")
if selfdep:
    fail(f"auto-dépendances : {selfdep}")
if inversions:
    fail(f"dépendances inversées : {inversions[:20]}")
ndeps = sum(len(deps(r)) for r in recs)
print(f"Dépendances : {ndeps} au total ; inconnues : {len(unknown)} ; auto-dépendances : {len(selfdep)} ; inversées (toutes phases) : {len(inversions)}")


def cycles(nodes):
    """Composantes fortement connexes de taille > 1 (Tarjan itératif) restreintes à `nodes`."""
    nodes = set(nodes)
    index, low, onstack, stack, out, counter = {}, {}, set(), [], [], [0]
    for start in sorted(nodes):
        if start in index:
            continue
        work = [(start, iter([d for d in deps(by[start]) if d in nodes]))]
        index[start] = low[start] = counter[0]; counter[0] += 1
        stack.append(start); onstack.add(start)
        while work:
            v, it = work[-1]
            advanced = False
            for w in it:
                if w not in index:
                    index[w] = low[w] = counter[0]; counter[0] += 1
                    stack.append(w); onstack.add(w)
                    work.append((w, iter([d for d in deps(by[w]) if d in nodes])))
                    advanced = True
                    break
                elif w in onstack:
                    low[v] = min(low[v], index[w])
            if advanced:
                continue
            work.pop()
            if work:
                low[work[-1][0]] = min(low[work[-1][0]], low[v])
            if low[v] == index[v]:
                comp = []
                while True:
                    w = stack.pop(); onstack.discard(w); comp.append(w)
                    if w == v:
                        break
                if len(comp) > 1:
                    out.append(sorted(comp))
    return out


p0 = [r["feature_id"] for r in recs if r["phase_mvp"].startswith("P0")]
c0 = cycles(p0)
call = cycles(ids)
if c0:
    fail(f"cycles parmi les lignes P0 : {c0}")
print(f"Cycles parmi les lignes P0 : {len(c0)} ; cycles sur tout le graphe : {len(call)}")

# ordre de construction possible (tri topologique des P0) : profondeur max de la chaîne
depth = {}


def d_of(n):
    if n not in depth:
        depth[n] = 1 + max([d_of(d) for d in deps(by[n]) if d in by and by[d]["phase_mvp"].startswith("P0")] or [0])
    return depth[n]


if not c0:
    print(f"Plus longue chaîne de dépendances P0 : {max(d_of(n) for n in p0)} niveaux")

print("\nRépartition par phase_mvp :")
cnt = Counter(r["phase_mvp"] for r in recs)
for k in ORDER:
    print(f"  {k:5} {cnt[k]:4}")
print(f"  total {len(recs)}")

print("\nP0 par module (P0-A / P0-B) :")
mod = defaultdict(Counter)
for r in recs:
    if r["phase_mvp"].startswith("P0"):
        mod[r["feature_id"].split("-")[0]][r["phase_mvp"]] += 1
for m in sorted(mod):
    print(f"  {m:5} {mod[m]['P0-A']:3} / {mod[m]['P0-B']:2}")

print("\nStatut de preuve (toutes lignes) :")
for k, v in Counter(r["turo_statut_preuve"] for r in recs).most_common():
    print(f"  {k:18} {v}")

# couverture des epics déclarés dans le README (tableau « | E<n> ... | <IDs> | »)
if README_PATH.exists():
    seen = Counter()
    epics = 0
    for line in README_PATH.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\| (E\d+) [^|]*\| (P0-[AB]) \| (\d+) \| ([^|]+)\|", line)
        if m:
            epics += 1
            lst = re.findall(r"[A-Z0-9]{3,4}-\d{3}", m.group(4))
            if len(lst) != int(m.group(3)):
                fail(f"epic {m.group(1)} : {len(lst)} IDs listés pour un compte annoncé de {m.group(3)}")
            for i in lst:
                seen[i] += 1
                if i not in by or by[i]["phase_mvp"] != m.group(2):
                    fail(f"epic {m.group(1)} : {i} absent ou pas en {m.group(2)}")
    missing = [i for i in p0 if seen[i] == 0]
    multi = [i for i, v in seen.items() if v > 1]
    if missing:
        fail(f"lignes P0 sans epic : {missing}")
    if multi:
        fail(f"lignes P0 dans plusieurs epics : {multi}")
    print(f"\nEpics lus dans le README : {epics} ; lignes P0 couvertes : {sum(1 for i in p0 if seen[i])}/{len(p0)}")

# ---- révision 3 (VERIF_10) ------------------------------------------------------------------------
IDRE = re.compile(r"\b[A-Z0-9]{3,4}-\d{3}\b")
NBRE = re.compile(r"Réf\. non bloquante : ([^(|]*)")


def nonbloq(r):
    out = set()
    for mm in NBRE.finditer(r["notes"]):
        out |= set(IDRE.findall(mm.group(1)))
    return out


undeclared, documented = [], 0
for r in recs:
    if not r["phase_mvp"].startswith("P0"):
        continue
    ds, nb = set(deps(r)), nonbloq(r)
    for i in sorted(set(IDRE.findall(r["description_courte"])) - {r["feature_id"]}):
        if i in by and by[i]["phase_mvp"].startswith("P0") and i not in ds:
            if i in nb:
                documented += 1
            else:
                undeclared.append((r["feature_id"], i))
if undeclared:
    fail(f"mentions P0 ni dans `dependances` ni documentées « Réf. non bloquante » : {undeclared[:30]}")
print(f"\nMentions d'un ID P0 dans une description P0 hors `dependances` : {len(undeclared)} non documentée(s) ;"
      f" {documented} documentées « Réf. non bloquante »")

# lots 0 à 4 (18 §6) + lot « C » des connecteurs réels, après le choix du pays de lancement (VERIF_18-F01,
# révision 5) : ordonné après le lot 4 ; aucune ligne des lots 0 à 4 ne peut dépendre d'une ligne du lot C.
LOTRANK = {**{str(k): k for k in range(5)}, "C": 5}
LOTS = set(LOTRANK)
badlot, lotinv = [], []
for r in recs:
    if (r["phase_mvp"] == "P0-A") != (r["lot_p0a"] != "") or (r["lot_p0a"] and r["lot_p0a"] not in LOTS):
        badlot.append(r["feature_id"])
    elif r["lot_p0a"]:
        for d in deps(r):
            if d in by and by[d]["lot_p0a"] in LOTS and LOTRANK[by[d]["lot_p0a"]] > LOTRANK[r["lot_p0a"]]:
                lotinv.append((r["feature_id"], r["lot_p0a"], d, by[d]["lot_p0a"]))
if badlot:
    fail(f"lot_p0a absent, en trop ou invalide : {badlot[:20]}")
if lotinv:
    fail(f"inversions de lot (ligne avant sa dépendance) : {lotinv[:20]}")
lotcnt = Counter(r["lot_p0a"] for r in recs if r["lot_p0a"])
print("Lots du P0-A : " + ", ".join(f"lot {k} = {lotcnt[k]}" for k in sorted(lotcnt, key=LOTRANK.get))
      + f" ; inversions de lot : {len(lotinv)}")

BETA = ["OUI", "SIMPLIFIÉ", "MANUEL", "DIFFÉRÉ"]
badbeta, betainv = [], []
for r in recs:
    v = r["beta_pilote"]
    if (r["phase_mvp"] == "P0-A") != (v != "") or (v and v not in BETA):
        badbeta.append(r["feature_id"])
    if v in ("OUI", "SIMPLIFIÉ"):
        betainv += [(r["feature_id"], d) for d in deps(r) if d in by and by[d]["beta_pilote"] == "DIFFÉRÉ"]
if badbeta:
    fail(f"beta_pilote absent, en trop ou invalide : {badbeta[:20]}")
if betainv:
    fail(f"ligne construite dans la Bêta pilote qui dépend d'une ligne DIFFÉRÉ : {betainv[:20]}")
bc = Counter(r["beta_pilote"] for r in recs if r["beta_pilote"])
print("Bêta pilote : " + ", ".join(f"{k} {bc[k]}" for k in BETA) + f" ; dépendances vers DIFFÉRÉ : {len(betainv)}")

RISK = {"faible", "moyen", "élevé", "non évalué"}
badrisk = [r["feature_id"] for r in recs if r["risque_legal_financier"] not in RISK
           or (r["phase_mvp"].startswith("P0") and r["risque_legal_financier"] == "non évalué")]
if badrisk:
    fail(f"risque_legal_financier invalide, ou non évalué en P0 : {badrisk[:20]}")
print("Risque juridique / financier des lignes P0 : " + ", ".join(
    f"{k} {v}" for k, v in Counter(r["risque_legal_financier"] for r in recs if r["phase_mvp"].startswith("P0")).most_common()))

# Estimation par barème (README §1 bis) : jours-agent par ligne (ex-jours-développeur assistés par IA) ; 1 unité d'effort = 10 j-agent
# (ex-« semaine-équipe » ; DEC-FONDATEUR-05 : aucun développeur humain, durée calendaire mesurée après le lot 0).
BAREME = {"faible": (0.5, 1.5), "moyenne": (1.5, 2.5), "élevée": (3.0, 8.0)}
DOWN = {"élevée": "moyenne", "moyenne": "faible"}


def weight(r, beta=False):
    c = r["complexite_tech"]
    if not beta or r["beta_pilote"] == "OUI":
        return BAREME[c]
    if r["beta_pilote"] == "SIMPLIFIÉ":
        return BAREME[DOWN[c]] if c in DOWN else (0.25, 0.75)
    return (0.0, 0.0)


def total(sel, beta=False):
    return (sum(weight(r, beta)[0] for r in sel) / 10, sum(weight(r, beta)[1] for r in sel) / 10)


badc = [r["feature_id"] for r in recs if r["complexite_tech"] not in BAREME]
if badc:
    fail(f"complexite_tech hors barème : {badc[:10]}")
else:
    pa = [r for r in recs if r["phase_mvp"] == "P0-A"]
    print("\nEstimation par barème (unités d'effort : 1 unité = 10 jours-agent, ex-« semaine-équipe » ; ordre de grandeur, barème calibré, non mesuré, sans valeur calendaire) :")
    lo, hi = total(pa)
    print(f"  P0-A complet ({len(pa)} lignes) : lignes {lo:.1f}–{hi:.1f} + socle 1,5–3 + durcissement et recette interne 1–2"
          f" = {lo + 2.5:.1f}–{hi + 5:.1f}")
    built = [r for r in pa if r["beta_pilote"] in ("OUI", "SIMPLIFIÉ")]
    lo, hi = total(pa, beta=True)
    print(f"  Bêta pilote ({len(built)} lignes construites) : lignes {lo:.1f}–{hi:.1f} + socle réduit 1–2"
          f" + recette interne 0,5–1 = {lo + 1.5:.1f}–{hi + 3:.1f}")
    lo, hi = total([r for r in recs if r["phase_mvp"] == "P0-B"])
    print(f"  P0-B (lignes seules, hors certification PSP et conformité) : {lo:.1f}–{hi:.1f}")
    p1 = [r for r in recs if r["phase_mvp"] == "P1"]
    lo, hi = total(p1)
    print(f"  P1 ({len(p1)} lignes, même barème que le P0-A, lignes seules) : {lo:.1f}–{hi:.1f}")

short = [r["feature_id"] for r in recs if r["phase_mvp"].startswith("P0") and len(r["description_courte"]) < 80]
print(f"Avertissement (non bloquant) : {len(short)} descriptions P0 de moins de 80 caractères, à compléter avant leur lot")

print("\nRÉSULTAT :", "OK" if not errors else f"{len(errors)} ÉCHEC(S)")
for e in errors:
    print("  -", e)
sys.exit(1 if errors else 0)
