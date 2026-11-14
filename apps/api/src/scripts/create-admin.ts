import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@hk/db";

/**
 * Creates the first Admin TI account on a fresh production server:
 *   pnpm --filter @hk/api create-admin -- admin@kampus.ac.id "Nama Admin" 'KataSandiKuat!'
 * Further users are created from the Admin page.
 */
// Tolerate "--email" (a missing space after pnpm's "--" separator).
const [rawEmail, name, password] = process.argv.slice(2).filter((a) => a !== "--");
const email = rawEmail?.replace(/^-+/, "");
const usage = "Pemakaian: create-admin -- <email> \"<nama>\" '<kata sandi minimal 12 karakter>'";
const problems: string[] = [];
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`Email tidak valid: ${rawEmail ?? "(kosong)"}`);
if (!name) problems.push("Nama belum diisi");
if (!password) problems.push("Kata sandi belum diisi");
else if (password.length < 12) problems.push(`Kata sandi terlalu pendek: ${password.length} karakter, minimal 12`);
if (problems.length > 0 || !email || !name || !password) {
  for (const p of problems) console.error(`✗ ${p}`);
  console.error(usage);
  process.exit(1);
}
const db = new PrismaClient();
await db.user.upsert({ where: { email: email.toLowerCase() }, update: { roleCode: "admin", active: true, passwordHash: await hash(password) }, create: { email: email.toLowerCase(), name, roleCode: "admin", passwordHash: await hash(password) } });
console.log(`Admin ${email} siap. Masuk di /masuk lalu buat akun Staf PMB, Pimpinan, Mahasiswa CP, dan Keuangan.`);
await db.$disconnect();
