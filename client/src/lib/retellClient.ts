import type { RetellClient } from "retell-client-js-sdk";

/**
 * Browser-side Retell client.
 *
 * Following the proxy pattern from the official retell-client-js-sdk README,
 * the client gets a placeholder key and a custom `fetch` that routes the
 * SDK's REST calls (create-web-call) to our own backend, which attaches the
 * real secret key server-side. No Retell credential ever exists in the browser;
 * the only thing the page receives is a short-lived, single-call access token.
 *
 * The SDK (which bundles the WebRTC stack) is loaded on demand so the landing
 * page stays light.
 */
let clientPromise: Promise<RetellClient> | null = null;

export function loadRetellClient(): Promise<RetellClient> {
  clientPromise ??= import("retell-client-js-sdk")
    .then(
      ({ RetellClient }) =>
        new RetellClient({
          key: "server-side-proxy",
          fetch: (url, init) => fetch(`/api/retell${new URL(String(url)).pathname}`, init),
        }),
    )
    .catch((err) => {
      clientPromise = null;
      throw err;
    });
  return clientPromise;
}

/** The server always substitutes its configured RETELL_AGENT_ID. */
export const SERVER_CONFIGURED_AGENT = "configured-on-server";
