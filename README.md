# haloK@MPUS

Lapisan orkestrasi **helpdesk Penerimaan Mahasiswa Baru (PMB) omnichannel** dengan Contact Personnel tiga lapis
(Agentic AI → Mahasiswa CP → Staf PMB), produk penelitian disertasi R&D. haloK@MPUS **bukan sistem pendaftaran**:
ia berada di atas sistem PMB dan, selama penelitian, memakai mock API berdata `DUMMY`.

| Dokumen | Isi |
|---|---|
| [`docs/PROMPT.md`](docs/PROMPT.md) | Spesifikasi sumber |
| [`docs/SRS.md`](docs/SRS.md) | Kebutuhan (FR/NFR), RBAC, kasus batas, tabel keterlacakan |
| [`docs/ARSITEKTUR.md`](docs/ARSITEKTUR.md) | Arsitektur, ER, katalog peristiwa, keputusan teknis |
| [`docs/PDP.md`](docs/PDP.md) | Pelindungan data pribadi & aliran data ke LLM |
| [`docs/KPI.md`](docs/KPI.md) | Definisi rumus setiap KPI dan contoh hitungan tangan |
| [`docs/PANDUAN-PENGGUNA.md`](docs/PANDUAN-PENGGUNA.md) | Panduan per peran |
| [`docs/SKENARIO-UJI.md`](docs/SKENARIO-UJI.md) | Skenario & hasil uji (dibuat otomatis dari hasil uji) |
| [`docs/VERIFIKASI-NFR.md`](docs/VERIFIKASI-NFR.md) | Hasil uji beban, benchmark KPI, keamanan |
| [`docs/RBAC-MATRIX.md`](docs/RBAC-MATRIX.md) | Matriks hak akses teramati (rute × peran) |
| [`docs/RENCANA.md`](docs/RENCANA.md) | Rencana & status fase |
| [`docs/screenshots/`](docs/screenshots) | Tangkapan layar (dibuat otomatis oleh uji E2E) |

Status: **Fase 4 (pengerasan & dokumentasi)** selesai — seluruh fase rencana awal. Panduan pengguna per peran dan instalasi server lengkap disusun pada Fase 4.

## Prasyarat

- Node.js ≥ 22 dan pnpm 10 (`corepack enable`)
- Docker + Docker Compose (PostgreSQL 16 + pgvector, Redis, Mailpit)

## Menjalankan secara lokal (pengembangan)

```bash
cp .env.example .env
```

Isi tiga kunci kriptografi di `.env` (masing-masing dengan keluaran `openssl rand -base64 32`) dan `SEED_DEFAULT_PASSWORD` (tanpa tanda `#`).

```bash
pnpm install
```

```bash
pnpm dev:infra
```

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

```bash
pnpm build:widget
```

Lalu jalankan tiga proses (di terminal terpisah):

```bash
pnpm dev:mock-pmb
```

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

Buka <http://localhost:3000>:

| Halaman | Kegunaan |
|---|---|
| `/demo` | Situs PMB tiruan dengan widget percakapan |
| `/sim/whatsapp`, `/sim/instagram`, `/sim/messenger`, `/sim/telegram`, `/sim/email` | Simulator kanal (payload berformat penyedia melewati webhook yang sama) |
| `/telepon` | Pencatatan panggilan (Mahasiswa CP / Staf PMB) |
| `/dasbor` | Dasbor KPI, laporan PDF/XLSX, ekspor penelitian (Pimpinan / Staf PMB) |
| `/masuk` | Konsol petugas |
| <http://localhost:8025> | Mailpit — kotak masuk email uji (kode OTP) |

Akun `DUMMY` (kata sandi = `SEED_DEFAULT_PASSWORD`): `cp1@dummy.halokampus.local`, `cp2@…`, `staf1@…`, `staf2@…`,
`pimpinan@…`, `keuangan@…`, `admin@dummy.halokampus.local`. Nomor pendaftaran `DUMMY`: `PMB-2027-000100` … `PMB-2027-000159`.

## Instalasi server (on-premise)

Contoh untuk Ubuntu Server 22.04/24.04 dengan nama domain yang mengarah ke server.

1. Pasang Docker Engine + Compose plugin dan Git; buka port 80 dan 443.
2. Ambil kode dan siapkan konfigurasi:

```bash
git clone <repositori-haloKampus> /opt/halokampus
```

```bash
cd /opt/halokampus && cp .env.example .env
```

3. Sunting `.env` untuk produksi:
   - `POSTGRES_PASSWORD` kuat; `DATABASE_URL` memakai host `postgres` dan kata sandi yang sama.
   - Tiga kunci kriptografi baru (`openssl rand -base64 32` untuk masing-masing). **Simpan cadangannya**: tanpa
     `DATA_ENCRYPTION_KEY` data terenkripsi tidak dapat dibaca.
   - `COOKIE_SECURE=true`, `ENABLE_SIMULATORS=false`, `API_PUBLIC_URL`/`WEB_PUBLIC_URL`/`CORS_ORIGINS` = `https://<domain>`
     (tambahkan domain situs PMB di `CORS_ORIGINS` bila widget ditanam di sana).
   - `EMAIL_WEBHOOK_TOKEN` dan rahasia webhook kanal yang dipakai; `SMTP_*` server email kampus.
   - `HALOKAMPUS_DOMAIN=<domain>` untuk Caddy (TLS otomatis), atau ganti `docker/Caddyfile` dengan sertifikat kampus.
   - Penyedia LLM: untuk data tetap di server, jalankan Ollama (`--profile local-llm`) dan isi `OLLAMA_MODEL`,
     `OLLAMA_EMBED_MODEL`, `EMBEDDING_PROVIDER=ollama`.
   Proses API/worker **menolak berjalan** bila pengaturan produksi tidak aman, dengan daftar masalahnya di log.
4. Bangun dan jalankan (migrasi basis data berjalan otomatis saat API start):

```bash
docker compose --profile app up -d --build
```

5. Siapkan data dasar (parameter & aturan kewenangan AI, **tanpa** data DUMMY) dan akun Admin pertama:

```bash
docker compose exec api pnpm --filter @hk/api seed:production
```

```bash
docker compose exec api pnpm --filter @hk/api create-admin -- admin@kampus.ac.id "Admin TI" 'KataSandiSangatKuat!'
```

6. Masuk sebagai Admin di `https://<domain>/masuk`, buat akun Pimpinan, Staf PMB, Mahasiswa CP, Keuangan;
   aktifkan kanal yang dipakai di halaman Admin.
7. Pimpinan + Staf PMB menetapkan parameter yang masih `DUMMY`/`[PERLU DATA]` di `/parameter` (terutama PRM-07
   jam kerja, PRM-08 retensi, PRM-10 ambang retrieval, PRM-15 survei, PRM-20 penyedia LLM).
8. Staf PMB mengunggah pedoman PMB resmi di Konsol Staf → Basis pengetahuan (uji tanya-jawab sebelum terbit).
9. Tanam widget di situs PMB:
   `<script src="https://<domain>/widget/halokampus-widget.js" data-api="https://<domain>" defer></script>`

Cadangan: jadwalkan `pg_dump` harian untuk volume `pgdata`, simpan bersama salinan `.env` di tempat aman.
Pembaruan: `git pull && docker compose --profile app up -d --build`.

## Kanal sungguhan

Setiap kanal berjalan dalam mode simulator sampai kredensialnya diisi di `.env` dan modenya diganti:

| Kanal | Mode | Webhook yang didaftarkan di penyedia |
|---|---|---|
| WhatsApp | `WHATSAPP_MODE=cloud_api` + `WHATSAPP_*` | `https://<domain>/webhooks/whatsapp` |
| Instagram & Messenger | `META_MODE=graph` + `META_*` | `https://<domain>/webhooks/meta` |
| Telegram | `TELEGRAM_MODE=bot_api` + `TELEGRAM_*` | `https://<domain>/webhooks/telegram` (setWebhook dengan `secret_token`) |
| Email | `EMAIL_MODE=smtp` + `SMTP_*`, `EMAIL_WEBHOOK_TOKEN` | layanan inbound-parse/relay IMAP → `https://<domain>/webhooks/email` |

Kanal dapat diaktifkan/nonaktifkan oleh Admin TI di halaman `/admin`. Bila worker dijalankan terpisah (`AI_INLINE=false`), setel `REALTIME_REDIS=true` di API dan worker.

## Penyedia LLM

Bawaan `mock` (deterministik, tanpa kunci API). Penyedia lain diaktifkan lewat `.env`, lalu urutannya per agen ditetapkan
di parameter **PRM-20** (halaman Parameter; butuh persetujuan Pimpinan + Staf PMB), mis. `{"default": ["ollama", "mock"]}`.

| Penyedia | Variabel `.env` | Lokasi |
|---|---|---|
| Ollama (LLM lokal) | `OLLAMA_MODEL`, `OLLAMA_BASE_URL`; jalankan `docker compose --profile local-llm up -d ollama` | lokal |
| Berkompatibel OpenAI (vLLM, LM Studio, OpenAI, Gemini) | `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_MODEL`, `OPENAI_COMPAT_LOCATION` | lokal/eksternal |
| Anthropic Claude | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (bawaan `claude-opus-5-5`, `ANTHROPIC_EFFORT=low`) | eksternal |

Embedding RAG: `EMBEDDING_PROVIDER=mock|ollama|openai_compatible`. Mengganti model embedding memerlukan pengindeksan ulang dokumen basis pengetahuan.

## Pengujian

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm test:coverage
```

```bash
pnpm e2e
```

`pnpm test` memakai basis data terpisah `halokampus_test` dan `pnpm e2e` memakai `halokampus_e2e`, keduanya dibuat otomatis.
Data pengembangan di basis data `halokampus` tidak tersentuh. E2E menjalankan mock PMB, API, dan web (hasil `next build`)
pada port 4100/4000/3000, jadi hentikan server pengembangan sebelum menjalankannya. Uji E2E sekaligus memperbarui `docs/screenshots/`.

Uji beban & benchmark KPI (hasil ke `docs/`):

```bash
pnpm loadtest -- --rate 5 --duration 60 --customers 300
```

```bash
pnpm bench:kpi -- 5000 --db
```

Bangun ulang `docs/SKENARIO-UJI.md` dari hasil uji sebenarnya:

```bash
pnpm test:report
```

Verifikasi rantai hash audit dan peristiwa:

```bash
pnpm audit:verify
```

## Struktur

```
apps/api        Fastify REST + Socket.IO, pipeline AI, SLA, RBAC, adaptor kanal (web, WhatsApp)
apps/web        Next.js: konsol CP/Staf/Keuangan/Admin, parameter, hak data pribadi, simulator
apps/widget     Widget percakapan (Preact, Shadow DOM, satu tag <script>)
apps/mock-pmb   Mock API sistem PMB (DUMMY)
packages/domain Logika murni: kalender hari kerja, SLA, ambang, perutean, penyamaran
packages/ai     Penyedia LLM/embedding, penyamar PII, pengklasifikasi niat, agen, penjaga kebijakan
packages/db     Skema Prisma & migrasi (pgvector, trigger append-only)
packages/kpi    Mesin KPI murni dari tabel events (docs/KPI.md)
packages/shared Kosakata bersama: peran & izin, kategori, alasan eskalasi, katalog peristiwa
config/         Konfigurasi yang dapat diubah tanpa kode (niat, kewenangan AI, templat, parameter awal, KB DUMMY)
```
