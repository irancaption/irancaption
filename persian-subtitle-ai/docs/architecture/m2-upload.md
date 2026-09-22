# M2 Upload Architecture

The V1 video limit is 100 MB and 30 minutes. R2 supports direct browser uploads with presigned PUT URLs, so video bytes do not pass through the Worker. The Worker creates an upload record, validates metadata, creates a private storage key, and returns a short-lived presigned PUT URL.

The client sends the file directly to R2 with the exact signed `Content-Type`. The Worker later verifies the object exists and its stored size before marking the upload complete.

For larger files or resumable uploads, R2 multipart is available through the Workers R2 API, but that model proxies each part through the Worker. It is therefore not used for the V1 direct-to-R2 browser path where the Worker must never receive video bytes.
