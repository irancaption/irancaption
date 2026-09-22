import type { Context } from "hono";
import type { ErrorCode } from "@irancaption/shared";

export class HttpApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable = false
  ) { super(message); }
}

export function apiError(c: Context, error: HttpApiError) {
  c.header("Cache-Control", "no-store");
  const requestId = c.get("requestId") as string;
  return c.json({ error: { code: error.code, message: error.message, retryable: error.retryable, requestId } }, error.status as never);
}
