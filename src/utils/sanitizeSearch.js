// CRM-8: shared guard for free-text search input that reaches PostgREST filters.
// Inside .or() / .ilike() strings PostgREST treats , ( ) : * % " ' and \ as
// filter syntax. We whitelist instead of blacklisting: letters in any script
// (Arabic and Swahili names work), digits, whitespace and the characters people
// type in emails and phone numbers: @ . + - _
// Dots are safe inside the value segment (PostgREST splits column.op.value on
// the first two dots only), so email searches keep working.
// Python mirror: mcp-server/crm_helpers.py sanitize_search().
export const SEARCH_MAX_LENGTH = 100

export function sanitizeSearch(raw, maxLength = SEARCH_MAX_LENGTH) {
  if (raw === null || raw === undefined) return ''
  return String(raw)
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s@.+\-_]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim()
}

/**
 * Build a PostgREST `.or()` filter that ilike-matches the sanitized term
 * against every column. Returns null when nothing searchable is left, so the
 * caller simply skips the filter.
 */
export function ilikeAny(columns, raw) {
  const term = sanitizeSearch(raw)
  if (!term) return null
  return columns.map((column) => `${column}.ilike.%${term}%`).join(',')
}
