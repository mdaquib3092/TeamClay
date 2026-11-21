import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig, loadUsers } from "./config.mjs";
import { VoiceIntake } from "./intake.mjs";
import { createServer } from "./server.mjs";
import { CaseFlow } from "./procurement/flow.mjs";
import { PmApproval } from "./cloud/pm-approval.mjs";
import { HodAnalysis } from "./cloud/hod-analysis.mjs";
import { RfqMailbox } from "./procurement/mail.mjs";
import { readJson } from "./sarvam.mjs";

process.umask(0o077);
const { values } = parseArgs({ options: {
  "env-file": { type: "string" }, users: { type: "string" },
  "whatsapp-store": { type: "string" }, "data-dir": { type: "string" },
  port: { type: "string" }, check: { type: "boolean" },
  "enable-chat": { type: "boolean" }, "auto-reply": { type: "boolean" },
  "case-root": { type: "string" },
} });

let intake, server, lockPath, lockToken;
function unlock() {
  if (!lockPath || !lockToken) return;
  try {
    if (JSON.parse(fs.readFileSync(lockPath, "utf8")).token === lockToken) fs.unlinkSync(lockPath);
  } catch { /* Never remove another process's lock. */ }
}
try {
  const config = loadConfig(values);
  config.workflowEnabled = !!values["case-root"];
  if(config.chatEnabled)config.knowledgeRoot=values["case-root"]?path.resolve(values["case-root"]):path.dirname(path.dirname(config.usersCsv));
  if (config.workflowEnabled && !config.autoReplies) throw new Error("Case mode requires staff chat.");
  const users = loadUsers(config.usersCsv);
  for (const file of ["messages.db", "whatsapp.db"]) {
    fs.accessSync(path.join(config.storeDir, file), fs.constants.R_OK);
  }
  if (values.check) {
    console.log(JSON.stringify({ configurationValid: true, sarvamKeyConfigured: true,
      model: config.model, registeredStaff: users.size, port: config.port,
      deepseekKeyConfigured: !!config.deepseekKey, chatEnabled: config.chatEnabled,
      chatModel: config.chatModel, automaticReplies: config.autoReplies, caseWorkflowConfigured: config.workflowEnabled, historicalBackfill: false }, null, 2));
  } else {
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    lockPath = path.join(config.dataDir, ".worker.lock");
    if (fs.existsSync(lockPath)) {
      const prior = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (!Number.isSafeInteger(prior.pid) || prior.pid <= 0) throw new Error("Invalid worker lock; inspect it before restarting.");
      try { process.kill(prior.pid, 0); throw new Error("A voice-intake worker already owns this data directory."); }
      catch (error) {
        if (error.code !== "ESRCH") throw error;
        fs.unlinkSync(lockPath);
      }
    }
    lockToken = randomUUID();
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token: lockToken }), { flag: "wx", mode: 0o600 });
    intake = new VoiceIntake(config);
    if (config.workflowEnabled) {
      const mailbox = await RfqMailbox.connect(values["env-file"]);
      await mailbox.gmail.authorisation();
      intake.workflow = new CaseFlow({ root: path.resolve(values["case-root"]), mailbox,
        pauseCheck: id => !!intake.db.prepare("SELECT paused FROM chat_preferences WHERE user_id=?").get(id)?.paused,
        sendStaff: async (recipient, message) => {
          const r = await fetch("http://127.0.0.1:8080/api/send", { method:"POST", redirect:"error", signal:AbortSignal.timeout(45000),
            headers:{"Content-Type":"application/json"}, body:JSON.stringify({recipient:recipient.whatsapp.slice(1),message}) });
          const result = await readJson(r);
          if(!r.ok || result.success!==true) throw new Error("WhatsApp acceptance unconfirmed");
          return {accepted:true,numberEnding:recipient.whatsapp.slice(-4)};
        } });
      const secretFile=path.join(os.homedir(),"Library/Application Support/TeamClay/Cloudflare/origin.key");
      if(fs.existsSync(secretFile)){
        const linkOptions={users:()=>loadUsers(config.usersCsv),secret:fs.readFileSync(secretFile,"utf8").trim(),paused:intake.workflow.pauseCheck};
        intake.workflow.pmLinks=new PmApproval(intake.workflow,linkOptions);
        intake.workflow.hodLinks=new HodAnalysis(intake.workflow,linkOptions);
      }
      if (!intake.setting("case_flow_activated")) intake.setSetting("case_flow_activated",new Date().toISOString());
    }
    server = createServer(intake, config.port);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, "127.0.0.1", resolve);
    });
    let stopped = false;
    const stop = () => { stopped = true; };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    console.log(`Voice-note intake: http://127.0.0.1:${config.port}`);
    console.log(`${users.size} configured staff users · ${config.model} · automatic replies ${config.autoReplies ? "enabled for staff only" : "disabled"}`);
    if (config.chatEnabled) console.log(`Chat model: ${config.chatModel} (DeepSeek-V4.1-Flash-1017)`);
    console.log("The existing WhatsApp bridge must remain running. Only new incoming audio is processed.");
    while (!stopped) {
      await Promise.all([intake.tick(), intake.chat?.tick()]);
      if(intake.workflow && !intake.lastError) await intake.workflow.tick(intake.users);
      await delay(2000);
    }
    await new Promise(resolve => server.close(resolve));
    intake.close(); intake = null;
  }
} catch {
  // Do not echo arbitrary file contents, provider response bodies or credentials.
  console.error("Voice intake could not start. Check configuration, staff CSV, readable bridge databases, the data-directory lock and the selected local port.");
  process.exitCode = 1;
} finally {
  server?.close();
  intake?.close();
  unlock();
}
