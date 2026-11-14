import Fastify from "fastify";
import { APPLICANTS } from "./data.js";

/**
 * Mock of the existing PMB information system. haloK@MPUS only talks to it through
 * PmbAdapter; this server exists because the real system is out of scope (AS-01).
 */
export function buildMockPmb() {
  const app = Fastify({ logger: false });
  app.get("/health", async () => ({ ok: true, dummy: true }));
  app.get<{ Params: { regNo: string } }>("/applicants/:regNo", async (req, reply) => {
    const a = APPLICANTS.find((x) => x.regNo.toUpperCase() === req.params.regNo.toUpperCase());
    if (!a) return reply.code(404).send({ error: "not_found" });
    return a;
  });
  // DUMMY reschedule policy: only applicants in the "tes" stage, at most once.
  const rescheduled = new Map<string, string>();
  const SLOTS = [
    { id: "S1", label: "[DUMMY] Sesi 1 — 15 Feb 2027 08.00 WIB", at: "2027-02-15T01:00:00Z" },
    { id: "S2", label: "[DUMMY] Sesi 2 — 15 Feb 2027 13.00 WIB", at: "2027-02-15T06:00:00Z" },
    { id: "S3", label: "[DUMMY] Sesi 3 — 16 Feb 2027 08.00 WIB", at: "2027-02-16T01:00:00Z" },
  ];
  app.get<{ Params: { regNo: string } }>("/applicants/:regNo/test-slots", async (req, reply) => {
    const a = APPLICANTS.find((x) => x.regNo.toUpperCase() === req.params.regNo.toUpperCase());
    if (!a) return reply.code(404).send({ error: "not_found" });
    if (a.stage !== "tes") return { allowed: false, reason: "Penjadwalan ulang hanya untuk pendaftar pada tahap tes seleksi.", slots: [] };
    if (rescheduled.has(a.regNo)) return { allowed: false, reason: "Jadwal tes sudah pernah diubah satu kali.", slots: [] };
    return { allowed: true, current: SLOTS[0], slots: SLOTS.slice(1) };
  });
  app.post<{ Params: { regNo: string }; Body: { slotId?: string } }>("/applicants/:regNo/reschedule", async (req, reply) => {
    const a = APPLICANTS.find((x) => x.regNo.toUpperCase() === req.params.regNo.toUpperCase());
    const slot = SLOTS.slice(1).find((s) => s.id === req.body?.slotId);
    if (!a || !slot) return reply.code(404).send({ error: "not_found" });
    if (a.stage !== "tes" || rescheduled.has(a.regNo)) return reply.code(409).send({ error: "not_allowed" });
    rescheduled.set(a.regNo, slot.id);
    return { ok: true, slot };
  });
  // Lists applicants with an open deadline and missing documents (used by proactive reminders).
  app.get("/applicants", async () => APPLICANTS.map(({ regNo, stage, documents, deadlines }) => ({ regNo, stage, documents, deadlines })));
  return app;
}
