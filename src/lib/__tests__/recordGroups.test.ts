import { describe, expect, it } from 'vitest';
import {
  RECORD_GROUPS,
  SERVICE_REQUEST_TYPE_GROUPS,
  groupServiceRequests,
  normalizeRequestType,
  serviceRequestGroup,
  type RecordGroupId,
} from '../records/recordGroups';
import { classifyLegacy, classifyNew } from '../records/sources/boston/serviceRequests';
import type { ServiceRequestPayload } from '../records/types';

/**
 * The table that sorts 311 requests into the panel's three groups. It runs at render time over
 * stored payloads and never touches the pull-time classification, which the daily fixture check
 * reads. These tests pin the groups the owner decided, the types the brief named, and the floor
 * that nothing the pull calls housing can fall out of the listed groups.
 */

function legacy(reason: string, type: string, overrides: Partial<ServiceRequestPayload> = {}): ServiceRequestPayload {
  return {
    caseId: `L-${type}`,
    system: 'legacy',
    openedAt: null,
    closedAt: null,
    status: null,
    closureReason: null,
    title: type,
    subject: null,
    reason,
    type,
    location: null,
    source: null,
    classification: classifyLegacy(reason),
    ...overrides,
  };
}

function newSystem(department: string, service: string, overrides: Partial<ServiceRequestPayload> = {}): ServiceRequestPayload {
  return {
    caseId: `N-${service}`,
    system: 'new',
    openedAt: null,
    closedAt: null,
    status: null,
    closureReason: null,
    title: service,
    subject: department,
    reason: department,
    type: service,
    location: null,
    source: null,
    classification: classifyNew(department),
    ...overrides,
  };
}

describe('RECORD_GROUPS', () => {
  it('lists the three groups in the order the owner set', () => {
    expect(RECORD_GROUPS.map((group) => group.title)).toEqual([
      'Living conditions',
      'Building safety and code',
      'Property upkeep',
    ]);
  });

  it('describes each group in plain words with no em dash or exclamation point', () => {
    for (const group of RECORD_GROUPS) {
      expect(group.description.length).toBeGreaterThan(0);
      expect(group.description).not.toMatch(/[—!]/);
    }
  });
});

describe('serviceRequestGroup', () => {
  it.each([
    ['Housing', 'Heat - Excessive  Insufficient'],
    ['Housing', 'No Utilities Residential - Water'],
    ['Housing', 'Mice Infestation - Residential'],
    ['Housing', 'Pest Infestation - Residential'],
    ['Housing', 'Bed Bugs'],
    ['Housing', 'Chronic Dampness/Mold'],
    ['Housing', 'Unsatisfactory Living Conditions'],
    ['Housing', 'Maintenance Complaint - Residential'],
    ['Building', 'Unsafe Dangerous Conditions'],
  ])('puts a %s request for %s in living conditions', (reason, type) => {
    expect(serviceRequestGroup(legacy(reason, type))).toBe('living');
  });

  it('counts Inspectional Services rodent activity under living conditions, though the pull files it as other', () => {
    const row = legacy('Environmental Services', 'Rodent Activity', { subject: 'Inspectional Services' });
    expect(row.classification).toBe('other');
    expect(serviceRequestGroup(row)).toBe('living');
  });

  it.each([
    ['Building', 'Work w/out Permit'],
    ['Building', 'Contractors Complaint'],
    ['Building', 'Building Inspection Request'],
    ['Building', 'Illegal Occupancy'],
    ['Housing', 'Short Term Rental'],
  ])('puts a %s request for %s in building safety and code', (reason, type) => {
    expect(serviceRequestGroup(legacy(reason, type))).toBe('building');
  });

  it.each([
    ['Code Enforcement', 'Unshoveled Sidewalk'],
    ['Code Enforcement', 'Improper Storage of Trash (Barrels)'],
    ['Code Enforcement', 'Illegal Dumping'],
    ['Code Enforcement', 'Poor Conditions of Property'],
  ])('puts a %s request for %s in property upkeep', (reason, type) => {
    expect(serviceRequestGroup(legacy(reason, type))).toBe('upkeep');
  });

  it("groups the new 311 system's Public Works trash and dumping requests with their legacy names", () => {
    expect(serviceRequestGroup(newSystem('Public Works Department (PWD)', 'Improper Trash Storage'))).toBe('upkeep');
    expect(serviceRequestGroup(newSystem('Public Works Department (PWD)', 'Illegal Dumping or Disposal'))).toBe('upkeep');
  });

  it.each([
    ['Enforcement & Abandoned Vehicles', 'Parking Enforcement'],
    ['Street Cleaning', 'Requests for Street Cleaning'],
    ['Sanitation', 'Missed Trash/Recycling/Yard Waste/Bulk Item'],
    ['Street Lights', 'Street Light Outages'],
    ['Highway Maintenance', 'Sidewalk Repair (Make Safe)'],
    ['Highway Maintenance', 'Contractor Complaints'],
    ['Health', 'Unsanitary Conditions - Establishment'],
    ['Environmental Services', 'Mosquitoes (West Nile)'],
  ])('leaves a %s request for %s as other', (reason, type) => {
    expect(serviceRequestGroup(legacy(reason, type))).toBeNull();
  });

  it('leaves new-system Public Works requests that are not about the property as other', () => {
    expect(serviceRequestGroup(newSystem('Public Works Department (PWD)', 'Street Light Outage'))).toBeNull();
    expect(serviceRequestGroup(newSystem('Public Works Department (PWD)', 'Litter & Debris'))).toBeNull();
  });

  it('ignores case, punctuation and repeated spaces in the recorded type', () => {
    expect(serviceRequestGroup(legacy('Housing', 'HEAT - EXCESSIVE, INSUFFICIENT'))).toBe('living');
    expect(serviceRequestGroup(legacy('Housing', 'chronic dampness / mold'))).toBe('living');
    expect(normalizeRequestType('  Work w/out   Permit ')).toBe('work w out permit');
  });

  it('reads the case title when the type is blank', () => {
    expect(serviceRequestGroup(legacy('Housing', 'Bed Bugs', { type: null, title: 'Bed Bugs' }))).toBe('living');
  });

  it('never drops a request the pull counts as housing, even with a type the table does not know', () => {
    expect(serviceRequestGroup(legacy('Housing', 'A New Housing Type'))).toBe('living');
    expect(serviceRequestGroup(legacy('Building', 'A New Building Type'))).toBe('building');
    expect(serviceRequestGroup(legacy('Code Enforcement', 'A New Exterior Type'))).toBe('upkeep');
    expect(serviceRequestGroup(newSystem('Inspectional Services Department (ISD)', 'A New ISD Service'))).toBe('building');
  });

  it('places a new-system Inspectional Services request by its service name', () => {
    expect(serviceRequestGroup(newSystem('Inspectional Services Department (ISD)', 'Unsatisfactory Living Conditions'))).toBe(
      'living',
    );
  });
});

describe('SERVICE_REQUEST_TYPE_GROUPS', () => {
  it('puts no type in two groups', () => {
    const seen = new Map<string, RecordGroupId>();
    for (const group of Object.keys(SERVICE_REQUEST_TYPE_GROUPS) as RecordGroupId[]) {
      for (const type of SERVICE_REQUEST_TYPE_GROUPS[group]) {
        const key = normalizeRequestType(type);
        expect(seen.get(key), `${type} is listed twice`).toBeUndefined();
        seen.set(key, group);
      }
    }
  });

  it('places every listed type in the group it is listed under', () => {
    for (const group of Object.keys(SERVICE_REQUEST_TYPE_GROUPS) as RecordGroupId[]) {
      for (const type of SERVICE_REQUEST_TYPE_GROUPS[group]) {
        expect(serviceRequestGroup(legacy('Anything', type, { classification: 'other' }))).toBe(group);
      }
    }
  });
});

describe('groupServiceRequests', () => {
  it('puts every request in exactly one group or the other count, newest first', () => {
    const rows = [
      legacy('Housing', 'Heat - Excessive  Insufficient', { caseId: 'h-old', openedAt: '2016-01-10 08:00:00' }),
      legacy('Housing', 'Bed Bugs', { caseId: 'h-new', openedAt: '2024-03-02 08:00:00' }),
      legacy('Building', 'Work w/out Permit', { caseId: 'b', openedAt: '2020-05-01 08:00:00' }),
      legacy('Code Enforcement', 'Unshoveled Sidewalk', { caseId: 'u', openedAt: '2021-02-01 08:00:00' }),
      legacy('Street Cleaning', 'Requests for Street Cleaning', { caseId: 'o1' }),
      legacy('Enforcement & Abandoned Vehicles', 'Parking Enforcement', { caseId: 'o2' }),
    ];

    const grouped = groupServiceRequests(rows);

    expect(grouped.living.map((row) => row.caseId)).toEqual(['h-new', 'h-old']);
    expect(grouped.building.map((row) => row.caseId)).toEqual(['b']);
    expect(grouped.upkeep.map((row) => row.caseId)).toEqual(['u']);
    expect(grouped.otherCount).toBe(2);
    expect(grouped.living.length + grouped.building.length + grouped.upkeep.length + grouped.otherCount).toBe(rows.length);
  });

  it('handles an empty list', () => {
    expect(groupServiceRequests([])).toEqual({ living: [], building: [], upkeep: [], otherCount: 0 });
  });
});
