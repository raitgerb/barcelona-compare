// Neighborhood metadata for guide pages.
// Intro copy is original editorial text (no third-party licensing issues).
export interface NeighborhoodMeta {
  es: string;
  en: string;
  ca: string;
  vibe: string; // short character descriptor used in meta descriptions
  vibeCa: string; // same, for the /ca/ hub
}

export const neighborhoodGuides: Record<string, NeighborhoodMeta> = {
  'Eixample': {
    es: 'El Eixample es el corazón modernista de Barcelona: calles en cuadrícula, infinitud de comercios locales y una densidad de salones de uñas y centros de masaje difícil de igualar. Ideal si buscas variedad y buena conexión con metro (L2, L3, L4, L5).',
    en: "Eixample is Barcelona's modernist heart: grid streets, endless local shops, and a density of nail salons and massage centers that's hard to beat. Ideal if you want variety and metro access (L2, L3, L4, L5).",
    ca: "L'Eixample és el cor modernista de Barcelona: carrers en quadrícula, una infinitat de comerços locals i una densitat de salons de manicura i centres de massatge difícil d'igualar. Ideal si busques varietat i bona connexió amb metro (L2, L3, L4, L5).",
    vibe: 'modernist grid, endless choice, metro hub',
    vibeCa: 'quadrícula modernista, oferta infinita, nus de metro',
  },
  'Gràcia': {
    es: 'Gràcia tiene alma de pueblo dentro de la ciudad: plazas con terrazas, boutiques independientes y una escena beauty muy local. Los salones aquí suelen ser pequeños, personales y con clientela fiel.',
    en: 'Gràcia feels like a village inside the city: plaza cafés, independent boutiques and a very local beauty scene. Salons here tend to be small, personal, with loyal regulars.',
    ca: "Gràcia té ànima de poble dins de la ciutat: places amb terrasses, botigues independents i una escena d'estètica molt local. Els salons d'aquí solen ser petits, personals i amb clientela fidel.",
    vibe: 'village squares, indie boutiques, local scene',
    vibeCa: 'places de poble, botigues independents, escena local',
  },
  'Ciutat Vella': {
    es: 'El casco antiguo — El Born, Gòtic i Raval — concentra turistas y locales por igual. Muchos centros de masaje tailandés y spa del centro están aquí, junto a opciones rápidas de manicura para viajeros.',
    en: "The old town — El Born, Gòtic and Raval — draws tourists and locals alike. Many of the city's Thai massage centers and spas sit here, alongside quick manicure options for travelers.",
    ca: "El casc antic — El Born, el Gòtic i el Raval — concentra turistes i locals per igual. Molts centres de massatge tailandès i spas del centre són aquí, al costat d'opcions ràpides de manicura per a viatgers.",
    vibe: 'old town, Thai massage capital, walk-in friendly',
    vibeCa: 'casc antic, capital del massatge tailandès, sense cita',
  },
  'Sarrià-Sant Gervasi': {
    es: 'Zona residencial de nivel alto: salones boutique, centros de estética completos y una clientela que valora la discreción y la calidad. Precios algo superiores a la media de la ciudad.',
    en: 'An upscale residential district: boutique salons, full-service aesthetic centers and clients who value discretion and quality. Prices run slightly above the city average.',
    ca: "Zona residencial de nivell alt: salons boutique, centres d'estètica complets i una clientela que valora la discreció i la qualitat. Els preus són una mica per sobre de la mitjana de la ciutat.",
    vibe: 'upscale residential, boutique salons',
    vibeCa: 'residencial de gamma alta, salons boutique',
  },
  'Sants-Montjuïc': {
    es: 'Barrio largo y diverso, de Sants comercial a las faldas de Montjuïc. Buena relación calidad-precio y muchos negocios familiares con años de oficio.',
    en: 'A long, diverse district from shopping-street Sants up the slopes of Montjuïc. Good value for money and many family-run businesses with years of craft.',
    ca: 'Barri llarg i divers, dels Sants comercial als peus de Montjuïc. Bona relació qualitat-preu i molts negocis familiars amb anys d\'ofici.',
    vibe: 'local shopping streets, family-run, value',
    vibeCa: 'carrers comercials de barri, negocis familiars, bon preu',
  },
  'Sant Martí': {
    es: 'Del Poblenou tech al Clot más tradicional: un distrito en transformación con salones nuevos mezclados con negocios de toda la vida. El Poblenou concentra las aperturas más recientes.',
    en: 'From techy Poblenou to traditional Clot: a district in transformation where brand-new salons mix with lifelong businesses. Poblenou has the newest openings.',
    ca: 'Del Poblenou tecnològic al Clot més tradicional: un districte en transformació amb salons nous barrejats amb negocis de tota la vida. El Poblenou concentra les obertures més recents.',
    vibe: 'Poblenou tech district, new openings, mixed character',
    vibeCa: 'Poblenou tecnològic, obertures noves, caràcter mixt',
  },
  'Les Corts': {
    es: 'Entre Diagonal y la Zona Universitaria: clientela mixta de oficinas y universidad, horarios amplios y centros eficientes pensados para la prisa del mediodía.',
    en: 'Between Diagonal and the university zone: an office-and-student clientele, wide opening hours and efficient centers built for the lunchtime rush.',
    ca: "Entre Diagonal i la Zona Universitària: clientela mixta d'oficines i universitat, horaris amplis i centres eficients pensats per a la pressa del migdia.",
    vibe: 'office & university crowd, efficient, lunch-break appointments',
    vibeCa: 'oficines i universitat, eficients, cita a l\'hora de dinar',
  },
  'Horta-Guinardó': {
    es: 'Barrios residenciales en las colinas: precios contenidos, trato cercano y salones de barrio donde te reciben por tu nombre.',
    en: 'Residential neighborhoods on the hills: contained prices, close personal service and corner salons where they greet you by name.',
    ca: 'Barris residencials als turons: preus continguts, tracte proper i salons de barri on et reben pel teu nom.',
    vibe: 'hilly residential, neighborhood feel, fair prices',
    vibeCa: 'residencial de turó, ambient de barri, preus justos',
  },
  'Nou Barris': {
    es: 'El distrito más auténticamente local: pocos turistas, mucho vecino. Los salones compiten en precio y trato, no en decoración.',
    en: "The most authentically local district: few tourists, lots of neighbors. Salons compete on price and personal treatment, not décor.",
    ca: 'El districte més autènticament local: pocs turistes, molts veïns. Els salons competeixen en preu i tracte, no en decoració.',
    vibe: 'authentically local, price-conscious, community',
    vibeCa: 'autènticament local, preu ajustat, comunitat',
  },
  'Sant Andreu': {
    es: 'Antigua zona fabril hoy tranquila y familiar, con la Rambla como eje. Oferta compacta pero sólida, con negocios veteranos muy bien valorados.',
    en: 'A former factory district, now calm and family-oriented around its rambla. A compact but solid offering with well-rated veteran businesses.',
    ca: 'Antiga zona fabril avui tranquil·la i familiar, amb la Rambla com a eix. Oferta compacta però sòlida, amb negocis veterans molt ben valorats.',
    vibe: 'former factories, family area, veteran businesses',
    vibeCa: 'antigues fàbriques, zona familiar, negocis veterans',
  },
};

export const guideSlugs = Object.keys(neighborhoodGuides);
