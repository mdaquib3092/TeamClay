import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GMAIL_SCOPES, GmailError, emailAddress, loadGmailConfig, readTokenState, writePrivateJson,
} from "../integrations/gmail/config.mjs";
import { GmailClient, buildRawMessage, exchangeAuthorizationCode } from "../integrations/gmail/client.mjs";
import { createAuthorization, startAuthorization, validState } from "../integrations/gmail/oauth.mjs";

const NOW = 1_800_000_000_000;
const CLIENT = {
  client_id: "test-client.apps.googleusercontent.com", client_secret: "dummy-client-secret",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token", redirect_uris: ["http://localhost"],
};
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const noNetwork = async () => { throw new Error("Unexpected network call"); };

async function fixture(t) {
  const temp = join(tmpdir(), "opencode");
  await mkdir(temp, { recursive: true });
  const root = await mkdtemp(join(temp, "vinayak-gmail-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateDir = join(root, "private");
  await mkdir(privateDir, { mode: 0o700 });
  const credentialPath = join(privateDir, "client.json");
  const sourcePath = join(privateDir, ".env");
  await writeFile(credentialPath, JSON.stringify({ installed: CLIENT }));
  await writeFile(sourcePath, [
    `Client_ID=${CLIENT.client_id}`, `Client_Secret=${CLIENT.client_secret}`,
    "GMAIL_CLIENT_CREDENTIALS=./client.json", "GMAIL_TOKEN_PATH=./.credentials/tokens.json",
  ].join("\n"));
  await writeFile(join(root, ".env.local"), `GMAIL_ENV_FILE=${sourcePath}\n`);
  const config = await loadGmailConfig({ root, env: {} });
  return { root, sourcePath, credentialPath, config };
}

function savedState(config, override = {}) {
  return {
    version: 1, clientId: config.clientId, email: "procurement@example.test",
    connectedAt: new Date(NOW).toISOString(), scopes: [...GMAIL_SCOPES],
    tokens: { access_token: "dummy-access-token", refresh_token: "dummy-refresh-token", expiry_date: NOW + 3_600_000 },
    ...override,
  };
}

async function seed(config, override = {}) {
  const state = savedState(config, override);
  await writePrivateJson(config.tokenPath, state);
  return state;
}

function tokenResponse(override = {}) {
  return {
    access_token: "dummy-new-access-token", refresh_token: "dummy-new-refresh-token",
    expires_in: 3600, token_type: "Bearer", scope: GMAIL_SCOPES.join(" "), ...override,
  };
}

test("Gmail loads external env and legacy credential keys without changing their values", async t => {
  const { config, sourcePath, credentialPath } = await fixture(t);
  const before = await readFile(sourcePath, "utf8");
  assert.equal(config.clientId, CLIENT.client_id);
  assert.equal(config.clientSecret, CLIENT.client_secret);
  assert.equal(config.credentialPath, credentialPath);
  assert.equal(config.sourceEnvPath, sourcePath);
  assert.equal(config.tokenPath, join(dirname(sourcePath), ".credentials/tokens.json"));
  assert.equal(await readTokenState(config), null);
  assert.equal(await readFile(sourcePath, "utf8"), before);
});

test("mismatched credentials are rejected without exposing either secret", async t => {
  const { root, credentialPath } = await fixture(t);
  await writeFile(credentialPath, JSON.stringify({ installed: { ...CLIENT, client_secret: "other-dummy-secret" } }));
  await assert.rejects(loadGmailConfig({ root, env: {} }), error =>
    error.code === "credential_mismatch" && !error.message.includes("other-dummy-secret") &&
    !error.message.includes(CLIENT.client_secret));
});

test("Web credentials cannot be used accidentally with a Desktop callback", async t => {
  const { root, credentialPath } = await fixture(t);
  await writeFile(credentialPath, JSON.stringify({ web: CLIENT }));
  await assert.rejects(loadGmailConfig({ root, env: {} }), /Desktop app/);
});

test("modified client files cannot redirect credentials to untrusted OAuth endpoints", async t => {
  const { root, credentialPath } = await fixture(t);
  await writeFile(credentialPath, JSON.stringify({ installed: { ...CLIENT, token_uri: "https://untrusted.example/token" } }));
  await assert.rejects(loadGmailConfig({ root, env: {} }), /official authentication endpoints/);
});

test("mailbox pinning is explicit and rejects display names or injected headers", async t => {
  const { root } = await fixture(t);
  const config = await loadGmailConfig({ root, env: { GMAIL_EXPECTED_EMAIL: "Procurement@Example.test" } });
  assert.equal(config.expectedEmail, "procurement@example.test");
  assert.throws(() => emailAddress("vendor@example.test\r\nBcc: attacker@example.test"), GmailError);
  assert.throws(() => emailAddress("Name <vendor@example.test>"), GmailError);
});

test("token files cannot overwrite source environment or OAuth credentials", async t => {
  const { root, sourcePath, credentialPath } = await fixture(t);
  for (const path of [sourcePath, credentialPath, join(root, ".env.local")]) {
    await assert.rejects(loadGmailConfig({ root, env: { GMAIL_TOKEN_PATH: path } }), /must be separate/);
  }
});

test("tokens are stored atomically with owner-only file and directory permissions", async t => {
  const { config } = await fixture(t);
  const state = await seed(config);
  assert.deepEqual(await readTokenState(config), state);
  if (process.platform !== "win32") {
    assert.equal((await stat(config.tokenPath)).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(config.tokenPath))).mode & 0o777, 0o700);
    await chmod(config.tokenPath, 0o644);
    await assert.rejects(readTokenState(config), /permissions to 600/);
  }
});

test("saved authorisations are bound to the client, mailbox and both granted scopes", async t => {
  const { config } = await fixture(t);
  await seed(config, { clientId: "another-client" });
  await assert.rejects(readTokenState(config), /another OAuth client/);
  await seed(config, { scopes: [GMAIL_SCOPES[0]] });
  await assert.rejects(readTokenState(config), /incomplete/);
  await seed(config);
  await assert.rejects(readTokenState({ ...config, expectedEmail: "other@example.test" }), /intended account/);
});

test("OAuth uses fresh PKCE S256, state, offline access and only the requested Gmail scopes", async t => {
  const { config } = await fixture(t);
  const redirect = "http://127.0.0.1:12345/oauth2/callback";
  const auth = createAuthorization(config, redirect);
  const url = new URL(auth.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(auth.verifier).digest("base64url"));
  assert.equal(auth.verifier.length, 43);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("scope"), GMAIL_SCOPES.join(" "));
  assert.equal(auth.url.includes(config.clientSecret), false);
  assert.equal(auth.url.includes(auth.verifier), false);
  assert.notEqual(createAuthorization(config, redirect).state, auth.state);
  assert.equal(validState(auth.state, auth.state), true);
  assert.equal(validState("bad-state", auth.state), false);
  assert.equal(validState(null, auth.state), false);
});

test("OAuth callback rejects wrong or duplicate state before any token exchange", async t => {
  const { config } = await fixture(t);
  let calls = 0;
  const flow = await startAuthorization(config, { fetchImpl: async () => { calls++; throw new Error("No exchange expected"); } });
  t.after(flow.cancel);
  const landing = await fetch(flow.url);
  assert.equal(landing.headers.get("cache-control"), "no-store");
  assert.ok(landing.headers.get("content-security-policy").includes("frame-ancestors 'none'"));
  assert.ok((await landing.text()).includes("authentication only"));
  const state = new URL(flow.authorizationUrl).searchParams.get("state");
  for (const query of ["state=bad&code=dummy", `state=${state}&state=${state}&code=dummy`]) {
    assert.equal((await fetch(`${flow.redirectUri}?${query}`)).status, 400);
  }
  assert.equal(calls, 0);
  assert.equal(await readTokenState(config), null);
});

test("successful OAuth checks profile and saves tokens without reading or sending messages", async t => {
  const { config } = await fixture(t);
  const calls = [];
  const flow = await startAuthorization(config, {
    now: () => NOW,
    fetchImpl: async (url, options) => {
      calls.push(url);
      if (url === "https://oauth2.googleapis.com/token") {
        assert.equal(options.body.get("grant_type"), "authorization_code");
        assert.equal(options.body.get("redirect_uri"), flow.redirectUri);
        assert.equal(options.body.get("code"), "dummy-code");
        const challenge = createHash("sha256").update(options.body.get("code_verifier")).digest("base64url");
        assert.equal(challenge, new URL(flow.authorizationUrl).searchParams.get("code_challenge"));
        return response(tokenResponse());
      }
      assert.equal(url, "https://gmail.googleapis.com/gmail/v1/users/me/profile");
      return response({ emailAddress: "procurement@example.test" });
    },
  });
  t.after(flow.cancel);
  const state = new URL(flow.authorizationUrl).searchParams.get("state");
  const result = await fetch(`${flow.redirectUri}?state=${state}&code=dummy-code`);
  assert.equal(result.status, 200);
  assert.ok((await result.text()).includes("No email was sent"));
  assert.deepEqual(await flow.completion, { email: "procurement@example.test", scopes: [...GMAIL_SCOPES] });
  assert.equal((await readTokenState(config)).email, "procurement@example.test");
  assert.equal(calls.length, 2);
  assert.equal(calls.some(url => url.includes("messages") || url.includes("threads")), false);
});

test("denied consent closes the flow without saving tokens", async t => {
  const { config } = await fixture(t);
  const flow = await startAuthorization(config, { fetchImpl: noNetwork });
  t.after(flow.cancel);
  const rejected = assert.rejects(flow.completion, /cancelled or denied/);
  const state = new URL(flow.authorizationUrl).searchParams.get("state");
  assert.equal((await fetch(`${flow.redirectUri}?state=${state}&error=access_denied`)).status, 400);
  await rejected;
  assert.equal(await readTokenState(config), null);
});

test("cancelling the flow closes its listener and does not create tokens", async t => {
  const { config } = await fixture(t);
  const flow = await startAuthorization(config, { fetchImpl: noNetwork });
  const rejected = assert.rejects(flow.completion, /cancelled/);
  flow.cancel();
  await rejected;
  assert.equal(await readTokenState(config), null);
});

test("partial consent never replaces an existing connection", async t => {
  const { config } = await fixture(t);
  const previous = await seed(config);
  await assert.rejects(exchangeAuthorizationCode(config, {
    code: "dummy", verifier: "dummy", redirectUri: "http://127.0.0.1:1234/oauth2/callback",
  }, {
    fetchImpl: async () => response(tokenResponse({ scope: GMAIL_SCOPES[0] })), now: () => NOW,
  }), /Both Gmail send and read/);
  assert.deepEqual(await readTokenState(config), previous);
});

test("selecting a different mailbox does not overwrite a pinned connection", async t => {
  const { config } = await fixture(t);
  const previous = await seed(config);
  await assert.rejects(exchangeAuthorizationCode({ ...config, expectedEmail: "procurement@example.test" }, {
    code: "dummy", verifier: "dummy", redirectUri: "http://127.0.0.1:1234/oauth2/callback",
  }, {
    fetchImpl: async url => url.includes("/token") ? response(tokenResponse()) : response({ emailAddress: "other@example.test" }),
    now: () => NOW,
  }), /different Gmail account/);
  assert.deepEqual(await readTokenState(config), previous);
});

test("expired tokens refresh once and retain their offline token and scope grant", async t => {
  const { config } = await fixture(t);
  await seed(config, { tokens: { access_token: "expired", refresh_token: "retained-dummy-refresh", expiry_date: NOW - 1 } });
  let calls = 0;
  const client = new GmailClient(config, {
    now: () => NOW,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, "https://oauth2.googleapis.com/token");
      assert.equal(options.body.get("refresh_token"), "retained-dummy-refresh");
      return response(tokenResponse({ refresh_token: undefined, scope: undefined }));
    },
  });
  assert.deepEqual(await Promise.all([client.accessToken(), client.accessToken()]),
    ["dummy-new-access-token", "dummy-new-access-token"]);
  assert.equal(calls, 1);
  assert.equal((await readTokenState(config)).tokens.refresh_token, "retained-dummy-refresh");
});

test("revoked tokens produce a safe reconnect message without Google's raw details", async t => {
  const { config } = await fixture(t);
  await seed(config, { tokens: { access_token: "expired", refresh_token: "dummy-refresh", expiry_date: NOW - 1 } });
  const client = new GmailClient(config, { now: () => NOW, fetchImpl: async () =>
    response({ error: "invalid_grant", error_description: "sensitive-upstream-details" }, 400) });
  await assert.rejects(client.profile(), error => error.code === "reauthentication_required" &&
    !error.message.includes("sensitive-upstream-details"));
});

test("verification fetches the profile only and exposes no inbox-reading methods", async t => {
  const { config } = await fixture(t);
  await seed(config);
  const calls = [];
  const client = new GmailClient(config, {
    now: () => NOW, fetchImpl: async url => {
      calls.push(url); return response({ emailAddress: "procurement@example.test" });
    },
  });
  assert.deepEqual(await client.profile(), { email: "procurement@example.test" });
  assert.deepEqual(calls, ["https://gmail.googleapis.com/gmail/v1/users/me/profile"]);
  assert.equal(client.thread, undefined);
});

test("CLI status checks configuration offline without printing credentials", async t => {
  const { sourcePath } = await fixture(t);
  const script = fileURLToPath(new URL("../scripts/gmail.mjs", import.meta.url));
  const output = execFileSync(process.execPath, [script, "status", "--env-file", sourcePath], {
    encoding: "utf8", env: { PATH: process.env.PATH },
  });
  const status = JSON.parse(output);
  assert.equal(status.credentialsConfigured, true);
  assert.equal(status.authorised, false);
  assert.equal(status.automaticSendingEnabled, false);
  assert.equal(status.manualSending, "explicit-confirmation-only");
  assert.equal(status.inboxProcessingEnabled, false);
  assert.equal(status.webAppRfqTransport, "internal-test-inbox");
  assert.equal(output.includes(CLIENT.client_secret), false);
  assert.equal(output.includes("dummy-refresh"), false);
});

const TEST_EMAIL = { to: "recipient@example.test", subject: "AI", text: "AI" };

test("sending defaults to an offline preview and does not require authentication", async t => {
  const { config } = await fixture(t);
  const client = new GmailClient(config, { fetchImpl: noNetwork });
  assert.deepEqual(await client.send(TEST_EMAIL), { mode: "preview", sent: false, ...TEST_EMAIL });
  assert.equal(await readTokenState(config), null);
});

test("outgoing email rejects multiple recipients, header injection and invalid bodies", async t => {
  const { config } = await fixture(t);
  const client = new GmailClient(config, { fetchImpl: noNetwork });
  for (const message of [
    { ...TEST_EMAIL, to: "a@example.test,b@example.test" },
    { ...TEST_EMAIL, subject: "AI\r\nBcc: attacker@example.test" },
    { ...TEST_EMAIL, text: "" },
    { ...TEST_EMAIL, text: "a".repeat(250_001) },
  ]) await assert.rejects(client.send(message, { confirmed: true }), GmailError);
});

test("MIME encoding preserves the exact subject/body and supports Unicode safely", () => {
  const plain = Buffer.from(buildRawMessage(TEST_EMAIL, "procurement@example.test"), "base64url").toString("utf8");
  assert.ok(plain.includes("Subject: =?UTF-8?B?QUk=?="));
  assert.equal(Buffer.from(plain.split("\r\n\r\n")[1], "base64").toString("utf8"), "AI");
  const subject = "नमस्ते 🏗️ ".repeat(10);
  const unicode = Buffer.from(buildRawMessage({ ...TEST_EMAIL, subject }, "procurement@example.test"), "base64url").toString("utf8");
  const words = [...unicode.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
  assert.ok(words.every(word => word[0].length <= 75));
  assert.equal(words.map(word => Buffer.from(word[1], "base64").toString("utf8")).join(""), subject);
});

test("confirmed sending checks the mailbox and makes exactly one Gmail send request", async t => {
  const { config } = await fixture(t);
  await seed(config);
  const calls = [];
  const client = new GmailClient(config, {
    now: () => NOW,
    fetchImpl: async (url, options) => {
      calls.push(url);
      assert.equal(options.headers.Authorization, "Bearer dummy-access-token");
      if (url.endsWith("/profile")) return response({ emailAddress: "procurement@example.test" });
      assert.equal(url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
      assert.equal(options.method, "POST");
      const raw = Buffer.from(JSON.parse(options.body).raw, "base64url").toString("utf8");
      assert.ok(raw.includes("From: procurement@example.test"));
      assert.ok(raw.includes("To: recipient@example.test"));
      assert.equal(raw.includes("Bcc:"), false);
      return response({ id: "message123", threadId: "thread123" });
    },
  });
  const result = await client.send(TEST_EMAIL, { confirmed: true });
  assert.equal(result.sent, true);
  assert.equal(result.from, "procurement@example.test");
  assert.equal(result.threadId, "thread123");
  assert.equal(calls.filter(url => url.endsWith("/messages/send")).length, 1);
});

test("a wrong mailbox prevents any send", async t => {
  const { config } = await fixture(t);
  await seed(config);
  let sends = 0;
  const client = new GmailClient(config, {
    now: () => NOW, fetchImpl: async url => {
      if (url.endsWith("/messages/send")) sends++;
      return response({ emailAddress: "other@example.test" });
    },
  });
  await assert.rejects(client.send(TEST_EMAIL, { confirmed: true }), /no longer matches/);
  assert.equal(sends, 0);
});

test("network or malformed send responses warn about uncertainty and are never retried", async t => {
  const { config } = await fixture(t);
  await seed(config);
  for (const failure of ["network", "response"]) {
    let sends = 0;
    const client = new GmailClient(config, {
      now: () => NOW, fetchImpl: async url => {
        if (url.endsWith("/profile")) return response({ emailAddress: "procurement@example.test" });
        sends++;
        if (failure === "network") throw new Error("dummy-network-failure");
        return new Response("unreadable upstream content", { status: 200 });
      },
    });
    await assert.rejects(client.send(TEST_EMAIL, { confirmed: true }), /Check the Sent folder before retrying/);
    assert.equal(sends, 1);
  }
});

test("CLI send without confirmation is a preview and cannot send real email", async t => {
  const { sourcePath } = await fixture(t);
  const script = fileURLToPath(new URL("../scripts/gmail.mjs", import.meta.url));
  const output = execFileSync(process.execPath, [
    script, "send", "--env-file", sourcePath, "--to", TEST_EMAIL.to, "--subject", "AI", "--body", "AI",
  ], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(JSON.parse(output).sent, false);
});
