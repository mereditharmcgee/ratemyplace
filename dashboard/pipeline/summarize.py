"""District and citywide summaries under the v3 rules. Shared by check_districts.py and the tests."""
from decimal import Decimal, ROUND_HALF_UP

BUCKETS = ["heat", "utilities", "pests_interior", "mold_ventilation", "living_conditions", "unsafe_dangerous", "maintenance", "other_living"]


def r1(x):
    return float(Decimal(str(x)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def r0(x):
    return int(Decimal(str(x)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def summarize(gr):
    o = {}
    k = gr[gr.rental_bldg]
    ru = k.rental_units.sum()
    o["rental_units_est"] = int(ru)
    o["lc3_2025_per_1000"] = r1(1000 * k.lc3_2025.sum() / ru)
    u = gr[gr.U]
    tot = int(u.lc3_total.sum())
    o["lc3_total"] = tot
    o["rodent3_total"] = int(u.rodent3.sum())
    sh = {bk: u[f"lc3_{bk}"].sum() / tot for bk in BUCKETS}
    other = sh["utilities"] + sh["maintenance"] + sh["mold_ventilation"] + sh["unsafe_dangerous"] + sh["other_living"]
    o["mix"] = {"pests_residential": r0(100 * sh["pests_interior"]), "general_living_conditions": r0(100 * sh["living_conditions"]),
                "heat": r0(100 * sh["heat"]), "utilities_mold_upkeep_unsafe": r0(100 * other)}
    o["universe_buildings"] = int(u.shape[0])
    o["rental_buildings"] = int(gr.rental_bldg.sum())
    f = gr[gr.flag3]
    o["flagged"] = int(f.shape[0])
    o["flagged_public"] = int(f.public.sum())
    o["flagged_with_citation"] = int(f.f_ssc.sum())
    o["flagged_complaints_only"] = int((f.f_lc & ~f.f_ssc & ~f.f_isd).sum())
    o["flagged_isd_only"] = int((f.f_isd & ~f.f_ssc & ~f.f_lc).sum())
    o["flagged_rental_bldgs"] = int(f.rental_bldg.sum())
    o["flagged_subsidized_or_nonprofit_bldgs"] = int(f.owner_sub.sum())
    return o


def all_districts(r):
    out = {}
    for dct, gr in r.groupby("district"):
        out[str(int(dct))] = summarize(gr)
    out["citywide"] = summarize(r)
    return out
