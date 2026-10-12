import { randomUUID } from "node:crypto";
import { config } from "./config.ts";
import type { DemoSession } from "./demoSessions.ts";
import type { DemoAppointment } from "../shared/api.ts";
import { parseDateText, parseTimeText } from "../shared/booking.ts";
import {
  SLOT_MINUTES,
  checkAvailability,
  formatDay,
  formatMinutes,
  formatMinutes24,
  formatSlotRange,
  shopClock,
  type AvailabilityOptions,
  type Slot,
} from "../shared/scheduling.ts";

/**
 * The booking authority. Julia's Retell functions call these through
 * /api/tools/*, and only `bookAppointment` can create an appointment — after
 * the shared availability rules accept the slot. Each operation is
 * synchronous, so a check and the insert that follows it cannot interleave
 * with another request (Node runs them on one thread).
 */

export interface ToolSlot {
  date: string;
  day: string;
  time: string;
  time_24h: string;
  ends: string;
}

const toToolSlot = (s: Slot): ToolSlot => ({
  date: s.dateISO,
  day: formatDay(s.dateISO),
  time: formatMinutes(s.startMinutes),
  time_24h: formatMinutes24(s.startMinutes),
  ends: formatMinutes(s.startMinutes + SLOT_MINUTES),
});

const describe = (s: Slot) => `${formatDay(s.dateISO)} at ${formatMinutes(s.startMinutes)}`;
const listAlternatives = (alts: Slot[]) =>
  alts.map((a, i) => (i === 0 || a.dateISO !== alts[0].dateISO ? describe(a) : formatMinutes(a.startMinutes))).join("; ");

function availabilityOptions(): AvailabilityOptions {
  return { hours: config.businessHours, now: shopClock(config.timeZone), maxAlternatives: 3, stepMinutes: 30 };
}

type ParsedRequest = { ok: true; slot: Slot } | { ok: false; message: string };

function parseRequest(dateRaw: unknown, timeRaw: unknown): ParsedRequest {
  const dateText = typeof dateRaw === "string" ? dateRaw.slice(0, 60) : "";
  const timeText = typeof timeRaw === "string" ? timeRaw.slice(0, 40) : "";
  if (!dateText.trim()) return { ok: false, message: "No date was provided. Ask the caller which day they would like." };
  if (!timeText.trim()) return { ok: false, message: "No time was provided. Ask the caller what time they would like." };
  const date = parseDateText(dateText, { timeZone: config.timeZone });
  if (!date) {
    return { ok: false, message: `The date "${dateText}" could not be understood. Ask the caller to say the day again (for example "Friday" or "October 16").` };
  }
  const time = parseTimeText(timeText);
  if (!time) {
    return { ok: false, message: `The time "${timeText}" could not be understood. Ask the caller for the time again, including AM or PM.` };
  }
  return { ok: true, slot: { dateISO: date.dateISO, startMinutes: time.hour24 * 60 + time.minute } };
}

function unavailableMessage(slot: Slot, reason: string, alternatives: Slot[]): string {
  const what =
    reason === "conflict"
      ? `${describe(slot)} is already booked (appointments last 60 minutes and cannot overlap).`
      : reason === "outside_hours"
        ? `${describe(slot)} is outside opening hours (${formatMinutes(config.businessHours.open)} to ${formatMinutes(config.businessHours.close)}; the last appointment starts at ${formatMinutes(config.businessHours.close - SLOT_MINUTES)}).`
        : `${describe(slot)} is in the past.`;
  const offer = alternatives.length
    ? ` Offer the caller these available times instead: ${listAlternatives(alternatives)}. Wait for the caller to agree before booking. Do not suggest any other time.`
    : " No alternative times are available in the next two weeks; apologise and offer to take a message.";
  return `NOT AVAILABLE: ${what}${offer} Do not tell the caller anything is booked.`;
}

// ───────────────────────────── check ─────────────────────────────

export function checkSlot(session: DemoSession, callId: string | null, args: Record<string, unknown>) {
  const parsed = parseRequest(args.date, args.time);
  if (!parsed.ok) {
    session.record({ callId, kind: "invalid", summary: "Couldn't read the requested date/time" });
    return { available: false, reason: "invalid_input", message: parsed.message };
  }
  const result = checkAvailability(session.appointments, parsed.slot, availabilityOptions());
  if (result.available) {
    session.record({ callId, kind: "available", summary: `${describe(parsed.slot)} is free` });
    return {
      available: true,
      requested: toToolSlot(parsed.slot),
      message: `AVAILABLE: ${describe(parsed.slot)} (until ${formatMinutes(parsed.slot.startMinutes + SLOT_MINUTES)}) is free. Confirm the details with the caller, then call book_appointment. It is not booked yet.`,
    };
  }
  const alts = result.alternatives;
  session.record({
    callId,
    kind: "unavailable",
    summary: `${describe(parsed.slot)} ${result.reason === "conflict" ? "overlaps a booking" : result.reason === "outside_hours" ? "is outside hours" : "is in the past"}${alts.length ? ` — offered ${formatMinutes(alts[0].startMinutes)}` : ""}`,
  });
  return {
    available: false,
    reason: result.reason,
    requested: toToolSlot(parsed.slot),
    alternatives: alts.map(toToolSlot),
    message: unavailableMessage(parsed.slot, result.reason, alts),
  };
}

// ───────────────────────────── book ─────────────────────────────

const normalizeName = (n: string) => n.toLocaleLowerCase().replace(/\s+/g, " ").trim();

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function bookSlot(session: DemoSession, callId: string | null, args: Record<string, unknown>) {
  const customerName = cleanText(args.customer_name, 60);
  const service = cleanText(args.service, 40) || "Haircut";
  if (!customerName || !/\p{L}/u.test(customerName)) {
    session.record({ callId, kind: "invalid", summary: "Booking attempted without a customer name" });
    return { booked: false, reason: "invalid_input", message: "NOT BOOKED: the customer's name is missing. Ask for their name first. Do not say the appointment is booked." };
  }
  const parsed = parseRequest(args.date, args.time);
  if (!parsed.ok) {
    session.record({ callId, kind: "invalid", summary: "Couldn't read the requested date/time" });
    return { booked: false, reason: "invalid_input", message: `NOT BOOKED: ${parsed.message} Do not say the appointment is booked.` };
  }
  const slot = parsed.slot;
  const sameCaller = (a: DemoAppointment) =>
    callId !== null ? a.callId === callId : normalizeName(a.customerName) === normalizeName(customerName);

  // Idempotency: the same confirmation processed twice returns the existing booking.
  const duplicate = session.appointments.find(
    (a) => sameCaller(a) && a.dateISO === slot.dateISO && a.startMinutes === slot.startMinutes,
  );
  if (duplicate) {
    session.record({ callId, kind: "already_booked", summary: `Repeat confirmation ignored — ${duplicate.customerName} already booked` });
    return {
      booked: true,
      already_booked: true,
      appointment: { ...toToolSlot(slot), customer_name: duplicate.customerName, service: duplicate.service },
      message: `BOOKED (already recorded): ${duplicate.customerName}, ${duplicate.service}, ${describe(slot)} until ${formatMinutes(slot.startMinutes + SLOT_MINUTES)}. You may confirm this to the caller.`,
    };
  }

  // Same caller + same name booking again = they changed their mind: move the appointment.
  const previous = session.appointments.find(
    (a) => sameCaller(a) && normalizeName(a.customerName) === normalizeName(customerName),
  );

  const result = checkAvailability(session.appointments, slot, { ...availabilityOptions(), ignoreId: previous?.id });
  if (!result.available) {
    session.record({
      callId,
      kind: "rejected",
      summary: `Rejected ${describe(slot)} for ${customerName} — ${result.reason === "conflict" ? "overlaps a booking" : result.reason === "outside_hours" ? "outside hours" : "in the past"}`,
    });
    return {
      booked: false,
      reason: result.reason,
      requested: toToolSlot(slot),
      alternatives: result.alternatives.map(toToolSlot),
      message: `NOT BOOKED. ${unavailableMessage(slot, result.reason, result.alternatives)}`,
    };
  }
  if (!previous && session.full) {
    return { booked: false, reason: "demo_limit", message: "NOT BOOKED: the demo calendar is full. Apologise and suggest resetting the demo." };
  }

  const appointment: DemoAppointment = previous
    ? { ...previous, customerName, service, dateISO: slot.dateISO, startMinutes: slot.startMinutes, createdAt: Date.now() }
    : { id: randomUUID(), callId, customerName, service, dateISO: slot.dateISO, startMinutes: slot.startMinutes, createdAt: Date.now() };
  session.setAppointments(previous ? session.appointments.map((a) => (a.id === previous.id ? appointment : a)) : [...session.appointments, appointment]);
  session.record({
    callId,
    kind: previous ? "rescheduled" : "booked",
    summary: `${previous ? "Moved" : "Booked"} ${customerName} · ${formatDay(slot.dateISO)} · ${formatSlotRange(slot)}`,
  });

  return {
    booked: true,
    rescheduled: !!previous,
    appointment: { ...toToolSlot(slot), customer_name: customerName, service },
    message: `BOOKED${previous ? " (moved from the earlier time)" : ""}: ${customerName}, ${service}, ${describe(slot)} until ${formatMinutes(slot.startMinutes + SLOT_MINUTES)}. You may now confirm this to the caller.`,
  };
}
