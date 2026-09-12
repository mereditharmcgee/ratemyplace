import type { APIContext } from 'astro';
import { getEnv } from '../lib/runtime';
import { siteUrlFrom } from '../lib/sitemap';

const HEADERS = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' };

export function GET(context: APIContext): Response {
  const site = siteUrlFrom(getEnv(context));

  // Preview deploys answer on *.ratemyplace-64y.pages.dev with production's content. Serving
  // the permissive file there invites a crawler to index a second copy of every page,
  // competing with the canonical domain. Compared against SITE_URL's host rather than a
  // hardcoded suffix, so any host that is not the canonical one — a custom domain still
  // being set up, a Pages branch alias — is covered by the same rule.
  if (context.url.host !== new URL(site).host) {
    return new Response('User-agent: *\nDisallow: /\n', { headers: HEADERS });
  }

  const body = [
    'User-agent: *',
    'Allow: /',
    // Prefixes, not directories: no trailing slash, so each line also covers the bare path
    // (`/admin` as well as `/admin/users`) instead of only what sits beneath it.
    'Disallow: /admin',
    'Disallow: /api',
    'Disallow: /auth',
    'Disallow: /profile',
    'Disallow: /review',
    'Disallow: /dispute',
    'Disallow: /email-verified',
    'Disallow: /bug-report',
    '',
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(body, { headers: HEADERS });
}
