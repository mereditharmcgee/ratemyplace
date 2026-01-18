import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  // Set default auth state - auth will be handled per-request where needed
  context.locals.user = null;
  context.locals.session = null;

  return next();
});
