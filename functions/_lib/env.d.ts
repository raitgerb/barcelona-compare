// Minimal Cloudflare Workers / Pages Functions types used by this project's
// `functions/` directory.
//
// Hand-rolled on purpose: adding `@cloudflare/workers-types` would pull the whole
// Workers global surface (Request/Response/fetch/...) into the Astro build's type
// space, where it fights the DOM lib. Extend this file when a new binding or API
// is actually used.

interface D1ResultMeta {
  duration?: number;
  changes?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
  [key: string]: unknown;
}

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1ResultMeta;
  error?: string;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

interface Env {
  /** D1 binding declared in wrangler.toml (local dev) and in the Pages project (deployed). */
  DB: D1Database;
  /** Admin token guarding registry writes. Set as a Pages secret in production. */
  REGISTRY_ADMIN_TOKEN?: string;
  /**
   * Pages deploy hook URL for the production branch (badge freshness — see
   * functions/_lib/rebuild.ts). Set as an encrypted variable in the production
   * deployment config only; when unset, rebuild triggers are recorded no-ops.
   */
  DEPLOY_HOOK_URL?: string;
  [key: string]: unknown;
}

interface EventContext<E = Env> {
  request: Request;
  env: E;
  params: Record<string, string | string[]>;
  data: Record<string, unknown>;
  functionPath: string;
  waitUntil(promise: Promise<unknown>): void;
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
}

type PagesFunction<E = Env> = (context: EventContext<E>) => Response | Promise<Response>;
