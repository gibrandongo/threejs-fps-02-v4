// state.js — the one place game state lives. Every module reads and writes S;
// no other module keeps its own copy of match, round or economy state.
export const CFG = {
  SIM_DT: 1 / 60,            // fixed simulation step (seconds)
  MAX_STEPS: 4,              // cap catch-up steps per rendered frame
  MAP_W: 64, MAP_D: 48,      // playable roof size in metres (x by z)
  WALL_H: 1.25,              // parapet height around the roof edge
  ROUND_TIME: 100,           // seconds of live play per round
  BUY_TIME: 10,              // seconds of buy phase before each round
  END_TIME: 4,               // seconds the round-end banner shows
  HILL_TARGET: 60,           // hill points that win a round outright
  ROUNDS_TO_WIN: 3,          // match is first to 3 rounds (best of 5)
  ZONE_HOLD: 30,             // seconds before the live zone rotates
  CAPTURE_TIME: 6,           // seconds of uncontested presence to capture
  SCORE_TICK: 1.0,           // seconds per hill point while a zone is owned
  RESPAWN_TIME: 3,
  START_MONEY: 800,
  KILL_REWARD: 300,
  CAPTURE_REWARD: 400,
  WIN_REWARD: 1200,
  LOSS_REWARD: 800,
  GRAVITY: 22,
  EYE_STAND: 1.62,
  EYE_CROUCH: 1.12,
  PLAYER_R: 0.34,            // horizontal collision radius
  PLAYER_H: 1.78,
  BOT_COUNT: 9,              // 4 allies + 5 enemies
  PULSE_TIME: 4,             // killstreak-3 enemy reveal duration
  SMOKE_TIME: 10,
  FRAG_FUSE: 2.2,
  FRAG_RADIUS: 6.5,
  FRAG_DAMAGE: 115,
};

// Difficulty tuning for bot perception and accuracy. Chosen on the menu.
export const DIFFS = {
  recruit: { reactMin: 0.75, reactMax: 1.25, aimErr: 0.055, burstPause: 0.55, hearR: 16, label: 'Recruit' },
  veteran: { reactMin: 0.45, reactMax: 0.8, aimErr: 0.034, burstPause: 0.4, hearR: 22, label: 'Veteran' },
  elite: { reactMin: 0.25, reactMax: 0.5, aimErr: 0.02, burstPause: 0.3, hearR: 28, label: 'Elite' },
};

export const ZONES = [
  { id: 'helipad', name: 'HELIPAD', x: -22, z: -8, r: 6.5 },
  { id: 'garden', name: 'GARDEN', x: 14, z: 6, r: 6.0 },
  { id: 'antenna', name: 'ANTENNA', x: -4, z: -17, r: 5.5 },
];

export const BOT_NAMES = {
  az: ['Vex', 'Juno', 'Kaito', 'Mira'],
  cr: ['Rook', 'Sable', 'Onyx', 'Dagger', 'Havoc'],
};

// The single mutable state object. resetMatch() re-initialises it in place so
// every module holding a reference to S keeps seeing the current match.
export const S = {
  phase: 'menu',           // menu | buy | live | roundEnd | matchEnd
  paused: false,
  phaseT: 0,               // seconds left in the current phase
  round: 1,
  wins: { az: 0, cr: 0 },
  hill: { az: 0, cr: 0 },
  zoneIdx: 0,
  zoneProgress: 0,         // 0..1 toward the capturing team
  zoneCapTeam: null,       // team currently filling the bar, or null
  zoneOwner: null,         // team that owns the live zone, or null
  zoneT: CFG.ZONE_HOLD,    // seconds until the live zone rotates
  scoreAcc: 0,             // fractional hill-point accumulator
  player: null,            // set by player.js
  bots: [],                // set by bots.js
  grenades: [],
  smokes: [],
  pulseUntil: 0,           // sim-time until enemy minimap reveal ends
  simTime: 0,
  timeScale: 1,
  settings: { diff: 'veteran', sens: 1.0, vol: 0.7 },
  stats: null,             // per-match player stats, see resetMatch
  roundKills: { az: 0, cr: 0 },
  lastKiller: '',
  lastAttacker: null,      // fighter ref for the death-spectate camera
  winner: null,            // 'az' | 'cr' when the match ends
  autoMode: false,         // started from ?auto=1 (no pointer lock)
  muted: false,
};

export function freshStats() {
  return { kills: 0, deaths: 0, captures: 0, shots: 0, hits: 0, streak: 0, bestStreak: 0, headshots: 0 };
}

export function resetMatch() {
  S.phase = 'buy';
  S.paused = false;
  S.phaseT = CFG.BUY_TIME;
  S.round = 1;
  S.wins.az = 0; S.wins.cr = 0;
  S.hill.az = 0; S.hill.cr = 0;
  S.zoneIdx = 0;
  S.zoneProgress = 0;
  S.zoneCapTeam = null;
  S.zoneOwner = null;
  S.zoneT = CFG.ZONE_HOLD;
  S.scoreAcc = 0;
  S.grenades.length = 0;
  S.smokes.length = 0;
  S.pulseUntil = 0;
  S.simTime = 0;
  S.stats = freshStats();
  S.roundKills.az = 0; S.roundKills.cr = 0;
  S.lastKiller = '';
  S.lastAttacker = null;
  S.winner = null;
}

export function resetRound() {
  S.phase = 'buy';
  S.phaseT = CFG.BUY_TIME;
  S.hill.az = 0; S.hill.cr = 0;
  S.zoneIdx = (S.round - 1) % ZONES.length;
  S.zoneProgress = 0;
  S.zoneCapTeam = null;
  S.zoneOwner = null;
  S.zoneT = CFG.ZONE_HOLD;
  S.scoreAcc = 0;
  S.grenades.length = 0;
  S.smokes.length = 0;
  S.pulseUntil = 0;
  S.roundKills.az = 0; S.roundKills.cr = 0;
}

export function liveZone() { return ZONES[S.zoneIdx]; }

export function diff() { return DIFFS[S.settings.diff] || DIFFS.veteran; }
