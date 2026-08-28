import { buildPublicHealth } from '../../lib/health';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
} as const;

export async function GET(): Promise<Response> {
  return new Response(JSON.stringify(buildPublicHealth()), {
    status: 200,
    headers,
  });
}

export async function HEAD(): Promise<Response> {
  return new Response(null, { status: 200, headers });
}
