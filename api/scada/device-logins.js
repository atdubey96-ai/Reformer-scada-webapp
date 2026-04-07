const {
  buildScadaRestUrl,
  fetchJson,
  getScadaReportTable,
  handleOptions,
  isScadaConfigured,
  readJsonBody,
  scadaHeaders,
  sendJson,
  sendMethodNotAllowed,
  trim
} = require("./_shared");

const LOGIN_EVENT_PREFIX = "SCADA-DEVICE-LOGIN-";
const DEFAULT_HOURS = 24;
const MAX_HOURS = 168;
const MAX_ROWS = 500;

function clampHours(raw) {
  const parsed = parseInt(trim(raw || DEFAULT_HOURS), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_HOURS;
  return Math.max(1, Math.min(MAX_HOURS, parsed));
}

function normalizeRole(value) {
  return String(value || "").toLowerCase() === "admin" ? "admin" : "operator";
}

function sanitizeToken(value, fallback) {
  const cleaned = String(value || "")
    .replace(/[^a-z0-9_-]/gi, "")
    .slice(0, 40);
  return cleaned || String(fallback || "unknown");
}

function normalizePostedEvent(body) {
  const event = {
    emp_id: trim(body.emp_id || body.empId || body.uploaded_by || body.uploadedBy),
    role: normalizeRole(body.role),
    device_id: trim(body.device_id || body.deviceId),
    device_code: trim(body.device_code || body.deviceCode),
    device_label: trim(body.device_label || body.deviceLabel || body.label),
    browser_label: trim(body.browser_label || body.browserLabel || body.browser),
    platform_label: trim(body.platform_label || body.platformLabel || body.platform),
    logged_in_at: trim(body.logged_in_at || body.loggedInAt || body.timestamp) || new Date().toISOString(),
    session_kind: trim(body.session_kind || body.sessionKind || "login") || "login"
  };
  return event;
}

function buildEventFileName(event) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const safeEmp = sanitizeToken(event.emp_id, "emp");
  const safeDevice = sanitizeToken(event.device_id, "device");
  return `${LOGIN_EVENT_PREFIX}${stamp}-${safeEmp}-${safeDevice}-${rand}.json`;
}

function encodeEventPayload(event) {
  return Buffer.from(JSON.stringify(event), "utf8").toString("base64");
}

function decodeEventPayload(row) {
  try {
    return JSON.parse(Buffer.from(String(row.data_base64 || ""), "base64").toString("utf8"));
  } catch (_err) {
    return null;
  }
}

function parseLoginRow(row) {
  const decoded = decodeEventPayload(row);
  if (!decoded || typeof decoded !== "object") return null;

  const deviceId = trim(decoded.device_id || decoded.deviceId);
  if (!deviceId) return null;

  const createdAt = trim(row.created_at || "");
  const empId = trim(decoded.emp_id || decoded.empId || row.uploaded_by || "");
  const deviceCode = trim(decoded.device_code || decoded.deviceCode || sanitizeToken(deviceId, "device").toUpperCase().slice(-6));

  return {
    file_name: trim(row.file_name || ""),
    created_at: createdAt || null,
    uploaded_by: trim(row.uploaded_by || ""),
    emp_id: empId,
    role: normalizeRole(decoded.role),
    device_id: deviceId,
    device_code: deviceCode || "UNKNOWN",
    device_label: trim(decoded.device_label || decoded.deviceLabel || "Unknown Device"),
    browser_label: trim(decoded.browser_label || decoded.browserLabel || decoded.browser || "Browser"),
    platform_label: trim(decoded.platform_label || decoded.platformLabel || decoded.platform || "Browser"),
    logged_in_at: trim(decoded.logged_in_at || decoded.loggedInAt || createdAt) || createdAt || null,
    session_kind: trim(decoded.session_kind || decoded.sessionKind || "login") || "login"
  };
}

function toEpoch(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : 0;
}

function buildSummary(rows, sinceIso, hours) {
  const devices = new Map();
  const employees = new Set();
  let totalLogins = 0;

  rows.forEach((row) => {
    const event = parseLoginRow(row);
    if (!event) return;
    totalLogins += 1;
    if (event.emp_id) employees.add(event.emp_id);

    const key = event.device_id;
    const seenAt = event.logged_in_at || event.created_at || null;
    const seenMs = toEpoch(seenAt);
    let entry = devices.get(key);

    if (!entry) {
      entry = {
        device_id: event.device_id,
        device_code: event.device_code,
        device_label: event.device_label,
        browser_label: event.browser_label,
        platform_label: event.platform_label,
        login_count: 0,
        first_seen_at: seenAt,
        first_seen_ms: seenMs,
        last_seen_at: seenAt,
        last_seen_ms: seenMs,
        last_emp_id: event.emp_id,
        last_role: event.role,
        employees: []
      };
      devices.set(key, entry);
    }

    entry.login_count += 1;
    if (event.emp_id && entry.employees.indexOf(event.emp_id) === -1) {
      entry.employees.push(event.emp_id);
    }

    if (!entry.first_seen_ms || (seenMs && seenMs < entry.first_seen_ms)) {
      entry.first_seen_at = seenAt;
      entry.first_seen_ms = seenMs;
    }

    if (!entry.last_seen_ms || (seenMs && seenMs >= entry.last_seen_ms)) {
      entry.last_seen_at = seenAt;
      entry.last_seen_ms = seenMs;
      entry.last_emp_id = event.emp_id || entry.last_emp_id;
      entry.last_role = event.role || entry.last_role;
      entry.device_label = event.device_label || entry.device_label;
      entry.browser_label = event.browser_label || entry.browser_label;
      entry.platform_label = event.platform_label || entry.platform_label;
      entry.device_code = event.device_code || entry.device_code;
    }
  });

  const deviceList = Array.from(devices.values())
    .sort((left, right) => (right.last_seen_ms || 0) - (left.last_seen_ms || 0))
    .map((entry) => {
      delete entry.first_seen_ms;
      delete entry.last_seen_ms;
      return entry;
    });

  return {
    ok: true,
    hours,
    since: sinceIso,
    unique_device_count: deviceList.length,
    unique_employee_count: employees.size,
    total_logins: totalLogins,
    devices: deviceList
  };
}

module.exports = async (req, res) => {
  if (handleOptions(req, res, "GET, POST, OPTIONS")) return;
  if (req.method !== "GET" && req.method !== "POST") {
    return sendMethodNotAllowed(res, "GET, POST, OPTIONS");
  }

  if (!isScadaConfigured()) {
    return sendJson(res, 500, { ok: false, error: "scada_report_not_configured" });
  }

  const table = encodeURIComponent(getScadaReportTable());
  const tableUrl = buildScadaRestUrl(table);

  if (req.method === "POST") {
    const body = readJsonBody(req) || {};
    const event = normalizePostedEvent(body);

    if (!event.emp_id || !event.device_id || !event.device_label) {
      return sendJson(res, 400, { ok: false, error: "missing_device_login_fields" });
    }

    const payload = {
      file_name: buildEventFileName(event),
      data_base64: encodeEventPayload(event),
      uploaded_by: event.emp_id || null
    };

    try {
      const out = await fetchJson(tableUrl, {
        method: "POST",
        headers: scadaHeaders({
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        }),
        body: JSON.stringify(payload)
      });

      if (out.ok || out.status === 201 || out.status === 204) {
        return sendJson(res, 200, { ok: true, file_name: payload.file_name });
      }

      return sendJson(res, 502, {
        ok: false,
        error: "device_login_write_failed",
        status: out.status
      });
    } catch (err) {
      return sendJson(res, 502, {
        ok: false,
        error: "device_login_write_error",
        message: String((err && err.message) || err || "unknown")
      });
    }
  }

  const hours = clampHours(req.query && req.query.hours);
  const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const queryUrl =
    tableUrl +
    "?select=file_name,data_base64,created_at,uploaded_by" +
    "&file_name=ilike." + encodeURIComponent(LOGIN_EVENT_PREFIX + "*") +
    "&created_at=gte." + encodeURIComponent(sinceIso) +
    "&order=created_at.desc" +
    "&limit=" + MAX_ROWS;

  try {
    const out = await fetchJson(queryUrl, { method: "GET", headers: scadaHeaders() });
    if (!out.ok) {
      return sendJson(res, 502, {
        ok: false,
        error: "device_login_fetch_failed",
        status: out.status
      });
    }

    const rows = Array.isArray(out.json) ? out.json : [];
    return sendJson(res, 200, buildSummary(rows, sinceIso, hours));
  } catch (err) {
    return sendJson(res, 502, {
      ok: false,
      error: "device_login_fetch_error",
      message: String((err && err.message) || err || "unknown")
    });
  }
};
