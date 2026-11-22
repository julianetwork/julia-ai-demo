/**
 * Daily briefing: wording and length cap (pure formatter), plus the
 * POST /api/jarvis/briefing endpoint with a fake Google, fake SMS and a
 * stubbed Retell call.
 */
process.env.RETELL_API_KEY = "key_test_secret_for_tests";
process.env.DEMO_TIMEZONE = "America/Toronto";
process.env.GOOGLE_CLIENT_ID = "cid";
process.env.GOOGLE_CLIENT_SECRET = "csecret";
process.env.GOOGLE_REFRESH_TOKEN = "rtoken";
process.env.JARVIS_OWNER_NUMBERS = "+1 (905) 555-0100,+14165550111";
process.env.JARVIS_PHONE_NUMBER = "+12895550123";
process.env.JARVIS_AGENT_ID = "agent_jarvis_test";
process.env.JARVIS_ADMIN_SECRET = "admin-secret-for-tests-0123456789";
process.env.TWILIO_ACCOUNT_SID = "AC_test";
process.env.TWILIO_AUTH_TOKEN = "twilio_token";

import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const { app } = await import("../server/app.ts");
const { config } = await import("../server/config.ts");
const { setGoogleFetch, zonedToUtc } = await import("../server/google.ts");
const { setTwilioFetch } = await import("../server/jarvis.ts");
const { formatBriefing, buildBriefing, BRIEFING_MAX } = await import("../server/briefing.ts");
const { retell } = await import("../server/retell.ts");
const { shopClock } = await import("../shared/scheduling.ts");

let server: Server;
let base = "";
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  setGoogleFetch(null);
  setTwilioFetch(null);
  server.close();
});

// ── fake Google: today's events and a configurable unread inbox ──
const today = shopClock("America/Toronto").dateISO;
const at = (min: number) => zonedToUtc(today, min, "America/Toronto").toISOString();
let events: any[] = [];
let mail: { from: string; subject: string }[] = [];
let googleCalls = 0;
beforeEach(() => {
  googleCalls = 0;
  events = [{ id: "e1", summary: "Flight lesson", start: { dateTime: at(15 * 60) }, end: { dateTime: at(16 * 60 + 30) } }];
  mail = [{ from: '"CASARA" <r@casara.ca>', subject: "Volunteer Acceptance" }];
  setGoogleFetch((async (input: string | URL | Request) => {
    googleCalls++;
    const url = new URL(String(input));
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (url.pathname === "/token") return json({ access_token: "at", expires_in: 3600 });
    if (url.pathname.endsWith("/calendars/primary/events")) return json({ items: events });
    if (url.pathname.endsWith("/messages")) return json({ messages: mail.map((_, i) => ({ id: `m${i}` })) });
    const m = /\/messages\/m(\d+)$/.exec(url.pathname);
    if (m) {
      const e = mail[Number(m[1])];
      return json({ id: `m${m[1]}`, payload: { headers: [{ name: "From", value: e.from }, { name: "Subject", value: e.subject }] } });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch);
});

let sms: URLSearchParams[] = [];
beforeEach(() => {
  sms = [];
  setTwilioFetch((async (_u: unknown, init?: RequestInit) => {
    sms.push(new URLSearchParams(String(init!.body)));
    return new Response("{}", { status: 201 });
  }) as typeof fetch);
});
afterEach(() => setTwilioFetch(null));

const briefing = (body: unknown, secret: string | null = process.env.JARVIS_ADMIN_SECRET!) =>
  fetch(`${base}/api/jarvis/briefing`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-jarvis-secret": secret } : {}) },
    body: JSON.stringify(body),
  });

test("briefing puts the calendar first, then unread mail", async () => {
  const text = await buildBriefing(new Date(at(7 * 60 + 30)));
  assert.match(text, /^Good morning\. \w+day, \w+ \d+: 3:00 PM Flight lesson\. Unread \(1\): CASARA: Volunteer Acceptance\.$/);
});

test("briefing handles an empty day and inbox", () => {
  const text = formatBriefing({ dayLabel: "Sunday, November 22", hour: 19, events: [], emails: [] });
  assert.equal(text, "Good evening. Sunday, November 22: nothing on the calendar. No unread email.");
});

test("briefing stays under the cap with many events and emails, ending cleanly", () => {
  const text = formatBriefing({
    dayLabel: "Sunday, November 22",
    hour: 7,
    events: Array.from({ length: 25 }, (_, i) => `${i + 1}:00 PM **Quite a long meeting title** number ${i + 1} with extra words`),
    emails: Array.from({ length: 8 }, (_, i) => ({ from: `Sender ${i}`, subject: `Subject line that goes on for a while ${i}` })),
  });
  assert.ok(text.length <= BRIEFING_MAX, `length ${text.length}`);
  assert.ok(text.startsWith("Good morning. Sunday, November 22: 1:00 PM Quite a long meeting title number 1"));
  assert.match(text, /\+\d+ more\. Unread \(8\): /, "calendar truncated with +N more, email section kept");
  assert.match(text, /\+\d+ more\.$/, "email list truncated with +N more");
  assert.ok(!/[*`\n]/.test(text), "plain text");
  assert.ok(/^[\x20-\x7e]*$/.test(text), "ASCII only, so the SMS isn't sent as Unicode");
});

test("briefing endpoint requires the admin secret", async () => {
  for (const secret of [null, "wrong-secret-wrong-secret-xx"]) {
    const res = await briefing({ mode: "text" }, secret);
    assert.equal(res.status, 401);
  }
  assert.equal(googleCalls, 0);
  assert.equal(sms.length, 0);
});

test("text mode sends exactly one SMS, to the owner's first number only", async () => {
  const res = await briefing({ to: "+14165550199" });
  assert.equal(res.status, 201);
  assert.equal(sms.length, 1);
  assert.equal(sms[0].get("To"), "+1 (905) 555-0100");
  assert.equal(sms[0].get("From"), "+12895550123");
  assert.match(sms[0].get("Body")!, /3:00 PM Flight lesson.*CASARA: Volunteer Acceptance/);
});

test("rejects an unknown mode", async () => {
  const res = await briefing({ mode: "email" });
  assert.equal(res.status, 400);
  assert.equal(sms.length, 0);
});

test("returns 503 when Google isn't connected", async () => {
  const saved = config.google.refreshToken;
  config.google.refreshToken = "";
  try {
    const res = await briefing({ mode: "text" });
    assert.equal(res.status, 503);
    assert.match(((await res.json()) as any).error, /Google is not connected/);
    assert.equal(sms.length, 0);
    assert.equal(googleCalls, 0);
  } finally {
    config.google.refreshToken = saved;
  }
});

test("call mode rings the owner with the briefing as a dynamic variable", async () => {
  const calls: any[] = [];
  const client = retell();
  const original = client.call.createPhoneCall;
  client.call.createPhoneCall = (async (params: any) => {
    calls.push(params);
    return { call_id: "call_briefing_1" };
  }) as any;
  try {
    const res = await briefing({ mode: "call", to: "+14165550199" });
    assert.equal(res.status, 201);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].to_number, "+1 (905) 555-0100");
    assert.equal(calls[0].from_number, "+12895550123");
    assert.equal(calls[0].override_agent_id, "agent_jarvis_test");
    assert.equal(calls[0].retell_llm_dynamic_variables.call_reason, "daily briefing");
    assert.match(calls[0].retell_llm_dynamic_variables.briefing, /Flight lesson/);
    assert.equal(sms.length, 0);
  } finally {
    client.call.createPhoneCall = original;
  }
});
