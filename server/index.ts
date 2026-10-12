import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config, isRetellConfigured } from "./config.ts";
import { retellProxy } from "./routes/retellProxy.ts";
import { callsRouter } from "./routes/calls.ts";
import { disposeAllMonitors } from "./liveMonitor.ts";
import { log } from "./logger.ts";

const app = express();
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
app.use("/api", express.json({ limit: "16kb" }));

app.get("/api/health", (_req, res) => {
  // Reports whether things are configured — never their values.
  res.json({ ok: true, retellConfigured: isRetellConfigured(), agentConfigured: Boolean(config.retellAgentId) });
});
app.use("/api/retell", retellProxy);
app.use("/api/calls", callsRouter);
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

const server = app.listen(config.port, () => {
  log.info("server", `Julia AI demo API listening on http://localhost:${config.port}`);
  log.info("server", `agent: ${config.retellAgentId} · time zone: ${config.timeZone}`);
  if (!isRetellConfigured()) {
    log.warn("server", "RETELL_API_KEY is not set. Copy .env.example to .env and add your Retell secret key.");
  }
  if (config.isProduction) log.info("server", `open http://localhost:${config.port}`);
});

const shutdown = () => {
  disposeAllMonitors();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
