export type AuditAction = "LOGIN" | "LOGOUT" | "PASSKEY_REGISTER" | "PASSKEY_REMOVE" | "VIDEO_UPLOAD" | "VIDEO_DELETE" | "JOB_CREATE" | "JOB_CANCEL" | "SUBTITLE_UPDATE" | "SUBTITLE_EXPORT" | "ACCOUNT_DELETE" | "ADMIN_ACTION";

export async function writeAudit(db: D1Database, input: { userId?: string; action: AuditAction; resourceType?: string; resourceId?: string; metadata?: Record<string, unknown>; ipHash?: string }): Promise<void> {
  await db.prepare("INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata_json, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), input.userId ?? null, input.action, input.resourceType ?? null, input.resourceId ?? null, input.metadata ? JSON.stringify(input.metadata) : null, input.ipHash ?? null, new Date().toISOString()).run();
}
