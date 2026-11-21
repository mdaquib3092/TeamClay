import assert from "node:assert/strict";
import test from "node:test";
import { createLocalApi, localRequestAllowed, parseCsv } from "../server/local-api.mjs";

const input = (path, extra = {}) => ({ url: path, method: "GET", headers: { host: "127.0.0.1:5174", cookie: "local-session=fake", ...extra.headers }, ...extra });
function invoke(handler, request) {
  return new Promise((resolve, reject) => {
    const response = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body) { resolve({ status: this.status, headers: this.headers, body: JSON.parse(body) }); },
    };
    Promise.resolve(handler(request, response, () => reject(new Error("Unexpected next")))).catch(reject);
  });
}
const options = { backendUrl: "http://127.0.0.1:5173", voiceUrl: "http://127.0.0.1:8767", bridgeUrl: "http://127.0.0.1:8766", dataRoot: "." };

test("rejects remote origins and DNS-rebinding hostnames", () => {
  assert.equal(localRequestAllowed(input("/", { headers: { host: "evil.example:5174" } }), 5174), false);
  assert.equal(localRequestAllowed(input("/", { headers: { host: "127.0.0.1:5174", origin: "https://evil.example" } }), 5174), false);
  assert.equal(localRequestAllowed(input("/"), 5174), true);
});
test("unauthenticated callers cannot inspect agent transcripts or mailbox metadata", async () => {
  let gmailRead = false; const paths = [];
  const handler = createLocalApi({ ...options,
    fetchImpl: async url => { paths.push(String(url)); return Response.json({ error: "Sign in" }, { status: 401 }); },
    gmailStatus: async () => { gmailRead = true; return {}; },
  });
  const response = await invoke(handler, input("/local-api/status"));
  assert.equal(response.status, 401);
  assert.equal(gmailRead, false);
  assert.deepEqual(paths, ["http://127.0.0.1:5173/api/workspace"]);
});
test("gateway has no send, approval or commercial mutation path", async () => {
  const handler = createLocalApi({ ...options, fetchImpl: async () => { throw new Error("Must not contact a provider"); } });
  const response = await invoke(handler, input("/local-api/send", { method: "POST" }));
  assert.equal(response.status, 405);
});
test("forwards only known read-only agent routes after workspace authentication", async () => {
  const paths = [];
  const handler = createLocalApi({ ...options, fetchImpl: async url => {
    paths.push(String(url)); return Response.json(String(url).endsWith("/api/voice-notes") ? { notes: [{ id: "synthetic", transcript: "Review me" }] } : {});
  } });
  const response = await invoke(handler, input("/local-api/voice-notes"));
  assert.equal(response.status, 200);
  assert.equal(response.body.notes[0].id, "synthetic");
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.deepEqual(paths, ["http://127.0.0.1:5173/api/workspace", "http://127.0.0.1:8767/api/voice-notes"]);
});
test("CSV parsing preserves quoted commas, missing values and literal zero", () => {
  assert.deepEqual(parseCsv('name,quantity,note\n"Vendor, One",0,\n'), [{ name: "Vendor, One", quantity: "0", note: null }]);
});
