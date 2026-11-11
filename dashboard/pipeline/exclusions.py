"""Private exclusions. The list is never in the repo: it is read from the DASHBOARD_EXCLUSIONS_JSON
environment variable (a GitHub Actions secret at night) or from the file named by
DASHBOARD_EXCLUSIONS_FILE (local runs). With neither set the pipeline stops, so unfiltered data
can never be published by accident. Nothing in here prints, logs or counts what the list holds.
"""
import json, os, re
from rules import entity_key, mnorm, owner_norm, zip5


class Exclusions:
    def __init__(self, cfg):
        self.parcels = {str(x).zfill(10) for x in cfg.get("parcel_ids", [])}
        self.owner_keys = {entity_key(x) for x in cfg.get("owner_names_exact", [])}
        self.addressee = [re.compile(p, re.I) for p in cfg.get("addressee_patterns", [])]
        self.mail_anchors = [(mnorm(a["street_contains"]), zip5(a.get("zip"))) for a in cfg.get("mailing_anchors", [])]
        # the do-not-exclude note names a separate company, its PO box and street address
        note = str(cfg.get("do_not_exclude_note", ""))
        self.guard_name = owner_norm(note.split("(")[0]).replace(" INC", "").strip()
        self.guard_boxes = re.findall(r"PO Box (\d+)", note, re.I)
        self.guard_streets = [mnorm(s) for s in re.findall(r"\((\d+ [A-Za-z]+ St)", note)]
        # Optional: owner names that are published as "Owner name not shown". The building and its
        # records stay in every number; only the name is withheld.
        self.hide_patterns = [re.compile(p, re.I) for p in cfg.get("owner_name_hide_patterns", [])]
        if not (self.parcels or self.owner_keys or self.addressee or self.mail_anchors):
            raise SystemExit("exclusions: the list loaded but is empty; refusing to continue")

    def by_owner(self, *names):
        return any(entity_key(n) in self.owner_keys for n in names if isinstance(n, str) and n)

    def by_addressee(self, *texts):
        return any(p.search(str(t)) for t in texts if isinstance(t, str) and t for p in self.addressee)

    def by_mail(self, street, zip_):
        st, z = mnorm(street), zip5(zip_)
        return any(a and a in st and (not az or az == z) for a, az in self.mail_anchors)

    def hide_name(self, *names):
        return any(p.search(str(n)) for n in names if isinstance(n, str) and n for p in self.hide_patterns)

    def guard_mail(self, street):
        """True when a mailing street belongs to the protected company (its lots must stay in)."""
        s = str(street or "")
        return any(b in s.upper() for b in self.guard_boxes) or any(g in mnorm(s) for g in self.guard_streets)


def quiet_errors():
    """The nightly job's logs are public. An uncaught error prints where it happened, never the message,
    because a message can carry a row value such as an owner name."""
    import sys, traceback

    def hook(etype, value, tb):
        where = traceback.extract_tb(tb)[-1]
        name = where.filename.replace(chr(92), "/").split("/")[-1]
        print(f"pipeline error: {etype.__name__} at {name}:{where.lineno} (message withheld)", file=sys.stderr)

    if not os.environ.get("DASHBOARD_VERBOSE_ERRORS"):
        sys.excepthook = hook


def load():
    raw = os.environ.get("DASHBOARD_EXCLUSIONS_JSON")
    path = os.environ.get("DASHBOARD_EXCLUSIONS_FILE")
    if not raw and path:
        raw = open(path, encoding="utf-8").read()
    if not raw or not raw.strip():
        raise SystemExit("exclusions: set DASHBOARD_EXCLUSIONS_JSON or DASHBOARD_EXCLUSIONS_FILE; refusing to build without the list")
    try:
        cfg = json.loads(raw)
    except Exception:
        raise SystemExit("exclusions: the list is not valid JSON; refusing to continue") from None
    return Exclusions(cfg)
