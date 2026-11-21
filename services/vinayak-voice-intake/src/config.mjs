import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export const STAFF_ROLES = new Set([
  "site_engineer", "project_manager", "hod",
]);

// RFC-style quoted fields, escaped quotes, CRLF and blank spreadsheet rows.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, "");
  const endField = () => { row.push(field.trim()); field = ""; closed = false; };
  const endRow = () => { endField(); if (row.some(Boolean)) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"' && !field.trim() && !closed) { field = ""; quoted = true; }
    else if (c === ",") endField();
    else if (c === "\n") endRow();
    else if (c === "\r" && text[i + 1] === "\n") { endRow(); i++; }
    else if (c === "\r") endRow();
    else if (closed && !/\s/.test(c)) throw new Error("Malformed users CSV.");
    else if (!closed) field += c;
  }
  if (quoted) throw new Error("Unclosed quoted field in users CSV.");
  if (field || row.length) endRow();
  return rows;
}

export function loadUsers(csvPath) {
  const [headers, ...rows] = parseCsv(fs.readFileSync(csvPath, "utf8"));
  for (const key of ["user_id", "name", "role", "project_id", "whatsapp", "language"]) {
    if (!headers?.includes(key)) throw new Error(`Users CSV requires the ${key} column.`);
  }
  if (new Set(headers).size !== headers.length) throw new Error("Duplicate users CSV columns.");
  const numbers = new Set(), ids = new Set(), users = new Map();
  for (const fields of rows) {
    if (fields.length !== headers.length) throw new Error("Users CSV row has the wrong column count.");
    const user = Object.fromEntries(headers.map((key, i) => [key, fields[i]]));
    if (!user.user_id || !user.name || !user.role || !user.project_id ||
        !/^\+[1-9]\d{7,14}$/.test(user.whatsapp)) {
      throw new Error("Each user needs an ID, name, role, project and international WhatsApp number.");
    }
    if (numbers.has(user.whatsapp) || ids.has(user.user_id)) {
      throw new Error("Users CSV has duplicate identities or phone numbers; intake paused.");
    }
    numbers.add(user.whatsapp); ids.add(user.user_id);
    if (STAFF_ROLES.has(user.role)) users.set(user.whatsapp.slice(1), user);
  }
  return users;
}

export function loadConfig(options = {}, environment = process.env) {
  const envFile = options["env-file"] || environment.VOICE_ENV_FILE;
  const external = envFile ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
  const setting = (key) => environment[key] || external[key];
  const apiKey = setting("SARVAM_API_KEY") || setting("Sarvam_api_key_1");
  if (!apiKey?.trim()) throw new Error("Sarvam API key is missing in the configured environment file.");
  const requiredPath = (flag, key) => {
    const value = options[flag] || setting(key);
    if (!value) throw new Error(`Configure --${flag} or ${key}.`);
    return path.resolve(value);
  };
  const model = setting("SARVAM_STT_MODEL") || "saaras:v4";
  if (!["saaras:v4", "saaras:v3"].includes(model)) throw new Error("Unsupported Sarvam STT model.");
  const port = Number(options.port || setting("VOICE_PORT") || 8767);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local voice-intake port.");
  const chatEnabled = options["enable-chat"] === true;
  const autoReplies = options["auto-reply"] === true;
  const deepseekKey = (setting("DEEPSEEK_API_KEY") || setting("Deepseek_Api_Key") || "").trim();
  if (chatEnabled && !deepseekKey) throw new Error("DeepSeek API key is missing.");
  if (autoReplies && !chatEnabled) throw new Error("Automatic replies require chat to be enabled.");
  if (setting("DEEPSEEK_MODEL") && setting("DEEPSEEK_MODEL") !== "deepseek-flash") {
    throw new Error("This deployment is pinned to the requested DeepSeek Flash model.");
  }
  return {
    apiKey: apiKey.trim(), model, port,
    deepseekKey, chatEnabled, autoReplies, chatModel: "deepseek-flash",
    usersCsv: requiredPath("users", "VOICE_USERS_CSV"),
    storeDir: requiredPath("whatsapp-store", "WHATSAPP_STORE_DIR"),
    dataDir: requiredPath("data-dir", "VOICE_DATA_DIR"),
    maxAudioBytes: 25 * 1024 * 1024,
  };
}

export function languageCode(user) {
  const value = user.language;
  return /^(hi|bn|kn|ml|mr|od|pa|ta|te|en|gu|as|ur|ne|kok|ks|sd|sa|sat|mni|brx|mai|doi)-IN$/.test(value)
    ? value : "unknown";
}
