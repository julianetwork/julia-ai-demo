import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkAvailability,
  overlaps,
  nextOpenSlot,
  shopClock,
  parseBusinessHours,
  formatSlotRange,
  type BookedSlot,
  type AvailabilityOptions,
} from "../shared/scheduling.ts";

const H = (h: number, m = 0) => h * 60 + m;
const D = "2026-10-13";
const opts: AvailabilityOptions = { hours: { open: H(9), close: H(22) }, now: { dateISO: "2026-10-12", minutes: H(15) } };
const at8pm: BookedSlot = { id: "a", dateISO: D, startMinutes: H(20) };

test("an appointment occupies [start, start + 60 min)", () => {
  assert.equal(formatSlotRange(at8pm), "8:00 PM – 9:00 PM");
  assert.equal(overlaps(at8pm, { dateISO: D, startMinutes: H(20, 59) }), true);
  assert.equal(overlaps(at8pm, { dateISO: D, startMinutes: H(19, 1) }), true);
  assert.equal(overlaps(at8pm, { dateISO: D, startMinutes: H(21) }), false, "starts exactly at the end");
  assert.equal(overlaps(at8pm, { dateISO: D, startMinutes: H(19) }), false, "ends exactly at the start");
  assert.equal(overlaps(at8pm, { dateISO: "2026-10-14", startMinutes: H(20) }), false, "different day");
});

test("overlapping requests are rejected with non-overlapping alternatives", () => {
  for (const start of [H(20), H(20, 30), H(19, 30), H(20, 15)]) {
    const r = checkAvailability([at8pm], { dateISO: D, startMinutes: start }, opts);
    assert.equal(r.available, false);
    if (r.available) continue;
    assert.equal(r.reason, "conflict");
    assert.equal(r.conflictsWith?.id, "a");
    assert.ok(r.alternatives.length > 0);
    for (const alt of r.alternatives) assert.equal(overlaps(alt, at8pm), false);
  }
});

test("8:00 PM taken → 9:00 PM is offered first", () => {
  const r = checkAvailability([at8pm], { dateISO: D, startMinutes: H(20) }, opts);
  assert.equal(r.available, false);
  if (!r.available) assert.deepEqual(r.alternatives[0], { dateISO: D, startMinutes: H(21) });
});

test("back-to-back appointments are allowed", () => {
  assert.equal(checkAvailability([at8pm], { dateISO: D, startMinutes: H(21) }, opts).available, true);
  assert.equal(checkAvailability([at8pm], { dateISO: D, startMinutes: H(19) }, opts).available, true);
});

test("outside business hours and past times are unavailable", () => {
  const late = checkAvailability([], { dateISO: D, startMinutes: H(21, 30) }, opts);
  assert.equal(!late.available && late.reason, "outside_hours", "21:30 would end after 22:00");
  const past = checkAvailability([], { dateISO: "2026-10-12", startMinutes: H(14) }, opts);
  assert.equal(!past.available && past.reason, "in_past");
  if (!past.available) assert.ok(past.alternatives.every((a) => a.dateISO > "2026-10-12" || a.startMinutes > H(15)));
});

test("a fully booked day rolls alternatives to the next day", () => {
  const booked: BookedSlot[] = [];
  for (let h = 9; h < 22; h++) booked.push({ id: `b${h}`, dateISO: D, startMinutes: H(h) });
  const r = checkAvailability(booked, { dateISO: D, startMinutes: H(12) }, opts);
  assert.equal(r.available, false);
  if (!r.available) assert.ok(r.alternatives.length === 3 && r.alternatives.every((a) => a.dateISO === "2026-10-14"));
});

test("rescheduling ignores the appointment being moved", () => {
  const r = checkAvailability([at8pm], { dateISO: D, startMinutes: H(20, 30) }, { ...opts, ignoreId: "a" });
  assert.equal(r.available, true);
});

test("next open slot and clock helpers", () => {
  assert.deepEqual(nextOpenSlot([], opts), { dateISO: "2026-10-12", startMinutes: H(15, 30) });
  assert.deepEqual(shopClock("America/Toronto", new Date("2026-10-13T00:30:00Z")), { dateISO: "2026-10-12", minutes: H(20, 30) });
  assert.deepEqual(parseBusinessHours("09:00-22:00"), { open: H(9), close: H(22) });
  assert.equal(parseBusinessHours("22:00-09:00"), null);
});
