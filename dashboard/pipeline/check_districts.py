"""Check 1: district numbers against the locked district pages.

  python check_districts.py REFERENCE_JSON [BUILD_PKL]

REFERENCE_JSON is the locked district_v3.json (kept outside the repo). Prints every measure
side by side and marks any gap above 2 percent. Exits 1 if a headline measure (complaints
per 1,000 rental units, universe, rental buildings, rental units) is off by more than 2 percent.
"""
import json, os, pickle, sys
from config import WORK
from summarize import all_districts

ref = json.load(open(sys.argv[1]))
pkl = sys.argv[2] if len(sys.argv) > 2 else os.path.join(WORK, "build.pkl")
bd = pickle.load(open(pkl, "rb"))
got = all_districts(bd["buildings"])
HEAD = {"lc3_2025_per_1000", "universe_buildings", "rental_buildings", "rental_units_est"}
KEYS = ["lc3_2025_per_1000", "rental_units_est", "universe_buildings", "rental_buildings", "lc3_total", "rodent3_total", "flagged", "flagged_public",
        "flagged_with_citation", "flagged_complaints_only", "flagged_isd_only", "flagged_rental_bldgs", "flagged_subsidized_or_nonprofit_bldgs"]
fail, gaps = 0, 0
print(f"build: {os.path.basename(pkl)}  as-of cap: {bd['as_of']}  raw pull finished: {bd['pull_log'].get('_finished')}")
print(f"{'area':9}{'measure':40}{'locked':>10}{'now':>10}{'gap':>8}")
for area in [str(i) for i in range(1, 10)] + ["citywide"]:
    for k in KEYS:
        a, b = ref[area][k], got[area][k]
        gap = 0 if a == b else (abs(b - a) / a * 100 if a else 100)
        mark = ""
        if gap > 2:
            gaps += 1
            mark = "  <-- above 2%"
            if k in HEAD: fail += 1
        print(f"{area:9}{k:40}{a:>10}{b:>10}{gap:>7.1f}%{mark}")
    for mk, a in ref[area]["mix"].items():
        b = got[area]["mix"][mk]
        mark = "" if abs(a - b) <= 1 else "  <-- more than 1 point"
        if mark: gaps += 1
        print(f"{area:9}{'mix: ' + mk:40}{a:>9}%{b:>9}%{b - a:>+7}pt{mark}")
print(f"\nmeasures above 2% (or mix off by more than a point): {gaps}; headline failures: {fail}")
sys.exit(1 if fail else 0)
