import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadUsers } from "./config.mjs";
import { DeepSeekClient } from "./deepseek.mjs";
import { ProviderError, readJson } from "./sarvam.mjs";

const timestamp = () => new Date().toISOString();
const messageId = (channel, chat, id) => createHash("sha256")
  .update(`${channel}\0${chat}\0${id}`).digest("hex");

export class ConversationEngine {
  constructor(intake, { client, fetcher = fetch } = {}) {
    this.intake = intake; this.db = intake.db; this.config = intake.config;
    this.client = client || new DeepSeekClient(this.config);
    this.fetcher = fetcher; this.error = null;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL, chat_jid TEXT NOT NULL,
        channel TEXT NOT NULL, phone TEXT NOT NULL, user_id TEXT NOT NULL,
        name TEXT NOT NULL, role TEXT NOT NULL, project_id TEXT NOT NULL,
        received_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        user_text TEXT NOT NULL, assistant_reply TEXT, intent TEXT, case_reference TEXT,
        status TEXT NOT NULL, error_code TEXT, model TEXT, response_model TEXT,
        provider_request_id TEXT, usage_json TEXT, generated_at TEXT,
        send_started_at TEXT, sent_at TEXT, reply_kind TEXT DEFAULT 'model',
        UNIQUE(channel,chat_jid,message_id)
      );
      CREATE TABLE IF NOT EXISTS chat_preferences (user_id TEXT PRIMARY KEY, paused INTEGER NOT NULL);
    `);
    // Keep existing receipt IDs and send times. A re-record notice is not
    // the answer to a recovered transcript; each has its own deduplication key.
    this.db.exec("UPDATE chat_messages SET channel='voice_notice' WHERE channel='voice' AND reply_kind='voice_failure'");
    if (!intake.setting("chat_cursor")) {
      const max = intake.source.prepare("SELECT COALESCE(MAX(rowid),0) AS value FROM messages").get().value;
      intake.setSetting("chat_cursor", String(max));
      intake.setSetting("chat_activated_at", timestamp());
    }
    const mode = this.config.autoReplies ? "automatic" : "draft";
    if (intake.setting("chat_reply_mode") !== mode) {
      intake.setSetting("chat_reply_mode", mode);
      if (this.config.autoReplies) intake.setSetting("auto_replies_activated_at", timestamp());
    }
    this.db.prepare(`UPDATE chat_messages SET status='needs_review',error_code='interrupted_generation'
      WHERE status='generating'`).run();
    this.db.prepare(`UPDATE chat_messages SET status='send_unconfirmed',error_code='interrupted_send_no_retry'
      WHERE status='sending'`).run();
    fs.mkdirSync(path.join(this.config.dataDir, "chats"), { recursive: true, mode: 0o700 });
  }
  update(id, fields) {
    const allowed = new Set(["status", "assistant_reply", "intent", "case_reference", "error_code",
      "model", "response_model", "provider_request_id", "usage_json", "generated_at",
      "send_started_at", "sent_at", "reply_kind"]);
    if (Object.keys(fields).some(key => !allowed.has(key))) throw new Error("Invalid chat update.");
    const entries = Object.entries({ ...fields, updated_at: timestamp() });
    this.db.prepare(`UPDATE chat_messages SET ${entries.map(([key]) => `${key}=?`).join(",")} WHERE id=?`)
      .run(...entries.map(([, value]) => value), id);
  }
  enqueue(row, user, text, channel, voiceError = null) {
    text = String(text || "").trim();
    if (!text && !voiceError) return;
    const received = Date.parse(String(row.timestamp).replace(" ", "T"));
    if (!Number.isFinite(received) || received < Date.parse(this.intake.setting("chat_activated_at"))) return;
    this.db.prepare(`INSERT OR IGNORE INTO chat_messages
      (id,message_id,chat_jid,channel,phone,user_id,name,role,project_id,
       received_at,created_at,updated_at,user_text,status,reply_kind,assistant_reply,error_code)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      messageId(channel === "voice" ? "voice_answer" : channel, row.chat_jid, row.id), row.id, row.chat_jid, channel,
      user.whatsapp, user.user_id, user.name, user.role, user.project_id,
      new Date(received).toISOString(), timestamp(), timestamp(), text.slice(0, 30000),
      voiceError ? "ready" : "queued", voiceError ? "voice_failure" : "model",
      voiceError ? "I received your voice note, but couldn't get a readable transcript. Please send another recording or type your request here." : null,
      voiceError);
  }
  discover(users) {
    const cursor = Number(this.intake.setting("chat_cursor"));
    const max = Number(this.intake.source.prepare("SELECT COALESCE(MAX(rowid),0) AS value FROM messages").get().value);
    if (max < cursor) throw new Error("source_database_replaced_or_truncated");
    const rows = this.intake.source.prepare(`SELECT rowid AS source_row,id,chat_jid,sender,timestamp,is_from_me,media_type
      FROM messages WHERE rowid>? AND rowid<=? AND is_from_me=0
      AND (media_type='' OR media_type IS NULL) ORDER BY rowid LIMIT 200`).all(cursor, max);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        const user = this.intake.staffSender(row, users);
        if (!user) continue;
        // Never retrieve text content for unknown/non-staff chats.
        const content = this.intake.source.prepare("SELECT content FROM messages WHERE id=? AND chat_jid=?")
          .get(row.id, row.chat_jid)?.content;
        this.enqueue(row, user, content, "text");
      }
      this.intake.setSetting("chat_cursor", String(rows.length === 200 ? rows.at(-1).source_row : max));
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    const voices = this.db.prepare(`SELECT n.* FROM voice_notes n
      WHERE (n.status='transcribed' OR (n.status='needs_review' AND n.error_code IS NOT NULL
        AND n.error_code<>'sender_permissions_changed')) AND n.received_at>=?
      AND NOT EXISTS (SELECT 1 FROM chat_messages c WHERE c.channel=CASE WHEN n.status='transcribed' THEN 'voice' ELSE 'voice_notice' END
        AND c.message_id=n.message_id AND c.chat_jid=n.chat_jid)
      ORDER BY n.received_at LIMIT 200`)
      .all(this.intake.setting("chat_activated_at"));
    for (const note of voices) {
      const user = users.get(note.phone.slice(1));
      if (!user || user.user_id !== note.user_id || user.role !== note.role || user.project_id !== note.project_id) continue;
      const failed = note.status === "needs_review";
      this.enqueue({ id: note.message_id, chat_jid: note.chat_jid, timestamp: note.received_at },
        user, note.transcript, failed ? "voice_notice" : "voice", failed ? note.error_code : null);
    }
  }
  history(message) {
    const rows = this.db.prepare(`SELECT user_text,assistant_reply FROM chat_messages
      WHERE user_id=? AND phone=? AND role=? AND project_id=?
      AND rowid<(SELECT rowid FROM chat_messages WHERE id=?)
      AND assistant_reply IS NOT NULL AND reply_kind<>'voice_failure' AND status IN ('ready','sent','send_unconfirmed')
      ORDER BY rowid DESC LIMIT 6`).all(
      message.user_id, message.phone, message.role, message.project_id, message.id).reverse();
    return rows.flatMap(row => [{ role: "user", content: row.user_text },
      { role: "assistant", content: row.assistant_reply }]);
  }
  currentUser(message, users) {
    const user = users.get(message.phone.slice(1));
    return user && user.user_id === message.user_id && user.role === message.role &&
      user.project_id === message.project_id ? user : null;
  }
  async generateOne(users) {
    const message = this.db.prepare("SELECT * FROM chat_messages WHERE status='queued' ORDER BY rowid LIMIT 1").get();
    if (!message) return false;
    const user = this.currentUser(message, users);
    if (!user) {
      this.update(message.id, { status: "needs_review", error_code: "sender_permissions_changed" }); return true;
    }
    const command = message.user_text.trim().toLowerCase();
    if (["/stop", "/pause", "/start", "/resume"].includes(command)) {
      const paused = command === "/stop" || command === "/pause";
      this.db.prepare("INSERT OR REPLACE INTO chat_preferences(user_id,paused) VALUES (?,?)").run(user.user_id, Number(paused));
      this.update(message.id, { status: "ready", reply_kind: "preference",
        assistant_reply: paused ? "Automatic replies are paused for you. Send /start to resume." :
          "Automatic replies are enabled for you again. Procurement approvals still require the agreed human review route." });
      return true;
    }
    if (this.db.prepare("SELECT paused FROM chat_preferences WHERE user_id=?").get(user.user_id)?.paused) {
      this.update(message.id, { status: "paused" }); return true;
    }
    if (this.intake.workflow && message.received_at >= this.intake.setting("case_flow_activated")) {
      const source = this.intake.source.prepare("SELECT id,chat_jid,sender,is_from_me,media_type,content FROM messages WHERE id=? AND chat_jid=?").get(message.message_id,message.chat_jid);
      if (!source || this.intake.staffSender(source,users)?.user_id !== user.user_id ||
          (message.channel==="text" && (source.media_type || source.content?.trim() !== message.user_text))) {
        this.update(message.id,{status:"needs_review",error_code:"workflow_source_mismatch"}); return true;
      }
      try {
        const reply=await this.intake.workflow.handle(message,user,users);
        if(reply!==null){this.update(message.id,{status:"ready",reply_kind:"workflow",assistant_reply:reply});return true;}
      } catch {
        this.update(message.id,{status:"ready",reply_kind:"workflow",error_code:"case_workflow_error",
          assistant_reply:"The case service could not confirm that step. Check STATUS with your case ID before retrying."});return true;
      }
    }
    const calls = this.db.prepare(`SELECT COUNT(*) AS value FROM chat_messages WHERE user_id=? AND generated_at>=?`)
      .get(user.user_id, new Date(Date.now() - 60000).toISOString()).value;
    if (message.user_text.length > 16000 || calls >= 10) {
      this.update(message.id, { status: "ready", reply_kind: "limit",
        assistant_reply: message.user_text.length > 16000 ?
          "Please split this into shorter messages, keeping the procurement case reference." :
          "Please wait a minute before sending more requests. Your message has been saved." });
      return true;
    }
    this.update(message.id, { status: "generating", generated_at: timestamp(), model: this.config.chatModel });
    try {
      const result = await this.client.reply(user, message.user_text, this.history(message));
      this.update(message.id, { status: "ready", assistant_reply: result.reply,
        intent: result.intent, case_reference: result.case_reference,
        model: result.model, response_model: result.response_model,
        provider_request_id: result.request_id, usage_json: JSON.stringify(result.usage), error_code: null });
    } catch (error) {
      this.update(message.id, { status: "ready", reply_kind: "fallback",
        error_code: error instanceof ProviderError ? error.code : "ai_reply_failed",
        assistant_reply: "Your message has been saved, but the AI service is temporarily unavailable. " +
          "Please try again later. No procurement action has been executed." });
    }
    return true;
  }
  async sendOne() {
    if (!this.config.autoReplies) return false;
    const message = this.db.prepare("SELECT * FROM chat_messages WHERE status='ready' ORDER BY rowid LIMIT 1").get();
    if (!message) return false;
    if (message.received_at < this.intake.setting("auto_replies_activated_at")) {
      this.update(message.id, { status: "draft_only", error_code: "predates_automatic_reply_activation" }); return true;
    }
    const users = loadUsers(this.config.usersCsv);
    if (!this.currentUser(message, users)) {
      this.update(message.id, { status: "needs_review", error_code: "sender_permissions_changed" }); return true;
    }
    if (message.reply_kind !== "preference" &&
        this.db.prepare("SELECT paused FROM chat_preferences WHERE user_id=?").get(message.user_id)?.paused) {
      this.update(message.id, { status: "paused" }); return true;
    }
    // Re-check original sender provenance immediately before any send.
    const original = this.intake.source.prepare("SELECT id,chat_jid,sender,is_from_me,media_type FROM messages WHERE id=? AND chat_jid=?")
      .get(message.message_id, message.chat_jid);
    const verified = original && this.intake.staffSender(original, users);
    if (!verified || verified.user_id !== message.user_id) {
      this.update(message.id, { status: "needs_review", error_code: "reply_source_no_longer_verifiable" }); return true;
    }
    this.update(message.id, { status: "sending", send_started_at: timestamp() });
    try {
      const response = await this.fetcher("http://127.0.0.1:8080/api/send", {
        method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error",
        signal: AbortSignal.timeout(90000),
        body: JSON.stringify({ recipient: message.phone.slice(1), message: message.assistant_reply }),
      });
      const result = await readJson(response);
      if (!response.ok || result.success !== true) throw new Error("reply_send_not_confirmed");
      this.update(message.id, { status: "sent", sent_at: timestamp() });
    } catch {
      // An uncertain send is NEVER retried automatically: avoid duplicate replies.
      this.update(message.id, { status: "send_unconfirmed", error_code: "reply_send_not_confirmed_no_retry" });
    }
    return true;
  }
  exportMessages() {
    const rows = this.db.prepare("SELECT * FROM chat_messages WHERE status NOT IN ('queued','generating','sending') ORDER BY rowid DESC LIMIT 100").all();
    for (const message of rows) {
      const filename = path.join(this.config.dataDir, "chats", `${message.id}.json`);
      const record = JSON.stringify(this.publicMessage(message), null, 2);
      if (fs.existsSync(filename) && fs.readFileSync(filename, "utf8") === record) continue;
      fs.writeFileSync(filename + ".tmp", record, { mode: 0o600 }); fs.renameSync(filename + ".tmp", filename);
    }
  }
  publicMessage(message) {
    return { id: message.id, message_id: message.message_id, channel: message.channel,
      user_id: message.user_id, name: message.name, role: message.role, project_id: message.project_id,
      number_ending: message.phone.slice(-4), received_at: message.received_at,
      user_text: message.user_text, assistant_reply: message.assistant_reply,
      status: message.status, intent: message.intent, case_reference: message.case_reference,
      case_reference_verified: false, model: message.model, error_code: message.error_code,
      sent_at: message.sent_at, procurement_actions_executed: [] };
  }
  messages() {
    return this.db.prepare("SELECT * FROM chat_messages ORDER BY rowid DESC LIMIT 100").all()
      .map(message => this.publicMessage(message));
  }
  status() {
    return { enabled: true, provider: "DeepSeek", model: this.config.chatModel,
      requestedVersion: "DeepSeek-V4.1-Flash-1017", automaticReplies: this.config.autoReplies,
      commercialActionsEnabled: !!this.intake.workflow, activatedAt: this.intake.setting("chat_activated_at"),
      error: this.error,
      counts: Object.fromEntries(this.db.prepare("SELECT status,COUNT(*) AS count FROM chat_messages GROUP BY status")
        .all().map(row => [row.status, row.count])) };
  }
  async tick() {
    try {
      const users = loadUsers(this.config.usersCsv);
      this.discover(users);
      await this.generateOne(users);
      await this.sendOne();
      this.exportMessages();
      this.error = null;
    } catch { this.error = "chat_paused_check_roster_or_database"; }
  }
}
