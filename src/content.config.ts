import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const businessSchema = z.object({
  name: z.string(),
  neighborhood: z.string(),
  address: z.string(),
  phone: z.string().optional(),
  website: z.string().url().optional(),
  whatsapp: z.string().optional(),
  priceIndicator: z.enum(['€', '€€', '€€€']).optional(),
  services: z.array(z.object({
    name: z.string(),
    price: z.string().optional(),
  })).default([]),
  hours: z.record(z.string()).optional(),
  languages: z.array(z.string()).default(['Español']),
  googleRating: z.number().min(0).max(5).optional(),
  googleReviewCount: z.number().int().min(0).optional(),
  googlePlaceId: z.string().optional(),
  photos: z.array(z.string()).default([]),
  featured: z.boolean().default(false),
  massageTypes: z.array(z.string()).optional(),
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
