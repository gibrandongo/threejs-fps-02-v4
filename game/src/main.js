// main.js — bootstrap and the game loop. A fixed 60Hz simulation (rounds,
// player, bots, grenades) runs apart from rendering; the renderer only syncs
// meshes, effects and the HUD. Also owns the viewmodel gun, pause/menu flow
// and the small debug hooks the soak harness drives.
import * as THREE from 'three';
import { CFG, S, resetMatch } from './state.js';
import { Input, initInput, requestLock, releaseLock, takeLookDelta, consumeAction, clearPressed } from './input.js';
import { buildTextures } from './textures.js';
import { buildWorld } from './map.js';
import { createPlayer, updatePlayer, syncCamera, currentWeapon, resetForRound } from './player.js';
import { createBots, updateBots } from './bots.js';
import { playerFire, playerThrow, startReload, updateGrenades, damageFighter } from './combat.js';
import { initRounds, startMatch, updateRounds, buyItem } from './rounds.js';
import { initHud, initMinimap, updateHud, showMenu, hideMenu, showPause, hidePause, hideMatchEnd, toggleBuy, isBuyOpen, closeBuy, openBuy, buyKey, setScoreboardVisible } from './hud.js';
import { initAudio, resumeAudio, setVolume, playStep } from './audio.js';
import { initEffects, updateEffects, takeShake } from './effects.js';

let renderer, scene, camera, world;
let tex;
let accumulator = 0;
let lastT = 0;
let prevFiring = false;
let fovCur = 75;
let bobPhase = 0;
let viewmodel = null;
let vmParts = {};
let vmWeapon = '';
let attractA = 0;
let renderT = 0;
let stepAcc = 0;
let menuCam = true;

const params = new URLSearchParams(location.search);

function buildRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('app').appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070f);
  scene.fog = new THREE.Fog(0x05070f, 55, 190);
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 400);
  scene.add(camera);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// First-person gun: boxes parented to the camera, re-shaped per weapon.
function buildViewmodel() {
  viewmodel = new THREE.Group();
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.4, metalness: 0.7 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x37e6ff, emissive: 0x37e6ff, emissiveIntensity: 0.8 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.8 });
  vmParts.body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.34), gunMat);
  vmParts.barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.26, 10), gunMat);
  vmParts.barrel.rotation.x = Math.PI / 2;
  vmParts.barrel.position.set(0, 0.018, -0.28);
  vmParts.mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.13, 0.08), gripMat);
  vmParts.mag.position.set(0, -0.1, 0.02);
  vmParts.mag.rotation.x = 0.15;
  vmParts.sight = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.03, 0.05), trimMat);
  vmParts.sight.position.set(0, 0.062, -0.06);
  vmParts.grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.07), gripMat);
  vmParts.grip.position.set(0, -0.09, 0.13);
  vmParts.grip.rotation.x = 0.35;
  vmParts.hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.13), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9 }));
  vmParts.hand.position.set(0, -0.08, -0.1);
  for (const k of Object.keys(vmParts)) viewmodel.add(vmParts[k]);
  viewmodel.position.set(0.23, -0.21, -0.5);
  camera.add(viewmodel);
}

function updateViewmodel(dt, aiming) {
  const p = S.player;
  if (!p || !viewmodel) return;
  const def = currentWeapon(p);
  if (def.id !== vmWeapon) {
    vmWeapon = def.id;
    const long = def.id === 'm88' ? 1.7 : (def.id === 'sg12' ? 1.15 : 1);
    const thick = def.id === 'sg12' ? 1.5 : 1;
    vmParts.barrel.scale.set(thick, long, thick);
    vmParts.barrel.position.z = -0.28 - (long - 1) * 0.1;
    vmParts.body.scale.set(thick, 1, def.id === 'p9' ? 0.7 : 1);
    vmParts.mag.visible = def.id !== 'm88';
  }
  // hip position vs aimed (centred) position, eased
  const tx = aiming ? 0 : 0.23, ty = aiming ? -0.158 : -0.21;
  viewmodel.position.x += (tx - viewmodel.position.x) * Math.min(1, dt * 14);
  viewmodel.position.y += (ty - viewmodel.position.y) * Math.min(1, dt * 14);
  // walk bob + recoil kick
  if (p.speed2d > 0.5 && p.onGround) bobPhase += dt * p.speed2d * 1.6;
  const bobY = Math.sin(bobPhase * 2) * 0.008 * Math.min(1, p.speed2d / 5);
  const bobX = Math.cos(bobPhase) * 0.006 * Math.min(1, p.speed2d / 5);
  viewmodel.position.z = -0.5 + p.recoilP * 1.4 + bobX * 0.4;
  viewmodel.position.y += bobY;
  viewmodel.rotation.x = p.recoilP * 1.8;
  if (p.reloading) { // reload dip: the gun drops and tilts while the mag swaps
    viewmodel.rotation.x -= 0.45;
    viewmodel.position.y -= 0.055;
  }
  viewmodel.visible = p.alive && !menuCam;
}

// One fixed simulation step. Rendering never writes game state.
function step(dt) {
  S.simTime += dt;
  const p = S.player;
  const frozen = S.paused || S.phase === 'menu' || S.phase === 'matchEnd';
  const combatLive = S.phase === 'live' && !S.paused;

  updateRounds(dt);

  // player look + movement
  const look = takeLookDelta();
  updatePlayer(p, dt, Input, look, world, frozen || S.phase === 'roundEnd');

  // footsteps: one soft tap per stride, quieter while crouched
  if (p.alive && p.onGround && p.speed2d > 1) {
    stepAcc += p.speed2d * dt;
    if (stepAcc > 2.3) { stepAcc = 0; playStep(p.speed2d > 6, p.crouched); }
  } else stepAcc = 0;

  // weapon inputs (live rounds only for firing/throwing)
  const def = currentWeapon(p);
  if (p.alive && !frozen) {
    if (consumeAction('reload')) startReload(p);
    if (consumeAction('slot1') && p.primary) { p.slot = 'primary'; p.reloading = false; }
    if (consumeAction('slot2')) { p.slot = 'side'; p.reloading = false; }
    if (consumeAction('frag') && combatLive) playerThrow(p, 'frag', camera, world);
    if (consumeAction('smoke') && combatLive) playerThrow(p, 'smoke', camera, world);
    const wantFire = Input.firing && (def.auto || !prevFiring);
    if (wantFire && combatLive && !isBuyOpen()) playerFire(p, camera, world, Input.aiming);
  }
  prevFiring = Input.firing;
  clearPressed();

  updateBots(dt, world, frozen);
  updateGrenades(dt, world);
}

function frame(t) {
  requestAnimationFrame(frame);
  const now = t / 1000;
  let renderDt = Math.min(0.1, now - (lastT || now));
  lastT = now;
  renderT += renderDt;
  Input.sens = S.settings.sens;
  const scaled = renderDt * S.timeScale;

  if (!S.paused && S.phase !== 'menu' && S.phase !== 'matchEnd') {
    accumulator += scaled;
    let steps = 0;
    while (accumulator >= CFG.SIM_DT && steps < CFG.MAX_STEPS) {
      step(CFG.SIM_DT);
      accumulator -= CFG.SIM_DT;
      steps++;
    }
    if (steps === CFG.MAX_STEPS) accumulator = 0;
  } else {
    accumulator = 0;
    takeLookDelta();
    clearPressed();
  }

  // ---- rendering ----
  if (menuCam) {
    attractA += renderDt * 0.07;
    camera.position.set(Math.cos(attractA) * 23, 8.5, Math.sin(attractA) * 23);
    camera.lookAt(0, 1.2, 0);
    camera.fov = 60;
    camera.updateProjectionMatrix();
  } else {
    const p = S.player;
    const aiming = Input.aiming && p.alive && !isBuyOpen();
    const def = currentWeapon(p);
    const targetFov = aiming ? def.adsFov : 75;
    fovCur += (targetFov - fovCur) * Math.min(1, renderDt * 12);
    camera.fov = fovCur;
    camera.updateProjectionMatrix();
    syncCamera(p, camera, takeShake());
    // death spectate: keep watching the fighter who dropped you until respawn
    if (!p.alive && S.lastAttacker && S.lastAttacker.alive) {
      camera.lookAt(S.lastAttacker.pos.x, 1.3 + S.lastAttacker.pos.y, S.lastAttacker.pos.z);
    }
    updateViewmodel(renderDt, aiming);
  }
  // beacon blink + live-zone beam pulse run on the render clock so the menu
  // backdrop animates even while the simulation is stopped
  const blink = (Math.sin(renderT * 2.4) > 0.2) ? 1 : 0.15;
  for (const b of world.beacons) b.opacity = blink;
  const zone = world.zones[S.zoneIdx];
  if (zone) zone.beam.material.opacity = 0.06 + 0.03 * Math.sin(renderT * 1.8) + (S.zoneOwner ? 0.04 : 0);

  updateEffects(renderDt);
  if (!menuCam) {
    updateHud(renderDt);
    setScoreboardVisible(Input.keys.has('score') && !S.paused && S.phase !== 'matchEnd');
  }
  renderer.render(scene, camera);
}

// ---- flow: menu / deploy / pause / quit ----
function deploy() {
  initAudio();
  resumeAudio();
  hideMenu();
  hidePause();
  hideMatchEnd();
  closeBuy();
  menuCam = false;
  resetMatch();
  startMatch(world);
  accumulator = 0;
  lastT = 0;
  if (!S.autoMode) requestLock(renderer.domElement);
}

function pauseGame() {
  if (S.phase === 'menu' || S.phase === 'matchEnd' || S.paused) return;
  S.paused = true;
  showPause();
}

function resumeGame() {
  S.paused = false;
  hidePause();
  if (!S.autoMode) requestLock(renderer.domElement);
}

function quitToMenu() {
  S.paused = false;
  S.phase = 'menu';
  hidePause();
  hideMatchEnd();
  closeBuy();
  menuCam = true;
  releaseLock();
  showMenu();
}

function wireFlow() {
  initHud({
    onDeploy: () => deploy(),
    onResume: () => resumeGame(),
    onQuit: () => quitToMenu(),
    onAgain: () => deploy(),
    onMenu: () => quitToMenu(),
    onBuy: (item) => buyItem(item),
    onVolume: (v) => setVolume(v),
    onBuyClosed: () => {
      if (!S.autoMode && (S.phase === 'buy' || S.phase === 'live') && !S.paused) requestLock(renderer.domElement);
    },
  });
  Input.onAction = (a) => {
    if (a === 'buy') {
      if (S.phase === 'buy' || S.phase === 'live') {
        if (isBuyOpen()) closeBuy();
        else { openBuy(); releaseLock(); }
      }
    } else if (a === 'pause') {
      if (S.paused) resumeGame(); else pauseGame();
    } else if (a === 'escape') {
      if (isBuyOpen()) closeBuy();
    }
  };
  Input.onLockChange = (locked) => {
    if (!locked && !S.autoMode && !menuCam && !isBuyOpen() && S.phase !== 'matchEnd' && S.phase !== 'menu') {
      pauseGame();
    }
  };
  Input.onClick = () => {
    if (!menuCam && !S.paused && S.phase !== 'matchEnd' && !isBuyOpen()) requestLock(renderer.domElement);
  };
  // number keys double as buy-menu shortcuts while it is open
  window.addEventListener('keydown', (e) => {
    if (!isBuyOpen()) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9) buyKey(n);
  });
}

function init() {
  buildRenderer();
  tex = buildTextures();
  world = buildWorld(scene, tex);
  initEffects(scene, tex);
  createPlayer();
  createBots(scene, world);
  initMinimap(world);
  initRounds(world);
  initInput(renderer.domElement);
  wireFlow();
  buildViewmodel();
  // menu attract state: bots stand at spawns for the backdrop
  resetForRound(S.player, world.spawns.az[0]);
  for (const bot of S.bots) {
    const s = world.spawns[bot.team][bot.index % world.spawns[bot.team].length];
    bot.pos.set(s[0], 0, s[1]);
    bot.yaw = s[2];
    bot.group.position.copy(bot.pos);
    bot.group.rotation.y = bot.yaw;
  }
  showMenu();
  // debug / soak hooks (also used for scripted screenshots)
  window.__SKYLINE__ = {
    S, deploy, quitToMenu,
    teleport: (x, z) => { S.player.pos.set(x, 0, z); },
    setLook: (yaw, pitch) => { S.player.yaw = yaw; S.player.pitch = pitch; },
    giveMoney: (n) => { S.player.money += n; },
    forcePhase: (phase, t) => { S.phase = phase; if (t !== undefined) S.phaseT = t; },
    setHill: (az, cr) => { S.hill.az = az; S.hill.cr = cr; },
    openBuy, closeBuy, toggleBuy, buyItem,
    bots: () => S.bots,
    // scripted-input hooks for automated play-testing and screenshots
    keys: Input.keys,
    press: (a) => Input.pressed.add(a),
    look: (dx, dy) => { Input.mouseDX += dx; Input.mouseDY += dy; },
    setFiring: (v) => { Input.firing = v; },
    fire: () => { if (S.player && S.player.alive) playerFire(S.player, camera, world, false); },
    hurtPlayer: (n, idx) => damageFighter(S.player, n, S.bots[idx || 0] || null, 'body'),
    version: 'skyline-siege-v4',
  };
  // URL params for scripted runs: ?auto=1&diff=veteran&cam=yaw,pitch,x,z
  if (params.get('diff') && ['recruit', 'veteran', 'elite'].includes(params.get('diff'))) {
    S.settings.diff = params.get('diff');
    const sel = document.getElementById('optDiff');
    if (sel) sel.value = S.settings.diff;
  }
  if (params.get('auto') === '1') {
    S.autoMode = true;
    Input.sens = S.settings.sens;
    deploy();
    const cam = params.get('cam');
    if (cam) {
      const [yaw, pitch, x, z] = cam.split(',').map(Number);
      if (Number.isFinite(yaw)) S.player.yaw = yaw;
      if (Number.isFinite(pitch)) S.player.pitch = pitch;
      if (Number.isFinite(x) && Number.isFinite(z)) S.player.pos.set(x, 0, z);
    }
    const hill = params.get('hill');
    if (hill) { const [a, c] = hill.split(',').map(Number); S.hill.az = a || 0; S.hill.cr = c || 0; }
    if (params.get('live') === '1') { S.phase = 'live'; S.phaseT = CFG.ROUND_TIME; }
  }
  Input.sens = S.settings.sens;
  requestAnimationFrame(frame);
}

init();
