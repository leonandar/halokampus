"use client";
import { StaffShell } from "@/components/StaffShell";
import { OrchestrationPanel } from "@/components/Governance";
import { useStaff } from "@/components/useStaff";

/** Pimpinan follows the orchestration cycle read-only (FR-35). */
export default function Orchestration() {
  const { user } = useStaff(["leader", "staff"]);
  return <StaffShell user={user} title="Siklus orkestrasi Staf PMB">{user ? <OrchestrationPanel canManage={user.role === "staff"} /> : null}</StaffShell>;
}
