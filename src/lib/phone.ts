/** Versioned, fail-closed canonicalization for Spanish listing phones. */
export const PHONE_CANONICALIZATION_VERSION = 'es-e164-v1' as const;

const NATIONAL = /^[6789]\d{8}$/;
const FORMATTING_ONLY = /^[\d\s().+-]+$/;

export function canonicalizeSpanishPhone(value: unknown, country: string): string | null {
  if (country !== 'ES' || typeof value !== 'string') return null;
  const input = value.trim();
  if (!input || !FORMATTING_ONLY.test(input)) return null;
  const international = input.startsWith('+');
  const digits = input.replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;
  if (international) {
    if (!digits.startsWith('+34')) return null;
    const national = digits.slice(3);
    return NATIONAL.test(national) ? `+34${national}` : null;
  }
  return digits.startsWith('+') || !NATIONAL.test(digits) ? null : `+34${digits}`;
}
