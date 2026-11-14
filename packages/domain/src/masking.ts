/** Server-side masking for roles that must not see full personal data (FR-26). */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 6) return "*".repeat(digits.length);
  return `${digits.slice(0, 4)}${"*".repeat(Math.max(4, digits.length - 7))}${digits.slice(-3)}`;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [user = "", domain = ""] = email.split("@");
  const head = user.slice(0, 1);
  return `${head}${"*".repeat(Math.max(3, user.length - 1))}@${domain}`;
}

/** Keeps the first word (the name a CP addresses the customer with), masks the rest. */
export function maskName(name: string | null | undefined): string {
  if (!name) return "";
  const [first = "", ...rest] = name.trim().split(/\s+/);
  return [first, ...rest.map((w) => `${w.slice(0, 1)}.`)].join(" ");
}

export function maskId(id: string | null | undefined): string {
  if (!id) return "";
  if (id.length <= 4) return "*".repeat(id.length);
  return `${"*".repeat(id.length - 4)}${id.slice(-4)}`;
}
