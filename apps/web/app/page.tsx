import Link from "next/link";

const LINKS: Array<[string, string, string]> = [
  ["/demo", "Widget percakapan (calon mahasiswa)", "Situs PMB tiruan dengan widget haloK@MPUS tertanam"],
  ["/sim/whatsapp", "Simulator kanal", "WhatsApp, Instagram, Messenger, Telegram, dan Email lewat webhook yang sama dengan API penyedia"],
  ["/masuk", "Masuk petugas", "Mahasiswa CP, Staf PMB, Pimpinan, Keuangan, Admin TI"],
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">haloK@MPUS</h1>
      <p className="mt-2 text-[var(--color-muted)]">Lapisan orkestrasi helpdesk PMB omnichannel dengan Contact Personnel tiga lapis: Agentic AI, Mahasiswa CP, dan Staf PMB.</p>
      <p className="mt-2 inline-block rounded bg-[var(--color-warn-soft)] px-2 py-1 text-sm text-[var(--color-warn)]">Lingkungan pengembangan — seluruh data bertanda DUMMY.</p>
      <ul className="mt-6 grid gap-3">
        {LINKS.map(([href, title, desc]) => (
          <li key={href}><Link href={href} className="card block p-4 hover:border-[var(--color-brand)]"><span className="font-semibold text-[var(--color-brand)]">{title}</span><span className="block text-sm text-[var(--color-muted)]">{desc}</span></Link></li>
        ))}
      </ul>
    </main>
  );
}
