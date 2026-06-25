(function () {
  "use strict";

  const API_BASE = window.location.origin;
  const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws";

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

  function getRank(points) {
    if (points < 0) points = 0;
    for (const r of RANKS) {
      if (r.max === null || points <= r.max) return r;
    }
    return RANKS[RANKS.length - 1];
  }

  let ws = null;
  let currentLeaderboard = "season";
  let currentPage = "leaderboard";

  function toast(msg, type = "success") {
    const container = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity 0.3s"; }, 3000);
    setTimeout(() => el.remove(), 3400);
  }

  function setStatus(online) {
    const el = document.getElementById("status-indicator");
    if (online) {
      el.textContent = "ONLINE";
      el.className = "status-online";
    } else {
      el.textContent = "OFFLINE";
      el.className = "status-offline";
    }
  }

  function connectWS() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      setStatus(false);
      return;
    }

    ws.onopen = () => {
      setStatus(true);
      toast("Connected to server", "success");
      fetchAllData();
    };

    ws.onclose = () => {
      setStatus(false);
      setTimeout(connectWS, 5000);
    };

    ws.onerror = () => setStatus(false);

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch (msg.type) {
        case "leaderboard":
          if (currentLeaderboard === "season") renderLeaderboard(msg.data.entries);
          break;
        case "lifetime_leaderboard":
          if (currentLeaderboard === "lifetime") renderLeaderboard(msg.data.entries);
          break;
        case "global_stats":
          renderGlobalStats(msg.data);
          break;
        case "rank_update":
          if (currentLeaderboard === "season") fetchLeaderboard("season");
          break;
        case "season":
          renderSeason(msg.data);
          break;
      }
    };
  }

  async function apiGet(path) {
    try {
      const res = await fetch(API_BASE + path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      toast(`API error: ${e.message}`, "error");
      return null;
    }
  }

  function fetchAllData() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "get_leaderboard", data: { limit: 100 } }));
      ws.send(JSON.stringify({ type: "get_lifetime_leaderboard", data: { limit: 100 } }));
      ws.send(JSON.stringify({ type: "get_stats" }));
      ws.send(JSON.stringify({ type: "get_season" }));
    }
    fetchLeaderboard("season");
    fetchGlobalStats();
    fetchSeason();
  }

  function fetchLeaderboard(type) {
    currentLeaderboard = type;
    if (type === "season" && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "get_leaderboard", data: { limit: 100 } }));
      return;
    }
    if (type === "lifetime" && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "get_lifetime_leaderboard", data: { limit: 100 } }));
      return;
    }

    const endpoints = {
      season: "/api/leaderboard?limit=100",
      lifetime: "/api/leaderboard/lifetime?limit=100",
      kills: "/api/leaderboard/kills?limit=20",
      wins: "/api/leaderboard/wins?limit=20",
    };

    apiGet(endpoints[type]).then(data => {
      if (data && data.entries) renderLeaderboard(data.entries);
    });
  }

  function renderLeaderboard(entries) {
    const container = document.getElementById("leaderboard-entries");
    if (!entries || entries.length === 0) {
      container.innerHTML = `<div class="lb-empty">No players yet</div>`;
      return;
    }

    container.innerHTML = entries.map((e, i) => {
      const rank = getRank(e.points || e.total_points || 0);
      const pts = e.points || e.total_points || 0;
      const kills = e.kills || e.total_kills || 0;
      const deaths = e.deaths || e.total_deaths || 0;
      const ws = e.wins || e.total_wins || 0;
      const matches = e.matches || e.total_matches || 0;
      const kd = e.kd || (deaths > 0 ? (kills / deaths).toFixed(2) : kills);
      const wr = e.winrate || (matches > 0 ? ((ws / matches) * 100).toFixed(1) : 0);
      let topClass = "";
      if (i === 0) topClass = "top-1";
      else if (i === 1) topClass = "top-2";
      else if (i === 2) topClass = "top-3";

      return `
        <div class="lb-row ${topClass}">
          <span class="lb-position">#${i + 1}</span>
          <span class="lb-tier">${rank.icon}</span>
          <span class="lb-name" style="color:${rank.color}">${e.username}</span>
          <span class="lb-points">${pts}</span>
          <span class="lb-kd">${kd}</span>
          <span class="lb-wr">${wr}%</span>
          <span class="lb-matches">${matches}</span>
        </div>`;
    }).join("");
  }

  async function fetchGlobalStats() {
    const data = await apiGet("/api/stats");
    const health = await apiGet("/api/health");

    if (data) {
      document.getElementById("stat-players").textContent = data.totalPlayers || 0;
      document.getElementById("stat-matches").textContent = data.totalMatches || 0;
      renderRankDistribution(data.rankDistribution);
      renderRecentActivity(data.recentActivity);
    }

    if (health) {
      document.getElementById("stat-clients").textContent = health.clients || 0;
      const uptime = (health.uptime || 0);
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      document.getElementById("stat-uptime").textContent = `${h}h ${m}m`;
    }
  }

  function renderRankDistribution(distribution) {
    const container = document.getElementById("rank-distribution");
    if (!distribution) {
      container.innerHTML = `<div class="empty-state">No data</div>`;
      return;
    }

    const total = Object.values(distribution).reduce((a, b) => a + b, 0);
    const maxCount = Math.max(...Object.values(distribution), 1);

    container.innerHTML = RANKS.map(r => {
      const count = distribution[r.name] || 0;
      const pct = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
      const barPct = ((count / maxCount) * 100).toFixed(0);
      return `
        <div class="rank-bar-item">
          <span class="rank-bar-icon">${r.icon}</span>
          <div style="flex:1">
            <div style="display:flex;justify-content:space-between;">
              <span class="rank-bar-name" style="color:${r.color}">${r.name}</span>
              <span class="rank-bar-count">${count}</span>
            </div>
            <div class="rank-bar-bar"><div class="rank-bar-fill" style="width:${barPct}%;background:${r.color}"></div></div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${pct}%</div>
          </div>
        </div>`;
    }).join("");
  }

  function renderRecentActivity(activity) {
    const container = document.getElementById("recent-activity");
    if (!activity || activity.length === 0) {
      container.innerHTML = `<div class="empty-state">No recent activity</div>`;
      return;
    }

    container.innerHTML = activity.map(a => {
      const won = a.won === 1;
      const deltaClass = a.points_delta >= 0 ? "positive" : "negative";
      const deltaText = a.points_delta >= 0 ? `+${a.points_delta}` : `${a.points_delta}`;
      const time = new Date(a.timestamp).toLocaleString();
      return `
        <div class="activity-item">
          <span class="activity-player">${a.username}</span>
          <span class="activity-stats">${a.kills}K/${a.deaths}D/${a.headshots}HS</span>
          <span class="activity-result ${won ? 'win' : 'loss'}">${won ? 'WIN' : 'LOSS'}</span>
          <span class="activity-delta ${deltaClass}">${deltaText}</span>
          <span class="activity-time">${time}</span>
        </div>`;
    }).join("");
  }

  async function fetchSeason() {
    const data = await apiGet("/api/season");
    if (data) renderSeason(data);
  }

  function renderSeason(season) {
    const container = document.getElementById("season-info");
    if (!season) {
      container.innerHTML = `<div class="empty-state">No season info</div>`;
      return;
    }

    const start = new Date(season.start_date).toLocaleDateString();
    const end = new Date(season.end_date).toLocaleDateString();
    const now = Date.now();
    const daysLeft = Math.max(0, Math.ceil((season.end_date - now) / 86400000));
    const total = Math.ceil((season.end_date - season.start_date) / 86400000);
    const progress = Math.min(100, ((now - season.start_date) / (season.end_date - season.start_date)) * 100);

    container.innerHTML = `
      <div class="season-card">
        <div>
          <div class="season-name">${season.name}</div>
          <div class="season-dates">${start} - ${end}</div>
          <div class="season-days-left">${daysLeft} days remaining</div>
        </div>
        <div class="season-progress">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);">
            <span>${total - daysLeft} days elapsed</span><span>${daysLeft} days left</span>
          </div>
          <div class="season-progress-bar">
            <div class="season-progress-fill" style="width:${progress}%"></div>
          </div>
        </div>
      </div>
    `;

    const tiersContainer = document.getElementById("rank-tiers");
    tiersContainer.innerHTML = RANKS.map(r => `
      <div class="tier-card">
        <span class="tier-icon">${r.icon}</span>
        <div>
          <div class="tier-name" style="color:${r.color}">${r.name}</div>
          <div class="tier-range">${r.min}${r.max !== null ? ` - ${r.max}` : "+"} points</div>
        </div>
      </div>
    `).join("");
  }

  async function searchPlayer() {
    const username = document.getElementById("player-search").value.trim();
    const container = document.getElementById("player-profile");
    if (!username) {
      container.innerHTML = `<div class="empty-state">Enter a username to search</div>`;
      return;
    }

    container.innerHTML = `<div class="empty-state">Loading profile...</div>`;

    const data = await apiGet(`/api/player/${encodeURIComponent(username)}`);
    const matches = await apiGet(`/api/player/${encodeURIComponent(username)}/matches?limit=30`);

    if (!data) {
      container.innerHTML = `<div class="empty-state">Player not found</div>`;
      return;
    }

    const rank = getRank(data.season?.points || 0);
    const kd = data.season?.deaths > 0 ? (data.season.kills / data.season.deaths).toFixed(2) : (data.season?.kills || 0);
    const hsPct = data.season?.kills > 0 ? ((data.season.headshots / data.season.kills) * 100).toFixed(1) : 0;
    const winRate = data.season?.matches > 0 ? ((data.season.wins / data.season.matches) * 100).toFixed(1) : 0;

    let matchesHTML = "";
    if (matches && matches.length > 0) {
      matchesHTML = `
        <h3 style="margin-top:20px;">Match History</h3>
        <table class="match-history-table">
          <thead><tr><th>Result</th><th>K/D/HS</th><th>Points</th><th>Date</th></tr></thead>
          <tbody>
            ${matches.map(m => {
              const won = m.won === 1;
              const delta = m.points_delta >= 0 ? `+${m.points_delta}` : `${m.points_delta}`;
              const t = new Date(m.timestamp).toLocaleString();
              return `<tr>
                <td style="color:${won ? 'var(--green)' : 'var(--red)'};font-weight:600">${won ? 'WIN' : 'LOSS'}</td>
                <td>${m.kills}/${m.deaths}/${m.headshots}</td>
                <td style="color:${m.points_delta >= 0 ? 'var(--green)' : 'var(--red)'}">${delta} → ${m.points_after}</td>
                <td>${t}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>`;
    }

    container.innerHTML = `
      <div class="profile-card">
        <div class="profile-rank">
          <div class="profile-rank-icon">${rank.icon}</div>
          <div class="profile-rank-name" style="color:${rank.color}">${rank.name}</div>
          <div class="profile-rank-points">${data.season?.points || 0} points</div>
        </div>
        <div class="profile-stats">
          <div class="stat-card"><div class="stat-number">${data.season?.matches || 0}</div><div class="stat-label">Matches</div></div>
          <div class="stat-card"><div class="stat-number">${data.season?.wins || 0}</div><div class="stat-label">Wins</div></div>
          <div class="stat-card"><div class="stat-number">${data.season?.kills || 0}</div><div class="stat-label">Kills</div></div>
          <div class="stat-card"><div class="stat-number">${data.season?.deaths || 0}</div><div class="stat-label">Deaths</div></div>
          <div class="stat-card"><div class="stat-number">${data.season?.headshots || 0}</div><div class="stat-label">Headshots</div></div>
          <div class="stat-card"><div class="stat-number">${kd}</div><div class="stat-label">K/D Ratio</div></div>
          <div class="stat-card"><div class="stat-number">${hsPct}%</div><div class="stat-label">Headshot %</div></div>
          <div class="stat-card"><div class="stat-number">${winRate}%</div><div class="stat-label">Win Rate</div></div>
        </div>
      </div>
      <div class="stats-grid" style="margin-top:0;">
        <div class="stat-card"><div class="stat-number">${data.lifetime?.total_points || 0}</div><div class="stat-label">Lifetime Points</div></div>
        <div class="stat-card"><div class="stat-number">${data.lifetime?.total_matches || 0}</div><div class="stat-label">Lifetime Matches</div></div>
        <div class="stat-card"><div class="stat-number">${data.lifetime?.total_kills || 0}</div><div class="stat-label">Lifetime Kills</div></div>
        <div class="stat-card"><div class="stat-number">${data.lifetime?.total_wins || 0}</div><div class="stat-label">Lifetime Wins</div></div>
      </div>
      ${matchesHTML}
    `;
  }

  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      currentPage = page;
      document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
      link.classList.add("active");
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      document.getElementById(`page-${page}`).classList.add("active");

      if (page === "leaderboard") fetchLeaderboard(currentLeaderboard);
      if (page === "stats") fetchGlobalStats();
      if (page === "season") fetchSeason();
    });
  });

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      fetchLeaderboard(tab.dataset.lb);
    });
  });

  document.getElementById("refresh-btn").addEventListener("click", () => {
    fetchAllData();
    toast("Refreshed", "success");
  });

  document.getElementById("player-search-btn").addEventListener("click", searchPlayer);
  document.getElementById("player-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchPlayer();
  });

  connectWS();
  fetchAllData();
})();