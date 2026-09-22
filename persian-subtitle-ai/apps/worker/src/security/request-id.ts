export function sanitizeRequestId(value: string | undefined): string | null {
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
}
