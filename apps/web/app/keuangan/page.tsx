"use client";
import { StaffShell } from "@/components/StaffShell";
import { TicketWorkspace } from "@/components/TicketWorkspace";
import { useStaff } from "@/components/useStaff";

export default function FinanceView() {
  const { user } = useStaff(["finance"]);
  return (
    <StaffShell user={user} title="Unit Keuangan · baca tiket pembayaran" banner={<p className="mx-auto max-w-[1400px] px-4 pt-3 text-sm text-[var(--color-muted)]">Akses baca terbatas pada tiket kategori pembayaran (FR-41).</p>}>
      {user ? <TicketWorkspace user={user} tier="T3" mode="finance" /> : null}
    </StaffShell>
  );
}
