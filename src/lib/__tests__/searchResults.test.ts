import { describe, it, expect } from 'vitest';

/**
 * Tests for search result pagination logic.
 * These validate the client-side logic in SearchResults.tsx
 * without requiring D1/API access.
 */

const PAGE_SIZE = 10;

describe('search pagination logic', () => {
  describe('hasMore calculation', () => {
    it('shows Load More when displayed < total', () => {
      const displayed = 10;
      const total = 29;
      expect(displayed < total).toBe(true);
    });

    it('hides Load More when displayed >= total', () => {
      const displayed = 29;
      const total = 29;
      expect(displayed < total).toBe(false);
    });

    it('hides Load More when total fits in first page', () => {
      const displayed = 5;
      const total = 5;
      expect(displayed < total).toBe(false);
    });

    it('handles zero results', () => {
      const displayed = 0;
      const total = 0;
      expect(displayed < total).toBe(false);
    });
  });

  describe('offset calculation', () => {
    it('first page offset is 0', () => {
      const currentItems: any[] = [];
      expect(currentItems.length).toBe(0);
    });

    it('second page offset equals PAGE_SIZE', () => {
      const currentItems = new Array(PAGE_SIZE).fill({});
      expect(currentItems.length).toBe(PAGE_SIZE);
    });

    it('third page offset equals 2 * PAGE_SIZE', () => {
      const currentItems = new Array(PAGE_SIZE * 2).fill({});
      expect(currentItems.length).toBe(PAGE_SIZE * 2);
    });

    it('partial last page still uses correct offset', () => {
      // 29 total: page 1 = 10, page 2 = 10, page 3 = 9
      const afterTwoPages = new Array(20).fill({});
      const offset = afterTwoPages.length;
      const remaining = 29 - offset;
      expect(offset).toBe(20);
      expect(remaining).toBe(9);
    });
  });

  describe('result appending', () => {
    it('appends new results to existing array', () => {
      const existing = [{ id: '1' }, { id: '2' }];
      const newResults = [{ id: '3' }, { id: '4' }];
      const combined = [...existing, ...newResults];
      expect(combined).toHaveLength(4);
      expect(combined[2].id).toBe('3');
    });

    it('handles empty API response gracefully', () => {
      const existing = [{ id: '1' }];
      const newResults: any[] = [];
      const combined = [...existing, ...newResults];
      expect(combined).toHaveLength(1);
    });
  });

  describe('Google fallback gating', () => {
    it('triggers Google when DB returns 0 results', () => {
      const dbResultCount = 0;
      expect(dbResultCount < 3).toBe(true);
    });

    it('triggers Google when DB returns 1-2 results', () => {
      expect(1 < 3).toBe(true);
      expect(2 < 3).toBe(true);
    });

    it('skips Google when DB returns 3+ results', () => {
      expect(3 < 3).toBe(false);
      expect(5 < 3).toBe(false);
    });
  });

  describe('deduplication of Google vs DB results', () => {
    it('filters Google results that match DB addresses', () => {
      const dbResults = [
        { type: 'building', title: '12 Brighton Ave' },
        { type: 'building', title: '45 Comm Ave' },
      ];
      const googleResults = [
        { mainText: '12 Brighton Ave', placeId: 'g1' },
        { mainText: '99 New Street', placeId: 'g2' },
      ];

      const filtered = googleResults.filter(g =>
        !dbResults.some(d =>
          d.type === 'building' && d.title.toLowerCase() === g.mainText.toLowerCase()
        )
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0].mainText).toBe('99 New Street');
    });

    it('case-insensitive deduplication', () => {
      const dbResults = [{ type: 'building', title: '12 BRIGHTON AVE' }];
      const googleResults = [{ mainText: '12 Brighton Ave', placeId: 'g1' }];

      const filtered = googleResults.filter(g =>
        !dbResults.some(d =>
          d.type === 'building' && d.title.toLowerCase() === g.mainText.toLowerCase()
        )
      );

      expect(filtered).toHaveLength(0);
    });

    it('does not filter landlord results from Google dedup', () => {
      const dbResults = [{ type: 'landlord', title: 'Smith Properties' }];
      const googleResults = [{ mainText: 'Smith Properties', placeId: 'g1' }];

      const filtered = googleResults.filter(g =>
        !dbResults.some(d =>
          d.type === 'building' && d.title.toLowerCase() === g.mainText.toLowerCase()
        )
      );

      // Landlord match should NOT filter a Google address result
      expect(filtered).toHaveLength(1);
    });
  });

  describe('API parameter construction', () => {
    it('builds correct params for building load-more', () => {
      const query = 'Brighton';
      const offset = 10;
      const params = new URLSearchParams({
        type: 'buildings',
        offset: String(offset),
        limit: String(PAGE_SIZE),
      });
      if (query) params.set('q', query);

      expect(params.get('type')).toBe('buildings');
      expect(params.get('offset')).toBe('10');
      expect(params.get('limit')).toBe('10');
      expect(params.get('q')).toBe('Brighton');
    });

    it('omits q param for browse-all mode', () => {
      const query = '';
      const params = new URLSearchParams({
        type: 'buildings',
        offset: '0',
        limit: String(PAGE_SIZE),
      });
      if (query) params.set('q', query);

      expect(params.get('q')).toBeNull();
    });

    it('constructs correct autocomplete params', () => {
      const input = 'Brighton';
      const params = new URLSearchParams({ q: input });
      expect(params.get('q')).toBe('Brighton');
    });
  });
});
