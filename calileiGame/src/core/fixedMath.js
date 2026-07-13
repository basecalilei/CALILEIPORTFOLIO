// fixedMath.js — Numeric helpers, swap-ready for fixed-point arithmetic.
//
// Currently thin wrappers around JS floating-point operations. If we ever
// need bit-exact determinism for rollback netcode or replays, we swap the
// internals here for fixed-point integer math without touching game code.
//
// Use these helpers for "physical" math — positions, velocities, gravity,
// collision sweeps. Frame counters, array indices, and IDs stay as plain
// JS; those aren't physical quantities and don't need this discipline.

export function add(a, b) { return a + b; }
export function sub(a, b) { return a - b; }
export function mul(a, b) { return a * b; }
export function div(a, b) { return a / b; }
export function abs(a)    { return a < 0 ? -a : a; }
export function sign(a)   { return a > 0 ? 1 : (a < 0 ? -1 : 0); }
export function min(a, b) { return a < b ? a : b; }
export function max(a, b) { return a > b ? a : b; }

export function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// Phase 11: Euclidean length of a 2D vector. Exposed as a meaningful
// operation (not raw sqrt) so the future port to fixed-point integer
// math has one place to swap — probably an integer Newton's method or
// a precomputed LUT for common magnitudes. Today the implementation is
// the float-math straight line; the interface is what consumers depend on.
export function length2D(x, y) {
  return Math.sqrt(x * x + y * y);
}
