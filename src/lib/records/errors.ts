// How a failure becomes a stored string, in one place.
//
// `record_pulls.error_message` and `records_queue.last_error` are provenance columns, not a
// log: a human reading the admin panel wants to know what went wrong, and neither column is
// worth bloating a row over. `pull.ts` writes the first, `queue.ts` and `scheduler.ts` the
// second, and they must read the same — a message clipped one way in one table and another
// way in the other is a needless difference for whoever is comparing them at 3am.
//
// This module exists so `queue.ts` does not have to import `pull.ts` for a string helper.
// `pull.ts` reaches the network and pulls in every Boston source; the queue reaches D1 and
// nothing else, and that separation is worth keeping.

/** error_message is provenance, not a log: enough to diagnose, short enough not to bloat the row. */
export const MAX_ERROR_LENGTH = 500;

/** Shared by the pull and the queue, so `record_pulls.error_message` and `records_queue.last_error` read the same. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The ellipsis is part of the budget: a cut message is MAX_ERROR_LENGTH characters, or one fewer per the note below. */
export function truncateError(message: string): string {
  if (message.length <= MAX_ERROR_LENGTH) return message;
  const cut = message.slice(0, MAX_ERROR_LENGTH - 1);
  // The cut can fall between a surrogate pair and leave a lone high surrogate: half a
  // character, which renders as a replacement glyph and does not survive a JSON round
  // trip. Drop it. That message is then one under budget, which nothing depends on.
  const last = cut.charCodeAt(cut.length - 1);
  const whole = last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
  return `${whole}…`;
}
