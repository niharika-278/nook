import { loadEnv } from "./config/env.js";
import { createPrismaClient } from "./db.js";
import { createApp } from "./app.js";

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const app = createApp({ env, prisma });

const server = app.listen(env.PORT, () => {
  console.log(`NOOK listening on http://localhost:${env.PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}; shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
