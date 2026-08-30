import { test, expect } from '@playwright/test';
import * as testHarness from './test-harness';

type BaseURLResolver = (configuredBaseURL?: string) => string;

function getBaseURLResolver(): BaseURLResolver {
  const resolver = Reflect.get(testHarness, 'resolveLocalE2EBaseURL');
  expect(typeof resolver).toBe('function');
  return resolver as BaseURLResolver;
}

test.describe('local E2E target guard', () => {
  test('defaults to and normalizes the approved local origin', () => {
    const resolveLocalE2EBaseURL = getBaseURLResolver();

    expect(resolveLocalE2EBaseURL()).toBe('http://localhost:8788');
    expect(resolveLocalE2EBaseURL('http://localhost:8788/')).toBe('http://localhost:8788');
  });

  test('rejects any target other than the exact local HTTP origin', () => {
    const resolveLocalE2EBaseURL = getBaseURLResolver();
    const rejectedTargets = [
      'https://ratemyplace.org',
      'https://localhost:8788',
      'http://127.0.0.1:8788',
      'http://localhost:8789',
      'http://localhost:8788/admin',
      'http://localhost:8788?unsafe=true',
      'not-a-url',
    ];

    for (const target of rejectedTargets) {
      expect(() => resolveLocalE2EBaseURL(target)).toThrow(/local E2E target/i);
    }
  });
});
