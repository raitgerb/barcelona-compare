// Response helpers shared by the owner (Phase 1) endpoints.
//
// Mirrors functions/_lib/http.ts (json/errorJson) and adds a mapper that
// understands ProfileError (functions/_lib/profile.ts) as well as the registry's
// RegistryError, so these handlers never leak an internal message.

import { errorJson, json, methodNotAllowed } from './http';
import { ProfileError } from './profile';
import { RegistryError } from './registry';

export { json, errorJson, methodNotAllowed };

/** Turn any thrown value into a JSON response. */
export function ownerErrorResponse(error: unknown): Response {
  if (error instanceof ProfileError) {
    return errorJson(error.code, error.message, error.status);
  }
  if (error instanceof RegistryError) {
    return errorJson(error.code, error.message, error.status);
  }
  console.error('owner-profile: unhandled error', error);
  return errorJson('internal_error', 'the request could not be completed', 500);
}

/** 405 with an Allow header. */
export function methodNotAllowedSafe(allow: string): Response {
  return methodNotAllowed(allow);
}

/** `x-owner-session: <token>` header (never a cookie: the dashboard is static). */
export function ownerTokenFrom(request: Request): string {
  return request.headers.get('x-owner-session')?.trim() ?? '';
}

/** Dashboard language: `?lang=en` / `{ lang: 'en' }`, defaulting to the site default (es). */
export function requestLang(request: Request, body?: Record<string, unknown>): 'es' | 'en' {
  const fromBody = typeof body?.lang === 'string' ? body.lang.toLowerCase() : '';
  if (fromBody === 'en') return 'en';
  if (fromBody === 'es') return 'es';
  const fromQuery = (new URL(request.url).searchParams.get('lang') ?? '').toLowerCase();
  return fromQuery === 'en' ? 'en' : 'es';
}
