import { z } from "zod";

export const correctionSchema = z.object({
  category: z.string().trim().min(1).max(100).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
}).superRefine((value, context) => {
  if (value.category === undefined && (!value.tags || value.tags.length === 0)) {
    context.addIssue({ code: "custom", path: ["category"], message: "provide a corrected category or at least one corrected tag" });
  }
});

export type CorrectionInput = z.infer<typeof correctionSchema>;
