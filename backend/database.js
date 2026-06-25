const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "cryzen_comp.db");

let db = null;
let saveInterval = null;

class Statement {
  constructor(sqlDb, sql) {
    this.sql = sql;
    this.sqlDb = sqlDb;
  }

  get(params = []) {
    try {
      const stmt = this.sqlDb.prepare(this.sql);
      if (params.length > 0) stmt.bind(params);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
      }
      stmt.free();
      return null;
    } catch (e) {
      return null;
    }
  }

  all(params = []) {
    try {
      const stmt = this.sqlDb.prepare(this.sql);
      if (params.length > 0) stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (e) {
      return [];
    }
  }

  run(params = []) {
    try {
      this.sqlDb.run(this.sql, params);
      const changes = this.sqlDb.getRowsModified();
      const lastId = this._lastInsertRowId();
      return { changes, lastInsertRowid: lastId };
    } catch (e) {
      throw e;
    }
  }

  _lastInsertRowId() {
    try {
      const stmt = this.sqlDb.prepare("SELECT last_insert_rowid() as id");
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row.id;
      }
      stmt.free();
      return 0;
    } catch {
      return 0;
    }
  }
}

function createStatement(sql) {
  return new Statement(db, sql);
}

function exec(sql) {
  db.run(sql);
}

function saveToDisk() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (e) {
    console.error("Failed to save database:", e.message);
  }
}

async function init() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    try {
      const buffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
    } catch (e) {
      console.error("Failed to load database, creating new:", e.message);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  exec(`
    CREATE TABLE IF NOT EXISTS players (
      username TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL,
      last_active INTEGER NOT NULL
    )
  `);
  exec(`
    CREATE TABLE IF NOT EXISTS seasons (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      start_date INTEGER NOT NULL,
      end_date INTEGER NOT NULL,
      active INTEGER DEFAULT 0,
      ended_at INTEGER DEFAULT NULL
    )
  `);
  exec(`
    CREATE TABLE IF NOT EXISTS season_stats (
      username TEXT NOT NULL,
      season_id INTEGER NOT NULL,
      points INTEGER DEFAULT 0,
      kills INTEGER DEFAULT 0,
      deaths INTEGER DEFAULT 0,
      headshots INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      matches INTEGER DEFAULT 0,
      peak_points INTEGER DEFAULT 0,
      PRIMARY KEY (username, season_id)
    )
  `);
  exec(`
    CREATE TABLE IF NOT EXISTS lifetime_stats (
      username TEXT PRIMARY KEY,
      total_matches INTEGER DEFAULT 0,
      total_kills INTEGER DEFAULT 0,
      total_deaths INTEGER DEFAULT 0,
      total_headshots INTEGER DEFAULT 0,
      total_wins INTEGER DEFAULT 0,
      total_losses INTEGER DEFAULT 0,
      total_points INTEGER DEFAULT 0
    )
  `);
  exec(`
    CREATE TABLE IF NOT EXISTS match_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      season_id INTEGER NOT NULL,
      kills INTEGER DEFAULT 0,
      deaths INTEGER DEFAULT 0,
      headshots INTEGER DEFAULT 0,
      won INTEGER DEFAULT 0,
      points_delta INTEGER DEFAULT 0,
      points_after INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL
    )
  `);

  saveToDisk();
  saveInterval = setInterval(saveToDisk, 30000);

  return db;
}

function getDb() {
  return db;
}

function registerPlayer(username) {
  const { v4: uuidv4 } = require("uuid");
  const token = uuidv4();
  const now = Date.now();

  try {
    createStatement("INSERT INTO players (username, token, created_at, last_active) VALUES (?, ?, ?, ?)")
      .run([username, token, now, now]);
    saveToDisk();
    return { username, token, success: true };
  } catch (err) {
    if (err.message && err.message.includes("UNIQUE")) {
      const existing = createStatement("SELECT token FROM players WHERE username = ?").get([username]);
      return { username, token: existing.token, success: true, existed: true };
    }
    throw err;
  }
}

function authenticatePlayer(token) {
  const row = createStatement("SELECT username, last_active FROM players WHERE token = ?").get([token]);
  if (!row) return null;
  createStatement("UPDATE players SET last_active = ? WHERE token = ?").run([Date.now(), token]);
  saveToDisk();
  return row.username;
}

function getPlayerProfile(username, seasonId) {
  const player = createStatement("SELECT * FROM players WHERE username = ?").get([username]);
  if (!player) return null;

  const seasonStats = createStatement(
    "SELECT * FROM season_stats WHERE username = ? AND season_id = ?"
  ).get([username, seasonId]) || {
    points: 0, kills: 0, deaths: 0, headshots: 0, wins: 0, losses: 0, matches: 0, peak_points: 0
  };

  const lifetimeStats = createStatement(
    "SELECT * FROM lifetime_stats WHERE username = ?"
  ).get([username]) || {
    total_matches: 0, total_kills: 0, total_deaths: 0, total_headshots: 0,
    total_wins: 0, total_losses: 0, total_points: 0
  };

  const recentMatches = createStatement(
    "SELECT * FROM match_history WHERE username = ? ORDER BY timestamp DESC LIMIT 20"
  ).all([username]);

  return {
    username,
    season: seasonStats,
    lifetime: lifetimeStats,
    recentMatches,
    lastActive: player.last_active,
    createdAt: player.created_at,
  };
}

function submitMatch(username, seasonId, stats) {
  const { calculateMatchPoints, getRank } = require("./ranking");
  const pointsDelta = calculateMatchPoints(stats);
  const now = Date.now();

  const currentStats = createStatement(
    "SELECT points FROM season_stats WHERE username = ? AND season_id = ?"
  ).get([username, seasonId]);

  const currentPoints = currentStats ? currentStats.points : 0;
  const newPoints = Math.max(0, currentPoints + pointsDelta);

  if (currentStats) {
    createStatement(`
      UPDATE season_stats SET
        points = ?,
        kills = kills + ?,
        deaths = deaths + ?,
        headshots = headshots + ?,
        wins = wins + ?,
        losses = losses + ?,
        matches = matches + 1,
        peak_points = CASE WHEN ? > peak_points THEN ? ELSE peak_points END
      WHERE username = ? AND season_id = ?
    `).run([newPoints, stats.kills, stats.deaths, stats.headshots,
      stats.won ? 1 : 0, stats.won ? 0 : 1, newPoints, newPoints, username, seasonId]);
  } else {
    createStatement(`
      INSERT INTO season_stats (username, season_id, points, kills, deaths, headshots, wins, losses, matches, peak_points)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run([username, seasonId, newPoints, stats.kills, stats.deaths, stats.headshots,
      stats.won ? 1 : 0, stats.won ? 0 : 1, newPoints]);
  }

  createStatement(`
    INSERT INTO match_history (username, season_id, kills, deaths, headshots, won, points_delta, points_after, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run([username, seasonId, stats.kills, stats.deaths, stats.headshots,
    stats.won ? 1 : 0, pointsDelta, newPoints, now]);

  saveToDisk();

  const newRank = getRank(newPoints);
  const oldRank = getRank(currentPoints);

  return {
    pointsDelta,
    newPoints,
    newRank: newRank.name,
    oldRank: oldRank.name,
    rankChanged: newRank.name !== oldRank.name,
  };
}

function getGlobalStats(seasonId) {
  const totalPlayers = createStatement(
    "SELECT COUNT(*) as count FROM season_stats WHERE season_id = ?"
  ).get([seasonId]);
  const playerCount = totalPlayers ? totalPlayers.count : 0;

  const totalMatches = createStatement(
    "SELECT SUM(matches) as total FROM season_stats WHERE season_id = ?"
  ).get([seasonId]);
  const matchCount = totalMatches ? totalMatches.total || 0 : 0;

  const { RANKS, getRank } = require("./ranking");
  const rankDistribution = {};
  for (const r of RANKS) rankDistribution[r.name] = 0;

  const players = createStatement("SELECT points FROM season_stats WHERE season_id = ?").all([seasonId]);
  for (const p of players) {
    const rank = getRank(p.points);
    rankDistribution[rank.name]++;
  }

  const recentActivity = createStatement(
    "SELECT * FROM match_history WHERE season_id = ? ORDER BY timestamp DESC LIMIT 20"
  ).all([seasonId]);

  return {
    totalPlayers: playerCount,
    totalMatches: matchCount,
    rankDistribution,
    recentActivity,
  };
}

function getTopKillers(seasonId, limit = 10) {
  return createStatement(
    "SELECT username, kills, deaths, matches FROM season_stats WHERE season_id = ? ORDER BY kills DESC LIMIT ?"
  ).all([seasonId, limit]);
}

function getTopWinners(seasonId, limit = 10) {
  return createStatement(
    "SELECT username, wins, losses, matches FROM season_stats WHERE season_id = ? ORDER BY wins DESC LIMIT ?"
  ).all([seasonId, limit]);
}

function getMatchHistory(username, limit = 50) {
  return createStatement(
    "SELECT * FROM match_history WHERE username = ? ORDER BY timestamp DESC LIMIT ?"
  ).all([username, limit]);
}

function shutdown() {
  if (saveInterval) clearInterval(saveInterval);
  saveToDisk();
}

module.exports = {
  init,
  getDb,
  prepare: createStatement,
  exec,
  registerPlayer,
  authenticatePlayer,
  getPlayerProfile,
  submitMatch,
  getGlobalStats,
  getTopKillers,
  getTopWinners,
  getMatchHistory,
  shutdown,
  DB_PATH,
};