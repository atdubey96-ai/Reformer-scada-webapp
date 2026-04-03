const {
  buildPlantRestUrl,
  buildSupabaseInFilter,
  fetchJson,
  getPlantCurrentTable,
  handleOptions,
  isPlantConfigured,
  plantHeaders,
  sendJson,
  sendMethodNotAllowed,
  splitCsvParam,
  trim
} = require("../_shared");

module.exports = async (req, res) => {
  if (handleOptions(req, res, "GET, OPTIONS")) return;
  if (req.method !== "GET") return sendMethodNotAllowed(res, "GET, OPTIONS");
  if (!isPlantConfigured()) {
    return sendJson(res, 500, { ok: false, error: "plant_proxy_not_configured" });
  }

  const tags = splitCsvParam(req.query && req.query.tags);
  const limitRaw = Number(req.query && req.query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200;
  let url =
    buildPlantRestUrl(encodeURIComponent(getPlantCurrentTable())) +
    "?select=tag_id,label,value,unit,synced_at,pushed_at";
  if (tags.length) {
    url += "&tag_id=in.(" + buildSupabaseInFilter(tags) + ")";
  }
  url += "&order=synced_at.desc&limit=" + encodeURIComponent(String(limit));

  try {
    const out = await fetchJson(url, { method: "GET", headers: plantHeaders() });
    if (!out.ok) {
      return sendJson(res, 502, {
        ok: false,
        error: "plant_current_fetch_failed",
        status: out.status
      });
    }
    return sendJson(res, 200, Array.isArray(out.json) ? out.json : []);
  } catch (err) {
    return sendJson(res, 502, {
      ok: false,
      error: "plant_current_fetch_error",
      message: String((err && err.message) || err || "unknown")
    });
  }
};
