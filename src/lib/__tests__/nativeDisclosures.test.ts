import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import LedgerRow from '../../components/records/LedgerRow.astro';
import ShowAll from '../../components/records/ShowAll.astro';

/**
 * Phase 28 (A11Y-07), decision 5: the records ledger rows, "Show all", "Report a record error"
 * and the six methodology weight cards stay native <details>/<summary>. A summary is already a
 * native control that reports its expanded state and works without script, so these need no
 * button, no aria-expanded and no aria-controls. This test keeps them native: a later change to
 * a div plus a click handler fails here.
 *
 * LedgerRow and ShowAll render in a container. The report form and the methodology page are
 * read as source, because each needs a database or a full page to render (the report form's
 * render is covered in buildingRecordsRender.test.ts).
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function parse(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

/** A summary that is the details' first element, holds no control, and is not re-roled. */
function expectNativeSummary(details: Element) {
  expect(details.tagName).toBe('DETAILS');
  const summary = details.firstElementChild;
  expect(summary?.tagName).toBe('SUMMARY');
  expect(summary!.hasAttribute('role')).toBe(false);
  expect(summary!.hasAttribute('tabindex')).toBe(false);
  expect(summary!.querySelector('a, button, input, select, textarea')).toBeNull();
  return summary as HTMLElement;
}

describe('records ledger row', () => {
  const props = {
    title: 'Building permits',
    status: null,
    hasRows: false,
    span: '2019-2025',
    count: '3',
    subCount: '1 open',
  };

  it('is a closed details whose summary carries the row title', async () => {
    const container = await AstroContainer.create();
    const root = parse(await container.renderToString(LedgerRow, { props, slots: { default: '<p>Rows</p>' } }));
    const details = root.querySelector('details')!;
    const summary = expectNativeSummary(details);
    expect(details.hasAttribute('open')).toBe(false);
    expect(summary.querySelector('h4')?.textContent).toBe('Building permits');
    // The chevron is decoration; the summary reports the state.
    expect(summary.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(summary.className).toContain('focus-visible:outline-teal-700');
  });

  it('can start open', async () => {
    const container = await AstroContainer.create();
    const root = parse(await container.renderToString(LedgerRow, { props: { ...props, open: true }, slots: { default: '<p>Rows</p>' } }));
    expect(root.querySelector('details')!.hasAttribute('open')).toBe(true);
  });
});

describe('records "Show all"', () => {
  it('is a details whose summary carries the label', async () => {
    const container = await AstroContainer.create();
    const root = parse(
      await container.renderToString(ShowAll, {
        props: { label: 'Show all 31 requests', rowCount: 31 },
        slots: { default: '<ul><li>Row</li></ul>' },
      }),
    );
    const details = root.querySelector('details.records-show-all')!;
    const summary = expectNativeSummary(details);
    expect(summary.textContent).toContain('Show all 31 requests');
    expect(details.hasAttribute('open')).toBe(false);
  });
});

describe('"Report a record error"', () => {
  const source = read('src/components/BuildingRecords.astro');

  it('is a native details with the heading in its summary', () => {
    const block = /<details id="report-record"[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(source);
    expect(block).not.toBeNull();
    expect(block![1]).toContain('Report a record error');
    expect(block![1]).not.toMatch(/<(a|button|input|select|textarea)\b/);
  });

  it('moves focus to the summary when the header link opens it', () => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(source)?.[1] ?? '';
    expect(script).toContain("querySelector('summary')");
    expect(script).toMatch(/\.focus\(/);
    expect(script).toContain('addEventListener(\'click\'');
  });
});

describe('methodology weight cards', () => {
  const source = read('src/pages/methodology.astro');

  it('are six native details, each opening with its summary', () => {
    const cards = Array.from(source.matchAll(/<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/g));
    expect(cards).toHaveLength(6);
    for (const [, summary] of cards) {
      expect(summary).toMatch(/<h3\b/);
      expect(summary).not.toMatch(/<(a|button|input|select|textarea)\b/);
      expect(summary).not.toMatch(/\brole=/);
    }
    // Nothing on the page turns a disclosure into a scripted div.
    expect(source).not.toMatch(/aria-expanded/);
  });
});
