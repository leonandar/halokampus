import { PrismaClient } from "@hk/db";
import { verifyChains } from "../services/ledger.js";

/** `pnpm audit:verify` — recomputes the audit and event hash chains (NFR-08). */
const db = new PrismaClient();
const r = await verifyChains(db);
console.log(`audit_logs: ${r.audit.rows} baris, ${r.audit.brokenAt === null ? "rantai utuh" : `RUSAK di seq ${r.audit.brokenAt}`}`);
console.log(`events:     ${r.events.rows} baris, ${r.events.brokenAt === null ? "rantai utuh" : `RUSAK di seq ${r.events.brokenAt}`}`);
await db.$disconnect();
process.exit(r.audit.brokenAt === null && r.events.brokenAt === null ? 0 : 1);
