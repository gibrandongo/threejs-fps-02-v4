// bots.js — the nine bots: waypoint navigation, hold positions, vision cones,
// hearing, reaction times, burst fire, strafing, grenades and zone play.
// Roles per team: two cappers push the live zone, two holders anchor angles
// near it, one flex roams toward the sound of gunfire.
import * as THREE from 'three';
import { CFG, S, BOT_NAMES, diff, liveZone, ZONES } from './state.js';
import { weaponById, botLoadout } from './weapons.js';
import { collideMove } from './player.js';
import { hasLOS, damageFighter, throwGrenade, fighterHitMeshes, registerHitMeshes, unregisterHitMeshes } from './combat.js';
import { nearestWaypoint, findPath } from './map.js';
import { fireTracer, muzzleFlash, impactSparks } from './effects.js';
import { playDistantShot } from './audio.js';
import { addCallout } from './hud.js';

const _eye = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _side = new THREE.Vector3();
const _muz = new THREE.Vector3();
const ROLES = ['cap', 'cap', 'hold', 'hold', 'flex'];

function botMaterials(team) {
  const main = team === 'az' ? 0x1e5a78 : 0x7a1e40;
  const trim = team === 'az' ? 0x37e6ff : 0xff3d7e;
  return {
    body: new THREE.MeshStandardMaterial({ color: main, roughness: 0.6, metalness: 0.3, emissive: 0x000000 }),
    trim: new THREE.MeshStandardMaterial({ color: trim, emissive: trim, emissiveIntensity: 1.4, roughness: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x161a24, roughness: 0.8 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.45, metalness: 0.7 }),
  };
}

function buildBotMesh(bot, mats) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, part) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.userData.bot = bot;
    m.userData.part = part;
    g.add(m);
    bot.parts.push(m);
    return m;
  };
  // legs (animated swing)
  bot.legL = add(new THREE.BoxGeometry(0.17, 0.72, 0.2), mats.dark, -0.13, 0.36, 0, 'legs');
  bot.legR = add(new THREE.BoxGeometry(0.17, 0.72, 0.2), mats.dark, 0.13, 0.36, 0, 'legs');
  bot.legL.geometry.translate(0, -0.36, 0); bot.legL.position.y = 0.72;
  bot.legR.geometry.translate(0, -0.36, 0); bot.legR.position.y = 0.72;
  // torso + trim plate + head + visor + gun
  add(new THREE.BoxGeometry(0.56, 0.78, 0.32), mats.body, 0, 1.11, 0, 'body');
  add(new THREE.BoxGeometry(0.4, 0.2, 0.05), mats.trim, 0, 1.28, 0.18, 'body');
  add(new THREE.BoxGeometry(0.34, 0.34, 0.34), mats.body, 0, 1.68, 0, 'head');
  add(new THREE.BoxGeometry(0.28, 0.09, 0.05), mats.trim, 0, 1.7, 0.18, 'head');
  const gun = add(new THREE.BoxGeometry(0.09, 0.12, 0.62), mats.gun, 0.22, 1.28, 0.3, 'body');
  gun.userData.part = 'body';
  const pack = add(new THREE.BoxGeometry(0.4, 0.5, 0.16), mats.dark, 0, 1.15, -0.24, 'body');
  pack.userData.part = 'body';
  bot.mats = mats;
  return g;
}

export function createBots(scene, world) {
  S.bots.length = 0;
  fighterHitMeshes.length = 0;
  for (const team of ['az', 'cr']) {
    const names = BOT_NAMES[team];
    const count = team === 'az' ? 4 : 5;
    for (let i = 0; i < count; i++) {
      const bot = {
        isBot: true, team, name: names[i], index: i,
        role: ROLES[i],
        pos: new THREE.Vector3(), yaw: 0, pitch: 0,
        hp: 100, maxHp: 100, armor: 0,
        alive: true, respawnT: 0,
        weaponId: 'p9', ammo: { mag: 12, reserve: 48 },
        frags: 1, grenadeT: 6 + Math.random() * 8,
        path: [], pathIdx: 0, goal: new THREE.Vector3(), goalKind: 'none',
        holdPos: new THREE.Vector3(), holdUntil: 0,
        target: null, seeT: 0, reactT: 0, lostT: 0,
        burstLeft: 0, burstT: 0, reloadT: 0, reloading: false,
        hearPos: null, hearT: 0,
        strafeDir: 1, strafeT: 0, walkPhase: 0, stuckT: 0,
        scanT: Math.random() * 0.15,   // staggered perception scans (see below)
        lastX: 0, lastZ: 0, repathT: 0, decideT: Math.random() * 0.4,
        flashT: 0, speed: 4.6, aimErr: 0.03,
        kills: 0, deaths: 0, captures: 0,
        parts: [], group: null, spawnProtT: 0,
      };
      const mats = botMaterials(team);
      bot.group = buildBotMesh(bot, mats);
      scene.add(bot.group);
      S.bots.push(bot);
    }
  }
  return S.bots;
}

export function resetBotsForRound(world) {
  fighterHitMeshes.length = 0;
  for (const bot of S.bots) {
    const spawns = world.spawns[bot.team];
    const s = spawns[bot.index % spawns.length];
    spawnBot(bot, s, world);
    bot.weaponId = botLoadout(S.round, bot.index);
    const def = weaponById(bot.weaponId);
    bot.ammo = { mag: def.mag, reserve: def.reserveMax };
    bot.frags = 1;
    bot.grenadeT = 6 + Math.random() * 8;
    bot.kills = 0; bot.deaths = 0; bot.captures = 0;
    bot.target = null; bot.hearPos = null; bot.path = []; bot.goalKind = 'none';
    bot.decideT = Math.random() * 0.5;
  }
}

function spawnBot(bot, s, world) {
  bot.pos.set(s[0], 0, s[1]);
  bot.yaw = s[2];
  bot.hp = bot.maxHp;
  bot.armor = S.round >= 3 ? 25 : 0;
  bot.alive = true;
  bot.respawnT = 0;
  bot.spawnProtT = 1.0;
  bot.flashT = 0;
  bot.group.visible = true;
  bot.group.position.copy(bot.pos);
  registerHitMeshes(bot);
  void world;
}

let lastCalloutT = -99;
function nearestZoneName(x, z) {
  let best = ZONES[0], bd = Infinity;
  for (const zn of ZONES) {
    const d = (zn.x - x) ** 2 + (zn.z - z) ** 2;
    if (d < bd) { bd = d; best = zn; }
  }
  return best.name;
}
function maybeCallout(bot, text) {
  if (S.simTime - lastCalloutT < 5) return;
  lastCalloutT = S.simTime;
  addCallout(bot.name, text, bot.team);
}

function enemiesOf(bot) {
  const list = [];
  if (S.player && S.player.team !== bot.team) list.push(S.player);
  for (const b of S.bots) if (b.team !== bot.team) list.push(b);
  return list;
}

function canSee(bot, foe, world) {
  if (!foe.alive) return false;
  _eye.set(bot.pos.x, 1.55, bot.pos.z);
  _tgt.set(foe.pos.x, 1.3 + foe.pos.y, foe.pos.z);
  const d = _eye.distanceTo(_tgt);
  if (d > 46) return false;
  // vision cone, unless the foe is close or the bot is already tracking them
  _dir.subVectors(_tgt, _eye).normalize();
  const facing = Math.sin(bot.yaw) * -_dir.x + Math.cos(bot.yaw) * -_dir.z;
  const tracking = bot.target === foe;
  if (d > 7 && !tracking && facing < 0.25) return false;
  return hasLOS(world, _eye, _tgt);
}

function pickGoal(bot, world) {
  const zone = liveZone();
  if (bot.role === 'cap') {
    // cappers drive onto the live zone; spread around its centre
    const a = (bot.index * 2.1) % (Math.PI * 2);
    bot.goal.set(zone.x + Math.cos(a) * zone.r * 0.45, 0, zone.z + Math.sin(a) * zone.r * 0.45);
    bot.goalKind = 'zone';
  } else if (bot.role === 'hold') {
    // holders anchor a firing angle just outside the ring
    const a = Math.atan2(bot.pos.z - zone.z, bot.pos.x - zone.x) + (bot.index % 2 ? 0.9 : -0.9);
    const r = zone.r + 4.5;
    bot.goal.set(zone.x + Math.cos(a) * r, 0, zone.z + Math.sin(a) * r);
    bot.goal.x = Math.max(-30, Math.min(30, bot.goal.x));
    bot.goal.z = Math.max(-22, Math.min(22, bot.goal.z));
    bot.goalKind = 'hold';
  } else if (bot.hearPos && bot.hearT > 0) {
    bot.goal.copy(bot.hearPos);
    bot.goalKind = 'hunt';
  } else {
    // flex without a lead shadows the zone from mid-range
    const a = (bot.index * 1.7 + S.simTime * 0.05) % (Math.PI * 2);
    bot.goal.set(zone.x + Math.cos(a) * (zone.r + 8), 0, zone.z + Math.sin(a) * (zone.r + 8));
    bot.goal.x = Math.max(-30, Math.min(30, bot.goal.x));
    bot.goal.z = Math.max(-22, Math.min(22, bot.goal.z));
    bot.goalKind = 'roam';
  }
  const from = nearestWaypoint(world.waypoints, bot.pos.x, bot.pos.z);
  const to = nearestWaypoint(world.waypoints, bot.goal.x, bot.goal.z);
  bot.path = findPath(world.waypoints, from, to);
  bot.pathIdx = 0;
  bot.repathT = 3;
  bot.stuckT = 0;
}

function steerTarget(bot, world, out) {
  if (bot.path.length > 0 && bot.pathIdx < bot.path.length) {
    const wp = world.waypoints[bot.path[bot.pathIdx]];
    out.set(wp.x, 0, wp.z);
    if (Math.hypot(out.x - bot.pos.x, out.z - bot.pos.z) < 1.2) bot.pathIdx++;
    if (bot.pathIdx >= bot.path.length) { bot.path = []; }
    return out;
  }
  return out.copy(bot.goal);
}

function botFire(bot, foe, dt, world) {
  const def = weaponById(bot.weaponId);
  const d = diff();
  if (bot.reloading) {
    bot.reloadT -= dt;
    if (bot.reloadT <= 0) {
      bot.reloading = false;
      const need = def.mag - bot.ammo.mag;
      const take = Math.min(need, bot.ammo.reserve);
      bot.ammo.mag += take; bot.ammo.reserve -= take;
    }
    return;
  }
  if (bot.ammo.mag <= 0) {
    if (bot.ammo.reserve > 0) { bot.reloading = true; bot.reloadT = def.reload; }
    else { bot.ammo.mag = def.mag; bot.ammo.reserve = def.reserveMax; } // bots scavenge
    return;
  }
  bot.burstT -= dt;
  if (bot.burstT > 0) return;
  if (bot.burstLeft <= 0) {
    bot.burstLeft = def.auto ? 3 + ((Math.random() * 3) | 0) : 1;
    bot.burstT = d.burstPause * (0.7 + Math.random() * 0.6);
    return;
  }
  bot.burstT = 60 / def.rpm;
  bot.burstLeft--;
  bot.ammo.mag--;
  _eye.set(bot.pos.x, 1.55, bot.pos.z);
  _tgt.set(foe.pos.x, 1.25 + foe.pos.y, foe.pos.z);
  _dir.subVectors(_tgt, _eye).normalize();
  // aim error: worse at range, better when the bot stands still
  const dist = _eye.distanceTo(_tgt);
  const err = d.aimErr * (0.7 + dist / 30);
  _dir.x += (Math.random() - 0.5) * err * 2;
  _dir.y += (Math.random() - 0.5) * err * 2;
  _dir.z += (Math.random() - 0.5) * err * 2;
  _dir.normalize();
  // headshots: elites sometimes aim high
  const headAim = Math.random() < (S.settings.diff === 'elite' ? 0.22 : 0.1);
  const hit = raycastWorld(world, _eye, _dir, 60, bot);
  _muz.copy(_eye).addScaledVector(_dir, 0.7);
  muzzleFlash(_muz, 0xffe9a8);
  if (S.player) playDistantShot(def.sound, _eye.distanceTo(S.player.pos));
  if (!hit) {
    _to.copy(_eye).addScaledVector(_dir, 40);
    fireTracer(_muz, _to, def.tracer);
    return;
  }
  fireTracer(_muz, hit.point, def.tracer);
  if (hit.foe) {
    const part = headAim && Math.random() < 0.5 ? 'head' : hit.part;
    const mult = part === 'head' ? def.headMult : (part === 'legs' ? def.legMult : 1);
    damageFighter(hit.foe, def.damage * mult * falloff(def, dist), bot, part);
  } else {
    impactSparks(hit.point, 0xffd98a, 3);
  }
}

function falloff(def, dist) {
  const half = def.range * 0.5;
  if (dist <= half) return 1;
  const t = Math.min(1, (dist - half) / half);
  return 1 - (1 - def.falloff) * t;
}

// Raycast used by bots: occluders + living fighters, nearest hit wins.
const _ray = new THREE.Raycaster();
function raycastWorld(world, origin, dir, maxDist, self) {
  _ray.set(origin, dir);
  _ray.far = maxDist;
  const wHits = _ray.intersectObjects(world.shotMeshes, false);
  let best = null, bestD = maxDist;
  if (wHits.length) { best = { point: wHits[0].point.clone(), foe: null, part: null }; bestD = wHits[0].distance; }
  const bHits = _ray.intersectObjects(fighterHitMeshes, false);
  for (const h of bHits) {
    const b = h.object.userData.bot;
    if (b === self || !b.alive || b.team === self.team) continue;
    if (h.distance < bestD) { best = { point: h.point.clone(), foe: b, part: h.object.userData.part }; bestD = h.distance; break; }
  }
  // the player is not a mesh: test a capsule approximation manually
  const p = S.player;
  if (p && p.alive && p.team !== self.team) {
    const hit = rayVsPlayer(origin, dir, p);
    if (hit && hit.dist < bestD) best = { point: hit.point, foe: p, part: hit.part };
  }
  return best;
}

// Ray vs the player's upright capsule (head sphere + body/leg cylinders).
function rayVsPlayer(origin, dir, p) {
  const px = p.pos.x, pz = p.pos.z, py = p.pos.y;
  const crouch = p.crouched;
  const headY = py + (crouch ? 1.02 : 1.62);
  const headR = 0.19;
  const tHead = raySphere(origin, dir, px, headY, pz, headR);
  if (tHead !== null) return { dist: tHead, point: origin.clone().addScaledVector(dir, tHead), part: 'head' };
  // body: vertical segment test in XZ, then height band
  const dx = origin.x - px, dz = origin.z - pz;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a < 1e-8) return null;
  const b = 2 * (dx * dir.x + dz * dir.z);
  const c = dx * dx + dz * dz - 0.34 * 0.34;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return null;
  const y = origin.y + dir.y * t;
  const top = py + (crouch ? 1.25 : 1.78);
  if (y < py || y > top) return null;
  return { dist: t, point: origin.clone().addScaledVector(dir, t), part: y < py + 0.7 ? 'legs' : 'body' };
}

function raySphere(o, dir, cx, cy, cz, r) {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

export function updateBots(dt, world, frozen) {
  const d = diff();
  for (const bot of S.bots) {
    bot.flashT = Math.max(0, bot.flashT - dt);
    bot.spawnProtT = Math.max(0, bot.spawnProtT - dt);
    bot.hearT = Math.max(0, bot.hearT - dt);
    bot.grenadeT -= dt;
    if (bot.flashT <= 0 && bot.mats) bot.mats.body.emissive.setHex(0x000000);
    if (!bot.alive) {
      bot.respawnT -= dt;
      if (bot.respawnT <= 0 && S.phase === 'live') {
        const spawns = world.spawns[bot.team];
        const s = spawns[(bot.index + S.round) % spawns.length];
        spawnBot(bot, s, world);
        const def = weaponById(bot.weaponId);
        bot.ammo = { mag: def.mag, reserve: def.reserveMax };
        bot.target = null; bot.path = []; bot.goalKind = 'none';
      }
      continue;
    }
    if (frozen || S.phase === 'menu' || S.phase === 'matchEnd') { syncBotMesh(bot, dt, false); continue; }

    // --- perception (throttled): a full vision scan every ~0.15s, staggered
    // across bots, instead of 45 line-of-sight raycasts every 60Hz step. The
    // tracked target persists between scans; reaction time still gates fire.
    bot.scanT -= dt;
    if (bot.scanT <= 0) {
      bot.scanT = 0.15;
      let seen = null, seenD = Infinity;
      for (const foe of enemiesOf(bot)) {
        if (!foe.alive) continue;
        const dd = Math.hypot(foe.pos.x - bot.pos.x, foe.pos.z - bot.pos.z);
        if (dd < seenD && canSee(bot, foe, world)) { seen = foe; seenD = dd; }
      }
      if (seen) {
        if (bot.target !== seen) {
          bot.target = seen; bot.seeT = 0; bot.reactT = d.reactMin + Math.random() * (d.reactMax - d.reactMin);
          if (Math.random() < 0.45) maybeCallout(bot, 'Contact — ' + nearestZoneName(bot.pos.x, bot.pos.z) + '!');
        }
        bot.seeT += 0.15;
        bot.lostT = 0;
      } else {
        bot.lostT += 0.15;
        if (bot.lostT > 1.2) { bot.target = null; bot.seeT = 0; }
      }
    }

    // --- decisions ---
    bot.decideT -= dt;
    bot.repathT -= dt;
    if (bot.decideT <= 0) {
      bot.decideT = 0.4;
      const zone = liveZone();
      const inZone = Math.hypot(bot.pos.x - zone.x, bot.pos.z - zone.z) < zone.r;
      const shouldHold = bot.goalKind === 'hold' && Math.hypot(bot.pos.x - bot.goal.x, bot.pos.z - bot.goal.z) < 2;
      const shouldStay = bot.goalKind === 'zone' && inZone && bot.target === null;
      if (!shouldHold && !shouldStay) pickGoal(bot, world);
      else if (bot.repathT <= 0 && !shouldStay) pickGoal(bot, world);
      if (bot.goalKind === 'zone' && S.zoneOwner === bot.team && bot.role === 'cap' && Math.random() < 0.3) {
        // owned zone: cappers push out to the ring edge to intercept retakes
        bot.goalKind = 'hold';
      }
    }

    // --- combat: face, strafe, fire ---
    let moveX = 0, moveZ = 0, speed = bot.speed;
    if (bot.target && bot.target.alive) {
      const foe = bot.target;
      _to.set(foe.pos.x - bot.pos.x, 0, foe.pos.z - bot.pos.z);
      const wantYaw = Math.atan2(-_to.x, -_to.z);
      bot.yaw = turnToward(bot.yaw, wantYaw, dt * 7);
      // strafe perpendicular to the line of fire, flipping every couple seconds
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) { bot.strafeDir *= -1; bot.strafeT = 1.2 + Math.random() * 1.4; }
      const side = _side.copy(_to).normalize();
      moveX = -side.z * bot.strafeDir;
      moveZ = side.x * bot.strafeDir;
      speed = bot.speed * 0.55;
      // keep some distance with the scattergun in reverse: close in
      const dist = _to.length();
      if (bot.weaponId === 'sg12' && dist > 7) { moveX += side.x * 0.8; moveZ += side.z * 0.8; }
      if (bot.weaponId === 'm88' && dist < 10) { moveX -= side.x * 0.6; moveZ -= side.z * 0.6; }
      if (bot.seeT >= bot.reactT && S.phase === 'live') botFire(bot, foe, dt, world);
      // opportunistic frag: foe far, grouped near a wall, grenade ready
      if (S.phase === 'live' && bot.frags > 0 && bot.grenadeT <= 0 && dist > 10 && dist < 26 && Math.random() < dt * 0.25) {
        bot.frags--;
        bot.grenadeT = 20;
        _eye.set(bot.pos.x, 1.55, bot.pos.z);
        const vel = new THREE.Vector3(foe.pos.x - bot.pos.x, 3.4, foe.pos.z - bot.pos.z);
        const fly = Math.max(0.55, dist / 16);
        vel.x /= fly; vel.z /= fly;
        throwGrenade('frag', bot, _eye, vel, world);
      }
    } else {
      // --- navigation toward the goal ---
      const tgt = steerTarget(bot, world, _to);
      const dx = tgt.x - bot.pos.x, dz = tgt.z - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      const arrived = bot.goalKind === 'zone' ? dist < 1.6 : dist < 1.4;
      if (!arrived) {
        moveX = dx / dist; moveZ = dz / dist;
        const wantYaw = Math.atan2(-moveX, -moveZ);
        bot.yaw = turnToward(bot.yaw, wantYaw, dt * 6);
        // stuck detection: no progress while trying to move
        if (Math.hypot(bot.pos.x - bot.lastX, bot.pos.z - bot.lastZ) < 0.02) {
          bot.stuckT += dt;
          if (bot.stuckT > 1.1) { pickGoal(bot, world); bot.stuckT = 0; }
        } else bot.stuckT = 0;
      } else {
        // arrived: holders face the zone, cappers scan
        const zone = liveZone();
        const wantYaw = bot.goalKind === 'hold'
          ? Math.atan2(-(zone.x - bot.pos.x), -(zone.z - bot.pos.z))
          : bot.yaw + Math.sin(S.simTime * 0.5 + bot.index) * dt * 0.6;
        bot.yaw = turnToward(bot.yaw, wantYaw, dt * 3);
        bot.path = [];
      }
      bot.lastX = bot.pos.x; bot.lastZ = bot.pos.z;
    }

    // --- integrate movement with the same collision as the player ---
    const vel = _dir.set(moveX * speed, 0, moveZ * speed);
    const beforeX = bot.pos.x, beforeZ = bot.pos.z;
    collideMove(bot.pos, vel, dt, world.colliders, 0.34, 1.78, 0);
    bot.pos.y = 0;
    const moved = Math.hypot(bot.pos.x - beforeX, bot.pos.z - beforeZ);
    bot.walkPhase += moved * 3.4;
    syncBotMesh(bot, dt, moved > 0.001);
  }
}

function turnToward(cur, want, maxStep) {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return want;
  return cur + Math.sign(d) * maxStep;
}

function syncBotMesh(bot, dt, moving) {
  void dt;
  bot.group.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
  bot.group.rotation.y = bot.yaw;
  if (moving) {
    const s = Math.sin(bot.walkPhase);
    bot.legL.rotation.x = s * 0.55;
    bot.legR.rotation.x = -s * 0.55;
  } else {
    bot.legL.rotation.x *= 0.8;
    bot.legR.rotation.x *= 0.8;
  }
}
