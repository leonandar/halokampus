# Panduan Pengguna — haloK@MPUS

haloK@MPUS adalah layanan tanya-jawab Penerimaan Mahasiswa Baru (PMB) yang dilayani bersama oleh tiga lapis
Contact Personnel: **Asisten AI** (Tingkat 1), **Mahasiswa CP** (Tingkat 2), dan **Staf PMB** (Tingkat 3).
Panduan ini disusun per peran. Tangkapan layar ada di `docs/screenshots/` (nomor gambar disebut dalam kurung).

> Lingkungan pengembangan memakai data bertanda **DUMMY**. Angka dan nama di dalamnya bukan data sungguhan.

---

## 1. Calon mahasiswa (tanpa akun)

**Di mana:** widget percakapan di situs PMB, WhatsApp, Instagram, Messenger, Telegram, email, atau telepon.

1. **Persetujuan.** Pada pesan pertama Anda diminta menyetujui pemrosesan pesan untuk layanan (wajib). Dua
   persetujuan lain bersifat pilihan: *pengingat proaktif* dan *perbaikan layanan* (gambar 01). Di WhatsApp/kanal
   lain, balas **SETUJU** atau tekan tombol *Setuju*; pertanyaan pertama Anda langsung dijawab sesudahnya.
2. **Bertanya.** Tulis pertanyaan seperti biasa. Jawaban Asisten AI selalu menyertakan **Sumber** dari pedoman PMB
   resmi (gambar 02). Tekan ikon jempol untuk menilai *membantu / tidak membantu*.
3. **Bicara dengan manusia.** Tekan tombol *Bicara dengan manusia* atau ketik **MANUSIA** kapan saja. Anda akan
   melihat kartu *Diteruskan ke petugas* beserta perkiraan waktu tanggapan (gambar 04). Riwayat dan ringkasan
   ikut diteruskan, jadi Anda **tidak perlu mengulang** penjelasan. Di luar jam layanan, kartu menyebut waktu buka
   layanan berikutnya; Asisten AI tetap bisa membantu pertanyaan umum.
4. **Cek status pendaftaran.** Tulis *"cek status pendaftaran saya"*, lalu nomor pendaftaran (mis. `PMB-2027-000102`).
   Kode OTP 6 angka dikirim ke email yang terdaftar di sistem PMB; ketik kodenya di percakapan.
5. **Jadwal ulang tes.** Tulis *"saya mau jadwal ulang tes"*. Setelah verifikasi, pilih slot yang ditawarkan.
   Kelayakan ditentukan kebijakan sistem PMB.
6. **Periksa berkas.** Di widget tekan ikon klip; di kanal lain kirim lampiran dan buka tautan aman yang dikirim.
   Berkas hanya diperiksa format & ukurannya, **tidak disimpan**. Unggah resmi tetap melalui portal pendaftaran.
7. **Pindah kanal.** Bila Anda pindah dari web ke WhatsApp (atau sebaliknya), cukup verifikasi nomor pendaftaran
   yang sama dan balas **YA** untuk menggabungkan riwayat. Tiket yang sedang berjalan ikut berpindah.
8. **Survei.** Setelah petugas menyelesaikan pertanyaan Anda, pilih angka pada survei singkat (gambar 15).
9. **Data pribadi.** Tekan *Data pribadi* di widget atau ketik *"data pribadi saya"* untuk tautan pribadi (24 jam):
   lihat & unduh data Anda, ubah persetujuan, atau minta koreksi/penghapusan (gambar 03).

---

## 2. Mahasiswa CP — Konsol Tingkat 2 (`/cp`)

**Kewenangan:** menjawab Tingkat 2 dengan bantuan AI, membimbing, meneruskan ke Staf PMB.
**Tidak dapat:** meng-override atau menjeda AI, mengubah data pendaftar, mengubah parameter. Batas ini selalu
tampil di spanduk kuning dan ditegakkan oleh server (gambar 05).

1. **Masuk** di `/masuk`, lalu set status **Online**. Hanya CP yang online yang bisa mengklaim tiket; status
   *Istirahat/Offline* ikut dicatat untuk pengukuran beban kerja.
2. **Antrean.** Setiap tiket menampilkan kanal, kategori, dan **hitung mundur SLA** (hijau → kuning < 1 menit →
   merah bila terlewat). Bila SLA Tingkat 2 terlewat tanpa tanggapan, tiket otomatis naik ke Staf PMB.
   Pakai pilihan *Semua kanal* untuk menyaring.
3. **Klaim tiket**, lalu baca **Serah-terima**: ringkasan AI, alasan eskalasi, skor keyakinan, dan kanal yang dipakai.
   Linimasa menampilkan semua pesan dari semua kanal. Data pribadi tampil **tersamar**.
4. **Balas.** Tekan *Minta draf AI* untuk draf beserta sumbernya; **periksa dan sunting** sebelum dikirim. Templat
   TP-01…TP-10 dapat disisipkan. Bila pelanggan memakai beberapa kanal, pilih kanal pengiriman.
5. **Selesai atau teruskan.** *Tandai selesai* bila sudah tuntas (survei otomatis dikirim ke pelanggan), atau
   *Eskalasi ke Staf PMB* dengan **alasan wajib**.
6. **Catat panggilan** (`/telepon`): isi nomor, centang persetujuan lisan setelah membacakan pemberitahuan, isi
   pertanyaan & jawaban. Kategori wajib (pembayaran, perubahan data, pengecualian, jalur khusus, keluhan berat)
   otomatis diteruskan ke Staf PMB (gambar 18).
7. **Umpan balik** dari Staf PMB tampil di bawah konsol.

---

## 3. Staf PMB — Konsol Tingkat 3 & Orkestrasi (`/staf`)

**Kewenangan khusus:** satu-satunya peran yang dapat menyupervisi, meng-override, menjeda, dan mengaudit AI.

| Tab | Kegunaan |
|---|---|
| **Antrean Tingkat 3** | Tiket kategori wajib (berlabel merah) dan eskalasi dari CP; SLA dalam hari kerja (gambar 06). *Buka data* menampilkan data pribadi tanpa samaran **dengan alasan** (tercatat di audit). |
| **Kotak masuk terpadu** | Semua tiket manusia (T2 + T3) dari semua kanal, dengan saringan kanal (gambar 19). |
| **Supervisi AI** | Umpan tindakan AI waktu nyata dengan skor keyakinan & komponennya, hasil penjaga kebijakan, penyedia LLM (gambar 07). Tombol **Override** → pilih *Batalkan / Ganti / Koreksi*, **kategori penyebab** dan **alasan** wajib, opsi memberi tahu calon mahasiswa (gambar 08). |
| **Jeda AI** | Jeda per kanal atau semua kanal dengan alasan; AI berhenti total, pesan masuk antrean manusia (gambar 10). |
| **Jejak audit** | Catatan append-only berantai hash; ekspor CSV/JSON (gambar 09). |
| **Basis pengetahuan** | Unggah Markdown, PDF, DOCX, atau TXT → draf → **jalankan uji tanya-jawab** → terbitkan. Versi lama otomatis ditarik (gambar 11). |
| **QA review** | Nilai sampel tiket selesai dengan formulir QA; untuk tiket berisi jawaban AI wajib memutuskan *benar/salah* (gambar 22). |
| **Supervisi CP** | Beban kerja tiap CP, kirim umpan balik kinerja (gambar 23). Dari detail tiket: lepas tiket CP ke antrean, atau kembalikan tiket T3 non-wajib ke CP. |
| **Siklus orkestrasi** | Daftar periksa lima fungsi (merencanakan – mengajari – memantau – mengintervensi – belajar), mingguan/harian sesuai PRM-06/PRM-18; *Tutup siklus* menyimpan nilai KPI periode (gambar 24). |
| **Hak data** | Proses permintaan subjek data; *Jalankan penghapusan* menganonimkan data pribadi (gambar 25). |

Staf PMB juga dapat **mengusulkan/menyetujui parameter** (`/parameter`) dan membuka **Dasbor KPI** (`/dasbor`).

---

## 4. Pimpinan PMB (`/dasbor`)

1. **Dasbor KPI** (gambar 21): saring periode, kanal, kategori, tingkat; centang/lepas *Sertakan data DUMMY*.
   Setiap kartu menampilkan nilai, jumlah data (n), dan status target (*memenuhi / belum memenuhi / target belum
   ditetapkan*). KPI yang membutuhkan parameter yang belum diisi menampilkan *Butuh parameter*.
   Rumus setiap KPI: `docs/KPI.md`.
2. **Laporan & ekspor:** *Laporan PDF / XLSX* untuk periode terpilih; laporan mingguan juga dibuat otomatis tiap
   Senin pagi. *Ekspor penelitian* menghasilkan data teranonimkan (pseudonim, tanpa nama/kontak/isi pesan, tanpa
   DUMMY, hanya pelanggan yang menyetujui *perbaikan layanan*).
3. **Parameter kebijakan** (`/parameter`, gambar 13): ubah ambang AI, SLA, jam kerja, retensi, target KPI, penyedia
   LLM, dsb. Setiap perubahan **butuh dua orang: satu Pimpinan dan satu Staf PMB** (pengusul tidak boleh
   menyetujui sendiri). Parameter berversi; nilai lama tetap tercatat.
4. **Siklus orkestrasi** (`/orkestrasi`): pantau daftar periksa Staf PMB (baca saja).

---

## 5. Unit Keuangan (`/keuangan`)

Hanya membaca tiket **kategori pembayaran** di Tingkat 3. Tidak dapat mengklaim, membalas, atau melihat kategori
lain. Data pribadi tampil tersamar.

---

## 6. Admin TI (`/admin`)

- **Pengguna:** tambah pengguna dan peran, nonaktifkan akun (sesi langsung berakhir).
- **Integrasi kanal:** aktif/nonaktifkan kanal; lihat mode (simulator/live), kelengkapan kredensial, dan apakah
  webhook sudah diamankan (gambar 20). Kredensial disimpan di lingkungan server (`.env`), bukan di basis data.
- Admin TI **tidak dapat** membaca isi percakapan atau data pribadi calon mahasiswa.

---

## 7. Semua petugas

- **2FA (opsional):** aktifkan dari API `/api/auth/2fa/setup` lalu `/api/auth/2fa/enable` (antarmuka menyusul).
  Lima kali salah kata sandi mengunci akun 15 menit.
- **Survei usability** (`/survei-petugas`, gambar 26): isi bila diminta tim peneliti.
- **Keamanan:** jangan mencatat data di luar daftar yang diizinkan (NIK, kata sandi, nomor rekening, dsb.).
