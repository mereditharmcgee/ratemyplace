/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type D1Database = import('@cloudflare/workers-types').D1Database;
type R2Bucket = import('@cloudflare/workers-types').R2Bucket;

declare namespace App {
  interface Platform {
    env: {
      DB: D1Database;
      VERIFICATION_BUCKET: R2Bucket;
      TURNSTILE_SECRET_KEY: string;
      GOOGLE_CLIENT_ID: string;
      GOOGLE_CLIENT_SECRET: string;
      GOOGLE_MAPS_API_KEY: string;
      GOOGLE_PLACES_API_KEY: string;
      RESEND_API_KEY: string;
      SITE_URL: string;
    };
    cf: import('@cloudflare/workers-types').IncomingRequestCfProperties;
    ctx: import('@cloudflare/workers-types').ExecutionContext;
  }

  interface Locals {
    user: import('lucia').User | null;
    session: import('lucia').Session | null;
    runtime: App.Platform;
  }
}
