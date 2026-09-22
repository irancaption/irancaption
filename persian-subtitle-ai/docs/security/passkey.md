# Passkey security model

The platform uses WebAuthn/passkeys as the only authentication mechanism in V1. No password credential is stored.

## Server ceremony

1. Registration creates an opaque internal user ID.
2. `generateRegistrationOptions()` requires a discoverable credential and user verification.
3. The WebAuthn challenge is stored only as SHA-256 in D1.
4. Registration verification checks RP ID, origin, challenge, user verification, and the authenticator response.
5. Credential public keys are stored as base64url text and counters are persisted.
6. Authentication uses discoverable credentials, so the login flow does not require an email or username.
7. Authentication verifies the stored credential, challenge, RP ID, origin, and user verification before creating a session.
8. A challenge is consumed exactly once after successful verification.

## Session model

Sessions use a 256-bit random token. Only its SHA-256 hash is stored in D1.

The browser receives a `__Host-psai_session` cookie with:

- `HttpOnly`
- `Secure`
- `SameSite=Lax`
- `Path=/`
- no `Domain`

Session lookup always checks revocation and expiry.

## Production configuration

Configure these Worker variables/secrets for the production hostname:

- `WEBAUTHN_RP_NAME` — public relying-party name; non-secret.
- `WEBAUTHN_RP_ID` — the exact RP ID, normally the production hostname; non-secret.
- `WEBAUTHN_ORIGIN` — exact HTTPS origin used by the browser; non-secret.
- `SESSION_TTL_SECONDS` — optional session lifetime between 5 minutes and 30 days.
- `R2_ACCOUNT_ID` — secret.
- `R2_ACCESS_KEY_ID` — secret.
- `R2_SECRET_ACCESS_KEY` — secret.

Do not commit any secret value. Store sensitive values with Cloudflare Secrets and GitHub Actions Secrets.
