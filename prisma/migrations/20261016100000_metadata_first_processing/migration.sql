ALTER TABLE "Bookmark"
  ADD COLUMN "categorySource" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "contentStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "contentError" TEXT;

UPDATE "Bookmark"
SET "categorySource" = 'MANUAL'
WHERE "categoryId" IS NOT NULL;

UPDATE "Bookmark"
SET "contentStatus" = 'COMPLETED'
WHERE "extractedText" IS NOT NULL;

ALTER TABLE "AIClassification"
  ADD COLUMN "classificationStage" TEXT NOT NULL DEFAULT 'CONTENT';
