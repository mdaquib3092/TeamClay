export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export const deskPath = path => globalThis.location?.pathname?.startsWith("/desk/") ? "/desk"+path : path;

export async function request(path, { body, signal, ...options } = {}) {
  const response = await fetch(deskPath(path), {
    credentials: "same-origin", cache: "no-store", ...options, signal,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...options.headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data;
  try { data = await response.json(); }
  catch { throw new ApiError("The service returned an unreadable response. Check that the backend is running.", response.status); }
  if (!response.ok) throw new ApiError(typeof data.error === "string" ? data.error : data.error?.message || "The request could not be completed.", response.status);
  return data;
}
