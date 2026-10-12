import { app } from "./app.ts";
import { config, isRetellConfigured } from "./config.ts";
import { disposeAllMonitors } from "./liveMonitor.ts";
import { disposeAllSessions } from "./demoSessions.ts";
import { log } from "./logger.ts";

const server = app.listen(config.port, () => {
  log.info("server", `Julia AI demo API listening on http://localhost:${config.port}`);
  log.info("server", `agent: ${config.retellAgentId} · time zone: ${config.timeZone}`);
  const h = config.businessHours;
  log.info("server", `scheduling: 60-minute slots, open ${String(h.open / 60 | 0).padStart(2, "0")}:${String(h.open % 60).padStart(2, "0")}–${String(h.close / 60 | 0).padStart(2, "0")}:${String(h.close % 60).padStart(2, "0")}`);
  if (!config.toolSecret) log.warn("server", "RETELL_TOOL_SECRET not set — function calls are accepted only with a valid Retell signature.");
  if (!isRetellConfigured()) {
    log.warn("server", "RETELL_API_KEY is not set. Copy .env.example to .env and add your Retell secret key.");
  }
  if (config.isProduction) log.info("server", `open http://localhost:${config.port}`);
});

const shutdown = () => {
  disposeAllMonitors();
  disposeAllSessions();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
