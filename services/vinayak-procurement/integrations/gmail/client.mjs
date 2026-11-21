import { randomUUID } from "node:crypto";
import { GMAIL_SCOPES, GmailError, emailAddress, readTokenState, writePrivateJson } from "./config.mjs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_URL = "https://gmail.googleapis.com/gmail/v1/users/me/";

async function googleJson(url, options, fetchImpl, signal) {
  const sending = url === `${GMAIL_URL}messages/send` && options.method === "POST";
  const uncertain = () => new GmailError("uncertain_delivery",
    "Gmail delivery is uncertain. Check the Sent folder before retrying; no automatic retry was attempted.");
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
  } catch {
    if (sending) throw uncertain();
    throw new GmailError("network_error", "Could not contact Google. Check your connection and try again.");
  }
  let body;
  try { body = await response.json(); }
  catch {
    if (sending) throw uncertain();
    throw new GmailError("google_error", "Google returned an unreadable response.");
  }
  if (!response.ok) {
    if (sending && response.status >= 500) throw uncertain();
    // Never forward Google's raw error descriptions, request bodies or tokens to logs.
    if (body.error === "invalid_grant" || response.status === 401) {
      throw new GmailError("reauthentication_required", "Gmail authorisation expired or was revoked. Run npm run gmail:connect -- --replace.");
    }
    if (body.error === "invalid_client") {
      throw new GmailError("invalid_credentials", "Google rejected the OAuth client. Check the client JSON and environment configuration.");
    }
    if (response.status === 403) {
      throw new GmailError("permission_denied", "Google denied access. Check that Gmail API is enabled and both Gmail permissions were granted.");
    }
    throw new GmailError("google_error", `Google rejected the request (HTTP ${response.status}). No automatic retry was attempted.`);
  }
  return body;
}

function messageInput(message) {
  const to = emailAddress(message.to);
  if (typeof message.subject !== "string" || !message.subject.trim() ||
      message.subject.length > 200 || /\p{Cc}/u.test(message.subject)) {
    throw new GmailError("invalid_message", "Use a subject of 1–200 characters without control characters.");
  }
  if (typeof message.text !== "string" || !message.text.trim() || Buffer.byteLength(message.text) > 250_000) {
    throw new GmailError("invalid_message", "Use a non-empty plain-text body of at most 250 KB.");
  }
  return { to, subject: message.subject, text: message.text };
}

export function buildRawMessage(message, from, thread) {
  const input = messageInput(message);
  const sender = emailAddress(from);
  if(thread&&(typeof thread.id!=="string"||!/^[\w-]{1,128}$/.test(thread.id)||typeof thread.parent!=="string"||/[\r\n]/.test(thread.parent)||
    !/^<[^<>\s@\x00-\x1F\x7F]{1,200}@[^<>\s@\x00-\x1F\x7F]{1,150}>$/.test(thread.parent)))throw new GmailError("invalid_thread","Cannot verify the message to reply to.");
  const parts = [];
  let part = "";
  for (const character of input.subject) {
    if (Buffer.byteLength(part + character) > 42) { parts.push(part); part = ""; }
    part += character;
  }
  if (part) parts.push(part);
  const subject = parts.map(value => `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`).join("\r\n ");
  const body = Buffer.from(input.text, "utf8").toString("base64").match(/.{1,76}/g).join("\r\n");
  const raw = [
    `From: ${sender}`, `To: ${input.to}`, `Subject: ${subject}`,
    `Message-ID: <${randomUUID()}@vinayak-procurement.local>`,
    ...(thread?[`In-Reply-To: ${thread.parent}`,`References: ${thread.parent}`,"Auto-Submitted: auto-replied"]:[]),
    "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64", "", body, "",
  ].join("\r\n");
  return Buffer.from(raw, "utf8").toString("base64url");
}

function tokenData(response, previous, now) {
  if (typeof response.access_token !== "string" || !response.access_token ||
      !Number.isFinite(response.expires_in) || response.expires_in <= 0 ||
      (response.token_type && response.token_type.toLowerCase() !== "bearer")) {
    throw new GmailError("invalid_token", "Google did not return a valid access token.");
  }
  const scopes = typeof response.scope === "string" ? response.scope.split(/\s+/).filter(Boolean) : previous?.scopes;
  if (!scopes || !GMAIL_SCOPES.every(scope => scopes.includes(scope))) {
    throw new GmailError("missing_permissions", "Both Gmail send and read permissions are required. Reconnect and select both permissions on Google's consent screen.");
  }
  const refreshToken = response.refresh_token || previous?.tokens.refresh_token;
  if (typeof refreshToken !== "string" || !refreshToken) {
    throw new GmailError("missing_refresh_token", "Google did not return offline access. Reconnect and grant consent again.");
  }
  return {
    scopes,
    tokens: {
      access_token: response.access_token,
      refresh_token: refreshToken,
      expiry_date: now + response.expires_in * 1000,
      ...(response.refresh_token_expires_in
        ? { refresh_expiry_date: now + response.refresh_token_expires_in * 1000 }
        : previous?.tokens.refresh_expiry_date ? { refresh_expiry_date: previous.tokens.refresh_expiry_date } : {}),
    },
  };
}

export async function exchangeAuthorizationCode(config, { code, verifier, redirectUri }, {
  fetchImpl = fetch, now = Date.now, signal,
} = {}) {
  const response = await googleJson(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId, client_secret: config.clientSecret,
      code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code",
    }),
  }, fetchImpl, signal);
  const data = tokenData(response, null, now());
  const profile = await googleJson(`${GMAIL_URL}profile`, {
    headers: { Authorization: `Bearer ${data.tokens.access_token}` },
  }, fetchImpl, signal);
  const email = emailAddress(profile.emailAddress);
  if (config.expectedEmail && email !== config.expectedEmail) {
    throw new GmailError("wrong_mailbox", "You selected a different Gmail account. Reconnect using the address in GMAIL_EXPECTED_EMAIL.");
  }
  if (signal?.aborted) throw new GmailError("cancelled", "Gmail connection was cancelled.");
  const state = {
    version: 1, clientId: config.clientId, email,
    connectedAt: new Date(now()).toISOString(), ...data,
  };
  await writePrivateJson(config.tokenPath, state);
  return { email, scopes: data.scopes };
}

export class GmailClient {
  constructor(config, { fetchImpl = fetch, now = Date.now } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.refreshing = null;
  }

  async authorisation() {
    const state = await readTokenState(this.config);
    if (!state) throw new GmailError("not_connected", "Gmail is not authorised yet. Run npm run gmail:connect.");
    return state;
  }

  async accessToken() {
    if (this.refreshing) return this.refreshing;
    const state = await this.authorisation();
    if (this.refreshing) return this.refreshing;
    if (state.tokens.expiry_date > this.now() + 60_000) return state.tokens.access_token;
    this.refreshing = (async () => {
      const response = await googleJson(TOKEN_URL, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.config.clientId, client_secret: this.config.clientSecret,
          refresh_token: state.tokens.refresh_token, grant_type: "refresh_token",
        }),
      }, this.fetchImpl);
      const next = { ...state, ...tokenData(response, state, this.now()) };
      await writePrivateJson(this.config.tokenPath, next);
      return next.tokens.access_token;
    })();
    try { return await this.refreshing; }
    finally { this.refreshing = null; }
  }

  async profile() {
    const token = await this.accessToken();
    const profile = await googleJson(`${GMAIL_URL}profile`, {
      headers: { Authorization: `Bearer ${token}` },
    }, this.fetchImpl);
    const state = await this.authorisation();
    if (emailAddress(profile.emailAddress) !== state.email) {
      throw new GmailError("wrong_mailbox", "The authorised account no longer matches the saved mailbox. Reconnect before continuing.");
    }
    return { email: state.email };
  }

  async send(message, { confirmed = false, thread } = {}) {
    const input = messageInput(message);
    // Preview by default: no token access, network calls or persistent enabling.
    if (!confirmed) return { mode: "preview", sent: false, ...input };
    const { email } = await this.profile();
    const token = await this.accessToken();
    const result = await googleJson(`${GMAIL_URL}messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: buildRawMessage(input, email,thread),...(thread?{threadId:thread.id}:{}) }),
    }, this.fetchImpl);
    if (typeof result?.id !== "string" || typeof result?.threadId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(result.id) || !result.threadId || thread&&result.threadId!==thread.id) {
      throw new GmailError("uncertain_delivery", "Gmail did not confirm message identifiers. Check the Sent folder before retrying.");
    }
    return {
      mode: "sent", sent: true, from: email, to: input.to, subject: input.subject,
      messageId: result.id, threadId: result.threadId,
    };
  }
}
