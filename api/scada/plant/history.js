const {
  buildScadaRestUrl,
  buildPlantRestUrl,
  buildSupabaseInFilter,
  fetchJson,
  getPlantHistoryTable,
  getScadaReportTable,
  handleOptions,
  isPlantConfigured,
  plantHeaders,
  scadaHeaders,
  sendJson,
  sendMethodNotAllowed,
  splitCsvParam
} = require("../_shared");

const LIVE_HISTORY_REPORT_FILE_NAME = "SCADA_LIVE_PLANT_HISTORY.json";

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch (_err) {
    return null;
  }
}

function decodeHistoryReportPayload(raw) {
  try {
    const text = Buffer.from(String(raw || ""), "base64").toString("utf8");
    const parsed = safeJsonParse(text);
    return parsed && Array.isArray(parsed.rows) ? parsed.rows : [];
  } catch (_err) {
    return [];
  }
}

function filterFallbackRows(rows, tags, since, limit) {
  const wanted = new Set((Array.isArray(tags) ? tags : []).map((tag) => String(tag || "").trim()).filter(Boolean));
  const sinceMs = Date.parse(String(since || ""));
  const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
    const tagId = String(row && row.tag_id || "").trim();
    if (wanted.size && !wanted.has(tagId)) return false;
    const stampMs = Date.parse(String((row && (row.pushed_at || row.synced_at || row.recorded_at)) || ""));
    if (Number.isFinite(sinceMs) && (!Number.isFinite(stampMs) || stampMs < sinceMs)) return false;
    return !!tagId;
  });
  return Number.isFinite(limit) && limit > 0 ? filtered.slice(-limit) : filtered;
}

async function fetchFallbackHistoryRows(tags, since, limit) {
  const url =
    buildScadaRestUrl(encodeURIComponent(getScadaReportTable())) +
    "?select=file_name,data_base64,created_at&file_name=eq." +
    encodeURIComponent(LIVE_HISTORY_REPORT_FILE_NAME) +
    "&order=created_at.desc&limit=1";
  const out = await fetchJson(url, { method: "GET", headers: scadaHeaders() });
  if (!out.ok) return [];
  const rows = decodeHistoryReportPayload(Array.isArray(out.json) && out.json.length ? out.json[0].data_base64 : "");
  return filterFallbackRows(rows, tags, since, limit);
}

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

  const baseUrl = buildPlantRestUrl(encodeURIComponent(getPlantHistoryTable()));
  const tagFilter = tags.length
    ? "&tag_id=in.(" + buildSupabaseInFilter(tags) + ")"
    : "";
  const pushedQuery =
    baseUrl +
    "?select=tag_id,label,value,pushed_at,synced_at,recorded_at" +
    (since ? "&pushed_at=gte." + encodeURIComponent(since) : "") +
    tagFilter +
    "&order=pushed_at.asc&limit=" + encodeURIComponent(String(limit));
  const recordedQuery =
    baseUrl +
    "?select=tag_id,label,value,recorded_at,synced_at" +
    (since ? "&recorded_at=gte." + encodeURIComponent(since) : "") +
    tagFilter +
    "&order=recorded_at.asc&limit=" + encodeURIComponent(String(limit));

  try {
    let out = await fetchJson(pushedQuery, { method: "GET", headers: plantHeaders() });
    const errorMessage = String(
      (out && out.json && (out.json.message || out.json.error || out.json.hint)) || ""
    ).toLowerCase();
    if (!out.ok && out.status === 400 && errorMessage.indexOf("pushed_at") !== -1) {
      out = await fetchJson(recordedQuery, { method: "GET", headers: plantHeaders() });
    }
    if (!out.ok) {
      const fallbackRows = await fetchFallbackHistoryRows(tags, since, limit);
      if (fallbackRows.length) {
        return sendJson(res, 200, {
          rows: fallbackRows,
          error: ""
        });
      }
      return sendJson(res, 502, {
        ok: false,
        error: "plant_history_fetch_failed",
        status: out.status
      });
    }
    const directRows = Array.isArray(out.json) ? out.json : [];
    if (!directRows.length) {
      const fallbackRows = await fetchFallbackHistoryRows(tags, since, limit);
      if (fallbackRows.length) {
        return sendJson(res, 200, {
          rows: fallbackRows,
          error: ""
        });
      }
    }
    return sendJson(res, 200, {
      rows: directRows,
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
