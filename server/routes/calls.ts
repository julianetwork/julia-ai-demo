import { Router, type Request, type Response, type NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { isRetellConfigured } from "../config.ts";
import { isKnownCall, CALL_ID_PATTERN } from "../callRegistry.ts";
import { getMonitor } from "../liveMonitor.ts";

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

/** Live transcript of a call (and a warning if Julia claims a booking the scheduler never made), as SSE. */
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
