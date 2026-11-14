# Verifikasi Kebutuhan Nonfungsional — haloK@MPUS (Fase 4)

Angka di bawah berasal dari berkas hasil yang dibuat skrip uji (`docs/loadtest-result-*.json`,
`docs/bench-kpi-*.json`) dan dari rangkaian uji otomatis (`docs/SKENARIO-UJI.md`). Semua data uji sintetis/`DUMMY`.
Mesin uji: kontainer pengembangan 16 vCPU, 15 GB RAM; PostgreSQL 16 + pgvector dan Redis di Docker pada mesin yang sama.

## 1. Ringkasan

| NFR | Kebutuhan | Hasil | Status |
|---|---|---|---|
| NFR-01 | Respons AI p95 ≤ PRM-02 (5 detik) pada beban target | Lapisan aplikasi: p95 **60 ms** pada 5 pesan/detik; p95 **86 ms** pada 25 pesan/detik (5× target). Waktu LLM sungguhan **belum diukur** (uji memakai LLM mock). | Lulus untuk lapisan aplikasi; LLM `[PERLU DATA]` |
| NFR-02 | Pembaruan konsol ≤ 2 detik | E2E: balasan CP tampil di widget dan antrean diperbarui dalam batas waktu tunggu Playwright (≤ 15 s; teramati < 2 s). Socket.IO melalui proxy Next.js; polling cadangan 10–15 s. | Lulus (pengamatan) |
| NFR-03 | Beban puncak 5 000 tiket/hari, 15 petugas | Uji beban 5 pesan/detik (2× jam tersibuk) & 25 pesan/detik: 0 galat HTTP, semua pesan dibalas. KPI 1 minggu puncak (35 000 tiket, 273 000 peristiwa): **3,5 s** termasuk memuat dari PostgreSQL. | Lulus; lihat §3 untuk periode panjang |
| NFR-03a | Kapasitas LLM lokal | Belum diukur — butuh server GPU & model Ollama (OP-09). | Terblokir |
| NFR-04 | Degradasi bertahap | Uji: penyedia LLM gagal → antrean manusia (SU-20); jeda AI → tanpa panggilan LLM (KB-10); timer SLA dari basis data + sapuan (KB-04). Redis/worker terpisah: adapter Redis Socket.IO ditulis, belum diuji kegagalan terkontrol. | Sebagian |
| NFR-05 | Keamanan | Matriks RBAC 53 rute × 5 peran teramati sesuai tabel izin (265 permintaan; setiap penolakan tercatat `authz_denied`); 401 tanpa sesi/token di semua rute terlindungi; CSRF; pembatasan laju (login 20/menit, sesi web 30/menit); verifikasi tanda tangan webhook Meta/Telegram/Email; header keamanan; penjaga konfigurasi produksi. | Lulus |
| NFR-06 | Tahan injeksi prompt | 5 serangan + dokumen KB beracun + LLM yang "dibobol" (mock jahat): tidak satu pun janji kelulusan/perubahan data sampai ke pelanggan; semua berakhir di antrean manusia. | Lulus |
| NFR-07 | PDP — tidak ada PII ke LLM/log | Uji kebocoran: nomor telepon, email, NIK, nama tidak muncul di prompt LLM (jawab, ringkasan, draf), log aplikasi, `events`, `audit_logs`; isi pesan di basis data hanya sandi. | Lulus |
| NFR-08 | Auditabilitas | Trigger menolak UPDATE/DELETE; `pnpm audit:verify` memeriksa rantai hash. | Lulus |
| NFR-09/10 | Aksesibilitas & responsif | axe-core (WCAG 2 A/AA, serius/kritis) bersih pada widget, hak data, konsol CP, konsol Staf, dasbor; widget 390 px tanpa gulir horizontal, target sentuh ≥ 44 px. | Lulus (otomatis); uji manual pembaca layar belum |
| NFR-13 | Keterpeliharaan | TypeScript strict di semua paket; cakupan uji baris ≈ 90%. | Lulus |
| NFR-14 | Portabilitas | Image produksi berhasil dibangun dan dijalankan (`docker/node.Dockerfile`): migrasi otomatis, `/health` 200, rute simulator 404 di produksi. | Lulus |
| NFR-15 | Teruji tanpa kunci API | Seluruh rangkaian berjalan dengan penyedia `mock`. | Lulus |
| NFR-16 | Reprodusibilitas KPI | 27 uji KT dengan nilai hitung tangan; peristiwa membawa versi kebijakan. | Lulus |

## 2. Uji beban (`pnpm loadtest`)

Pelanggan web sintetis (sudah memberi persetujuan) mengirim pertanyaan campuran (dijawab AI, skor rendah → CP,
pembayaran → Staf) pada laju tetap. Waktu balasan = pesan pelanggan → pesan balasan pertama (jawaban AI atau
kartu "diteruskan"), dihitung dari tabel `events`.

| Skenario | Pesan | Laju tercapai | Galat HTTP | HTTP p95 | Balasan p50 / p95 / p99 / maks | Pipeline AI p95 |
|---|---|---|---|---|---|---|
| Target (2× jam tersibuk) | 300 | 5/s | 0 | 47 ms | 41 / 60 / 75 / 81 ms | 7 ms |
| Stres (5× target) | 1 500 | 25/s | 0 | 75 ms | 51 / 86 / 208 / 307 ms | 8 ms |

**Interpretasi.** Lapisan aplikasi menyisakan ruang sangat besar terhadap PRM-02 (5 s). Waktu nyata akan
didominasi LLM: dengan penyedia sungguhan, p95 harus diukur ulang (perintah sama, setelah PRM-20 menunjuk
penyedia itu). Bila LLM melewati PRM-02, sistem otomatis mengalihkan ke manusia (FR-20).

## 3. Mesin KPI (`pnpm bench:kpi -- 5000 --db`)

| Pengukuran | Hasil |
|---|---|
| Data | 35 000 tiket (5 000/hari × 7), 273 000 peristiwa |
| Hitung di memori | 0,63–0,73 s (0,41 s dengan saringan kanal), heap ≈ 180 MB |
| Muat dari PostgreSQL + hitung | 2,4 s + 1,1 s = **3,5 s** |

Temuan dan perbaikan selama Fase 4:
- **Kinerja:** versi awal butuh 10–18 s karena formatter tanggal dibuat ulang untuk setiap peristiwa; setelah
  di-cache menjadi < 1 s (≈ 15× lebih cepat).
- **Bug skala:** pemuat KPI awalnya mengirim daftar id tiket sebagai parameter; di atas 32 767 tiket (PostgreSQL)
  kueri akan gagal — tercapai dalam seminggu masa puncak. Diganti subkueri; diuji dengan 35 000 tiket.

Keterbatasan: periode sebulan pada masa puncak diperkirakan ±15 s. Bila dasbor bulanan dibutuhkan saat puncak,
langkah berikutnya adalah tabel ringkasan harian (ADR-16 dapat direvisi tanpa mengubah rumus).

## 4. Keamanan — temuan Fase 4

| Temuan | Tindakan |
|---|---|
| Tiga rute menjawab 500 untuk id tidak dikenal/kosong (aktivasi pengguna, QA review, umpan balik CP) | Penanganan galat Prisma dipusatkan: tidak ditemukan → 404, input tidak valid → 400; dicek oleh matriks RBAC (tidak boleh ada 5xx). |
| Header keamanan belum lengkap | Ditambah `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS saat `COOKIE_SECURE`. |
| Konfigurasi pengembangan bisa terbawa ke produksi | Proses API/worker menolak start bila `NODE_ENV=production` dengan simulator aktif, cookie tidak aman, kunci kosong, atau webhook tanpa rahasia. |
| Klasifikasi berbasis contoh dengan embedding mock dapat memasukkan pertanyaan biasa ke kategori wajib (mis. "jalur prestasi" → jalur khusus) | Aman (condong ke manusia) tetapi menambah beban Staf. Kalibrasi ulang contoh berlabel & PRM-10 saat embedding sungguhan dipasang. |
| Unggah KB PDF kadang menjawab 500: pustaka `pdf-parse` 1.1.1 gagal acak ("bad XRef entry") pada PDF yang valid, bahkan untuk berkas yang sama | Diganti `pdfjs-dist` 4.10.38 (30/30 percobaan berhasil); PDF/DOCX rusak kini dijawab 400 `unreadable_pdf`/`unreadable_docx` dengan uji regresi. |
| Token CSRF disimpan di `sessionStorage` (bukan cookie) | Diterima: cookie sesi `httpOnly` + `SameSite=Strict`; XSS tetap harus dicegah (React meng-escape keluaran). |

## 5. Yang belum diverifikasi

- Waktu respons dengan LLM sungguhan (Anthropic/Ollama/vLLM) dan kapasitas GPU (NFR-01, NFR-03a).
- Uji kegagalan terkontrol Redis/worker terpisah (`AI_INLINE=false`, `REALTIME_REDIS=true`).
- Uji dengan akun kanal resmi (WhatsApp/Meta/Telegram/SMTP).
- Uji pembaca layar manual dan uji usability dengan pengguna (butir SUS resmi).
- Uji penetrasi oleh pihak independen.
