/**
 * Review insights: rating-distribution estimation + bilingual keyword extraction
 * from the googleReviews we have in frontmatter. Build-time only, no runtime deps.
 *
 * We store up to ~5 recent reviews per business, not the full histogram. The
 * distribution below reconstructs an approximate 5→1 breakdown by scaling the
 * sample's rating shares to the business's real googleReviewCount. Honest
 * labeling in the UI: "distribución estimada a partir de las reseñas mostradas".
 */

export interface RawReview {
  author?: string;
  rating?: number;
  relativeTime?: string;
  languageCode?: string;
  text?: string;
}

export interface Histogram {
  counts: [number, number, number, number, number]; // index 0 = 5★ … index 4 = 1★
  total: number; // reviews sampled (what the bars are actually based on)
  share: [number, number, number, number, number]; // 0..1 fractions
}

export function ratingHistogram(reviews: RawReview[] | undefined, sampleCap = 200): Histogram | null {
  const ratings = (reviews ?? [])
    .map(r => Math.round(Number(r.rating)))
    .filter(n => Number.isInteger(n) && n >= 1 && n <= 5);
  if (ratings.length < 3) return null; // too thin to say anything
  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const r of ratings) counts[5 - r]++;
  const total = Math.min(ratings.length, sampleCap);
  const share = counts.map(c => (total ? c / total : 0)) as unknown as [number, number, number, number, number];
  return { counts, total: ratings.length, share };
}

// ---------- keyword mining ----------

interface KeywordDef {
  key: string;
  es: string;
  en: string;
  ca: string;
  patterns: RegExp[];
  positive?: boolean;
}

// Patterns match accent-stripped lowercase review text (ES + EN).
const KEYWORDS: KeywordDef[] = [
  { key: 'trato',       es: 'trato amable',       en: 'friendly staff',       ca: 'tracte amable',        positive: true,
    patterns: [/\b(amable|simpatic|agradable|atent[oa]s?|friendly|kind|welcoming|hospitalar|hospitality|hospitable)\b/, /\bbuen trato\b/, /\bgreat service\b/] },
  { key: 'calidad',     es: 'buen resultado',     en: 'great result',         ca: 'bon resultat',         positive: true,
    patterns: [/\b(perfect|perfecto|precios[ao]|increible|incrível|enamorad|encantad|hermos|beautiful|gorgeous|stunning|love[d]? (my|mis|the)|me encant)\b/, /\bbuen (trabajo|resultado|acabado)\b/, /\b(very )?good (job|work|result)\b/] },
  { key: 'profesional', es: 'profesionalidad',    en: 'professional',         ca: 'professionalitat',     positive: true,
    patterns: [/\b(profesional|meticulos[oa]?|detallista|cuidados[oa]|precis[oa]|meticulous|detail(ed|ed)?|skilled|clean work)\b/, /\b(al minimo detalle|minimo detalle|attention to detail)\b/] },
  { key: 'precio',      es: 'buena relación calidad-precio', en: 'good value', ca: 'bona relació qualitat-preu', positive: true,
    patterns: [/\b(barat|bien de precio|buena relación|calidad precio|calidad-precio|affordable|reasonable (price|prices)|good (value|price)|cheap)\b/, /\bprecio[s]? (bajos|razonable|razonables)\b/] },
  { key: 'limpieza',    es: 'limpieza',           en: 'cleanliness',          ca: 'neteja',               positive: true,
    patterns: [/\b(limpio|limpieza|higien|esteril|clean(ty|liness)?|hygien|sterile)\b/] },
  { key: 'ambiente',    es: 'buen ambiente',      en: 'nice atmosphere',      ca: 'bon ambient',          positive: true,
    patterns: [/\b(ambiente|acogedor|decoraci|ambience|ambiance|atmosphere|cozy|vibe|relaxing place|lugar agradable)\b/] },
  { key: 'rapidez',     es: 'rapidez',            en: 'quick service',        ca: 'rapidesa',             positive: true,
    patterns: [/\b(rapido|rapid[oa]s|puntual|sin cita|quick(ly)?|fast|efficient|on time|no wait|walk.?in)\b/, /\b(en poco tiempo\b)/] },
  { key: 'reserva',     es: 'fácil de reservar',  en: 'easy booking',         ca: 'fàcil de reservar',    positive: true,
    patterns: [/\b(reserv|cita|booking|booked|appointment|whatsapp)\b/] },
  { key: 'idiomas',     es: 'atención en inglés', en: 'english-speaking',     ca: 'atenció en anglès',    positive: true,
    patterns: [/\b(english|ingl[ée]s|hablan ingles|speaks? english)\b/] },
  { key: 'recomendado', es: 'muy recomendado',    en: 'highly recommended',   ca: 'molt recomanat',       positive: true,
    patterns: [/\b(recomiend[oa]|recomendable|recommen[d]?d|will (be )?(back|return)|volver[ée]|vengo|regular place|my new place|fijo)\b/] },
  // Negative signals — only surfaced when they clearly dominate
  { key: 'trato-malo',  es: 'mal trato',          en: 'poor service',         ca: 'mal tracte',           positive: false,
    patterns: [/\b(maleducad|gro[s]?[s]?|rude|unfriendly|mal trato|malcarad|desagradable|unprofessional)\b/] },
  { key: 'espera',      es: 'esperas largas',     en: 'long waits',           ca: 'esperes llargues',     positive: false,
    patterns: [/\b(esper[ae]|tarda[r]?(ron|ndo)?|delay|wait(ed|ing)?|slow|lento)\b/] },
  { key: 'caro',        es: 'caro',               en: 'pricey',               ca: 'car',                  positive: false,
    patterns: [/\b(caro|cara|expensive|overpriced|rip.?off|steep)\b/] },
  { key: 'resultado-malo', es: 'resultado decepcionante', en: 'disappointing result', ca: 'resultat decebedor', positive: false,
    patterns: [/\b(mal(in|o|a)? (masaje|trabajo|acabado|resultado)|desastre|horrible|terrible|awful|worst|never again|nunca (mas|volver)|no (vuelvo|recomiendo))\b/, /\b(bad|poor|disappointing) (service|result|experience)\b/] },
];

export interface KeywordHit {
  key: string;
  es: string;
  en: string;
  ca: string;
  positive: boolean;
  count: number;   // matching reviews in sample
  share: number;   // fraction of sampled reviews mentioning it
}

export function reviewKeywords(reviews: RawReview[] | undefined, minShare = 0.15, minCount = 3, maxOut = 5): KeywordHit[] {
  const sampled = (reviews ?? []).filter(r => typeof r.text === 'string' && r.text.length > 3);
  if (sampled.length < 5) return [];
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hits: KeywordHit[] = [];
  for (const kw of KEYWORDS) {
    let count = 0;
    for (const r of sampled) {
      const hay = norm((r.text as string));
      if (kw.patterns.some(p => p.test(hay))) count++;
    }
    const share = count / sampled.length;
    if (count >= minCount && share >= minShare) {
      hits.push({ key: kw.key, es: kw.es, en: kw.en, ca: kw.ca, positive: kw.positive !== false, count, share });
    }
  }
  // Positives first, by share desc; cap negatives at 1 so one gripe can't dominate
  hits.sort((a, b) => (Number(b.positive) - Number(a.positive)) || (b.share - a.share));
  const negatives = hits.filter(h => !h.positive).slice(0, 1);
  return [...hits.filter(h => h.positive).slice(0, maxOut), ...negatives].slice(0, maxOut + 1);
}
