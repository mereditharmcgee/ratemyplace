"""Step 3: write the compact JSON files the page loads, then scan them.

  core.json            metadata, geography cells, one row per complaint and per building-month with a citation
  buildings.json       buildings that have any record since January 2023 (map, table)
  owners-index.json    every published owner name
  owners/NN.json       the buildings under each owner
  records/NNN.json     record lists per building, for the drill-down
  boundaries.json      simplified district and neighborhood outlines

Owner names are decided here (config.OWNER_NAME_POLICY), so a name that is not meant to be
published never reaches a file. After writing, a scan confirms that no hidden owner is listed
under a name; a hit fails the run and removes the output.
"""
import datetime, json, os, pickle, re, shutil, sys, time
from collections import Counter, defaultdict
from zoneinfo import ZoneInfo

import pandas as pd
from shapely.geometry import mapping, shape

import quiet
from config import INDIVIDUAL_OWNER_LABEL, OUT, OWNER_NAME_POLICY, RAW, SOURCES, WINDOW_START, WORK
from rules import PUBLIC_PAT, nonprofit_name, owner_class, owner_norm, zip5

if OWNER_NAME_POLICY not in ("ordinance", "all"):
    raise SystemExit("OWNER_NAME_POLICY must be 'ordinance' or 'all'")
quiet.quiet_errors()
bd = pickle.load(open(os.path.join(WORK, "build.pkl"), "rb"))
if bd["as_of"]:
    raise SystemExit("build.pkl was built with --as-of; re-run build.py without it before exporting")
N_OWNER_SHARDS, N_RECORD_SHARDS = 64, 256
GROUPS = ["pests", "general", "heat", "other"]   # the four public issue groups, in display order
BUCKET_GROUP = {"pests_interior": 0, "living_conditions": 1, "heat": 2}   # everything else is group 3
# Under the "ordinance" policy an owner-occupied small building is named only when its owner is plainly an entity.
# Everything else is treated as a person: the name classifier reads surnames such as Hill or Park as organizations.
NAMED_WHEN_OWNER_OCCUPIED = {"Company (LLC, corporation, or partnership)", "Public or quasi-public", "Condo association or trust"}

OUT = os.path.abspath(OUT)
tmp = OUT + ".tmp"


def rmtree(path):
    """Windows can hold a handle for a moment (sync tools, antivirus); retry rather than leave a half-deleted folder."""
    for i in range(6):
        shutil.rmtree(path, ignore_errors=True)
        if not os.path.exists(path): return
        time.sleep(1 + i)
    raise SystemExit("could not clear " + os.path.basename(path))


rmtree(tmp)
os.makedirs(os.path.join(tmp, "owners")); os.makedirs(os.path.join(tmp, "records"))


def dump(name, obj):
    with open(os.path.join(tmp, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)


def clean(v):
    return "" if v is None or (isinstance(v, float) and pd.isna(v)) else re.sub(r"\s+", " ", str(v)).strip()


def nice_address(a):
    """'195 Lexington ST' -> '195 Lexington St'. The assessor writes the suffix in capitals."""
    return " ".join(t.capitalize() if (t.isupper() and t.isalpha() and len(t) > 1) else t for t in clean(a).split()) or "(no street address)"


# ---------------- buildings ----------------
r = bd["buildings"].copy()
r["zip"] = r.ZIP_CODE.map(zip5)
r["dist"] = r.district.map(lambda x: "" if pd.isna(x) else str(int(float(x))))
r["nbhd"] = r.neighborhood.map(clean)
r["addr"] = r.address.map(nice_address)
r["owner_raw"] = r.OWNER.map(clean)
r["own_key"] = r.owner_raw.map(owner_norm)
r["own_class"] = r.own_key.map(owner_class)
r["hidden"] = (OWNER_NAME_POLICY == "ordinance") & r.oo_small_display & r.LU.ne("CM") & ~r.own_class.isin(NAMED_WHEN_OWNER_OCCUPIED)
r["public_display"] = r.public | r.bha_link
r["is_condo"] = r.LU.eq("CM")
u = r[r.U].copy()            # the dashboard universe: residential, not an owner-occupied single-family home
gid_row = {g: i for i, g in enumerate(r.GIS_ID)}

# geography cells
districts = sorted({d for d in u.dist if d}, key=int)
nbhds = sorted({n for n in u.nbhd if n})
zips = sorted({z for z in u.zip if z})
di = {d: i for i, d in enumerate(districts)}; ni = {n: i for i, n in enumerate(nbhds)}; zi = {z: i for i, z in enumerate(zips)}
u["cell_key"] = list(zip(u.dist.map(lambda d: di.get(d, -1)), u.nbhd.map(lambda n: ni.get(n, -1)), u.zip.map(lambda z: zi.get(z, -1))))
cg = u.groupby("cell_key").agg(n=("GIS_ID", "size"), rb=("rental_bldg", "sum"), ru=("rental_units", lambda s: s[u.loc[s.index, "rental_bldg"]].sum()))
cell_keys = sorted(cg.index)
cell_idx = {k: i for i, k in enumerate(cell_keys)}
cells = [[k[0], k[1], k[2], int(cg.at[k, "n"]), int(cg.at[k, "rb"]), int(cg.at[k, "ru"])] for k in cell_keys]
u["cell"] = u.cell_key.map(cell_idx)

# ---------------- records ----------------
uset = set(u.GIS_ID)
c = bd["complaints"]; c = c[c.GIS_ID.isin(uset)].copy()
c["group"] = c.bucket.map(lambda b: BUCKET_GROUP.get(b, 3))
cit = bd["citations"]; cit = cit[cit.GIS_ID.isin(uset)].copy()
isd = bd["isd"]; isd = isd[isd.GIS_ID.isin(uset)].copy()
data_through = max(c.open_day.max(), cit.day.max())
pulled_utc = datetime.datetime.fromisoformat(bd["pull_log"]["_finished"])
pulled = pulled_utc.astimezone(ZoneInfo("America/New_York")).date().isoformat()
if data_through[:10] > pulled:
    data_through = pulled   # a record dated in the future is a city data-entry slip, not a later pull
months = []
y, mo = 2023, 1
while f"{y}-{mo:02d}" <= data_through[:7]:
    months.append(f"{y}-{mo:02d}"); mo += 1
    if mo == 13: y, mo = y + 1, 1
mi = {m: i for i, m in enumerate(months)}
c = c[c.open_day.str[:7].isin(mi)]; cit = cit[cit.day.str[:7].isin(mi) & (cit.day >= WINDOW_START)]

has = u[(u.lc3_total > 0) | (u.ssc_dates > 0) | (u.isd_cond3 > 0)].copy()
has = has[has.GIS_ID.isin(set(c.GIS_ID)) | has.GIS_ID.isin(set(cit.GIS_ID)) | (has.isd_cond3 > 0)]
has = has.sort_values(["dist", "addr"]).reset_index(drop=True)
bi = {g: i for i, g in enumerate(has.GIS_ID)}

c = c.sort_values(["open_day", "case_enquiry_id"])
cit_bm = cit.assign(m=cit.day.str[:7]).groupby(["GIS_ID", "m"]).day.nunique().reset_index().sort_values(["m", "GIS_ID"])

# ---------------- owners ----------------
own_b_sub = {}   # attributed owner -> subsidized or nonprofit
for o, sub in zip(r.attributed_owner, r.owner_sub):
    if sub: own_b_sub[o] = True
groups = defaultdict(lambda: {"names": Counter(), "holdings": [], "public": False, "sub": False, "condo_assoc": 0})


def bsum(row):
    return [row.GIS_ID, row.addr, row.dist, row.nbhd, row.zip, None if pd.isna(row.units_num) else int(row.units_num),
            int(row.lc3_total) if row.U else 0, int(row.ssc_dates) if row.U else 0, int(row.isd_cond3) if row.U else 0]


for row in r.itertuples(index=False):
    if row.hidden or not row.own_key:
        continue
    if OWNER_NAME_POLICY == "ordinance" and row.oo_sf:
        continue   # owner-occupied single-family homes are outside the dashboard altogether
    g = groups[row.own_key]
    g["names"][row.owner_raw] += 1
    g["holdings"].append(bsum(row) + [0, 1 if row.is_condo else 0])
    if row.public_display or PUBLIC_PAT.search(row.own_key): g["public"] = True
    if (row.owner_sub and not row.is_condo) or own_b_sub.get(row.own_key) or nonprofit_name(row.own_key): g["sub"] = True
    if row.is_condo: g["condo_assoc"] += 1

# condo units: owners who do not live in the unit are published; owners who do are not (unless the policy is "all")
cu = bd["condo_units"].copy()
cu["OWNER"] = cu.OWNER.map(clean)
if OWNER_NAME_POLICY == "ordinance":
    cu = cu[cu.OWN_OCC != "Y"]
cu = cu[cu.own_n != ""]
unit_owners = defaultdict(list)   # GIS_ID -> [[name, units]]
for (gid, key), grp in cu.groupby(["GIS_ID", "own_n"]):
    row = r.iloc[gid_row[gid]]
    name = grp.OWNER.value_counts().index[0]
    g = groups[key]
    g["names"][name] += len(grp)
    g["holdings"].append(bsum(row) + [len(grp), 0])
    if PUBLIC_PAT.search(key): g["public"] = True
    if own_b_sub.get(key) or nonprofit_name(key): g["sub"] = True
    unit_owners[gid].append([key, len(grp)])

keys = sorted(groups)
oid = {k: i for i, k in enumerate(keys)}
o_name, o_n, o_rec, o_flag = [], [], [], []
shards = defaultdict(dict)
for k in keys:
    g = groups[k]
    name = g["names"].most_common(1)[0][0]
    hold = sorted(g["holdings"], key=lambda h: (-(h[6] + h[7] + h[8]), h[1]))
    nb = len({h[0] for h in hold})
    flag = 1 if g["public"] else 2 if g["sub"] else 3 if g["condo_assoc"] == len(hold) else 0
    o_name.append(name); o_n.append(nb); o_rec.append(sum(1 for h in hold if h[6] + h[7] + h[8] > 0)); o_flag.append(flag)
    shards[oid[k] % N_OWNER_SHARDS][str(oid[k])] = {"name": name, "spellings": sorted(g["names"]), "flag": flag, "holdings": hold}
for i in range(N_OWNER_SHARDS):
    dump(f"owners/{i}.json", shards.get(i, {}))
dump("owners-index.json", {"name": o_name, "n": o_n, "rec": o_rec, "flag": o_flag, "shards": N_OWNER_SHARDS})

# ---------------- buildings.json (columnar) ----------------
def owner_text(row):
    if row.hidden: return INDIVIDUAL_OWNER_LABEL
    return row.owner_raw or "Not listed"


def flags(row):
    return (1 if row.public_display else 0) | (2 if row.owner_sub and not row.public_display else 0) | (4 if row.hidden else 0) | (8 if row.is_condo else 0) \
        | (16 if row.pp_units > 0 else 0) | (32 if row.ppo_units > 0 else 0) | (64 if row.ir_units > 0 else 0) | (128 if row.rental_bldg else 0)


owner_strings, owner_si = [], {}
def sidx(t):
    if t not in owner_si:
        owner_si[t] = len(owner_strings); owner_strings.append(t)
    return owner_si[t]


B = {"id": [], "addr": [], "lat": [], "lon": [], "cell": [], "units": [], "ru": [], "owner": [], "oid": [], "flags": [], "isd": [], "pwd": [], "rod": [], "pid": []}
for row in has.itertuples(index=False):
    B["id"].append(row.GIS_ID); B["addr"].append(row.addr)
    B["lat"].append(None if pd.isna(row.y) else round(float(row.y), 5)); B["lon"].append(None if pd.isna(row.x) else round(float(row.x), 5))
    B["cell"].append(int(row.cell)); B["units"].append(None if pd.isna(row.units_num) else int(row.units_num))
    B["ru"].append(int(row.rental_units) if row.rental_bldg else 0)
    B["owner"].append(sidx(owner_text(row))); B["oid"].append(-1 if (row.hidden or not row.own_key) else oid[row.own_key])
    B["flags"].append(flags(row)); B["isd"].append(int(row.isd_cond3)); B["pwd"].append(int(row.pwd_tickets)); B["rod"].append(int(row.rodent3))
    B["pid"].append(row.PID)
B["ownerStrings"] = owner_strings
dump("buildings.json", B)

# ---------------- records shards ----------------
rec = defaultdict(lambda: {"c": [], "s": [], "i": [], "u": []})
for x in c.itertuples(index=False):
    rec[x.GIS_ID]["c"].append([x.open_day, clean(x.type), int(x.group), clean(x.case_status)])
for (gid, day), grp in cit.groupby(["GIS_ID", "day"]):
    rec[gid]["s"].append([day, sorted({clean(t) for t in grp.description if clean(t)})])
for (gid, case), grp in isd.groupby(["GIS_ID", "case_no"]):
    rec[gid]["i"].append([clean(case), clean(grp.status.iloc[0]), grp.status_day.max(), sorted({clean(t) for t in grp.description if clean(t)}), bool(grp.cond.any())])
for gid, lst in unit_owners.items():
    if gid in bi:
        rec[gid]["u"] = [[oid[k], groups[k]["names"].most_common(1)[0][0], n] for k, n in sorted(lst, key=lambda t: -t[1])]
rshards = defaultdict(dict)
for gid in has.GIS_ID:
    v = rec[gid]
    v["c"].sort(reverse=True); v["s"].sort(reverse=True); v["i"].sort(key=lambda t: t[2] or "", reverse=True)
    rshards[int(gid) % N_RECORD_SHARDS][gid] = v
for i in range(N_RECORD_SHARDS):
    dump(f"records/{i}.json", rshards.get(i, {}))

# ---------------- core.json ----------------
core = {
    "meta": {
        "pulled": pulled, "dataThrough": data_through[:10], "windowStart": WINDOW_START, "months": months, "groups": GROUPS,
        "ownerPolicy": OWNER_NAME_POLICY, "sources": SOURCES, "recordShards": N_RECORD_SHARDS, "ownerShards": N_OWNER_SHARDS,
        "universeBuildings": int(len(u)), "rentalBuildings": int(u.rental_bldg.sum()), "buildingsWithRecords": int(len(has)),
        "universeUnits": int(u.units_num[u.units_num > 0].sum()),
        "unmappedNew311": int(sum(bd["unmapped_new_311"].values())),
        "matched311": {k: int(v) for k, v in bd["match_311"].items()},
    },
    "districts": districts, "neighborhoods": nbhds, "zips": zips, "cells": cells,
    "bCell": [int(x) for x in has.cell], "bRental": [1 if x else 0 for x in has.rental_bldg],
    "complaints": {"b": [bi[g] for g in c.GIS_ID], "m": [mi[d[:7]] for d in c.open_day], "g": [int(x) for x in c.group]},
    "citations": {"b": [bi[g] for g in cit_bm.GIS_ID], "m": [mi[m] for m in cit_bm.m], "n": [int(x) for x in cit_bm.day]},
}
dump("core.json", core)

# ---------------- boundaries ----------------
def outlines(path, key):
    out = []
    for f in json.load(open(path, encoding="utf-8"))["features"]:
        geom = shape(f["geometry"]).simplify(0.00025, preserve_topology=True)
        gj = mapping(geom)
        polys = gj["coordinates"] if gj["type"] == "MultiPolygon" else [gj["coordinates"]]
        rings = [[[round(x, 5), round(y, 5)] for x, y, *_ in poly[0]] for poly in polys if len(poly[0]) >= 4]
        out.append({"name": str(f["properties"][key]), "rings": rings})
    return out


dump("boundaries.json", {"districts": outlines(os.path.join(RAW, "council_districts.geojson"), "DISTRICT"),
                         "neighborhoods": outlines(os.path.join(RAW, "bpda_neighborhoods.geojson"), "name")})

# ---------------- safety scan ----------------
# No building whose owner is shown as "Individual owner" may sit under a published owner name.
_listed = {(k, h[0]) for k, g in groups.items() for h in g["holdings"] if not h[9]}
if any((row.own_key, row.GIS_ID) in _listed for row in r[r.hidden].itertuples(index=False)):
    rmtree(tmp)
    raise SystemExit("safety scan: a hidden owner is listed under a published name; nothing was written")

rmtree(OUT)
os.replace(tmp, OUT)
sizes = {fn: os.path.getsize(os.path.join(OUT, fn)) for fn in os.listdir(OUT) if fn.endswith(".json")}
print("pulled", pulled, "data through", data_through[:10])
print("universe", len(u), "with records", len(has), "complaints", len(c), "citation building-months", len(cit_bm), "owners", len(keys), "cells", len(cells))
print("hidden owner buildings", int(r.hidden.sum()), "| sizes (KB):", {k: round(v / 1024) for k, v in sizes.items()})
