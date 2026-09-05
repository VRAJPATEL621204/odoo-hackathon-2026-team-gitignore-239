/**
 * Human-readable record numbers such as CON/2026/0042.
 *
 * The counter is incremented with an atomic UPDATE inside the caller's
 * transaction, so two requests creating a contract at the same moment can never
 * be handed the same number. A plain "count the rows and add one" would.
 */
export async function nextSequenceNumber(tx, key, year) {
  const counter = await tx.sequence.upsert({
    where: { key_year: { key, year } },
    update: { lastNumber: { increment: 1 } },
    create: { key, year, lastNumber: 1 },
  });
  return counter.lastNumber;
}

/** Formats a contract reference: CON/2026/0042. */
export function formatReference(prefix, year, number) {
  return `${prefix}/${year}/${String(number).padStart(4, '0')}`;
}
