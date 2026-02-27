/**
 * Structured JSON logging helper for Cloudflare Workers
 * Logs are automatically indexed by Cloudflare when using JSON format
 */

interface LogContext {
  endpoint?: string;
  ip?: string;
  error?: string;
  request_id?: string;
  [key: string]: any;
}

export function logError(event: string, context: LogContext): void {
  console.error(JSON.stringify({
    level: 'error',
    timestamp: new Date().toISOString(),
    event,
    request_id: context.request_id || crypto.randomUUID(),
    ...context
  }));
}
