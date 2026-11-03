"""Export des vecteurs dorés T01-T68, TJ01-TJ21 et TA01-TA11 (US-016), lu par le harnais TypeScript.

Les valeurs attendues viennent UNIQUEMENT des oracles déjà audités de ce dossier, chargés tels quels
(aucune ligne recopiée, aucun fichier modifié) :
- T01-T48 : `independent_settlement_check.py` (règlement `compute` et couche d'exécution
  `run_execution_vectors`) ; chaque résultat calculé est comparé à la valeur recopiée dans `VECT`
  par l'oracle, puis aux cellules de la ligne « | Txx | » de 08 ;
- TJ01-TJ21 : `check_legs.py` (dictionnaire `EXPECTED`), comparé aux cellules des lignes « | TJxx | » de 08 ;
- T49-T68 : contrôles `check(...)` de `check_t49plus.py`, `check_verif12_fixes.py` et `check_t66_68.py` ;
- TA01-TA11 : contrôles de `check_ta_consolidation.py` et fonctions de `verif15_ta.py` (16 A.8.1).
Pour les scripts qui contrôlent par `check(label, obtenu, attendu)`, la définition de `check` est retirée de
l'arbre syntaxique au chargement et remplacée par un enregistreur : chaque attente est exportée et chaque écart
fait échouer l'export. Aucun montant n'est calculé ici, en dehors de la conversion de la pénalité hôte des
unités majeures (colonne de 08) en unités mineures (exposant de la devise de test, comme T62).

Le fichier `golden_vectors.json` (même dossier) est le contrat lu par `packages/money/src/golden-vectors` (`@rueda/money/golden-vectors`).
Par défaut, le script régénère l'export en mémoire et le compare octet par octet au fichier commité :
tout écart (08 modifié, oracle modifié, JSON modifié à la main) fait échouer la CI.

Usage : python -I -X utf8 tools/export_golden_vectors.py [--write]
  sans option : contrôle (code 1 en cas d'écart) ; --write : réécrit golden_vectors.json.
"""
import ast
import contextlib
import importlib.util
import io
import json
import re
import sys
from fractions import Fraction
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
TOOLS = Path(__file__).resolve().parent
SPECS = TOOLS.parent
OUT = TOOLS / "golden_vectors.json"
FORMAT = 1
# Exposants de la configuration de TEST des oracles (« USD x100, PYG x1 ») : données, pas constantes du code produit.
CURRENCIES = {"USD": {"exponent": 2}, "PYG": {"exponent": 0}}
VECTOR_ID = re.compile(r"^(T[AJ]?\d{2}[a-z]?)\b")
errors = []


def err(msg):
    errors.append(msg)


class _Quiet(io.StringIO):
    """Sortie muette ; `reconfigure` existe pour les oracles qui l'appellent au chargement."""

    def reconfigure(self, **_kw):
        return None


def load_module(name):
    """Charge un oracle comme module (son bloc `if __name__ == '__main__'` n'est pas exécuté)."""
    path = TOOLS / name
    spec = importlib.util.spec_from_file_location("oracle_" + path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stdout(_Quiet()):
        try:
            spec.loader.exec_module(mod)
        except SystemExit as exc:
            if exc.code not in (0, None):
                err(f"{name} : code de sortie {exc.code} au chargement")
    return mod


def run_recording(name):
    """Exécute un oracle en remplaçant SA fonction `check` par un enregistreur ; retourne (globals, attentes)."""
    path = TOOLS / name
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    defs = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "check"]
    if len(defs) != 1:
        err(f"{name} : une seule fonction `check` de premier niveau attendue, {len(defs)} trouvée(s)")
        return {}, []
    tree.body = [n for n in tree.body if n is not defs[0]]
    recorded = []

    def check(label, got, exp):
        recorded.append((label, exp))
        if got != exp:
            err(f"{name} : écart sur « {label} » : obtenu {got!r}, attendu {exp!r}")
        return 0 if got == exp else 1

    glb = {"__name__": "oracle_" + path.stem, "__file__": str(path), "__builtins__": __builtins__, "check": check}
    with contextlib.redirect_stdout(_Quiet()):
        try:
            exec(compile(tree, str(path), "exec"), glb)
        except SystemExit as exc:
            if exc.code not in (0, None):
                err(f"{name} : code de sortie {exc.code}")
    if not recorded:
        err(f"{name} : aucun contrôle enregistré")
    return glb, recorded


def ratio(q):
    q = Fraction(q)
    return f"{q.numerator}/{q.denominator}"


def minor(v):
    if isinstance(v, bool) or not isinstance(v, int):
        raise TypeError(f"montant entier attendu : {v!r}")
    return str(v)


def encode(v):
    """Valeur attendue d'un contrôle -> JSON typé, sans perte (entiers en texte, fractions exactes)."""
    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, int):
        return {"$int": str(v)}
    if isinstance(v, Fraction):
        return {"$ratio": ratio(v)}
    if isinstance(v, (list, tuple)):
        return [encode(x) for x in v]
    if isinstance(v, dict):
        if not all(isinstance(k, str) for k in v):
            raise TypeError(f"clé non textuelle : {v!r}")
        return {k: encode(x) for k, x in v.items()}
    raise TypeError(f"type non exportable : {type(v).__name__} ({v!r})")


# ------------------------------------------------------------------ lecture des tables de 08 et 16
TXT08 = (SPECS / "08_BUSINESS_RULES.md").read_text(encoding="utf-8")
TXT16 = (SPECS / "16_PRODUCT_REQUIREMENTS_DOCUMENT.md").read_text(encoding="utf-8")


def rows(text, pattern):
    out = {}
    for m in re.finditer(r"(?m)^\| (" + pattern + r") \|.*$", text):
        if m.group(1) in out:
            err(f"ligne en double : {m.group(1)}")
        out[m.group(1)] = [c.strip() for c in m.group(0).strip().strip("|").split("|")]
    return out


ROWS_T = rows(TXT08, r"T\d\d")
ROWS_TJ = rows(TXT08, r"TJ\d\d[a-z]?")
ROWS_TA = rows(TXT16, r"TA\d\d")
SPACES = re.compile(r"[   ]")
AMOUNT = re.compile(r"[−+-]?\d{1,3}(?:[   ]\d{3})*(?:,\d+)?|[−+-]?\d+(?:,\d+)?")


def cell_amount(cell, exponent):
    """Premier montant écrit dans une cellule de 08, en unités de la colonne (exposant donné)."""
    text = cell.replace("*", "")
    m = AMOUNT.search(text)
    if not m:
        raise ValueError(f"aucun montant dans « {cell} »")
    s = SPACES.sub("", m.group(0)).replace("−", "-").lstrip("+")
    whole, _, dec = s.partition(",")
    if len(dec) != exponent:
        raise ValueError(f"« {m.group(0)} » : {exponent} décimale(s) attendue(s)")
    return int(whole + dec) if not whole.startswith("-") else -int(whole[1:] + dec)


# ------------------------------------------------------------------ T01-T48 : règlement économique
ISC = load_module("independent_settlement_check.py")
EVENT_KEYS = {
    "reason": "reason",
    "req": "requestedAtMinutes",
    "term_at": "terminatedAtMinutes",
    "evidence": "evidenceValidated",
    "goodfaith": "hostGoodFaith",
    "ad_approved": "additionalDriverApproved",
    "host_msg_traced": "hostMessageTraced",
    "checkin": "checkedIn",
    "host_no_show_reported": "hostNoShowReported",
    "host_eligible": "hostEligibleOverride",
}
LINE_NAMES = {"P": "tripPrice", "PP": "promoPlatform", "PH": "promoHost", "F": "tripFee", "Pr": "protection",
              "X": "extras", "R": "enhancedRoadside", "AD": "additionalDriver", "D": "delivery"}
NON_NORMATIVE = {
    "T17": "option A de DEC-FONDATEUR-01 (compensation financée par la plateforme) ; défaut fail-closed = T61 (a)",
    "T18": "option A de DEC-FONDATEUR-01 ; défaut fail-closed : hôte 0,00, net 0,00 (T61)",
    "T20": "option A de DEC-FONDATEUR-01 ; défaut fail-closed : hôte 0,00, net 0,00 (T61)",
    "T48": "pénalité PYG PROPOSÉE (OQ-BR-24) : non normative",
    "T62": "pénalité PYG PROPOSÉE (OQ-BR-24) : la partie PYG est non normative",
}
SETTLEMENT_COLS = ["guestRefundMinor", "taxRefundedMinor", "hostEarningsMinor", "platformNetMinor", "hostPenaltyMajor"]


def export_trip(t):
    if set(t) - {"name", "cur", "days", "rate", "share", "groups", "taxPaid", "total", "booked", *LINE_NAMES}:
        err(f"trip {t['name']} : champ inconnu")
    return {
        "name": t["name"],
        "currency": t["cur"],
        "days": t["days"],
        "rate": {"R": "REFUNDABLE", "NR": "NON_REFUNDABLE"}[t["rate"]],
        "bookedAtMinutes": t["booked"],
        "hostSharePct": ratio(t["share"]),
        "deliverySharePct": ratio(t["share"]),
        "extrasSharePct": ratio(t["share"]),
        "linesMinor": {LINE_NAMES[k]: minor(t[k]) for k in LINE_NAMES},
        "taxGroups": [{"id": g, "rate": ratio(rate), "lines": [LINE_NAMES[x] for x in lines],
                       "taxPaidMinor": minor(t["taxPaid"][g])} for g, (rate, lines) in t["groups"].items()],
        "totalPaidMinor": minor(t["total"]),
    }


def export_event(ev):
    unknown = set(ev) - set(EVENT_KEYS)
    if unknown:
        err(f"événement : clé(s) inconnue(s) {sorted(unknown)}")
    return {EVENT_KEYS[k]: v for k, v in ev.items() if k in EVENT_KEYS}


settlement = []
for tid, t, ev, exp in ISC.VECT:
    o = ISC.compute(t, ev)
    got = (o["guest"], o["tax"], o["host"], o["net"], o["pen"])
    if got != exp:
        err(f"{tid} : oracle {got} != attendu de l'oracle {exp}")
    exponent = CURRENCIES[t["cur"]]["exponent"]
    row = ROWS_T.get(tid)
    if row is None:
        err(f"{tid} absent de 08")
    else:
        try:
            written = [cell_amount(c, exponent) for c in row[3:7]] + [cell_amount(row[7], 0)]
        except ValueError as e:
            err(f"{tid} : cellule de 08 illisible ({e})")
            written = None
        if written is not None and tuple(written) != exp:
            err(f"{tid} : 08 écrit {tuple(written)}, oracle {exp}")
    expected = dict(zip(SETTLEMENT_COLS, (minor(x) for x in exp)))
    expected["hostPenaltyMinor"] = minor(exp[4] * 10 ** exponent)
    expected.update({
        "qualifiedReason": o["reason"],
        "retainedMinor": minor(o["retained"]),
        "retainedTaxMinor": minor(o["ret_tax"]),
        "hostFromGuestMinor": minor(o["host_guest"]),
        "hostCompensationMinor": minor(o["comp"]),
    })
    settlement.append({
        "id": tid,
        "currency": t["cur"],
        "normative": tid not in NON_NORMATIVE,
        **({"nonNormativeReason": NON_NORMATIVE[tid]} if tid in NON_NORMATIVE else {}),
        "oracle": "independent_settlement_check.py",
        "entries08": row[1] if row else None,
        "qualification08": row[2] if row else None,
        "trip": export_trip(t),
        "event": export_event(ev),
        "expected": expected,
    })


def recorded_checks(oracle, recorded):
    out = []
    for label, exp in recorded:
        m = VECTOR_ID.match(label)
        vid = m.group(1) if m else None
        out.append({"vectorId": vid, "oracle": oracle, "label": label,
                    "normative": (vid or "")[:3] not in NON_NORMATIVE, "expected": encode(exp)})
    return out


# T28-T36, T47 : couche d'exécution de l'oracle indépendant (sa fonction `check`, remplacée à chaud)
exec_recorded = []


def _isc_check(label, got, exp):
    exec_recorded.append((label, exp))
    if got != exp:
        err(f"independent_settlement_check.py : écart sur « {label} »")
    return 0 if got == exp else 1


ISC.check = _isc_check
with contextlib.redirect_stdout(_Quiet()):
    if ISC.run_execution_vectors() != 0:
        err("independent_settlement_check.py : run_execution_vectors en écart")
checks = recorded_checks("independent_settlement_check.py", exec_recorded)

# ------------------------------------------------------------------ TJ01-TJ21 : jambes explicites (E7)
LEGS = load_module("check_legs.py")
if getattr(LEGS, "errors", ["module non chargé"]):
    err(f"check_legs.py en écart : {getattr(LEGS, 'errors', None)}")
LEG_NAMES = ["HOST", "INSURER", "TAX_THIRD_PARTY", "PLATFORM"]
legs = []
for vid, (cur, lg) in LEGS.EXPECTED.items():
    if "TOTAL" not in lg:
        err(f"{vid} : jambes sans total")
        continue
    if vid in LEGS.REFUSED:
        kind = "REFUSED_CAPTURE"
    elif vid in LEGS.LOSSES:
        kind = "CHARGEBACK_LOSS"
    elif vid in LEGS.REFUNDS:
        kind = "VARIATION"
    else:
        kind = "ALLOCATION"
    row = ROWS_TJ.get(vid)
    if row is None:
        err(f"{vid} absent de 08")
    else:
        exponent = CURRENCIES[cur]["exponent"]
        try:
            written = [cell_amount(c, exponent) for c in row[3:8]]
        except ValueError as e:
            err(f"{vid} : cellule de 08 illisible ({e})")
            written = None
        if written is not None and written != [lg[k] for k in LEG_NAMES + ["TOTAL"]]:
            err(f"{vid} : 08 écrit {written}, oracle {[lg[k] for k in LEG_NAMES + ['TOTAL']]}")
    legs.append({
        "id": vid,
        "currency": cur,
        "kind": kind,
        "normative": True,
        "oracle": "check_legs.py",
        "entries08": row[1] if row else None,
        "operation08": row[2] if row else None,
        "legsMinor": {k: minor(lg[k]) for k in LEG_NAMES},
        "totalMinor": minor(lg["TOTAL"]),
    })
if sorted(set(ROWS_TJ) - {x["id"] for x in legs}):
    err(f"lignes TJ de 08 non exportées : {sorted(set(ROWS_TJ) - {x['id'] for x in legs})}")

# ------------------------------------------------------------------ T49-T68 et TA01-TA11 : contrôles des oracles
for name in ("check_t49plus.py", "check_verif12_fixes.py", "check_t66_68.py", "check_ta_consolidation.py"):
    _g, rec = run_recording(name)
    checks += recorded_checks(name, rec)

V15 = load_module("verif15_ta.py")
acceptance = []
ta_checks = {}
for c in checks:
    if c["vectorId"] and c["vectorId"].startswith("TA"):
        ta_checks.setdefault(c["vectorId"], []).append(c["label"])
TA_REFS = {"TA08": ["TJ01", "TJ02a", "TJ02b", "TJ08a", "TJ08b", "TJ10a", "TJ10b", "TJ10c"],
           "TA09": ["TJ21a", "TJ21b"], "TA10": ["TJ01", "TJ02a", "TJ02b", "TJ03"], "TA11": ["TJ01", "TJ05a", "TJ05b"]}
TA_EXTRA = {   # attentes de verif15_ta.py, valeurs des fonctions de l'oracle sur les entrées de 16 A.8.1
    "TA04": {"hostPenaltyTier": {"hoursBefore30": V15.host_penalty_tier(30), "hoursBefore24": V15.host_penalty_tier(24)}},
    "TA07": {"billedDays": {"minutes4349": V15.billed(3 * 1440 + 29), "minutes4350": V15.billed(3 * 1440 + 30),
                            "minutes240": V15.billed(240)}},
    "TA09": {"commercialCreditAllowed": {"amount1000NoCap": V15.credit_allowed(1000)}},
}
for n in range(1, 12):
    ta = f"TA{n:02d}"
    if ta not in ROWS_TA:
        err(f"{ta} absent de 16")
    entry = {"id": ta, "currency": "USD", "entries16": ROWS_TA.get(ta, [None, None])[1],
             "checkLabels": ta_checks.get(ta, []), "legVectorRefs": TA_REFS.get(ta, [])}
    if ta in TA_EXTRA:
        entry["expected"] = encode(TA_EXTRA[ta])
    if not entry["checkLabels"] and ta not in TA_EXTRA and not entry["legVectorRefs"]:
        err(f"{ta} : aucune attente d'oracle")
    acceptance.append(entry)
if TA_EXTRA["TA07"]["billedDays"] != {"minutes4349": 3, "minutes4350": 4, "minutes240": 1}:
    err("TA07 : verif15_ta.billed ne redonne pas 3 ; 4 ; 1")

# ------------------------------------------------------------------ couverture
covered_t = {x["id"] for x in settlement} | {c["vectorId"] for c in checks if c["vectorId"]}
missing = [f"T{n:02d}" for n in range(1, 69) if f"T{n:02d}" not in covered_t
           and not any((v or "").startswith(f"T{n:02d}") for v in covered_t)]
if missing:
    err(f"vecteurs T sans attente d'oracle : {missing}")
if set(ROWS_T) != {f"T{n:02d}" for n in range(1, 69)}:
    err(f"lignes T de 08 : {len(ROWS_T)} (T01-T68 attendues)")
curs = {x["currency"] for x in settlement} | {x["currency"] for x in legs}
if curs != set(CURRENCIES):
    err(f"devises couvertes {sorted(curs)} != {sorted(CURRENCIES)}")

export = {
    "$comment": "Généré par docs/specs/tools/export_golden_vectors.py (US-016) depuis les oracles de ce dossier. "
                "NE PAS MODIFIER À LA MAIN : python -I -X utf8 tools/export_golden_vectors.py --write. "
                "Montants en unités mineures, entiers écrits en texte ; ratios exacts « n/d ».",
    "format": FORMAT,
    "currencies": CURRENCIES,
    "settlement": settlement,
    "legs": legs,
    "checks": checks,
    "acceptance": acceptance,
}
text = json.dumps(export, ensure_ascii=False, indent=2) + "\n"

n_exec = len({c["vectorId"] for c in checks if c["vectorId"] and re.fullmatch(r"T\d\d[a-z]?", c["vectorId"])})
by_cur = {c: sum(1 for x in settlement + legs if x["currency"] == c) for c in CURRENCIES}
print(f"Vecteurs de règlement exportés : {len(settlement)} ; lignes TJ exportées : {len(legs)} ; "
      f"contrôles exportés : {len(checks)} ; TA : {len(acceptance)}")
print(f"Couverture T01-T68 : {68 - len(missing)}/68 ; par devise : "
      + ", ".join(f"{c} {n}" for c, n in by_cur.items()))
print(f"Identifiants T couverts par les contrôles d'exécution : {n_exec}")

if "--write" in sys.argv[1:]:
    if errors:
        print("RÉSULTAT : ÉCHEC, rien n'est écrit")
    else:
        OUT.write_text(text, encoding="utf-8", newline="\n")
        print(f"écrit : {OUT.name}")
elif not OUT.is_file():
    err(f"{OUT.name} absent : lancer avec --write")
elif OUT.read_text(encoding="utf-8") != text:
    old = OUT.read_text(encoding="utf-8").splitlines()
    new = text.splitlines()
    first = next((i for i, (a, b) in enumerate(zip(old, new)) if a != b), min(len(old), len(new)))
    err(f"{OUT.name} diverge de l'export régénéré (première ligne différente : {first + 1})")

print("RÉSULTAT :", "OK" if not errors else f"{len(errors)} ÉCART(S)")
for e in errors:
    print("  -", e)
sys.exit(1 if errors else 0)
