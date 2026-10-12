import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config, isRetellConfigured } from "./config.ts";
import { retellProxy } from "./routes/retellProxy.ts";
import { callsRouter } from "./routes/calls.ts";
import { demoSessionsRouter } from "./routes/demoSessions.ts";
import { toolsRouter } from "./routes/tools.ts";
import { log } from "./logger.ts";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", config.trustProxy);

app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    // The page needs the microphone; nothing else.
    "Permissions-Policy": "microphone=(self), camera=(), geolocation=()",
  });
  next();
});
// Retell function calls need the raw body for signature checks, so they get their own parser.
app.use("/api/tools", toolsRouter);
app.use("/api", express.json({ limit: "16kb" }));

app.get("/api/health", (_req, res) => {
  // Reports whether things are configured — never their values.
  res.json({
    ok: true,
    retellConfigured: isRetellConfigured(),
    agentConfigured: Boolean(config.retellAgentId),
    toolSecretConfigured: Boolean(config.toolSecret),
  });
});
app.use("/api/retell", retellProxy);
app.use("/api/calls", callsRouter);
app.use("/api/demo-sessions", demoSessionsRouter);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Malformed JSON and other request errors: answer safely, log briefly.
app.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) log.error("http", err.message);
  res.status(status).json({ error_message: status === 500 ? "Unexpected server error." : "Invalid request." });
});

// Production: serve the built frontend from the same origin.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client/dist");
if (config.isProduction) {
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
    app.get("/{*rest}", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  } else {
    log.warn("http", "client/dist not found — run `npm run build` first.");
  }
}

