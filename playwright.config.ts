import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// E2E runs the real stack (mock PMB, API, built web app) against a dedicated database.
function dotenv(path: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => /^[A-Z0-9_]+=/.test(l))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
        }),
    );
  } catch {
    return {};
  }
}
const base = dotenv(".env");
export const E2E_DB = (base.DATABASE_URL ?? "postgresql://halokampus:halokampus_dev@localhost:5432/halokampus").replace(/\/[^/?]+(\?|$)/, "/halokampus_e2e$1");
const env = { ...base, DATABASE_URL: E2E_DB, DISABLE_RATE_LIMIT: "true", ENABLE_SIMULATORS: "true", AI_INLINE: "true", CONFIG_DIR: "../../config" };

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://localhost:3000", locale: "id-ID", timezoneId: "Asia/Jakarta", trace: "off" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 } }],
  webServer: [
    { command: "pnpm --filter @hk/mock-pmb start", url: "http://localhost:4100/health", reuseExistingServer: false, env },
    { command: "npx tsx src/server.ts", cwd: "apps/api", url: "http://localhost:4000/health", reuseExistingServer: false, env, timeout: 60_000 },
    { command: "pnpm --filter @hk/web start", url: "http://localhost:3000", reuseExistingServer: false, env },
  ],
});
