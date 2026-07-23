// fighter.js — Fighter entity factory.
//
// createFighter(config, x, y) returns a flat object containing only the
// fields used by systems that currently exist. The fighter's shape grows
// with the engine, not ahead of it.
//
// (x, y) is the bottom-center anchor — the point where the fighter's
// feet touch the ground. The rectangular body extends from y-height to y
// vertically, and from x-width/2 to x+width/2 horizontally. This anchor
// choice means "fighter is on the platform" is literally fighter.y ===
// platform.y, with no offset math.
//
// Phase 6: adds airJumpsUsed, the counter that gates the canAirJump
// condition. Refilled by the resetAirActions effect on landing (renamed
// from resetAirJumps in Phase 11).
//
// Phase 11: adds airDodgesUsed, the counter that gates the canAirDodge
// condition. Refilled by the same resetAirActions effect on landing.
//
// Phase 13 step 3: adds pendingHit and hitConnected — the two fields
// hitDetectionSystem reads and writes. They form a distinct cluster
// ("hit-detection scratchpad") that no other system touches in step 3.
//
// Phase 13 step 4: adds `damage` — the cumulative percent accumulator
// that the knockback formula reads to scale launch magnitude. Starts
// at 0 (fresh fighter takes minimal launch), incremented by
// applyHitReaction on every consumed pendingHit. Visible in the live-
// stats panel so the user can watch it climb across a session. Never
// reset by the engine; KO / respawn (Phase 19) will be the consumer
// that zeroes it.
//
// Phase 13 step 5: adds `pendingHitstunFrames` — the runtime field
// that makes Hitstun's duration dynamic. Written by applyHitReaction
// from the consumed hit's hitstun value; read by the hitstunFinished
// condition that gates Hitstun's exit transition. Not cleared after
// Hitstun ends — left as "last hitstun received" inspection data on
// the fighter, harmless when not in Hitstun. Re-hits during Hitstun
// overwrite it; stateFrame is reset to 0 by the Hitstun → Hitstun
// re-transition, so the new hit's hitstun value starts a fresh
// countdown.
//
// KO/respawn (Phase 19's substrate, pulled forward): adds spawnX/spawnY
// — the creation-time (x, y), frozen so the respawn effect can restore
// "the original spawn point" without knowing anything about the
// composition root's SPAWN_* constants — and pendingKO, the blast-zone
// scratchpad. blastZoneSystem writes pendingKO on a blast-zone
// crossing; the kOd condition consumes it next tick; the respawn
// effect clears it (and zeroes `damage` — the consumer the Phase 13
// step 4 note above anticipated).

import { createInputBuffer } from '../core/inputBuffer.js';

export function createFighter(config, x, y) {
  return {
    x,
    y,
    spawnX: x,            // original spawn point — respawn target,
    spawnY: y,            //   frozen at creation, never rewritten
    vx: 0,
    vy: 0,
    grounded: false,
    facing: 1,            // 1 = right, -1 = left
    actionState: 'Idle',
    stateFrame: 0,
    airJumpsUsed: 0,
    airDodgesUsed: 0,     // Phase 11
    pendingHit: null,     // Phase 13 step 3
    hitConnected: new Set(),  // Phase 13 step 3 — attacker's per-attack victim record
    damage: 0,            // Phase 13 step 4 — percent accumulator
    pendingHitstunFrames: 0,  // Phase 13 step 5 — Hitstun's dynamic duration
    pendingKO: false,     // blast-zone scratchpad — see KO/respawn note above
    config,
    inputBuffer: createInputBuffer(),
  };
}