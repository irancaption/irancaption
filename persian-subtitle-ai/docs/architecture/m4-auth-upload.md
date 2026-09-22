# M4 authentication and upload flow

```text
Browser
  |
  +-- POST /api/v1/auth/passkey/register/options
  |       -> WebAuthn ceremony
  +-- POST /api/v1/auth/passkey/register/verify
  |       -> D1 credential + secure session
  |
  +-- POST /api/v1/uploads
  |       -> Worker authorizes upload
  |       -> presigned R2 PUT URL
  |
  +-- PUT presigned R2 URL
  |       -> video bytes go directly to R2
  |
  +-- POST /api/v1/uploads/:id/complete
  |       -> Worker HEAD checks R2 object
  |
  +-- POST /api/v1/jobs
          -> D1 idempotent job
          -> Cloudflare Queue
```

The Worker does not receive or proxy video bytes during the normal upload path.

For the V1 maximum of 100 MB, a single presigned PUT is used. A multipart/resumable upload design is intentionally not mixed into this flow because doing multipart through the Worker would violate the direct-upload requirement.
