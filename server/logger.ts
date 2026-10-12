/** Tiny structured logger. Never pass secrets or access tokens to it. */
type Level = "info" | "warn" | "error";

function write(level: Level, scope: string, message: string, extra?: Record<string, unknown>) {
  const time = new Date().toISOString().slice(11, 19);
  const line = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const args = extra && Object.keys(extra).length ? [line, extra] : [line];
  if (level === "error") console.error(...args);
  else if (level === "warn") console.warn(...args);
  else console.log(...args);
}

export const log = {
  info: (scope: string, msg: string, extra?: Record<string, unknown>) => write("info", scope, msg, extra),
  warn: (scope: string, msg: string, extra?: Record<string, unknown>) => write("warn", scope, msg, extra),
  error: (scope: string, msg: string, extra?: Record<string, unknown>) => write("error", scope, msg, extra),
};

/** Shortens ids for logs: call_8f3a…91c2 */
export const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 9)}…${id.slice(-4)}` : id);
