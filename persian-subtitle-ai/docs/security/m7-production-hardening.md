# M7 Production Hardening

## Quotas
Monthly defaults are configurable through non-secret Worker vars:
- `MAX_UPLOAD_BYTES_PER_PERIOD`: 1 GiB
- `MAX_VIDEO_COUNT_PER_PERIOD`: 10
- `MAX_JOB_COUNT_PER_PERIOD`: 20
- `MAX_PROCESSED_SECONDS_PER_PERIOD`: 3600

Quota usage is persisted in D1. Job processing duration is charged once per job through the `usage_recorded_at` checkpoint so queue retries do not charge the same job twice.

## Upload trust boundary
The browser performs a client-side MP4/duration check for UX. The server remains authoritative for byte count and R2 object metadata. The authoritative duration limit is enforced after STT from timestamped segments before translation/subtitle generation.

## Retry/idempotency
Existing transcript segments are reused when a queue retry occurs. Existing translated segments are reused and only missing translations are requested. This prevents repeating STT after a later-stage retry and limits duplicate AI cost.

## Subtitle editing
User edits create immutable subtitle versions rather than mutating an existing version. Current version is advanced only after the new version is populated.

## Rate limiting
The current in-process limiter is a best-effort edge guard and is not a globally shared quota store across Worker isolates. Production deployments should retain it as a first line of defense and may add a Cloudflare-native distributed limiter when the deployment topology requires strict global request ceilings.

## Secrets
R2 signing credentials and authentication configuration secrets are never stored in source control. Use Cloudflare secrets and GitHub Actions secrets.
