const crypto = require("crypto");

const DEFAULT_SCADA_SUPABASE_URL = "https://xqkbrlcdbgykmatzwvct.supabase.co";
const DEFAULT_SCADA_SUPABASE_ANON_KEY = "sb_publishable_L99JfiV_68w79GJ10klTCg_R1H60L_D";
const DEFAULT_SCADA_REPORT_TABLE = "scada_reports";
const DEFAULT_SCADA_AUTH_TABLE = "scada_auth";
const DEFAULT_SCADA_AUTH_ROW_ID = "1";
const DEFAULT_SCADA_REPORT_FILE_NAME = "Burner_SCADA_Report.xlsx";

const DEFAULT_PLANT_SUPABASE_URL = "https://mozuuowwdfyqqvpiyetk.supabase.co";
const DEFAULT_PLANT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1venV1b3d3ZGZ5cXF2cGl5ZXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MTU3NjksImV4cCI6MjA5MDE5MTc2OX0.SqSAoPwxgPi6cVrYeIQC8xBebbVINZEaPw-odWdqUPo";
const DEFAULT_PLANT_CURRENT_TABLE = "plant_data";
const DEFAULT_PLANT_HISTORY_TABLE = "plant_data_history";

function trim(value) {
  return String(value == null ? "" : value).trim();
}

function trimTrailingSlash(value) {
  return trim(value).replace(/\/+$/, "");
}

function getEnv(name, fallback) {
  const value = trim(process.env[name] || "");
  return value || trim(fallback || "");
}

function getScadaSupabaseUrl() {
  return trimTrailingSlash(getEnv("SCADA_SUPABASE_URL", DEFAULT_SCADA_SUPABASE_URL));
}

function getScadaSupabaseAnonKey() {
  return getEnv("SCADA_SUPABASE_ANON_KEY", DEFAULT_SCADA_SUPABASE_ANON_KEY);
}

function getScadaReportTable() {
  return getEnv("SCADA_REPORT_TABLE", DEFAULT_SCADA_REPORT_TABLE);
}

function getScadaAuthTable() {
  return getEnv("SCADA_AUTH_TABLE", DEFAULT_SCADA_AUTH_TABLE);
}

function getScadaAuthRowId() {
  return getEnv("SCADA_AUTH_ROW_ID", DEFAULT_SCADA_AUTH_ROW_ID);
}

function getDefaultReportFileName() {
  return getEnv("SCADA_DEFAULT_REPORT_FILE_NAME", DEFAULT_SCADA_REPORT_FILE_NAME);
}

function getPlantSupabaseUrl() {
  return trimTrailingSlash(getEnv("TD_PLANT_SUPABASE_URL", DEFAULT_PLANT_SUPABASE_URL));
}

function getPlantSupabaseAnonKey() {
  return getEnv("TD_PLANT_SUPABASE_ANON_KEY", DEFAULT_PLANT_SUPABASE_ANON_KEY);
}

function getPlantCurrentTable() {
  return getEnv("TD_PLANT_CURRENT_TABLE", DEFAULT_PLANT_CURRENT_TABLE);
}

function getPlantHistoryTable() {
  return getEnv("TD_PLANT_HISTORY_TABLE", DEFAULT_PLANT_HISTORY_TABLE);
}

function isScadaConfigured() {
  return !!(getScadaSupabaseUrl() && getScadaSupabaseAnonKey());
}

function isPlantConfigured() {
  return !!(getPlantSupabaseUrl() && getPlantSupabaseAnonKey());
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch (_err) {
    return null;
  }
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text().catch(() => "");
  return {
    res,
    ok: res.ok,
    status: res.status,
    text,
    json: safeJsonParse(text)
  };
}

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.json(payload);
}

function sendMethodNotAllowed(res, allow) {
  res.setHeader("Allow", allow);
  return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
}

function handleOptions(req, res, allow) {
  if (req.method !== "OPTIONS") return false;
  res.status(204);
  res.setHeader("Allow", allow);
  res.setHeader("Cache-Control", "no-store");
  res.end();
  return true;
}

function scadaHeaders(extra) {
  return Object.assign(
    {
      apikey: getScadaSupabaseAnonKey(),
      Authorization: "Bearer " + getScadaSupabaseAnonKey(),
      Accept: "application/json",
      "Cache-Control": "no-cache"
    },
    extra || {}
  );
}

function plantHeaders(extra) {
  return Object.assign(
    {
      apikey: getPlantSupabaseAnonKey(),
      Authorization: "Bearer " + getPlantSupabaseAnonKey(),
      Accept: "application/json",
      "Cache-Control": "no-cache"
    },
    extra || {}
  );
}

function buildScadaRestUrl(pathAndQuery) {
  return getScadaSupabaseUrl() + "/rest/v1/" + String(pathAndQuery || "");
}

function buildPlantRestUrl(pathAndQuery) {
  return getPlantSupabaseUrl() + "/rest/v1/" + String(pathAndQuery || "");
}

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) return safeJsonParse(req.body);
  return null;
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

function splitCsvParam(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => trim(item))
    .filter(Boolean);
}

function buildSupabaseInFilter(items) {
  return items.join(",");
}

module.exports = {
  buildPlantRestUrl,
  buildScadaRestUrl,
  buildSupabaseInFilter,
  fetchJson,
  getDefaultReportFileName,
  getPlantCurrentTable,
  getPlantHistoryTable,
  getPlantSupabaseAnonKey,
  getPlantSupabaseUrl,
  getScadaAuthRowId,
  getScadaAuthTable,
  getScadaReportTable,
  handleOptions,
  isPlantConfigured,
  isScadaConfigured,
  plantHeaders,
  readJsonBody,
  safeEqualString,
  scadaHeaders,
  sendJson,
  sendMethodNotAllowed,
  sha256Hex,
  splitCsvParam,
  trim
};
