"""Contrôle CI des oracles et vérificateurs de la spécification (US-002, US-050).

Exécute chaque script de `docs/specs/tools/` inscrit au registre des oracles
`docs/specs/tools/registry.json` avec `python -I -X utf8`, puis vérifie que le code de
sortie vaut 0 et que la sortie contient les motifs attendus (« RÉSULTAT : OK »,
« 0 écart », « 48 vecteurs »…) et aucun motif interdit.

Le registre ne contient que des **attentes** (données, révisables avec les specs sans
toucher scripts/ci). Tout ce qui pourrait affaiblir le contrôle reste ici, en dur :
`EXCLUDED` (seule façon de ne pas exécuter un script), `FLOOR_ORACLES` (oracles qui
doivent figurer au registre), `REQUIRED_COUNTS` (comptes obligatoires, >= 1),
`COMMON_FORBID` et les règles de validation du registre. Toute anomalie du registre
(absent, illisible, vide, clé inconnue ou en double, script absent ou hors de tools/)
fait échouer le contrôle.

Les scripts écrivent dans `verification/` : on les exécute donc sur une **copie
temporaire** de `docs/specs/`, qui reste intacte (handoff : ne pas modifier docs/specs).

Usage : python -I -X utf8 scripts/ci/check-spec-tools.py [--specs docs/specs] [--only nom.py ...]
Sortie : 0 si tout est conforme, 1 sinon.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REGISTRY_NAME = "registry.json"
REGISTRY_VERSION = 1

# Motif interdit pour tous les scripts (regex, mode MULTILINE), indépendant du registre.
COMMON_FORBID = [r"Traceback \(most recent call last\)"]

# Scripts de tools/ volontairement non exécutés (avec la raison). Le registre ne peut
# rien exclure : seul ce dictionnaire le peut, et le modifier touche scripts/ci.
EXCLUDED = {
    "verify_cxl_tests.py": "déclassé (00_README §4) : imprime, n'asserte rien",
    "verif24_stats.py": "hors liste de 00_README §4 (statistiques de l'audit 24)",
}

# Plancher : oracles qui doivent figurer au registre (ceux de 00_README §4 au 2026-11-02,
# dont tous les oracles d'argent, plus export_golden_vectors.py ajouté par US-016). Le registre peut
# contenir d'autres oracles (inclusion, pas égalité) ; rendre un oracle plancher touche ce fichier. En retirer un du registre fait échouer le contrôle.
FLOOR_ORACLES = frozenset(
    {
        # Structure des documents
        "check_inventory.py",
        "check_prd_structure.py",
        "check_backlog.py",
        "verif19_backlog.py",
        "verif18_crossref.py",
        "verif18_stale.py",
        "verif15_struct.py",
        "verif15_conf.py",
        # Oracles monétaires
        "verif11_settlement.py",
        "independent_settlement_check.py",
        "verif12_t49plus.py",
        "check_t49plus.py",
        "check_verif12_fixes.py",
        "check_t66_68.py",
        "check_ta_consolidation.py",
        "check_legs.py",
        "verif15_ta.py",
        "export_golden_vectors.py",  # US-016 : export des vecteurs dorés lu par @rueda/money/golden-vectors
    }
)

# Comptes obligatoires : l'entrée doit déclarer ces comptes (entier >= 1), et chacun doit
# figurer comme nombre dans au moins un motif « require ».
REQUIRED_COUNTS = {
    "verif11_settlement.py": ("vecteurs",),
    "verif12_t49plus.py": ("vecteurs",),
    "check_legs.py": ("vecteurs",),
}

ENTRY_KEYS = frozenset({"comment", "require", "forbid", "counts"})
TOP_KEYS = frozenset({"$comment", "version", "oracles"})
NAME_RE = re.compile(r"[A-Za-z0-9_]+\.py")


class RegistryError(Exception):
    """Registre des oracles invalide ; `errors` liste tous les écarts trouvés."""

    def __init__(self, errors):
        super().__init__("; ".join(errors))
        self.errors = list(errors)


def _no_duplicates(pairs):
    seen = {}
    for key, value in pairs:
        if key in seen:
            raise RegistryError([f"clé en double : « {key} »"])
        seen[key] = value
    return seen


def _check_patterns(name, field, value, errors, required):
    """Retourne les motifs valides de `value` ; ajoute à `errors` chaque motif refusé."""
    if not isinstance(value, list) or (required and not value):
        qualif = " non vide" if required else ""
        errors.append(f"{name} : « {field} » doit être une liste{qualif} de motifs")
        return []
    ok = []
    for pat in value:
        if not isinstance(pat, str) or not pat:
            errors.append(f"{name} : motif « {field} » non textuel ou vide : {pat!r}")
            continue
        try:
            rx = re.compile(pat, re.MULTILINE)
        except re.error as exc:
            errors.append(f"{name} : motif « {field} » invalide {pat!r} : {exc}")
            continue
        if required and rx.search(""):
            errors.append(f"{name} : motif « require » {pat!r} accepte une sortie vide")
            continue
        ok.append(pat)
    return ok


def validate_registry(data, tools_dir):
    """Valide le registre (objet JSON déjà lu) ; retourne {script: attentes} ou lève RegistryError."""
    errors = []
    if not isinstance(data, dict):
        raise RegistryError(["le registre doit être un objet JSON"])
    for key in sorted(set(data) - TOP_KEYS):
        errors.append(f"clé inconnue au premier niveau : « {key} »")
    version = data.get("version")
    if isinstance(version, bool) or version != REGISTRY_VERSION:
        errors.append(f"« version » doit valoir {REGISTRY_VERSION}")
    oracles = data.get("oracles")
    if not isinstance(oracles, dict) or not oracles:
        errors.append("« oracles » doit être un objet non vide")
        raise RegistryError(errors)

    tools_dir = Path(tools_dir).resolve()
    result = {}
    for name, entry in oracles.items():
        if not NAME_RE.fullmatch(name):
            errors.append(f"{name!r} : nom de script invalide (nom simple *.py de docs/specs/tools/ attendu)")
            continue
        # NAME_RE exclut déjà tout séparateur et « .. ». Ce contrôle est gardé pour les liens
        # symboliques : un tools/x.py qui pointe hors de tools/ se résout ailleurs et est refusé.
        path = (tools_dir / name).resolve()
        if path.parent != tools_dir:
            errors.append(f"{name} : chemin hors de docs/specs/tools/")
            continue
        if not path.is_file():
            errors.append(f"{name} : script absent de docs/specs/tools/")
            continue
        if name in EXCLUDED:
            errors.append(f"{name} : inscrit au registre et dans EXCLUDED (contradiction)")
            continue
        if not isinstance(entry, dict):
            errors.append(f"{name} : l'entrée doit être un objet")
            continue
        for key in sorted(set(entry) - ENTRY_KEYS):
            errors.append(f"{name} : clé inconnue « {key} » (seules {sorted(ENTRY_KEYS)} sont admises)")
        if "comment" in entry and not isinstance(entry["comment"], str):
            errors.append(f"{name} : « comment » doit être un texte")
        require = _check_patterns(name, "require", entry.get("require"), errors, required=True)
        forbid = _check_patterns(name, "forbid", entry.get("forbid", []), errors, required=False)
        counts = entry.get("counts", {})
        if not isinstance(counts, dict):
            errors.append(f"{name} : « counts » doit être un objet")
            counts = {}
        for cname, value in counts.items():
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                errors.append(f"{name} : compte « {cname} » = {value!r} (entier >= 1 attendu)")
            elif not any(re.search(rf"(?<![0-9]){value}(?![0-9])", p) for p in require):
                errors.append(f"{name} : compte « {cname} » = {value} absent des motifs « require »")
        for cname in REQUIRED_COUNTS.get(name, ()):
            if cname not in counts:
                errors.append(f"{name} : compte obligatoire « {cname} » manquant")
        result[name] = {"require": require, "forbid": forbid}

    for name in sorted(FLOOR_ORACLES - set(oracles)):
        errors.append(f"{name} : oracle plancher absent du registre (le retirer exige de modifier scripts/ci)")
    if errors:
        raise RegistryError(errors)
    return result


def load_registry(specs):
    """Lit et valide `<specs>/tools/registry.json` ; lève RegistryError s'il est absent ou invalide."""
    tools_dir = Path(specs) / "tools"
    path = tools_dir / REGISTRY_NAME
    if not path.is_file():
        raise RegistryError([f"registre introuvable : {path}"])
    try:
        data = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_no_duplicates)
    except RegistryError:
        raise
    except (OSError, UnicodeDecodeError, ValueError, RecursionError) as exc:
        raise RegistryError([f"registre illisible ({path}) : {exc}"]) from exc
    return validate_registry(data, tools_dir)


def check_output(exp, returncode, output):
    """Retourne la liste des écarts (vide si conforme) pour les attentes `exp` d'un script."""
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


def unknown_tools(specs, registry):
    """Scripts de tools/ ni au registre ni exclus : un nouvel outil doit être classé."""
    present = {p.name for p in (Path(specs) / "tools").glob("*.py")}
    return sorted(present - set(registry) - set(EXCLUDED))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--specs", default="docs/specs")
    ap.add_argument("--only", nargs="*", default=None)
    args = ap.parse_args(argv)

    src = Path(args.specs).resolve()
    if not (src / "tools").is_dir():
        print(f"ÉCHEC : {src / 'tools'} introuvable", file=sys.stderr)
        return 1
    try:
        registry = load_registry(src)
    except RegistryError as exc:
        for e in exc.errors:
            print(f"ÉCHEC registre : {e}")
        print("RÉSULTAT : ÉCHEC (registre des oracles invalide)")
        return 1
    names = args.only or list(registry)
    failures = 0
    for extra in unknown_tools(src, registry):
        print(f"ÉCHEC {extra} : script non classé (l'inscrire à docs/specs/tools/{REGISTRY_NAME})")
        failures += 1

    with tempfile.TemporaryDirectory(prefix="rueda-specs-") as tmp:
        specs = Path(tmp) / "specs"
        shutil.copytree(src, specs)
        for name in names:
            if name not in registry:
                print(f"ÉCHEC {name} : pas de motifs attendus définis")
                failures += 1
                continue
            rc, out = run_tool(specs, name)
            errors = check_output(registry[name], rc, out)
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
