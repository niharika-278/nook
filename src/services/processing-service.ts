import type { Prisma, PrismaClient } from "@prisma/client";
import { extractResource, type ExtractedResource } from "../content/processor.js";
import { AppError } from "../domain/errors.js";
import { isFallbackCategory, normalizeLabel, resolveCategoryCandidate, tagKey } from "../domain/taxonomy.js";
import type { AIProvider } from "../ai/types.js";
import { PROMPT_VERSION, fallbackClassification, validateClassification } from "../ai/provider.js";
import type { Classification, ClassificationInput } from "../ai/types.js";
import type { CorrectionInput } from "../schemas/correction.js";

type ResourceExtractor = (url: string) => Promise<ExtractedResource>;
const processingLeaseMs = 5 * 60 * 1000;

function parseTags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeTags(tags: string[]): string[] {
  return [...new Map(tags.map((tag) => [tagKey(tag), tag.normalize("NFKC").trim().replace(/\s+/g, " ")])).values()]
    .filter((tag) => tag.length > 0);
}

async function persistTags(
  prisma: Prisma.TransactionClient,
  userId: string,
  bookmarkId: string,
  tags: string[],
): Promise<void> {
  for (const name of normalizeTags(tags)) {
    const normalizedName = tagKey(name);
    const tag = await prisma.tag.upsert({
      where: { userId_normalizedName: { userId, normalizedName } },
      create: { userId, name, normalizedName },
      update: {},
    });
    await prisma.bookmarkTag.upsert({
      where: { bookmarkId_tagId: { bookmarkId, tagId: tag.id } },
      create: { bookmarkId, tagId: tag.id },
      update: {},
    });
  }
}

function resourceKeywords(bookmark: { url: string; title: string | null; description: string | null; extractedText: string | null }): Set<string> {
  const source = [bookmark.url, bookmark.title ?? "", bookmark.description ?? "", bookmark.extractedText?.slice(0, 6000) ?? ""].join(" ");
  return new Set((source.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).slice(0, 500));
}

async function selectRelevantCorrections(
  prisma: Prisma.TransactionClient | PrismaClient,
  userId: string,
  bookmark: { url: string; title: string | null; description: string | null; extractedText: string | null; contentType: string | null },
) {
  const hostname = new URL(bookmark.url).hostname.toLowerCase();
  const keywords = resourceKeywords(bookmark);
  const candidates = await prisma.userCorrection.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return candidates.map((correction) => {
    let score = 0;
    if (correction.domain?.toLowerCase() === hostname) score += 5;
    if (correction.contentType && correction.contentType === bookmark.contentType) score += 2;
    const correctionKeywords = correction.keywords?.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
    score += correctionKeywords.some((keyword) => keywords.has(keyword)) ? 1 : 0;
    return { correction, score };
  })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.correction.createdAt.getTime() - left.correction.createdAt.getTime())
    .slice(0, 8)
    .map(({ correction }) => {
      const example: { category?: string; tags: string[]; reason?: string } = {
        tags: parseTags(correction.correctedTags),
      };
      if (correction.correctedCategory) example.category = correction.correctedCategory;
      if (correction.reason) example.reason = correction.reason;
      return example;
    });
}

function processingErrorMessage(error: unknown): string {
  if (error instanceof AppError) return `${error.code}: ${error.message}`.slice(0, 1000);
  return "PROCESSING_FAILED: resource processing failed";
}

type ProcessingBookmark = {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  extractedText: string | null;
  contentType: string | null;
  categoryId: string | null;
  categorySource: string;
  sourceDomain: string | null;
  faviconUrl: string | null;
  previewImageUrl: string | null;
};

function metadataIsInsufficient(bookmark: ProcessingBookmark): boolean {
  const parsed = new URL(bookmark.url);
  return !bookmark.title?.trim() && !bookmark.description?.trim() && parsed.pathname === "/" && !parsed.search;
}

async function loadExistingCategories(prisma: PrismaClient, userId: string): Promise<string[]> {
  const categories = await prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" }, select: { name: true } });
  return categories.map(({ name }) => name);
}

function metadataInput(
  bookmark: ProcessingBookmark,
  corrections: ClassificationInput["corrections"],
  existingCategories: string[],
): ClassificationInput {
  return {
    stage: "METADATA",
    existingCategories,
    url: bookmark.url,
    ...(bookmark.title ? { title: bookmark.title } : {}),
    ...(bookmark.description ? { description: bookmark.description } : {}),
    ...(bookmark.sourceDomain ? { sourceDomain: bookmark.sourceDomain } : {}),
    ...(bookmark.faviconUrl ? { faviconUrl: bookmark.faviconUrl } : {}),
    ...(bookmark.previewImageUrl ? { previewImageUrl: bookmark.previewImageUrl } : {}),
    contentType: bookmark.contentType ?? "metadata",
    text: "",
    corrections,
  };
}

function contentInput(
  bookmark: ProcessingBookmark,
  extracted: ExtractedResource,
  corrections: ClassificationInput["corrections"],
  existingCategories: string[],
): ClassificationInput {
  return {
    stage: "CONTENT",
    existingCategories,
    url: extracted.finalUrl,
    ...(bookmark.title ?? extracted.title ? { title: bookmark.title ?? extracted.title } : {}),
    ...(bookmark.description ?? extracted.description ? { description: bookmark.description ?? extracted.description } : {}),
    sourceDomain: extracted.sourceDomain,
    ...(extracted.faviconUrl ? { faviconUrl: extracted.faviconUrl } : {}),
    ...(extracted.previewImageUrl ? { previewImageUrl: extracted.previewImageUrl } : {}),
    contentType: extracted.contentType,
    text: extracted.text,
    corrections,
  };
}

async function persistClassification(
  prisma: PrismaClient,
  userId: string,
  bookmarkId: string,
  provider: AIProvider,
  classification: Classification,
  stage: "METADATA" | "CONTENT",
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.bookmark.findFirst({
      where: { id: bookmarkId, userId },
      select: { categoryId: true, categorySource: true },
    });
    if (!current) throw new AppError(404, "BOOKMARK_NOT_FOUND", "bookmark not found");

    const existingCategories = await tx.category.findMany({ where: { userId }, select: { id: true, name: true } });
    const resolved = resolveCategoryCandidate(classification.category, existingCategories.map(({ name }) => name));
    const resolvedTags = normalizeTags([...classification.tags, ...resolved.additionalTags]);
    let category = resolved.name && !isFallbackCategory(resolved.name) && current.categorySource !== "MANUAL"
      ? existingCategories.find(({ name }) => name === resolved.name)
      : undefined;
    if (resolved.name && !isFallbackCategory(resolved.name) && current.categorySource !== "MANUAL" && !category) {
      category = await tx.category.create({ data: { userId, name: resolved.name }, select: { id: true, name: true } });
    }
    const categoryUpdate = current.categorySource === "MANUAL" || !category
      ? {}
      : { categoryId: category.id, categorySource: "AI" };

    await tx.aIClassification.upsert({
      where: { bookmarkId },
      create: {
        bookmarkId,
        provider: provider.name,
        model: provider.model,
        categoryName: resolved.name,
        tags: JSON.stringify(resolvedTags),
        summary: classification.summary,
        confidence: classification.confidence,
        promptVersion: PROMPT_VERSION,
        classificationStage: stage,
      },
      update: {
        provider: provider.name,
        model: provider.model,
        categoryName: resolved.name,
        tags: JSON.stringify(resolvedTags),
        summary: classification.summary,
        confidence: classification.confidence,
        promptVersion: PROMPT_VERSION,
        classificationStage: stage,
        createdAt: new Date(),
      },
    });
    if (Object.keys(categoryUpdate).length > 0) {
      await tx.bookmark.update({ where: { id: bookmarkId }, data: categoryUpdate });
    }
    await persistTags(tx, userId, bookmarkId, resolvedTags);
  });
}

export async function processBookmark(
  prisma: PrismaClient,
  userId: string,
  bookmarkId: string,
  provider: AIProvider | undefined,
  extractor: ResourceExtractor = extractResource,
) {
  const staleBefore = new Date(Date.now() - processingLeaseMs);
  const claimed = await prisma.bookmark.updateMany({
    where: {
      id: bookmarkId,
      userId,
      OR: [
        { processingStatus: { in: ["PENDING", "FAILED"] } },
        { processingStatus: "PROCESSING", processingStartedAt: null },
        { processingStatus: "PROCESSING", processingStartedAt: { lt: staleBefore } },
      ],
    },
    data: { processingStatus: "PROCESSING", processingError: null, processingStartedAt: new Date(), contentError: null },
  });
  if (claimed.count === 0) {
    const bookmark = await prisma.bookmark.findFirst({ where: { id: bookmarkId, userId }, select: { id: true, processingStatus: true } });
    if (!bookmark) throw new AppError(404, "BOOKMARK_NOT_FOUND", "bookmark not found");
    throw new AppError(409, "PROCESSING_IN_PROGRESS", `bookmark is already ${bookmark.processingStatus.toLowerCase()}`);
  }

  try {
    const bookmark = await prisma.bookmark.findUniqueOrThrow({
      where: { id: bookmarkId },
      select: {
        id: true,
        url: true,
        title: true,
        description: true,
        extractedText: true,
        contentType: true,
        categoryId: true,
        categorySource: true,
        sourceDomain: true,
        faviconUrl: true,
        previewImageUrl: true,
      },
    });
    let classificationSucceeded = false;
    let metadataError: unknown;
    if (provider) {
      try {
        const corrections = await selectRelevantCorrections(prisma, userId, {
          url: bookmark.url,
          title: bookmark.title,
          description: bookmark.description,
          extractedText: bookmark.extractedText,
          contentType: bookmark.contentType,
        });
        const existingCategories = await loadExistingCategories(prisma, userId);
        const metadata = metadataIsInsufficient(bookmark)
          ? fallbackClassification
          : validateClassification(await provider.classify(metadataInput(bookmark, corrections, existingCategories)));
        await persistClassification(prisma, userId, bookmarkId, provider, metadata, "METADATA");
        classificationSucceeded = true;
      } catch (error) {
        metadataError = error;
      }
    } else {
      metadataError = new AppError(503, "AI_NOT_CONFIGURED", "AI classification is not configured");
    }

    await prisma.bookmark.updateMany({
      where: { id: bookmarkId, userId },
      data: { contentStatus: "PROCESSING", contentError: null },
    });

    let extracted: ExtractedResource;
    try {
      extracted = await extractor(bookmark.url);
    } catch (error) {
      await prisma.bookmark.updateMany({
        where: { id: bookmarkId, userId },
        data: {
          contentStatus: "FAILED",
          contentError: processingErrorMessage(error),
          processingStatus: classificationSucceeded ? "COMPLETED" : "FAILED",
          processingError: classificationSucceeded ? null : processingErrorMessage(metadataError ?? error),
          processingStartedAt: null,
          processedAt: classificationSucceeded ? new Date() : null,
        },
      });
      if (classificationSucceeded) return prisma.bookmark.findUniqueOrThrow({ where: { id: bookmarkId }, include: { classification: true } });
      throw metadataError ?? error;
    }
    const extractedData: Prisma.BookmarkUncheckedUpdateInput = {
      canonicalUrl: extracted.finalUrl,
      sourceDomain: extracted.sourceDomain,
      contentType: extracted.contentType,
      extractedText: extracted.text,
      contentHash: extracted.contentHash,
      processingError: null,
      contentStatus: "COMPLETED",
      contentError: null,
    };
    if (!bookmark.title && extracted.title) extractedData.title = extracted.title;
    if (!bookmark.description && extracted.description) extractedData.description = extracted.description;
    if (extracted.author) extractedData.author = extracted.author;
    if (extracted.publishedAt) extractedData.publishedAt = new Date(extracted.publishedAt);
    if (extracted.faviconUrl) extractedData.faviconUrl = extracted.faviconUrl;
    if (extracted.previewImageUrl) extractedData.previewImageUrl = extracted.previewImageUrl;
    const duplicate = await prisma.bookmark.findFirst({
      where: { userId, id: { not: bookmarkId }, contentHash: extracted.contentHash },
      select: { id: true },
    });
    extractedData.duplicateType = duplicate ? "LIKELY" : "NONE";
    extractedData.duplicateOfId = duplicate?.id ?? null;
    await prisma.bookmark.update({ where: { id: bookmarkId }, data: extractedData });

    if (provider) {
      try {
        const corrections = await selectRelevantCorrections(prisma, userId, {
          url: extracted.finalUrl,
          title: bookmark.title ?? extracted.title ?? null,
          description: bookmark.description ?? extracted.description ?? null,
          extractedText: extracted.text,
          contentType: extracted.contentType,
        });
        const existingCategories = await loadExistingCategories(prisma, userId);
        const classification = validateClassification(await provider.classify(contentInput(bookmark, extracted, corrections, existingCategories)));
        await persistClassification(prisma, userId, bookmarkId, provider, classification, "CONTENT");
        classificationSucceeded = true;
      } catch (error) {
        classificationSucceeded = false;
        metadataError = metadataError ?? error;
      }
    }

    await prisma.bookmark.update({
      where: { id: bookmarkId },
      data: {
        processingStatus: classificationSucceeded ? "COMPLETED" : "FAILED",
        processingError: classificationSucceeded ? null : processingErrorMessage(metadataError),
        processingStartedAt: null,
        processedAt: classificationSucceeded ? new Date() : null,
      },
    });
    if (!classificationSucceeded) throw metadataError ?? new AppError(503, "AI_NOT_CONFIGURED", "AI classification is not configured");
    return prisma.bookmark.findUniqueOrThrow({ where: { id: bookmarkId }, include: { classification: true } });
  } catch (error) {
    await prisma.bookmark.updateMany({
      where: { id: bookmarkId, userId },
      data: { processingStatus: "FAILED", processingStartedAt: null, processingError: processingErrorMessage(error) },
    }).catch(() => undefined);
    throw error;
  }
}

export async function createCorrection(prisma: PrismaClient, userId: string, bookmarkId: string, input: CorrectionInput) {
  const bookmark = await prisma.bookmark.findFirst({
    where: { id: bookmarkId, userId },
    include: { classification: true },
  });
  if (!bookmark) throw new AppError(404, "BOOKMARK_NOT_FOUND", "bookmark not found");
  const domain = new URL(bookmark.url).hostname.toLowerCase();
  const keywords = [...resourceKeywords(bookmark)].slice(0, 200).join(" ");
  const correction = await prisma.$transaction(async (tx) => {
    let categoryId: string | null | undefined;
    if (input.category !== undefined) {
      if (input.category === null) {
        categoryId = null;
      } else {
        const normalizedCategory = normalizeLabel(input.category);
        const existingCategory = await tx.category.findFirst({ where: { userId, name: { equals: normalizedCategory, mode: "insensitive" } }, select: { id: true } });
        const category = existingCategory ?? await tx.category.create({ data: { userId, name: normalizedCategory }, select: { id: true } });
        categoryId = category.id;
      }
    }
    if (input.tags !== undefined) {
      await tx.bookmarkTag.deleteMany({ where: { bookmarkId } });
      await persistTags(tx, userId, bookmarkId, input.tags);
    }
    await tx.bookmark.update({
      where: { id: bookmarkId },
      data: {
        ...(categoryId === undefined ? {} : { categoryId, categorySource: "MANUAL" }),
      },
    });
    return tx.userCorrection.create({
      data: {
        userId,
        bookmarkId,
        domain,
        contentType: bookmark.contentType,
        originalCategory: bookmark.classification?.categoryName ?? null,
        correctedCategory: input.category ?? null,
        originalTags: bookmark.classification?.tags ?? null,
        correctedTags: input.tags === undefined ? null : JSON.stringify(normalizeTags(input.tags)),
        keywords,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      },
    });
  });
  return correction;
}

export async function listCorrections(prisma: PrismaClient, userId: string, options: { page: number; limit: number }) {
  const skip = (options.page - 1) * options.limit;
  const [items, total] = await prisma.$transaction([
    prisma.userCorrection.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take: options.limit,
      include: { bookmark: { select: { id: true, title: true, url: true } } },
    }),
    prisma.userCorrection.count({ where: { userId } }),
  ]);
  return { items, page: options.page, limit: options.limit, total };
}
