import fs from "node:fs";
import { parseEnv, parseArgs } from "node:util";
import { DeepSeekClient } from "../src/deepseek.mjs";
const { values } = parseArgs({ options: { "env-file": { type: "string" } } });
if (!values["env-file"]) throw new Error("Provide the external environment file path.");
const env = parseEnv(fs.readFileSync(values["env-file"], "utf8"));
const client = new DeepSeekClient({ deepseekKey: env.DEEPSEEK_API_KEY || env.Deepseek_Api_Key });
try {
  const reply = await client.reply({
    user_id: "SYNTHETIC-TEST", name: "Test Coordinator",
    role: "project_manager", project_id: "TEST-PROJECT",
  }, "This is a connection test, not a real procurement request. Say hello in one short sentence.");
  console.log(JSON.stringify({ passed: true, requestedModel: reply.model,
    responseModel: reply.response_model, syntheticReply: reply.reply }));
} catch (error) {
  console.log(JSON.stringify({ passed: false, error: error.code || "deepseek_check_failed" }));
  process.exitCode = 1;
}
