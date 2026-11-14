import Script from "next/script";

/** Stand-in for the institution's PMB website, embedding the widget with one script tag (FR-45). */
export default function Demo() {
  return (
    <main className="min-h-dvh bg-white">
      <header className="bg-[#0b3d6e] px-4 py-5 text-white">
        <div className="mx-auto max-w-4xl"><p className="text-sm opacity-90">[DUMMY] Universitas Contoh</p><h1 className="text-2xl font-bold">Penerimaan Mahasiswa Baru 2027</h1></div>
      </header>
      <section className="mx-auto max-w-4xl px-4 py-6">
        <p className="mb-3">Halaman ini meniru situs PMB institusi. Widget haloK@MPUS di pojok kanan bawah ditanam dengan satu tag skrip:</p>
        <pre tabIndex={0} aria-label="Contoh kode penanaman widget" className="overflow-x-auto rounded bg-slate-900 p-3 text-sm text-slate-100"><code>{'<script src="https://halokampus.contoh/widget/halokampus-widget.js" data-api="https://halokampus.contoh" defer></script>'}</code></pre>
        <p className="mt-3 text-sm text-[var(--color-muted)]">Coba: “Jalur pendaftaran apa saja yang tersedia?”, “Berapa biaya pendaftaran?”, “Bagaimana status pendaftaran saya?” (nomor DUMMY: PMB-2027-000102), atau “Pembayaran saya gagal”.</p>
      </section>
      <Script src="/widget/halokampus-widget.js" data-api="" strategy="afterInteractive" />
    </main>
  );
}
