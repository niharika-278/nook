import { PrismaClient } from "@prisma/client";
import { createBookmark } from "../src/services/bookmark-service.js";
import { normalizeCategoryAliases } from "../src/services/category-cleanup-service.js";
import { createCorrection } from "../src/services/processing-service.js";

const prisma = new PrismaClient({ datasources: { db: { url: "postgresql://nook:nook_dev_password@localhost:5433/nook_test?schema=public" } } });
const testRun = Date.now();

describe("safe category alias cleanup", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("moves only AI assignments, preserves manual corrections, and is idempotent", async () => {
    const user = await prisma.user.create({ data: { email: `cleanup-${testRun}@example.com`, passwordHash: "test" } });
    const portfolio = await prisma.category.create({ data: { userId: user.id, name: "Portfolio" } });
    const alias = await prisma.category.create({ data: { userId: user.id, name: "Professional Portfolio" } });
    const aiBookmark = await createBookmark(prisma, user.id, { url: "https://example.com/cleanup-ai", categoryId: alias.id, tags: ["React"] });
    await prisma.bookmark.update({ where: { id: aiBookmark.id }, data: { categorySource: "AI" } });
    const manualBookmark = await createBookmark(prisma, user.id, { url: "https://example.com/cleanup-manual", categoryId: alias.id });
    await createCorrection(prisma, user.id, manualBookmark.id, { category: "Professional Portfolio", reason: "Keep this manual shelf." });

    const first = await normalizeCategoryAliases(prisma, { userId: user.id, apply: true });
    expect(first.groups[0]?.movedBookmarks).toBe(1);
    expect(first.groups[0]?.protectedBookmarks).toBe(1);
    expect((await prisma.bookmark.findUniqueOrThrow({ where: { id: aiBookmark.id } })).categoryId).toBe(portfolio.id);
    expect((await prisma.bookmarkTag.findMany({ where: { bookmarkId: aiBookmark.id }, include: { tag: true } })).map(({ tag }) => tag.name)).toContain("Professional Portfolio");
    expect((await prisma.bookmark.findUniqueOrThrow({ where: { id: manualBookmark.id } })).categoryId).toBe(alias.id);

    const beforeSecondRun = await prisma.category.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true } });
    await normalizeCategoryAliases(prisma, { userId: user.id, apply: true });
    const afterSecondRun = await prisma.category.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true } });
    expect(afterSecondRun).toEqual(beforeSecondRun);
  });

  it("creates a canonical category and removes an unused alias on apply", async () => {
    const user = await prisma.user.create({ data: { email: `cleanup-canonical-${testRun}@example.com`, passwordHash: "test" } });
    const alias = await prisma.category.create({ data: { userId: user.id, name: "Personal Website" } });
    await prisma.category.create({ data: { userId: user.id, name: "Personal Portfolio" } });
    const bookmark = await createBookmark(prisma, user.id, { url: "https://example.com/cleanup-canonical", categoryId: alias.id });
    await prisma.bookmark.update({ where: { id: bookmark.id }, data: { categorySource: "AI" } });

    const dryRun = await normalizeCategoryAliases(prisma, { userId: user.id });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.groups[0]?.createdCanonical).toBe(false);
    expect(dryRun.groups[0]?.wouldCreateCanonical).toBe(true);
    expect(await prisma.category.count({ where: { userId: user.id } })).toBe(2);

    await normalizeCategoryAliases(prisma, { userId: user.id, apply: true });
    const categories = await prisma.category.findMany({ where: { userId: user.id } });
    expect(categories.map(({ name }) => name)).toEqual(["Portfolio"]);
    expect((await prisma.bookmark.findUniqueOrThrow({ where: { id: bookmark.id } })).categoryId).toBe(categories[0]?.id);
  });
});
