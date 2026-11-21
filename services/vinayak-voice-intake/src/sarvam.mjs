const API = "https://api.sarvam.ai";
const JOBS = "/speech-to-text/job/v1";

export class ProviderError extends Error {
  constructor(code, status = 0, retryable = false) {
    super(code);
    this.code = code; this.status = status; this.retryable = retryable;
  }
}

export async function readJson(response, maximum = 2 * 1024 * 1024) {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel();
    throw new ProviderError("response_too_large");
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body || []) {
    total += chunk.length;
    if (total > maximum) throw new ProviderError("response_too_large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ProviderError("invalid_provider_response"); }
}

export function signedStorageUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new ProviderError("invalid_storage_url"); }
  const host = url.hostname;
  const sarvamS3 = /^saas-prod-vistaar-[a-z0-9-]+\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(host);
  const trusted = host === "api.sarvam.ai" || host === "storage.googleapis.com" ||
    host.endsWith(".storage.googleapis.com") || host.endsWith(".blob.core.windows.net") ||
    host.endsWith(".blob.storage.azure.net") || sarvamS3;
  if (url.protocol !== "https:" || url.username || url.password ||
      (url.port && url.port !== "443") || !trusted) throw new ProviderError("untrusted_storage_url");
  return url.href;
}

function transcriptResult(result) {
  if (typeof result?.transcript !== "string" || !result.transcript.trim()) {
    throw new ProviderError("empty_transcript_needs_review");
  }
  return {
    transcript: result.transcript.trim(), language_code: result.language_code || null,
    request_id: result.request_id || null, timestamps: result.timestamps || null,
  };
}

export class SarvamClient {
  constructor({ apiKey, model = "saaras:v4", fetcher = fetch }) {
    this.apiKey = apiKey; this.model = model; this.fetcher = fetcher;
  }
  async request(endpoint, { method = "GET", body, signal } = {}) {
    const headers = { "api-subscription-key": this.apiKey };
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await this.fetcher(API + endpoint, {
        method, headers, body: body === undefined || multipart ? body : JSON.stringify(body),
        redirect: "error", signal: signal || AbortSignal.timeout(60000),
      });
    } catch { throw new ProviderError("sarvam_network_error", 0, true); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(`sarvam_http_${response.status}`, response.status,
        response.status === 429 || response.status >= 500);
    }
    return readJson(response);
  }
  async transcribeWav(wav, language = "unknown") {
    const body = new FormData();
    body.set("file", new Blob([wav], { type: "audio/wav" }), "note.wav");
    body.set("model", this.model);
    body.set("mode", "transcribe");
    body.set("language_code", language);
    body.set("with_timestamps", "true");
    return transcriptResult(await this.request("/speech-to-text", { method: "POST", body }));
  }
  async initialise(language = "unknown") {
    const result = await this.request(JOBS, {
      method: "POST", body: { job_parameters: {
        model: this.model, mode: "transcribe", language_code: language,
        with_timestamps: true, with_diarization: false,
      } },
    });
    if (typeof result.job_id !== "string" || !result.job_id) throw new ProviderError("missing_job_id");
    return result.job_id;
  }
  async upload(jobId, filename, audio) {
    const links = await this.request(`${JOBS}/upload-files`, {
      method: "POST", body: { job_id: jobId, files: [filename] },
    });
    const url = signedStorageUrl(links.upload_urls?.[filename]?.file_url);
    const headers = { "Content-Type": "application/octet-stream" };
    if (["Azure", "Azure_V1"].includes(links.storage_container_type)) {
      headers["x-ms-blob-type"] = "BlockBlob";
    }
    let response;
    try {
      // Signed storage URLs authenticate themselves: NEVER forward the Sarvam key.
      response = await this.fetcher(url, {
        method: "PUT", headers, body: audio, redirect: "error",
        signal: AbortSignal.timeout(120000),
      });
    } catch { throw new ProviderError("audio_upload_network_error", 0, true); }
    await response.body?.cancel();
    if (!response.ok) throw new ProviderError("audio_upload_failed", response.status, true);
  }
  start(jobId) {
    return this.request(`${JOBS}/${encodeURIComponent(jobId)}/start`, { method: "POST" });
  }
  status(jobId) {
    return this.request(`${JOBS}/${encodeURIComponent(jobId)}/status`);
  }
  async result(jobId, status) {
    const details = status.job_details || [];
    const outputs = details.filter(file => file.state === "Success").flatMap(file => file.outputs || []);
    if (outputs.length !== 1 || details.some(file => file.state !== "Success")) {
      throw new ProviderError("batch_output_incomplete");
    }
    const filename = outputs[0].file_name;
    if (typeof filename !== "string" || !filename.endsWith(".json")) throw new ProviderError("invalid_output_file");
    const links = await this.request(`${JOBS}/download-files`, {
      method: "POST", body: { job_id: jobId, files: [filename] },
    });
    const url = signedStorageUrl(links.download_urls?.[filename]?.file_url);
    let response;
    try { response = await this.fetcher(url, { redirect: "error", signal: AbortSignal.timeout(60000) }); }
    catch { throw new ProviderError("transcript_download_error", 0, true); }
    if (!response.ok) throw new ProviderError("transcript_download_failed", response.status, true);
    return transcriptResult(await readJson(response));
  }
}
