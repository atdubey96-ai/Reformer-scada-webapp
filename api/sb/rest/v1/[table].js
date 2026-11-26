// Relay for the office Excel push: forwards /api/sb/rest/v1/<table> to the plant Supabase REST API.
// Lets the office PC reach Supabase through the vercel.app domain when the proxy blocks *.supabase.co.
const { getPlantSupabaseUrl, getPlantSupabaseAnonKey } = require("../../../scada/_shared");

const ALLOWED_TABLES = new Set([
  "plant_data", "plant_data_history", "h2_material_balance", "app_settings",
  // Browser reads also come here when the office proxy blocks *.supabase.co.
  "scada_reports", "dcs_configs"
]);
const isAllowed = (t) => ALLOWED_TABLES.has(t) || /^h2_material_balance[a-z_0-9]*$/.test(t);
// apikey/authorization are always set server-side (new project anon key), so old Excel keys still work.
const FORWARD_HEADERS = ["content-type", "prefer", "accept", "range", "accept-profile", "content-profile"];

module.exports = async (req, res) => {
  const table = String((req.query && req.query.table) || "");
  if (!isAllowed(table)) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ ok: false, error: "table_not_allowed" }));
  }
  if (!["GET", "HEAD", "POST", "PATCH"].includes(req.method)) {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
  }

  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const cleanQs = qs.replace(/([?&])table=[^&]*&?/, "$1").replace(/[?&]$/, "");
  const target = getPlantSupabaseUrl() + "/rest/v1/" + table + cleanQs;

  const headers = {};
  for (const h of FORWARD_HEADERS) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }
  const anonKey = getPlantSupabaseAnonKey();
  headers.apikey = anonKey;
  headers.authorization = "Bearer " + anonKey;

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body == null ? {} : req.body);
  }

  try {
    const upstream = await fetch(target, { method: req.method, headers, body });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    const cr = upstream.headers.get("content-range");
    if (cr) res.setHeader("Content-Range", cr);
    return res.end(text);
  } catch (err) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ ok: false, error: "relay_fetch_error", message: String((err && err.message) || err) }));
  }
};
