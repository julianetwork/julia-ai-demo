import { Router, type Request, type Response, type NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { config, isRetellConfigured } from "../config.ts";
import { retell, describeRetellError } from "../retell.ts";
import { isKnownCall, CALL_ID_PATTERN } from "../callRegistry.ts";
import { getMonitor } from "../liveMonitor.ts";
import { log, shortId } from "../logger.ts";
import {
  extractBooking,
  fromPostCallAnalysis,
  type TranscriptLine,
} from "../../shared/booking.ts";
import type { BookingVerification } from "../../shared/api.ts";

export const callsRouter = Router();

const readLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });

function requireKnownCall(req: Request, res: Response, next: NextFunction) {
  const callId = String(req.params.callId ?? "");
  if (!CALL_ID_PATTERN.test(callId) || !isKnownCall(callId)) {
    return res.status(404).json({ error: "Unknown call. Only calls started from this demo can be inspected." });
  }
  if (!isRetellConfigured()) return res.status(503).json({ error: "RETELL_API_KEY is not configured." });
  next();
}

/** Live transcript + live booking detection, as Server-Sent Events. */
callsRouter.get("/:callId/stream", readLimiter, requireKnownCall, (req, res) => {
  const callId = String(req.params.callId);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 3000\n\n");

  const monitor = getMonitor(callId);
  monitor.subscribe(res);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    monitor.unsubscribe(res);
  });
});

/**
 * Post-call verification against Retell's stored record of the call. This is
 * authoritative: it uses the final transcript and, if configured on the agent,
 * the structured post-call analysis fields. The page polls it after a call.
 */
callsRouter.get("/:callId/booking", readLimiter, requireKnownCall, async (req, res) => {
  const callId = String(req.params.callId);
  try {
    const call = await retell().call.retrieve(callId);
    const reply = (body: BookingVerification) => res.json(body);

    if (call.call_status === "registered" || call.call_status === "ongoing") {
      return reply({ state: "pending", reason: "call_in_progress" });
    }
    if (call.call_status === "not_connected" || call.call_status === "error") {
      return reply({ state: "unavailable", reason: "call_not_connected" });
    }

    const endedAgoMs = call.end_timestamp ? Date.now() - call.end_timestamp : Infinity;
    const opts = {
      referenceDate: call.start_timestamp ? new Date(call.start_timestamp) : new Date(),
      timeZone: config.timeZone,
    };
    const disconnectionReason = call.disconnection_reason ?? null;

    // 1. Structured post-call analysis (only if the agent defines these fields).
    const structured = fromPostCallAnalysis(call.call_analysis?.custom_analysis_data, opts);
    if (structured) {
      log.info("verify", `${shortId(callId)}: ${structured.status} via post-call analysis`);
      return reply({ state: structured.status, method: "post_call_analysis", result: structured, disconnectionReason });
    }

    // Give Retell a short moment to finish post-call processing.
    const transcript: TranscriptLine[] = (call.transcript_object ?? []).map((u) => ({
      role: u.role,
      content: u.content,
    }));
    if (!call.call_analysis && endedAgoMs < 15_000) {
      return reply({ state: "pending", reason: "processing" });
    }
    if (!transcript.length) {
      if (endedAgoMs < 45_000) return reply({ state: "pending", reason: "processing" });
      return reply({ state: "unavailable", reason: "no_transcript" });
    }

    // 2. Transcript fallback (same extractor as the live stream).
    const result = extractBooking(transcript, opts);
    log.info("verify", `${shortId(callId)}: ${result.status} via transcript`);
    return reply({ state: result.status, method: "transcript", result, disconnectionReason });
  } catch (err) {
    const { status, message, detail } = describeRetellError(err);
    if (status === 502 && detail === "upstream 404") {
      return res.json({ state: "unavailable", reason: "not_found" } satisfies BookingVerification);
    }
    log.error("verify", `get-call failed for ${shortId(callId)}: ${detail}`);
    res.status(status).json({ error: message });
  }
});
