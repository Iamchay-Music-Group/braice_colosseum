/**
 * Email canonicalisation.
 *
 * Addresses are compared case-insensitively, so there has to be exactly one
 * canonical form. We normalise to lowercase + trimmed whitespace, and the
 * unique index sits on LOWER(email) as a second line of defence against rows
 * written by other tooling (migration 003).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
