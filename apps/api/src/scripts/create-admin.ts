import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@hk/db";

/**
 * Creates the first Admin TI account on a fresh production server:
 *   pnpm --filter @hk/api create-admin -- admin@kampus.ac.id "Nama Admin" 'KataSandiKuat!'
 * Further users are created from the Admin page.
 */
const [email, name, password] = process.argv.slice(2).filter((a) => a !== "--");
if (!email || !name || !password || password.length < 12) {
  console.error("Pemakaian: create-admin <email> <nama> <kata-sandi minimal 12 karakter>");
  process.exit(1);
}
const db = new PrismaClient();
await db.user.upsert({ where: { email: email.toLowerCase() }, update: { roleCode: "admin", active: true, passwordHash: await hash(password) }, create: { email: email.toLowerCase(), name, roleCode: "admin", passwordHash: await hash(password) } });
console.log(`Admin ${email} siap. Masuk di /masuk lalu buat akun Staf PMB, Pimpinan, Mahasiswa CP, dan Keuangan.`);
await db.$disconnect();
