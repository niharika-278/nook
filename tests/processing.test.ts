import { PrismaClient } from "@prisma/client";
import { createBookmark } from "../src/services/bookmark-service.js";
import { createCorrection, listCorrections, processBookmark } from "../src/services/processing-service.js";
import { acceptCollectionSuggestion, generateCollectionSuggestions, listCollectionSuggestions } from "../src/services/collection-suggestion-service.js";
import { AppError } from "../src/domain/errors.js";
import type { AIProvider } from "../src/ai/types.js";
import type { ExtractedResource } from "../src/content/processor.js";

const prisma = new PrismaClient({ datasources: { db: { url: "postgresql://nook:nook_dev_password@localhost:5433/nook_test?schema=public" } } });

const extracted: ExtractedResource = {
  finalUrl: "https://example.com/guide",
  contentType: "text/html",
  sourceDomain: "example.com",
  title: "Useful guide",
  description: "A guide",
  text: "A useful guide about secure systems.",
  contentHash: "hash-guide",
};

const successfulProvider: AIProvider = {
  name: "test-provider",
  model: "test-model",
  classify: async (input) => ({
    category: input.corrections[0]?.category ?? "Reading",
    tags: ["reference", "secure"],
    summary: "A concise guide.",
    confidence: 0.95,
  }),
};

describe("bookmark processing and recovery", () => {
  beforeAll(async () => {
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it("persists extraction and validated AI results as one completed flow", async () => {
    const user = await prisma.user.create({ data: { email: "processor@example.com", passwordHash: "test" } });
    const category = await prisma.category.create({ data: { userId: user.id, name: "Reading" } });
    const bookmark = await createBookmark(prisma, user.id, { url: "https://example.com/guide", categoryId: category.id });
    const result = await processBookmark(prisma, user.id, bookmark.id, successfulProvider, async () => extracted);

    expect(result.processingStatus).toBe("COMPLETED");
  expect(result.classification?.categoryName).toBe("Reading");
  expect(result.classification?.tags).toBe(JSON.stringify(["reference", "secure"]));
  expect(result.classification?.classificationStage).toBe("CONTENT");
  const stored = await prisma.bookmark.findUniqueOrThrow({ where: { id: bookmark.id } });
    expect(stored.extractedText).toContain("secure systems");
    expect(stored.processingError).toBeNull();
    expect(stored.sourceDomain).toBe("example.com");
    expect(stored.categoryId).toBe(category.id);
    expect(await prisma.bookmarkTag.count({ where: { bookmarkId: bookmark.id } })).toBe(2);
  });

  it("preserves extracted content and records a retryable failure when AI fails", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "processor@example.com" } });
    const bookmark = await createBookmark(prisma, user.id, { url: "https://example.com/failure" });
    const failingProvider: AIProvider = {
      name: "test-provider",
      model: "test-model",
      classify: async () => { throw new AppError(502, "AI_OUTPUT_INVALID", "invalid test output"); },
    };

    await expect(processBookmark(prisma, user.id, bookmark.id, failingProvider, async () => ({ ...extracted, finalUrl: "https://example.com/failure" })))
      .rejects.toThrow("invalid test output");
    const stored = await prisma.bookmark.findUniqueOrThrow({ where: { id: bookmark.id } });
    expect(stored.processingStatus).toBe("FAILED");
    expect(stored.extractedText).toContain("secure systems");
  expect(stored.processingError).toBe("AI_OUTPUT_INVALID: invalid test output");
    expect(stored.contentStatus).toBe("COMPLETED");
    expect(await prisma.aIClassification.findUnique({ where: { bookmarkId: bookmark.id } })).toBeNull();
  });

  it("classifies saved metadata when source extraction is forbidden", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "processor@example.com" } });
    const bookmark = await createBookmark(prisma, user.id, {
      url: "https://blocked.example/guide",
      title: "A secure systems guide",
      description: "A guide about secure systems.",
    });
    const classify = vi.fn(async (_input: Parameters<AIProvider["classify"]>[0]) => ({
      category: "Reading",
      tags: ["reference"],
      summary: "A summary grounded in the saved description.",
      confidence: 0.8,
    }));
    const provider: AIProvider = { name: "test-provider", model: "test-model", classify };

    const result = await processBookmark(prisma, user.id, bookmark.id, provider, async () => {
      throw new AppError(422, "REMOTE_FETCH_FAILED", "the remote resource returned HTTP 403");
    });

    expect(classify).toHaveBeenCalledOnce();
    expect(classify.mock.calls[0]?.[0]).toMatchObject({
      stage: "METADATA",
      url: "https://blocked.example/guide",
      title: "A secure systems guide",
      description: "A guide about secure systems.",
      text: "",
    });
    expect(result.processingStatus).toBe("COMPLETED");
    expect(result.contentStatus).toBe("FAILED");
    expect(result.contentError).toContain("HTTP 403");
    expect(result.classification?.classificationStage).toBe("METADATA");
    expect(result.classification?.categoryName).toBe("Reading");
    const createdCategory = await prisma.category.findFirst({ where: { userId: user.id, name: "Reading" } });
    expect(createdCategory).not.toBeNull();
    expect((await prisma.bookmark.findUniqueOrThrow({ where: { id: bookmark.id } })).categorySource).toBe("AI");
  });

  it("reuses a suitable existing category and keeps the narrower label as a tag", async () => {
    const user = await prisma.user.create({ data: { email: "taxonomy-reuse@example.com", passwordHash: "test" } });
    const portfolio = await prisma.category.create({ data: { userId: user.id, name: "Portfolio" } });
    const bookmark = await createBookmark(prisma, user.id, {
      url: "https://example.com/portfolio-reuse",
      title: "Personal portfolio tips",
    });
    const provider: AIProvider = {
      name: "test-provider",
      model: "test-model",
      classify: async (input) => ({
        category: input.existingCategories?.includes("Portfolio") ? "personal portfolio" : "Portfolio",
        tags: ["projects"],
        summary: null,
        confidence: 0.9,
      }),
    };
    await processBookmark(prisma, user.id, bookmark.id, provider, async () => {
      throw new AppError(422, "REMOTE_FETCH_FAILED", "the remote resource returned HTTP 403");
    });
    const stored = await prisma.bookmark.findUniqueOrThrow({ where: { id: bookmark.id }, include: { category: true, tags: { include: { tag: true } } } });
    expect(stored.categoryId).toBe(portfolio.id);
    expect(stored.category?.name).toBe("Portfolio");
    expect(stored.tags.map(({ tag }) => tag.name)).toEqual(expect.arrayContaining(["projects", "personal portfolio"]));
  });

  it("creates a distinct reusable category instead of forcing an unrelated parent", async () => {
    const user = await prisma.user.create({ data: { email: "taxonomy-distinct@example.com", passwordHash: "test" } });
    await prisma.category.create({ data: { userId: user.id, name: "Engineering" } });
    const bookmark = await createBookmark(prisma, user.id, { url: "https://example.com/software-engineering", title: "Software engineering practices" });
    const provider: AIProvider = {
      name: "test-provider",
      model: "test-model",
      classify: async () => ({ category: "Software Engineering", tags: ["architecture"], summary: null, confidence: 0.9 }),
    };
    await processBookmark(prisma, user.id, bookmark.id, provider, async () => {
      throw new AppError(422, "REMOTE_FETCH_FAILED", "the remote resource returned HTTP 403");
    });
    const stored = await prisma.bookmark.findUniqueOrThrow({ where: { id: bookmark.id }, include: { category: true } });
    expect(stored.category?.name).toBe("Software Engineering");
    expect(await prisma.category.count({ where: { userId: user.id } })).toBe(2);
  });

  it("preserves existing manual tags while AI adds normalized tags", async () => {
    const user = await prisma.user.create({ data: { email: "taxonomy-tags@example.com", passwordHash: "test" } });
    const bookmark = await createBookmark(prisma, user.id, { url: "https://example.com/tag-preservation", tags: ["React"] });
    const provider: AIProvider = {
      name: "test-provider",
      model: "test-model",
      classify: async () => ({ category: "Programming", tags: ["ReactJS", "TypeScript"], summary: null, confidence: 0.9 }),
    };
    await processBookmark(prisma, user.id, bookmark.id, provider, async () => {
      throw new AppError(422, "REMOTE_FETCH_FAILED", "the remote resource returned HTTP 403");
    });
    const tags = await prisma.bookmarkTag.findMany({ where: { bookmarkId: bookmark.id }, include: { tag: true }, orderBy: { tag: { normalizedName: "asc" } } });
    expect(tags.map(({ tag }) => tag.normalizedName)).toEqual(["react", "typescript"]);
    expect(tags.find(({ tag }) => tag.normalizedName === "react")?.tag.name).toBe("React");
  });

  it("creates a usable category when AI names a new shelf", async () => {
    const user = await prisma.user.create({ data: { email: "new-ai-category@example.com", passwordHash: "test" } });
    const bookmark = await createBookmark(prisma, user.id, { url: "https://example.com/new-ai-category", title: "A new topic" });
    const provider: AIProvider = {
      name: "test-provider",
      model: "test-model",
      classify: async () => ({ category: "Fresh topic", tags: ["new"], summary: null, confidence: 0.8 }),
    };
    await processBookmark(prisma, user.id, bookmark.id, provider, async () => {
      throw new AppError(422, "REMOTE_FETCH_FAILED", "the remote resource returned HTTP 403");
    });
    const stored = await prisma.bookmark.findUniqueOrThrow({ where: { id: bookmark.id }, include: { category: true } });
    expect(stored.category?.name).toBe("Fresh topic");
    expect(stored.categorySource).toBe("AI");
  });

  it("preserves a manual correction made while content enrichment is in flight", async () => {
    const user = await prisma.user.create({ data: { email: "in-flight-correction@example.com", passwordHash: "test" } });
    const bookmark = await createBookmark(prisma, user.id, {
      url: "https://example.com/in-flight-correction",
      title: "A guide",
      description: "A guide for processing.",
    });
    let releaseExtraction!: () => void;
    let extractionStarted!: () => void;
    const extractionReady = new Promise<void>((resolve) => { extractionStarted = resolve; });
    const extractionRelease = new Promise<void>((resolve) => { releaseExtraction = resolve; });
    const provider: AIProvider = {
      name: "test-provider",
      model: "test-model",
      classify: async () => ({ category: "Reading", tags: ["reference"], summary: "A guide.", confidence: 0.9 }),
    };
    const processing = processBookmark(prisma, user.id, bookmark.id, provider, async () => {
      extractionStarted();
      await extractionRelease;
      return { ...extracted, finalUrl: "https://example.com/in-flight-correction" };
    });
    await extractionReady;
    await createCorrection(prisma, user.id, bookmark.id, { category: "Engineering", tags: ["manual"], reason: "Keep this with engineering references." });
    releaseExtraction();
    await processing;

    const stored = await prisma.bookmark.findUniqueOrThrow({ where: { id: bookmark.id }, include: { category: true } });
    expect(stored.category?.name).toBe("Engineering");
    expect(stored.categorySource).toBe("MANUAL");
    expect(stored.processingStatus).toBe("COMPLETED");
  });

  it("revalidates custom provider output before persistence", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "processor@example.com" } });
    const bookmark = await createBookmark(prisma, user.id, { url: "https://example.com/custom-provider" });
    const invalidProvider: AIProvider = {
      name: "custom-test-provider",
      model: "custom-test-model",
      classify: async () => ({ category: null, tags: [], summary: null, confidence: null }),
    };

    await expect(processBookmark(prisma, user.id, bookmark.id, invalidProvider, async () => ({
      ...extracted,
      finalUrl: "https://example.com/custom-provider",
    }))).rejects.toMatchObject({ code: "AI_OUTPUT_INVALID" });
    const stored = await prisma.bookmark.findUniqueOrThrow({ where: { id: bookmark.id } });
    expect(stored.processingStatus).toBe("FAILED");
    expect(stored.processingError).toBe("AI_OUTPUT_INVALID: the AI provider returned an invalid classification");
  });

  it("stores corrections without treating them as model training", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "processor@example.com" } });
    const bookmark = await prisma.bookmark.findFirstOrThrow({ where: { userId: user.id, url: "https://example.com/guide" } });
    const correction = await createCorrection(prisma, user.id, bookmark.id, {
      category: "Engineering",
      tags: ["Security", "security"],
      reason: "This belongs with engineering references.",
    });

    expect(correction.correctedCategory).toBe("Engineering");
    expect(correction.correctedTags).toBe(JSON.stringify(["security"]));
    expect(correction.reason).toContain("engineering references");
    const corrections = await listCorrections(prisma, user.id, { page: 1, limit: 10 });
    expect(corrections.total).toBe(1);
    expect(corrections.items[0]?.bookmark?.id).toBe(bookmark.id);
    const correctedBookmark = await prisma.bookmark.findUniqueOrThrow({ where: { id: bookmark.id } });
    expect(correctedBookmark.categoryId).not.toBeNull();
    expect(await prisma.bookmarkTag.count({ where: { bookmarkId: bookmark.id } })).toBe(1);
  });

  it("creates reviewable AI collection suggestions without changing bookmark organization", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "processor@example.com" } });
    const second = await createBookmark(prisma, user.id, { url: "https://example.com/second" });
    await processBookmark(prisma, user.id, second.id, successfulProvider, async () => ({ ...extracted, finalUrl: "https://example.com/second" }));
    const first = await prisma.bookmark.findFirstOrThrow({ where: { userId: user.id, canonicalUrl: "https://example.com/guide" } });
    const provider: AIProvider = {
      ...successfulProvider,
      suggestCollections: async ({ bookmarks }) => [{
        name: "Secure reading",
        description: "Processed resources about secure systems.",
        bookmarkIds: bookmarks.slice(0, 2).map(({ id }) => id),
      }],
    };
    const created = await generateCollectionSuggestions(prisma, user.id, provider);
    expect(created).toHaveLength(1);
    const pending = await listCollectionSuggestions(prisma, user.id, { limit: 10 });
    expect(pending[0]?.status).toBe("PENDING");
    expect(pending[0]?.bookmarks).toHaveLength(2);
    const collection = await acceptCollectionSuggestion(prisma, user.id, created[0]!.id);
    expect(collection.source).toBe("AI");
    expect(collection.bookmarks).toHaveLength(2);
    expect((await prisma.bookmark.findUniqueOrThrow({ where: { id: first.id } })).processingStatus).toBe("COMPLETED");
  });

  it("reclaims a stale processing lease after an interrupted worker", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "processor@example.com" } });
    const bookmark = await createBookmark(prisma, user.id, { url: "https://example.com/stale" });
    await prisma.bookmark.update({
      where: { id: bookmark.id },
      data: { processingStatus: "PROCESSING", processingStartedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    const result = await processBookmark(prisma, user.id, bookmark.id, successfulProvider, async () => ({ ...extracted, finalUrl: "https://example.com/stale" }));
    expect(result.processingStatus).toBe("COMPLETED");
    expect((await prisma.bookmark.findUniqueOrThrow({ where: { id: bookmark.id } })).processingStartedAt).toBeNull();
  });
});
