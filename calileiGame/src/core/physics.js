// physics.js — Pure functions on bodies.
//
// A "body" is the minimal shape physics cares about:
//   { x, y, vx, vy, grounded }
// physics knows nothing about fighters, states, or what kind of entity it
// is acting on. Any object in the World with those fields can be passed
// here. Bodies are mutated in place: returning fresh objects would force
// allocations every frame and doesn't match how the math will read in C++.

import * as fm from './fixedMath.js';

// Apply gravity and clamp downward velocity at maxFallSpeed. The cap
// applies only to positive vy (descending); rising velocity is never
// touched here. If maxFallSpeed is undefined/null, no cap is applied —
// callers that don't have a meaningful cap can pass either explicitly.
export function applyGravity(body, gravity, maxFallSpeed) {
  body.vy = fm.add(body.vy, gravity);
  if (maxFallSpeed !== undefined && maxFallSpeed !== null
      && body.vy > maxFallSpeed) {
    body.vy = maxFallSpeed;
  }
}

export function applyFriction(body, friction) {
  // Reduce horizontal speed toward zero without overshooting. If friction
  // would flip the sign of vx, snap to zero instead — friction alone never
  // reverses direction.
  const speed = fm.abs(body.vx);
  if (speed <= friction) {
    body.vx = 0;
  } else {
    body.vx = fm.sub(body.vx, fm.mul(fm.sign(body.vx), friction));
  }
}

// Snap horizontal velocity directly. Used by ground-locomotion modes
// (walk, dash) where the speed is determined by stick/facing + character
// stats rather than accumulated from accel.
export function setHorizontalSpeed(body, speed) {
  body.vx = speed;
}

// Accumulate horizontal velocity, with directional cap handling. Used by
// air drift.
//
// The rule, in plain terms:
//   - Accel within range: accept normally.
//   - Accel that crosses out of range: clamp to the cap.
//   - vx already past cap, accel pushes further: ignore (no further
//     outward acceleration past max).
//   - vx already past cap, accel pulls back toward range: apply (deceleration
//     works at any velocity).
//
// This is what makes "dash off the edge" preserve momentum in air — the
// drift max only LIMITS new acceleration outward, it doesn't yank back
// velocity that's already above it.
export function addHorizontalVelocity(body, accel, maxSpeed) {
  const oldVx = body.vx;
  const next = fm.add(oldVx, accel);

  if (next <= maxSpeed && next >= -maxSpeed) {
    body.vx = next;
    return;
  }

  if (oldVx >= -maxSpeed && oldVx <= maxSpeed) {
    body.vx = next > maxSpeed ? maxSpeed : -maxSpeed;
    return;
  }

  if (fm.sign(accel) !== fm.sign(oldVx)) {
    body.vx = next;
  }
}

export function integrate(body) {
  body.x = fm.add(body.x, body.vx);
  body.y = fm.add(body.y, body.vy);
}
