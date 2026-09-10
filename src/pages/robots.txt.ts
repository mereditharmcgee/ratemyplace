import type { APIContext } from 'astro';
import { getEnv } from '../lib/runtime';
import { siteUrlFrom } from '../lib/sitemap';

export function GET(context: APIContext): Response {
  const site = siteUrlFrom(getEnv(context));
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
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
}
