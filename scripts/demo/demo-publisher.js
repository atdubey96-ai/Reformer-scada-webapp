#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const WEBAPP_DIR = path.join(ROOT_DIR, "webapp");
const DEMO_WORKBOOK_PATH = path.join(WEBAPP_DIR, "Data_website_demo.xlsx");
const WORKBOOK_GENERATOR_PATH = path.join(__dirname, "generate_demo_workbook.py");
const STATE_PATH = process.env.SCADA_DEMO_STATE_FILE || "/tmp/scada-demo-publisher-state.json";
const INTERVAL_MS = Math.max(60000, Number(process.env.SCADA_DEMO_INTERVAL_MS || (5 * 60 * 1000)));
const HISTORY_WINDOW_MS = 60 * 60 * 1000;
const DEMO_TAG_PREFIX = process.env.SCADA_DEMO_TAG_PREFIX || "DEMO__";
const SUPABASE_URL = process.env.SCADA_DEMO_SUPABASE_URL || "https://mozuuowwdfyqqvpiyetk.supabase.co";
const SUPABASE_KEY = process.env.SCADA_DEMO_SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1venV1b3d3ZGZ5cXF2cGl5ZXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MTU3NjksImV4cCI6MjA5MDE5MTc2OX0.SqSAoPwxgPi6cVrYeIQC8xBebbVINZEaPw-odWdqUPo";
const CURRENT_TABLE = process.env.SCADA_DEMO_CURRENT_TABLE || "plant_data";
const HISTORY_TABLE = process.env.SCADA_DEMO_HISTORY_TABLE || "plant_data_history";
const REPORTS_SUPABASE_URL = process.env.SCADA_DEMO_REPORTS_URL || "https://xqkbrlcdbgykmatzwvct.supabase.co";
const REPORTS_SUPABASE_KEY = process.env.SCADA_DEMO_REPORTS_KEY || "sb_publishable_L99JfiV_68w79GJ10klTCg_R1H60L_D";
const REPORTS_TABLE = process.env.SCADA_DEMO_REPORTS_TABLE || "scada_reports";
const DEMO_CURRENT_REPORT_FILE_NAME = process.env.SCADA_DEMO_CURRENT_FILE || "SCADA_DEMO_CURRENT.json";
const DEMO_HISTORY_REPORT_FILE_NAME = process.env.SCADA_DEMO_HISTORY_FILE || "SCADA_DEMO_HISTORY.json";
const RUN_ONCE = process.argv.includes("--once");
const SKIP_WORKBOOK = process.env.SCADA_DEMO_SKIP_WORKBOOK === "1";

const TAGS = [
  { tagId: "GJA.2041fic2405.pv", label: "Feed Flow Mixing Point", unit: "Nm3/h", sheetCell: "H4", fallbackValue: 19479.43 },
  { tagId: "GJA.2041ti2501.pv", label: "AB Side COT", unit: "degC", sheetCell: "H5", fallbackValue: 838.42 },
  { tagId: "GJA.2041ti2502.pv", label: "CD Side COT", unit: "degC", sheetCell: "H6", fallbackValue: 828.99 },
  { tagId: "GJA.2041ti2408.pv", label: "Flue Gas Temp", unit: "degC", sheetCell: "H7", fallbackValue: 911.8 },
  { tagId: "GJA.2041tic2411.pv", label: "Pre-reformer Inlet", unit: "degC", sheetCell: "H8", fallbackValue: 447.32 },
  { tagId: "GJA.2041ti2412.pv", label: "Pre-reformer Outlet", unit: "degC", sheetCell: "H9", fallbackValue: 485.7 },
  { tagId: "GJA.2041fic2904.pv", label: "PSA-1 Off Gas", unit: "Nm3/h", sheetCell: "H10", fallbackValue: 33014.14 },
  { tagId: "GJA.2041fic3009.pv", label: "PSA-2 Off Gas", unit: "Nm3/h", sheetCell: "H11", fallbackValue: 0 },
  { tagId: "GJA.2041fic6303a.pv", label: "Naphtha Fuel", unit: "kg/h", sheetCell: "H12", fallbackValue: 1207.42 },
  { tagId: "GJA.2041pi2507a.pv", label: "Naphtha Tip Pressure", unit: "kg/cm2", sheetCell: "H13", fallbackValue: 0.37 },
  { tagId: "GJA.2041pi2504a.pv", label: "Natural Gas Tip Pressure", unit: "kg/cm2", sheetCell: "H14", fallbackValue: 0.38 },
  { tagId: "GJA.2041pi2501a.pv", label: "PSA-1 Off Gas Tip Pressure", unit: "kg/cm2", sheetCell: "H15", fallbackValue: 0.06 },
  { tagId: "GJA.2041ai2401.pv", label: "Excess O2", unit: "%Vol", sheetCell: "H16", fallbackValue: 6.36 },
  { tagId: "GJA.2041ai2601.pv", label: "Methane Slip", unit: "%Vol", sheetCell: "H17", fallbackValue: 3.36 }
];

function log(message) {
  const stamp = new Date().toISOString();
  console.log("[demo-publisher]", stamp, message);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hashString(input) {
  const text = String(input || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const token = String(value).trim().replace(/,/g, "");
  if (!token) return null;
  const numeric = Number(token);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildHeaders(extraHeaders) {
  return Object.assign({
    apikey: SUPABASE_KEY,
    Authorization: "Bearer " + SUPABASE_KEY,
    Accept: "application/json",
    "Content-Type": "application/json"
  }, extraHeaders || {});
}

function buildReportHeaders(extraHeaders) {
  return Object.assign({
    apikey: REPORTS_SUPABASE_KEY,
    Authorization: "Bearer " + REPORTS_SUPABASE_KEY,
    Accept: "application/json",
    "Content-Type": "application/json"
  }, extraHeaders || {});
}

function requestJson(method, urlString, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: url.pathname + url.search,
      method,
      headers: headers || {}
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (_err) {
          parsed = null;
        }
        resolve({
          statusCode: response.statusCode || 0,
          headers: response.headers || {},
          text: raw,
          json: parsed
        });
      });
    });
    request.on("error", reject);
    if (body !== undefined && body !== null) {
      request.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    request.end();
  });
}

function collectLatestRows(rows) {
  const latest = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row || !row.tag_id) return;
    const tagId = String(row.tag_id).trim();
    if (!tagId || latest.has(tagId)) return;
    latest.set(tagId, row);
  });
  return latest;
}

async function fetchLiveLatestRows() {
  const wantedTags = TAGS.map((tag) => tag.tagId).join(",");
  const url = SUPABASE_URL + "/rest/v1/" + CURRENT_TABLE
    + "?select=tag_id,label,value,unit,synced_at,pushed_at"
    + "&tag_id=in.(" + wantedTags + ")"
    + "&order=synced_at.desc"
    + "&limit=200";
  const result = await requestJson("GET", url, buildHeaders({ "Cache-Control": "no-cache" }));
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error("Live baseline fetch failed with HTTP " + result.statusCode);
  }
  return collectLatestRows(result.json || []);
}

function defaultBaselineMap() {
  const baseline = {};
  TAGS.forEach((tag) => {
    baseline[tag.tagId] = tag.fallbackValue;
  });
  return baseline;
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function buildBaseline(stateBaseline, latestLiveRows) {
  const baseline = defaultBaselineMap();
  if (stateBaseline && typeof stateBaseline === "object") {
    Object.keys(stateBaseline).forEach((tagId) => {
      const numeric = toNumber(stateBaseline[tagId]);
      if (numeric !== null) baseline[tagId] = numeric;
    });
  }
  TAGS.forEach((tag) => {
    const liveRow = latestLiveRows && latestLiveRows.get ? latestLiveRows.get(tag.tagId) : null;
    const numeric = toNumber(liveRow && liveRow.value);
    if (numeric !== null && !(stateBaseline && Object.prototype.hasOwnProperty.call(stateBaseline, tag.tagId))) {
      baseline[tag.tagId] = numeric;
    }
  });
  return baseline;
}

function getVariationRange(baseValue) {
  if (!Number.isFinite(baseValue)) return { min: 0, max: 0 };
  if (Math.abs(baseValue) < 1) {
    return { min: Math.max(0, baseValue - 0.05), max: baseValue + 0.05 };
  }
  return {
    min: Math.max(0, baseValue * 0.95),
    max: baseValue * 1.05
  };
}

function computeNextValue(tag, baseValue, previousValue, sequenceIndex) {
  const safeBase = Number.isFinite(baseValue) ? baseValue : tag.fallbackValue;
  const safePrevious = Number.isFinite(previousValue) ? previousValue : safeBase;
  const seed = hashString(tag.tagId);
  const waveA = Math.sin((sequenceIndex + (seed % 13)) / 2.6);
  const waveB = Math.cos((sequenceIndex + (seed % 29)) / 4.9);
  const micro = ((((seed >>> 3) + (sequenceIndex * 97)) % 1000) / 1000) - 0.5;
  const targetRatio = clamp((waveA * 0.028) + (waveB * 0.014) + (micro * 0.008), -0.05, 0.05);
  const target = safeBase * (1 + targetRatio);
  const smoothed = safePrevious + ((target - safePrevious) * 0.44);
  const nudged = smoothed + (safeBase * micro * 0.0015);
  const limits = getVariationRange(safeBase);
  return Number(clamp(nudged, limits.min, limits.max).toFixed(2));
}

function buildSnapshotSequence(baseline, previous, startSequence, count) {
  const snapshots = [];
  let rollingPrevious = Object.assign({}, previous || baseline);
  for (let index = 0; index < count; index += 1) {
    const sequenceIndex = startSequence + index;
    const snapshot = {};
    TAGS.forEach((tag) => {
      const nextValue = computeNextValue(
        tag,
        toNumber(baseline[tag.tagId]),
        toNumber(rollingPrevious[tag.tagId]),
        sequenceIndex
      );
      snapshot[tag.tagId] = nextValue;
      rollingPrevious[tag.tagId] = nextValue;
    });
    snapshots.push(snapshot);
  }
  return snapshots;
}

function buildCurrentRows(snapshot, isoTimestamp) {
  return TAGS.map((tag) => ({
    tag_id: DEMO_TAG_PREFIX + tag.tagId,
    label: "Demo " + tag.label,
    value: snapshot[tag.tagId],
    unit: tag.unit,
    synced_at: isoTimestamp,
    pushed_at: isoTimestamp
  }));
}

function buildHistoryRows(snapshot, isoTimestamp) {
  return TAGS.map((tag) => ({
    tag_id: DEMO_TAG_PREFIX + tag.tagId,
    label: "Demo " + tag.label,
    value: snapshot[tag.tagId],
    recorded_at: isoTimestamp
  }));
}

async function upsertCurrentRows(rows) {
  const upsertUrl = SUPABASE_URL + "/rest/v1/" + CURRENT_TABLE + "?on_conflict=tag_id";
  const upsertHeaders = buildHeaders({
    Prefer: "resolution=merge-duplicates,return=representation",
    "Cache-Control": "no-cache"
  });
  const upsertResult = await requestJson("POST", upsertUrl, upsertHeaders, rows);
  if (upsertResult.statusCode >= 200 && upsertResult.statusCode < 300) {
    return;
  }
  const insertUrl = SUPABASE_URL + "/rest/v1/" + CURRENT_TABLE;
  const insertHeaders = buildHeaders({
    Prefer: "return=representation",
    "Cache-Control": "no-cache"
  });
  const insertResult = await requestJson("POST", insertUrl, insertHeaders, rows);
  if (insertResult.statusCode < 200 || insertResult.statusCode >= 300) {
    throw new Error("Current demo write failed with HTTP " + insertResult.statusCode + ": " + (insertResult.text || "unknown error"));
  }
}

async function insertHistoryRows(rows) {
  const url = SUPABASE_URL + "/rest/v1/" + HISTORY_TABLE;
  const result = await requestJson("POST", url, buildHeaders({
    Prefer: "return=minimal",
    "Cache-Control": "no-cache"
  }), rows);
  if (result.statusCode >= 200 && result.statusCode < 300) {
    return true;
  }
  log("History insert skipped: HTTP " + result.statusCode + " " + (result.text || "").slice(0, 180));
  return false;
}

function trimHistoryRows(rows, cutoffMs) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const recordedAt = Date.parse(row && row.recorded_at ? row.recorded_at : "");
    return Number.isFinite(recordedAt) && recordedAt >= cutoffMs;
  });
}

async function writeDemoReportBlob(fileName, payload) {
  const url = REPORTS_SUPABASE_URL + "/rest/v1/" + REPORTS_TABLE;
  const body = {
    file_name: fileName,
    data_base64: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
    uploaded_by: "DEMO_PUBLISHER"
  };
  const result = await requestJson("POST", url, buildReportHeaders({
    Prefer: "return=representation",
    "Cache-Control": "no-cache"
  }), body);
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error("Demo report write failed with HTTP " + result.statusCode + ": " + (result.text || "unknown error"));
  }
}

function ensureDemoWorkbook() {
  if (fs.existsSync(DEMO_WORKBOOK_PATH)) return;
  const generated = spawnSync("python3", [WORKBOOK_GENERATOR_PATH], {
    cwd: ROOT_DIR,
    encoding: "utf8"
  });
  if (generated.status !== 0) {
    throw new Error((generated.stderr || generated.stdout || "Could not generate demo workbook").trim());
  }
  if (!fs.existsSync(DEMO_WORKBOOK_PATH)) {
    throw new Error("Demo workbook was not created: " + DEMO_WORKBOOK_PATH);
  }
}

function appleScriptString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function openWorkbookInExcel() {
  const result = spawnSync("open", ["-a", "Microsoft Excel", DEMO_WORKBOOK_PATH], {
    cwd: ROOT_DIR,
    stdio: "ignore"
  });
  if (result.status === 0) return;
  spawnSync("open", [DEMO_WORKBOOK_PATH], {
    cwd: ROOT_DIR,
    stdio: "ignore"
  });
}

function updateWorkbook(snapshot) {
  if (SKIP_WORKBOOK) return;
  if (process.platform !== "darwin") return;
  ensureDemoWorkbook();
  openWorkbookInExcel();
  const workbookName = path.basename(DEMO_WORKBOOK_PATH);
  const assignments = TAGS.map((tag) => {
    return 'set value of range "' + tag.sheetCell + '" of targetSheet to ' + Number(snapshot[tag.tagId] || 0).toFixed(2);
  }).join("\n");
  const script = [
    'tell application "Microsoft Excel"',
    "activate",
    "repeat 10 times",
    'if (exists workbook "' + appleScriptString(workbookName) + '") then exit repeat',
    "delay 0.5",
    "end repeat",
    'if not (exists workbook "' + appleScriptString(workbookName) + '") then error "Workbook is not open: ' + appleScriptString(workbookName) + '"',
    'set targetBook to workbook "' + appleScriptString(workbookName) + '"',
    "set targetSheet to worksheet 1 of targetBook",
    "set nowValue to current date",
    'set value of range "D1" of targetSheet to nowValue',
    'set value of range "E1" of targetSheet to nowValue',
    'set value of range "H3" of targetSheet to nowValue',
    assignments,
    "save workbook targetBook",
    "end tell"
  ].join("\n");
  const result = spawnSync("osascript", ["-"], {
    cwd: ROOT_DIR,
    input: script,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    log("Workbook update warning: " + (result.stderr || result.stdout || "AppleScript failed").trim());
  }
}

async function runCycle() {
  ensureDemoWorkbook();
  const state = loadState();
  let latestLiveRows = null;
  try {
    latestLiveRows = await fetchLiveLatestRows();
  } catch (error) {
    log("Live baseline fetch warning: " + (error && error.message ? error.message : String(error)));
  }

  const baseline = buildBaseline(state.baseline, latestLiveRows);
  const previous = state.previous && typeof state.previous === "object" ? state.previous : baseline;
  const sequence = Number.isFinite(state.sequence) ? state.sequence : 0;
  const historyPointCount = Math.max(3, Math.round(HISTORY_WINDOW_MS / INTERVAL_MS) + 1);
  const firstRun = !state.previous;
  const snapshots = buildSnapshotSequence(
    baseline,
    previous,
    firstRun ? (sequence - historyPointCount + 1) : sequence,
    firstRun ? historyPointCount : 1
  );
  const currentSnapshot = snapshots[snapshots.length - 1];
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const historyRows = [];
  if (firstRun) {
    snapshots.forEach((snapshot, index) => {
      const millisAgo = (snapshots.length - 1 - index) * INTERVAL_MS;
      const isoTimestamp = new Date(now - millisAgo).toISOString();
      historyRows.push.apply(historyRows, buildHistoryRows(snapshot, isoTimestamp));
    });
  } else {
    historyRows.push.apply(historyRows, buildHistoryRows(currentSnapshot, nowIso));
  }
  const currentRows = buildCurrentRows(currentSnapshot, nowIso);
  const rollingHistoryRows = trimHistoryRows(
    (Array.isArray(state.historyRows) ? state.historyRows : []).concat(historyRows),
    now - HISTORY_WINDOW_MS
  );

  try {
    await upsertCurrentRows(currentRows);
    await insertHistoryRows(historyRows);
  } catch (error) {
    log("Plant-table demo publish skipped: " + (error && error.message ? error.message : String(error)));
  }

  await writeDemoReportBlob(DEMO_CURRENT_REPORT_FILE_NAME, {
    generated_at: nowIso,
    source: "demo-publisher",
    rows: currentRows
  });
  await writeDemoReportBlob(DEMO_HISTORY_REPORT_FILE_NAME, {
    generated_at: nowIso,
    source: "demo-publisher",
    rows: rollingHistoryRows
  });
  updateWorkbook(currentSnapshot);

  saveState({
    baseline,
    previous: currentSnapshot,
    sequence: sequence + 1,
    historyRows: rollingHistoryRows,
    lastRunAt: nowIso
  });

  const sampleTag = TAGS[0];
  log("Published demo snapshot. " + sampleTag.label + " = " + currentSnapshot[sampleTag.tagId]);
}

async function main() {
  await runCycle();
  if (RUN_ONCE) return;
  let running = false;
  setInterval(async () => {
    if (running) {
      log("Previous cycle still running, skipping this interval.");
      return;
    }
    running = true;
    try {
      await runCycle();
    } catch (error) {
      log("Cycle failed: " + (error && error.message ? error.message : String(error)));
    } finally {
      running = false;
    }
  }, INTERVAL_MS);
  log("Demo publisher will keep updating every " + Math.round(INTERVAL_MS / 60000) + " minute(s).");
}

main().catch((error) => {
  log("Fatal error: " + (error && error.message ? error.message : String(error)));
  process.exit(1);
});
