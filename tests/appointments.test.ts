import { test } from "node:test";
import assert from "node:assert/strict";
import { appointmentsReducer } from "../client/src/hooks/useAppointments.ts";

const booking = { customerName: "Ahmed", service: "Haircut", dateLabel: "tomorrow", dateISO: "2026-10-13", time: "3:00 PM", time24: "15:00" };

test("repeated signals for the same call produce exactly one appointment", () => {
  let s = appointmentsReducer([], { type: "captured", callId: "call_1", booking, method: "live_transcript", verified: false, evidence: "x" });
  s = appointmentsReducer(s, { type: "captured", callId: "call_1", booking, method: "live_transcript", verified: false, evidence: "x" });
  s = appointmentsReducer(s, { type: "captured", callId: "call_1", booking: { ...booking, time: "4:00 PM", time24: "16:00" }, method: "post_call_transcript", verified: true, evidence: "y" });
  assert.equal(s.length, 1);
  assert.equal(s[0].status, "verified");
  assert.equal(s[0].time, "4:00 PM");
});

test("separate calls create separate appointments; reset clears all", () => {
  let s = appointmentsReducer([], { type: "captured", callId: "call_1", booking, method: "live_transcript", verified: false, evidence: "x" });
  s = appointmentsReducer(s, { type: "captured", callId: "call_2", booking, method: "live_transcript", verified: false, evidence: "x" });
  assert.equal(s.length, 2);
  s = appointmentsReducer(s, { type: "flag_for_review", callId: "call_2" });
  assert.equal(s.find((a) => a.callId === "call_2")?.status, "needs_review");
  s = appointmentsReducer(s, { type: "remove", callId: "call_1" });
  assert.equal(s.length, 1);
  assert.deepEqual(appointmentsReducer(s, { type: "reset" }), []);
});
