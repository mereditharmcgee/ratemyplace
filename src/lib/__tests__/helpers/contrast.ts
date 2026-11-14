import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// WCAG 2 contrast for the guard tests, measured on the colours a browser actually paints.
// Tailwind 4 defines its palette in oklch. A token is converted to sRGB, clipped to the gamut
// and rounded to 8 bits, which matches what headless Chromium paints for every token these
// guards use. Hex colours (the map's SCORE_HEX, the email templates) are taken as written.

const require = createRequire(import.meta.url);

let tokens: Map<string, string> | null = null;

function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${linear
    .map((value) => {
      const clipped = Math.min(1, Math.max(0, value));
      const encoded = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
      return Math.round(encoded * 255)
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
}

function loadTokens(): Map<string, string> {
  if (tokens) return tokens;
  const css = readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8');
  tokens = new Map();
  for (const match of css.matchAll(/--color-([a-z]+-\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g)) {
    tokens.set(match[1], oklchToHex(Number(match[2]) / 100, Number(match[3]), Number(match[4])));
  }
  tokens.set('white', '#ffffff');
  tokens.set('black', '#000000');
  // The brand page surface, from src/styles/global.css.
  tokens.set('paper', '#f6f4ee');
  return tokens;
}

/** "amber-800" or "white" -> the painted 8-bit hex. Throws on an unknown token. */
export function tailwindHex(token: string): string {
  const hex = loadTokens().get(token);
  if (!hex) throw new Error(`unknown Tailwind colour token: ${token}`);
  return hex;
}

/** The colour token inside a utility class: "bg-amber-50" -> "amber-50". */
export function tokenOf(utility: string): string {
  const match = utility.match(/^(?:bg|text|border|ring|fill|stroke)-((?:[a-z]+-\d+)|white|black)$/);
  if (!match) throw new Error(`not a colour utility: ${utility}`);
  return match[1];
}

function rgb(hex: string): [number, number, number] {
  let digits = hex.replace('#', '');
  if (digits.length === 3) digits = [...digits].map((d) => d + d).join('');
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours, unrounded. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `top` painted at `alpha` over `base`, as an 8-bit hex. */
export function composite(top: string, alpha: number, base: string): string {
  const [t, b] = [rgb(top), rgb(base)];
  return `#${t
    .map((channel, i) => Math.round(channel * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0'))
    .join('')}`;
}
