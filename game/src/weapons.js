// weapons.js — every gun, throwable and buy-menu item. Damage, recoil and
// spread live here so combat.js and bots.js share one balance table.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 SIDEARM', slot: 'side', price: 0,
    damage: 26, headMult: 2.2, legMult: 0.8, rpm: 360, mag: 12, reserveMax: 48,
    reload: 1.25, pellets: 1, auto: false, range: 34, falloff: 0.45,
    spread: { stand: 0.011, move: 0.03, crouch: 0.007, ads: 0.004, bloom: 0.006, maxBloom: 0.035 },
    recoil: { pitch: 0.011, yaw: 0.004, recover: 0.55 },
    tracer: 0xffe9a8, sound: 'pistol', kick: 0.012, adsFov: 58,
    desc: 'Reliable sidearm. Fast draw, honest damage, always in your holster.',
  },
  kr9: {
    id: 'kr9', name: 'KR-9 SMG', slot: 'primary', price: 900,
    damage: 22, headMult: 2.0, legMult: 0.8, rpm: 780, mag: 30, reserveMax: 90,
    reload: 1.7, pellets: 1, auto: true, range: 26, falloff: 0.4,
    spread: { stand: 0.02, move: 0.042, crouch: 0.013, ads: 0.009, bloom: 0.005, maxBloom: 0.05 },
    recoil: { pitch: 0.008, yaw: 0.005, recover: 0.5 },
    tracer: 0x7dfcff, sound: 'smg', kick: 0.009, adsFov: 55,
    desc: 'Bullet hose for close lanes. Huge magazine, climbs if you hold the trigger.',
  },
  vk7: {
    id: 'vk7', name: 'VK-7 RIFLE', slot: 'primary', price: 1600,
    damage: 32, headMult: 2.4, legMult: 0.8, rpm: 600, mag: 25, reserveMax: 75,
    reload: 2.0, pellets: 1, auto: true, range: 46, falloff: 0.6,
    spread: { stand: 0.013, move: 0.036, crouch: 0.008, ads: 0.004, bloom: 0.007, maxBloom: 0.045 },
    recoil: { pitch: 0.013, yaw: 0.005, recover: 0.6 },
    tracer: 0x9dff8a, sound: 'rifle', kick: 0.014, adsFov: 52,
    desc: 'The all-rounder. Bursts at range, full-auto up close. Stopping to aim pays.',
  },
  sg12: {
    id: 'sg12', name: 'SG-12 SCATTERGUN', slot: 'primary', price: 1100,
    damage: 13, headMult: 1.8, legMult: 0.8, rpm: 78, mag: 6, reserveMax: 24,
    reload: 2.5, pellets: 8, auto: false, range: 15, falloff: 0.25,
    spread: { stand: 0.05, move: 0.07, crouch: 0.04, ads: 0.03, bloom: 0.004, maxBloom: 0.06 },
    recoil: { pitch: 0.035, yaw: 0.012, recover: 0.4 },
    tracer: 0xffc46b, sound: 'shotgun', kick: 0.05, adsFov: 58,
    desc: 'Eight pellets per shell. Devastating around corners, useless across the roof.',
  },
  m88: {
    id: 'm88', name: 'M88 MARKSMAN', slot: 'primary', price: 2400,
    damage: 82, headMult: 2.0, legMult: 0.8, rpm: 52, mag: 5, reserveMax: 15,
    reload: 2.8, pellets: 1, auto: false, range: 70, falloff: 0.85,
    spread: { stand: 0.02, move: 0.075, crouch: 0.01, ads: 0.0008, bloom: 0.02, maxBloom: 0.03 },
    recoil: { pitch: 0.042, yaw: 0.008, recover: 0.35 },
    tracer: 0xff8ad8, sound: 'marksman', kick: 0.055, adsFov: 32,
    desc: 'One shot, one rooftop. Pinpoint only when aimed and still — never on the run.',
  },
};

export const THROWABLES = {
  frag: { id: 'frag', name: 'FRAG GRENADE', price: 300, max: 2, desc: 'Cooks 2.2s, then 115 damage in a 6.5m blast. Bounces off crates.' },
  smoke: { id: 'smoke', name: 'SMOKE CANISTER', price: 250, max: 2, desc: 'Ten seconds of thick cover. Bots cannot see through it.' },
};

export const ARMOR = { id: 'armor', name: 'COMBAT ARMOUR', price: 500, desc: 'Absorbs half of incoming damage until its 50 points run out.' };
export const AMMO_PACK = { id: 'ammo', name: 'AMMO RESUPPLY', price: 200, desc: 'Refills reserve ammunition for every weapon you carry.' };

// Buy-menu catalogue in display order. kind: weapon | throwable | gear.
export const BUY_ITEMS = [
  { kind: 'weapon', ref: 'kr9' },
  { kind: 'weapon', ref: 'vk7' },
  { kind: 'weapon', ref: 'sg12' },
  { kind: 'weapon', ref: 'm88' },
  { kind: 'throwable', ref: 'frag' },
  { kind: 'throwable', ref: 'smoke' },
  { kind: 'gear', ref: 'armor' },
  { kind: 'gear', ref: 'ammo' },
  { kind: 'weapon', ref: 'p9' },
];

export function weaponById(id) { return WEAPONS[id] || WEAPONS.p9; }

// Bot loadouts escalate with the round number so later rounds hit harder.
export function botLoadout(round, index) {
  if (round <= 1) return index % 3 === 0 ? 'kr9' : 'p9';
  if (round === 2) return ['kr9', 'vk7', 'sg12', 'kr9', 'vk7'][index % 5];
  if (round === 3) return ['vk7', 'sg12', 'vk7', 'm88', 'kr9'][index % 5];
  return ['vk7', 'm88', 'vk7', 'sg12', 'vk7'][index % 5];
}

// Damage at range: full damage inside half range, linear falloff to falloff
// fraction at max range, then the floor value beyond it.
export function damageAtRange(def, dist) {
  const half = def.range * 0.5;
  if (dist <= half) return def.damage;
  const t = Math.min(1, (dist - half) / half);
  return def.damage * (1 - (1 - def.falloff) * t);
}

// Spread for one shot: base stance spread plus accumulated bloom, in radians.
export function shotSpread(def, moving, crouched, aiming, bloom) {
  let base = def.spread.stand;
  if (aiming) base = def.spread.ads;
  else if (crouched) base = def.spread.crouch;
  else if (moving) base = def.spread.move;
  return base + Math.min(def.spread.maxBloom, bloom);
}
