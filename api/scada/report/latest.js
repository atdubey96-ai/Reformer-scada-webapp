const {
  buildScadaRestUrl,
  fetchJson,
  getDefaultReportFileName,
  getScadaReportTable,
  handleOptions,
  isScadaConfigured,
  scadaHeaders,
  sendJson,
  sendMethodNotAllowed,
  trim
} = require("../_shared");

function emptyRow(fileName) {
  return {
    file_name: fileName || "",
    data_base64: "",
    created_at: null,
    uploaded_by: null
  };
}

module.exports = async (req, res) => {
  if (handleOptions(req, res, "GET, OPTIONS")) return;
  if (req.method !== "GET") return sendMethodNotAllowed(res, "GET, OPTIONS");
  if (!isScadaConfigured()) {
    return sendJson(res, 500, { ok: false, error: "scada_report_not_configured" });
  }

  const requestedFile = trim((req.query && req.query.file_name) || "");
  const exactFile = requestedFile || getDefaultReportFileName();
  const table = encodeURIComponent(getScadaReportTable());
  const exactUrl =
    buildScadaRestUrl(table) +
    "?select=file_name,data_base64,created_at,uploaded_by" +
    "&file_name=eq." + encodeURIComponent(exactFile) +
    "&order=created_at.desc&limit=1";

  try {
    const exactOut = await fetchJson(exactUrl, { method: "GET", headers: scadaHeaders() });
    if (exactOut.ok) {
      const rows = Array.isArray(exactOut.json) ? exactOut.json : [];
      if (rows.length) return sendJson(res, 200, rows[0]);
    }

    if (!requestedFile && /\.xlsx$/i.test(exactFile)) {
      const anyXlsxUrl =
        buildScadaRestUrl(table) +
        "?select=file_name,data_base64,created_at,uploaded_by" +
        "&file_name=ilike.*.xlsx&order=created_at.desc&limit=1";
      const anyOut = await fetchJson(anyXlsxUrl, { method: "GET", headers: scadaHeaders() });
      if (anyOut.ok) {
        const rows = Array.isArray(anyOut.json) ? anyOut.json : [];
        if (rows.length) return sendJson(res, 200, rows[0]);
      }
    }

    return sendJson(res, 200, emptyRow(exactFile));
  } catch (err) {
    return sendJson(res, 502, {
      ok: false,
      error: "report_fetch_error",
      message: String((err && err.message) || err || "unknown")
    });
  }
};
