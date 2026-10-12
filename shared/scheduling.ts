/**
 * Appointment scheduling rules for the Julia AI demo.
 *
 *  - Every appointment occupies exactly SLOT_MINUTES (60): [start, start + 60).
 *    An 8:00 PM booking blocks 8:00 PM up to, but not including, 9:00 PM.
 *  - Two appointments on the same date may not overlap at all; back-to-back
 *    appointments (one ends exactly when the next begins) are allowed.
 *  - Requests must fall within business hours and must not be in the past,
 *    both judged in the barbershop's configured time zone.
 *
 * Pure functions with no I/O: the server uses them to validate every booking,
 * and the dashboard uses them to display slot ranges and the next open slot.
 */

export const SLOT_MINUTES = 60;

export interface Slot {
  /** Calendar date in the shop's time zone, YYYY-MM-DD. */
  dateISO: string;
  /** Start time as minutes after midnight in the shop's time zone. */
  startMinutes: number;
}

export interface BookedSlot extends Slot {
  id: string;
}

export interface BusinessHours {
  /** Opening time, minutes after midnight. */
  open: number;
  /** Closing time, minutes after midnight. The last bookable start is close − 60. */
  close: number;
}

export interface ShopClock {
  dateISO: string;
  minutes: number;
}

export type UnavailableReason = "conflict" | "outside_hours" | "in_past";

export type AvailabilityResult =
  | { available: true; slot: Slot }
  | {
      available: false;
      slot: Slot;
      reason: UnavailableReason;
      /** The confirmed appointment the request overlaps, for "conflict". */
      conflictsWith?: BookedSlot;
      /** Valid, non-overlapping alternatives, nearest to the request first. */
      alternatives: Slot[];
    };

export interface AvailabilityOptions {
  hours: BusinessHours;
  /** Current date/time in the shop's time zone. */
  now: ShopClock;
  maxAlternatives?: number;
  /** Granularity of suggested start times. */
  stepMinutes?: number;
  /** Ignore this appointment (used when rescheduling it). */
  ignoreId?: string;
}

export const DEFAULT_HOURS: BusinessHours = { open: 9 * 60, close: 22 * 60 };

// ───────────────────────────── basics ─────────────────────────────

export function slotEnd(slot: Slot): number {
  return slot.startMinutes + SLOT_MINUTES;
}

/** True when the two 60-minute intervals share any time on the same date. */
export function overlaps(a: Slot, b: Slot): boolean {
  return a.dateISO === b.dateISO && a.startMinutes < slotEnd(b) && b.startMinutes < slotEnd(a);
}

export function isWithinHours(slot: Slot, hours: BusinessHours): boolean {
  return slot.startMinutes >= hours.open && slotEnd(slot) <= hours.close;
}

export function isInPast(slot: Slot, now: ShopClock): boolean {
  return slot.dateISO < now.dateISO || (slot.dateISO === now.dateISO && slot.startMinutes <= now.minutes);
}

export function compareSlots(a: Slot, b: Slot): number {
  return a.dateISO === b.dateISO ? a.startMinutes - b.startMinutes : a.dateISO < b.dateISO ? -1 : 1;
}

function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Current date and minutes-after-midnight in an IANA time zone. */
export function shopClock(timeZone: string, at: Date = new Date()): ShopClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    dateISO: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

// ─────────────────────────── availability ───────────────────────────

function usable(slot: Slot, booked: BookedSlot[], opts: AvailabilityOptions): boolean {
  return (
    isWithinHours(slot, opts.hours) &&
    !isInPast(slot, opts.now) &&
    !booked.some((b) => b.id !== opts.ignoreId && overlaps(b, slot))
  );
}

/**
 * Free start times nearest to the request: the same day first (closest
 * first, later on ties), then the following days, up to `maxAlternatives`.
 */
export function findAlternatives(booked: BookedSlot[], requested: Slot, opts: AvailabilityOptions): Slot[] {
  const max = opts.maxAlternatives ?? 3;
  const step = opts.stepMinutes ?? 30;
  const result: Slot[] = [];
  for (let day = 0; day < 14 && result.length < max; day++) {
    const dateISO = addDaysISO(requested.dateISO, day);
    const candidates: Slot[] = [];
    for (let m = opts.hours.open; m + SLOT_MINUTES <= opts.hours.close; m += step) {
      const slot = { dateISO, startMinutes: m };
      if (usable(slot, booked, opts) && !(day === 0 && m === requested.startMinutes)) candidates.push(slot);
    }
    const target = requested.startMinutes;
    candidates.sort((a, b) => {
      const d = Math.abs(a.startMinutes - target) - Math.abs(b.startMinutes - target);
      return d !== 0 ? d : b.startMinutes - a.startMinutes;
    });
    result.push(...candidates.slice(0, max - result.length));
  }
  return result;
}

/** Checks a requested start against every confirmed appointment in the session. */
export function checkAvailability(booked: BookedSlot[], requested: Slot, opts: AvailabilityOptions): AvailabilityResult {
  let reason: UnavailableReason | null = null;
  let conflictsWith: BookedSlot | undefined;
  if (isInPast(requested, opts.now)) reason = "in_past";
  else if (!isWithinHours(requested, opts.hours)) reason = "outside_hours";
  else {
    conflictsWith = booked.find((b) => b.id !== opts.ignoreId && overlaps(b, requested));
    if (conflictsWith) reason = "conflict";
  }
  if (!reason) return { available: true, slot: requested };
  return {
    available: false,
    slot: requested,
    reason,
    ...(conflictsWith ? { conflictsWith } : {}),
    alternatives: findAlternatives(booked, requested, opts),
  };
}

/** The earliest bookable slot from now (used by the dashboard). */
export function nextOpenSlot(booked: BookedSlot[], opts: AvailabilityOptions): Slot | null {
  const step = opts.stepMinutes ?? 30;
  for (let day = 0; day < 14; day++) {
    const dateISO = addDaysISO(opts.now.dateISO, day);
    for (let m = opts.hours.open; m + SLOT_MINUTES <= opts.hours.close; m += step) {
      const slot = { dateISO, startMinutes: m };
      if (usable(slot, booked, opts)) return slot;
    }
  }
  return null;
}

// ───────────────────────────── formatting ─────────────────────────────

export function formatMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`;
}

export function formatMinutes24(minutes: number): string {
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "8:00 PM – 9:00 PM" */
export function formatSlotRange(slot: Slot): string {
  return `${formatMinutes(slot.startMinutes)} – ${formatMinutes(slotEnd(slot))}`;
}

const dayFmt = new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** "Tuesday, October 13" */
export function formatDay(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return dayFmt.format(new Date(Date.UTC(y, m - 1, d)));
}

/** Parses "HH:MM-HH:MM" (e.g. "09:00-22:00") into business hours. */
export function parseBusinessHours(value: string | undefined): BusinessHours | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(value ?? "");
  if (!m) return null;
  const open = Number(m[1]) * 60 + Number(m[2]);
  const close = Number(m[3]) * 60 + Number(m[4]);
  if (open < 0 || close > 24 * 60 || close - open < SLOT_MINUTES) return null;
  return { open, close };
}
