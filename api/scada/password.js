const {
  buildScadaRestUrl,
  fetchJson,
  getScadaAuthRowId,
  getScadaAuthTable,
  handleOptions,
  isScadaConfigured,
  readJsonBody,
  safeEqualString,
  scadaHeaders,
  sendJson,
  sendMethodNotAllowed,
  sha256Hex,
  trim
} = require("./_shared");

const FAILED_DELAY_MS = 450;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

module.exports = async (req, res) => {
  if (handleOptions(req, res, "POST, OPTIONS")) return;
  if (req.method !== "POST") return sendMethodNotAllowed(res, "POST, OPTIONS");
  if (!isScadaConfigured()) {
    return sendJson(res, 500, { ok: false, error: "scada_password_not_configured" });
  }

  const body = readJsonBody(req) || {};
  const empId = trim(body.empId);
  const otp = String(body.otp || "");
  const newPassword = String(body.newPassword || "");

  if (!empId) return sendJson(res, 400, { ok: false, error: "missing_emp_id" });
  if (!otp) return sendJson(res, 400, { ok: false, error: "missing_otp" });
  if (!newPassword || newPassword.length < 4) {
    return sendJson(res, 400, { ok: false, error: "invalid_new_password" });
  }

  const authUrl =
    buildScadaRestUrl(encodeURIComponent(getScadaAuthTable())) +
    "?id=eq." + encodeURIComponent(getScadaAuthRowId()) +
    "&select=otp_hash";

  try {
    const authOut = await fetchJson(authUrl, { method: "GET", headers: scadaHeaders() });
    if (!authOut.ok) {
      return sendJson(res, 502, { ok: false, error: "otp_fetch_failed", status: authOut.status });
    }
    const row = Array.isArray(authOut.json) && authOut.json.length ? authOut.json[0] : {};
    const otpHash = String(row.otp_hash || "").toLowerCase();
    if (!otpHash) {
      return sendJson(res, 400, { ok: false, error: "otp_not_configured" });
    }
    if (!safeEqualString(sha256Hex(otp), otpHash)) {
      await sleep(FAILED_DELAY_MS);
      return sendJson(res, 401, { ok: false, error: "invalid_otp" });
    }

    const nextHash = sha256Hex(newPassword);
    const patchUrl =
      buildScadaRestUrl(encodeURIComponent(getScadaAuthTable())) +
      "?id=eq." + encodeURIComponent(getScadaAuthRowId());
    const payload = {
      password_hash: nextHash,
      updated_by: empId,
      updated_at: new Date().toISOString()
    };
    const patchOut = await fetchJson(patchUrl, {
      method: "PATCH",
      headers: scadaHeaders({
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      }),
      body: JSON.stringify(payload)
    });
    if (!(patchOut.ok || patchOut.status === 204)) {
      return sendJson(res, 502, {
        ok: false,
        error: "password_update_failed",
        status: patchOut.status
      });
    }
    return sendJson(res, 200, { ok: true, password_hash: nextHash });
  } catch (err) {
    return sendJson(res, 502, {
      ok: false,
      error: "password_update_error",
      message: String((err && err.message) || err || "unknown")
    });
  }
};
