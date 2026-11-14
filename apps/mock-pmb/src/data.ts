// DUMMY applicants. Every record is fictional and marked isDummy. Do not use real data here.
export interface Applicant {
  regNo: string;
  name: string;
  email: string;
  phone: string;
  program: string;
  path: "prestasi" | "tes_tulis" | "mandiri";
  stage: "isi_formulir" | "pembayaran" | "unggah_berkas" | "verifikasi" | "tes" | "pengumuman";
  paymentStatus: "belum_bayar" | "lunas" | "menunggu_verifikasi";
  documents: Array<{ docType: string; label: string; status: "belum_unggah" | "diunggah" | "terverifikasi" | "ditolak" }>;
  deadlines: Array<{ code: string; label: string; at: string }>;
  isDummy: true;
}

const PROGRAMS = ["S1-PMAT", "S1-TI", "S1-MNJ"];
const PATHS: Applicant["path"][] = ["prestasi", "tes_tulis", "mandiri"];
const STAGES: Applicant["stage"][] = ["isi_formulir", "pembayaran", "unggah_berkas", "verifikasi", "tes"];
const FIRST = ["Andi", "Budi", "Citra", "Dewi", "Eko", "Fajar", "Gita", "Hana", "Irfan", "Joko", "Kirana", "Lestari"];
const LAST = ["Pratama", "Santoso", "Wijaya", "Lestari", "Saputra", "Rahayu", "Nugroho", "Kusuma"];

const DEADLINES = [
  { code: "close", label: "Penutupan pendaftaran jalur mandiri", at: "2027-01-31T16:59:00Z" },
  { code: "upload", label: "Batas akhir unggah berkas", at: "2027-02-03T16:59:00Z" },
];

function docs(stage: Applicant["stage"], i: number): Applicant["documents"] {
  const uploaded = stage === "verifikasi" || stage === "tes";
  return [
    { docType: "pas_foto", label: "Pas foto", status: uploaded || i % 2 === 0 ? "diunggah" : "belum_unggah" },
    { docType: "ijazah", label: "Ijazah/SKL", status: uploaded ? "terverifikasi" : "diunggah" },
    { docType: "rapor", label: "Rapor", status: uploaded ? "terverifikasi" : "belum_unggah" },
  ];
}

export const APPLICANTS: Applicant[] = Array.from({ length: 60 }, (_, i) => {
  const stage = STAGES[i % STAGES.length]!;
  const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]} (DUMMY)`;
  return {
    regNo: `PMB-2027-${String(100 + i).padStart(6, "0")}`,
    name,
    email: `pendaftar${100 + i}@contoh.invalid`,
    phone: `0812000${String(100 + i).padStart(5, "0")}`,
    program: PROGRAMS[i % PROGRAMS.length]!,
    path: PATHS[i % PATHS.length]!,
    stage,
    paymentStatus: stage === "isi_formulir" ? "belum_bayar" : stage === "pembayaran" ? "menunggu_verifikasi" : "lunas",
    documents: docs(stage, i),
    deadlines: DEADLINES,
    isDummy: true,
  };
});
