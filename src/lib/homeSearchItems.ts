// The homepage dropdown's rows and their order.
//
// LEAF MODULE: no runtime imports. HomeSearch (a React island) imports it, so anything it
// imported would ship to every visitor (`clientLeafModules.test.ts` enforces it).
//
// Order: buildings already on RateMyPlace first (our own matches, then Google suggestions
// the server matched to a building page), then landlords, then the remaining Google
// suggestions, which are addresses to start a review for. A building row opens the building
// page; writing a review is its second action.

/** A row from `GET /api/search/autocomplete`. */
export interface HomeDbResult {
  id: string;
  type: 'building' | 'landlord';
  title: string;
  subtitle: string;
  slug: string;
  reviewCount: number;
  avgScore: number | null;
}

/** The building a Google suggestion turned out to be (`GET /api/places/autocomplete?scope=boston`). */
export interface HomeExistingBuilding {
  slug: string;
  title: string;
  subtitle: string;
  reviewCount: number;
  avgScore: number | null;
}

export interface HomePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
  existing?: HomeExistingBuilding | null;
}

/**
 * Where "Write a review" goes: our own row knows the building id; a matched Google row goes
 * through the `/review/new?placeId=` handoff, which resolves the same building (and says when
 * the address is part of a larger parcel).
 */
export type HomeReviewTarget = { buildingId: string } | { placeId: string };

export type HomeDropdownItem =
  | {
      kind: 'building';
      key: string;
      slug: string;
      title: string;
      subtitle: string;
      reviewCount: number;
      avgScore: number | null;
      review: HomeReviewTarget;
    }
  | { kind: 'landlord'; key: string; result: HomeDbResult }
  | { kind: 'address'; key: string; prediction: HomePrediction };

export function homeDropdownItems(dbResults: HomeDbResult[], predictions: HomePrediction[]): HomeDropdownItem[] {
  const ownBuildings = dbResults.filter((r) => r.type === 'building');
  const landlords = dbResults.filter((r) => r.type === 'landlord');

  const shownSlugs = new Set(ownBuildings.map((b) => b.slug));
  // Our own titles, lower-cased: a Google row with exactly the same street text as one of
  // our rows is the same address shown twice.
  const ownTitles = new Set(ownBuildings.map((b) => b.title.toLowerCase()));

  const buildings: HomeDropdownItem[] = ownBuildings.map((b) => ({
    kind: 'building',
    key: `db-${b.id}`,
    slug: b.slug,
    title: b.title,
    subtitle: b.subtitle,
    reviewCount: b.reviewCount,
    avgScore: b.avgScore,
    review: { buildingId: b.id },
  }));
  const addresses: HomeDropdownItem[] = [];

  for (const p of predictions) {
    if (p.existing) {
      // Two suggestions can be the same building (a range parcel); show it once.
      if (shownSlugs.has(p.existing.slug)) continue;
      shownSlugs.add(p.existing.slug);
      buildings.push({
        kind: 'building',
        key: `g-${p.placeId}`,
        slug: p.existing.slug,
        title: p.existing.title,
        subtitle: p.existing.subtitle,
        reviewCount: p.existing.reviewCount,
        avgScore: p.existing.avgScore,
        review: { placeId: p.placeId },
      });
      continue;
    }
    if (ownTitles.has(p.mainText.toLowerCase())) continue;
    addresses.push({ kind: 'address', key: `g-${p.placeId}`, prediction: p });
  }

  return [
    ...buildings,
    ...landlords.map((l): HomeDropdownItem => ({ kind: 'landlord', key: `db-${l.id}`, result: l })),
    ...addresses,
  ];
}

/** The page a row opens when it is chosen (click, or Enter while highlighted). */
export function homeItemHref(item: HomeDropdownItem): string {
  if (item.kind === 'building') return `/building/${item.slug}`;
  if (item.kind === 'landlord') return `/landlord/${item.result.slug}`;
  return placeReviewHref(item.prediction.placeId);
}

/** The review form for a Google place: the `/review/new?placeId=` handoff. */
export function placeReviewHref(placeId: string): string {
  return `/review/new?placeId=${encodeURIComponent(placeId)}`;
}
