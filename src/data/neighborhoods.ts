// Neighborhood metadata for guide pages.
// Intro copy is original editorial text (no third-party licensing issues).
export interface NeighborhoodMeta {
  es: string;
  en: string;
  vibe: string; // short character descriptor used in meta descriptions
}

export const neighborhoodGuides: Record<string, NeighborhoodMeta> = {
  'Eixample': {
    es: 'El Eixample es el corazón modernista de Barcelona: calles en cuadrícula, infinitud de comercios locales y una densidad de salones de uñas y centros de masaje difícil de igualar. Ideal si buscas variedad y buena conexión con metro (L2, L3, L4, L5).',
    en: "Eixample is Barcelona's modernist heart: grid streets, endless local shops, and a density of nail salons and massage centers that's hard to beat. Ideal if you want variety and metro access (L2, L3, L4, L5).",
    vibe: 'modernist grid, endless choice, metro hub',
  },
  'Gràcia': {
    es: 'Gràcia tiene alma de pueblo dentro de la ciudad: plazas con terrazas, boutiques independientes y una escena beauty muy local. Los salones aquí suelen ser pequeños, personales y con clientela fiel.',
    en: 'Gràcia feels like a village inside the city: plaza cafés, independent boutiques and a very local beauty scene. Salons here tend to be small, personal, with loyal regulars.',
    vibe: 'village squares, indie boutiques, local scene',
  },
  'Ciutat Vella': {
    es: 'El casco antiguo — El Born, Gòtic i Raval — concentra turistas y locales por igual. Muchos centros de masaje tailandés y spa del centro están aquí, junto a opciones rápidas de manicura para viajeros.',
    en: "The old town — El Born, Gòtic and Raval — draws tourists and locals alike. Many of the city's Thai massage centers and spas sit here, alongside quick manicure options for travelers.",
    vibe: 'old town, Thai massage capital, walk-in friendly',
  },
  'Sarrià-Sant Gervasi': {
    es: 'Zona residencial de nivel alto: salones boutique, centros de estética completos y una clientela que valora la discreción y la calidad. Precios algo superiores a la media de la ciudad.',
    en: 'An upscale residential district: boutique salons, full-service aesthetic centers and clients who value discretion and quality. Prices run slightly above the city average.',
    vibe: 'upscale residential, boutique salons',
  },
  'Sants-Montjuïc': {
    es: 'Barrio largo y diverso, de Sants comercial a las faldas de Montjuïc. Buena relación calidad-precio y muchos negocios familiares con años de oficio.',
    en: 'A long, diverse district from shopping-street Sants up the slopes of Montjuïc. Good value for money and many family-run businesses with years of craft.',
    vibe: 'local shopping streets, family-run, value',
  },
  'Sant Martí': {
    es: 'Del Poblenou tech al Clot más tradicional: un distrito en transformación con salones nuevos mezclados con negocios de toda la vida. El Poblenou concentra las aperturas más recientes.',
    en: 'From techy Poblenou to traditional Clot: a district in transformation where brand-new salons mix with lifelong businesses. Poblenou has the newest openings.',
    vibe: 'Poblenou tech district, new openings, mixed character',
  },
  'Les Corts': {
    es: 'Entre Diagonal y la Zona Universitaria: clientela mixta de oficinas y universidad, horarios amplios y centros eficientes pensados para la prisa del mediodía.',
    en: 'Between Diagonal and the university zone: an office-and-student clientele, wide opening hours and efficient centers built for the lunchtime rush.',
    vibe: 'office & university crowd, efficient, lunch-break appointments',
  },
  'Horta-Guinardó': {
    es: 'Barrios residenciales en las colinas: precios contenidos, trato cercano y salones de barrio donde te reciben por tu nombre.',
    en: 'Residential neighborhoods on the hills: contained prices, close personal service and corner salons where they greet you by name.',
    vibe: 'hilly residential, neighborhood feel, fair prices',
  },
  'Nou Barris': {
    es: 'El distrito más auténticamente local: pocos turistas, mucho vecino. Los salones compiten en precio y trato, no en decoración.',
    en: "The most authentically local district: few tourists, lots of neighbors. Salons compete on price and personal treatment, not décor.",
    vibe: 'authentically local, price-conscious, community',
  },
  'Sant Andreu': {
    es: 'Antigua zona fabril hoy tranquila y familiar, con la Rambla como eje. Oferta compacta pero sólida, con negocios veteranos muy bien valorados.',
    en: 'A former factory district, now calm and family-oriented around its rambla. A compact but solid offering with well-rated veteran businesses.',
    vibe: 'former factories, family area, veteran businesses',
  },
};

export const guideSlugs = Object.keys(neighborhoodGuides);
