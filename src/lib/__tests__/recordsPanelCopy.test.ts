import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BANNED_WORDS } from '../records/display';

// The panel is spread across the entry component and the section pieces it composes, so the
// scan reads all of them. Anything added to src/components/records is covered automatically —
// a new section extracted tomorrow cannot slip out from under this. The islands are scanned
// with them: the request button and the correction form both write on the reader-facing
// surface, so their copy answers to the same rule.
const PANEL_FILES = [
  join(process.cwd(), 'src/components/BuildingRecords.astro'),
  ...readdirSync(join(process.cwd(), 'src/components/records'))
    .filter((name) => name.endsWith('.astro') || name.endsWith('.tsx'))
    .map((name) => join(process.cwd(), 'src/components/records', name)),
];

const source = PANEL_FILES.map((path) => readFileSync(path, 'utf8')).join('\n');

/** Word-boundary alternation over the banned list. Built from a plain string so the escapes survive. */
const bannedPattern = new RegExp('\\b(' + BANNED_WORDS.join('|') + ')\\b', 'i');

describe('BuildingRecords.astro display rules', () => {
  it('scans every file that makes up the panel', () => {
    expect(PANEL_FILES.length).toBeGreaterThan(1);
    // Every piece the panel is assembled from, named so a rename that quietly drops one out
    // of the scan is a failure rather than a silently smaller surface.
    for (const name of [
      'CorrectionNotes.astro',
      'FactsStrip.astro',
      'LedgerRow.astro',
      'YearBars.astro',
      'CategoryBars.astro',
      'StatusToken.astro',
      'SourceState.astro',
      'RecordList.astro',
      'RecordsRequestButton.tsx',
      'RecordCorrectionForm.tsx',
    ]) {
      expect(PANEL_FILES.some((path) => path.endsWith(name))).toBe(true);
    }
  });
  it('builds a pattern that genuinely matches a banned word', () => {
    expect(bannedPattern.test('there is a pattern of delay here')).toBe(true);
    expect(bannedPattern.test('nothing to see')).toBe(false);
  });
  it('contains none of the banned characterizations', () => {
    expect(source).not.toMatch(bannedPattern);
  });
  it('never imports score colors or links to reviews and scores', () => {
    expect(source).not.toMatch(/scoring-colors/);
    expect(source).not.toMatch(/getScore(Text)?Color|getScoreBgTint/);
    expect(source).not.toMatch(/#review-|ScoreCard/);
  });
  it('routes every date and dollar value through the display helpers', () => {
    expect(source).toMatch(/formatRecordDate\(/);
    expect(source).toMatch(/formatPullDate\(/);
    expect(source).toMatch(/formatDollars\(/);
    expect(source).not.toMatch(/toLocaleDateString/);
  });
  it('gates the mailing address and condominium owner', () => {
    expect(source).toMatch(/showMailingAddress\(/);
    expect(source).toMatch(/mailingAddressLine\(/);
    expect(source).toMatch(/CONDOMINIUM_COPY/);
  });
});
