import { parseArgs } from "node:util";
import { dirname, join } from "node:path";
import { GmailError, loadGmailConfig, readTokenState, writePrivateJson } from "../integrations/gmail/config.mjs";
import { GmailClient } from "../integrations/gmail/client.mjs";
import { startAuthorization } from "../integrations/gmail/oauth.mjs";

const HELP = `Local Gmail connector (Node.js only; not the web app's RFQ dispatch)

  npm run gmail:status
  npm run gmail:status -- --verify
  npm run gmail:connect -- --port 53682
  npm run gmail:connect -- --replace
  npm run gmail:send -- --to recipient@example.com --subject "Subject" --body "Body"
  npm run gmail:send -- --to recipient@example.com --subject "Subject" --body "Body" --confirm-send

Send is preview-only unless --confirm-send is explicitly provided.
No automatic sends, inbox reading or monitoring are enabled.
Use --env-file /absolute/path/.env to select another local environment.
Never paste OAuth client secrets or refresh tokens in chat.`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean" }, verify: { type: "boolean" }, replace: { type: "boolean" },
      port: { type: "string" }, "env-file": { type: "string" },
      to: { type: "string" }, subject: { type: "string" }, body: { type: "string" },
      "confirm-send": { type: "boolean" },
    },
  });
  const command = positionals[0];
  if (values.help || !command) { console.log(HELP); return; }
  if (positionals.length !== 1 || !["status", "connect", "send"].includes(command)) {
    throw new GmailError("invalid_command", HELP);
  }
  const config = await loadGmailConfig({
    env: values["env-file"] ? { ...process.env, GMAIL_ENV_FILE: values["env-file"] } : process.env,
  });
  const client = new GmailClient(config);
  if (command === "status") {
    const verified = values.verify ? await client.profile() : null;
    const state = await readTokenState(config);
    console.log(JSON.stringify({
      credentialsConfigured: true, credentialsFile: config.credentialPath,
      environmentFile: config.sourceEnvPath, authorised: Boolean(state),
      expectedMailbox: config.expectedEmail, mailbox: state?.email || null, verifiedWithGoogle: Boolean(verified),
      accessTokenExpiresAt: state ? new Date(state.tokens.expiry_date).toISOString() : null,
      automaticSendingEnabled: false, manualSending: "explicit-confirmation-only", inboxProcessingEnabled: false,
      tokenFile: config.tokenPath,
      webAppRfqTransport: "internal-test-inbox",
      nextStep: state ? "Email authentication is configured. Web-app dispatch remains test-only." : "Run npm run gmail:connect and authorise your Gmail account.",
    }, null, 2));
    return;
  }
  if (command === "send") {
    const result = await client.send({
      to: values.to, subject: values.subject, text: values.body,
    }, { confirmed: values["confirm-send"] === true });
    if (result.sent) {
      const receiptPath = join(dirname(config.tokenPath), "sent", `${result.messageId}.json`);
      try {
        await writePrivateJson(receiptPath, { ...result, acceptedAt: new Date().toISOString() });
        result.receiptPath = receiptPath;
      } catch {
        // Sending already succeeded. A local receipt error must never cause a resend.
        result.warning = "Gmail accepted this email, but the local receipt could not be saved. Do not resend.";
      }
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "connect") {
    if (!values.replace && await readTokenState(config)) {
      console.log("Gmail is already connected. Use gmail:status -- --verify, or gmail:connect -- --replace to authorise again.");
      return;
    }
    const flow = await startAuthorization(config, { port: values.port === undefined ? 0 : Number(values.port) });
    const cancel = () => flow.cancel();
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    console.log(`Open this connection page in your normal browser:\n${flow.url}\n\nChoose your Gmail account and grant both requested permissions.\nThis link expires in 15 minutes. Setup checks only your mailbox profile; no email is sent.`);
    try {
      const result = await flow.completion;
      console.log(`Gmail connected: ${result.email}\nTokens saved privately. Run npm run gmail:status -- --verify to check the connection.`);
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
    return;
  }
}

main().catch(error => {
  // Deliberately omit stack traces, raw HTTP bodies and unknown error messages.
  console.error(error instanceof GmailError ? error.message : "The Gmail command could not complete. Check the arguments and local file permissions.");
  process.exitCode = 1;
});
