import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { config, isRetellConfigured } from "../config.ts";
import { retell, describeRetellError } from "../retell.ts";
import { registerCall, isKnownCall, CALL_ID_PATTERN } from "../callRegistry.ts";
import { log, shortId } from "../logger.ts";

/**
 * Narrow proxy for the browser's Retell SDK (the pattern documented in the
 * retell-client-js-sdk README). The browser SDK is constructed with a dummy
 * key and a custom `fetch` that points here; this router adds the real secret
 * key server-side. Only the two endpoints a web call needs are exposed, and
 * the agent id is always taken from server config — never from the browser.
 */
export const retellProxy = Router();

const createCallLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) => {
    log.warn("calls", `rate limit hit by ${req.ip}`);
    res.status(429).json({
      error_message: "Too many demo calls from this device. Please wait a few minutes and try again.",
    });
  },
});

retellProxy.post("/v3/create-web-call", createCallLimiter, async (req, res) => {
  if (!isRetellConfigured()) {
    log.error("calls", "cannot create call: RETELL_API_KEY is missing (see .env.example)");
    return res.status(503).json({
      error_message: "The demo server is not configured yet: RETELL_API_KEY is missing.",
    });
  }
  // The browser may send fields, but nothing it sends is trusted or forwarded.
  if (req.body !== undefined && (typeof req.body !== "object" || Array.isArray(req.body))) {
    return res.status(400).json({ error_message: "Invalid request body." });
  }

  try {
    const call = await retell().call.createWebCall({
      agent_id: config.retellAgentId,
      metadata: { source: "julia-ai-demo" },
    });
    registerCall(call.call_id);
    log.info("calls", `web call created ${shortId(call.call_id)}`);
    // access_token is a single-call, short-lived join token — not the API key.
    res.json(call);
  } catch (err) {
    const { status, message, detail } = describeRetellError(err);
    log.error("calls", `create-web-call failed: ${detail}`);
    res.status(status).json({ error_message: message });
  }
});

// Used by the SDK if a call is cancelled while it is still being created.
retellProxy.post("/v2/stop-call/:callId", async (req, res) => {
  const { callId } = req.params;
  if (!CALL_ID_PATTERN.test(callId) || !isKnownCall(callId)) {
    return res.status(404).json({ error_message: "Unknown call." });
  }
  try {
    await retell().call.stop(callId);
    log.info("calls", `stopped ${shortId(callId)}`);
    res.status(204).end();
  } catch (err) {
    const { status, message, detail } = describeRetellError(err);
    log.warn("calls", `stop-call failed for ${shortId(callId)}: ${detail}`);
    res.status(status).json({ error_message: message });
  }
});

retellProxy.all("/{*rest}", (_req, res) => {
  res.status(404).json({ error_message: "Not available." });
});
