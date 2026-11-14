import { hash } from "@node-rs/argon2";
import { loadEnv } from "../env.js";
import { createContext } from "../bootstrap.js";
import { createKbDocument, publishKbDocument, testKbDocument } from "../services/kb.js";
import type { Ctx } from "../context.js";

/** DUMMY development data: staff accounts, parameters v1, AI authority rules, sample KB. */
/** Production bootstrap: parameters v1 and AI authority rules only — no DUMMY users or documents. */
export async function seedBase(ctx: Ctx) {
  const n = await ctx.params.seedDefaults(ctx.config.parameterDefaults);
  for (const r of ctx.config.authorityRules) {
    await ctx.db.aiAuthorityRule.upsert({
      where: { actionKey_version: { actionKey: r.action, version: 1 } },
      update: { authorityClass: r.class, description: r.description ?? null },
      create: { actionKey: r.action, authorityClass: r.class, description: r.description ?? null },
    });
  }
  return n;
}

export async function seed(ctx: Ctx, password: string) {
  const n = await seedBase(ctx);
  const users = [
    { email: "cp1@dummy.halokampus.local", name: "Rina (CP DUMMY)", role: "cp" },
    { email: "cp2@dummy.halokampus.local", name: "Bagus (CP DUMMY)", role: "cp" },
    { email: "staf1@dummy.halokampus.local", name: "Sari (Staf DUMMY)", role: "staff" },
    { email: "staf2@dummy.halokampus.local", name: "Dimas (Staf DUMMY)", role: "staff" },
    { email: "pimpinan@dummy.halokampus.local", name: "Dr. Wulan (Pimpinan DUMMY)", role: "leader" },
    { email: "keuangan@dummy.halokampus.local", name: "Tono (Keuangan DUMMY)", role: "finance" },
    { email: "admin@dummy.halokampus.local", name: "Admin TI (DUMMY)", role: "admin" },
  ];
  const passwordHash = await hash(password);
  for (const u of users) {
    // DUMMY accounts always get the current SEED_DEFAULT_PASSWORD; real accounts are never touched.
    await ctx.db.user.upsert({ where: { email: u.email }, update: { passwordHash, isDummy: true }, create: { email: u.email, name: u.name, roleCode: u.role, passwordHash, isDummy: true } });
  }
  // DUMMY development: every channel enabled (simulators). Production enables channels in the Admin page.
  await ctx.db.channel.updateMany({ data: { enabled: true } });
  const staff = await ctx.db.user.findUniqueOrThrow({ where: { email: "staf1@dummy.halokampus.local" } });
  let docs = 0;
  for (const f of ctx.config.kbDummyFiles) {
    const slug = f.name.replace(/\.md$/, "");
    if (await ctx.db.kbDocument.findFirst({ where: { slug } })) continue;
    const doc = await createKbDocument(ctx, { slug, markdown: f.content, userId: staff.id, isDummy: true });
    await testKbDocument(ctx, { documentId: doc.id, questions: ["[DUMMY] uji otomatis seed"], userId: staff.id });
    await publishKbDocument(ctx, { documentId: doc.id, userId: staff.id });
    docs++;
  }
  return { parameters: n, users: users.length, kbDocuments: docs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  const ctx = await createContext(env);
  if (process.argv.includes("--production")) {
    console.log("[seed] production base (no DUMMY data):", { parameters: await seedBase(ctx) });
    await ctx.db.$disconnect();
    process.exit(0);
  }
  const pw = process.env.SEED_DEFAULT_PASSWORD;
  if (!pw || pw.startsWith("GANTI")) throw new Error("Set SEED_DEFAULT_PASSWORD in .env");
  console.log("[seed] DUMMY data:", await seed(ctx, pw));
  await ctx.db.$disconnect();
}
