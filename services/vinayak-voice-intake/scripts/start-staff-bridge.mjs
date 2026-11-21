import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { loadUsers } from "../src/config.mjs";

const { values } = parseArgs({ options: {
  users: { type: "string" }, "session-root": { type: "string" },
} });
if (!values.users || !values["session-root"]) throw new Error("Provide users CSV and the existing session root.");
const users = loadUsers(values.users);
if (users.size === 0) throw new Error("No authorised staff recipients configured.");
const root = fileURLToPath(new URL("..", import.meta.url));
const child = spawn(path.join(root, "bridge/vinayak-staff-bridge"), [], {
  cwd: path.resolve(values["session-root"]), stdio: "inherit",
  env: { ...process.env, WHATSAPP_ALLOW_SEND: "true", WHATSAPP_LOG_MESSAGES: "false",
    WHATSAPP_SEND_ALLOWLIST: [...users.keys()].join(",") },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.once("error", () => { console.error("Staff-only WhatsApp bridge could not start."); process.exitCode = 1; });
child.once("exit", code => { process.exitCode = code || 0; });
