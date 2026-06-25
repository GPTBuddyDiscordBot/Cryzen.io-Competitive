// ==UserScript==
// @name         Cryzen Comp
// @namespace    cryzen-comp
// @version      1.0.0
// @description  Competitive ranking system for Cryzen.io
// @author       Cryzen Comp
// @match        https://cryzen.io/*
// @match        https://www.cryzen.io/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const WSS_URL = GM_getValue("wss_url", "wss://cryzen-io-competitive.onrender.com/ws");
  const HOTKEY_TOGGLE = GM_getValue("hotkey", "F2");

  const RANKS = [
    { name: "Bronze I",    icon: "🥉", min: 0,    max: 99,   color: "#CD7F32", tier: "Bronze" },
    { name: "Bronze II",   icon: "🥉", min: 100,  max: 199,  color: "#CD7F32", tier: "Bronze" },
    { name: "Bronze III",  icon: "🥉", min: 200,  max: 299,  color: "#CD7F32", tier: "Bronze" },
    { name: "Silver I",    icon: "🥈", min: 300,  max: 399,  color: "#C0C0C0", tier: "Silver" },
    { name: "Silver II",   icon: "🥈", min: 400,  max: 499,  color: "#C0C0C0", tier: "Silver" },
    { name: "Silver III",  icon: "🥈", min: 500,  max: 599,  color: "#C0C0C0", tier: "Silver" },
    { name: "Gold I",      icon: "🥇", min: 600,  max: 699,  color: "#FFD700", tier: "Gold" },
    { name: "Gold II",     icon: "🥇", min: 700,  max: 799,  color: "#FFD700", tier: "Gold" },
    { name: "Gold III",    icon: "🥇", min: 800,  max: 899,  color: "#FFD700", tier: "Gold" },
    { name: "Champion I",  icon: "🏆", min: 900,  max: 999,  color: "#FF5733", tier: "Champion" },
    { name: "Champion II", icon: "🏆", min: 1000, max: 1099, color: "#FF5733", tier: "Champion" },
    { name: "Champion III",icon: "🏆", min: 1100, max: null, color: "#FF5733", tier: "Champion" },
  ];

  const POINTS = { WIN: 25, KILL: 2, HS: 1, LOSS: -15, HIGH_DEATH_THRESHOLD: 10, HIGH_DEATH_PENALTY: -2 };

  function getRank(points) {
    if (points < 0) points = 0;
    for (const r of RANKS) {
      if (r.max === null || points <= r.max) return r;
    }
    return RANKS[RANKS.length - 1];
  }

  function getNextRank(points) {
    const idx = RANKS.indexOf(getRank(points));
    return idx < RANKS.length - 1 ? RANKS[idx + 1] : null;
  }

  let ws = null;
  let profile = null;
  let currentSeason = null;
  let leaderboardData = [];
  let lifetimeLeaderboard = [];
  let guiVisible = false;
  let reconnectTimer = null;
  let matchTracking = {
    inMatch: false,
    kills: 0,
    deaths: 0,
    headshots: 0,
    won: false,
    matchStart: 0,
    lastKnownKills: 0,
    lastKnownDeaths: 0,
    lastKnownHeadshots: 0,
  };
  let notifications = [];

  GM_registerMenuCommand("Set WSS URL", () => {
    const url = prompt("Enter WSS endpoint URL:", WSS_URL);
    if (url) { GM_setValue("wss_url", url); location.reload(); }
  });

  GM_registerMenuCommand("Set Hotkey", () => {
    const key = prompt("Enter toggle hotkey (e.g. F2, F3):", HOTKEY_TOGGLE);
    if (key) { GM_setValue("hotkey", key); location.reload(); }
  });

  GM_registerMenuCommand("Reset Token", () => {
    GM_setValue("auth_token", "");
    location.reload();
  });

  function connectWS() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    try {
      ws = new WebSocket(WSS_URL);
    } catch (e) {
      addNotification("Failed to connect to server", "error");
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      addNotification("Connected to Cryzen Comp", "info");
      const token = GM_getValue("auth_token", "");
      if (token) {
        ws.send(JSON.stringify({ type: "auth", data: { token } }));
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      handleMessage(msg);
    };

    ws.onclose = () => {
      addNotification("Disconnected from server", "error");
      scheduleReconnect();
    };

    ws.onerror = () => {
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWS();
    }, 5000);
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case "connected":
        break;
      case "auth_success":
        GM_setValue("auth_token", msg.data.token || GM_getValue("auth_token", ""));
        profile = msg.data.profile;
        currentSeason = msg.data.season;
        if (msg.data.isNew) addNotification(`Welcome, ${msg.data.username}!`, "info");
        else addNotification(`Authenticated as ${msg.data.username}`, "info");
        requestLeaderboard();
        break;
      case "auth_failed":
        addNotification("Authentication failed. Re-registering...", "error");
        GM_setValue("auth_token", "");
        doRegister();
        break;
      case "profile":
        profile = msg.data;
        break;
      case "profile_update":
        profile = msg.data;
        break;
      case "match_result":
        const result = msg.data;
        if (result.rankChanged) {
          addNotification(`Rank up! ${result.oldRank} → ${result.newRank}`, "achievement");
        }
        addNotification(`Match: +${result.pointsDelta} points (${result.newPoints} total)`, "info");
        break;
      case "leaderboard":
        leaderboardData = msg.data.entries;
        break;
      case "lifetime_leaderboard":
        lifetimeLeaderboard = msg.data.entries;
        break;
      case "season":
        currentSeason = msg.data;
        break;
      case "global_stats":
        break;
      case "rank_update":
        addNotification(`${msg.data.username} ranked up to ${msg.data.newRank}!`, "info");
        break;
      case "error":
        addNotification(msg.data.message, "error");
        break;
    }
    updateGUI();
  }

  function doRegister() {
    const username = prompt("Enter your Cryzen username for Cryzen Comp:");
    if (!username) { addNotification("Registration cancelled", "error"); return; }
    ws.send(JSON.stringify({ type: "auth", data: { username } }));
  }

  function sendWS(type, data = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    }
  }

  function requestLeaderboard() {
    sendWS("get_leaderboard", { limit: 50 });
    sendWS("get_lifetime_leaderboard", { limit: 50 });
    sendWS("get_season");
  }

  function submitMatchResult() {
    if (!matchTracking.inMatch) return;
    const stats = {
      kills: matchTracking.kills,
      deaths: matchTracking.deaths,
      headshots: matchTracking.headshots,
      won: matchTracking.won,
    };
    sendWS("submit_match", stats);
    matchTracking = {
      inMatch: false, kills: 0, deaths: 0, headshots: 0, won: false, matchStart: 0,
      lastKnownKills: 0, lastKnownDeaths: 0, lastKnownHeadshots: 0,
    };
  }

  let lastNotifText = "";
  let lastNotifTime = 0;
  function addNotification(text, type = "info") {
    const now = Date.now();
    if (text === lastNotifText && now - lastNotifTime < 3000) return;
    lastNotifText = text;
    lastNotifTime = now;
    notifications.push({ id: now, text, type });
    if (notifications.length > 20) notifications.shift();
    updateGUI();
  }

  // === Game Event Detection ===

  let originalWS = null;
  let gameWSSockets = [];
  let killCountObserver = null;
  let lastKillFeedEntries = 0;
  let deathScreenObserver = null;
  let matchEndObserver = null;
  let periodicTracker = null;

  function initGameTracking() {
    interceptWebSocket();
    startDOMTracking();
    startPeriodicTracking();
    scanGameState();
  }

  function interceptWebSocket() {
    if (window._cryzenCompWSIntercepted) return;
    const OrigWS = window.WebSocket;
    originalWS = OrigWS;

    window.WebSocket = function (url, protocols) {
      const socket = new OrigWS(url, protocols);

      if (url && !url.includes("cryzen-comp") && !url.includes("10000")) {
        gameWSSockets.push(socket);

        socket.addEventListener("message", (event) => {
          try {
            if (event.data instanceof Blob) {
              event.data.arrayBuffer().then(buf => {
                handleColyseusBuffer(buf, socket.url);
              });
            } else if (typeof event.data === "string") {
              if (event.data.startsWith("{")) {
                try {
                  const json = JSON.parse(event.data);
                  if (json.type === "join_room" || json.type === "join") onMatchStart();
                  if (json.type === "leave_room" || json.type === "leave") onMatchEnd(false);
                } catch {}
              }
            } else if (event.data instanceof ArrayBuffer || ArrayBuffer.isView(event.data)) {
              handleColyseusBuffer(event.data, socket.url);
            }
          } catch {}
        });
      }

      return socket;
    };

    window.WebSocket.prototype = OrigWS.prototype;
    window.WebSocket.CONNECTING = OrigWS.CONNECTING;
    window.WebSocket.OPEN = OrigWS.OPEN;
    window.WebSocket.CLOSING = OrigWS.CLOSING;
    window.WebSocket.CLOSED = OrigWS.CLOSED;
    window._cryzenCompWSIntercepted = true;
  }

  function handleColyseusBuffer(buf) {
    try {
      const view = new Uint8Array(buf);
      if (view.length < 2) return;
      const opcode = view[0];
      if (opcode === 1) { onMatchStart(); }
      if (opcode === 2) { onMatchEnd(false); }
      if (opcode === 3 || opcode === 4) {
        extractColyseusState(view);
      }
    } catch {}
  }

  function extractColyseusState(view) {
    try {
      const text = new TextDecoder().decode(view);
      const patterns = [
        /"kills"\s*:\s*(\d+)/gi,
        /"deaths"\s*:\s*(\d+)/gi,
        /"headshots"\s*:\s*(\d+)/gi,
        /"score"\s*:\s*(\d+)/gi,
        /"won"\s*:\s*(true|false)/gi,
        /"winner"\s*:\s*(true|false)/gi,
      ];
      let foundKills = 0, foundDeaths = 0, foundHS = 0;
      for (const match of text.matchAll(/"kills"\s*:\s*(\d+)/gi)) {
        foundKills = Math.max(foundKills, parseInt(match[1]));
      }
      for (const match of text.matchAll(/"deaths"\s*:\s*(\d+)/gi)) {
        foundDeaths = Math.max(foundDeaths, parseInt(match[1]));
      }
      for (const match of text.matchAll(/"headshots"\s*:\s*(\d+)/gi)) {
        foundHS = Math.max(foundHS, parseInt(match[1]));
      }
      if (foundKills > matchTracking.lastKnownKills && matchTracking.inMatch) {
        matchTracking.kills += foundKills - matchTracking.lastKnownKills;
        matchTracking.lastKnownKills = foundKills;
      }
      if (foundDeaths > matchTracking.lastKnownDeaths && matchTracking.inMatch) {
        matchTracking.deaths += foundDeaths - matchTracking.lastKnownDeaths;
        matchTracking.lastKnownDeaths = foundDeaths;
      }
      if (foundHS > matchTracking.lastKnownHeadshots && matchTracking.inMatch) {
        matchTracking.headshots += foundHS - matchTracking.lastKnownHeadshots;
        matchTracking.lastKnownHeadshots = foundHS;
      }
    } catch {}
  }

  function startDOMTracking() {
    const appEl = document.getElementById("app");
    if (!appEl) {
      setTimeout(startDOMTracking, 1000);
      return;
    }

    const observer = new MutationObserver(() => {
      detectDOMChanges();
    });

    observer.observe(appEl, { childList: true, subtree: true, characterData: true });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    detectDOMChanges();
  }

  let lastDeathScreenSeen = 0;
  let lastMatchEndSeen = 0;
  let lastKillFeedText = "";

  function detectDOMChanges() {
    detectDeathScreenDOM();
    detectKillFeedDOM();
    detectScoreboardDOM();
  }

  function detectMatchStartDOM() {
    return;
  }

  function detectDeathScreenDOM() {
    if (!matchTracking.inMatch) return;
    const now = Date.now();
    if (now - lastDeathScreenSeen < 5000) return;

    const allEls = document.querySelectorAll("*");
    for (const el of allEls) {
      if (el.offsetHeight <= 0 || el.offsetWidth <= 0) continue;
      const cls = (el.className || "").toString().toLowerCase();
      const text = (el.textContent || "").toLowerCase();
      if ((cls.includes("death") || cls.includes("dead") || cls.includes("respawn")) &&
          (text.includes("respawn") || text.includes("click to"))) {
        matchTracking.deaths++;
        lastDeathScreenSeen = now;
        updateGUI();
        return;
      }
    }
  }

  function detectMatchEndDOM() {
    return;
  }

  function detectKillFeedDOM() {
    if (!matchTracking.inMatch) return;
    const allEls = document.querySelectorAll("*");
    const currentText = [];
    for (const el of allEls) {
      const cls = (el.className || "").toString().toLowerCase();
      if (cls.includes("kill-feed") || cls.includes("killfeed") || cls.includes("death-log")) {
        const txt = (el.textContent || "").trim();
        if (txt.length > 0 && txt.length < 200) currentText.push(txt);
      }
    }
    const joined = currentText.join("|");
    if (joined !== lastKillFeedText && joined.length > 0) {
      const diff = joined.replace(lastKillFeedText, "");
      if (diff.length > 0 && matchTracking.inMatch) {
        const lower = diff.toLowerCase();
        if (lower.includes("headshot") || lower.includes("head shot")) {
          matchTracking.kills++;
          matchTracking.headshots++;
          updateGUI();
        }
      }
      lastKillFeedText = joined;
    }
  }

  function detectScoreboardDOM() {
    if (!matchTracking.inMatch) return;
    const allEls = document.querySelectorAll("*");
    for (const el of allEls) {
      const cls = (el.className || "").toString().toLowerCase();
      if (cls.includes("score") || cls.includes("board") || cls.includes("tab")) {
        const text = (el.textContent || "").toLowerCase();
        const killMatches = text.match(/kills?[:\s]*(\d+)/i);
        const deathMatches = text.match(/deaths?[:\s]*(\d+)/i);
        const hsMatches = text.match(/headshots?[:\s]*(\d+)/i);
        if (killMatches) {
          const k = parseInt(killMatches[1]);
          if (k > matchTracking.lastKnownKills) {
            matchTracking.kills += k - matchTracking.lastKnownKills;
            matchTracking.lastKnownKills = k;
          }
        }
        if (deathMatches) {
          const d = parseInt(deathMatches[1]);
          if (d > matchTracking.lastKnownDeaths) {
            matchTracking.deaths += d - matchTracking.lastKnownDeaths;
            matchTracking.lastKnownDeaths = d;
          }
        }
        if (hsMatches) {
          const h = parseInt(hsMatches[1]);
          if (h > matchTracking.lastKnownHeadshots) {
            matchTracking.headshots += h - matchTracking.lastKnownHeadshots;
            matchTracking.lastKnownHeadshots = h;
          }
        }
      }
    }
  }

  function onMatchStart() {
    if (matchTracking.inMatch) return;
    const now = Date.now();
    if (now - lastMatchEndSeen < 10000) return;
    matchTracking = {
      inMatch: true,
      kills: 0,
      deaths: 0,
      headshots: 0,
      won: false,
      matchStart: now,
      lastKnownKills: 0,
      lastKnownDeaths: 0,
      lastKnownHeadshots: 0,
    };
    lastKillFeedEntries = 0;
    lastKillFeedText = "";
    lastDeathScreenSeen = 0;
    lastMatchEndSeen = 0;
    addNotification("Match started", "info");
    updateGUI();
    scheduleStateScan();
  }

  function onMatchEnd(won) {
    if (!matchTracking.inMatch) return;
    const now = Date.now();
    if (now - lastMatchEndSeen < 5000) return;
    lastMatchEndSeen = now;
    matchTracking.won = won;
    if (matchTracking.kills === 0 && matchTracking.deaths === 0) {
      autoDetectMatchStats();
    }
    matchTracking.inMatch = false;
    setTimeout(() => {
      addNotification("Match ended - " + (matchTracking.won ? "WIN" : "LOSS") + ": " + matchTracking.kills + "K/" + matchTracking.deaths + "D/" + matchTracking.headshots + "HS", matchTracking.won ? "achievement" : "info");
      submitMatchResult();
      updateGUI();
    }, 1500);
  }

  function autoDetectMatchStats() {
    try {
      const allText = document.body.textContent || "";
      const killMatches = allText.match(/kills?[:\s]*(\d+)/gi);
      const deathMatches = allText.match(/deaths?[:\s]*(\d+)/gi);
      const hsMatches = allText.match(/headshots?[:\s]*(\d+)/gi);
      if (killMatches) {
        for (const m of killMatches) {
          const n = parseInt(m.match(/\d+/)[0]);
          if (n > matchTracking.kills) matchTracking.kills = n;
        }
      }
      if (deathMatches) {
        for (const m of deathMatches) {
          const n = parseInt(m.match(/\d+/)[0]);
          if (n > matchTracking.deaths) matchTracking.deaths = n;
        }
      }
      if (hsMatches) {
        for (const m of hsMatches) {
          const n = parseInt(m.match(/\d+/)[0]);
          if (n > matchTracking.headshots) matchTracking.headshots = n;
        }
      }
    } catch {}
  }

  function scanGameState() {
    try {
      const appEl = document.getElementById("app");
      if (!appEl || !appEl.__vue_app__) return;
      const pinia = appEl.__vue_app__?.config?.globalProperties?.$pinia;
      if (!pinia) return;
      const stores = pinia._s;
      for (const [name, store] of stores) {
        deepScanObject(store, name);
      }
    } catch {}
  }

  function deepScanObject(obj, path, depth) {
    if (!depth) depth = 0;
    if (depth > 10 || !obj || typeof obj !== "object") return;
    try {
      const state = obj.$state || obj;
      if (matchTracking.inMatch && typeof state.kills === "number" && state.kills > matchTracking.lastKnownKills) {
        matchTracking.kills += state.kills - matchTracking.lastKnownKills;
        matchTracking.lastKnownKills = state.kills;
        updateGUI();
      }
      if (matchTracking.inMatch && typeof state.deaths === "number" && state.deaths > matchTracking.lastKnownDeaths) {
        matchTracking.deaths += state.deaths - matchTracking.lastKnownDeaths;
        matchTracking.lastKnownDeaths = state.deaths;
        updateGUI();
      }
      if (matchTracking.inMatch && typeof state.headshots === "number" && state.headshots > matchTracking.lastKnownHeadshots) {
        matchTracking.headshots += state.headshots - matchTracking.lastKnownHeadshots;
        matchTracking.lastKnownHeadshots = state.headshots;
        updateGUI();
      }
      if (typeof state.inGame === "boolean" && !state.inGame && matchTracking.inMatch) {
        matchTracking.won = state.isWinner || state.won || false;
        onMatchEnd(matchTracking.won);
        return;
      }
      if (typeof state === "object") {
        for (const key of Object.keys(state)) {
          if (key === "$state" || key === "_s" || key === "$pinia" || key.startsWith("$") || key.startsWith("_")) continue;
          try {
            const val = state[key];
            if (val && typeof val === "object") deepScanObject(val, path + "." + key, depth + 1);
          } catch {}
        }
      }
    } catch {}
  }

  function startPeriodicTracking() {
    periodicTracker = setInterval(() => {
      if (!matchTracking.inMatch) return;
      scanGameState();
    }, 3000);
  }

  function scheduleStateScan() {
    let scans = 0;
    const maxScans = 60;
    const scanInterval = setInterval(() => {
      if (!matchTracking.inMatch || scans >= maxScans) {
        clearInterval(scanInterval);
        return;
      }
      scanGameState();
      detectDOMChanges();
      scans++;
    }, 1000);
  }

  // === GUI ===

  GM_addStyle(`
    #cryzen-comp-gui {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 340px;
      max-height: 80vh;
      background: rgba(15, 15, 20, 0.95);
      border: 1px solid #FF5733;
      border-radius: 12px;
      color: #e0e0e0;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      z-index: 999999;
      overflow: hidden;
      display: none;
      box-shadow: 0 8px 32px rgba(255, 87, 51, 0.15);
      backdrop-filter: blur(12px);
      transition: opacity 0.2s;
    }
    #cryzen-comp-gui.visible { display: block; }
    #cryzen-comp-gui * { box-sizing: border-box; }

    #cc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: linear-gradient(135deg, #FF5733 0%, #C70039 100%);
      border-radius: 12px 12px 0 0;
      cursor: move;
      user-select: none;
    }
    #cc-header h2 { margin: 0; font-size: 14px; font-weight: 700; color: #fff; letter-spacing: 1px; }
    #cc-header .cc-status { font-size: 11px; color: #fff; opacity: 0.8; }
    #cc-header .cc-close { background: none; border: none; color: #fff; font-size: 18px; cursor: pointer; padding: 0 4px; line-height: 1; }
    #cc-header .cc-close:hover { opacity: 0.7; }

    #cc-tabs {
      display: flex;
      border-bottom: 1px solid #333;
      padding: 0 8px;
      background: rgba(20, 20, 25, 0.9);
    }
    #cc-tabs button {
      background: none;
      border: none;
      color: #888;
      font-size: 12px;
      padding: 8px 10px;
      cursor: pointer;
      transition: color 0.2s;
      border-bottom: 2px solid transparent;
    }
    #cc-tabs button:hover { color: #ccc; }
    #cc-tabs button.active { color: #FF5733; border-bottom-color: #FF5733; }

    #cc-body {
      padding: 12px;
      max-height: calc(80vh - 110px);
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: #FF5733 #1a1a1a;
    }
    #cc-body::-webkit-scrollbar { width: 6px; }
    #cc-body::-webkit-scrollbar-track { background: #1a1a1a; }
    #cc-body::-webkit-scrollbar-thumb { background: #FF5733; border-radius: 3px; }

    .cc-section { margin-bottom: 14px; }
    .cc-section-title {
      font-size: 11px;
      color: #FF5733;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 6px;
      font-weight: 600;
    }

    .cc-rank-display {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: rgba(30, 30, 35, 0.8);
      border-radius: 8px;
      border: 1px solid #333;
    }
    .cc-rank-icon { font-size: 32px; }
    .cc-rank-info { flex: 1; }
    .cc-rank-name { font-size: 16px; font-weight: 700; }
    .cc-rank-points { font-size: 12px; color: #888; }
    .cc-progress-bar {
      height: 6px;
      background: #333;
      border-radius: 3px;
      margin-top: 6px;
      overflow: hidden;
    }
    .cc-progress-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s;
    }

    .cc-stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .cc-stat-item {
      background: rgba(30, 30, 35, 0.8);
      border-radius: 6px;
      padding: 8px 10px;
      border: 1px solid #333;
    }
    .cc-stat-label { font-size: 10px; color: #888; text-transform: uppercase; }
    .cc-stat-value { font-size: 15px; font-weight: 700; color: #e0e0e0; }

    .cc-match-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: rgba(30, 30, 35, 0.8);
      border-radius: 6px;
      border: 1px solid #333;
      margin-bottom: 6px;
    }
    .cc-match-won { color: #4CAF50; font-weight: 700; font-size: 12px; }
    .cc-match-loss { color: #F44336; font-weight: 700; font-size: 12px; }
    .cc-match-stats { font-size: 11px; color: #888; }
    .cc-match-points { font-size: 12px; font-weight: 600; }
    .cc-match-points.positive { color: #4CAF50; }
    .cc-match-points.negative { color: #F44336; }
    .cc-match-time { font-size: 10px; color: #666; }

    .cc-lb-entry {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      background: rgba(30, 30, 35, 0.6);
      border-radius: 4px;
      margin-bottom: 4px;
      border: 1px solid transparent;
    }
    .cc-lb-entry.self { border-color: #FF5733; background: rgba(255, 87, 51, 0.1); }
    .cc-lb-pos { font-size: 12px; color: #888; min-width: 24px; }
    .cc-lb-rank { font-size: 14px; min-width: 20px; }
    .cc-lb-name { font-size: 12px; flex: 1; font-weight: 600; }
    .cc-lb-points { font-size: 12px; color: #FF5733; font-weight: 700; }
    .cc-lb-stats { font-size: 10px; color: #888; }

    .cc-season-info {
      background: rgba(30, 30, 35, 0.8);
      border-radius: 8px;
      padding: 12px;
      border: 1px solid #333;
    }
    .cc-season-name { font-size: 16px; font-weight: 700; color: #FF5733; }
    .cc-season-date { font-size: 11px; color: #888; }

    .cc-tracking-badge {
      position: fixed;
      top: 60px;
      right: 20px;
      background: rgba(15, 15, 20, 0.9);
      border: 1px solid #FF5733;
      border-radius: 8px;
      padding: 6px 12px;
      color: #FF5733;
      font-size: 11px;
      z-index: 999998;
      display: none;
      cursor: pointer;
    }
    .cc-tracking-badge.visible { display: block; }
    .cc-tracking-badge .cc-live-kd { font-weight: 700; }

    .cc-notification-stack {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999997;
      max-width: 300px;
    }
    .cc-notif {
      background: rgba(15, 15, 20, 0.95);
      border: 1px solid #333;
      border-radius: 8px;
      padding: 8px 12px;
      margin-top: 6px;
      font-size: 12px;
      color: #e0e0e0;
      animation: cc-slide-in 0.3s ease;
      transition: opacity 0.3s;
    }
    .cc-notif.info { border-left: 3px solid #2196F3; }
    .cc-notif.error { border-left: 3px solid #F44336; }
    .cc-notif.achievement { border-left: 3px solid #FFD700; }
    @keyframes cc-slide-in { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

    .cc-login-panel {
      text-align: center;
      padding: 20px;
    }
    .cc-login-panel button {
      background: linear-gradient(135deg, #FF5733, #C70039);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 12px 24px;
      font-size: 14px;
      cursor: pointer;
      font-weight: 600;
      margin-top: 10px;
    }
    .cc-login-panel button:hover { opacity: 0.9; }
    .cc-manual-submit {
      margin-top: 10px;
    }
    .cc-manual-form label { font-size: 11px; color: #888; display: block; margin-bottom: 3px; }
    .cc-manual-form input {
      background: rgba(30,30,35,0.9);
      border: 1px solid #444;
      border-radius: 4px;
      color: #e0e0e0;
      padding: 6px 8px;
      font-size: 12px;
      width: 60px;
      margin-bottom: 6px;
    }
    .cc-manual-form select {
      background: rgba(30,30,35,0.9);
      border: 1px solid #444;
      border-radius: 4px;
      color: #e0e0e0;
      padding: 6px 8px;
      font-size: 12px;
    }
    .cc-manual-submit-btn {
      background: #FF5733;
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
      margin-top: 8px;
    }
  `);

  function buildGUI() {
    const gui = document.createElement("div");
    gui.id = "cryzen-comp-gui";
    gui.innerHTML = `
      <div id="cc-header">
        <h2>CRYZEN COMP</h2>
        <span class="cc-status" id="cc-conn-status">--</span>
        <button class="cc-close" id="cc-close">&times;</button>
      </div>
      <div id="cc-tabs">
        <button class="active" data-tab="profile">Profile</button>
        <button data-tab="matches">Matches</button>
        <button data-tab="leaderboard">Leaderboard</button>
        <button data-tab="season">Season</button>
        <button data-tab="manual">Stats</button>
      </div>
      <div id="cc-body"></div>
    `;
    document.body.appendChild(gui);

    const badge = document.createElement("div");
    badge.className = "cc-tracking-badge";
    badge.id = "cc-tracking-badge";
    badge.innerHTML = `TRACKING: <span class="cc-live-kd">0K/0D/0HS</span>`;
    badge.onclick = () => { guiVisible = !guiVisible; gui.classList.toggle("visible", guiVisible); updateGUI(); };
    document.body.appendChild(badge);

    const notifStack = document.createElement("div");
    notifStack.className = "cc-notification-stack";
    notifStack.id = "cc-notif-stack";
    document.body.appendChild(notifStack);

    document.getElementById("cc-close").onclick = () => {
      guiVisible = false;
      gui.classList.remove("visible");
    };

    document.getElementById("cc-tabs").onclick = (e) => {
      if (e.target.tagName !== "BUTTON") return;
      document.querySelectorAll("#cc-tabs button").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      renderTab(e.target.dataset.tab);
    };

    makeDraggable(gui, document.getElementById("cc-header"));
  }

  function makeDraggable(el, handle) {
    let startX, startY, initialX, initialY;
    handle.addEventListener("mousedown", (e) => {
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;
      document.addEventListener("mousemove", onDrag);
      document.addEventListener("mouseup", onStop);
      e.preventDefault();
    });
    function onDrag(e) {
      el.style.left = initialX + e.clientX - startX + "px";
      el.style.top = initialY + e.clientY - startY + "px";
      el.style.right = "auto";
    }
    function onStop() {
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", onStop);
    }
  }

  let currentTab = "profile";

  function renderTab(tab) {
    currentTab = tab;
    const body = document.getElementById("cc-body");
    if (!body) return;

    switch (tab) {
      case "profile": renderProfile(body); break;
      case "matches": renderMatches(body); break;
      case "leaderboard": renderLeaderboard(body); break;
      case "season": renderSeason(body); break;
      case "manual": renderManualSubmit(body); break;
    }
  }

  function renderProfile(body) {
    if (!profile) {
      body.innerHTML = `<div class="cc-login-panel"><p style="color:#888;">Connect to start tracking</p><button id="cc-register-btn">Register / Login</button></div>`;
      const regBtn = document.getElementById("cc-register-btn");
      if (regBtn) regBtn.onclick = doRegister;
      return;
    }

    const seasonPts = profile.season?.points || 0;
    const rank = getRank(seasonPts);
    const nextRank = getNextRank(seasonPts);
    const progress = nextRank ? ((seasonPts - rank.min) / (nextRank.min - rank.min)) * 100 : 100;

    const kd = profile.season?.deaths > 0 ? (profile.season.kills / profile.season.deaths).toFixed(2) : profile.season?.kills || 0;
    const hsPct = profile.season?.kills > 0 ? ((profile.season.headshots / profile.season.kills) * 100).toFixed(1) : 0;
    const winRate = profile.season?.matches > 0 ? ((profile.season.wins / profile.season.matches) * 100).toFixed(1) : 0;

    body.innerHTML = `
      <div class="cc-section">
        <div class="cc-rank-display">
          <div class="cc-rank-icon">${rank.icon}</div>
          <div class="cc-rank-info">
            <div class="cc-rank-name" style="color:${rank.color}">${rank.name}</div>
            <div class="cc-rank-points">${seasonPts} points ${nextRank ? `(${nextRank.min - seasonPts} to ${nextRank.name})` : "(MAX)"}</div>
            <div class="cc-progress-bar">
              <div class="cc-progress-fill" style="width:${progress}%;background:${rank.color}"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="cc-section">
        <div class="cc-section-title">Season Stats</div>
        <div class="cc-stats-grid">
          <div class="cc-stat-item"><div class="cc-stat-label">Matches</div><div class="cc-stat-value">${profile.season?.matches || 0}</div></div>
          <div class="cc-stat-item"><div class="cc-stat-label">Wins</div><div class="cc-stat-value">${profile.season?.wins || 0}</div></div>
          <div class="cc-stat-item"><div class="cc-stat-label">Kills</div><div class="cc-stat-value">${profile.season?.kills || 0}</div></div>
          <div class="cc-stat-item"><div class="cc-stat-label">Deaths</div><div class="cc-stat-value">${profile.season?.deaths || 0}</div></div>
          <div class="cc-stat-item"><div class="cc-stat-label">Headshots</div><div class="cc-stat-value">${profile.season?.headshots || 0}</div></div>
          <div class="cc-stat-item"><div class="cc-stat-label">K/D</div><div class="cc-stat-value">${kd}</div></div>
          <div class="cc-stat-item"><div class="cc-stat-label">HS%</div><div class="cc-stat-value">${hsPct}%</div></div>
          <div class="cc-stat-item"><div class="cc-stat-label">Win Rate</div><div class="cc-stat-value">${winRate}%</div></div>
        </div>
      </div>
      <div class="cc-section">
        <div class="cc-section-title">Lifetime Stats</div>
        <div class="cc-stats-grid">
          <div class="cc-stat-item"><div class="cc-stat-label">Total Points</div><div class="cc-stat-value">${profile.lifetime?.total_points || 0}</div></div>
          <div class="cc-stat-item"><div class="cc-stat-label">Total Matches</div><div class="cc-stat-value">${profile.lifetime?.total_matches || 0}</div></div>
          <div class="cc-stat-item"><div class="cc-stat-label">Total Kills</div><div class="cc-stat-value">${profile.lifetime?.total_kills || 0}</div></div>
          <div class="cc-stat-item"><div class="cc-stat-label">Total Wins</div><div class="cc-stat-value">${profile.lifetime?.total_wins || 0}</div></div>
        </div>
      </div>
      ${matchTracking.inMatch ? `
      <div class="cc-section">
        <div class="cc-section-title" style="color:#4CAF50">Live Match</div>
        <div class="cc-stats-grid">
          <div class="cc-stat-item"><div class="cc-stat-label">Kills</div><div class="cc-stat-value" style="color:#4CAF50">${matchTracking.kills}</div></div>
          <div class="cc-stat-item"><div class="cc-stat-label">Deaths</div><div class="cc-stat-value" style="color:#F44336">${matchTracking.deaths}</div></div>
          <div class="cc-stat-item"><div class="cc-stat-label">Headshots</div><div class="cc-stat-value" style="color:#FFD700">${matchTracking.headshots}</div></div>
        </div>
      </div>` : ""}
    `;
  }

  function renderMatches(body) {
    if (!profile) {
      body.innerHTML = `<div class="cc-login-panel"><p style="color:#888;">Login to view match history</p></div>`;
      return;
    }

    const matches = profile.recentMatches || [];
    if (matches.length === 0) {
      body.innerHTML = `<div style="text-align:center;color:#888;padding:20px;">No matches yet</div>`;
      return;
    }

    body.innerHTML = matches.map(m => {
      const won = m.won === 1;
      const ptsClass = m.points_delta >= 0 ? "positive" : "negative";
      const deltaText = m.points_delta >= 0 ? `+${m.points_delta}` : `${m.points_delta}`;
      const time = new Date(m.timestamp).toLocaleString();
      return `
        <div class="cc-match-item">
          <div style="flex:1">
            <span class="${won ? 'cc-match-won' : 'cc-match-loss'}">${won ? "WIN" : "LOSS"}</span>
            <span class="cc-match-stats">${m.kills}K/${m.deaths}D/${m.headshots}HS</span>
            <span class="cc-match-points ${ptsClass}">${deltaText} pts</span>
            <div class="cc-match-time">${time}</div>
          </div>
          <div style="font-size:12px;color:#888;">${m.points_after} pts</div>
        </div>`;
    }).join("");
  }

  function renderLeaderboard(body) {
    const entries = leaderboardData;
    const myName = profile?.username;

    if (entries.length === 0) {
      body.innerHTML = `<div style="text-align:center;color:#888;padding:20px;">No leaderboard data</div>`;
      return;
    }

    body.innerHTML = `
      <div class="cc-section">
        <div class="cc-section-title">Season Leaderboard</div>
        ${entries.slice(0, 30).map((e, i) => {
          const rank = getRank(e.points);
          const isSelf = e.username === myName;
          return `
            <div class="cc-lb-entry ${isSelf ? 'self' : ''}">
              <div class="cc-lb-pos">#${i + 1}</div>
              <div class="cc-lb-rank">${rank.icon}</div>
              <div class="cc-lb-name" style="color:${isSelf ? '#FF5733' : '#e0e0e0'}">${e.username}</div>
              <div class="cc-lb-points">${e.points}</div>
              <div class="cc-lb-stats">${e.kd} K/D | ${e.winrate}% WR</div>
            </div>`;
        }).join("")}
      </div>
    `;
  }

  function renderSeason(body) {
    if (!currentSeason) {
      body.innerHTML = `<div style="text-align:center;color:#888;padding:20px;">No season info</div>`;
      return;
    }

    const startDate = new Date(currentSeason.start_date).toLocaleDateString();
    const endDate = new Date(currentSeason.end_date).toLocaleDateString();
    const now = Date.now();
    const daysLeft = Math.max(0, Math.ceil((currentSeason.end_date - now) / (86400000)));
    const totalDays = Math.ceil((currentSeason.end_date - currentSeason.start_date) / 86400000);
    const progress = ((now - currentSeason.start_date) / (currentSeason.end_date - currentSeason.start_date)) * 100;

    body.innerHTML = `
      <div class="cc-section">
        <div class="cc-season-info">
          <div class="cc-season-name">${currentSeason.name}</div>
          <div class="cc-season-date">${startDate} - ${endDate}</div>
          <div style="font-size:13px;color:#888;margin-top:4px;">${daysLeft} days remaining</div>
          <div class="cc-progress-bar" style="margin-top:8px;">
            <div class="cc-progress-fill" style="width:${Math.min(100, progress)}%;background:#FF5733"></div>
          </div>
        </div>
      </div>
      <div class="cc-section">
        <div class="cc-section-title">Rank Tiers</div>
        ${RANKS.map(r => `
          <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
            <span style="font-size:18px">${r.icon}</span>
            <span style="font-size:12px;color:${r.color};font-weight:600">${r.name}</span>
            <span style="font-size:11px;color:#888">${r.min}${r.max !== null ? ` - ${r.max}` : "+"} pts</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderManualSubmit(body) {
    const tracked = matchTracking;
    const hasTracked = tracked.kills > 0 || tracked.deaths > 0;
    body.innerHTML = `
      <div class="cc-section">
        <div class="cc-section-title">Auto-Detected Stats</div>
        ${hasTracked ? `
          <div class="cc-stats-grid">
            <div class="cc-stat-item"><div class="cc-stat-label">Kills</div><div class="cc-stat-value" style="color:#4CAF50">${tracked.kills}</div></div>
            <div class="cc-stat-item"><div class="cc-stat-label">Deaths</div><div class="cc-stat-value" style="color:#F44336">${tracked.deaths}</div></div>
            <div class="cc-stat-item"><div class="cc-stat-label">Headshots</div><div class="cc-stat-value" style="color:#FFD700">${tracked.headshots}</div></div>
            <div class="cc-stat-item"><div class="cc-stat-label">Result</div><div class="cc-stat-value" style="color:${tracked.won ? '#4CAF50' : '#F44336'}">${tracked.won ? "WIN" : "LOSS"}</div></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button class="cc-manual-submit-btn" id="cc-man-submit-win" style="background:#4CAF50">Submit as WIN</button>
            <button class="cc-manual-submit-btn" id="cc-man-submit-loss" style="background:#F44336">Submit as LOSS</button>
          </div>
        ` : `
          <p style="font-size:12px;color:#888;text-align:center;padding:12px;">No match data detected yet.<br>Stats auto-track during gameplay.</p>
        `}
        <button class="cc-manual-submit-btn" id="cc-man-autodetect" style="background:#444;margin-top:10px;display:block;width:100%">Scan Page For Stats</button>
      </div>
      <div class="cc-section">
        <div class="cc-section-title">Connection</div>
        <div style="font-size:12px;color:#888;">
          <div>WSS: <span style="color:#e0e0e0">${WSS_URL}</span></div>
          <div>Status: <span id="cc-ws-status-text">${ws ? (ws.readyState === WebSocket.OPEN ? "Connected" : "Disconnected") : "Not connected"}</span></div>
        </div>
      </div>
      <div class="cc-section">
        <div class="cc-section-title">Points Breakdown</div>
        <div style="font-size:11px;color:#888;">
          Win: <span style="color:#4CAF50">+25</span> | Kill: <span style="color:#4CAF50">+2</span> | Headshot: <span style="color:#FFD700">+1</span><br>
          Loss: <span style="color:#F44336">-15</span> | High Deaths (>=10): <span style="color:#F44336">-2</span>
        </div>
      </div>
    `;

    const winBtn = document.getElementById("cc-man-submit-win");
    const lossBtn = document.getElementById("cc-man-submit-loss");
    if (winBtn && hasTracked) {
      winBtn.addEventListener("click", () => {
        sendWS("submit_match", { kills: tracked.kills, deaths: tracked.deaths, headshots: tracked.headshots, won: true });
        addNotification("Submitted: " + tracked.kills + "K/" + tracked.deaths + "D/" + tracked.headshots + "HS as WIN", "achievement");
        matchTracking = { inMatch: false, kills: 0, deaths: 0, headshots: 0, won: false, matchStart: 0, lastKnownKills: 0, lastKnownDeaths: 0, lastKnownHeadshots: 0 };
        setTimeout(() => renderTab("manual"), 500);
      });
    }
    if (lossBtn && hasTracked) {
      lossBtn.addEventListener("click", () => {
        sendWS("submit_match", { kills: tracked.kills, deaths: tracked.deaths, headshots: tracked.headshots, won: false });
        addNotification("Submitted: " + tracked.kills + "K/" + tracked.deaths + "D/" + tracked.headshots + "HS as LOSS", "achievement");
        matchTracking = { inMatch: false, kills: 0, deaths: 0, headshots: 0, won: false, matchStart: 0, lastKnownKills: 0, lastKnownDeaths: 0, lastKnownHeadshots: 0 };
        setTimeout(() => renderTab("manual"), 500);
      });
    }

    const autoBtn = document.getElementById("cc-man-autodetect");
    if (autoBtn) {
      autoBtn.addEventListener("click", () => {
        autoDetectMatchStats();
        addNotification("Stats auto-detected: " + matchTracking.kills + "K/" + matchTracking.deaths + "D/" + matchTracking.headshots + "HS", "info");
        setTimeout(() => renderTab("manual"), 300);
      });
    }
  }

  function updateGUI() {
    const statusEl = document.getElementById("cc-conn-status");
    if (statusEl) {
      if (ws && ws.readyState === WebSocket.OPEN) statusEl.textContent = "CONNECTED";
      else statusEl.textContent = "OFFLINE";
      statusEl.style.color = ws && ws.readyState === WebSocket.OPEN ? "#4CAF50" : "#F44336";
    }

    const badge = document.getElementById("cc-tracking-badge");
    if (badge) {
      badge.classList.toggle("visible", matchTracking.inMatch);
      const kdSpan = badge.querySelector(".cc-live-kd");
      if (kdSpan) kdSpan.textContent = `${matchTracking.kills}K/${matchTracking.deaths}D/${matchTracking.headshots}HS`;
    }

    renderTab(currentTab);
    renderNotifications();
  }

  function renderNotifications() {
    const stack = document.getElementById("cc-notif-stack");
    if (!stack) return;

    const recent = notifications.slice(-5);
    stack.innerHTML = recent.map(n => `<div class="cc-notif ${n.type}">${n.text}</div>`).join("");

    setTimeout(() => {
      const notifs = stack.querySelectorAll(".cc-notif");
      if (notifs.length > 0 && notifications.length > 5) {
        notifications.splice(0, notifications.length - 5);
        notifs[0].style.opacity = "0";
        setTimeout(() => notifs[0]?.remove(), 300);
      }
    }, 4000);
  }

  // === Hotkey ===

  document.addEventListener("keydown", (e) => {
    if (e.key === HOTKEY_TOGGLE || e.code === HOTKEY_TOGGLE) {
      guiVisible = !guiVisible;
      const gui = document.getElementById("cryzen-comp-gui");
      gui?.classList.toggle("visible", guiVisible);
      updateGUI();
    }
    if (e.key === "F3" || e.code === "F3") {
      e.preventDefault();
      if (matchTracking.inMatch) {
        matchTracking.won = confirm("Did you win? (OK=Win, Cancel=Loss)");
        onMatchEnd(matchTracking.won);
      } else if (matchTracking.kills > 0 || matchTracking.deaths > 0) {
        const won = confirm("Submit tracked match as WIN? (OK=Win, Cancel=Loss)");
        matchTracking.won = won;
        addNotification(`Submitting: ${matchTracking.kills}K/${matchTracking.deaths}D/${matchTracking.headshots}HS as ${won ? "WIN" : "LOSS"}`, "info");
        sendWS("submit_match", { kills: matchTracking.kills, deaths: matchTracking.deaths, headshots: matchTracking.headshots, won });
        matchTracking = { inMatch: false, kills: 0, deaths: 0, headshots: 0, won: false, matchStart: 0, lastKnownKills: 0, lastKnownDeaths: 0, lastKnownHeadshots: 0 };
        updateGUI();
      } else {
        addNotification("No match data to submit yet", "error");
      }
    }
  });

  // === Init ===

  function init() {
    buildGUI();
    connectWS();
    initGameTracking();

    const autoAuth = setInterval(() => {
      const token = GM_getValue("auth_token", "");
      if (token && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "auth", data: { token } }));
        clearInterval(autoAuth);
      }
    }, 1000);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 2000);
  } else {
    window.addEventListener("load", () => setTimeout(init, 2000));
  }
})();
