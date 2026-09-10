import type { APIContext } from 'astro';
import { getEnv } from '../lib/runtime';
import { siteUrlFrom } from '../lib/sitemap';

export function GET(context: APIContext): Response {
  const site = siteUrlFrom(getEnv(context));
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /api/',
    'Disallow: /auth/',
    'Disallow: /profile',
    'Disallow: /review/',
    'Disallow: /dispute',
    '',
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
}
