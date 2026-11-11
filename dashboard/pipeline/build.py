"""Step 2: buildings, record matching and the v3 district rules.

A port of the district method's reference scripts (building table and geography, record
matching, owner flags, Short-Term Rental flags, v3 rules) into one pass. Reads the raw
cache, writes work/build.pkl for export.py and the checks.

  python build.py                    build from the raw cache
  python build.py --as-of 2026-10-27 cap complaints and citations at a date (used by check 1)
"""
import json, os, pickle, re, sys
import numpy as np, pandas as pd, shapely
from scipy.spatial import cKDTree
from shapely.geometry import shape

import quiet
from config import RAW, WORK, WINDOW_START, NEW_311_BUCKETS
from rules import *  # noqa: F401,F403  (the locked rules)
from rules import BHA_MAIL_KEYS, BHA_NAME_PAT, PUBLIC_PAT, is_living, isd_class, living_bucket, mail_key, nonprofit_name, num_list, owner_class, owner_norm, street_norm, wnorm, zip5

AS_OF = sys.argv[sys.argv.index("--as-of") + 1] if "--as-of" in sys.argv else None
os.makedirs(WORK, exist_ok=True)
quiet.quiet_errors()


def raw(name):
    return os.path.join(RAW, name)


def say(*a):
    print(*a, flush=True)


# =====================================================================================
# Buildings: one row per assessment lot (GIS_ID)
# =====================================================================================
a = pd.read_csv(raw("assessment_fy2026.csv"), dtype=str, low_memory=False)
for c in ["PID", "GIS_ID", "CM_ID"]:
    a[c] = a[c].where(a[c].isna(), a[c].str.replace(r"\.0$", "", regex=True).str.zfill(10))
a["LUC"] = a["LUC"].str.zfill(3)
pid2gis = dict(zip(a.PID, a.GIS_ID))
gis_set = set(a.GIS_ID.dropna())


def residential(lu, luc):
    if lu in ("R1", "R2", "R3", "R4", "RC", "CM"): return True
    if lu == "A" and luc in ("112", "113", "114", "120", "121", "125", "126", "127"): return True
    if lu == "E" and luc in ("908", "950", "992"): return True
    if lu == "EA": return True
    return False


# main record per lot: condo main row, else the row whose PID equals GIS_ID, else first row
a["is_main"] = (a.LU == "CM") | ((a.PID == a.GIS_ID) & (a.LU != "CD"))
main = a[a.is_main].drop_duplicates("GIS_ID")
missing = a[~a.GIS_ID.isin(main.GIS_ID) & (a.LU != "CD")].drop_duplicates("GIS_ID")
main = pd.concat([main, missing])
b = main[["GIS_ID", "PID", "ST_NUM", "ST_NUM2", "ST_NAME", "ZIP_CODE", "CITY", "LU", "LUC", "LU_DESC", "OWN_OCC", "OWNER",
          "MAIL_ADDRESSEE", "MAIL_STREET_ADDRESS", "MAIL_CITY", "MAIL_STATE", "MAIL_ZIP_CODE", "RES_UNITS", "YR_BUILT"]].copy()
b = b[b.GIS_ID.notna()].reset_index(drop=True)
b["residential"] = [residential(l, c) for l, c in zip(b.LU, b.LUC)]
b["address"] = (b.ST_NUM.fillna("") + np.where(b.ST_NUM2.notna(), "-" + b.ST_NUM2.fillna(""), "") + " " + b.ST_NAME.fillna("")).str.strip()

# condo unit owners
cd = a[a.LU == "CD"].copy()
cd["own_n"] = cd.OWNER.map(owner_norm)
cnt = cd.groupby(["GIS_ID", "own_n"]).size().rename("k").reset_index()
tot = cd.groupby("GIS_ID").size().rename("cd_units")
top = cnt.sort_values("k", ascending=False).drop_duplicates("GIS_ID").set_index("GIS_ID")
dist_owners = cnt.groupby("GIS_ID").own_n.nunique().rename("cd_distinct_owners")
b = b.merge(tot, left_on="GIS_ID", right_index=True, how="left").merge(dist_owners, left_on="GIS_ID", right_index=True, how="left")
b["cd_top_owner"] = b.GIS_ID.map(top.own_n)
b["cd_top_owner_units"] = b.GIS_ID.map(top.k)
cdm = cd.drop_duplicates(["GIS_ID", "own_n"]).set_index(["GIS_ID", "own_n"])

# SAM coordinates and unit-address counts
s = pd.read_csv(raw("sam_addresses.csv"), dtype=str, low_memory=False)
s["PARn"] = s.PARCEL_ID.where(s.PARCEL_ID.isna(), s.PARCEL_ID.str.replace(r"\.0$", "", regex=True).str.zfill(10))
s["GIS_ID"] = s.PARn.map(pid2gis)
s.loc[s.GIS_ID.isna() & s.PARn.isin(gis_set), "GIS_ID"] = s.PARn
s["x"] = pd.to_numeric(s.POINT_X, errors="coerce"); s["y"] = pd.to_numeric(s.POINT_Y, errors="coerce")
prim = s[s.RELATIONSHIP_TYPE == "1"].groupby("GIS_ID")[["x", "y"]].mean()
allp = s.groupby("GIS_ID")[["x", "y"]].mean()
coords = prim.combine_first(allp)
b = b.merge(coords, left_on="GIS_ID", right_index=True, how="left")
units_sam = s[s.UNIT.notna()].groupby("GIS_ID").UNIT.nunique()
b["sam_unit_addresses"] = b.GIS_ID.map(units_sam)


def units(r):
    lu, luc, sam = r.LU, r.LUC, r.sam_unit_addresses
    if lu == "R1": return 1, "class (single family)"
    if lu == "R2": return 2, "class (two family)"
    if lu == "R3" and luc == "105": return 3, "class (three family)"
    if lu == "CM":
        u = pd.to_numeric(r.RES_UNITS, errors="coerce")
        if pd.isna(u) or u == 0: u = r.cd_units
        return (int(u), "assessment RES_UNITS (condo)") if pd.notna(u) and u > 0 else (np.nan, "unknown")
    if lu == "R4":
        if pd.notna(sam) and 4 <= sam <= 6: return int(sam), "estimate: SAM unit addresses (class 4-6)"
        return 5, "estimate: class midpoint (class 4-6)"
    if lu == "A" and luc == "112":
        if pd.notna(sam) and 7 <= sam <= 30: return int(sam), "estimate: SAM unit addresses (class 7-30)"
        return np.nan, "unknown (class 7-30)"
    if lu == "A" and luc == "113":
        if pd.notna(sam) and 31 <= sam <= 99: return int(sam), "estimate: SAM unit addresses (class 31-99)"
        return np.nan, "unknown (class 31-99)"
    if lu == "A" and luc == "114":
        if pd.notna(sam) and sam >= 100: return int(sam), "estimate: SAM unit addresses (class 100+)"
        return np.nan, "unknown (class 100+)"
    if pd.notna(sam) and sam >= 2: return int(sam), "estimate: SAM unit addresses"
    return np.nan, "unknown"


uu = b.apply(units, axis=1, result_type="expand")
b["units"], b["unit_basis"] = uu[0], uu[1]

# owner attribution
b["owner_norm"] = b.OWNER.map(owner_norm)
maj = (b.LU == "CM") & b.cd_top_owner.notna() & (b.cd_top_owner_units >= 2) & (b.cd_top_owner_units >= 0.5 * b.cd_units)
b["condo_majority_owner"] = np.where(maj, b.cd_top_owner, None)
b["attributed_owner"] = np.where(maj, b.cd_top_owner, b.owner_norm)
b["attributed_basis"] = np.where(maj, "majority condo-unit owner", np.where(b.LU == "CM", "condo main record (association)", "owner of record"))
b["attributed_class"] = b.attributed_owner.map(owner_class)


def mail_for(r):
    if r.attributed_basis == "majority condo-unit owner":
        m = cdm.loc[(r.GIS_ID, r.attributed_owner)]
        return m.MAIL_ADDRESSEE, m.MAIL_STREET_ADDRESS, m.MAIL_ZIP_CODE, m.OWN_OCC
    return r.MAIL_ADDRESSEE, r.MAIL_STREET_ADDRESS, r.MAIL_ZIP_CODE, r.OWN_OCC


mm = b.apply(mail_for, axis=1, result_type="expand")
b["att_mail_addressee"], b["att_mail_street"], b["att_mail_zip"], b["att_own_occ"] = mm[0], mm[1], mm[2], mm[3]


# districts and neighborhoods by point in polygon
def load_polys(path, key):
    g = json.load(open(path, encoding="utf-8"))
    return [(f["properties"][key], shape(f["geometry"])) for f in g["features"]]


dists = load_polys(raw("council_districts.geojson"), "DISTRICT")
nbhd = load_polys(raw("bpda_neighborhoods.geojson"), "name")


def pip(xs, ys, polys):
    out = np.array([None] * len(xs), dtype=object)
    ok = ~(np.isnan(xs) | np.isnan(ys))
    for name, poly in polys:
        shapely.prepare(poly)
        hit = np.zeros(len(xs), bool)
        hit[ok] = shapely.contains_xy(poly, xs[ok], ys[ok])
        out[hit & (out == None)] = name  # noqa: E711
    return out


b["district"] = pip(b.x.values, b.y.values, dists)
b["neighborhood"] = pip(b.x.values, b.y.values, nbhd)
say("lots", len(b), "residential", int(b.residential.sum()))

# address index: (num, street, zip) -> set(GIS_ID)
idx_z, idx_nz, idx_sorted = {}, {}, {}


def add(num, street, z, gid):
    if not gid or pd.isna(gid): return
    st = street_norm(street)
    if not st: return
    srt = " ".join(sorted(st.split()))
    for n in num_list(num):
        idx_z.setdefault((n, st, zip5(z)), set()).add(gid)
        idx_nz.setdefault((n, st), set()).add(gid)
        idx_sorted.setdefault((n, srt, zip5(z)), set()).add(gid)


for r in s[["STREET_NUMBER", "FULL_STREET_NAME", "ZIP_CODE", "GIS_ID", "IS_RANGE", "RANGE_FROM", "RANGE_TO"]].itertuples(index=False):
    add(r.STREET_NUMBER, r.FULL_STREET_NAME, r.ZIP_CODE, r.GIS_ID)
    if r.IS_RANGE == "1" and pd.notna(r.RANGE_FROM) and pd.notna(r.RANGE_TO):
        add(f"{r.RANGE_FROM}-{r.RANGE_TO}", r.FULL_STREET_NAME, r.ZIP_CODE, r.GIS_ID)
for r in a[["ST_NUM", "ST_NUM2", "ST_NAME", "ZIP_CODE", "GIS_ID"]].drop_duplicates().itertuples(index=False):
    num = r.ST_NUM if pd.isna(r.ST_NUM2) else f"{r.ST_NUM}-{r.ST_NUM2}"
    add(num, r.ST_NAME, r.ZIP_CODE, r.GIS_ID)
sam2gis = dict(zip(s.SAM_ADDRESS_ID, s.GIS_ID))

# =====================================================================================
# Matching records to buildings
# =====================================================================================
sam = s[s.GIS_ID.notna() & s.x.notna()]
sam_street = sam.FULL_STREET_NAME.fillna("").map(street_norm).values
LAT0 = 42.32


def proj(x, y):
    return np.c_[np.asarray(x, float) * 111320 * np.cos(np.radians(LAT0)), np.asarray(y, float) * 110540]


tree = cKDTree(proj(sam.x, sam.y))
sam_gis = sam.GIS_ID.values
cent = b.drop_duplicates("GIS_ID").set_index("GIS_ID")[["x", "y"]]
cent_x, cent_y = cent.x.to_dict(), cent.y.to_dict()
ck = {}
for g, x, y in zip(sam.GIS_ID, sam.x, sam.y):
    ck.setdefault(f"{y:.5f},{x:.5f}", set()).add(g)


def pick(cands, x, y):
    cands = [c for c in cands if c in cent_x]
    if len(cands) == 1 or (cands and (pd.isna(x) or pd.isna(y))): return cands[0]
    if not cands: return None
    d = [(float((cent_x[c] - x) ** 2 + (cent_y[c] - y) ** 2) if pd.notna(cent_x[c]) else 9e9, c) for c in cands]
    return min(d)[1]


def match_addr(num, street, z, x=np.nan, y=np.nan, nearest_m=25):
    """Layered: address+zip, sorted-token address+zip, exact SAM coordinate, address without zip (unique), nearest SAM point."""
    st = street_norm(street)
    nums = num_list(num) if num else []
    for n in nums[::-1]:
        c = idx_z.get((n, st, zip5(z)))
        if c: return pick(list(c), x, y), "address+zip"
    srt = " ".join(sorted(st.split()))
    for n in nums[::-1]:
        c = idx_sorted.get((n, srt, zip5(z)))
        if c: return pick(list(c), x, y), "address+zip (token order)"
    if pd.notna(x) and pd.notna(y):
        c = ck.get(f"{y:.5f},{x:.5f}")
        if c: return pick(list(c), x, y), "exact SAM coordinate"
    for n in nums[::-1]:
        c = idx_nz.get((n, st))
        if c and len(c) == 1: return list(c)[0], "address (no zip, unique)"
    if pd.notna(x) and pd.notna(y) and nearest_m:
        dds, iis = tree.query(proj([x], [y])[0], k=8)
        for dd, ii in zip(np.atleast_1d(dds), np.atleast_1d(iis)):
            if dd > nearest_m: break
            if not st or sam_street[ii] == st: return sam_gis[ii], f"nearest SAM point on same street ({dd:.0f} m)"
    return None, "unmatched"


def split_num_street(v):
    v = re.sub(r"&amp;", "&", str(v or "")).strip()
    if v.upper().startswith("INTERSECTION") or not v or v == "nan": return None, None
    m = re.match(r"^([0-9][0-9A-Za-z]*(?:\s*-\s*[0-9][0-9A-Za-z]*)?)\s+(.*)$", v)
    return (m.group(1).replace(" ", ""), m.group(2)) if m else (None, v)


# ---- 311 living conditions ----
d = pd.read_csv(raw("311_candidates.csv"), dtype=str, low_memory=False)
d = d[[is_living(t, r) for t, r in zip(d.type, d.reason)]].copy()
d["open_day"] = d.open_dt.str[:10]
d = d[d.open_day >= WINDOW_START]
if AS_OF: d = d[d.open_day <= AS_OF]
d["bucket"] = d.type.map(living_bucket)
# the new 311 system (ISD housing cases from Nov 5, 2026), mapped onto the same buckets
nw = pd.read_csv(raw("311_new_system.csv"), dtype=str)
nw["bucket"] = nw.service_name.map(lambda x: NEW_311_BUCKETS.get(wnorm(x)))
unmapped_new = nw[nw.bucket.isna()].service_name.value_counts().to_dict()
nw = nw[nw.bucket.notna()]
nw = pd.DataFrame({"case_enquiry_id": nw.case_id, "open_dt": nw.open_date, "closed_dt": nw.close_date, "case_status": nw.case_status,
                   "closure_reason": nw.closure_reason, "type": nw.service_name, "reason": "Housing",
                   "location_street_name": nw.street_number.fillna("") + " " + nw.street_name.fillna(""),
                   "location_zipcode": nw.zip_code, "latitude": nw.latitude, "longitude": nw.longitude, "bucket": nw.bucket})
nw["open_day"] = nw.open_dt.str[:10]
if AS_OF: nw = nw[nw.open_day <= AS_OF]
d = pd.concat([d, nw], ignore_index=True)
d["lat"] = pd.to_numeric(d.latitude, errors="coerce"); d["lon"] = pd.to_numeric(d.longitude, errors="coerce")
res = []
for r in d.itertuples(index=False):
    num, st = split_num_street(r.location_street_name)
    if num is None:
        res.append((None, "intersection or no street number"))
        continue
    res.append(match_addr(num, st, r.location_zipcode, r.lon, r.lat))
d["GIS_ID"], d["match_method"] = [x[0] for x in res], [x[1] for x in res]
d["dup"] = d.closure_reason.fillna("").str.contains(r"duplicate", case=False)
# The two 311 systems overlap for a few days around the Nov 5, 2026 switch. If the same building has the same
# kind of request on the same day in both, keep the legacy row only.
_new = d.case_enquiry_id.astype(str).str.startswith("BCS")
_has = d.GIS_ID.notna()
_legacy_keys = set(zip(d.GIS_ID[~_new & _has], d.open_day[~_new & _has], d.bucket[~_new & _has]))
_both = _new & _has & pd.Series([k in _legacy_keys for k in zip(d.GIS_ID, d.open_day, d.bucket)], index=d.index)
d = d[~_both].copy()
d["rodent"] = d.bucket.eq("rodent_activity_isd") | d.type.eq("Pigeon Infestation")
d["yr"] = d.open_day.str[:4]
say("311 living", len(d), d.match_method.str.split(" \\(").str[0].value_counts().to_dict())

# ---- ISD violations ----
v = pd.read_csv(raw("isd_violations.csv"), dtype=str, low_memory=False)
v["GIS_ID"] = v.sam_id.map(sam2gis)
for i in v[v.GIS_ID.isna()].index:
    st = f"{v.at[i, 'violation_street'] or ''} {v.at[i, 'violation_suffix'] or ''}"
    num = v.at[i, "violation_stno"] if pd.isna(v.at[i, "violation_sthigh"]) else f"{v.at[i, 'violation_stno']}-{v.at[i, 'violation_sthigh']}"
    g, _ = match_addr(num, st, v.at[i, "violation_zip"], pd.to_numeric(v.at[i, "longitude"], errors="coerce"), pd.to_numeric(v.at[i, "latitude"], errors="coerce"))
    v.at[i, "GIS_ID"] = g
v["status_day"] = v.status_dttm.str[:10]
PAPER = {"testing & certification", "periodic inspections"}
v["cond"] = v.description.map(lambda x: isd_class(x) == "condition or safety" and wnorm(x) not in PAPER)
say("isd", len(v), "matched", int(v.GIS_ID.notna().sum()))

# ---- RentSmart sanitary code citations ----
rs = pd.read_csv(raw("rentsmart.csv"), dtype=str, low_memory=False)
rs["par"] = rs.parcel.where(rs.parcel.isna(), rs.parcel.str.replace(r"\.0$", "", regex=True).str.zfill(10))
rs["GIS_ID"] = rs.par.map(pid2gis)
rs.loc[rs.GIS_ID.isna() & rs.par.isin(gis_set), "GIS_ID"] = rs.par
for i in rs[rs.GIS_ID.isna()].index:
    num, st = split_num_street(str(rs.at[i, "address"]).split(",")[0])
    g, _ = match_addr(num, st, rs.at[i, "zip_code"], pd.to_numeric(rs.at[i, "longitude"], errors="coerce"), pd.to_numeric(rs.at[i, "latitude"], errors="coerce"))
    rs.at[i, "GIS_ID"] = g
rs["day"] = rs.date.str[:10]
if AS_OF: rs = rs[rs.day <= AS_OF]
say("rentsmart", len(rs), "matched", int(rs.GIS_ID.notna().sum()))

# ---- Public Works tickets ----
p = pd.read_csv(raw("pwd_by_sam.csv"), dtype={"sam_id": str})
p["GIS_ID"] = p.sam_id.str.replace(r"\.0$", "", regex=True).map(sam2gis)
pwd = p.groupby("GIS_ID").tickets.sum()

# ---- Short-Term Rental Eligibility flags ----
f = pd.read_csv(raw("str_flags.csv"), dtype=str)
f["GIS_ID"] = f.sam_address_id.str.replace(r"\.0$", "", regex=True).map(sam2gis)
fg = f[f.GIS_ID.notna()].groupby("GIS_ID").agg(ir_units=("ir", lambda x: int((x == "Y").sum())), pp_units=("pp", lambda x: int((x == "Y").sum())),
                                              ppo_units=("ppo", lambda x: int((x == "Y").sum())))

# =====================================================================================
# v3 rules
# =====================================================================================
def unit_conf(basis):
    if basis.startswith("class (") or basis.startswith("assessment"): return "exact"
    if "class midpoint" in basis or "(class" in basis and basis.startswith("estimate"): return "estimate in class range"
    if basis.startswith("estimate"): return "unchecked estimate"
    return "unknown"


b["unit_confidence"] = b.unit_basis.fillna("unknown").map(unit_conf)
b["rate_ok"] = b.unit_confidence.isin(["exact", "estimate in class range"]) & (b.units > 0)
b["oo_sf"] = (b.LU == "R1") & (b.OWN_OCC == "Y")

n_res_all = int(b.residential.sum())
r = b[b.residential].drop_duplicates("GIS_ID").copy()
r["subsidized_class"] = r.LUC.isin(["125", "126", "127"]) | r.LU.eq("EA")
r["nonprofit_name"] = [nonprofit_name(o, ad) for o, ad in zip(r.attributed_owner.fillna(""), r.att_mail_addressee.fillna(""))]
r["public"] = r.attributed_class.eq("Public or quasi-public") | r.LUC.eq("908")
r["condo_assoc_only"] = r.attributed_basis.eq("condo main record (association)")
# public housing held through a partnership (display label only; the district counts use `public`)
r["bha_link"] = r.LUC.eq("908") | r.attributed_owner.fillna("").map(lambda o: bool(PUBLIC_PAT.search(o) or BHA_NAME_PAT.search(o))) | \
    r.att_mail_addressee.fillna("").str.upper().str.contains("BOSTON HOUSING AUTH") | \
    pd.Series([mail_key(x, z) in BHA_MAIL_KEYS for x, z in zip(r.att_mail_street, r.att_mail_zip)], index=r.index)
r["units_num"] = pd.to_numeric(r.units, errors="coerce")
cd["rental"] = (cd.OWN_OCC != "Y").astype(int)
cdg = cd.groupby("GIS_ID").agg(cd_units_all=("PID", "size"), cd_rental=("rental", "sum"))
r = r.merge(cdg, left_on="GIS_ID", right_index=True, how="left")
iscondo = r.LU.eq("CM")
# Unit count shown on the page (table, per-unit column, default order). It is stricter than `units`, which the
# district rates keep using unchanged. A count is shown only when city records support it:
#   class    one, two or three family: the assessment class is the count
#   condo    condo lot: the number of residential condo unit records (LU CD) on the lot, when nothing else
#            residential sits on the lot (an apartment building held as one condo unit has no count)
#   address  4 to 6 family and apartment classes: the city address list's unit count, when it falls inside the
#            range the assessment class allows
# Anything else has no count: address-list counts with no class range to check against (mixed use, subsidized
# and exempt classes), class midpoints, and lots with more than one residential assessment record.
RES_LU = {"R1", "R2", "R3", "R4", "RC", "A", "EA", "E"}
_oth = a[a.GIS_ID.notna() & ~a.LU.isin(["CD", "CM"]) & a.LU.isin(RES_LU)].groupby("GIS_ID").size()
r["res_rows"] = r.GIS_ID.map(_oth).fillna(0).astype(int)   # residential-type records on the lot, condo units and master aside


def units_shown(x):
    if x.LU == "CM":
        ru = pd.to_numeric(x.RES_UNITS, errors="coerce")
        if pd.notna(x.cd_units_all) and x.cd_units_all > 0 and x.res_rows == 0 and not (pd.notna(ru) and ru > x.cd_units_all):
            return int(x.cd_units_all), "condo"
        return np.nan, "none"
    if x.res_rows > 1: return np.nan, "none"
    if x.unit_basis.startswith("class ("): return int(x.units_num), "class"
    if x.unit_basis.startswith("estimate: SAM unit addresses (class"): return int(x.units_num), "address"
    return np.nan, "none"


_us = r.apply(units_shown, axis=1, result_type="expand")
r["units_shown"], r["units_source"] = _us[0], _us[1]
r["rental_units"] = np.where(iscondo, r.cd_rental, np.where(r.OWN_OCC.eq("Y"), (r.units_num - 1).clip(lower=0), r.units_num))
r["known"] = r.rate_ok & r.rental_units.notna()
r["rental_bldg"] = r.known & (r.rental_units > 0)
r["U"] = ~r.oo_sf
r["oo_le6"] = r.OWN_OCC.eq("Y") & (r.units_num.fillna(99) <= 6)   # the method's test, used for the district numbers
# The owner-name display rule is stricter where the unit count is missing: a one, two or three family class is
# 6 or fewer by definition, and an owner-occupied building with no usable count is treated as small.
r["oo_small_display"] = r.OWN_OCC.eq("Y") & ((r.units_num <= 6) | r.LU.isin(["R1", "R2", "R3"]) | r.units_num.isna())

res_ids = set(r.GIS_ID)
m = d[d.GIS_ID.isin(res_ids)]
m3 = m[~m.dup & ~m.rodent]
rod = m[~m.dup & m.rodent]
r["lc3_total"] = r.GIS_ID.map(m3.groupby("GIS_ID").size()).fillna(0).astype(int)
for y in ["2023", "2024", "2025", "2026"]:
    r[f"lc3_{y}"] = r.GIS_ID.map(m3[m3.yr == y].groupby("GIS_ID").size()).fillna(0).astype(int)
BUCKETS = ["heat", "utilities", "pests_interior", "mold_ventilation", "living_conditions", "unsafe_dangerous", "maintenance", "other_living"]
for bk in BUCKETS:
    r[f"lc3_{bk}"] = r.GIS_ID.map(m3[m3.bucket == bk].groupby("GIS_ID").size()).fillna(0).astype(int)
r["rodent3"] = r.GIS_ID.map(rod.groupby("GIS_ID").size()).fillna(0).astype(int)

vo = v[(v.status == "Open") & v.GIS_ID.isin(res_ids)]
cc = vo.groupby(["GIS_ID", "case_no"]).cond.any().reset_index()
r["isd_cond3"] = r.GIS_ID.map(cc[cc.cond].groupby("GIS_ID").size()).fillna(0).astype(int)
rsm = rs[rs.GIS_ID.isin(res_ids)]
r["ssc_dates"] = r.GIS_ID.map(rsm.groupby("GIS_ID").day.nunique()).fillna(0).astype(int)
r["pwd_tickets"] = r.GIS_ID.map(pwd).fillna(0).astype(int)
for c in ["ir_units", "pp_units", "ppo_units"]:
    r[c] = r.GIS_ID.map(fg[c]).fillna(0).astype(int)

r["f_lc"] = r.lc3_total >= 5; r["f_isd"] = r.isd_cond3 >= 1; r["f_ssc"] = r.ssc_dates >= 1
r["flag3"] = r.U & (r.f_lc | r.f_isd | r.f_ssc)

# owner classes by attributed owner (private owners only)
priv = r[r.attributed_owner.fillna("").ne("") & ~r.public]
own_b = priv.groupby("attributed_owner").agg(bldgs=("GIS_ID", "size"), any_sub=("subsidized_class", "any"), np_name=("nonprofit_name", "any"),
                                             units_sum=("units_num", "sum"), ir_sum=("ir_units", "sum"))
own_b["ir_share"] = (own_b.ir_sum / own_b.units_sum.replace(0, np.nan)).fillna(0)
OVERRIDE_SUB = {"CSTO WINN OWNER LLC MASS LLC", "COMMERCE APARTMENTS LP MASS LP"}   # Castle Square; Commerce Apartments (checked Nov 3)
own_b["subsidized_or_nonprofit"] = own_b.any_sub | own_b.np_name | (own_b.ir_share >= 0.5) | own_b.index.isin(OVERRIDE_SUB)
sub_owner = own_b.subsidized_or_nonprofit.to_dict()
r["owner_sub"] = [bool(sub_owner.get(o, False)) and not pub for o, pub in zip(r.attributed_owner, r.public)]

say("universe", int(r.U.sum()), "rental buildings", int(r.rental_bldg.sum()), "flagged", int(r.flag3.sum()))

# condo unit rows at residential lots (for the owner lookup)
cdk = cd[cd.GIS_ID.isin(res_ids)][["GIS_ID", "PID", "OWNER", "own_n", "OWN_OCC"]].copy()

pull_log = json.load(open(raw("pull_log.json")))
out = {
    "as_of": AS_OF,
    "pull_log": pull_log,
    "n_residential_all": n_res_all,
    "buildings": r.drop(columns=["MAIL_ADDRESSEE", "MAIL_STREET_ADDRESS", "MAIL_CITY", "MAIL_STATE", "MAIL_ZIP_CODE", "att_mail_addressee",
                                 "att_mail_street", "att_mail_zip"]),
    "complaints": m3[["case_enquiry_id", "GIS_ID", "open_day", "type", "bucket", "case_status", "closed_dt"]].copy(),
    "rodent": rod[["GIS_ID", "open_day"]].copy(),
    "citations": rsm[["GIS_ID", "day", "description"]].copy(),
    "isd": v[v.GIS_ID.isin(res_ids) & ((v.status == "Open") | (v.status_day >= WINDOW_START))][["GIS_ID", "case_no", "status", "status_day", "description", "cond"]].copy(),
    "condo_units": cdk,
    "unmapped_new_311": unmapped_new,
    "match_311": d.match_method.str.split(" \\(").str[0].value_counts().to_dict(),
}
name = "build.pkl" if not AS_OF else f"build_asof_{AS_OF}.pkl"
pickle.dump(out, open(os.path.join(WORK, name), "wb"))
say("written", name)
