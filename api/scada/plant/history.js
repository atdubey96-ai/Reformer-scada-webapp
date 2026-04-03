const {
  buildPlantRestUrl,
  buildSupabaseInFilter,
  fetchJson,
  getPlantHistoryTable,
  handleOptions,
  isPlantConfigured,
  plantHeaders,
  sendJson,
  sendMethodNotAllowed,
  splitCsvParam
} = require("../_shared");

module.exports = async (req, res) => {
  if (handleOptions(req, res, "GET, OPTIONS")) return;
  if (req.method !== "GET") return sendMethodNotAllowed(res, "GET, OPTIONS");
  if (!isPlantConfigured()) {
    return sendJson(res, 500, { ok: false, error: "plant_proxy_not_configured" });
  }

  const tags = splitCsvParam(req.query && req.query.tags);
  const since = String((req.query && req.query.since) || "").trim();
  const limitRaw = Number(req.query && req.query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 10000) : 5000;

  let url =
    buildPlantRestUrl(encodeURIComponent(getPlantHistoryTable())) +
    "?select=tag_id,label,value,recorded_at";
  if (since) {
    url += "&recorded_at=gte." + encodeURIComponent(since);
  }
  if (tags.length) {
    url += "&tag_id=in.(" + buildSupabaseInFilter(tags) + ")";
  }
  url += "&order=recorded_at.asc&limit=" + encodeURIComponent(String(limit));

  try {
    const out = await fetchJson(url, { method: "GET", headers: plantHeaders() });
    if (!out.ok) {
      return sendJson(res, 502, {
        ok: false,
        error: "plant_history_fetch_failed",
        status: out.status
      });
    }
    return sendJson(res, 200, {
      rows: Array.isArray(out.json) ? out.json : [],
      error: ""
    });
  } catch (err) {
    return sendJson(res, 502, {
      ok: false,
      error: "plant_history_fetch_error",
      message: String((err && err.message) || err || "unknown")
    });
  }
};
