# Secret Handling

Production secrets are not committed to the repository.

Required secret values for direct R2 presigning are stored as Cloudflare Worker secrets:

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

The R2 account endpoint is configuration, not an application credential. It may be supplied through deployment configuration when the real Cloudflare account is provisioned.

Session signing material, WebAuthn server secrets, AI provider credentials, and other sensitive values must likewise be stored through Cloudflare Secrets or GitHub Actions Secrets.
