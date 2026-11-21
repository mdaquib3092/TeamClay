import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if (char === "\n" && !quoted) { row.push(cell.replace(/\r$/, "")); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  const [headers = [], ...records] = rows;
  return records.map(values => Object.fromEntries(headers.map((key, index) => [key, values[index] || null])));
}

export function localRequestAllowed(request, port) {
  const host = request.headers.host;
  return [`127.0.0.1:${port}`, `localhost:${port}`].includes(host) &&
    (!request.headers.origin || request.headers.origin === `http://${host}`);
}

const json = (response, status, data) => {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(data));
};

export function createLocalApi({
  backendUrl, voiceUrl, bridgeUrl, dataRoot, port = 5174, fetchImpl = fetch,
  gmailStatus = async () => ({ authorised: false, state: "Not configured" }),
}) {
  const read = async (base, path, headers = {}) => {
    const response = await fetchImpl(new URL(path, base), { headers, signal: AbortSignal.timeout(7000), redirect: "error" });
    if (!response.ok) throw new Error("Service unavailable");
    return response.json();
  };
  return async (request, response, next) => {
    if (!request.url?.startsWith("/local-api/")) { next(); return; }
    if (!localRequestAllowed(request, port)) return json(response, 403, { error: "Open this service from the local procurement UI." });
    if (request.method !== "GET") return json(response, 405, { error: "This integration gateway is read-only. Business changes use the authenticated procurement API." });
    try {
      // Never expose transcripts, contacts or mailbox metadata to an unsigned-in visitor.
      const authentication = await fetchImpl(new URL("/api/workspace", backendUrl), {
        headers: { cookie: request.headers.cookie || "" }, signal: AbortSignal.timeout(7000), redirect: "error",
      });
      await authentication.body?.cancel();
      if (authentication.status === 401) return json(response, 401, { error: "Sign in to the procurement workspace first." });
      if (!authentication.ok) return json(response, 503, { error: "The procurement backend is unavailable." });
      const path = new URL(request.url, "http://localhost").pathname;
      if (path === "/local-api/status") {
        const results = await Promise.allSettled([
          read(bridgeUrl, "/status"), read(voiceUrl, "/api/status"), gmailStatus(),
        ]);
        const value = index => results[index].status === "fulfilled" ? results[index].value : { available: false, state: "Unavailable" };
        const agent=value(1), gmail=value(2), live=agent.caseWorkflow?.enabled===true && gmail.authorised===true;
        return json(response, 200, { whatsapp: value(0), agent, gmail:{...gmail,inboxMonitoringEnabled:live},
          commercialExecution:live,rfqTransport:"internal-test-inbox",caseRfqTransport:live?"pm-confirmed-gmail":null,liveEmailDispatch:live });
      }
      if (path === "/local-api/procurement/cases") {
        const [board, bridge, gmail] = await Promise.all([
          read(voiceUrl,"/api/procurement/cases"),read(bridgeUrl,"/status").catch(()=>({})),gmailStatus().catch(()=>({})),
        ]);
        const linked = bridge.phase==="connected" && bridge.sendScope==="configured_staff_only" && bridge.outboundEnabled===true;
        return json(response,200,{...board,agentNumber:linked && board.agentNumber?.endsWith(bridge.accountLastFour) ? board.agentNumber : null,
          connections:{whatsapp:linked,gmailAuthorised:gmail.authorised===true,agentEnding:bridge.accountLastFour || null}});
      }
      const sample = /^\/local-api\/procurement\/samples\/(cement|steel|waterproofing)$/.exec(path);
      if (sample) return json(response,200,await read(voiceUrl,`/api/procurement/samples/${sample[1]}`));
      const resources = { "/local-api/voice-notes": "/api/voice-notes", "/local-api/messages": "/api/messages", "/local-api/roles": "/api/roles" };
      if (resources[path]) return json(response, 200, await read(voiceUrl, resources[path]));
      if (path === "/local-api/catalog") {
        const names = ["projects", "users", "materials", "stock", "vendors", "vendor_performance"];
        const tables = Object.fromEntries(await Promise.all(names.map(async name => {
          const rows = parseCsv(await readFile(resolve(dataRoot, `${name}.csv`), "utf8"));
          return [name, rows.map(record => Object.fromEntries(Object.entries(record).map(([key, value]) =>
            [key, key === "whatsapp" && value ? `ending ${value.replace(/\D/g, "").slice(-4)}` : value])))];
        })));
        return json(response, 200, { tables, source: "TeamClay configured CSVs (demo/test catalog)", verifiedSupplierHistory: false });
      }
      return json(response, 404, { error: "Unknown local integration endpoint." });
    } catch {
      return json(response, 503, { error: "A local integration is unavailable. Check that the procurement backend and staff agent are running." });
    }
  };
}
