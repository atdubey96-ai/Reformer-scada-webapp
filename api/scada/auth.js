const {
  buildScadaRestUrl,
  fetchJson,
  getScadaAuthRowId,
  getScadaAuthTable,
  handleOptions,
  isScadaConfigured,
  scadaHeaders,
  sendJson,
  sendMethodNotAllowed
} = require("./_shared");

module.exports = async (req, res) => {
  if (handleOptions(req, res, "GET, OPTIONS")) return;
  if (req.method !== "GET") return sendMethodNotAllowed(res, "GET, OPTIONS");
  if (!isScadaConfigured()) {
    return sendJson(res, 500, { ok: false, error: "scada_auth_not_configured" });
  }

  const url =
    buildScadaRestUrl(encodeURIComponent(getScadaAuthTable())) +
    "?id=eq." + encodeURIComponent(getScadaAuthRowId()) +
    "&select=password_hash";

  try {
    const out = await fetchJson(url, { method: "GET", headers: scadaHeaders() });
    if (!out.ok) {
      return sendJson(res, 502, {
        ok: false,
        error: "auth_fetch_failed",
        status: out.status
      });
    }
    const row = Array.isArray(out.json) && out.json.length ? out.json[0] : {};
    return sendJson(res, 200, {
      password_hash: row.password_hash || ""
    });
  } catch (err) {
    return sendJson(res, 502, {
      ok: false,
      error: "auth_fetch_error",
      message: String((err && err.message) || err || "unknown")
    });
  }
};
