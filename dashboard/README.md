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
pages use the same rules, so a change to a rule there needs a re-run of `check_districts.py`.

Every residential lot in the assessing file is included. The district pages were published from a
build that left out a small number of lots, so three citywide numbers differ slightly (see `pipeline/benchmarks.json`);
the nine district rates are the same.

| Step | File | What it does |
|------|------|--------------|
| 1 | `pull.py` | Read-only pulls into `pipeline/.cache/raw/` |
| 2 | `build.py` | Buildings, record matching, units, owners, v3 rules |
| 3 | `gate.py` | Stops the run if tonight's numbers drift too far from `benchmarks.json` |
| 4 | `export.py` | Writes `web/public/data/`, then checks that no hidden owner is listed by name |

Run locally (Python 3.13 or newer):

```bash
cd dashboard/pipeline
python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python pull.py && .venv/Scripts/python build.py && .venv/Scripts/python gate.py && .venv/Scripts/python export.py
cd ../web && npm ci && npm test && npm run build && npm run preview
```

## Owner names: one setting

`OWNER_NAME_POLICY` in `pipeline/config.py`:

- `ordinance` (default): where an individual or a family trust owns and lives in a building of 6 or
  fewer units, the owner is published as "Individual owner". The name is dropped in `export.py`,
  so it never reaches a file the browser can load. Condo unit owners who live in their unit are
  not published. Everyone else is named exactly as the assessing record lists them.
- `all`: every owner of record is published by name.

Mailing addresses are never exported under either setting.

## Order of the building table

The table opens ordered by an adjusted complaints-per-unit rate. The adjusted rate is not shown; the
table shows the raw complaint count and the raw complaints per unit, and any column can be chosen
as the order instead.

```
adjusted = (complaints + 5 x citywide rate) / (units + 5)
```

`complaints` is the building's count for the chosen dates and issues. `citywide rate` is complaints
per unit across every building in the dashboard for the same dates and issues (place filters do not
change it). The effect is that each building is treated as if it had 5 more units with an average
record: a two-family with one complaint moves most of the way to the citywide rate, and a 100-unit
building barely moves. The 5 comes from the data (how much buildings differ from each other beyond
chance gives about 5.4) and is fixed in `web/src/compute.ts` as `SHRINK_UNITS`. A building with no
unit count is placed at the citywide rate. Clicking a column header sorts by that column, and a
second click reverses it.

## Unit counts shown in the table

The table, the per-unit column and the default order use a unit count only where city records
support it (`units_shown` and `units_source` in `build.py`, `usrc` in `buildings.json`):

| Source | Rule |
|---|---|
| `class` | One, two or three family: the assessment class is the count. |
| `condo` | Condo lot: the number of residential condo unit records on the lot, when nothing else residential sits on it. |
| `address` | 4 to 6 family and apartment classes: the city address list's unit count, when it falls inside the range the class allows. |
| `none` | Everything else. No count is shown, no per-unit number, and the building is placed at the citywide rate. |

`none` covers mixed-use, subsidized and exempt classes (the assessment file has no unit field for
them, and the address list badly undercounts complexes), condo main records that hold a whole
apartment building as one unit, class midpoints, and lots with more than one residential record.
The district rates do not use this count. They keep the method's own `units` column, unchanged.

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
