import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { PrismaClient } from "@hk/db";
import { E2E_DB } from "../playwright.config";

export const PASSWORD = "Dummy-2026!"; // SEED_DEFAULT_PASSWORD in .env (DUMMY)
export const db = new PrismaClient({ datasources: { db: { url: E2E_DB } } });
mkdirSync("docs/screenshots", { recursive: true });

export async function login(page: Page, email: string) {
  await page.goto("/masuk");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/masuk"));
}

/** Screenshot for the dissertation appendix, taken at 2x for print quality. */
export async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: true });
}

export function widget(page: Page) {
  return page.locator("#halokampus-widget");
}
