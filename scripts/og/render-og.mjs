// Renders brand/social/og-default.html to the 1200x630 link-preview image every page
// advertises (src/lib/seo.ts DEFAULT_OG_IMAGE): public/brand/social/og-default.png, which is
// served, and the identical brand/social/og-default.png, the brand-asset copy (brand.md
// section 11). Run with `npm run og:render`; `npm run og:render -- --out <file>` writes one
// candidate elsewhere for review without touching either committed copy. Needs network
// (Google Fonts) and Playwright's Chromium (`npx playwright install chromium`).
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const W = 1200;
const H = 630;
const MAX_BYTES = 300_000; // WhatsApp drops larger preview images
const SQUARE = { left: (W - H) / 2, right: (W + H) / 2 }; // the centre 630px square
const X_TRIM = 15; // X shows a 2:1 crop: 15px off the top and the bottom
const SLOT = '<!--LOCKUP-->';
// Every face the template sets, with its text, so the right unicode-range subsets are fetched.
const FONTS = [
  ['400 128px "Instrument Serif"', 'Know before you sign. RateMyPlace'],
  ['400 32px "Inter"', 'A public record of rental housing, from the people who know it best.'],
];

const outFlag = process.argv.indexOf('--out');
const outs = outFlag > -1
  ? [resolve(process.argv[outFlag + 1])]
  : [resolve(ROOT, 'public/brand/social/og-default.png'), resolve(ROOT, 'brand/social/og-default.png')];

const template = await readFile(resolve(ROOT, 'brand/social/og-default.html'), 'utf8');
if (template.split(SLOT).length !== 2) throw new Error(`brand/social/og-default.html must contain ${SLOT} exactly once`);
const lockup = await readFile(resolve(ROOT, 'brand/logo-lockup.svg'), 'utf8');
const html = template.replace(SLOT, lockup);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle' });

  // document.fonts.load resolves to the faces it loaded, so an empty list means the face never
  // arrived. Not document.fonts.check(): that is true when no matching face exists at all.
  const missing = await page.evaluate(async (fonts) => {
    const failed = [];
    for (const [spec, text] of fonts) if ((await document.fonts.load(spec, text)).length === 0) failed.push(spec);
    await document.fonts.ready;
    return failed;
  }, FONTS);
  if (missing.length) throw new Error(`Brand font(s) did not load: ${missing.join(', ')}; refusing to write a fallback-font image`);

  // The lockup's viewBox has empty space right of the wordmark, so centring the box would push
  // the drawing left. Crop the viewBox to what is drawn, now that the wordmark's font is in.
  const cropped = await page.evaluate(() => {
    const svg = document.querySelector('.lockup svg');
    if (!(svg instanceof SVGSVGElement)) return false;
    const b = svg.getBBox();
    if (b.width <= 0 || b.height <= 0) return false;
    svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.width} ${b.height}`);
    return true;
  });
  if (!cropped) throw new Error('could not measure the inlined lockup');

  // Hold the layout to the crop-safe zone the template promises. Text is measured by its ink
  // (a Range), not its block box, which spans the whole padded column.
  const boxes = await page.evaluate(() =>
    [
      ['lockup', document.querySelector('.lockup svg')],
      ['headline', document.querySelector('h1')],
      ['secondary', document.querySelector('.sub')],
    ].map(([name, el]) => {
      if (!el) return { name, missing: true };
      let r = el.getBoundingClientRect();
      if (name !== 'lockup') {
        const range = document.createRange();
        range.selectNodeContents(el);
        r = range.getBoundingClientRect();
      }
      return { name, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    }),
  );
  for (const b of boxes) {
    if (b.missing) throw new Error(`template has no ${b.name}`);
    if (b.left < SQUARE.left || b.right > SQUARE.right || b.top < X_TRIM || b.bottom > H - X_TRIM) {
      throw new Error(`${b.name} leaves the crop-safe zone: ${JSON.stringify(b)}`);
    }
  }
  const lockupBox = boxes.find((b) => b.name === 'lockup');
  if (lockupBox.width / 3 < 120) throw new Error(`lockup is ${lockupBox.width}px wide; it needs 360px to stay 120px wide in a 400px card`);

  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
  if (png.length > MAX_BYTES) throw new Error(`PNG is ${png.length} bytes; keep it under ${MAX_BYTES}`);
  for (const out of outs) {
    await mkdir(dirname(out), { recursive: true }); // empty directories are not in git
    await writeFile(out, png);
    console.log(`wrote ${out} (${W}x${H}, ${png.length} bytes)`);
  }
  for (const b of boxes) console.log(`  ${b.name}: x ${Math.round(b.left)}-${Math.round(b.right)}, y ${Math.round(b.top)}-${Math.round(b.bottom)}`);
} finally {
  await browser.close();
}
