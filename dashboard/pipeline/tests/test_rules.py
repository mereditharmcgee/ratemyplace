"""Rule tests that need no data: python -m unittest discover -s tests"""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import rules


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


if __name__ == "__main__":
    unittest.main()
