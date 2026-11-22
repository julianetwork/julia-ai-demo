#!/usr/bin/env node
/**
 * One-time Google sign-in for Jarvis. Prints the GOOGLE_REFRESH_TOKEN to put in .env.
 *
 *   1. Google Cloud Console → APIs & Services: enable "Google Calendar API" and "Gmail API".
 *   2. Credentials → Create OAuth client ID → type "Desktop app".
 *   3. Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env, then run:  npm run google:auth
 *
 * Runs on your own computer: it opens a sign-in link and listens on
 * http://127.0.0.1:53682 for Google's redirect. The token is printed only to
 * this terminal and never sent anywhere else.
 */
import "dotenv/config";
import http from "node:http";
import { randomBytes } from "node:crypto";

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first (OAuth client of type Desktop app).");
  process.exit(1);
}

const PORT = 53682;
const redirect = `http://127.0.0.1:${PORT}`;
const state = randomBytes(16).toString("hex");
const scopes = [
  "https://www.googleapis.com/auth/calendar.events", // read + add events
  "https://www.googleapis.com/auth/gmail.readonly", // read inbox
  "https://www.googleapis.com/auth/gmail.compose", // save drafts (Jarvis never sends)
];
const url =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

const server = http.createServer(async (req, res) => {
  const q = new URL(req.url ?? "/", redirect).searchParams;
  if (q.get("state") !== state || !q.get("code")) {
    res.writeHead(400).end("Sign-in failed or was cancelled. Check the terminal.");
    return;
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: q.get("code"),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    }),
  });
  const body = await tokenRes.json();
  if (!body.refresh_token) {
    res.writeHead(500).end("Google returned no refresh token. Check the terminal.");
    console.error("No refresh token in Google's response:", body.error ?? body);
  } else {
    res.writeHead(200, { "content-type": "text/plain" }).end("Done. You can close this tab and go back to the terminal.");
    console.log("\nAdd this line to .env (and to your host's environment variables):\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${body.refresh_token}\n`);
  }
  server.close();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Open this link and sign in with the Google account Jarvis should manage:\n");
  console.log(url + "\n");
});
