const SERVICE_NAME = "scada-relay";
const DEFAULT_PLANT_SUPABASE_URL = "https://mozuuowwdfyqqvpiyetk.supabase.co";
const DEFAULT_PLANT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1venV1b3d3ZGZ5cXF2cGl5ZXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MTU3NjksImV4cCI6MjA5MDE5MTc2OX0.SqSAoPwxgPi6cVrYeIQC8xBebbVINZEaPw-odWdqUPo";
const DEFAULT_PLANT_CURRENT_TABLE = "plant_data";
const LIVE_HISTORY_REPORT_FILE_NAME = "SCADA_LIVE_PLANT_HISTORY.json";
const LIVE_HISTORY_BUCKET_MS = 15 * 60 * 1000;
const LIVE_HISTORY_RETENTION_MS = (8 * 60 * 60 * 1000) + LIVE_HISTORY_BUCKET_MS;
const LIVE_HISTORY_TAGS = [
  "GJA.2041fic2405.pv",
  "GJA.2041ti2501.pv",
  "GJA.2041ti2502.pv",
  "GJA.2041ti2408.pv",
  "GJA.2041ai2401.pv",
  "GJA.2041ai2601.pv",
  "GJA.2041fic2904.pv",
  "GJA.2041fic3009.pv",
  "GJA.2041fic6303a.pv",
  "GJA.2041pi2501a.pv",
  "GJA.2041pi2504a.pv",
  "GJA.2041pi2507a.pv",
  "GJA.2041tic2411.pv",
  "GJA.2041ti2412.pv"
];

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    try {
      var url = new URL(request.url);
      var path = url.pathname.replace(/\/+$/, "") || "/";
      var method = request.method.toUpperCase();

      if (method === "GET" && path === "/") {
        return json(
          {
            ok: true,
            service: SERVICE_NAME,
            endpoints: ["/health", "/scada/auth", "/scada/report/latest", "/scada/report", "/scada/tst/ocr", "/scada/live-history/snapshot"]
          },
          200
        );
      }

      if (method === "GET" && path === "/health") {
        var sbConfigured = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
        var azureConfigured = isAzureDocIntelConfigured(env);
        return json(
          {
            ok: true,
            service: SERVICE_NAME,
            configured: sbConfigured,
            supabase_configured: sbConfigured,
            azure_docintel_configured: azureConfigured
          },
          200
        );
      }

      if (!allowRelayRequest(request, env)) {
        return json({ error: "unauthorized" }, 401);
      }

      if (path === "/scada/tst/ocr" && method === "POST") {
        return await handleTstOcr(request, env);
      }

      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        return json({ error: "relay_not_configured" }, 500);
      }

      if (path === "/scada/auth" && method === "GET") {
        return await handleAuth(env);
      }

      if (path === "/scada/report/latest" && method === "GET") {
        return await handleLatestReport(env);
      }

      if (path === "/scada/report" && (method === "POST" || method === "PUT")) {
        var payload = await request.json().catch(function () {
          return null;
        });
        return await handleWriteReport(env, payload);
      }

      if (path === "/scada/live-history/snapshot" && (method === "GET" || method === "POST")) {
        return await handleLiveHistorySnapshot(env);
      }

      return json({ error: "not_found" }, 404);
    } catch (err) {
      return json(
        {
          error: "relay_error",
          message: String((err && err.message) || err || "unknown")
        },
        502
      );
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledLiveHistorySnapshot(env, event));
  }
};

var AZURE_DOCINTEL_DEFAULT_MODEL_ID = "prebuilt-layout";
var AZURE_DOCINTEL_DEFAULT_API_VERSION = "2024-11-30";
var AZURE_DOCINTEL_DEFAULT_FEATURES = "ocrHighResolution";
var AZURE_DOCINTEL_DEFAULT_OUTPUT_FORMAT = "text";
var AZURE_DOCINTEL_POLL_MAX_TRIES = 16;
var AZURE_DOCINTEL_POLL_DELAY_MS = 1200;

function allowRelayRequest(request, env) {
  var expected = String(env.RELAY_KEY || "").trim();
  if (!expected) return true;
  var got = String(request.headers.get("x-scada-relay-key") || "").trim();
  return !!got && got === expected;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function isAzureDocIntelConfigured(env) {
  return !!(String(env.AZURE_DOCINTEL_ENDPOINT || "").trim() && String(env.AZURE_DOCINTEL_KEY || "").trim());
}

function getAzureDocIntelEndpoint(env) {
  var endpoint = trimTrailingSlash(env.AZURE_DOCINTEL_ENDPOINT || "");
  endpoint = endpoint.replace(/\/documentintelligence$/i, "");
  return endpoint;
}

function getAzureDocIntelKey(env) {
  return String(env.AZURE_DOCINTEL_KEY || "").trim();
}

function getAzureDocIntelModelId(env) {
  return String(env.AZURE_DOCINTEL_MODEL_ID || AZURE_DOCINTEL_DEFAULT_MODEL_ID).trim() || AZURE_DOCINTEL_DEFAULT_MODEL_ID;
}

function getAzureDocIntelApiVersion(env) {
  return String(env.AZURE_DOCINTEL_API_VERSION || AZURE_DOCINTEL_DEFAULT_API_VERSION).trim() || AZURE_DOCINTEL_DEFAULT_API_VERSION;
}

function getAzureDocIntelFeatures(env) {
  return String(env.AZURE_DOCINTEL_FEATURES || AZURE_DOCINTEL_DEFAULT_FEATURES).trim();
}

function getAzureDocIntelOutputFormat(env) {
  return String(env.AZURE_DOCINTEL_OUTPUT_CONTENT_FORMAT || AZURE_DOCINTEL_DEFAULT_OUTPUT_FORMAT).trim() || AZURE_DOCINTEL_DEFAULT_OUTPUT_FORMAT;
}

function getAzureDocIntelLocale(env) {
  return String(env.AZURE_DOCINTEL_LOCALE || "").trim();
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch (_err) {
    return null;
  }
}

function trimTrailingPlantSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function getPlantSupabaseUrl(env) {
  return trimTrailingPlantSlash(
    env.PLANT_SUPABASE_URL ||
    env.TD_PLANT_SUPABASE_URL ||
    DEFAULT_PLANT_SUPABASE_URL
  );
}

function getPlantSupabaseAnonKey(env) {
  return String(
    env.PLANT_SUPABASE_ANON_KEY ||
    env.TD_PLANT_SUPABASE_ANON_KEY ||
    DEFAULT_PLANT_SUPABASE_ANON_KEY
  ).trim();
}

function getPlantCurrentTable(env) {
  return String(
    env.PLANT_CURRENT_TABLE ||
    env.TD_PLANT_CURRENT_TABLE ||
    DEFAULT_PLANT_CURRENT_TABLE
  ).trim();
}

function plantHeaders(env, extra) {
  var key = getPlantSupabaseAnonKey(env);
  return Object.assign(
    {
      apikey: key,
      Authorization: "Bearer " + key,
      Accept: "application/json",
      "Cache-Control": "no-cache"
    },
    extra || {}
  );
}

function buildSupabaseInFilter(items) {
  return (Array.isArray(items) ? items : []).join(",");
}

function utf8ToBase64(value) {
  var bytes = new TextEncoder().encode(String(value || ""));
  var binary = "";
  for (var i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUtf8(value) {
  var binary = atob(String(value || ""));
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function decodeBase64Json(raw) {
  try {
    return safeJsonParse(base64ToUtf8(raw));
  } catch (_err) {
    return null;
  }
}

function encodeBase64Json(value) {
  return utf8ToBase64(JSON.stringify(value || {}));
}

function collectLatestRows(rows) {
  var latest = new Map();
  (Array.isArray(rows) ? rows : []).forEach(function (row) {
    if (!row || !row.tag_id) return;
    var tagId = String(row.tag_id).trim();
    if (!tagId || latest.has(tagId)) return;
    latest.set(tagId, row);
  });
  return latest;
}

function getLiveHistoryBucketStart(dateLike) {
  var dt = dateLike ? new Date(dateLike) : new Date();
  var ms = dt.getTime();
  if (!isFinite(ms)) ms = Date.now();
  return new Date(Math.floor(ms / LIVE_HISTORY_BUCKET_MS) * LIVE_HISTORY_BUCKET_MS);
}

function trimLiveHistoryRows(rows) {
  var cutoff = Date.now() - LIVE_HISTORY_RETENTION_MS;
  return (Array.isArray(rows) ? rows : []).filter(function (row) {
    var ms = Date.parse(row && row.recorded_at ? row.recorded_at : "");
    return isFinite(ms) && ms >= cutoff;
  });
}

async function fetchPlantCurrentRowsForHistory(env) {
  var baseUrl = getPlantSupabaseUrl(env) + "/rest/v1/" + encodeURIComponent(getPlantCurrentTable(env));
  var filterQuery = "&tag_id=in.(" + buildSupabaseInFilter(LIVE_HISTORY_TAGS) + ")&order=synced_at.desc&limit=200";
  var out = await fetch(
    baseUrl + "?select=tag_id,label,value,unit,synced_at,pushed_at" + filterQuery,
    { method: "GET", headers: plantHeaders(env) }
  );
  var body = await readResponseJsonOrText(out);
  if (!out.ok) {
    var msg = String((body.json && (body.json.message || body.json.error || body.json.hint)) || "").toLowerCase();
    if (out.status === 400 && msg.indexOf("pushed_at") !== -1) {
      out = await fetch(
        baseUrl + "?select=tag_id,label,value,unit,synced_at" + filterQuery,
        { method: "GET", headers: plantHeaders(env) }
      );
      body = await readResponseJsonOrText(out);
    }
  }
  if (!out.ok) {
    throw new Error("plant_current_fetch_failed:" + out.status);
  }
  var rows = Array.isArray(body.json) ? body.json : [];
  return Array.from(collectLatestRows(rows).values()).map(function (row) {
    return Object.assign({}, row, {
      pushed_at: row && (row.pushed_at || row.synced_at) ? (row.pushed_at || row.synced_at) : null
    });
  });
}

async function fetchLatestNamedReport(env, fileName) {
  var u =
    String(env.SUPABASE_URL).replace(/\/+$/, "") +
    "/rest/v1/" +
    sbTable(env) +
    "?select=file_name,data_base64,created_at,uploaded_by&file_name=eq." +
    encodeURIComponent(String(fileName || "")) +
    "&order=created_at.desc&limit=1";
  var res = await fetch(u, { method: "GET", headers: sbHeaders(env) });
  if (!res.ok) return null;
  var arr = await res.json().catch(function () { return []; });
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

async function writeNamedReport(env, fileName, payload, uploadedBy) {
  return await handleWriteReport(env, {
    file_name: fileName,
    data_base64: encodeBase64Json(payload),
    uploaded_by: uploadedBy || "CLOUDFLARE_CRON"
  });
}

async function buildAndStoreLiveHistorySnapshot(env) {
  var currentRows = await fetchPlantCurrentRowsForHistory(env);
  var bucketStart = getLiveHistoryBucketStart(new Date());
  var bucketStartIso = bucketStart.toISOString();
  var existingReport = await fetchLatestNamedReport(env, LIVE_HISTORY_REPORT_FILE_NAME);
  var existingPayload = decodeBase64Json(existingReport && existingReport.data_base64) || {};
  var existingRows = trimLiveHistoryRows(existingPayload.rows || []);
  var byBucketTag = new Map();

  existingRows.forEach(function (row) {
    var key = String((row && row.recorded_at) || "") + "::" + String((row && row.tag_id) || "");
    byBucketTag.set(key, row);
  });

  currentRows.forEach(function (row) {
    var tagId = String(row && row.tag_id || "").trim();
    if (!tagId) return;
    byBucketTag.set(bucketStartIso + "::" + tagId, {
      tag_id: tagId,
      label: row.label || tagId,
      value: row.value,
      recorded_at: bucketStartIso
    });
  });

  var mergedRows = trimLiveHistoryRows(Array.from(byBucketTag.values()).sort(function (a, b) {
    return Date.parse(a.recorded_at || "") - Date.parse(b.recorded_at || "");
  }));

  var reportPayload = {
    file_name: LIVE_HISTORY_REPORT_FILE_NAME,
    generated_at: new Date().toISOString(),
    bucket_ms: LIVE_HISTORY_BUCKET_MS,
    retention_ms: LIVE_HISTORY_RETENTION_MS,
    rows: mergedRows
  };

  var writeResponse = await writeNamedReport(env, LIVE_HISTORY_REPORT_FILE_NAME, reportPayload, "CLOUDFLARE_CRON");
  if (!writeResponse || !writeResponse.ok) {
    throw new Error("live_history_report_write_failed");
  }

  return {
    ok: true,
    bucket_start: bucketStartIso,
    current_rows: currentRows.length,
    stored_rows: mergedRows.length
  };
}

async function handleLiveHistorySnapshot(env) {
  try {
    var result = await buildAndStoreLiveHistorySnapshot(env);
    return json(result, 200);
  } catch (err) {
    return json(
      {
        ok: false,
        error: "live_history_snapshot_failed",
        message: String((err && err.message) || err || "unknown")
      },
      502
    );
  }
}

async function runScheduledLiveHistorySnapshot(env, event) {
  try {
    await buildAndStoreLiveHistorySnapshot(env);
  } catch (err) {
    console.error("scheduled live history snapshot failed", String((err && err.message) || err || "unknown"), event && event.cron);
  }
}

async function readResponseJsonOrText(response) {
  var text = await response.text().catch(function () {
    return "";
  });
  var jsonBody = safeJsonParse(text);
  return { text: text, json: jsonBody };
}

function pickFirstNonEmptyString(items) {
  for (var i = 0; i < items.length; i++) {
    if (typeof items[i] === "string" && items[i].trim()) return items[i].trim();
  }
  return "";
}

function flattenAzureDocIntelText(result) {
  if (!result || typeof result !== "object") return "";
  var analyze = result.analyzeResult && typeof result.analyzeResult === "object" ? result.analyzeResult : result;
  var direct = pickFirstNonEmptyString([analyze.content, result.content]);
  if (direct) return direct;

  var parts = [];
  var pages = Array.isArray(analyze.pages) ? analyze.pages : [];
  for (var pi = 0; pi < pages.length; pi++) {
    var page = pages[pi];
    var lines = Array.isArray(page && page.lines) ? page.lines : [];
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      var content = pickFirstNonEmptyString([line && line.content, line && line.text]);
      if (content) parts.push(content);
    }
  }

  if (!parts.length && Array.isArray(analyze.paragraphs)) {
    for (var i = 0; i < analyze.paragraphs.length; i++) {
      var para = analyze.paragraphs[i];
      var paraText = pickFirstNonEmptyString([para && para.content, para && para.text]);
      if (paraText) parts.push(paraText);
    }
  }

  return parts.join("\n").trim();
}

function summarizeAzureDocIntelResult(result, modelId) {
  var analyze = result && result.analyzeResult && typeof result.analyzeResult === "object" ? result.analyzeResult : {};
  return {
    provider: "azure-document-intelligence",
    model_id: modelId,
    status: String(result && result.status || "unknown"),
    page_count: Array.isArray(analyze.pages) ? analyze.pages.length : 0,
    table_count: Array.isArray(analyze.tables) ? analyze.tables.length : 0,
    content_length: String(analyze.content || "").length
  };
}

function createEmptyTstValueArray() {
  var values = [];
  for (var i = 0; i < 60; i++) values.push("");
  return values;
}

function normalizeTstHeaderToken(text) {
  return String(text || "")
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/[^A-Z0-9]+/g, "");
}

function normalizeTstHeaderTokenForMatch(text) {
  return normalizeTstHeaderToken(text)
    .replace(/0/g, "O")
    .replace(/8/g, "B")
    .replace(/1/g, "I")
    .replace(/5/g, "S");
}

function mapTstHeaderCellToKey(text) {
  var norm = normalizeTstHeaderTokenForMatch(text);
  if (!norm) return "";
  if (norm.indexOf("PEEPHOLE") >= 0 || norm === "PH" || norm.indexOf("PEEP") >= 0) return "__row__";
  if (norm.indexOf("ABBOTTOM") >= 0 || norm.indexOf("ABBOT") >= 0) return "ab-bot";
  if (norm.indexOf("CDBOTTOM") >= 0 || norm.indexOf("CDBOT") >= 0 || norm.indexOf("COBOT") >= 0) return "cd-bot";
  if (norm.indexOf("ABTOP") >= 0) return "ab-top";
  if (norm.indexOf("CDTOP") >= 0 || norm.indexOf("COTOP") >= 0) return "cd-top";
  return "";
}

function parseLikelyTstRowNumber(text) {
  var token = String(text || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[OQ]/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5");
  if (!/^\d{1,2}$/.test(token)) return NaN;
  var n = Number(token);
  return isFinite(n) && n >= 1 && n <= 15 ? n : NaN;
}

function parseLikelyTstTemp(text) {
  var token = String(text || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!token) return NaN;
  var digitCount = (token.match(/\d/g) || []).length;
  if (digitCount < 2) return NaN;
  token = token
    .replace(/[OQ]/g, "0")
    .replace(/D/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6");
  if (!/^\d{3,4}$/.test(token)) return NaN;
  var n = Number(token);
  return isFinite(n) && n >= 100 && n <= 1800 ? n : NaN;
}

function setTstValueInArray(values, key, rowNo, value) {
  var offsets = {
    "ab-bot": 0,
    "cd-bot": 15,
    "ab-top": 30,
    "cd-top": 45
  };
  if (!values || !offsets.hasOwnProperty(key)) return;
  if (!(rowNo >= 1 && rowNo <= 15)) return;
  var idx = offsets[key] + (rowNo - 1);
  values[idx] = String(value || "");
}

function countFilledTstValues(values) {
  var count = 0;
  if (!Array.isArray(values)) return 0;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i] || "").trim()) count++;
  }
  return count;
}

function extractTstValuesFromAzureTables(result) {
  var analyze = result && result.analyzeResult && typeof result.analyzeResult === "object" ? result.analyzeResult : null;
  var tables = Array.isArray(analyze && analyze.tables) ? analyze.tables : [];
  var best = null;

  for (var ti = 0; ti < tables.length; ti++) {
    var table = tables[ti];
    var cells = Array.isArray(table && table.cells) ? table.cells : [];
    if (!cells.length) continue;

    var rowMap = {};
    var cellMap = {};
    for (var ci = 0; ci < cells.length; ci++) {
      var cell = cells[ci];
      var rowIndex = Number(cell && cell.rowIndex);
      var colIndex = Number(cell && cell.columnIndex);
      if (!isFinite(rowIndex) || !isFinite(colIndex)) continue;
      if (!rowMap[rowIndex]) rowMap[rowIndex] = [];
      rowMap[rowIndex].push(cell);
      cellMap[rowIndex + ":" + colIndex] = cell;
    }

    var headerRowIndex = -1;
    var headerScore = 0;
    var headerCols = {};
    var rowIndexes = Object.keys(rowMap).map(function (k) {
      return Number(k);
    });

    for (var ri = 0; ri < rowIndexes.length; ri++) {
      var candidateRowIndex = rowIndexes[ri];
      var rowCells = rowMap[candidateRowIndex] || [];
      var candidateCols = {};
      var candidateScore = 0;
      for (var rci = 0; rci < rowCells.length; rci++) {
        var key = mapTstHeaderCellToKey(rowCells[rci] && rowCells[rci].content);
        if (!key) continue;
        if (!candidateCols[key]) {
          candidateCols[key] = Number(rowCells[rci].columnIndex);
          candidateScore++;
        }
      }
      if (candidateScore > headerScore) {
        headerScore = candidateScore;
        headerRowIndex = candidateRowIndex;
        headerCols = candidateCols;
      }
    }

    if (headerRowIndex < 0 || headerScore < 3) continue;

    var rowLabelColumn = isFinite(headerCols.__row__) ? headerCols.__row__ : -1;
    var dataCols = {
      "ab-bot": headerCols["ab-bot"],
      "cd-bot": headerCols["cd-bot"],
      "ab-top": headerCols["ab-top"],
      "cd-top": headerCols["cd-top"]
    };
    var values = createEmptyTstValueArray();

    for (var rj = 0; rj < rowIndexes.length; rj++) {
      var dataRowIndex = rowIndexes[rj];
      if (dataRowIndex === headerRowIndex) continue;

      var peepHole = NaN;
      if (rowLabelColumn >= 0) {
        var labelCell = cellMap[dataRowIndex + ":" + rowLabelColumn];
        peepHole = parseLikelyTstRowNumber(labelCell && labelCell.content);
      }
      if (!isFinite(peepHole)) {
        var candidateCells = rowMap[dataRowIndex] || [];
        for (var cj = 0; cj < candidateCells.length; cj++) {
          var maybeRow = parseLikelyTstRowNumber(candidateCells[cj] && candidateCells[cj].content);
          if (isFinite(maybeRow)) {
            peepHole = maybeRow;
            break;
          }
        }
      }
      if (!isFinite(peepHole)) continue;

      var keys = ["ab-bot", "cd-bot", "ab-top", "cd-top"];
      for (var ki = 0; ki < keys.length; ki++) {
        var mapKey = keys[ki];
        var col = dataCols[mapKey];
        if (!isFinite(col)) continue;
        var dataCell = cellMap[dataRowIndex + ":" + col];
        var temp = parseLikelyTstTemp(dataCell && dataCell.content);
        if (isFinite(temp)) {
          setTstValueInArray(values, mapKey, peepHole, String(Math.round(temp)));
        }
      }
    }

    var filledCount = countFilledTstValues(values);
    if (!best || filledCount > best.filled_count) {
      best = {
        values: values,
        filled_count: filledCount,
        source: "azure-table"
      };
    }
  }

  return best;
}

function medianNumber(values) {
  var nums = [];
  for (var i = 0; i < (Array.isArray(values) ? values.length : 0); i++) {
    var n = Number(values[i]);
    if (isFinite(n)) nums.push(n);
  }
  if (!nums.length) return NaN;
  nums.sort(function (a, b) {
    return a - b;
  });
  var mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function getAzurePolygonBounds(polygon) {
  var pts = [];
  if (Array.isArray(polygon) && polygon.length) {
    if (typeof polygon[0] === "number") {
      for (var i = 0; i + 1 < polygon.length; i += 2) {
        var x = Number(polygon[i]);
        var y = Number(polygon[i + 1]);
        if (isFinite(x) && isFinite(y)) pts.push({ x: x, y: y });
      }
    } else {
      for (var j = 0; j < polygon.length; j++) {
        var pt = polygon[j];
        var px = Number(pt && pt.x);
        var py = Number(pt && pt.y);
        if (isFinite(px) && isFinite(py)) pts.push({ x: px, y: py });
      }
    }
  }
  if (!pts.length) return null;

  var minX = Infinity;
  var maxX = -Infinity;
  var minY = Infinity;
  var maxY = -Infinity;
  for (var k = 0; k < pts.length; k++) {
    minX = Math.min(minX, pts[k].x);
    maxX = Math.max(maxX, pts[k].x);
    minY = Math.min(minY, pts[k].y);
    maxY = Math.max(maxY, pts[k].y);
  }
  if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) return null;
  return {
    minX: minX,
    maxX: maxX,
    minY: minY,
    maxY: maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2
  };
}

function createAzureLayoutItem(node, fallbackText, kind, pageNumber) {
  var text = pickFirstNonEmptyString([node && node.content, node && node.text, fallbackText]);
  if (!text) return null;
  var polygon =
    (node && node.polygon) ||
    (Array.isArray(node && node.boundingRegions) && node.boundingRegions[0] && node.boundingRegions[0].polygon) ||
    null;
  var bounds = getAzurePolygonBounds(polygon);
  if (!bounds) return null;
  return {
    text: text,
    kind: kind || "item",
    pageNumber: Number(pageNumber) || 1,
    confidence: Number(node && node.confidence) || 0,
    minX: bounds.minX,
    maxX: bounds.maxX,
    minY: bounds.minY,
    maxY: bounds.maxY,
    width: bounds.width,
    height: bounds.height,
    cx: bounds.cx,
    cy: bounds.cy
  };
}

function collectAzureLayoutItems(result, sourceKind) {
  var analyze = result && result.analyzeResult && typeof result.analyzeResult === "object" ? result.analyzeResult : null;
  var pages = Array.isArray(analyze && analyze.pages) ? analyze.pages : [];
  var out = [];
  for (var pi = 0; pi < pages.length; pi++) {
    var page = pages[pi];
    var pageNumber = Number(page && page.pageNumber) || pi + 1;
    var nodes = Array.isArray(page && page[sourceKind]) ? page[sourceKind] : [];
    for (var ni = 0; ni < nodes.length; ni++) {
      var item = createAzureLayoutItem(nodes[ni], "", sourceKind, pageNumber);
      if (item) out.push(item);
    }
  }
  return out;
}

function pickBestTstHeaderCluster(items) {
  var candidates = [];
  for (var i = 0; i < (Array.isArray(items) ? items.length : 0); i++) {
    var key = mapTstHeaderCellToKey(items[i] && items[i].text);
    if (!key) continue;
    candidates.push(
      Object.assign(
        {
          headerKey: key
        },
        items[i]
      )
    );
  }
  if (!candidates.length) return null;

  candidates.sort(function (a, b) {
    return a.cy - b.cy;
  });

  var heightMedian = medianNumber(
    candidates.map(function (item) {
      return item.height;
    })
  );
  var mergeThreshold = Math.max(12, (isFinite(heightMedian) ? heightMedian : 18) * 1.35);
  var clusters = [];

  for (var ci = 0; ci < candidates.length; ci++) {
    var cand = candidates[ci];
    var cluster = clusters.length ? clusters[clusters.length - 1] : null;
    if (!cluster || Math.abs(cand.cy - cluster.cy) > mergeThreshold) {
      clusters.push({
        items: [cand],
        cy: cand.cy
      });
      continue;
    }
    cluster.items.push(cand);
    cluster.cy =
      cluster.items.reduce(function (sum, item) {
        return sum + item.cy;
      }, 0) / cluster.items.length;
  }

  var best = null;
  for (var cj = 0; cj < clusters.length; cj++) {
    var group = clusters[cj];
    var map = {};
    var minY = Infinity;
    var maxY = -Infinity;
    var heights = [];
    for (var gi = 0; gi < group.items.length; gi++) {
      var item = group.items[gi];
      minY = Math.min(minY, item.minY);
      maxY = Math.max(maxY, item.maxY);
      heights.push(item.height);
      if (!map[item.headerKey] || item.width > map[item.headerKey].width) {
        map[item.headerKey] = item;
      }
    }
    var uniqueKeys = Object.keys(map);
    var score = uniqueKeys.length + (map.__row__ ? 0.2 : 0);
    if (!best || score > best.score) {
      best = {
        score: score,
        items: group.items,
        map: map,
        uniqueCount: uniqueKeys.length,
        minY: minY,
        maxY: maxY,
        medianHeight: medianNumber(heights)
      };
    }
  }

  return best && best.uniqueCount >= 3 ? best : null;
}

function getTstColumnGeometry(headerCluster) {
  if (!headerCluster || !headerCluster.map) return null;
  var keys = ["ab-bot", "cd-bot", "ab-top", "cd-top"];
  var columns = [];
  for (var i = 0; i < keys.length; i++) {
    var item = headerCluster.map[keys[i]];
    if (!item) continue;
    columns.push({
      key: keys[i],
      cx: item.cx
    });
  }
  if (columns.length < 2) return null;
  columns.sort(function (a, b) {
    return a.cx - b.cx;
  });
  var gaps = [];
  for (var j = 1; j < columns.length; j++) {
    gaps.push(columns[j].cx - columns[j - 1].cx);
  }
  var gapMedian = medianNumber(gaps);
  return {
    columns: columns,
    minDataX: columns[0].cx,
    maxDataX: columns[columns.length - 1].cx,
    rowHeaderX: headerCluster.map.__row__ ? headerCluster.map.__row__.cx : columns[0].cx - (isFinite(gapMedian) ? gapMedian : 80),
    gapMedian: isFinite(gapMedian) ? gapMedian : Math.max(80, (columns[columns.length - 1].cx - columns[0].cx) / Math.max(1, columns.length - 1))
  };
}

function pickTstRowAnchors(items, headerCluster, columnGeometry) {
  if (!headerCluster || !columnGeometry) return [];
  var headerBottom = headerCluster.maxY + (isFinite(headerCluster.medianHeight) ? headerCluster.medianHeight : 18) * 0.35;
  var splitX = (columnGeometry.rowHeaderX + columnGeometry.minDataX) / 2 + columnGeometry.gapMedian * 0.08;
  var bestByRow = {};

  for (var i = 0; i < (Array.isArray(items) ? items.length : 0); i++) {
    var item = items[i];
    var rowNo = parseLikelyTstRowNumber(item && item.text);
    if (!isFinite(rowNo)) continue;
    if (item.cy <= headerBottom) continue;
    if (item.cx > splitX) continue;

    var score = Math.abs(item.cx - columnGeometry.rowHeaderX) - item.confidence * 10;
    if (!bestByRow[rowNo] || score < bestByRow[rowNo].score) {
      bestByRow[rowNo] = {
        rowNo: rowNo,
        cy: item.cy,
        score: score
      };
    }
  }

  var out = Object.keys(bestByRow)
    .map(function (key) {
      return bestByRow[key];
    })
    .sort(function (a, b) {
      return a.rowNo - b.rowNo;
    });

  return out;
}

function extractTstValuesFromAzureGeometry(result) {
  var lineItems = collectAzureLayoutItems(result, "lines");
  var wordItems = collectAzureLayoutItems(result, "words");
  var headerCluster = pickBestTstHeaderCluster(lineItems.length ? lineItems : wordItems);
  if (!headerCluster) return null;

  var columnGeometry = getTstColumnGeometry(headerCluster);
  if (!columnGeometry) return null;

  var rowAnchors = pickTstRowAnchors(wordItems.length ? wordItems : lineItems, headerCluster, columnGeometry);
  if (rowAnchors.length < 2) rowAnchors = pickTstRowAnchors(lineItems, headerCluster, columnGeometry);
  if (!rowAnchors.length) return null;

  var rowGaps = [];
  for (var i = 1; i < rowAnchors.length; i++) {
    rowGaps.push(Math.abs(rowAnchors[i].cy - rowAnchors[i - 1].cy));
  }
  var rowStep = medianNumber(rowGaps);
  if (!isFinite(rowStep) || rowStep <= 0) rowStep = Math.max(24, (isFinite(headerCluster.medianHeight) ? headerCluster.medianHeight : 18) * 2.2);

  var headerBottom = headerCluster.maxY + (isFinite(headerCluster.medianHeight) ? headerCluster.medianHeight : 18) * 0.4;
  var values = createEmptyTstValueArray();
  var chosenScore = {};
  var sources = [wordItems, lineItems];

  for (var si = 0; si < sources.length; si++) {
    var sourceItems = sources[si];
    for (var ii = 0; ii < sourceItems.length; ii++) {
      var item = sourceItems[ii];
      var temp = parseLikelyTstTemp(item && item.text);
      if (!isFinite(temp)) continue;
      if (item.cy <= headerBottom) continue;
      if (item.cx < columnGeometry.minDataX - columnGeometry.gapMedian * 0.25) continue;

      var nearestColumn = null;
      var nearestColumnDistance = Infinity;
      for (var ci = 0; ci < columnGeometry.columns.length; ci++) {
        var col = columnGeometry.columns[ci];
        var dx = Math.abs(item.cx - col.cx);
        if (dx < nearestColumnDistance) {
          nearestColumnDistance = dx;
          nearestColumn = col;
        }
      }
      if (!nearestColumn || nearestColumnDistance > columnGeometry.gapMedian * 0.48) continue;

      var nearestRow = null;
      var nearestRowDistance = Infinity;
      for (var ri = 0; ri < rowAnchors.length; ri++) {
        var row = rowAnchors[ri];
        var dy = Math.abs(item.cy - row.cy);
        if (dy < nearestRowDistance) {
          nearestRowDistance = dy;
          nearestRow = row;
        }
      }
      if (!nearestRow || nearestRowDistance > rowStep * 0.65) continue;

      var cellKey = nearestColumn.key + ":" + nearestRow.rowNo;
      var score = nearestColumnDistance + nearestRowDistance - item.confidence * 8;
      if (chosenScore[cellKey] === undefined || score < chosenScore[cellKey]) {
        setTstValueInArray(values, nearestColumn.key, nearestRow.rowNo, String(Math.round(temp)));
        chosenScore[cellKey] = score;
      }
    }
  }

  var filledCount = countFilledTstValues(values);
  return filledCount
    ? {
        values: values,
        filled_count: filledCount,
        source: "azure-geometry"
      }
    : null;
}

async function handleTstOcr(request, env) {
  if (!isAzureDocIntelConfigured(env)) {
    return json(
      {
        error: "azure_docintel_not_configured",
        provider: "azure-document-intelligence"
      },
      500
    );
  }

  var payload = await request.json().catch(function () {
    return null;
  });
  if (!payload || typeof payload !== "object") {
    return json({ error: "invalid_payload" }, 400);
  }

  var base64Source = pickFirstNonEmptyString([
    payload.base64Source,
    payload.document_base64,
    payload.data_base64,
    payload.image_base64
  ]).replace(/\s+/g, "");
  if (!base64Source) {
    return json({ error: "missing_base64_source" }, 400);
  }

  try {
    var result = await runAzureDocIntelAnalyze(env, {
      base64Source: base64Source,
      mimeType: pickFirstNonEmptyString([payload.mime_type, payload.mimeType]),
      fileName: pickFirstNonEmptyString([payload.file_name, payload.fileName])
    });
    var ocrText = flattenAzureDocIntelText(result);
    var tableValues = extractTstValuesFromAzureTables(result);
    var geometryValues = extractTstValuesFromAzureGeometry(result);
    var bestValues =
      geometryValues && geometryValues.filled_count > (tableValues ? tableValues.filled_count : 0)
        ? geometryValues
        : tableValues;
    return json(
      {
        ok: true,
        mode: bestValues && bestValues.filled_count > 0 ? bestValues.source : "azure-layout",
        provider: "azure-document-intelligence",
        ocr_text: ocrText,
        values: bestValues && bestValues.filled_count > 0 ? bestValues.values : undefined,
        details: Object.assign(
          {
            ocr_text: ocrText,
            values: bestValues && bestValues.filled_count > 0 ? bestValues.values : undefined,
            filled_count: bestValues ? bestValues.filled_count : 0,
            value_source: bestValues ? bestValues.source : "text",
            table_filled_count: tableValues ? tableValues.filled_count : 0,
            geometry_filled_count: geometryValues ? geometryValues.filled_count : 0
          },
          summarizeAzureDocIntelResult(result, getAzureDocIntelModelId(env))
        )
      },
      200
    );
  } catch (err) {
    return json(
      {
        error: "azure_docintel_failed",
        provider: "azure-document-intelligence",
        message: String((err && err.message) || err || "unknown")
      },
      502
    );
  }
}

async function runAzureDocIntelAnalyze(env, input) {
  var endpoint = getAzureDocIntelEndpoint(env);
  var key = getAzureDocIntelKey(env);
  var modelId = getAzureDocIntelModelId(env);
  var apiVersion = getAzureDocIntelApiVersion(env);
  var features = getAzureDocIntelFeatures(env);
  var outputFormat = getAzureDocIntelOutputFormat(env);
  var locale = getAzureDocIntelLocale(env);
  var query = [
    "_overload=analyzeDocument",
    "api-version=" + encodeURIComponent(apiVersion)
  ];

  if (features) query.push("features=" + encodeURIComponent(features));
  if (outputFormat) query.push("outputContentFormat=" + encodeURIComponent(outputFormat));
  if (locale) query.push("locale=" + encodeURIComponent(locale));

  var analyzeUrl =
    endpoint +
    "/documentintelligence/documentModels/" +
    encodeURIComponent(modelId) +
    ":analyze?" +
    query.join("&");

  var analyzeRes = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Ocp-Apim-Subscription-Key": key
    },
    body: JSON.stringify({
      base64Source: input.base64Source
    })
  });

  if (!analyzeRes.ok && analyzeRes.status !== 202) {
    var analyzeBody = await readResponseJsonOrText(analyzeRes);
    throw new Error(
      "azure_analyze_" +
        analyzeRes.status +
        ":" +
        pickFirstNonEmptyString([
          analyzeBody.json && analyzeBody.json.error && analyzeBody.json.error.message,
          analyzeBody.text
        ]).slice(0, 240)
    );
  }

  var operationLocation = pickFirstNonEmptyString([
    analyzeRes.headers.get("Operation-Location"),
    analyzeRes.headers.get("operation-location")
  ]);
  if (!operationLocation) {
    throw new Error("azure_missing_operation_location");
  }

  for (var attempt = 0; attempt < AZURE_DOCINTEL_POLL_MAX_TRIES; attempt++) {
    if (attempt > 0) await sleep(AZURE_DOCINTEL_POLL_DELAY_MS);

    var pollRes = await fetch(operationLocation, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Ocp-Apim-Subscription-Key": key
      }
    });
    var pollBody = await readResponseJsonOrText(pollRes);
    var pollJson = pollBody.json || {};
    var status = String(pollJson.status || "").toLowerCase();

    if (!pollRes.ok && status !== "running" && status !== "notstarted") {
      throw new Error(
        "azure_poll_" +
          pollRes.status +
          ":" +
          pickFirstNonEmptyString([
            pollJson.error && pollJson.error.message,
            pollBody.text
          ]).slice(0, 240)
      );
    }

    if (status === "succeeded") return pollJson;
    if (status === "failed" || status === "partiallysucceeded") {
      throw new Error(
        "azure_result_" +
          status +
          ":" +
          pickFirstNonEmptyString([
            pollJson.error && pollJson.error.message,
            pollBody.text
          ]).slice(0, 240)
      );
    }
  }

  throw new Error("azure_poll_timeout");
}

function sbHeaders(env, extra) {
  return Object.assign(
    {
      apikey: String(env.SUPABASE_SERVICE_ROLE_KEY),
      Authorization: "Bearer " + String(env.SUPABASE_SERVICE_ROLE_KEY),
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    extra || {}
  );
}

function sbTable(env) {
  return String(env.SUPABASE_TABLE || "scada_reports").trim();
}

function authTable(env) {
  return String(env.AUTH_TABLE || "scada_auth").trim();
}

function authRowId(env) {
  return String(env.AUTH_ROW_ID || "1").trim();
}

async function handleAuth(env) {
  var u =
    String(env.SUPABASE_URL).replace(/\/+$/, "") +
    "/rest/v1/" +
    authTable(env) +
    "?id=eq." +
    authRowId(env) +
    "&select=password_hash,otp_hash";

  var res = await fetch(u, { method: "GET", headers: sbHeaders(env) });
  if (!res.ok) return json({ error: "auth_fetch_failed", status: res.status }, 502);

  var arr = await res.json();
  var row = Array.isArray(arr) && arr.length ? arr[0] : {};
  return json(
    {
      password_hash: row.password_hash || "",
      otp_hash: row.otp_hash || ""
    },
    200
  );
}

async function handleLatestReport(env) {
  var u =
    String(env.SUPABASE_URL).replace(/\/+$/, "") +
    "/rest/v1/" +
    sbTable(env) +
    "?select=file_name,data_base64,created_at,uploaded_by&order=created_at.desc&limit=1";

  var res = await fetch(u, { method: "GET", headers: sbHeaders(env) });
  if (!res.ok) return json({ error: "latest_fetch_failed", status: res.status }, 502);

  var arr = await res.json();
  var row = Array.isArray(arr) && arr.length ? arr[0] : null;
  return json(
    row || {
      file_name: "",
      data_base64: "",
      created_at: null,
      uploaded_by: null
    },
    200
  );
}

async function handleWriteReport(env, payload) {
  if (!payload || !payload.data_base64) {
    return json({ error: "invalid_payload" }, 400);
  }

  var writePayload = {
    file_name: String(payload.file_name || "Burner_SCADA_Report.xlsx"),
    data_base64: String(payload.data_base64 || ""),
    uploaded_by: payload.uploaded_by || null
  };

  var tableUrl = String(env.SUPABASE_URL).replace(/\/+$/, "") + "/rest/v1/" + sbTable(env);

  var insertRes = await fetch(tableUrl, {
    method: "POST",
    headers: sbHeaders(env, { Prefer: "return=minimal" }),
    body: JSON.stringify(writePayload)
  });
  if (insertRes.ok || insertRes.status === 201 || insertRes.status === 204) {
    return json({ ok: true, mode: "insert" }, 200);
  }

  var upsertRes = await fetch(tableUrl + "?on_conflict=file_name", {
    method: "POST",
    headers: sbHeaders(env, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(writePayload)
  });
  if (upsertRes.ok || upsertRes.status === 201 || upsertRes.status === 204) {
    return json({ ok: true, mode: "upsert" }, 200);
  }

  var patchRes = await fetch(tableUrl + "?file_name=eq." + encodeURIComponent(writePayload.file_name), {
    method: "PATCH",
    headers: sbHeaders(env, { Prefer: "return=minimal" }),
    body: JSON.stringify({
      data_base64: writePayload.data_base64,
      uploaded_by: writePayload.uploaded_by
    })
  });
  if (patchRes.ok || patchRes.status === 204) {
    return json({ ok: true, mode: "patch" }, 200);
  }

  return json(
    {
      error: "write_failed",
      insert_status: insertRes.status,
      upsert_status: upsertRes.status,
      patch_status: patchRes.status
    },
    502
  );
}

function withCors(response) {
  var r = new Response(response.body, response);
  r.headers.set("Access-Control-Allow-Origin", "*");
  r.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,OPTIONS");
  r.headers.set("Access-Control-Allow-Headers", "Content-Type,x-scada-relay-key");
  return r;
}

function json(data, status) {
  return withCors(
    new Response(JSON.stringify(data), {
      status: status || 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    })
  );
}

/* Legacy class kept as a no-op so Cloudflare can deploy older DO-linked versions safely. */
export class VisionQuotaDO {
  constructor(state) {
    this.state = state;
  }

  async fetch() {
    return new Response(JSON.stringify({ ok: true, disabled: true }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
}
