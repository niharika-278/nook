import pino from "pino";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import type { AppEnv } from "../src/config/env.js";

const env: AppEnv = {
  DATABASE_URL: "postgresql://nook:nook_dev_password@localhost:5433/nook_test?schema=public",
  JWT_SECRET: "test-secret-that-is-longer-than-thirty-two-characters",
  PORT: 3000,
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  CORS_ORIGIN: "http://localhost:3000",
  AI_BASE_URL: "",
  AI_API_KEY: "",
  AI_MODEL: "",
};

const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const app = createApp({ env, prisma, logger: pino({ level: "silent" }) });

async function register(email: string) {
  const response = await request(app).post("/api/auth/register").send({
    email,
    password: "correct-horse-battery",
    displayName: "Test User",
  });
  expect(response.status).toBe(201);
  return response.body.data.token as string;
}

describe("NOOK authentication and owned bookmarks", () => {
  beforeAll(async () => {
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it("reports database health and rejects unauthenticated access", async () => {
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.body.data).toEqual({ status: "ok", database: "ok" });

    const extensionPreflight = await request(app)
      .options("/api/auth/login")
      .set("Origin", "chrome-extension://abcdefghijklmnopabcdefghijklmnop")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");
    expect(extensionPreflight.status).toBe(204);
    expect(extensionPreflight.headers["access-control-allow-origin"]).toBe("chrome-extension://abcdefghijklmnopabcdefghijklmnop");

    const response = await request(app).get("/api/bookmarks");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");

    const invalidLogin = await request(app).post("/api/auth/login").send({ email: "missing@example.com", password: "wrong-password" });
    expect(invalidLogin.status).toBe(401);
    expect(invalidLogin.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("registers users, prevents duplicate email, and isolates bookmarks", async () => {
    const firstToken = await register("first@example.com");
    const duplicateEmail = await request(app).post("/api/auth/register").send({
      email: "first@example.com",
      password: "correct-horse-battery",
    });
    expect(duplicateEmail.status).toBe(409);
    expect(duplicateEmail.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");

    const category = await request(app)
      .post("/api/categories")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ name: "Reading" });
    expect(category.status).toBe(201);
    const duplicateCategory = await request(app)
      .post("/api/categories")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ name: "Reading" });
    expect(duplicateCategory.status).toBe(409);

    const bookmark = await request(app)
      .post("/api/bookmarks")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({
        url: "HTTPS://Example.com/read?utm_source=news&b=2&a=1#fragment",
        title: "A useful article",
        categoryId: category.body.data.id,
        tags: ["Reference", "reference", "Research"],
      });
    expect(bookmark.status).toBe(201);
    expect(bookmark.body.data.canonicalUrl).toBe("https://example.com/read?a=1&b=2");
    expect(bookmark.body.data.tags.map((entry: { tag: { normalizedName: string } }) => entry.tag.normalizedName))
      .toEqual(["reference", "research"]);

    const duplicate = await request(app)
      .post("/api/bookmarks")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ url: "https://example.com/read?a=1&b=2" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("EXACT_DUPLICATE");

    const secondToken = await register("second@example.com");
    const hidden = await request(app)
      .get(`/api/bookmarks/${bookmark.body.data.id}`)
      .set("Authorization", `Bearer ${secondToken}`);
    expect(hidden.status).toBe(404);
    const list = await request(app)
      .get("/api/bookmarks?tag=research&limit=10")
      .set("Authorization", `Bearer ${firstToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBe(1);

    const collection = await request(app)
      .post("/api/collections")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ name: "Reading queue", categoryId: category.body.data.id });
    expect(collection.status).toBe(201);
    const hiddenCollection = await request(app)
      .get(`/api/collections/${collection.body.data.id}`)
      .set("Authorization", `Bearer ${secondToken}`);
    expect(hiddenCollection.status).toBe(404);
    const membership = await request(app)
      .post(`/api/collections/${collection.body.data.id}/bookmarks`)
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ bookmarkId: bookmark.body.data.id });
    expect(membership.status).toBe(201);
    const collectionView = await request(app)
      .get(`/api/collections/${collection.body.data.id}`)
      .set("Authorization", `Bearer ${firstToken}`);
    expect(collectionView.status).toBe(200);
    expect(collectionView.body.data._count.bookmarks).toBe(1);

    const update = await request(app)
      .patch(`/api/bookmarks/${bookmark.body.data.id}`)
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ title: "Updated article", tags: ["updated"] });
    expect(update.status).toBe(200);
    expect(update.body.data.title).toBe("Updated article");
    expect(update.body.data.tags).toHaveLength(1);

    const updatedTagId = update.body.data.tags[0].tag.id as string;
    const removedTag = await request(app)
      .delete(`/api/bookmarks/${bookmark.body.data.id}/tags/${updatedTagId}`)
      .set("Authorization", `Bearer ${firstToken}`);
    expect(removedTag.status).toBe(204);

    const archive = await request(app)
      .post("/api/categories")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ name: "Archive" });
    expect(archive.status).toBe(201);
    const moved = await request(app)
      .patch(`/api/bookmarks/${bookmark.body.data.id}`)
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ categoryId: archive.body.data.id });
    expect(moved.status).toBe(200);
    expect(moved.body.data.categoryId).toBe(archive.body.data.id);
    const renamed = await request(app)
      .patch(`/api/categories/${archive.body.data.id}`)
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ name: "Archive queue" });
    expect(renamed.status).toBe(200);
    const removedCategory = await request(app)
      .delete(`/api/categories/${archive.body.data.id}`)
      .set("Authorization", `Bearer ${firstToken}`);
    expect(removedCategory.status).toBe(204);

    const corrections = await request(app)
      .get("/api/corrections?limit=10")
      .set("Authorization", `Bearer ${firstToken}`);
    expect(corrections.status).toBe(200);
    expect(corrections.body.data.total).toBe(0);

    const removed = await request(app)
      .delete(`/api/collections/${collection.body.data.id}/bookmarks/${bookmark.body.data.id}`)
      .set("Authorization", `Bearer ${firstToken}`);
    expect(removed.status).toBe(204);

    const deleted = await request(app)
      .delete(`/api/bookmarks/${bookmark.body.data.id}`)
      .set("Authorization", `Bearer ${firstToken}`);
    expect(deleted.status).toBe(204);
  });

  it("returns structured validation errors", async () => {
    const token = await register("validation@example.com");
    const response = await request(app)
      .post("/api/bookmarks")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: "javascript:alert(1)" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("UNSUPPORTED_URL_SCHEME");

    const malformedJson = await request(app)
      .post("/api/bookmarks")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send('{"url":');
    expect(malformedJson.status).toBe(400);
    expect(malformedJson.body.error.code).toBe("INVALID_JSON");
  });
});
