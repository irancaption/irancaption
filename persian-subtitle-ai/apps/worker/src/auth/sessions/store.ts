import { sha256Hex } from "../../security/hash.js";

const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type SessionRecord = {
  id: string;
  userId: string;
  expiresAt: string;
};

function sessionTtlSeconds(value?: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 300 || parsed > 30 * 24 * 60 * 60) {
    return DEFAULT_SESSION_TTL_SECONDS;
  }
  return parsed;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function createSession(
  db: D1Database,
  userId: string,
  request: Request,
  ttlConfig?: string,
): Promise<{ record: SessionRecord; token: string }> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionTtlSeconds(ttlConfig) * 1000);
  const id = crypto.randomUUID();

  await db.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, ip_hash, user_agent_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    id,
    userId,
    tokenHash,
    now.toISOString(),
    expiresAt.toISOString(),
    now.toISOString(),
    request.headers.get("CF-Connecting-IP") ? await sha256Hex(request.headers.get("CF-Connecting-IP") as string) : null,
    request.headers.get("User-Agent") ? await sha256Hex(request.headers.get("User-Agent") as string) : null,
  ).run();

  return { record: { id, userId, expiresAt: expiresAt.toISOString() }, token };
}

export async function getSession(db: D1Database, token: string): Promise<SessionRecord | null> {
  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(
    "SELECT id, user_id, expires_at FROM sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1",
  ).bind(tokenHash, new Date().toISOString()).first<{ id: string; user_id: string; expires_at: string }>();

  if (!row) return null;

  await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), row.id).run();

  return { id: row.id, userId: row.user_id, expiresAt: row.expires_at };
}

export async function revokeSession(db: D1Database, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), tokenHash).run();
}

export function sessionCookie(token: string, expiresAt: string): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return `__Host-psai_session=${token}; Path=/; Max-Age=${maxAge}; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; Secure; SameSite=Lax`;
}

export function expiredSessionCookie(): string {
  return "__Host-psai_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax";
}

export function getSessionToken(request: Request): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const item of cookie.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name === "__Host-psai_session") return parts.join("=") || null;
  }
  return null;
}
