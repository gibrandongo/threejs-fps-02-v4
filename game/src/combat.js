// combat.js — hitscan shooting, damage and death, grenade physics, line of
// sight (with smoke blocking), gunshot hearing and killstreak rewards. Works
// on fighters generically: the player and the bots share the same fields.
import * as THREE from 'three';
import { CFG, S } from './state.js';
import { weaponById, damageAtRange, shotSpread } from './weapons.js';
import { applyDamage, currentWeapon, currentAmmo, stashLoadout } from './player.js';
import { fireTracer, muzzleFlash, impactSparks, explosionBurst, addShake, smokeColumn } from './effects.js';
import { playShot, playHit, playKill, playHurt, playExplosion, playDry, playStreak, playThrow, playBounce, playReload } from './audio.js';
import { addKillfeed, showHitmarker, showBanner, showDeath, setStreak, showDamageDir } from './hud.js';

// Raycast targets: the part meshes of living bots. bots.js registers and
// unregisters meshes here as bots spawn and die.
export const fighterHitMeshes = [];
export function registerHitMeshes(bot) {
  for (const m of bot.parts) fighterHitMeshes.push(m);
}
export function unregisterHitMeshes(bot) {
  for (let i = fighterHitMeshes.length - 1; i >= 0; i--) {
    if (fighterHitMeshes[i].userData.bot === bot) fighterHitMeshes.splice(i, 1);
  }
}

const _ray = new THREE.Raycaster();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pdir = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

// Line of sight between two points: blocked by occluder meshes or by an
// active smoke cloud the segment passes through.
export function hasLOS(world, a, b) {
  _dir.subVectors(b, a);
  const dist = _dir.length();
  _dir.normalize();
  _ray.set(a, _dir);
  _ray.far = dist;
  const hits = _ray.intersectObjects(world.occluders, false);
  if (hits.length) return false;
  for (const sm of S.smokes) {
    if (segmentHitsSphere(a, b, sm.pos, sm.radius)) return false;
  }
  return true;
}

function segmentHitsSphere(a, b, c, r) {
  _dir.subVectors(b, a);
  const len2 = _dir.lengthSq();
  let t = 0;
  if (len2 > 0) {
    t = ((c.x - a.x) * _dir.x + (c.y - a.y) * _dir.y + (c.z - a.z) * _dir.z) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const dx = a.x + _dir.x * t - c.x;
  const dy = a.y + _dir.y * t - c.y;
  const dz = a.z + _dir.z * t - c.z;
  return dx * dx + dy * dy + dz * dz < r * r;
}

// Gunfire and explosions alert nearby enemies: bots remember the position.
export function emitNoise(pos, team, radius) {
  for (const bot of S.bots) {
    if (!bot.alive || bot.team === team) continue;
    const d = Math.hypot(bot.pos.x - pos.x, bot.pos.z - pos.z);
    if (d > radius) continue;
    if (!bot.hearPos) bot.hearPos = new THREE.Vector3();
    bot.hearPos.copy(pos);
    bot.hearT = 4;
    if (bot.role === 'flex' || d < radius * 0.45) bot.decideT = 0;
  }
}

// ---- damage and death ----
export function damageFighter(target, raw, attacker, part) {
  if (!target.alive) return 0;
  if (target.spawnProtT > 0) return 0;
  let dmg = raw;
  if (target.isBot) {
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, raw * 0.5);
      target.armor -= absorbed;
      dmg = raw - absorbed;
    }
    target.hp -= dmg;
    target.flashT = 0.09;
    if (target.mats) target.mats.body.emissive.setHex(0x661111);
    if (attacker && target.target !== attacker && Math.random() < 0.7) {
      target.target = attacker;
      target.seeT = 0.2; target.reactT = 0.15; target.lostT = 0;
    }
    if (attacker === S.player) {
      showHitmarker(part === 'head');
      playHit(part === 'head');
      S.stats.hits++;
      if (part === 'head') S.stats.headshots++;
    }
    if (target.hp <= 0) killFighter(target, attacker, part);
    return dmg;
  }
  // the player
  const hpDmg = applyDamage(target, dmg);
  if (hpDmg > 0) {
    playHurt();
    if (attacker && attacker.isBot) S.lastKiller = attacker.name;
    if (attacker) {
      S.lastAttacker = attacker;
      // direction of the shooter relative to where the player is facing
      const faceYaw = Math.atan2(-(attacker.pos.x - target.pos.x), -(attacker.pos.z - target.pos.z));
      showDamageDir(faceYaw - target.yaw);
    }
  }
  if (!target.alive) killFighter(target, attacker, part);
  return hpDmg;
}

function killFighter(target, attacker, part) {
  target.hp = 0;
  target.alive = false;
  target.respawnT = CFG.RESPAWN_TIME;
  target.deaths++;
  if (attacker) attacker.kills++;
  if (attacker) S.lastAttacker = attacker;
  if (target.isBot) {
    unregisterHitMeshes(target);
    target.group.visible = false;
    target.target = null;
    _hitPoint.set(target.pos.x, 1.2, target.pos.z);
    impactSparks(_hitPoint, 0xff5b5b, 8);
  } else {
    stashLoadout(target);
    S.stats.deaths++;
    S.stats.streak = 0;
    setStreak(0);
    showDeath(S.lastKiller || 'the roof');
    emitNoise(target.pos, target.team, 30);
  }
  if (attacker) {
    S.roundKills[attacker.team]++;
    const killer = attacker === S.player ? 'YOU' : attacker.name;
    const victim = target === S.player ? 'YOU' : target.name;
    addKillfeed(killer, victim, part === 'head', attacker.team);
    if (attacker === S.player) {
      S.stats.kills++;
      S.stats.streak++;
      S.stats.bestStreak = Math.max(S.stats.bestStreak, S.stats.streak);
      S.player.money += CFG.KILL_REWARD;
      setStreak(S.stats.streak);
      playKill();
      checkStreakReward();
    } else if (attacker.isBot && attacker.team === 'az') {
      // allied bot kill: small team payout, keeps the economy moving
      S.player.money += 100;
    }
  }
}

function checkStreakReward() {
  const n = S.stats.streak;
  if (n === 3) {
    S.pulseUntil = S.simTime + CFG.PULSE_TIME;
    showBanner('RECON PULSE', 'Enemies revealed on the minimap', false);
    playStreak();
  } else if (n === 5) {
    const p = S.player;
    for (const id of Object.keys(p.ammo)) {
      const def = weaponById(id);
      p.ammo[id].reserve = def.reserveMax;
    }
    p.armor = Math.max(p.armor, 50);
    showBanner('SUPPLY DROP', 'Ammo refilled, armour restored', false);
    playStreak();
  }
}

// ---- player shooting ----
export function playerFire(p, camera, world, aiming) {
  const def = currentWeapon(p);
  if (p.reloading || p.fireT > 0) return;
  const ammo = currentAmmo(p);
  if (ammo.mag <= 0) {
    playDry();
    p.fireT = 0.25;
    if (ammo.reserve > 0) startReload(p);
    return;
  }
  p.fireT = 60 / def.rpm;
  ammo.mag--;
  S.stats.shots++;
  p.bloom = Math.min(def.spread.maxBloom, p.bloom + def.spread.bloom);
  p.recoilP += def.recoil.pitch * (aiming ? 0.7 : 1);
  p.recoilY += (Math.random() - 0.5) * def.recoil.yaw * 2;

  camera.getWorldDirection(_dir);
  _origin.copy(camera.position);
  const moving = p.speed2d > 1.2;
  const spread = shotSpread(def, moving, p.crouched, aiming, p.bloom);
  _muzzle.copy(_origin).addScaledVector(_dir, 0.6);
  _muzzle.y -= 0.1;
  muzzleFlash(_muzzle, 0xffe9a8);
  playShot(def.sound);
  emitNoise(p.pos, p.team, 24);

  for (let pellet = 0; pellet < def.pellets; pellet++) {
    _pdir.copy(_dir);
    _pdir.x += (Math.random() - 0.5) * spread * 2;
    _pdir.y += (Math.random() - 0.5) * spread * 2;
    _pdir.z += (Math.random() - 0.5) * spread * 2;
    _pdir.normalize();
    const hit = hitscan(world, _origin, _pdir, 80, p);
    if (!hit) {
      _hitPoint.copy(_origin).addScaledVector(_pdir, 60);
      fireTracer(_muzzle, _hitPoint, def.tracer);
      continue;
    }
    fireTracer(_muzzle, hit.point, def.tracer);
    if (hit.foe) {
      const mult = hit.part === 'head' ? def.headMult : (hit.part === 'legs' ? def.legMult : 1);
      damageFighter(hit.foe, damageAtRange(def, hit.dist) * mult, p, hit.part);
    } else {
      impactSparks(hit.point, 0xffd98a, 2);
    }
  }
  if (p.hp > 0 && def.kick > 0.03) addShake(def.kick * 2);
}

// One hitscan ray: nearest of world meshes and enemy fighter meshes.
export function hitscan(world, origin, dir, maxDist, self) {
  _ray.set(origin, dir);
  _ray.far = maxDist;
  let best = null, bestD = maxDist;
  const wHits = _ray.intersectObjects(world.shotMeshes, false);
  if (wHits.length) { best = { point: wHits[0].point.clone(), foe: null, part: null, dist: wHits[0].distance }; bestD = wHits[0].distance; }
  const bHits = _ray.intersectObjects(fighterHitMeshes, false);
  for (const h of bHits) {
    const b = h.object.userData.bot;
    if (!b.alive || b.team === self.team) continue;
    if (h.distance < bestD) { best = { point: h.point.clone(), foe: b, part: h.object.userData.part, dist: h.distance }; bestD = h.distance; break; }
  }
  return best;
}

export function startReload(p) {
  const def = currentWeapon(p);
  const ammo = currentAmmo(p);
  if (p.reloading || ammo.mag >= def.mag || ammo.reserve <= 0) return;
  p.reloading = true;
  p.reloadT = def.reload;
  playReload();
}

// ---- grenades ----
export function throwGrenade(kind, owner, origin, vel, world) {
  const g = {
    kind, owner,
    pos: origin.clone(), vel: vel.clone(),
    fuse: kind === 'frag' ? CFG.FRAG_FUSE : 1.4,
    bounces: 0, alive: true,
    mesh: null,
  };
  const geo = new THREE.SphereGeometry(0.11, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: kind === 'frag' ? 0x2e4a3a : 0x8a8f9a, roughness: 0.5, metalness: 0.6 });
  g.mesh = new THREE.Mesh(geo, mat);
  g.mesh.position.copy(g.pos);
  world.scene.add(g.mesh);
  S.grenades.push(g);
  playThrow();
  return g;
}

export function playerThrow(p, kind, camera, world) {
  if (p.throwT > 0 || p.reloading) return false;
  if (kind === 'frag' && p.frags <= 0) return false;
  if (kind === 'smoke' && p.smokes <= 0) return false;
  if (kind === 'frag') p.frags--; else p.smokes--;
  p.throwT = 0.6;
  camera.getWorldDirection(_dir);
  _origin.copy(camera.position).addScaledVector(_dir, 0.5);
  const vel = _dir.clone().multiplyScalar(15);
  vel.y += 3.2;
  vel.x += p.vel.x * 0.4; vel.z += p.vel.z * 0.4;
  throwGrenade(kind, p, _origin, vel, world);
  return true;
}

export function updateGrenades(dt, world) {
  for (let i = S.grenades.length - 1; i >= 0; i--) {
    const g = S.grenades[i];
    g.fuse -= dt;
    g.vel.y -= CFG.GRAVITY * dt;
    g.pos.addScaledVector(g.vel, dt);
    // floor bounce
    if (g.pos.y < 0.11) {
      g.pos.y = 0.11;
      if (Math.abs(g.vel.y) > 2) playBounce();
      g.vel.y = Math.abs(g.vel.y) * 0.42;
      g.vel.x *= 0.7; g.vel.z *= 0.7;
      g.bounces++;
    }
    // wall / prop bounce (AABB side test, cheap: only on overlap)
    for (const b of world.colliders) {
      if (g.pos.y > b.y1 || g.pos.y < b.y0) continue;
      if (g.pos.x > b.x0 - 0.11 && g.pos.x < b.x1 + 0.11 && g.pos.z > b.z0 - 0.11 && g.pos.z < b.z1 + 0.11) {
        const dxl = g.pos.x - (b.x0 - 0.11), dxr = (b.x1 + 0.11) - g.pos.x;
        const dzl = g.pos.z - (b.z0 - 0.11), dzr = (b.z1 + 0.11) - g.pos.z;
        const m = Math.min(dxl, dxr, dzl, dzr);
        if (m === dxl) { g.pos.x = b.x0 - 0.11; g.vel.x = -Math.abs(g.vel.x) * 0.45; }
        else if (m === dxr) { g.pos.x = b.x1 + 0.11; g.vel.x = Math.abs(g.vel.x) * 0.45; }
        else if (m === dzl) { g.pos.z = b.z0 - 0.11; g.vel.z = -Math.abs(g.vel.z) * 0.45; }
        else { g.pos.z = b.z1 + 0.11; g.vel.z = Math.abs(g.vel.z) * 0.45; }
        g.bounces++;
      }
    }
    if (g.mesh) g.mesh.position.copy(g.pos);
    if (g.fuse <= 0) {
      if (g.kind === 'frag') explode(g, world);
      else {
        S.smokes.push({ pos: g.pos.clone(), radius: 4.2, until: S.simTime + CFG.SMOKE_TIME });
        smokeColumn(g.pos, 1, 1);
      }
      if (g.mesh) { world.scene.remove(g.mesh); g.mesh.geometry.dispose(); g.mesh.material.dispose(); }
      S.grenades.splice(i, 1);
    }
  }
  // smoke upkeep: expire old clouds, keep columns fed
  for (let i = S.smokes.length - 1; i >= 0; i--) {
    const sm = S.smokes[i];
    if (S.simTime > sm.until) { S.smokes.splice(i, 1); continue; }
    smokeColumn(sm.pos, dt, 1);
  }
}

function explode(g, world) {
  explosionBurst(g.pos);
  playExplosion(S.player ? g.pos.distanceTo(S.player.pos) : 30);
  emitNoise(g.pos, g.owner.team, 34);
  const victims = [...S.bots];
  if (S.player) victims.push(S.player);
  for (const v of victims) {
    if (!v.alive || v === g.owner) continue;
    const d = Math.hypot(v.pos.x - g.pos.x, v.pos.z - g.pos.z);
    if (d > CFG.FRAG_RADIUS) continue;
    _origin.set(g.pos.x, g.pos.y + 0.3, g.pos.z);
    _hitPoint.set(v.pos.x, 1.2 + v.pos.y, v.pos.z);
    if (!hasLOS(world, _origin, _hitPoint)) continue;
    const dmg = CFG.FRAG_DAMAGE * (1 - (d / CFG.FRAG_RADIUS) * 0.7);
    damageFighter(v, dmg, g.owner, 'body');
  }
  if (S.player && S.player.alive) {
    const d = g.pos.distanceTo(S.player.pos);
    if (d < 12) addShake(0.35 * (1 - d / 12));
  }
}
