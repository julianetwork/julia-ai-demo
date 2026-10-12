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
  const secretHeader = req.get("x-julia-tool-secret");
  if (secretMatches(secretHeader)) return next();
  const signature = req.get("x-retell-signature");
  const raw = (req as RawRequest).rawBody;
  let signatureValid = false;
  if (signature && raw && config.retellApiKey) {
    try {
      signatureValid = await verify(raw, config.retellApiKey, signature);
    } catch {
      /* treated as invalid */
    }
  }
  if (signatureValid) return next();
  // Explain exactly why (without revealing any secret) so setup problems are easy to fix.
  const reasons = [
    !config.toolSecret
      ? "RETELL_TOOL_SECRET is not set on the server"
      : !secretHeader
        ? "the function has no X-Julia-Tool-Secret header"
        : "the X-Julia-Tool-Secret header does not match RETELL_TOOL_SECRET",
    !signature ? "no X-Retell-Signature header" : "X-Retell-Signature did not verify against RETELL_API_KEY",
  ];
  log.warn("tools", `401 for ${req.path}: ${reasons.join("; ")}`);
  res.status(401).json({ error: "Unauthorized", hint: "Set the same secret in RETELL_TOOL_SECRET and the function's X-Julia-Tool-Secret header." });
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

// A function URL that doesn't match either endpoint: log it so a typo in Retell is visible.
toolsRouter.use((req, res) => {
  log.warn("tools", `no such function endpoint: ${req.method} /api/tools${req.path} — expected POST /api/tools/check-availability or /api/tools/book-appointment`);
  res.status(404).json({ error: "Unknown function endpoint" });
});
