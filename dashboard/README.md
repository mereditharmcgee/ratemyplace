# Data dashboard

A static page of City of Boston housing records (311 living-conditions complaints, State Sanitary
Code citations, building violations) by council district, neighborhood, ZIP code and owner of
record. It is a separate deployable from the main site: nothing in `src/` imports from here, and
the main site's TypeScript and Tailwind builds ignore this folder.

```
dashboard/
  pipeline/   Python. Pulls from Analyze Boston, applies the district method, writes JSON.
  web/        Vite + Preact + Leaflet. Loads the JSON. No server.
```

## How the numbers are made

`pipeline/rules.py` is the district method (v3, locked November 9, 2026): the 311 type lists, the
four issue groups, address and owner normalization, owner classes. The dashboard and the district
pages must agree, so a change to a rule there needs a re-run of `check_districts.py`.

| Step | File | What it does |
|------|------|--------------|
| 1 | `pull.py` | Read-only pulls into `pipeline/.cache/raw/` |
| 2 | `build.py` | Buildings, record matching, units, owners, v3 rules |
| 3 | `gate.py` | Stops the run if tonight's numbers drift too far from `benchmarks.json` |
| 4 | `export.py` | Writes `web/public/data/`, then scans it for private entries |

Run locally (Python 3.13 or newer):

```bash
cd dashboard/pipeline
python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt
export DASHBOARD_EXCLUSIONS_FILE=/path/to/the/private/list.json
.venv/Scripts/python pull.py && .venv/Scripts/python build.py && .venv/Scripts/python gate.py && .venv/Scripts/python export.py
cd ../web && npm ci && npm test && npm run build && npm run preview
```

## Private exclusions

A small private list of lots is left out of every output. It is never in this repo. The pipeline
reads it from `DASHBOARD_EXCLUSIONS_JSON` (a GitHub Actions secret at night) or from the file named
by `DASHBOARD_EXCLUSIONS_FILE`, and refuses to run without it. Nothing prints, logs or counts
what it holds, and `export.py` deletes its own output if an entry is found in it.

## Owner names: one setting

`OWNER_NAME_POLICY` in `pipeline/config.py`:

- `ordinance` (default): where an individual or a family trust owns and lives in a building of 6 or
  fewer units, the owner is published as "Individual owner". The name is dropped in `export.py`,
  so it never reaches a file the browser can load. Condo unit owners who live in their unit are
  not published. Everyone else is named exactly as the assessing record lists them.
- `all`: every owner of record is published by name.

Mailing addresses are never exported under either setting.

## The 311 switch on November 5, 2026

The city moved Inspectional Services housing requests from the legacy yearly 311 files to its new
311 system on November 5, 2026. `pull.py` reads both. `config.NEW_311_BUCKETS` maps the new service
names onto the method's buckets; a name that is not in the map is left out and counted in
`core.json` under `meta.unmappedNew311`, so a new name is noticed instead of guessed at.

## Nightly refresh and hosting

`.github/workflows/dashboard-nightly.yml` runs the four steps, the tests and the site build, then
deploys `web/dist` to Cloudflare as a static-assets Worker (`web/wrangler.jsonc`). A failed step
deploys nothing, so the site keeps the previous night's files and date. Scheduled workflows run
only from `main`. GitHub pauses schedules in a repository with no activity for 60 days.

There are two deploy targets. `npx wrangler deploy --env preview` updates
`ratemyplace-data-preview` on its unlisted `workers.dev` address. `npx wrangler deploy` updates
`ratemyplace-data`, which has no `workers.dev` address and is reachable only through a custom
domain attached in the Cloudflare dashboard. The nightly job deploys the preview target until the
repository variable `DASHBOARD_DEPLOY_TARGET` is set to `production`.

Every build is `noindex` unless `DASHBOARD_INDEXABLE=1`. `web/public/_headers` also sends
`X-Robots-Tag: noindex` on every `workers.dev` address.

## Adding a layer later

Records are keyed to the assessing lot (`GIS_ID`). A new layer (for example rental registration or
court enforcement cases) is one more pull in `pull.py`, one more match in `build.py` using
`match_addr` or the parcel maps, and one more array in `core.json` shaped like `citations`.

## Colors

The four issue colors (`web/src/data.ts`) were checked for color-vision deficiency across all
pairs on a white surface. Map dots carry a dark outline, and the table beside the map shows the
same buildings as text.
