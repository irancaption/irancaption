import type { MiddlewareHandler } from "hono";
import { HttpApiError } from "../errors/api.js";

function allowedOrigin(origin: string | undefined, configured: string | undefined, requestOrigin: string): boolean {
  if (!origin) return true;
  if (configured) return configured.split(",").map((item) => item.trim()).filter(Boolean).includes(origin);
  return origin === requestOrigin && new URL(requestOrigin).hostname === "localhost";
}

export const originGuard: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header("Origin");
  const requestOrigin = new URL(c.req.url).origin;
  if (!allowedOrigin(origin, c.env.ALLOWED_ORIGINS, requestOrigin)) throw new HttpApiError(403, "ORIGIN_REJECTED", "The request origin is not allowed.");
  await next();
};

export function corsHeaders(origin: string | undefined, configured: string | undefined, requestOrigin: string): Record<string, string> {
  if (!origin || !allowedOrigin(origin, configured, requestOrigin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, X-Request-Id",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Vary": "Origin"
  };
}
