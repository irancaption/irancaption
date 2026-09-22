# Persian Subtitle AI

A production-oriented Persian subtitle platform built as a TypeScript monorepo for Cloudflare Workers.

## M1

M1 provides:

- Vite + TypeScript + HTML5 + CSS3 frontend
- Persian-first RTL initial UI
- Hono Worker
- `GET /api/v1/health`
- Shared package
- Type-safe subtitle core with timestamp validation
- AI provider abstractions
- Wrangler configuration for Workers Static Assets
- Cloudflare D1, R2 and Queue binding declarations prepared for M2 resource creation
- Initial D1 migration directory

Authentication, uploads, AI providers, database access and job processing are intentionally not implemented in M1.

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Commands

```bash
npm install
npm run dev
npm run build
npm run typecheck
npm run lint
npm test
```

The frontend development server runs independently with Vite. The production architecture serves the generated `apps/web/dist` directory as Workers Static Assets from the Worker.

## Cloudflare resources

No Cloudflare resource IDs or credentials are committed.

Before the first Cloudflare deployment, M2 must create and attach:

- D1 database for the project
- R2 bucket for video objects
- Queue for transcription jobs

The D1 binding is intentionally present without a database ID because Cloudflare requires the real database ID for a deployable D1 binding. A fabricated ID is never used.

R2 and Queue names are stable resource names in the Wrangler configuration and must be created in Cloudflare before deployment.

Secrets must be configured with Cloudflare Secrets and GitHub Actions Secrets. No secrets are stored in this repository.

## M2 progress

The database foundation now includes authentication, sessions, uploads, jobs, transcript segments, subtitles, subtitle versions/cues, usage, and audit-log tables. Upload architecture preserves the direct-to-R2 requirement for the 100 MB V1 limit.

## M3 progress

Implemented the next production foundation locally: shared limits/schemas/errors, SRT/VTT formatting, request IDs, security headers, explicit CORS/origin handling, rate-limit abstraction, R2 presigned PUT signing utility, upload validation, ownership-scoped query helpers, audit logging, queue message types, and job-state update helper. Protected resource routes intentionally require real authentication and do not use a fake identity.

## M4 progress

Implemented the real authentication and upload path locally:

- WebAuthn/passkey registration and verification using `@simplewebauthn/server` 14.x.
- Discoverable passwordless authentication using `allowCredentials: []`.
- Required user verification for registration and authentication.
- SHA-256-only challenge persistence with one-time challenge consumption.
- Credential public-key and signature-counter persistence.
- Secure `__Host-psai_session` HttpOnly/Secure/SameSite session cookie.
- Session hashing, expiry, revocation, last-seen tracking, IP/user-agent hashes and login/logout audit records.
- Ownership-scoped video/upload/job APIs.
- Browser-to-R2 presigned PUT upload for MP4 files up to 100 MB.
- R2 object size/content-type verification on upload completion.
- Idempotent job creation and queue publication.
- `POST /api/v1/videos/:id/process`.
- Queue consumer now acknowledges invalid/missing work and records an explicit `NOT_IMPLEMENTED` failure when no real speech-to-text provider is configured; it does not fabricate AI results.

The production hostname must provide `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_NAME`, `ALLOWED_ORIGINS`, and the R2 signing credentials as Cloudflare configuration/secrets. No secret values are committed.

## M5 — AI pipeline

M5 adds the production pipeline boundary for Cloudflare Workers AI: Whisper large-v3-turbo for timestamped speech recognition, M2M100-1.2B for translation to Persian, deterministic Persian normalization, subtitle segmentation, D1 persistence of transcript segments, subtitle version creation, and Queue retry/DLQ configuration.

The pipeline intentionally requires a prepared audio object in R2. The original MP4 remains in R2 and never passes through the Worker. The authenticated API exposes a direct-to-R2 prepared-audio upload contract at `POST /api/v1/videos/:id/audio-upload` and its completion endpoint. Media extraction from MP4 into that audio object is a separate media-preparation client/runtime concern and is not faked inside the Worker.

## M6/M7 progress

M6/M7 adds the authenticated dashboard/editor surface and production hardening:

- RTL Persian-first dashboard, processing status, video details and synchronized subtitle workflow.
- Immutable subtitle editing versions with full-document save, split and merge operations.
- SRT/VTT export from the current owned subtitle version.
- Monthly D1-backed quotas for uploaded bytes, video count, processing jobs and processed seconds.
- Server-authoritative 100 MB object-size validation and MP4 content-type validation at R2 completion.
- Server-authoritative 30-minute duration enforcement from timestamped STT output.
- Queue retry reuse of persisted transcript and translated segments to avoid repeating completed AI stages.
- Per-job processed-duration usage checkpoint to prevent retry double-charging.
- Usage API at `GET /api/v1/usage`.
- Production-hardening indexes and migration `0004`/`0005`.

The current in-process request limiter remains a best-effort edge guard rather than a globally shared distributed rate-limit database. It must not be treated as the sole abuse-control mechanism for a high-volume production deployment.

## M8 — Production security, CI/CD and deployment

M8 adds the production hardening and deployment layer:

- Sanitized `X-Request-Id` values to prevent log/header injection.
- `Cache-Control: no-store` on API responses.
- Session-cookie unsafe requests require a browser `Origin` header; the existing explicit origin allowlist remains authoritative.
- Production-only HSTS.
- Migration numbering/destructive-change validation script.
- Dependency audit in CI.
- Dedicated staging and production Wrangler configurations with separate resource names.
- GitHub Actions workflows for CI, staging deployment and manually triggered production deployment.
- Deployment documentation with the exact repository files, GitHub secrets and Cloudflare resources required.

### Repository placement

The M8 files are intended to be committed directly to the `irancaption/irancaption` repository at the same paths shown in the ZIP.

The current workspace does not contain a `package-lock.json`; CI intentionally uses `npm install` until a lockfile is generated on a network-enabled machine and committed.

### Verification status

Local TypeScript project compilation (`tsc -p tsconfig.json`) passes in the available environment. Migration validation and YAML parsing also pass. Full Vitest/ESLint execution was not available because project npm dependencies are not installed locally and registry access timed out.


## M9 Production Reliability Hardening

- Atomic upload/job quota reservation
- Abandoned upload cleanup and quota release
- Scheduled cleanup every 15 minutes
- WebAuthn registration no longer creates persistent users before verification
- R2 audio cleanup when a video is deleted
- GitCode/AtomGit CI workflow
- Mobile repository upload instructions


## M10 production reliability

M10 hardens quota accounting and authentication API compatibility. Upload quota reservations now retain the exact monthly accounting period so cleanup cannot release usage into the wrong month. Processed-duration quota increments are atomic at the database level, preventing concurrent jobs from exceeding the configured monthly limit. The canonical authentication endpoints are also available under `/api/v1/auth/*` while the existing `/api/v1/auth/passkey/*` paths remain compatible.

### Mobile repository placement

If you are uploading the project from a phone, extract the M10 ZIP first. The repository root must directly contain `package.json`, `apps/`, `packages/`, `database/`, `tests/`, `docs/`, `scripts/`, `.github/`, and `.gitcode/`. Do not commit the ZIP itself as the project root and do not create an extra nested `persian-subtitle-ai-work/` directory.
