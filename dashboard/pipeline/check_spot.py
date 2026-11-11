"""Check 2: spot-check random buildings against fresh queries to the city's API.

  python check_spot.py [N] [SEED]

For each building: every 311 complaint we show is looked up live by case id (same day, not a
duplicate); State Sanitary Code citation dates are re-counted live by parcel id; and the owner
of record is re-read live from the assessment. Run it right after a pull, since the city's data
moves during the day. Output names no owner that the page does not name.
"""
import json, os, pickle, random, sys
import ckan
from config import INDIVIDUAL_OWNER_LABEL, OUT, RAW, RES, RES_311_YEARLY, WORK, WINDOW_START
import pandas as pd

N = int(sys.argv[1]) if len(sys.argv) > 1 else 20
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 20261110
bd = pickle.load(open(os.path.join(WORK, "build.pkl"), "rb"))
B = json.load(open(os.path.join(OUT, "buildings.json"), encoding="utf-8"))
core = json.load(open(os.path.join(OUT, "core.json"), encoding="utf-8"))
a = pd.read_csv(os.path.join(RAW, "assessment_fy2026.csv"), dtype=str, usecols=["PID", "GIS_ID"])
for c in ["PID", "GIS_ID"]:
    a[c] = a[c].str.zfill(10)
pids = a.groupby("GIS_ID").PID.apply(list).to_dict()
comp = bd["complaints"]; cit = bd["citations"]
months = set(core["meta"]["months"])
random.seed(SEED)
picks = random.sample(range(len(B["id"])), N)
ok_all = True
print(f"spot check of {N} random buildings (seed {SEED}); data pulled {core['meta']['pulled']}")
print(f"{'address':34}{'311 shown':>10}{'found live':>11}{'cit. dates':>11}{'live':>6}{'  owner':8} result")
for i in picks:
    gid, addr = B["id"][i], B["addr"][i]
    mine = comp[(comp.GIS_ID == gid) & comp.open_day.str[:7].isin(months)]
    ids = list(mine.case_enquiry_id.astype(str))
    found = 0
    legacy = [x for x in ids if not x.startswith("BCS")]
    new = [x for x in ids if x.startswith("BCS")]
    if legacy:
        inlist = ",".join("'" + x + "'" for x in legacy)
        for rid in RES_311_YEARLY.values():
            for rec in ckan.sql(f'SELECT case_enquiry_id, open_dt, closure_reason FROM "{rid}" WHERE case_enquiry_id IN ({inlist})'):
                day = mine[mine.case_enquiry_id.astype(str) == str(rec["case_enquiry_id"])].open_day.iloc[0]
                if str(rec["open_dt"])[:10] == day and "duplicate" not in str(rec["closure_reason"] or "").lower():
                    found += 1
    if new:
        inlist = ",".join("'" + x + "'" for x in new)
        found += len(ckan.sql(f'SELECT case_id FROM "{RES["311_new_system"]}" WHERE case_id IN ({inlist})'))
    my_dates = cit[(cit.GIS_ID == gid) & (cit.day >= WINDOW_START)].day.nunique()
    plist = sorted(set(pids.get(gid, [gid]) + [gid]))
    inlist = ",".join("'" + p + "'" for p in plist + [p.lstrip("0") for p in plist])
    live = ckan.sql(f'''SELECT date FROM "{RES["rentsmart"]}" WHERE violation_type='Housing Violations' AND date>='{WINDOW_START}' AND parcel IN ({inlist})''')
    live_dates = len({str(x["date"])[:10] for x in live})
    shown_owner = B["ownerStrings"][B["owner"][i]]
    rec = ckan.sql(f'''SELECT "OWNER", "OWN_OCC", "LU" FROM "{RES["assessment_fy2026"]}" WHERE "PID"='{B["pid"][i]}' LIMIT 1''')
    live_owner = " ".join(str(rec[0]["OWNER"] or "").split()) if rec else ""
    if shown_owner == INDIVIDUAL_OWNER_LABEL:
        owner_ok = bool(rec) and rec[0]["OWN_OCC"] == "Y"
        owner_note = "hidden" if owner_ok else "HIDDEN?"
    else:
        owner_ok = shown_owner == live_owner
        owner_note = "same" if owner_ok else "DIFF"
    # RentSmart rows without a parcel id are matched by address, so we may show more dates than a parcel-only recount finds
    good = found == len(ids) and my_dates >= live_dates and owner_ok
    note = "" if my_dates == live_dates else f" (+{my_dates - live_dates} date(s) matched by address)" if my_dates > live_dates else ""
    ok_all &= good
    print(f"{addr[:33]:34}{len(ids):>10}{found:>11}{my_dates:>11}{live_dates:>6}  {owner_note:8} {'ok' if good else 'MISMATCH'}{note}")
print("\nresult:", "all buildings match the live API" if ok_all else "MISMATCHES FOUND")
sys.exit(0 if ok_all else 1)
