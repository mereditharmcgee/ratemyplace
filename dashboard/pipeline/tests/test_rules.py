"""Rule tests that need no data and no private files: python -m unittest discover -s tests"""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import rules
from exclusions import Exclusions


class Rules(unittest.TestCase):
    def test_living_types_and_buckets(self):
        self.assertTrue(rules.is_living("Heat - Excessive  Insufficient", "Housing"))
        self.assertTrue(rules.is_living("Something New", "Housing"))
        self.assertFalse(rules.is_living("Illegal Rooming House", "Housing"))
        self.assertEqual(rules.living_bucket("Bed Bugs"), "pests_interior")
        self.assertEqual(rules.living_bucket("Rodent Activity"), "rodent_activity_isd")
        self.assertEqual(rules.living_bucket("Chronic Dampness/Mold"), "mold_ventilation")
        self.assertEqual(rules.living_bucket("Lead"), "other_living")

    def test_address_ranges(self):
        self.assertEqual(rules.num_list("16-20"), ["16", "18", "20", "16-20"])
        self.assertEqual(rules.num_list("9-5"), ["5", "7", "9", "9-5"])
        self.assertEqual(rules.num_list("1-200"), ["1-200"])
        self.assertEqual(rules.street_norm("Saint Botolph Street"), "ST BOTOLPH ST")
        self.assertEqual(rules.street_norm("West Broadway"), "W BROADWAY")
        self.assertEqual(rules.zip5("2127"), "02127")

    def test_owner_names_are_only_lightly_normalized(self):
        self.assertEqual(rules.owner_norm("Example Holdings L.L.C."), "EXAMPLE HOLDINGS LLC")
        self.assertNotEqual(rules.owner_norm("EXAMPLE HOLDINGS LLC"), rules.owner_norm("EXAMPLE HOLDINGS II LLC"))
        self.assertEqual(rules.owner_class("EXAMPLE HOLDINGS LLC"), "Company (LLC, corporation, or partnership)")
        self.assertEqual(rules.owner_class("BOSTON HOUSING AUTHORITY"), "Public or quasi-public")
        self.assertEqual(rules.owner_class("DOE JANE"), "Appears to be an individual")
        self.assertEqual(rules.isd_class("Failure to Obtain Permit"), "permit, use or administrative")

    def test_exclusions_match_exact_names_only(self):
        ex = Exclusions({"owner_names_exact": ["Sample Realty LLC"], "parcel_ids": ["123"], "mailing_anchors": [{"street_contains": "1 Sample Way", "zip": "02100"}],
                         "addressee_patterns": ["c/o sample mgmt"]})
        self.assertTrue(ex.by_owner("SAMPLE REALTY L.L.C."))
        self.assertTrue(ex.by_owner("Sample Realty LLC A MASS LLC"))
        self.assertFalse(ex.by_owner("SAMPLE REALTY TWO LLC"))
        self.assertTrue(ex.by_mail("1 SAMPLE WAY STE 4", "02100"))
        self.assertFalse(ex.by_mail("1 SAMPLE WAY", "02199"))
        self.assertTrue(ex.by_addressee("C/O SAMPLE MGMT"))
        self.assertIn("0000000123", ex.parcels)

    def test_optional_name_withholding(self):
        ex = Exclusions({"parcel_ids": ["1"], "owner_name_hide_patterns": [r"\bSAMPLENAME\b"]})
        self.assertTrue(ex.hide_name("SAMPLENAME JANE"))
        self.assertFalse(ex.hide_name("SAMPLENAMESON JANE"))
        self.assertFalse(Exclusions({"parcel_ids": ["1"]}).hide_name("SAMPLENAME JANE"))

    def test_an_empty_list_is_refused(self):
        with self.assertRaises(SystemExit):
            Exclusions({})


if __name__ == "__main__":
    unittest.main()
