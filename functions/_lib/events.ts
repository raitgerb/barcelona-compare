// Per-business event counters (B2B partner analytics).
//
// The only module that touches `business_events` (migrations/0002_business_events.sql).
// Counters are aggregated at write time, keyed by (placeId, Europe/Madrid day, event
// type) — the same `place_id` key as the registry, so a monthly partner report joins
// the two with no extra mapping.
//
// What is deliberately NOT stored: cookies, session ids, IP addresses, user-agent
// strings, referrers, page URLs. A row is a number.
//
// Docs: docs/business-analytics.md

export const EVENT_TYPES = [
  'view',
  'click_phone',
  'click_whatsapp',
  'click_website',
  'click_directions',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const CLICK_TYPES = EVENT_TYPES.filter((t): t is Exclude<EventType, 'view'> => t !== 'view');

/**
 * Google Places IDs are URL-safe alphanumeric strings (e.g. `ChIJN1t_tDeuEmsRUsoyG83frY4`).
 * The bound is deliberately loose in the character set and tight in the length: it is a
 * cheap abuse guard, not a validator of Google's format.
 */
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,120}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const MAX_RANGE_DAYS = 400;

export type EventErrorCode = 'invalid_body' | 'invalid_query';

export class EventError extends Error {
  constructor(
    readonly code: EventErrorCode,
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = 'EventError';
  }
}

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

export function isPlaceId(value: unknown): value is string {
  return typeof value === 'string' && PLACE_ID_RE.test(value);
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Calendar day in Europe/Madrid (the market the site serves) as YYYY-MM-DD.
 * UTC would move ~1-2 hours of every evening into the wrong day for the monthly report.
 */
export function madridDate(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10); // no ICU in runtime: fall back to UTC
  }
}

/** Turn `month=YYYY-MM` into an inclusive from/to day range. */
export function monthRange(month: string): { from: string; to: string } {
  if (!MONTH_RE.test(month)) {
    throw new EventError('invalid_query', 'month must be formatted YYYY-MM');
  }
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (m < 1 || m > 12) throw new EventError('invalid_query', 'month must be formatted YYYY-MM');
  const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth).padStart(2, '0')}` };
}

/** Resolve a requested period from `month` or explicit `from`/`to`. */
export function resolvePeriod(params: URLSearchParams): { from: string; to: string } {
  const month = params.get('month');
  if (month) return monthRange(month);

  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to) {
    throw new EventError('invalid_query', 'provide month=YYYY-MM or both from and to (YYYY-MM-DD)');
  }
  if (!isDateString(from) || !isDateString(to)) {
    throw new EventError('invalid_query', 'from and to must be YYYY-MM-DD dates');
  }
  if (from > to) throw new EventError('invalid_query', 'from must not be after to');
  const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (spanDays > MAX_RANGE_DAYS) {
    throw new EventError('invalid_query', `range must not exceed ${MAX_RANGE_DAYS} days`);
  }
  return { from, to };
}

/**
 * Count one event. One write per event (no buffering): the row already exists for
 * everything but the first event of the day, so the daily write count tracks traffic —
 * which is what D1 bills. Idempotent per call by design; callers fire once per event.
 */
export async function recordEvent(
  db: D1Database,
  placeId: string,
  eventType: EventType,
  date: string = madridDate(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO business_events (place_id, date, event_type, count)
       VALUES (?1, ?2, ?3, 1)
       ON CONFLICT (place_id, date, event_type)
       DO UPDATE SET count = count + 1,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(placeId, date, eventType)
    .run();
}

export interface EventTotal {
  placeId: string;
  eventType: EventType;
  total: number;
}

/** Raw (placeId, eventType, total) rows for a day range, optionally one business. */
export async function totalsByType(
  db: D1Database,
  range: { from: string; to: string },
  placeId?: string,
): Promise<EventTotal[]> {
  const rows = await db
    .prepare(
      `SELECT place_id, event_type, SUM(count) AS total
       FROM business_events
       WHERE date >= ?1 AND date <= ?2${placeId ? ' AND place_id = ?3' : ''}
       GROUP BY place_id, event_type
       ORDER BY place_id ASC, event_type ASC`,
    )
    .bind(...(placeId ? [range.from, range.to, placeId] : [range.from, range.to]))
    .all<{ place_id: string; event_type: string; total: number }>();

  return (rows.results ?? []).map((row) => ({
    placeId: row.place_id,
    eventType: row.event_type as EventType,
    total: Number(row.total) || 0,
  }));
}

/** Day-by-day counters for one business (used by the per-business endpoint). */
export async function dailyTotals(
  db: D1Database,
  placeId: string,
  range: { from: string; to: string },
): Promise<Array<{ date: string; eventType: EventType; count: number }>> {
  const rows = await db
    .prepare(
      `SELECT date, event_type, count
       FROM business_events
       WHERE place_id = ?1 AND date >= ?2 AND date <= ?3
       ORDER BY date ASC, event_type ASC`,
    )
    .bind(placeId, range.from, range.to)
    .all<{ date: string; event_type: string; count: number }>();

  return (rows.results ?? []).map((row) => ({
    date: row.date,
    eventType: row.event_type as EventType,
    count: Number(row.count) || 0,
  }));
}

export interface EventBreakdown {
  placeId: string;
  views: number;
  clicks: Record<string, number>;
  clickTotal: number;
  total: number;
}

/** Reshape flat totals into one report row per business. */
export function toBreakdown(totals: EventTotal[]): EventBreakdown[] {
  const byPlace = new Map<string, EventBreakdown>();

  for (const { placeId, eventType, total } of totals) {
    let row = byPlace.get(placeId);
    if (!row) {
      row = { placeId, views: 0, clicks: {}, clickTotal: 0, total: 0 };
      byPlace.set(placeId, row);
    }
    if (eventType === 'view') {
      row.views += total;
    } else {
      row.clicks[eventType.replace(/^click_/, '')] = total;
      row.clickTotal += total;
    }
    row.total += total;
  }

  return [...byPlace.values()].sort((a, b) => b.views - a.views || b.clickTotal - a.clickTotal);
}

export interface DayBreakdown {
  date: string;
  views: number;
  clicks: Record<string, number>;
  clickTotal: number;
  total: number;
}

/** Group day-level counters (one business) into one row per day. */
export function toDailyBreakdown(
  rows: Array<{ date: string; eventType: EventType; count: number }>,
): DayBreakdown[] {
  const byDate = new Map<string, DayBreakdown>();

  for (const { date, eventType, count } of rows) {
    let row = byDate.get(date);
    if (!row) {
      row = { date, views: 0, clicks: {}, clickTotal: 0, total: 0 };
      byDate.set(date, row);
    }
    if (eventType === 'view') {
      row.views += count;
    } else {
      row.clicks[eventType.replace(/^click_/, '')] = count;
      row.clickTotal += count;
    }
    row.total += count;
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
