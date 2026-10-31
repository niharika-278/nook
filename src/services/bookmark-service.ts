import type { Prisma, PrismaClient } from "@prisma/client";
import { canonicalizeUrl } from "../domain/url.js";
import { AppError } from "../domain/errors.js";
import { normalizeLabel, tagKey } from "../domain/taxonomy.js";
import type { BookmarkCreateInput, BookmarkUpdateInput } from "../schemas/bookmark.js";

const bookmarkInclude = {
  category: true,
  tags: { include: { tag: true }, orderBy: { tag: { normalizedName: "asc" as const } } },
  classification: true,
} satisfies Prisma.BookmarkInclude;

type BookmarkWithRelations = Prisma.BookmarkGetPayload<{ include: typeof bookmarkInclude }>;

function normalizeTagName(value: string): string {
  return tagKey(value);
}

function uniqueTags(tags: string[] | undefined): string[] {
  return [...new Map((tags ?? []).map((tag) => [normalizeTagName(tag), tag.trim()])).values()]
    .filter((tag) => tag.length > 0);
}

async function ensureCategoryOwnership(
  prisma: Prisma.TransactionClient | PrismaClient,
  userId: string,
  categoryId: string | null | undefined,
): Promise<void> {
  if (categoryId === undefined || categoryId === null) return;
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId }, select: { id: true } });
  if (!category) throw new AppError(404, "CATEGORY_NOT_FOUND", "category not found");
}

async function attachTags(
  prisma: Prisma.TransactionClient,
  userId: string,
  bookmarkId: string,
  names: string[],
): Promise<void> {
  for (const name of names) {
    const normalizedName = normalizeTagName(name);
    const tag = await prisma.tag.upsert({
      where: { userId_normalizedName: { userId, normalizedName } },
      create: { userId, name: name.trim(), normalizedName },
      update: {},
    });
    await prisma.bookmarkTag.create({ data: { bookmarkId, tagId: tag.id } });
  }
}

export async function createBookmark(
  prisma: PrismaClient,
  userId: string,
  input: BookmarkCreateInput,
): Promise<BookmarkWithRelations> {
  const canonicalUrl = canonicalizeUrl(input.url);
  const existing = await prisma.bookmark.findUnique({
    where: { userId_canonicalUrl: { userId, canonicalUrl } },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(409, "EXACT_DUPLICATE", "you have already saved this URL", { existingBookmarkId: existing.id });
  }
  const names = uniqueTags(input.tags);
  return prisma.$transaction(async (tx) => {
    await ensureCategoryOwnership(tx, userId, input.categoryId);
    const bookmark = await tx.bookmark.create({
      data: {
        userId,
        url: input.url.trim(),
        canonicalUrl,
        categorySource: input.categoryId === undefined ? "NONE" : "MANUAL",
        sourceDomain: new URL(canonicalUrl).hostname.toLowerCase(),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
      },
    });
    await attachTags(tx, userId, bookmark.id, names);
    return tx.bookmark.findUniqueOrThrow({ where: { id: bookmark.id }, include: bookmarkInclude });
  });
}

export async function listBookmarks(
  prisma: PrismaClient,
  userId: string,
  options: { page: number; limit: number; categoryId?: string | undefined; tag?: string | undefined; status?: string | undefined; q?: string | undefined },
): Promise<{ items: BookmarkWithRelations[]; page: number; limit: number; total: number }> {
  const where: Prisma.BookmarkWhereInput = { userId };
  if (options.categoryId) where.categoryId = options.categoryId;
  if (options.status) where.processingStatus = options.status;
  if (options.tag) {
    where.tags = { some: { tag: { normalizedName: normalizeTagName(options.tag) } } };
  }
  if (options.q) {
    where.OR = [
      { title: { contains: options.q } },
      { description: { contains: options.q } },
      { canonicalUrl: { contains: options.q } },
      { sourceDomain: { contains: options.q } },
      { category: { name: { contains: options.q, mode: "insensitive" } } },
      { tags: { some: { tag: { normalizedName: { contains: normalizeTagName(options.q), mode: "insensitive" } } } } },
    ];
  }

  const skip = (options.page - 1) * options.limit;
  const [items, total] = await prisma.$transaction([
    prisma.bookmark.findMany({ where, include: bookmarkInclude, orderBy: { createdAt: "desc" }, skip, take: options.limit }),
    prisma.bookmark.count({ where }),
  ]);
  return { items, page: options.page, limit: options.limit, total };
}

export async function getBookmark(prisma: PrismaClient, userId: string, bookmarkId: string): Promise<BookmarkWithRelations> {
  const bookmark = await prisma.bookmark.findFirst({ where: { id: bookmarkId, userId }, include: bookmarkInclude });
  if (!bookmark) throw new AppError(404, "BOOKMARK_NOT_FOUND", "bookmark not found");
  return bookmark;
}

export async function updateBookmark(
  prisma: PrismaClient,
  userId: string,
  bookmarkId: string,
  input: BookmarkUpdateInput,
): Promise<BookmarkWithRelations> {
  const names = input.tags === undefined ? undefined : uniqueTags(input.tags);
  return prisma.$transaction(async (tx) => {
    const current = await tx.bookmark.findFirst({ where: { id: bookmarkId, userId }, select: { id: true, categoryId: true, categorySource: true } });
    if (!current) throw new AppError(404, "BOOKMARK_NOT_FOUND", "bookmark not found");
    await ensureCategoryOwnership(tx, userId, input.categoryId);
    const canonicalUrl = input.url === undefined ? undefined : canonicalizeUrl(input.url);
    const data: Prisma.BookmarkUncheckedUpdateInput = {};
    if (input.url !== undefined && canonicalUrl !== undefined) {
      data.url = input.url.trim();
      data.canonicalUrl = canonicalUrl;
    }
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.categoryId !== undefined) {
      data.categoryId = input.categoryId;
      const categoryChanged = current.categoryId !== input.categoryId;
      const explicitlyCleared = input.categoryId === null && current.categorySource !== "AI";
      if (categoryChanged || explicitlyCleared) data.categorySource = "MANUAL";
    }
    await tx.bookmark.update({ where: { id: bookmarkId }, data });
    if (names !== undefined) {
      await tx.bookmarkTag.deleteMany({ where: { bookmarkId } });
      await attachTags(tx, userId, bookmarkId, names);
    }
    return tx.bookmark.findUniqueOrThrow({ where: { id: bookmarkId }, include: bookmarkInclude });
  });
}

export async function deleteBookmark(prisma: PrismaClient, userId: string, bookmarkId: string): Promise<void> {
  const result = await prisma.bookmark.deleteMany({ where: { id: bookmarkId, userId } });
  if (result.count === 0) throw new AppError(404, "BOOKMARK_NOT_FOUND", "bookmark not found");
}

export async function listCategories(prisma: PrismaClient, userId: string) {
  return prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" }, include: { _count: { select: { bookmarks: true } } } });
}

export async function createCategory(prisma: PrismaClient, userId: string, name: string) {
  const normalizedName = normalizeLabel(name);
  const existing = await prisma.category.findFirst({
    where: { userId, name: { equals: normalizedName, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) throw new AppError(409, "CATEGORY_ALREADY_EXISTS", "a category with that name already exists");
  try {
    return await prisma.category.create({ data: { userId, name: normalizedName }, include: { _count: { select: { bookmarks: true } } } });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      throw new AppError(409, "CATEGORY_ALREADY_EXISTS", "a category with that name already exists");
    }
    throw error;
  }
}

export async function updateCategory(prisma: PrismaClient, userId: string, categoryId: string, name: string) {
  const existing = await prisma.category.findFirst({ where: { id: categoryId, userId }, select: { id: true } });
  if (!existing) throw new AppError(404, "CATEGORY_NOT_FOUND", "category not found");
  const normalizedName = normalizeLabel(name);
  const duplicate = await prisma.category.findFirst({
    where: { userId, id: { not: categoryId }, name: { equals: normalizedName, mode: "insensitive" } },
    select: { id: true },
  });
  if (duplicate) throw new AppError(409, "CATEGORY_ALREADY_EXISTS", "a category with that name already exists");
  try {
    return await prisma.category.update({ where: { id: categoryId }, data: { name: normalizedName }, include: { _count: { select: { bookmarks: true } } } });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      throw new AppError(409, "CATEGORY_ALREADY_EXISTS", "a category with that name already exists");
    }
    throw error;
  }
}

export async function deleteCategory(prisma: PrismaClient, userId: string, categoryId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const category = await tx.category.findFirst({ where: { id: categoryId, userId }, select: { id: true } });
    if (!category) throw new AppError(404, "CATEGORY_NOT_FOUND", "category not found");
    await tx.bookmark.updateMany({ where: { categoryId, userId }, data: { categoryId: null, categorySource: "NONE" } });
    await tx.category.delete({ where: { id: categoryId } });
  });
}

export async function listTags(prisma: PrismaClient, userId: string, limit: number) {
  return prisma.tag.findMany({ where: { userId }, orderBy: { normalizedName: "asc" }, take: limit, include: { _count: { select: { bookmarks: true } } } });
}

export async function removeTagFromBookmark(prisma: PrismaClient, userId: string, bookmarkId: string, tagId: string): Promise<void> {
  const owned = await prisma.bookmarkTag.findFirst({
    where: { bookmarkId, tagId, bookmark: { userId }, tag: { userId } },
    select: { bookmarkId: true },
  });
  if (!owned) throw new AppError(404, "BOOKMARK_TAG_NOT_FOUND", "tag is not associated with this bookmark");
  await prisma.bookmarkTag.delete({ where: { bookmarkId_tagId: { bookmarkId, tagId } } });
}
