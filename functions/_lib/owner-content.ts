// Edge-inject the owner's published content into the static detail pages.
//
// The site is statically built, so the Google-derived services / hours / photo
// strip are baked into every listing page. When an owner publishes edits
// (Phase 1 self-service), `functions/_middleware.ts` calls this module to swap
// those regions for the owner's version *in the served HTML* — no rebuild,
// no client-side fetch, and crawlers see the same content a visitor does.
//
// Regions: gallery, services, hours, whatsapp. `whatsapp` is a single CTA slot
// (the prominent "Reservar por WhatsApp" button), which is what lets an owner who
// had no WhatsApp number on their listing publish one and see it live in seconds
// instead of waiting for a rebuild — only 9 of 1,182 listings carry one from Google.
//
//     <!--owner:services--> …default markup… <!--/owner:services-->
//
// Comment pairs (rather than CSS selectors) are the anchor because they survive
// every template refactor that keeps the markers, cannot collide with business
// content, and are inert if injection never happens. When a business has no
// published override, the response is returned untouched — this module is only
// reached for pages that have one.

import type { ProfileOverride } from './profile';
import { WHATSAPP_ICON_PATH, whatsappHref } from './whatsapp';

export const OWNER_MARKERS = ['gallery', 'services', 'hours', 'whatsapp'] as const;
export type OwnerRegion = (typeof OWNER_MARKERS)[number];

/** True when the payload carries our markers at all (cheap gate before parsing). */
export function hasOwnerMarkers(html: string): boolean {
  return html.includes('<!--owner:gallery-->');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** yyyy-mm-dd -> dd/mm/yyyy (both locales on this site use day-first dates). */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

interface Labels {
  services: string;
  hours: string;
  closed: string;
  owned: string;
  ownerPhotos: string;
  whatsappCta: string;
  whatsappHint: string;
  updated: (date: string) => string;
}

function labels(lang: string): Labels {
  if (lang === 'en') {
    return {
      services: 'Services & Prices',
      hours: 'Opening Hours',
      closed: 'Closed',
      owned: 'Provided by the business',
      ownerPhotos: 'Photos from the business',
      whatsappCta: 'Book on WhatsApp',
      whatsappHint: 'Book without calling — your message is ready to send',
      updated: (date) => `Details provided by the business · updated ${date}`,
    };
  }
  return {
    services: 'Servicios y precios',
    hours: 'Horario',
    closed: 'Cerrado',
    owned: 'Datos facilitados por el negocio',
    ownerPhotos: 'Fotos del negocio',
    whatsappCta: 'Reservar por WhatsApp',
    whatsappHint: 'Pide cita sin llamar — el mensaje ya está escrito',
    updated: (date) => `Datos facilitados por el negocio · actualizado el ${date}`,
  };
}

const DAY_LABELS: Record<string, Record<string, string>> = {
  es: {
    monday: 'Lunes',
    tuesday: 'Martes',
    wednesday: 'Miércoles',
    thursday: 'Jueves',
    friday: 'Viernes',
    saturday: 'Sábado',
    sunday: 'Domingo',
  },
  en: {
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
    sunday: 'Sunday',
  },
};

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** Replace the inner HTML of one marker region. No-op when the markers are absent. */
function replaceRegion(
  html: string,
  region: OwnerRegion,
  transform: (inner: string) => string,
): { html: string; changed: boolean } {
  const open = `<!--owner:${region}-->`;
  const close = `<!--/owner:${region}-->`;
  const start = html.indexOf(open);
  if (start === -1) return { html, changed: false };
  const end = html.indexOf(close, start + open.length);
  if (end === -1) return { html, changed: false };
  const inner = html.slice(start + open.length, end);
  const next = transform(inner);
  if (next === inner) return { html, changed: false };
  return { html: html.slice(0, start + open.length) + next + html.slice(end), changed: true };
}

function renderServices(override: ProfileOverride, lang: string, updated: string): string {
  const services = override.services ?? [];
  const l = labels(lang);
  const rows = services
    .map((service) => {
      const price = service.price
        ? `<span class="font-medium text-stone-900">${escapeHtml(service.price)}</span>`
        : '<span class="text-stone-400">—</span>';
      return `<div class="flex justify-between py-2.5"><span class="text-stone-700">${escapeHtml(
        service.name,
      )}</span>${price}</div>`;
    })
    .join('');
  const note = override.priceNote
    ? `<p class="text-sm text-stone-600 mt-3">${escapeHtml(override.priceNote)}</p>`
    : '';
  const attribution = `<p class="text-xs text-stone-500 mt-3">${escapeHtml(l.updated(updated))}</p>`;
  return `<section class="mb-8" data-owner-content="services"><h2 class="text-lg font-semibold text-stone-900 mb-3">${l.services}</h2><div class="divide-y divide-stone-100">${rows}</div>${note}${attribution}</section>`;
}

function renderHours(override: ProfileOverride, lang: string, updated: string): string {
  const hours = override.hours ?? {};
  const l = labels(lang);
  const dayLabels = DAY_LABELS[lang] ?? DAY_LABELS.es!;
  const rows = DAY_ORDER.filter((day) => day in hours)
    .map((day) => {
      const value = (hours[day] ?? '').trim();
      const shown = value ? escapeHtml(value) : `<span class="text-stone-400">${l.closed}</span>`;
      return `<div class="flex justify-between py-2 text-sm"><span class="text-stone-500 w-24">${escapeHtml(
        dayLabels[day] ?? day,
      )}</span><span class="text-stone-700">${shown}</span></div>`;
    })
    .join('');
  const attribution = `<p class="text-xs text-stone-500 mt-3">${escapeHtml(l.updated(updated))}</p>`;
  return `<section class="mb-8" data-owner-content="hours"><h2 class="text-lg font-semibold text-stone-900 mb-3">${l.hours}</h2><div class="divide-y divide-stone-100">${rows}</div>${attribution}</section>`;
}

function renderWhatsappCta(number: string, lang: string): string {
  const l = labels(lang);
  const href = whatsappHref(number, lang === 'en' ? 'en' : 'es');
  return (
    `<div class="mb-6" data-owner-content="whatsapp">` +
    `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" data-track-event="click_whatsapp"` +
    ` class="flex w-full items-center justify-center gap-2.5 rounded-xl bg-green-600 px-5 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-green-700">` +
    `<svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${WHATSAPP_ICON_PATH}"/></svg>` +
    `${escapeHtml(l.whatsappCta)}</a>` +
    `<p class="mt-2 text-center text-xs text-stone-500">${escapeHtml(l.whatsappHint)}</p>` +
    `</div>`
  );
}

function renderGallery(
  inner: string,
  override: ProfileOverride,
  lang: string,
  galleryBase: string,
): string {
  const l = labels(lang);
  let out = inner;
  for (const index of override.hiddenPhotos) {
    // The lightbox resolves photos by DOM index against `${galleryBase}-N.jpg`, so
    // hidden slots stay in the markup (display:none) instead of being removed —
    // every remaining Google photo keeps pointing at its own file.
    const pattern = new RegExp(`(<img[^>]*?src="[^"]*-${index}\\.jpg")`, 'g');
    out = out.replace(pattern, '$1 style="display:none"');
  }
  if (override.addedPhotos.length === 0) return out;

  // Owner photos live in their own block (not `.photo-gallery`), so the lightbox
  // never tries to resolve them as `${galleryBase}-N.jpg`; each one links to the
  // full-size image instead.
  const cards = override.addedPhotos
    .map(
      (url, i) =>
        `<a href="${escapeHtml(url)}" target="_blank" rel="noopener nofollow" class="snap-start shrink-0"><img src="${escapeHtml(
          url,
        )}" alt="${escapeHtml(l.ownerPhotos)} ${i + 1}" class="min-w-[280px] h-48 object-cover rounded-xl border border-stone-100 bg-stone-100" width="280" height="192" loading="lazy" decoding="async" /></a>`,
    )
    .join('');
  const block = `<div class="mb-8" data-owner-content="photos"><h2 class="text-base font-semibold text-stone-900 mb-3">${l.ownerPhotos}</h2><div class="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">${cards}</div></div>`;
  return `${out}${block}`;
}

export interface InjectInput {
  html: string;
  override: ProfileOverride;
  lang: 'es' | 'en';
  /** Image base path for the Google strip, e.g. `https://pub-x.r2.dev/images/nails/salon`. */
  galleryBase: string;
}

/**
 * Swap the owner's content into the served HTML. Returns `changed: false` when
 * nothing applied (then the caller should return the original response as-is).
 */
export function injectOwnerContent(input: InjectInput): { html: string; changed: boolean } {
  const { override, lang } = input;
  const updated = formatDate(override.updatedAt);
  let html = input.html;
  let changed = false;

  const gallery = replaceRegion(html, 'gallery', (inner) =>
    renderGallery(inner, override, lang, input.galleryBase),
  );
  html = gallery.html;
  changed = changed || gallery.changed;

  if (override.services !== null) {
    const services = replaceRegion(html, 'services', () =>
      override.services!.length > 0 ? renderServices(override, lang, updated) : '',
    );
    html = services.html;
    changed = changed || services.changed;
  }

  if (override.hours !== null) {
    const hours = replaceRegion(html, 'hours', () =>
      Object.keys(override.hours!).length > 0 ? renderHours(override, lang, updated) : '',
    );
    html = hours.html;
    changed = changed || hours.changed;
  }

  if (override.whatsapp !== null) {
    // A stored number wins over the Google-derived CTA; an empty value (never
    // produced by the dashboard, which sends null instead) clears the slot.
    const whatsapp = replaceRegion(html, 'whatsapp', () =>
      override.whatsapp ? renderWhatsappCta(override.whatsapp, lang) : '',
    );
    html = whatsapp.html;
    changed = changed || whatsapp.changed;
  }

  return { html, changed };
}

/** Path shapes that carry the markers: `/nails/<slug>/` and `/en/massage/<slug>/`. */
export const DETAIL_PATH_RE = /^\/(?:en\/)?(nails|massage)\/([^/]+)\/?$/;

export interface DetailPathMatch {
  category: 'nails' | 'massage';
  lang: 'es' | 'en';
  /** URL-decoded slug (site slugs may contain non-ASCII letters). */
  slug: string;
}

export function matchDetailPath(pathname: string): DetailPathMatch | null {
  const match = DETAIL_PATH_RE.exec(pathname);
  if (!match) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(match[2]!);
  } catch {
    return null;
  }
  return {
    category: match[1] as 'nails' | 'massage',
    lang: pathname.startsWith('/en/') ? 'en' : 'es',
    slug,
  };
}

export function galleryBaseFor(category: string, slug: string, r2Base: string | undefined): string {
  const base = (r2Base ?? '').replace(/\/+$/, '');
  return `${base}/images/${category}/${slug}`;
}
