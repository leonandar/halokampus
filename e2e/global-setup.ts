import { execSync } from "node:child_process";
import { PrismaClient } from "@hk/db";
import { E2E_DB } from "../playwright.config";

/** Prepares the dedicated E2E database: migrate, clear, seed DUMMY data, 24/7 service-hours fixture. */
export default async function globalSetup() {
  execSync(`docker exec halokampus-postgres-1 psql -U halokampus -d halokampus -tc "SELECT 1 FROM pg_database WHERE datname='halokampus_e2e'" | grep -q 1 || docker exec halokampus-postgres-1 psql -U halokampus -d halokampus -c "CREATE DATABASE halokampus_e2e"`, { stdio: "ignore", shell: "/bin/bash" });
  execSync("npx prisma migrate deploy", { cwd: "packages/db", env: { ...process.env, DATABASE_URL: E2E_DB }, stdio: "ignore" });
  const db = new PrismaClient({ datasources: { db: { url: E2E_DB } } });
  const tables = await db.$queryRawUnsafe<Array<{ tablename: string }>>(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('roles','channels','sla_policies','_prisma_migrations')`);
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await db.channel.updateMany({ data: { aiPaused: false, aiPausedReason: null, aiPausedBy: null, aiPausedAt: null } });
  execSync("npx tsx --env-file=../../.env src/scripts/seed.ts", { cwd: "apps/api", env: { ...process.env, DATABASE_URL: E2E_DB, CONFIG_DIR: "../../config" }, stdio: "ignore" });
  // E2E-only DUMMY fixture: service hours every day so runs are deterministic at any time.
  const allDay = { timezone: "Asia/Jakarta", holidays: [], days: Object.fromEntries(["1", "2", "3", "4", "5", "6", "7"].map((d) => [d, [["00:00", "23:59"]]])) };
  await db.policyParameter.updateMany({ where: { code: "PRM-07", status: "active" }, data: { value: allDay, source: "DUMMY-E2E" } });
  await db.$disconnect();
}
