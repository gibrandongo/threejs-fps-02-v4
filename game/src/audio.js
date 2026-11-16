// audio.js — all sound is synthesised with WebAudio: filtered noise bursts
// for gunfire, sine pings for UI and hits, a low thump for explosions. No
// audio files, no network. The context starts on the first user gesture.
import { S } from './state.js';

let ctx = null;
let master = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = S.settings.vol * 0.5;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 0.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  } catch (err) { ctx = null; }
}

export function setVolume(v) {
  S.settings.vol = v;
  if (master) master.gain.value = v * 0.5;
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function noise(dur, freq, gain, type, when) {
  if (!ctx) return;
  const t = ctx.currentTime + (when || 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filt = ctx.createBiquadFilter();
  filt.type = type || 'lowpass';
  filt.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filt); filt.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

function tone(freq, dur, gain, type, slideTo, when) {
  if (!ctx) return;
  const t = ctx.currentTime + (when || 0);
  const o = ctx.createOscillator();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

const SHOTS = {
  pistol: [900, 0.11, 0.5],
  smg: [1100, 0.08, 0.38],
  rifle: [750, 0.12, 0.55],
  shotgun: [420, 0.22, 0.8],
  marksman: [550, 0.28, 0.85],
};

export function playShot(sound, dist) {
  const [freq, dur, gain] = SHOTS[sound] || SHOTS.rifle;
  const att = dist === undefined ? 1 : Math.max(0.06, 1 - dist / 55);
  noise(dur, freq, gain * att, 'lowpass');
  if (att > 0.4) noise(0.05, 3200, 0.16 * att, 'highpass');
}

// Distant gunfire other bots hear: softer, no crack.
export function playDistantShot(sound, dist) { playShot(sound, Math.max(18, dist)); }

export function playReload() { tone(520, 0.05, 0.12, 'square'); tone(340, 0.05, 0.12, 'square', null, 0.28); tone(660, 0.07, 0.14, 'square', null, 0.55); }
export function playDry() { tone(1400, 0.04, 0.1, 'square'); }
export function playHit(head) { tone(head ? 1900 : 1350, 0.06, 0.22, 'sine'); }
export function playKill() { tone(880, 0.09, 0.25, 'sine'); tone(1320, 0.12, 0.22, 'sine', null, 0.07); }
export function playHurt() { tone(160, 0.14, 0.3, 'sawtooth', 70); }
export function playExplosion(dist) {
  const att = Math.max(0.1, 1 - dist / 60);
  noise(0.7, 160, 0.9 * att, 'lowpass');
  tone(55, 0.5, 0.5 * att, 'sine', 30);
}
export function playCaptureTick() { tone(1046, 0.07, 0.12, 'sine'); }
export function playZoneCapture(friendly) {
  if (friendly) { tone(660, 0.1, 0.22, 'sine'); tone(880, 0.1, 0.22, 'sine', null, 0.1); tone(1320, 0.16, 0.22, 'sine', null, 0.2); }
  else { tone(520, 0.12, 0.22, 'sine'); tone(390, 0.18, 0.22, 'sine', null, 0.12); }
}
export function playRoundWin() { tone(523, 0.12, 0.25, 'triangle'); tone(659, 0.12, 0.25, 'triangle', null, 0.12); tone(784, 0.2, 0.25, 'triangle', null, 0.24); }
export function playRoundLose() { tone(392, 0.14, 0.25, 'triangle'); tone(330, 0.14, 0.25, 'triangle', null, 0.14); tone(262, 0.24, 0.25, 'triangle', null, 0.28); }
export function playBuy() { tone(980, 0.07, 0.18, 'sine'); tone(1470, 0.09, 0.18, 'sine', null, 0.06); }
export function playDenied() { tone(220, 0.12, 0.2, 'square', 160); }
export function playClick() { tone(760, 0.05, 0.14, 'sine'); }
export function playStreak() { tone(1175, 0.08, 0.2, 'sine'); tone(1568, 0.14, 0.2, 'sine', null, 0.08); }
export function playRespawn() { tone(440, 0.1, 0.16, 'sine', 660); }
export function playThrow() { noise(0.09, 900, 0.14, 'bandpass'); }
export function playBounce() { tone(300, 0.05, 0.1, 'sine', 180); }
export function playStep(running, crouched) {
  const g = crouched ? 0.04 : (running ? 0.1 : 0.07);
  noise(0.06, running ? 500 : 380, g, 'lowpass');
}
