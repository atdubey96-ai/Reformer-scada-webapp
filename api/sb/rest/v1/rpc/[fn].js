// Relay for Supabase RPC calls (e.g. tube_life_hourly) when the browser cannot reach *.supabase.co directly.
const { getPlantSupabaseUrl, getPlantSupabaseAnonKey } = require("../../../../scada/_shared");

const ALLOWED_FNS = new Set(["tube_life_hourly"]);

module.exports = async (req, res) => {
  const fn = String((req.query && req.query.fn) || "");
  if (!ALLOWED_FNS.has(fn)) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ ok: false, error: "rpc_not_allowed" }));
  }
  if (!["GET", "POST"].includes(req.method)) {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
  }
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const cleanQs = qs.replace(/([?&])fn=[^&]*&?/, "$1").replace(/[?&]$/, "");
  const key = getPlantSupabaseAnonKey();
  const headers = { apikey: key, authorization: "Bearer " + key, "content-type": "application/json" };
  if (req.headers.accept) headers.accept = req.headers.accept;
  let body;
  if (req.method === "POST") body = typeof req.body === "string" ? req.body : JSON.stringify(req.body == null ? {} : req.body);
  try {
    const upstream = await fetch(getPlantSupabaseUrl() + "/rest/v1/rpc/" + fn + cleanQs, { method: req.method, headers, body });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    return res.end(text);
  } catch (err) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ ok: false, error: "relay_fetch_error", message: String((err && err.message) || err) }));
  }
};
