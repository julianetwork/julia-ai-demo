/**
 * Remembers which call ids this server created, so the transcript stream and
 * booking-verification endpoints only work for calls started from this demo.
 * In memory only; entries expire after a few hours.
 */
const TTL_MS = 3 * 60 * 60 * 1000;

interface Entry {
  createdAt: number;
}

const calls = new Map<string, Entry>();

export const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function registerCall(callId: string) {
  calls.set(callId, { createdAt: Date.now() });
}

export function isKnownCall(callId: string): boolean {
  const entry = calls.get(callId);
  if (!entry) return false;
  if (Date.now() - entry.createdAt > TTL_MS) {
    calls.delete(callId);
    return false;
  }
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of calls) if (now - entry.createdAt > TTL_MS) calls.delete(id);
}, 10 * 60 * 1000).unref();
