"use client";
import { useCallback, useEffect, useState } from "react";
import { api, setCsrf } from "@/lib/api";

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: "cp" | "staff" | "leader" | "finance" | "admin";
  presence: string;
  totpEnabled: boolean;
}

/** Loads the signed-in staff user; redirects to /masuk when the session is missing or the role is not allowed. */
export function useStaff(allowed: StaffUser["role"][]) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const reload = useCallback(async () => {
    try {
      const r = await api<{ user: StaffUser; csrfToken: string }>("/api/auth/me");
      setCsrf(r.csrfToken);
      if (!allowed.includes(r.user.role)) {
        window.location.href = homeFor(r.user.role);
        return;
      }
      setUser(r.user);
    } catch {
      window.location.href = `/masuk?lanjut=${encodeURIComponent(window.location.pathname)}`;
    }
  }, [allowed.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void reload(), [reload]);
  return { user, setUser, reload };
}

export function homeFor(role: string): string {
  return { cp: "/cp", staff: "/staf", leader: "/dasbor", finance: "/keuangan", admin: "/admin" }[role] ?? "/";
}
