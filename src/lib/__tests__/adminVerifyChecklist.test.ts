import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import VerifyPage from '../../pages/admin/verify.astro';

// The owner made the upload modal's list of accepted documents the official one. The admin
// checklist on /admin/verify names the same four kinds, says photo IDs are not accepted, and
// no longer lists a bank statement.

const MODAL_DOCUMENTS = [
  'Lease or rental agreement',
  'Utility bill (gas, electric, water)',
  'Rent receipt or payment confirmation',
  'Piece of mail showing your name and this address',
];

async function checklist(): Promise<string[]> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  const html = await container.renderToString(VerifyPage, {
    locals: {
      user: { id: 'admin-1', email: 'admin@example.test', emailVerified: true, isAdmin: true },
      session: { id: 's-1' },
      // The header counts unread notifications for a signed-in user.
      runtime: { env: { DB: { prepare: () => ({ bind: () => ({ first: async () => ({ count: 0 }) }) }) } } },
    } as unknown as App.Locals,
  });
  const root = document.createElement('div');
  root.innerHTML = html;
  const heading = Array.from(root.querySelectorAll('p')).find((p) => p.textContent?.trim() === 'What to look for:');
  const list = heading?.parentElement?.querySelector('ul');
  expect(list).toBeTruthy();
  return Array.from(list?.querySelectorAll('li') ?? []).map((li) => (li.textContent ?? '').replace(/\s+/g, ' ').trim());
}

describe('/admin/verify checklist', () => {
  it('lists the official documents and refuses photo IDs', async () => {
    expect(await checklist()).toEqual([
      "Document shows the user's name and the property address",
      'Accepted documents: lease or rental agreement, utility bill (gas, electric, water), rent receipt or payment confirmation, or any mail showing the user\'s name and this address',
      'Photo IDs are not accepted',
      'Document appears genuine and unaltered',
    ]);
  });

  it('no longer accepts a bank statement', async () => {
    expect((await checklist()).join(' ').toLowerCase()).not.toContain('bank statement');
  });

  it('matches the upload modal, which is the official list', () => {
    // If the modal's list changes, the admin checklist above has to change with it.
    const modal = readFileSync(join(process.cwd(), 'src/components/profile/VerificationModal.tsx'), 'utf8');
    const block = modal.match(/Accepted documents:<\/p>\s*<ul[^>]*>([\s\S]*?)<\/ul>/);
    expect(block).toBeTruthy();
    const items = Array.from(block?.[1].matchAll(/<li>([^<]*)<\/li>/g) ?? [], (match) => match[1].trim());
    expect(items).toEqual(MODAL_DOCUMENTS);
  });
});
