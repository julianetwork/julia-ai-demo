import express, { Router, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { verify } from "retell-sdk";
import { config } from "../config.ts";
import { sessionIdForCall, CALL_ID_PATTERN } from "../callRegistry.ts";
import { getSession, ephemeralSessionForCall, type DemoSession } from "../demoSessions.ts";
import { checkSlot, bookSlot } from "../scheduler.ts";
import { log, shortId } from "../logger.ts";

/**
 * Endpoints for Julia's Retell custom functions (check_availability,
 * book_appointment). Retell POSTs `{ name, call, args }` while the call is in
 * progress; the JSON we return is what the agent reads before it speaks.
 *
 * Authentication: a request is accepted if it carries a valid Retell
 * signature (X-Retell-Signature, verified with the API key against the raw
 * body) or, when RETELL_TOOL_SECRET is configured, the matching
 * X-Julia-Tool-Secret header set on the function in Retell.
 */
export const toolsRouter = Router();

type RawRequest = Request & { rawBody?: string };

toolsRouter.use(
  express.json({
    limit: "1mb", // the payload includes the call object and its transcript so far
    verify: (req, _res, buf) => {
      (req as RawRequest).rawBody = buf.toString("utf8");
    },
  }),
);

function secretMatches(provided: string | undefined): boolean {
  if (!config.toolSecret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(config.toolSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authenticate(req: Request, res: Response, next: NextFunction) {
  if (secretMatches(req.get("x-julia-tool-secret"))) return next();
  const signature = req.get("x-retell-signature");
  const raw = (req as RawRequest).rawBody;
  if (signature && raw && config.retellApiKey) {
    try {
      if (await verify(raw, config.retellApiKey, signature)) return next();
    } catch {
      /* fall through */
    }
  }
  log.warn("tools", `rejected unauthenticated tool call from ${req.ip}`);
  res.status(401).json({ error: "Unauthorized" });
}

interface ToolBody {
  name?: string;
  call?: { call_id?: string; metadata?: { demo_session_id?: string } };
  call_id?: string;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Finds the demo session (visitor) a function call belongs to. */
function resolve(req: Request): { session: DemoSession; callId: string | null; attached: boolean } {
  const body = (req.body ?? {}) as ToolBody;
  const rawId = body.call?.call_id ?? body.call_id;
  const callId = typeof rawId === "string" && CALL_ID_PATTERN.test(rawId) ? rawId : null;
  const sessionId = (callId && sessionIdForCall(callId)) || body.call?.metadata?.demo_session_id;
  const session = typeof sessionId === "string" ? getSession(sessionId) : undefined;
  if (session) return { session, callId, attached: true };
  // A call with no demo page (e.g. Retell's dashboard test): keep a private scratch calendar per call.
  return { session: ephemeralSessionForCall(callId ?? "unknown"), callId, attached: false };
}

function args(req: Request): Record<string, unknown> {
  const body = (req.body ?? {}) as ToolBody;
  // Supports both the default `{ args: {...} }` payload and "args at root".
  const a = body.args && typeof body.args === "object" ? body.args : body;
  return a as Record<string, unknown>;
}

toolsRouter.post("/check-availability", authenticate, (req, res) => {
  const { session, callId, attached } = resolve(req);
  const result = checkSlot(session, callId, args(req));
  log.info("tools", `check_availability ${callId ? shortId(callId) : "(no call id)"}${attached ? "" : " [no demo page]"} → ${result.available ? "available" : result.reason}`);
  res.json(result);
});

toolsRouter.post("/book-appointment", authenticate, (req, res) => {
  const { session, callId, attached } = resolve(req);
  const result = bookSlot(session, callId, args(req));
  log.info("tools", `book_appointment ${callId ? shortId(callId) : "(no call id)"}${attached ? "" : " [no demo page]"} → ${result.booked ? "booked" : result.reason}`);
  res.json(result);
});
