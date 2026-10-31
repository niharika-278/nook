import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const prismaCli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
const testDatabaseUrl = process.env.POSTGRES_TEST_DATABASE_URL ?? "postgresql://nook:nook_dev_password@localhost:5433/nook_test?schema=public";

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

run(process.platform === "win32" ? "docker.exe" : "docker", ["compose", "up", "-d", "postgres"]);
try {
  run(process.platform === "win32" ? "docker.exe" : "docker", ["exec", "nook-postgres", "createdb", "-U", "nook", "nook_test"]);
} catch (error) {
  // createdb exits non-zero when the test database already exists.
  if (!(error && typeof error === "object" && "status" in error && error.status === 1)) throw error;
}

const environment = { ...process.env, DATABASE_URL: testDatabaseUrl };

execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
  env: environment,
  stdio: "inherit",
});
