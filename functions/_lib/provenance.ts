/**
 * One definition of "non-blank provenance" for the ownership approval invariant.
 *
 * Round 4 (independent) found that the JavaScript predicate and the SQLite predicate
 * disagreed: `String.prototype.trim()` strips the full ECMAScript whitespace set, while
 * one-argument SQLite `trim()` strips ASCII space (U+0020) only. A `verified = 1` row
 * could therefore hold evidence/approver of `"\t"`, `"\n"` or `"\u00a0"`, stay published
 * through the SQL read guards and 403 the owner at the JavaScript runtime guard.
 *
 * The invariant is written once here and expressed twice, because a `.sql` migration
 * cannot import TypeScript:
 *
 *   - JavaScript: `isNonBlankProvenance` delegates to `String.prototype.trim()` itself,
 *     so it keeps exactly the ECMAScript semantics. It is intentionally NOT re-implemented
 *     with a character list: `trim()` is the definition, not an approximation of it.
 *   - SQL: `SQL_NONBLANK` uses SQLite's two-argument `trim(X, Y)`, which removes any
 *     character that appears in `Y` from both ends of `X`, with `char(...)` emitting the
 *     Unicode code points. `trim(X, chars) = ''` is true exactly when every character of X
 *     is in the set — identical to `String.prototype.trim() === ''`.
 *
 * ECMAScript WhiteSpace (ECMA-262 § 12.2 / Unicode `Zs`): U+0009 TAB, U+000B VT,
 * U+000C FF, U+0020 SP, U+00A0 NBSP, U+FEFF ZWNBSP, U+1680, U+2000–U+200A, U+202F,
 * U+205F, U+3000.
 * ECMAScript LineTerminator: U+000A LF, U+000D CR, U+2028 LS, U+2029 PS.
 *
 * `migrations/0007_ownership_lifecycle.sql` must carry the same code-point list literally;
 * `scripts/ownership-lifecycle-test.cjs` asserts the two stay in step over the whole set.
 */

/** Code points removed by ECMAScript `String.prototype.trim()` at either end. */
export const ECMASCRIPT_WHITESPACE_CODEPOINTS: readonly number[] = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
  // U+2000..U+200A (en quad .. hair space)
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];

/** SQLite `char(...)` argument list for the same set. */
export const SQL_NONBLANK_CHARSET = `char(${ECMASCRIPT_WHITESPACE_CODEPOINTS.join(', ')})`;

/**
 * `true` when `value` is a string and carries at least one character that survives
 * ECMAScript `trim()`. `null`/`undefined`/non-strings are blank: the approval invariant
 * is fail-closed on missing provenance, not only on whitespace-only provenance.
 */
export function isNonBlankProvenance(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * SQL predicate for one provenance column expression: non-NULL **and** non-blank under
 * ECMAScript `trim()` semantics. Callers must still bind the result as a whole clause
 * (`AND ${...}`); the expression never accepts a NULL column, so the guard direction of
 * every existing caller (`IS NOT NULL AND trim(x) <> ''`) is preserved.
 */
export function sqlNonBlankProvenance(expression: string): string {
  return `(${expression} IS NOT NULL AND trim(${expression}, ${SQL_NONBLANK_CHARSET}) <> '')`;
}
