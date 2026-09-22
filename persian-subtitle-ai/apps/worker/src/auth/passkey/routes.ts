import { Hono } from "hono";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";
import { getPasskeyConfig } from "./config.js";
import { sha256Hex } from "../../security/hash.js";
import { createSession, expiredSessionCookie, getSessionToken, revokeSession, sessionCookie } from "../sessions/store.js";
import { writeAudit } from "../../audit/log.js";
import type { Bindings } from "../../index.js";

const app = new Hono<{ Bindings: Bindings; Variables: { requestId: string } }>();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

type ChallengeRow = { id: string; user_id: string | null; challenge_hash: string; type: "registration" | "authentication"; expires_at: string; consumed_at: string | null };
type CredentialRow = { id: string; user_id: string; credential_id: string; public_key: string; counter: number; transports: string | null };

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON body.");
  return value as Record<string, unknown>;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function parseTransports(value: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((item): item is AuthenticatorTransportFuture => typeof item === "string");
  } catch {
    return undefined;
  }
}

async function saveChallenge(db: D1Database, userId: string | null, type: ChallengeRow["type"], challenge: string): Promise<void> {
  const now = new Date();
  await db.prepare("INSERT INTO webauthn_challenges (id, user_id, challenge_hash, type, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), userId, await sha256Hex(challenge), type, new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(), now.toISOString()).run();
}

async function consumeMatchingChallenge(db: D1Database, type: ChallengeRow["type"], challenge: string): Promise<ChallengeRow | null> {
  const hash = await sha256Hex(challenge);
  const row = await db.prepare("SELECT id, user_id, challenge_hash, type, expires_at, consumed_at FROM webauthn_challenges WHERE challenge_hash = ? AND type = ? AND consumed_at IS NULL AND expires_at > ? LIMIT 1")
    .bind(hash, type, new Date().toISOString()).first<ChallengeRow>();
  if (!row) return null;
  const consumedAt = new Date().toISOString();
  const updated = await db.prepare("UPDATE webauthn_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?")
    .bind(consumedAt, row.id, consumedAt).run();
  if (!updated.meta.changes) return null;
  return row;
}

app.post("/register/options", async (c) => {
  const config = getPasskeyConfig(c.env, c.req.url);
  // Do not create a persistent user until the WebAuthn ceremony succeeds.
  // Abandoned registration attempts therefore cannot accumulate orphan users.
  const userId = crypto.randomUUID();
  const existing: { results: Array<{ credential_id: string; transports: string | null }> } = { results: [] };

  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userID: isoUint8Array.fromUTF8String(userId),
    userName: userId,
    userDisplayName: "کاربر جدید",
    attestationType: "none",
    excludeCredentials: existing.results.map((item) => ({ id: item.credential_id, transports: parseTransports(item.transports) })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: [-7, -257],
  });

  await saveChallenge(c.env.DB, userId, "registration", options.challenge);
  return c.json(options);
});

app.post("/register/verify", async (c) => {
  const contentLength = Number(c.req.header("Content-Length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return c.json({ error: { code: "INVALID_REQUEST", message: "Request body is too large.", retryable: false, requestId: c.get("requestId") } }, 413);
  try {
    const body = jsonObject(await c.req.json());
    const response = body as Parameters<typeof verifyRegistrationResponse>[0]["response"];
    const clientDataJSON = (body.response as Record<string, unknown> | undefined)?.clientDataJSON;
    if (typeof clientDataJSON !== "string") throw new Error("Invalid registration response.");
    const challengeValue = clientChallengeFromJSON(clientDataJSON);
    const consumed = await consumeMatchingChallenge(c.env.DB, "registration", challengeValue);
    if (!consumed?.user_id) throw new Error("Registration challenge is invalid, expired, or already used.");
    const config = getPasskeyConfig(c.env, c.req.url);
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: async (received) => (await sha256Hex(received)) === consumed.challenge_hash,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) throw new Error("Passkey verification failed.");

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const transports = credential.transports ? JSON.stringify(credential.transports) : null;
    const publicKey = base64url(credential.publicKey);
    const userId = consumed.user_id;
    const now = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO users (id, status, display_name, created_at, updated_at) VALUES (?, 'active', ?, ?, ?)")
        .bind(userId, "کاربر جدید", now, now),
      c.env.DB.prepare("INSERT INTO passkey_credentials (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), userId, credential.id, publicKey, credential.counter, transports, credentialDeviceType, credentialBackedUp ? 1 : 0, now),
    ]);
    await c.env.DB.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").bind(new Date().toISOString(), new Date().toISOString(), userId).run();
    const session = await createSession(c.env.DB, userId, c.req.raw, c.env.SESSION_TTL_SECONDS);
    await writeAudit(c.env.DB, { userId, action: "PASSKEY_REGISTER" });
    await writeAudit(c.env.DB, { userId, action: "LOGIN" });
    return c.json({ verified: true }, 200, { "Set-Cookie": sessionCookie(session.token, session.record.expiresAt) });
  } catch {
    return c.json({ error: { code: "INVALID_REQUEST", message: "Passkey registration could not be verified.", retryable: false, requestId: c.get("requestId") } }, 400);
  }
});

app.post("/login/options", async (c) => {
  const config = getPasskeyConfig(c.env, c.req.url);
  const options = await generateAuthenticationOptions({ rpID: config.rpID, userVerification: "required" });
  await saveChallenge(c.env.DB, null, "authentication", options.challenge);
  return c.json(options);
});

app.post("/login/verify", async (c) => {
  const contentLength = Number(c.req.header("Content-Length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return c.json({ error: { code: "INVALID_REQUEST", message: "Request body is too large.", retryable: false, requestId: c.get("requestId") } }, 413);
  try {
    const body = jsonObject(await c.req.json());
    const credentialId = typeof body.id === "string" ? body.id : "";
    if (!credentialId) throw new Error("Missing credential ID.");
    const credential = await c.env.DB.prepare("SELECT id, user_id, credential_id, public_key, counter, transports FROM passkey_credentials WHERE credential_id = ? AND revoked_at IS NULL LIMIT 1")
      .bind(credentialId).first<CredentialRow>();
    if (!credential) throw new Error("Unknown passkey.");
    const clientDataJSON = (body.response as Record<string, unknown> | undefined)?.clientDataJSON;
    if (typeof clientDataJSON !== "string") throw new Error("Invalid authentication response.");
    const challengeValue = clientChallengeFromJSON(clientDataJSON);
    const consumed = await consumeMatchingChallenge(c.env.DB, "authentication", challengeValue);
    if (!consumed) throw new Error("Authentication challenge is invalid, expired, or already used.");
    const config = getPasskeyConfig(c.env, c.req.url);
    const verification = await verifyAuthenticationResponse({
      response: body as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
      expectedChallenge: async (received) => (await sha256Hex(received)) === consumed.challenge_hash,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
      credential: { id: credential.credential_id, publicKey: decodeBase64url(credential.public_key), counter: credential.counter, transports: parseTransports(credential.transports) },
    });
    if (!verification.verified) throw new Error("Passkey verification failed.");
    await c.env.DB.prepare("UPDATE passkey_credentials SET counter = ?, last_used_at = ? WHERE id = ? AND revoked_at IS NULL")
      .bind(verification.authenticationInfo.newCounter, new Date().toISOString(), credential.id).run();
    await c.env.DB.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(new Date().toISOString(), new Date().toISOString(), credential.user_id).run();
    const session = await createSession(c.env.DB, credential.user_id, c.req.raw, c.env.SESSION_TTL_SECONDS);
    await writeAudit(c.env.DB, { userId: credential.user_id, action: "LOGIN" });
    return c.json({ verified: true }, 200, { "Set-Cookie": sessionCookie(session.token, session.record.expiresAt) });
  } catch {
    return c.json({ error: { code: "INVALID_REQUEST", message: "Passkey authentication failed.", retryable: false, requestId: c.get("requestId") } }, 400);
  }
});

app.get("/session", async (c) => {
  const token = getSessionToken(c.req.raw);
  if (!token) return c.json({ authenticated: false });
  const hash = await sha256Hex(token);
  const row = await c.env.DB.prepare("SELECT s.id, s.user_id, s.expires_at, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.deleted_at IS NULL LIMIT 1")
    .bind(hash, new Date().toISOString()).first<{ id: string; user_id: string; expires_at: string; display_name: string | null }>();
  if (!row) return c.json({ authenticated: false });
  return c.json({ authenticated: true, user: { id: row.user_id, displayName: row.display_name }, expiresAt: row.expires_at });
});

app.post("/logout", async (c) => {
  const token = getSessionToken(c.req.raw);
  if (token) {
    const hash = await sha256Hex(token);
    const row = await c.env.DB.prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1").bind(hash).first<{ user_id: string }>();
    await revokeSession(c.env.DB, token);
    if (row) await writeAudit(c.env.DB, { userId: row.user_id, action: "LOGOUT" });
  }
  return c.json({ ok: true }, 200, { "Set-Cookie": expiredSessionCookie() });
});

function clientChallengeFromJSON(clientDataJSON: string): string {
  const json = JSON.parse(new TextDecoder().decode(decodeBase64url(clientDataJSON))) as { challenge?: unknown };
  if (typeof json.challenge !== "string" || json.challenge.length < 16) throw new Error("Invalid WebAuthn challenge.");
  return json.challenge;
}

function decodeBase64url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default app;
