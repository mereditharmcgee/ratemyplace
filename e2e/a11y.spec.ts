import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { executeLocalD1 } from './test-harness';
import { prepare, rateAllItemsInStep } from './review-helpers';
import { FY2026_RESOURCE_ID } from '../src/lib/records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../src/lib/records/sources/boston/permits';
import { VIOLATIONS_RESOURCE_ID } from '../src/lib/records/sources/boston/violations';
import { ENFORCEMENT_RESOURCE_ID } from '../src/lib/records/sources/boston/enforcement';
import { NEW_311_RESOURCE_ID } from '../src/lib/records/sources/boston/serviceRequests';
import { RENTSMART_RESOURCE_ID } from '../src/lib/records/sources/boston/rentsmart';
import type {
  AssessmentPayload,
  PermitPayload,
  RecordKind,
  ServiceRequestPayload,
  ViolationPayload,
} from '../src/lib/records/types';

// Phase 28 (A11Y-01) automated baseline. axe runs the WCAG 2.0 and 2.1 A and AA rules over the
// public contribution path (home, search, auth, every review step, the building page) and over
// representative landlord, profile and admin pages, at 1280x900 and 375x812.
//
// For now it RECORDS and asserts nothing. Each scan is written to A11Y_BASELINE_OUT (default
// test-results/a11y-baseline.json) with a per-rule summary. When the A11Y-08 fixes land, set
// ENFORCE_CONTRIBUTION_PATH to true and every contribution-path scan must have zero serious
// or critical violations.
//
// Local only, like every spec here. Google Maps and Places are refused at the browser and the
// two Places proxies answer with one fictional suggestion, so no Google API is called. Turnstile
// is the e2e stub. The review walk never submits: the one Submit press is answered by a routed
// 500. The only database write is a synthetic city-records fixture on one seed building, so the
// records ledger has rows to open; it is removed in afterAll.

const ENFORCE_CONTRIBUTION_PATH = false;

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
] as const;
type Viewport = (typeof VIEWPORTS)[number];

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.A11Y_BASELINE_OUT ?? path.join(PROJECT_ROOT, 'test-results', 'a11y-baseline.json');

// Seed data (scripts/db-seed.ts). building-01 has the most reviews and several unit cards;
// building-30 has none and is the one the review specs walk; review-001 belongs to the seed user.
const BUILDING_ID = 'building-01';
const BUILDING_SLUG = '12-brighton-ave';
const SEED_REVIEW_ID = 'review-001';
const REVIEW_BUILDING_ID = 'building-30';
const LANDLORD_SLUG = 'allston-management-group-llc';

// --- Recording ---

type Surface = 'public' | 'signed-in' | 'admin';

interface Target {
  page: string;
  state: string;
  surface: Surface;
  /** Home, search, auth, review and building: the A11Y-08 gate. */
  contributionPath: boolean;
}

interface NodeRecord {
  target: string;
  html: string;
  failureSummary: string;
}

interface ViolationRecord {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  nodeCount: number;
  nodes: NodeRecord[];
}

interface ScanRecord extends Target {
  key: string;
  viewport: Viewport['name'];
  url: string;
  scannedAt: string;
  axeVersion: string | null;
  /** The page is wider than the viewport, which is what a 375px check looks for. */
  horizontalOverflow: boolean;
  violations: ViolationRecord[];
  incomplete: { id: string; impact: string | null; nodeCount: number }[];
  passCount: number;
  error?: string;
}

interface RuleSummary {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  totalNodes: number;
  onContributionPath: boolean;
  pages: string[];
  viewports: string[];
  scans: { key: string; nodes: number }[];
  sampleTargets: string[];
}

interface Baseline {
  /** The Playwright runner's pid: scans from an earlier run are dropped, not merged. */
  runnerPid: number;
  startedAt: string;
  axeVersion: string | null;
  tags: string[];
  scans: ScanRecord[];
  summary: RuleSummary[];
}

const MAX_NODES_PER_VIOLATION = 25;
const MAX_SAMPLE_TARGETS = 8;

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function loadBaseline(): Baseline {
  // A failed test restarts the worker and loses module state, so the file is the record and
  // each scan is merged into it. The runner's pid tells this run's file from a stale one.
  if (existsSync(OUT)) {
    try {
      const saved = JSON.parse(readFileSync(OUT, 'utf8')) as Baseline;
      if (saved.runnerPid === process.ppid) return saved;
    } catch {
      // An unreadable file is replaced.
    }
  }
  return {
    runnerPid: process.ppid,
    startedAt: new Date().toISOString(),
    axeVersion: null,
    tags: AXE_TAGS,
    scans: [],
    summary: [],
  };
}

function summarize(scans: ScanRecord[]): RuleSummary[] {
  const byRule = new Map<string, RuleSummary>();
  for (const scan of scans) {
    for (const violation of scan.violations) {
      let rule = byRule.get(violation.id);
      if (!rule) {
        rule = {
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          helpUrl: violation.helpUrl,
          totalNodes: 0,
          onContributionPath: false,
          pages: [],
          viewports: [],
          scans: [],
          sampleTargets: [],
        };
        byRule.set(violation.id, rule);
      }
      rule.totalNodes += violation.nodeCount;
      rule.onContributionPath ||= scan.contributionPath;
      if (!rule.pages.includes(scan.page)) rule.pages.push(scan.page);
      if (!rule.viewports.includes(scan.viewport)) rule.viewports.push(scan.viewport);
      rule.scans.push({ key: scan.key, nodes: violation.nodeCount });
      for (const node of violation.nodes) {
        if (rule.sampleTargets.length >= MAX_SAMPLE_TARGETS) break;
        if (!rule.sampleTargets.includes(node.target)) rule.sampleTargets.push(node.target);
      }
    }
  }
  const rank: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  return [...byRule.values()].sort(
    (a, b) => (rank[a.impact ?? ''] ?? 4) - (rank[b.impact ?? ''] ?? 4) || b.totalNodes - a.totalNodes,
  );
}

function recordScan(scan: ScanRecord): void {
  const baseline = loadBaseline();
  baseline.scans = baseline.scans.filter((saved) => saved.key !== scan.key).concat(scan);
  baseline.axeVersion ??= scan.axeVersion;
  baseline.summary = summarize(baseline.scans);
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(baseline, null, 2)}\n`);
}

// --- Page handling ---
// prepare() (viewport plus the Google refusal and the Places routes) is in review-helpers.ts.

/** Let islands hydrate and transitions finish, so axe sees what a reader sees. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  // client:load and client:idle islands drop their ssr attribute once hydrated. client:visible
  // ones wait for the viewport, so they are left out and the wait is bounded either way.
  await page
    .waitForFunction(
      () => document.querySelectorAll('astro-island[ssr]:not([client="visible"])').length === 0,
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(300);
}

/** Scroll to the foot and back so client:visible islands below the fold hydrate too. */
async function hydrateBelowFold(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function scan(page: Page, viewport: Viewport, target: Target): Promise<void> {
  await settle(page);
  const url = new URL(page.url());
  const key = `${target.page} | ${target.state} | ${viewport.name}`;
  const base = {
    ...target,
    key,
    viewport: viewport.name,
    url: url.pathname + url.search,
    scannedAt: new Date().toISOString(),
  };
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  try {
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    const violations: ViolationRecord[] = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodeCount: violation.nodes.length,
      nodes: violation.nodes.slice(0, MAX_NODES_PER_VIOLATION).map((node) => ({
        target: node.target.map(String).join(' '),
        html: truncate(node.html, 240),
        failureSummary: truncate(node.failureSummary ?? '', 400),
      })),
    }));
    recordScan({
      ...base,
      axeVersion: results.testEngine.version,
      horizontalOverflow,
      violations,
      incomplete: results.incomplete.map((item) => ({
        id: item.id,
        impact: item.impact ?? null,
        nodeCount: item.nodes.length,
      })),
      passCount: results.passes.length,
    });

    if (ENFORCE_CONTRIBUTION_PATH && target.contributionPath) {
      const blocking = violations
        .filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''))
        .map((violation) => `${violation.id} (${violation.impact}, ${violation.nodeCount} nodes)`);
      expect.soft(blocking, `serious or critical axe findings on ${key}`).toEqual([]);
    }
  } catch (error) {
    recordScan({
      ...base,
      axeVersion: null,
      horizontalOverflow,
      violations: [],
      incomplete: [],
      passCount: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    if (ENFORCE_CONTRIBUTION_PATH) throw error;
  }
}

function button(page: Page, text: string) {
  return page.locator('button[type="button"]', { hasText: text });
}

async function waitForEnabled(page: Page, text: string): Promise<void> {
  await page.waitForFunction(
    (label) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="button"]')).some(
        (candidate) => candidate.textContent?.includes(label) && !candidate.disabled,
      ),
    text,
    { timeout: 10_000 },
  );
}

// --- Synthetic city records on one seed building ---

const FIXTURE_PREFIX = 'e2e-a11y-';

interface FixturePull {
  id: string;
  sourceId: string;
  label: string;
  status: 'ok' | 'empty';
  records: { kind: RecordKind; key: string; payload: object }[];
}

const assessment: AssessmentPayload = {
  fiscalYear: 'FY2026',
  parcelId: '0000000001',
  owner: 'EXAMPLE OWNER LLC',
  mailAddressee: null,
  mailStreet: null,
  mailCity: null,
  mailState: null,
  mailZip: null,
  landUse: 'R3',
  landUseDescription: 'Three-family dwelling',
  yearBuilt: 1910,
  yearRemodel: 1995,
  grossArea: 4200,
  livingArea: 3300,
  residentialUnits: 3,
  commercialUnits: 0,
  totalValue: 1_250_000,
  landValue: 450_000,
  buildingValue: 800_000,
  condominium: false,
};

function permit(n: number, issuedDate: string, status: string): PermitPayload {
  return {
    permitNumber: `E2E-PERMIT-${n}`,
    workType: 'Interior work',
    permitType: 'Short Form Building Permit',
    description: 'Replace kitchen cabinets and counters',
    comments: null,
    applicant: null,
    declaredValuation: 18_000,
    totalFees: 240,
    issuedDate,
    expirationDate: null,
    status,
    occupancyType: '3unit',
    address: null,
  };
}

const violation: ViolationPayload = {
  caseNumber: 'E2E-V-1',
  code: '105.1',
  value: null,
  description: 'Failure to obtain a permit',
  status: 'Open',
  statusDate: '2025-06-01',
  address: null,
  contactAddress: null,
  samId: null,
};

function serviceRequest(n: number, openedAt: string, closedAt: string | null): ServiceRequestPayload {
  return {
    caseId: `E2E-SR-${n}`,
    system: 'new',
    openedAt,
    closedAt,
    status: closedAt ? 'Closed' : 'Open',
    closureReason: closedAt ? 'Case resolved' : null,
    title: 'Heat - excessive or insufficient',
    subject: 'Inspectional Services',
    reason: 'Housing',
    type: 'Heat - Excessive Insufficient',
    location: null,
    source: 'Constituent Call',
    classification: 'housing',
  };
}

const FIXTURE_PULLS: FixturePull[] = [
  {
    id: `${FIXTURE_PREFIX}pull-assessor`,
    sourceId: FY2026_RESOURCE_ID,
    label: 'Property Assessment FY2026',
    status: 'ok',
    records: [{ kind: 'assessment', key: 'FY2026:0000000001', payload: assessment }],
  },
  {
    id: `${FIXTURE_PREFIX}pull-permits`,
    sourceId: PERMITS_RESOURCE_ID,
    label: 'Approved Building Permits',
    status: 'ok',
    records: [
      { kind: 'permit', key: 'E2E-PERMIT-1', payload: permit(1, '2024-03-04', 'Closed') },
      { kind: 'permit', key: 'E2E-PERMIT-2', payload: permit(2, '2025-09-12', 'Open') },
    ],
  },
  {
    id: `${FIXTURE_PREFIX}pull-violations`,
    sourceId: VIOLATIONS_RESOURCE_ID,
    label: 'Building and Property Violations',
    status: 'ok',
    records: [{ kind: 'violation', key: 'E2E-V-1', payload: violation }],
  },
  {
    id: `${FIXTURE_PREFIX}pull-enforcement`,
    sourceId: ENFORCEMENT_RESOURCE_ID,
    label: 'Public Works Code Enforcement',
    status: 'empty',
    records: [],
  },
  {
    id: `${FIXTURE_PREFIX}pull-311`,
    sourceId: NEW_311_RESOURCE_ID,
    label: '311 Service Requests',
    status: 'ok',
    records: [
      { kind: 'service_request', key: 'E2E-SR-1', payload: serviceRequest(1, '2025-01-10T10:00:00', '2025-01-12T16:00:00') },
      { kind: 'service_request', key: 'E2E-SR-2', payload: serviceRequest(2, '2025-11-02T09:00:00', null) },
    ],
  },
  {
    id: `${FIXTURE_PREFIX}pull-rentsmart`,
    sourceId: RENTSMART_RESOURCE_ID,
    label: 'RentSmart',
    status: 'empty',
    records: [],
  },
];

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const REMOVE_RECORDS_FIXTURE = [
  `DELETE FROM building_records WHERE id LIKE '${FIXTURE_PREFIX}%'`,
  `DELETE FROM record_pulls WHERE id LIKE '${FIXTURE_PREFIX}%'`,
].join('; ');

function seedRecordsFixture(): void {
  const now = Math.floor(Date.now() / 1000);
  const statements: string[] = [REMOVE_RECORDS_FIXTURE];
  for (const pull of FIXTURE_PULLS) {
    statements.push(
      'INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, retrieved_at) ' +
        `VALUES (${sqlText(pull.id)}, ${sqlText(BUILDING_ID)}, 'boston', ${sqlText(pull.sourceId)}, ${sqlText(pull.label)}, ` +
        `'e2e fixture', ${sqlText(pull.status)}, ${pull.records.length}, ${now})`,
    );
    for (const record of pull.records) {
      statements.push(
        'INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload) ' +
          `VALUES (${sqlText(`${FIXTURE_PREFIX}${record.key}`)}, ${sqlText(BUILDING_ID)}, ${sqlText(pull.id)}, ` +
          `${sqlText(record.kind)}, ${sqlText(record.key)}, ${sqlText(JSON.stringify(record.payload))})`,
      );
    }
  }
  executeLocalD1(statements.join('; '));
}

test.beforeAll(() => {
  seedRecordsFixture();
});

test.afterAll(() => {
  executeLocalD1(REMOVE_RECORDS_FIXTURE);
  const baseline = loadBaseline();
  const lines = baseline.summary.map(
    (rule) => `  ${rule.impact ?? 'n/a'}  ${rule.id}  nodes=${rule.totalNodes}  pages=${rule.pages.join(', ')}`,
  );
  console.log(`[a11y] ${baseline.scans.length} scans recorded to ${OUT}\n${lines.join('\n')}`);
});

// --- Scans ---

for (const viewport of VIEWPORTS) {
  test.describe(`axe baseline at ${viewport.width}x${viewport.height}`, () => {
    test(`home (${viewport.name})`, async ({ page }) => {
      test.setTimeout(60_000);
      await prepare(page, viewport);
      const target = { page: 'home', surface: 'public', contributionPath: true } as const;

      await page.goto('/');
      await scan(page, viewport, { ...target, state: 'default' });

      // One of ours plus one routed Google suggestion, so both dropdown groups render.
      await page.getByRole('combobox', { name: 'Search by address, neighborhood, or landlord' }).fill('78 Linden');
      await page.getByText('Other addresses').waitFor({ timeout: 10_000 });
      await scan(page, viewport, { ...target, state: 'address suggestions open' });

      if (viewport.name === 'mobile') {
        await page.keyboard.press('Escape');
        await page.goto('/');
        await settle(page);
        await page.locator('#mobile-menu-button').click();
        await page.locator('#mobile-menu').waitFor();
        await scan(page, viewport, { ...target, state: 'mobile menu open' });
      }
    });

    test(`search (${viewport.name})`, async ({ page }) => {
      test.setTimeout(60_000);
      await prepare(page, viewport);
      const target = { page: 'search', surface: 'public', contributionPath: true } as const;

      await page.goto('/search');
      await scan(page, viewport, { ...target, state: 'empty' });

      await page.goto('/search?q=Brighton');
      await scan(page, viewport, { ...target, state: 'query "Brighton"' });
    });

    test(`building page (${viewport.name})`, async ({ page }) => {
      test.setTimeout(90_000);
      await prepare(page, viewport);
      const target = { page: 'building', surface: 'public', contributionPath: true } as const;

      await page.goto(`/building/${BUILDING_SLUG}`);
      await scan(page, viewport, { ...target, state: 'default' });

      // Open every disclosure: the unit cards (clickable divs today) and every <details>,
      // which covers the records ledger rows and the report-a-record form.
      const closedCards = page.locator('.unit-card[data-expanded="false"]');
      for (let guard = 0; guard < 20 && (await closedCards.count()) > 0; guard++) {
        await closedCards.first().click();
      }
      await page.evaluate(() => {
        document.querySelectorAll('details:not([open])').forEach((details) => {
          (details as HTMLDetailsElement).open = true;
        });
      });
      await hydrateBelowFold(page);
      await scan(page, viewport, { ...target, state: 'all disclosures open' });
    });

    test(`building page after submitting (${viewport.name})`, async ({ authedPage: page }) => {
      test.setTimeout(60_000);
      await prepare(page, viewport);
      const target = { page: 'building (after submit)', surface: 'signed-in', contributionPath: true } as const;

      await page.goto(`/building/${BUILDING_SLUG}?submitted=true&reviewId=${SEED_REVIEW_ID}`);
      await scan(page, viewport, { ...target, state: 'submitted banner' });

      await page.getByRole('button', { name: 'Verify Now' }).click();
      await page.getByRole('heading', { name: 'Verify Your Tenancy' }).waitFor();
      await scan(page, viewport, { ...target, state: 'verification dialog open' });
    });

    test(`landlord page (${viewport.name})`, async ({ page }) => {
      await prepare(page, viewport);
      await page.goto(`/landlord/${LANDLORD_SLUG}`);
      await scan(page, viewport, { page: 'landlord', state: 'default', surface: 'public', contributionPath: false });
    });

    test(`auth pages (${viewport.name})`, async ({ page }) => {
      test.setTimeout(60_000);
      await prepare(page, viewport);
      for (const [label, url] of [
        ['auth: sign in', '/auth/signin'],
        ['auth: sign up', '/auth/signup'],
        ['auth: forgot password', '/auth/forgot-password'],
      ] as const) {
        await page.goto(url);
        await scan(page, viewport, { page: label, state: 'default', surface: 'public', contributionPath: true });
      }
    });

    test(`review form, every step (${viewport.name})`, async ({ authedPage: page }) => {
      test.setTimeout(150_000);
      await prepare(page, viewport);
      const at = (step: string, state: string) =>
        ({ page: `review: ${step}`, state, surface: 'signed-in', contributionPath: true }) as const;

      // The address step and its autocomplete.
      await page.goto('/review/new');
      const addressInput = page.locator('input[placeholder="Start typing your address..."]');
      await addressInput.waitFor();
      await scan(page, viewport, at('address', 'empty'));

      await addressInput.fill('45 Melnea');
      await page.getByText('Existing properties').waitFor({ timeout: 10_000 });
      await page.getByText('Powered by Google').waitFor({ timeout: 10_000 });
      await scan(page, viewport, at('address', 'suggestions open'));

      await page.getByRole('option', { name: /Enter it manually/ }).click();
      await page.locator('#review-street-address').waitFor();
      await scan(page, viewport, at('address', 'manual entry'));

      // A known building opens at unit details. Every answer below is a valid one.
      await page.goto(`/review/new?building=${REVIEW_BUILDING_ID}`);
      await page.locator('#review-bedrooms').waitFor({ timeout: 15_000 });
      await scan(page, viewport, at('unit details', 'defaults'));
      await button(page, 'Continue').click();

      await page.getByRole('heading', { name: 'Rate Your Unit' }).waitFor();
      await scan(page, viewport, at('unit rating', 'unanswered'));
      await rateAllItemsInStep(page, 4);
      await scan(page, viewport, at('unit rating', 'answered'));
      await button(page, 'Continue').click();

      await page.getByRole('heading', { name: 'Rate the Building' }).waitFor();
      await rateAllItemsInStep(page, 4);
      await scan(page, viewport, at('building rating', 'answered'));
      await button(page, 'Continue').click();

      await page.getByRole('heading', { name: 'Rate Your Landlord' }).waitFor();
      await rateAllItemsInStep(page, 4);
      await scan(page, viewport, at('landlord rating', 'answered'));
      await button(page, 'Continue').click();

      await page.getByText('How long did you live').first().waitFor();
      await page.locator('textarea').first().fill('Quiet building and a responsive landlord.');
      await scan(page, viewport, at('additional', 'answered'));
      await button(page, 'Review & Submit').click();

      await page.getByRole('heading', { name: 'Review Summary' }).waitFor();
      await page.locator('input[type="checkbox"]').check();
      await waitForEnabled(page, 'Submit Review');
      await scan(page, viewport, at('confirm', 'ready to submit'));

      // The one Submit press is answered here with a 500 and never reaches the server.
      await page.route(
        (url) => url.pathname === '/api/reviews',
        (route) =>
          route.request().method() === 'POST'
            ? route.fulfill({ status: 500, json: { error: 'Failed to submit review' } })
            : route.continue(),
      );
      await button(page, 'Submit Review').click();
      await page.getByText('Failed to submit review').waitFor({ timeout: 10_000 });
      await scan(page, viewport, at('confirm', 'submit failed'));
    });

    test(`profile (${viewport.name})`, async ({ authedPage: page }) => {
      test.setTimeout(60_000);
      await prepare(page, viewport);
      const target = { page: 'profile', surface: 'signed-in', contributionPath: false } as const;

      await page.goto('/profile?updated=true');
      await page.getByRole('button', { name: /My Reviews/ }).waitFor();
      await scan(page, viewport, { ...target, state: 'reviews tab, updated banner' });

      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await scan(page, viewport, { ...target, state: 'settings tab' });

      await page.getByRole('button', { name: /My Reviews/ }).click();
      await page.getByRole('button', { name: 'Verify', exact: true }).first().click();
      await page.getByRole('heading', { name: 'Verify Your Tenancy' }).waitFor();
      await scan(page, viewport, { ...target, state: 'verification dialog open' });
    });

    test(`admin pages (${viewport.name})`, async ({ adminPage: page }) => {
      test.setTimeout(90_000);
      await prepare(page, viewport);
      const at = (label: string, state: string) =>
        ({ page: label, state, surface: 'admin', contributionPath: false }) as const;

      await page.goto('/admin');
      await scan(page, viewport, at('admin: dashboard', 'default'));

      await page.goto('/admin/reviews');
      await page.locator('button').filter({ hasText: /All \(/ }).waitFor();
      await page.locator('.cursor-pointer').first().click();
      await page.locator('button', { hasText: 'Reset to Pending' }).first().waitFor();
      await scan(page, viewport, at('admin: reviews', 'first row expanded'));

      await page.goto('/admin/buildings');
      await page.locator('.cursor-pointer').first().waitFor();
      await scan(page, viewport, at('admin: buildings', 'default'));
      await page.locator('.cursor-pointer').first().click();
      await scan(page, viewport, at('admin: buildings', 'first row expanded'));
    });
  });
}
