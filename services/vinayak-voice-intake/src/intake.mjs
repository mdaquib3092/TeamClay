import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { loadUsers, languageCode } from "./config.mjs";
import { SarvamClient, ProviderError, readJson } from "./sarvam.mjs";
import { ROLE_POLICY, roleAssistance, roleProfiles } from "./roles.mjs";
import { ConversationEngine } from "./conversations.mjs";
import { shortVoiceWav } from "./short-voice.mjs";

const now = () => new Date().toISOString();
const noteId = (row) => createHash("sha256").update(`${row.chat_jid}\0${row.id}`).digest("hex");
const phonePart = (value) => String(value || "").split("@")[0].split(":")[0];
const publicNote = (note) => ({
  id: note.id, message_id: note.message_id, user_id: note.user_id, name: note.name,
  role: note.role, project_id: note.project_id, number_ending: note.phone.slice(-4),
  received_at: note.received_at, status: note.status, transcript: note.transcript,
  language_code: note.detected_language, model: note.model, error_code: note.error_code,
  stt_transport: note.stt_transport,
  review_status: "unreviewed", workflow_status: note.assistance_json ? "role_routed_pending_human_review" : "awaiting_transcript",
  reply_status: note.assistance_json ? "draft_not_sent" : "disabled",
  assistance: note.assistance_json ? JSON.parse(note.assistance_json) : null,
});

export function authorisedStaffSender(row, users, resolveLid) {
  if (Number(row.is_from_me) !== 0) return null;
  const [chatUser, server] = row.chat_jid.split("@");
  if (server !== "s.whatsapp.net" && server !== "lid") return null;
  let phone;
  if (server === "lid") {
    // WhatsApp LIDs are not phone numbers, even when they look like one.
    phone = phonePart(resolveLid(phonePart(chatUser)));
  } else {
    phone = phonePart(chatUser);
    if (phonePart(row.sender) !== phone) return null;
  }
  return phone && users.get(phone) || null;
}
export function authorisedUser(row, users, resolveLid) {
  return row.media_type === "audio" ? authorisedStaffSender(row, users, resolveLid) : null;
}

export class VoiceIntake {
  constructor(config, { provider, fetcher = fetch, clock = now, prepareWav = shortVoiceWav } = {}) {
    this.config = config; this.fetcher = fetcher; this.clock = clock;
    this.prepareWav = prepareWav;
    this.provider = provider || new SarvamClient(config);
    this.users = loadUsers(config.usersCsv);
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(config.dataDir, "notes"), { recursive: true, mode: 0o700 });
    this.source = new DatabaseSync(path.join(config.storeDir, "messages.db"), { readOnly: true });
    this.sessions = new DatabaseSync(path.join(config.storeDir, "whatsapp.db"), { readOnly: true });
    this.source.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000");
    this.sessions.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000");
    this.db = new DatabaseSync(path.join(config.dataDir, "voice-notes.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS voice_notes (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL, chat_jid TEXT NOT NULL,
        user_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
        project_id TEXT NOT NULL, phone TEXT NOT NULL, language TEXT NOT NULL,
        received_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        status TEXT NOT NULL, model TEXT NOT NULL, expected_sha TEXT NOT NULL,
        job_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
        transcript TEXT, detected_language TEXT, provider_request_id TEXT,
        timestamps_json TEXT, error_code TEXT,
        UNIQUE(chat_jid, message_id)
      );
    `);
    if (!this.db.prepare("PRAGMA table_info(voice_notes)").all().some(column => column.name === "assistance_json")) {
      this.db.exec("ALTER TABLE voice_notes ADD COLUMN assistance_json TEXT");
    }
    if (!this.db.prepare("PRAGMA table_info(voice_notes)").all().some(column => column.name === "stt_transport")) {
      this.db.exec("ALTER TABLE voice_notes ADD COLUMN stt_transport TEXT NOT NULL DEFAULT 'batch'");
    }
    if (!this.setting("cursor")) {
      const maximum = this.source.prepare("SELECT COALESCE(MAX(rowid),0) AS value FROM messages").get().value;
      this.setSetting("cursor", String(maximum));
      this.setSetting("activated_at", clock());
    }
    this.db.prepare("UPDATE voice_notes SET status='queued' WHERE status='downloading'").run();
    this.db.prepare(`UPDATE voice_notes SET status='needs_review', error_code='interrupted_submission'
      WHERE (status='submitting' AND job_id IS NULL) OR status='transcribing_rest'`).run();
    this.lastScan = null; this.lastError = null;
    this.exportProfiles();
    this.chat = config.chatEnabled ? new ConversationEngine(this) : null;
  }
  setting(key) { return this.db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value; }
  setSetting(key, value) {
    this.db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run(key, value);
  }
  resolveLid(lid) {
    return this.sessions.prepare("SELECT pn FROM whatsmeow_lid_map WHERE lid=? OR lid=? LIMIT 1")
      .get(lid, `${lid}@lid`)?.pn || null;
  }
  staffSender(row, users = this.users) {
    return authorisedStaffSender(row, users, lid => this.resolveLid(lid));
  }
  discover() {
    // Reload every scan. Invalid/duplicate identities pause intake, rather than
    // continuing with a stale or ambiguous permissions list.
    this.users = loadUsers(this.config.usersCsv);
    this.exportProfiles();
    const cursor = Number(this.setting("cursor"));
    const maximum = Number(this.source.prepare("SELECT COALESCE(MAX(rowid),0) AS value FROM messages").get().value);
    if (maximum < cursor) throw new Error("source_database_replaced_or_truncated");
    const rows = this.source.prepare(`SELECT rowid AS source_row, id, chat_jid, sender,
      timestamp, is_from_me, media_type, file_sha256, file_length FROM messages
      WHERE rowid>? AND rowid<=? AND media_type='audio' AND is_from_me=0
      ORDER BY rowid LIMIT 200`).all(cursor, maximum);
    const insert = this.db.prepare(`INSERT OR IGNORE INTO voice_notes
      (id,message_id,chat_jid,user_id,name,role,project_id,phone,language,received_at,
       created_at,updated_at,status,model,expected_sha,error_code)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        const user = authorisedUser(row, this.users, lid => this.resolveLid(lid));
        const timestamp = Date.parse(String(row.timestamp).replace(" ", "T"));
        if (!user || !Number.isFinite(timestamp) || timestamp < Date.parse(this.setting("activated_at"))) continue;
        const sha = Buffer.from(row.file_sha256 || []).toString("hex");
        const safe = sha.length === 64 && Number(row.file_length) > 0 &&
          Number(row.file_length) <= this.config.maxAudioBytes;
        insert.run(noteId(row), row.id, row.chat_jid, user.user_id, user.name, user.role,
          user.project_id, user.whatsapp, languageCode(user), new Date(timestamp).toISOString(),
          this.clock(), this.clock(), safe ? "queued" : "needs_review", this.config.model,
          sha, safe ? null : "audio_size_or_integrity_metadata_invalid");
      }
      this.setSetting("cursor", String(rows.length === 200 ? rows.at(-1).source_row : maximum));
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.lastScan = this.clock();
  }
  update(id, fields) {
    const allowed = new Set(["status", "job_id", "attempts", "next_at", "transcript",
      "detected_language", "provider_request_id", "timestamps_json", "error_code", "assistance_json", "stt_transport"]);
    if (Object.keys(fields).some(key => !allowed.has(key))) throw new Error("Invalid voice-note update.");
    const entries = Object.entries({ ...fields, updated_at: this.clock() });
    this.db.prepare(`UPDATE voice_notes SET ${entries.map(([key]) => `${key}=?`).join(",")} WHERE id=?`)
      .run(...entries.map(([, value]) => value), id);
  }
  async audio(note) {
    let response;
    try {
      response = await this.fetcher("http://127.0.0.1:8080/api/download", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: note.message_id, chat_jid: note.chat_jid }),
        signal: AbortSignal.timeout(120000), redirect: "error",
      });
    } catch { throw new ProviderError("whatsapp_download_network_error", 0, true); }
    if (!response.ok) throw new ProviderError("whatsapp_download_failed", response.status, true);
    const data = await readJson(response);
    if (!data.success || typeof data.path !== "string") throw new ProviderError("whatsapp_download_failed", 0, true);
    const root = fs.realpathSync(this.config.storeDir);
    const filename = fs.realpathSync(data.path);
    if (!filename.startsWith(root + path.sep)) throw new ProviderError("unsafe_download_path");
    const stat = fs.statSync(filename);
    if (!stat.isFile() || stat.size === 0 || stat.size > this.config.maxAudioBytes) throw new ProviderError("audio_too_large_or_empty");
    const buffer = fs.readFileSync(filename);
    if (createHash("sha256").update(buffer).digest("hex") !== note.expected_sha) {
      throw new ProviderError("downloaded_audio_integrity_mismatch");
    }
    return buffer;
  }
  exportNote(id) {
    const note = this.db.prepare("SELECT * FROM voice_notes WHERE id=?").get(id);
    const record = { ...publicNote(note), phone: note.phone, chat_jid: note.chat_jid,
      provider_job_id: note.job_id, provider_request_id: note.provider_request_id,
      timestamps: note.timestamps_json ? JSON.parse(note.timestamps_json) : null };
    const filename = path.join(this.config.dataDir, "notes", `${note.id}.json`);
    fs.writeFileSync(filename + ".tmp", JSON.stringify(record, null, 2), { mode: 0o600 });
    fs.renameSync(filename + ".tmp", filename);
  }
  exportProfiles() {
    const profileData = JSON.stringify({ version: ROLE_POLICY.version,
      staff: roleProfiles(this.users), workflow: ROLE_POLICY.workflow,
      controls: { ...ROLE_POLICY.controls, automaticReplies: this.config.autoReplies === true, liveCommercialActions: !!this.workflow } }, null, 2);
    if (profileData === this.lastProfileExport) return;
    const filename = path.join(this.config.dataDir, "role_profiles.json");
    fs.writeFileSync(filename + ".tmp", profileData, { mode: 0o600 });
    fs.renameSync(filename + ".tmp", filename);
    this.lastProfileExport = profileData;
  }
  routeCompleted() {
    for (const note of this.db.prepare("SELECT * FROM voice_notes WHERE status='transcribed' AND assistance_json IS NULL").all()) {
      const user = this.users.get(note.phone.slice(1));
      if (!user || user.user_id !== note.user_id || user.role !== note.role || user.project_id !== note.project_id) continue;
      this.update(note.id, { assistance_json: JSON.stringify(roleAssistance(note, user, this.users)) });
      this.exportNote(note.id);
    }
  }
  saveTranscript(note, text, user) {
    this.update(note.id, { status: "transcribed", transcript: text.transcript,
      detected_language: text.language_code, provider_request_id: text.request_id,
      timestamps_json: JSON.stringify(text.timestamps), error_code: null, attempts: 0,
      assistance_json: JSON.stringify(roleAssistance({ ...note, transcript: text.transcript }, user, this.users)) });
  }
  async processOne() {
    const note = this.db.prepare(`SELECT * FROM voice_notes
      WHERE status IN ('queued','uploading','processing','retry_short_wav') AND next_at<=?
      ORDER BY next_at,created_at LIMIT 1`).get(Date.now());
    if (!note) return false;
    const user = this.users.get(note.phone.slice(1));
    if (!user || user.user_id !== note.user_id || user.role !== note.role || user.project_id !== note.project_id) {
      this.update(note.id, { status: "needs_review", error_code: "sender_permissions_changed" });
      this.exportNote(note.id); return true;
    }
    let stage = note.status;
    try {
      if (stage === "queued" || stage === "uploading" || stage === "retry_short_wav") {
        if (stage === "queued") this.update(note.id, { status: "downloading" });
        const audio = await this.audio(note);
        if (!note.job_id || stage === "retry_short_wav") {
          const wav = await this.prepareWav(audio, this.config.dataDir);
          if (wav) {
            stage = "transcribing_rest";
            this.update(note.id, { status: stage, stt_transport: "rest_wav" });
            const text = await this.provider.transcribeWav(wav, note.language);
            this.saveTranscript(note, text, user);
            this.exportNote(note.id);
            return true;
          }
          if (stage === "retry_short_wav") throw new ProviderError("empty_transcript_needs_review");
        }
        if (!note.job_id) {
          stage = "submitting";
          this.update(note.id, { status: stage });
          note.job_id = await this.provider.initialise(note.language);
          this.update(note.id, { job_id: note.job_id, status: "uploading" });
        }
        stage = "uploading";
        await this.provider.upload(note.job_id, `${note.id}.ogg`, audio);
        // If starting has an ambiguous network result, preserve the job ID and
        // poll it instead of creating another billable transcription job.
        stage = "processing";
        this.update(note.id, { status: stage, attempts: 0, next_at: Date.now() + 5000, error_code: null });
        await this.provider.start(note.job_id);
      } else {
        const result = await this.provider.status(note.job_id);
        if (result.job_state === "Failed") throw new ProviderError("sarvam_batch_failed");
        if (["Completed", "PartiallyCompleted"].includes(result.job_state)) {
          const text = await this.provider.result(note.job_id, result);
          this.saveTranscript(note, text, user);
        } else if (Date.now() - Date.parse(note.created_at) > 30 * 60 * 1000) {
          throw new ProviderError("batch_processing_timeout");
        } else {
          this.update(note.id, { next_at: Date.now() + 5000, attempts: 0, error_code: null });
        }
      }
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : "local_intake_error";
      const attempts = note.attempts + 1;
      if (code === "empty_transcript_needs_review" && stage === "processing") {
        // A completed, empty batch result can be retried once as decoded PCM
        // for short voice notes. Keep the existing job ID for traceability.
        this.update(note.id, { status: "retry_short_wav", next_at: 0, error_code: code });
      } else if (error.retryable && attempts < 3 && !["submitting", "transcribing_rest"].includes(stage)) {
        this.update(note.id, { status: stage === "downloading" ? "queued" : stage,
          attempts, next_at: Date.now() + attempts * 30000, error_code: code });
      } else {
        this.update(note.id, { status: "needs_review", attempts, error_code: code });
      }
    }
    this.exportNote(note.id);
    return true;
  }
  async tick(mediaReady=true) {
    try { this.discover(); this.lastError = null; if(mediaReady)await this.processOne(); this.routeCompleted(); }
    catch { this.lastError = "intake_paused_check_users_or_source_database"; }
  }
  notes() {
    if (!this.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='chat_messages'").get()) {
      return this.db.prepare("SELECT * FROM voice_notes ORDER BY created_at DESC LIMIT 100").all().map(publicNote);
    }
    return this.db.prepare(`SELECT n.*, coalesce(c.status,notice.status) AS dispatch_status,
      CASE WHEN c.id IS NOT NULL THEN c.sent_at ELSE notice.sent_at END AS dispatch_time,
      coalesce(c.reply_kind,notice.reply_kind) AS reply_kind
      FROM voice_notes n LEFT JOIN chat_messages c
      ON c.channel='voice' AND c.chat_jid=n.chat_jid AND c.message_id=n.message_id
      LEFT JOIN chat_messages notice
      ON notice.channel='voice_notice' AND notice.chat_jid=n.chat_jid AND notice.message_id=n.message_id
      ORDER BY n.created_at DESC LIMIT 100`).all().map(note => ({
      ...publicNote(note), reply_status: note.dispatch_status || "not_sent", reply_sent_at: note.dispatch_time, reply_kind: note.reply_kind,
    }));
  }
  status() {
    return { provider: "Sarvam", model: this.config.model, mode: "transcribe",
      transport: "rest_wav_or_batch", registeredStaff: this.users.size,
      activatedAt: this.setting("activated_at"), lastScan: this.lastScan,staffBridgeReady:this.bridgeReady??null,
      error: this.lastError, automaticReplies: this.config.autoReplies === true, procurementWrites: !!this.workflow,
      chat: this.chat ? this.chat.status() : { enabled: false },
      roleProfilesConfigured: true, staffRoles: Object.keys(ROLE_POLICY.staffRoles),
      liveWorkflowActions: !!this.workflow, caseWorkflow: this.workflow?.summary() || {enabled:false}, minimumEligibleRfqVendors: ROLE_POLICY.controls.minimumEligibleRfqVendors,
      counts: Object.fromEntries(this.db.prepare("SELECT status,COUNT(*) AS count FROM voice_notes GROUP BY status")
        .all().map(row => [row.status, row.count])) };
  }
  profiles() { return { staff: roleProfiles(this.users), workflow: ROLE_POLICY.workflow,
    controls: { ...ROLE_POLICY.controls, automaticReplies: this.config.autoReplies === true, liveCommercialActions: !!this.workflow } }; }
  close() { this.workflow?.db.close(); this.source.close(); this.sessions.close(); this.db.close(); }
}
