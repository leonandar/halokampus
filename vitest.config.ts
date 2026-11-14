import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 60000,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "apps/api/src/**/*.ts", "apps/mock-pmb/src/**/*.ts"],
      reporter: ["text-summary", "json-summary"],
    },
  },
});
