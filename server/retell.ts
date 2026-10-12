import Retell, { APIError } from "retell-sdk";
import { config } from "./config.ts";

/**
 * Server-side Retell client (official `retell-sdk`). It holds the secret key,
 * so it must only ever be used from the backend.
 */
let client: Retell | null = null;

export function retell(): Retell {
  if (!config.retellApiKey) throw new Error("RETELL_API_KEY is not configured");
  client ??= new Retell({ apiKey: config.retellApiKey, maxRetries: 1, timeout: 15_000 });
  return client;
}

/** Maps a Retell API failure to a safe, user-presentable message + HTTP status. */
export function describeRetellError(err: unknown): { status: number; message: string; detail: string } {
  if (err instanceof APIError) {
    const upstream = err.status ?? 0;
    if (upstream === 401 || upstream === 403) {
      return { status: 502, message: "Retell rejected the server's API key. Check RETELL_API_KEY.", detail: `upstream ${upstream}` };
    }
    if (upstream === 404) {
      return { status: 502, message: "Retell could not find the configured agent. Check RETELL_AGENT_ID.", detail: "upstream 404" };
    }
    if (upstream === 402) {
      return { status: 502, message: "The Retell account cannot place calls right now (billing or credits).", detail: "upstream 402" };
    }
    if (upstream === 429) {
      return { status: 503, message: "Retell is rate limiting or out of concurrency. Please try again shortly.", detail: "upstream 429" };
    }
    if (upstream === 422 || upstream === 400) {
      return { status: 502, message: "Retell rejected the call request.", detail: `upstream ${upstream}: ${err.message.slice(0, 200)}` };
    }
    return { status: 502, message: "Retell is unavailable right now. Please try again.", detail: `upstream ${upstream || "network"}` };
  }
  return { status: 500, message: "Unexpected server error.", detail: err instanceof Error ? err.message : String(err) };
}
