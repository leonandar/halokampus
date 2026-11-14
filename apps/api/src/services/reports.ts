import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { KpiValue } from "@hk/kpi";
import type { Ctx } from "../context.js";
import { appendAudit, appendEvent } from "./ledger.js";
import { kpiReport, type KpiReport } from "./kpi.js";

/** Periodic KPI report (FR-39) as PDF or XLSX. Numbers come only from the KPI engine. */
const UNIT: Record<string, string> = { seconds: "detik", milliseconds: "ms", percent: "%", score: "skor", count: "", ratio: "" };
const fmtValue = (k: KpiValue) => (k.value === null ? (k.status === "needs_param" ? "perlu parameter" : "tidak ada data") : `${k.value}${k.unit === "percent" ? "%" : UNIT[k.unit] ? ` ${UNIT[k.unit]}` : ""}`);
const fmtTarget = (k: KpiValue) => (k.target === null ? "target belum ditetapkan" : `${k.target}${k.unit === "percent" ? "%" : ""}`);
// Built-in PDF fonts are WinAnsi: replace symbols they cannot draw.
const ascii = (s: string) => s.replace(/→/g, "->").replace(/÷/g, "/").replace(/[≤]/g, "<=").replace(/[≥]/g, ">=").replace(/[–—]/g, "-");

const dateId = (iso: string) => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

export async function renderPdf(r: KpiReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: "Laporan KPI haloK@MPUS", Author: "haloK@MPUS" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const lastDay = new Date(new Date(r.period.to).getTime() - 1).toISOString();
  doc.font("Helvetica-Bold").fontSize(18).text("Laporan KPI haloK@MPUS");
  doc.font("Helvetica").fontSize(10).fillColor("#334155").text(`Periode ${dateId(r.period.from)} s.d. ${dateId(lastDay)} (WIB) · dibuat ${new Date(r.generatedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`);
  doc.text(`Tiket dalam periode: ${r.ticketCount}. Semua angka dihitung dari tabel peristiwa (events).`);
  if (r.containsDummy) doc.moveDown(0.3).fillColor("#92400e").font("Helvetica-Bold").text("PERHATIAN: laporan ini memuat data DUMMY (pengembangan). Bukan data penelitian.");
  doc.fillColor("#0f172a").moveDown();
  const groups: Record<string, string> = { kecepatan: "Kecepatan", efektivitas: "Efektivitas", kualitas: "Kualitas & pengalaman", tata_kelola_ai: "Tata kelola AI", beban_kerja: "Beban kerja", pdp: "UU PDP" };
  for (const [g, label] of Object.entries(groups)) {
    const ks = r.kpis.filter((k) => k.group === g);
    if (!ks.length) continue;
    doc.font("Helvetica-Bold").fontSize(12).text(label);
    doc.moveDown(0.2);
    for (const k of ks) {
      const y = doc.y;
      doc.font("Helvetica").fontSize(9.5).fillColor("#0f172a").text(ascii(`${r.kpiMap[k.id] ? `${r.kpiMap[k.id]} · ` : ""}${k.label}`), 48, y, { width: 230 });
      doc.font("Helvetica-Bold").text(ascii(fmtValue(k)), 285, y, { width: 100 });
      doc.font("Helvetica").fillColor("#475569").text(ascii(`n=${k.n} · ${fmtTarget(k)}`), 390, y, { width: 160 });
      doc.moveDown(0.35);
    }
    doc.moveDown(0.6);
  }
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text("Corong eskalasi");
  doc.font("Helvetica").fontSize(9.5);
  for (const f of r.funnel) doc.text(`${f.label}: ${f.count}`);
  doc.moveDown(0.6).font("Helvetica-Bold").fontSize(12).text("Kepatuhan SLA per kanal");
  doc.font("Helvetica").fontSize(9.5);
  for (const s of r.slByChannel) doc.text(`${s.channel} ${s.tier}: ${s.value ?? "-"}% (terpenuhi ${s.met}, terlewati ${s.breached})`);
  doc.moveDown().fontSize(8).fillColor("#475569").text(ascii(`Parameter: PRM-01=${r.params.PRM01}; PRM-11=${r.params.PRM11 ?? "[PERLU DATA]"}; PRM-12=${r.params.PRM12 ?? "[PERLU DATA]"}. Definisi rumus: docs/KPI.md.`));
  doc.end();
  return done;
}

export async function renderXlsx(r: KpiReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "haloK@MPUS";
  const k = wb.addWorksheet("KPI");
  k.columns = [
    { header: "Kode Buku Model", key: "map", width: 16 }, { header: "ID", key: "id", width: 18 }, { header: "KPI", key: "label", width: 40 },
    { header: "Nilai", key: "value", width: 12 }, { header: "Satuan", key: "unit", width: 12 }, { header: "Pembilang", key: "num", width: 11 },
    { header: "Penyebut", key: "den", width: 11 }, { header: "n", key: "n", width: 8 }, { header: "Status", key: "status", width: 14 },
    { header: "Target", key: "target", width: 12 }, { header: "Catatan", key: "note", width: 60 },
  ];
  for (const x of r.kpis) k.addRow({ map: r.kpiMap[x.id] ?? "", id: x.id, label: x.label, value: x.value, unit: x.unit, num: x.numerator ?? "", den: x.denominator ?? "", n: x.n, status: x.status, target: x.target ?? "target belum ditetapkan", note: x.note ?? "" });
  k.getRow(1).font = { bold: true };
  const sl = wb.addWorksheet("SLA per kanal");
  sl.columns = [{ header: "Kanal", key: "channel" }, { header: "Tingkat", key: "tier" }, { header: "Terpenuhi", key: "met" }, { header: "Terlewati", key: "breached" }, { header: "%", key: "value" }];
  sl.addRows(r.slByChannel);
  const tr = wb.addWorksheet("Tren harian");
  tr.columns = [{ header: "Tanggal", key: "date", width: 12 }, { header: "Dibuka", key: "opened" }, { header: "Dieskalasi", key: "escalated" }, { header: "Selesai oleh AI", key: "contained" }, { header: "SLA terpenuhi", key: "slMet" }, { header: "SLA terlewati", key: "slBreached" }];
  tr.addRows(r.series);
  const info = wb.addWorksheet("Keterangan");
  info.addRows([["Periode", `${r.period.from} – ${r.period.to}`], ["Data DUMMY", r.containsDummy ? "YA — bukan data penelitian" : "tidak"], ["Sumber", "tabel events; rumus di docs/KPI.md"]]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function generateReport(ctx: Ctx, q: { from: Date; to: Date; format: "pdf" | "xlsx"; includeDummy: boolean; userId?: string | null; role?: string }) {
  const r = await kpiReport(ctx, { from: q.from, to: q.to, includeDummy: q.includeDummy });
  const content = q.format === "pdf" ? await renderPdf(r) : await renderXlsx(r);
  const filename = `laporan-kpi-halokampus-${r.period.from.slice(0, 10)}_${new Date(new Date(r.period.to).getTime() - 1).toISOString().slice(0, 10)}.${q.format}`;
  const row = await ctx.db.generatedReport.create({ data: { periodFrom: q.from, periodTo: q.to, format: q.format, filename, content: new Uint8Array(content), includesDummy: r.containsDummy, createdBy: q.userId ?? null, createdAt: ctx.clock.now() } });
  await appendEvent(ctx.db, { occurredAt: ctx.clock.now(), type: "report_generated", actorType: q.role ?? "system", actorId: q.userId ?? null, payload: { format: q.format } });
  if (q.userId) await appendAudit(ctx.db, { at: ctx.clock.now(), actorType: "user", actorId: q.userId, actorRole: q.role ?? null, action: "report.generate", resourceType: "report", resourceId: row.id, detail: { format: q.format } });
  return row;
}

/** Scheduled weekly report: previous Monday–Sunday (WIB), both formats. */
export async function weeklyReports(ctx: Ctx) {
  const now = ctx.clock.now();
  const wib = new Date(now.getTime() + 7 * 3600_000);
  const dow = (wib.getUTCDay() + 6) % 7; // 0 = Monday
  const thisMonday = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() - dow) - 7 * 3600_000;
  const from = new Date(thisMonday - 7 * 86400_000);
  const to = new Date(thisMonday);
  for (const format of ["pdf", "xlsx"] as const) await generateReport(ctx, { from, to, format, includeDummy: ctx.env.ENABLE_SIMULATORS });
}
