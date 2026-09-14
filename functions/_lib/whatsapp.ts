// WhatsApp booking links (B2B Phase 1: the booking CTA + the owner capture path).
//
// One module for both sides of the same button:
//   * the static listing templates import this at BUILD time (frontmatter `whatsapp`)
//   * the edge injector (`functions/_lib/owner-content.ts`) imports this at RUNTIME
//     (the number an owner saved in `profile_overrides.whatsapp`)
// so a number typed in by an owner renders exactly like one that came from Google.
//
// Why a normaliser at all: `wa.me` requires the full international number, but the
// numbers in the content collection are stored the way a local writes them
// ("640 79 36 74"), which produced `https://wa.me/640793674` — a dead link for
// every one of the 9 businesses that had the field. Anything that reads as a
// Spanish number gets +34; explicit international input is kept as it is.
//
// The prefilled message is deliberate: it tells the business the enquiry came from
// barcelonacompare.com (attribution that survives the click even for a business
// that has no WhatsApp Business tooling) and it saves the visitor from writing an
// opening line.
//
// Docs: docs/whatsapp-cta.md

export type Lang = 'es' | 'en' | 'ca';

export interface WhatsappLink {
  /** Digits only, country code first — e.g. `34640793674`. */
  number: string;
  /** `https://wa.me/<number>?text=<prefilled message>` */
  href: string;
}

/** The only country this site covers, so a bare national number means +34. */
const DEFAULT_COUNTRY = '34';

/** Business-friendly rejection message (shown by the owner dashboard). */
export const WHATSAPP_FORMAT_HINT = 'Escribe el número con prefijo, por ejemplo +34 600 000 000.';

const PREFILL: Record<Lang, string> = {
  es: 'Hola, os escribo desde barcelonacompare.com para pedir cita.',
  en: "Hi, I'm writing from barcelonacompare.com to book an appointment.",
  ca: 'Hola, us escric des de barcelonacompare.com per demanar cita.',
};

/**
 * Normalise a human-entered phone number to `wa.me` digits.
 *
 * Accepts: `640 79 36 74`, `640793674`, `+34 640 79 36 74`, `0034 640 79 36 74`,
 * `+351 912 345 678`. Returns null when the input cannot be read as a phone
 * number (empty, too short, no recognisable shape).
 */
export function normalizeWhatsapp(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const explicitInternational = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) digits = digits.replace(/^00/, '');
  if (!digits) return null;

  // `+…` / `00…` are trusted as written: 10-15 digits is the E.164 range.
  if (explicitInternational || trimmed.startsWith('00')) {
    return digits.length >= 10 && digits.length <= 15 ? digits : null;
  }
  // A national Spanish number: 9 digits starting with a mobile/landline prefix.
  if (digits.length === 9 && /^[6789]/.test(digits)) return DEFAULT_COUNTRY + digits;
  // Already country-coded but written without a `+`.
  if (digits.length === 11 && digits.startsWith(DEFAULT_COUNTRY)) return digits;
  return null;
}

/** `https://wa.me/<digits>?text=<prefilled>` for an already-normalised number. */
export function whatsappHref(number: string, lang: Lang = 'es'): string {
  const text = PREFILL[lang] ?? PREFILL.es;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** Convenience: normalise + build the link in one step, or null if unusable. */
export function whatsappLink(raw: unknown, lang: Lang = 'es'): WhatsappLink | null {
  const number = normalizeWhatsapp(raw);
  return number ? { number, href: whatsappHref(number, lang) } : null;
}

/** The WhatsApp glyph, shared by the static templates and the edge injector. */
export const WHATSAPP_ICON_PATH =
  'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.347-.347.52-.52.174-.174.232-.298.347-.497.116-.198.058-.371-.014-.52-.072-.148-.638-1.538-.874-2.104-.23-.553-.464-.478-.637-.487l-.545-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.464 3.488';
