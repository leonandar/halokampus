# PROMPT CLAUDE CODE — Aplikasi haloK@MPUS
## Sistem Layanan Helpdesk PMB Omnichannel dengan Contact Personnel Tiga Lapis

> Cara pakai: buka Claude Code di folder proyek kosong, lalu tempel seluruh isi berkas ini
> sebagai pesan pertama. Simpan juga berkas ini di akar repositori sebagai `docs/PROMPT.md`.
> Bagian bertanda `[ISI]` diisi peneliti sebelum dikirim, atau biarkan Claude Code memakai nilai bawaan.

---

<peran>
Anda adalah tim rekayasa perangkat lunak senior (arsitek sistem, pengembang full-stack,
insinyur AI/LLM, dan penguji) yang membangun aplikasi **haloK@MPUS**: lapisan orkestrasi
layanan helpdesk Penerimaan Mahasiswa Baru (PMB) perguruan tinggi yang bersifat omnichannel.
Aplikasi ini adalah produk penelitian disertasi R&D (Ramaswamy, 1996), sehingga setiap
fitur harus dapat ditelusuri ke komponen model, setiap tindakan harus tercatat, dan
setiap angka kinerja harus berasal dari log sistem, bukan diasumsikan.
</peran>

<konteks_model>
Aplikasi mengimplementasikan pengembangan **Service Encounter Triad** (Fitzsimmons,
Fitzsimmons, & Bordoloi, 2023): Organisasi – Contact Personnel – Pelanggan. Pengembangan
difokuskan pada sudut **Contact Personnel** yang dibelah menjadi **tiga lapis**:

| Lapis | Aktor | Peran dalam model | Kewenangan inti |
|---|---|---|---|
| 1 | **Agentic AI** | Autonomous Executor | Melayani langsung calon mahasiswa dalam batas kewenangan; bertindak proaktif; menjelaskan dasar jawaban/tindakan; mengalihkan bila di luar batas |
| 2 | **Mahasiswa CP** (mahasiswa PMB) | Augmented Operator | Menangani eskalasi Tingkat 2 dengan bantuan AI (draf jawaban, ringkasan); membimbing sebaya; meneruskan ke staf. **TIDAK** dapat override AI, mengubah data pendaftar, atau mengubah parameter |
| 3 | **Staf PMB** | Human Frontline & Operational Orchestrator | Menangani Tingkat 3; **satu-satunya** lapis yang dapat menyupervisi, meng-override, menjeda, dan mengaudit AI; mengelola basis pengetahuan AI; menjalankan siklus orkestrasi |

Aktor lain:
- **Calon mahasiswa** (pelanggan): tanpa akun; diidentifikasi lewat kanal + verifikasi OTP / nomor pendaftaran.
- **Pimpinan PMB** (Organisasi = Orkestrator Strategis): menetapkan kebijakan dan parameter (ambang keyakinan AI, SLA, jam kerja), melihat dasbor KPI. Tidak menangani tiket.
- **Unit keuangan**: akses baca terbatas pada tiket kategori pembayaran.
- **Admin TI**: kelola pengguna, integrasi kanal, kunci API. Tidak membaca isi percakapan.

Lensa desain **3F** wajib tercermin di antarmuka:
- *Filtering* → informasi yang ditampilkan relevan dengan prodi/jalur/tahap pendaftar, tidak berlebih.
- *Fragmentation* → pengalaman tidak terpecah antarkanal; riwayat dan progres ikut berpindah kanal.
- *Frugality* → usaha pelanggan minimal; tidak pernah mengulang informasi yang sudah diberikan.

Posisi sistem (keputusan mengikat): haloK@MPUS **bukan sistem pendaftaran baru**. Ia
berada **di atas** sistem informasi PMB yang sudah berjalan dan hanya membaca/menulis ke
sistem itu melalui adaptor integrasi. Pada MVP, sistem PMB diganti **mock API**.
</konteks_model>

<parameter_layanan>
Semua nilai berikut adalah **parameter yang dapat diubah Pimpinan** lewat antarmuka
(tabel `policy_parameters`, berversi, setiap perubahan tercatat di audit). Jangan
menulisnya sebagai konstanta di kode. Nilai bawaan berstatus usulan penelitian:

| Kode | Parameter | Nilai bawaan |
|---|---|---|
| PRM-01 | Ambang keyakinan AI (di bawah ini → eskalasi Tingkat 2) | 0,75 |
| PRM-02 | SLA respons Tingkat 1 (AI) | ≤ 5 detik |
| PRM-03 | SLA tanggapan Tingkat 2 (Mahasiswa CP) | ≤ 3 menit |
| PRM-04 | SLA penyelesaian Tingkat 3 (Staf PMB) | ≤ 1 hari kerja |
| PRM-05 | SLA kategori pembayaran | ≤ 2 hari kerja |
| PRM-06 | Siklus orkestrasi Staf PMB | mingguan (harian pada masa puncak) |
| PRM-07 | Jam kerja & kalender libur (untuk menghitung "hari kerja") | [ISI: mis. Senin–Jumat 08.00–16.00 WIB] |
| PRM-08 | Masa retensi data percakapan | [ISI: keputusan institusi] |
</parameter_layanan>

<aturan_perutean>
1. **Kewenangan AI tiga kelas** (disimpan sebagai konfigurasi, bukan kode keras):
   - *Boleh mandiri*: menjawab informasi PMB dari basis pengetahuan resmi; status pendaftaran (baca); pengingat tenggat proaktif; validasi kelengkapan berkas (format, ukuran, jenis); penjadwalan ulang yang diizinkan kebijakan.
   - *Wajib dialihkan*: keyakinan < PRM-01; topik di luar basis pengetahuan; pelanggan meminta manusia; dua kali umpan balik negatif berturut-turut.
   - *Dilarang*: mengubah data pendaftar; memutuskan kelulusan/pengecualian; menjanjikan hal di luar pedoman; meminta data pribadi di luar yang diperlukan.
2. **Lima kategori wajib langsung ke Staf PMB (Tingkat 3)**, melewati Tingkat 2:
   pembayaran (gagal/ganda/salah jalur), perubahan data, permintaan pengecualian,
   jalur/kelompok khusus, keluhan berat/emosi tinggi.
3. **Skor keyakinan AI** dihitung sebagai skor komposit yang dapat dijelaskan (mis. skor
   kemiripan retrieval + klasifikasi niat + penilaian diri model), disimpan per jawaban
   beserta komponennya. Jangan mengandalkan penilaian diri LLM saja.
4. **Serah-terima tanpa mengulang**: setiap eskalasi membawa ringkasan AI, kategori,
   alasan eskalasi, skor keyakinan, dan seluruh riwayat lintas kanal.
5. **Pelanggaran SLA**: bila SLA Tingkat 2 lewat tanpa tanggapan, tiket otomatis naik ke
   Staf PMB dan peristiwa dicatat sebagai `sla_breach`.
6. Calon mahasiswa **selalu** dapat menekan "Bicara dengan manusia" di semua kanal.
</aturan_perutean>

<fitur>

### A. Contact Personnel tiga lapis

**A1. Lapis Agentic AI (Autonomous Executor)**
- Agen penjawab berbasis RAG atas basis pengetahuan resmi PMB (pedoman, jadwal, biaya, persyaratan per jalur/prodi); setiap jawaban menyertakan rujukan sumber.
- Arsitektur multi-agen: (1) agen klasifikasi niat & kategori, (2) agen penjawab RAG, (3) agen tindakan (pengingat, validasi berkas, cek status lewat adaptor PMB), (4) agen penjaga kebijakan yang memeriksa kelas kewenangan sebelum jawaban/tindakan dikirim, (5) agen peringkas untuk serah-terima.
- Tindakan proaktif: pengingat tenggat dan kekurangan berkas, hanya bila calon mahasiswa memberi persetujuan, selalu disertai "mengapa saya menerima ini".
- Personalisasi berdasarkan prodi, jalur, dan tahap pendaftaran (Filtering).
- Umpan balik membantu / tidak membantu per jawaban (ikon SVG, bukan emoji).
- Penyedia LLM dibuat dapat ditukar lewat antarmuka `LLMProvider`; bawaan Anthropic Claude API, dengan mode **mock** deterministik agar seluruh sistem dapat diuji tanpa kunci API.

**A2. Lapis Mahasiswa CP (Augmented Operator) — Konsol Tingkat 2**
- Antrean tiket dengan hitung mundur SLA; klaim tiket; status kehadiran (online/istirahat/offline).
- Panel serah-terima: ringkasan AI, alasan eskalasi, skor keyakinan, riwayat lintas kanal.
- Draf jawaban dari AI yang dapat disunting sebelum dikirim; templat pesan TP-01…TP-10 [ISI dari Buku Panduan].
- Tombol: kirim, tandai selesai, eskalasi ke Staf PMB (wajib alasan).
- Data pribadi calon mahasiswa ditampilkan **tersamar** (mis. nomor telepon sebagian) kecuali yang diperlukan.
- Penanda batas kewenangan yang selalu terlihat. Tidak ada tombol override di konsol ini.

**A3. Lapis Staf PMB (Human Frontline & Operational Orchestrator) — Konsol Tingkat 3**
- Antrean Tingkat 3 dan lima kategori wajib, dengan label kategori.
- **Supervisi AI langsung**: umpan tindakan AI waktu nyata beserta skor keyakinan.
- **Override**: batalkan / ganti / koreksi jawaban atau tindakan AI; alasan dan kategori penyebab wajib; opsi memberi tahu calon mahasiswa.
- **Jeda AI** per kanal atau semua kanal (AI berhenti menjawab, semua pesan masuk ke antrean manusia).
- **Jejak audit** per tiket dan global, tidak dapat diubah (append-only), dapat diekspor.
- **Manajemen basis pengetahuan AI**: unggah/ubah dokumen, versi, tanggal berlaku, uji tanya-jawab sebelum terbit.
- **Supervisi Mahasiswa CP**: memantau beban kerja, mengembalikan tiket, memberi umpan balik kinerja.
- **Modul siklus orkestrasi** lima fungsi (merencanakan – mengajari – memantau – mengintervensi – belajar) dengan daftar periksa per siklus sesuai PRM-06.

**A4. Organisasi (Pimpinan)**
- Pengaturan parameter PRM dengan riwayat versi dan persetujuan.
- Dasbor KPI (lihat B) dan laporan berkala.

### B. KPI standar layanan call center / contact center

Bangun modul KPI yang **semuanya dihitung dari tabel peristiwa (`events`)**, dengan
definisi rumus tersimpan di `docs/KPI.md` dan kode yang teruji. Minimal:

| Kelompok | KPI | Definisi ringkas |
|---|---|---|
| Kecepatan | First Response Time (FRT) | waktu dari pesan pertama pelanggan ke tanggapan pertama (AI atau manusia) |
| | Average Speed of Answer (ASA) | rerata waktu tunggu sampai manusia menanggapi tiket yang dieskalasi |
| | Service Level (SL) | % tiket yang ditanggapi dalam SLA per tingkat (PRM-02/03/04/05) |
| | Average Handle Time (AHT) | rerata waktu penanganan aktif per tiket per lapis |
| | Average Resolution Time | rerata waktu dari tiket dibuka sampai selesai |
| Efektivitas | First Contact Resolution (FCR) | % tiket selesai pada kontak pertama tanpa dibuka ulang dalam N hari |
| | AI Containment Rate | % percakapan selesai oleh AI tanpa eskalasi |
| | Escalation Rate per tingkat | % ke Tingkat 2, % ke Tingkat 3, % langsung via lima kategori wajib |
| | Reopen Rate | % tiket yang dibuka ulang |
| | Transfer / Handoff Rate | rerata jumlah perpindahan penangan per tiket |
| | Abandonment Rate | % percakapan ditinggalkan pelanggan sebelum ditanggapi manusia |
| Kualitas & pengalaman | CSAT | skor kepuasan pascalayanan (skala dapat dikonfigurasi) |
| | Customer Effort Score (CES) | skor usaha pascalayanan (Frugality) |
| | NPS (opsional) | dapat dinonaktifkan |
| | Quality Assurance score | skor penilaian sampel percakapan oleh Staf PMB (formulir QA dapat dikonfigurasi) |
| Tata kelola AI | Override Rate & penyebab | jumlah/% tindakan AI yang di-override, per kategori penyebab |
| | Akurasi AI terverifikasi | % jawaban AI yang dinilai benar pada audit sampel |
| | Distribusi skor keyakinan | histogram; proporsi di bawah PRM-01 |
| Beban kerja | Backlog & usia tiket | jumlah tiket terbuka per tingkat dan umurnya |
| | Occupancy / utilisasi CP & staf | waktu menangani ÷ waktu online |
| | Volume per kanal, jam, kategori | untuk perencanaan kapasitas puncak |
| UU PDP | Permintaan hak data | jumlah & waktu penyelesaian permintaan akses/koreksi/hapus |

Ketentuan:
- Setiap KPI dapat disaring menurut periode, kanal, kategori, lapis, dan petugas.
- Target KPI adalah parameter, bukan angka tertanam. Bila target belum ditetapkan, tampilkan "target belum ditetapkan".
- Sediakan pemetaan opsional ke kode KPI-01…KPI-22 Buku Model haloK@MPUS lewat berkas `config/kpi-map.yaml` [ISI bila Buku Model tersedia].
- Ekspor CSV/XLSX **teranonimkan** untuk analisis penelitian (tanpa nama, nomor telepon, atau isi pesan; ID diganti pseudonim stabil).

### C. Omnichannel — semua fitur layanan tersedia di semua kanal
- Kanal: **Web chat widget**, **WhatsApp** (WhatsApp Business Cloud API), **Instagram DM** dan **Facebook Messenger** (Meta Graph API), **Email**, **Telegram**, serta **pencatatan telepon/call center** (formulir pencatatan panggilan oleh petugas; adaptor VoIP opsional).
- Setiap kanal diimplementasikan sebagai adaptor dengan antarmuka yang sama (`ChannelAdapter`: terima pesan, kirim pesan, kirim lampiran, status terkirim/dibaca) sehingga AI, eskalasi, SLA, survei, dan audit bekerja identik di semua kanal.
- **Identitas pelanggan terpadu**: satu profil calon mahasiswa menggabungkan beberapa kanal setelah verifikasi (OTP atau nomor pendaftaran), dengan persetujuan.
- **Kontinuitas percakapan lintas kanal**: riwayat, progres, dan tiket aktif ikut berpindah kanal; petugas melihat satu linimasa terpadu.
- **Kotak masuk terpadu** untuk Mahasiswa CP dan Staf PMB, apa pun kanalnya.
- Fitur yang wajib tersedia di setiap kanal: tanya-jawab AI, cek status pendaftaran, pengingat proaktif, unggah/validasi berkas (bila kanal mendukung lampiran), "Bicara dengan manusia", survei CSAT/CES, dan akses hak data pribadi.
- Pada MVP, setiap kanal eksternal memiliki **simulator** (halaman uji yang meniru WhatsApp/Instagram/Email) agar alur dapat diuji tanpa akun bisnis resmi.
</fitur>

<pelindungan_data_UU_PDP>
Patuhi UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi:
- **Persetujuan** dicatat per tujuan (layanan wajib; pengingat proaktif opsional; perbaikan layanan opsional) dan dapat ditarik kapan saja.
- **Minimisasi data**: hanya simpan data yang diperlukan; AI tidak boleh meminta data di luar daftar yang diizinkan.
- **Hak subjek data**: lihat, unduh salinan, koreksi, dan tarik persetujuan/hapus; diproses lewat tiket khusus dengan SLA.
- **Retensi**: penghapusan/anonimisasi otomatis setelah PRM-08 (job terjadwal yang teruji).
- **Keamanan**: enkripsi saat transit (TLS) dan saat disimpan untuk kolom sensitif; kontrol akses berbasis peran (RBAC) di sisi server; penyamaran data untuk Mahasiswa CP; audit setiap akses ke data pribadi.
- Data yang dikirim ke penyedia LLM diminimalkan dan disamarkan bila memungkinkan; dokumentasikan alirannya di `docs/PDP.md`.
</pelindungan_data_UU_PDP>

<arsitektur_dan_teknologi>
Gunakan tumpukan berikut kecuali ada alasan kuat (jelaskan bila mengubah):
- **Monorepo TypeScript** (pnpm workspaces).
- **Backend**: Node.js + NestJS (atau Fastify) dengan REST + WebSocket untuk waktu nyata.
- **Frontend**: Next.js (App Router) + Tailwind; konsol responsif hingga lebar ponsel; widget web sebagai bundle tertanam terpisah.
- **Basis data**: PostgreSQL + Prisma; **pgvector** untuk RAG.
- **Antrean & timer SLA**: Redis + BullMQ.
- **LLM**: antarmuka `LLMProvider` (Anthropic Claude API bawaan; mode mock).
- **Autentikasi petugas**: email + kata sandi + 2FA opsional; peran: `cp`, `staff`, `leader`, `finance`, `admin`.
- **Kontainer**: Docker Compose untuk semua layanan; berkas `.env.example` lengkap.
- **Pengujian**: Vitest/Jest (unit), Supertest (API), Playwright (E2E).

Entitas basis data minimal: `customers`, `customer_identities` (per kanal), `consents`,
`conversations`, `messages`, `tickets`, `ticket_assignments`, `escalations`,
`ai_actions` (dengan skor keyakinan & komponennya), `overrides`, `audit_logs` (append-only),
`events` (sumber semua KPI), `kb_documents`, `kb_chunks`, `policy_parameters` (berversi),
`ai_authority_rules`, `sla_policies`, `surveys`, `survey_responses`, `qa_reviews`,
`orchestration_cycles`, `data_subject_requests`, `users`, `roles`, `channels`.
Sertakan diagram ER (Mermaid) di `docs/ARSITEKTUR.md`.
</arsitektur_dan_teknologi>

<acuan_antarmuka>
Rancangan antarmuka mengikuti wireframe haloK@MPUS v0.1 yang sudah disetujui konsepnya:
1. Widget percakapan calon mahasiswa (ponsel): jawaban AI + sumber, pengingat proaktif + alasan, kartu "diteruskan ke Mahasiswa CP" dengan janji waktu, tombol "Bicara dengan manusia", tautan data pribadi.
2. Konsol Mahasiswa CP: antrean + hitung mundur SLA, ringkasan serah-terima, riwayat lintas kanal, draf AI yang dapat disunting, penanda batas kewenangan.
3. Konsol Staf PMB: supervisi AI langsung, formulir override beralasan wajib, jeda AI, jejak audit.
4. Dasbor KPI pimpinan: kartu KPI, corong eskalasi tiga tingkat, kepatuhan SLA per kanal, tren waktu, panel tata kelola AI.
5. Layar persetujuan & hak data pribadi.
Bahasa antarmuka: Bahasa Indonesia. Aksesibilitas: target sentuh ≥ 44 px, kontras teks ≥ 4,5:1, elemen interaktif memakai `<button>`/`<a>`/`<input>` asli.
</acuan_antarmuka>

<cara_kerja>
Kerjakan **bertahap**. Di akhir setiap fase, berhenti, laporkan hasil, dan tunggu
persetujuan saya sebelum lanjut.

**Fase 0 — Rencana (jangan menulis kode aplikasi dulu)**
1. Ajukan paling banyak 5 pertanyaan klarifikasi yang benar-benar menentukan desain.
2. Tulis `docs/SRS.md`: aktor, kebutuhan fungsional (kode FR-xx), kebutuhan nonfungsional (NFR-xx: kinerja ≤ 5 detik untuk AI, ketersediaan, keamanan, PDP, aksesibilitas), dan **tabel keterlacakan Komponen Model → Fitur → FR → Uji** (kolom: lapis triad, lensa 3F, konstruk instrumen bila relevan seperti OMNI, AAUT, ARQ, AEXP, HAI, HMC, EMP, AIGV, TRUST, PEVAL).
3. Tulis `docs/ARSITEKTUR.md` dan rencana fase dalam bentuk daftar tugas.

**Fase 1 — MVP**
Web widget + simulator WhatsApp; klasifikasi niat; RAG atas basis pengetahuan contoh;
skor keyakinan & ambang PRM-01; eskalasi tiga tingkat + lima kategori wajib; timer SLA;
konsol Mahasiswa CP dan Staf PMB; override, jeda AI, jejak audit; persetujuan PDP; mock
API sistem PMB; data contoh **bertanda jelas `DUMMY`**.

**Fase 2 — Omnichannel penuh**
Adaptor WhatsApp, Instagram, Messenger, Email, Telegram, pencatatan telepon; identitas
terpadu; kontinuitas lintas kanal; kotak masuk terpadu; survei CSAT/CES di semua kanal.

**Fase 3 — KPI & tata kelola**
Modul KPI lengkap dari tabel `events`; dasbor pimpinan; laporan berkala; ekspor
teranonimkan; pengaturan parameter berversi; modul siklus orkestrasi; QA review.

**Fase 4 — Pengerasan & dokumentasi**
Uji keamanan dasar (RBAC, injeksi prompt, kebocoran data pribadi ke LLM), uji beban
sederhana untuk masa puncak PMB, `README.md` instalasi langkah demi langkah (lokal dan
server), `docs/PANDUAN-PENGGUNA.md` per peran, dan `docs/SKENARIO-UJI.md`.
</cara_kerja>

<pengujian>
- **Uji fungsional (black-box)**: satu skenario per FR, termasuk kasus batas: keyakinan tepat 0,75; SLA tepat habis; pelanggan berpindah kanal di tengah eskalasi; Mahasiswa CP mencoba override (harus ditolak server); AI menerima pertanyaan kategori wajib.
- **Uji E2E** Playwright untuk alur utama: tanya → AI jawab; tanya → eskalasi CP → selesai; kategori pembayaran → langsung Staf; override → tercatat di audit → KPI berubah.
- **Uji KPI**: data peristiwa sintetis dengan hasil yang dihitung tangan, untuk memastikan setiap rumus KPI benar.
- **Usability**: sediakan modul survei yang item-nya dimuat dari berkas konfigurasi (mis. `config/surveys/sus.yaml`), **jangan menulis butir instrumen sendiri**; butir resmi disediakan tim instrumen penelitian.
- Laporkan cakupan uji dan semua uji yang gagal apa adanya.
</pengujian>

<batasan>
- Jangan mengarang data, angka hasil, target KPI, atau rujukan ilmiah. Bila tidak ada, tulis `[PERLU DATA]` dan jadikan parameter.
- Data contoh hanya untuk pengembangan, diberi tanda `DUMMY`, dan tidak boleh muncul di ekspor penelitian kecuali diminta eksplisit.
- Jangan menambah fitur pendaftaran mahasiswa baru (formulir pendaftaran, seleksi, pembayaran): itu milik sistem PMB yang sudah ada.
- Otoritas override, jeda, dan audit AI **hanya** pada peran `staff`; ditegakkan di server, bukan hanya disembunyikan di UI.
- Nama produk ditulis persis **haloK@MPUS**.
- Komentar kode dan nama variabel dalam bahasa Inggris; teks antarmuka dan dokumentasi pengguna dalam Bahasa Indonesia.
- Tanyakan bila ada instruksi yang bertentangan; jangan menebak untuk keputusan yang sulit dibatalkan.
</batasan>

<keluaran_akhir_setiap_fase>
Akhiri setiap fase dengan ringkasan:
1. Yang selesai (dengan kode FR yang terpenuhi).
2. Cara menjalankan dan menguji (perintah persis).
3. Hasil uji (lulus/gagal, cakupan).
4. Tangkapan layar setiap layar baru (simpan di `docs/screenshots/`) untuk lampiran disertasi.
5. Keputusan teknis yang Anda ambil dan alasannya.
6. Hal yang terblokir dan apa yang dibutuhkan dari saya.
</keluaran_akhir_setiap_fase>

Mulailah dari **Fase 0**.
