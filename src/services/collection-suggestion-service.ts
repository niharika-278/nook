import type { PrismaClient } from "@prisma/client";
import { AppError } from "../domain/errors.js";
import type { AIProvider } from "../ai/types.js";

export async function generateCollectionSuggestions(
  prisma: PrismaClient,
  userId: string,
  provider: AIProvider | undefined,
) {
  if (!provider?.suggestCollections) {
    throw new AppError(503, "AI_NOT_CONFIGURED", "AI collection suggestions are not configured");
  }
  const bookmarks = await prisma.bookmark.findMany({
    where: { userId, processingStatus: "COMPLETED" },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: {
      id: true,
      title: true,
      description: true,
      extractedText: true,
      category: { select: { name: true } },
      tags: { select: { tag: { select: { name: true } } } },
    },
  });
  if (bookmarks.length < 2) {
    throw new AppError(422, "INSUFFICIENT_RESOURCES", "at least two processed bookmarks are required");
  }
  const suggestions = await provider.suggestCollections({
    bookmarks: bookmarks.map((bookmark) => ({
      id: bookmark.id,
      ...(bookmark.title ? { title: bookmark.title } : {}),
      ...(bookmark.description ? { description: bookmark.description } : {}),
      ...(bookmark.category?.name ? { category: bookmark.category.name } : {}),
      tags: bookmark.tags.map(({ tag }) => tag.name),
      ...(bookmark.extractedText ? { content: bookmark.extractedText } : {}),
    })),
  });
  if (suggestions.length === 0) {
    throw new AppError(422, "NO_COLLECTION_SUGGESTIONS", "the AI provider found no useful collection suggestions");
  }
  return prisma.$transaction(async (tx) => {
    const created = [];
    for (const suggestion of suggestions) {
      created.push(await tx.collectionSuggestion.create({
        data: {
          userId,
          name: suggestion.name,
          description: suggestion.description,
          provider: provider.name,
          model: provider.model,
          bookmarks: {
            create: suggestion.bookmarkIds.map((bookmarkId) => ({ bookmarkId })),
          },
        },
        include: { bookmarks: true },
      }));
    }
    return created;
  });
}

export async function listCollectionSuggestions(
  prisma: PrismaClient,
  userId: string,
  options: { status?: string | undefined; limit: number },
) {
  return prisma.collectionSuggestion.findMany({
    where: { userId, ...(options.status ? { status: options.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: options.limit,
    include: { bookmarks: { include: { bookmark: { select: { id: true, title: true, url: true } } } } },
  });
}

export async function acceptCollectionSuggestion(prisma: PrismaClient, userId: string, suggestionId: string) {
  return prisma.$transaction(async (tx) => {
    const suggestion = await tx.collectionSuggestion.findFirst({
      where: { id: suggestionId, userId, status: "PENDING" },
      include: { bookmarks: { select: { bookmarkId: true } } },
    });
    if (!suggestion) throw new AppError(404, "COLLECTION_SUGGESTION_NOT_FOUND", "collection suggestion not found");
    const collection = await tx.collection.create({
      data: {
        userId,
        name: suggestion.name,
        description: suggestion.description,
        source: "AI",
        bookmarks: { create: suggestion.bookmarks.map(({ bookmarkId }) => ({ bookmarkId })) },
      },
      include: { bookmarks: true },
    });
    await tx.collectionSuggestion.update({ where: { id: suggestion.id }, data: { status: "ACCEPTED", reviewedAt: new Date() } });
    return collection;
  });
}

export async function rejectCollectionSuggestion(prisma: PrismaClient, userId: string, suggestionId: string) {
  const result = await prisma.collectionSuggestion.updateMany({
    where: { id: suggestionId, userId, status: "PENDING" },
    data: { status: "REJECTED", reviewedAt: new Date() },
  });
  if (result.count === 0) throw new AppError(404, "COLLECTION_SUGGESTION_NOT_FOUND", "collection suggestion not found");
}
