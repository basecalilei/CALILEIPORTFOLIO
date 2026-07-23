// effects.js — Registry of named transition effects.
//
// Effects fire once at the moment a transition resolves — not on every
// frame of a state. They mutate fighter fields. Adding a new effect is
// one entry here plus a reference from a transition in data/states/*.js.

import * as fm from './fixedMath.js';
import { pressIndex, BUFFER_SIZE } from './inputBuffer.js';
import { computeKnockback } from './knockback.js';

export const effects = {
  // Apply the upward jump velocity. Called on the JumpSquat → Fall
  // transition. Negative because Y-down: jumping means decreasing y.
  applyJumpImpulse: (fighter) => {
    fighter.vy = -fighter.config.physics.jumpForce;
  },

  // Apply the upward air-jump velocity and consume one air jump. Called
  // on the Fall|AirJump|FastFall → AirJump transition. We OVERWRITE vy
  // rather than add to it: the jump should feel the same whether you
  // were rising, level, falling normally, or fast-falling — every air
  // jump produces the same upward burst.
  applyAirJumpImpulse: (fighter) => {
    fighter.vy = -fighter.config.physics.airJumpForce;
    fighter.airJumpsUsed += 1;
  },

  // Refresh per-aerial-phase counters. Called on the AirState → Land
  // transition (Fall, AirJump, FastFall, AirDodge — all paths back from
  // airborne to grounded). Land is currently the only such path, so this
  // is the single reset site for everything that's "once per aerial phase."
  //
  // Phase 11: renamed from `resetAirJumps`. Now also resets airDodgesUsed.
  // The state machine supports one effect per transition; composing
  // multiple resets into one effect is the cheapest factoring while only
  // two counters need it. If a future state needs to reset just one of
  // the two (or a third counter is added with different reset semantics),
  // the right move is to extend the state machine to allow an array of
  // effects per transition, then split the composite back into atoms.
  // Until then, composite.
  resetAirActions: (fighter) => {
    fighter.airJumpsUsed = 0;
    fighter.airDodgesUsed = 0;
  },

  // Commit facing to the current stickX direction. Fired on every
  // transition INTO Dash or DashBack. Reads buffer[0].stickX directly —
  // the conditions that trigger this effect guarantee stickX is non-zero
  // on the fire frame.
  commitFacingFromSlam: (fighter) => {
    const now = fighter.inputBuffer[0];
    if (!now || now.stickX === 0) return;
    fighter.facing = fm.sign(now.stickX);
  },

  // Phase 12a.2: commit facing to the stickX direction at the moment the
  // light-attack button was pressed (NOT the current stickX). Fired on
  // transitions from Idle/Walk/Land/DashStop/Squat into LightSideGround.
  //
  // The press-frame stick is the right input — at the moment the player
  // pressed A with a horizontal stick component, that's their intended
  // attack direction. Reading current stickX would race the player's
  // reflexive stick adjustments and produce wrong directions when the
  // press is buffered across frames.
  //
  // Searches the entire buffer; the condition (lightAttackPressedSide)
  // already enforced the buffer-window check, so any press it found will
  // be found here too. If pressIndex returns -1, the condition was lying
  // (shouldn't happen) — we no-op rather than mutate facing on bad data.
  //
  // When heavy/special/grab attack families arrive with their own side
  // variants, they'll want the same logic against their own button slots.
  // Until a second consumer exists, this stays specifically named.
  commitFacingFromLightAttackPress: (fighter) => {
    const idx = pressIndex(fighter.inputBuffer, 'lightattack', BUFFER_SIZE);
    if (idx === -1) return;
    const stickX = fighter.inputBuffer[idx].stickX;
    if (stickX === 0) return;
    fighter.facing = fm.sign(stickX);
  },

  // Phase 8: fast-fall impulse. Snaps vy to the character's fast-fall
  // speed regardless of current vy. The destination state (FastFall)
  // has gravity:0 in its mods, so this speed becomes the constant
  // descent velocity until landing or air-jump-cancel.
  applyFastFall: (fighter) => {
    fighter.vy = fighter.config.physics.fastFallSpeed;
  },

  // Phase 11: air-dodge impulse. Reads the stick at the moment of
  // transition, normalizes the 2D direction vector, and scales by the
  // character's airDodgeSpeed to set vx and vy. The destination state
  // (AirDodge) has gravity:0 and friction:0 with horizontalMode:'none',
  // so these velocities persist unchanged for the dodge's duration.
  //
  // Normalization (stick / length × speed) ensures cardinals and
  // diagonals reach the same magnitude. Without it, diagonals would be
  // 41% faster than cardinals — wrong, and it would create directional
  // bias in which dodge angles are best.
  //
  // The neutral case (no stick direction) sets vx and vy to 0, producing
  // an in-place dodge. This is intentional: a future combat system will
  // want the option to use the dodge's i-frames defensively without
  // committing to motion.
  applyAirDodge: (fighter) => {
    const now = fighter.inputBuffer[0];
    const sx = now ? now.stickX : 0;
    const sy = now ? now.stickY : 0;

    if (sx === 0 && sy === 0) {
      // Neutral dodge — in-place, useful for using i-frames (future)
      // without changing position.
      fighter.vx = 0;
      fighter.vy = 0;
    } else {
      const len = fm.length2D(sx, sy);
      const speed = fighter.config.physics.airDodgeSpeed;
      fighter.vx = fm.mul(fm.div(sx, len), speed);
      fighter.vy = fm.mul(fm.div(sy, len), speed);
    }

    fighter.airDodgesUsed += 1;
  },

  // Phase 13 step 4: hit reaction. Fired on the universal `hitTaken`
  // transition (every state → Hitstun). Reads the fighter's pendingHit
  // (set by hitDetectionSystem on the previous tick), computes the
  // launch velocity via core/knockback, applies it, accumulates the
  // hit's damage into the fighter's percent counter, and clears
  // pendingHit so the next tick starts from a clean slate.
  //
  // Ordering inside the effect:
  //   1. Snapshot the hit (read pendingHit into a local — the next
  //      writes to fighter.* shouldn't depend on the live field).
  //   2. computeKnockback uses fighter.damage BEFORE the hit's damage
  //      is added — Melee convention: post-hit percent enters the
  //      formula via the function's internal `total = victim + move`
  //      step. Don't pre-increment damage here.
  //   3. Apply vx/vy.
  //   4. Increment damage (post-hit accumulation).
  //   5. Write pendingHitstunFrames from hit.hitstun (Phase 13 step 5).
  //      Defaulted to 0 via `?? 0` so an attack authored without a
  //      hitstun field produces zero-frame hitstun (immediate Fall
  //      transition) instead of permanent paralysis from a never-
  //      satisfied stateFrame >= undefined comparison.
  //   6. Clear pendingHit. After this effect, no other system should
  //      see the consumed hit.
  //
  // The effect is single-argument (fighter), matching every other
  // effect. attackerFacing is read from hit, not from the live
  // attacker fighter — hitDetectionSystem snapshotted it at hit time,
  // so a pivoting attacker between hit-write and hit-consume can't
  // distort the launch direction.
  applyHitReaction: (fighter) => {
    const hit = fighter.pendingHit;
    if (!hit) return;  // defensive — hitTaken should have gated this

    const { vx, vy } = computeKnockback(
      hit,
      fighter.damage,
      fighter.config.physics.weight,
    );

    fighter.vx = vx;
    fighter.vy = vy;
    fighter.damage += hit.damage;
    fighter.pendingHitstunFrames = hit.hitstun ?? 0;
    fighter.pendingHit = null;
  },

  // Respawn. Consumes pendingKO (written by blastZoneSystem when the
  // fighter crossed the blast zone) and puts the fighter back at their
  // original spawn point, airborne, as a fresh fighter. The paired
  // transition targets Fall: spawn points sit above the stage, so the
  // fighter drops back in and the ordinary Fall → Land path settles
  // them — no dedicated respawn state needed until Phase 19 adds
  // freeze/i-frames, at which point the `to:` target changes and this
  // substrate stays.
  //
  // A composite like applyHitReaction — another decomposition candidate
  // when 13b's array-of-effects interpreter extension lands.
  //
  // What resets and why:
  //   - x/y from spawnX/spawnY (recorded once by createFighter — the
  //     "original spawn point" is creation-time truth, not stage data).
  //   - vx/vy to 0: the killing launch must not follow through death.
  //   - grounded false: the spawn point is airborne; collision will
  //     assert the truth on landing.
  //   - damage to 0 — this is the consumer fighter.js's Phase 13
  //     step 4 note anticipated ("KO / respawn will be the consumer
  //     that zeroes it").
  //   - air actions refilled: a respawned fighter has fresh resources,
  //     same as a landing.
  //   - pendingHit null: a hit recorded on the death frame must not
  //     launch the freshly respawned fighter out of Fall next tick.
  //   - pendingKO false: the flag this effect consumes.
  //
  // Deliberately untouched: facing (no gameplay reason to reset),
  // pendingHitstunFrames (house convention — stale inspection data,
  // harmless outside Hitstun), and hitConnected (hit-detection-internal
  // scratchpad with its own owner; hitDetectionSystem clears it on the
  // next attack state's entry tick).
  respawn: (fighter) => {
    fighter.x = fighter.spawnX;
    fighter.y = fighter.spawnY;
    fighter.vx = 0;
    fighter.vy = 0;
    fighter.grounded = false;
    fighter.damage = 0;
    fighter.airJumpsUsed = 0;
    fighter.airDodgesUsed = 0;
    fighter.pendingHit = null;
    fighter.pendingKO = false;
  },
};