import { config } from "./config.ts";
import { google, zonedToUtc } from "./google.ts";
import { parseDateText, parseTimeText } from "../shared/booking.ts";
import { formatDay, formatMinutes, shopClock } from "../shared/scheduling.ts";

/**
 * Jarvis: a personal assistant on a phone line. Retell custom functions call
 * these to read the owner's Google Calendar and Gmail, add calendar events and
 * save email drafts. Jarvis never sends email: drafts wait in Gmail for the
 * owner to review.
 *
 * Every function first checks the caller (see `isOwnerCall`), because the
 * phone number is public and the data behind it is private.
 */

const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export interface JarvisCall {
  from_number?: string;
  agent_id?: string;
  call_type?: string;
}

const digits = (n: string) => n.replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, "");

/**
 * Only phone calls from the owner's own numbers (and, when configured, to the
 * Jarvis agent) may use these functions. Web calls from the public demo page
 * have no caller number and are always refused.
 */
export function isOwnerCall(call: JarvisCall | undefined): { ok: true } | { ok: false; reason: string } {
  if (config.jarvis.ownerNumbers.length === 0) return { ok: false, reason: "JARVIS_OWNER_NUMBERS is not set" };
  if (config.jarvis.agentId && call?.agent_id !== config.jarvis.agentId) return { ok: false, reason: "not the Jarvis agent" };
  const from = call?.from_number ? digits(call.from_number) : "";
  if (!from) return { ok: false, reason: "no caller number (web call or hidden caller ID)" };
  if (!config.jarvis.ownerNumbers.some((n) => digits(n) === from)) return { ok: false, reason: "caller is not the owner" };
  return { ok: true };
}

export const REFUSED = {
  ok: false,
  message: "ACCESS DENIED: this caller is not the owner. Do not reveal any calendar or email details. Politely say you can't help on this line.",
};

// ─────────────────────────── dates ───────────────────────────

function resolveDay(text: string): { dateISO: string } | null {
  if (!text) return { dateISO: shopClock(config.timeZone).dateISO };
  const d = parseDateText(text, { timeZone: config.timeZone });
  return d ? { dateISO: d.dateISO } : null;
}

function addDays(dateISO: string, n: number) {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function spokenTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: config.timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

// ─────────────────────────── calendar ───────────────────────────

interface GEvent {
  id: string;
  summary?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

async function eventsBetween(start: Date, end: Date): Promise<GEvent[]> {
  const q = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "25",
  });
  const body = await google<{ items?: GEvent[] }>(`${CAL}/events?${q}`);
  return body.items ?? [];
}

function describe(e: GEvent): string {
  const title = e.summary || "Untitled event";
  if (!e.start.dateTime) return `${title} (all day)`;
  return `${spokenTime(e.start.dateTime)} to ${spokenTime(e.end.dateTime!)}: ${title}${e.location ? ` at ${e.location}` : ""}`;
}

/** get_schedule(date?) — the owner's events for one day (default today). */
export async function getSchedule(args: Args) {
  const day = resolveDay(str(args.date));
  if (!day) return { ok: false, message: `Could not understand the date "${str(args.date)}". Ask the owner to say it another way.` };
  const start = zonedToUtc(day.dateISO, 0, config.timeZone);
  const end = zonedToUtc(addDays(day.dateISO, 1), 0, config.timeZone);
  const events = await eventsBetween(start, end);
  const label = formatDay(day.dateISO);
  return {
    ok: true,
    date: day.dateISO,
    events: events.map(describe),
    message: events.length
      ? `${label}: ${events.length} event${events.length > 1 ? "s" : ""}. ${events.map(describe).join(". ")}.`
      : `${label}: nothing on the calendar.`,
  };
}

/**
 * create_event(title, date, time, duration_minutes?, location?, force?)
 * Refuses when the slot overlaps an existing event unless force is true, so
 * Jarvis must read the conflict back and get a clear yes first.
 */
export async function createEvent(args: Args) {
  const title = str(args.title);
  const day = resolveDay(str(args.date));
  const time = parseTimeText(str(args.time));
  const missing = [!title && "title", (!day || !str(args.date)) && "date", !time && "time"].filter(Boolean);
  if (missing.length) return { ok: false, created: false, message: `Missing or unclear: ${missing.join(", ")}. Ask the owner for it.` };
  const rawDuration = Number(args.duration_minutes);
  const duration = Number.isFinite(rawDuration) && rawDuration >= 5 && rawDuration <= 12 * 60 ? Math.round(rawDuration) : 60;
  const startMin = time!.hour24 * 60 + time!.minute;
  const start = zonedToUtc(day!.dateISO, startMin, config.timeZone);
  const end = new Date(start.getTime() + duration * 60_000);
  if (start.getTime() < Date.now() - 5 * 60_000) {
    return { ok: false, created: false, message: "That time is in the past. Confirm the date with the owner." };
  }
  const force = args.force === true || args.force === "true";
  if (!force) {
    const clashes = (await eventsBetween(start, end)).filter((e) => e.start.dateTime);
    if (clashes.length) {
      return {
        ok: false,
        created: false,
        conflict: true,
        message: `NOT CREATED: it overlaps ${clashes.map(describe).join("; ")}. Tell the owner and only call again with force=true if they still want it.`,
      };
    }
  }
  const location = str(args.location);
  const created = await google<{ id: string; htmlLink: string }>(`${CAL}/events`, {
    method: "POST",
    body: JSON.stringify({
      summary: title,
      ...(location ? { location } : {}),
      description: "Added by Jarvis (phone assistant).",
      start: { dateTime: start.toISOString(), timeZone: config.timeZone },
      end: { dateTime: end.toISOString(), timeZone: config.timeZone },
    }),
  });
  return {
    ok: true,
    created: true,
    id: created.id,
    message: `CREATED: "${title}" on ${formatDay(day!.dateISO)} from ${formatMinutes(startMin)} for ${duration} minutes.`,
  };
}

// ─────────────────────────── gmail ───────────────────────────

interface GMessage {
  id: string;
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

/** get_inbox_summary() — unread primary-inbox mail from the last 3 days. */
export async function inboxSummary(_args: Args) {
  const q = new URLSearchParams({ q: "in:inbox category:primary is:unread newer_than:3d", maxResults: "8" });
  const list = await google<{ messages?: { id: string }[]; resultSizeEstimate?: number }>(`${GMAIL}/messages?${q}`);
  const ids = (list.messages ?? []).map((m) => m.id);
  const messages = await Promise.all(
    ids.map((id) =>
      google<GMessage>(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`),
    ),
  );
  const items = messages.map((m) => {
    const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
    const from = h("from").replace(/\s*<[^>]+>/, "").replace(/"/g, "") || "Unknown sender";
    return { from, subject: h("subject") || "(no subject)", snippet: (m.snippet ?? "").slice(0, 160) };
  });
  return {
    ok: true,
    unread: items.length,
    emails: items,
    message: items.length
      ? `${items.length} unread in the primary inbox from the last 3 days. ${items.map((e) => `From ${e.from}: ${e.subject}`).join(". ")}.`
      : "No unread email in the primary inbox from the last 3 days.",
  };
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function base64url(s: string) {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** draft_email(to, subject, body) — saves a Gmail draft. Never sends. */
export async function draftEmail(args: Args) {
  const to = str(args.to).toLowerCase().replace(/\s+/g, "");
  const subject = str(args.subject).replace(/[\r\n]+/g, " ").slice(0, 200);
  const body = str(args.body).slice(0, 5000);
  if (!EMAIL.test(to)) return { ok: false, drafted: false, message: `"${str(args.to)}" is not a valid email address. Spell it back to the owner and ask again.` };
  if (!body) return { ok: false, drafted: false, message: "The email body is empty. Ask the owner what to say." };
  const mime = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject || "(no subject)").toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");
  await google(`${GMAIL}/drafts`, { method: "POST", body: JSON.stringify({ message: { raw: base64url(mime) } }) });
  return { ok: true, drafted: true, message: `DRAFT SAVED (not sent) to ${to}. Tell the owner it's waiting in Gmail drafts for them to review and send.` };
}
