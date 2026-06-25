const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const cors = require("cors");
const path = require("path");

const database = require("./database");
const ranking = require("./ranking");
const seasons = require("./seasons");

const PORT = process.env.PORT || 10000;
const WSS_PATH = "/ws";

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const connectedClients = new Map();

function broadcastToClients(type, data) {
  const msg = JSON.stringify({ type, data });
  for (const [, ws] of connectedClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function setupWSS() {
  const wss = new WebSocketServer({ server, path: WSS_PATH });

  wss.on("connection", (ws) => {
    let authenticatedUser = null;

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { ws.send(JSON.stringify({ type: "error", data: { message: "Invalid JSON" } })); return; }

      switch (msg.type) {
        case "auth": {
          if (msg.data?.token) {
            const username = database.authenticatePlayer(msg.data.token);
            if (username) {
              authenticatedUser = username;
              connectedClients.set(username, ws);
              const seasonId = seasons.getCurrentSeason()?.id;
              const profile = database.getPlayerProfile(username, seasonId);
              ws.send(JSON.stringify({ type: "auth_success", data: { username, profile, season: seasons.getCurrentSeason() } }));
            } else {
              ws.send(JSON.stringify({ type: "auth_failed", data: { message: "Invalid token" } }));
            }
          } else if (msg.data?.username) {
            const result = database.registerPlayer(msg.data.username);
            authenticatedUser = result.username;
            connectedClients.set(result.username, ws);
            const seasonId = seasons.getCurrentSeason()?.id;
            const profile = database.getPlayerProfile(result.username, seasonId);
            ws.send(JSON.stringify({ type: "auth_success", data: { username: result.username, token: result.token, profile, isNew: !result.existed, season: seasons.getCurrentSeason() } }));
          } else {
            ws.send(JSON.stringify({ type: "auth_failed", data: { message: "Provide token or username" } }));
          }
          break;
        }

        case "submit_match": {
          if (!authenticatedUser) { ws.send(JSON.stringify({ type: "error", data: { message: "Not authenticated" } })); return; }
          seasons.checkSeasonExpiry(database);
          const seasonId = seasons.getCurrentSeason()?.id;
          const stats = msg.data;
          if (!stats || typeof stats.kills !== "number" || typeof stats.won !== "boolean") {
            ws.send(JSON.stringify({ type: "error", data: { message: "Invalid match data" } })); return;
          }
          const result = database.submitMatch(authenticatedUser, seasonId, stats);
          const profile = database.getPlayerProfile(authenticatedUser, seasonId);
          ws.send(JSON.stringify({ type: "match_result", data: result }));
          ws.send(JSON.stringify({ type: "profile_update", data: profile }));
          if (result.rankChanged) {
            broadcastToClients("rank_update", { username: authenticatedUser, oldRank: result.oldRank, newRank: result.newRank, points: result.newPoints });
          }
          break;
        }

        case "get_profile": {
          if (!authenticatedUser) { ws.send(JSON.stringify({ type: "error", data: { message: "Not authenticated" } })); return; }
          const seasonId = seasons.getCurrentSeason()?.id;
          const profile = database.getPlayerProfile(authenticatedUser, seasonId);
          ws.send(JSON.stringify({ type: "profile", data: profile }));
          break;
        }

        case "get_leaderboard": {
          const seasonId = msg.data?.seasonId || seasons.getCurrentSeason()?.id;
          const limit = msg.data?.limit || 50;
          const lb = seasons.getSeasonLeaderboard(database, seasonId, limit);
          ws.send(JSON.stringify({ type: "leaderboard", data: { seasonId, entries: lb } }));
          break;
        }

        case "get_lifetime_leaderboard": {
          const limit = msg.data?.limit || 50;
          const lb = seasons.getLifetimeLeaderboard(database, limit);
          ws.send(JSON.stringify({ type: "lifetime_leaderboard", data: { entries: lb } }));
          break;
        }

        case "get_season": {
          ws.send(JSON.stringify({ type: "season", data: seasons.getCurrentSeason() }));
          break;
        }

        case "get_stats": {
          const seasonId = seasons.getCurrentSeason()?.id;
          const stats = database.getGlobalStats(seasonId);
          ws.send(JSON.stringify({ type: "global_stats", data: stats }));
          break;
        }
      }
    });

    ws.on("close", () => {
      if (authenticatedUser) connectedClients.delete(authenticatedUser);
    });

    ws.send(JSON.stringify({ type: "connected", data: { message: "Cryzen Comp server connected" } }));
  });
}

app.get("/api/leaderboard", (req, res) => {
  const seasonId = req.query.seasonId || seasons.getCurrentSeason()?.id;
  const limit = parseInt(req.query.limit) || 50;
  const lb = seasons.getSeasonLeaderboard(database, seasonId, limit);
  res.json({ seasonId, entries: lb });
});

app.get("/api/leaderboard/lifetime", (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const lb = seasons.getLifetimeLeaderboard(database, limit);
  res.json({ entries: lb });
});

app.get("/api/leaderboard/kills", (req, res) => {
  const seasonId = req.query.seasonId || seasons.getCurrentSeason()?.id;
  const limit = parseInt(req.query.limit) || 10;
  res.json({ entries: database.getTopKillers(seasonId, limit) });
});

app.get("/api/leaderboard/wins", (req, res) => {
  const seasonId = req.query.seasonId || seasons.getCurrentSeason()?.id;
  const limit = parseInt(req.query.limit) || 10;
  res.json({ entries: database.getTopWinners(seasonId, limit) });
});

app.get("/api/player/:username", (req, res) => {
  const seasonId = req.query.seasonId || seasons.getCurrentSeason()?.id;
  const profile = database.getPlayerProfile(req.params.username, seasonId);
  if (!profile) return res.status(404).json({ error: "Player not found" });
  res.json(profile);
});

app.get("/api/player/:username/matches", (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const matches = database.getMatchHistory(req.params.username, limit);
  res.json(matches);
});

app.get("/api/stats", (req, res) => {
  const seasonId = req.query.seasonId || seasons.getCurrentSeason()?.id;
  res.json(database.getGlobalStats(seasonId));
});

app.get("/api/season", (req, res) => {
  res.json(seasons.getCurrentSeason());
});

app.get("/api/ranks", (req, res) => {
  res.json(ranking.RANKS);
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), clients: connectedClients.size });
});

app.get("/plugin/cryzen-comp.user.js", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "tampermonkey", "cryzen-comp.js"));
});

async function start() {
  await database.init();
  seasons.initSeason(database);
  setupWSS();

  server.listen(PORT, () => {
    console.log(`Cryzen Comp server running on port ${PORT}`);
    console.log(`WebSocket: ws://localhost:${PORT}${WSS_PATH}`);
    console.log(`Dashboard: http://localhost:${PORT}/`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

module.exports = { app, server, start };