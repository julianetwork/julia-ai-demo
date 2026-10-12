/**
 * HTTP-level tests of the scheduling tools exactly as Retell calls them:
 * POST { name, call: { call_id }, args } with an X-Retell-Signature header.
 */
process.env.RETELL_API_KEY = "key_test_secret_for_tests";
process.env.RETELL_TOOL_SECRET = "tool-secret-for-tests";
process.env.DEMO_TIMEZONE = "America/Toronto";
process.env.BUSINESS_HOURS = "09:00-22:00";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sign } from "retell-sdk";

const { app } = await import("../server/app.ts");
const { registerCall } = await import("../server/callRegistry.ts");
const { shopClock } = await import("../shared/scheduling.ts");

let server: Server;
let base = "";
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const tomorrow = (() => {
  const { dateISO } = shopClock("America/Toronto");
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
})();

async function newSession(): Promise<string> {
  const res = await fetch(`${base}/api/demo-sessions`, { method: "POST" });
  assert.equal(res.status, 201);
  return ((await res.json()) as { id: string }).id;
}

async function tool(path: string, callId: string, args: Record<string, unknown>, auth: "signature" | "secret" | "none" = "signature") {
  const body = JSON.stringify({ name: path, call: { call_id: callId }, args });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth === "signature") headers["x-retell-signature"] = await sign(body, process.env.RETELL_API_KEY!);
  if (auth === "secret") headers["x-julia-tool-secret"] = process.env.RETELL_TOOL_SECRET!;
  const res = await fetch(`${base}/api/tools/${path}`, { method: "POST", headers, body });
  return { status: res.status, json: (await res.json()) as any };
}

async function appointments(sessionId: string): Promise<any[]> {
  // Read the first snapshot from the dashboard's SSE stream.
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/demo-sessions/${sessionId}/events`, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  let text = "";
  while (!text.includes("event: activity_log")) text += new TextDecoder().decode((await reader.read()).value);
  ctrl.abort();
  const line = text.split("\n").find((l) => l.startsWith("data:") && l.includes('"appointments"'))!;
  return JSON.parse(line.slice(5)).appointments;
}

test("tool calls must be authenticated", async () => {
  const sid = await newSession();
  registerCall("call_auth_000001", sid);
  assert.equal((await tool("check-availability", "call_auth_000001", { date: tomorrow, time: "8 PM" }, "none")).status, 401);
  const forged = await fetch(`${base}/api/tools/check-availability`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-retell-signature": "v=1,d=" + "0".repeat(64) },
    body: "{}",
  });
  assert.equal(forged.status, 401);
  assert.equal((await tool("check-availability", "call_auth_000001", { date: tomorrow, time: "8 PM" }, "secret")).status, 200);
  assert.equal((await tool("check-availability", "call_auth_000001", { date: tomorrow, time: "8 PM" }, "signature")).status, 200);
});

test("full scheduling flow: book, dedupe, conflict, alternative, back-to-back, reschedule, reset", async () => {
  const sid = await newSession();
  registerCall("call_flow_000001", sid);
  registerCall("call_flow_000002", sid);

  const check = await tool("check-availability", "call_flow_000001", { date: tomorrow, time: "8:00 PM" });
  assert.equal(check.json.available, true);
  assert.equal(await appointments(sid).then((a) => a.length), 0, "checking never books");

  const booked = await tool("book-appointment", "call_flow_000001", { customer_name: "Ahmed", date: tomorrow, time: "8:00 PM", service: "Haircut" });
  assert.equal(booked.json.booked, true);
  assert.match(booked.json.message, /^BOOKED/);

  const repeat = await tool("book-appointment", "call_flow_000001", { customer_name: "Ahmed", date: tomorrow, time: "20:00" });
  assert.equal(repeat.json.booked, true);
  assert.equal(repeat.json.already_booked, true);
  assert.equal((await appointments(sid)).length, 1, "same confirmation twice → one appointment");

  const clash = await tool("check-availability", "call_flow_000002", { date: tomorrow, time: "8:30 PM" });
  assert.equal(clash.json.available, false);
  assert.equal(clash.json.reason, "conflict");
  assert.equal(clash.json.alternatives[0].time, "9:00 PM");
  assert.match(clash.json.message, /Do not tell the caller anything is booked/);

  const forced = await tool("book-appointment", "call_flow_000002", { customer_name: "Sam", date: tomorrow, time: "8:30 PM" });
  assert.equal(forced.json.booked, false, "a conflicting booking is refused even if the agent skips the check");
  assert.match(forced.json.message, /^NOT BOOKED/);

  const backToBack = await tool("book-appointment", "call_flow_000002", { customer_name: "Sam", date: tomorrow, time: "9:00 PM" });
  assert.equal(backToBack.json.booked, true, "9:00 PM starts exactly when 8:00 PM ends");
  assert.equal((await appointments(sid)).length, 2);

  const moved = await tool("book-appointment", "call_flow_000001", { customer_name: "Ahmed", date: tomorrow, time: "10:00 AM" });
  assert.equal(moved.json.booked, true);
  assert.equal(moved.json.rescheduled, true);
  const list = await appointments(sid);
  assert.equal(list.length, 2, "rescheduling moves, never duplicates");
  assert.deepEqual(list.map((a) => [a.customerName, a.startMinutes]), [["Ahmed", 600], ["Sam", 1260]]);

  const free8 = await tool("check-availability", "call_flow_000002", { date: tomorrow, time: "8 PM" });
  assert.equal(free8.json.available, true, "the old 8 PM slot was released");

  assert.equal((await fetch(`${base}/api/demo-sessions/${sid}/reset`, { method: "POST" })).status, 204);
  assert.equal((await appointments(sid)).length, 0);
  const again = await tool("book-appointment", "call_flow_000002", { customer_name: "Sam", date: tomorrow, time: "9:00 PM" });
  assert.equal(again.json.booked, true, "reset frees every slot");
});

test("sessions are isolated from each other", async () => {
  const a = await newSession();
  const b = await newSession();
  registerCall("call_iso_0000001", a);
  registerCall("call_iso_0000002", b);
  assert.equal((await tool("book-appointment", "call_iso_0000001", { customer_name: "Lee", date: tomorrow, time: "11 AM" })).json.booked, true);
  assert.equal((await tool("check-availability", "call_iso_0000002", { date: tomorrow, time: "11 AM" })).json.available, true);
  assert.equal((await appointments(b)).length, 0);
});

test("invalid input and outside hours are explained, never booked", async () => {
  const sid = await newSession();
  registerCall("call_bad_0000001", sid);
  const noName = await tool("book-appointment", "call_bad_0000001", { date: tomorrow, time: "3 PM" });
  assert.equal(noName.json.booked, false);
  const badDate = await tool("book-appointment", "call_bad_0000001", { customer_name: "Kim", date: "someday", time: "3 PM" });
  assert.equal(badDate.json.reason, "invalid_input");
  const late = await tool("book-appointment", "call_bad_0000001", { customer_name: "Kim", date: tomorrow, time: "9:30 PM" });
  assert.equal(late.json.reason, "outside_hours");
  assert.equal((await appointments(sid)).length, 0);
});

test("web calls require a live demo session", async () => {
  const res = await fetch(`${base}/api/retell/v3/create-web-call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent_id: "x", metadata: { demo_session_id: "00000000-0000-4000-8000-000000000000" } }),
  });
  assert.equal(res.status, 409);
});
