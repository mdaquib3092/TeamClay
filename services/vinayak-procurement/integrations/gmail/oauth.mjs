import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { GMAIL_SCOPES, GmailError } from "./config.mjs";
import { exchangeAuthorizationCode } from "./client.mjs";

export function createAuthorization(config, redirectUri) {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: redirectUri, response_type: "code",
    scope: GMAIL_SCOPES.join(" "), access_type: "offline",
    prompt: "consent select_account", state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    ...(config.expectedEmail ? { login_hint: config.expectedEmail } : {}),
  }).toString();
  return { url: url.href, verifier, state };
}

export function validState(received, expected) {
  if (typeof received !== "string") return false;
  const left = Buffer.from(received), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function html(title, detail, link) {
  const escape = text => text.replace(/[&<>"']/g, char =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title></head><body><main><h1>${escape(title)}</h1><p>${escape(detail)}</p>${link ? `<p><a href="${escape(link)}">Continue to Google to connect Gmail</a></p><p>Requested permissions for the future procurement integration: send email, and read email and attachments. Google grants mailbox-wide read access; use a dedicated test mailbox where possible.</p><p>This phase configures authentication only. Setup checks your mailbox profile; it does not read your inbox or send email.</p>` : ""}</main></body></html>`;
}

export async function startAuthorization(config, {
  port = 0, timeoutMs = 15 * 60_000, fetchImpl = fetch, now = Date.now,
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new GmailError("invalid_port", "Choose a port between 0 and 65535.");
  }
  let resolveCompletion, rejectCompletion;
  const completion = new Promise((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  // A caller may attach its completion handler after the listener starts.
  completion.catch(() => {});
  const controller = new AbortController();
  let settled = false, processing = false, timer, origin, authorization, redirectUri;
  const finish = (error, result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) controller.abort();
    server.close();
    if (error) rejectCompletion(error);
    else resolveCompletion(result);
  };
  const respond = (response, status, title, detail, link) => {
    response.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY", Connection: "close",
    });
    response.end(html(title, detail, link));
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host || request.method !== "GET") {
        respond(response, 400, "Invalid request", "Use the connection link printed by the local connector.");
        return;
      }
      const url = new URL(request.url, origin);
      if (url.pathname === "/") {
        respond(response, 200, "Connect Gmail to Vinayak Procurement",
          "Choose the personal Gmail account you want the local agent to use.", authorization.url);
        return;
      }
      if (url.pathname !== "/oauth2/callback") {
        respond(response, 404, "Not found", "Return to the local connection page.");
        return;
      }
      if (url.searchParams.getAll("state").length !== 1 ||
          !validState(url.searchParams.get("state"), authorization.state)) {
        respond(response, 400, "Connection not accepted", "The OAuth state did not match. Use the original connection page.");
        return;
      }
      if (settled || processing) {
        respond(response, 409, "Connection already in progress", "Return to the connector terminal.");
        return;
      }
      if (url.searchParams.has("error")) {
        respond(response, 400, "Gmail was not connected", "Google sign-in was cancelled or denied. No email was sent.");
        finish(new GmailError("consent_denied", "Google sign-in was cancelled or denied. Run gmail:connect to try again."));
        return;
      }
      const code = url.searchParams.get("code");
      if (url.searchParams.getAll("code").length !== 1 || !code || code.length > 4096) {
        respond(response, 400, "Missing authorisation code", "Start again from the local connection page.");
        return;
      }
      processing = true;
      const result = await exchangeAuthorizationCode(config, {
        code, verifier: authorization.verifier, redirectUri,
      }, { fetchImpl, now, signal: controller.signal });
      respond(response, 200, "Gmail connected", "Authorisation was saved privately on this Mac. No email was sent. You can close this tab.");
      finish(null, result);
    } catch (error) {
      respond(response, 400, "Could not connect Gmail", "Return to the connector terminal for setup instructions. No email was sent.");
      finish(error instanceof GmailError ? error : new GmailError("connection_failed", "Could not save the Gmail connection. Check the private token directory permissions."));
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  }).catch(() => { throw new GmailError("port_unavailable", "Could not start the local OAuth listener. Choose a different --port."); });
  origin = `http://127.0.0.1:${server.address().port}`;
  redirectUri = `${origin}/oauth2/callback`;
  authorization = createAuthorization(config, redirectUri);
  server.on("error", () => finish(new GmailError("listener_failed", "The local OAuth listener stopped. Run gmail:connect again.")));
  timer = setTimeout(() => finish(new GmailError("connection_timeout", "The Gmail connection link expired. Run npm run gmail:connect again.")), timeoutMs);
  timer.unref();
  return {
    url: origin, authorizationUrl: authorization.url, redirectUri, completion,
    cancel: () => finish(new GmailError("cancelled", "Gmail connection cancelled. No email was sent.")),
  };
}
