import { Router, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { config, isRetellConfigured } from "../config.ts";
import { retell, describeRetellError } from "../retell.ts";
import { textOwner } from "../jarvis.ts";
import { log } from "../logger.ts";

/**
 * Owner-triggered actions: make Jarvis call you, or text you.
 *   POST /api/jarvis/call-me   { "reason"?: "morning briefing" }
 *   POST /api/jarvis/text-me   { "message": "..." }
 * Both need the X-Jarvis-Secret header (JARVIS_ADMIN_SECRET) and only ever
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

jarvisAdminRouter.post("/call-me", requireSecret, async (req, res) => {
  const to = config.jarvis.ownerNumbers[0];
  if (!isRetellConfigured() || !config.jarvis.phoneNumber || !config.jarvis.agentId || !to) {
    res.status(503).json({ error: "Set RETELL_API_KEY, JARVIS_PHONE_NUMBER, JARVIS_AGENT_ID and JARVIS_OWNER_NUMBERS first." });
    return;
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : "the owner asked for a call";
  try {
    const call = await retell().call.createPhoneCall({
      from_number: config.jarvis.phoneNumber,
      to_number: to,
      override_agent_id: config.jarvis.agentId,
      retell_llm_dynamic_variables: { call_reason: reason },
      metadata: { jarvis_outbound: true },
    });
    log.info("jarvis", "outbound call to owner started");
    res.status(201).json({ ok: true, call_id: call.call_id });
  } catch (err) {
    const e = describeRetellError(err);
    log.error("jarvis", `call-me failed: ${e.detail}`);
    res.status(e.status).json({ error: e.message });
  }
});

jarvisAdminRouter.post("/text-me", requireSecret, async (req, res) => {
  const result = await textOwner(typeof req.body?.message === "string" ? req.body.message : "");
  res.status(result.ok ? 201 : 400).json(result);
});
