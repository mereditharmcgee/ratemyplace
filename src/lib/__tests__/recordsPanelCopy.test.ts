import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANNED_WORDS } from '../records/display';

const source = readFileSync(join(process.cwd(), 'src/components/BuildingRecords.astro'), 'utf8');

/** Word-boundary alternation over the banned list. Built from a plain string so the escapes survive. */
const bannedPattern = new RegExp('\\b(' + BANNED_WORDS.join('|') + ')\\b', 'i');

describe('BuildingRecords.astro display rules', () => {
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
    expect(source).toMatch(/formatDollars\(/);
    expect(source).not.toMatch(/toLocaleDateString/);
  });
  it('gates the mailing address and condominium owner', () => {
    expect(source).toMatch(/showMailingAddress\(/);
    expect(source).toMatch(/CONDOMINIUM_COPY/);
  });
});
