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
  var state = {
    activeTab: readStored("active-tab", "home"),
    wall: readStored("wall", "A"),
    trendMetric: readStored("trend-metric", "hguLoad"),
    alarmFilter: readStored("alarm-filter", "all"),
    sheetKind: "",
    sheetPayload: null,
    legacyMode: false,
    selectedCellKey: ""
  };
  var root = null;
  var renderTimer = 0;
  var refreshInterval = 0;
  var hooksInstalled = false;
  var primedAnalysis = false;
  var lastTrendRequestAt = 0;

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

  function ensureAnalysisPayload(){
    if(primedAnalysis) return;
    primedAnalysis = true;
    try{
      if(typeof window.generateAnalysis === "function"){
        window.generateAnalysis({ skipRender: true });
      }
    }catch(e){}
  }

  function getLatestBurnerAnalysisPayload(){
    ensureAnalysisPayload();
    return window._latestBurnerAnalysisPayload && typeof window._latestBurnerAnalysisPayload === "object"
      ? window._latestBurnerAnalysisPayload
      : null;
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

  function buildWallSummary(wall){
    var payload = getLatestBurnerAnalysisPayload();
    var payloadEntry = null;
    if(payload && Array.isArray(payload.wallEntries)){
      payloadEntry = payload.wallEntries.find(function(item){
        return String(item && (item.wallName || item.displayName) || "").replace(/^Wall\s+/i, "").toUpperCase() === String(wall).toUpperCase();
      }) || null;
    }
    var grid = getBurnerGrid();
    var rows = Array.isArray(grid[wall]) ? grid[wall] : [];
    var counts = { B:0, N:0, O:0, C:0 };
    rows.forEach(function(row){
      (Array.isArray(row) ? row : []).forEach(function(cell){
        counts[normalizeBurnerState(cell)] += 1;
      });
    });
    var severity = payloadEntry && payloadEntry.sev ? String(payloadEntry.sev).toLowerCase() : getWallSeverity(wall);
    var issueCopy = payloadEntry && payloadEntry.desc
      ? payloadEntry.desc
      : (severity === "normal" ? "Balanced burner mix" : ("Wall " + wall + " needs review"));
    var actionCopy = payloadEntry && payloadEntry.action
      ? payloadEntry.action
      : (severity === "normal" ? "No immediate action required." : "Open wall view for burner-level monitoring.");
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
    return Array.isArray(window.alarmLog) ? window.alarmLog.filter(function(item){ return !item.acked; }) : [];
  }

  function getResolvedAlarms(){
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
      return buildBannerHtml("Stable wall view", "2D burner monitoring is now the primary phone surface. 3D stays optional.");
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
      +   '<div class="m2-card-copy">Single-wall 2D monitoring replaces the twin-cuboid landing surface on mobile.</div>'
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
      +   '<div class="m2-card-copy">You can scan one wall instantly, tap any burner for details, and only open 3D when you actually need it.</div>'
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
      + buildBannerHtml("Performance trends", historyPoints.length ? "Single-chart mobile trends with key live indicators." : "Load live history only when needed, instead of shipping a full desktop analytics wall.")
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
      +     buildListItemHtml("Classic analytics", "Open the classic dashboard only when you need the full multi-chart desktop stack.")
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
    var latestEntry = getLatestTempEntry();
    var cleaning = getCleaningStats();
    var entries = getTempEntries().slice(0, 4);
    return ''
      + buildBannerHtml("Latest process snapshot", latestEntry ? ((latestEntry.shift || "Saved entry") + " · " + formatDateTime(latestEntry.dt)) : "No saved TST entries yet.", latestEntry ? "good" : "warning")
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-eyebrow">Latest snapshot</div>'
      +   '<div class="m2-hero-row" style="margin-top:8px;">'
      +     '<div>'
      +       '<div class="m2-chamber-status">' + escapeHtml(latestEntry ? (latestEntry.shift || "Latest") : "No TST") + '</div>'
      +       '<div class="m2-card-copy">' + escapeHtml(latestEntry ? formatDateTime(latestEntry.dt) : "Start with classic TST entry when needed.") + '</div>'
      +     '</div>'
      +     '<div class="m2-live-stack">'
      +       '<div class="m2-live-pill">' + escapeHtml(latestEntry ? (countFilledPeepValues(latestEntry) + " points") : "Pending") + '</div>'
      +     '</div>'
      +   '</div>'
      + '</div></section>'
      + '<section class="m2-grid-2">'
      +   buildMetricCardHtml("Cleaned", String(cleaning.cleaned), "logged burners")
      +   buildMetricCardHtml("Pending", String(cleaning.pending), "not logged")
      +   buildMetricCardHtml("Recent 7d", String(cleaning.recent7), "cleaning updates")
      +   buildMetricCardHtml("History", String(entries.length), "saved snapshots")
      + '</section>'
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-card-title">Recent records</div>'
      +   '<div class="m2-list" style="margin-top:14px;">'
      +     (entries.length
              ? entries.map(function(entry){
                  return buildListItemHtml(
                    (entry.shift || "Saved entry") + " · " + formatDateTime(entry.dt),
                    "Filled peep values: " + countFilledPeepValues(entry)
                  );
                }).join("")
              : '<div class="m2-empty">No saved entries yet. Classic operator tools remain available from this screen.</div>')
      +   '</div>'
      + '</div></section>'
      + '<section class="m2-card"><div class="m2-card-pad">'
      +   '<div class="m2-card-title">Classic operator tools</div>'
      +   '<div class="m2-card-copy">Desktop-style editing remains available behind these secondary actions so the main mobile flow stays clean.</div>'
      +   '<div class="m2-tools-grid">'
      +     buildToolButtonHtml("Open TST entry", "tempdata")
      +     buildToolButtonHtml("Open burner editor", "burner")
      +     buildToolButtonHtml("Open cleaning log", "cleaning")
      +     buildToolButtonHtml("Open 3D dashboard", "cuboidstack")
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

  function buildToolButtonHtml(label, tab){
    return '<button class="m2-tool-btn" type="button" data-legacy-tab="' + escapeHtml(tab) + '">' + escapeHtml(label) + '</button>';
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
        +     '<div class="m2-sheet-copy">Mobile-first monitoring stays in front. Classic tools stay one tap away.</div>'
        +     '<div class="m2-tools-grid">'
        +       '<button class="m2-tool-btn" type="button" data-action="refresh-shell">Refresh live data</button>'
        +       (showInstallAction ? '<button class="m2-tool-btn" type="button" data-action="install-app">Install app</button>' : '')
        +       '<button class="m2-tool-btn" type="button" data-action="toggle-theme">' + (isLight ? "Switch to dark mode" : "Switch to light mode") + '</button>'
        +       buildToolButtonHtml("Classic burner tools", "burner")
        +       buildToolButtonHtml("Classic cleaning tools", "cleaning")
        +       buildToolButtonHtml("Classic TST tools", "tempdata")
        +       buildToolButtonHtml("Classic 3D dashboard", "cuboidstack")
        +       '<button class="m2-tool-btn wide" type="button" data-action="logout-shell">Logout</button>'
        +     '</div>'
        +   '</div>'
        + '</div>';
    }
    if(state.sheetKind === "cell" && state.sheetPayload){
      var payload = state.sheetPayload;
      var wall = payload.wall;
      var ri = payload.ri;
      var ci = payload.ci;
      var grid = getBurnerGrid();
      var rows = Array.isArray(grid[wall]) ? grid[wall] : [];
      var stateCode = normalizeBurnerState(rows[ri] && rows[ri][ci]);
      var opening = getOpeningValue(wall, ri, ci, stateCode);
      var cleaningLog = getCleaningLog();
      var cleanKey = "R" + (ri + 1) + "B" + (ci + 1);
      var cleanDate = cleaningLog[wall] && cleaningLog[wall][cleanKey] ? cleaningLog[wall][cleanKey] : "Not logged";
      var latestEntry = getLatestTempEntry();
      return ''
        + '<div class="m2-sheet is-open">'
        +   '<div class="m2-sheet-backdrop" data-action="sheet-close"></div>'
        +   '<div class="m2-sheet-panel">'
        +     '<div class="m2-sheet-handle"></div>'
        +     '<div class="m2-sheet-title">Wall ' + escapeHtml(wall) + ' · Row ' + (ri + 1) + ' · Burner ' + (ci + 1) + '</div>'
        +     '<div class="m2-sheet-copy">Quick burner detail stays compact and readable for mobile review.</div>'
        +     '<div class="m2-inline-grid">'
        +       '<div class="m2-inline-block"><div class="m2-stat-label">State</div><div class="m2-mini-value">' + escapeHtml(getStateLabel(stateCode)) + '</div></div>'
        +       '<div class="m2-inline-block"><div class="m2-stat-label">Opening</div><div class="m2-mini-value">' + escapeHtml(opening + "%") + '</div></div>'
        +       '<div class="m2-inline-block"><div class="m2-stat-label">Last cleaned</div><div class="m2-mini-value">' + escapeHtml(cleanDate) + '</div></div>'
        +       '<div class="m2-inline-block"><div class="m2-stat-label">Latest snapshot</div><div class="m2-mini-value">' + escapeHtml(latestEntry ? formatTimeAgo(latestEntry.dt) : "No TST") + '</div></div>'
        +     '</div>'
        +     '<div class="m2-sheet-actions">'
        +       '<button class="m2-tool-btn" type="button" data-legacy-tab="cuboidstack">Open 3D viewer</button>'
        +       '<button class="m2-tool-btn" type="button" data-legacy-tab="burner">Open classic burner tools</button>'
        +     '</div>'
        +   '</div>'
        + '</div>';
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
      if(state.legacyMode){
        document.body.setAttribute("data-mobile-legacy", "1");
      }else{
        document.body.removeAttribute("data-mobile-legacy");
      }
    }else{
      document.body.removeAttribute("data-mobile-v2");
      document.body.removeAttribute("data-mobile-legacy");
      mountedRoot.innerHTML = "";
      state.legacyMode = false;
      state.sheetKind = "";
      state.sheetPayload = null;
      return false;
    }
    return true;
  }

  function buildShellHtml(){
    return ''
      + '<div class="m2-legacy-bar">'
      +   '<button class="m2-legacy-btn" type="button" data-action="exit-legacy">Back to redesigned mobile</button>'
      +   '<button class="m2-legacy-btn" type="button" data-action="refresh-shell">Refresh</button>'
      + '</div>'
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
        state.sheetKind = "cell";
        state.sheetPayload = {
          wall: String(cellBtn.getAttribute("data-cell-wall")),
          ri: parseInt(cellBtn.getAttribute("data-cell-ri"), 10),
          ci: parseInt(cellBtn.getAttribute("data-cell-ci"), 10)
        };
        scheduleRender();
        return;
      }

      var ackBtn = target.closest("[data-ack-id]");
      if(ackBtn){
        if(typeof window.acknowledgeAlarmById === "function"){
          window.acknowledgeAlarmById(Number(ackBtn.getAttribute("data-ack-id")));
        }
        scheduleRender();
        return;
      }

      var legacyBtn = target.closest("[data-legacy-tab]");
      if(legacyBtn){
        enterLegacyMode(String(legacyBtn.getAttribute("data-legacy-tab") || ""));
        return;
      }

      var actionBtn = target.closest("[data-action]");
      if(actionBtn){
        handleAction(String(actionBtn.getAttribute("data-action") || ""));
      }
    };
  }

  function handleAction(action){
    if(action === "open-tools"){
      state.sheetKind = "tools";
      state.sheetPayload = null;
      scheduleRender();
      return;
    }
    if(action === "sheet-close"){
      state.sheetKind = "";
      state.sheetPayload = null;
      scheduleRender();
      return;
    }
    if(action === "refresh-shell"){
      state.sheetKind = "";
      state.sheetPayload = null;
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
    if(action === "logout-shell"){
      if(typeof window.logout === "function") window.logout();
      return;
    }
    if(action === "ack-all"){
      if(typeof window.acknowledgeAllAlarms === "function"){
        window.acknowledgeAllAlarms();
      }
      scheduleRender();
      return;
    }
    if(action === "exit-legacy"){
      exitLegacyMode();
      return;
    }
  }

  function refreshCurrentMobileView(){
    if(state.activeTab === "alarms"){
      if(typeof window.refreshAlarmPanel === "function") window.refreshAlarmPanel();
      scheduleRender();
      return;
    }
    if(state.activeTab === "trends"){
      requestTrendData(true);
      return;
    }
    if(typeof window.smartRefresh === "function"){
      Promise.resolve(window.smartRefresh()).finally(scheduleRender);
      return;
    }
    if(typeof window.handleGlobalRefreshClick === "function"){
      window.handleGlobalRefreshClick();
    }
    scheduleRender();
  }

  function requestTrendData(force){
    if(typeof window.refreshReformerDashboard !== "function"){
      scheduleRender();
      return;
    }
    if(!force && (Date.now() - lastTrendRequestAt) < 12000){
      return;
    }
    lastTrendRequestAt = Date.now();
    Promise.resolve(window.refreshReformerDashboard(!!force)).finally(scheduleRender);
  }

  function enterLegacyMode(tab){
    state.legacyMode = true;
    state.sheetKind = "";
    state.sheetPayload = null;
    ensureMountedState();
    if(tab && typeof window.switchTab === "function"){
      window.switchTab(tab);
    }
    setTimeout(function(){
      try{ window.scrollTo({ top: 0, behavior: "smooth" }); }catch(e){ window.scrollTo(0, 0); }
      scheduleRender();
    }, 20);
  }

  function exitLegacyMode(){
    state.legacyMode = false;
    state.sheetKind = "";
    state.sheetPayload = null;
    ensureMountedState();
    scheduleRender();
  }

  function scheduleRender(){
    clearTimeout(renderTimer);
    renderTimer = window.setTimeout(render, 50);
  }

  function installHooks(){
    if(hooksInstalled) return;
    hooksInstalled = true;
    [
      "generateAnalysis",
      "refreshAlarmPanel",
      "render",
      "buildCleaningTable",
      "saveTempData",
      "smartRefresh",
      "acknowledgeAlarmById",
      "acknowledgeAllAlarms",
      "refreshReformerDashboard"
    ].forEach(wrapFunction);
  }

  function wrapFunction(name){
    var original = window[name];
    if(typeof original !== "function" || original.__mobileV2Wrapped) return;
    var wrapped = function(){
      var result = original.apply(this, arguments);
      scheduleRender();
      return result;
    };
    wrapped.__mobileV2Wrapped = true;
    wrapped.__mobileV2Original = original;
    window[name] = wrapped;
  }

  function startFallbackRefreshLoop(){
    clearInterval(refreshInterval);
    refreshInterval = window.setInterval(function(){
      if(isMobileShellActive() && !state.legacyMode){
        scheduleRender();
      }
    }, 12000);
  }

  window.addEventListener("resize", function(){
    if(!isMobileViewport()) exitLegacyMode();
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
    if(state.legacyMode){
      exitLegacyMode();
    }
  });

  window.scadaUpdateMobileShell = function(){
    scheduleRender();
  };

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", function(){
      installHooks();
      startFallbackRefreshLoop();
      render();
    });
  }else{
    installHooks();
    startFallbackRefreshLoop();
    render();
  }
})();
