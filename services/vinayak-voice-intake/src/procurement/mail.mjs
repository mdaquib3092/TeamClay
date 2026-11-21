import { GmailClient } from "../../../vinayak-procurement/integrations/gmail/client.mjs";
import { loadGmailConfig } from "../../../vinayak-procurement/integrations/gmail/config.mjs";
import { readJson } from "../sarvam.mjs";

const base = "https://gmail.googleapis.com/gmail/v1/users/me/";
const idOK = id => typeof id === "string" && /^[\w-]{1,128}$/.test(id);
const headers = (message, name) => (message.payload?.headers || []).filter(h => h.name.toLowerCase() === name).map(h => h.value);
function belongs(message, invitation) {
  if (!idOK(message.id) || message.threadId !== invitation.thread_id || message.id === invitation.gmail_id ||
    !Number.isSafeInteger(Number(message.internalDate)) || Number(message.internalDate) <= 0 ||
    message.labelIds?.some(l => ["SENT", "DRAFT", "SPAM", "TRASH"].includes(l))) return false;
  const from = headers(message, "from");
  if (from.length !== 1 || /[\r\n]/.test(from[0])) return false;
  const email = (/^[^<>,;]*<([^<>,;]+)>\s*$/.exec(from[0])?.[1] || from[0]).trim().toLowerCase();
  if (email !== invitation.email.toLowerCase()) return false;
  return !headers(message, "Authentication-Results").some(s => /^\s*mx\.google\.com;/i.test(s) && /\bdmarc=fail\b/i.test(s));
}
function replyText(part) {
  if (!part || part.filename || part.body?.attachmentId) return "";
  if (part.mimeType === "text/plain" && typeof part.body?.data === "string") {
    if (part.body.data.length > 160000) return "";
    return Buffer.from(part.body.data, "base64url").toString("utf8").replace(/\r\n/g, "\n").trim();
  }
  for (const child of part.parts || []) {
    const text = replyText(child);
    if (text) return text;
  }
  return "";
}

export class RfqMailbox {
  static async connect(envFile) {
    const config = await loadGmailConfig({ env: { ...process.env, GMAIL_ENV_FILE: envFile } });
    if (!config.expectedEmail) throw new Error("Set GMAIL_EXPECTED_EMAIL for case mail.");
    return new RfqMailbox(new GmailClient(config));
  }
  constructor(gmail, fetcher = fetch) { this.gmail = gmail; this.fetcher = fetcher; }
  send(payload) { return this.gmail.send(payload, { confirmed: true }); }
  async get(route, params) {
    const url = new URL(route, base);
    for (const [k, v] of params) url.searchParams.append(k, v);
    const token = await this.gmail.accessToken();
    const res = await this.fetcher(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(12000) });
    if (!res.ok) { await res.body?.cancel(); throw new Error(`Gmail thread read HTTP ${res.status}`); }
    return readJson(res, 5 * 1024 * 1024);
  }
  // No mailbox-wide search. Anchor each thread to *our* stored outbound Gmail
  // message. Fetch bodies only for unseen, matching counterparties in it.
  async replies(invitation, seen) {
    if (!idOK(invitation.thread_id) || !idOK(invitation.gmail_id)) throw new Error("Missing Gmail receipt");
    const thread = await this.get(`threads/${invitation.thread_id}`, [["format", "metadata"], ["metadataHeaders", "From"], ["metadataHeaders", "Authentication-Results"]]);
    if (thread.id !== invitation.thread_id || !thread.messages?.some(m => m.id === invitation.gmail_id &&
      m.threadId === invitation.thread_id && m.labelIds?.includes("SENT"))) throw new Error("RFQ thread anchor missing");
    const messages = [];
    for (const item of thread.messages) {
      if (seen.has(item.id) || !belongs(item, invitation)) continue;
      const mail = await this.get(`messages/${item.id}`, [["format", "full"]]);
      if (mail.id !== item.id || !belongs(mail, invitation)) continue;
      messages.push({ id: mail.id, threadId: mail.threadId, received: Number(mail.internalDate), text: replyText(mail.payload) });
    }
    return messages.sort((a, b) => a.received - b.received || a.id.localeCompare(b.id));
  }
}
