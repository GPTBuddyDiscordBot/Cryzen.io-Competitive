const DEFAULT_SEASON_DURATION_DAYS = 30;

let currentSeason = null;

function initSeason(db) {
  const row = db.prepare("SELECT * FROM seasons WHERE active = 1 ORDER BY id DESC LIMIT 1").get();
  if (row) {
    currentSeason = row;
    return row;
  }
  return createNewSeason(db);
}

function createNewSeason(db) {
  const now = Date.now();
  const endDate = now + DEFAULT_SEASON_DURATION_DAYS * 24 * 60 * 60 * 1000;
  const lastSeason = db.prepare("SELECT id FROM seasons ORDER BY id DESC LIMIT 1").get();
  const seasonNumber = (lastSeason ? lastSeason.id : 0) + 1;

  db.prepare("INSERT INTO seasons (id, name, start_date, end_date, active) VALUES (?, ?, ?, ?, 1)")
    .run([seasonNumber, `Season ${seasonNumber}`, now, endDate]);

  currentSeason = db.prepare("SELECT * FROM seasons WHERE active = 1 ORDER BY id DESC LIMIT 1").get();
  return currentSeason;
}

function endSeason(db) {
  if (!currentSeason) return;
  db.prepare("UPDATE seasons SET active = 0, ended_at = ? WHERE id = ?").run([Date.now(), currentSeason.id]);

  const players = db.prepare("SELECT username, points FROM season_stats WHERE season_id = ?").all([currentSeason.id]);
  for (const p of players) {
    db.prepare("INSERT OR IGNORE INTO lifetime_stats (username, total_matches, total_kills, total_deaths, total_headshots, total_wins, total_losses, total_points) VALUES (?, 0, 0, 0, 0, 0, 0, 0)")
      .run([p.username]);
    db.prepare(`
      UPDATE lifetime_stats SET
        total_matches = total_matches + (SELECT matches FROM season_stats WHERE username = ? AND season_id = ?),
        total_kills = total_kills + (SELECT kills FROM season_stats WHERE username = ? AND season_id = ?),
        total_deaths = total_deaths + (SELECT deaths FROM season_stats WHERE username = ? AND season_id = ?),
        total_headshots = total_headshots + (SELECT headshots FROM season_stats WHERE username = ? AND season_id = ?),
        total_wins = total_wins + (SELECT wins FROM season_stats WHERE username = ? AND season_id = ?),
        total_losses = total_losses + (SELECT losses FROM season_stats WHERE username = ? AND season_id = ?),
        total_points = total_points + ?
      WHERE username = ?
    `).run([
      p.username, currentSeason.id,
      p.username, currentSeason.id,
      p.username, currentSeason.id,
      p.username, currentSeason.id,
      p.username, currentSeason.id,
      p.username, currentSeason.id,
      p.points, p.username
    ]);
  }

  createNewSeason(db);
  return currentSeason;
}

function getCurrentSeason() {
  return currentSeason;
}

function checkSeasonExpiry(db) {
  if (!currentSeason) return false;
  if (Date.now() > currentSeason.end_date) {
    endSeason(db);
    return true;
  }
  return false;
}

function getSeasonLeaderboard(db, seasonId, limit = 50) {
  const sid = seasonId || currentSeason?.id;
  if (!sid) return [];
  return db.prepare(`
    SELECT username, points, kills, deaths, headshots, wins, losses, matches,
           ROUND(kills * 1.0 / CASE WHEN deaths = 0 THEN 1 ELSE deaths END, 2) as kd,
           ROUND(headshots * 1.0 / CASE WHEN kills = 0 THEN 1 ELSE kills END, 2) as hs_pct,
           ROUND(wins * 1.0 / CASE WHEN matches = 0 THEN 1 ELSE matches END, 2) as winrate
    FROM season_stats WHERE season_id = ?
    ORDER BY points DESC
    LIMIT ?
  `).all([sid, limit]);
}

function getLifetimeLeaderboard(db, limit = 50) {
  return db.prepare(`
    SELECT username, total_points, total_kills, total_deaths, total_headshots,
           total_wins, total_losses, total_matches,
           ROUND(total_kills * 1.0 / CASE WHEN total_deaths = 0 THEN 1 ELSE total_deaths END, 2) as kd,
           ROUND(total_headshots * 1.0 / CASE WHEN total_kills = 0 THEN 1 ELSE total_kills END, 2) as hs_pct,
           ROUND(total_wins * 1.0 / CASE WHEN total_matches = 0 THEN 1 ELSE total_matches END, 2) as winrate
    FROM lifetime_stats
    ORDER BY total_points DESC
    LIMIT ?
  `).all([limit]);
}

module.exports = {
  initSeason,
  createNewSeason,
  endSeason,
  getCurrentSeason,
  checkSeasonExpiry,
  getSeasonLeaderboard,
  getLifetimeLeaderboard,
  DEFAULT_SEASON_DURATION_DAYS,
};