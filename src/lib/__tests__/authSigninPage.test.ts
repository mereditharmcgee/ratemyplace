import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import SigninPage from '../../pages/auth/signin.astro';

/**
 * Visual-audit regression test: the sign-in page used an h2 with no h1 on the
 * page at all. Assert there is exactly one h1 and that it carries the page
 * heading text.
 */

function mainFragment(html: string): HTMLDivElement {
  const match = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (!match) throw new Error('Rendered page is missing <main>');
  const fragment = document.createElement('div');
  fragment.innerHTML = match[1];
  return fragment;
}

describe('sign-in page heading', () => {
  it('renders exactly one h1 carrying the page heading', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(SigninPage, {
      locals: { user: null, session: null } as unknown as App.Locals,
      request: new Request('https://ratemyplace.org/auth/signin'),
    });

    const main = mainFragment(html);
    const h1s = main.querySelectorAll('h1');

    expect(h1s.length).toBe(1);
    expect(h1s[0].textContent).toContain('Sign in to your account');
    expect(main.querySelectorAll('h2').length).toBe(0);
  });
});
