"""Read-only helpers for the Analyze Boston CKAN API (GET requests only)."""
import json, os, subprocess, time, urllib.parse, urllib.request

BASE = "https://data.boston.gov/api/3/action"
UA = "ratemyplace-data-dashboard/1.0 (read-only nightly pull)"


def get(url, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=600) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(5 * (i + 1))


def sql(q):
    d = json.loads(get(BASE + "/datastore_search_sql?" + urllib.parse.urlencode({"sql": q})))
    if not d.get("success"):
        raise RuntimeError(str(d.get("error"))[:300])
    return d["result"]["records"]


def sql_all(q, page=32000):
    """Page a SELECT with LIMIT/OFFSET (q must have a deterministic ORDER BY)."""
    out, off = [], 0
    while True:
        recs = sql(f"{q} LIMIT {page} OFFSET {off}")
        out.extend(recs)
        if len(recs) < page:
            return out
        off += page


def download(url, path, tries=4):
    """Stream a URL to a file through curl (follows the redirects the city uses), atomically."""
    tmp = path + ".part"
    for i in range(tries):
        r = subprocess.run(["curl", "-sS", "-L", "--fail", "-A", UA, "-o", tmp, url])
        if r.returncode == 0 and os.path.getsize(tmp) > 0:
            os.replace(tmp, path)
            return os.path.getsize(path)
        time.sleep(5 * (i + 1))
    raise RuntimeError("download failed: " + url.split("?")[0])


def dump(resource_id, path):
    return download(f"https://data.boston.gov/datastore/dump/{resource_id}?bom=false", path)


def resource_url(package, resource_id):
    pkg = json.loads(get(f"{BASE}/package_show?id={package}"))
    return [r for r in pkg["result"]["resources"] if r["id"] == resource_id][0]["url"]
