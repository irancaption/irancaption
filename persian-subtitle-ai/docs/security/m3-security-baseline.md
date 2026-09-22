# M3 security baseline

The Worker now establishes request IDs, baseline security headers, explicit Origin allowlisting, structured request logs, route-level rate-limit abstraction, and API error normalization.

The in-memory limiter is intentionally a development baseline. Production abuse controls must use Cloudflare-native durable state/rate limiting before public launch; it must not be treated as a globally consistent distributed limiter.

Authentication-protected resource routes deliberately return `AUTH_REQUIRED` until the real Passkey/WebAuthn session implementation exists. No fake user identity or bypass is introduced.
