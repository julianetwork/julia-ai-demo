import { RetellClient, type MonitorSession, type LiveCallUtterance } from "retell-client-js-sdk";
import type { Response } from "express";
import { config } from "./config.ts";
import { log, shortId } from "./logger.ts";
import { sessionIdForCall } from "./callRegistry.ts";
import { callHasBooking } from "./demoSessions.ts";
import { extractBooking, type TranscriptLine } from "../shared/booking.ts";
import type { LiveEvent } from "../shared/api.ts";

/**
 * Live transcript relay.
 *
 * With Retell's v3 web calls the browser only receives audio; the transcript
 * stream needs a key with Call.Write, which must never be shipped to the
 * browser. So the server watches the call with the official SDK's
 * `monitorCall()` (transcript only — it never joins the audio) and relays it
 * to the page over Server-Sent Events. The secret key stays on the server.
 *
 * Bookings are NOT created from the transcript — only the scheduler (via
 * Julia's book_appointment function) can do that. The transcript is used as a
 * safety net: if Julia says a booking is confirmed but the scheduler holds no
 * booking for this call, the page is warned.
 */

const EXTRACT_DEBOUNCE_MS = 1200;
const IDLE_DISPOSE_MS = 60_000;

class LiveMonitor {
  private session?: MonitorSession;
  private subscribers = new Set<Response>();
  private lines: TranscriptLine[] = [];
  private lastTranscript?: LiveEvent;
  private lastMonitor: LiveEvent = { type: "monitor", state: "connecting" };
  private lastMismatch?: LiveEvent;
  private ended?: LiveEvent;
  private debounce?: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private readonly startedAt = new Date();

  constructor(
    readonly callId: string,
    private readonly onDispose: () => void,
  ) {
    if (typeof WebSocket === "undefined") {
      log.warn("monitor", "global WebSocket missing (Node 22+ required) — live transcript disabled");
      this.handleError(new Error("WebSocket unavailable in this Node.js version"));
      return;
    }
    const client = new RetellClient({ key: config.retellApiKey });
    this.session = client.monitorCall({
      call_id: callId,
      transcript: true,
      hooks: {
        onTranscript: (transcript) => this.handleTranscript(transcript),
        onEnd: (event) => this.handleEnd(event.disconnection_reason ?? null),
        onError: (err) => this.handleError(err),
      },
    });
    log.info("monitor", `watching transcript for ${shortId(callId)}`);
  }

  subscribe(res: Response) {
    this.subscribers.add(res);
    clearTimeout(this.idleTimer);
    // Replay current state to late joiners (e.g. a reconnecting EventSource).
    for (const ev of [this.lastMonitor, this.lastTranscript, this.lastMismatch, this.ended]) {
      if (ev) send(res, ev);
    }
  }

  unsubscribe(res: Response) {
    this.subscribers.delete(res);
    if (this.subscribers.size === 0) {
      this.idleTimer = setTimeout(() => this.dispose(), this.ended ? 5_000 : IDLE_DISPOSE_MS);
    }
  }

  dispose() {
    clearTimeout(this.debounce);
    clearTimeout(this.idleTimer);
    // disconnect() only leaves the monitor; it never hangs up the call.
    this.session?.disconnect();
    this.session = undefined;
    for (const res of this.subscribers) res.end();
    this.subscribers.clear();
    this.onDispose();
  }

  private broadcast(ev: LiveEvent) {
    for (const res of this.subscribers) send(res, ev);
  }

  private handleTranscript(transcript: LiveCallUtterance[]) {
    if (this.lastMonitor.type === "monitor" && this.lastMonitor.state !== "connected") {
      this.lastMonitor = { type: "monitor", state: "connected" };
      this.broadcast(this.lastMonitor);
    }
    const visible = transcript.filter(
      (u): u is LiveCallUtterance & { role: "agent" | "user"; content: string } =>
        (u.role === "agent" || u.role === "user") && typeof (u as { content?: unknown }).content === "string",
    );
    this.lines = visible.map((u) => ({ role: u.role, content: u.content }));
    this.lastTranscript = {
      type: "transcript",
      lines: visible.map((u) => ({ id: u.id, role: u.role, content: u.content })),
    };
    this.broadcast(this.lastTranscript);

    // Wait for the utterance to settle before judging it (it streams in word by word).
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.evaluate(), EXTRACT_DEBOUNCE_MS);
  }

  private evaluate() {
    const result = extractBooking(this.lines, { referenceDate: this.startedAt, timeZone: config.timeZone });
    if (result.status !== "confirmed" && result.status !== "incomplete") return;
    if (callHasBooking(sessionIdForCall(this.callId), this.callId)) return;
    if (this.lastMismatch?.type === "mismatch" && this.lastMismatch.evidence === result.evidence) return;
    this.lastMismatch = { type: "mismatch", evidence: result.evidence };
    log.warn("monitor", `Julia announced a booking on ${shortId(this.callId)} without a scheduler booking`);
    this.broadcast(this.lastMismatch);
  }

  private handleEnd(reason: string | null) {
    if (this.ended) return;
    // The stream closed before delivering anything: that's a monitor failure,
    // not proof the call ended. The browser's own call session decides that.
    if (!this.lastTranscript) {
      this.handleError(new Error("transcript stream closed before any data"));
      return;
    }
    clearTimeout(this.debounce);
    this.evaluate();
    this.ended = { type: "ended", disconnectionReason: reason };
    log.info("monitor", `call ${shortId(this.callId)} ended${reason ? ` (${reason})` : ""}`);
    this.broadcast(this.ended);
    if (this.subscribers.size === 0) this.idleTimer = setTimeout(() => this.dispose(), 5_000);
  }

  private handleError(err: Error) {
    // Non-fatal errors also arrive here; only report the stream as unavailable
    // if we never managed to receive a transcript.
    log.warn("monitor", `transcript stream issue for ${shortId(this.callId)}: ${err.message}`);
    if (this.lastMonitor.type === "monitor" && this.lastMonitor.state === "connecting") {
      this.lastMonitor = {
        type: "monitor",
        state: "unavailable",
        message: "Live transcript unavailable for this call.",
      };
      this.broadcast(this.lastMonitor);
    }
  }
}

function send(res: Response, ev: LiveEvent) {
  res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
}

const monitors = new Map<string, LiveMonitor>();

export function getMonitor(callId: string): LiveMonitor {
  let monitor = monitors.get(callId);
  if (!monitor) {
    monitor = new LiveMonitor(callId, () => monitors.delete(callId));
    monitors.set(callId, monitor);
  }
  return monitor;
}

export function disposeAllMonitors() {
  for (const m of [...monitors.values()]) m.dispose();
}
