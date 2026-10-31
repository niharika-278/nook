import { z } from "zod";
import { AppError } from "../domain/errors.js";
import { tagKey } from "../domain/taxonomy.js";

const MAX_CATEGORY_LENGTH = 100;
const MAX_TAG_LENGTH = 80;
const MAX_TAG_COUNT = 20;
const MAX_SUMMARY_LENGTH = 2_000;

function normalizeText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function normalizeTagList(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const key = tagKey(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
  }
  return normalized;
}

const classificationText = (max: number) =>
  z.preprocess(normalizeText, z.string().min(1).max(max).nullable());

const classificationTag = z.preprocess(
  normalizeText,
  z.string().min(1).max(MAX_TAG_LENGTH),
);

const placeholderValues = new Set([
  "na",
  "n/a",
  "none",
  "null",
  "unknown",
  "unclassified",
  "not available",
  "no category",
  "no summary",
]);

function isPlaceholder(value: string): boolean {
  return placeholderValues.has(value.toLowerCase());
}

/**
 * The classification schema is deliberately strict at the AI boundary. It
 * also applies the same NFKC/whitespace normalization used by persistence and
 * removes tags that are duplicates after the shared tag normalization layer.
 */
export const classificationSchema = z.object({
  category: classificationText(MAX_CATEGORY_LENGTH),
  tags: z.array(classificationTag).max(MAX_TAG_COUNT).transform(normalizeTagList),
  summary: classificationText(MAX_SUMMARY_LENGTH),
  confidence: z.number().min(0).max(1).nullable(),
}).strict().superRefine((classification, context) => {
  if (classification.category === null && classification.tags.length === 0 && classification.summary === null) {
    context.addIssue({ code: "custom", message: "classification must contain useful content" });
  }

  if (classification.category !== null && isPlaceholder(classification.category)) {
    context.addIssue({ code: "custom", path: ["category"], message: "placeholder categories are not allowed" });
  }
  if (classification.summary !== null && isPlaceholder(classification.summary)) {
    context.addIssue({ code: "custom", path: ["summary"], message: "placeholder summaries are not allowed" });
  }
  classification.tags.forEach((tag, index) => {
    if (isPlaceholder(tag)) {
      context.addIssue({ code: "custom", path: ["tags", index], message: "placeholder tags are not allowed" });
    }
  });
});

export type Classification = z.infer<typeof classificationSchema>;

/** Validate and normalize output from any AIProvider, including custom ones. */
export function validateClassification(value: unknown): Classification {
  const result = classificationSchema.safeParse(value);
  if (!result.success) {
    throw new AppError(502, "AI_OUTPUT_INVALID", "the AI provider returned an invalid classification");
  }
  return result.data;
}

const collectionSuggestionItemSchema = z.object({
  name: z.preprocess(normalizeText, z.string().min(1).max(120)),
  description: z.preprocess(normalizeText, z.string().min(1).max(500)),
  bookmarkIds: z.array(z.string().cuid()).min(2).max(30).transform((ids) => [...new Set(ids)]),
}).strict();

export const collectionSuggestionSchema = z.object({
  suggestions: z.array(collectionSuggestionItemSchema).max(10),
}).strict();

export type CollectionSuggestion = z.infer<typeof collectionSuggestionItemSchema>;

export function validateCollectionSuggestions(value: unknown, allowedBookmarkIds: readonly string[]): CollectionSuggestion[] {
  const parsed = collectionSuggestionSchema.safeParse(value);
  if (!parsed.success) throw new AppError(502, "AI_OUTPUT_INVALID", "the AI provider returned invalid collection suggestions");
  const allowed = new Set(allowedBookmarkIds);
  if (parsed.data.suggestions.some((suggestion) => suggestion.bookmarkIds.some((id) => !allowed.has(id)))) {
    throw new AppError(502, "AI_OUTPUT_INVALID", "the AI provider referenced an unavailable bookmark");
  }
  return parsed.data.suggestions.filter((suggestion) => suggestion.bookmarkIds.length >= 2);
}

export interface ClassificationInput {
  stage?: "METADATA" | "CONTENT";
  existingCategories?: string[];
  url: string;
  title?: string;
  description?: string;
  sourceDomain?: string;
  faviconUrl?: string;
  previewImageUrl?: string;
  contentType: string;
  text: string;
  corrections: Array<{ category?: string; tags: string[]; reason?: string }>;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  classify(input: ClassificationInput): Promise<Classification>;
  suggestCollections?(input: CollectionSuggestionInput): Promise<CollectionSuggestion[]>;
}

export interface CollectionSuggestionInput {
  bookmarks: Array<{
    id: string;
    title?: string;
    description?: string;
    category?: string;
    tags: string[];
    content?: string;
  }>;
}
