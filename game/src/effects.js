// effects.js — pooled visual effects: tracers, impact sparks, muzzle flash,
// explosion bursts, smoke clouds and rain. Pools are fixed at startup; the
// hot loop allocates nothing.
import * as THREE from 'three';

const MAX_TRACERS = 28;
const MAX_SPARKS = 90;
const MAX_SMOKE_PUFFS = 60;
const RAIN_DROPS = 500;

let sceneRef = null;
let tracers = [];
let sparks = [];
let smokePuffs = [];
let muzzle = null;
let muzzleLight = null;
let boomLight = null;
let rain = null;
let rainPos = null;
let shakeAmt = 0;
let glowTex = null;
let puffTex = null;

export function initEffects(scene, tex) {
  sceneRef = scene;
  glowTex = tex.glow;
  puffTex = tex.puff;

  // tracer pool: one Line each, shown for ~60ms
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  for (let i = 0; i < MAX_TRACERS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  // spark pool: small additive sprites with velocity + gravity
  for (let i = 0; i < MAX_SPARKS; i++) {
    const m = new THREE.SpriteMaterial({ map: glowTex, color: 0xffd98a, transparent: true, depthWrite: false });
    const s = new THREE.Sprite(m);
    s.visible = false;
    s.scale.set(0.14, 0.14, 1);
    scene.add(s);
    sparks.push({ s, life: 0, vx: 0, vy: 0, vz: 0 });
  }
  // smoke puff pool: large soft sprites, slow rise
  for (let i = 0; i < MAX_SMOKE_PUFFS; i++) {
    const m = new THREE.SpriteMaterial({ map: puffTex, color: 0xcfd8e6, transparent: true, opacity: 0, depthWrite: false });
    const s = new THREE.Sprite(m);
    s.visible = false;
    scene.add(s);
    smokePuffs.push({ s, life: 0, maxLife: 1, grow: 0 });
  }
  // muzzle flash sprite + shared light, repositioned per shot
  muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe9a8, transparent: true, depthWrite: false }));
  muzzle.visible = false;
  muzzle.scale.set(0.55, 0.55, 1);
  scene.add(muzzle);
  muzzleLight = new THREE.PointLight(0xffc46b, 0, 9, 2);
  scene.add(muzzleLight);
  boomLight = new THREE.PointLight(0xff8a3d, 0, 22, 1.6);
  scene.add(boomLight);

  // rain: one LineSegments cloud of short vertical streaks, wrapping in a box
  rainPos = new Float32Array(RAIN_DROPS * 6);
  for (let i = 0; i < RAIN_DROPS; i++) {
    const x = (Math.random() - 0.5) * 90, y = Math.random() * 30, z = (Math.random() - 0.5) * 70;
    rainPos.set([x, y, z, x, y - 0.55, z], i * 6);
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0x6a86b8, transparent: true, opacity: 0.35 }));
  rain.frustumCulled = false;
  scene.add(rain);
}

export function addShake(n) { shakeAmt = Math.min(0.6, shakeAmt + n); }
export function takeShake() {
  const s = shakeAmt;
  shakeAmt *= 0.86;
  if (shakeAmt < 0.002) shakeAmt = 0;
  return s;
}

export function fireTracer(from, to, color) {
  for (const t of tracers) {
    if (t.life > 0) continue;
    const p = t.line.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x; p[4] = to.y; p[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.line.material.opacity = 0.9;
    t.line.visible = true;
    t.life = 0.06;
    return;
  }
}

export function impactSparks(pos, color, count) {
  let made = 0;
  for (const sp of sparks) {
    if (made >= count) break;
    if (sp.life > 0) continue;
    sp.s.position.copy(pos);
    sp.s.material.color.setHex(color);
    sp.s.material.opacity = 1;
    sp.vx = (Math.random() - 0.5) * 6;
    sp.vy = Math.random() * 5 + 1;
    sp.vz = (Math.random() - 0.5) * 6;
    sp.life = 0.35 + Math.random() * 0.25;
    sp.s.visible = true;
    made++;
  }
}

export function muzzleFlash(pos, color) {
  muzzle.position.copy(pos);
  muzzle.material.color.setHex(color || 0xffe9a8);
  muzzle.material.opacity = 1;
  muzzle.visible = true;
  muzzle.material.rotation = Math.random() * Math.PI;
  muzzleLight.position.copy(pos);
  muzzleLight.intensity = 14;
}

export function explosionBurst(pos) {
  impactSparks(pos, 0xff8a3d, 26);
  impactSparks(pos, 0xffd98a, 14);
  boomLight.position.set(pos.x, pos.y + 1, pos.z);
  boomLight.intensity = 90;
  for (const p of smokePuffs) {
    if (p.life > 0) continue;
    p.s.position.set(pos.x + (Math.random() - 0.5) * 2, pos.y + Math.random(), pos.z + (Math.random() - 0.5) * 2);
    p.s.scale.set(1.4, 1.4, 1);
    p.s.material.opacity = 0.55;
    p.s.visible = true;
    p.life = 0.9; p.maxLife = 0.9; p.grow = 2.4;
    break;
  }
}

// Continuous smoke column for an active smoke grenade. Called each sim step
// with the grenade's position; spawns puffs at a throttled rate.
let puffClock = 0;
export function smokeColumn(pos, dt, strength) {
  puffClock -= dt;
  if (puffClock > 0) return;
  puffClock = 0.09;
  for (const p of smokePuffs) {
    if (p.life > 0) continue;
    const a = Math.random() * Math.PI * 2, r = Math.random() * 1.6;
    p.s.position.set(pos.x + Math.cos(a) * r, pos.y + 0.4 + Math.random() * 1.4, pos.z + Math.sin(a) * r);
    const sc = 1.6 + Math.random() * 1.6;
    p.s.scale.set(sc, sc, 1);
    p.s.material.opacity = 0.5 * strength;
    p.s.visible = true;
    p.life = 1.6; p.maxLife = 1.6; p.grow = 0.7;
    return;
  }
}

export function updateEffects(dt) {
  for (const t of tracers) {
    if (t.life <= 0) continue;
    t.life -= dt;
    if (t.life <= 0) t.line.visible = false;
    else t.line.material.opacity = t.life / 0.06 * 0.9;
  }
  for (const sp of sparks) {
    if (sp.life <= 0) continue;
    sp.life -= dt;
    if (sp.life <= 0) { sp.s.visible = false; continue; }
    sp.vy -= 14 * dt;
    sp.s.position.x += sp.vx * dt;
    sp.s.position.y += sp.vy * dt;
    sp.s.position.z += sp.vz * dt;
    if (sp.s.position.y < 0.05) { sp.s.position.y = 0.05; sp.vy = 0; }
    sp.s.material.opacity = Math.min(1, sp.life * 3);
  }
  for (const p of smokePuffs) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.s.visible = false; continue; }
    const k = 1 - p.life / p.maxLife;
    p.s.material.opacity = 0.5 * (1 - k * 0.7);
    const sc = p.s.scale.x + p.grow * dt;
    p.s.scale.set(sc, sc, 1);
    p.s.position.y += 0.35 * dt;
  }
  if (muzzle.visible) {
    // time-based decay: the flash reads the same at 30fps and 144fps
    muzzle.material.opacity *= Math.exp(-16 * dt);
    if (muzzle.material.opacity < 0.05) muzzle.visible = false;
  }
  muzzleLight.intensity *= Math.exp(-18 * dt);
  boomLight.intensity *= Math.exp(-5 * dt);
  if (muzzleLight.intensity < 0.2) muzzleLight.intensity = 0;
  if (boomLight.intensity < 0.2) boomLight.intensity = 0;
  // rain falls and wraps
  if (rain) {
    const arr = rain.geometry.attributes.position.array;
    for (let i = 0; i < RAIN_DROPS; i++) {
      let y = arr[i * 6 + 1] - 17 * dt;
      if (y < 0) y = 28 + Math.random() * 4;
      arr[i * 6 + 1] = y;
      arr[i * 6 + 4] = y - 0.55;
    }
    rain.geometry.attributes.position.needsUpdate = true;
  }
}
