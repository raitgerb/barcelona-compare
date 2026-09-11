// Env declarations owned by the claim flow (B2B Phase 0).
//
// `interface Env` merges with the declaration in functions/_lib/env.d.ts, so the
// claim flow adds what it needs without editing a file other cards also touch.
// Names match the ones the owner-dashboard work uses for its login codes
// (RESEND_API_KEY / EMAIL_FROM), so one secret configures both flows.

interface Env {
  /** HMAC key for verification codes and IP throttling. Required by /api/claim/*. */
  CLAIM_CODE_SECRET?: string;
  /** Optional transactional-email transport (see functions/_lib/claim-mail.ts). */
  RESEND_API_KEY?: string;
  /** From: address for transactional email. */
  EMAIL_FROM?: string;
  /** Reply-To: address for transactional email (defaults to hola@barcelonacompare.com). */
  EMAIL_REPLY_TO?: string;
}
