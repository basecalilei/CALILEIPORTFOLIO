// collision.js — Pure geometric primitives for sweep collision.
//
// Two kinds of geometry are tested separately:
//
//   sweepPointOntoPlatform — point vs. one-way horizontal line. Used for
//     soft platforms. Only fires when crossing the line downward from
//     above; rising motion or sideways motion passes through.
//
//   sweepPointIntoSolid — point vs. axis-aligned rectangle. Tests each
//     of the four sides for entry. Returns the first hit, with a `side`
//     tag so the caller can pick the right response (vx zero for left/
//     right, vy zero plus grounded=true for top, vy zero for bottom).
//
// "From outside" position checks use NON-STRICT inequality (e.g., a
// fighter at exactly x=right is treated as on/outside the right edge,
// not inside). This is important for the snap-then-slide case: when
// collision snaps a fighter to a wall, their next-frame xPrev equals the
// wall. If we required strict inequality, attempts to move INTO the wall
// would not retrigger the sweep and the fighter would penetrate.
//
// Phase 8 does not implement time-of-impact ordering for diagonal corner
// hits. Side priority is: top, bottom, left, right. For Battlefield's
// geometry — a single rectangular floor with corners well off the main
// playable area — diagonal corner ambiguity does not arise in normal
// play. When a future stage exercises it, swap in TOI.

import * as fm from './fixedMath.js';

// Soft platform: one-way collision from above only.
export function sweepPointOntoPlatform(xPrev, yPrev, xNow, yNow, platform) {
  const segY = platform.y;

  // Must be crossing the line from at-or-above to strictly-below.
  // Non-strict on yPrev catches the "starting on the line" case (which
  // happens when a grounded fighter has somehow accumulated a nonzero
  // vy — shouldn't occur in current physics, but defensive).
  if (yPrev > segY) return null;
  if (yNow <= segY) return null;

  const dy = fm.sub(yNow, yPrev);
  if (dy === 0) return null;  // both equal segY; not a crossing

  // Linear interpolation to find x at the moment y crossed segY.
  const t = fm.div(fm.sub(segY, yPrev), dy);
  const dx = fm.sub(xNow, xPrev);
  const hitX = fm.add(xPrev, fm.mul(t, dx));

  if (hitX < platform.x1 || hitX > platform.x2) return null;

  return { x: hitX, y: segY };
}

// Solid rectangle: bidirectional collision on all four sides. Returns
// { x, y, side } where side is 'top' | 'bottom' | 'left' | 'right',
// or null if the motion segment didn't cross any side.
export function sweepPointIntoSolid(xPrev, yPrev, xNow, yNow, solid) {
  // TOP: entered from above (yPrev <= top), pushed past it downward.
  // Inclusive x-range so corner landings count.
  if (yPrev <= solid.top && yNow > solid.top) {
    const dy = fm.sub(yNow, yPrev);
    if (dy !== 0) {
      const t = fm.div(fm.sub(solid.top, yPrev), dy);
      const dx = fm.sub(xNow, xPrev);
      const hitX = fm.add(xPrev, fm.mul(t, dx));
      if (hitX >= solid.left && hitX <= solid.right) {
        return { x: hitX, y: solid.top, side: 'top' };
      }
    }
  }

  // BOTTOM: entered from below (yPrev >= bottom), pushed up into it.
  if (yPrev >= solid.bottom && yNow < solid.bottom) {
    const dy = fm.sub(yNow, yPrev);
    if (dy !== 0) {
      const t = fm.div(fm.sub(solid.bottom, yPrev), dy);
      const dx = fm.sub(xNow, xPrev);
      const hitX = fm.add(xPrev, fm.mul(t, dx));
      if (hitX >= solid.left && hitX <= solid.right) {
        return { x: hitX, y: solid.bottom, side: 'bottom' };
      }
    }
  }

  // LEFT: entered from the left side (xPrev <= left), pushed right.
  // STRICT y-range (top < hitY < bottom) so a fighter standing on top
  // at exactly y=top doesn't get caught by the left wall when walking
  // toward it along the top edge.
  if (xPrev <= solid.left && xNow > solid.left) {
    const dx = fm.sub(xNow, xPrev);
    if (dx !== 0) {
      const t = fm.div(fm.sub(solid.left, xPrev), dx);
      const dy = fm.sub(yNow, yPrev);
      const hitY = fm.add(yPrev, fm.mul(t, dy));
      if (hitY > solid.top && hitY < solid.bottom) {
        return { x: solid.left, y: hitY, side: 'left' };
      }
    }
  }

  // RIGHT: entered from the right side (xPrev >= right), pushed left.
  if (xPrev >= solid.right && xNow < solid.right) {
    const dx = fm.sub(xNow, xPrev);
    if (dx !== 0) {
      const t = fm.div(fm.sub(solid.right, xPrev), dx);
      const dy = fm.sub(yNow, yPrev);
      const hitY = fm.add(yPrev, fm.mul(t, dy));
      if (hitY > solid.top && hitY < solid.bottom) {
        return { x: solid.right, y: hitY, side: 'right' };
      }
    }
  }

  return null;
}
