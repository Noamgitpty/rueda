"""Évaluation des oracles Python de 08 sur des cas générés (US-042).

Ce script ne calcule AUCUN montant lui-même : il charge les oracles de `docs/specs/tools/`
(`independent_settlement_check.py`, puis `check_legs.py`, qui doit d'abord rendre « RÉSULTAT : OK »)
et ne fait que composer leurs fonctions :
- primitives : `rhu` (roundHalfUp) et `alloc_host` (allocHost) de independent_settlement_check ;
- règlement : `mk_trip` (taxe payée par ligne puis sommée, total), `compute` (table de décision,
  remboursement, retenue, taxe, part hôte, compensation, pénalité) et `settle` (taxe remboursée d'un
  groupe isolé, part hôte de la capture) de independent_settlement_check ;
- jambes : `legs` de check_legs (HOST, INSURER, TAX_THIRD_PARTY, PLATFORM = complément).

Le générateur des cas (fast-check) est dans `oracle-diff.oracle.test.ts` : ce script ne tire rien
au hasard. Entrée : JSON (liste de cas, entiers en chaînes) ; sortie : JSON des attendus.
Usage : python -I -X utf8 oracle_driver.py <cas.json> <attendus.json>
"""
import contextlib
import importlib.util
import io
import json
import sys
from fractions import Fraction as Fr
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
TOOLS = ROOT / "docs" / "specs" / "tools"

# Noms des lignes du moteur TypeScript -> noms de l'oracle (08, pseudo-code LINES).
TS_TO_ORACLE = {
    "tripPrice": "P",
    "promoPlatform": "PP",
    "promoHost": "PH",
    "tripFee": "F",
    "protection": "Pr",
    "extras": "X",
    "enhancedRoadside": "R",
    "additionalDriver": "AD",
    "delivery": "D",
}


class _Sink(io.StringIO):
    """Sortie standard muette pour l'import de check_legs (qui appelle reconfigure)."""

    def reconfigure(self, **_kwargs):
        return None


def _load(name, quiet=False):
    spec = importlib.util.spec_from_file_location(name, TOOLS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sink = _Sink()
    code = 0
    with contextlib.redirect_stdout(sink) if quiet else contextlib.nullcontext():
        try:
            spec.loader.exec_module(module)
        except SystemExit as stop:  # check_legs se termine par sys.exit(0 | 1)
            code = stop.code or 0
    if code != 0 or (quiet and "RÉSULTAT : OK" not in sink.getvalue()):
        raise SystemExit(f"oracle {name}.py en échec : il ne peut pas servir d'oracle")
    return module


ISC = _load("independent_settlement_check")
LEGS = _load("check_legs", quiet=True)


def frac(pair):
    return Fr(int(pair[0]), int(pair[1]))


def primitive(case):
    q = frac(case["ratio"])
    if case["kind"] == "rhu":
        return {"value": str(ISC.rhu(q))}
    return {"value": str(ISC.alloc_host(int(case["amount"]), q))}


def settlement(case):
    lines = {TS_TO_ORACLE[k]: int(v) for k, v in case["lines"].items()}
    groups = {
        g["id"]: (frac(g["rate"]), [TS_TO_ORACLE[l] for l in g["lines"]]) for g in case["groups"]
    }
    third = {g["id"]: bool(g["thirdParty"]) for g in case["groups"]}
    t = ISC.mk_trip(
        "us042", case["currency"], case["days"], case["rate"],
        lines["P"], lines["F"], lines["Pr"], lines["X"], lines["R"], lines["AD"], lines["D"],
        None, share=frac(case["share"]), groups=groups, PP=lines["PP"], PH=lines["PH"],
    )
    t["booked"] = case["bookedMinutes"]
    # Jambes (08 E7) par l'oracle check_legs, parts assureur du cas.
    LEGS.INS_PR = frac(case["insurerPremiumShare"])
    LEGS.INS_R = frac(case["insurerRoadsideShare"])
    tl = {"groups": {g: (groups[g][0], groups[g][1], third[g]) for g in groups}}
    all_lines = {l: t[l] for l in ISC.LINES}
    capture_host = ISC.settle(t, {}, 0, True)["host_guest"]
    capture = LEGS.legs(tl, all_lines, dict(t["taxPaid"]), capture_host)
    result = {
        "taxPaid": {g: str(v) for g, v in t["taxPaid"].items()},
        "totalPaid": str(t["total"]),
        "penaltyScheduleMajor": [str(v) for v in ISC.PENALTY[case["currency"]]],
        "captureLegs": {k: str(v) for k, v in capture.items()},
        **evaluate(t, groups, tl, capture, case["event"]),
    }
    if case.get("event2") is not None:  # version n+1 du même trip (requalification, 08 E4)
        result["second"] = evaluate(t, groups, tl, capture, case["event2"])
    return result


def evaluate(t, groups, tl, capture, e):
    ev = {
        "reason": e["reason"],
        "req": e["requestedMinutes"],
        "evidence": e["evidenceValidated"],
        "checkin": e["checkinValidated"],
        "host_msg_traced": e["hostMessageTraced"],
        "host_no_show_reported": e["hostNoShowReportedBefore"],
        "ad_approved": e["additionalDriverApproved"],
    }
    out = ISC.compute(t, ev)
    refund = out["refund"]
    # Taxe remboursée PAR GROUPE : settle de l'oracle sur le trip réduit à ce seul groupe.
    tax_refund = {}
    for g in groups:
        tg = dict(t)
        tg["groups"] = {g: groups[g]}
        tg["taxPaid"] = {g: t["taxPaid"][g]}
        tax_refund[g] = ISC.settle(tg, refund, 0, False)["tax"]
    kept = LEGS.legs(
        tl,
        {l: t[l] - refund.get(l, 0) for l in ISC.LINES},
        {g: t["taxPaid"][g] - tax_refund[g] for g in groups},
        out["host_guest"],
    )
    s = str
    return {
        "reason": out["reason"],
        "guestRefund": s(out["guest"]),
        "taxRefund": s(out["tax"]),
        "hostEarnings": s(out["host"]),
        "hostFromGuest": s(out["host_guest"]),
        "hostCompensation": s(out["comp"]),
        "platformNet": s(out["net"]),
        "retained": s(out["retained"]),
        "retainedTax": s(out["ret_tax"]),
        "hostPenaltyMajor": s(out["pen"]),
        "refundByLine": {k: s(refund.get(o, 0)) for k, o in TS_TO_ORACLE.items()},
        "taxRefundByGroup": {g: s(v) for g, v in tax_refund.items()},
        "settledLegs": {k: s(v) for k, v in kept.items()},
        "legVariation": {k: s(v) for k, v in LEGS.diff(kept, capture).items()},
    }


def main(argv):
    if len(argv) != 3:
        raise SystemExit("usage : python -I -X utf8 oracle_driver.py <cas.json> <attendus.json>")
    cases = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    results = []
    for case in cases:
        results.append(primitive(case) if case["kind"] in ("rhu", "alloc") else settlement(case))
    Path(argv[2]).write_text(json.dumps(results), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv)
