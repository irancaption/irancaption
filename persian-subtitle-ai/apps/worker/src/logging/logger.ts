export type LogContext = {
  requestId?: string;
  userId?: string;
  route?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  jobId?: string;
  videoId?: string;
  stage?: string;
  attempt?: number;
  provider?: string;
};

function write(level: "info" | "warn" | "error", message: string, context: LogContext): void {
  const record = { level, message, ...context, timestamp: new Date().toISOString() };
  console[level](JSON.stringify(record));
}

export const logger = {
  info: (message: string, context: LogContext = {}) => write("info", message, context),
  warn: (message: string, context: LogContext = {}) => write("warn", message, context),
  error: (message: string, context: LogContext = {}) => write("error", message, context)
};
