// rounds.js — match flow: buy phase, live round, hill capture and scoring,
// zone rotation, round/match resolution, and the economy (rewards + buys).
import { CFG, S, ZONES, liveZone, resetRound } from './state.js';
import { WEAPONS, THROWABLES, ARMOR, AMMO_PACK, weaponById } from './weapons.js';
import { giveWeapon, resetForRound, respawnPlayer } from './player.js';
import { resetBotsForRound } from './bots.js';
import { paintZone } from './map.js';
import { showBanner, showToast, setBuyMsg, refreshBuyMenu, closeBuy, hideDeath, showMatchEnd } from './hud.js';
import { playZoneCapture, playRoundWin, playRoundLose, playBuy, playDenied, playCaptureTick, playRespawn } from './audio.js';

let worldRef = null;
let tickClock = 0;

export function initRounds(world) { worldRef = world; }

export function startMatch(world) {
  worldRef = world;
  const p = S.player;
  p.money = CFG.START_MONEY;
  p.kills = 0; p.deaths = 0;
  resetForRound(p, world.spawns.az[0]);
  resetBotsForRound(world);
  paintAllZones();
  showBanner('ROUND 1', 'Buy phase — spend your $800, then take the ' + liveZone().name, false);
}

// Begin a fresh round after the previous one resolved.
function beginRound() {
  resetRound();
  const world = worldRef;
  const p = S.player;
  resetForRoundKeepMoney(p, world.spawns.az[S.round % world.spawns.az.length]);
  resetBotsForRound(world);
  hideDeath();
  closeBuy();
  paintAllZones();
  showBanner('ROUND ' + S.round, 'Capture the ' + liveZone().name + ' — first to ' + CFG.HILL_TARGET + ' hill points', false);
}

function resetForRoundKeepMoney(p, spawn) {
  const money = p.money;
  const primary = p.primary, slot = p.slot, frags = p.frags, smokes = p.smokes;
  resetForRound(p, spawn);
  p.money = money;
  if (primary && primary !== 'p9') giveWeapon(p, primary);
  p.slot = slot;
  p.frags = frags; p.smokes = smokes;
  p.keptPrimary = primary; p.keptSlot = slot;
  p.keptFrags = frags; p.keptSmokes = smokes; p.keptArmor = 0;
}

function paintAllZones() {
  for (let i = 0; i < worldRef.zones.length; i++) {
    const z = worldRef.zones[i];
    if (i === S.zoneIdx) paintZone(z, 0xffffff, 0.07);
    else paintZone(z, 0x33415e, 0.02);
  }
}

function paintLiveZone() {
  const z = worldRef.zones[S.zoneIdx];
  if (S.zoneOwner === 'az') paintZone(z, 0x37e6ff, 0.12);
  else if (S.zoneOwner === 'cr') paintZone(z, 0xff3d7e, 0.12);
  else if (S.zoneCapTeam === 'az') paintZone(z, 0x37e6ff, 0.09);
  else if (S.zoneCapTeam === 'cr') paintZone(z, 0xff3d7e, 0.09);
  else paintZone(z, 0xffffff, 0.07);
}

export function updateRounds(dt) {
  const world = worldRef;
  if (!world) return;
  if (S.phase === 'buy') {
    S.phaseT -= dt;
    if (S.phaseT <= 0) {
      S.phase = 'live';
      S.phaseT = CFG.ROUND_TIME;
      closeBuy();
      showBanner('TAKE THE ' + liveZone().name, 'Hold the zone to bank hill points', false);
    }
    return;
  }
  if (S.phase === 'roundEnd') {
    S.phaseT -= dt;
    if (S.phaseT <= 0) {
      if (S.wins.az >= CFG.ROUNDS_TO_WIN || S.wins.cr >= CFG.ROUNDS_TO_WIN) {
        endMatch();
      } else {
        S.round++;
        beginRound();
      }
    }
    return;
  }
  if (S.phase !== 'live') return;

  S.phaseT -= dt;
  // zone rotation clock
  S.zoneT -= dt;
  if (S.zoneT <= 0) rotateZone();

  updateHill(dt);

  // scoring: the owning team banks a hill point every SCORE_TICK
  if (S.zoneOwner) {
    S.scoreAcc += dt;
    if (S.scoreAcc >= CFG.SCORE_TICK) {
      S.scoreAcc -= CFG.SCORE_TICK;
      S.hill[S.zoneOwner]++;
      tickClock += 1;
      if (S.zoneOwner === 'az' && tickClock % 5 === 0) playCaptureTick();
    }
  }
  if (S.hill.az >= CFG.HILL_TARGET || S.hill.cr >= CFG.HILL_TARGET || S.phaseT <= 0) {
    endRound();
  }

  // player respawn
  const p = S.player;
  if (!p.alive && p.respawnT <= 0) {
    const spawns = world.spawns.az;
    respawnPlayer(p, spawns[(S.round + S.stats.deaths) % spawns.length]);
    hideDeath();
    playRespawn();
  }
}

function rotateZone() {
  S.zoneIdx = (S.zoneIdx + 1) % ZONES.length;
  S.zoneProgress = 0;
  S.zoneCapTeam = null;
  S.zoneOwner = null;
  S.zoneT = CFG.ZONE_HOLD;
  S.scoreAcc = 0;
  paintAllZones();
  showToast('Zone moved — capture the ' + liveZone().name);
}

function updateHill(dt) {
  const zone = liveZone();
  let az = 0, cr = 0, playerInside = false;
  const p = S.player;
  if (p.alive && insideZone(p.pos, zone)) { az++; playerInside = true; }
  for (const b of S.bots) {
    if (!b.alive) continue;
    if (insideZone(b.pos, zone)) { if (b.team === 'az') az++; else cr++; }
  }
  const solo = (az > 0) !== (cr > 0);
  if (!solo) {
    // contested or empty: progress decays slowly toward neutral
    if (S.zoneProgress > 0 && az === 0 && cr === 0) {
      S.zoneProgress = Math.max(0, S.zoneProgress - dt / (CFG.CAPTURE_TIME * 2));
      if (S.zoneProgress === 0) S.zoneCapTeam = null;
    }
    paintLiveZone();
    return;
  }
  const team = az > 0 ? 'az' : 'cr';
  if (S.zoneOwner === team) {
    // owner present: hold is secure, nothing to capture
    paintLiveZone();
    return;
  }
  if (S.zoneCapTeam !== team) {
    // new team pushing: must first unwind the other team's progress
    if (S.zoneProgress > 0 && S.zoneCapTeam) {
      S.zoneProgress -= dt / CFG.CAPTURE_TIME;
      if (S.zoneProgress <= 0) { S.zoneProgress = 0; S.zoneCapTeam = null; }
      paintLiveZone();
      return;
    }
    S.zoneCapTeam = team;
  }
  S.zoneProgress += dt / CFG.CAPTURE_TIME;
  if (playerInside && team === 'az' && Math.random() < dt * 2) playCaptureTick();
  if (S.zoneProgress >= 1) {
    S.zoneProgress = 1;
    S.zoneOwner = team;
    S.zoneCapTeam = team;
    for (const b of S.bots) {
      if (b.alive && b.team === team && insideZone(b.pos, zone)) b.captures++;
    }
    paintLiveZone();
    if (team === 'az') {
      S.player.money += CFG.CAPTURE_REWARD;
      if (playerInside) S.stats.captures++;
      showBanner('ZONE SECURED', '+$' + CFG.CAPTURE_REWARD + ' — hold it to bank points', false);
    } else {
      showBanner('ZONE LOST', 'Crimson holds the ' + zone.name, true);
    }
    playZoneCapture(team === 'az');
  }
  paintLiveZone();
}

function insideZone(pos, zone) {
  const dx = pos.x - zone.x, dz = pos.z - zone.z;
  return dx * dx + dz * dz < zone.r * zone.r;
}

function endRound() {
  // Hill points decide; a level round goes to the team with more eliminations.
  let winner;
  if (S.hill.az !== S.hill.cr) winner = S.hill.az > S.hill.cr ? 'az' : 'cr';
  else winner = S.roundKills.az >= S.roundKills.cr ? 'az' : 'cr';
  S.wins[winner]++;
  S.phase = 'roundEnd';
  S.phaseT = CFG.END_TIME;
  const p = S.player;
  p.money += winner === 'az' ? CFG.WIN_REWARD : CFG.LOSS_REWARD;
  closeBuy();
  if (winner === 'az') {
    showBanner('ROUND WON', S.hill.az + ' — ' + S.hill.cr + '  ·  +$' + CFG.WIN_REWARD, false);
    playRoundWin();
  } else {
    showBanner('ROUND LOST', S.hill.az + ' — ' + S.hill.cr + '  ·  +$' + CFG.LOSS_REWARD, true);
    playRoundLose();
  }
  // clear live grenades and smoke between rounds
  for (const g of S.grenades) if (g.mesh) worldRef.scene.remove(g.mesh);
  S.grenades.length = 0;
  S.smokes.length = 0;
}

function endMatch() {
  S.phase = 'matchEnd';
  S.winner = S.wins.az > S.wins.cr ? 'az' : 'cr';
  showMatchEnd();
}

// ---- economy: buys ----
export function buyItem(item) {
  const p = S.player;
  if (!p || S.phase !== 'buy') { setBuyMsg('Buy phase is closed.'); playDenied(); return; }
  if (item.kind === 'weapon') {
    const w = WEAPONS[item.ref];
    if (p.primary === item.ref || p.sidearm === item.ref) { setBuyMsg(w.name + ' already owned.'); return; }
    if (p.money < w.price) { setBuyMsg('Not enough money for ' + w.name + '.'); playDenied(); return; }
    p.money -= w.price;
    giveWeapon(p, item.ref);
    p.keptPrimary = p.primary; p.keptSlot = p.slot;
    setBuyMsg(w.name + ' purchased.');
    playBuy();
  } else if (item.kind === 'throwable') {
    const t = THROWABLES[item.ref];
    const cur = item.ref === 'frag' ? p.frags : p.smokes;
    if (cur >= t.max) { setBuyMsg(t.name + ' already full.'); return; }
    if (p.money < t.price) { setBuyMsg('Not enough money.'); playDenied(); return; }
    p.money -= t.price;
    if (item.ref === 'frag') { p.frags++; p.keptFrags = p.frags; }
    else { p.smokes++; p.keptSmokes = p.smokes; }
    setBuyMsg(t.name + ' purchased.');
    playBuy();
  } else if (item.ref === 'armor') {
    if (p.armor >= 50) { setBuyMsg('Armour already full.'); return; }
    if (p.money < ARMOR.price) { setBuyMsg('Not enough money.'); playDenied(); return; }
    p.money -= ARMOR.price;
    p.armor = 50;
    p.keptArmor = 50;
    setBuyMsg('Armour equipped.');
    playBuy();
  } else {
    // ammo resupply
    let need = false;
    for (const id of Object.keys(p.ammo)) {
      const def = weaponById(id);
      if (p.ammo[id].reserve < def.reserveMax) need = true;
    }
    if (!need) { setBuyMsg('Ammo already full.'); return; }
    if (p.money < AMMO_PACK.price) { setBuyMsg('Not enough money.'); playDenied(); return; }
    p.money -= AMMO_PACK.price;
    for (const id of Object.keys(p.ammo)) p.ammo[id].reserve = weaponById(id).reserveMax;
    setBuyMsg('Ammo refilled.');
    playBuy();
  }
  refreshBuyMenu();
}
