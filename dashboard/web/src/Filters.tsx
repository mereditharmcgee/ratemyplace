import { COPY } from './copy';
import { defaultFilters, fullYears, monthLabel, OWNER_TYPES, type Core, type Filters, type OwnerType } from './compute';
import { ISSUE_COLORS, ISSUE_KEYS } from './data';

export function selectionLabel(core: Core, f: Filters): string {
  const place = [
    f.district >= 0 ? `${COPY.districtN} ${core.districts[f.district]}` : '',
    f.neighborhood >= 0 ? core.neighborhoods[f.neighborhood] : '',
    f.zip >= 0 ? core.zips[f.zip] : '',
  ].filter(Boolean).join(', ') || COPY.allBoston;
  const on = ISSUE_KEYS.filter((_, i) => f.issues[i]).map((k) => COPY.issuesShort[k]);
  const issue = on.length ? on.join(' + ') : COPY.issueAll;
  const months = core.meta.months;
  const dates = f.m0 === f.m1 ? monthLabel(months[f.m0]) : `${monthLabel(months[f.m0])} to ${monthLabel(months[f.m1])}`;
  return `${place}; ${issue}; ${dates}`;
}

interface Props { core: Core; filters: Filters; onChange: (f: Filters) => void }

export function FiltersBar({ core, filters: f, onChange }: Props) {
  const months = core.meta.months;
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const complete = fullYears(core);
  const setYear = (y: string) => {
    const idx = months.map((m, i) => (m.startsWith(y) ? i : -1)).filter((i) => i >= 0);
    set({ m0: idx[0], m1: idx[idx.length - 1] });
  };
  const isYear = (y: string) => months[f.m0] === `${y}-01` && months[f.m1].startsWith(y) && (f.m1 === months.length - 1 || !months[f.m1 + 1].startsWith(y));
  const isAll = f.m0 === 0 && f.m1 === months.length - 1;
  const toggleIssue = (i: number) => set({ issues: f.issues.map((v, j) => (j === i ? !v : v)) });
  const noIssue = !f.issues.some(Boolean);

  return (
    <section class="filters" aria-labelledby="filters-h">
      <h2 id="filters-h">{COPY.filtersHeading}</h2>
      <div class="filter-grid">
        <label>
          <span>{COPY.district}</span>
          <select value={String(f.district)} onChange={(e) => set({ district: Number((e.target as HTMLSelectElement).value) })}>
            <option value="-1">{COPY.all}</option>
            {core.districts.map((d, i) => <option value={String(i)}>{COPY.districtN} {d}</option>)}
          </select>
        </label>
        <label>
          <span>{COPY.neighborhood}</span>
          <select value={String(f.neighborhood)} onChange={(e) => set({ neighborhood: Number((e.target as HTMLSelectElement).value) })}>
            <option value="-1">{COPY.all}</option>
            {core.neighborhoods.map((n, i) => <option value={String(i)}>{n}</option>)}
          </select>
        </label>
        <label>
          <span>{COPY.zip}</span>
          <select value={String(f.zip)} onChange={(e) => set({ zip: Number((e.target as HTMLSelectElement).value) })}>
            <option value="-1">{COPY.all}</option>
            {core.zips.map((z, i) => <option value={String(i)}>{z}</option>)}
          </select>
        </label>
        <label>
          <span>{COPY.ownerType}</span>
          <select id="owner-type" value={f.owner} aria-describedby="owner-type-note" onChange={(e) => set({ owner: (e.target as HTMLSelectElement).value as OwnerType })}>
            {OWNER_TYPES.map((t) => <option value={t}>{COPY.ownerTypes[t]}</option>)}
          </select>
        </label>
      </div>
      <p class="filter-note" id="owner-type-note">{COPY.ownerTypeNote}</p>

      <fieldset class="chips">
        <legend>{COPY.issue}</legend>
        <button type="button" class="chip" aria-pressed={noIssue} onClick={() => set({ issues: f.issues.map(() => false) })}>{COPY.issueAll}</button>
        {ISSUE_KEYS.map((k, i) => (
          <button type="button" class="chip" aria-pressed={f.issues[i]} title={COPY.issueHelp[k]} onClick={() => toggleIssue(i)}>
            <span class="dot" style={{ background: ISSUE_COLORS[i] }} aria-hidden="true" />
            {COPY.issues[k]}
          </button>
        ))}
      </fieldset>

      <fieldset class="chips">
        <legend>{COPY.dates}</legend>
        <button type="button" class="chip" aria-pressed={isAll} onClick={() => set({ m0: 0, m1: months.length - 1 })}>{COPY.presetAll}</button>
        {years.map((y) => (
          <button type="button" class="chip" aria-pressed={!isAll && isYear(y)} onClick={() => setYear(y)}>
            {complete.includes(y) ? y : `${y} ${COPY.presetYtd}`}
          </button>
        ))}
        <span class="range">
          <label>
            <span>{COPY.from}</span>
            <select value={String(f.m0)} onChange={(e) => { const v = Number((e.target as HTMLSelectElement).value); set({ m0: v, m1: Math.max(v, f.m1) }); }}>
              {months.map((m, i) => <option value={String(i)}>{monthLabel(m)}</option>)}
            </select>
          </label>
          <label>
            <span>{COPY.to}</span>
            <select value={String(f.m1)} onChange={(e) => { const v = Number((e.target as HTMLSelectElement).value); set({ m1: v, m0: Math.min(v, f.m0) }); }}>
              {months.map((m, i) => <option value={String(i)}>{monthLabel(m)}</option>)}
            </select>
          </label>
        </span>
      </fieldset>
      <button type="button" class="link-button" onClick={() => onChange(defaultFilters(core))}>{COPY.reset}</button>
    </section>
  );
}
