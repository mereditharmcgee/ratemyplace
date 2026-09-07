import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANNED_WORDS } from '../records/display';

const source = readFileSync(join(process.cwd(), 'src/components/BuildingRecords.astro'), 'utf8');

describe('BuildingRecords.astro display rules', () => {
  it('contains none of the banned characterizations', () => {
    const pattern = new RegExp(`\b(${BANNED_WORDS.join('|')})\b`, 'i');
    expect(source).not.toMatch(pattern);
  });
  it('never imports score colors or links to reviews and scores', () => {
    expect(source).not.toMatch(/scoring-colors/);
    expect(source).not.toMatch(/getScore(Text)?Color|getScoreBgTint/);
    expect(source).not.toMatch(/#review-|ScoreCard/);
  });
  it('routes every date and dollar value through the display helpers', () => {
    expect(source).toMatch(/formatRecordDate\(/);
    expect(source).toMatch(/formatDollars\(/);
    expect(source).not.toMatch(/toLocaleDateString/);
  });
  it('gates the mailing address and condominium owner', () => {
    expect(source).toMatch(/showMailingAddress\(/);
    expect(source).toMatch(/CONDOMINIUM_COPY/);
  });
});
