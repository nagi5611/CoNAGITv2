/**
 * src/auth/password.ts — PBKDF2-SHA256（Web Crypto）。保存形式: v1$<iter>$<salt_b64>$<hash_b64>
 */

const ITERATIONS = 120_000;
const PREFIX = "v1";

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

export async function hashPassword(plain: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(enc.encode(plain), salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(bits)}`;
}

async function deriveBits(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const buf = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    keyMaterial,
    256,
  );
  return new Uint8Array(buf);
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== PREFIX) return false;
  const iter = Number(parts[1]);
  if (!Number.isFinite(iter) || iter < 10_000) return false;
  const saltB64 = parts[2]!;
  const hashB64 = parts[3]!;
  if (!saltB64 || !hashB64) return false;
  const salt = base64UrlToBytes(saltB64);
  const expectedHash = base64UrlToBytes(hashB64);
  const enc = new TextEncoder();
  const actualHash = await deriveBits(enc.encode(plain), salt, iter);
  return timingSafeEqual(actualHash, expectedHash);
}
