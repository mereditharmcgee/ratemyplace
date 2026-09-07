import { describe, it, expect } from 'vitest';
import {
  CORRECTION_KINDS,
  CORRECTION_RESOLUTIONS,
  CLAIM_MIN,
  CLAIM_MAX,
  validateCorrectionBody,
  diffRecordSnapshots,
  type RecordSnapshot,
} from '../records/corrections';
import { sanitizeMultilineText } from '../validation';

const goodBody = {
  buildingId: 'bldg-lanark',
  recordKind: 'permit',
  claim: 'This permit lists the wrong applicant name for the 2023 renovation.',
  contactEmail: 'tenant@example.com',
};

describe('CORRECTION_KINDS / CORRECTION_RESOLUTIONS', () => {
  it('includes every RECORD_KINDS entry plus panel', () => {
    expect(CORRECTION_KINDS).toContain('panel');
    expect(CORRECTION_KINDS).toContain('assessment');
    expect(CORRECTION_KINDS).toContain('permit');
    expect(CORRECTION_KINDS).toContain('violation');
    expect(CORRECTION_KINDS).toContain('enforcement_ticket');
    expect(CORRECTION_KINDS).toContain('service_request');
    expect(CORRECTION_KINDS).toContain('rentsmart');
  });

  it('lists the three resolutions in order', () => {
    expect(CORRECTION_RESOLUTIONS).toEqual([
      'repulled_unchanged',
      'repulled_updated',
      'source_mismatch_noted',
    ]);
  });
});

describe('validateCorrectionBody', () => {
  it('accepts a good body', () => {
    expect(validateCorrectionBody(goodBody)).toEqual([]);
  });

  it('accepts a panel kind with no email', () => {
    const errors = validateCorrectionBody({
      buildingId: 'bldg-lanark',
      recordKind: 'panel',
      claim: 'The whole records panel is missing for this building entirely.',
    });
    expect(errors).toEqual([]);
  });

  it('rejects an unknown record kind', () => {
    const errors = validateCorrectionBody({ ...goodBody, recordKind: 'score' });
    expect(errors).toEqual([{ field: 'recordKind', message: 'Choose which record is wrong.' }]);
  });

  it('rejects a claim shorter than the minimum', () => {
    const errors = validateCorrectionBody({ ...goodBody, claim: 'too short' });
    expect(errors).toEqual([
      { field: 'claim', message: `Tell us what is wrong in at least ${CLAIM_MIN} characters.` },
    ]);
  });

  it('rejects a claim over the maximum', () => {
    const errors = validateCorrectionBody({ ...goodBody, claim: 'x'.repeat(CLAIM_MAX + 1) });
    expect(errors).toEqual([{ field: 'claim', message: `Keep it under ${CLAIM_MAX} characters.` }]);
  });

  it('rejects a badly formatted email', () => {
    const errors = validateCorrectionBody({ ...goodBody, contactEmail: 'not-an-email' });
    expect(errors).toEqual([{ field: 'contactEmail', message: 'Email format is invalid.' }]);
  });

  it('reports buildingId, recordKind, claim in that order for an empty body', () => {
    const errors = validateCorrectionBody({});
    expect(errors.map((e) => e.field)).toEqual(['buildingId', 'recordKind', 'claim']);
  });
});

describe('diffRecordSnapshots', () => {
  it('reports added, removed, and changed permit rows', () => {
    const before: RecordSnapshot[] = [
      { kind: 'permit', source_key: 'A', payload: '{"v":1}' },
      { kind: 'permit', source_key: 'B', payload: '{"v":1}' },
    ];
    const after: RecordSnapshot[] = [
      { kind: 'permit', source_key: 'A', payload: '{"v":2}' },
      { kind: 'permit', source_key: 'C', payload: '{"v":1}' },
    ];

    const diff = diffRecordSnapshots(before, after);

    expect(diff.added).toEqual([{ kind: 'permit', source_key: 'C' }]);
    expect(diff.removed).toEqual([{ kind: 'permit', source_key: 'B' }]);
    expect(diff.changed).toEqual([{ kind: 'permit', source_key: 'A' }]);
  });

  it('reports nothing for rentsmart rows with reassigned CKAN ids (rowId differs, content is identical)', () => {
    const before: RecordSnapshot[] = [
      { kind: 'rentsmart', source_key: 'old-1', payload: '{"rowId":"old-1","violationType":"heat"}' },
    ];
    const after: RecordSnapshot[] = [
      { kind: 'rentsmart', source_key: 'new-99', payload: '{"rowId":"new-99","violationType":"heat"}' },
    ];

    const diff = diffRecordSnapshots(before, after);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it('reports real rentsmart additions and removals by payload content, ignoring rowId', () => {
    const before: RecordSnapshot[] = [
      { kind: 'rentsmart', source_key: 'old-1', payload: '{"rowId":"old-1","violationType":"heat"}' },
    ];
    const after: RecordSnapshot[] = [
      { kind: 'rentsmart', source_key: 'new-99', payload: '{"rowId":"new-99","violationType":"pests"}' },
    ];

    const diff = diffRecordSnapshots(before, after);

    expect(diff.added).toEqual([{ kind: 'rentsmart', source_key: 'new-99' }]);
    expect(diff.removed).toEqual([{ kind: 'rentsmart', source_key: 'old-1' }]);
    expect(diff.changed).toEqual([]);
  });
});

describe('sanitizeMultilineText', () => {
  it('strips tags but keeps line breaks', () => {
    expect(sanitizeMultilineText('<b>Line one</b>\nLine two')).toBe('Line one\nLine two');
  });

  it('normalizes CRLF to LF', () => {
    expect(sanitizeMultilineText('Line one\r\nLine two\rLine three')).toBe('Line one\nLine two\nLine three');
  });

  it('collapses triple-or-more newlines to a blank line', () => {
    expect(sanitizeMultilineText('Para one\n\n\n\nPara two')).toBe('Para one\n\nPara two');
  });

  it('reduces all-markup input to an empty string', () => {
    expect(sanitizeMultilineText('<b></b><i></i><em></em>')).toBe('');
  });
});
