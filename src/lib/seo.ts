// Head metadata for every page: title, description, canonical, Open Graph and Twitter tags.
// BaseLayout is the only caller; pure, so it is unit-tested without rendering.
import { siteUrlFrom } from './sitemap';

export const SITE_NAME = 'RateMyPlace';
/** Moved verbatim from BaseLayout's default prop. */
export const DEFAULT_DESCRIPTION = 'Tenant housing reviews - Real experiences from real renters';
export const NOINDEX_ROBOTS = 'noindex, follow';
/**
 * The committed link-preview image, rendered from brand/social/og-default.html by
 * `npm run og:render`. Platforms cache previews by image URL, so a replacement image gets a
 * new filename and this path changes with it.
 */
export const DEFAULT_OG_IMAGE = {
  path: '/brand/social/og-default.png',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'RateMyPlace. Know before you sign. A public record of rental housing, from the people who know it best.',
} as const;

export interface HeadMetaInput { title: string; description: string; pathname: string; siteOrigin: string; noindex?: boolean }
export interface HeadMeta {
  title: string;
  description: string;
  siteName: string;
  /** The canonical link and og:url. Null on noindex pages, so a private URL is never advertised. */
  url: string | null;
  robots: string | null;
  image: { url: string; width: number; height: number; type: string; alt: string };
}

/** The sitemap's form: root is '/', every other path has no trailing slash. Never lowercases or re-encodes. */
export function canonicalPath(pathname: string): string {
  const trimmed = pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (trimmed === '') return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** SITE_URL as a bare origin. Never throws: BaseLayout renders every page. */
export function siteOriginFrom(env: { SITE_URL?: string } | undefined): string {
  const fallback = siteUrlFrom(undefined);
  // Not siteUrlFrom(env): it strips trailing slashes first, which turns 'https://' into
  // 'https:', and the scheme test below would then read that as a host.
  const raw = env?.SITE_URL?.trim() || fallback;
  try {
    // A scheme is prefixed only when none is present: 'https://' + 'https://x' parses as host 'https'.
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '' ? url.origin : fallback;
  } catch {
    return fallback;
  }
}

export function headMeta(input: HeadMetaInput): HeadMeta {
  const url = input.noindex ? null : `${input.siteOrigin}${canonicalPath(input.pathname)}`;
  return {
    title: `${input.title} | ${SITE_NAME}`,
    description: input.description,
    siteName: SITE_NAME,
    url,
    robots: input.noindex ? NOINDEX_ROBOTS : null,
    image: {
      url: `${input.siteOrigin}${DEFAULT_OG_IMAGE.path}`,
      width: DEFAULT_OG_IMAGE.width,
      height: DEFAULT_OG_IMAGE.height,
      type: DEFAULT_OG_IMAGE.type,
      alt: DEFAULT_OG_IMAGE.alt,
    },
  };
}

/** Any query parameter makes /search a variant: noindexed, and it carries no canonical. */
export function isSearchVariant(url: URL): boolean {
  return [...url.searchParams.keys()].length > 0;
}
