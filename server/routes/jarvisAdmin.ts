import { Router, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { config, isRetellConfigured } from "../config.ts";
import { retell, describeRetellError } from "../retell.ts";
import { textOwner } from "../jarvis.ts";
import { buildBriefing } from "../briefing.ts";
import { isGoogleConfigured } from "../google.ts";
import { log } from "../logger.ts";

/**
 * Owner-triggered actions: make Jarvis call you, or text you.
 *   POST /api/jarvis/call-me   { "reason"?: "morning briefing" }
 *   POST /api/jarvis/text-me   { "message": "..." }
 *   POST /api/jarvis/briefing  { "mode"?: "text" | "call" }
 * All need the X-Jarvis-Secret header (JARVIS_ADMIN_SECRET) and only ever
 * reach the owner's own number — never an arbitrary one.
 */
export const jarvisAdminRouter = Router();

function requireSecret(req: Request, res: Response, next: NextFunction) {
  const given = Buffer.from(req.get("x-jarvis-secret") ?? "");
  const want = Buffer.from(config.jarvis.adminSecret);
  if (want.length >= 16 && given.length === want.length && timingSafeEqual(given, want)) return next();
  log.warn("jarvis", `401 for ${req.path}${want.length < 16 ? " (JARVIS_ADMIN_SECRET unset or shorter than 16 chars)" : ""}`);
  res.status(401).json({ error: "Unauthorized" });
}

const callNotReady = () =>
  !isRetellConfigured() || !config.jarvis.phoneNumber || !config.jarvis.agentId || !config.jarvis.ownerNumbers[0];
const CALL_SETUP = "Set RETELL_API_KEY, JARVIS_PHONE_NUMBER, JARVIS_AGENT_ID and JARVIS_OWNER_NUMBERS first.";

/** Rings the owner's first number from Jarvis's number. The destination never comes from the request. */
async function callOwner(res: Response, vars: Record<string, string>, label: string) {
  try {
    const call = await retell().call.createPhoneCall({
      from_number: config.jarvis.phoneNumber,
      to_number: config.jarvis.ownerNumbers[0],
      override_agent_id: config.jarvis.agentId,
      retell_llm_dynamic_variables: vars,
      metadata: { jarvis_outbound: true },
    });
    log.info("jarvis", `outbound ${label} call to owner started`);
    res.status(201).json({ ok: true, call_id: call.call_id });
  } catch (err) {
    const e = describeRetellError(err);
    log.error("jarvis", `${label} call failed: ${e.detail}`);
    res.status(e.status).json({ error: e.message });
  }
}

jarvisAdminRouter.post("/call-me", requireSecret, async (req, res) => {
  if (callNotReady()) {
    res.status(503).json({ error: CALL_SETUP });
    return;
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : "the owner asked for a call";
  await callOwner(res, { call_reason: reason }, "call-me");
});

jarvisAdminRouter.post("/text-me", requireSecret, async (req, res) => {
  const result = await textOwner(typeof req.body?.message === "string" ? req.body.message : "");
  res.status(result.ok ? 201 : 400).json(result);
});

/**
 * Today's calendar and unread mail, texted (default) or read out on a call.
 * Meant for a scheduler (e.g. every morning at 7:30), so failures return a
 * clear status rather than a half-sent briefing.
 */
jarvisAdminRouter.post("/briefing", requireSecret, async (req, res) => {
  const mode = req.body?.mode ?? "text";
  if (mode !== "text" && mode !== "call") {
    res.status(400).json({ error: 'mode must be "text" or "call".' });
    return;
  }
  if (!isGoogleConfigured()) {
    res.status(503).json({ error: "Google is not connected: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN (npm run google:auth)." });
    return;
  }
  // Check before reading Google, so a misconfigured call doesn't fetch mail for nothing.
  if (mode === "call" && callNotReady()) {
    res.status(503).json({ error: CALL_SETUP });
    return;
  }
  let briefing: string;
  try {
    briefing = await buildBriefing();
  } catch (err) {
    log.error("jarvis", `briefing failed: ${err instanceof Error ? err.message : String(err)}`);
    res.status(502).json({ error: "Couldn't read Google Calendar or Gmail for the briefing." });
    return;
  }
  if (mode === "call") {
    await callOwner(res, { call_reason: "daily briefing", briefing }, "briefing");
    return;
  }
  const result = await textOwner(briefing);
  log.info("jarvis", `briefing text ${result.ok ? "sent" : "failed"}`);
  res.status(result.ok ? 201 : 502).json(result);
});
