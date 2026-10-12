# Julia AI — Interactive Voice Receptionist Demo

A client-facing demo of **Julia**, an AI receptionist for barbershops. A visitor talks to Julia in a real-time voice call in the browser, through Retell AI. They play a customer booking a haircut. Julia checks a live calendar through the app's scheduler before confirming anything. Every appointment is a 60-minute slot, and overlapping bookings are refused with an alternative offered. The booking appears in an appointments dashboard below the call.

> **Demo only.** Bookings are simulated and kept in server memory for the current page session only. Nothing is saved to disk, sent, or added to a real calendar. A page refresh or **Reset Demo** clears everything.

---

## Quick start (Ubuntu)

```bash
# 1. Node.js 22 or newer is required (the server uses Node's built-in WebSocket)
node -v            # if < 22, install it, e.g. with nvm:
# curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && source ~/.bashrc && nvm install 22

# 2. Install dependencies
cd julia-ai-demo
npm install

# 3. Configure credentials (server-side only)
cp .env.example .env
nano .env          # set RETELL_API_KEY=<your Retell secret API key>

# 4. Run (API on :8787 + Vite dev server on :5173)
npm run dev
```

Open **http://localhost:5173** in Chrome, Edge, Firefox or Safari and click **Start Conversation**.

### Production-style run (single port)

```bash
npm run build      # type-check + build the frontend into client/dist
npm start          # serves the app and the API on http://localhost:8787
```

### All scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Express API (auto-reload) and the Vite frontend together |
| `npm run dev:server` / `npm run dev:client` | Starts each one on its own |
| `npm run build` | TypeScript check, then production build of the frontend |
| `npm start` | Serves the built app and the API from one Express server |
| `npm test` | Unit + HTTP tests: scheduling rules, the Retell tool endpoints (signed requests), date/time parsing (EN/FR) |
| `npm run typecheck` | TypeScript only |
| `npm run check:secrets` | Scans `client/dist` to prove no Retell secret is in the bundle (also checks against the real key in `.env`) |

### Deploy to Render (public HTTPS link)

1. In Render choose **New → Web Service** and connect this GitHub repository and branch.
2. Settings:
   * **Language:** Node · **Build command:** `npm ci && npm run build` · **Start command:** `npm start`
   * **Environment variables:** `RETELL_API_KEY` (your secret key), `TRUST_PROXY` (the hop count the server logs as "proxy hops", typically `3` on Render), `DEMO_TIMEZONE=America/Toronto`, `RETELL_TOOL_SECRET` (a long random string), optionally `BUSINESS_HOURS`
3. Deploy. Your link is `https://<service-name>.onrender.com`. Render provides HTTPS, which the microphone requires.
4. Set up Julia's two scheduling functions in Retell using that URL (see [Retell configuration](#retell-configuration)).

On the free tier the service sleeps when idle, so the first visit can take about 30 seconds. Open the link before a meeting.

---

## Environment variables (`.env`)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `RETELL_API_KEY` | **yes** | – | Retell **secret** API key (Retell dashboard → Settings → API Keys). Server-side only. |
| `RETELL_AGENT_ID` | no | `agent_022698413456f29efd82adef26` | The published Julia agent |
| `PORT` | no | `8787` | API port (and app port with `npm start`) |
| `CALL_RATE_LIMIT_MAX` | no | `6` | Web calls one IP may start per window |
| `CALL_RATE_LIMIT_WINDOW_MINUTES` | no | `10` | Rate-limit window |
| `DEMO_TIMEZONE` | no | server's zone | IANA zone (e.g. `America/Toronto`) used to resolve "tomorrow", "Friday"… |
| `TRUST_PROXY` | no | `loopback` | When hosted, the number of proxy hops in front of the app, so per-IP limits see real visitor IPs. The server logs the value to use ("proxy hops"). Avoid `true`, which visitors can spoof |
| `CALL_RATE_LIMIT_GLOBAL_MAX` | no | `40` | New calls allowed per window across all visitors. Independent of IPs, so it can't be bypassed |
| `BUSINESS_HOURS` | no | `09:00-22:00` | Opening hours in the shop's time zone. Slots are 60 minutes, so the last start is one hour before closing |
| `RETELL_TOOL_SECRET` | recommended | – | Shared secret that Retell sends in an `X-Julia-Tool-Secret` header on the scheduling functions. Signed Retell requests are accepted either way |

If `RETELL_API_KEY` is missing, the server still starts and logs a warning. The page then shows a friendly "not configured" message instead of crashing.

---

## How it works

```
Browser (React)                       Express server                                  Retell
───────────────                       ──────────────                                  ──────
POST /api/demo-sessions ───────────▶  new in-memory demo calendar (per page)
EventSource /api/demo-sessions/:id/events ◀── live appointments + scheduler activity

retell-client-js-sdk ── create-web-call (+ demo_session_id) ──▶ adds secret key ──▶ /v3/create-web-call
   └── WebRTC audio ◀───────────────────────────────────────────────────────────▶ Julia (voice)

                                      POST /api/tools/check-availability  ◀── Julia's functions
                                      POST /api/tools/book-appointment    ◀── (signed by Retell)
                                         └─ shared/scheduling.ts decides

EventSource /api/calls/:id/stream ◀── monitorCall() transcript ◀────────────────── /v2/monitor-call
```

### Scheduling: one-hour slots, no overlaps (enforced in code)

All rules live in `shared/scheduling.ts`, a pure, unit-tested module:

* Every appointment occupies exactly **60 minutes**, `[start, start + 60 min)`. An 8:00 PM booking blocks 8:00 PM up to, but not including, 9:00 PM.
* A request is refused if it overlaps **any** confirmed appointment on the same date in this demo session. Back-to-back is allowed: 9:00 PM may follow 8:00 PM.
* A request must fall within `BUSINESS_HOURS` and not be in the past. Both are judged in `DEMO_TIMEZONE`, the shop's time zone.
* When a slot is unavailable, `checkAvailability()` returns up to three non-overlapping alternatives, nearest first (later wins a tie). If 8:00 PM is taken, 9:00 PM is offered first. A full day rolls over to the following days.
* The dashboard uses the same module for slot ranges ("8:00 PM – 9:00 PM"), "Today" and "Next open slot".

**Julia cannot book on her own.** She has two Retell custom functions that call the server while the call is in progress:

| Function | What the server does |
| --- | --- |
| `check_availability(date, time)` | Parses the date/time ("tomorrow", "Friday", "2026-10-16", "8 PM", "20:00", "15 h"). Validates the slot and returns `available: true`, or `available: false` with a reason and alternatives. It never books anything. |
| `book_appointment(customer_name, date, time, service?)` | Re-validates the slot and, only if it is free, records the appointment. It returns `booked: true` or `booked: false` plus alternatives. This is the **only** way an appointment can be created. |

* **Atomic:** the check and the insert happen in one synchronous step, so two requests cannot both take the same slot.
* **Duplicates:** the same confirmation processed twice (a retry or a repeated function call) returns the existing booking (`already_booked: true`) and never creates a second row.
* **Changing the time:** if the same caller books again under the same name, the appointment is **moved**, not duplicated. The old slot is freed.
* **Wording:** each response carries a plain-language `message` addressed to Julia ("NOT AVAILABLE: … Offer these times … Do not tell the caller anything is booked"). The prompt section below tells her to follow it.
* **Authentication:** requests must carry a valid `X-Retell-Signature` (verified against the raw body with your API key, using the official `retell-sdk` `verify`) or the `X-Julia-Tool-Secret` header.
* **Routing:** each web call is created with this page's `demo_session_id`, so a function call lands in the right visitor's calendar. Calls started elsewhere, such as Retell's own "Test" button, get a private scratch calendar and never touch a demo page.

**Safety net:** the server also watches the live transcript. If Julia ever *says* a booking is confirmed but the scheduler holds no booking for that call, the page shows a warning ("Julia said it was booked — the scheduler disagrees") and adds nothing.

### Voice call (official SDK, secret key never in the browser)

* The browser uses the official **`retell-client-js-sdk` v3** `RetellClient.createWebCall()`, following the proxy pattern from the SDK README. The client has a placeholder key and a custom `fetch` that routes to `/api/retell/...` on our server, where the real key is attached.
* The proxy exposes only `POST /v3/create-web-call` (rate-limited) and `POST /v2/stop-call/:id` (only for calls this server created). The agent id always comes from `RETELL_AGENT_ID`. The only browser field used is the demo session id, which must exist on the server.
* The browser only ever receives a **single-call, short-lived `access_token`**.
* In SDK v3, the audio connection carries no transcript. The server reads it with the SDK's `monitorCall()` (transcript only) and relays it to the page over Server-Sent Events, so the key stays on the server.

### Session isolation

* Each page load creates a demo session on the server. Its appointments live **only in server memory**: no database, no files, no `localStorage` or `sessionStorage`.
* **Refreshing the page** starts a new, empty session. **Reset Demo** ends any active call and empties the session, so every slot is free again.
* Two visitors (or two tabs) never see or block each other's appointments.
* Idle sessions expire after 30 minutes. A server restart (for example, a free-tier host waking up) clears everything, and the page says so.

---

## Retell configuration

The scheduling rules only work if Julia calls the two functions, so this setup is **required**. It needs a public HTTPS URL (your Render link). For local development, use a tunnel such as `cloudflared tunnel --url http://localhost:8787` and use the URL it prints.

### 1. Add two custom functions

In the Retell dashboard, open the agent and go to **Functions → + Add → Custom Function**. Replace `https://YOUR-APP.onrender.com` with your link.

**Function 1 — `check_availability`**

* **Name:** `check_availability`
* **Description:** `Checks whether a requested appointment start time is free. Every appointment lasts 60 minutes and appointments cannot overlap. Call this after you know the date and time the caller wants, before confirming anything. It never books.`
* **Method / URL:** `POST https://YOUR-APP.onrender.com/api/tools/check-availability`
* **Headers:** `X-Julia-Tool-Secret` = the same value as `RETELL_TOOL_SECRET`
* **Parameters (JSON):**

```json
{
  "type": "object",
  "properties": {
    "date": { "type": "string", "description": "Requested date as YYYY-MM-DD, or as the caller said it, e.g. 'tomorrow' or 'Friday'" },
    "time": { "type": "string", "description": "Requested start time, e.g. '8:00 PM' or '20:00'" }
  },
  "required": ["date", "time"]
}
```

**Function 2 — `book_appointment`**

* **Name:** `book_appointment`
* **Description:** `Books a 60-minute appointment. Only call this after check_availability said the time is available AND the caller has agreed to the details. The appointment exists only if the result says booked: true.`
* **Method / URL:** `POST https://YOUR-APP.onrender.com/api/tools/book-appointment`
* **Headers:** `X-Julia-Tool-Secret` = the same value as `RETELL_TOOL_SECRET`
* **Parameters (JSON):**

```json
{
  "type": "object",
  "properties": {
    "customer_name": { "type": "string", "description": "The customer's name" },
    "date": { "type": "string", "description": "Appointment date as YYYY-MM-DD, or as the caller said it" },
    "time": { "type": "string", "description": "Appointment start time, e.g. '8:00 PM'" },
    "service": { "type": "string", "description": "Service requested, e.g. 'Haircut'. Defaults to Haircut" }
  },
  "required": ["customer_name", "date", "time"]
}
```

For both functions:
* Turn on **Speak during execution** (e.g. "One moment while I check the schedule") and **Speak after execution**.
* Use a timeout of about **10 seconds**.
* Leave **Payload: args only** *off*. The server needs the call id that Retell sends alongside the arguments.

### 2. Replace step 6 of the "Booking Simulation" prompt section

Paste this into Julia's prompt in place of "6. Once confirmed, clearly state that the appointment is booked":

```
# Scheduling rules (mandatory)
- Every appointment lasts exactly 60 minutes. You cannot see the calendar; the scheduling functions are the only source of truth.
- Once you know the caller's name, the date and the time, call check_availability. Do not guess availability.
- If it returns available: false, say something natural like "That time is already booked. I can offer you 9:00 PM instead. Would that work for you?" Only offer times listed in the result. Wait for the caller to agree, then call check_availability again for the agreed time.
- When the time is available, repeat the name, service, date and time and ask the caller to confirm. After they say yes, call book_appointment.
- Only if book_appointment returns booked: true, say: "Perfect, [name], you're all set for [service] on [day and date] at [time]."
- If book_appointment returns booked: false, never say the appointment is booked. Follow the message in the result and offer its alternatives.
- Never tell the caller an appointment is booked or confirmed without a successful book_appointment result.
- If the caller wants a different time after booking, check the new time, then call book_appointment again with the same name; the system moves the appointment.
```

### 3. Publish, and check data storage

* Click **Publish**. Web calls use the published version.
* Keep the agent's data storage setting on one that retains transcripts. Otherwise the live transcript (and the safety-net check) is unavailable. Scheduling itself still works.

---

## Project structure

```
julia-ai-demo/
├── .env.example              # placeholder config (copy to .env)
├── package.json              # scripts & dependencies (single package)
├── vite.config.ts            # Vite (root: client/, /api proxied to Express)
├── tsconfig.json
├── server/
│   ├── index.ts              # starts the server
│   ├── config.ts             # env loading & validation
│   ├── logger.ts             # concise logs, no secrets
│   ├── retell.ts             # server-side Retell client + safe error mapping
│   ├── callRegistry.ts       # in-memory set of call ids created by this server
│   ├── app.ts                # Express app (routes, security headers, static files)
│   ├── demoSessions.ts       # per-page demo calendars in memory + SSE broadcast
│   ├── scheduler.ts          # booking authority: check / book / reschedule / dedupe
│   ├── liveMonitor.ts        # monitorCall() transcript → SSE + "claimed but not booked" check
│   └── routes/
│       ├── retellProxy.ts    # narrow, rate-limited proxy for the browser SDK
│       ├── tools.ts          # Retell function endpoints (signature / secret auth)
│       ├── demoSessions.ts   # create / events (SSE) / reset
│       └── calls.ts          # live transcript stream (SSE)
├── shared/
│   ├── scheduling.ts         # 60-minute slots, overlap rules, alternatives — pure, tested
│   ├── booking.ts            # EN/FR date/time parsing + confirmation detection — pure, tested
│   └── api.ts                # types shared by server and client
├── client/
│   ├── index.html            # Google Fonts: Inter 400–600, Nunito 600–800
│   ├── public/favicon.svg
│   └── src/
│       ├── App.tsx, main.tsx
│       ├── styles/theme.css  # brand design tokens (colours, type, spacing, radii)
│       ├── styles/global.css # components, responsive & reduced-motion rules
│       ├── hooks/useVoiceCall.ts     # call lifecycle, mic flow, live transcript
│       ├── hooks/useDemoSession.ts   # this page's demo calendar (live from the server)
│       ├── lib/              # SDK loader (proxied), types, formatting
│       └── components/       # Navbar, Hero, VoiceDemo, VoiceOrb, CallControls,
│                             # LiveTranscript, SchedulingStatus, AppointmentsDashboard,
│                             # AppointmentRow, ResetDemoButton, Capabilities, Footer
├── scripts/check-bundle-secrets.mjs
└── tests/                    # node:test unit tests (run with tsx)
```

### Design notes

* All colours come from the five brand tokens in `client/src/styles/theme.css`. The page is light (`#F9F5FF`) with charcoal text. The voice stage is a charcoal panel so the orb's cyan glow reads clearly.
* **One exception to the palette:** `--color-danger` (`#E5484D`), used only for error icons and borders. An error needs a signal that can't be mistaken for the blue "info" states.
* The voice orb has distinct idle, connecting, listening, speaking (reacts to Julia's audio level), ended and error states. All animation is disabled under `prefers-reduced-motion`.

---

## Troubleshooting

**Microphone permission denied / "Microphone access is blocked"**
Click the lock or microphone icon in the address bar, allow the microphone for this site, then click *Start a new conversation*. On Ubuntu, also check *Settings → Privacy → Microphone* and *Settings → Sound → Input*.

**"Microphone needs a secure page"**
Browsers only allow microphones on `https://` or `http://localhost`. Use `http://localhost:5173`, not a LAN IP like `http://192.168.x.x`. To present from another device, serve the app over HTTPS (for example through a tunnel).

**Browser requirements**
Use a recent Chrome, Edge, Firefox or Safari with WebRTC. Headphones prevent Julia from hearing herself.

**"The demo server is not configured yet: RETELL_API_KEY is missing"**
Create `.env` from `.env.example`, set `RETELL_API_KEY`, and restart `npm run dev`.

**"Retell rejected the server's API key" / "could not find the configured agent"**
The key is wrong or revoked, or `RETELL_AGENT_ID` belongs to another workspace. Check both in the Retell dashboard.

**"The connection to Julia failed"**
Usually a VPN, corporate firewall or proxy that blocks WebRTC/UDP. Try another network. Server logs (terminal running `npm run dev`) show the Retell status code, never the key.

**"Too many demo calls"**
The per-IP limit was hit. Wait, or raise `CALL_RATE_LIMIT_MAX` in `.env`.

**Live transcript says "unavailable"**
The server couldn't open Retell's transcript stream (Node < 22, network, or key permissions). The call and scheduling still work.

**Julia says she booked it, but nothing appears / "the scheduler disagrees"**
Julia is not calling `book_appointment`. Check that both functions exist on the agent, the agent is **published**, the URLs point at your deployed app, and the prompt section from *Retell configuration* is in place. Server logs show every function call (`[tools] book_appointment … → booked`).

**Function calls fail with 401 in the server logs**
The `X-Julia-Tool-Secret` header on the function doesn't match `RETELL_TOOL_SECRET` (watch for spaces), or the signature couldn't be verified. Set the same secret in both places and redeploy.

**Julia can't book anything locally**
Retell can't reach `localhost`. Use your Render URL in the functions, or run a tunnel (`cloudflared tunnel --url http://localhost:8787`) and use its HTTPS URL.

**"The demo server restarted, so the dashboard was cleared"**
Free hosting tiers sleep and restart. Demo calendars live in memory, so a restart empties them. That is expected.

---

## Testing status

Verified locally (in a sandbox without access to Retell's servers):

* `npm run typecheck`, `npm run build` and `npm test` all pass. There are 26 tests:
  * **Scheduling rules:** 60-minute intervals, partial overlaps refused, back-to-back allowed, 9:00 PM offered when 8:00 PM is taken, outside hours and past times, full days rolling over, rescheduling.
  * **HTTP tests of the function endpoints, using requests signed exactly as Retell signs them:**
    * unsigned or forged requests rejected;
    * a check never books;
    * the same confirmation twice gives one appointment;
    * a conflicting booking is refused even when the agent skips the check;
    * reschedule moves rather than duplicates;
    * Reset frees every slot;
    * sessions are isolated;
    * calls without a live demo session are refused.
* **Browser run against the real scheduler** (Playwright/Chromium). Only the Retell audio was stubbed, and the harness sent signed function calls as Retell would. Covered: booking appears live; duplicate ignored; conflict shows "That time isn't available" with 9:00 PM offered; the conflicting booking is refused; back-to-back accepted; Reset frees 8:00 PM again; refresh starts an empty calendar with no web storage; no horizontal overflow on mobile.
* **Secret handling:** with a dummy key, the built bundle, served assets, API responses and logs contain no trace of it.

**Still needs a real test with your Retell agent:** a voice call where Julia actually calls `check_availability` and `book_appointment`. This needs the function setup above and a publish. Try: book 8 PM, then start a new call and ask for 8:30 PM. Julia should offer 9:00 PM.
