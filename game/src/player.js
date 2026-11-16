// player.js — the human player: acceleration movement, crouch, jump, AABB
// collision, eye height, armour, and the weapon inventory (primary + sidearm).
import * as THREE from 'three';
import { CFG, S } from './state.js';
import { weaponById } from './weapons.js';

const WALK = 5.2, SPRINT = 7.0, CROUCH_SPEED = 2.7, AIR_CTL = 0.35;
const ACCEL = 42, FRICTION = 11, JUMP_VEL = 7.4;

export function createPlayer() {
  const p = {
    team: 'az',
    name: 'YOU',
    pos: new THREE.Vector3(26, 0, 16),
    vel: new THREE.Vector3(),
    yaw: -2.4, pitch: 0,
    hp: 100, maxHp: 100, armor: 0,
    alive: true, respawnT: 0,
    crouched: false, onGround: true,
    money: CFG.START_MONEY,
    primary: 'p9', sidearm: 'p9', slot: 'side',
    ammo: {},          // weaponId -> { mag, reserve }
    frags: 1, smokes: 1,
    bloom: 0, recoilP: 0, recoilY: 0,
    fireT: 0, reloadT: 0, reloading: false,
    throwT: 0, hurtT: 0, speed2d: 0,
    spawnProtT: 0,
    kills: 0, deaths: 0,   // match totals, shown on the scoreboard
  };
  giveWeapon(p, 'p9');
  S.player = p;
  return p;
}

export function giveWeapon(p, id) {
  const def = weaponById(id);
  if (!p.ammo[id]) p.ammo[id] = { mag: def.mag, reserve: def.reserveMax };
  if (def.slot === 'primary') p.primary = id; else p.sidearm = id;
  p.slot = def.slot;
  p.reloading = false; p.reloadT = 0;
}

export function currentWeapon(p) {
  return weaponById(p.slot === 'primary' ? p.primary : p.sidearm);
}

export function currentAmmo(p) {
  const id = p.slot === 'primary' ? p.primary : p.sidearm;
  return p.ammo[id];
}

export function resetForRound(p, spawn) {
  p.pos.set(spawn[0], 0, spawn[1]);
  p.vel.set(0, 0, 0);
  p.yaw = spawn[2]; p.pitch = 0;
  p.hp = p.maxHp; p.armor = 0;
  p.alive = true; p.respawnT = 0;
  p.crouched = false; p.bloom = 0;
  p.recoilP = 0; p.recoilY = 0;
  p.reloading = false; p.reloadT = 0; p.fireT = 0;
  p.primary = 'p9'; p.sidearm = 'p9'; p.slot = 'side';
  p.ammo = {};
  giveWeapon(p, 'p9');
  p.frags = 1; p.smokes = 1;
  p.spawnProtT = 1.0;
}

export function respawnPlayer(p, spawn) {
  resetForRound(p, spawn);
  // keep purchased loadout across deaths inside a round: re-issue it
  if (p.keptPrimary && p.keptPrimary !== 'p9') giveWeapon(p, p.keptPrimary);
  p.slot = p.keptSlot || 'side';
  p.frags = p.keptFrags ?? 1;
  p.smokes = p.keptSmokes ?? 1;
  p.armor = p.keptArmor || 0;
}

export function stashLoadout(p) {
  p.keptPrimary = p.primary;
  p.keptSlot = p.slot;
  p.keptFrags = p.frags;
  p.keptSmokes = p.smokes;
  p.keptArmor = p.armor;
}

// Axis-separated AABB collision. Mutates pos in place; returns nothing.
export function collideMove(pos, vel, dt, colliders, radius, height, y) {
  // X axis
  pos.x += vel.x * dt;
  for (const b of colliders) {
    if (y + height < b.y0 || y > b.y1) continue;
    if (pos.x + radius > b.x0 && pos.x - radius < b.x1 && pos.z + radius > b.z0 && pos.z - radius < b.z1) {
      pos.x = vel.x > 0 ? b.x0 - radius : b.x1 + radius;
      vel.x = 0;
    }
  }
  // Z axis
  pos.z += vel.z * dt;
  for (const b of colliders) {
    if (y + height < b.y0 || y > b.y1) continue;
    if (pos.x + radius > b.x0 && pos.x - radius < b.x1 && pos.z + radius > b.z0 && pos.z - radius < b.z1) {
      pos.z = vel.z > 0 ? b.z0 - radius : b.z1 + radius;
      vel.z = 0;
    }
  }
  // roof bounds (the parapet colliders also stop the player; this is the net)
  const hx = CFG.MAP_W / 2 - radius - 0.3, hz = CFG.MAP_D / 2 - radius - 0.3;
  pos.x = Math.max(-hx, Math.min(hx, pos.x));
  pos.z = Math.max(-hz, Math.min(hz, pos.z));
}

const _wish = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

export function updatePlayer(p, dt, input, look, world, frozen) {
  if (!p.alive) {
    p.respawnT -= dt;
    return;
  }
  p.hurtT = Math.max(0, p.hurtT - dt);
  p.spawnProtT = Math.max(0, p.spawnProtT - dt);
  p.fireT = Math.max(0, p.fireT - dt);
  p.throwT = Math.max(0, p.throwT - dt);

  // look
  p.yaw -= look.dx;
  p.pitch -= look.dy;
  p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
  // recoil recovery pulls the view back toward the pre-shot pitch
  p.recoilP = approach(p.recoilP, 0, dt * 2.4);
  p.recoilY = approach(p.recoilY, 0, dt * 2.4);
  p.bloom = Math.max(0, p.bloom - dt * 0.09);

  // stance
  const wantCrouch = input.keys.has('crouch');
  if (wantCrouch !== p.crouched) p.crouched = wantCrouch;

  // wish direction in yaw space
  _fwd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  _right.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  _wish.set(0, 0, 0);
  if (!frozen) {
    if (input.keys.has('forward')) _wish.add(_fwd);
    if (input.keys.has('back')) _wish.sub(_fwd);
    if (input.keys.has('right')) _wish.add(_right);
    if (input.keys.has('left')) _wish.sub(_right);
  }
  const moving = _wish.lengthSq() > 0;
  if (moving) _wish.normalize();
  const sprinting = input.keys.has('sprint') && !p.crouched && input.keys.has('forward') && !input.aiming;
  const maxSpeed = p.crouched ? CROUCH_SPEED : (sprinting ? SPRINT : WALK);
  const accel = p.onGround ? ACCEL : ACCEL * AIR_CTL;

  if (moving) {
    p.vel.x += _wish.x * accel * dt;
    p.vel.z += _wish.z * accel * dt;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    if (sp > maxSpeed) { p.vel.x *= maxSpeed / sp; p.vel.z *= maxSpeed / sp; }
  } else if (p.onGround) {
    const sp = Math.hypot(p.vel.x, p.vel.z);
    const drop = FRICTION * dt;
    if (sp <= drop) { p.vel.x = 0; p.vel.z = 0; }
    else { p.vel.x *= (sp - drop) / sp; p.vel.z *= (sp - drop) / sp; }
  }
  p.speed2d = Math.hypot(p.vel.x, p.vel.z);

  // vertical: jump + gravity, flat roof floor at y=0
  if (input.keys.has('jump') && p.onGround && !frozen) {
    p.vel.y = JUMP_VEL;
    p.onGround = false;
  }
  p.vel.y -= CFG.GRAVITY * dt;
  p.pos.y += p.vel.y * dt;
  if (p.pos.y <= 0) { p.pos.y = 0; p.vel.y = 0; p.onGround = true; }

  const height = p.crouched ? 1.25 : CFG.PLAYER_H;
  collideMove(p.pos, p.vel, dt, world.colliders, CFG.PLAYER_R, height, p.pos.y);

  // reload timing
  if (p.reloading) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) {
      p.reloading = false;
      const def = currentWeapon(p);
      const a = currentAmmo(p);
      const need = def.mag - a.mag;
      const take = Math.min(need, a.reserve);
      a.mag += take; a.reserve -= take;
    }
  }
}

function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}

export function eyeHeight(p) {
  return p.crouched ? CFG.EYE_CROUCH : CFG.EYE_STAND;
}

// Position the render camera at the player's eye, with recoil and landing dip.
export function syncCamera(p, camera, shake) {
  camera.position.set(p.pos.x, p.pos.y + eyeHeight(p), p.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = p.yaw + p.recoilY;
  camera.rotation.x = p.pitch + p.recoilP;
  camera.rotation.z = 0;
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    camera.rotation.z = (Math.random() - 0.5) * shake * 0.06;
  }
}

// Armour absorbs half the damage while it lasts. Returns hp damage taken.
export function applyDamage(p, raw) {
  if (!p.alive || p.spawnProtT > 0) return 0;
  let hpDmg = raw;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, raw * 0.5);
    p.armor -= absorbed;
    hpDmg = raw - absorbed;
  }
  p.hp -= hpDmg;
  p.hurtT = 0.35;
  if (p.hp <= 0) { p.hp = 0; p.alive = false; p.respawnT = CFG.RESPAWN_TIME; }
  return hpDmg;
}
