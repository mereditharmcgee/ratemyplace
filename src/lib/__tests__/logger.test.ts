import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logError } from '../logger';

describe('logError', () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('logs structured JSON to console.error', () => {
    logError('test_event', { endpoint: '/api/test', ip: '1.2.3.4' });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedString = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(loggedString);

    expect(parsed.level).toBe('error');
    expect(parsed.event).toBe('test_event');
    expect(parsed.endpoint).toBe('/api/test');
    expect(parsed.ip).toBe('1.2.3.4');
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.request_id).toBeTruthy();
  });

  it('uses provided request_id if given', () => {
    logError('test_event', { request_id: 'custom-123' });

    const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(parsed.request_id).toBe('custom-123');
  });

  it('generates request_id if not provided', () => {
    logError('test_event', {});

    const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(parsed.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
