import { execSync } from "node:child_process";
import { testDatabaseUrl } from "./test-database";

/** Applies the real migrations (including CHECK constraints) to the test database. */
export default function setup() {
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: testDatabaseUrl() } });
}
