import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { db, login, shot, widget } from "./helpers";

test.describe.configure({ mode: "serial" });

const ANSWERABLE = "Jalur pendaftaran apa saja yang tersedia?";
const LOW_CONFIDENCE = "Berapa biaya pendaftaran?";

async function openWidgetAndConsent(page: Page) {
  await page.goto("/demo");
  await widget(page).getByRole("button", { name: /Buka layanan tanya PMB/ }).click();
  const consent = widget(page).getByRole("button", { name: "Setuju dan mulai" });
  await expect(consent).toBeVisible();
  return consent;
}

async function ask(page: Page, text: string) {
  await widget(page).getByLabel("Pesan").fill(text);
  await widget(page).getByRole("button", { name: "Kirim" }).click();
}

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${label}: ${v.id} (${v.nodes.length})`)).toEqual([]);
}

test("E2E-1 · E2E-6: widget consent → AI answer with source → feedback; data-rights page", async ({ page, context }) => {
  const consent = await openWidgetAndConsent(page);
  await shot(page, "01-widget-persetujuan");
  await widget(page).getByText("Pengingat proaktif").click();
  await consent.click();
  await ask(page, ANSWERABLE);
  await expect(widget(page).getByText(/Sumber: \[DUMMY\] Jalur dan Program Studi/)).toBeVisible();
  await widget(page).getByRole("button", { name: "Membantu" }).first().click();
  await expect(widget(page).getByText("Terima kasih atas umpan baliknya.")).toBeVisible();
  await shot(page, "02-widget-jawaban-ai-sumber");
  await axe(page, "widget");

  const [dataPage] = await Promise.all([context.waitForEvent("page"), widget(page).getByRole("button", { name: "Data pribadi" }).click()]);
  await dataPage.waitForLoadState();
  await expect(dataPage.getByRole("heading", { name: /Data pribadi & persetujuan/ })).toBeVisible();
  await expect(dataPage.getByText("Disetujui").first()).toBeVisible();
  await shot(dataPage, "03-hak-data-pribadi");
  await axe(dataPage, "data-pribadi");
  await dataPage.close();
});

test("E2E-2: low confidence → hand-off card → CP claims, uses AI draft, replies → customer sees reply", async ({ page, browser }) => {
  await openWidgetAndConsent(page).then((b) => b.click());
  await ask(page, LOW_CONFIDENCE);
  await expect(widget(page).getByText("Diteruskan ke petugas")).toBeVisible();
  await expect(widget(page).getByText(/Perkiraan tanggapan Mahasiswa CP paling lambat/)).toBeVisible();
  await shot(page, "04-widget-diteruskan-cp");

  const cpCtx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
  const cp = await cpCtx.newPage();
  await login(cp, "cp1@dummy.halokampus.local");
  await expect(cp.getByText(/Batas kewenangan Mahasiswa CP/)).toBeVisible();
  await cp.getByRole("button", { name: "Online", exact: true }).click();
  await cp.getByRole("button", { name: /#\d+ .*Biaya \(informasi\)/ }).first().click();
  await cp.getByRole("button", { name: "Klaim tiket" }).click();
  await expect(cp.getByText("Tiket diklaim.")).toBeVisible();
  await cp.getByRole("button", { name: "Minta draf AI" }).click();
  await expect(cp.getByLabel("Isi balasan")).toHaveValue(/Rp250\.000/);
  await shot(cp, "05-konsol-cp-serah-terima-draf");
  await axe(cp, "konsol-cp");
  await expect(cp.getByRole("button", { name: /override/i })).toHaveCount(0);
  await cp.getByRole("button", { name: "Kirim", exact: true }).click();
  await expect(cp.getByText("Balasan terkirim.")).toBeVisible();
  await expect(widget(page).getByText("Mahasiswa CP", { exact: true }).last()).toBeVisible({ timeout: 15_000 });
  await cp.getByRole("button", { name: "Tandai selesai" }).click();
  await expect(cp.getByText("Tiket ditandai selesai.")).toBeVisible();
  await cpCtx.close();
  // FR-57: post-service survey in the same widget (items are DUMMY placeholders from config).
  await expect(widget(page).getByText(/Butir CSAT-1/)).toBeVisible({ timeout: 15_000 });
  await widget(page).getByRole("button", { name: "4", exact: true }).last().click();
  await expect(widget(page).getByText(/Butir CES-1/)).toBeVisible({ timeout: 15_000 });
  await shot(page, "15-widget-survei");
  await widget(page).getByRole("button", { name: "5", exact: true }).last().click();
  await expect(widget(page).getByText("Terima kasih atas penilaian Kakak.")).toBeVisible({ timeout: 15_000 });
});

test("E2E-3: payment problem → straight to the Staf PMB queue with the category label", async ({ page, browser }) => {
  await openWidgetAndConsent(page).then((b) => b.click());
  await ask(page, "Pembayaran saya gagal tapi saldo sudah terpotong");
  await expect(widget(page).getByText(/diteruskan ke Staf PMB/)).toBeVisible();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
  const staff = await ctx.newPage();
  await login(staff, "staf1@dummy.halokampus.local");
  const item = staff.getByRole("button", { name: /#\d+ .*Pembayaran/ }).first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(staff.getByText("kategori wajib T3")).toBeVisible();
  await shot(staff, "06-konsol-staf-antrean-t3");
  await axe(staff, "konsol-staf");
  await ctx.close();
});

test("E2E-4: override → recorded in the audit trail → override event (KPI source) increases", async ({ page, browser }) => {
  await openWidgetAndConsent(page).then((b) => b.click());
  await ask(page, ANSWERABLE);
  await expect(widget(page).getByText(/Sumber:/).last()).toBeVisible();
  const before = await db.event.count({ where: { type: "override_applied" } });

  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
  const staff = await ctx.newPage();
  await login(staff, "staf1@dummy.halokampus.local");
  await staff.getByRole("tab", { name: "Supervisi AI" }).click();
  await expect(staff.getByText("kb.answer").first()).toBeVisible();
  await shot(staff, "07-supervisi-ai-langsung");
  await staff.getByRole("button", { name: "Override" }).first().click();
  await staff.getByLabel("Kategori penyebab (wajib)").selectOption("outdated_kb");
  await staff.getByLabel("Alasan (wajib)").fill("Contoh override untuk lampiran (DUMMY)");
  await staff.getByLabel("Jawaban pengganti").fill("Jalur yang dibuka: prestasi, tes tulis, dan mandiri. (DUMMY, diperbarui Staf)");
  await shot(staff, "08-formulir-override");
  await staff.getByRole("button", { name: "Terapkan override" }).click();
  await expect(staff.getByText("Di-override").first()).toBeVisible();
  await expect(widget(page).getByText(/diganti oleh Staf PMB/)).toBeVisible({ timeout: 15_000 });
  await staff.getByRole("tab", { name: "Jejak audit" }).click();
  await expect(staff.getByRole("cell", { name: "ai.override" }).first()).toBeVisible();
  await shot(staff, "09-jejak-audit");
  expect(await db.event.count({ where: { type: "override_applied" } })).toBe(before + 1);

  await staff.getByRole("tab", { name: "Jeda AI" }).click();
  await shot(staff, "10-jeda-ai");
  await staff.getByRole("tab", { name: "Basis pengetahuan" }).click();
  await expect(staff.getByText("[DUMMY] Biaya Pendaftaran").first()).toBeVisible();
  await shot(staff, "11-basis-pengetahuan");
  await ctx.close();
});

test("E2E-5 · FR-52: WhatsApp simulator — consent, then the held question is answered", async ({ page }) => {
  await page.goto("/sim/whatsapp");
  await page.getByLabel("Nomor pengirim").fill("6281200000077");
  await page.getByRole("textbox", { name: "Pesan" }).fill(ANSWERABLE);
  await page.getByRole("button", { name: "Kirim", exact: true }).click();
  await page.getByRole("button", { name: "Setuju" }).click();
  await expect(page.getByText(/Sumber: \[DUMMY\] Jalur/)).toBeVisible({ timeout: 15_000 });
  await shot(page, "12-simulator-whatsapp");
});

test("Parameter page shows the two-person rule; mobile widget at 390 px", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
  const leader = await ctx.newPage();
  await login(leader, "pimpinan@dummy.halokampus.local");
  await leader.goto("/parameter");
  await expect(leader.getByText("Parameter aktif")).toBeVisible();
  await shot(leader, "13-parameter-kebijakan");
  await ctx.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mobile.newPage();
  await m.goto("/demo");
  await widget(m).getByRole("button", { name: /Buka layanan tanya PMB/ }).click();
  await widget(m).getByRole("button", { name: "Setuju dan mulai" }).click();
  await widget(m).getByLabel("Pesan").fill(ANSWERABLE);
  await widget(m).getByRole("button", { name: "Kirim" }).click();
  await expect(widget(m).getByText(/Sumber:/)).toBeVisible();
  const box = await widget(m).getByRole("button", { name: "Bicara dengan manusia" }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await shot(m, "14-widget-ponsel");
  await mobile.close();
});

test("Fase 2 · FR-49/50: Telegram and Email simulators — typed options on email", async ({ page }) => {
  await page.goto("/sim/telegram");
  await page.getByRole("textbox", { name: "Pesan" }).fill("SETUJU");
  await page.getByRole("button", { name: "Kirim", exact: true }).click();
  await page.getByRole("textbox", { name: "Pesan" }).fill(ANSWERABLE);
  await page.getByRole("button", { name: "Kirim", exact: true }).click();
  await expect(page.getByText(/Sumber: \[DUMMY\] Jalur/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Bicara dg manusia" })).toBeVisible();
  await shot(page, "16-simulator-telegram");

  await page.goto("/sim/email");
  await page.getByRole("textbox", { name: "Pesan" }).fill("SETUJU");
  await page.getByRole("button", { name: "Kirim", exact: true }).click();
  await page.getByRole("textbox", { name: "Pesan" }).fill(ANSWERABLE);
  await page.getByRole("button", { name: "Kirim", exact: true }).click();
  await expect(page.getByText(/Balas dengan: 1 = Membantu/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("textbox", { name: "Pesan" }).fill("MANUSIA");
  await page.getByRole("button", { name: "Kirim", exact: true }).click();
  await expect(page.getByText(/diteruskan ke petugas PMB/)).toBeVisible({ timeout: 15_000 });
  await shot(page, "17-simulator-email");
});

test("Fase 2 · FR-51/55: phone log, unified inbox with channel filter, admin channels", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
  const staff = await ctx.newPage();
  await login(staff, "staf1@dummy.halokampus.local");
  await staff.goto("/telepon");
  await staff.getByLabel("Nomor penelepon").fill("081200007777");
  await staff.getByLabel("Penelepon menyetujui").check();
  await staff.getByLabel("Pertanyaan penelepon").fill("Kapan jadwal tes seleksi jalur mandiri? (DUMMY)");
  await staff.getByLabel("Jawaban yang diberikan (opsional)").fill("Tes daring 15 Februari 2027 (DUMMY).");
  await staff.getByRole("radio", { name: "Masih ditindaklanjuti" }).check();
  await shot(staff, "18-catat-panggilan");
  await staff.getByRole("button", { name: "Simpan catatan" }).click();
  await expect(staff.getByText(/Tercatat · Tingkat 3/)).toBeVisible();

  await staff.goto("/staf");
  await staff.getByRole("tab", { name: "Kotak masuk terpadu" }).click();
  await expect(staff.getByRole("button", { name: /Telepon/ }).first()).toBeVisible();
  await staff.getByLabel("Saring kanal").selectOption("phone");
  await staff.getByRole("button", { name: /#\d+ Telepon/ }).first().click();
  await expect(staff.getByText("Linimasa lintas kanal")).toBeVisible();
  await shot(staff, "19-kotak-masuk-terpadu");
  await ctx.close();

  const actx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
  const admin = await actx.newPage();
  await login(admin, "admin@dummy.halokampus.local");
  await expect(admin.getByText("Integrasi kanal")).toBeVisible();
  await expect(admin.getByRole("cell", { name: "Telegram" })).toBeVisible();
  await shot(admin, "20-admin-kanal");
  await actx.close();
});

test("Fase 3 · FR-38/60 · E2E-4: leader dashboard reflects the override; governance screens", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
  const leader = await ctx.newPage();
  await login(leader, "pimpinan@dummy.halokampus.local");
  await expect(leader).toHaveURL(/\/dasbor/);
  await expect(leader.getByRole("heading", { name: "Corong eskalasi tiga tingkat" })).toBeVisible();
  await expect(leader.getByText(/memuat data DUMMY/)).toBeVisible();
  // E2E-4 earlier overrode one AI answer: the override tile must show a non-zero rate.
  const overrideTile = leader.locator(".card", { has: leader.getByRole("heading", { name: "Override Rate" }) });
  await expect(overrideTile).not.toContainText(/^Override Rate0/);
  await expect(overrideTile.getByText(/dari/)).toContainText(/^[1-9]\d* dari/);
  await expect(leader.getByText("Target belum ditetapkan").first()).toBeVisible();
  await shot(leader, "21-dasbor-kpi");
  await axe(leader, "dasbor");
  await leader.goto("/orkestrasi");
  await expect(leader.getByRole("heading", { name: /Siklus orkestrasi/ })).toBeVisible();
  await ctx.close();

  const sctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
  const staff = await sctx.newPage();
  await login(staff, "staf1@dummy.halokampus.local");
  await staff.getByRole("tab", { name: "QA review" }).click();
  await expect(staff.getByRole("heading", { name: /Sampel QA/ })).toBeVisible();
  const first = staff.getByRole("button", { name: /^#\d+/ }).first();
  if (await first.isVisible()) {
    await first.click();
    await expect(staff.getByRole("heading", { name: /Formulir QA/ })).toBeVisible();
  }
  await shot(staff, "22-qa-review");
  await staff.getByRole("tab", { name: "Supervisi CP" }).click();
  await expect(staff.getByRole("heading", { name: /Beban kerja Mahasiswa CP/ })).toBeVisible();
  await shot(staff, "23-supervisi-cp");
  await staff.getByRole("tab", { name: "Siklus orkestrasi" }).click();
  await staff.getByRole("checkbox").first().click();
  await expect(staff.getByRole("checkbox").first()).toBeChecked();
  await expect(staff.getByText("Tersimpan.")).toBeVisible();
  await shot(staff, "24-siklus-orkestrasi");
  await staff.getByRole("tab", { name: "Hak data" }).click();
  await expect(staff.getByRole("heading", { name: "Permintaan hak subjek data" })).toBeVisible();
  await shot(staff, "25-hak-data-staf");
  await staff.goto("/survei-petugas");
  await expect(staff.getByText(/Butir usability 1/)).toBeVisible();
  await shot(staff, "26-survei-usability");
  await sctx.close();
});
