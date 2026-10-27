/**
 * Let background work queued by `fireAndForget` (no `waitUntil` in unit tests) run to the
 * end: a few macrotask turns, each draining the microtasks before it.
 *
 * Use `vi.waitFor` for a positive assertion on a background write; call this before a
 * negative one ("nothing was written"), and before any later `db.batch` on the same db, so
 * a background write cannot interleave with the batch's transaction.
 */
export async function flushBackground(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
