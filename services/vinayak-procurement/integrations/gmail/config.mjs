import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const GMAIL_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
]);

export class GmailError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GmailError";
    this.code = code;
  }
}

export function emailAddress(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value)) {
    throw new GmailError("invalid_email", "Use a single email address, without a display name or extra recipients.");
  }
  return value.toLowerCase();
}

async function readEnv(path, optional = false) {
  try {
    return parseEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (optional && error.code === "ENOENT") return {};
    throw new GmailError("invalid_config", `Could not read the local environment file: ${path}`);
  }
}

function resolvePath(value, base) {
  return isAbsolute(value) ? value : resolve(base, value);
}

export async function loadGmailConfig({ root = PROJECT_ROOT, env = process.env } = {}) {
  const local = await readEnv(resolve(root, ".env.local"), true);
  const source = env.GMAIL_ENV_FILE || local.GMAIL_ENV_FILE;
  const sourceEnvPath = source ? resolvePath(source, root) : null;
  const external = sourceEnvPath ? await readEnv(sourceEnvPath) : {};
  const values = { ...local, ...external, ...env };
  const base = sourceEnvPath ? dirname(sourceEnvPath) : root;
  const credentialPath = values.GMAIL_CLIENT_CREDENTIALS
    ? resolvePath(values.GMAIL_CLIENT_CREDENTIALS, base) : null;
  const envId = values.GMAIL_CLIENT_ID || values.Client_ID;
  const envSecret = values.GMAIL_CLIENT_SECRET || values.Client_Secret;
  let clientId = envId, clientSecret = envSecret;

  if (credentialPath) {
    let document;
    try { document = JSON.parse(await readFile(credentialPath, "utf8")); }
    catch { throw new GmailError("invalid_credentials", "Could not read the Google OAuth client JSON file."); }
    if (!document?.installed) {
      throw new GmailError("invalid_credentials", "The local connector requires a Desktop app OAuth client, not a Web app or service account.");
    }
    const client = document.installed;
    if ((envId && envId !== client.client_id) || (envSecret && envSecret !== client.client_secret)) {
      throw new GmailError("credential_mismatch", "The OAuth credentials in the environment and downloaded JSON do not match.");
    }
    if ((client.auth_uri && client.auth_uri !== "https://accounts.google.com/o/oauth2/auth" && client.auth_uri !== "https://accounts.google.com/o/oauth2/v2/auth") ||
        (client.token_uri && client.token_uri !== "https://oauth2.googleapis.com/token")) {
      throw new GmailError("invalid_credentials", "The OAuth client file must use Google's official authentication endpoints.");
    }
    clientId = client.client_id;
    clientSecret = client.client_secret;
  }
  if (typeof clientId !== "string" || !clientId.endsWith(".apps.googleusercontent.com") ||
      typeof clientSecret !== "string" || !clientSecret.trim()) {
    throw new GmailError("missing_credentials", "Configure GMAIL_CLIENT_CREDENTIALS, or GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET, in the local environment file.");
  }
  const tokenPath = values.GMAIL_TOKEN_PATH
    ? resolvePath(values.GMAIL_TOKEN_PATH, base) : resolve(root, ".credentials/gmail-token.json");
  if ([credentialPath, sourceEnvPath, resolve(root, ".env.local")].includes(tokenPath)) {
    throw new GmailError("invalid_config", "The token file must be separate from the environment and OAuth client files.");
  }
  return {
    clientId, clientSecret, credentialPath, sourceEnvPath, tokenPath,
    expectedEmail: values.GMAIL_EXPECTED_EMAIL ? emailAddress(values.GMAIL_EXPECTED_EMAIL) : null,
  };
}

// Atomic replacement avoids leaving a half-written refresh token after interruption.
// Only this newly created temporary file is removed on failure.
export async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function validateTokenState(state, config) {
  if (state?.version !== 1 || state.clientId !== config.clientId) {
    throw new GmailError("invalid_token", "The saved Gmail authorisation belongs to another OAuth client. Run gmail:connect -- --replace.");
  }
  if (typeof state.tokens?.access_token !== "string" || !state.tokens.access_token ||
      typeof state.tokens.refresh_token !== "string" || !state.tokens.refresh_token ||
      !Number.isFinite(state.tokens.expiry_date) || !Array.isArray(state.scopes) ||
      !GMAIL_SCOPES.every(scope => state.scopes.includes(scope))) {
    throw new GmailError("invalid_token", "Saved Gmail authorisation is incomplete. Reconnect and grant both requested permissions.");
  }
  const email = emailAddress(state.email);
  if (config.expectedEmail && email !== config.expectedEmail) {
    throw new GmailError("wrong_mailbox", "The saved Gmail account does not match GMAIL_EXPECTED_EMAIL. Reconnect with the intended account.");
  }
  return state;
}

export async function readTokenState(config) {
  let metadata;
  try { metadata = await stat(config.tokenPath); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw new GmailError("invalid_token", "Could not access the private Gmail token file.");
  }
  if (process.platform !== "win32" && (metadata.mode & 0o077)) {
    throw new GmailError("insecure_token", "The Gmail token file must be private. Set its permissions to 600 before continuing.");
  }
  let state;
  try { state = JSON.parse(await readFile(config.tokenPath, "utf8")); }
  catch { throw new GmailError("invalid_token", "Could not read the saved Gmail authorisation. Run gmail:connect -- --replace."); }
  return validateTokenState(state, config);
}
