# Upload boundary

The application keeps video bytes out of the Worker. The eventual authenticated upload route creates a database upload record and signs a short-lived R2 PUT URL for a single generated object key. The browser then uploads directly to R2 with the exact signed `Content-Type`.

The signing credentials are server-side Cloudflare secrets. They are never sent to the browser. The current implementation contains the signing utility but does not expose it through an unauthenticated route.

For the V1 100 MB maximum, single-object presigned PUT is the intended path. Cloudflare documents presigned PUT as the direct browser-to-R2 pattern and supports expiry plus Content-Type restrictions.
