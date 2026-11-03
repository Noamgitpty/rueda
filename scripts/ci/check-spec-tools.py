"""Contrôle CI des oracles et vérificateurs de la spécification (US-002).

Exécute chaque script de `docs/specs/tools/` cité dans `docs/specs/00_README.md` §4
(sauf `verify_cxl_tests.py`, déclassé : il n'asserte rien) avec `python -I -X utf8`,
puis vérifie que le code de sortie vaut 0 et que la sortie contient les motifs attendus
(« RÉSULTAT : OK », « 0 écart », « 48 vecteurs »…) et aucun motif interdit.

Les scripts écrivent dans `verification/` : on les exécute donc sur une **copie
temporaire** de `docs/specs/`, qui reste intacte (handoff : ne pas modifier docs/specs).

Usage : python -I -X utf8 scripts/ci/check-spec-tools.py [--specs docs/specs] [--only nom.py ...]
Sortie : 0 si tout est conforme, 1 sinon.
"""

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Motifs par script (regex, mode MULTILINE). « require » : tous doivent apparaître ;
# « forbid » : aucun ne doit apparaître. Les valeurs attendues viennent de 00_README §4.
COMMON_FORBID = [r"Traceback \(most recent call last\)"]

EXPECTATIONS = {
    # Structure des documents
    "check_inventory.py": {"require": [r"^RÉSULTAT : OK\s*$"]},
    "check_prd_structure.py": {"require": [r"^RÉSULTAT : OK\s*$"]},
    "check_backlog.py": {"require": [r"^RÉSULTAT : OK\s*$"]},
    "verif19_backlog.py": {"require": [r"^ERREURS 0\s*$"]},
    "verif18_crossref.py": {
        # 0 cité sans définition, hors 2 faux positifs connus (« SM-x » dans 17, « SHA-256 »).
        "require": [
            r"^- SM : .*, 1 cites sans definition$",
            r"^\s+\* SM-x : 17_:\d+$",
            r"^- FEAT : .*, 1 cites sans definition$",
            r"^\s+\* SHA-256 : ",
            r"^- BR : .*, 0 cites sans definition$",
        ],
        "forbid": [r"^- (?!SM :|FEAT :).*, [1-9]\d* cites sans definition$"],
    },
    # Lecture humaine : seul le code de sortie et l'absence de trace d'erreur sont contrôlés.
    "verif18_stale.py": {"require": [r"^### "]},
    "verif15_struct.py": {
        "require": [
            r"^sheets with heading problems 0$",
            r"^P0 missing from sheets: \[\]$",
            r"^dup ids \[\]$",
            r"^feature refs unknown \[\]$",
            r"^sheets with non GWT-balanced AC 0$",
        ],
        "forbid": [r"unknown \{[^}]", r"unknown \[[^\]]"],
    },
    # Statuts de preuve par fiche : sortie statistique, sans verdict ; seul le compte est contrôlé.
    "verif15_conf.py": {"require": [r"^Counter\(\{"]},
    # Oracles monétaires
    "verif11_settlement.py": {"require": [r"^Vecteurs executes: 48 \| ecarts: 0$"]},
    "independent_settlement_check.py": {"require": [r"^ECARTS sur T01-T48 : 0$"]},
    "verif12_t49plus.py": {"require": [r"^38/38$"]},
    "check_t49plus.py": {"require": [r"^T49-T65 : ecarts = 0$"]},
    "check_verif12_fixes.py": {"require": [r"^0 ecart$"], "forbid": [r"ECART\(S\)"]},
    "check_t66_68.py": {"require": [r"^RÉSULTAT : OK\s*$"]},
    "check_ta_consolidation.py": {"require": [r"^RÉSULTAT : OK\s*$"]},
    "check_legs.py": {"require": [r"^RÉSULTAT : OK\s*$", r"^Lignes TJ trouvées dans 08 : 47 ; vecteurs calculés : 47$"]},
    "verif15_ta.py": {"require": [r"^OK$"]},
}

# Scripts de tools/ volontairement non exécutés (avec la raison).
EXCLUDED = {
    "verify_cxl_tests.py": "déclassé (00_README §4) : imprime, n'asserte rien",
    "verif24_stats.py": "hors liste de 00_README §4 (statistiques de l'audit 24)",
}


def check_output(name, returncode, output):
    """Retourne la liste des écarts (vide si conforme)."""
    exp = EXPECTATIONS[name]
    errors = []
    if returncode != 0:
        errors.append(f"code de sortie {returncode} (0 attendu)")
    for pat in exp.get("require", []):
        if not re.search(pat, output, re.MULTILINE):
            errors.append(f"motif attendu absent : {pat}")
    for pat in COMMON_FORBID + exp.get("forbid", []):
        m = re.search(pat, output, re.MULTILINE)
        if m:
            errors.append(f"motif interdit présent : {pat} -> « {m.group(0).strip()} »")
    return errors


def run_tool(specs, name, timeout=600):
    proc = subprocess.run(
        [sys.executable, "-I", "-X", "utf8", f"tools/{name}"],
        cwd=specs,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    return proc.returncode, proc.stdout + proc.stderr


def unknown_tools(specs):
    """Scripts de tools/ ni contrôlés ni exclus : un nouvel outil doit être classé ici."""
    present = {p.name for p in (Path(specs) / "tools").glob("*.py")}
    return sorted(present - set(EXPECTATIONS) - set(EXCLUDED))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--specs", default="docs/specs")
    ap.add_argument("--only", nargs="*", default=None)
    args = ap.parse_args(argv)

    src = Path(args.specs).resolve()
    if not (src / "tools").is_dir():
        print(f"ÉCHEC : {src / 'tools'} introuvable", file=sys.stderr)
        return 1
    names = args.only or list(EXPECTATIONS)
    failures = 0
    for extra in unknown_tools(src):
        print(f"ÉCHEC {extra} : script non classé (ajouter à EXPECTATIONS ou EXCLUDED)")
        failures += 1

    with tempfile.TemporaryDirectory(prefix="rueda-specs-") as tmp:
        specs = Path(tmp) / "specs"
        shutil.copytree(src, specs)
        for name in names:
            if name not in EXPECTATIONS:
                print(f"ÉCHEC {name} : pas de motifs attendus définis")
                failures += 1
                continue
            rc, out = run_tool(specs, name)
            errors = check_output(name, rc, out)
            if errors:
                failures += 1
                print(f"ÉCHEC {name}")
                for e in errors:
                    print(f"    {e}")
                print("    --- fin de la sortie ---")
                for line in out.strip().splitlines()[-15:]:
                    print(f"    | {line}")
            else:
                print(f"OK    {name}")
    for name, why in EXCLUDED.items():
        print(f"exclu {name} : {why}")
    print(f"RÉSULTAT : {'OK' if not failures else f'{failures} ÉCHEC(S)'}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
