import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import SigninPage from '../../pages/auth/signin.astro';
import SignupPage from '../../pages/auth/signup.astro';
import ReviewEditPage from '../../pages/review/edit/[id].astro';
import { fakeD1 } from './helpers/fakeD1';

// Sign-in and sign-up carry a validated `?redirect=` through to every way out of the page:
// the form's own success navigation (data-redirect), the Google button, and the link to the
// other auth page. A hostile value collapses to '/' and the links go back to being bare,
// which is also what the e2e selectors (`a[href="/auth/signup"]`) rely on.

const SIGNED_OUT = { user: null, session: null } as unknown as App.Locals;
const SIGNED_IN = {
  user: { id: 'u-1', email: 'u@example.com', isAdmin: false },
  session: { id: 's-1' },
} as unknown as App.Locals;

function mainFragment(html: string): HTMLDivElement {
  const match = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (!match) throw new Error('Rendered page is missing <main>');
  const fragment = document.createElement('div');
  fragment.innerHTML = match[1];
  return fragment;
}

describe.each([
  { name: 'sign-in', Page: SigninPage, path: '/auth/signin', formId: 'signin-form', crossLinkPrefix: '/auth/signup' },
  { name: 'sign-up', Page: SignupPage, path: '/auth/signup', formId: 'signup-form', crossLinkPrefix: '/auth/signin' },
])('$name page carries ?redirect=', ({ Page, path, formId, crossLinkPrefix }) => {
  async function render(search: string): Promise<HTMLDivElement> {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Page, {
      locals: SIGNED_OUT,
      request: new Request(`https://ratemyplace.org${path}${search}`),
    });
    return mainFragment(html);
  }

  function parts(main: HTMLDivElement) {
    const form = main.querySelector(`#${formId}`) as HTMLFormElement | null;
    if (!form) throw new Error('form missing');
    const google = main.querySelector('a[href^="/api/auth/google"]');
    const cross = main.querySelector(`a[href^="${crossLinkPrefix}"]`);
    if (!google || !cross) throw new Error('links missing');
    return {
      dataRedirect: form.getAttribute('data-redirect'),
      googleHref: google.getAttribute('href'),
      crossHref: cross.getAttribute('href'),
    };
  }

  it('threads a safe return path through the form, the Google button and the cross-link', async () => {
    const got = parts(await render('?redirect=%2Freview%2Fnew%3FplaceId%3Dabc'));
    expect(got.dataRedirect).toBe('/review/new?placeId=abc');
    expect(got.googleHref).toBe('/api/auth/google?redirect=%2Freview%2Fnew%3FplaceId%3Dabc');
    expect(got.crossHref).toBe(`${crossLinkPrefix}?redirect=%2Freview%2Fnew%3FplaceId%3Dabc`);
  });

  it.each([['%2F%2Fevil.example'], ['%2F.%2F%2Fevil.example'], ['%2F%252e%2F%2Fevil.example']])(
    'drops the hostile redirect %s and leaves the links bare',
    async (encoded) => {
      const got = parts(await render(`?redirect=${encoded}`));
      expect(got.dataRedirect).toBe('/');
      expect(got.googleHref).toBe('/api/auth/google');
      expect(got.crossHref).toBe(crossLinkPrefix);
    },
  );

  it('with no redirect, the links are bare', async () => {
    const got = parts(await render(''));
    expect(got.dataRedirect).toBe('/');
    expect(got.googleHref).toBe('/api/auth/google');
    expect(got.crossHref).toBe(crossLinkPrefix);
  });

  it('a signed-in visitor goes straight to the safe return path', async () => {
    const container = await AstroContainer.create();
    const response = await container.renderToResponse(Page, {
      locals: SIGNED_IN,
      request: new Request(`https://ratemyplace.org${path}?redirect=%2Freview%2Fnew%3FplaceId%3Dabc`),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/review/new?placeId=abc');
  });

  it('a signed-in visitor with a hostile redirect goes home', async () => {
    const container = await AstroContainer.create();
    const response = await container.renderToResponse(Page, {
      locals: SIGNED_IN,
      request: new Request(`https://ratemyplace.org${path}?redirect=%2F.%2F%2Fevil.example`),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/');
  });
});

describe('review edit page', () => {
  it('sends a signed-out visitor to sign in with its own path as the return', async () => {
    const container = await AstroContainer.create();
    const response = await container.renderToResponse(ReviewEditPage, {
      locals: SIGNED_OUT,
      params: { id: 'abc' },
      request: new Request('https://ratemyplace.org/review/edit/abc'),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/auth/signin?redirect=%2Freview%2Fedit%2Fabc');
  });

  // The page reads its review through getDB, the same accessor the API routes use.
  async function signedInTo(review: { user_id: string } | null): Promise<Response> {
    const { db } = fakeD1((call) => (call.sql.includes('FROM reviews r') ? review : undefined));
    const container = await AstroContainer.create();
    return container.renderToResponse(ReviewEditPage, {
      locals: { ...SIGNED_IN, runtime: { env: { DB: db } } } as unknown as App.Locals,
      params: { id: 'abc' },
      request: new Request('https://ratemyplace.org/review/edit/abc'),
    });
  }

  it('sends a signed-in visitor to their profile when the review does not exist', async () => {
    const response = await signedInTo(null);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/profile?error=not-found');
  });

  it("sends a signed-in visitor to their profile from someone else's review", async () => {
    const response = await signedInTo({ user_id: 'someone-else' });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/profile?error=unauthorized');
  });
});
