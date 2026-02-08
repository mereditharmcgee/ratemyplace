import { describe, it, expect } from 'vitest';
import {
  bedroomOptions,
  bathroomOptions,
  amenityOptions,
  utilityOptions,
  laundryTypeOptions,
} from '../formOptions';

// ═══════════════════════════════════════════════════
// Option structure validation
// ═══════════════════════════════════════════════════

describe('Option arrays have correct structure', () => {
  // Some arrays use { value, label }, others use { id, label }
  const valueOptions = [
    { name: 'bedroomOptions', options: bedroomOptions, keyProp: 'value' },
    { name: 'bathroomOptions', options: bathroomOptions, keyProp: 'value' },
    { name: 'laundryTypeOptions', options: laundryTypeOptions, keyProp: 'value' },
  ];

  const idOptions = [
    { name: 'amenityOptions', options: amenityOptions, keyProp: 'id' },
    { name: 'utilityOptions', options: utilityOptions, keyProp: 'id' },
  ];

  const allOptions = [...valueOptions, ...idOptions];

  for (const { name, options, keyProp } of allOptions) {
    describe(name, () => {
      it('is a non-empty array', () => {
        expect(Array.isArray(options)).toBe(true);
        expect(options.length).toBeGreaterThan(0);
      });

      it(`each option has ${keyProp} and label`, () => {
        for (const option of options) {
          expect(option).toHaveProperty(keyProp);
          expect(option).toHaveProperty('label');
          expect(typeof (option as any)[keyProp]).toBe('string');
          expect(typeof option.label).toBe('string');
          expect((option as any)[keyProp].length).toBeGreaterThan(0);
          expect(option.label.length).toBeGreaterThan(0);
        }
      });

      it('has no duplicate keys', () => {
        const keys = options.map((o: any) => o[keyProp]);
        const uniqueKeys = new Set(keys);
        expect(uniqueKeys.size).toBe(keys.length);
      });
    });
  }
});

// ═══════════════════════════════════════════════════
// Specific content validation
// ═══════════════════════════════════════════════════

describe('bedroomOptions', () => {
  it('includes studio', () => {
    expect(bedroomOptions.some(o => o.value === 'studio')).toBe(true);
  });

  it('includes 5+ bedrooms', () => {
    expect(bedroomOptions.some(o => o.value === '5+')).toBe(true);
  });

  it('has 6 options (studio through 5+)', () => {
    expect(bedroomOptions).toHaveLength(6);
  });
});

describe('amenityOptions', () => {
  it('has at least 5 amenities', () => {
    expect(amenityOptions.length).toBeGreaterThanOrEqual(5);
  });
});

describe('utilityOptions', () => {
  it('has at least 3 utilities', () => {
    expect(utilityOptions.length).toBeGreaterThanOrEqual(3);
  });
});

describe('laundryTypeOptions', () => {
  it('includes in-unit option', () => {
    expect(laundryTypeOptions.some(o => o.value.includes('unit'))).toBe(true);
  });

  it('includes no laundry option', () => {
    expect(laundryTypeOptions.some(o => o.value === 'none')).toBe(true);
  });
});
