const RANKS = [
  { name: "Bronze I",    icon: "🥉", minPoints: 0,    maxPoints: 99,   tier: "Bronze",   level: 1 },
  { name: "Bronze II",   icon: "🥉", minPoints: 100,  maxPoints: 199,  tier: "Bronze",   level: 2 },
  { name: "Bronze III",  icon: "🥉", minPoints: 200,  maxPoints: 299,  tier: "Bronze",   level: 3 },
  { name: "Silver I",    icon: "🥈", minPoints: 300,  maxPoints: 399,  tier: "Silver",   level: 1 },
  { name: "Silver II",   icon: "🥈", minPoints: 400,  maxPoints: 499,  tier: "Silver",   level: 2 },
  { name: "Silver III",  icon: "🥈", minPoints: 500,  maxPoints: 599,  tier: "Silver",   level: 3 },
  { name: "Gold I",      icon: "🥇", minPoints: 600,  maxPoints: 699,  tier: "Gold",     level: 1 },
  { name: "Gold II",     icon: "🥇", minPoints: 700,  maxPoints: 799,  tier: "Gold",     level: 2 },
  { name: "Gold III",    icon: "🥇", minPoints: 800,  maxPoints: 899,  tier: "Gold",     level: 3 },
  { name: "Champion I",  icon: "🏆", minPoints: 900,  maxPoints: 999,  tier: "Champion", level: 1 },
  { name: "Champion II", icon: "🏆", minPoints: 1000, maxPoints: 1099, tier: "Champion", level: 2 },
  { name: "Champion III",icon: "🏆", minPoints: 1100, maxPoints: null, tier: "Champion", level: 3 },
];

const POINTS = {
  WIN: 25,
  KILL: 2,
  HEADSHOT_BONUS: 1,
  LOSS: -15,
  HIGH_DEATH_THRESHOLD: 10,
  HIGH_DEATH_PENALTY: -2,
};

function getRank(points) {
  if (points < 0) points = 0;
  for (const rank of RANKS) {
    if (rank.maxPoints === null || points <= rank.maxPoints) {
      return rank;
    }
  }
  return RANKS[RANKS.length - 1];
}

function getNextRank(points) {
  const current = getRank(points);
  const idx = RANKS.indexOf(current);
  if (idx < RANKS.length - 1) return RANKS[idx + 1];
  return null;
}

function getPointsToNextRank(points) {
  const current = getRank(points);
  const next = getNextRank(points);
  if (!next) return 0;
  return next.minPoints - points;
}

function calculateMatchPoints(stats) {
  const { kills, deaths, headshots, won } = stats;
  let delta = 0;

  if (won) {
    delta += POINTS.WIN;
  } else {
    delta += POINTS.LOSS;
  }

  delta += kills * POINTS.KILL;
  delta += headshots * POINTS.HEADSHOT_BONUS;

  if (!won && deaths >= POINTS.HIGH_DEATH_THRESHOLD) {
    delta += POINTS.HIGH_DEATH_PENALTY;
  }

  return delta;
}

function getRankColor(tier) {
  const colors = {
    Bronze:   "#CD7F32",
    Silver:   "#C0C0C0",
    Gold:     "#FFD700",
    Champion: "#FF5733",
  };
  return colors[tier] || "#FFFFFF";
}

module.exports = {
  RANKS,
  POINTS,
  getRank,
  getNextRank,
  getPointsToNextRank,
  calculateMatchPoints,
  getRankColor,
};
