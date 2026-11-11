import { OWNER_TYPES, type Core, type Filters, type OwnerType } from './compute';

// The filters live in the address bar, so a filtered view can be shared as a link.
export function writeHash(core: Core, f: Filters): void {
  const p = new URLSearchParams();
  if (f.district >= 0) p.set('district', core.districts[f.district]);
  if (f.neighborhood >= 0) p.set('neighborhood', core.neighborhoods[f.neighborhood]);
  if (f.zip >= 0) p.set('zip', core.zips[f.zip]);
  const on = core.meta.groups.filter((_, i) => f.issues[i]);
  if (on.length) p.set('issue', on.join(','));
  if (f.m0 > 0) p.set('from', core.meta.months[f.m0]);
  if (f.m1 < core.meta.months.length - 1) p.set('to', core.meta.months[f.m1]);
  if (f.owner !== 'private') p.set('owners', f.owner);
  const s = p.toString();
  const next = s ? `#${s}` : location.pathname + location.search;
  if ((location.hash || '') !== (s ? `#${s}` : '')) history.replaceState(null, '', next);
}

export function readHash(core: Core, base: Filters): Filters {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  const f = { ...base, issues: [...base.issues] };
  const idx = (list: string[], v: string | null) => (v === null ? -1 : list.indexOf(v));
  f.district = idx(core.districts, p.get('district'));
  f.neighborhood = idx(core.neighborhoods, p.get('neighborhood'));
  f.zip = idx(core.zips, p.get('zip'));
  for (const g of (p.get('issue') ?? '').split(',')) {
    const i = core.meta.groups.indexOf(g);
    if (i >= 0) f.issues[i] = true;
  }
  const m0 = idx(core.meta.months, p.get('from')), m1 = idx(core.meta.months, p.get('to'));
  if (m0 >= 0) f.m0 = m0;
  if (m1 >= 0) f.m1 = m1;
  if (f.m0 > f.m1) { f.m0 = base.m0; f.m1 = base.m1; }
  const o = p.get('owners') as OwnerType | null;
  f.owner = o && OWNER_TYPES.includes(o) ? o : base.owner;
  return f;
}
