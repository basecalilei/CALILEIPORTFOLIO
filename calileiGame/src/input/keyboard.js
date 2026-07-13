// keyboard.js — Raw keyboard input → normalized input snapshots.
//
// Installs window-level keydown/keyup listeners that maintain an internal
// Set of currently-held keys. getCurrentInput() builds a fresh snapshot
// from that set on every call. This is the one module that holds state
// outside the World — but it's I/O state (a mirror of OS keyboard state),
// not game state. Game logic never reaches into this file; it only sees
// the snapshots that main hands into tick.
//
// The snapshot shape is "gamepad-flavored" so a future gamepad module can
// produce the same shape without anything downstream changing. The shape
// is the contract; consumers (conditions, effects, future systems) read
// named fields and don't care about the source.

// Use event.code (physical key) rather than event.key (layout-mapped
// character) so input behavior is layout-independent. Players on AZERTY
// keyboards still press the same physical keys.
const heldKeys = new Set();

// Keys we intercept so the browser doesn't scroll the page on them.
const PREVENT_DEFAULT = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
]);

export function initKeyboard() {
  window.addEventListener('keydown', (e) => {
    heldKeys.add(e.code);
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    heldKeys.delete(e.code);
  });
  // If the window loses focus mid-press, the OS may never fire the
  // matching keyup. Clear the held set on blur so keys don't appear stuck
  // when the user alt-tabs back in.
  window.addEventListener('blur', () => {
    heldKeys.clear();
  });
}

// Snapshot shape (the engine's input contract):
//
//   stickX, stickY        Left stick. Integer -1 / 0 / +1 on keyboard;
//                         analog (-1.0 to +1.0) on a future gamepad.
//   cStickX, cStickY      Right stick / c-stick. Always 0 on keyboard;
//                         analog on gamepad. Reserved for smash-attack
//                         direction and aerial-attack direction.
//   jump                  Boolean. Press to leave the ground.
//   lightattack           Boolean. Standard quick attack.
//   heavyattack           Boolean. Standard heavy attack (smash family).
//   lightspecial          Boolean. Special move, neutral/light variant.
//   heavyspecial          Boolean. Special move, charged/heavy variant.
//   grab                  Boolean. Grab attack — bypasses shield.
//   shield                Boolean. Shield held at any depth.
//   shieldDepth           Number 0.0 to 1.0. Analog shield strength.
//                         On keyboard, mirrors `shield` as 0.0 or 1.0.
//                         On gamepad, comes from trigger axis. Light-
//                         shield (partial depth) and hard-shield (full
//                         depth) will eventually have different properties.
//
// Most fields are unused today. They exist so that adding the consuming
// logic later is purely additive — no contract migration, no buffer
// reshape, no condition-rewrite to handle "older snapshots without this
// field."

export function getCurrentInput() {
  let stickX = 0;
  if (heldKeys.has('ArrowLeft')  || heldKeys.has('KeyA')) stickX -= 1;
  if (heldKeys.has('ArrowRight') || heldKeys.has('KeyD')) stickX += 1;

  let stickY = 0;
  if (heldKeys.has('ArrowUp')    || heldKeys.has('KeyW')) stickY -= 1;
  if (heldKeys.has('ArrowDown')  || heldKeys.has('KeyS')) stickY += 1;

  const shield = heldKeys.has('KeyX');

  return {
    // Sticks
    stickX,
    stickY,
    cStickX: 0,
    cStickY: 0,

    // Buttons
    jump:         heldKeys.has('Space'),
    lightattack:  heldKeys.has('KeyZ'),
    heavyattack:  heldKeys.has('KeyC'),
    lightspecial: heldKeys.has('KeyV'),
    heavyspecial: heldKeys.has('KeyB'),
    grab:         heldKeys.has('KeyN'),
    shield,

    // Analog
    shieldDepth: shield ? 1.0 : 0.0,
  };
}
