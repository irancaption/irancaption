export type PasskeyConfig = {
  rpName: string;
  rpID: string;
  origin: string;
};

export function getPasskeyConfig(env: { WEBAUTHN_RP_NAME?: string; WEBAUTHN_RP_ID?: string; WEBAUTHN_ORIGIN?: string }, requestUrl: string): PasskeyConfig {
  const url = new URL(requestUrl);
  const rpID = env.WEBAUTHN_RP_ID?.trim() || url.hostname;
  const origin = env.WEBAUTHN_ORIGIN?.trim() || url.origin;
  const rpName = env.WEBAUTHN_RP_NAME?.trim() || "Persian Subtitle AI";

  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("WebAuthn requires HTTPS outside localhost.");
  }

  return { rpName, rpID, origin };
}
