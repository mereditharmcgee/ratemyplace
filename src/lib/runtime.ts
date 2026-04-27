import type { APIContext } from 'astro';

export function getEnv(context: APIContext): App.Platform['env'] {
  const runtime = context.locals.runtime;
  if (!runtime) {
    throw new Error('Cloudflare runtime unavailable — are you running in Wrangler?');
  }
  return runtime.env;
}
