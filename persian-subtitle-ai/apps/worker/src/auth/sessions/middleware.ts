import type { Context, Next } from "hono";
import type { Bindings } from "../../index.js";
import { getSession, getSessionToken } from "./store.js";

export type AuthVariables = { userId: string; sessionId: string };

export async function requireSession(c: Context<{ Bindings: Bindings; Variables: AuthVariables }>, next: Next) {
  const token = getSessionToken(c.req.raw);
  if (!token) return c.json({ error: { code: "AUTH_REQUIRED", message: "Authentication is required.", retryable: false, requestId: c.get("requestId") } }, 401);
  const session = await getSession(c.env.DB, token);
  if (!session) return c.json({ error: { code: "AUTH_REQUIRED", message: "Authentication is required.", retryable: false, requestId: c.get("requestId") } }, 401);
  c.set("userId", session.userId);
  c.set("sessionId", session.id);
  await next();
}
