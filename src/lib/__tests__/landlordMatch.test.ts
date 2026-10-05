import { describe, expect, it } from 'vitest';
import { classifyLandlordCandidates, keptSeparateNote } from '../admin/landlordMatch';

const aaBoston = { id: 'll-aa', name: 'AA Management', cities: ['Boston'], states: ['MA'] };

describe('classifyLandlordCandidates', () => {
  it('does not match a New Haven building to a same-named Boston landlord (the AA Management case)', () => {
    const result = classifyLandlordCandidates('AA Management', { city: 'New Haven', state: 'CT' }, [aaBoston]);
    expect(result.exact).toBeNull();
    expect(result.elsewhere).toEqual([aaBoston]);
  });

  it('treats Boston localities as Boston: Allston matches a Boston landlord', () => {
    const result = classifyLandlordCandidates('aa management ', { city: 'Allston', state: 'MA' }, [aaBoston]);
    expect(result.exact).toEqual(aaBoston);
    expect(result.elsewhere).toEqual([]);
  });

  it('matches the same city case-insensitively, and state case-insensitively', () => {
    const nh = { id: 'll-nh', name: 'AA Management', cities: ['NEW HAVEN'], states: ['CT'] };
    expect(classifyLandlordCandidates('AA Management', { city: 'New Haven', state: 'ct' }, [nh]).exact).toEqual(nh);
  });

  it('ignores a trailing ", ST" on either side: "New Haven, CT" matches "New Haven"', () => {
    const nh = { id: 'll-nh', name: 'AA Management', cities: ['New Haven'], states: ['CT'] };
    expect(classifyLandlordCandidates('AA Management', { city: 'New Haven, CT', state: 'CT' }, [nh]).exact).toEqual(nh);
    const nhSuffixed = { id: 'll-nh2', name: 'AA Management', cities: ['New Haven, CT '], states: ['CT'] };
    expect(classifyLandlordCandidates('AA Management', { city: 'new haven', state: 'CT' }, [nhSuffixed]).exact).toEqual(nhSuffixed);
  });

  it('a city match in another state is elsewhere', () => {
    const portland = { id: 'll-me', name: 'Harbor Co', cities: ['Portland'], states: ['ME'] };
    const result = classifyLandlordCandidates('Harbor Co', { city: 'Portland', state: 'OR' }, [portland]);
    expect(result.exact).toBeNull();
    expect(result.elsewhere).toEqual([portland]);
  });

  it('two same-area candidates are ambiguous: no exact, both listed', () => {
    const a = { id: 'll-1', name: 'AA Management', cities: ['Boston'], states: ['MA'] };
    const b = { id: 'll-2', name: 'AA Management', cities: ['Dorchester'], states: ['MA'] };
    const result = classifyLandlordCandidates('AA Management', { city: 'Boston', state: 'MA' }, [a, b]);
    expect(result.exact).toBeNull();
    expect(result.elsewhere).toEqual([a, b]);
  });

  it('one same-area candidate is exact even with a namesake elsewhere, which is still listed', () => {
    const nh = { id: 'll-nh', name: 'AA Management', cities: ['New Haven'], states: ['CT'] };
    const result = classifyLandlordCandidates('AA Management', { city: 'Brighton', state: 'MA' }, [nh, aaBoston]);
    expect(result.exact).toEqual(aaBoston);
    expect(result.elsewhere).toEqual([nh]);
  });

  it('a landlord with no buildings is never exact', () => {
    const empty = { id: 'll-empty', name: 'AA Management', cities: [], states: [] };
    const result = classifyLandlordCandidates('AA Management', { city: 'Boston', state: 'MA' }, [empty]);
    expect(result.exact).toBeNull();
    expect(result.elsewhere).toEqual([empty]);
  });

  it('a building with no state never matches', () => {
    const result = classifyLandlordCandidates('AA Management', { city: 'Boston', state: null }, [aaBoston]);
    expect(result.exact).toBeNull();
  });

  it('ignores different names and blank names', () => {
    const other = { id: 'll-x', name: 'AAA Management', cities: ['Boston'], states: ['MA'] };
    expect(classifyLandlordCandidates('AA Management', { city: 'Boston', state: 'MA' }, [other])).toEqual({ exact: null, elsewhere: [] });
    expect(classifyLandlordCandidates('  ', { city: 'Boston', state: 'MA' }, [aaBoston])).toEqual({ exact: null, elsewhere: [] });
  });
});

describe('keptSeparateNote', () => {
  it('names each same-name landlord with its cities and states and the date', () => {
    const nh = { id: 'll-nh', name: 'AA Management', cities: ['New Haven'], states: ['CT'] };
    expect(keptSeparateNote([aaBoston, nh], new Date('2026-10-05T14:00:00Z'))).toBe(
      'Same name as landlord ll-aa (Boston, MA); Same name as landlord ll-nh (New Haven, CT); kept separate 2026-10-05',
    );
  });

  it('stays within 1000 characters and keeps the decision date', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `ll-${i}`, name: 'X', cities: ['Somewhere Long'], states: ['MA'] }));
    const note = keptSeparateNote(many, new Date('2026-10-05T00:00:00Z'));
    expect(note.length).toBeLessThanOrEqual(1000);
    expect(note.endsWith('; kept separate 2026-10-05')).toBe(true);
  });
});
