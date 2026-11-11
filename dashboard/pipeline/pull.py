"""Step 1: pull everything from Analyze Boston into the raw cache. Read-only GET requests.

  python pull.py            pull everything
  python pull.py --missing  only pull files that are not in the cache yet (for development)

A failure raises, so the nightly job stops before it builds or deploys anything.
"""
import csv, datetime, json, os, sys
import ckan
from config import RAW, RES, RES_311_YEARLY, PACKAGES, WINDOW_START

os.makedirs(RAW, exist_ok=True)
MISSING_ONLY = "--missing" in sys.argv
LOGP = os.path.join(RAW, "pull_log.json")
log = json.load(open(LOGP)) if os.path.exists(LOGP) else {}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def want(name):
    return not (MISSING_ONLY and os.path.exists(os.path.join(RAW, name)) and name in log)


def write_csv(name, recs, cols):
    tmp = os.path.join(RAW, name + ".part")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(recs)
    os.replace(tmp, os.path.join(RAW, name))


def done(name, **kw):
    log[name] = {"pulled": now(), **kw}
    json.dump(log, open(LOGP, "w"), indent=1)
    print("pulled", name, kw.get("rows", kw.get("bytes", "")), flush=True)


# full tables
for name in ["assessment_fy2026", "sam_addresses", "isd_violations"]:
    f = name + ".csv"
    if want(f):
        done(f, resource_id=RES[name], bytes=ckan.dump(RES[name], os.path.join(RAW, f)))

# boundaries
for name in ["council_districts", "bpda_neighborhoods"]:
    f = name + ".geojson"
    if want(f):
        url = ckan.resource_url(PACKAGES[name], RES[name])
        done(f, resource_id=RES[name], bytes=ckan.download(url, os.path.join(RAW, f)))

# 311 living-conditions candidates (the exact grouping is applied in build.py)
COLS_311 = ["case_enquiry_id", "open_dt", "closed_dt", "case_status", "closure_reason", "case_title", "subject", "reason", "type",
            "location", "location_street_name", "location_zipcode", "latitude", "longitude", "source"]
WHERE_311 = ("reason IN ('Housing','Building','Environmental Services') OR type ILIKE '%Utilit%' OR type ILIKE '%Living%' "
             "OR type ILIKE '%Infestation%' OR type ILIKE '%Mold%' OR type ILIKE '%Rodent%' OR type ILIKE '%Heat%' "
             "OR type IN ('Lead','Carbon Monoxide','Bed Bugs','Breathe Easy','Rat Bite','Poor Ventilation','Sewage/Septic Back-Up')")
if want("311_candidates.csv"):
    rows = []
    per_year = {}
    for yr, rid in RES_311_YEARLY.items():
        recs = ckan.sql_all(f'SELECT {", ".join(COLS_311)} FROM "{rid}" WHERE ({WHERE_311}) ORDER BY case_enquiry_id')
        if yr < datetime.date.today().year and len(recs) < 1000:
            raise RuntimeError(f"311 {yr} came back nearly empty")
        per_year[str(yr)] = len(recs)
        rows += recs
    write_csv("311_candidates.csv", rows, COLS_311)
    done("311_candidates.csv", rows=len(rows), per_year=per_year)

# the new 311 system: record its service list so a move of housing services into it is noticed
if want("311_new_system_services.csv"):
    svc = ckan.sql(f'SELECT assigned_department, service_name, count(*) n FROM "{RES["311_new_system"]}" GROUP BY 1,2')
    write_csv("311_new_system_services.csv", svc, ["assigned_department", "service_name", "n"])
    done("311_new_system_services.csv", rows=len(svc))

# RentSmart State Sanitary Code citations. The owner column is deliberately not pulled.
if want("rentsmart.csv"):
    cols = ["_id", "date", "violation_type", "description", "address", "neighborhood", "zip_code", "parcel", "latitude", "longitude"]
    recs = ckan.sql_all(f'''SELECT {", ".join(cols)} FROM "{RES["rentsmart"]}" WHERE violation_type='Housing Violations' AND date>='{WINDOW_START}' ORDER BY _id''')
    if len(recs) < 1000:
        raise RuntimeError("RentSmart came back nearly empty")
    write_csv("rentsmart.csv", recs, cols)
    done("rentsmart.csv", rows=len(recs))

# Public Works code enforcement tickets, counted per SAM address
if want("pwd_by_sam.csv"):
    recs = ckan.sql_all(f'''SELECT sam_id, count(DISTINCT ticket_no) tickets, max(status_dttm) latest FROM "{RES["pwd_enforcement"]}"
WHERE status_dttm>='{WINDOW_START}' AND sam_id IS NOT NULL GROUP BY sam_id ORDER BY sam_id''')
    write_csv("pwd_by_sam.csv", recs, ["sam_id", "tickets", "latest"])
    done("pwd_by_sam.csv", rows=len(recs))

# Short-Term Rental Eligibility: income-restricted and problem-property flags, per SAM address
if want("str_flags.csv"):
    R = RES["str_eligibility"]
    recs = ckan.sql_all(f'''SELECT _id, sam_address_id, "income restricted" ir, "problem property" pp, "problem property owner" ppo FROM "{R}"
WHERE "income restricted"='Y' OR "problem property"='Y' OR "problem property owner"='Y' ORDER BY _id''', page=30000)
    write_csv("str_flags.csv", recs, ["sam_address_id", "ir", "pp", "ppo"])
    done("str_flags.csv", rows=len(recs))

log["_finished"] = now()
json.dump(log, open(LOGP, "w"), indent=1)
print("pull complete")
