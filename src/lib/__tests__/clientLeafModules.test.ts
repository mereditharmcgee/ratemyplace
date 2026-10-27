import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// These modules are imported by browser code: React islands and the sign-in and sign-up
// page scripts. A runtime import would pull whatever it imports into every visitor's
// bundle, so a server module (the D1 resolvers, the Places client, records/*) could ship
// to the client by accident. Type-only imports are erased at build time and are fine.
const LEAF_MODULES = [
  'src/lib/authRedirect.ts',
  'src/lib/homeSearchItems.ts',
  'src/lib/reviewPaths.ts',
  'src/lib/reviewSubmitOutcome.ts',
];

describe('client leaf modules have no runtime imports', () => {
  it.each(LEAF_MODULES.map((file) => [file]))('%s', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    expect(source).not.toMatch(/^\s*import\s+(?!type\b)/m);
    expect(source).not.toMatch(/^\s*export\s+[^;]*\sfrom\s/m);
  });
});
