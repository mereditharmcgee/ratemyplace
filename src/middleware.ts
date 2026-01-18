import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  // Set default auth state
  context.locals.user = null;
  context.locals.session = null;

  // Session validation is handled per-request in API routes and protected pages
  // This avoids issues when D1 binding is not yet configured

  return next();
});
