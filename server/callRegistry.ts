/**
 * Remembers which call ids this server created, and which demo session (page)
 * each belongs to, so transcript streams and scheduling tool calls are routed
 * to the right visitor. In memory only; entries expire after a few hours.
 */
const TTL_MS = 3 * 60 * 60 * 1000;

interface Entry {
  createdAt: number;
  sessionId: string;
}

const calls = new Map<string, Entry>();

export const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function registerCall(callId: string, sessionId: string) {
  calls.set(callId, { createdAt: Date.now(), sessionId });
}

function entry(callId: string): Entry | undefined {
  const e = calls.get(callId);
  if (e && Date.now() - e.createdAt > TTL_MS) {
    calls.delete(callId);
    return undefined;
  }
  return e;
}

export function isKnownCall(callId: string): boolean {
  return !!entry(callId);
}

export function sessionIdForCall(callId: string): string | undefined {
  return entry(callId)?.sessionId;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, e] of calls) if (now - e.createdAt > TTL_MS) calls.delete(id);
}, 10 * 60 * 1000).unref();
