import { useCallback, useEffect, useState } from "react";
import { request } from "./api.mjs";

export function useResource(path) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { const next = await request(path); setData(next); setError(""); }
    catch (error) { setError(error.message); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => { refresh(); }, [refresh]);
  return { data, error, loading, refresh };
}
