import { z } from "zod";

export const collectionCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  categoryId: z.string().cuid().nullable().optional(),
});

export const collectionUpdateSchema = collectionCreateSchema;

export const collectionListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const collectionBookmarkSchema = z.object({
  bookmarkId: z.string().cuid(),
});

export type CollectionInput = z.infer<typeof collectionCreateSchema>;
