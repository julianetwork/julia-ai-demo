import "dotenv/config";
import { DEFAULT_HOURS, parseBusinessHours } from "../shared/scheduling.ts";

/** Server-side configuration. Values here never reach the browser. */
const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * How many reverse proxies sit in front of the app, so rate limiting sees the
 * real visitor IP. Locally: none. On Render/Railway/Fly: set TRUST_PROXY=true.
 */
function parseTrustProxy(value: string | undefined): boolean | number | string {
  const v = (value ?? "").trim();
  if (!v) return "loopback";
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

const apiKey = (process.env.RETELL_API_KEY ?? "").trim();
const placeholder = !apiKey || apiKey === "your_retell_secret_api_key_here";

export const config = {
  port: num(process.env.PORT, 8787),
  isProduction: process.env.NODE_ENV === "production",
  retellApiKey: placeholder ? "" : apiKey,
  retellAgentId: (process.env.RETELL_AGENT_ID ?? "").trim() || "agent_022698413456f29efd82adef26",
  rateLimit: {
    max: num(process.env.CALL_RATE_LIMIT_MAX, 6),
    windowMs: num(process.env.CALL_RATE_LIMIT_WINDOW_MINUTES, 10) * 60_000,
  },
  /** Optional shared secret Retell sends in the X-Julia-Tool-Secret header of function calls. */
  toolSecret: (process.env.RETELL_TOOL_SECRET ?? "").trim(),
  businessHours: parseBusinessHours(process.env.BUSINESS_HOURS) ?? DEFAULT_HOURS,
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  timeZone: process.env.DEMO_TIMEZONE?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone,
};

export const isRetellConfigured = () => config.retellApiKey !== "";

/** Validates the time zone early so a typo fails loudly at startup, not mid-demo. */
try {
  new Intl.DateTimeFormat("en-CA", { timeZone: config.timeZone });
} catch {
  console.warn(`[config] DEMO_TIMEZONE "${config.timeZone}" is not a valid IANA zone; using UTC.`);
  config.timeZone = "UTC";
}

if (process.env.BUSINESS_HOURS && !parseBusinessHours(process.env.BUSINESS_HOURS)) {
  console.warn(`[config] BUSINESS_HOURS "${process.env.BUSINESS_HOURS}" is invalid (use HH:MM-HH:MM); using 09:00-22:00.`);
}
