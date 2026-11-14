"use client";

/** Same-origin fetch for staff consoles; mutating calls carry the CSRF token. */
let csrf: string | null = null;
export function setCsrf(token: string | null) {
  csrf = token;
  try {
    if (token) sessionStorage.setItem("hk_csrf", token);
    else sessionStorage.removeItem("hk_csrf");
  } catch {}
}
function getCsrf(): string | null {
  if (csrf) return csrf;
  try {
    csrf = sessionStorage.getItem("hk_csrf");
  } catch {}
  return csrf;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; bearer?: string } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    const t = getCsrf();
    if (t) headers["x-csrf-token"] = t;
  }
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  const res = await fetch(path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? `HTTP ${res.status}`);
  return data as T;
}
