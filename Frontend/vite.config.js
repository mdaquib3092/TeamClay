import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLocalApi, localRequestAllowed } from "./server/local-api.mjs";

export default defineConfig(({ mode }) => {
  // This object is server-side only. No OAuth secret is exposed as a VITE_ variable.
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.CLAY_BACKEND_URL || "http://127.0.0.1:5173";
  const port = Number(env.CLAY_UI_PORT || 5174);
  const source = env.CLAY_SOURCE_APP;
  const proxy = {
    target: backendUrl, changeOrigin: true,
    configure(server) {
      server.on("proxyReq", (upstream, request) => {
        if (request.headers.origin) upstream.setHeader("origin", new URL(backendUrl).origin);
        for (const name of Object.keys(request.headers)) if (name.startsWith("oai-authenticated-")) upstream.removeHeader(name);
      });
      server.on("proxyRes", response => {
        if (response.headers.location?.startsWith(backendUrl)) response.headers.location = response.headers.location.slice(backendUrl.length) || "/";
      });
    },
  };
  return {
    plugins: [react(), {
      name: "clay-local-integrations",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (!localRequestAllowed(request, port)) {
            response.writeHead(403, { "Content-Type": "text/plain" }); response.end("Local same-origin access only."); return;
          }
          next();
        });
        server.middlewares.use(createLocalApi({
          backendUrl, port,
          voiceUrl: env.CLAY_AGENT_URL || "http://127.0.0.1:8767",
          bridgeUrl: env.CLAY_WHATSAPP_STATUS_URL || "http://127.0.0.1:8766",
          dataRoot: resolve(process.cwd(), "../data"),
          gmailStatus: async () => {
            if (!source) return { authorised: false, state: "Set CLAY_SOURCE_APP on the local server" };
            try {
              const module = await import(pathToFileURL(resolve(source, "integrations/gmail/config.mjs")).href);
              const config = await module.loadGmailConfig({ root: source });
              const state = await module.readTokenState(config);
              return { authorised: !!state, mailbox: state?.email || null, state: state ? "Gmail OAuth connected" : "Sign-in required",
                automaticSendingEnabled: false, inboxMonitoringEnabled: false, verifiedWithGoogle: false };
            } catch { return { authorised: false, state: "Local Gmail configuration unavailable" }; }
          },
        }));
      },
    }],
    base: "./",
    server: { host: "127.0.0.1", port, strictPort: true,
      fs: { allow: [process.cwd()], deny: ["**/.env*", "**/.credentials/**", "**/client_secret_*.json", "**/.git/**", "**/*.pem", "**/*.key"] },
      proxy: Object.fromEntries(
      ["/api", "/signin-with-chatgpt", "/signout-with-chatgpt", "/callback"].map(path => [path, proxy]),
    ) },
  };
});
