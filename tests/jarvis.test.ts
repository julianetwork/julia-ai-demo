/**
 * Jarvis function endpoints, with a fake Google API: owner-only access,
 * calendar reads/writes, conflict refusal, inbox summary and draft-only email.
 */
process.env.RETELL_API_KEY = "key_test_secret_for_tests";
process.env.RETELL_TOOL_SECRET = "tool-secret-for-tests";
process.env.DEMO_TIMEZONE = "America/Toronto";
process.env.GOOGLE_CLIENT_ID = "cid";
process.env.GOOGLE_CLIENT_SECRET = "csecret";
process.env.GOOGLE_REFRESH_TOKEN = "rtoken";
process.env.JARVIS_OWNER_NUMBERS = "+1 (905) 555-0100";
process.env.JARVIS_PHONE_NUMBER = "+12895550123";
process.env.JARVIS_ADMIN_SECRET = "admin-secret-for-tests-0123456789";
process.env.TWILIO_ACCOUNT_SID = "AC_test";
process.env.TWILIO_AUTH_TOKEN = "twilio_token";

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sign } from "retell-sdk";

const { app } = await import("../server/app.ts");
const { setGoogleFetch, zonedToUtc } = await import("../server/google.ts");
const { setTwilioFetch } = await import("../server/jarvis.ts");

let server: Server;
let base = "";
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  setGoogleFetch(null);
  server.close();
});

// ── fake Google ──
let events: any[] = [];
let drafts: any[] = [];
const requests: string[] = [];
beforeEach(() => {
  events = [];
  drafts = [];
  requests.length = 0;
  setGoogleFetch((async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (url.pathname === "/token") return json({ access_token: "at", expires_in: 3600 });
    if (url.pathname.endsWith("/calendars/primary/events") && init?.method === "POST") {
      const e = { id: `e${events.length + 1}`, ...JSON.parse(String(init.body)) };
      events.push(e);
      return json({ id: e.id, htmlLink: "x" });
    }
    if (url.pathname.endsWith("/calendars/primary/events")) {
      const min = Date.parse(url.searchParams.get("timeMin")!);
      const max = Date.parse(url.searchParams.get("timeMax")!);
      return json({ items: events.filter((e) => Date.parse(e.start.dateTime) < max && Date.parse(e.end.dateTime) > min) });
    }
    if (url.pathname.endsWith("/messages")) return json({ messages: [{ id: "m1" }] });
    if (url.pathname.endsWith("/messages/m1"))
      return json({ id: "m1", snippet: "See you Wednesday", payload: { headers: [{ name: "From", value: '"CASARA" <r@casara.ca>' }, { name: "Subject", value: "Volunteer Acceptance" }] } });
    if (url.pathname.endsWith("/drafts")) {
      drafts.push(JSON.parse(String(init!.body)));
      return json({ id: "d1" });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch);
});

const OWNER = "+19055550100";
async function jarvis(fn: string, args: Record<string, unknown>, from: string | null = OWNER) {
  const call = { call_id: "call_test_123456", call_type: from ? "phone_call" : "web_call", ...(from ? { from_number: from } : {}) };
  const body = JSON.stringify({ name: fn, call, args });
  const res = await fetch(`${base}/api/tools/jarvis/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-retell-signature": await sign(body, process.env.RETELL_API_KEY!) },
    body,
  });
  return { status: res.status, json: (await res.json()) as any };
}

const nextWeek = (() => {
  const d = new Date(Date.now() + 7 * 86_400_000);
  return d.toISOString().slice(0, 10);
})();

test("refuses callers that are not the owner, without touching Google", async () => {
  for (const from of ["+14165550199", null]) {
    const r = await jarvis("get-schedule", {}, from);
    assert.equal(r.json.ok, false);
    assert.match(r.json.message, /ACCESS DENIED/);
  }
  assert.equal(requests.length, 0);
});

test("unauthenticated requests are rejected", async () => {
  const res = await fetch(`${base}/api/tools/jarvis/get-schedule`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ call: { from_number: OWNER } }),
  });
  assert.equal(res.status, 401);
});

test("creates an event, reads it back, and refuses an overlap unless forced", async () => {
  const made = await jarvis("create-event", { title: "Flight lesson", date: nextWeek, time: "3 PM", duration_minutes: 90 });
  assert.equal(made.json.created, true, made.json.message);
  assert.equal(events[0].start.timeZone, "America/Toronto");
  assert.equal(events[0].start.dateTime, zonedToUtc(nextWeek, 15 * 60, "America/Toronto").toISOString());

  const day = await jarvis("get-schedule", { date: nextWeek });
  assert.equal(day.json.events.length, 1);
  assert.match(day.json.message, /3:00 PM to 4:30 PM: Flight lesson/);

  const clash = await jarvis("create-event", { title: "Gym", date: nextWeek, time: "4 PM" });
  assert.equal(clash.json.created, false);
  assert.equal(clash.json.conflict, true);
  assert.equal(events.length, 1);

  const forced = await jarvis("create-event", { title: "Gym", date: nextWeek, time: "4 PM", force: true });
  assert.equal(forced.json.created, true);
});

test("asks for missing details instead of guessing", async () => {
  const r = await jarvis("create-event", { title: "Dentist" });
  assert.equal(r.json.created, false);
  assert.match(r.json.message, /date, time/);
  assert.equal(events.length, 0);
});

test("summarises unread mail", async () => {
  const r = await jarvis("inbox-summary", {});
  assert.equal(r.json.unread, 1);
  assert.match(r.json.message, /From CASARA: Volunteer Acceptance/);
});

test("saves drafts only, and validates the address", async () => {
  const bad = await jarvis("draft-email", { to: "vish at maple wings", subject: "Hi", body: "Update" });
  assert.equal(bad.json.drafted, false);
  const ok = await jarvis("draft-email", { to: "Vish@Example.com", subject: "ROC-A update", body: "Still waiting on ISED." });
  assert.equal(ok.json.drafted, true);
  const raw = Buffer.from(drafts[0].message.raw, "base64url").toString("utf8");
  assert.match(raw, /^To: vish@example.com/);
  assert.ok(!requests.some((r) => r.includes("/send")), "never calls send");
});

test("zonedToUtc handles DST", () => {
  assert.equal(zonedToUtc("2026-07-01", 12 * 60, "America/Toronto").toISOString(), "2026-07-01T16:00:00.000Z");
  assert.equal(zonedToUtc("2026-12-01", 12 * 60, "America/Toronto").toISOString(), "2026-12-01T17:00:00.000Z");
});

test("texts go only to the owner, from Jarvis's number", async () => {
  const sent: URLSearchParams[] = [];
  setTwilioFetch((async (_u: unknown, init?: RequestInit) => {
    sent.push(new URLSearchParams(String(init!.body)));
    return new Response("{}", { status: 201 });
  }) as typeof fetch);
  const viaCall = await jarvis("text-me", { message: "CASARA 6:30, leave by 3:45" });
  assert.equal(viaCall.json.ok, true);
  const denied = await jarvis("text-me", { message: "hi" }, "+14165550199");
  assert.match(denied.json.message, /ACCESS DENIED/);

  const noSecret = await fetch(`${base}/api/jarvis/text-me`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "x", to: "+14165550199" }) });
  assert.equal(noSecret.status, 401);
  const ok = await fetch(`${base}/api/jarvis/text-me`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-jarvis-secret": process.env.JARVIS_ADMIN_SECRET! },
    body: JSON.stringify({ message: "Test from Jarvis", to: "+14165550199" }),
  });
  assert.equal(ok.status, 201);
  assert.equal(sent.length, 2);
  for (const p of sent) {
    assert.equal(p.get("To"), "+1 (905) 555-0100");
    assert.equal(p.get("From"), "+12895550123");
  }
  setTwilioFetch(null);
});

test("call-me needs the admin secret", async () => {
  const res = await fetch(`${base}/api/jarvis/call-me`, { method: "POST", headers: { "content-type": "application/json", "x-jarvis-secret": "wrong" }, body: "{}" });
  assert.equal(res.status, 401);
});
