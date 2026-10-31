import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError, isPrismaUniqueConstraint } from "../domain/errors.js";
import type { CollectionInput } from "../schemas/collection.js";

const collectionSummaryInclude = {
  category: true,
  _count: { select: { bookmarks: true } },
} satisfies Prisma.CollectionInclude;

type CollectionSummary = Prisma.CollectionGetPayload<{ include: typeof collectionSummaryInclude }>;

async function ensureCategoryOwnership(
  prisma: Prisma.TransactionClient | PrismaClient,
  userId: string,
  categoryId: string | null | undefined,
): Promise<void> {
  if (categoryId === undefined || categoryId === null) return;
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId }, select: { id: true } });
  if (!category) throw new AppError(404, "CATEGORY_NOT_FOUND", "category not found");
}

export async function listCollections(
  prisma: PrismaClient,
  userId: string,
  options: { page: number; limit: number },
): Promise<{ items: CollectionSummary[]; page: number; limit: number; total: number }> {
  const skip = (options.page - 1) * options.limit;
  const [items, total] = await prisma.$transaction([
    prisma.collection.findMany({
      where: { userId },
      include: collectionSummaryInclude,
      orderBy: { createdAt: "desc" },
      skip,
      take: options.limit,
    }),
    prisma.collection.count({ where: { userId } }),
  ]);
  return { items, page: options.page, limit: options.limit, total };
}

export async function getCollection(prisma: PrismaClient, userId: string, collectionId: string) {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, userId },
    include: {
      category: true,
      bookmarks: {
        orderBy: { createdAt: "desc" },
        include: {
          bookmark: { include: { category: true, tags: { include: { tag: true } } } },
        },
      },
      _count: { select: { bookmarks: true } },
    },
  });
  if (!collection) throw new AppError(404, "COLLECTION_NOT_FOUND", "collection not found");
  return collection;
}

export async function createCollection(prisma: PrismaClient, userId: string, input: CollectionInput) {
  await ensureCategoryOwnership(prisma, userId, input.categoryId);
  try {
    return await prisma.collection.create({
      data: {
        userId,
        name: input.name.trim(),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
      },
      include: collectionSummaryInclude,
    });
  } catch (error) {
    if (isPrismaUniqueConstraint(error)) {
      throw new AppError(409, "COLLECTION_ALREADY_EXISTS", "a collection with that name already exists");
    }
    throw error;
  }
}

export async function updateCollection(
  prisma: PrismaClient,
  userId: string,
  collectionId: string,
  input: CollectionInput,
) {
  const existing = await prisma.collection.findFirst({ where: { id: collectionId, userId }, select: { id: true } });
  if (!existing) throw new AppError(404, "COLLECTION_NOT_FOUND", "collection not found");
  await ensureCategoryOwnership(prisma, userId, input.categoryId);
  try {
    return await prisma.collection.update({
      where: { id: collectionId },
      data: {
        name: input.name.trim(),
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
      },
      include: collectionSummaryInclude,
    });
  } catch (error) {
    if (isPrismaUniqueConstraint(error)) {
      throw new AppError(409, "COLLECTION_ALREADY_EXISTS", "a collection with that name already exists");
    }
    throw error;
  }
}

export async function deleteCollection(prisma: PrismaClient, userId: string, collectionId: string): Promise<void> {
  const result = await prisma.collection.deleteMany({ where: { id: collectionId, userId } });
  if (result.count === 0) throw new AppError(404, "COLLECTION_NOT_FOUND", "collection not found");
}

export async function addBookmarkToCollection(
  prisma: PrismaClient,
  userId: string,
  collectionId: string,
  bookmarkId: string,
) {
  return prisma.$transaction(async (tx) => {
    const collection = await tx.collection.findFirst({ where: { id: collectionId, userId }, select: { id: true } });
    if (!collection) throw new AppError(404, "COLLECTION_NOT_FOUND", "collection not found");
    const bookmark = await tx.bookmark.findFirst({ where: { id: bookmarkId, userId }, select: { id: true } });
    if (!bookmark) throw new AppError(404, "BOOKMARK_NOT_FOUND", "bookmark not found");
    return tx.collectionBookmark.upsert({
      where: { collectionId_bookmarkId: { collectionId, bookmarkId } },
      create: { collectionId, bookmarkId },
      update: {},
    });
  });
}

export async function removeBookmarkFromCollection(
  prisma: PrismaClient,
  userId: string,
  collectionId: string,
  bookmarkId: string,
): Promise<void> {
  const collection = await prisma.collection.findFirst({ where: { id: collectionId, userId }, select: { id: true } });
  if (!collection) throw new AppError(404, "COLLECTION_NOT_FOUND", "collection not found");
  const result = await prisma.collectionBookmark.deleteMany({ where: { collectionId, bookmarkId } });
  if (result.count === 0) throw new AppError(404, "COLLECTION_BOOKMARK_NOT_FOUND", "bookmark is not in this collection");
}
