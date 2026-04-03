const crypto = require("crypto");

const DEFAULT_ADMIN_EMP_ID = "15112019";
const DEFAULT_ADMIN_PASSWORD_HASH = "73f7169006184f3d26b47f939da25dc51aa33fe282f9d3830df0390b04f759f6";
const FAILED_LOGIN_DELAY_MS = 450;

function getAdminEmpId() {
  return String(process.env.SCADA_ADMIN_EMP_ID || DEFAULT_ADMIN_EMP_ID).trim();
}

function getAdminPasswordHash() {
  return String(process.env.SCADA_ADMIN_PASSWORD_HASH || DEFAULT_ADMIN_PASSWORD_HASH)
    .trim()
    .toLowerCase();
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input == null ? "" : input), "utf8").digest("hex");
}

function safeEqualString(left, right) {
  const a = Buffer.from(String(left == null ? "" : left), "utf8");
  const b = Buffer.from(String(right == null ? "" : right), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch (_err) {
      return null;
    }
  }
  return null;
}

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.json(payload);
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.status(204);
    res.setHeader("Allow", "POST, OPTIONS");
    res.setHeader("Cache-Control", "no-store");
    return res.end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  }

  const body = readJsonBody(req);
  const empId = String((body && body.empId) || "").trim();
  const password = String((body && body.password) || "");

  if (!empId || !password) {
    await sleep(FAILED_LOGIN_DELAY_MS);
    return sendJson(res, 400, { ok: false, error: "missing_credentials" });
  }

  const empMatches = safeEqualString(empId, getAdminEmpId());
  const passwordMatches = safeEqualString(sha256Hex(password), getAdminPasswordHash());

  if (!empMatches || !passwordMatches) {
    await sleep(FAILED_LOGIN_DELAY_MS);
    return sendJson(res, 401, { ok: false, error: "invalid_credentials" });
  }

  return sendJson(res, 200, {
    ok: true,
    role: "admin"
  });
};
