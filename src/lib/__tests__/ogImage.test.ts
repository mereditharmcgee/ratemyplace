// The default link-preview image every page advertises (seo.ts DEFAULT_OG_IMAGE). Until
// October 2026 the og:image tag pointed at a file that did not exist, so every shared link
// previewed with no image; these checks keep the committed PNG in place and within the
// limits social platforms enforce.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_OG_IMAGE } from '../seo';

const ROOT = process.cwd();
const PUBLIC_PNG = join(ROOT, 'public', DEFAULT_OG_IMAGE.path);
const BRAND_PNG = join(ROOT, 'brand', 'social', 'og-default.png');
const TEMPLATE = join(ROOT, 'brand', 'social', 'og-default.html');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('default OG image', () => {
  it('exists where the head tags point', () => {
    expect(existsSync(PUBLIC_PNG)).toBe(true);
  });

  it('is a PNG of the advertised size', () => {
    const png = readFileSync(PUBLIC_PNG);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    // IHDR is the first chunk: width at byte 16, height at byte 20.
    expect(png.readUInt32BE(16)).toBe(DEFAULT_OG_IMAGE.width);
    expect(png.readUInt32BE(20)).toBe(DEFAULT_OG_IMAGE.height);
  });

  it('stays under 300 KB, above which WhatsApp drops preview images', () => {
    expect(statSync(PUBLIC_PNG).size).toBeLessThan(300_000);
  });

  it('is byte-identical to the brand-asset copy', () => {
    expect(readFileSync(BRAND_PNG).equals(readFileSync(PUBLIC_PNG))).toBe(true);
  });

  it('has exactly one lockup slot in its template', () => {
    expect(readFileSync(TEMPLATE, 'utf8').split('<!--LOCKUP-->').length).toBe(2);
  });

  it('renders the same lockup the site serves', () => {
    const brand = readFileSync(join(ROOT, 'brand', 'logo-lockup.svg'));
    const served = readFileSync(join(ROOT, 'public', 'brand', 'logo-lockup.svg'));
    expect(brand.equals(served)).toBe(true);
  });
});
