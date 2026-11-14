# Definisi KPI — haloK@MPUS

Semua KPI dihitung oleh `packages/kpi` (fungsi murni) **hanya dari tabel `events`** (FR-59/60). Tidak ada
angka yang diasumsikan atau ditanam. Setiap rumus di bawah ini diuji dengan data sintetis yang hasilnya dihitung
tangan (`packages/kpi/test/kpi.test.ts`, kode uji **KT-xx**).

## 1. Aturan umum

| Aturan | Isi |
|---|---|
| Periode | `[from, to)` dalam UTC; dasbor memakai hari kalender WIB (`from` 00.00 WIB s.d. `to` 24.00 WIB). Periode yang belum berakhir diukur sampai "sekarang". |
| Populasi tiket | KPI berbasis tiket memakai tiket yang **dibuka** (`ticket_opened`) dalam periode. Peristiwa sesudah periode tetap dipakai untuk tiket tersebut (mis. penyelesaian esok hari). |
| KPI berbasis peristiwa | SL, CSAT/CES/NPS, QA, override, distribusi keyakinan, volume, DSR memakai peristiwa yang **terjadi** dalam periode. |
| Saringan | kanal (kanal saat tiket dibuka / kanal peristiwa), kategori (kategori akhir tiket), tingkat (SL, AHT, ASA), petugas (AHT, ASA, occupancy, QA). |
| Data DUMMY | Dasbor dapat menyertakan atau mengecualikan (`includeDummy`); laporan menandainya. Ekspor penelitian mengecualikan secara bawaan. |
| Target | Dari PRM-14 (`{"frt": 60, …}` per id KPI). Kosong → "target belum ditetapkan". Arah lebih baik (`better`) tercantum per KPI. |
| Parameter belum ada | KPI yang membutuhkan PRM-11/PRM-12 berstatus `needs_param` dan **tidak** menampilkan angka. |
| Versi kebijakan | Setiap peristiwa SLA membawa `policyVersions`, sehingga SL dihitung terhadap SLA yang berlaku saat itu. |
| Pembulatan | 2 desimal; perbandingan ambang keyakinan dalam basis poin (4 desimal). |

## 2. Kecepatan

| ID | KPI | Rumus | Peristiwa |
|---|---|---|---|
| `frt` (KT-01) | First Response Time | rerata (dan median) detik dari `message_received` pertama tiket → `message_sent` pertama sesudahnya dengan `actorType` ∈ {ai, cp, staff}. Kartu sistem ("diteruskan") **tidak** dihitung sebagai tanggapan. Tiket tanpa tanggapan tidak masuk penyebut. | message_received, message_sent |
| `asa` (KT-02) | Average Speed of Answer | rerata detik per **episode eskalasi**: setiap `first_human_response` dipasangkan dengan `escalation` terakhir sebelumnya pada tiket yang sama. Satu tiket bisa punya dua episode (T2, lalu T3). | escalation, first_human_response |
| `sl_t1_prm-02`, `sl_t2_prm-03`, `sl_t3_prm-04`, `sl_t3_prm-05` (KT-03) | Service Level per kebijakan | `sla_met ÷ (sla_met + sla_breach)` per tingkat & kode parameter. Timer yang dibatalkan (`cancelled`) tidak dihitung. Tenggat inklusif. SLA T2 dihitung dalam jam layanan CP (PRM-19, keputusan Q4). | sla_met, sla_breach |
| `aht_t2`, `aht_t3` (KT-04) | Average Handle Time | rerata detik `handling_started` → `handling_ended` oleh petugas yang sama (klaim → selesai/diteruskan/dilepas). | handling_started, handling_ended |
| `aht_t1_ai` | Waktu proses AI | rerata `latencyMs` pada `ai_answer_sent`. | ai_answer_sent |
| `resolution` (KT-05) | Average Resolution Time | rerata detik `ticket_opened` → `ticket_resolved` pertama. | ticket_opened, ticket_resolved |

## 3. Efektivitas

| ID | KPI | Rumus |
|---|---|---|
| `fcr` (KT-06) | First Contact Resolution | tiket selesai yang **tidak** dibuka ulang dalam PRM-12 hari **dan** tanpa perpindahan antarpetugas manusia (`handoff` dari T2/T3) ÷ tiket selesai. Perpindahan AI → manusia pertama tetap dianggap kontak pertama dengan manusia. **Butuh PRM-12.** |
| `containment` (KT-07) | AI Containment Rate | tiket yang mendapat tanggapan AI (`ai_answer_sent`/`ai_action_executed`) dan **tidak pernah** punya `escalation` ÷ semua tiket. |
| `esc_t2`, `esc_t3`, `esc_mandatory` (KT-08) | Escalation Rate | tiket dengan ≥ 1 `escalation` ke T2 / ke T3 / `escalation_mandatory` ÷ semua tiket. Pengembalian Staf → CP (`ticket_returned`) **bukan** eskalasi. |
| `reopen` (KT-09) | Reopen Rate | tiket selesai yang punya `ticket_reopened` ÷ tiket selesai. Pembukaan ulang terjadi bila pelanggan menulis lagi dalam PRM-12 hari. **Butuh PRM-12.** |
| `handoff` (KT-10) | Transfer/Handoff per tiket | rerata jumlah `handoff` per tiket. |
| `abandonment` (KT-11) | Abandonment Rate | tiket yang dieskalasi dan mendapat `customer_inactive_timeout` (`waiting`) **sebelum** `first_human_response` ÷ tiket yang dieskalasi. Ketidakaktifan = tidak ada pesan pelanggan selama PRM-11 menit. **Butuh PRM-11.** |

## 4. Kualitas, tata kelola AI, beban kerja, PDP

| ID | KPI | Rumus |
|---|---|---|
| `csat` (KT-12) | CSAT | rerata skor butir per respons `survey_answered` (survey = csat), lalu rerata antarrespons; `top2Percent` = respons ≥ (maks − 1). Butir dari `config/surveys/csat.yaml`; bila DUMMY, KPI diberi catatan. |
| `ces` (KT-13) | Customer Effort Score | idem untuk survey = ces (lebih kecil lebih baik — konfirmasi arah skala dengan tim instrumen). |
| `nps` (KT-14) | NPS | %skor 9–10 − %skor 0–6 untuk survey = nps; tidak aktif selama `nps` tidak ada di PRM-15. |
| `qa` (KT-15) | Skor QA | rerata `score` (0–100) pada `qa_review_submitted`; skor = jumlah nilai kriteria ÷ jumlah nilai maksimum × 100. |
| `override` (KT-16) | Override Rate | `override_applied` ÷ (`ai_answer_sent` + `ai_action_executed`) dalam periode; rincian per kategori penyebab. |
| `ai_accuracy` (KT-17) | Akurasi AI terverifikasi | QA dengan `aiAnswerCorrect = true` ÷ QA yang memberi putusan benar/salah. |
| `confidence_below` (KT-18) | Distribusi keyakinan | skor dari `ai_answer_sent.confidence` dan `escalation.confidence` (oleh AI); histogram 10 kelas; proporsi < PRM-01. |
| `backlog` (KT-19) | Backlog & usia | per tingkat, tiket yang pada akhir periode masih berada di tingkat itu (diputar ulang dari `escalation`/`ticket_resolved`/`ticket_reopened`); usia = akhir periode − dibuka. KPI = T2 + T3. Tiket dibuka ≤ 60 hari sebelum periode ikut dihitung. |
| `occupancy` (KT-20) | Occupancy | Σ waktu menangani ÷ Σ waktu online (`presence_changed` = online), dipotong ke periode, hanya petugas dengan waktu online. Bisa > 100% karena menangani beberapa tiket bersamaan. |
| `volume_messages`, `volume_tickets` (KT-21) | Volume | jumlah `message_received` (per kanal, per jam WIB) dan tiket dibuka (per kategori). |
| `dsr` (KT-22) | Permintaan hak data | jumlah `dsr_opened`; rincian jumlah `dsr_closed` dan rerata jam penyelesaian (`durationMs`). |

## 5. Contoh hitungan tangan (KT)

Data sintetis enam tiket (A–F) pada 16 Nov 2026; lengkapnya di `packages/kpi/test/kpi.test.ts`.

| KPI | Hitungan | Hasil |
|---|---|---|
| FRT | A 2 s, B 123 s, C 660 s, D 4 s → (2+123+660+4)/4 | 197,25 s (median 63,5) |
| ASA | 120, 659, 90, 120 | 247,25 s |
| SL T2 | B, D terpenuhi; E terlewati | 66,67% |
| AHT T2 / T3 | (240+140)/2; (6600+500)/2 | 190 s / 3 550 s |
| Resolusi | (300+7200+1000)/3 | 2 833,33 s |
| FCR (N = 3) | B, C ya; D dibuka ulang & pindah CP→Staf | 66,67% |
| Containment | hanya A dari 5 | 20% |
| Eskalasi T2 / T3 / wajib | 3/5, 3/5, 1/5 | 60%, 60%, 20% |
| Handoff | (0+1+1+2+2)/5 | 1,2 |
| Abandonment | E dari 4 tiket dieskalasi | 25% |
| CSAT / CES | (4+5)/2; (2+3)/2 | 4,5 / 2,5 |
| QA / akurasi AI | (80+60+90)/3; 1 dari 2 | 76,67 / 50% |
| Override | 1 dari 2 tindakan AI | 50% |
| Keyakinan < 0,75 | {0,85; 0,80; 0,70} | 33,33% |
| Occupancy | (4 + 2,33)/(60 + 16,67) menit | 8,26% |

## 6. Pemetaan ke Buku Model

`config/kpi-map.yaml` memetakan id di atas ke KPI-01…KPI-22 Buku Model haloK@MPUS. Saat ini semua `null`
**[PERLU DATA]**; dasbor dan laporan otomatis menampilkan kode itu setelah diisi.

## 7. Keterbatasan yang diketahui

- KPI dihitung saat diminta (tanpa snapshot harian). Untuk periode panjang pada masa puncak, kinerja diukur pada uji beban Fase 4.
- Tiket AI tanpa interaksi lanjutan baru "selesai" bila PRM-11 ditetapkan (job ketidakaktifan); sebelum itu, containment dihitung dari tiket yang tidak pernah dieskalasi.
- `ces` diasumsikan "lebih kecil lebih baik"; arah skala resmi mengikuti butir dari tim instrumen.
