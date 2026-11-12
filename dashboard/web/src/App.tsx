import { lazy, Suspense } from 'preact/compat';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { COPY } from './copy';
import { buildingRows, cellMask, dayLabel, defaultFilters, hasGeo, ownerTypeOn, summarize, type Core, type Filters } from './compute';
import { loadBuildings, loadCore, type Buildings } from './data';
import { FiltersBar, placeLabel, selectionLabel } from './Filters';
import { Tiles } from './Tiles';
import { Trend } from './Trend';
import { BuildingTable } from './BuildingTable';
import { BuildingDetail, type DetailTarget } from './BuildingDetail';
import { OwnerLookup } from './OwnerLookup';
import { HowItWorks } from './HowItWorks';
import { readHash, writeHash } from './hash';

const MapView = lazy(() => import('./MapView'));

export function App() {
  const [core, setCore] = useState<Core | null>(null);
  const [buildings, setBuildings] = useState<Buildings | null>(null);
  const [failed, setFailed] = useState(false);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [ownerId, setOwnerId] = useState<number | null>(null);

  useEffect(() => {
    loadCore()
      .then((c) => {
        setCore(c);
        setFilters(readHash(c, defaultFilters(c)));
        // the heavier building list loads after the numbers are on screen
        loadBuildings().then(setBuildings).catch(() => setFailed(true));
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => { if (core && filters) writeHash(core, filters); }, [core, filters]);

  const mask = useMemo(() => (core && filters ? cellMask(core, filters) : []), [core, filters]);
  const bostonMask = useMemo(() => (core ? core.cells.map(() => true) : []), [core]);
  const summary = useMemo(() => (core && filters ? summarize(core, filters, mask) : null), [core, filters, mask]);
  const boston = useMemo(() => (core && filters ? summarize(core, filters, bostonMask) : null), [core, filters, bostonMask]);
  const allRows = useMemo(() => (core && filters ? buildingRows(core, filters, mask) : []), [core, filters, mask]);
  // The owner-type filter applies to the map, the table and the download. The tiles and the trend never see it.
  const rows = useMemo(() => (buildings && filters ? allRows.filter((r) => ownerTypeOn(buildings.flags[r.b], filters.owner)) : allRows), [allRows, buildings, filters]);

  const showOwner = (id: number) => {
    setDetail(null);
    setOwnerId(id);
    requestAnimationFrame(() => document.getElementById('owners')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <>
      <a class="skip" href="#results">{COPY.skipToResults}</a>
      <header class="site-header">
        <div class="wrap header-row">
          <a href="https://ratemyplace.org" class="brand"><img src="/logo-lockup.svg" alt={COPY.siteName} height="28" /></a>
          {core && (
            <p class="updated">
              {COPY.updated} <time dateTime={core.meta.pulled}>{dayLabel(core.meta.pulled)}</time>
            </p>
          )}
        </div>
      </header>
      <main class="wrap">
        <h1>{COPY.pageTitle}</h1>
        {COPY.introPlaceholder.map((p) => <p class="intro">{p}</p>)}
        <p class="placeholder">{COPY.placeholders.notTheList}</p>

        {failed && <p class="error" role="alert">{COPY.loadError}</p>}
        {!core && !failed && <p class="loading" role="status">{COPY.loading}</p>}

        {core && filters && summary && boston && (
          <>
            <FiltersBar core={core} buildings={buildings} filters={filters} onChange={setFilters} onOpen={(b) => setDetail({ kind: 'index', b })} />
            <div id="results" tabIndex={-1}>
              <p class="selection" role="status" translate={false}>
                {COPY.selection}: <strong>{selectionLabel(core, filters)}</strong>. {COPY.ownerType}: <strong>{COPY.ownerTypes[filters.owner]}</strong> ({COPY.selectionOwnerScope}).
              </p>
              {summary.buildings === 0 ? (
                <p class="empty">{COPY.noMatch}</p>
              ) : (
                <>
                  <Tiles core={core} filters={filters} summary={summary} boston={boston} showArea={hasGeo(filters)} place={placeLabel(core, filters)} />
                  <Trend core={core} filters={filters} mask={mask} showArea={hasGeo(filters)} place={placeLabel(core, filters)} />
                  <section class="split" aria-label={COPY.mapHeading}>
                    <div class="panel map-panel">
                      <h2>{COPY.mapHeading}</h2>
                      <p class="sub">{COPY.mapSub}</p>
                      {buildings ? (
                        <Suspense fallback={<p class="loading">{COPY.mapLoading}</p>}>
                          <MapView core={core} buildings={buildings} rows={rows} filters={filters} onOpen={(b) => setDetail({ kind: 'index', b })} />
                        </Suspense>
                      ) : (
                        <p class="loading">{COPY.mapLoading}</p>
                      )}
                    </div>
                    <BuildingTable core={core} buildings={buildings} rows={rows} filters={filters} onOpen={(b) => setDetail({ kind: 'index', b })} />
                  </section>
                </>
              )}
            </div>
            <OwnerLookup core={core} buildings={buildings} ownerId={ownerId} onPick={setOwnerId} onOpen={setDetail} />
            <HowItWorks core={core} />
          </>
        )}
      </main>
      <footer class="site-footer">
        <div class="wrap">
          <a href="https://ratemyplace.org">{COPY.footer}</a>
          <span class="placeholder">{COPY.placeholders.whoMadeThis}</span>
          {core && <span>{COPY.dataThrough} {dayLabel(core.meta.dataThrough)}</span>}
        </div>
      </footer>
      {core && detail && <BuildingDetail core={core} buildings={buildings} target={detail} onClose={() => setDetail(null)} onOwner={showOwner} />}
    </>
  );
}
