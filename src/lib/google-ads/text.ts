/**
 * Term normalization shared by Paid vs Organic and search term analysis:
 * lowercase, trim, collapse whitespace. Keyword text additionally drops
 * match-type syntax ([exact], "phrase", +modifier) so it compares to queries.
 *
 * NORMALIZE_SQL mirrors normalizeTerm for PostgreSQL so GSC queries can be
 * grouped in the database with the same result.
 */
export function normalizeTerm(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normalizeKeyword(value: string | null | undefined): string {
  return normalizeTerm(String(value ?? '').replace(/[[\]"]/g, ' ').replace(/(^|\s)\+(?=\S)/g, '$1'));
}

/** SQL expression for normalizeTerm(column). */
export function normalizeSql(column: string): string {
  return `btrim(regexp_replace(lower(${column}), '\\s+', ' ', 'g'))`;
}
