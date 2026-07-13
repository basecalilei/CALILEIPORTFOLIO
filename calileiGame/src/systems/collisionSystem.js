// collisionSystem.js — Per-frame collision resolution.
//
// Three responsibilities, in order:
//
//   1. SWEEP solids. Per-side response: top hit lands the fighter
//      (vy=0, grounded=true), bottom hit causes a head bump (vy=0,
//      grounded unchanged — fighter stays airborne and starts falling),
//      left/right hits stop horizontal motion (vx=0, grounded unchanged).
//
//   2. SWEEP platforms (only if not already landed on a solid, and only
//      if the fighter isn't currently requesting drop-through).
//
//   3. CLEAR grounded for walking off. If the fighter was grounded last
//      frame but didn't trigger a new sweep, check whether their feet
//      are still on any surface (solid top or platform). If not, clear
//      grounded so the state machine sees notGrounded next frame and
//      transitions to Fall.
//
// PHASE 9: drop-through. A fighter "wants through platforms" when their
// stick is held down AND their current state doesn't block it. The rule
// is applied at TWO sites: the platform sweep skips entirely (so falling
// through from above doesn't catch), and isStandingOnAnySurface ignores
// platforms (so a fighter standing on one becomes un-grounded). The
// state can block this behavior by setting `physics.respectPlatforms`
// to true — useful for attack states later, where being knocked off a
// platform mid-attack would be wrong.
//
// The previous position is derived as `current - velocity`, not stored
// on the fighter. Physics is the only system that moves bodies between
// frames and collision runs immediately after, so the derivation is
// correct.

import {
  sweepPointOntoPlatform,
  sweepPointIntoSolid,
} from '../core/collision.js';
import * as fm from '../core/fixedMath.js';

// Predicate: should this fighter currently pass through soft platforms?
// Two requirements:
//   - the player is holding down (stickY > 0)
//   - the current state doesn't opt out (respectPlatforms !== true)
// Reads the most recent input snapshot directly; no persistent state on
// the fighter is involved.
function wantsThroughPlatforms(fighter, state) {
  if (state.physics.respectPlatforms === true) return false;
  const now = fighter.inputBuffer[0];
  if (!now || now.stickY <= 0) return false;
  return true;
}

export function collisionSystem(world) {
  const stage = world.stage;
  for (const fighter of world.fighters) {
    const state = world.states[fighter.actionState];
    const ignoringPlatforms = wantsThroughPlatforms(fighter, state);

    const xPrev = fm.sub(fighter.x, fighter.vx);
    const yPrev = fm.sub(fighter.y, fighter.vy);

    let landed = false;
    let hitSolid = false;

    // Solids first. Drop-through never affects solids — they're hard
    // geometry regardless of input or state.
    for (const solid of stage.solids) {
      const hit = sweepPointIntoSolid(
        xPrev, yPrev,
        fighter.x, fighter.y,
        solid,
      );
      if (hit) {
        // Only the perpendicular axis snaps to the hit point. The
        // parallel axis keeps whatever motion this frame produced. This
        // is essential for wall slides: when a fighter is pressed against
        // a wall and gravity moves them down by vy, the wall hit fires
        // at t=0 (xPrev is already at the wall) with hitY=yPrev. If we
        // snapped y too, every frame would yank the fighter back to the
        // y they had at start-of-frame and they'd never accumulate
        // vertical progress. Snapping only x lets them slide.
        //
        // The same principle applies to top/bottom hits — preserving
        // parallel x motion means a fighter landing diagonally on the
        // edge of a platform ends at xNow rather than at the contact
        // point. The visual difference is sub-pixel for normal landings
        // and more correct for edge cases.
        switch (hit.side) {
          case 'top':
            fighter.y = hit.y;
            fighter.vy = 0;
            fighter.grounded = true;
            landed = true;
            break;
          case 'bottom':
            // Head bump: stop upward motion but stay airborne.
            fighter.y = hit.y;
            fighter.vy = 0;
            break;
          case 'left':
          case 'right':
            // Wall: stop horizontal motion. No state change here —
            // the state machine continues to drive vx through the
            // chosen horizontal mode, and collision keeps zeroing it
            // until the fighter changes direction or the wall is
            // cleared (e.g., by falling past the bottom edge).
            fighter.x = hit.x;
            fighter.vx = 0;
            break;
        }
        hitSolid = true;
        break;
      }
    }

    // Platforms second. Skipped entirely if the fighter is requesting
    // drop-through — this is what lets you fall onto a platform from
    // above while holding down and pass through it.
    if (!hitSolid && !ignoringPlatforms) {
      for (const platform of stage.platforms) {
        const hit = sweepPointOntoPlatform(
          xPrev, yPrev,
          fighter.x, fighter.y,
          platform,
        );
        if (hit) {
          // Same rule as solid top hits — snap only y, leave x alone.
          fighter.y = hit.y;
          fighter.vy = 0;
          fighter.grounded = true;
          landed = true;
          break;
        }
      }
    }

    // Walk-off check. Was grounded, didn't land on anything this frame,
    // is now somewhere that isn't a landable surface → clear grounded.
    // When the fighter is requesting drop-through, platforms don't count
    // as a surface, so standing on one with down held clears grounded
    // on the very next frame.
    if (!landed && fighter.grounded) {
      if (!isStandingOnAnySurface(fighter, stage, !ignoringPlatforms)) {
        fighter.grounded = false;
      }
    }
  }
}

// "Still standing on a surface" means feet are exactly at a solid's top
// or a platform's y line, AND within its x range. We can use === on y
// because a grounded fighter has vy=0 and physics doesn't integrate y
// when vy=0 — so y remains exactly equal to the surface's y after the
// initial snap. If a future system sets vy nonzero while grounded
// (it shouldn't), this assumption will break loudly.
//
// The `includePlatforms` flag lets a fighter who's requesting drop-
// through become ungrounded even while standing on a platform —
// platforms are no longer considered a valid resting surface for them.
function isStandingOnAnySurface(fighter, stage, includePlatforms) {
  for (const solid of stage.solids) {
    if (fighter.y === solid.top
        && fighter.x >= solid.left
        && fighter.x <= solid.right) {
      return true;
    }
  }
  if (includePlatforms) {
    for (const platform of stage.platforms) {
      if (fighter.y === platform.y
          && fighter.x >= platform.x1
          && fighter.x <= platform.x2) {
        return true;
      }
    }
  }
  return false;
}
