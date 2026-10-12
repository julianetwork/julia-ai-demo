import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { config } from "../config.ts";
import { createSession, getSession } from "../demoSessions.ts";
import { SLOT_MINUTES } from "../../shared/scheduling.ts";
import type { DemoSessionInfo } from "../../shared/api.ts";
import { log } from "../logger.ts";

/** One demo session per open page: its appointments live only in server memory. */
export const demoSessionsRouter = Router();

const createLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
const readLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });

const info = (id: string): DemoSessionInfo => ({
  id,
  timeZone: config.timeZone,
  hours: config.businessHours,
  slotMinutes: SLOT_MINUTES,
});

demoSessionsRouter.post("/", createLimiter, (_req, res) => {
  const session = createSession();
  log.info("sessions", "new demo session");
  res.status(201).json(info(session.id));
});

demoSessionsRouter.get("/:id", readLimiter, (req, res) => {
  const session = getSession(String(req.params.id));
  if (!session) return res.status(404).json({ error: "Session not found" });
  session.touch();
  res.json(info(session.id));
});

/** Live appointments + scheduler activity for the dashboard (Server-Sent Events). */
demoSessionsRouter.get("/:id/events", readLimiter, (req, res) => {
  const session = getSession(String(req.params.id));
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  session.subscribe(res);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    session.unsubscribe(res);
  });
});

/** Reset Demo: clears this session's appointments, freeing every slot. */
demoSessionsRouter.post("/:id/reset", readLimiter, (req, res) => {
  const session = getSession(String(req.params.id));
  if (!session) return res.status(404).json({ error: "Session not found" });
  session.reset();
  log.info("sessions", "demo session reset");
  res.status(204).end();
});
