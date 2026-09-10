import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The search page renders the first page of results server-side and the results endpoint
 * serves every page after it. They are two hand-written copies of one query, and a change
 * to either alone shows up as a building that appears on load and vanishes on "Load more".
 * Both now build the query-mode buildings query out of `searchSql.ts`; these are the guards
 * that they keep doing so, and that removing the reviewed-only gate there did not remove it
 * from browse mode or from the landlord queries.
 */
const page = readFileSync(join(process.cwd(), 'src/pages/search.astro'), 'utf8');
const endpoint = readFileSync(join(process.cwd(), 'src/pages/api/search/results.ts'), 'utf8');

describe('search page and results endpoint stay aligned', () => {
  for (const [name, source] of [['search.astro', page], ['results.ts', endpoint]] as const) {
    it(`${name} builds the query-mode buildings query from searchSql`, () => {
      expect(source).toMatch(/buildingSearchWhere\(/);
      expect(source).toMatch(/buildingSearchSelect\(/);
      expect(source).toMatch(/BUILDING_SEARCH_ORDER/);
    });
  }

  // The page held eight: buildings and landlords, count and rows, in each of search and
  // browse mode. The two query-mode buildings queries lost theirs; the other six keep it.
  it('the page keeps browse mode and landlords reviewed-only', () => {
    expect((page.match(/HAVING COUNT\(r\.id\) > 0/g) ?? []).length).toBe(6);
  });

  // Three, not the two the plan predicted: the endpoint's landlords branch is also written
  // as a query / no-query pair, so it carries two `HAVING`s of its own, not one. The
  // buildings branch keeps the one in its no-query variant.
  it('the endpoint keeps browse mode and landlords reviewed-only', () => {
    expect((endpoint.match(/HAVING COUNT\(r\.id\) > 0/g) ?? []).length).toBe(3);
  });
});
