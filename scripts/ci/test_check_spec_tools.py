"""Tests du contrôle des oracles (python -I -X utf8 -m unittest discover -s scripts/ci -p "test_*.py")."""

import importlib.util
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "check_spec_tools", Path(__file__).with_name("check-spec-tools.py")
)
cst = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cst)


class CheckOutputTest(unittest.TestCase):
    def test_sortie_conforme(self):
        self.assertEqual(cst.check_output("check_backlog.py", 0, "x\nRÉSULTAT : OK\n"), [])

    def test_code_de_sortie_non_nul(self):
        errs = cst.check_output("check_backlog.py", 1, "RÉSULTAT : OK\n")
        self.assertTrue(any("code de sortie" in e for e in errs))

    def test_motif_absent(self):
        errs = cst.check_output("verif11_settlement.py", 0, "Vecteurs executes: 48 | ecarts: 1\n")
        self.assertTrue(any("absent" in e for e in errs))

    def test_47_vecteurs_refuse(self):
        errs = cst.check_output("verif11_settlement.py", 0, "Vecteurs executes: 47 | ecarts: 0\n")
        self.assertTrue(errs)

    def test_trace_python_refusee(self):
        out = "RÉSULTAT : OK\nTraceback (most recent call last):\n"
        errs = cst.check_output("check_backlog.py", 0, out)
        self.assertTrue(any("interdit" in e for e in errs))

    def test_crossref_faux_positifs_connus_acceptes(self):
        out = (
            "- BR : 199 distincts cites, 199 definis, 0 cites sans definition\n"
            "- SM : 11 distincts cites, 10 definis, 1 cites sans definition\n"
            "    * SM-x : 17_:950\n"
            "- FEAT : 652 distincts cites, 676 definis, 1 cites sans definition\n"
            "    * SHA-256 : 10b:283\n"
        )
        self.assertEqual(cst.check_output("verif18_crossref.py", 0, out), [])

    def test_crossref_nouvel_identifiant_non_defini_refuse(self):
        out = (
            "- BR : 199 distincts cites, 198 definis, 1 cites sans definition\n"
            "- SM : 11 distincts cites, 10 definis, 1 cites sans definition\n"
            "    * SM-x : 17_:950\n"
            "- FEAT : 652 distincts cites, 676 definis, 1 cites sans definition\n"
            "    * SHA-256 : 10b:283\n"
        )
        self.assertTrue(cst.check_output("verif18_crossref.py", 0, out))

    def test_ecarts_verif12_fixes_refuses(self):
        errs = cst.check_output("check_verif12_fixes.py", 0, "2 ECART(S): T61, T20\n")
        self.assertEqual(len(errs), 2)

    def test_tous_les_scripts_de_tools_sont_classes(self):
        specs = Path(__file__).resolve().parents[2] / "docs" / "specs"
        self.assertEqual(cst.unknown_tools(specs), [])


if __name__ == "__main__":
    unittest.main()
