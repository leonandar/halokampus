# Spesifikasi Instalasi — haloK@MPUS

Dokumen ini untuk tim TI yang memasang haloK@MPUS. Isinya: kebutuhan perangkat keras dan lunak, platform
yang didukung, langkah per platform, jaringan, pemeriksaan setelah instalasi, dan penanganan masalah.
Angka yang ditulis **terukur** berasal dari pengukuran di lingkungan uji. Angka **rekomendasi** adalah
titik awal yang diturunkan dari pengukuran itu dan belum diuji pada perangkat sasaran.
Nilai yang belum ada datanya ditulis `[PERLU DATA]`.

---

## 1. Komponen yang dipasang

Semua komponen berjalan sebagai kontainer Docker dari satu berkas `docker-compose.yml`.

| Layanan | Fungsi | Port di host |
|---|---|---|
| `caddy` | Reverse proxy HTTPS, sertifikat otomatis | **80, 443** (satu-satunya yang terbuka ke jaringan) |
| `web` | Konsol petugas, dasbor, widget (Next.js) | 127.0.0.1:3000 |
| `api` | REST + Socket.IO, webhook kanal; menjalankan migrasi basis data saat start | 127.0.0.1:4000 |
| `worker` | Pipeline AI, timer SLA, pengingat, laporan terjadwal | – |
| `postgres` | PostgreSQL 16 + pgvector | 127.0.0.1:5432 |
| `redis` | Antrean BullMQ, Socket.IO lintas proses | 127.0.0.1:6379 |
| `mock-pmb` | Mock API sistem PMB berdata `DUMMY` (selama penelitian) | 127.0.0.1:4100 |
| `mailpit` | Penampung email uji; ganti dengan SMTP kampus di produksi | 127.0.0.1:8025, 1025 |
| `ollama` (opsional) | LLM lokal, profil `local-llm` | 127.0.0.1:11434 |

Port yang terikat ke `127.0.0.1` hanya dapat diakses dari server itu sendiri.

---

## 2. Kebutuhan perangkat keras

### 2.1 Pengukuran

Lingkungan pengukuran: Ubuntu 24.04, Docker Engine 29.9.2, Compose 5.6.1.

| Pengukuran | Hasil |
|---|---|
| Memori seluruh layanan saat diam (8 kontainer, tanpa Ollama) | ≈ 0,7 GB (api 0,19; worker 0,20; web 0,12; mock-pmb 0,10; postgres 0,05; lainnya < 0,02) |
| Memori puncak saat menerima pesan (pembatas laju aktif, satu IP) | ≈ 0,73 GB; CPU puncak api 31%, worker 22% dari satu inti |
| Image aplikasi `halokampus-app` | 3,6 GB; image pendukung ≈ 0,8 GB |
| Basis data baru setelah migrasi + data dasar | 10 MB (volume data PostgreSQL 50 MB); cadangan `pg_dump` terkompresi 0,1 MB |
| Uji beban Fase 4 (LLM mock) | 25 pesan/detik, balasan p95 86 ms (`docs/VERIFIKASI-NFR.md`) |
| KPI satu minggu masa puncak (35 000 tiket) | 3,5 s; heap ≈ 180 MB |

Waktu dan sumber daya LLM sungguhan belum diukur (NFR-01, NFR-03a).

### 2.2 Rekomendasi

| Pemakaian | CPU | RAM | Disk | Dasar |
|---|---|---|---|---|
| Uji coba di laptop/PC | 4 inti | 8 GB (Docker Desktop diberi ≥ 4 GB) | ≥ 15 GB kosong | Image 4,4 GB + cache build; memori terukur 0,7 GB |
| Server produksi **tanpa** LLM lokal (LLM eksternal atau server GPU terpisah) | 4 vCPU | 8 GB | SSD 100 GB | Ruang untuk cache PostgreSQL, build ulang saat pembaruan, dan masa puncak. Pertumbuhan data per hari `[PERLU DATA]`: ukur setelah sebulan dengan perintah di §7. |
| Server LLM lokal (Ollama/vLLM) | `[PERLU DATA]` | `[PERLU DATA]` | `[PERLU DATA]` | Bergantung pada model yang dipilih dan beban puncak; ukur dengan `pnpm loadtest` setelah PRM-20 menunjuk penyedia lokal (OP-09). |

Server LLM lokal sebaiknya dipisah dari server aplikasi. Hubungkan lewat `OLLAMA_BASE_URL` atau
`OPENAI_COMPAT_BASE_URL`.

---

## 3. Kebutuhan perangkat lunak

| Perangkat lunak | Versi | Keterangan |
|---|---|---|
| Docker Engine / Docker Desktop | Compose v2 (`docker compose`, bukan `docker-compose`) | Teruji: Engine 29.9.2, Compose 5.6.1 |
| Git | versi apa pun yang masih didukung | Mengambil kode dari GitHub |
| OpenSSL | bawaan macOS/Linux/Git Bash | Dipakai `scripts/setup-env.sh` untuk membuat kunci |
| Peramban | Safari, Chrome, Edge, Firefox versi terbaru | Konsol & widget |
| Node.js 22 + pnpm 10 | **hanya** untuk pengembangan | Tidak perlu untuk instalasi Docker |

Semua image tersedia untuk **amd64 (Intel/AMD)** dan **arm64 (Apple silicon, server ARM)**: `node:22-bookworm`,
`pgvector/pgvector:pg16`, `redis:7.4-alpine`, `caddy:2.8`, `axllent/mailpit:v1.21`. Modul native di
`pnpm-lock.yaml` (argon2, Next.js SWC, sharp, esbuild, rollup) juga punya versi linux-arm64.

---

## 4. Platform

| Platform | Cara menjalankan | Status uji |
|---|---|---|
| Ubuntu 22.04 / 24.04 Server (amd64) | Docker Engine | **Teruji** (24.04): build, migrasi, HTTPS, mulai ulang penuh, semua perintah §7–§8 |
| Debian 12 | Docker Engine | Belum diuji; langkah sama dengan Ubuntu |
| RHEL / Rocky / AlmaLinux 9 | Docker Engine (repo docker-ce) | Belum diuji; perhatikan SELinux (§5.4) |
| macOS 13+ Apple silicon (M1–M4) | Docker Desktop | Belum diuji; image dibangun native arm64 |
| macOS 13+ Intel | Docker Desktop | Belum diuji |
| Windows 10 22H2 / Windows 11 | Docker Desktop + WSL 2 (Ubuntu) | Belum diuji; jalankan perintah **di dalam WSL** |
| Server ARM64 Linux | Docker Engine | Belum diuji |

---

## 5. Langkah instalasi

Langkah inti (§5.5) sama untuk semua platform. Bagian ini hanya menjelaskan persiapan yang berbeda.

### 5.1 macOS

1. Unduh Docker Desktop di <https://www.docker.com/products/docker-desktop/> sesuai chip (Apple silicon/Intel),
   seret ke Applications, buka, dan tunggu sampai muncul *Engine running*.
2. *Settings → Resources*: memori minimal 4 GB.
3. Buka Terminal; bila `git` belum ada, macOS menawarkan *Command Line Tools*, pilih *Install*.
4. Lanjut ke §5.5 dengan domain `localhost`.

### 5.2 Windows 10/11

1. PowerShell **sebagai Administrator**:

```powershell
wsl --install -d Ubuntu
```

2. Mulai ulang komputer, buka *Ubuntu*, lalu buat nama pengguna Linux.
3. Pasang Docker Desktop, lalu centang *Settings → General → Use the WSL 2 based engine* dan
   *Settings → Resources → WSL integration → Ubuntu*.
4. Jalankan **semua perintah §5.5 di terminal Ubuntu**, dan simpan kode di folder rumah WSL (`~/halokampus`),
   bukan di `C:\` (`/mnt/c/...`). Cara ini lebih cepat dan menjaga akhir baris berkas tetap LF.
5. Bila port 80/443 sudah dipakai (IIS, Skype, dsb.), hentikan layanan itu dulu.
6. Buka `https://localhost/masuk` di peramban Windows.

### 5.3 Ubuntu / Debian

```bash
curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
```

```bash
sudo usermod -aG docker $USER && newgrp docker
```

Untuk server produksi, Anda juga bisa memasang lewat repositori apt resmi Docker
(<https://docs.docker.com/engine/install/ubuntu/>). Buka port 80 dan 443 di firewall:

```bash
sudo ufw allow 80,443/tcp
```

### 5.4 RHEL / Rocky / AlmaLinux 9

```bash
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
```

```bash
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin git && sudo systemctl enable --now docker
```

```bash
sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload
```

Bila SELinux *enforcing* dan Caddy tidak dapat membaca `Caddyfile`, ubah baris volume Caddy di
`docker-compose.yml` dari `:ro` menjadi `:ro,Z` (belum diuji).

### 5.5 Langkah inti (semua platform)

1. Ambil kode:

```bash
git clone -b feat/halokampus https://github.com/leonandar/halokampus ~/halokampus
```

```bash
cd ~/halokampus
```

   Di server, folder `/opt/halokampus` lebih lazim.

2. Buat `.env` produksi. Ganti `localhost` dengan domain server, misalnya `halokampus.uny.ac.id`:

```bash
scripts/setup-env.sh localhost
```

   Skrip membuat tiga kunci kriptografi, kata sandi basis data, dan pengaturan aman (HTTPS, simulator mati,
   worker terpisah). Skrip menolak menimpa `.env` yang sudah ada. **Simpan salinan `.env`**: tanpa
   `DATA_ENCRYPTION_KEY`, data terenkripsi tidak bisa dibaca.

3. Bangun dan jalankan. Build pertama memakan waktu sekitar 5–10 menit; migrasi berjalan otomatis:

```bash
docker compose --profile app up -d --build
```

4. Siapkan data dasar (20 parameter kebijakan, tanpa data `DUMMY`):

```bash
docker compose exec api pnpm --filter @hk/api seed:production
```

5. Buat Admin pertama. Beri **spasi setelah `--`** dan pakai kata sandi minimal 12 karakter dalam tanda kutip tunggal:

```bash
docker compose exec api pnpm --filter @hk/api create-admin -- admin@kampus.ac.id "Nama Admin" 'KataSandiMinimal12!'
```

6. Buka `https://<domain>/masuk`. Pada `localhost`, peramban memperingatkan soal sertifikat lokal Caddy;
   pilih lanjutkan (Safari: *Show Details → visit this website*).
7. Lanjutkan konfigurasi layanan seperti README langkah 6–9: akun petugas, kanal, parameter, basis
   pengetahuan, dan widget.

### 5.6 Server dengan domain kampus

- Arahkan DNS domain ke IP server. Caddy mengambil sertifikat Let's Encrypt otomatis **bila** port 80/443 dapat
  dijangkau dari internet.
- Untuk server intranet (tidak terjangkau internet), pakai sertifikat kampus. Di `docker/Caddyfile`, tambahkan
  `tls /etc/caddy/cert.pem /etc/caddy/key.pem` di dalam blok situs, lalu mount kedua berkas itu ke layanan `caddy`.
- Isi `SMTP_*` dengan server email kampus. Layanan `mailpit` boleh dibiarkan, tetapi tidak lagi dipakai.
- Webhook kanal (WhatsApp/Meta/Telegram/email) memerlukan domain yang dapat dijangkau penyedia dari internet.

---

## 6. Jaringan

| Arah | Tujuan | Keperluan |
|---|---|---|
| Masuk | TCP 80, 443 | Pengguna, petugas, webhook kanal |
| Keluar (saat build) | `registry-1.docker.io`, `registry.npmjs.org`, `binaries.prisma.sh`, `github.com` | Image, paket, mesin Prisma, kode |
| Keluar (saat berjalan, sesuai fitur) | `api.anthropic.com` / penyedia OpenAI-compatible; `graph.facebook.com`; `api.telegram.org`; server SMTP kampus; ACME Let's Encrypt | LLM eksternal, kanal, email, sertifikat |
| Internal | Server LLM lokal (11434 Ollama / port vLLM) | Bila LLM lokal di server terpisah |

---

## 7. Pemeriksaan setelah instalasi

```bash
docker compose ps
```

Semua layanan harus berstatus `Up`, dengan `postgres` dan `mailpit` berstatus `healthy`.

```bash
docker compose exec api node -e 'fetch("http://localhost:4000/health").then(r=>r.text()).then(console.log)'
```

Hasil yang diharapkan: `{"ok":true,"product":"haloK@MPUS"}`.

```bash
docker compose exec api pnpm --filter @hk/api audit:verify
```

Hasil yang diharapkan: `rantai utuh` untuk `audit_logs` dan `events`.

```bash
curl -skI https://localhost/masuk
```

Hasil yang diharapkan: `200`, dengan header `strict-transport-security`.

Ukuran basis data, untuk memperkirakan kebutuhan disk:

```bash
docker compose exec postgres psql -U halokampus -c "select pg_size_pretty(pg_database_size('halokampus'))"
```

---

## 8. Cadangan, pembaruan, dan mulai ulang

- **Cadangan harian:**

```bash
docker compose exec -T postgres pg_dump -U halokampus halokampus | gzip > halokampus-$(date +%F).sql.gz
```

  Simpan bersama salinan `.env` di tempat terpisah.
- **Pembaruan:**

```bash
git pull && docker compose --profile app up -d --build
```

- **Reboot server:** layanan kembali otomatis (`restart: unless-stopped`), dan API menunggu PostgreSQL siap sebelum
  migrasi. Di Linux, pastikan Docker aktif saat boot (`sudo systemctl enable docker`).

---

## 9. Masalah umum

| Gejala | Penyebab | Solusi |
|---|---|---|
| `create-admin` gagal, `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` | Tidak ada spasi setelah `--`, atau kata sandi < 12 karakter | Lihat baris `✗ …` di atas galat; ulangi dengan format §5.5 langkah 5 |
| API langsung berhenti, log menyebut `ENABLE_SIMULATORS`/`COOKIE_SECURE`/kunci | Penjaga konfigurasi produksi menolak `.env` yang tidak aman | Buat `.env` dengan `scripts/setup-env.sh`, atau perbaiki butir yang disebut di log |
| `bind: address already in use` pada 80/443/5432 | Port dipakai layanan lain (IIS, Apache, PostgreSQL lokal) | Hentikan layanan itu, atau ubah port host di `docker-compose.yml` |
| Setelah login, kembali lagi ke halaman masuk | Diakses lewat `http://` sedangkan cookie mewajibkan HTTPS | Buka lewat `https://` |
| Peringatan sertifikat di `https://localhost` | Sertifikat lokal Caddy | Normal untuk uji coba; di server pakai domain resmi |
| Build gagal kehabisan memori | Docker Desktop diberi < 4 GB | *Settings → Resources*, naikkan memori |
| `scripts/setup-env.sh: bad interpreter` di Windows | Kode di-clone di Windows sehingga akhir baris berubah CRLF | Clone ulang **di dalam WSL** (§5.2) |
| Semua pertanyaan diteruskan ke petugas | Basis pengetahuan masih kosong | Staf PMB mengunggah pedoman resmi (Konsol Staf → Basis pengetahuan) |
