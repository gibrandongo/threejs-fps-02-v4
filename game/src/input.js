// input.js — keyboard, mouse and pointer-lock state. One shared Input object;
// the sim reads it, the UI writes through its callbacks. Edge-triggered
// actions are consumed once per fixed step by the sim.
export const Input = {
  keys: new Set(),
  mouseDX: 0,
  mouseDY: 0,
  firing: false,      // LMB held
  aiming: false,      // RMB held
  locked: false,
  // One-shot actions, set by event handlers, cleared by consumeActions().
  pressed: new Set(),

  // Look sensitivity multiplier (menu slider) and invert flag.
  sens: 1.0,
  invertY: false,

  onLockChange: null,   // (locked) => void
  onAction: null,       // (action) => void, for UI-level keys (buy, pause)
  onClick: null,        // () => void, canvas click while unlocked (menu flow)
};

const KEYMAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyC: 'crouch', ControlLeft: 'crouch',
  Space: 'jump',
  KeyR: 'reload',
  KeyG: 'frag',
  KeyV: 'smoke',
  Digit1: 'slot1',
  Digit2: 'slot2',
  KeyB: 'buy',
  KeyP: 'pause',
  Tab: 'score',
  Escape: 'escape',
};

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    const a = KEYMAP[e.code];
    if (!a) return;
    if (a === 'crouch' || a === 'jump' || a === 'forward' || a === 'score') e.preventDefault();
    if (e.repeat) return;
    Input.keys.add(a);
    Input.pressed.add(a);
    if ((a === 'buy' || a === 'pause' || a === 'escape') && Input.onAction) Input.onAction(a);
  });
  window.addEventListener('keyup', (e) => {
    const a = KEYMAP[e.code];
    if (!a) return;
    Input.keys.delete(a);
  });
  window.addEventListener('blur', () => {
    Input.keys.clear();
    Input.firing = false;
    Input.aiming = false;
  });

  document.addEventListener('mousemove', (e) => {
    if (!Input.locked) return;
    Input.mouseDX += e.movementX || 0;
    Input.mouseDY += e.movementY || 0;
  });
  document.addEventListener('mousedown', (e) => {
    if (!Input.locked) {
      if (e.target === canvas && Input.onClick) Input.onClick();
      return;
    }
    if (e.button === 0) Input.firing = true;
    if (e.button === 2) Input.aiming = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) Input.firing = false;
    if (e.button === 2) Input.aiming = false;
  });
  document.addEventListener('contextmenu', (e) => {
    if (e.target === canvas) e.preventDefault();
  });
  document.addEventListener('pointerlockchange', () => {
    Input.locked = document.pointerLockElement === canvas;
    if (!Input.locked) { Input.firing = false; Input.aiming = false; }
    if (Input.onLockChange) Input.onLockChange(Input.locked);
  });
  document.addEventListener('pointerlockerror', () => {
    Input.locked = false;
    if (Input.onLockChange) Input.onLockChange(false);
  });
  // Wheel swaps primary/sidearm.
  window.addEventListener('wheel', (e) => {
    if (!Input.locked) return;
    Input.pressed.add(e.deltaY > 0 ? 'slot2' : 'slot1');
  }, { passive: true });
}

export function requestLock(canvas) {
  if (Input.locked) return;
  try {
    const p = canvas.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => { /* headless or denied: game still runs */ });
  } catch (err) { /* pointer lock unavailable: mouse-look fallback stays off, keys still work */ }
}

export function releaseLock() {
  if (document.pointerLockElement) document.exitPointerLock();
}

// Consume the accumulated mouse delta (radians) for this sim step.
export function takeLookDelta() {
  const dx = Input.mouseDX * 0.0022 * Input.sens;
  let dy = Input.mouseDY * 0.0022 * Input.sens;
  if (Input.invertY) dy = -dy;
  Input.mouseDX = 0;
  Input.mouseDY = 0;
  return { dx, dy };
}

// True once for each key press; the sim calls this inside its fixed step.
export function consumeAction(name) {
  if (Input.pressed.has(name)) { Input.pressed.delete(name); return true; }
  return false;
}

export function clearPressed() { Input.pressed.clear(); }
