// Shared HTTP helpers for the registry API.

import { RegistryError } from './registry';

const MAX_BODY_BYTES = 16 * 1024;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorJson(code: string, message: string, status: number): Response {
  return json({ ok: false, error: code, message }, status, { 'cache-control': 'no-store' });
}

/**
 * Turn any thrown value into a JSON response, without leaking internals.
 * Both `RegistryError` (registry) and `EventError` (analytics) carry a machine-readable
 * `code` and an HTTP `status`; anything else is an unexpected failure.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof RegistryError) {
    return errorJson(error.code, error.message, error.status);
  }
  if (error instanceof Error && error.name === 'EventError') {
    const coded = error as Error & { code?: unknown; status?: unknown };
    return errorJson(
      typeof coded.code === 'string' ? coded.code : 'invalid_query',
      error.message,
      typeof coded.status === 'number' ? coded.status : 400,
    );
  }
  console.error('api: unhandled error', error);
  return errorJson('internal_error', 'request failed', 500);
}

export function methodNotAllowed(allow: string): Response {
  return json({ ok: false, error: 'method_not_allowed', message: `use ${allow}` }, 405, {
    allow,
    'cache-control': 'no-store',
  });
}

async function sha256(bytes: BufferSource): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/**
 * Constant-time comparison of the admin token header against the configured secret.
 * Both sides are hashed first so the comparison neither leaks the token length nor
 * short-circuits on the first differing byte.
 */
export async function isAdminRequest(
  request: Request,
  configuredToken: string | undefined,
): Promise<boolean> {
  const provided = request.headers.get('x-registry-admin-token')?.trim() ?? '';
  if (!configuredToken || !provided) return false;

  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    sha256(encoder.encode(provided)),
    sha256(encoder.encode(configuredToken)),
  ]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Parse a JSON request body, rejecting anything oversized or non-object. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BODY_BYTES) {
    throw new RegistryError('invalid_body', 'request body too large');
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new RegistryError('invalid_body', 'request body too large');
  }
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new RegistryError('invalid_body', 'body must be valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RegistryError('invalid_body', 'body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}
