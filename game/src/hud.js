// hud.js — every DOM element: scoreboard, zone bar, timer, vitals, ammo,
// minimap, killfeed, banners, buy menu and overlays. main.js injects the
// button handlers; the sim calls the show/update functions directly.
import { CFG, S, liveZone } from './state.js';
import { WEAPONS, THROWABLES, ARMOR, AMMO_PACK, BUY_ITEMS } from './weapons.js';
import { currentWeapon, currentAmmo } from './player.js';

const $ = (id) => document.getElementById(id);
let handlers = {};
let minimapBg = null;
let mapWorld = null;
let lastHud = {};
let bannerT = null, toastT = null, hitT = null;
let buyOpen = false;
let mmClock = 0;

export function initHud(h) {
  handlers = h;
  loadSettings();
  $('deployBtn').addEventListener('click', () => handlers.onDeploy && handlers.onDeploy());
  $('resumeBtn').addEventListener('click', () => handlers.onResume && handlers.onResume());
  $('quitBtn').addEventListener('click', () => handlers.onQuit && handlers.onQuit());
  $('againBtn').addEventListener('click', () => handlers.onAgain && handlers.onAgain());
  $('menuBtn').addEventListener('click', () => handlers.onMenu && handlers.onMenu());
  $('buyDone').addEventListener('click', () => closeBuy());
  $('optDiff').addEventListener('change', (e) => { S.settings.diff = e.target.value; saveSettings(); });
  $('optSens').addEventListener('input', (e) => {
    S.settings.sens = e.target.value / 100;
    $('sensVal').textContent = S.settings.sens.toFixed(2);
    saveSettings();
  });
  $('optVol').addEventListener('input', (e) => {
    $('volVal').textContent = e.target.value + '%';
    saveSettings();
    if (handlers.onVolume) handlers.onVolume(e.target.value / 100);
  });
  buildBuyMenu();
}

// Menu settings persist across visits (guarded: storage may be unavailable).
function saveSettings() {
  try {
    localStorage.setItem('skysiege-settings', JSON.stringify(S.settings));
  } catch (err) { /* private mode or file protocol: settings simply do not persist */ }
}
function loadSettings() {
  try {
    const raw = localStorage.getItem('skysiege-settings');
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.diff) S.settings.diff = saved.diff;
    if (typeof saved.sens === 'number') S.settings.sens = saved.sens;
    if (typeof saved.vol === 'number') S.settings.vol = saved.vol;
    $('optDiff').value = S.settings.diff;
    $('optSens').value = Math.round(S.settings.sens * 100);
    $('sensVal').textContent = S.settings.sens.toFixed(2);
    $('optVol').value = Math.round(S.settings.vol * 100);
    $('volVal').textContent = Math.round(S.settings.vol * 100) + '%';
  } catch (err) { /* corrupted or unavailable storage: defaults stand */ }
}

export function isBuyOpen() { return buyOpen; }

// ---------- overlays ----------
export function showMenu() { $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); }
export function hideMenu() { $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); }
export function showPause() { $('pauseMenu').classList.remove('hidden'); }
export function hidePause() { $('pauseMenu').classList.add('hidden'); }
export function showMatchEnd() {
  $('matchTitle').textContent = S.winner === 'az' ? 'VICTORY' : 'DEFEAT';
  $('matchSub').textContent = S.winner === 'az'
    ? 'Azure takes the roof. The skyline is yours tonight.'
    : 'Crimson takes the roof. Run it back.';
  const st = S.stats;
  $('stK').textContent = st.kills;
  $('stD').textContent = st.deaths;
  $('stC').textContent = st.captures;
  $('stA').textContent = (st.shots ? Math.round(100 * st.hits / st.shots) : 0) + '%';
  $('stS').textContent = st.bestStreak;
  $('matchEnd').classList.remove('hidden');
}
export function hideMatchEnd() { $('matchEnd').classList.add('hidden'); }

// ---------- banners / toast / hitmarker ----------
export function showBanner(text, sub, crimson) {
  const b = $('banner');
  b.textContent = text;
  b.classList.toggle('cr', !!crimson);
  b.classList.remove('hidden');
  const s = $('subbanner');
  if (sub) { s.textContent = sub; s.classList.remove('hidden'); }
  else s.classList.add('hidden');
  if (bannerT) clearTimeout(bannerT);
  bannerT = setTimeout(() => { b.classList.add('hidden'); s.classList.add('hidden'); }, 2800);
}

export function showToast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  if (toastT) clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), 2200);
}

export function showHitmarker(head) {
  const h = $('hitmarker');
  h.classList.toggle('head', !!head);
  h.classList.add('show');
  if (hitT) clearTimeout(hitT);
  hitT = setTimeout(() => h.classList.remove('show'), 90);
}

export function showDeath(killer) {
  $('deathText').textContent = 'ELIMINATED BY ' + killer.toUpperCase();
  $('deathBox').classList.remove('hidden');
}
export function hideDeath() { $('deathBox').classList.add('hidden'); }

export function setStreak(n) {
  const box = $('streakBox');
  if (n >= 2) { $('streakN').textContent = n; box.classList.remove('hidden'); }
  else box.classList.add('hidden');
}

// ---------- bot callouts ----------
export function addCallout(who, text, team) {
  const box = $('callouts');
  const row = document.createElement('div');
  row.className = 'co' + (team === 'cr' ? ' cr' : '');
  const b = document.createElement('b'); b.textContent = who;
  row.append(b, document.createTextNode(': ' + text));
  box.prepend(row);
  while (box.children.length > 3) box.removeChild(box.lastChild);
  setTimeout(() => { if (row.parentNode) row.parentNode.removeChild(row); }, 5000);
}

// ---------- damage direction ----------
let dmgDirT = null;
export function showDamageDir(relativeAngle) {
  const el = $('dmgDir');
  el.style.transform = 'rotate(' + relativeAngle + 'rad)';
  el.classList.add('show');
  if (dmgDirT) clearTimeout(dmgDirT);
  dmgDirT = setTimeout(() => el.classList.remove('show'), 650);
}

// ---------- scoreboard (hold TAB) ----------
let scoreVisible = false;
export function setScoreboardVisible(show) {
  if (show === scoreVisible) { if (show) renderScoreboard(); return; }
  scoreVisible = show;
  $('scoreboard').classList.toggle('hidden', !show);
  if (show) renderScoreboard();
}

function renderScoreboard() {
  const rows = $('scoreRows');
  rows.innerHTML = '';
  const fighters = [];
  if (S.player) fighters.push(S.player);
  for (const b of S.bots) fighters.push(b);
  fighters.sort((a, b) => (b.kills - a.kills) || (a.deaths - b.deaths));
  for (const f of fighters) {
    const tr = document.createElement('tr');
    tr.className = f.team + (f === S.player ? ' me' : '');
    const caps = f === S.player ? (S.stats ? S.stats.captures : 0) : (f.captures || 0);
    const cells = [f.name, String(f.kills || 0), String(f.deaths || 0), String(caps)];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    rows.appendChild(tr);
  }
}

// ---------- killfeed ----------
export function addKillfeed(killer, victim, head, team) {
  const feed = $('killfeed');
  const row = document.createElement('div');
  row.className = 'kf' + (team === 'cr' ? ' cr' : '');
  row.innerHTML = '';
  const k = document.createElement('b'); k.textContent = killer;
  const v = document.createElement('b'); v.textContent = victim;
  row.append(k, document.createTextNode(head ? '  ⌖  ' : '  ▸  '), v);
  if (head) {
    const hs = document.createElement('span');
    hs.className = 'hs'; hs.textContent = ' HEADSHOT';
    row.append(hs);
  }
  feed.prepend(row);
  while (feed.children.length > 5) feed.removeChild(feed.lastChild);
  setTimeout(() => { if (row.parentNode) row.parentNode.removeChild(row); }, 6000);
}

// ---------- buy menu ----------
function itemInfo(item) {
  if (item.kind === 'weapon') { const w = WEAPONS[item.ref]; return { name: w.name, price: w.price, desc: w.desc }; }
  if (item.kind === 'throwable') { const t = THROWABLES[item.ref]; return { name: t.name, price: t.price, desc: t.desc }; }
  if (item.ref === 'armor') return { name: ARMOR.name, price: ARMOR.price, desc: ARMOR.desc };
  return { name: AMMO_PACK.name, price: AMMO_PACK.price, desc: AMMO_PACK.desc };
}

function buildBuyMenu() {
  const grid = $('buyGrid');
  grid.innerHTML = '';
  BUY_ITEMS.forEach((item, i) => {
    const info = itemInfo(item);
    const card = document.createElement('div');
    card.className = 'buyCard';
    card.dataset.ref = item.ref;
    card.dataset.kind = item.kind;
    const h = document.createElement('h3'); h.textContent = (i + 1) + '. ' + info.name;
    const p = document.createElement('p'); p.textContent = info.desc;
    const pr = document.createElement('div'); pr.className = 'price'; pr.textContent = info.price ? '$' + info.price : 'OWNED';
    card.append(h, p, pr);
    card.addEventListener('click', () => { if (handlers.onBuy) handlers.onBuy(item); });
    grid.appendChild(card);
  });
}

export function refreshBuyMenu() {
  const p = S.player;
  if (!p) return;
  $('buyMoney').textContent = p.money;
  for (const card of $('buyGrid').children) {
    const ref = card.dataset.ref, kind = card.dataset.kind;
    const info = itemInfo({ kind, ref });
    let owned = false;
    if (kind === 'weapon') owned = (p.primary === ref || p.sidearm === ref);
    card.classList.toggle('owned', owned);
    card.classList.toggle('poor', !owned && p.money < info.price);
  }
}

export function openBuy() {
  if (S.phase !== 'buy' && S.phase !== 'live') return;
  if (S.phase === 'live') { showToast('Buy phase is closed — next round'); return; }
  buyOpen = true;
  refreshBuyMenu();
  $('buyMsg').textContent = '';
  $('buyMenu').classList.remove('hidden');
}
export function closeBuy() {
  buyOpen = false;
  $('buyMenu').classList.add('hidden');
  if (handlers.onBuyClosed) handlers.onBuyClosed();
}
export function toggleBuy() { if (buyOpen) closeBuy(); else openBuy(); }
export function buyKey(n) {
  if (!buyOpen) return;
  const item = BUY_ITEMS[n - 1];
  if (item && handlers.onBuy) handlers.onBuy(item);
}
export function setBuyMsg(t) { $('buyMsg').textContent = t; }

// ---------- minimap ----------
export function initMinimap(world) {
  mapWorld = world;
  const cv = $('minimap');
  minimapBg = document.createElement('canvas');
  minimapBg.width = cv.width; minimapBg.height = cv.height;
  const b = minimapBg.getContext('2d');
  b.fillStyle = '#0a1220';
  b.fillRect(0, 0, cv.width, cv.height);
  b.strokeStyle = 'rgba(55,230,255,0.5)';
  b.strokeRect(4, 4, cv.width - 8, cv.height - 8);
  const sx = (cv.width - 16) / CFG.MAP_W, sz = (cv.height - 16) / CFG.MAP_D;
  const X = (x) => 8 + (x + CFG.MAP_W / 2) * sx;
  const Z = (z) => 8 + (z + CFG.MAP_D / 2) * sz;
  b.fillStyle = 'rgba(140,170,210,0.55)';
  for (const c of world.colliders) {
    if (c.y1 < 0.8) continue;
    b.fillRect(X(c.x0), Z(c.z0), (c.x1 - c.x0) * sx, (c.z1 - c.z0) * sz);
  }
}

function drawMinimap() {
  const cv = $('minimap');
  const g = cv.getContext('2d');
  if (minimapBg) g.drawImage(minimapBg, 0, 0);
  const sx = (cv.width - 16) / CFG.MAP_W, sz = (cv.height - 16) / CFG.MAP_D;
  const X = (x) => 8 + (x + CFG.MAP_W / 2) * sx;
  const Z = (z) => 8 + (z + CFG.MAP_D / 2) * sz;
  // live zone ring
  const zone = liveZone();
  const col = S.zoneOwner === 'az' ? '#37e6ff' : (S.zoneOwner === 'cr' ? '#ff3d7e' : '#ffffff');
  g.strokeStyle = col;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(X(zone.x), Z(zone.z), zone.r * sx, 0, 7);
  g.stroke();
  // fighters
  const pulse = S.simTime < S.pulseUntil;
  const dot = (x, z, color, r) => {
    g.fillStyle = color;
    g.beginPath(); g.arc(X(x), Z(z), r, 0, 7); g.fill();
  };
  for (const bot of S.bots) {
    if (!bot.alive) continue;
    if (bot.team === 'az') dot(bot.pos.x, bot.pos.z, '#37e6ff', 3);
    else if (pulse) dot(bot.pos.x, bot.pos.z, '#ff3d7e', 3);
  }
  // player arrow
  const p = S.player;
  if (p && p.alive) {
    const px = X(p.pos.x), pz = Z(p.pos.z);
    g.save();
    g.translate(px, pz);
    g.rotate(-p.yaw); // arrow points along the facing (-sin yaw, -cos yaw)
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(-4, 5);
    g.closePath(); g.fill();
    g.restore();
  }
}

// ---------- per-frame HUD refresh (cheap: only changed text is written) ----------
function setText(id, val) {
  if (lastHud[id] !== val) { lastHud[id] = val; $(id).textContent = val; }
}

export function updateHud(dt) {
  const p = S.player;
  if (!p) return;
  // timer + round
  let t = Math.max(0, Math.ceil(S.phaseT));
  if (S.phase === 'buy') t = Math.max(0, Math.ceil(S.phaseT));
  const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
  setText('timer', mm + ':' + ss);
  $('timer').classList.toggle('low', S.phase === 'live' && S.phaseT <= 15);
  setText('roundLabel', S.phase === 'buy' ? 'BUY PHASE — ROUND ' + S.round : 'ROUND ' + S.round);
  setText('buyTimer', String(Math.max(0, Math.ceil(S.phaseT))));
  // scores
  setText('ptsAz', String(S.hill.az));
  setText('ptsCr', String(S.hill.cr));
  setText('winsAz', '●'.repeat(S.wins.az) + '○'.repeat(Math.max(0, CFG.ROUNDS_TO_WIN - S.wins.az)));
  setText('winsCr', '●'.repeat(S.wins.cr) + '○'.repeat(Math.max(0, CFG.ROUNDS_TO_WIN - S.wins.cr)));
  // zone bar
  const zone = liveZone();
  setText('zoneLabel', zone.name + (S.zoneOwner ? ' — ' + (S.zoneOwner === 'az' ? 'AZURE' : 'CRIMSON') : ' — NEUTRAL'));
  const fill = $('zoneFill');
  const pct = Math.round(S.zoneProgress * 100);
  if (lastHud.zonePct !== pct) { lastHud.zonePct = pct; fill.style.width = pct + '%'; }
  const zc = S.zoneCapTeam === 'cr' ? '#ff3d7e' : '#37e6ff';
  if (lastHud.zoneCol !== zc) { lastHud.zoneCol = zc; fill.style.background = zc; }
  // vitals
  setText('hpNum', String(Math.ceil(p.hp)));
  $('hpNum').classList.toggle('low', p.hp <= 30);
  const hpp = Math.round(100 * p.hp / p.maxHp);
  if (lastHud.hp !== hpp) {
    lastHud.hp = hpp;
    $('hpFill').style.width = hpp + '%';
    $('hpFill').classList.toggle('low', p.hp <= 30);
  }
  setText('armorNum', String(Math.floor(p.armor)));
  // ammo + weapon
  const def = currentWeapon(p);
  const ammo = currentAmmo(p);
  setText('weaponName', def.name + (p.reloading ? ' — RELOADING' : ''));
  setText('magAmmo', String(ammo.mag));
  setText('resAmmo', String(ammo.reserve));
  $('ammoRow').classList.toggle('empty', ammo.mag === 0);
  setText('fragCount', 'FRAG ×' + p.frags);
  setText('smokeCount', 'SMOKE ×' + p.smokes);
  setText('money', String(p.money));
  // damage vignette + respawn countdown
  $('dmgVin').classList.toggle('hit', p.hurtT > 0);
  if (!p.alive) setText('respawnText', 'Respawn in ' + Math.max(0, p.respawnT).toFixed(1));
  // crosshair gap follows spread: wide on the move, tight aimed/crouched
  const gap = p.reloading ? 16 : (8 + p.bloom * 220 + (p.speed2d > 1.2 ? 6 : 0) - (p.crouched ? 3 : 0));
  $('crosshair').style.setProperty('--gap', Math.max(4, Math.round(gap)) + 'px');
  // minimap at ~8Hz
  mmClock -= dt;
  if (mmClock <= 0) { mmClock = 0.12; drawMinimap(); }
  if (buyOpen) refreshBuyMenu();
}
