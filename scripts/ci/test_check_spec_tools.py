"""Tests du contrôle des oracles (python -I -X utf8 -m unittest discover -s scripts/ci -p "test_*.py")."""

import contextlib
import copy
import importlib.util
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "check_spec_tools", Path(__file__).with_name("check-spec-tools.py")
)
cst = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cst)

SPECS = Path(__file__).resolve().parents[2] / "docs" / "specs"
REAL = json.loads((SPECS / "tools" / cst.REGISTRY_NAME).read_text(encoding="utf-8"))
REGISTRY = cst.load_registry(SPECS)


def exp(name):
    return REGISTRY[name]


class CheckOutputTest(unittest.TestCase):
    def test_sortie_conforme(self):
        self.assertEqual(cst.check_output(exp("check_backlog.py"), 0, "x\nRÉSULTAT : OK\n"), [])

    def test_code_de_sortie_non_nul(self):
        errs = cst.check_output(exp("check_backlog.py"), 1, "RÉSULTAT : OK\n")
        self.assertTrue(any("code de sortie" in e for e in errs))

    def test_motif_absent(self):
        errs = cst.check_output(exp("verif11_settlement.py"), 0, "Vecteurs executes: 48 | ecarts: 1\n")
        self.assertTrue(any("absent" in e for e in errs))

    def test_47_vecteurs_refuse(self):
        errs = cst.check_output(exp("verif11_settlement.py"), 0, "Vecteurs executes: 47 | ecarts: 0\n")
        self.assertTrue(errs)

    def test_check_legs_57_vecteurs_refuse(self):
        out = "RÉSULTAT : OK\nLignes TJ trouvées dans 08 : 57 ; vecteurs calculés : 57\n"
        self.assertTrue(cst.check_output(exp("check_legs.py"), 0, out))

    def test_trace_python_refusee(self):
        out = "RÉSULTAT : OK\nTraceback (most recent call last):\n"
        errs = cst.check_output(exp("check_backlog.py"), 0, out)
        self.assertTrue(any("interdit" in e for e in errs))

    def test_trace_python_refusee_meme_sans_forbid_au_registre(self):
        errs = cst.check_output({"require": [r"^OK$"]}, 0, "OK\nTraceback (most recent call last):\n")
        self.assertTrue(any("interdit" in e for e in errs))

    def test_crossref_faux_positifs_connus_acceptes(self):
        out = (
            "- BR : 199 distincts cites, 199 definis, 0 cites sans definition\n"
            "- SM : 11 distincts cites, 10 definis, 1 cites sans definition\n"
            "    * SM-x : 17_:950\n"
            "- FEAT : 652 distincts cites, 676 definis, 1 cites sans definition\n"
            "    * SHA-256 : 10b:283\n"
        )
        self.assertEqual(cst.check_output(exp("verif18_crossref.py"), 0, out), [])

    def test_crossref_nouvel_identifiant_non_defini_refuse(self):
        out = (
            "- BR : 199 distincts cites, 198 definis, 1 cites sans definition\n"
            "- SM : 11 distincts cites, 10 definis, 1 cites sans definition\n"
            "    * SM-x : 17_:950\n"
            "- FEAT : 652 distincts cites, 676 definis, 1 cites sans definition\n"
            "    * SHA-256 : 10b:283\n"
        )
        self.assertTrue(cst.check_output(exp("verif18_crossref.py"), 0, out))

    def test_ecarts_verif12_fixes_refuses(self):
        errs = cst.check_output(exp("check_verif12_fixes.py"), 0, "2 ECART(S): T61, T20\n")
        self.assertEqual(len(errs), 2)

    def test_tous_les_scripts_de_tools_sont_classes(self):
        self.assertEqual(cst.unknown_tools(SPECS, REGISTRY), [])


class InvariantsDuScriptTest(unittest.TestCase):
    """Ce qui peut affaiblir le contrôle reste dans le script, pas dans le registre."""

    def test_planchers_couvrent_le_registre_actuel_et_les_oracles_d_argent(self):
        self.assertEqual(cst.FLOOR_ORACLES, frozenset(REAL["oracles"]))
        for money in ("check_legs.py", "verif11_settlement.py", "independent_settlement_check.py"):
            self.assertIn(money, cst.FLOOR_ORACLES)

    def test_planchers_et_exclusions_disjoints(self):
        self.assertFalse(cst.FLOOR_ORACLES & set(cst.EXCLUDED))
        self.assertLessEqual(set(cst.REQUIRED_COUNTS), cst.FLOOR_ORACLES)

    def test_le_registre_ne_peut_rien_exclure(self):
        self.assertFalse(cst.ENTRY_KEYS & {"exclude", "excluded", "skip", "disabled", "enabled"})
        self.assertFalse(cst.TOP_KEYS & {"excluded", "EXCLUDED", "floor"})


class RegistreTest(unittest.TestCase):
    """Chaque règle de validation du registre, sur une copie temporaire de tools/."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="rueda-registre-"))
        self.specs = self.tmp / "specs"
        tools = self.specs / "tools"
        tools.mkdir(parents=True)
        for p in (SPECS / "tools").glob("*.py"):
            (tools / p.name).write_text("print('fictif')\n", encoding="utf-8")
        self.path = tools / cst.REGISTRY_NAME
        self.data = copy.deepcopy(REAL)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, data=None, text=None):
        if text is None:
            text = json.dumps(self.data if data is None else data, ensure_ascii=False)
        self.path.write_text(text, encoding="utf-8")

    def errors(self, **kw):
        self.write(**kw)
        with self.assertRaises(cst.RegistryError) as ctx:
            cst.load_registry(self.specs)
        return "\n".join(ctx.exception.errors)

    def main_output(self, *args):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(io.StringIO()):
            rc = cst.main(["--specs", str(self.specs), *args])
        return rc, buf.getvalue()

    def test_copie_du_registre_reel_acceptee(self):
        self.write()
        self.assertEqual(cst.load_registry(self.specs), REGISTRY)

    def test_registre_absent(self):
        with self.assertRaises(cst.RegistryError) as ctx:
            cst.load_registry(self.specs)
        self.assertIn("introuvable", ctx.exception.errors[0])
        rc, out = self.main_output()
        self.assertEqual(rc, 1)
        self.assertIn("ÉCHEC registre : registre introuvable", out)
        self.assertNotIn("RÉSULTAT : OK", out)

    def test_registre_illisible(self):
        self.assertIn("illisible", self.errors(text="{ pas du json"))
        self.assertIn("illisible", self.errors(text=""))
        self.path.write_bytes(b"\xff\xfe\x00")
        with self.assertRaises(cst.RegistryError):
            cst.load_registry(self.specs)

    def test_registre_vide(self):
        self.assertIn("non vide", self.errors(data={"version": 1, "oracles": {}}))
        self.assertIn("non vide", self.errors(data={}))
        self.assertIn("objet JSON", self.errors(data=[]))

    def test_version_inconnue_ou_cle_inconnue_au_premier_niveau(self):
        self.data["version"] = 2
        self.assertIn("version", self.errors())
        self.data["version"] = True
        self.assertIn("version", self.errors())
        self.data["version"] = 1
        self.data["excluded"] = ["check_legs.py"]
        self.assertIn("clé inconnue au premier niveau", self.errors())

    def test_entree_en_double(self):
        text = json.dumps(self.data, ensure_ascii=False)
        dup = '"check_legs.py": {"require": ["^x$"]}, '
        text = text.replace('"check_inventory.py":', dup + '"check_inventory.py":', 1)
        self.assertIn("clé en double : « check_legs.py »", self.errors(text=text))

    def test_cle_en_double_dans_une_entree(self):
        text = json.dumps(self.data, ensure_ascii=False)
        text = text.replace('"verif15_ta.py": {', '"verif15_ta.py": {"require": ["^x$"], ', 1)
        self.assertIn("clé en double : « require »", self.errors(text=text))

    def test_oracle_plancher_retire(self):
        del self.data["oracles"]["check_legs.py"]
        self.assertIn("check_legs.py : oracle plancher absent", self.errors())
        rc, out = self.main_output()
        self.assertEqual(rc, 1)
        self.assertNotIn("RÉSULTAT : OK", out)

    def test_compte_a_zero(self):
        legs = self.data["oracles"]["check_legs.py"]
        legs["counts"]["vecteurs"] = 0
        legs["require"][1] = "^Lignes TJ trouvées dans 08 : 0 ; vecteurs calculés : 0$"
        self.assertIn("compte « vecteurs » = 0", self.errors())

    def test_compte_non_entier_ou_booleen(self):
        for bad in (True, "58", 58.0, -1, None):
            self.data["oracles"]["check_legs.py"]["counts"]["vecteurs"] = bad
            self.assertIn("entier >= 1", self.errors(), bad)

    def test_compte_obligatoire_retire(self):
        del self.data["oracles"]["check_legs.py"]["counts"]
        self.assertIn("compte obligatoire « vecteurs » manquant", self.errors())

    def test_compte_absent_des_motifs(self):
        legs = self.data["oracles"]["check_legs.py"]
        legs["require"] = [r"^RÉSULTAT : OK\s*$"]
        self.assertIn("= 58 absent des motifs", self.errors())
        legs["require"] = [r"^RÉSULTAT : OK\s*$", r"^vecteurs : 580$"]
        self.assertIn("= 58 absent des motifs", self.errors())

    def test_oracle_non_classe(self):
        (self.specs / "tools" / "check_nouveau.py").write_text("print('x')\n", encoding="utf-8")
        self.write()
        self.assertEqual(cst.unknown_tools(self.specs, cst.load_registry(self.specs)), ["check_nouveau.py"])
        rc, out = self.main_output("--only", "verif15_ta.py")
        self.assertEqual(rc, 1)
        self.assertIn("ÉCHEC check_nouveau.py : script non classé", out)

    def test_chemin_hors_de_tools(self):
        (self.specs / "evil.py").write_text("print('OK')\n", encoding="utf-8")
        for bad in ("../evil.py", "..\\evil.py", "/tmp/evil.py", "C:/evil.py", "sub/check.py", "evil.sh", ".py"):
            self.data["oracles"][bad] = {"require": ["^OK$"]}
            self.assertIn("nom de script invalide", self.errors(), bad)
            del self.data["oracles"][bad]

    def test_script_absent(self):
        self.data["oracles"]["check_fantome.py"] = {"require": ["^OK$"]}
        self.assertIn("check_fantome.py : script absent", self.errors())

    def test_script_exclu_inscrit_au_registre(self):
        self.data["oracles"]["verify_cxl_tests.py"] = {"require": ["^OK$"]}
        self.assertIn("contradiction", self.errors())

    def test_cle_inconnue_dans_une_entree(self):
        for key in ("skip", "exclude", "enabled", "requires"):
            self.data["oracles"]["check_legs.py"][key] = True
            self.assertIn(f"clé inconnue « {key} »", self.errors(), key)
            del self.data["oracles"]["check_legs.py"][key]

    def test_require_vide_absent_ou_trivial(self):
        o = self.data["oracles"]
        o["verif15_ta.py"]["require"] = []
        self.assertIn("liste non vide", self.errors())
        del o["verif15_ta.py"]["require"]
        self.assertIn("liste non vide", self.errors())
        for trivial in (".*", "^", "(OK)?", "x*"):
            o["verif15_ta.py"]["require"] = [trivial]
            self.assertIn("accepte une sortie vide", self.errors(), trivial)

    def test_motif_invalide_ou_non_textuel(self):
        o = self.data["oracles"]
        o["verif15_ta.py"]["require"] = ["^OK($"]
        self.assertIn("invalide", self.errors())
        o["verif15_ta.py"]["require"] = ["^OK$"]
        o["verif15_ta.py"]["forbid"] = [3]
        self.assertIn("non textuel", self.errors())
        o["verif15_ta.py"]["forbid"] = "ECART"
        self.assertIn("doit être une liste", self.errors())

    def test_entree_non_objet(self):
        self.data["oracles"]["verif15_ta.py"] = ["^OK$"]
        self.assertIn("l'entrée doit être un objet", self.errors())


if __name__ == "__main__":
    unittest.main()
