import type { Prisma, PrismaClient } from "@prisma/client";
import { categoryAliasKey, canonicalCategoryName, categoryKey, labelKey, normalizeLabel, tagKey } from "../domain/taxonomy.js";

export interface CategoryCleanupOptions {
  userId?: string;
  apply?: boolean;
}

export interface CategoryCleanupGroupReport {
  userId: string;
  categoryKey: string;
  categoryNames: string[];
  canonicalName: string;
  createdCanonical: boolean;
  wouldCreateCanonical: boolean;
  movedBookmarks: number;
  movedCollections: number;
  protectedBookmarks: number;
  protectedCollections: number;
  deletedCategories: string[];
}

export interface CategoryCleanupReport {
  dryRun: boolean;
  groups: CategoryCleanupGroupReport[];
}

export async function normalizeCategoryAliases(
  prisma: PrismaClient,
  options: CategoryCleanupOptions = {},
): Promise<CategoryCleanupReport> {
  const users = options.userId
    ? [{ id: options.userId }]
    : await prisma.user.findMany({ select: { id: true } });
  const report: CategoryCleanupReport = { dryRun: options.apply !== true, groups: [] };

  for (const user of users) {
    const run = async (tx: PrismaClient | Prisma.TransactionClient): Promise<void> => {
      const categories = await tx.category.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true } });
      const groups = new Map<string, typeof categories>();
      for (const category of categories) {
        const key = categoryAliasKey(category.name);
        if (!key) continue;
        const group = groups.get(key) ?? [];
        group.push(category);
        groups.set(key, group);
      }

      for (const [key, group] of groups) {
        if (group.length < 2) continue;
        const canonicalName = canonicalCategoryName(group[0]?.name ?? key);
        const target = group.find(({ name }) => labelKey(name) === labelKey(canonicalName));
        const aliasIds = group.map(({ id }) => id);
        const bookmarks = await tx.bookmark.findMany({
          where: { userId: user.id, categoryId: { in: aliasIds } },
          select: { id: true, categoryId: true, categorySource: true, corrections: { select: { correctedCategory: true } } },
        });
        const collections = await tx.collection.findMany({
          where: { userId: user.id, categoryId: { in: aliasIds } },
          select: { id: true, categoryId: true, source: true },
        });
        const eligibleBookmarks = bookmarks.filter(({ categorySource, corrections }) =>
          categorySource === "AI" && corrections.every(({ correctedCategory }) => correctedCategory === null),
        );
        const protectedBookmarks = bookmarks.length - eligibleBookmarks.length;
        const eligibleCollections = collections.filter(({ source }) => source === "AI");
        const protectedCollections = collections.length - eligibleCollections.length;
        const wouldCreateCanonical = !target;
        const createdCanonical = wouldCreateCanonical && options.apply === true;
        let targetId = target?.id;
        if (!targetId && options.apply === true) {
          const created = await tx.category.create({ data: { userId: user.id, name: canonicalName }, select: { id: true } });
          targetId = created.id;
        }

        const groupReport: CategoryCleanupGroupReport = {
          userId: user.id,
          categoryKey: categoryKey(canonicalName),
          categoryNames: group.map(({ name }) => name),
          canonicalName,
          createdCanonical,
          wouldCreateCanonical,
          movedBookmarks: targetId ? eligibleBookmarks.filter(({ categoryId }) => categoryId !== targetId).length : eligibleBookmarks.length,
          movedCollections: targetId ? eligibleCollections.filter(({ categoryId }) => categoryId !== targetId).length : eligibleCollections.length,
          protectedBookmarks,
          protectedCollections,
          deletedCategories: [],
        };

        if (options.apply === true && targetId) {
          for (const bookmark of eligibleBookmarks) {
            if (bookmark.categoryId !== targetId) {
              const sourceCategory = group.find(({ id }) => id === bookmark.categoryId);
              if (sourceCategory && labelKey(sourceCategory.name) !== labelKey(canonicalName)) {
                const tagName = normalizeLabel(sourceCategory.name);
                const tag = await tx.tag.upsert({
                  where: { userId_normalizedName: { userId: user.id, normalizedName: tagKey(tagName) } },
                  create: { userId: user.id, name: tagName, normalizedName: tagKey(tagName) },
                  update: {},
                  select: { id: true },
                });
                await tx.bookmarkTag.upsert({
                  where: { bookmarkId_tagId: { bookmarkId: bookmark.id, tagId: tag.id } },
                  create: { bookmarkId: bookmark.id, tagId: tag.id },
                  update: {},
                });
              }
              await tx.bookmark.update({ where: { id: bookmark.id }, data: { categoryId: targetId } });
            }
          }
          for (const collection of eligibleCollections) {
            if (collection.categoryId !== targetId) {
              await tx.collection.update({ where: { id: collection.id }, data: { categoryId: targetId } });
            }
          }
          for (const category of group) {
            if (category.id === targetId) continue;
            const remainingBookmarks = await tx.bookmark.count({ where: { categoryId: category.id } });
            const remainingCollections = await tx.collection.count({ where: { categoryId: category.id } });
            if (remainingBookmarks === 0 && remainingCollections === 0) {
              await tx.category.delete({ where: { id: category.id } });
              groupReport.deletedCategories.push(category.name);
            }
          }
        }
        report.groups.push(groupReport);
      }
    };

    if (options.apply === true) {
      await prisma.$transaction(async (tx) => run(tx));
    } else {
      await run(prisma);
    }
  }
  return report;
}
