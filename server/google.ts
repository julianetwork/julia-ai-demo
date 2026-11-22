import { config } from "./config.ts";

/**
 * Minimal Google API client for Jarvis (Calendar + Gmail), using the owner's
 * OAuth refresh token. No SDK dependency: plain fetch against the REST APIs.
 * Credentials come from GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
 * GOOGLE_REFRESH_TOKEN (see `npm run google:auth`) and never leave the server.
 */

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = (...a) => fetch(...a);
/** Tests swap in a fake Google. */
export function setGoogleFetch(f: FetchLike | null) {
  fetchImpl = f ?? ((...a) => fetch(...a));
  cached = null;
}

export const isGoogleConfigured = () =>
  Boolean(config.google.clientId && config.google.clientSecret && config.google.refreshToken);

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (!isGoogleConfigured()) throw new GoogleError("Google is not connected (GOOGLE_* variables missing).", 503);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      refresh_token: config.google.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new GoogleError(`Google token refresh failed (${res.status}). Re-run npm run google:auth.`, res.status);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

export async function google<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const res = await fetchImpl(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  if (!res.ok) throw new GoogleError(`Google API ${res.status} for ${new URL(url).pathname}`, res.status);
  return (await res.json()) as T;
}

// ─────────────────────────── time zone helpers ───────────────────────────

/** Converts a wall-clock time in `timeZone` to a UTC Date (DST-safe). */
export function zonedToUtc(dateISO: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const seen = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    guess += wall - seen;
  }
  return new Date(guess);
}
