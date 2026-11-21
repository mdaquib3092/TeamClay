import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { loadUsers, parseCsv, loadConfig } from "../src/config.mjs";
import { VoiceIntake, authorisedUser } from "../src/intake.mjs";
import { SarvamClient, signedStorageUrl, ProviderError } from "../src/sarvam.mjs";
import { createServer } from "../src/server.mjs";
import { shortOpus } from "../src/short-voice.mjs";

const csv = "user_id,name,role,project_id,whatsapp,email,language\r\nU01,Test Engineer,site_engineer,P01,+919123456789,test@example.test,all\r\n,,,,,,\r\n";
const audio = Buffer.from("synthetic-test-audio");
const sha = createHash("sha256").update(audio).digest();
const json = (body, status = 200) => Response.json(body, { status });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vinayak-voice-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storeDir = path.join(root, "store"); fs.mkdirSync(storeDir);
  const usersCsv = path.join(root, "users.csv"); fs.writeFileSync(usersCsv, csv);
  const source = new DatabaseSync(path.join(storeDir, "messages.db"));
  source.exec(`CREATE TABLE messages (id TEXT,chat_jid TEXT,sender TEXT,timestamp TEXT,
    is_from_me INTEGER,media_type TEXT,file_sha256 BLOB,file_length INTEGER)`);
  const sessions = new DatabaseSync(path.join(storeDir, "whatsapp.db"));
  sessions.exec("CREATE TABLE whatsmeow_lid_map (lid TEXT PRIMARY KEY,pn TEXT)");
  const config = { usersCsv, storeDir, dataDir: path.join(root, "data"), model: "saaras:v4",
    maxAudioBytes: 25 * 1024 * 1024, apiKey: "fake-secret" };
  const insert = (overrides = {}) => {
    const row = { id: "new-message", chat_jid: "919123456789@s.whatsapp.net",
      sender: "919123456789", timestamp: new Date(Date.now() + 1000).toISOString(),
      is_from_me: 0, media_type: "audio", file_sha256: sha, file_length: audio.length, ...overrides };
    source.prepare(`INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)`).run(...Object.values(row));
    return row;
  };
  t.after(() => { source.close(); sessions.close(); });
  return { root, source, sessions, config, insert };
}

test("CSV parser handles quoted names, CRLF and blank rows", () => {
  assert.deepEqual(parseCsv('a,b\r\n"one, two","say ""hi"""\r\n,\r\n'), [["a", "b"], ["one, two", 'say "hi"']]);
  assert.throws(() => parseCsv('a,b\n"unclosed'));
});
test("duplicate phone identities fail closed and vendor roles are excluded", (t) => {
  const f = fixture(t);
  fs.appendFileSync(f.config.usersCsv, "U02,Other,hod,ALL,+919123456789,x@test.local,all\n");
  assert.throws(() => loadUsers(f.config.usersCsv), /duplicate/);
  fs.writeFileSync(f.config.usersCsv, csv.replace("site_engineer", "vendor"));
  assert.equal(loadUsers(f.config.usersCsv).size, 0);
});
test("current external Sarvam key spelling is recognised without exposing it", (t) => {
  const f = fixture(t);
  const file = path.join(f.root, ".env"); fs.writeFileSync(file, 'Sarvam_api_key_1="example-secret"\n');
  const config = loadConfig({ "env-file": file, users: f.config.usersCsv,
    "whatsapp-store": f.config.storeDir, "data-dir": f.config.dataDir }, {});
  assert.equal(config.apiKey, "example-secret"); assert.equal(config.model, "saaras:v4");
});
test("unknown senders, outgoing messages and groups are never authorised", (t) => {
  const f = fixture(t), users = loadUsers(f.config.usersCsv);
  const row = { media_type: "audio", is_from_me: 0, sender: "919123456789", chat_jid: "919123456789@s.whatsapp.net" };
  assert.ok(authorisedUser(row, users, () => null));
  assert.equal(authorisedUser({ ...row, is_from_me: 1 }, users, () => null), null);
  assert.equal(authorisedUser({ ...row, chat_jid: "group@g.us" }, users, () => null), null);
  assert.equal(authorisedUser({ ...row, sender: "unknown" }, users, () => null), null);
});
test("LIDs require a phone mapping and cannot be mistaken for allowlisted numbers", (t) => {
  const f = fixture(t), users = loadUsers(f.config.usersCsv);
  const row = { media_type: "audio", is_from_me: 0, sender: "123456", chat_jid: "123456@lid" };
  assert.equal(authorisedUser(row, users, () => null), null);
  assert.ok(authorisedUser(row, users, () => "919123456789"));
  assert.equal(authorisedUser({ ...row, chat_jid: "919123456789@lid" }, users, () => null), null);
});
test("first start skips history; replaying a message cannot create duplicate jobs", async (t) => {
  const f = fixture(t); f.insert({ id: "historical-message" });
  const intake = new VoiceIntake(f.config, { provider: {} }); t.after(() => intake.close());
  intake.discover(); assert.equal(intake.notes().length, 0);
  f.insert(); intake.discover(); f.insert(); intake.discover();
  assert.equal(intake.notes().length, 1);
  f.insert({ id: "history-sync", timestamp: "2020-01-01T00:00:00Z" });
  intake.discover(); assert.equal(intake.notes().length, 1);
});
test("end-to-end intake persists role, project and unreviewed transcript without sending messages", async (t) => {
  const f = fixture(t);
  const filename = path.join(f.config.storeDir, "audio.ogg"); fs.writeFileSync(filename, audio);
  let jobs = 0;
  const provider = {
    initialise: async language => { assert.equal(language, "unknown"); jobs++; return "job-test"; },
    upload: async (id, name, body) => { assert.equal(id, "job-test"); assert.deepEqual(body, audio); },
    start: async () => ({}),
    status: async () => ({ job_state: "Completed" }),
    result: async () => ({ transcript: "We need ten cement bags.", language_code: "en-IN", request_id: "test-result", timestamps: null }),
  };
  const intake = new VoiceIntake(f.config, { provider, fetcher: async (url) => {
    assert.equal(url, "http://127.0.0.1:8080/api/download");
    return json({ success: true, path: filename });
  } }); t.after(() => intake.close());
  f.insert(); intake.discover(); await intake.processOne();
  const id = intake.notes()[0].id; intake.update(id, { next_at: 0 });
  await intake.processOne();
  const note = intake.notes()[0];
  assert.equal(note.status, "transcribed"); assert.equal(note.role, "site_engineer");
  assert.equal(note.project_id, "P01"); assert.equal(note.reply_status, "draft_not_sent");
  assert.equal(note.assistance.work_queue, "requirement_intake");
  assert.equal(note.assistance.case_link_status, "case_reference_required");
  assert.equal(note.review_status, "unreviewed"); assert.equal(jobs, 1);
  const exported = JSON.parse(fs.readFileSync(path.join(f.config.dataDir, "notes", `${id}.json`)));
  assert.equal(exported.transcript, "We need ten cement bags.");
  await intake.processOne(); assert.equal(jobs, 1);
});
test("a changed role blocks queued audio before any provider request", async (t) => {
  const f = fixture(t); let called = false;
  const intake = new VoiceIntake(f.config, { provider: { initialise: () => { called = true; } } });
  t.after(() => intake.close());
  f.insert(); intake.discover();
  fs.writeFileSync(f.config.usersCsv, csv.replace("site_engineer", "project_manager"));
  intake.discover(); await intake.processOne();
  assert.equal(intake.notes()[0].error_code, "sender_permissions_changed");
  assert.equal(called, false);
});
test("wrong downloaded audio hash is held for review, never uploaded", async (t) => {
  const f = fixture(t); let uploaded = false;
  const filename = path.join(f.config.storeDir, "wrong.ogg"); fs.writeFileSync(filename, "wrong audio");
  const intake = new VoiceIntake(f.config, { provider: { initialise: () => { uploaded = true; } },
    fetcher: async () => json({ success: true, path: filename }) });
  t.after(() => intake.close());
  f.insert(); intake.discover(); await intake.processOne();
  assert.equal(intake.notes()[0].error_code, "downloaded_audio_integrity_mismatch");
  assert.equal(uploaded, false);
});
test("only a complete short Ogg Opus stream takes the REST route", () => {
  function page(flags, granule, packet, seq = 1) {
    const header = Buffer.alloc(28);
    header.write("OggS"); header[5] = flags;
    header.writeBigInt64LE(BigInt(granule), 6); header.writeUInt32LE(1, 14);
    header.writeUInt32LE(seq, 18); header[26] = 1; header[27] = packet.length;
    return Buffer.concat([header, packet]);
  }
  const head = page(2, 0, Buffer.concat([Buffer.from("OpusHead"), Buffer.alloc(11)]), 0);
  const short = Buffer.concat([head, page(4, 48000, Buffer.alloc(20))]);
  assert.ok(shortOpus(short));
  assert.ok(shortOpus(Buffer.concat([head, page(0, 225912, Buffer.alloc(20))])));
  assert.equal(shortOpus(Buffer.concat([head, page(0, 225912, Buffer.alloc(20), 3)])), false);
  assert.equal(shortOpus(Buffer.concat([head, page(0, 225912, Buffer.alloc(255))])), false);
  assert.equal(shortOpus(short.subarray(0, -1)), false);
  assert.equal(shortOpus(head), false);
  assert.equal(shortOpus(Buffer.concat([head, page(4, 31 * 48000, Buffer.alloc(20))])), false);
});
test("short WAV recovery returns provider text without creating or restarting a batch job", async (t) => {
  const f = fixture(t), filename = path.join(f.config.storeDir, "test-note.ogg");
  fs.writeFileSync(filename, audio);
  const wav = Buffer.from("synthetic WAV for multipart transport test");
  let posts = 0;
  const provider = new SarvamClient({ apiKey: "test-only", fetcher: async (url, options) => {
    assert.equal(url, "https://api.sarvam.ai/speech-to-text");
    assert.equal(options.body.get("model"), "saaras:v4");
    assert.equal(options.body.get("mode"), "transcribe");
    assert.equal(options.body.get("language_code"), "unknown");
    const file = options.body.get("file");
    assert.equal(file.type, "audio/wav");
    assert.equal(file.name, "note.wav"); assert.deepEqual(Buffer.from(await file.arrayBuffer()), wav);
    posts++; return json({ transcript: "We need cement.", request_id: "rest-test", language_code: "en-IN" });
  } });
  const intake = new VoiceIntake(f.config, { provider, fetcher: async () => json({ success: true, path: filename }),
    prepareWav: async raw => { assert.deepEqual(raw, audio); return wav; } });
  t.after(() => intake.close());
  f.insert(); intake.discover(); const id = intake.notes()[0].id;
  intake.update(id, { status: "retry_short_wav", job_id: "completed-empty-batch" });
  await intake.processOne(); await intake.processOne();
  const row = intake.db.prepare("SELECT * FROM voice_notes WHERE id=?").get(id);
  assert.equal(posts, 1); assert.equal(row.status, "transcribed"); assert.equal(row.stt_transport, "rest_wav");
  assert.equal(row.transcript, "We need cement."); assert.equal(row.job_id, "completed-empty-batch");
});
test("ambiguous job creation is not automatically retried or double-billed", async (t) => {
  const f = fixture(t);
  const filename = path.join(f.config.storeDir, "audio.ogg"); fs.writeFileSync(filename, audio);
  let calls = 0;
  const intake = new VoiceIntake(f.config, {
    provider: { initialise: async () => { calls++; throw new ProviderError("network", 0, true); } },
    fetcher: async () => json({ success: true, path: filename }),
  }); t.after(() => intake.close());
  f.insert(); intake.discover(); await intake.processOne(); await intake.processOne();
  assert.equal(calls, 1); assert.equal(intake.notes()[0].status, "needs_review");
});
test("Sarvam batch uses documented fields and never leaks API key to signed storage", async () => {
  const calls = [];
  const client = new SarvamClient({ apiKey: "test-secret", fetcher: async (url, options = {}) => {
    calls.push({ url, ...options });
    if (url.endsWith("/job/v1")) return json({ job_id: "job-test" }, 202);
    if (url.endsWith("/upload-files")) return json({ storage_container_type: "Azure_V1",
      upload_urls: { "note.ogg": { file_url: "https://test.blob.core.windows.net/audio?sig=private" } } });
    if (url.includes("blob.core.windows.net")) return new Response(null, { status: 201 });
    return json({});
  } });
  const id = await client.initialise(); await client.upload(id, "note.ogg", audio); await client.start(id);
  assert.equal(JSON.parse(calls[0].body).job_parameters.model, "saaras:v4");
  assert.equal(JSON.parse(calls[0].body).job_parameters.mode, "transcribe");
  assert.equal(calls[2].headers["api-subscription-key"], undefined);
  assert.equal(calls[2].headers["x-ms-blob-type"], "BlockBlob");
  assert.equal(calls[2].redirect, "error");
});
test("batch result downloads request actual output filenames and preserve source text", async () => {
  let downloadBody;
  const client = new SarvamClient({ apiKey: "test-secret", fetcher: async (url, options = {}) => {
    if (url.includes("download-files")) { downloadBody = JSON.parse(options.body); return json({
      download_urls: { "0.json": { file_url: "https://test.blob.core.windows.net/result?sig=private" } },
    }); }
    assert.equal(options.headers, undefined);
    return json({ transcript: "दस सीमेंट बैग चाहिए।", language_code: "hi-IN" });
  } });
  const result = await client.result("job-test", { job_details: [
    { state: "Success", outputs: [{ file_name: "0.json" }] },
  ] });
  assert.deepEqual(downloadBody, { job_id: "job-test", files: ["0.json"] });
  assert.equal(result.transcript, "दस सीमेंट बैग चाहिए।");
});
test("signed URL validation prevents local-network access or credentials in URLs", () => {
  for (const url of ["http://localhost/file", "https://127.0.0.1/file",
    "https://evil.test/file", "https://api.sarvam.ai.evil.test/file",
    "https://user:password@storage.googleapis.com/file"]) {
    assert.throws(() => signedStorageUrl(url));
  }
  assert.equal(new URL(signedStorageUrl("https://saas-prod-vistaar-bulk-upload.s3.amazonaws.com/file?sig=private")).protocol, "https:");
  assert.throws(() => signedStorageUrl("https://attacker-bucket.s3.amazonaws.com/file"));
});
test("provider error bodies are not echoed with secrets", async () => {
  const client = new SarvamClient({ apiKey: "test-secret", fetcher: async () =>
    json({ error: "test-secret and private text" }, 403) });
  await assert.rejects(client.initialise(), error => error.message === "sarvam_http_403");
});
test("local dashboard rejects cross-origin hosts and all writes", async (t) => {
  const server = createServer({ status: () => ({ automaticReplies: false }), notes: () => [] }, 18767);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const requestStatus = (method, headers) => new Promise((resolve, reject) => {
    const request = http.request(base + "/api/status", { method, headers }, response => {
      response.resume(); response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject); request.end();
  });
  assert.equal((await fetch(`${base}/api/status`)).status, 403);
  assert.equal(await requestStatus("GET", { Host: "localhost:18767", Origin: "https://evil.test" }), 403);
  assert.equal(await requestStatus("POST", { Host: "localhost:18767" }), 405);
  assert.equal(await requestStatus("GET", { Host: "localhost:18767" }), 200);
});
