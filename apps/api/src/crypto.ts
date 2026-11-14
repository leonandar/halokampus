import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Column-level encryption (AES-256-GCM) and blind indexes (HMAC-SHA256) for personal
 * data at rest (NFR-05). Ciphertext format: v1.<iv>.<tag>.<data> (base64url).
 */
export class Crypto {
  private readonly key: Buffer;
  private readonly bidxKey: Buffer;
  constructor(encKeyB64: string, bidxKeyB64: string) {
    this.key = Buffer.from(encKeyB64, "base64");
    this.bidxKey = Buffer.from(bidxKeyB64, "base64");
    if (this.key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must decode to 32 bytes");
    if (this.bidxKey.length < 32) throw new Error("BLIND_INDEX_KEY must decode to >= 32 bytes");
  }
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
  }
  decrypt(token: string): string {
    const [v, iv, tag, data] = token.split(".");
    if (v !== "v1" || !iv || !tag || data === undefined) throw new Error("Unsupported ciphertext");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  }
  encryptOpt(plain: string | null | undefined): string | null {
    return plain == null || plain === "" ? null : this.encrypt(plain);
  }
  decryptOpt(token: string | null | undefined): string | null {
    return token ? this.decrypt(token) : null;
  }
  encryptJson(v: unknown): string {
    return this.encrypt(JSON.stringify(v));
  }
  decryptJson<T>(token: string | null | undefined): T | null {
    return token ? (JSON.parse(this.decrypt(token)) as T) : null;
  }
  /** Deterministic index so we can look up encrypted identifiers without decrypting. */
  blindIndex(value: string): string {
    return createHmac("sha256", this.bidxKey).update(value.trim().toLowerCase()).digest("hex");
  }
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const randomDigits = (n: number) => Array.from({ length: n }, () => randomInt(0, 10)).join("");
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
