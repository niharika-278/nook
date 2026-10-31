import { z } from "zod";

export const collectionSuggestionIdSchema = z.object({
  id: z.string().cuid(),
});

export const collectionSuggestionListSchema = z.object({
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
