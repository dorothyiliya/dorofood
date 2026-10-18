import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));
const serverOnlyStub = fileURLToPath(new URL("./test/support/server-only-stub.ts", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": src, "server-only": serverOnlyStub } },
  test: {
    environment: "node",
    projects: [
      { extends: true, test: { name: "unit", include: ["test/unit/**/*.test.ts"], setupFiles: ["test/support/hermetic-env.ts"] } },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          globalSetup: ["test/support/global-setup.ts"],
          setupFiles: ["test/support/integration-env.ts"],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
