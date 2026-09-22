import { AwsClient } from "aws4fetch";
import { UPLOAD_URL_TTL_SECONDS } from "@irancaption/shared";

export type R2PresignEnv = {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
};

export async function createPresignedPutUrl(env: R2PresignEnv, key: string, contentType: string, expiresIn = UPLOAD_URL_TTL_SECONDS): Promise<string> {
  const client = new AwsClient({ service: "s3", region: "auto", accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY });
  const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key}`);
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  const signed = await client.sign(new Request(url, { method: "PUT", headers: { "Content-Type": contentType } }), { aws: { signQuery: true } });
  return signed.url.toString();
}
