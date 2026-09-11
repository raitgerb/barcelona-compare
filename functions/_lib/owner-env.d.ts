// Env declarations owned by the Phase 1 owner-edit feature.
//
// `interface Env` merges with the one in functions/_lib/env.d.ts, so this file
// adds the bindings this feature needs without touching a file other cards edit.
// See functions/_lib/env.d.ts for the hand-rolled Workers types and why they are
// not `@cloudflare/workers-types`.

interface Env {
  /** Base URL of the image CDN (unset in local dev -> /images/... fallback). */
  R2_IMAGE_BASE_URL?: string;
  /** Optional Resend credentials for login-code delivery. */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Absolute site origin used in owner emails (defaults to the request origin). */
  PUBLIC_SITE_URL?: string;
}
