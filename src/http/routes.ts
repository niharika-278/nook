import type { Express, Request } from "express";
import type { AppEnv } from "../config/env.js";
import { authenticate, requireUser } from "../middleware/auth.js";
import { loginSchema, registerSchema } from "../schemas/auth.js";
import {
  bookmarkCreateSchema,
  bookmarkListSchema,
  bookmarkUpdateSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  tagListSchema,
} from "../schemas/bookmark.js";
import { loginUser, registerUser } from "../services/auth-service.js";
import {
  createBookmark,
  createCategory,
  deleteBookmark,
  deleteCategory,
  getBookmark,
  listBookmarks,
  listCategories,
  listTags,
  updateBookmark,
  updateCategory,
  removeTagFromBookmark,
} from "../services/bookmark-service.js";
import type { PrismaClient } from "@prisma/client";
import { AppError } from "../domain/errors.js";
import type { AIProvider } from "../ai/types.js";
import { correctionSchema } from "../schemas/correction.js";
import { correctionListSchema } from "../schemas/correction-list.js";
import { createCorrection, listCorrections, processBookmark } from "../services/processing-service.js";
import {
  addBookmarkToCollection,
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
  removeBookmarkFromCollection,
  updateCollection,
} from "../services/collection-service.js";
import {
  collectionBookmarkSchema,
  collectionCreateSchema,
  collectionListSchema,
  collectionUpdateSchema,
} from "../schemas/collection.js";
import { collectionSuggestionIdSchema, collectionSuggestionListSchema } from "../schemas/collection-suggestion.js";
import {
  acceptCollectionSuggestion,
  generateCollectionSuggestions,
  listCollectionSuggestions,
  rejectCollectionSuggestion,
} from "../services/collection-suggestion-service.js";

function userId(req: Request): string {
  return requireUser(req);
}

export function registerRoutes(app: Express, prisma: PrismaClient, env: AppEnv, provider?: AIProvider): void {
  app.post("/api/auth/register", async (req, res) => {
    const result = await registerUser(prisma, env, registerSchema.parse(req.body));
    res.status(201).json({ data: result });
  });

  app.post("/api/auth/login", async (req, res) => {
    const result = await loginUser(prisma, env, loginSchema.parse(req.body));
    res.json({ data: result });
  });

  app.get("/api/auth/me", authenticate(env), async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: userId(req) },
      select: { id: true, email: true, displayName: true, createdAt: true },
    });
    if (!user) throw new AppError(401, "INVALID_TOKEN", "authentication is required");
    res.json({ data: { user } });
  });

  app.get("/api/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ data: { status: "ok", database: "ok" } });
  });

  app.use("/api", authenticate(env));

  app.get("/api/bookmarks", async (req, res) => {
    const options = bookmarkListSchema.parse(req.query);
    const result = await listBookmarks(prisma, userId(req), options);
    res.json({ data: result });
  });

  app.post("/api/bookmarks", async (req, res) => {
    const bookmark = await createBookmark(prisma, userId(req), bookmarkCreateSchema.parse(req.body));
    res.status(201).json({ data: bookmark });
    if (provider) {
      void processBookmark(prisma, userId(req), bookmark.id, provider).catch((error: unknown) => {
        req.log.warn({ err: error, bookmarkId: bookmark.id }, "automatic bookmark processing failed");
      });
    }
  });

  app.get("/api/bookmarks/:id", async (req, res) => {
    const bookmark = await getBookmark(prisma, userId(req), req.params.id);
    res.json({ data: bookmark });
  });

  app.patch("/api/bookmarks/:id", async (req, res) => {
    const bookmark = await updateBookmark(prisma, userId(req), req.params.id, bookmarkUpdateSchema.parse(req.body));
    res.json({ data: bookmark });
  });

  app.delete("/api/bookmarks/:id", async (req, res) => {
    await deleteBookmark(prisma, userId(req), req.params.id);
    res.status(204).send();
  });

  app.delete("/api/bookmarks/:id/tags/:tagId", async (req, res) => {
    await removeTagFromBookmark(prisma, userId(req), req.params.id, req.params.tagId);
    res.status(204).send();
  });

  app.post("/api/bookmarks/:id/process", async (req, res) => {
    const bookmark = await processBookmark(prisma, userId(req), req.params.id, provider);
    res.json({ data: bookmark });
  });

  app.post("/api/bookmarks/:id/correction", async (req, res) => {
    const correction = await createCorrection(prisma, userId(req), req.params.id, correctionSchema.parse(req.body));
    res.status(201).json({ data: correction });
  });

  app.get("/api/corrections", async (req, res) => {
    const options = correctionListSchema.parse(req.query);
    res.json({ data: await listCorrections(prisma, userId(req), options) });
  });

  app.get("/api/categories", async (req, res) => {
    res.json({ data: await listCategories(prisma, userId(req)) });
  });

  app.post("/api/categories", async (req, res) => {
    const input = categoryCreateSchema.parse(req.body);
    res.status(201).json({ data: await createCategory(prisma, userId(req), input.name) });
  });

  app.patch("/api/categories/:id", async (req, res) => {
    const input = categoryUpdateSchema.parse(req.body);
    res.json({ data: await updateCategory(prisma, userId(req), req.params.id, input.name) });
  });

  app.delete("/api/categories/:id", async (req, res) => {
    await deleteCategory(prisma, userId(req), req.params.id);
    res.status(204).send();
  });

  app.get("/api/tags", async (req, res) => {
    const { limit } = tagListSchema.parse(req.query);
    res.json({ data: await listTags(prisma, userId(req), limit) });
  });

  app.get("/api/collections", async (req, res) => {
    const options = collectionListSchema.parse(req.query);
    res.json({ data: await listCollections(prisma, userId(req), options) });
  });

  app.post("/api/collections", async (req, res) => {
    const collection = await createCollection(prisma, userId(req), collectionCreateSchema.parse(req.body));
    res.status(201).json({ data: collection });
  });

  app.get("/api/collections/:id", async (req, res) => {
    res.json({ data: await getCollection(prisma, userId(req), req.params.id) });
  });

  app.patch("/api/collections/:id", async (req, res) => {
    const collection = await updateCollection(prisma, userId(req), req.params.id, collectionUpdateSchema.parse(req.body));
    res.json({ data: collection });
  });

  app.delete("/api/collections/:id", async (req, res) => {
    await deleteCollection(prisma, userId(req), req.params.id);
    res.status(204).send();
  });

  app.post("/api/collections/:id/bookmarks", async (req, res) => {
    const { bookmarkId } = collectionBookmarkSchema.parse(req.body);
    res.status(201).json({ data: await addBookmarkToCollection(prisma, userId(req), req.params.id, bookmarkId) });
  });

  app.delete("/api/collections/:id/bookmarks/:bookmarkId", async (req, res) => {
    await removeBookmarkFromCollection(prisma, userId(req), req.params.id, req.params.bookmarkId);
    res.status(204).send();
  });

  app.get("/api/collection-suggestions", async (req, res) => {
    const options = collectionSuggestionListSchema.parse(req.query);
    res.json({ data: await listCollectionSuggestions(prisma, userId(req), options) });
  });

  app.post("/api/collection-suggestions/generate", async (req, res) => {
    res.status(201).json({ data: await generateCollectionSuggestions(prisma, userId(req), provider) });
  });

  app.post("/api/collection-suggestions/:id/accept", async (req, res) => {
    const { id } = collectionSuggestionIdSchema.parse(req.params);
    res.status(201).json({ data: await acceptCollectionSuggestion(prisma, userId(req), id) });
  });

  app.post("/api/collection-suggestions/:id/reject", async (req, res) => {
    const { id } = collectionSuggestionIdSchema.parse(req.params);
    await rejectCollectionSuggestion(prisma, userId(req), id);
    res.status(204).send();
  });
}
