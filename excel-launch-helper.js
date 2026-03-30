#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const HOST = process.env.SCADA_HELPER_HOST || "127.0.0.1";
const PORT = Number(process.env.SCADA_HELPER_PORT || "8766");
const DEFAULT_WORKBOOK_PATH = path.join(__dirname, "webapp", "Data_website2.xlsm");

function getWorkbookPath() {
  const rawPath = process.env.SCADA_EXCEL_FILE || DEFAULT_WORKBOOK_PATH;
  return path.resolve(rawPath);
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin, Access-Control-Request-Headers, Access-Control-Request-Method, Access-Control-Request-Private-Network"
  });
  res.end(JSON.stringify(payload));
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: false,
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(command + " exited with code " + code));
    });
  });
}

function quotePowerShell(value) {
  return "'" + String(value || "").replace(/'/g, "''") + "'";
}

async function openWorkbookFile(workbookPath) {
  if (!fs.existsSync(workbookPath)) {
    throw new Error("Workbook not found: " + workbookPath);
  }

  if (process.platform === "darwin") {
    try {
      await runCommand("open", ["-a", "Microsoft Excel", workbookPath]);
      return;
    } catch (err) {
      await runCommand("open", [workbookPath]);
      return;
    }
  }

  if (process.platform === "win32") {
    const command = "Start-Process -FilePath " + quotePowerShell(workbookPath);
    await runCommand("powershell.exe", ["-NoProfile", "-Command", command]);
    return;
  }

  await runCommand("xdg-open", [workbookPath]);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 32) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleOpenExcel(req, res) {
  try {
    await readRequestBody(req);
    const workbookPath = getWorkbookPath();
    await openWorkbookFile(workbookPath);
    writeJson(res, 200, {
      ok: true,
      path: workbookPath,
      platform: process.platform
    });
  } catch (err) {
    writeJson(res, 500, {
      ok: false,
      error: err && err.message ? err.message : "Could not open workbook."
    });
  }
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url || "/", "http://" + (req.headers.host || (HOST + ":" + PORT)));

  if (req.method === "OPTIONS") {
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && reqUrl.pathname === "/health") {
    writeJson(res, 200, {
      ok: true,
      path: getWorkbookPath(),
      platform: process.platform
    });
    return;
  }

  if (req.method === "POST" && reqUrl.pathname === "/open-excel") {
    handleOpenExcel(req, res);
    return;
  }

  writeJson(res, 404, {
    ok: false,
    error: "Not found"
  });
});

server.listen(PORT, HOST, () => {
  console.log("[excel-helper] listening on http://" + HOST + ":" + PORT);
  console.log("[excel-helper] workbook: " + getWorkbookPath());
});

server.on("error", (err) => {
  const message = err && err.message ? err.message : "Unknown helper error";
  console.error("[excel-helper] " + message);
  process.exit(1);
});
