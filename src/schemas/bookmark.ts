import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const bookmarkCreateSchema = z.object({
  url: z.string().trim().min(1).max(4096),
  title: optionalText(500),
  description: optionalText(5000),
  categoryId: z.string().cuid().optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
});

export const bookmarkUpdateSchema = bookmarkCreateSchema.partial().extend({
  categoryId: z.string().cuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
});

export const bookmarkListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  categoryId: z.string().cuid().optional(),
  tag: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED"]).optional(),
  q: z.string().trim().max(200).optional(),
});

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const categoryUpdateSchema = categoryCreateSchema;

export const tagListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

export type BookmarkCreateInput = z.infer<typeof bookmarkCreateSchema>;
export type BookmarkUpdateInput = z.infer<typeof bookmarkUpdateSchema>;
