// textures.js — every texture is drawn on a canvas at load. No image files,
// no network: concrete, metal, hazard stripes, helipad markings, neon signs
// and the lit-window facade used by the skyline.
import * as THREE from 'three';

function canvasTex(size, draw, repeatX, repeatY) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX || 1, repeatY || 1);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function speckle(g, size, base, flecks, n) {
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    g.fillStyle = flecks[(Math.random() * flecks.length) | 0];
    g.globalAlpha = 0.12 + Math.random() * 0.25;
    const s = 1 + Math.random() * 3;
    g.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  g.globalAlpha = 1;
}

export function roofTexture() {
  return canvasTex(256, (g, s) => {
    speckle(g, s, '#343a47', ['#3e4553', '#2c313d', '#495064'], 900);
    // expansion joints
    g.strokeStyle = 'rgba(10,12,18,0.8)';
    g.lineWidth = 3;
    g.strokeRect(1, 1, s - 2, s - 2);
    g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
    g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
    // faint stains
    for (let i = 0; i < 7; i++) {
      g.fillStyle = 'rgba(12,14,20,0.16)';
      g.beginPath();
      g.ellipse(Math.random() * s, Math.random() * s, 20 + Math.random() * 40, 12 + Math.random() * 26, Math.random() * 3, 0, 7);
      g.fill();
    }
  }, 8, 6);
}

export function metalTexture() {
  return canvasTex(256, (g, s) => {
    speckle(g, s, '#3a4150', ['#454d5d', '#313845', '#4d5668'], 500);
    g.strokeStyle = 'rgba(8,10,16,0.55)';
    g.lineWidth = 2;
    for (let y = 0; y <= s; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
    // rivets
    g.fillStyle = '#565e6e';
    for (let x = 16; x < s; x += 32) for (let y = 16; y < s; y += 32) {
      g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill();
    }
  }, 2, 2);
}

export function hazardTexture() {
  return canvasTex(128, (g, s) => {
    g.fillStyle = '#c9a227';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#15161a';
    for (let i = -s; i < s * 2; i += 32) {
      g.beginPath();
      g.moveTo(i, s); g.lineTo(i + 16, s); g.lineTo(i + 16 + s, 0); g.lineTo(i + s, 0);
      g.closePath(); g.fill();
    }
  }, 3, 1);
}

export function padTexture() {
  return canvasTex(256, (g, s) => {
    speckle(g, s, '#232833', ['#2b313e', '#1c2029'], 500);
    g.strokeStyle = '#d8dcea';
    g.lineWidth = 6;
    g.beginPath(); g.arc(s / 2, s / 2, s * 0.42, 0, 7); g.stroke();
    g.fillStyle = '#d8dcea';
    g.font = '900 120px Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('H', s / 2, s / 2 + 4);
  }, 1, 1);
}

export function windowTexture() {
  return canvasTex(128, (g, s) => {
    g.fillStyle = '#0b0e16';
    g.fillRect(0, 0, s, s);
    const cols = 6, rows = 10;
    const cw = s / cols, ch = s / rows;
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
      const lit = Math.random();
      if (lit < 0.42) {
        g.fillStyle = lit < 0.3 ? '#ffd98a' : (lit < 0.37 ? '#9fe8ff' : '#ff9ec6');
        g.globalAlpha = 0.55 + Math.random() * 0.45;
      } else {
        g.fillStyle = '#141826';
        g.globalAlpha = 1;
      }
      g.fillRect(x * cw + 2, y * ch + 2, cw - 4, ch - 4);
    }
    g.globalAlpha = 1;
  }, 1, 1);
}

// A glowing sign plane texture: big letters on a dark plate with a neon rim.
export function signTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0d15';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(8, 8, 496, 112);
  g.font = '900 62px Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 26;
  g.fillStyle = color;
  g.fillText(text, 256, 66);
  g.shadowBlur = 8;
  g.fillStyle = '#ffffff';
  g.globalAlpha = 0.85;
  g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Soft radial glow sprite for muzzle flashes, beacons and explosions.
export function glowTexture() {
  return canvasTex(64, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }, 1, 1);
}

// Round soft particle for smoke puffs and impact dust.
export function puffTexture() {
  return canvasTex(64, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(220,228,240,0.85)');
    grad.addColorStop(0.6, 'rgba(200,210,226,0.4)');
    grad.addColorStop(1, 'rgba(200,210,226,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }, 1, 1);
}

export function buildTextures() {
  return {
    roof: roofTexture(),
    metal: metalTexture(),
    hazard: hazardTexture(),
    pad: padTexture(),
    windows: windowTexture(),
    glow: glowTexture(),
    puff: puffTexture(),
  };
}
