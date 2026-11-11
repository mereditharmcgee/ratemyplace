"""Nightly gate: stop the deploy if tonight's numbers have moved further from the locked district
pages than normal drift explains (a broken pull, a renamed city column, a half-empty file).

Exit 0 lets the deploy go ahead. Exit 1 keeps yesterday's files and yesterday's date on the site.
"""
import json, os, pickle, sys
from config import HERE, WORK
from summarize import all_districts

bench = json.load(open(os.path.join(HERE, "benchmarks.json")))
bd = pickle.load(open(os.path.join(WORK, "build.pkl"), "rb"))
got = all_districts(bd["buildings"])
problems = []
for area, locked in bench["complaints_per_1000_rental_units_2025"].items():
    now = got[area]["lc3_2025_per_1000"]
    if abs(now - locked) / locked > 0.05:
        problems.append(f"2025 rate for {area}: locked {locked}, now {now}")
for key in ["universe_buildings", "rental_buildings"]:
    now = got["citywide"][key]
    if abs(now - bench[key]) / bench[key] > 0.03:
        problems.append(f"{key}: locked {bench[key]}, now {now}")
if got["citywide"]["lc3_total"] < bench["complaints_total_at_lock"]:
    problems.append("fewer complaints than on the lock date; a 311 file is probably incomplete")
# A truncated file should stop the run even when the headline numbers still look plausible.
log = bd["pull_log"]
FLOORS = {"rentsmart.csv": ("rows", 15000), "str_flags.csv": ("rows", 20000), "pwd_by_sam.csv": ("rows", 30000), "311_candidates.csv": ("rows", 60000),
          "isd_violations.csv": ("bytes", 3_000_000), "assessment_fy2026.csv": ("bytes", 60_000_000), "sam_addresses.csv": ("bytes", 90_000_000)}
for name, (field, floor) in FLOORS.items():
    if int(log.get(name, {}).get(field, 0)) < floor:
        problems.append(f"{name} is smaller than expected")
by_month = bd["complaints"].open_day.str[:7].value_counts()
for m in sorted(by_month.index)[-4:-1]:   # the three months before the current one
    if by_month[m] < 250:
        problems.append(f"only {int(by_month[m])} complaints matched in {m}; a 311 source is probably incomplete")
for p in problems:
    print("GATE:", p)
print("gate:", "FAILED" if problems else "passed", f"({len(problems)} problem(s))")
sys.exit(1 if problems else 0)
