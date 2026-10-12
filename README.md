# Julia AI — Interactive Voice Receptionist Demo

A client-facing demo of **Julia**, an AI receptionist for barbershops. A visitor talks to Julia in a real-time voice call in the browser, through Retell AI. They play a customer booking a haircut, and the confirmed booking appears automatically in an appointments dashboard below the call.

> **Demo only.** Bookings are simulated and kept in the page's memory. Nothing is saved, sent, or added to a real calendar. A page refresh or **Reset Demo** clears everything.

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
| `npm test` | Unit tests: booking extraction (EN/FR) and appointment de-duplication |
| `npm run typecheck` | TypeScript only |
| `npm run check:secrets` | Scans `client/dist` to prove no Retell secret is in the bundle (also checks against the real key in `.env`) |

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

If `RETELL_API_KEY` is missing, the server still starts and logs a warning. The page then shows a friendly "not configured" message instead of crashing.

---

## How it works

```
Browser (React)                         Express server                      Retell
───────────────                         ──────────────                      ──────
retell-client-js-sdk ──POST /api/retell/v3/create-web-call──▶ adds secret key ──▶ /v3/create-web-call
   (placeholder key,                    (forces RETELL_AGENT_ID,                 returns access_token
    proxied fetch)     ◀── call_id + short-lived access_token ──┘
   │
   └── WebRTC audio ◀──────────────────────────────────────────────────────────▶ Julia (voice)

EventSource ◀── GET /api/calls/:id/stream (SSE) ── monitorCall() transcript ◀── /v2/monitor-call (WS)
   live transcript + live booking detection         + booking extractor

fetch ──▶ GET /api/calls/:id/booking ── call.retrieve() ──────────────────────▶ /v2/get-call
   post-call verification                (post-call analysis, or final transcript)
```

### Voice call (official SDK, secret key never in the browser)

* The browser uses the official **`retell-client-js-sdk` v3** `RetellClient.createWebCall()`. It follows the **proxy pattern documented in the SDK README**: the client gets a placeholder key and a custom `fetch` that sends the SDK's request to `/api/retell/...` on our server, where the real key is attached.
* The proxy exposes only `POST /v3/create-web-call` (rate-limited) and `POST /v2/stop-call/:id` (only for calls this server created). It ignores anything the browser sends and always uses `RETELL_AGENT_ID`.
* The browser only ever receives a **single-call, short-lived `access_token`**.
* I did not choose a Retell public key, for two reasons. A public key would also live in the browser. And the live transcript needs a key with `Call.Write`, which the SDK README says a web-call-scoped public key doesn't have. The server proxy avoids both problems.

### Automatic booking capture

In SDK v3, the audio connection no longer delivers transcript or "agent talking" events to the browser. The transcript is a separate stream that needs a privileged key. So capture runs on the server, in two layers:

1. **Live (during the call).** The server opens the SDK's own `monitorCall()` (transcript only; it never joins the audio) with the secret key. It relays the transcript to the page over Server-Sent Events and runs the booking extractor on it. A booking is added to the dashboard right after Julia confirms it, with status **Confirmed · Verifying…**.
2. **Verification (after the call).** The page polls `GET /api/calls/:id/booking`. The server fetches Retell's stored call record and uses, in order:
   * **Structured post-call analysis**, if you configure it (recommended, see below).
   * Otherwise the **final transcript**, run through the same extractor.

   A matching booking becomes **Confirmed · Verified**. If the record contradicts the live capture, the row is marked **Needs review**. If Julia cancelled the booking, it is removed.

The extractor (`shared/booking.ts`) is deliberately conservative and handles English and French:

* It requires an **agent** statement of final confirmation, such as "you're all set", "your appointment is confirmed", or "c'est confirmé".
* It ignores questions ("is that correct?"), hypotheticals ("once a booking is confirmed…"), feature descriptions ("appointments are booked automatically"), and negations.
* It requires **name, date and time**. If any is missing, the UI says *"Booking not added — details incomplete"* and adds nothing.
* The latest confirmation wins (callers can change their mind). An agent cancellation after confirming voids the booking.
* Dates ("tomorrow", "Friday", "October 20th", "vendredi", "le 16 octobre") resolve relative to the call date. Times handle "3 PM", "3:30 p.m.", "15 h 30", "two o'clock" and "noon".
* There is one appointment per call id, so repeated events never duplicate a row.

The UI is always explicit about the state: listening, captured, verifying, verified, incomplete, not confirmed, or couldn't be verified.

### Session isolation

* Appointments live in React state only. There is no database, `localStorage` or `sessionStorage`.
* **Reset Demo** ends any active call, cancels pending verification, and clears the transcript, capture status and dashboard.
* Every call gets a new "generation". Late events from an earlier call or a reset session are ignored, so details never leak into the next prospect's demo.
* The server keeps only call ids (for authorizing the stream/verify endpoints) and a live transcript buffer in memory while a call is being watched. These expire automatically.

---

## Retell configuration

The demo works with the agent as published, provided these hold:

1. **The API key** in `.env` must be a secret key from the same workspace as the agent.
2. **Data storage.** The agent's data storage setting must keep transcripts ("everything", or "everything except PII" if you accept a redacted name). With "basic attributes only", post-call verification can't read the transcript. The UI then says the booking couldn't be verified.

**Recommended for the most reliable capture:**

3. **Add these lines to Julia's prompt** in the Retell dashboard:

   > When the caller wants to book, ask for their name, the date, and the time, one question at a time. Repeat the details back and ask them to confirm. After they confirm, say exactly: "Perfect, [name], you're all set for [service] on [day and date] at [time]." Always say times with AM or PM (or "15 h" in French). Never say a booking is confirmed before the caller agrees.

4. **Optional structured signal: post-call analysis.** In the agent's *Post-Call Analysis* settings, add these custom fields. When they are present, the server uses them in preference to the transcript.

   | Name | Type | Description |
   | --- | --- | --- |
   | `booking_confirmed` | Boolean | True only if Julia explicitly confirmed an appointment and the caller agreed |
   | `customer_name` | Text | The customer's name as confirmed |
   | `appointment_date` | Text | The confirmed date (YYYY-MM-DD if possible, otherwise as spoken) |
   | `appointment_time` | Text | The confirmed time, e.g. "3:00 PM" |
   | `service` | Text | The service booked, e.g. "Haircut" |

   Post-call analysis arrives a few seconds after the call ends. The live capture covers the moment of confirmation itself.

No tool or function-calling setup is needed. A Retell custom function would require a publicly reachable webhook URL, which a local demo doesn't have.

---

## Project structure

```
julia-ai-demo/
├── .env.example              # placeholder config (copy to .env)
├── package.json              # scripts & dependencies (single package)
├── vite.config.ts            # Vite (root: client/, /api proxied to Express)
├── tsconfig.json
├── server/
│   ├── index.ts              # Express app, security headers, static serving in prod
│   ├── config.ts             # env loading & validation
│   ├── logger.ts             # concise logs, no secrets
│   ├── retell.ts             # server-side Retell client + safe error mapping
│   ├── callRegistry.ts       # in-memory set of call ids created by this server
│   ├── liveMonitor.ts        # monitorCall() transcript → SSE + live booking detection
│   └── routes/
│       ├── retellProxy.ts    # narrow, rate-limited proxy for the browser SDK
│       └── calls.ts          # /stream (SSE) and /booking (post-call verification)
├── shared/
│   ├── booking.ts            # booking extractor (EN/FR) — pure, unit-tested
│   └── api.ts                # types shared by server and client
├── client/
│   ├── index.html            # Google Fonts: Inter 400–600, Nunito 600–800
│   ├── public/favicon.svg
│   └── src/
│       ├── App.tsx, main.tsx
│       ├── styles/theme.css  # brand design tokens (colours, type, spacing, radii)
│       ├── styles/global.css # components, responsive & reduced-motion rules
│       ├── hooks/useVoiceCall.ts     # call lifecycle, mic flow, SSE, verification
│       ├── hooks/useAppointments.ts  # in-memory appointments (one per call)
│       ├── lib/              # SDK loader (proxied), types, formatting
│       └── components/       # Navbar, Hero, VoiceDemo, VoiceOrb, CallControls,
│                             # LiveTranscript, CaptureStatus, AppointmentsDashboard,
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
The server couldn't open Retell's transcript stream (Node < 22, network, or key permissions). The call still works, and the booking is checked from Retell's call record when the call ends.

**"Booking couldn't be verified"**
Retell didn't return a transcript. Check the agent's data storage setting (see *Retell configuration*).

---

## Testing status

Verified locally (in a sandbox without access to Retell's servers):

* `npm install`, `npm run typecheck`, `npm run build` and `npm test` (15 tests) all pass.
* The backend starts and serves health, the proxy allow-list, rate limiting, input validation and unknown-call rejection. It handles a missing key without crashing.
* **Secret handling:** with a dummy key in `.env`, the built bundle, every served asset, and API responses and logs contain no trace of it.
* A browser run (Playwright/Chromium, Retell SDK and Retell responses stubbed) covered:
  * The empty state.
  * A confirmed booking appearing exactly once, despite repeated live events.
  * The booking being verified after the call.
  * An incomplete call adding nothing.
  * Unexpected call termination being reported.
  * Mute.
  * Reset Demo clearing everything.
  * A refresh clearing everything, with no web storage used.
  * The denied-microphone message.
  * No horizontal overflow at 390 px and 820 px.

**Still needs a real test with your credentials and a microphone:** an actual Retell voice call, and the live transcript stream and post-call verification against your agent. Run through the *Try this script* steps on the page once after adding your key.
