import { config } from "./config.ts";
import { eventsOnDay, shortEvent, inboxSummary } from "./jarvis.ts";
import { formatDay, shopClock } from "../shared/scheduling.ts";

/**
 * Daily briefing: today's calendar plus unread mail, short enough for one
 * text (or for Jarvis to read out at the start of a call). Triggered by
 * POST /api/jarvis/briefing, typically from a scheduler each morning.
 */

/** Keeps the text to a handful of SMS segments; carriers split anything longer. */
export const BRIEFING_MAX = 600;
/** One long event title or subject must not crowd out everything else. */
const ITEM_MAX = 70;
/** Room kept for the email section so a packed calendar can't push it out entirely. */
const EMAIL_RESERVE = 40;

export interface BriefingInput {
  /** "Sunday, November 22" */
  dayLabel: string;
  /** Hour of day in the owner's time zone, for the greeting. */
  hour: number;
  events: string[];
  emails: { from: string; subject: string }[];
}

// Plain text only: collapse whitespace and drop markdown emphasis so the text
// reads the same in any SMS app and when spoken.
const clean = (s: string, max = ITEM_MAX) => {
  const t = s.replace(/[*`]+/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t;
};

/**
 * Joins as many items as fit in `budget` characters with "; ", adding
 * " +N more" for the rest. Never cuts an item in half.
 */
function fitList(items: string[], budget: number): string {
  for (let shown = items.length; shown >= 0; shown--) {
    const rest = items.length - shown;
    const head = items.slice(0, shown).join("; ");
    const text = rest ? `${head}${head ? " " : ""}+${rest} more` : head;
    if (text.length <= budget) return text;
  }
  return `+${items.length} more`;
}

/** Pure formatter, so the wording and length cap are testable without Google. */
export function formatBriefing(input: BriefingInput): string {
  const greeting = input.hour < 12 ? "Good morning." : input.hour < 18 ? "Good afternoon." : "Good evening.";
  const events = input.events.map((e) => clean(e));
  const emails = input.emails.map((e) => clean(`${clean(e.from, 30)}: ${clean(e.subject)}`));

  // Calendar first: it gets everything except a small reserve for email.
  const calPrefix = `${greeting} ${input.dayLabel}: `;
  const calendar = events.length
    ? `${calPrefix}${fitList(events, BRIEFING_MAX - calPrefix.length - 1 - EMAIL_RESERVE)}.`
    : `${greeting} ${input.dayLabel}: nothing on the calendar.`;

  // ASCII only on purpose: one non-GSM character (like an em dash) makes the
  // whole SMS Unicode, which cuts each segment from 160 to 70 characters.
  const mailPrefix = ` Unread (${emails.length}): `;
  const mail = emails.length
    ? `${mailPrefix}${fitList(emails, BRIEFING_MAX - calendar.length - mailPrefix.length - 1)}.`
    : " No unread email.";

  return `${calendar}${mail}`.slice(0, BRIEFING_MAX);
}

/** Reads today's calendar and unread inbox from Google and formats the briefing. */
export async function buildBriefing(now = new Date()): Promise<string> {
  const clock = shopClock(config.timeZone, now);
  const [events, inbox] = await Promise.all([eventsOnDay(clock.dateISO), inboxSummary({})]);
  return formatBriefing({
    dayLabel: formatDay(clock.dateISO),
    hour: Math.floor(clock.minutes / 60),
    events: events.map(shortEvent),
    emails: inbox.emails,
  });
}
