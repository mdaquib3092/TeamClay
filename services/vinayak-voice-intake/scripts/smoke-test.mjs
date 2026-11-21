// Explicit diagnostic only: synthesises its own audio, never reads staff recordings.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../src/config.mjs";
import { SarvamClient } from "../src/sarvam.mjs";

process.umask(0o077);
const { values } = parseArgs({ options: {
  "env-file": { type: "string" }, users: { type: "string" },
  "whatsapp-store": { type: "string" }, "data-dir": { type: "string" },
  resume: { type: "boolean" },
} });
const config = loadConfig(values);
const directory = path.join(config.dataDir, "diagnostics");
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const receiptPath = path.join(directory, "sarvam-smoke-test.json");
const prior = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, "utf8")) : null;
if (prior && (!values.resume || prior.passed || !prior.jobId)) {
  console.log("A smoke-test receipt already exists. Inspect it before running another billable test.");
  process.exit(0);
}
const temporary = fs.mkdtempSync(path.join(directory, ".audio-test-"));
const receipt = prior || { syntheticTest: true, model: config.model, startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
save();
try {
  execFileSync("/usr/bin/say", ["-v", "Samantha", "-o", path.join(temporary, "test.aiff"),
    "This is a test for Vinayak procurement. We need ten bags of cement."], { stdio: "ignore" });
  execFileSync("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16@16000",
    path.join(temporary, "test.aiff"), path.join(temporary, "test.wav")], { stdio: "ignore" });
  const client = new SarvamClient(config);
  if (!receipt.jobId) { receipt.jobId = await client.initialise("en-IN"); save(); }
  const existing = await client.status(receipt.jobId);
  if (["Accepted", "Pending"].includes(existing.job_state)) {
    await client.upload(receipt.jobId, "test.wav", fs.readFileSync(path.join(temporary, "test.wav")));
    await client.start(receipt.jobId);
  }
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const status = await client.status(receipt.jobId);
    if (status.job_state === "Failed") throw new Error("sarvam_batch_failed");
    if (status.job_state === "Completed") {
      const result = await client.result(receipt.jobId, status);
      receipt.passed = true; receipt.transcript = result.transcript;
      receipt.language = result.language_code; delete receipt.error; save();
      console.log(JSON.stringify({ passed: true, model: config.model,
        syntheticTranscript: result.transcript, language: result.language_code }));
      break;
    }
    await delay(5000);
  }
  if (!receipt.passed) throw new Error("smoke_test_timeout_job_preserved");
} catch (error) {
  receipt.passed = false;
  receipt.error = error.code || "smoke_test_failed";
  save();
  console.log(JSON.stringify({ passed: false, error: receipt.error, jobPreserved: !!receipt.jobId }));
  process.exitCode = 1;
} finally {
  receipt.finishedAt = new Date().toISOString(); save();
  // Only remove this script's freshly created synthetic-audio directory.
  fs.rmSync(temporary, { recursive: true, force: true });
}
