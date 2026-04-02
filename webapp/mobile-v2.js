(function(){
  "use strict";

  var MOBILE_QUERY = "(max-width: 900px)";
  var STORAGE_PREFIX = "scada-mobile-v2:";
  var TAB_LABELS = {
    home: "Executive overview",
    walls: "Wall monitoring",
    trends: "Performance trends",
    logs: "Recent logs",
    alarms: "Alarm center"
  };
  var TREND_METRICS = {
    hguLoad: {
      label: "HGU Load",
      unit: "%",
      color: "#7aa9ff",
      accessor: function(point){ return point ? point.hguLoad : null; }
    },
    avgCot: {
      label: "Avg COT",
      unit: "degC",
      color: "#57d3a8",
      accessor: function(point){
        if(!point) return null;
        var values = [toNumber(point.abCot), toNumber(point.cdCot)].filter(isFiniteNumber);
        if(!values.length) return null;
        return values.reduce(function(sum, item){ return sum + item; }, 0) / values.length;
      }
    },
    excessO2: {
      label: "Excess O2",
      unit: "%Vol",
      color: "#f3b65b",
      accessor: function(point){ return point ? point.excessO2 : null; }
    },
    methaneSlip: {
      label: "Methane Slip",
      unit: "%Vol",
      color: "#ff7b95",
      accessor: function(point){ return point ? point.methaneSlip : null; }
    }
  };
  var TST_ROW_KEYS = ["ab-bot", "cd-bot", "ab-top", "cd-top"];
  var TST_ROW_LABELS = {
    "ab-bot": "AB Bot",
    "cd-bot": "CD Bot",
    "ab-top": "AB Top",
    "cd-top": "CD Top"
  };
  var state = {
    activeTab: readStored("active-tab", "home"),
    wall: readStored("wall", "A"),
    trendMetric: readStored("trend-metric", "hguLoad"),
    alarmFilter: readStored("alarm-filter", "all"),
    sheetKind: "",
    sheetPayload: null,
    selectedCellKey: ""
  };
  var root = null;
  var renderTimer = 0;
  var lastTrendRequestAt = 0;
  var lastAlarmRefreshAt = 0;

  function readStored(key, fallback){
    try{
      var raw = localStorage.getItem(STORAGE_PREFIX + key);
      return raw == null || raw === "" ? fallback : raw;
    }catch(e){
      return fallback;
    }
  }

  function writeStored(key, value){
    try{
      localStorage.setItem(STORAGE_PREFIX + key, String(value));
    }catch(e){}
  }

  function persistState(){
    writeStored("active-tab", state.activeTab);
    writeStored("wall", state.wall);
    writeStored("trend-metric", state.trendMetric);
    writeStored("alarm-filter", state.alarmFilter);
  }

  function isMobileViewport(){
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia(MOBILE_QUERY).matches;
  }

  function isLoggedIn(){
    return typeof window.isUserLoggedIn === "function" ? !!window.isUserLoggedIn() : true;
  }

  function isStandaloneInstalled(){
    try{
      if(typeof window.scadaGetInstallState === "function"){
        var state = window.scadaGetInstallState();
        if(state && state.installed) return true;
      }
    }catch(e){}
    try{
      if(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    }catch(e){}
    try{
      if(window.navigator && window.navigator.standalone) return true;
    }catch(e){}
    return false;
  }

  function getInstallPlatform(){
    var ua = String((window.navigator && window.navigator.userAgent) || "").toLowerCase();
    if(/iphone|ipad|ipod/.test(ua)) return "ios";
    if(/android/.test(ua)) return "android";
    if(/windows/.test(ua)) return "windows";
    return "mobile";
  }

  function isMobileShellActive(){
    return isMobileViewport() && isLoggedIn();
  }

  function ensureRoot(){
    if(root && document.body && document.body.contains(root)) return root;
    root = document.getElementById("mobile-v2-root");
    if(!root){
      root = document.createElement("div");
      root.id = "mobile-v2-root";
      var anchor = document.querySelector(".tab-panels");
      if(anchor && anchor.parentNode){
        anchor.parentNode.insertBefore(root, anchor);
      }else if(document.body){
        document.body.appendChild(root);
      }
    }
    return root;
  }

  function toNumber(value){
    var num = Number(value);
    return isFinite(num) ? num : null;
  }

  function isFiniteNumber(value){
    return typeof value === "number" && isFinite(value);
  }

  function clamp(value, min, max){
    return Math.max(min, Math.min(max, value));
  }

  function escapeHtml(value){
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeBurnerState(value){
    var code = String(value || "").toUpperCase().trim();
    return (code === "B" || code === "N" || code === "O" || code === "C") ? code : "C";
  }

  function parseDateSafe(value){
    if(!value) return null;
    var dt = new Date(value);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function formatTimeAgo(value){
    var dt = parseDateSafe(value);
    if(!dt) return "—";
    var diffMs = Math.max(0, Date.now() - dt.getTime());
    var minutes = Math.round(diffMs / 60000);
    if(minutes < 1) return "Just now";
    if(minutes < 60) return minutes + "m ago";
    var hours = Math.round(minutes / 60);
    if(hours < 24) return hours + "h ago";
    var days = Math.round(hours / 24);
    return days + "d ago";
  }

  function formatDateTime(value){
    var dt = parseDateSafe(value);
    if(!dt) return "—";
    return dt.toLocaleString([], {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatNumber(value, digits){
    var num = toNumber(value);
    if(!isFiniteNumber(num)) return "—";
    return num.toFixed(digits == null ? 0 : digits);
  }

  function countFilledPeepValues(entry){
    if(!entry || !entry.peepHoles || typeof entry.peepHoles !== "object") return 0;
    var count = 0;
    Object.keys(entry.peepHoles).forEach(function(key){
      var values = Array.isArray(entry.peepHoles[key]) ? entry.peepHoles[key] : [];
      values.forEach(function(item){
        if(String(item || "").trim() !== "") count += 1;
      });
    });
    return count;
  }

  function getWallNames(){
    if(Array.isArray(window.WALL_NAMES) && window.WALL_NAMES.length) return window.WALL_NAMES.slice();
    return ["A", "B", "C", "D"];
  }

  function getBurnerGrid(){
    return window.data && typeof window.data === "object" ? window.data : {};
  }

  function getOpeningGrid(){
    return window.burnerOpeningData && typeof window.burnerOpeningData === "object" ? window.burnerOpeningData : {};
  }

  function getOpeningValue(wall, ri, ci, stateCode){
    if(typeof window.getBurnerOpeningValue === "function"){
      return window.getBurnerOpeningValue(wall, ri, ci, stateCode);
    }
    var openingGrid = getOpeningGrid();
    var val = openingGrid && openingGrid[wall] && openingGrid[wall][ri] ? openingGrid[wall][ri][ci] : null;
    var num = toNumber(val);
    if(!isFiniteNumber(num)) return stateCode === "C" ? 0 : 100;
    return clamp(num, 0, 100);
  }

  function getTempEntries(){
    var list = [];
    if(Array.isArray(window.tempDataEntries) && window.tempDataEntries.length){
      list = window.tempDataEntries.slice();
    }else if(typeof window.getAllTempEntries === "function"){
      try{ list = window.getAllTempEntries().slice(); }catch(e){ list = []; }
    }
    list.sort(function(a, b){
      var ta = parseDateSafe(a && (a.dt || a.date || a.createdAt || a.created_at));
      var tb = parseDateSafe(b && (b.dt || b.date || b.createdAt || b.created_at));
      return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
    });
    return list;
  }

  function getLatestTempEntry(){
    return getTempEntries()[0] || null;
  }

  function getTempEntryRecords(){
    var list = [];
    if(Array.isArray(window.tempDataEntries) && window.tempDataEntries.length){
      list = window.tempDataEntries.map(function(entry, index){
        return { entry: entry, originalIndex: index };
      });
    }else if(typeof window.getAllTempEntries === "function"){
      try{
        list = window.getAllTempEntries().map(function(entry, index){
          return { entry: entry, originalIndex: index };
        });
      }catch(e){
        list = [];
      }
    }
    list.sort(function(a, b){
      var ta = parseDateSafe(a && a.entry && (a.entry.dt || a.entry.date || a.entry.createdAt || a.entry.created_at));
      var tb = parseDateSafe(b && b.entry && (b.entry.dt || b.entry.date || b.entry.createdAt || b.entry.created_at));
      return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
    });
    return list;
  }

  function getProcessBindings(){
    return Array.isArray(window.TD_PROCESS_FIELD_BINDINGS) ? window.TD_PROCESS_FIELD_BINDINGS.slice() : [];
  }

  function getCurrentDateTimeLocalValue(){
    var now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  }

  function toDateTimeLocalValue(value){
    var dt = parseDateSafe(value);
    if(!dt) return getCurrentDateTimeLocalValue();
    var local = new Date(dt.getTime() - (dt.getTimezoneOffset() * 60000));
    return local.toISOString().slice(0, 16);
  }

  function createEmptyPeepHoles(){
    var peepHoles = {};
    TST_ROW_KEYS.forEach(function(key){
      peepHoles[key] = Array(15).fill("");
    });
    return peepHoles;
  }

  function buildTstDraft(entry){
    var draft = {
      dt: toDateTimeLocalValue(entry && entry.dt),
      shift: entry && entry.shift ? String(entry.shift) : "",
      peepHoles: createEmptyPeepHoles(),
      processValues: {}
    };
    getProcessBindings().forEach(function(binding){
      var raw = entry && typeof window.getTdProcessEntryValue === "function"
        ? window.getTdProcessEntryValue(entry, binding.key)
        : (entry ? entry[binding.key] : "");
      draft.processValues[binding.key] = typeof window.formatTdProcessFieldValue === "function"
        ? window.formatTdProcessFieldValue(binding, raw)
        : String(raw == null ? "" : raw);
    });
    TST_ROW_KEYS.forEach(function(rowKey){
      var values = entry && entry.peepHoles && Array.isArray(entry.peepHoles[rowKey]) ? entry.peepHoles[rowKey] : [];
      for(var i = 0; i < 15; i++){
        draft.peepHoles[rowKey][i] = values[i] == null ? "" : String(values[i]);
      }
    });
    return draft;
  }

  function getCleaningKey(ri, ci){
    return "R" + (ri + 1) + "B" + (ci + 1);
  }

  function getCleaningDateForCell(wall, ri, ci){
    var log = getCleaningLog();
    var key = getCleaningKey(ri, ci);
    return log[wall] && log[wall][key] ? String(log[wall][key]) : "";
  }

  function ensureAlarmDataFresh(force){
    var now = Date.now();
    if(!force && (now - lastAlarmRefreshAt) < 5000) return;
    lastAlarmRefreshAt = now;
    try{
      if(typeof window.rebuildWallAlarms === "function") window.rebuildWallAlarms();
      if(typeof window.rebuildFreqAlarms === "function") window.rebuildFreqAlarms();
      if(typeof window.updateAlarmTabBadge === "function") window.updateAlarmTabBadge();
    }catch(e){}
  }

  function saveBurnerCellNative(wall, ri, ci, nextState, nextOpening){
    if(typeof window.stageBurnerCellChange === "function"){
      window.stageBurnerCellChange(wall, ri, ci, {
        state: nextState,
        opening: nextOpening
      });
      if(typeof window.commitBurnerPending === "function"){
        window.commitBurnerPending();
      }
    }else{
      if(window.data && window.data[wall] && window.data[wall][ri]){
        window.data[wall][ri][ci] = nextState;
      }
      if(typeof window.setBurnerOpeningValue === "function"){
        window.setBurnerOpeningValue(wall, ri, ci, nextOpening, nextState);
      }
      if(typeof window.saveData === "function") window.saveData();
      if(typeof window.saveBurnerOpeningData === "function") window.saveBurnerOpeningData();
    }
    if(typeof window.markCurrentAutoSyncDigest === "function"){
      try{ window.markCurrentAutoSyncDigest(); }catch(e){}
    }
    ensureAlarmDataFresh(true);
  }

  function addCleaningEventNative(wall, ri, ci, dateValue){
    var cleanDate = String(dateValue || "").trim();
    if(!cleanDate) return false;
    var key = getCleaningKey(ri, ci);
    if(typeof window.getBurnerDatesForSelection === "function" && typeof window.persistCleaningDatesForBurner === "function"){
      var dates = window.getBurnerDatesForSelection(wall, key).slice();
      dates.push(cleanDate);
      window.persistCleaningDatesForBurner(wall, key, dates);
    }else{
      var log = typeof window.loadCleaningLog === "function" ? (window.loadCleaningLog() || {}) : {};
      if(!log[wall]) log[wall] = {};
      log[wall][key] = cleanDate;
      if(typeof window.saveCleaningLog === "function") window.saveCleaningLog(log);
    }
    if(typeof window.markCurrentAutoSyncDigest === "function"){
      try{ window.markCurrentAutoSyncDigest(); }catch(e){}
    }
    ensureAlarmDataFresh(true);
    return true;
  }

  function saveTempEntryNative(entryDraft, editIndex){
    var rows = Array.isArray(window.tempDataEntries)
      ? window.tempDataEntries
      : (typeof window.getAllTempEntries === "function" ? window.getAllTempEntries().slice() : []);
    window.tempDataEntries = rows;

    var entry = {
      dt: String(entryDraft.dt || ""),
      shift: String(entryDraft.shift || ""),
      burnerSnapshot: typeof window.captureCurrentBurnerSnapshot === "function"
        ? window.captureCurrentBurnerSnapshot()
        : null,
      peepHoles: createEmptyPeepHoles()
    };

    if(typeof window.captureCurrentBurnerOpeningSnapshot === "function"){
      entry.openingSnapshot = window.captureCurrentBurnerOpeningSnapshot(entry.burnerSnapshot);
    }

    getProcessBindings().forEach(function(binding){
      entry[binding.key] = String(entryDraft.processValues[binding.key] || "").trim();
    });

    TST_ROW_KEYS.forEach(function(rowKey){
      for(var i = 0; i < 15; i++){
        entry.peepHoles[rowKey][i] = String(entryDraft.peepHoles[rowKey][i] || "").trim();
      }
    });

    if(editIndex >= 0 && editIndex < rows.length){
      rows[editIndex] = entry;
    }else{
      rows.unshift(entry);
    }

    try{
      localStorage.setItem("tempDataEntries", JSON.stringify(rows));
    }catch(e){}
    if(typeof window.ensureTempEntriesHaveSnapshots === "function"){
      try{ window.ensureTempEntriesHaveSnapshots(); }catch(e){}
    }
    if(typeof window.markCurrentAutoSyncDigest === "function"){
      try{ window.markCurrentAutoSyncDigest(); }catch(e){}
    }
    return entry;
  }

  function deleteTempEntryNative(index){
    var rows = Array.isArray(window.tempDataEntries)
      ? window.tempDataEntries
      : (typeof window.getAllTempEntries === "function" ? window.getAllTempEntries().slice() : []);
    if(!(index >= 0 && index < rows.length)) return false;
    rows.splice(index, 1);
    window.tempDataEntries = rows;
    try{
      localStorage.setItem("tempDataEntries", JSON.stringify(rows));
    }catch(e){}
    if(typeof window.markCurrentAutoSyncDigest === "function"){
      try{ window.markCurrentAutoSyncDigest(); }catch(e){}
    }
    return true;
  }

  function getCleaningLog(){
    try{
      if(typeof window.getMergedCleaningLog === "function"){
        return window.getMergedCleaningLog() || {};
      }
      if(typeof window.loadCleaningLog === "function"){
        return window.loadCleaningLog() || {};
      }
    }catch(e){}
    return {};
  }

  function getCleaningStats(){
    var log = getCleaningLog();
    var total = getWallNames().length * 6 * 15;
    var cleaned = 0;
    var recent7 = 0;
    Object.keys(log || {}).forEach(function(wall){
      var entries = log[wall] && typeof log[wall] === "object" ? log[wall] : {};
      Object.keys(entries).forEach(function(key){
        var dateValue = String(entries[key] || "").trim();
        if(!dateValue) return;
        cleaned += 1;
        var dt = parseDateSafe(dateValue);
        if(!dt) return;
        var diffDays = (Date.now() - dt.getTime()) / 86400000;
        if(diffDays <= 7) recent7 += 1;
      });
    });
    return {
      total: total,
      cleaned: cleaned,
      pending: Math.max(0, total - cleaned),
      recent7: recent7
    };
  }

  function getLastSyncCopy(){
    var lastSync = document.getElementById("lastSync");
    var syncHealth = document.getElementById("syncHealthText");
    return {
      lastSync: String(lastSync && lastSync.textContent || "—").trim(),
      syncStatus: String(syncHealth && syncHealth.textContent || "Live").trim()
    };
  }

  function getTempEntryByIndex(index){
    if(!Array.isArray(window.tempDataEntries)) return null;
    return (index >= 0 && index < window.tempDataEntries.length) ? window.tempDataEntries[index] : null;
  }

  function showMobileToast(message){
    if(!message) return;
    if(typeof window.showToast === "function"){
      window.showToast(message);
    }
  }

  function syncMobileChanges(successMessage){
    if(typeof window.exportToExcel !== "function"){
      if(successMessage) showMobileToast(successMessage);
      return Promise.resolve(true);
    }
    return Promise.resolve(window.exportToExcel({ silent: true })).then(function(result){
      if(!successMessage) return result;
      if(result === "queued"){
        showMobileToast(successMessage + " Sync queued.");
      }else if(result === true){
        showMobileToast(successMessage);
      }else{
        showMobileToast(successMessage + " Saved locally.");
      }
      return result;
    }).catch(function(err){
      console.warn("Mobile sync failed:", err);
      showMobileToast("Saved locally. Central sync will retry.");
      return false;
    });
  }

  function getWallSeverity(wall){
    return window.wallSeverity && window.wallSeverity[wall] ? String(window.wallSeverity[wall]).toLowerCase() : "normal";
  }

  function severityRank(severity){
    var sev = String(severity || "normal").toLowerCase();
    return sev === "critical" ? 3 : sev === "major" ? 2 : sev === "warning" ? 1 : 0;
  }

  function severityTone(severity){
    var sev = String(severity || "normal").toLowerCase();
    return sev === "critical" ? "critical" : sev === "major" ? "major" : sev === "warning" ? "warning" : "good";
  }

  function severityStatusText(severity){
    var sev = String(severity || "normal").toLowerCase();
    if(sev === "critical" || sev === "major") return "Alert";
    if(sev === "warning") return "Watch";
    return "Healthy";
  }

  function maxSeverity(a, b){
    return severityRank(a) >= severityRank(b) ? String(a || "normal").toLowerCase() : String(b || "normal").toLowerCase();
  }

  function deriveWallSeverity(counts){
    var total = (counts.B || 0) + (counts.N || 0) + (counts.O || 0) + (counts.C || 0);
    if(!total) return "normal";
    var coldRatio = (counts.C || 0) / total;
    var activeStates = [counts.B || 0, counts.N || 0, counts.O || 0];
    var maxActive = Math.max.apply(null, activeStates);
    var minActive = Math.min.apply(null, activeStates);
    var gap = maxActive - minActive;
    if(coldRatio >= 0.5 || gap >= 24) return "critical";
    if(coldRatio >= 0.35 || gap >= 16) return "major";
    if(coldRatio >= 0.18 || gap >= 9) return "warning";
    return "normal";
  }

  function buildWallIssueCopy(wall, counts, severity){
    var active = (counts.B || 0) + (counts.N || 0) + (counts.O || 0);
    var cold = counts.C || 0;
    if(severity === "normal"){
      return active + " burners active and " + cold + " cold on Wall " + wall + ".";
    }
    if(cold >= 18){
      return cold + " burners are cold on Wall " + wall + ".";
    }
    return "Wall " + wall + " is showing " + getDominantStateLabel(counts).toLowerCase() + " dominance with " + cold + " cold burners.";
  }

  function buildWallActionCopy(wall, counts, severity){
    if(severity === "normal"){
      return "No immediate action required.";
    }
    if((counts.C || 0) >= 18){
      return "Review cold burners on Wall " + wall + " first.";
    }
    return "Open Wall " + wall + " and review burner states and openings.";
  }

  function buildWallSummary(wall){
    var grid = getBurnerGrid();
    var rows = Array.isArray(grid[wall]) ? grid[wall] : [];
    var counts = { B:0, N:0, O:0, C:0 };
    rows.forEach(function(row){
      (Array.isArray(row) ? row : []).forEach(function(cell){
        counts[normalizeBurnerState(cell)] += 1;
      });
    });
    var severity = maxSeverity(getWallSeverity(wall), deriveWallSeverity(counts));
    var issueCopy = buildWallIssueCopy(wall, counts, severity);
    var actionCopy = buildWallActionCopy(wall, counts, severity);
    return {
      wall: wall,
      counts: counts,
      severity: severity,
      issueCopy: issueCopy,
      actionCopy: actionCopy
    };
  }

  function buildChamberSummary(label, walls){
    var items = walls.map(buildWallSummary);
    var worst = items.slice().sort(function(a, b){
      return severityRank(b.severity) - severityRank(a.severity);
    })[0] || buildWallSummary(walls[0]);
    var activeCount = items.reduce(function(sum, item){
      return sum + item.counts.B + item.counts.N + item.counts.O;
    }, 0);
    var coldCount = items.reduce(function(sum, item){
      return sum + item.counts.C;
    }, 0);
    return {
      label: label,
      severity: worst.severity,
      status: severityStatusText(worst.severity),
      copy: worst.issueCopy,
      activeCount: activeCount,
      coldCount: coldCount
    };
  }

  function getActiveAlarms(){
    ensureAlarmDataFresh(false);
    return Array.isArray(window.alarmLog) ? window.alarmLog.filter(function(item){ return !item.acked; }) : [];
  }

  function getResolvedAlarms(){
    ensureAlarmDataFresh(false);
    return Array.isArray(window.alarmLog) ? window.alarmLog.filter(function(item){ return !!item.acked; }) : [];
  }

  function getAlarmTone(alarm){
    if(!alarm) return "warning";
    if(alarm.type === "freq") return "warning";
    return String(alarm.sev || "warning").toLowerCase();
  }

  function getAlarmTitle(alarm){
    if(typeof window.buildAlarmChipTitle === "function"){
      return window.buildAlarmChipTitle(alarm);
    }
    return String(alarm && (alarm.title || alarm.wall || "Alarm") || "Alarm");
  }

  function getAlarmSummary(alarm){
    if(typeof window.buildAlarmChipSummary === "function"){
      return window.buildAlarmChipSummary(alarm);
    }
    return String(alarm && (alarm.desc || alarm.action || "") || "");
  }

  function computeHealthScore(){
    var score = 100;
    var activeAlarms = getActiveAlarms();
    var walls = getWallNames().map(buildWallSummary);
    activeAlarms.forEach(function(alarm){
      var tone = getAlarmTone(alarm);
      score -= tone === "critical" ? 14 : tone === "major" ? 9 : 5;
    });
    walls.forEach(function(item){
      score -= severityRank(item.severity) * 4;
    });
    var latestEntry = getLatestTempEntry();
    var latestEntryDate = latestEntry && latestEntry.dt ? parseDateSafe(latestEntry.dt) : null;
    if(!latestEntryDate){
      score -= 6;
    }else{
      var ageHours = (Date.now() - latestEntryDate.getTime()) / 3600000;
      if(ageHours > 12) score -= 4;
    }
    return clamp(Math.round(score), 26, 99);
  }

  function buildFocusItems(){
    var items = [];
    getActiveAlarms().slice(0, 3).forEach(function(alarm){
      items.push({
        tone: getAlarmTone(alarm),
        title: getAlarmTitle(alarm),
        copy: getAlarmSummary(alarm)
      });
    });
    if(items.length < 3){
      getWallNames()
        .map(buildWallSummary)
        .sort(function(a, b){ return severityRank(b.severity) - severityRank(a.severity); })
        .forEach(function(item){
          if(items.length >= 3 || item.severity === "normal") return;
          items.push({
            tone: item.severity,
            title: "Wall " + item.wall + " monitoring",
            copy: item.actionCopy
          });
        });
    }
    if(!items.length){
      items.push({
        tone: "good",
        title: "No immediate issues",
        copy: "Mobile home is now focused on health status, top risks, and fast navigation."
      });
    }
    return items.slice(0, 3);
  }

  function buildRecentActivityItems(){
    var latestEntry = getLatestTempEntry();
    var sync = getLastSyncCopy();
    var alarms = getActiveAlarms();
    var list = [];
    if(latestEntry){
      list.push({
        title: "Latest TST snapshot",
        copy: (latestEntry.shift || "Saved entry") + " · " + formatDateTime(latestEntry.dt)
      });
    }
    list.push({
      title: "Last sync",
      copy: sync.lastSync || "—"
    });
    list.push({
      title: "Open alarms",
      copy: alarms.length ? (alarms.length + " active alarms") : "No active alarms"
    });
    return list;
  }

  function buildWallIssueBanner(summary){
    if(!summary || summary.severity === "normal"){
      return buildBannerHtml("Stable wall view", "Single-wall 2D burner monitoring keeps the mobile scan fast and clear.");
    }
    return buildBannerHtml(
      "Wall " + summary.wall + " needs review",
      summary.issueCopy,
      summary.severity
    );
  }

  function buildBannerHtml(title, copy, tone){
    var className = tone === "good" || !tone ? "m2-banner m2-banner-good" : "m2-banner";
    return ''
      + '<div class="' + className + '">'
      +   '<div class="m2-banner-title">' + escapeHtml(title) + '</div>'
      +   '<div class="m2-banner-copy">' + escapeHtml(copy) + '</div>'
      + '</div>';
  }

  function buildHomePaneHtml(){
    var health = computeHealthScore();
    var sync = getLastSyncCopy();
    var alarms = getActiveAlarms();
    var chamberAB = buildChamberSummary("AB Chamber", ["A", "B"]);
    var chamberCD = buildChamberSummary("CD Chamber", ["C", "D"]);
    var latestEntry = getLatestTempEntry();
    var filledPoints = latestEntry ? countFilledPeepValues(latestEntry) : 0;
    var focusItems = buildFocusItems();
    var recentActivity = buildRecentActivityItems();

    return ''
      + (alarms.length
        ? buildBannerHtml(alarms.length + " issue" + (alarms.length > 1 ? "s" : "") + " need review", "Top risks are surfaced first for a boss-friendly mobile overview.", getAlarmTone(alarms[0]))
        : buildBannerHtml("Plant status looks stable", "No active alarms at the moment. Mobile home stays focused on health, sync, and next actions.", "good"))
      + '<section class="m2-hero">'
      +   '<div class="m2-eyebrow">Plant health</div>'
      +   '<div class="m2-hero-row">'
      +     '<div>'
      +       '<div class="m2-hero-score">' + health + '%</div>'
      +       '<div class="m2-hero-copy">' + escapeHtml(health >= 85 ? "Stable operating picture" : health >= 70 ? "Stable with focused attention" : "Needs leadership review") + '</div>'
      +     '</div>'
      +     '<div class="m2-live-stack">'
      +       '<div class="m2-live-pill">' + escapeHtml(sync.syncStatus || "Live") + '</div>'
      +       '<div class="m2-live-meta">Last sync<div class="m2-live-time">' + escapeHtml(sync.lastSync || "—") + '</div></div>'
      +     '</div>'
      +   '</div>'
      + '</section>'
      + '<section class="m2-grid-2">'
      +   buildChamberCardHtml(chamberAB)
      +   buildChamberCardHtml(chamberCD)
      + '</section>'
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-card-title">Quick KPIs</div>'
      +   '<div class="m2-chip-row" style="margin-top:14px;">'
      +     buildChipHtml("Active alarms", alarms.length)
      +     buildChipHtml("TST points", filledPoints || "—")
      +     buildChipHtml("Cleaned", getCleaningStats().cleaned)
      +     buildChipHtml("Wall focus", state.wall)
      +   '</div>'
      + '</div></section>'
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-card-title">Focus Now</div>'
      +   '<div class="m2-focus-list" style="margin-top:14px;">'
      +     focusItems.map(function(item){
              return ''
                + '<div class="m2-focus-item tone-' + severityTone(item.tone) + '">'
                +   '<div class="m2-focus-title">' + escapeHtml(item.title) + '</div>'
                +   '<div class="m2-focus-copy">' + escapeHtml(item.copy) + '</div>'
                + '</div>';
            }).join("")
      +   '</div>'
      + '</div></section>'
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-card-title">Recent Activity</div>'
      +   '<div class="m2-list" style="margin-top:14px;">'
      +     recentActivity.map(function(item){
              return ''
                + '<div class="m2-list-item">'
                +   '<div class="m2-list-title">' + escapeHtml(item.title) + '</div>'
                +   '<div class="m2-list-meta">' + escapeHtml(item.copy) + '</div>'
                + '</div>';
            }).join("")
      +   '</div>'
      + '</div></section>';
  }

  function buildChamberCardHtml(chamber){
    return ''
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-chamber-name">' + escapeHtml(chamber.label) + '</div>'
      +   '<div class="m2-chamber-status m2-status-' + (chamber.severity === "normal" ? "good" : chamber.severity === "warning" ? "watch" : "alert") + '">'
      +     escapeHtml(chamber.status)
      +   '</div>'
      +   '<div class="m2-card-copy">' + escapeHtml(chamber.copy) + '</div>'
      + '</div></section>';
  }

  function buildChipHtml(label, value){
    return '<div class="m2-chip"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }

  function buildWallsPaneHtml(){
    var summary = buildWallSummary(state.wall);
    var counts = summary.counts;
    return ''
      + buildWallIssueBanner(summary)
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-card-title">Wall selector</div>'
      +   '<div class="m2-seg" style="margin-top:14px;">'
      +     getWallNames().map(function(wall){
              return '<button class="m2-seg-btn' + (state.wall === wall ? ' is-active' : '') + '" type="button" data-wall="' + escapeHtml(wall) + '">' + escapeHtml(wall) + '</button>';
            }).join("")
      +   '</div>'
      +   '<div class="m2-wall-kpis">'
      +     buildMiniStatHtml("Severity", severityStatusText(summary.severity))
      +     buildMiniStatHtml("Active burners", counts.B + counts.N + counts.O)
      +     buildMiniStatHtml("Cold", counts.C)
      +     buildMiniStatHtml("Primary state", getDominantStateLabel(counts))
      +   '</div>'
      + '</div></section>'
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-card-title">Wall ' + escapeHtml(state.wall) + ' burner view</div>'
      +   '<div class="m2-card-copy">Single-wall 2D monitoring is the core mobile surface for fast review.</div>'
      +   buildWallMatrixHtml(state.wall)
      +   '<div class="m2-chip-row" style="margin-top:14px;">'
      +     buildChipHtml("Both", counts.B)
      +     buildChipHtml("NG", counts.N)
      +     buildChipHtml("Off gas", counts.O)
      +     buildChipHtml("Cold", counts.C)
      +   '</div>'
      + '</div></section>'
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-card-title">Why this view is faster</div>'
      +   '<div class="m2-card-copy">You can scan one wall instantly, tap any burner for details, and skip heavy multi-surface loading on phone.</div>'
      + '</div></section>';
  }

  function buildMiniStatHtml(label, value){
    return ''
      + '<div class="m2-mini-stat">'
      +   '<div class="m2-stat-label">' + escapeHtml(label) + '</div>'
      +   '<div class="m2-mini-value">' + escapeHtml(value) + '</div>'
      + '</div>';
  }

  function getDominantStateLabel(counts){
    var order = [
      { key:"B", label:"Both" },
      { key:"N", label:"NG" },
      { key:"O", label:"Off gas" },
      { key:"C", label:"Cold" }
    ];
    order.sort(function(a, b){
      return (counts[b.key] || 0) - (counts[a.key] || 0);
    });
    return order[0] ? order[0].label : "—";
  }

  function buildWallMatrixHtml(wall){
    var grid = getBurnerGrid();
    var rows = Array.isArray(grid[wall]) ? grid[wall] : [];
    var selected = state.selectedCellKey || "";
    var html = ''
      + '<div class="m2-matrix-shell"><div class="m2-matrix-scroll"><div class="m2-matrix">'
      +   '<div class="m2-matrix-top"><div class="m2-axis">R/B</div>';
    for(var col = 1; col <= 15; col++){
      html += '<div class="m2-axis">' + col + '</div>';
    }
    html += '</div>';
    for(var ri = rows.length - 1; ri >= 0; ri--){
      html += '<div class="m2-matrix-row"><div class="m2-axis-row">R' + (ri + 1) + '</div>';
      for(var ci = 0; ci < 15; ci++){
        var stateCode = normalizeBurnerState(rows[ri] && rows[ri][ci]);
        var cellKey = wall + ":" + ri + ":" + ci;
        html += '<button'
          + ' type="button"'
          + ' class="m2-cell state-' + stateCode.toLowerCase() + (selected === cellKey ? ' is-selected' : '') + '"'
          + ' data-cell-wall="' + escapeHtml(wall) + '"'
          + ' data-cell-ri="' + ri + '"'
          + ' data-cell-ci="' + ci + '"'
          + ' aria-label="Wall ' + escapeHtml(wall) + ' row ' + (ri + 1) + ' burner ' + (ci + 1) + '">'
          + '</button>';
      }
      html += '</div>';
    }
    html += '</div></div></div>';
    return html;
  }

  function buildTrendsPaneHtml(){
    var dashState = window.__reformerDashState || null;
    var current = dashState && dashState.data ? dashState.data : {};
    var historyPoints = dashState && Array.isArray(dashState.historyPoints) ? dashState.historyPoints.slice() : [];
    var currentMetric = TREND_METRICS[state.trendMetric] || TREND_METRICS.hguLoad;
    return ''
      + buildBannerHtml("Performance trends", historyPoints.length ? "Single-chart mobile trends with key live indicators." : "Load live history only when needed, instead of shipping a heavy analytics wall on phone.")
      + '<section class="m2-grid-2">'
      +   buildMetricCardHtml("HGU Load", formatNumber(current.hguLoad, 1), "%")
      +   buildMetricCardHtml("Avg COT", formatAvgCot(current), "degC")
      +   buildMetricCardHtml("Excess O2", formatNumber(current.excessO2, 2), "%Vol")
      +   buildMetricCardHtml("Methane Slip", formatNumber(current.methaneSlip, 2), "%Vol")
      + '</section>'
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-card-title">Primary trend chart</div>'
      +   '<div class="m2-chart-switch">'
      +     Object.keys(TREND_METRICS).map(function(key){
              var item = TREND_METRICS[key];
              return '<button class="m2-chip' + (state.trendMetric === key ? ' is-active' : '') + '" type="button" data-trend-metric="' + escapeHtml(key) + '">' + escapeHtml(item.label) + '</button>';
            }).join("")
      +   '</div>'
      +   (historyPoints.length
          ? buildTrendChartHtml(historyPoints, currentMetric)
          : '<div class="m2-chart-card"><div class="m2-empty">No mobile trend history loaded yet. Tap refresh on this screen to pull the latest live history.</div></div>')
      + '</div></section>'
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-card-title">What matters</div>'
      +   '<div class="m2-list" style="margin-top:14px;">'
      +     buildListItemHtml(currentMetric.label + " latest", getMetricLatestCopy(historyPoints, currentMetric))
      +     buildListItemHtml("History window", historyPoints.length ? (historyPoints.length + " recent samples from the plant feed") : "Waiting for live history")
      +     buildListItemHtml("Mobile focus", "One live chart at a time keeps the phone view fast and readable.")
      +   '</div>'
      + '</div></section>';
  }

  function buildMetricCardHtml(label, value, unit){
    return ''
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-stat-label">' + escapeHtml(label) + '</div>'
      +   '<div class="m2-stat-value">' + escapeHtml(value) + '</div>'
      +   '<div class="m2-card-copy">' + escapeHtml(unit) + '</div>'
      + '</div></section>';
  }

  function buildActionButtonHtml(label, attrs, tone){
    var attrText = "";
    Object.keys(attrs || {}).forEach(function(key){
      attrText += " " + key + '="' + escapeHtml(attrs[key]) + '"';
    });
    return '<button class="m2-inline-btn' + (tone ? (' ' + tone) : '') + '" type="button"' + attrText + '>' + escapeHtml(label) + '</button>';
  }

  function buildActionRowHtml(buttons){
    return buttons && buttons.length ? ('<div class="m2-list-actions">' + buttons.join("") + '</div>') : "";
  }

  function buildShiftOptionsHtml(selected){
    var options = ["Morning", "Evening", "Night"];
    return options.map(function(label){
      return '<option value="' + escapeHtml(label) + '"' + (selected === label ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    }).join("");
  }

  function buildBurnerStateOptionsHtml(selected){
    var options = [
      { value: "B", label: "Both" },
      { value: "N", label: "NG only" },
      { value: "O", label: "Off gas" },
      { value: "C", label: "Cold" }
    ];
    return options.map(function(item){
      return '<option value="' + item.value + '"' + (selected === item.value ? ' selected' : '') + '>' + escapeHtml(item.label) + '</option>';
    }).join("");
  }

  function buildTstRecordListItemHtml(record){
    var entry = record && record.entry ? record.entry : null;
    var index = record ? record.originalIndex : -1;
    if(!entry) return "";
    return ''
      + '<div class="m2-list-item">'
      +   '<div class="m2-list-title">' + escapeHtml((entry.shift || "Saved entry") + " · " + formatDateTime(entry.dt)) + '</div>'
      +   '<div class="m2-list-meta">Filled peep values: ' + escapeHtml(countFilledPeepValues(entry)) + '</div>'
      +   buildActionRowHtml([
            buildActionButtonHtml("View", { "data-entry-view": index }),
            buildActionButtonHtml("Edit", { "data-entry-edit": index })
          ])
      + '</div>';
  }

  function buildTstProcessFieldsHtml(draft){
    return getProcessBindings().map(function(binding){
      var value = draft.processValues[binding.key] || "";
      var label = binding.exportLabel || binding.label || binding.key;
      return ''
        + '<label class="m2-field">'
        +   '<span class="m2-field-label">' + escapeHtml(label) + '</span>'
        +   '<input class="m2-input" type="text" inputmode="decimal" data-tst-field-key="' + escapeHtml(binding.key) + '" value="' + escapeHtml(value) + '">'
        + '</label>';
    }).join("");
  }

  function buildTstPeepRowsHtml(draft){
    return TST_ROW_KEYS.map(function(rowKey){
      var values = draft.peepHoles[rowKey] || [];
      return ''
        + '<div class="m2-peep-row">'
        +   '<div class="m2-peep-label">' + escapeHtml(TST_ROW_LABELS[rowKey] || rowKey) + '</div>'
        +   '<div class="m2-peep-values">'
        +     Array.from({ length: 15 }, function(_, index){
              return '<input class="m2-peep-input" type="text" inputmode="decimal" data-tst-peep-row="' + escapeHtml(rowKey) + '" data-tst-peep-index="' + index + '" value="' + escapeHtml(values[index] || "") + '" placeholder="' + (index + 1) + '">';
            }).join("")
        +   '</div>'
        + '</div>';
    }).join("");
  }

  function buildTstReadonlyRowsHtml(entry){
    return TST_ROW_KEYS.map(function(rowKey){
      var values = entry && entry.peepHoles && Array.isArray(entry.peepHoles[rowKey]) ? entry.peepHoles[rowKey] : [];
      return ''
        + '<div class="m2-peep-readonly">'
        +   '<div class="m2-peep-label">' + escapeHtml(TST_ROW_LABELS[rowKey] || rowKey) + '</div>'
        +   '<div class="m2-row-values">'
        +     Array.from({ length: 15 }, function(_, index){
              var raw = values[index];
              return '<span class="m2-row-value">' + escapeHtml(raw == null || raw === "" ? "—" : raw) + '</span>';
            }).join("")
        +   '</div>'
        + '</div>';
    }).join("");
  }

  function formatAvgCot(current){
    var values = [toNumber(current.abCot), toNumber(current.cdCot)].filter(isFiniteNumber);
    if(!values.length) return "—";
    var avg = values.reduce(function(sum, item){ return sum + item; }, 0) / values.length;
    return formatNumber(avg, 1);
  }

  function getMetricLatestCopy(points, metric){
    if(!points.length) return "Waiting for live history";
    var latest = metric.accessor(points[points.length - 1]);
    return escapeHtml(metric.label + " " + formatNumber(latest, metric.unit === "degC" ? 1 : 2) + " " + metric.unit);
  }

  function buildTrendChartHtml(points, metric){
    var values = points.map(metric.accessor).filter(isFiniteNumber);
    if(!values.length){
      return '<div class="m2-chart-card"><div class="m2-empty">No valid ' + escapeHtml(metric.label) + ' points yet.</div></div>';
    }
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    if(min === max){
      min -= 1;
      max += 1;
    }
    var width = 320;
    var height = 176;
    var paddingX = 18;
    var paddingY = 20;
    var usableWidth = width - (paddingX * 2);
    var usableHeight = height - (paddingY * 2);
    var path = "";
    var lastPoint = null;
    points.forEach(function(point, index){
      var val = metric.accessor(point);
      if(!isFiniteNumber(val)) return;
      var x = paddingX + (usableWidth * (points.length <= 1 ? 0 : index / (points.length - 1)));
      var y = paddingY + usableHeight - (((val - min) / (max - min)) * usableHeight);
      path += (path ? " L " : "M ") + x.toFixed(1) + " " + y.toFixed(1);
      lastPoint = { x: x, y: y, value: val };
    });
    return ''
      + '<div class="m2-chart-card">'
      +   '<div class="m2-chip-row">'
      +     buildChipHtml("Min", formatNumber(min, metric.unit === "degC" ? 1 : 2))
      +     buildChipHtml("Max", formatNumber(max, metric.unit === "degC" ? 1 : 2))
      +     buildChipHtml("Latest", formatNumber(lastPoint ? lastPoint.value : null, metric.unit === "degC" ? 1 : 2))
      +   '</div>'
      +   '<div class="m2-chart-frame">'
      +     '<svg class="m2-chart-svg" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" aria-hidden="true">'
      +       '<line class="m2-chart-axis" x1="' + paddingX + '" y1="' + (paddingY + usableHeight) + '" x2="' + (paddingX + usableWidth) + '" y2="' + (paddingY + usableHeight) + '"></line>'
      +       '<line class="m2-chart-axis" x1="' + paddingX + '" y1="' + paddingY + '" x2="' + paddingX + '" y2="' + (paddingY + usableHeight) + '"></line>'
      +       '<path class="m2-chart-path" d="' + path + '" style="stroke:' + escapeHtml(metric.color) + ';"></path>'
      +       (lastPoint ? '<circle class="m2-chart-dot" cx="' + lastPoint.x.toFixed(1) + '" cy="' + lastPoint.y.toFixed(1) + '" r="5" fill="' + escapeHtml(metric.color) + '"></circle>' : '')
      +     '</svg>'
      +   '</div>'
      + '</div>';
  }

  function buildLogsPaneHtml(){
    var records = getTempEntryRecords();
    var latestRecord = records[0] || null;
    var latestEntry = latestRecord ? latestRecord.entry : null;
    var cleaning = getCleaningStats();
    var entries = records.slice(0, 4);
    return ''
      + buildBannerHtml("Latest process snapshot", latestEntry ? ((latestEntry.shift || "Saved entry") + " · " + formatDateTime(latestEntry.dt)) : "No saved TST entries yet.", latestEntry ? "good" : "warning")
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-eyebrow">Latest snapshot</div>'
      +   '<div class="m2-hero-row" style="margin-top:8px;">'
      +     '<div>'
      +       '<div class="m2-chamber-status">' + escapeHtml(latestEntry ? (latestEntry.shift || "Latest") : "No TST") + '</div>'
      +       '<div class="m2-card-copy">' + escapeHtml(latestEntry ? formatDateTime(latestEntry.dt) : "Create the first TST entry when needed.") + '</div>'
      +     '</div>'
      +     '<div class="m2-live-stack">'
      +       '<div class="m2-live-pill">' + escapeHtml(latestEntry ? (countFilledPeepValues(latestEntry) + " points") : "Pending") + '</div>'
      +     '</div>'
      +   '</div>'
      +   buildActionRowHtml(latestRecord
            ? [
                buildActionButtonHtml("View latest", { "data-entry-view": latestRecord.originalIndex }),
                buildActionButtonHtml("Edit latest", { "data-entry-edit": latestRecord.originalIndex }),
                buildActionButtonHtml("New TST", { "data-action": "open-tst-new" }, "is-primary")
              ]
            : [
                buildActionButtonHtml("New TST", { "data-action": "open-tst-new" }, "is-primary"),
                buildActionButtonHtml("Download format", { "data-action": "download-tst-format" })
              ])
      + '</div></section>'
      + '<section class="m2-grid-2">'
      +   buildMetricCardHtml("Cleaned", String(cleaning.cleaned), "logged burners")
      +   buildMetricCardHtml("Pending", String(cleaning.pending), "not logged")
      +   buildMetricCardHtml("Recent 7d", String(cleaning.recent7), "cleaning updates")
      +   buildMetricCardHtml("History", String(records.length), "saved snapshots")
      + '</section>'
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-card-title">Recent records</div>'
      +   '<div class="m2-list" style="margin-top:14px;">'
      +     (entries.length
              ? entries.map(buildTstRecordListItemHtml).join("")
              : '<div class="m2-empty">No saved entries yet. Create the first mobile TST entry from this screen.</div>')
      +   '</div>'
      + '</div></section>';
  }

  function buildListItemHtml(title, copy){
    return ''
      + '<div class="m2-list-item">'
      +   '<div class="m2-list-title">' + escapeHtml(title) + '</div>'
      +   '<div class="m2-list-meta">' + escapeHtml(copy) + '</div>'
      + '</div>';
  }

  function buildAlarmsPaneHtml(){
    var active = getActiveAlarms();
    var resolved = getResolvedAlarms().slice(0, 3);
    var counts = {
      critical: active.filter(function(item){ return getAlarmTone(item) === "critical"; }).length,
      major: active.filter(function(item){ return getAlarmTone(item) === "major"; }).length,
      warning: active.filter(function(item){ return getAlarmTone(item) === "warning"; }).length,
      all: active.length
    };
    var filtered = active.filter(function(item){
      if(state.alarmFilter === "all") return true;
      return getAlarmTone(item) === state.alarmFilter;
    });

    return ''
      + buildBannerHtml(
          active.length ? "Priority-first alarm feed" : "No active alarms",
          active.length ? "Critical and major alarms stay closest to the top, with one-tap acknowledgement." : "Resolved items stay available below for quick review.",
          active.length ? getAlarmTone(active[0]) : "good"
        )
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-card-title">Severity filters</div>'
      +   '<div class="m2-chip-row" style="margin-top:14px;">'
      +     buildAlarmFilterChip("critical", "CRIT " + counts.critical)
      +     buildAlarmFilterChip("major", "MAJ " + counts.major)
      +     buildAlarmFilterChip("warning", "WARN " + counts.warning)
      +     buildAlarmFilterChip("all", "ALL " + counts.all)
      +   '</div>'
      + '</div></section>'
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">'
      +     '<div class="m2-card-title">Live alarm feed</div>'
      +     (active.length ? '<button class="m2-chip" type="button" data-action="ack-all">Acknowledge all</button>' : '')
      +   '</div>'
      +   '<div class="m2-list" style="margin-top:14px;">'
      +     (filtered.length ? filtered.map(buildAlarmCardHtml).join("") : '<div class="m2-empty">No alarms in this filter right now.</div>')
      +   '</div>'
      + '</div></section>'
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-card-title">Recent resolved</div>'
      +   '<div class="m2-list" style="margin-top:14px;">'
      +     (resolved.length ? resolved.map(function(item){
              return buildListItemHtml(getAlarmTitle(item), formatDateTime(item.ts));
            }).join("") : '<div class="m2-empty">Resolved alarms will appear here after acknowledgement.</div>')
      +   '</div>'
      + '</div></section>';
  }

  function buildAlarmFilterChip(filter, label){
    return '<button class="m2-chip' + (state.alarmFilter === filter ? ' is-active' : '') + '" type="button" data-alarm-filter="' + escapeHtml(filter) + '">' + escapeHtml(label) + '</button>';
  }

  function buildAlarmCardHtml(alarm){
    var tone = severityTone(getAlarmTone(alarm));
    return ''
      + '<div class="m2-alarm-card tone-' + tone + '">'
      +   '<div class="m2-alarm-title">' + escapeHtml(getAlarmTitle(alarm)) + '</div>'
      +   '<div class="m2-alarm-copy">' + escapeHtml(getAlarmSummary(alarm)) + '</div>'
      +   '<div class="m2-alarm-meta">'
      +     '<div class="m2-alarm-time">' + escapeHtml(formatDateTime(alarm.ts)) + '</div>'
      +     '<button class="m2-ack-btn" type="button" data-ack-id="' + escapeHtml(alarm.id) + '">Acknowledge</button>'
      +   '</div>'
      + '</div>';
  }

  function buildTstReadonlyFieldsHtml(entry){
    return getProcessBindings().map(function(binding){
      var raw = typeof window.getTdProcessEntryValue === "function"
        ? window.getTdProcessEntryValue(entry, binding.key)
        : (entry ? entry[binding.key] : "");
      var formatted = typeof window.formatTdProcessFieldValue === "function"
        ? window.formatTdProcessFieldValue(binding, raw)
        : String(raw == null ? "" : raw);
      return ''
        + '<div class="m2-field is-static">'
        +   '<span class="m2-field-label">' + escapeHtml(binding.exportLabel || binding.label || binding.key) + '</span>'
        +   '<div class="m2-field-static-value">' + escapeHtml(formatted || "—") + '</div>'
        + '</div>';
    }).join("");
  }

  function buildCellEditorSheetHtml(payload){
    if(!payload) return "";
    var wall = payload.wall;
    var ri = payload.ri;
    var ci = payload.ci;
    var grid = getBurnerGrid();
    var rows = Array.isArray(grid[wall]) ? grid[wall] : [];
    var stateCode = normalizeBurnerState(rows[ri] && rows[ri][ci]);
    var opening = getOpeningValue(wall, ri, ci, stateCode);
    var cleanDate = getCleaningDateForCell(wall, ri, ci);
    var latestEntry = getLatestTempEntry();
    var displayCleanDate = cleanDate || "Not logged";
    var openingDisabled = stateCode === "C" ? ' disabled' : "";
    return ''
      + '<div class="m2-sheet is-open">'
      +   '<div class="m2-sheet-backdrop" data-action="sheet-close"></div>'
      +   '<div class="m2-sheet-panel">'
      +     '<div class="m2-sheet-handle"></div>'
      +     '<div class="m2-sheet-title">Wall ' + escapeHtml(wall) + ' · Row ' + (ri + 1) + ' · Burner ' + (ci + 1) + '</div>'
      +     '<div class="m2-sheet-copy">Adjust state, opening, and cleaning directly from the mobile wall view.</div>'
      +     '<div class="m2-inline-grid">'
      +       '<div class="m2-inline-block"><div class="m2-stat-label">Current state</div><div class="m2-mini-value">' + escapeHtml(getStateLabel(stateCode)) + '</div></div>'
      +       '<div class="m2-inline-block"><div class="m2-stat-label">Opening</div><div class="m2-mini-value" data-cell-opening-preview>' + escapeHtml(opening + "%") + '</div></div>'
      +       '<div class="m2-inline-block"><div class="m2-stat-label">Last cleaned</div><div class="m2-mini-value">' + escapeHtml(displayCleanDate) + '</div></div>'
      +       '<div class="m2-inline-block"><div class="m2-stat-label">Latest TST</div><div class="m2-mini-value">' + escapeHtml(latestEntry ? formatTimeAgo(latestEntry.dt) : "No TST") + '</div></div>'
      +     '</div>'
      +     '<div class="m2-form-grid m2-form-grid-tight">'
      +       '<label class="m2-field">'
      +         '<span class="m2-field-label">Burner state</span>'
      +         '<select class="m2-select" data-cell-state>'
      +           buildBurnerStateOptionsHtml(stateCode)
      +         '</select>'
      +       '</label>'
      +       '<label class="m2-field">'
      +         '<span class="m2-field-label">Opening</span>'
      +         '<div class="m2-range-row">'
      +           '<input class="m2-range" type="range" min="0" max="100" step="5" data-cell-opening value="' + escapeHtml(opening) + '"' + openingDisabled + '>'
      +           '<strong class="m2-range-value" data-cell-opening-label>' + escapeHtml(opening + "%") + '</strong>'
      +         '</div>'
      +       '</label>'
      +       '<label class="m2-field m2-field-wide">'
      +         '<span class="m2-field-label">Log cleaning date</span>'
      +         '<input class="m2-input" type="date" data-cell-cleaning-date value="' + escapeHtml(cleanDate || "") + '">'
      +       '</label>'
      +     '</div>'
      +     '<div class="m2-sheet-actions">'
      +       '<button class="m2-tool-btn" type="button" data-action="save-cell">Save burner update</button>'
      +       '<button class="m2-tool-btn" type="button" data-action="log-cleaning">Add cleaning log</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function buildTstFormSheetHtml(payload){
    var editIndex = payload && typeof payload.editIndex === "number" ? payload.editIndex : -1;
    var entry = editIndex >= 0 ? getTempEntryByIndex(editIndex) : null;
    var draft = buildTstDraft(entry);
    return ''
      + '<div class="m2-sheet is-open">'
      +   '<div class="m2-sheet-backdrop" data-action="sheet-close"></div>'
      +   '<div class="m2-sheet-panel">'
      +     '<div class="m2-sheet-handle"></div>'
      +     '<div class="m2-sheet-title">' + escapeHtml(editIndex >= 0 ? "Edit TST entry" : "New TST entry") + '</div>'
      +     '<div class="m2-sheet-copy">Fill process values and peep-hole readings directly in the mobile flow.</div>'
      +     '<div class="m2-form-grid">'
      +       '<label class="m2-field">'
      +         '<span class="m2-field-label">Date & time</span>'
      +         '<input class="m2-input" type="datetime-local" data-tst-dt value="' + escapeHtml(draft.dt) + '">'
      +       '</label>'
      +       '<label class="m2-field">'
      +         '<span class="m2-field-label">Shift</span>'
      +         '<select class="m2-select" data-tst-shift>'
      +           '<option value="">Select shift</option>'
      +           buildShiftOptionsHtml(draft.shift)
      +         '</select>'
      +       '</label>'
      +       buildTstProcessFieldsHtml(draft)
      +     '</div>'
      +     '<div class="m2-sheet-section">Peep-hole readings</div>'
      +     '<div class="m2-peep-shell">'
      +       buildTstPeepRowsHtml(draft)
      +     '</div>'
      +     '<div class="m2-sheet-actions">'
      +       '<button class="m2-tool-btn" type="button" data-action="save-tst">' + escapeHtml(editIndex >= 0 ? "Update TST" : "Save TST") + '</button>'
      +       '<button class="m2-tool-btn" type="button" data-action="sheet-close">Cancel</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function buildTstViewSheetHtml(payload){
    var index = payload && typeof payload.index === "number" ? payload.index : -1;
    var entry = getTempEntryByIndex(index);
    if(!entry){
      return ''
        + '<div class="m2-sheet is-open">'
        +   '<div class="m2-sheet-backdrop" data-action="sheet-close"></div>'
        +   '<div class="m2-sheet-panel">'
        +     '<div class="m2-sheet-handle"></div>'
        +     '<div class="m2-sheet-title">Record unavailable</div>'
        +     '<div class="m2-sheet-copy">This TST record is no longer available.</div>'
        +   '</div>'
        + '</div>';
    }
    return ''
      + '<div class="m2-sheet is-open">'
      +   '<div class="m2-sheet-backdrop" data-action="sheet-close"></div>'
      +   '<div class="m2-sheet-panel">'
      +     '<div class="m2-sheet-handle"></div>'
      +     '<div class="m2-sheet-title">' + escapeHtml((entry.shift || "Saved entry") + " · " + formatDateTime(entry.dt)) + '</div>'
      +     '<div class="m2-sheet-copy">' + escapeHtml(countFilledPeepValues(entry) + " peep-hole values captured in this snapshot.") + '</div>'
      +     '<div class="m2-inline-grid">'
      +       '<div class="m2-inline-block"><div class="m2-stat-label">Shift</div><div class="m2-mini-value">' + escapeHtml(entry.shift || "—") + '</div></div>'
      +       '<div class="m2-inline-block"><div class="m2-stat-label">Saved</div><div class="m2-mini-value">' + escapeHtml(formatTimeAgo(entry.dt)) + '</div></div>'
      +       '<div class="m2-inline-block"><div class="m2-stat-label">Filled points</div><div class="m2-mini-value">' + escapeHtml(countFilledPeepValues(entry)) + '</div></div>'
      +       '<div class="m2-inline-block"><div class="m2-stat-label">Burner snapshot</div><div class="m2-mini-value">' + escapeHtml(entry.burnerSnapshot ? "Attached" : "Not saved") + '</div></div>'
      +     '</div>'
      +     '<div class="m2-sheet-section">Process values</div>'
      +     '<div class="m2-form-grid">'
      +       buildTstReadonlyFieldsHtml(entry)
      +     '</div>'
      +     '<div class="m2-sheet-section">Peep-hole readings</div>'
      +     '<div class="m2-peep-shell is-readonly">'
      +       buildTstReadonlyRowsHtml(entry)
      +     '</div>'
      +     '<div class="m2-sheet-actions">'
      +       '<button class="m2-tool-btn" type="button" data-entry-edit="' + escapeHtml(index) + '">Edit entry</button>'
      +       '<button class="m2-tool-btn" type="button" data-entry-delete="' + escapeHtml(index) + '">Delete entry</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function buildSheetHtml(){
    if(!state.sheetKind) return "";
    if(state.sheetKind === "tools"){
      var isLight = document.body && document.body.classList.contains("light-theme");
      var showInstallAction = !isStandaloneInstalled();
      return ''
        + '<div class="m2-sheet is-open">'
        +   '<div class="m2-sheet-backdrop" data-action="sheet-close"></div>'
        +   '<div class="m2-sheet-panel">'
        +     '<div class="m2-sheet-handle"></div>'
        +     '<div class="m2-sheet-title">Quick actions</div>'
        +     '<div class="m2-sheet-copy">Lightweight mobile controls only, with no desktop fallback shortcuts.</div>'
        +     '<div class="m2-tools-grid">'
        +       '<button class="m2-tool-btn" type="button" data-action="refresh-shell">Refresh live data</button>'
        +       (showInstallAction ? '<button class="m2-tool-btn" type="button" data-action="install-app">Install app</button>' : '')
        +       '<button class="m2-tool-btn" type="button" data-action="toggle-theme">' + (isLight ? "Switch to dark mode" : "Switch to light mode") + '</button>'
        +       '<button class="m2-tool-btn" type="button" data-action="open-tst-new">New TST entry</button>'
        +       '<button class="m2-tool-btn" type="button" data-action="download-tst-format">Download TST format</button>'
        +       '<button class="m2-tool-btn wide" type="button" data-action="logout-shell">Logout</button>'
        +     '</div>'
        +   '</div>'
        + '</div>';
    }
    if(state.sheetKind === "cell" && state.sheetPayload){
      return buildCellEditorSheetHtml(state.sheetPayload);
    }
    if(state.sheetKind === "tst-form"){
      return buildTstFormSheetHtml(state.sheetPayload);
    }
    if(state.sheetKind === "tst-view"){
      return buildTstViewSheetHtml(state.sheetPayload);
    }
    return "";
  }

  function getStateLabel(code){
    if(typeof window.getBurnerStateLabel === "function"){
      return window.getBurnerStateLabel(code);
    }
    return code === "B" ? "Both" : code === "N" ? "NG only" : code === "O" ? "Off gas" : "Cold";
  }

  function render(){
    if(!ensureMountedState()) return;
    var shell = ensureRoot();
    shell.innerHTML = buildShellHtml();
    bindRootEvents();
    if(state.activeTab === "trends"){
      var dashState = window.__reformerDashState || null;
      if(!dashState || !dashState.lastFetchAt){
        requestTrendData(false);
      }
    }
  }

  function ensureMountedState(){
    var active = isMobileShellActive();
    var mountedRoot = ensureRoot();
    if(!document.body) return false;
    if(active){
      document.body.setAttribute("data-mobile-v2", "1");
      document.body.removeAttribute("data-mobile-legacy");
    }else{
      document.body.removeAttribute("data-mobile-v2");
      document.body.removeAttribute("data-mobile-legacy");
      mountedRoot.innerHTML = "";
      state.sheetKind = "";
      state.sheetPayload = null;
      return false;
    }
    return true;
  }

  function buildShellHtml(){
    return ''
      + '<div class="m2-shell">'
      +   '<header class="m2-head">'
      +     '<div class="m2-brand">'
      +       '<div class="m2-brand-kicker">Industrial monitoring</div>'
      +       '<div class="m2-brand-title">Reformer SCADA</div>'
      +       '<div class="m2-brand-subtitle">' + escapeHtml(TAB_LABELS[state.activeTab] || "Mobile monitoring") + '</div>'
      +     '</div>'
      +     '<div class="m2-head-actions">'
      +       '<button class="m2-icon-btn" type="button" title="Refresh live data" data-action="refresh-shell">&#8635;</button>'
      +       '<button class="m2-icon-btn" type="button" title="Quick actions" data-action="open-tools">&#8942;</button>'
      +     '</div>'
      +   '</header>'
      +   '<div class="m2-pane' + (state.activeTab === "home" ? ' is-active' : '') + '">' + (state.activeTab === "home" ? buildHomePaneHtml() : "") + '</div>'
      +   '<div class="m2-pane' + (state.activeTab === "walls" ? ' is-active' : '') + '">' + (state.activeTab === "walls" ? buildWallsPaneHtml() : "") + '</div>'
      +   '<div class="m2-pane' + (state.activeTab === "trends" ? ' is-active' : '') + '">' + (state.activeTab === "trends" ? buildTrendsPaneHtml() : "") + '</div>'
      +   '<div class="m2-pane' + (state.activeTab === "logs" ? ' is-active' : '') + '">' + (state.activeTab === "logs" ? buildLogsPaneHtml() : "") + '</div>'
      +   '<div class="m2-pane' + (state.activeTab === "alarms" ? ' is-active' : '') + '">' + (state.activeTab === "alarms" ? buildAlarmsPaneHtml() : "") + '</div>'
      +   '<nav class="m2-nav" aria-label="Mobile app navigation">'
      +     buildNavButtonHtml("home", "HOME")
      +     buildNavButtonHtml("walls", "WALLS")
      +     buildNavButtonHtml("trends", "TRENDS")
      +     buildNavButtonHtml("logs", "LOGS")
      +     buildNavButtonHtml("alarms", "ALARMS")
      +   '</nav>'
      + '</div>'
      + buildSheetHtml();
  }

  function buildNavButtonHtml(key, label){
    return ''
      + '<button class="m2-nav-btn' + (state.activeTab === key ? ' is-active' : '') + '" type="button" data-nav-tab="' + escapeHtml(key) + '">'
      +   '<span class="m2-nav-icon"></span>'
      +   '<span>' + escapeHtml(label) + '</span>'
      + '</button>';
  }

  function openSheet(kind, payload){
    state.sheetKind = kind || "";
    state.sheetPayload = payload || null;
    scheduleRender();
  }

  function closeSheet(){
    state.sheetKind = "";
    state.sheetPayload = null;
    scheduleRender();
  }

  function syncCellSheetControls(source){
    var panel = source && typeof source.closest === "function"
      ? source.closest(".m2-sheet-panel")
      : ensureRoot().querySelector(".m2-sheet-panel");
    if(!panel) return;
    var stateSelect = panel.querySelector("[data-cell-state]");
    var openingInput = panel.querySelector("[data-cell-opening]");
    var openingLabel = panel.querySelector("[data-cell-opening-label]");
    var openingPreview = panel.querySelector("[data-cell-opening-preview]");
    if(stateSelect && openingInput){
      if(String(stateSelect.value || "C") === "C"){
        openingInput.value = "0";
        openingInput.disabled = true;
      }else{
        if(openingInput.disabled && Number(openingInput.value || 0) <= 0){
          openingInput.value = "100";
        }
        openingInput.disabled = false;
      }
    }
    if(openingInput && openingLabel){
      openingLabel.textContent = String(openingInput.value || 0) + "%";
    }
    if(openingInput && openingPreview){
      openingPreview.textContent = String(openingInput.value || 0) + "%";
    }
  }

  function readCellSheetDraft(){
    if(!state.sheetPayload) return null;
    var panel = ensureRoot().querySelector(".m2-sheet-panel");
    if(!panel) return null;
    var stateSelect = panel.querySelector("[data-cell-state]");
    var openingInput = panel.querySelector("[data-cell-opening]");
    var cleanInput = panel.querySelector("[data-cell-cleaning-date]");
    var nextState = normalizeBurnerState(stateSelect ? stateSelect.value : "C");
    var nextOpening = nextState === "C" ? 0 : clamp(Number(openingInput && openingInput.value), 0, 100);
    if(!isFiniteNumber(nextOpening)) nextOpening = nextState === "C" ? 0 : 100;
    return {
      wall: state.sheetPayload.wall,
      ri: state.sheetPayload.ri,
      ci: state.sheetPayload.ci,
      stateCode: nextState,
      opening: nextOpening,
      cleanDate: String(cleanInput && cleanInput.value || "").trim()
    };
  }

  function readTstSheetDraft(){
    var panel = ensureRoot().querySelector(".m2-sheet-panel");
    if(!panel) return null;
    var draft = {
      dt: String(panel.querySelector("[data-tst-dt]") && panel.querySelector("[data-tst-dt]").value || "").trim(),
      shift: String(panel.querySelector("[data-tst-shift]") && panel.querySelector("[data-tst-shift]").value || "").trim(),
      processValues: {},
      peepHoles: createEmptyPeepHoles()
    };
    getProcessBindings().forEach(function(binding){
      var input = panel.querySelector('[data-tst-field-key="' + binding.key + '"]');
      draft.processValues[binding.key] = String(input && input.value || "").trim();
    });
    TST_ROW_KEYS.forEach(function(rowKey){
      for(var i = 0; i < 15; i++){
        var peep = panel.querySelector('[data-tst-peep-row="' + rowKey + '"][data-tst-peep-index="' + i + '"]');
        draft.peepHoles[rowKey][i] = String(peep && peep.value || "").trim();
      }
    });
    return draft;
  }

  function bindRootEvents(){
    var shell = ensureRoot();
    shell.onclick = function(event){
      var target = event.target;
      var navBtn = target.closest("[data-nav-tab]");
      if(navBtn){
        state.activeTab = String(navBtn.getAttribute("data-nav-tab") || "home");
        state.sheetKind = "";
        state.sheetPayload = null;
        persistState();
        scheduleRender();
        return;
      }

      var wallBtn = target.closest("[data-wall]");
      if(wallBtn){
        state.wall = String(wallBtn.getAttribute("data-wall") || "A").toUpperCase();
        persistState();
        scheduleRender();
        return;
      }

      var metricBtn = target.closest("[data-trend-metric]");
      if(metricBtn){
        state.trendMetric = String(metricBtn.getAttribute("data-trend-metric") || "hguLoad");
        persistState();
        scheduleRender();
        return;
      }

      var filterBtn = target.closest("[data-alarm-filter]");
      if(filterBtn){
        state.alarmFilter = String(filterBtn.getAttribute("data-alarm-filter") || "all");
        persistState();
        scheduleRender();
        return;
      }

      var cellBtn = target.closest("[data-cell-wall]");
      if(cellBtn){
        state.selectedCellKey = String(cellBtn.getAttribute("data-cell-wall")) + ":" + cellBtn.getAttribute("data-cell-ri") + ":" + cellBtn.getAttribute("data-cell-ci");
        openSheet("cell", {
          wall: String(cellBtn.getAttribute("data-cell-wall")),
          ri: parseInt(cellBtn.getAttribute("data-cell-ri"), 10),
          ci: parseInt(cellBtn.getAttribute("data-cell-ci"), 10)
        });
        return;
      }

      var ackBtn = target.closest("[data-ack-id]");
      if(ackBtn){
        if(typeof window.acknowledgeAlarmById === "function"){
          window.acknowledgeAlarmById(Number(ackBtn.getAttribute("data-ack-id")));
        }
        ensureAlarmDataFresh(true);
        scheduleRender();
        return;
      }

      var entryViewBtn = target.closest("[data-entry-view]");
      if(entryViewBtn){
        openSheet("tst-view", {
          index: parseInt(entryViewBtn.getAttribute("data-entry-view"), 10)
        });
        return;
      }

      var entryEditBtn = target.closest("[data-entry-edit]");
      if(entryEditBtn){
        openSheet("tst-form", {
          editIndex: parseInt(entryEditBtn.getAttribute("data-entry-edit"), 10)
        });
        return;
      }

      var entryDeleteBtn = target.closest("[data-entry-delete]");
      if(entryDeleteBtn){
        var deleteIndex = parseInt(entryDeleteBtn.getAttribute("data-entry-delete"), 10);
        if(deleteIndex >= 0 && typeof window.confirm === "function" && !window.confirm("Delete this TST entry?")){
          return;
        }
        if(deleteTempEntryNative(deleteIndex)){
          closeSheet();
          syncMobileChanges("TST entry deleted.");
        }
        return;
      }

      var actionBtn = target.closest("[data-action]");
      if(actionBtn){
        handleAction(String(actionBtn.getAttribute("data-action") || ""));
      }
    };

    shell.oninput = function(event){
      var target = event.target;
      if(target && (target.matches("[data-cell-opening]") || target.matches("[data-cell-state]"))){
        syncCellSheetControls(target);
      }
    };

    shell.onchange = function(event){
      var target = event.target;
      if(target && (target.matches("[data-cell-opening]") || target.matches("[data-cell-state]"))){
        syncCellSheetControls(target);
      }
    };
  }

  function handleAction(action){
    if(action === "open-tools"){
      openSheet("tools");
      return;
    }
    if(action === "sheet-close"){
      closeSheet();
      return;
    }
    if(action === "refresh-shell"){
      state.sheetKind = "";
      state.sheetPayload = null;
      scheduleRender();
      refreshCurrentMobileView();
      return;
    }
    if(action === "install-app"){
      state.sheetKind = "";
      state.sheetPayload = null;
      if(typeof window.scadaOpenInstallPrompt === "function"){
        Promise.resolve(window.scadaOpenInstallPrompt(getInstallPlatform())).finally(scheduleRender);
      }else{
        var fallback = typeof window.scadaGetInstallFallbackMessage === "function"
          ? window.scadaGetInstallFallbackMessage(getInstallPlatform())
          : "Install prompt not available yet. Open the browser menu and choose Install app or Add to Home screen.";
        if(typeof window.alert === "function") window.alert(fallback);
        scheduleRender();
      }
      return;
    }
    if(action === "toggle-theme"){
      state.sheetKind = "";
      state.sheetPayload = null;
      if(typeof window.toggleTheme === "function" && document.body){
        window.toggleTheme(document.body.classList.contains("light-theme"));
      }
      scheduleRender();
      return;
    }
    if(action === "open-tst-new"){
      openSheet("tst-form", { editIndex: -1 });
      return;
    }
    if(action === "download-tst-format"){
      state.sheetKind = "";
      state.sheetPayload = null;
      if(typeof window.downloadTstTemplate === "function"){
        window.downloadTstTemplate();
      }
      scheduleRender();
      return;
    }
    if(action === "logout-shell"){
      if(typeof window.logout === "function") window.logout();
      return;
    }
    if(action === "ack-all"){
      if(typeof window.acknowledgeAllAlarms === "function"){
        window.acknowledgeAllAlarms();
      }
      ensureAlarmDataFresh(true);
      scheduleRender();
      return;
    }
    if(action === "save-cell"){
      var cellDraft = readCellSheetDraft();
      if(!cellDraft) return;
      saveBurnerCellNative(cellDraft.wall, cellDraft.ri, cellDraft.ci, cellDraft.stateCode, cellDraft.opening);
      closeSheet();
      syncMobileChanges("Burner update saved.");
      return;
    }
    if(action === "log-cleaning"){
      var cleaningDraft = readCellSheetDraft();
      if(!cleaningDraft || !cleaningDraft.cleanDate){
        showMobileToast("Select a cleaning date first.");
        return;
      }
      if(addCleaningEventNative(cleaningDraft.wall, cleaningDraft.ri, cleaningDraft.ci, cleaningDraft.cleanDate)){
        closeSheet();
        syncMobileChanges("Cleaning log saved.");
      }
      return;
    }
    if(action === "save-tst"){
      var tstDraft = readTstSheetDraft();
      var editIndex = state.sheetPayload && typeof state.sheetPayload.editIndex === "number" ? state.sheetPayload.editIndex : -1;
      if(!tstDraft || !tstDraft.dt){
        showMobileToast("Select a date and time first.");
        return;
      }
      if(!tstDraft.shift){
        showMobileToast("Select a shift first.");
        return;
      }
      saveTempEntryNative(tstDraft, editIndex);
      state.activeTab = "logs";
      persistState();
      closeSheet();
      syncMobileChanges(editIndex >= 0 ? "TST entry updated." : "TST entry saved.");
      return;
    }
  }

  function refreshCurrentMobileView(){
    var refreshPromise;
    if(typeof window.autoImportFromServer === "function"){
      refreshPromise = Promise.resolve(window.autoImportFromServer(true));
    }else if(typeof window.smartRefresh === "function"){
      refreshPromise = Promise.resolve(window.smartRefresh());
    }else{
      refreshPromise = Promise.resolve(typeof window.handleGlobalRefreshClick === "function" ? window.handleGlobalRefreshClick() : true);
    }
    refreshPromise.finally(function(){
      ensureAlarmDataFresh(true);
      if(state.activeTab === "trends"){
        requestTrendData(true);
      }else{
        scheduleRender();
      }
    });
  }

  function requestTrendData(force){
    var refreshFn = typeof window.refreshReformerDashboardLite === "function"
      ? window.refreshReformerDashboardLite
      : window.refreshReformerDashboard;
    if(typeof refreshFn !== "function"){
      scheduleRender();
      return;
    }
    if(!force && (Date.now() - lastTrendRequestAt) < 12000){
      return;
    }
    lastTrendRequestAt = Date.now();
    Promise.resolve(refreshFn(!!force)).finally(scheduleRender);
  }

  function scheduleRender(){
    clearTimeout(renderTimer);
    renderTimer = window.setTimeout(render, 50);
  }

  window.addEventListener("resize", function(){
    scheduleRender();
  }, { passive: true });

  window.addEventListener("orientationchange", function(){
    setTimeout(scheduleRender, 120);
  });

  window.addEventListener("appinstalled", scheduleRender);
  window.addEventListener("pageshow", scheduleRender);
  window.addEventListener("storage", scheduleRender);
  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState === "visible") scheduleRender();
  });
  document.addEventListener("keydown", function(event){
    if(event.key !== "Escape") return;
    if(state.sheetKind){
      state.sheetKind = "";
      state.sheetPayload = null;
      scheduleRender();
      return;
    }
  });

  window.scadaUpdateMobileShell = function(){
    scheduleRender();
  };

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", function(){
      render();
    });
  }else{
    render();
  }
})();
