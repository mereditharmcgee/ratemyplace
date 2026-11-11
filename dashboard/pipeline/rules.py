"""Shared rules for the dashboard pipeline: 311 type lists, issue buckets, address and owner
normalization, owner classes, public and nonprofit patterns, ISD description classes.

This is a straight port of the district method (v3, locked Nov 9, 2026). The district pages
and the dashboard must agree, so do not adjust a rule here without re-running
check_districts.py. Exclusions live in exclusions.py and are loaded from a secret.
"""
import re
import pandas as pd

# ---------- RateMyPlace 'Living conditions' group (https://ratemyplace.org/methodology, read 2026-10-27) ----------
LIVING_TYPES = ["Unsatisfactory Living Conditions", "Squalid Living Conditions", "Maintenance Complaint - Residential",
    "Rental Unit Delivery Conditions", "Heat - Excessive Insufficient", "No Utilities Residential - Water",
    "No Utilities Residential - Electricity", "No Utilities Residential - Gas", "Unsatisfactory Utilities - Electrical Plumbing",
    "Cross Metering - Sub-Metering", "Sewage/Septic Back-Up", "Pest Infestation - Residential", "Mice Infestation - Residential",
    "Bed Bugs", "Chronic Dampness/Mold", "Poor Ventilation", "Carbon Monoxide", "Lead", "Breathe Easy", "Rodent Activity",
    "Rat Bite", "Pigeon Infestation", "Unsafe Dangerous Conditions"]
BUILDING_TYPES = ["Building Inspection Request", "Work w/out Permit", "Exceeding Terms of Permit", "Contractors Complaint",
    "Working Beyond Hours", "Protection of Adjoining Property", "Electrical", "Plumbing", "Mechanical", "Egress",
    "Maintenance - Homeowner", "Illegal Occupancy", "Illegal Rooming House", "Occupying W/Out A Valid CO/CI", "Illegal Use",
    "Zoning", "ADA", "Short Term Rental", "Overcrowding", "Student Overcrowding", "Abandoned Building", "Illegal Auto Body Shop"]
def wnorm(x):
    return re.sub(r"\s+", " ", str(x)).strip().lower()
LIVING_SET = {wnorm(t) for t in LIVING_TYPES}
BUILDING_SET = {wnorm(t) for t in BUILDING_TYPES}
def is_living(type_, reason):
    t = wnorm(type_)
    return t in LIVING_SET or (wnorm(reason) == "housing" and t not in BUILDING_SET)

# Sub-buckets for display (all inside the RateMyPlace living-conditions group)
def living_bucket(type_):
    t = wnorm(type_)
    if t.startswith("heat"): return "heat"
    if t.startswith("no utilities") or t.startswith("unsatisfactory utilities") or t.startswith("cross metering") or t.startswith("sewage"): return "utilities"
    if t in ("rodent activity", "rat bite"): return "rodent_activity_isd"
    if t in ("pest infestation - residential", "mice infestation - residential", "bed bugs", "pigeon infestation"): return "pests_interior"
    if t in ("chronic dampness/mold", "poor ventilation"): return "mold_ventilation"
    if t in ("unsatisfactory living conditions", "squalid living conditions", "rental unit delivery conditions"): return "living_conditions"
    if t == "unsafe dangerous conditions": return "unsafe_dangerous"
    if t == "maintenance complaint - residential": return "maintenance"
    return "other_living"   # lead, carbon monoxide, breathe easy, Housing-category fallbacks

# ---------- addresses ----------
SUFFIX = {"ST": "ST", "STREET": "ST", "AV": "AVE", "AVE": "AVE", "AVENUE": "AVE", "RD": "RD", "ROAD": "RD", "PL": "PL",
    "PLACE": "PL", "TE": "TER", "TER": "TER", "TERRACE": "TER", "PK": "PARK", "PARK": "PARK", "SQ": "SQ", "SQUARE": "SQ",
    "DR": "DR", "DRIVE": "DR", "CT": "CT", "COURT": "CT", "BL": "BLVD", "BLVD": "BLVD", "BOULEVARD": "BLVD", "RO": "ROW",
    "ROW": "ROW", "WY": "WAY", "WAY": "WAY", "HW": "HWY", "HWY": "HWY", "HIGHWAY": "HWY", "PW": "PKWY", "PKWY": "PKWY",
    "PARKWAY": "PKWY", "LA": "LN", "LN": "LN", "LANE": "LN", "CI": "CIR", "CIR": "CIR", "CIRCLE": "CIR", "WH": "WHF",
    "WHF": "WHF", "WHARF": "WHF", "PZ": "PLZ", "PLZ": "PLZ", "PLAZA": "PLZ", "CC": "CIRT", "CIRT": "CIRT", "CIRCUIT": "CIRT",
    "CR": "CRES", "CRES": "CRES", "CRESCENT": "CRES", "GRN": "GRN", "GREEN": "GRN", "AL": "ALY", "ALY": "ALY", "ALLEY": "ALY"}
DIRS = {"EAST": "E", "WEST": "W", "NORTH": "N", "SOUTH": "S"}
NAME_TOKENS = {"SAINT": "ST", "STE": "ST", "MOUNT": "MT", "MONSIGNOR": "MSGR", "DOCTOR": "DR"}   # applied to non-final tokens only
def street_norm(street):
    """Canonical street string: uppercase, punctuation stripped, suffix and directional words canonicalized."""
    if street is None or (isinstance(street, float) and pd.isna(street)): return ""
    t = re.sub(r"&AMP;", "&", str(street).upper())
    t = re.sub(r"[^A-Z0-9 ]", " ", t)
    toks = [x for x in t.split() if x]
    out = []
    for i, x in enumerate(toks):
        if x in DIRS: x = DIRS[x]
        if i < len(toks) - 1 and x in NAME_TOKENS: x = NAME_TOKENS[x]
        last_is_dir = toks[-1] in DIRS or toks[-1] in ("E", "W", "N", "S")
        if (i == len(toks) - 1 and not last_is_dir) or (last_is_dir and i == len(toks) - 2):
            x = SUFFIX.get(x, x)
        out.append(x)
    return " ".join(out)
def num_list(num):
    """'16-18' -> ['16','17','18'] same-parity expansion (16,18); '9R' -> ['9R']; '23' -> ['23']."""
    if num is None or (isinstance(num, float) and pd.isna(num)): return []
    s = str(num).upper().strip().replace(" TO ", "-")
    s = re.sub(r"\s+", "", s)
    m = re.match(r"^(\d+)[A-Z]?-(\d+)[A-Z]?$", s)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        if a > b: a, b = b, a          # v2: reversed ranges ('1232-1230 Commonwealth Ave', '65-61 Empire St') expand too
        if b - a <= 60:
            step = 2 if (b - a) % 2 == 0 else 1
            return [str(n) for n in range(a, b + 1, step)] + [s]
    return [s]
def zip5(z):
    if z is None or (isinstance(z, float) and pd.isna(z)): return ""
    z = re.sub(r"\D", "", str(z).split(".")[0])
    return z[:5].zfill(5) if z else ""

# ---------- owners ----------
def owner_norm(x):
    """Light normalization only: uppercase, punctuation to space, collapse whitespace, unify L L C / INC. spellings.
    Names that differ in any other way (including a trailing jurisdiction tag like 'MASS LLC') are NOT merged."""
    if x is None or (isinstance(x, float) and pd.isna(x)): return ""
    t = str(x).upper().replace("&", " AND ")
    t = re.sub(r"\bL\s*\.?\s*L\s*\.?\s*C\b\.?", "LLC", t)
    t = re.sub(r"\bL\s*\.?\s*P\b\.?", "LP", t)
    t = re.sub(r"\bINC\b\.?", "INC", t)
    t = re.sub(r"[^A-Z0-9 ]", " ", t)
    return re.sub(r"\s+", " ", t).strip()
ENTITY_PAT = re.compile(r"\b(LLC|L L C|INC|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|LIMITED|PARTNERSHIP|PARTNERS|ASSOC|ASSOCIATES|"
    r"ASSOCIATION|HOLDINGS?|PROPERTIES|PROPERTY|REALTY|REAL ESTATE|MANAGEMENT|MGMT|DEVELOPMENT|DEVELOPERS|INVESTMENTS?|"
    r"VENTURES?|GROUP|ENTERPRISES?|APARTMENTS?|HOUSING|HOMES|RESIDENCES?|FUND|CAPITAL|EQUITIES|ESTATES|BANK|"
    r"FOUNDATION|CHURCH|UNIVERSITY|COLLEGE|HOSPITAL|AUTHORITY|CITY OF|COMMONWEALTH|SOCIETY|INSTITUTE|CENTER|CDC|"
    r"CORPORATE|NOMINEE|CONDOMINIUM|CONDO|COOPERATIVE|COOP|ORG|ORGANIZATION|BOSTON REDEVELOPMENT|BPDA)\b")
TRUST_PAT = re.compile(r"\b(TRUST|TRST|TR|TRS|TS|TRUSTEE|TRUSTEES|TRSTS|REALTY TRUST|NOMINEE TRUST|FAMILY TRUST|REVOCABLE|IRREVOCABLE|LIVING TRUST)\b")
ORG_WORDS = re.compile(r"\b(ASSOCS|ASSOCIATES|ASSOCIATION|BOSTON|BAY|PARK|VILLAGE|HOUSE|COURT|GARDENS|TOWERS?|HEIGHTS|SQUARE|SQ|UNITED|"
    r"COMMONS|PLACE|MANOR|ARMS|TERRACE|HALL|STREET|ST|AVENUE|AVE|ROAD|RD|HILL|DORCHESTER|ROXBURY|BRIGHTON|ALLSTON|SCHOOL|SECRETARY|"
    r"TENANTS|COMMUNITY|NEIGHBORHOOD|PROJECT|PORTFOLIO|OWNER|REDEVELOPER|COOP|CO OP|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|\d+)\b")
PUBLIC_PAT = re.compile(r"\b(BOSTON HOUSING AUTH|HOUSING AUTHORITY|CITY O[FB] BOSTON|COMMONWEALTH OF MASS|COMM OF MASS|BOSTON REDEV\w*|BOSTON REDVLP\w*|BOSTON REDEVLP\w*|BOSTON REDEVELP\w*|BPDA|UNITED STATES|"
    r"MASSACHUSETTS BAY TRANS|MBTA|MASS PORT|MASSPORT|PUBLIC FACILITIES)\b")
def owner_class(norm_name):
    if not norm_name: return "Unknown"
    if PUBLIC_PAT.search(norm_name): return "Public or quasi-public"
    if re.search(r"\b(CONDOMINIUM|CONDO)\b", norm_name) and TRUST_PAT.search(norm_name): return "Condo association or trust"
    if re.search(r"\b(LLC|INC|CORP|CORPORATION|LP|LPS|LLP|LTD|LIMITED PARTNERSHIP|LIM PTR|LTD PTR|LIMITED|INCORPORATED)\b", norm_name): return "Company (LLC, corporation, or partnership)"
    if TRUST_PAT.search(norm_name):
        if ENTITY_PAT.search(norm_name): return "Trust (named entity)"
        return "Trust (may be an individual or family)"
    if ENTITY_PAT.search(norm_name) or ORG_WORDS.search(norm_name): return "Other organization"
    return "Appears to be an individual"
def is_individualish(cls):
    return cls in ("Appears to be an individual", "Trust (may be an individual or family)")

# ---------- entity key (used for exclusion matching) ----------
_JUR = r"(?:\s+A)?\s+(?:MASS|MA|MASSACHUSETTS|DEL|DE|DELAWARE|NY|NH|RI|CT|ME|VT|FL|NJ)\s+(?:LLC|LP|LPS|LTD|INC|CORP|CORPORATION|LIMITED PARTNERSHIP|TRUST)$"
def entity_key(name):
    """Owner normalization plus suffix tolerance: drops a trailing jurisdiction tag ('MASS LLC', 'A MASS LLC', 'DEL LP') and
    unifies CORPORATION/INCORPORATED/COMPANY/LIMITED LIABILITY COMPANY spellings. Used for exclusion and case-file entity matching."""
    t = owner_norm(name)
    for _ in range(2): t = re.sub(_JUR, "", t)
    t = re.sub(r"\bLIMITED LIABILITY COMPANY\b", "LLC", t); t = re.sub(r"\bCORPORATION\b", "CORP", t)
    t = re.sub(r"\bINCORPORATED\b", "INC", t); t = re.sub(r"\bCOMPANY\b", "CO", t); t = re.sub(r"\bLIMITED PARTNERSHIP\b", "LP", t)
    t = re.sub(r"^THE\s+", "", t)
    return re.sub(r"\s+", " ", t).strip()
def mnorm(x):
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]", " ", str(x or "").upper())).strip()

# ---------- public / BHA, subsidized, nonprofit (heuristics documented on Method_and_Caveats) ----------
BHA_NAME_PAT = re.compile(r"\b(REVITALIZ\w*|REVITILIZ\w*|REVIT|MISSION MAIN|ORCHARD PARK|ORCHARD GARDENS|WASHINGTON BEECH|OLD COLONY PHASE|BC LENOX|HERITAGE HOUSING CORP)\b")
BHA_MAIL_KEYS = {("52 CHAUNCY ST", "02111")}
NONPROFIT_PAT = re.compile(r"\b(CDC|NDC|COMMUNITY DEVELOPMENT|NEIGHBORHOOD DEVELOPMENT|NEIGHBORHOOD HOUSING|HOUSING (CORP|CORPORATION|INC|PARTNERSHIP|PARTNERS|ASSOC\w*|DEVELOPMENT|COOP)|"
    r"AFFORDABLE|TENANTS|URBAN EDGE|UE|JPNDC|EBCDC|EBNT|DBEDC|NUESTRA|INQUILINOS|VIVIENDAS|IBA|CARITAS|HABITAT|ECUMENICAL|LAND TRUST|BNCLT|"
    r"CO OP|COOPERATIVE|MUTUAL HOUSING|ST JOSEPHS COMMUNITY|MADISON PARK|CODMAN SQUARE NEIGHBORHOOD|FIELDS CORNER|ASIAN COMMUNITY|"
    r"COMMUNITY BUILDERS|TCB|PLANNING OFFICE FOR URBAN AFFAIRS|POUA|HEARTH|ROGERSON|JCHE|NHPF|NATIONAL HOUSING PARTNERSHIP|"
    r"PRESERVATION OF AFFORDABLE|POAH|SENIOR HOUSING|ELDERLY HOUSING|SUPPORTIVE HOUSING)\b")
def nonprofit_name(*texts):
    return any(NONPROFIT_PAT.search(owner_norm(t)) for t in texts if isinstance(t, str) and t)

NUMWORD = {"ONE": "1", "TWO": "2", "THREE": "3", "FOUR": "4", "FIVE": "5", "SIX": "6", "SEVEN": "7", "EIGHT": "8", "NINE": "9", "TEN": "10"}
def mail_key(street, zip_):
    """Tax mailing address key used for LEAD clusters: suite, floor, unit and room tokens dropped; common spelling variants unified."""
    s = re.sub(r"[^A-Z0-9 ]", " ", str(street or "").upper())
    s = re.sub(r"\bP\s*O\s+BOX\b", "PO BOX", s)
    s = re.sub(r"\b(MARKETPLACE|MRKTPLC|MKTPLC|MKT PL|MARKET PL|MARKET PLACE|MRKT PL)\b", "MARKETPLACE", s)
    s = re.sub(r"\b(SUITE|STE|UNIT|APT|RM|ROOM|FL|FLR|FLOOR|BLDG)\s*[A-Z0-9]*\b", " ", s)
    s = re.sub(r"\b\d+(ST|ND|RD|TH)\s+(FL|FLR|FLOOR)\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    toks = s.split()
    if toks and toks[0] in NUMWORD: toks[0] = NUMWORD[toks[0]]
    if not s.startswith("PO BOX"):
        # keep number + street only (drop trailing unit numbers such as '126 JOHN ST 10')
        for i in range(len(toks) - 1, 0, -1):
            if toks[i] in SUFFIX or toks[i] == "MARKETPLACE":
                toks = toks[:i + 1]; break
    toks = [SUFFIX.get(t, t) if i == len(toks) - 1 else DIRS.get(t, t) for i, t in enumerate(toks)]
    return (" ".join(toks), zip5(zip_))

# ---------- ISD violation description classes ----------
ISD_PERMIT_ADMIN = {"failure to obtain permit", "failed to comply w permit term", "no use of premises permit:", "permits",
    "certificate of occupancy", "protection of adj. property", "suspension or revocation", "city of boston zoning code",
    "building or use of premise req", "failure to secure permit", "municipal bylaws or ordinances", "inspections", "right of entry",
    "working beyond hours", "zoning"}
def isd_class(desc):
    return "permit, use or administrative" if wnorm(desc) in ISD_PERMIT_ADMIN else "condition or safety"
