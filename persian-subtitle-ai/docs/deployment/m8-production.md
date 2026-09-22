# M8 Production Deployment

## Repository files to commit

Commit these M8 files:

- `.github/workflows/ci.yml`
- `.github/workflows/staging.yml`
- `.github/workflows/production.yml`
- `apps/worker/wrangler.staging.jsonc`
- `apps/worker/wrangler.production.jsonc`
- `apps/worker/src/security/request-id.ts`
- `scripts/validate-migrations.mjs`
- `tests/security-hardening.test.ts`
- `docs/deployment/m8-production.md`

## GitHub environments

Create `staging` and `production` environments. Add these secrets to each environment:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Never commit secret values.

## Cloudflare resources

Create separate D1 databases, R2 buckets, and Queues matching the names in the environment config files before deployment. Configure R2 signing credentials and WebAuthn values as Cloudflare Worker secrets/variables.

## Lockfile

The repository currently has no `package-lock.json`. CI therefore uses `npm install` rather than `npm ci`. Generate and commit a lockfile from a network-enabled development machine before treating the repository as fully reproducible.

## Security changes

M8 adds request-ID sanitization, session-cookie origin/CSRF enforcement, production HSTS, `Cache-Control: no-store` on API errors, migration validation, dependency auditing, and separate staging/production deployment workflows.
