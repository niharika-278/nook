-- NOOK PostgreSQL baseline generated from prisma/schema.prisma.
CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."Bookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "faviconUrl" TEXT,
    "previewImageUrl" TEXT,
    "sourceDomain" TEXT,
    "contentType" TEXT,
    "extractedText" TEXT,
    "contentHash" TEXT,
    "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "processingError" TEXT,
    "processedAt" TIMESTAMP(3),
    "duplicateType" TEXT NOT NULL DEFAULT 'NONE',
    "duplicateOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."Category" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."Tag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."BookmarkTag" (
    "bookmarkId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookmarkTag_pkey" PRIMARY KEY ("bookmarkId","tagId")
);

CREATE TABLE "public"."Collection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."CollectionBookmark" (
    "collectionId" TEXT NOT NULL,
    "bookmarkId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionBookmark_pkey" PRIMARY KEY ("collectionId","bookmarkId")
);

CREATE TABLE "public"."UserCorrection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookmarkId" TEXT,
    "domain" TEXT,
    "contentType" TEXT,
    "originalCategory" TEXT,
    "correctedCategory" TEXT,
    "originalTags" TEXT,
    "correctedTags" TEXT,
    "keywords" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserCorrection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."AIClassification" (
    "id" TEXT NOT NULL,
    "bookmarkId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "categoryName" TEXT,
    "tags" TEXT NOT NULL,
    "summary" TEXT,
    "confidence" DOUBLE PRECISION,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AIClassification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."CollectionSuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    CONSTRAINT "CollectionSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."CollectionSuggestionBookmark" (
    "suggestionId" TEXT NOT NULL,
    "bookmarkId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionSuggestionBookmark_pkey" PRIMARY KEY ("suggestionId","bookmarkId")
);

CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");
CREATE INDEX "Bookmark_userId_createdAt_idx" ON "public"."Bookmark"("userId", "createdAt");
CREATE INDEX "Bookmark_userId_categoryId_idx" ON "public"."Bookmark"("userId", "categoryId");
CREATE INDEX "Bookmark_userId_processingStatus_idx" ON "public"."Bookmark"("userId", "processingStatus");
CREATE UNIQUE INDEX "Bookmark_userId_canonicalUrl_key" ON "public"."Bookmark"("userId", "canonicalUrl");
CREATE INDEX "Category_userId_createdAt_idx" ON "public"."Category"("userId", "createdAt");
CREATE UNIQUE INDEX "Category_userId_name_key" ON "public"."Category"("userId", "name");
CREATE INDEX "Tag_userId_createdAt_idx" ON "public"."Tag"("userId", "createdAt");
CREATE UNIQUE INDEX "Tag_userId_normalizedName_key" ON "public"."Tag"("userId", "normalizedName");
CREATE INDEX "BookmarkTag_tagId_idx" ON "public"."BookmarkTag"("tagId");
CREATE INDEX "Collection_userId_createdAt_idx" ON "public"."Collection"("userId", "createdAt");
CREATE UNIQUE INDEX "Collection_userId_name_key" ON "public"."Collection"("userId", "name");
CREATE INDEX "CollectionBookmark_bookmarkId_idx" ON "public"."CollectionBookmark"("bookmarkId");
CREATE INDEX "UserCorrection_userId_domain_idx" ON "public"."UserCorrection"("userId", "domain");
CREATE INDEX "UserCorrection_userId_contentType_idx" ON "public"."UserCorrection"("userId", "contentType");
CREATE UNIQUE INDEX "AIClassification_bookmarkId_key" ON "public"."AIClassification"("bookmarkId");
CREATE INDEX "CollectionSuggestion_userId_status_createdAt_idx" ON "public"."CollectionSuggestion"("userId", "status", "createdAt");
CREATE INDEX "CollectionSuggestionBookmark_bookmarkId_idx" ON "public"."CollectionSuggestionBookmark"("bookmarkId");

ALTER TABLE "public"."Bookmark" ADD CONSTRAINT "Bookmark_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Bookmark" ADD CONSTRAINT "Bookmark_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."Category" ADD CONSTRAINT "Category_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Tag" ADD CONSTRAINT "Tag_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."BookmarkTag" ADD CONSTRAINT "BookmarkTag_bookmarkId_fkey"
  FOREIGN KEY ("bookmarkId") REFERENCES "public"."Bookmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."BookmarkTag" ADD CONSTRAINT "BookmarkTag_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "public"."Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Collection" ADD CONSTRAINT "Collection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Collection" ADD CONSTRAINT "Collection_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."CollectionBookmark" ADD CONSTRAINT "CollectionBookmark_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "public"."Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."CollectionBookmark" ADD CONSTRAINT "CollectionBookmark_bookmarkId_fkey"
  FOREIGN KEY ("bookmarkId") REFERENCES "public"."Bookmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."UserCorrection" ADD CONSTRAINT "UserCorrection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."UserCorrection" ADD CONSTRAINT "UserCorrection_bookmarkId_fkey"
  FOREIGN KEY ("bookmarkId") REFERENCES "public"."Bookmark"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."AIClassification" ADD CONSTRAINT "AIClassification_bookmarkId_fkey"
  FOREIGN KEY ("bookmarkId") REFERENCES "public"."Bookmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."CollectionSuggestion" ADD CONSTRAINT "CollectionSuggestion_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."CollectionSuggestionBookmark" ADD CONSTRAINT "CollectionSuggestionBookmark_suggestionId_fkey"
  FOREIGN KEY ("suggestionId") REFERENCES "public"."CollectionSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."CollectionSuggestionBookmark" ADD CONSTRAINT "CollectionSuggestionBookmark_bookmarkId_fkey"
  FOREIGN KEY ("bookmarkId") REFERENCES "public"."Bookmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;
