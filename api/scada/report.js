const {
  buildScadaRestUrl,
  fetchJson,
  getDefaultReportFileName,
  getScadaReportTable,
  handleOptions,
  isScadaConfigured,
  readJsonBody,
  scadaHeaders,
  sendJson,
  sendMethodNotAllowed,
  trim
} = require("./_shared");

function buildWritePayload(body) {
  return {
    file_name: trim(body.file_name || body.fileName) || getDefaultReportFileName(),
    data_base64: trim(body.data_base64 || body.dataBase64 || body.base64),
    uploaded_by: trim(body.uploaded_by || body.uploadedBy || body.empId) || null
  };
}

module.exports = async (req, res) => {
  if (handleOptions(req, res, "POST, PUT, OPTIONS")) return;
  if (req.method !== "POST" && req.method !== "PUT") {
    return sendMethodNotAllowed(res, "POST, PUT, OPTIONS");
  }
  if (!isScadaConfigured()) {
    return sendJson(res, 500, { ok: false, error: "scada_report_not_configured" });
  }

  const body = readJsonBody(req) || {};
  const payload = buildWritePayload(body);
  if (!payload.data_base64) {
    return sendJson(res, 400, { ok: false, error: "missing_data_base64" });
  }

  const tableUrl = buildScadaRestUrl(encodeURIComponent(getScadaReportTable()));

  try {
    const insertOut = await fetchJson(tableUrl, {
      method: "POST",
      headers: scadaHeaders({
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      }),
      body: JSON.stringify(payload)
    });
    if (insertOut.ok || insertOut.status === 201 || insertOut.status === 204) {
      return sendJson(res, 200, { ok: true, mode: "insert" });
    }

    const upsertOut = await fetchJson(tableUrl + "?on_conflict=file_name", {
      method: "POST",
      headers: scadaHeaders({
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      }),
      body: JSON.stringify(payload)
    });
    if (upsertOut.ok || upsertOut.status === 201 || upsertOut.status === 204) {
      return sendJson(res, 200, { ok: true, mode: "upsert" });
    }

    const patchOut = await fetchJson(
      tableUrl + "?file_name=eq." + encodeURIComponent(payload.file_name),
      {
        method: "PATCH",
        headers: scadaHeaders({
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        }),
        body: JSON.stringify({
          data_base64: payload.data_base64,
          uploaded_by: payload.uploaded_by
        })
      }
    );
    if (patchOut.ok || patchOut.status === 204) {
      return sendJson(res, 200, { ok: true, mode: "patch" });
    }

    return sendJson(res, 502, {
      ok: false,
      error: "report_write_failed",
      statuses: {
        insert: insertOut.status,
        upsert: upsertOut.status,
        patch: patchOut.status
      }
    });
  } catch (err) {
    return sendJson(res, 502, {
      ok: false,
      error: "report_write_error",
      message: String((err && err.message) || err || "unknown")
    });
  }
};
