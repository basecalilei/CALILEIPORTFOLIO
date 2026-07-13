// inputBuffer.js — Generic input buffer primitive.
//
// Operates on snapshots as opaque objects. Knows nothing about which keys
// or sticks exist — those are properties on snapshots that query helpers
// inspect. Adding a new field to the snapshot shape (e.g. an "L" button
// later) requires no changes here.
//
// Convention: buffer[0] is "now" (the freshest snapshot). buffer[N] is
// "N frames ago". This reads naturally in transition rules like
// wasPressedWithin(buffer, 'jump', 5) — "was jump pressed within the last
// five frames?".
//
// Older entries are never mutated. Edges (jumpPressed, stickSlammed) are
// derived by walking consecutive snapshots — never stored as fields, so
// the buffer is the single source of truth for input history.

// 12 frames covers Melee-class input windows (most techniques are 5–12)
// with headroom. Change here and reload to retune.
export const BUFFER_SIZE = 12;

// The neutral input snapshot — every field at its "no input" value. Used
// by fighters without a live input source (the Phase 13 dummy, a future
// AI-disabled CPU slot, a paused-controller P2). The shape mirrors the
// snapshot contract documented in input/keyboard.js exactly; every field
// is present so consumers querying `buffer[i].grab` etc. never see
// undefined. Frozen so accidental mutation surfaces loudly — a single
// reference to this object will sit in many fighter buffers at once, so
// silent mutation would corrupt the buffer's "newest-to-oldest" semantics
// across every fighter that's been receiving neutral input.
export const NEUTRAL_SNAPSHOT = Object.freeze({
  stickX:       0,
  stickY:       0,
  cStickX:      0,
  cStickY:      0,
  jump:         false,
  lightattack:  false,
  heavyattack:  false,
  lightspecial: false,
  heavyspecial: false,
  grab:         false,
  shield:       false,
  shieldDepth:  0.0,
});

export function createInputBuffer() {
  return [];
}

export function pushInput(buffer, snapshot) {
  buffer.unshift(snapshot);
  if (buffer.length > BUFFER_SIZE) {
    buffer.length = BUFFER_SIZE;
  }
}

// True if `key` went from false → true at any point within the last
// `frames` snapshots. Walks newest-to-oldest, comparing each frame to the
// next-older one to find a rising edge.
export function wasPressedWithin(buffer, key, frames) {
  const limit = Math.min(frames, buffer.length - 1);
  for (let i = 0; i < limit; i++) {
    if (buffer[i][key] && !buffer[i + 1][key]) return true;
  }
  return false;
}

// Index of the most recent rising edge of `key` within the last `frames`
// snapshots, or -1 if none found. Sibling primitive to wasPressedWithin:
// same walk, returns position instead of bool so callers can inspect the
// snapshot at the press frame.
//
// Use case: conditions that route on "what was the stick doing when the
// button was pressed" rather than "what is the stick doing now". A press
// buffered for several frames still carries its press-frame stick context
// in buffer[idx], which fully decouples the press from the player's later
// reflexive stick adjustments. The directional light-attack family uses
// this — lightAttackPressedUp asks "was lightattack pressed within window
// AND was stickY < 0 on the press frame?".
//
// Returns the newest edge first, matching wasPressedWithin's behavior:
// double-tapping a key picks up the more recent press.
export function pressIndex(buffer, key, frames) {
  const limit = Math.min(frames, buffer.length - 1);
  for (let i = 0; i < limit; i++) {
    if (buffer[i][key] && !buffer[i + 1][key]) return i;
  }
  return -1;
}

// Array of {stickX, stickY} for the last `frames` snapshots, newest first.
// Used by techniques that care about stick motion patterns — e.g. dash
// detection, which looks for rapid neutral → direction within N frames.
export function getStickHistory(buffer, frames) {
  const limit = Math.min(frames, buffer.length);
  const history = [];
  for (let i = 0; i < limit; i++) {
    history.push({ stickX: buffer[i].stickX, stickY: buffer[i].stickY });
  }
  return history;
}
