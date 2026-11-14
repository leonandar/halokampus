# Rencana Fase — haloK@MPUS

Setiap fase diakhiri laporan (selesai + FR, cara menjalankan, hasil uji & cakupan, tangkapan layar di
`docs/screenshots/`, keputusan teknis, hal terblokir) dan menunggu persetujuan sebelum fase berikutnya.

## Fase 0 — Rencana
- [x] Simpan spesifikasi sumber di `docs/PROMPT.md`
- [x] `docs/SRS.md`: aktor, FR-01…FR-70, NFR-01…NFR-18, RBAC, kasus batas, tabel keterlacakan
- [x] `docs/ARSITEKTUR.md`: konteks, kontainer, pipeline multi-agen, skor keyakinan, status tiket & SLA, ER, katalog peristiwa, keamanan, ADR
- [x] Rencana fase (berkas ini)
- [x] Jawaban pertanyaan klarifikasi Q1–Q5 → SRS/ARSITEKTUR direvisi (SRS §10)
- [x] Persetujuan Fase 0

## Fase 1 — MVP
**Fondasi**
- [x] Monorepo pnpm, TypeScript strict, ESLint/Prettier, Vitest, CI lokal (`pnpm verify`)
- [x] Docker Compose: postgres+pgvector, redis, api, worker, web, mock-pmb, mailpit; `.env.example` lengkap
- [x] Skema Prisma + migrasi SQL (pgvector, trigger append-only, rantai hash); seed `DUMMY`
- [x] `packages/domain`: `Clock`, kalender hari kerja (PRM-07), perbandingan ambang basis poin, mesin status tiket, evaluator kewenangan
- [x] Layanan parameter berversi (`policy_parameters`) — baca runtime, ubah langsung + audit (persetujuan penuh di Fase 3)

**Autentikasi & RBAC** — FR-41, FR-42 (pengguna), FR-43
- [x] Login email + kata sandi argon2id, 2FA TOTP opsional, kunci akun
- [x] Guard RBAC REST + WebSocket; uji matriks peran × endpoint

**AI** — FR-01…FR-06, FR-12…FR-20, FR-68
- [x] `LLMProvider` (Anthropic + Mock), `EmbeddingProvider` (lokal + Mock)
- [x] Penyamar PII untuk payload LLM
- [x] Agen niat (aturan + contoh berlabel `DUMMY`), agen RAG (hibrida, tersaring), agen tindakan (status, validasi berkas, pengingat), agen penjaga, agen peringkas
- [x] Skor keyakinan komposit + gerbang keras; penyimpanan komponen di `ai_actions`
- [x] Fallback saat jeda / LLM gagal / lewat PRM-02
- [x] Basis pengetahuan contoh `DUMMY` + ingest + uji tanya-jawab sebelum terbit (dasar FR-33)

**Perutean & SLA** — FR-05, FR-07…FR-11
- [x] Eskalasi T1→T2→T3, lima kategori wajib, paket serah-terima
- [x] Timer SLA (DB + BullMQ + penyapu), auto-naik T2→T3, `sla_breach`, janji waktu

**Kanal** — FR-44, FR-45, FR-46 (simulator), FR-52 (WA), FR-53 (dasar)
- [x] Kontrak `ChannelAdapter`; adaptor web; adaptor WhatsApp + simulator WA
- [x] Widget (Preact, Shadow DOM): jawaban + sumber, umpan balik SVG, pengingat + alasan, kartu "diteruskan", "Bicara dengan manusia", tautan data pribadi
- [x] Verifikasi OTP / nomor pendaftaran (OTP lewat mailpit/simulator)

**Konsol** — FR-21…FR-32
- [x] Konsol CP: antrean + hitung mundur, klaim atomik, kehadiran, panel serah-terima, draf AI tersunting, templat `DUMMY`, penanda batas kewenangan, penyamaran server
- [x] Konsol Staf: antrean T3 berlabel, supervisi AI waktu nyata, override beralasan, jeda AI, jejak audit (lihat), basis pengetahuan (Markdown)

**PDP & integrasi** — FR-63, FR-64, FR-65 (ajukan), FR-67, FR-69, FR-70
- [x] Persetujuan per tujuan, tarik persetujuan, daftar data diizinkan
- [x] Pengajuan hak data (tiket DSR), audit `pii_accessed`
- [x] Mock PMB API (`DUMMY`) + `PmbAdapter`
- [x] `docs/PDP.md` (aliran data, termasuk ke LLM)

**Uji Fase 1**
- [x] Unit: domain, skor keyakinan, kalender, kewenangan, penyamar PII
- [x] API (Supertest): SU untuk FR Fase 1, KB-01…KB-04, KB-06, KB-07, KB-08, KB-10, KB-12, KB-13
- [x] E2E Playwright: E2E-1, E2E-2, E2E-3, E2E-4 (bagian audit), E2E-6
- [x] Pemeriksaan aksesibilitas axe-core; tangkapan layar 360/1280 px

**Catatan Fase 1**
- Persetujuan parameter dua orang (Pimpinan + Staf) sudah ada di API dan halaman Parameter (dimajukan dari Fase 3).
- Penggabungan identitas lintas kanal dasar (OTP + persetujuan, tiket dilebur) sudah ada; dimajukan sebagian dari Fase 2.
- Belum: notifikasi waktu-nyata dari proses `worker` terpisah (Fase 1 berjalan dengan `AI_INLINE=true`); unggah KB PDF/DOCX; ekspor audit.

## Fase 2 — Omnichannel penuh
- [x] Adaptor nyata WhatsApp Cloud API, Instagram DM, Messenger, Email, Telegram (FR-46…FR-50) + verifikasi tanda tangan webhook
- [x] Simulator untuk setiap kanal (FR-52)
- [x] Formulir pencatatan telepon; antarmuka adaptor VoIP opsional (FR-51)
- [x] Penggabungan identitas lintas kanal dengan persetujuan (FR-53)
- [x] Kontinuitas lintas kanal tanpa reset SLA (FR-54) — KB-05, E2E-5
- [x] Kotak masuk terpadu & linimasa tunggal (FR-55)
- [x] Matriks paritas fitur per kanal + uji otomatis (FR-56); tautan unggah aman untuk kanal tanpa lampiran
- [x] Survei CSAT/CES (NPS opsional) di semua kanal dari konfigurasi (FR-57)
- [x] Penjadwalan ulang lewat agen tindakan (FR-14 sisa); kelola integrasi kanal oleh Admin (FR-42 sisa)

**Catatan Fase 2**
- Adaptor nyata (Graph API, Bot API, SMTP) sudah ditulis dan lolos typecheck, tetapi baru diuji lewat simulator; uji dengan akun resmi menunggu kredensial (AS-03).
- Adaptor VoIP: belum (opsional di spesifikasi); pencatatan telepon oleh petugas sudah ada.
- Uji paritas: `apps/api/test/omnichannel.test.ts` (5 kanal × 9 fitur).

## Fase 3 — KPI & tata kelola
- [x] `docs/KPI.md`: definisi formal tiap KPI (pembilang, penyebut, peristiwa, aturan pengecualian)
- [x] `packages/kpi` + uji KT dengan data sintetis hitung tangan untuk setiap KPI
- [x] Filter periode/kanal/kategori/lapis/petugas (snapshot harian tidak dibuat; KPI dihitung saat diminta — lihat KPI.md §7)
- [x] Dasbor Pimpinan: kartu KPI, corong eskalasi, kepatuhan SLA per kanal, tren, panel tata kelola AI (FR-38); target sebagai parameter (FR-40)
- [x] Laporan berkala PDF/XLSX (FR-39)
- [x] Ekspor teranonimkan CSV/XLSX, pseudonim HMAC, pengecualian `DUMMY` (FR-62); ekspor audit (FR-32)
- [x] Parameter berversi dengan alur usul → setujui → berlaku (FR-37)
- [x] `config/kpi-map.yaml` (FR-61)
- [x] Modul siklus orkestrasi (FR-35); supervisi CP (FR-34); QA review & akurasi AI (FR-36)
- [x] Manajemen KB lengkap (FR-33); alur hak data lengkap (FR-65); job retensi PRM-08 (FR-66)
- [x] Modul survei usability dari YAML (FR-58)
- [x] E2E-4 lengkap (override → audit → KPI berubah)

**Catatan Fase 3**
- Peristiwa sumber dilengkapi: `escalation.confidence`, `handling_ended` saat dieskalasi, buka-ulang tiket (PRM-12), sapuan ketidakaktifan (PRM-11).
- Konten resmi masih `[PERLU DATA]`: kriteria QA, butir siklus orkestrasi, butir SUS/CSAT/CES, kode KPI-01…22, nilai PRM-08/11/12/13/14/16.

## Fase 4 — Pengerasan & dokumentasi
- [x] Uji keamanan: matriks RBAC lengkap, rangkaian injeksi prompt, uji kebocoran PII ke LLM & log, header keamanan
- [x] Uji beban masa puncak (NFR-01, NFR-03) dengan angka beban dari institusi
- [x] Uji kegagalan terkontrol (LLM mati, Redis restart, kanal gagal) — NFR-04
- [x] `README.md` instalasi lokal & server langkah demi langkah
- [x] `docs/PANDUAN-PENGGUNA.md` per peran
- [x] `docs/SKENARIO-UJI.md`: SU-01…SU-70, KB-01…KB-13, E2E-1…E2E-6 dengan hasil
- [x] Tangkapan layar final semua layar untuk lampiran disertasi

**Catatan Fase 4**
- Hasil & temuan: `docs/VERIFIKASI-NFR.md`; skenario & hasil uji: `docs/SKENARIO-UJI.md`; matriks RBAC teramati: `docs/RBAC-MATRIX.md`.
- Belum (butuh sumber daya dari institusi): uji dengan LLM/GPU sungguhan, akun kanal resmi, uji kegagalan worker terpisah, uji pembaca layar manual, uji penetrasi independen.
