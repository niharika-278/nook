import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { normalizeCategoryAliases } from "../src/services/category-cleanup-service.js";

const apply = process.argv.includes("--apply");
const userIndex = process.argv.indexOf("--user");
const userId = userIndex >= 0 ? process.argv[userIndex + 1] : undefined;
const prisma = new PrismaClient();

try {
  const report = await normalizeCategoryAliases(prisma, { apply, userId });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await prisma.$disconnect();
}
