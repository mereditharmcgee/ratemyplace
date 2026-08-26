import type { APIContext } from 'astro';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../pages/api/admin/verification/[id]';

const verification = {
  id: 'verification-1',
  review_id: 'review-1',
  r2_key: 'users/user-1/verifications/review-1/proof.pdf',
  status: 'pending',
};

type Decision = 'approve' | 'reject';

function createContext(
  decision: Decision,
  deleteDocument: (key: string) => Promise<void>,
): APIContext {
  const db = {
    prepare(sql: string) {
      return {
        bind(..._values: unknown[]) {
          return {
            async first() {
              return sql.includes('SELECT id, review_id, r2_key, status')
                ? verification
                : null;
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  };
  const request = new Request(
    'https://ratemyplace.org/api/admin/verification/verification-1',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.10',
      },
      body: JSON.stringify({
        action: decision,
        rejection_reason: 'Address does not match the reviewed building.',
      }),
    },
  );

  return {
    params: { id: verification.id },
    request,
    locals: {
      user: { id: 'admin-1', isAdmin: true },
      runtime: {
        env: {
          DB: db,
          VERIFICATION_BUCKET: { delete: deleteDocument },
        },
      },
    },
  } as unknown as APIContext;
}

describe('admin verification decisions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('immediately deletes the uploaded document when verification is rejected', async () => {
    const deletedKeys: string[] = [];
    const context = createContext(
      'reject',
      async (key: string) => {
        deletedKeys.push(key);
      },
    );

    const response = await POST(context);

    expect(response.status).toBe(200);
    expect(deletedKeys).toEqual([
      'users/user-1/verifications/review-1/proof.pdf',
    ]);
  });

  it.each(['approve', 'reject'] as const)(
    'reports a failed document deletion without failing the %s decision',
    async (decision) => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const context = createContext(decision, async () => {
        throw new Error('R2 unavailable');
      });

      const response = await POST(context);

      const structuredLogs: Array<Record<string, unknown>> = [];
      for (const [message] of consoleSpy.mock.calls) {
        if (typeof message !== 'string') continue;

        try {
          const parsed: unknown = JSON.parse(message);
          if (typeof parsed === 'object' && parsed !== null) {
            structuredLogs.push(parsed as Record<string, unknown>);
          }
        } catch {
          // deleteVerificationImage also emits its legacy non-JSON error.
        }
      }
      const deleteFailureLogs = structuredLogs.filter(
        (entry) => entry.event === 'verification_document_delete_failed',
      );

      expect(response.status).toBe(200);
      expect(deleteFailureLogs).toHaveLength(1);
      expect(deleteFailureLogs[0]).toMatchObject({
        level: 'error',
        event: 'verification_document_delete_failed',
        r2_key: 'users/user-1/verifications/review-1/proof.pdf',
        decision,
      });
    },
  );
});
