# Item 4: odd assessor street suffixes (WY, HW, CI, PW, LA, RO, AL, CR), revision 2

Branch `fix/street-suffix-search` from `main` @ `1b8ca2b`.

Evidence lives in two scratch folders:
- **Revision 1 harnesses:** `C:/Users/mmcge/AppData/Local/Temp/claude/C--Users-mmcge-ratemyplace-boston/e4bed66b-7eb9-44e3-aa17-a1ef131b648b/scratchpad/plan-oct26/street-suffix/`. It holds `analyse.ts`, `rekey.ts`, `likeforms.ts`, `expect.ts`, their `*.out.txt` outputs and `identity.new.ts`.
- **Revision 2 harnesses:** `C:/Users/mmcge/AppData/Local/Temp/claude/C--Users-mmcge-ratemyplace-boston/e4bed66b-7eb9-44e3-aa17-a1ef131b648b/scratchpad/plan-oct26/suffix-rev/`. It holds `sim.mjs`, `table.mjs`, `lost.mjs`, `genuine.mjs` and `sqlcheck.mjs`.

Both sets ran against the 38,301 production `buildings` rows exported read-only on 2026-10-26. Production was re-checked read-only on the evening of 2026-10-26 (D1 `unixepoch()` = 1793067655).

## 0. What changed from revision 1

| Critique point | Resolution |
|---|---|
| **Re-key bundled with the optional respell** | The generator now writes separate files. `rekey.sql` and `rekey-rollback.sql` are always applied after deploy. `respell.sql` and `respell-rollback.sql` are applied only if the owner approves. `refresh.sql` and `refresh-cancel.sql` are needed either way. Post-checks are split the same way (§8). |
| **Rollback not durable; refresh not idempotent over time** | Each run writes to a new directory, `.cache/suffix-backfill/<target>-<d1 epoch>/`. The writer refuses an existing directory and opens every file with flag `wx`. A run that plans zero changes writes nothing. The directory also holds a `before.json` snapshot. §9 gives a last-resort rollback SQL. `refresh.sql` is now guarded by `NOT EXISTS` on a `record_pulls` row since `T_live`, so re-applying it after the first batch has drained is a no-op (prototyped in `sqlcheck.mjs`, tested in §6). |
| **Search precision understated** | Adopted whole-word matching, applied to **every** alternative spelling rather than only those of two characters or fewer. The typed term keeps its substring match. Evidence and the owner-facing numbers are in D3. |
| **No live validation before queueing refreshes** | `npm run records:check` now runs on the branch before merge. A production **pilot** using the admin "Pull records" button on three buildings, with exact pass criteria, must pass before `refresh.sql` (§8.2). |
| **QA incomplete** | Added a `/qa` run plus every view the data appears in: search API, the `/search` page with Load more, the building page, `/admin/buildings` and `/admin/records`. Profile and map are shown to be unaffected with two SELECTs (§7). |

Minor points:
- Section 9 is no longer contradictory: pending refresh rows are cancelled first.
- User rows keyed during the deploy window are now covered by the rollback.
- TDD cases are marked as new or as guards.
- The 53-row search limit is stated.
- The "transactional" claim is dropped.
- The production record goes in `migrations/AGENTS.md` as well.
- Battery Wharf is covered by the pilot.
- A note on the enrich adapter is added.
- CONFIRM B is widened: re-run 2026-10-26, it returns only the Neponset row.
- The twin decision is moved before deploy.

All six missing tests are added (§6: 1g, 1h, 7c, 9b–9e, 12d, 12e).

## 1. What is wrong, measured

**Production D1 (read-only, 2026-10-26)**
- `buildings` has 38,208 seed rows and 93 user rows.
- Exactly **375 seed rows** end in a street word that `SUFFIX_SPELLINGS` (`src/lib/records/identity.ts:16-34`) does not know. CONFIRM A was re-run tonight with the same result:

| Suffix | Rows | Distinct streets | Examples |
|---|---|---|---|
| HW | 128 | 3 | Cummins, American Legion, Truman |
| WY | 118 | 22 | Grampian 22, Msgr P J Lydon 52, Appian 4 |
| CI | 71 | 12 | Mamelon, Newcroft, Rockvale |
| PW | 36 | 6 | VFW 17, Neponset Valley 15, W Roxbury 1 |
| LA | 14 | 6 | Greenough, Radford |
| RO | 5 | 3 | Holden, Dexter, Nearen |
| AL | 2 | 2 | Bakers, Board |
| CR | 1 | 1 | Conry (Crescent) |

- Every one of the 375 ends in the title-cased abbreviation ("120 Grampian Wy"). None has a "(Rear)" tail.
- No production address contains any punctuation other than `-`.
- Widened CONFIRM B (keys ending in any non-first spelling of a new row, §8.3) returns exactly one row: `seed-1801494010`, "29 Neponset Field Lane", key `NEPONSET FIELD LN`.
- **User rows:** 14 have keys, all ST, AV or RD. 79 have a NULL `street_key`. The only Boston user row whose identity changes is `t6aaqyar342wrkhi`, "9 Appian Way", 02134:
  - Created 2026-10-07 by `src/pages/review/new.astro:93` (item 1's path).
  - No parcel, 0 reviews, 0 pulls.
  - A duplicate of `seed-2201144001`, "9-11 Appian Wy".
  - The other user rows ending in Way, Lane or Circle are outside Boston (Melville, New Haven, North Salt Lake, Tallahassee) and are not pulled.
- **Interest:** none of the 375 has a review (0) or a saved row (0). Profile and map, which are reviewed-only, cannot show them.
- **Queue:** pending is fill 780. Two affected buildings hold pending fill rows: `seed-0300470100` and `seed-0301075000`.
- **Out of scope**, because these are not suffixes: XT (CORNAUBA XT, SOLDIERS FIELD RD XT), CIRCUIT, GREEN, VALE, LAWN, BROADWAY. Adding XT would make "SOLDIERS FIELD RD" a base.

**Search on production today (GET `/api/search/results?q=…&type=buildings`)**

| Query | Total |
|---|---|
| grampian way | 0 |
| grampian wy | 22 |
| cummins highway | 0 |
| vfw parkway | 0 |
| radford lane | 0 |
| mamelon circle | 0 |
| holden row | 0 |
| conry crescent | 0 |
| appian way | 1 |
| lane | 245 |
| terrace | 2,113 |
| dorchester street | 277 |
| chestnut street | 144 |
| comm ave | 236 |
| beacon street | 177 |
| washington street | 676 |

**Stored records for the 375**

| Kind | Records | Buildings |
|---|---|---|
| assessment | 2,239 | 375 |
| permit | 1,135 | 249 |
| rentsmart | 2,513 | 253 |
| service_request | 4,838 | 189 |
| violation | **0** | 0 |
| enforcement_ticket | **0** | 0 |

**Pilot baselines (`building_records` by kind)**

| Building | Records today |
|---|---|
| `seed-1302598000` "72-74 Grampian Wy" | assessment 6, rentsmart 1. No 311, permit or enforcement. |
| `seed-1801494010` "29 Neponset Field Lane" | assessment 6, enforcement_ticket 1, permit 1, rentsmart 4, service_request 5 |
| `seed-0303041302` "2-5 Battery Wharf" | assessment 6, enforcement_ticket 4, service_request 4 |

**City dataset spellings** (from read-only CKAN GETs, revision 1):

| Dataset | Spellings used |
|---|---|
| Assessor | WY, HW, PW, CI, LA (LN once), RO, AL, CR |
| Permits `address` | `GRAMPIAN WY`, `CUMMINS HW`, `VFW PW`, `MAMELON CI`, `HOLDEN RO`, `CONRY CR`, `BOARD AL`; Lane as `RADFORD LN` |
| Violation and enforcement feeds | Bare street (`GRAMPIAN`) plus `violation_suffix` WY/HW/PW/CI/RO/AL/CR and LN. `violation_street = 'GRAMPIAN WY'` has 0 rows. |
| 311 new `street_name` | `GRAMPIAN WAY`, `CUMMINS HWY`, `VFW PKWY`, `ROCKVALE CIR`, `RADFORD LN`, `HOLDEN ROW`, `BAKERS ALY` |
| 311 legacy `location` | `GRAMPIAN WAY …`, `VFW PKWY …`, `MAMELON CIR …`, `RADFORD LN …`, `HOLDEN ROW …`, `CONRY CRES …` |

## 2. Design decisions

### D1. Add the spellings, with the assessor spelling first in each row
The first spelling is the key spelling.

```ts
const SUFFIX_SPELLINGS: ReadonlyArray<readonly string[]> = [
  ['AV', 'AVE', 'AVENUE'],
  ['ST', 'STREET'],
  ['RD', 'ROAD'],
  ['DR', 'DRIVE'],
  ['PL', 'PLACE'],
  ['TE', 'TER', 'TERR', 'TERRACE'],
  ['CT', 'COURT'],
  ['LA', 'LN', 'LANE'],          // assessor: GREENOUGH LA (one parcel NEPONSET FIELD LN); permits, violation feeds, 311: LN
  ['BLVD', 'BOULEVARD'],
  ['PW', 'PKWY', 'PARKWAY'],     // assessor, permits, violation feeds: VFW PW; 311: VFW PKWY
  ['HW', 'HWY', 'HIGHWAY'],      // assessor, permits, violation feeds: CUMMINS HW; 311: CUMMINS HWY
  ['SQ', 'SQUARE'],
  ['CI', 'CIR', 'CIRCLE'],       // assessor, permits, violation feeds: MAMELON CI; 311: MAMELON CIR
  ['PK', 'PARK'],                // assessor: UNION PK; 311: Union Park
  ['WHARF', 'WH', 'WHF'],        // assessor: ROWES WHARF; enforcement suffix: WH
  ['RO', 'ROW'],                 // assessor, permits, violation feeds: HOLDEN RO; 311: HOLDEN ROW
  ['WY', 'WAY'],                 // assessor, permits, violation feeds: GRAMPIAN WY; 311: GRAMPIAN WAY
  ['AL', 'ALY', 'ALLEY'],        // assessor, permits, violation feeds: BOARD AL; 311: BAKERS ALY
  ['CR', 'CRES', 'CRESCENT'],    // assessor, permits, enforcement: CONRY CR; legacy 311: CONRY CRES
];
```

Re-splitting all 38,222 stored keys and re-keying every address gives:
- **Exactly one key changes:** `NEPONSET FIELD LN` becomes `NEPONSET FIELD LA`.
- 374 of the 375 odd-suffix keys are unchanged. `GRAMPIAN WY` now splits as `GRAMPIAN` plus `WY` and keys identically.
- No key becomes null.
- No keyed user row changes.

Putting WAY first instead would re-key 118 rows, and LN first would re-key 14. Never change the first spelling of AV, ST, RD, DR, PL, TE, CT, BLVD, SQ, PK or WHARF: that would re-key thousands of rows. A pin test now guards this (test 1g).

### D2. Make `addressLikeClauses` try every street spelling (`src/lib/records/ckan.ts:39-43`)
Today the clauses are built from the short and long forms only. With D1 alone, "29 Neponset Field Lane" would lose `LN`, which is what permits store. PW streets would never try `PKWY`, and LA streets would never try `LN`.

The fix appends `<number form> <street form>` for every `identity.streetForms` entry that an existing pattern does not already cover by prefix.
- Clause lists stay byte-identical for 37,850 of 38,228 Boston rows.
- 378 lists change: the 375, Neponset Field (keeps LN), Battery Wharf (gains `WH`), and user row `t6aaqyar342wrkhi`.
- The longest encoded GET grows from 609 to 808 characters, which is safe.
- D1 must not ship without D2.

### D3. Search: derive from the table, and match alternatives as whole words (REVISED)
`OTHER_SPELLINGS` in `src/lib/searchQuery.ts` already derives from `SUFFIX_SPELLINGS`. After D1:
- "way" expands to `['way','wy']`.
- "lane" expands to `['lane','la','ln']`.
- "highway" expands to `['highway','hw','hwy']`.

Revision 1 kept every spelling a substring LIKE. The real cost of that, measured over all 38,301 production addresses, is not "small": 'lane' goes from 245 to 2,411, 'row' from 171 to 5,419 and 'alley' from 25 to 2,809.

**Change in `src/lib/searchSql.ts`:**
- The **typed** spelling of each term stays a substring match, exactly as today. So 'st' still finds "St James", 'comm' finds "Commonwealth", and 'way' finds "Broadway".
- **Every other spelling of its suffix row** matches only as a whole word. It is matched against `(' ' || REPLACE(REPLACE(b.address, ',', ' '), '.', ' ') || ' ')` with the pattern `% <spelling> %`.
- The bind count is unchanged: one pattern per alternative.

**Why all alternatives, not only those of two characters or fewer:**
- Three- and four-letter alternatives are noisy too: `cres` hits "Crest", `cir` hits "Circuit", `ter` hits "Water" and "Chester", `aly` hits "Italy".
- Under a two-character rule, 'crescent' gives 127 results against 57 under the all-alternatives rule. 'circle' gives 115 against 72, and 'terrace' 1,559 against 457.
- Nothing genuine is lost. `genuine.mjs` ran 1,600 queries: every suffix spelling alone, plus 31 street names times 50 spellings, each with and without the respell. That dropped 22,620 old-result rows, and **0** of them contained the searched suffix as a word.
- Production addresses contain no punctuation except `-`, which is why the REPLACE handles only `,` and `.`, for future user input.

**Address-column totals** (from `table.mjs`; the live API matched these within 1 because of the neighborhood and landlord fallback):

| Query | Today | Rev 1 (substring) | Rev 2, code only | Rev 2 + respell |
|---|---|---|---|---|
| grampian way | 0 | 22 | 22 | 22 |
| cummins highway | 0 | 82 | 82 | 82 |
| vfw parkway | 0 | 17 | 17 | 17 |
| radford lane | 0 | 4 | 4 | 4 |
| holden row | 0 | 3 | 3 | 3 |
| mamelon circle | 0 | 13 | 13 | 13 |
| board alley | 0 | 1 | 1 | 1 |
| conry crescent | 0 | 1 | 1 | 1 |
| appian way | 1 | 5 | 5 | 5 |
| lane | 244 | 2,411 | 39 | 39 |
| row | 171 | 5,419 | 176 | 176 |
| circle | 44 | 265 | 72 | 72 |
| highway | 0 | 159 | 128 | 128 |
| alley | 25 | 2,809 | 27 | 27 |
| crescent | 56 | 362 | 57 | 57 |
| way | 417 | 791 | 535 | 699* |
| oak lane | 0 | 40 | 0 | 0 |
| park lane | 66 | 95 | 16 | 16 |
| centre lane | 0 | 6 | 1 | 1 |
| terrace | 2,113 | 2,113 | 457 | 457 |
| dorchester street | 277 | 277 | 60 | 60 |
| chestnut street | 144 | 144 | 34 | 34 |
| comm ave | 236 | 236 | 236 | 236 |
| beacon street | 177 | 177 | 177 | 177 |
| washington street | 676 | 676 | 676 | 676 |

\* A typed 'way' is still a substring match, so after the respell it also finds "…Highway" and "…Parkway". "Broadway" and "Fenway" already behave this way.

The shrinking rows for existing suffixes are pure noise removal. For example, 'dorchester street' stops listing Dorchester **Avenue**, which matched only because "Dorchester" contains `st`.

`searchQuery.ts` logic is unchanged; only its doc comment changes. `search.astro`, `api/search/results.ts`, `MAX_TERMS` and the whole-query neighborhood and landlord fallback are unchanged. The parity test needs no change.

### D4. Respell the 375 display addresses to the natural spelling (optional, owner approval)
After D1, `formatSeedAddress` already writes "120 Grampian Way", because it uses the longest spelling. The seed upsert never rewrites `address` (`seed/sql.ts:66`), so without D4 stored rows keep "Wy" while a newly seeded parcel would read "Way".

Respelling only the last word reproduces `formatSeedAddress` for all 375, with 0 disagreements. `addressKey(respelled)` equals the stored key and range for all 375.
- **Slugs never change.**
- User rows are never rewritten.
- **Bump `updated_at` on respelled rows.** The H1 and `<title>` change, which is real content. **Do not bump** for the key-only change; D1 has no triggers.

D4 is now a separate file. If the owner declines it, search still works (D3 handles "Wy" with "way"), and records still improve (D1 + D2 + D5).

### D5. Re-pull the affected buildings, after a live pilot (REVISED)
The stored records were pulled with the broken identity. After the Worker runs the new code and the pilot passes (§8.2), enqueue one `refresh` row per **seed** id across the respell and re-key plans (376 ids). Each row is guarded so it is skipped when the building:
- already has a pending row (the partial unique index plus `INSERT OR IGNORE`), or
- has any `record_pulls` row with `retrieved_at >= T_live`. This covers pilot pulls, fill pulls under the new code, and a second apply after the batch drains.

Today that means 376 − 2 (pending fill) − 2 (pilot) = **372** rows. `PRIORITY.refresh` = 1 runs ahead of the fill (2), at about 60 an hour, so the batch takes about 6.2 hours.

Battery Wharf (`seed-0303041302`, the one other seed whose LIKE list changes) is not interesting to the refresh planner (`planRefresh` covers reviewed, saved or button buildings only). The pilot pulls it instead.

### D6. Dedupe: no code change
- `addressKey('9 Appian Way')` changes from `APPIAN WAY` (a miss) to `APPIAN WY`, so it hits `seed-2201144001`: range 9..11 is odd and contains 9, and the ZIP is 02134.
- `POST /api/buildings` (`src/pages/api/buildings.ts:264`) writes the new key for future user rows.
- `t6aaqyar342wrkhi` still wins tier 1 (place id) for its own place. That is the owner's or item 1's call, ideally made **before** deploy (§7 step 0).

## 3. Before and after for real rows (from `analyse.out.txt`)

`stripTrailingLocality` is unchanged and `isDegenerateStreet` is false in every row.

| Row | splitSuffix before → after | Key before → after | streetForms after | LIKE forms after (permits, legacy 311) | Violation feeds before → after |
|---|---|---|---|---|---|
| seed-2201144001 "9-11 Appian Wy" | `APPIAN WY`, null → `APPIAN`, [WY, WAY] | APPIAN WY = | APPIAN WY, APPIAN WAY | {9, 11, 9-11} × {WY, WAY} | street `APPIAN WY` (0 rows) → `APPIAN` + suffix IN (WY, WAY) |
| seed-1302537000 "9 Grampian Wy" | → `GRAMPIAN`, [WY, WAY] | GRAMPIAN WY = | +GRAMPIAN WAY | 9 GRAMPIAN WY, 9 GRAMPIAN WAY | → `GRAMPIAN` (WY, WAY) |
| seed-1404208000 "12 American Legion Hw" | → `AMERICAN LEGION`, [HW, HWY, HIGHWAY] | = | +HWY, +HIGHWAY | HW, HIGHWAY | → `AMERICAN LEGION` (HW, HWY, HIGHWAY) |
| seed-1904225000 "9 Cummins Hw" | → `CUMMINS` | CUMMINS HW = | +HWY, +HIGHWAY | HW, HIGHWAY | → `CUMMINS` (HW…) |
| seed-1800385001 "3 Mamelon Ci" | → `MAMELON`, [CI, CIR, CIRCLE] | = | +CIR, +CIRCLE | CI, CIRCLE | → `MAMELON` (CI…) |
| seed-2007173000 "530 Vfw Pw" | → `VFW`, [PW, PKWY, PARKWAY] | VFW PW = | +PKWY, +PARKWAY | PW, PARKWAY, **PKWY** (D2) | → `VFW` (PW…) |
| seed-1605329000 "11 Radford La" | → `RADFORD`, [LA, LN, LANE] | RADFORD LA = | +LN, +LANE | LA, LANE, **LN** (D2) | → `RADFORD` (LA, LN, LANE) |
| seed-0200636000 "2 Holden Ro" | → `HOLDEN`, [RO, ROW] | = | +ROW | RO, ROW | → `HOLDEN` (RO, ROW) |
| seed-0303292000 "11 Board Al" | → `BOARD`, [AL, ALY, ALLEY] | = | +ALY, +ALLEY | AL, ALLEY | → `BOARD` (AL…) |
| seed-1902294000 "10-12 Conry Cr" | → `CONRY`, [CR, CRES, CRESCENT] | = | +CRES, +CRESCENT | {10, 12, 10-12} × {CR, CRESCENT} | → `CONRY` (CR…) |
| seed-2005709000 "566 W Roxbury Pw" | → `W ROXBURY` | W ROXBURY PW = | +PKWY, +PARKWAY | PW, PARKWAY, PKWY | `ROXBURY PW` → `ROXBURY` (PW…) |
| seed-0501507000 "16 Cedar Lane Wy" | → `CEDAR LANE`, [WY, WAY] | = | +WAY | WY, WAY | → `CEDAR LANE` (WY, WAY) |
| seed-1801494010 "29 Neponset Field Lane" | [LN, LANE] → [LA, LN, LANE] | **NEPONSET FIELD LN → LA** | LA, LN, LANE | LA, LANE, LN (LN only via D2) | (LN, LANE) → (LA, LN, LANE) |
| user t6aaqyar342wrkhi "9 Appian Way" | [WAY] → [WY, WAY] | computed APPIAN WAY → **APPIAN WY** (stored NULL) | +APPIAN WY (parcel now resolves) | WY, WAY | (WAY) → (WY, WAY) |

After D4, the respelled rows ("9-11 Appian Way", "120 Grampian Way") have the same key, range, streetForms and LIKE forms as above.

**Superset check** over all 375 rows plus every Boston user row: old streetForms are a subset of the new ones; every old LIKE pattern is covered; every violation suffix list is a superset, or the old query had 0 rows. With D1 and D2 there are 0 failures. With D1 alone, Neponset Field loses LN. The critic re-verified this over all 38,228 Boston rows.

## 4. Effect per source module (`src/lib/records/sources/boston/`)

| Module | Matches on | Effect |
|---|---|---|
| `assessor.ts` (`addressPredicate`, about line 87) | Parcel for seed rows; `upper("ST_NAME") IN streetForms` only when resolving a parcel | Seed parcel path unchanged. User rows typed with "Way/Hwy/Pkwy/Cir/Lane/Row/Alley/Cres" now resolve. |
| `rentsmart.ts` | Parcel only | Unaffected |
| `permits.ts` | parcel_id OR zip-qualified `addressLikeClauses('address')` | A superset: gains the long forms, plus LN for LA streets, PKWY for PW streets and WH for Battery Wharf |
| `violations.ts`, `enforcement.ts` (via `violationFeeds.ts` `bareStreetName` and `suffixSpellings`) | Bare base + suffix IN spellings | Before: `violation_street='GRAMPIAN WY'`, 0 rows for all 375. After: base + full suffix row. Cummins HW alone has 2,367 enforcement rows citywide. |
| `serviceRequests.ts`, new system | `upper("street_name") IN streetForms` | Gains the USPS forms (WAY, HWY, PKWY, CIR, LN, ROW, ALY) |
| `serviceRequests.ts`, 16 legacy years | `addressLikeClauses('location')` | Before, prefixes rescued only HW→HWY, CI→CIR, RO→ROW and CR→CRES. After, all forms are matched. |

The Lanark fixture (RD) is unchanged, so `records:check` cannot exercise the new shapes; the pilot does. All interpolation still goes through `escapeLikeForCkan` and `sqlLiteral`.

## 5. Change set

### 5.1 `src/lib/records/identity.ts`
- **Lines 15-34:** replace the table with D1's. Update the doc comment to say:
  - The first spelling of a row is the key spelling and must stay the assessor's.
  - The table was verified 2026-09-07 and extended 2026-10 with WY/HW/PW/CI/LA/RO/AL/CR, with the per-dataset provenance from §1.
  - Changing a first spelling re-keys stored rows; run `npm run records:suffix-backfill`.
- Nothing else changes: `splitStreet`, `isDegenerateStreet`, `keyOf`, `buildIdentity`, `streetKey`, `addressKey` and `stripTrailingLocality`.
- `SUFFIX_SPELLINGS` stays exported via line 217.
- A street that is only a new spelling ("5 Wy", "5 Crescent") becomes degenerate. That is the existing intended rule, and no production key is affected.

### 5.2 `src/lib/records/ckan.ts` (lines 28-43)

```ts
export function addressLikeClauses(column: string, identity: BuildingIdentity): string[] {
  if (!/^[a-z_]+$/.test(column)) throw new Error(`Unsafe column name for LIKE clause: ${column}`);
  const forms = Array.from(new Set([...identity.addressFormsShort, ...identity.addressFormsLong]));
  // Every other spelling the street goes by: the feeds disagree (permits write RADFORD LN where the
  // assessor writes RADFORD LA; legacy 311 writes VFW PKWY). A form an earlier pattern already
  // prefixes (AVE behind AV, TER behind TE) adds nothing to LIKE 'x%' and is skipped, so a street
  // whose short form prefixes its other spellings queries exactly as before.
  const numberForms = identity.rangeForm ? [...identity.numbers, identity.rangeForm] : identity.numbers;
  for (const number of numberForms) {
    for (const street of identity.streetForms) {
      const form = `${number} ${street}`;
      if (!forms.some((covered) => form.startsWith(covered))) forms.push(form);
    }
  }
  return forms.map((f) => `upper("${column}") LIKE ${sqlLiteral(`${escapeLikeForCkan(f)}%`)} ESCAPE '!'`);
}
```

Update the docstring's first sentence to "…for every unique short and long address form on `identity`, then every other street spelling not already prefix-covered."

### 5.3 `src/lib/searchSql.ts` (lines 16-50) and `src/lib/searchQuery.ts` (doc only)

```ts
const LIKE = "LIKE ? ESCAPE '\\'";
/**
 * The address as space-delimited words, with a leading and trailing space and commas and
 * periods read as spaces. An alternative spelling is matched against this as `% <spelling> %`,
 * so it only ever hits a whole word: 'lane' finds "Radford La" but not the `la` in "Lanark"
 * or the `ln` in "Lincoln".
 */
const ADDRESS_WORDS = "(' ' || REPLACE(REPLACE(b.address, ',', ' '), '.', ' ') || ' ')";

function contains(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}

function wholeWord(value: string): string {
  return `% ${escapeLikePattern(value)} %`;
}

export function buildingSearchWhere(query: string): SqlFragment {
  const whole = contains(query.trim());
  const terms = normalizeSearchQuery(query);
  const binds: string[] = [];
  const clauses = terms.map(([typed, ...alternatives]) => {
    binds.push(contains(typed), ...alternatives.map(wholeWord));
    const ors = [`b.address ${LIKE}`, ...alternatives.map(() => `${ADDRESS_WORDS} ${LIKE}`)];
    return `(${ors.join(' OR ')})`;
  });
  // ...rest unchanged (empty-terms fallback, whole-query neighborhood/landlord binds)
}
```

- Update `buildingSearchWhere`'s docstring to say that the typed spelling matches anywhere in the address and every other spelling of its suffix row matches only as a whole word.
- In `searchQuery.ts:20-24`, add one sentence: index 0 is the typed spelling; `searchSql.ts` matches it as a substring and the rest as whole words.
- Nothing is user-controlled in the SQL text. Every value is bound, and `escapeLikePattern` still escapes `%`, `_` and `\`.

### 5.4 `src/lib/records/seed/format.ts:11`
Change `function titleWord` to `export function titleWord`. No logic change.

### 5.5 New file: `src/lib/records/seed/suffixBackfill.ts`
A pure module. It is used by the script and tests, and is reusable after any future table change.

```ts
import { addressKey, splitSuffix, streetKey } from '../identity';
import { PRIORITY } from '../queue';
import { titleWord } from './format';
import { lit } from './sql';

export interface KeyedBuildingRow { id: string; address: string; source: 'user' | 'seed'; street_key: string; st_num_lo: number | null; st_num_hi: number | null; updated_at: number }
export interface Change { id: string; source: 'user' | 'seed'; from: string; to: string }
export type RefusalReason = 'respell_changes_key' | 'lone_directional_base' | 'rekey_degenerate';
export interface Refusal { id: string; address: string; reason: RefusalReason }
export interface SuffixBackfillPlan { respells: Change[]; rekeys: Change[]; refused: Refusal[]; before: KeyedBuildingRow[] }
/** Statements per `wrangler d1 execute --file`: the seed's measured cliff (records-seed-boston.ts STATEMENTS_PER_FILE). */
export const MAX_STATEMENTS_PER_FILE = 999;

export function respelledSeedAddress(address: string): string | null;
export function planSuffixBackfill(rows: readonly KeyedBuildingRow[]): SuffixBackfillPlan;
export function refreshIds(plan: SuffixBackfillPlan): string[];
export function rekeyStatements(plan: SuffixBackfillPlan): string[];
export function rekeyRollbackStatements(plan: SuffixBackfillPlan): string[];
export function respellStatements(plan: SuffixBackfillPlan): string[];
export function respellRollbackStatements(plan: SuffixBackfillPlan): string[];
export function refreshStatements(plan: SuffixBackfillPlan, pulledSince: number): string[];
export function refreshCancelStatements(plan: SuffixBackfillPlan, pulledSince: number): string[];
export interface BackfillFileOptions { pulledSince: number | null; generatedAt: number; target: '--local' | '--remote'; dir: string }
export function backfillFiles(plan: SuffixBackfillPlan, options: BackfillFileOptions): Map<string, string>;
export interface RunDirFs {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: true }): unknown;
  writeFileSync(path: string, data: string, options: { flag: 'wx' }): void;
}
export function writeBackfillRun(dir: string, files: ReadonlyMap<string, string>, fs: RunDirFs): boolean;
```

**`respelledSeedAddress`** works as in revision 1:
- It keeps any `(…)` tail.
- It needs at least 3 words.
- It takes `splitSuffix` of the street part. If the last word is a known spelling other than its row's longest, it replaces that word with `titleWord(longest)`.
- Otherwise it returns null.

**`planSuffixBackfill`**, per row:
1. **Re-key.** Compute `next = streetKey(street_key)`, a pure re-split of the stored key. If `next` is null, refuse with `rekey_degenerate`; NULL is never written. If `next !== stored`, push the row to `rekeys`.
2. **Respell.** Only when `source === 'seed'` and `respelledSeedAddress` is non-null:
   - If the new base matches `/^[NSEW]$/`, refuse with `lone_directional_base`.
   - Otherwise require `addressKey(respelled)` to equal `{(rekeyed ?? stored) key, st_num_lo, st_num_hi}`. If it does not, refuse with `respell_changes_key`.
   - Otherwise push the row to `respells`.
3. `before` collects every row that appears in `respells`, `rekeys` or `refused`.

**`refreshIds`** returns the distinct, sorted **seed** ids across `respells` and `rekeys`. It is independent of whether `respell.sql` is applied.

Statements. Every value goes through `lit()`, and every statement is guarded, so re-applying is a no-op:
- **rekey:**
  `UPDATE buildings SET street_key = <to> WHERE id = <id> AND street_key = <from>;`
- **rekey rollback:** the same statement with `<from>` and `<to>` swapped.
- **respell:**
  `UPDATE buildings SET address = <to>, updated_at = unixepoch() WHERE id = <id> AND source = 'seed' AND address = <from>;`
- **respell rollback:** the inverse, also bumping `updated_at`, because the content changes back.
- **refresh:**
  `INSERT OR IGNORE INTO records_queue (building_id, reason, priority, requested_at) SELECT <id>, 'refresh', ${PRIORITY.refresh}, unixepoch() WHERE EXISTS (SELECT 1 FROM buildings WHERE id = <id>) AND NOT EXISTS (SELECT 1 FROM record_pulls WHERE building_id = <id> AND retrieved_at >= <pulledSince>);`
  This shape was prototyped in SQLite (`sqlcheck.mjs`). A pending fill row is ignored, a missing building is skipped, and a second apply after the pulls land inserts nothing.
- **refresh cancel:**
  `UPDATE records_queue SET done_at = unixepoch() WHERE building_id = <id> AND reason = 'refresh' AND done_at IS NULL AND requested_at >= <pulledSince>;`

**`backfillFiles`** returns a Map of file name to content (statements joined by `\n`, trailing newline):
- `rekey.sql` and `rekey-rollback.sql` only if there are re-keys.
- `respell.sql` and `respell-rollback.sql` only if there are respells.
- `refresh.sql` and `refresh-cancel.sql` only if `pulledSince !== null` and `refreshIds` is non-empty.
- If anything above was produced, also `before.json` (`plan.before`, pretty JSON) and `summary.txt`. The summary holds the target, `generatedAt`, `pulledSince`, counts by new word, every re-key, every refusal, and the exact `wrangler d1 execute <target> --file <dir>/<file>` commands.
- A plan with no changes returns an **empty map**.
- It throws if any SQL file exceeds `MAX_STATEMENTS_PER_FILE`.
- SQL files carry no comments; the metadata lives in `summary.txt`.

**`writeBackfillRun`**:
- Returns `false` and touches nothing if `files.size === 0`.
- Throws `refusing to overwrite existing run directory <dir>` if `fs.existsSync(dir)`.
- Otherwise it runs `mkdirSync(dir, { recursive: true })` and writes each file as `${dir}/${name}` with `{ flag: 'wx' }` (which also fails rather than overwrites if a file appears). It then returns `true`.
- The fs is injected, so `src/lib` imports no `node:` module, and the test uses a fake.

### 5.6 New file: `scripts/lib/wranglerD1.ts`, plus a move-only edit to `scripts/records-seed-boston.ts`
- Move `shellArg`, `parseWranglerJson`, `foldNullStrings` and `wranglerJson` **verbatim**, doc comments included, from `records-seed-boston.ts:101-144` into the new file. Export them, plus `export const D1_DATABASE = 'ratemyplace-db';`. `wranglerJson` uses `D1_DATABASE`.
- In `records-seed-boston.ts`:
  - Line 75 becomes `const DB_NAME = D1_DATABASE;`.
  - Add `import { D1_DATABASE, shellArg, wranglerJson } from './lib/wranglerD1';`.
  - Keep the `execFileSync` import, which line 313 still uses.
  - Call sites 263, 269, 313 and 318 are unchanged.
- One copy of the AGENTS-required `"null"` folding instead of two.

### 5.7 New file: `scripts/records-suffix-backfill.ts`, plus `package.json:24`
Add `"records:suffix-backfill": "npx tsx scripts/records-suffix-backfill.ts"` after `records:seed`.

Flags:
- The target is `--local` (default) or `--remote`.
- `--pulled-since <10-digit epoch>` is optional. It must be no later than the D1 `now`; the script throws on a malformed or future value. Without it, the summary says `refresh.sql not written: pass --pulled-since <T_live>`.

Flow:
1. `now` comes from `wranglerJson([target, '--command', 'SELECT unixepoch() AS now'])`.
2. The rows come from `SELECT id, address, source, street_key, st_num_lo, st_num_hi, updated_at FROM buildings WHERE street_key IS NOT NULL`.
3. Plan the backfill. Set `dir = .cache/suffix-backfill/<local|remote>-<now>`.
4. Call `backfillFiles` and print `summary.txt` to the console.
5. Call `writeBackfillRun(dir, files, { existsSync, mkdirSync, writeFileSync })`. If it returns false, print `Nothing to change; no files written.`

It **never applies anything**. This is a data step, not a migration, so nothing goes into `migrations/`. `.cache/` is gitignored (`.gitignore:7`).

Expected output against production today, with `--pulled-since`:
- Respell 375 (Highway 128, Way 118, Circle 71, Parkway 36, Lane 14, Row 5, Alley 2, Crescent 1).
- Re-key 1, refused 0, refresh ids 376.
- Statement counts: `rekey.sql` 1, `respell.sql` 375, `refresh.sql` 376, and the same for their rollback and cancel files.

### 5.8 Docs
**Root `AGENTS.md:339-346`, the search bullet.** Add: "The typed spelling of each term matches anywhere in the address; every other spelling of its suffix row matches only as a whole word (`ADDRESS_WORDS` in `searchSql.ts`)."

**`src/lib/AGENTS.md:225-231`, the `addressKey`/`streetKey` bullet.** Add:
- The first spelling of each row is the key spelling and must stay the assessor's; `recordsAddressKey.test.ts` pins it.
- The October 2026 additions put WY/HW/PW/CI/LA/RO/AL/CR ahead of WAY/HWY/PKWY/CIR/LN/ROW.
- After any table change, run `npm run records:suffix-backfill -- --remote --pulled-since <T_live>` and apply its files by hand, in the order in its `summary.txt`.

**`src/lib/AGENTS.md`, the `identity.ts` bullet (around line 214).** Note that `addressLikeClauses` tries every street spelling not already prefix-covered.

**Follow-up docs PR after the production apply.** Record in **`migrations/AGENTS.md`**, next to the 2026-09-09 seed record, and in `src/lib/AGENTS.md`:

> SUFFIX BACKFILL APPLIED TO PRODUCTION <date>: run dir `.cache/suffix-backfill/remote-<epoch>` on <machine>; rekey 1, respell N (or "declined"), refresh M; T_live=<epoch>.

## 6. Tests, written first (TDD)

**[new]** fails on `main` today; **[guard]** passes today and must keep passing.

1. **`src/lib/__tests__/recordsAddressKey.test.ts`**
   - a. [new] `splitSuffix('Grampian Way')` → `{base:'GRAMPIAN', spellings:['WY','WAY']}`, and `splitSuffix('Cedar Lane Wy').base` → `CEDAR LANE`.
   - b. `streetKey` gives one key per street:

     | Input | Key | Status |
     |---|---|---|
     | Grampian Way | `GRAMPIAN WY` | [new] |
     | Grampian Wy | `GRAMPIAN WY` | [guard] |
     | Cummins Highway / Hwy | `CUMMINS HW` | [new] |
     | VFW Parkway / Pkwy | `VFW PW` | [new] |
     | Mamelon Circle / Cir | `MAMELON CI` | [new] |
     | Radford Lane / Ln | `RADFORD LA` | [new] |
     | Holden Row | `HOLDEN RO` | [new] |
     | Bakers Alley / Aly | `BAKERS AL` | [new] |
     | Conry Crescent / Cres | `CONRY CR` | [new] |

   - c. [guard] `streetKey('GRAMPIAN WY')` → `GRAMPIAN WY`. [new] `streetKey('NEPONSET FIELD LN')` → `NEPONSET FIELD LA`.
   - d. Degenerate streets return null. [guard] `streetKey('Way')`. [new] `streetKey('Wy')`, `'Crescent'`, `'Alley'`, `'La'` and `addressKey('5 Wy')`.
   - e. addressKey:
     - [new] `addressKey('9 Appian Way')` → `{APPIAN WY, 9, 9}`.
     - [guard] `addressKey('9-11 Appian Wy')` → `{APPIAN WY, 9, 11}`.
     - [new] `addressKey('9 Appian Way Allston MA 02134')` → `APPIAN WY`.
     - [new] `addressKey('1 Greenough Ln')` → `GREENOUGH LA`.
   - f. (removed in favour of g)
   - g. [new] **Pin the key spellings:** `expect(SUFFIX_SPELLINGS.map((r) => r[0])).toEqual(['AV','ST','RD','DR','PL','TE','CT','LA','BLVD','PW','HW','SQ','CI','PK','WHARF','RO','WY','AL','CR'])`. The message says to change it only together with a `records:suffix-backfill` run.
   - h. [guard] **No spelling in two rows:** `const all = SUFFIX_SPELLINGS.flat(); expect(new Set(all).size).toBe(all.length)`. `SUFFIX_ROW_BY_SPELLING` is a Map, so a duplicate would silently let the later row win.
2. **`src/lib/__tests__/recordsIdentity.test.ts`**
   - [new] A table test over the 8 addresses in §3 asserting `streetBase`, `streetShort` (`<base> <assessor>`), `streetLong` and `streetForms` (the full row).
   - [new] "9 Grampian Way" has the same street fields as "9 Grampian Wy".
   - [new] "566 W Roxbury Pw" has base `W ROXBURY`.
   - [new] `buildIdentity('5 Wy')` throws "Degenerate".
3. **`src/lib/__tests__/recordsSeedFormat.test.ts`**
   - [new] `formatSeedAddress`:

     | Input | Output |
     |---|---|
     | ('120', null, 'GRAMPIAN WY') | '120 Grampian Way' |
     | ('9', null, 'CUMMINS HW') | '9 Cummins Highway' |
     | ('3', null, 'MAMELON CI') | '3 Mamelon Circle' |
     | ('50', null, 'NEPONSET VALLEY PW') | '50 Neponset Valley Parkway' |
     | ('11', null, 'RADFORD LA') | '11 Radford Lane' |
     | ('2', null, 'HOLDEN RO') | '2 Holden Row' |
     | ('11', null, 'BOARD AL') | '11 Board Alley' |
     | ('10', '12', 'CONRY CR') | '10-12 Conry Crescent' |
     | ('16', null, 'CEDAR LANE WY') | '16 Cedar Lane Way' |

   - [guard] `('29', null, 'NEPONSET FIELD LN')` → '29 Neponset Field Lane'.
   - [guard] `addressKey(formatSeedAddress('9','11','APPIAN WY'))` → `{APPIAN WY, 9, 11}`. This holds before and after.
4. **`src/lib/__tests__/recordsCkan.test.ts`** (real `buildIdentity`)
   - [new] `530 VFW Pw` → exactly `530 VFW PW%`, `530 VFW PARKWAY%`, `530 VFW PKWY%`.
   - [new] `11 Radford La` → LA, LANE, LN.
   - [new] `10 Battery Wharf` → WHARF, WH.
   - [guard] `1027 Commonwealth Ave` → exactly 2 clauses (AV, AVENUE); `12 Main Ter` → TE, TERRACE; `23-27 Lanark Rd` → the same 6 as today.
   - [new] Property test: for every row and spelling in `SUFFIX_SPELLINGS`, `buildIdentity('5-7 Test <spelling>')` must have a clause literal prefixing every `{5, 7, 5-7} × streetForms` form. Today it fails on WHARF/WH.
5. **`src/lib/__tests__/recordsPermits.test.ts`**
   - '9 Grampian Wy' (zip 02125, parcel 1302537000): `result.query` contains `LIKE '9 GRAMPIAN WY%'` [guard] and `LIKE '9 GRAMPIAN WAY%'` [new].
   - [new] '11 Radford La' contains `LIKE '11 RADFORD LN%'`.
6. **`src/lib/__tests__/recordsServiceRequests.test.ts`**
   - [new] '9 Grampian Wy': the new-system SQL contains `upper("street_name") IN ('GRAMPIAN WY','GRAMPIAN WAY')`, and the legacy SQL contains `LIKE '9 GRAMPIAN WAY%'`.
   - [new] '530 VFW Pw' legacy contains `LIKE '530 VFW PKWY%'`.
7. **`src/lib/__tests__/recordsViolations.test.ts`**
   - a. [new] '9 Grampian Wy': `bareStreetName` → `GRAMPIAN` and `suffixSpellings` → `['WY','WAY']`. The run query contains `upper("violation_street") = 'GRAMPIAN'` and `upper("violation_suffix") IN ('WY','WAY')`.
   - b. [new] '11 Radford La' → `['LA','LN','LANE']`.
   - c. [new] **Directional plus new suffix:** '566 W Roxbury Pw' → `bareStreetName` = `ROXBURY` (today `ROXBURY PW`) and `suffixSpellings` = `['PW','PKWY','PARKWAY']`. The enforcement query contains `= 'ROXBURY'` and `IN ('PW','PKWY','PARKWAY')`.
8. **`src/lib/__tests__/recordsSearchQuery.test.ts`** (all [new])
   - 'grampian way' → `[['grampian'],['way','wy']]`; 'grampian wy' → `[['grampian'],['wy','way']]`.
   - 'cummins highway' → `[['cummins'],['highway','hw','hwy']]`.
   - 'radford lane' → `[['radford'],['lane','la','ln']]`.
   - 'conry crescent' → `[['conry'],['crescent','cr','cres']]`.
   - The existing row-coverage guardrail at line 40 covers the new rows automatically.
9. **`src/lib/__tests__/recordsSearchSql.test.ts`** (node:sqlite double)
   - a. [new] Insert '120 Grampian Wy' (a), '121 Grampian Way' (b) and '5 Grampian St' (c). 'grampian way' and 'grampian wy' both return [a, b], not c. '9 Cummins Hw' is found by 'cummins highway' and by 'cummins hwy'.
   - b. [new] **Breadth pin.** Insert '12 Oakland Street', '4 Centre Lane' (l1), '6 Centre La' (l2), '8 Centre Place' and '10 Lincoln Street'. Then:
     - 'oak lane' → [].
     - 'centre lane' → [l1, l2], with no Centre Place.
     - 'lane' → [l1, l2], with no Lincoln.
   - c. [new] **Existing suffixes narrow.** Insert '5 Dorchester Avenue', '7 Dorchester Street' and '9 Dorchester St'. 'dorchester street' → the Street and St rows only.
   - d. [new] **Punctuation.** User rows '14 Centre Ln.' and '3 Main St, Boston' are found by 'centre lane' and 'main street'.
   - e. [new] **Exact binds:** `buildingSearchWhere('radford lane').binds` equals `['%radford%','%lane%','% la %','% ln %','%radford lane%','%radford lane%']`. That is the same count as today; only the shape of the last two alternatives changes.
   - f. [guard] Existing cases still pass: 'comm ave' finds Avenue and Ave; ordering; `has_records`; the neighborhood and landlord fallback; and "escapes LIKE wildcards in every bind" (`% la %` starts and ends with `%`). Add [guard] '1 St James Avenue' found by 'st james' (the typed term stays a substring).
10. **`src/lib/__tests__/recordsDedupe.test.ts`**
    - [new] Seed '9-11 Appian Wy' (key APPIAN WY, 9..11, zip 02134). Input '9 Appian Way' finds it with city 'Boston', with city 'Allston', and when the stored address is '9-11 Appian Way'.
    - [new] Seed key 'GREENOUGH LA' 1..1 is found by '1 Greenough Lane' and by '1 Greenough Ln'.
    - [new] Seed key 'NEPONSET FIELD LA' is found by '29 Neponset Field Lane'. The same row with the stale key 'NEPONSET FIELD LN' gives **null**, which documents why `rekey.sql` is mandatory.
11. **`src/lib/__tests__/recordsBuildingsRoute.test.ts`**
    - [new] Insert 'seed-appian' as '9-11 Appian Wy'. Then POST `{streetAddress:'9 Appian Way', city:'Allston', state:'MA', zipCode:'02134'}` with no placeId.
    - Expect 200 and `{building:{id:'seed-appian', slug:…}, created:false}`, with no new row.
12. **New file: `src/lib/__tests__/recordsSuffixBackfill.test.ts`** (all [new])
    - a. **`respelledSeedAddress`:**
      - '120 Grampian Wy' → '120 Grampian Way'.
      - '9-11 Appian Wy' → '…Way'; '12 American Legion Hw' → '…Highway'; '16 Cedar Lane Wy' → '16 Cedar Lane Way'; '566 W Roxbury Pw' → '…Parkway'; '10-12 Conry Cr' → '…Crescent'.
      - '120A Grampian Wy' → '120A Grampian Way'; '5 Grampian Wy (Rear)' → '5 Grampian Way (Rear)'.
      - null for '23-27 Lanark Road', '29 Neponset Field Lane', '10 W Broadway', '12 Lanark Road (Rear)' and '5 Park Street'.
      - It agrees with `formatSeedAddress(lo, hi, ST_NAME)` for all eight spellings.
    - b. **`planSuffixBackfill`:**
      - A seed Grampian row is respelled, not re-keyed.
      - A seed Neponset row (key LN) is re-keyed to LA, not respelled.
      - A user row '9 Appian Wy' is never respelled; a user row keyed 'APPIAN WAY' is re-keyed to 'APPIAN WY'.
      - '7 N Wy' / 'N WY' is refused with `lone_directional_base`.
      - '5 Grampian Wy (Rear)' / 'GRAMPIAN WY (REAR)' is refused with `respell_changes_key`.
      - '9-11 Appian Wy' with `st_num_hi` 13 is refused with `respell_changes_key`.
      - Key 'WY' is refused with `rekey_degenerate` and never emitted as NULL.
      - `before` holds exactly the touched rows.
      - `refreshIds` holds seed ids only, from both lists, deduped and sorted.
    - c. **Statement strings:**
      - One exact respell, re-key, refresh and cancel statement.
      - A seed "5 O'Brien Wy" / "O'BRIEN WY" quotes as `'5 O''Brien Way'`.
      - Each rollback is the exact inverse.
      - Refresh carries `'refresh', 1,` and the `retrieved_at >= <pulledSince>` guard.
    - d. **Generator output** (`backfillFiles` and `writeBackfillRun`):
      - A plan with 1 re-key and 2 respells, with `pulledSince`, gives exactly the keys `before.json`, `refresh-cancel.sql`, `refresh.sql`, `rekey-rollback.sql`, `rekey.sql`, `respell-rollback.sql`, `respell.sql`, `summary.txt`.
      - With `pulledSince: null`, there are no refresh files.
      - A re-key-only plan has no respell files.
      - A zero-change plan gives an **empty map**, and `writeBackfillRun` returns false without calling `mkdirSync`.
      - A plan with 1,000 respells throws.
      - With a fake fs whose `existsSync` returns true, `writeBackfillRun` throws `/refusing to overwrite/` and writes nothing.
      - Every write uses `{ flag: 'wx' }`.
    - e. **Integration on `createRecordsTestDb()`:**
      1. Insert seeds:
         - 'seed-g' '120 Grampian Wy' (key GRAMPIAN WY, `updated_at` 1).
         - 'seed-n' '29 Neponset Field Lane' (key NEPONSET FIELD LN, `updated_at` 1).
         - 'seed-a' '9-11 Appian Wy', with a pending `fill` row.
         - 'seed-p' '72-74 Grampian Wy', with an `insertPull` (the pilot case).
         - 'seed-o' '3 Mamelon Ci', with an `insertPull` then `UPDATE record_pulls SET retrieved_at = 500` (pulled before the cutoff).

         Also insert user 'u1' '9 Appian Way' with key APPIAN WAY.
      2. Run `rekey.sql`. Keys change for seed-n and u1, and their `updated_at` is unchanged.
      3. Run `respell.sql`. Addresses change for the four seeds, `updated_at` > 1, slugs are untouched, and u1's address is untouched.
      4. Re-run both files. The total `meta.changes` is 0.
      5. Run `refresh.sql` with `pulledSince` = 1000. Pending refresh rows exist for seed-g, seed-n and seed-o. There is none for seed-a (pending fill), seed-p (pulled since the cutoff) or u1.
      6. Mark those refresh rows done and `insertPull` for each. Re-run `refresh.sql`: **0 new rows**. This is the re-apply-after-drain case.
      7. Re-enqueue seed-g by hand, then run `refresh-cancel.sql`: its row gets a `done_at`.
      8. Run `respell-rollback.sql` then `rekey-rollback.sql`. The original addresses and keys are restored.
13. [guard] `recordsSearchParity.test.ts` needs no change and must pass.

**Run order**
1. Write tests 1–12 and confirm that exactly the [new] cases fail.
2. Apply 5.1. Tests 1–3, 5 (WAY), 6 (Grampian), 7, 8, 10 and 11 pass.
3. Apply 5.2. Tests 4, 5 (LN) and 6 (PKWY) pass.
4. Apply 5.3. Test 9 passes.
5. Apply 5.4–5.7. Test 12 passes.
6. Run `npm run check` (0 errors; `scripts/` is in the tsconfig include), then `npm test`, then `npm run build`.

## 7. Order of work, deploy and QA

0. **Before merge:** the owner decides `t6aaqyar342wrkhi` (owner input 5). Once this deploys, a reader's "request records" on that page resolves parcel 2201144001 onto the user row, creating a parcel twin.
1. Branch, then TDD (§6), then docs (5.8). Stage files explicitly. **Never `git add -A`**: `src/pages/api/admin/verification/[id] (1).ts`, `.agents/` and `ops/content/instagram/` are untracked strays, and Astro would route the first one.
2. **On the branch:**
   - `npm run records:check`. It runs live and read-only against data.boston.gov; every check must pass. ckan.ts is shared adapter code.
   - `npm run records:suffix-backfill -- --remote` as a read-only dry run. The summary must read 375 / 1 / 0, and it says refresh.sql was not written. Inspect `respell.sql`.
   - Record pre-deploy timings: `curl -s -o /dev/null -w '%{time_total}\n' "https://ratemyplace.org/api/search/results?q=terrace&type=buildings&limit=10"`, and the same for `cummins%20highway`.
3. **Open the PR.** CI runs check, test, build and the audit gate.
   - The preview cannot exercise Turnstile or the map (AGENTS); neither is touched here.
   - The preview appears to share the production D1 (one `DB` binding), so make **read-only** GETs only:
     - `<preview>/api/search/results?q=grampian%20way&type=buildings&limit=50` gives total 22.
     - `q=dorchester%20street` gives about 60.
4. Merge. Pages deploys.
5. **`npm run records:worker:deploy`.** The Worker imports `pull.ts`, which imports `identity.ts` and `ckan.ts`. Confirm invocations resume within about 15 minutes, per `docs/runbooks/records-scheduler.md`. Then record **T_live** (§8.1).
6. **Production search checks.** These depend on code only; the respell is not needed. All are GETs on `https://ratemyplace.org/api/search/results?…&type=buildings&limit=50`:

   | Query | Expected total |
   |---|---|
   | grampian way | 22 |
   | grampian wy | 22 |
   | cummins highway | 82 |
   | vfw parkway | 17 |
   | radford lane | 4 |
   | mamelon circle | 13 |
   | holden row | 3 |
   | conry crescent | 1 |
   | appian way | 5 |
   | dorchester street | about 60 (was 277) |
   | lane | about 40 (was 245) |
   | terrace | about 457 (was 2,113) |
   | comm ave | **236, unchanged** |
   | beacon street | **177, unchanged** |
   | washington street | **676, unchanged** |

   Repeat the step-2 timings and expect the same order of magnitude.
7. **Pilot (§8.2)**, then the data steps §8.3–§8.7.
8. **QA:** run `/qa` (or the AGENTS checklist by hand) against production after §8.6, or after §8.5 if the respell is declined. Cover every view the data appears in:
   - **Search results:**
     - `/search?q=cummins+highway` shows a count equal to the API total of 82.
     - "Load more" reaches all 82 with no duplicates, and sorting is by address.
     - `/search?q=grampian+way` lists the "Grampian Way" rows (or "Wy" if declined).
     - Empty state for `q=zzzz`.
     - A one-letter query still behaves as today.
   - **Property detail:**
     - `/building/120-grampian-wy-boston`: `<title>` is "120 Grampian Way, Boston | RateMyPlace", the H1 matches, and the records panel renders.
     - `/building/294-296-neponset-valley-pw-boston` is the longest respelled address ("294-296 Neponset Valley Parkway"). Check its layout at 375, 768 and 1280px, with no overflow and no `undefined`, `null` or `NaN`.
   - **Admin panel:**
     - `/admin/buildings?q=Grampian` shows the "Grampian Way" rows.
     - `/admin/records` queue view shows the refresh rows after §8.7.
   - **User profile and map:** not affected. Re-run the two §1 SELECTs (reviews and saved rows joined to the affected buildings); both must still be 0.
   - **Sitemap:** the chunk containing `120-grampian-wy-boston` shows the apply date as `lastmod` within about an hour (edge cache).
9. About 7 hours later, run post-step R (§8.8).
10. Follow-up docs PR recording the apply (5.8).

## 8. Production data steps (by hand, after §7 steps 4–6)
Every command is `npx wrangler d1 execute ratemyplace-db --remote …`. Each statement in the generated files is guarded by its old value, so a partial or repeated apply is safe. Do not rely on a `--file` apply being one transaction.

### 8.1 T_live
After the Worker deploy is confirmed:

```sql
SELECT unixepoch() AS t_live
```

Record the value.

### 8.2 Pilot
Owner, as admin on production:
1. Open `/admin/buildings`, search `72-74 Grampian`, expand the row and press **Pull records**.
2. Repeat for `29 Neponset Field` and `2-5 Battery Wharf`. The rate limit is one per building per 120 s. Each press is audited as `records_pulled`.

**Pass criteria:**
- Every source line reads `ok` or `empty`, with no `error`.
- This query returns no `status = 'error'` rows:

  ```sql
  SELECT building_id, source_label, status, row_count FROM record_pulls WHERE building_id IN ('seed-1302598000','seed-1801494010','seed-0303041302') AND retrieved_at >= <T_live> ORDER BY building_id, source_label
  ```

- This query shows `enforcement_ticket` at least 1 for `seed-1302598000` (0 today), and every other kind at or above the §1 baselines:

  ```sql
  SELECT building_id, kind, COUNT(*) AS n FROM building_records WHERE building_id IN ('seed-1302598000','seed-1801494010','seed-0303041302') GROUP BY building_id, kind
  ```

**If any check fails, STOP.** Do not run 8.7. Investigate, and roll back code if an adapter is broken (§9).

### 8.3 Confirm first
**A:**

```sql
SELECT substr(address, -2) AS suffix, COUNT(*) AS n FROM buildings WHERE source = 'seed' AND substr(address, -3) IN (' Wy',' Hw',' Ci',' Pw',' La',' Ro',' Al',' Cr') GROUP BY 1 ORDER BY 2 DESC
```

Expect Hw 128, Wy 118, Ci 71, Pw 36, La 14, Ro 5, Al 2, Cr 1, for 375 in total.

**B (widened sanity check; the generator is authoritative):**

```sql
SELECT id, source, address, street_key FROM buildings WHERE street_key LIKE '% LN' OR street_key LIKE '% LANE' OR street_key LIKE '% WAY' OR street_key LIKE '% HWY' OR street_key LIKE '% HIGHWAY' OR street_key LIKE '% CIR' OR street_key LIKE '% CIRCLE' OR street_key LIKE '% ROW' OR street_key LIKE '% PKWY' OR street_key LIKE '% PARKWAY' OR street_key LIKE '% ALY' OR street_key LIKE '% ALLEY' OR street_key LIKE '% CRES' OR street_key LIKE '% CRESCENT' OR street_key IN ('LN','LANE','WAY','HWY','HIGHWAY','CIR','CIRCLE','ROW','PKWY','PARKWAY','ALY','ALLEY','CRES','CRESCENT')
```

Expect exactly `seed-1801494010 | seed | 29 Neponset Field Lane | NEPONSET FIELD LN`.

**Backup:** run with `--json` and redirect to `.cache/suffix-backfill/backup-<T_live>.json`. Expect 376 rows.

```sql
SELECT id, address, street_key, updated_at FROM buildings WHERE (source = 'seed' AND substr(address, -3) IN (' Wy',' Hw',' Ci',' Pw',' La',' Ro',' Al',' Cr')) OR id = 'seed-1801494010'
```

### 8.4 Generate
`npm run records:suffix-backfill -- --remote --pulled-since <T_live>`.
- The summary must read: respell 375 (Highway 128, Way 118, Circle 71, Parkway 36, Lane 14, Row 5, Alley 2, Crescent 1), re-key 1, refused 0, refresh ids 376.
- The counts must agree with A and B.
- **Record the run directory** (`.cache/suffix-backfill/remote-<epoch>/`). Do not delete it.

### 8.5 Re-key (always)
Apply `--file .cache/suffix-backfill/remote-<epoch>/rekey.sql`, which contains one statement:

```sql
UPDATE buildings SET street_key = 'NEPONSET FIELD LA' WHERE id = 'seed-1801494010' AND street_key = 'NEPONSET FIELD LN';
```

Post-checks:
- `SELECT id, street_key, updated_at FROM buildings WHERE id = 'seed-1801494010'` gives `NEPONSET FIELD LA`, with `updated_at` unchanged from the backup.
- Re-run B: 0 rows.

### 8.6 Respell (only if the owner approved D4)
1. Record T0 with `SELECT unixepoch() AS t0`.
2. Apply `--file …/respell.sql`. A sample statement:

   ```sql
   UPDATE buildings SET address = '120 Grampian Way', updated_at = unixepoch() WHERE id = 'seed-1302460000' AND source = 'seed' AND address = '120 Grampian Wy';
   ```

3. Post-checks:
   - Re-run A: 0 rows.
   - Run the query below. Expect HW 128/128, WY 118/118, CI 71/71, PW 36/36, **LA 15/14** (Neponset re-keyed, not bumped), RO 5/5, AL 2/2, CR 1/1.

     ```sql
     SELECT substr(street_key, -3) AS k, COUNT(*) AS n, SUM(updated_at >= <T0>) AS bumped FROM buildings WHERE source = 'seed' AND substr(street_key, -3) IN (' WY',' HW',' CI',' PW',' LA',' RO',' AL',' CR') GROUP BY 1 ORDER BY 2 DESC
     ```

   - Run the query below. Expect:
     - '9-11 Appian Way' / `9-11-appian-wy-boston` / APPIAN WY / 9 / 11
     - '120 Grampian Way' / `120-grampian-wy-boston` / GRAMPIAN WY
     - '29 Neponset Field Lane' / `29-neponset-field-lane-boston` / NEPONSET FIELD LA

     ```sql
     SELECT id, address, slug, street_key, st_num_lo, st_num_hi FROM buildings WHERE id IN ('seed-2201144001','seed-1302460000','seed-1801494010')
     ```

   - GET `https://ratemyplace.org/building/120-grampian-wy-boston`. The `<title>` should be "120 Grampian Way, Boston | RateMyPlace".

**If the owner declined:** skip 8.6. The key-count query then reads LA 15 rows with 0 bumped.

### 8.7 Refresh (after the pilot passed; needed with or without 8.6)
1. Compute the expected count:

   ```sql
   SELECT COUNT(*) AS expected FROM buildings b WHERE b.source = 'seed' AND substr(b.street_key, -3) IN (' WY',' HW',' CI',' PW',' LA',' RO',' AL',' CR') AND NOT EXISTS (SELECT 1 FROM records_queue q WHERE q.building_id = b.id AND q.done_at IS NULL) AND NOT EXISTS (SELECT 1 FROM record_pulls p WHERE p.building_id = b.id AND p.retrieved_at >= <T_live>)
   ```

   Expect about 372: 376 minus 2 pending fill minus 2 pilot.
2. Record T1 with `SELECT unixepoch() AS t1`.
3. Apply `--file …/refresh.sql` **once**. A sample statement:

   ```sql
   INSERT OR IGNORE INTO records_queue (building_id, reason, priority, requested_at) SELECT 'seed-1302460000', 'refresh', 1, unixepoch() WHERE EXISTS (SELECT 1 FROM buildings WHERE id = 'seed-1302460000') AND NOT EXISTS (SELECT 1 FROM record_pulls WHERE building_id = 'seed-1302460000' AND retrieved_at >= <T_live>);
   ```

4. Post-check: this must equal `expected`.

   ```sql
   SELECT COUNT(*) AS n FROM records_queue WHERE reason = 'refresh' AND done_at IS NULL AND requested_at >= <T1>
   ```

Re-applying the same file is a no-op. Never generate a new run with a **different** `--pulled-since` and apply its `refresh.sql`.

### 8.8 Post-step R (about 7 hours later)
- Expect pending 0 and parked 0:

  ```sql
  SELECT COUNT(*) AS rows, SUM(done_at IS NULL) AS pending, SUM(done_at IS NULL AND attempts >= 3) AS parked FROM records_queue WHERE reason = 'refresh' AND requested_at >= <T1>
  ```

- Expect `violation` and `enforcement_ticket` present, permit at least 1,135 and service_request at least 4,838:

  ```sql
  SELECT r.kind, COUNT(*) AS n, COUNT(DISTINCT r.building_id) AS buildings FROM building_records r JOIN buildings b ON b.id = r.building_id WHERE b.source = 'seed' AND substr(b.street_key, -3) IN (' WY',' HW',' CI',' PW',' LA',' RO',' AL',' CR') GROUP BY r.kind
  ```

- Expect no error spike against the pre-apply rate:

  ```sql
  SELECT source_label, SUM(status = 'error') AS errors, COUNT(*) AS n FROM record_pulls WHERE retrieved_at >= <T1> GROUP BY source_label
  ```

## 9. Rollback

### Respell only (keep the code)
Apply `--file .cache/suffix-backfill/remote-<epoch>/respell-rollback.sql`. It restores the "Wy"-style addresses and bumps `updated_at` again. Under the new code the key and identity are identical either way, so nothing else is needed.

### Full code rollback, in this order
1. **Cancel pending refreshes:** apply `refresh-cancel.sql`. Without it, a reverted Worker pulling them would delete the violation and enforcement records the new code found.
   - Fallback if the file is unavailable:

     ```sql
     UPDATE records_queue SET done_at = unixepoch() WHERE reason = 'refresh' AND done_at IS NULL AND requested_at >= <T1>
     ```

   - This also closes any planner refresh rows created since T1; `planRefresh` re-creates those the next day.
2. Apply `respell-rollback.sql`, if 8.6 ran.
3. Apply `rekey-rollback.sql`, which restores `NEPONSET FIELD LN`.
4. **User rows keyed under the new code since T_live.** Re-splitting cannot undo these, because the old table lacks LA, WY and the other new spellings. Find them:

   ```sql
   SELECT id, address, street_key FROM buildings WHERE source = 'user' AND created_at >= <T_live> AND (substr(street_key, -3) IN (' WY',' HW',' CI',' PW',' LA',' RO',' AL',' CR'))
   ```

   For each row, compute the old key on the reverted `main`:

   ```
   npx tsx -e "import { addressKey } from './src/lib/records/identity'; console.log(addressKey('<address>'))"
   ```

   Then apply:

   ```sql
   UPDATE buildings SET street_key = '<old>' WHERE id = '<id>' AND street_key = '<new>'
   ```

   Expected volume is about 0–2 rows.
5. `git revert -m 1 <merge sha>` on a branch, then PR and merge, which redeploys Pages.
6. `npm run records:worker:deploy` from the reverted `main`.

Records pulled under the new code stay. The 376 buildings are not interesting to `planRefresh` (0 reviews, 0 saves), so only a reader's button or an admin pull would shrink them back.

### If the run directory is lost (last resort)
The original last word is the title-cased last word of the key, for all 375. For each pair (WY, Way), (HW, Highway), (CI, Circle), (PW, Parkway), (LA, Lane), (RO, Row), (AL, Alley), (CR, Crescent):

```sql
UPDATE buildings SET address = substr(address, 1, length(address) - length('<Long>')) || '<Short>', updated_at = unixepoch() WHERE source = 'seed' AND substr(street_key, -3) = ' <SHORT>' AND substr(address, -(length('<Long>') + 1)) = ' <Long>' AND id <> 'seed-1801494010'
```

For example: `… length('Way')) || 'Wy' … substr(street_key, -3) = ' WY' AND substr(address, -4) = ' Way' …`.

Before this change no seed address ended in " Way", " Highway", " Circle", " Parkway", " Row", " Alley" or " Crescent", and the only " Lane" seed with a re-keyable key was Neponset, which is excluded. Re-run A afterwards and expect 375.

## 10. Known limits (stated, not fixed here)
- **53 of the 375 still don't match a natural search**, because the words before the suffix differ, not the suffix itself:
  - 52 "Msgr P J Lydon Wy" rows: "monsignor lydon way" finds 0, while "msgr p j lydon way" finds 52.
  - "566 W Roxbury Pw": "west roxbury parkway" finds 0, while "w roxbury parkway" finds 1.
  - The same applies to Google long names in dedupe, such as "Monsignor Patrick J Lydon Way" and likely "Veterans of Foreign Wars Parkway". This would need a word-alias table, which is a separate item.
- **Whole-word alternatives** do not match a suffix glued to punctuation other than `,` or `.` (for example "Ave#3" or "St)") through its other spelling. The typed spelling still matches as a substring. No production address has such punctuation.
- **The legacy admin "enrich" adapter** (`src/lib/enrichment/adapters/boston.ts`, an exact `ST_NAME` filter built from the address) will query "GRAMPIAN WAY" for respelled rows. Every other seeded row is already in that state because of long-form formatting, so this is a note, not a regression.
- **"Vfw Parkway"** keeps the existing title-casing of VFW.
- **Slug and address disagree** on the 375 pages (`-wy-` in the URL, "Way" on the page). This is permanent under the never-change-slugs rule, and cosmetic.

## 11. What NOT to change
- The first spelling of any existing row (AV, ST, RD, DR, PL, TE, CT, BLVD, SQ, PK, WHARF).
- Slugs, which are never regenerated.
- User-entered addresses (`source = 'user'`).
- `search.astro`, `api/search/results.ts`, `MAX_TERMS`, the typed-term substring match, and the whole-query neighborhood and landlord fallback.
- `isDegenerateStreet`, `stripTrailingLocality`, and `streetKey`'s deliberate lack of the locality stripper.
- The seed upsert in `seed/sql.ts`.
- `formatSeedAddress` logic (only `titleWord` is exported).
- `src/lib/enrichment/`.
- XT, CIRCUIT and the other non-suffix words.
- No migration file.
- Do not backfill the 79 NULL user `street_key`s.
- Do not delete or merge `t6aaqyar342wrkhi` in this branch; it is the owner's call, via the audited admin DELETE (`building_deleted`).
- `updated_at` on the key-only change.
- Never `git add -A`.

## 12. Overlap with other items
- **Item 1** (the review form) creates rows without `street_key` at `review/new.astro:93`. If item 1 routes that path through `findBuildingByAddress`, this change makes "Way/Lane/…" input land on seeded rows. Both items append to `recordsDedupe.test.ts`, which may cause a trivial merge conflict.
- **Item 3** (titles and canonical tags): titles derive from `address`, so the respelled titles flow through.
- **Item 5** (Astro upgrade) is independent. Re-run the suite if it merges first.
