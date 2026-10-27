/**
 * What /search says when a search finds nothing.
 *
 * The message follows what was searched. The Landlords filter matches two kinds of name: the
 * landlords reviewers named, only once one of their buildings has an approved review (the
 * `HAVING COUNT(r.id) > 0` in both landlord queries), and owners of record from the assessor,
 * only when the owner is an entity or holds two or more residential parcels here
 * (`searchOwnerNames` in `records/ownerList.ts`). So it gets its own message: the buildings
 * hint ("a partial street name") is no help to someone looking for a landlord.
 *
 * Every other type gets the buildings messages. A neighborhood or ZIP on its own ("Brighton",
 * "02135") gets a message in those terms, since the street-name hint is no help to someone
 * who typed a place. A full address whose house number has no building offers the street
 * without the number, since a number matches only that number or a range holding it.
 */

export interface SearchEmptyInput {
  /** The trimmed query as typed. */
  query: string;
  /** The `type` parameter: 'all', 'buildings' or 'landlords'. Anything else gets the buildings messages. */
  type: string;
  /** True when the query named only a neighborhood or ZIP (`isAreaSearch`). */
  areaSearch: boolean;
  /** The typed address without its house number (`withoutHouseNumber`), or null. */
  streetQuery: string | null;
}

export interface SearchEmptyState {
  title: string;
  description: string;
  /** A follow-up search to offer under the message, or null. */
  next: { label: string; href: string } | null;
}

export const LANDLORD_EMPTY_TITLE = 'No landlords match that search';
export const LANDLORD_EMPTY_DESCRIPTION =
  'Landlords named in reviews are listed once one of their buildings has a review. Owners of record are listed when they own two or more buildings here. Try part of the name.';
export const LANDLORD_EMPTY_NEXT_LABEL = 'Search buildings instead';

export function searchEmptyState({ query, type, areaSearch, streetQuery }: SearchEmptyInput): SearchEmptyState {
  if (type === 'landlords') {
    return {
      title: LANDLORD_EMPTY_TITLE,
      description: LANDLORD_EMPTY_DESCRIPTION,
      next: { label: LANDLORD_EMPTY_NEXT_LABEL, href: `/search?q=${encodeURIComponent(query)}&type=buildings` },
    };
  }
  if (areaSearch) {
    return {
      title: 'No buildings listed under that neighborhood or ZIP code',
      description: 'Some buildings have no neighborhood on file. Try the street name or the full address.',
      next: null,
    };
  }
  if (streetQuery) {
    return {
      title: 'No buildings match that address',
      description: 'Try the street without the house number.',
      next: { label: `Search ${streetQuery}`, href: `/search?q=${encodeURIComponent(streetQuery)}` },
    };
  }
  return {
    title: 'No buildings match that search',
    description: 'Try a wider neighborhood or a partial street name.',
    next: null,
  };
}
