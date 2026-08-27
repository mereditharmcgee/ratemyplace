import { describe, expect, it } from 'vitest';
import { buildPublicHealth } from '../health';
import { GET, HEAD } from '../../pages/api/health';

describe('public health contract', () => {
  it('contains only generic status and release', () => {
    expect(buildPublicHealth('a'.repeat(40))).toEqual({
      status: 'ok',
      release: 'a'.repeat(40),
    });
  });

  it('returns no-store JSON without internal fields', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(body).sort()).toEqual(['release', 'status']);
    expect(body.status).toBe('ok');
    expect(typeof body.release).toBe('string');
  });

  it('supports a bodyless HEAD probe with the same cache policy', async () => {
    const response = await HEAD();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });
});
