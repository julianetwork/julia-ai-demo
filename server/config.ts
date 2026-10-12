import "dotenv/config";

/** Server-side configuration. Values here never reach the browser. */
const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

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
