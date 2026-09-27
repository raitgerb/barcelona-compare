/**
 * Versioned, fail-closed canonicalization for listing phone numbers.
 *
 * The listing data is Barcelona-only today, so ES is the only accepted
 * country context. This function deliberately does not attempt to infer a
 * country from an unqualified number.
 */
export const PHONE_CANONICALIZATION_VERSION = 'es-e164-v1' as const;
export type ListingCountry = 'ES';

const SPANISH_NATIONAL_NUMBER = /^[6789]\d{8}$/;
const FORMATTING_ONLY = /^[\d\s().+-]+$/;

/** Return an E.164 Spanish number, or null when the input is not unambiguous. */
export function canonicalizeSpanishPhone(
  value: unknown,
  country: string,
): string | null {
  if (country !== 'ES' || typeof value !== 'string') return null;

  const input = value.trim();
  if (!input || !FORMATTING_ONLY.test(input)) return null;

  const hasInternationalPrefix = input.startsWith('+');
  const digits = input.replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;

  if (hasInternationalPrefix) {
    if (!digits.startsWith('+34')) return null;
    const national = digits.slice(3);
    return SPANISH_NATIONAL_NUMBER.test(national) ? `+34${national}` : null;
  }

  if (digits.startsWith('+') || !SPANISH_NATIONAL_NUMBER.test(digits)) return null;
  return `+34${digits}`;
}
