"""US-318 (ADR-198) : frais de gestion d'une refacturation (amende, péage, fourrière) par l'oracle
`rhu` (roundHalfUp) de `docs/specs/tools/independent_settlement_check.py`. Ce script ne calcule
rien lui-même : frais = rhu(montant × 500 / 10 000), 08 BR-PRICE-15 [NOUS] (5 %, ligne 1692) et
BR-PRICE-14 [NOUS] (2) (arrondi half-up par ligne, ligne 1686).

Usage (depuis la racine du dépôt) :
    python -I -X utf8 packages/money/test/oracle/traffic_fee_oracle.py
Sortie : « devise montant frais total » par cas, attendus repris dans
`packages/money/test/settlement/traffic-charge.test.ts` et `packages/db/test/l0/l0-us318-p2p-claims.test.ts`.
"""
import contextlib
import importlib.util
import io
import sys
from fractions import Fraction as Fr
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[4] / "docs" / "specs" / "tools"
spec = importlib.util.spec_from_file_location("isc", TOOLS / "independent_settlement_check.py")
isc = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(io.StringIO()):
    spec.loader.exec_module(isc)

FEE_BPS = 500  # graine 0178 (traffic_charge_admin_fee_bps), 08 BR-PRICE-15 [NOUS]
CASES = [("USD", 1230), ("USD", 1000), ("USD", 1), ("PYG", 25010), ("PYG", 150000), ("PYG", 9),
         ("PYG", 10)]
for currency, amount in CASES:
    fee = isc.rhu(Fr(amount * FEE_BPS, 10000))
    sys.stdout.write(f"{currency} {amount} {fee} {amount + fee}\n")
