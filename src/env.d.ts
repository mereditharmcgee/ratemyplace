/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type D1Database = import('@cloudflare/workers-types').D1Database;
type R2Bucket = import('@cloudflare/workers-types').R2Bucket;

declare namespace App {
  interface Platform {
    env: {
      DB: D1Database;
      VERIFICATION_BUCKET: R2Bucket;
    };
    cf: import('@cloudflare/workers-types').IncomingRequestCfProperties;
    ctx: import('@cloudflare/workers-types').ExecutionContext;
  }

  interface Locals {
    user: import('lucia').User | null;
    session: import('lucia').Session | null;
  }
}
