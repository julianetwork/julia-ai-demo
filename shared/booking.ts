/**
 * Booking extraction for the Julia AI demo.
 *
 * Given the real transcript of a Retell call, decide whether Julia (the agent)
 * genuinely confirmed a simulated appointment, and if so pull out the
 * customer's name, the requested date and the requested time.
 *
 * Design rules (deliberately conservative):
 *  - A booking only counts when the AGENT states a final confirmation
 *    ("you're all set", "your appointment is confirmed", "c'est confirmé"...).
 *    Questions, hypotheticals ("once it's confirmed…") and negations are ignored.
 *  - Name, date and time must all be found, otherwise the result is
 *    "incomplete" — never a fabricated booking.
 *  - A cancellation by the agent after the last confirmation wins.
 *  - English and French are supported because the agent speaks both.
 *
 * This module is pure (no I/O) so it runs on the server for both the live
 * transcript stream and the post-call verification, and is unit-tested.
 */

export interface TranscriptLine {
  role: string;
  content: string;
}

export interface ExtractedBooking {
  customerName: string;
  service: string;
  /** The date as spoken, e.g. "tomorrow", "Friday", "October 16th". */
  dateLabel: string;
  /** Resolved calendar date (YYYY-MM-DD) relative to the call, when possible. */
  dateISO: string | null;
  /** Display time, e.g. "3:30 PM". */
  time: string;
  /** 24-hour time, e.g. "15:30". */
  time24: string;
}

export type MissingField = "name" | "date" | "time";

export type ExtractionResult =
  | { status: "confirmed"; booking: ExtractedBooking; evidence: string }
  | {
      status: "incomplete";
      missing: MissingField[];
      partial: Partial<ExtractedBooking>;
      evidence: string;
    }
  | { status: "not_confirmed"; reason: "empty" | "no_confirmation" | "cancelled" };

export interface ExtractOptions {
  /** Moment the call happened; used to resolve "tomorrow", "Friday"… */
  referenceDate?: Date;
  /** IANA time zone for resolving relative dates. Defaults to local. */
  timeZone?: string;
}

// ───────────────────────────── vocab ─────────────────────────────

const L = "\\p{L}";
const START = `(?<![${L}\\d])`;
const END = `(?![${L}])`;

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11,
  décembre: 12, decembre: 12,
};

const ORDINAL_WORDS: Record<string, number> = (() => {
  const base: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
    eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
    fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
    eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30, premier: 1,
  };
  const units = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];
  units.forEach((u, i) => {
    base[`twenty-${u}`] = 21 + i;
    base[`twenty ${u}`] = 21 + i;
  });
  base["thirty-first"] = 31;
  base["thirty first"] = 31;
  return base;
})();

const HOUR_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
  une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8,
  neuf: 9, dix: 10, onze: 11, douze: 12,
};

const MINUTE_WORDS: Record<string, number> = {
  "o'clock": 0, "o’clock": 0, fifteen: 15, thirty: 30, "forty-five": 45,
  "forty five": 45, "quarter past": 15, "half past": 30,
  "et quart": 15, "et demie": 30, "trente": 30, "quinze": 15,
};

/** Words that look like names after "for …" / "I'm …" but are not names. */
const NAME_STOPWORDS = new Set(
  [
    ...Object.keys(WEEKDAYS), ...Object.keys(MONTHS),
    "today", "tomorrow", "tonight", "morning", "afternoon", "evening", "noon",
    "a", "an", "the", "your", "you", "me", "us", "it", "that", "this", "now",
    "yes", "yeah", "yep", "no", "nope", "okay", "ok", "sure", "thanks", "thank",
    "hi", "hello", "hey", "julia", "just", "here", "there", "good", "fine",
    "great", "perfect", "sorry", "well", "so", "um", "uh", "hmm", "actually",
    "looking", "calling", "interested", "hoping", "trying", "going", "wanting",
    "booking", "booked", "appointment", "haircut", "haircuts", "cut", "trim",
    "beard", "fade", "shave", "service", "barber", "barbershop", "everything",
    "all", "set", "confirmed", "available", "free", "ready", "new", "back",
    "not", "very", "really", "glad", "happy", "excited", "next", "coming",
    "oui", "non", "bonjour", "salut", "merci", "bien", "d'accord", "parfait",
    "votre", "vous", "moi", "un", "une", "le", "la", "les", "demain",
    "aujourd'hui", "rendez-vous", "coupe", "barbe", "midi", "matin", "soir",
    "intéressé", "intéressée", "là", "prêt", "prête", "désolé", "désolée",
    "mister", "mr", "mrs", "ms", "sir", "madam", "monsieur", "madame",
    "i", "we", "our", "my", "for", "to", "in", "on", "at", "and", "or", "is",
    "can", "let", "what", "how", "would", "will", "pour", "de", "à", "et",
    "je", "j'ai", "il", "elle", "nous", "ça", "ce", "quoi", "comment",
  ].map((w) => w.toLowerCase()),
);

// ─────────────────────── confirmation detection ───────────────────────

const CONFIRM_PATTERNS: RegExp[] = [
  // English
  /\byou(?:'re| are)\s+(?:all\s+)?(?:set|booked|confirmed|scheduled|good to go)\b/i,
  /\b(?:is|are|has been|have been|'s)\s+(?:now\s+|officially\s+|all\s+)?(?:confirmed|booked|scheduled|reserved|locked in)\b/i,
  /\bi(?:'ve| have)\s+(?:now\s+|just\s+|gone ahead and\s+)?(?:booked|scheduled|reserved|confirmed|locked)\b/i,
  /\b(?:booking|appointment|reservation)\s+(?:is\s+)?confirmed\b/i,
  /\bconfirmed for\b/i,
  /\ball booked\b/i,
  // French
  /c(?:'|’)est\s+(?:bien\s+|donc\s+)?(?:confirmé|réservé|noté|enregistré)/i,
  /(?:est|a été|sont|ont été)\s+(?:bien\s+|donc\s+)?(?:confirmée?s?|réservée?s?|enregistrée?s?|planifiée?s?)/i,
  /j(?:'|’)ai\s+(?:bien\s+|donc\s+)?(?:réservé|confirmé|enregistré|noté|planifié)/i,
  /vous êtes\s+(?:bien\s+)?(?:inscrite?|réservée?|confirmée?)/i,
  /rendez-vous\s+(?:est\s+)?confirmé/i,
];

const NEGATED_CONFIRM =
  /(?:\bnot|n't|\bnever)\s+(?:yet\s+)?(?:been\s+)?(?:confirmed|booked|scheduled|reserved)|\b(?:unable to|can't|cannot|couldn't|could not)\s+(?:book|confirm|schedule|reserve)|n(?:'|’)est pas|ne sont pas|pas (?:encore )?(?:confirmé|réservé)|impossible de (?:réserver|confirmer)/i;

const HYPOTHETICAL =
  /\b(?:before|once|when|if|after|until|as soon as|whether)\b|\b(?:avant(?: que| de)?|dès que|lorsque|quand|une fois que)\b|\bsi\b/i;

/** "Appointments are booked automatically…" describes a feature, not a booking. */
const GENERIC_SUBJECT =
  /\b(?:appointments|bookings|reservations|customers|clients|calls|everyone|les rendez-vous|vos clients)\b/i;

const CANCELLED =
  /\b(?:cancel(?:l)?ed|cancelled it|removed (?:the|your) (?:booking|appointment))\b|annulée?s?\b/i;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Returns the confirming sentence if this agent utterance is a final confirmation. */
export function findConfirmationSentence(text: string): string | null {
  for (const sentence of splitSentences(text)) {
    if (sentence.endsWith("?")) continue;
    if (NEGATED_CONFIRM.test(sentence)) continue;
    for (const pattern of CONFIRM_PATTERNS) {
      const m = pattern.exec(sentence);
      if (!m) continue;
      const before = sentence.slice(0, m.index);
      if (HYPOTHETICAL.test(before) || GENERIC_SUBJECT.test(before)) continue;
      return sentence;
    }
  }
  return null;
}

// ─────────────────────────── date parsing ───────────────────────────

interface YMD {
  y: number;
  m: number;
  d: number;
}

interface DateMention {
  index: number;
  label: string;
  explicit: boolean;
  resolve: (today: YMD) => YMD | null;
}

function ymdInZone(date: Date, timeZone?: string): YMD {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function toUTC({ y, m, d }: YMD): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(ymd: YMD, days: number): YMD {
  const t = toUTC(ymd);
  t.setUTCDate(t.getUTCDate() + days);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function isValidYMD({ y, m, d }: YMD): boolean {
  const t = toUTC({ y, m, d });
  return t.getUTCFullYear() === y && t.getUTCMonth() + 1 === m && t.getUTCDate() === d;
}

export function formatISO({ y, m, d }: YMD): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const WEEKDAY_ALT = Object.keys(WEEKDAYS).join("|");
const ORDINAL_ALT = Object.keys(ORDINAL_WORDS).sort((a, b) => b.length - a.length).join("|");
const DAY_NUM = `(\\d{1,2})(?:st|nd|rd|th|er|e)?|(${ORDINAL_ALT})`;

const RE_MONTH_DAY = new RegExp(`${START}(${MONTH_ALT})\\.?\\s+(?:the\\s+)?(?:${DAY_NUM})${END}`, "giu");
const RE_DAY_MONTH = new RegExp(`${START}(?:the\\s+|le\\s+)?(?:${DAY_NUM})\\s+(?:of\\s+)?(${MONTH_ALT})${END}`, "giu");
const RE_RELATIVE = new RegExp(
  `${START}(day after tomorrow|après-demain|apres-demain|aujourd(?:'|’)hui|tomorrow|today|tonight|this evening|this afternoon|this morning|demain|ce soir|cet après-midi|ce matin)${END}`,
  "giu",
);
const RE_WEEKDAY = new RegExp(
  `${START}(?:(next|this|coming|this coming)\\s+)?(${WEEKDAY_ALT})(?:\\s+(prochain))?${END}`,
  "giu",
);
const RE_DAY_ONLY = new RegExp(`${START}the\\s+(\\d{1,2})(?:st|nd|rd|th)${END}(?!\\s+(?:of\\s+)?(?:${MONTH_ALT}))`, "giu");

function dayFrom(numeric: string | undefined, word: string | undefined): number | null {
  if (numeric) return Number(numeric);
  if (word) return ORDINAL_WORDS[word.toLowerCase()] ?? null;
  return null;
}

function resolveMonthDay(month: number, day: number) {
  return (today: YMD): YMD | null => {
    let candidate = { y: today.y, m: month, d: day };
    if (!isValidYMD(candidate)) return null;
    // A date more than a week in the past means next year ("January 3rd" said in December).
    if (toUTC(candidate).getTime() < toUTC(addDays(today, -7)).getTime()) {
      candidate = { ...candidate, y: today.y + 1 };
    }
    return isValidYMD(candidate) ? candidate : null;
  };
}

function findDateMentions(text: string): DateMention[] {
  const mentions: DateMention[] = [];
  for (const m of text.matchAll(RE_MONTH_DAY)) {
    const month = MONTHS[m[1].toLowerCase()];
    const day = dayFrom(m[2], m[3]);
    if (!month || !day || day > 31) continue;
    mentions.push({ index: m.index!, label: m[0], explicit: true, resolve: resolveMonthDay(month, day) });
  }
  for (const m of text.matchAll(RE_DAY_MONTH)) {
    const month = MONTHS[m[3].toLowerCase()];
    const day = dayFrom(m[1], m[2]);
    if (!month || !day || day > 31) continue;
    mentions.push({ index: m.index!, label: m[0], explicit: true, resolve: resolveMonthDay(month, day) });
  }
  for (const m of text.matchAll(RE_RELATIVE)) {
    const word = m[1].toLowerCase().replace("’", "'");
    const offset =
      word === "day after tomorrow" || word.startsWith("apr") ? 2
      : word === "tomorrow" || word === "demain" ? 1
      : 0;
    mentions.push({ index: m.index!, label: m[0], explicit: false, resolve: (t) => addDays(t, offset) });
  }
  for (const m of text.matchAll(RE_WEEKDAY)) {
    const target = WEEKDAYS[m[2].toLowerCase()];
    const modifier = (m[1] || "").toLowerCase();
    mentions.push({
      index: m.index!,
      label: m[0],
      explicit: false,
      resolve: (today) => {
        const todayW = toUTC(today).getUTCDay();
        let diff = (target - todayW + 7) % 7;
        if (diff === 0 && modifier !== "this") diff = 7;
        return addDays(today, diff);
      },
    });
  }
  for (const m of text.matchAll(RE_DAY_ONLY)) {
    const day = Number(m[1]);
    if (!day || day > 31) continue;
    mentions.push({
      index: m.index!,
      label: m[0],
      explicit: false,
      resolve: (today) => {
        const thisMonth = { y: today.y, m: today.m, d: day };
        if (isValidYMD(thisMonth) && day >= today.d) return thisMonth;
        const nm = today.m === 12 ? { y: today.y + 1, m: 1 } : { y: today.y, m: today.m + 1 };
        const next = { ...nm, d: day };
        return isValidYMD(next) ? next : null;
      },
    });
  }
  return mentions.sort((a, b) => a.index - b.index);
}

/** Picks the most reliable date mention in one utterance (explicit dates win). */
function pickDate(text: string): DateMention | null {
  const mentions = findDateMentions(text);
  if (!mentions.length) return null;
  const explicit = mentions.filter((m) => m.explicit);
  return (explicit.length ? explicit : mentions).at(-1)!;
}

// ─────────────────────────── time parsing ───────────────────────────

interface TimeMention {
  index: number;
  hour24: number;
  minute: number;
}

const HOUR_WORD_ALT = Object.keys(HOUR_WORDS).join("|");
const MINUTE_WORD_ALT = Object.keys(MINUTE_WORDS)
  .filter((k) => !k.includes("past"))
  .sort((a, b) => b.length - a.length)
  .join("|");

const AM = /^a\.?\s?m\.?$/i;
const RE_DIGIT_AMPM = new RegExp(`${START}(\\d{1,2})(?:[:.h](\\d{2}))?\\s*(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)(?![${L}])`, "giu");
const RE_DIGIT_24 = new RegExp(`${START}(\\d{1,2}):(\\d{2})(?!\\d)`, "gu");
const RE_FRENCH_H = new RegExp(`${START}(\\d{1,2})\\s?(?:h|heures?)(?:\\s?(\\d{2}))?${END}`, "giu");
const RE_WORD_TIME = new RegExp(
  `${START}(?:(half past|quarter past)\\s+)?(${HOUR_WORD_ALT})(?:\\s+(${MINUTE_WORD_ALT}))?\\s*(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?|o(?:'|’)clock|heures?|in the (?:morning|afternoon|evening)|du matin|de l(?:'|’)après-midi|du soir)${END}`,
  "giu",
);
const RE_NOON = new RegExp(`${START}(noon|midday|midi)${END}`, "giu");
const RE_AT_HOUR = new RegExp(
  `${START}(?:at|à)\\s+(\\d{1,2})(?:[:.](\\d{2}))?(?![\\d:.]|\\s*(?:%|minutes?|hours?|days?|weeks?|people|persons?|barbers?|chairs?|locations?|ans|jours?|personnes?)${END})`,
  "giu",
);
const RE_DIGIT_OCLOCK = new RegExp(`${START}(\\d{1,2})\\s+o(?:'|’)clock${END}`, "giu");

/** Barbershop-hours heuristic when am/pm is not stated: 8–11 → morning, otherwise afternoon. */
function inferHour(hour: number, context: string): number {
  if (hour >= 13) return hour;
  if (/(morning|matin|a\.?\s?m)/i.test(context)) return hour === 12 ? 0 : hour;
  if (/(afternoon|evening|après-midi|soir|p\.?\s?m)/i.test(context)) return hour === 12 ? 12 : hour + 12;
  if (hour === 12) return 12;
  return hour >= 8 ? hour : hour + 12;
}

function findTimeMentions(text: string): TimeMention[] {
  const out: TimeMention[] = [];
  const taken: Array<[number, number]> = [];
  const free = (i: number, len: number) => !taken.some(([s, e]) => i < e && i + len > s);
  const push = (i: number, len: number, hour24: number, minute: number) => {
    if (hour24 < 0 || hour24 > 23 || minute < 0 || minute > 59 || !free(i, len)) return;
    taken.push([i, i + len]);
    out.push({ index: i, hour24, minute });
  };

  for (const m of text.matchAll(RE_DIGIT_AMPM)) {
    const h = Number(m[1]);
    if (h < 1 || h > 12) continue;
    const isAm = AM.test(m[3].replace(/\s/g, ""));
    push(m.index!, m[0].length, isAm ? h % 12 : (h % 12) + 12, Number(m[2] || 0));
  }
  for (const m of text.matchAll(RE_WORD_TIME)) {
    let h = HOUR_WORDS[m[2].toLowerCase()];
    let min = m[3] ? (MINUTE_WORDS[m[3].toLowerCase()] ?? 0) : 0;
    if (m[1]) min = m[1].toLowerCase().startsWith("half") ? 30 : 15;
    const suffix = m[4].toLowerCase();
    if (/^a/.test(suffix) || /morning|matin/.test(suffix)) h = h % 12;
    else if (/^p/.test(suffix) || /afternoon|evening|après-midi|soir/.test(suffix)) h = (h % 12) + 12;
    else h = inferHour(h, text.slice(m.index!, m.index! + m[0].length + 30));
    push(m.index!, m[0].length, h, min);
  }
  for (const m of text.matchAll(RE_FRENCH_H)) {
    const h = Number(m[1]);
    const ctx = text.slice(m.index!, m.index! + m[0].length + 30);
    push(m.index!, m[0].length, inferHour(h, ctx), Number(m[2] || 0));
  }
  for (const m of text.matchAll(RE_DIGIT_24)) {
    const ctx = text.slice(m.index!, m.index! + m[0].length + 30);
    push(m.index!, m[0].length, inferHour(Number(m[1]), ctx), Number(m[2]));
  }
  for (const m of text.matchAll(RE_DIGIT_OCLOCK)) {
    const ctx = text.slice(m.index!, m.index! + m[0].length + 30);
    push(m.index!, m[0].length, inferHour(Number(m[1]), ctx), 0);
  }
  for (const m of text.matchAll(RE_NOON)) push(m.index!, m[0].length, 12, 0);
  for (const m of text.matchAll(RE_AT_HOUR)) {
    const h = Number(m[1]);
    if (h < 1 || h > 23) continue;
    const ctx = text.slice(m.index!, m.index! + m[0].length + 30);
    push(m.index!, m[0].length, inferHour(h, ctx), Number(m[2] || 0));
  }
  return out.sort((a, b) => a.index - b.index);
}

function pickTime(text: string): TimeMention | null {
  return findTimeMentions(text).at(-1) ?? null;
}

export function formatTime(hour24: number, minute: number): { display: string; h24: string } {
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    display: `${h12}:${String(minute).padStart(2, "0")} ${suffix}`,
    h24: `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

// ─────────────────────────── name parsing ───────────────────────────

const NAME_TOKEN = `[\\p{Lu}][\\p{L}'’-]*`;

/** Makes a literal phrase case-insensitive while the rest of the regex stays case-sensitive. */
function caseless(src: string): string {
  return src.replace(/\\.|\p{L}/gu, (ch) => {
    if (ch.startsWith("\\")) return ch;
    const lo = ch.toLowerCase();
    const up = ch.toUpperCase();
    return lo === up ? ch : `[${lo}${up}]`;
  });
}
const NAME_QUESTION =
  /\b(?:your (?:full |first )?name|name (?:for|on|under) (?:the|this|your) (?:booking|appointment|reservation)|who (?:should|shall|do|can) i (?:put|book)|(?:may|can|could) i (?:have|get|grab) (?:a|the|your) name|what(?:'s| is) the name)\b|votre (?:nom|prénom)|(?:à|a) quel nom|vous appelez|quel est votre (?:nom|prénom)|c(?:'|’)est à quel nom/i;

const SELF_INTRO = new RegExp(
  `(?<![\\p{L}])` +
    caseless(`(?:my name is|my name's|name is|this is|i am|i'm|it's|it is|call me|je m(?:'|’)appelle|mon nom est|mon nom c(?:'|’)est|moi c(?:'|’)est|c(?:'|’)est)`) + `\\s+(${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,2})`,
  "gu",
);

const AGENT_NAME_REF = new RegExp(
  caseless(`(?:\\bfor|\\bpour|\\bunder|thanks,?|thank you,?|merci,?|perfect,?|great,?|parfait,?|nice to meet you,?|enchantée?,?|got it,?)`) +
    `\\s+(${NAME_TOKEN}(?:\\s+${NAME_TOKEN})?)`,
  "gu",
);

const FILLERS =
  /^(?:(?:yes|yeah|yep|sure|ok|okay|so|um+|uh+|well|hi|hello|oh|alright|oui|alors|euh+|bon|bien sûr|d'accord)[\s,.!]+)+/i;

function cleanName(raw: string): string | null {
  const tokens = raw
    .replace(/[.,!?;:]+$/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const kept: string[] = [];
  for (const tok of tokens) {
    const bare = tok.replace(/[.,!?;:]/g, "");
    if (!bare || NAME_STOPWORDS.has(bare.toLowerCase())) break;
    if (!/^[\p{L}'’-]+$/u.test(bare)) break;
    kept.push(bare);
    if (kept.length === 3) break;
  }
  if (!kept.length) return null;
  return kept
    .map((t) => t.charAt(0).toLocaleUpperCase() + t.slice(1))
    .join(" ");
}

/** Name given in direct answer to "what's your name?" */
function answerName(answer: string): string | null {
  let text = answer.trim().replace(FILLERS, "");
  const intro = new RegExp(SELF_INTRO.source, "u").exec(text);
  if (intro) return cleanName(intro[1]);
  text = text.replace(/^(?:it(?:'s| is)|my name(?:'s| is)|this is|c(?:'|’)est|je m(?:'|’)appelle|i(?:'m| am))\s+/i, "");
  // Short answers only — a long sentence is probably not just a name.
  const firstSentence = splitSentences(text)[0] ?? "";
  if (firstSentence.split(/\s+/).length > 4) return null;
  return cleanName(firstSentence);
}

function findName(lines: TranscriptLine[], windowStart: number, confirmIdx: number): string | null {
  const userText = lines.filter((l) => l.role === "user").map((l) => l.content.toLowerCase()).join(" ");

  // 1. Agent recap near the confirmation, cross-checked against what the user said.
  for (let i = confirmIdx; i >= windowStart; i--) {
    if (lines[i].role !== "agent") continue;
    const refs = [...lines[i].content.matchAll(AGENT_NAME_REF)];
    for (const ref of refs.reverse()) {
      const name = cleanName(ref[1]);
      if (name && userText.includes(name.split(" ")[0].toLowerCase())) return name;
    }
  }
  // 2. The user's answer right after Julia asked for a name (latest wins).
  for (let i = confirmIdx; i >= 1; i--) {
    if (lines[i].role === "user" && lines[i - 1].role === "agent" && NAME_QUESTION.test(lines[i - 1].content)) {
      const name = answerName(lines[i].content);
      if (name) return name;
    }
  }
  // 3. A self-introduction anywhere ("my name is …", "je m'appelle …").
  for (let i = confirmIdx; i >= 0; i--) {
    if (lines[i].role !== "user") continue;
    const intros = [...lines[i].content.matchAll(SELF_INTRO)];
    for (const intro of intros.reverse()) {
      const name = cleanName(intro[1]);
      if (name) return name;
    }
  }
  // 4. Agent recap alone (spelled the way Julia understood it).
  for (let i = confirmIdx; i >= windowStart; i--) {
    if (lines[i].role !== "agent") continue;
    const refs = [...lines[i].content.matchAll(AGENT_NAME_REF)];
    for (const ref of refs.reverse()) {
      const name = cleanName(ref[1]);
      if (name) return name;
    }
  }
  return null;
}

// ────────────────────────── service parsing ──────────────────────────

const SERVICES: Array<[RegExp, string]> = [
  [/haircut and (?:a )?beard|cut (?:and|&) beard|coupe et (?:la )?barbe/i, "Haircut & beard"],
  [/kids?(?:'|’)? ?cut|children(?:'|’)?s cut|coupe (?:pour )?enfant/i, "Kids cut"],
  [/beard trim|beard|taille de (?:la )?barbe|barbe/i, "Beard trim"],
  [/hot towel|shave|rasage/i, "Hot towel shave"],
  [/skin fade|fade|dégradé/i, "Fade"],
  [/line[- ]?up|edge[- ]?up/i, "Line-up"],
  [/haircut|hair cut|trim|coupe/i, "Haircut"],
];

function findService(lines: TranscriptLine[], upTo: number): string {
  for (let i = upTo; i >= 0; i--) {
    for (const [re, label] of SERVICES) if (re.test(lines[i].content)) return label;
  }
  return "Haircut";
}

// ───────────────────────────── main ─────────────────────────────

const DETAIL_WINDOW = 8;

export function extractBooking(
  transcript: TranscriptLine[],
  options: ExtractOptions = {},
): ExtractionResult {
  const lines = transcript.filter(
    (l): l is TranscriptLine =>
      !!l && (l.role === "agent" || l.role === "user") && typeof l.content === "string" && l.content.trim() !== "",
  );
  if (!lines.length) return { status: "not_confirmed", reason: "empty" };

  let confirmIdx = -1;
  let evidence = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].role !== "agent") continue;
    const sentence = findConfirmationSentence(lines[i].content);
    if (sentence) {
      confirmIdx = i;
      evidence = sentence;
      break;
    }
  }
  if (confirmIdx < 0) return { status: "not_confirmed", reason: "no_confirmation" };

  // The agent cancelled after the last confirmation.
  for (let i = confirmIdx + 1; i < lines.length; i++) {
    if (lines[i].role === "agent" && CANCELLED.test(lines[i].content)) {
      return { status: "not_confirmed", reason: "cancelled" };
    }
  }

  const windowStart = Math.max(0, confirmIdx - DETAIL_WINDOW);
  // Search order: the confirmation itself, then Julia's recap, then what the caller said.
  const order: number[] = [confirmIdx];
  for (let i = confirmIdx - 1; i >= windowStart; i--) if (lines[i].role === "agent") order.push(i);
  for (let i = confirmIdx; i >= windowStart; i--) if (lines[i].role === "user") order.push(i);

  let date: DateMention | null = null;
  let time: TimeMention | null = null;
  for (const i of order) {
    date ??= pickDate(lines[i].content);
    time ??= pickTime(lines[i].content);
    if (date && time) break;
  }

  const customerName = findName(lines, windowStart, confirmIdx);
  const service = findService(lines, confirmIdx);

  const today = ymdInZone(options.referenceDate ?? new Date(), options.timeZone);
  const resolved = date ? date.resolve(today) : null;
  const t = time ? formatTime(time.hour24, time.minute) : null;

  const partial: Partial<ExtractedBooking> = { service };
  if (customerName) partial.customerName = customerName;
  if (date) {
    partial.dateLabel = date.label.trim();
    partial.dateISO = resolved ? formatISO(resolved) : null;
  }
  if (t) {
    partial.time = t.display;
    partial.time24 = t.h24;
  }

  const missing: MissingField[] = [];
  if (!customerName) missing.push("name");
  if (!date) missing.push("date");
  if (!t) missing.push("time");
  if (missing.length) return { status: "incomplete", missing, partial, evidence };

  return { status: "confirmed", booking: partial as ExtractedBooking, evidence };
}

// ───────────────────── parsing for tool arguments ─────────────────────

/**
 * Resolves a date as given to a scheduling tool: "2026-10-16", "tomorrow",
 * "Friday", "October 16th", "vendredi"… Returns null when not understood.
 */
export function parseDateText(text: string, options: ExtractOptions = {}): { dateISO: string; label: string } | null {
  const trimmed = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const ymd = { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
    return isValidYMD(ymd) ? { dateISO: formatISO(ymd), label: trimmed } : null;
  }
  const mention = pickDate(trimmed);
  if (!mention) return null;
  const resolved = mention.resolve(ymdInZone(options.referenceDate ?? new Date(), options.timeZone));
  return resolved ? { dateISO: formatISO(resolved), label: mention.label.trim() } : null;
}

/** Parses a start time such as "8:00 PM", "20:00", "15 h 30", "noon". */
export function parseTimeText(text: string): { hour24: number; minute: number } | null {
  const t = pickTime(text.trim());
  return t ? { hour24: t.hour24, minute: t.minute } : null;
}
