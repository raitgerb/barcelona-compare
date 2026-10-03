import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const businessSchema = z.object({
  name: z.string(),
  neighborhood: z.string(),
  address: z.string(),
  phone: z.string().optional(),
  website: z.string().url().optional(),
<<<<<<< HEAD
=======
  websiteEn: z.string().url().optional(),
  websiteCa: z.string().url().optional(),
  description: z.string().optional(),
  descriptionEn: z.string().optional(),
>>>>>>> 1060f87 (fix: correct Noa's Secret listing details)
  whatsapp: z.string().optional(),
  priceIndicator: z.enum(['€', '€€', '€€€']).optional(),
  services: z.array(z.object({
    name: z.string(),
    price: z.string().optional(),
  })).default([]),
  hours: z.record(z.string(), z.string()).optional(),
  languages: z.array(z.string()).default(['Español']),
  googleRating: z.number().min(0).max(5).optional(),
  googleReviewCount: z.number().int().min(0).optional(),
  googlePlaceId: z.string().optional(),
  mapPlaceId: z.string().optional(),
  photos: z.array(z.string()).default([]),
  featured: z.boolean().default(false),
  massageTypes: z.array(z.string()).optional(),
  primaryType: z.string().optional(),
  googleMapsUri: z.string().optional(),
  googleReviews: z.array(z.object({
    author: z.string(),
    rating: z.number().min(0).max(5),
    relativeTime: z.string().default(''),
    languageCode: z.string().default(''),
    text: z.string(),
  })).default([]),
  serviceTags: z.array(z.string()).optional(),
  googleEditorialSummary: z.string().optional(),
});

const nails = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/nails' }),
  schema: businessSchema,
});

const massage = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/massage' }),
  schema: businessSchema,
});

export const collections = { nails, massage };
