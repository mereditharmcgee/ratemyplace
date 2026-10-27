import { describe, it, expect } from 'vitest';
import {
  MIN_PARCELS_FOR_PERSON,
  isEntityOwner,
  isResidentialAssessment,
  linkableOwnerKey,
  ownerKey,
  ownerRowFromAssessment,
} from '../records/ownerOfRecord';
import { showMailingAddress } from '../records/display';

describe('ownerKey', () => {
  it('normalizes case, spacing and punctuation, nothing else', () => {
    expect(ownerKey('  Example Realty,  L.P. ')).toBe('EXAMPLE REALTY LP');
    expect(ownerKey('EXAMPLE REALTY LP')).toBe('EXAMPLE REALTY LP');
    expect(ownerKey('Sample Holdings L.L.C.')).toBe('SAMPLE HOLDINGS LLC');
    expect(ownerKey('SAMPLE HOLDINGS LLC')).toBe('SAMPLE HOLDINGS LLC');
    expect(ownerKey('Doe, Jane')).toBe('DOE JANE');
  });

  it('keeps a different recorded spelling as a different owner', () => {
    expect(ownerKey('12 EXAMPLE ROAD LLC')).not.toBe(ownerKey('12 EXAMPLE RD LLC'));
    expect(ownerKey('EXAMPLE PROPERTIES')).not.toBe(ownerKey('EXAMPLE PROPERTIES INC'));
  });

  it('is null for a blank or missing name', () => {
    expect(ownerKey(null)).toBeNull();
    expect(ownerKey(undefined)).toBeNull();
    expect(ownerKey('')).toBeNull();
    expect(ownerKey(' . , ')).toBeNull();
  });
});

describe('isEntityOwner', () => {
  it.each([
    'SAMPLE HOLDINGS LLC',
    'EXAMPLE REALTY LP',
    'EXAMPLE PARTNERS LLP',
    'EXAMPLE WIDGETS INC',
    'EXAMPLE CORP',
    'DOE FAMILY TRUST',
    'EXAMPLE REALTY',
    'EXAMPLE ASSOCIATES',
    'EXAMPLE PROPERTIES',
    'EXAMPLE MANAGEMENT',
    'EXAMPLE MGMT',
    'EXAMPLE COMPANY',
    'Example Realty, L.P.',
  ])('treats %s as an entity', (name) => {
    expect(isEntityOwner(name)).toBe(true);
  });

  it.each([
    'DOE JANE',
    'DOE JANE TR',
    'DOE JOHN TRUSTEE',
    'PRINCE JOHN',
    'CHURCH MARY E',
  ])('treats %s as a person', (name) => {
    expect(isEntityOwner(name)).toBe(false);
  });

  it('matches whole words only', () => {
    expect(isEntityOwner('MANAGEMENTSON JANE')).toBe(false);
    expect(isEntityOwner('LTDOVICH JANE')).toBe(false);
  });

  it('never calls a name a person that the mailing-address gate calls an entity', () => {
    for (const name of ['SAMPLE HOLDINGS LLC', 'EXAMPLE HOUSING AUTHORITY', 'EXAMPLE UNIVERSITY', 'DOE FAMILY TR']) {
      expect(showMailingAddress(name)).toBe(true);
      expect(isEntityOwner(name)).toBe(true);
    }
  });

  it('does not widen the mailing-address gate', () => {
    // A link-only token makes a name linkable without publishing its tax mailing address.
    expect(isEntityOwner('EXAMPLE MANAGEMENT')).toBe(true);
    expect(showMailingAddress('EXAMPLE MANAGEMENT')).toBe(false);
  });
});

describe('isResidentialAssessment', () => {
  it.each([
    ['R1', null],
    ['R2', null],
    ['R3', 'THREE-FAM DWELLING'],
    ['R4', null],
    ['RC', null],
    ['A', 'APT 7-30 UNITS'],
    ['a', 'apt 31-99 units'],
  ])('counts land use %s (%s) as residential', (landUse, landUseDescription) => {
    expect(isResidentialAssessment({ landUse, landUseDescription })).toBe(true);
  });

  it.each([
    ['A', 'DORMITORY bd'],
    ['A', null],
    ['C', 'COMMERCIAL'],
    ['CD', 'RESIDENTIAL CONDO'],
    ['E', 'EXEMPT'],
    [null, null],
  ])('does not count land use %s (%s)', (landUse, landUseDescription) => {
    expect(isResidentialAssessment({ landUse, landUseDescription })).toBe(false);
  });
});

describe('linkableOwnerKey', () => {
  const entity = { owner: 'Sample Holdings, L.L.C.', condominium: false };
  const person = { owner: 'DOE JANE', condominium: false };

  it('links an entity owner whatever the parcel count', () => {
    expect(linkableOwnerKey(entity, 0)).toBe('SAMPLE HOLDINGS LLC');
    expect(linkableOwnerKey(entity, 1)).toBe('SAMPLE HOLDINGS LLC');
  });

  it('links a person only at two or more residential parcels', () => {
    expect(MIN_PARCELS_FOR_PERSON).toBe(2);
    expect(linkableOwnerKey(person, 0)).toBeNull();
    expect(linkableOwnerKey(person, 1)).toBeNull();
    expect(linkableOwnerKey(person, 2)).toBe('DOE JANE');
  });

  it('never links a condominium parcel, which shows no single owner', () => {
    expect(linkableOwnerKey({ ...entity, condominium: true }, 5)).toBeNull();
    expect(linkableOwnerKey({ ...person, condominium: true }, 5)).toBeNull();
  });

  it('never links a missing owner', () => {
    expect(linkableOwnerKey({ owner: null, condominium: false }, 5)).toBeNull();
    expect(linkableOwnerKey({ owner: '  ', condominium: false }, 5)).toBeNull();
  });

  it('gates a typed key the same way, since a key normalizes to itself', () => {
    for (const name of ['Sample Holdings, L.L.C.', 'Example Realty, L.P.', 'Doe, Jane']) {
      const key = ownerKey(name);
      expect(ownerKey(key)).toBe(key);
    }
    const typedPerson = { owner: 'doe jane', condominium: false };
    expect(linkableOwnerKey(typedPerson, 1)).toBeNull();
    expect(linkableOwnerKey(typedPerson, 2)).toBe('DOE JANE');
    expect(linkableOwnerKey({ owner: 'sample holdings llc', condominium: false }, 0)).toBe('SAMPLE HOLDINGS LLC');
  });
});

describe('ownerRowFromAssessment', () => {
  const assessment = {
    fiscalYear: 'FY2026',
    parcelId: '0100001000',
    owner: '  Example Realty, L.P. ',
    condominium: false,
    landUse: 'R3',
    landUseDescription: 'THREE-FAM DWELLING',
  };

  it('keeps the owner as recorded beside its key and both flags', () => {
    expect(ownerRowFromAssessment('b-1', assessment)).toEqual({
      buildingId: 'b-1',
      fiscalYear: 'FY2026',
      parcelId: '0100001000',
      owner: 'Example Realty, L.P.',
      ownerKey: 'EXAMPLE REALTY LP',
      isEntity: 1,
      residential: 1,
    });
    expect(ownerRowFromAssessment('b-2', { ...assessment, owner: 'DOE JANE', landUse: 'C', landUseDescription: 'COMMERCIAL' })).toMatchObject({
      ownerKey: 'DOE JANE',
      isEntity: 0,
      residential: 0,
    });
  });

  it('has no row for a condominium or a blank owner', () => {
    expect(ownerRowFromAssessment('b-1', { ...assessment, condominium: true })).toBeNull();
    expect(ownerRowFromAssessment('b-1', { ...assessment, owner: null })).toBeNull();
    expect(ownerRowFromAssessment('b-1', { ...assessment, owner: ' , ' })).toBeNull();
  });

  it('stores a blank parcel id as null, so the person rule never counts it', () => {
    expect(ownerRowFromAssessment('b-1', { ...assessment, parcelId: '  ' })?.parcelId).toBeNull();
  });
});
