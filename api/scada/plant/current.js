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
  const baseUrl = buildPlantRestUrl(encodeURIComponent(getPlantCurrentTable()));
  let filterQuery = "";
  if (tags.length) {
    filterQuery += "&tag_id=in.(" + buildSupabaseInFilter(tags) + ")";
  }
  filterQuery += "&order=synced_at.desc&limit=" + encodeURIComponent(String(limit));

  try {
    let out = await fetchJson(
      baseUrl + "?select=tag_id,label,value,unit,synced_at,pushed_at" + filterQuery,
      { method: "GET", headers: plantHeaders() }
    );
    const errorMessage = String(
      (out && out.json && (out.json.message || out.json.error || out.json.hint)) || ""
    ).toLowerCase();
    if (!out.ok && out.status === 400 && errorMessage.indexOf("pushed_at") !== -1) {
      out = await fetchJson(
        baseUrl + "?select=tag_id,label,value,unit,synced_at" + filterQuery,
        { method: "GET", headers: plantHeaders() }
      );
    }
    if (!out.ok) {
      return sendJson(res, 502, {
        ok: false,
        error: "plant_current_fetch_failed",
        status: out.status
      });
    }
    return sendJson(
      res,
      200,
      (Array.isArray(out.json) ? out.json : []).map((row) =>
        Object.assign({}, row, {
          pushed_at: (row && (row.pushed_at || row.synced_at)) || null
        })
      )
    );
  } catch (err) {
    return sendJson(res, 502, {
      ok: false,
      error: "plant_current_fetch_error",
      message: String((err && err.message) || err || "unknown")
    });
  }
};
