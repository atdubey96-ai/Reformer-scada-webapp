const SERVICE_NAME = "scada-relay";

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
            endpoints: ["/health", "/scada/auth", "/scada/report/latest", "/scada/report", "/scada/tst/ocr"]
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
    return json(
      {
        ok: true,
        mode: tableValues && tableValues.filled_count > 0 ? "azure-table" : "azure-layout",
        provider: "azure-document-intelligence",
        ocr_text: ocrText,
        values: tableValues && tableValues.filled_count > 0 ? tableValues.values : undefined,
        details: Object.assign(
          {
            ocr_text: ocrText,
            values: tableValues && tableValues.filled_count > 0 ? tableValues.values : undefined,
            filled_count: tableValues ? tableValues.filled_count : 0,
            value_source: tableValues ? tableValues.source : "text"
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
