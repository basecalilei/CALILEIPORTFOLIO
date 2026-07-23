// conditions.js — Registry of named transition conditions.
//
// Each condition is a function (fighter, state) → boolean. State
// transitions reference conditions by name; the state machine resolves
// the name through this registry. Adding a new condition is one entry
// here plus references from data/states/*.js — the state machine
// interpreter doesn't change.

import { wasPressedWithin, pressIndex } from './inputBuffer.js';
import * as fm from './fixedMath.js';

// jumpPressed window: a rising edge within this many frames counts as
// "pressed now" for ground-jump and similar transitions. 5 frames is
// forgiving enough that human-perfect input isn't required but tight
// enough that stale presses don't surprise the player. This window also
// covers jump-buffer-through-Land: tap jump on the last frame of Fall
// and the press carries through Land's 4 frames into Idle's check.
const JUMP_BUFFER_FRAMES = 5;

// canAirJump window: SHORTER than jumpPressed for a specific reason.
// See Phase 6 notes — the original ground-jump press would otherwise
// auto-promote to an air jump on the first Fall frame.
const AIRJUMP_BUFFER_FRAMES = 3;

// Light attack buffer window. Same as jumpPressed — both are discrete
// deliberate button inputs that deserve a forgiving rising-edge window
// so frame-perfect input isn't required. 5 frames matches the standard
// "discrete press" window already used by jumpPressed and stickSlammed.
const LIGHT_ATTACK_BUFFER_FRAMES = 5;

// canAirDodge window: same rationale as canAirJump. Short enough that
// when ground-shield arrives in a future combat phase, a ground-shield
// press will not carry into the first frame of Fall and auto-promote
// into an air-dodge. 3 frames means the press has aged out before Fall
// has a chance to evaluate canAirDodge. (Today there's no ground-shield
// to bleed into the buffer, but the window is set conservatively for
// when there will be.)
const AIRDODGE_BUFFER_FRAMES = 3;

// stickSlam window: how far back to look for a neutral → direction
// transition. The condition also requires the current snapshot to be
// non-neutral — see stickSlammed below.
const STICK_SLAM_FRAMES = 5;

// Fast-fall windows. Two thresholds:
//
//   FRESH window: if any frame in buf[1..FRESH-1] is neutral on stickY,
//     the current down-press is "fresh" — it started recently — and
//     fast-fall fires immediately. This is the apex fast-fall path:
//     press down at apex (or up to a couple frames early), neutral is
//     in the recent buffer, condition fires the moment vy reaches 0.
//
//   COMMIT window: if down has been held for COMMIT consecutive frames
//     with no neutral break (including the current frame), fast-fall
//     fires anyway. This is the "carryover from drop-through" path:
//     you held down to drop through a platform, kept holding, and
//     after a deliberate sustained hold you commit to fast-fall.
//
// The gap between FRESH and COMMIT defines the player-accessible
// window where you can tap down to drop through WITHOUT also fast-
// falling. Press once, hold for 2-5 frames, release: you drop through
// the platform and resume normal-speed fall. Hold for 6+ frames:
// you drop through AND fast-fall.
//
// FRESH=3 is the structural maximum. The drop-through case puts the
// original press at buf[2] (Fall's first transition check happens 2
// frames after the press), so any FRESH > 3 would scan past the press
// and see the pre-press neutral, misclassifying carryover as fresh.
// FRESH=2 also works but doesn't cover the "pressed 1 frame before
// apex" case — 3 is strictly better.
//
// Known small regression vs. Phase 8: pressing down 2-4 frames BEFORE
// apex used to fire fast-fall exactly at apex; now it fires 1-3 frames
// late (via the commit path). The exactly-at-apex and 1-frame-early
// cases are unchanged. If this regression is noticeable, fix is to add
// a "framesSinceGrounded" counter on the fighter and gate carryover by
// "was grounded recently" rather than buffer-pattern matching.
const FAST_FALL_FRESH_WINDOW = 3;
const FAST_FALL_COMMIT_FRAMES = 6;

export const conditions = {
  jumpPressed: (f, _s) =>
    wasPressedWithin(f.inputBuffer, 'jump', JUMP_BUFFER_FRAMES),

  // Phase 12a.1: light attack rising-edge within the light-attack window.
  // Same shape as jumpPressed. The snapshot's `lightattack` slot has been
  // claimed since Phase 4; this is its first consumer.
  lightAttackPressed: (f, _s) =>
    wasPressedWithin(f.inputBuffer, 'lightattack', LIGHT_ATTACK_BUFFER_FRAMES),

  // Phase 12a.2: directional variants of lightAttackPressed.
  //
  // Each asks "was lightattack pressed within the window AND was the
  // stick in this direction on the press frame?". Press-frame stick is
  // the key — a buffered press still carries its press-frame context,
  // which decouples the press from the player's later reflexive stick
  // movements. Reading current stickX/Y would route incorrectly when the
  // player taps a direction + attack, then releases the direction before
  // the state machine evaluates.
  //
  // Y-down convention: stickY > 0 is "down" (pulled down on the stick or
  // a down-arrow key); stickY < 0 is "up".
  //
  // These overlap by design. A diagonal press (stickX=1, stickY=-1)
  // makes BOTH Up and Side true; the source state's transition priority
  // order decides which one fires (Up listed first, by convention).
  // Pure-cardinal presses match exactly one.
  lightAttackPressedUp: (f, _s) => {
    const idx = pressIndex(f.inputBuffer, 'lightattack', LIGHT_ATTACK_BUFFER_FRAMES);
    return idx !== -1 && f.inputBuffer[idx].stickY < 0;
  },

  lightAttackPressedDown: (f, _s) => {
    const idx = pressIndex(f.inputBuffer, 'lightattack', LIGHT_ATTACK_BUFFER_FRAMES);
    return idx !== -1 && f.inputBuffer[idx].stickY > 0;
  },

  lightAttackPressedSide: (f, _s) => {
    const idx = pressIndex(f.inputBuffer, 'lightattack', LIGHT_ATTACK_BUFFER_FRAMES);
    return idx !== -1 && f.inputBuffer[idx].stickX !== 0;
  },

  // Phase 12a.4: aerial directional variants. Forward and Back are
  // facing-relative — "forward" means the stick was on the same side as
  // facing at the press frame; "back" means opposite. This is the
  // critical distinction from ground's lightAttackPressedSide, which
  // doesn't care about facing (ground tilts pivot the fighter; aerials
  // never pivot, so the hitbox direction lives on the state and is
  // resolved by facing-relative stick at the press moment).
  //
  // Facing rarely changes mid-press (only via explicit commit effects,
  // none of which run airborne), so using current f.facing matches
  // press-frame facing in practice. If a future ground-to-air transition
  // changes facing while a press is buffered, current facing is the more
  // recent player intent anyway.
  //
  // Diagonals: up-forward (stickX>0, stickY<0 with facing=1) makes both
  // lightAttackPressedUp AND lightAttackPressedForward true. The source
  // state's transition priority order decides which wins (vertical first).
  lightAttackPressedForward: (f, _s) => {
    const idx = pressIndex(f.inputBuffer, 'lightattack', LIGHT_ATTACK_BUFFER_FRAMES);
    return idx !== -1 && f.inputBuffer[idx].stickX * f.facing > 0;
  },

  lightAttackPressedBack: (f, _s) => {
    const idx = pressIndex(f.inputBuffer, 'lightattack', LIGHT_ATTACK_BUFFER_FRAMES);
    return idx !== -1 && f.inputBuffer[idx].stickX * f.facing < 0;
  },

  // duration=N means the state lasts exactly N physics frames before
  // this condition fires. stateFrame is 0-indexed (0 on entry, increments
  // by 1 each tick the state survives). Since the increment happens at
  // the END of stateSystem (after the no-fire path), checking
  // `stateFrame + 1 >= duration` is what makes "the Nth frame's
  // stateSystem fires the transition" — not the (N+1)th. duration=0 or
  // undefined means "no auto-exit" — never fires regardless of stateFrame.
  //
  // Phase 12a.2.5: duration source is two-tier. The character config's
  // `attacks[stateName].duration` wins if present (used by attack states,
  // where the value is character-specific). Otherwise falls back to the
  // state's own `duration` (used by movement states like Land/JumpSquat,
  // where the value is universal — for now). When per-character movement
  // tuning arrives, the same lookup pattern picks it up automatically as
  // long as the data is authored under the same character namespace.
  durationElapsed: (f, s) => {
    const attackDuration = f.config.attacks?.[s.name]?.duration;
    const duration = attackDuration ?? s.duration;
    return duration > 0 && f.stateFrame + 1 >= duration;
  },

  grounded:    (f, _s) =>  f.grounded,
  notGrounded: (f, _s) => !f.grounded,

  horizontalInput: (f, _s) => {
    const now = f.inputBuffer[0];
    return !!now && now.stickX !== 0;
  },
  noHorizontalInput: (f, _s) => {
    const now = f.inputBuffer[0];
    return !now || now.stickX === 0;
  },

  // Y-down convention: stickY > 0 means "stick pulled down".
  crouchInput: (f, _s) => {
    const now = f.inputBuffer[0];
    return !!now && now.stickY > 0;
  },
  notCrouchInput: (f, _s) => {
    const now = f.inputBuffer[0];
    return !now || now.stickY <= 0;
  },

  canAirJump: (f, _s) => {
    if (!wasPressedWithin(f.inputBuffer, 'jump', AIRJUMP_BUFFER_FRAMES)) {
      return false;
    }
    return f.airJumpsUsed < f.config.physics.maxAirJumps;
  },

  // Phase 11: shield-press rising edge within the airdodge window AND
  // the dodge counter still has room. Mirrors canAirJump's shape exactly
  // — two stacked questions, one buffered-input and one resource check.
  canAirDodge: (f, _s) => {
    if (!wasPressedWithin(f.inputBuffer, 'shield', AIRDODGE_BUFFER_FRAMES)) {
      return false;
    }
    return f.airDodgesUsed < f.config.physics.maxAirDodges;
  },

  stickSlammed: (f, _s) => {
    const buf = f.inputBuffer;
    const now = buf[0];
    if (!now || now.stickX === 0) return false;
    const limit = Math.min(STICK_SLAM_FRAMES, buf.length - 1);
    for (let i = 0; i < limit; i++) {
      if (buf[i].stickX !== 0 && buf[i + 1].stickX === 0) return true;
    }
    return false;
  },

  stickReverseFromFacing: (f, _s) => {
    const now = f.inputBuffer[0];
    if (!now || now.stickX === 0) return false;
    return fm.sign(now.stickX) === -f.facing;
  },

  // Phase 8/9: fast-fall trigger. The current down-press fires fast-fall
  // either when it's a fresh press (neutral seen in FRESH window) OR
  // when it's a sustained hold (COMMIT consecutive held frames).
  //
  // This split exists because drop-through and fast-fall share the same
  // input (stickY > 0) and we want to give the player a tap window for
  // drop-without-commit. The two paths:
  //
  //   APEX (fresh): jumped, ascended with stick neutral, pressed down
  //     at apex. buf[1] is neutral → fresh → fires this frame. Same
  //     latency as the original Phase 8 condition.
  //
  //   CARRYOVER (commit): tapped down on a platform, dropped through,
  //     kept holding. The press itself is older than the fresh window,
  //     so the loop sees only held frames. Suppressed until the held
  //     run reaches COMMIT frames, at which point the player has
  //     unambiguously committed.
  //
  // Both paths require vy >= -5 — can't fast-fall while strongly
  // ascending. The threshold being -5 rather than 0 is a deliberate
  // feel choice: it lets the player cancel a portion of their jump by
  // fast-falling before apex, which makes movement feel faster. When
  // fast-fall becomes available during a jump has a major effect on
  // movement feel in a platform fighter (a chunk of the ascent is
  // cancellable at -5, only the apex itself at 0). This is an
  // in-progress tuning knob; the exact value may move later for balance
  // or feel. The principle is "the condition gates on physics readiness";
  // the specific number is the tuning choice.
  fastFallTriggered: (f, _s) => {
    const buf = f.inputBuffer;
    const now = buf[0];
    if (!now || now.stickY <= 0) return false;
    if (f.vy < -5) return false;

    // Fresh path: any neutral within buf[1..FRESH-1] means the current
    // down started recently — fire immediately.
    const freshLimit = Math.min(FAST_FALL_FRESH_WINDOW, buf.length);
    for (let i = 1; i < freshLimit; i++) {
      if (!buf[i] || buf[i].stickY <= 0) return true;
    }

    // Commit path: held for COMMIT consecutive frames including now.
    // If the entire window is held, the press counts as committed even
    // without a recent neutral. Require the buffer to actually have
    // COMMIT entries — otherwise we'd spuriously commit in the first
    // few frames after start, when there's no history to disprove a
    // sustained hold.
    if (buf.length < FAST_FALL_COMMIT_FRAMES) return false;
    for (let i = 0; i < FAST_FALL_COMMIT_FRAMES; i++) {
      if (!buf[i] || buf[i].stickY <= 0) return false;
    }
    return true;
  },

  // Phase 13 step 4: hit-taken. True when hitDetectionSystem wrote
  // pendingHit on the previous tick and no transition has consumed it
  // yet. Universally placed as the FIRST transition in every state
  // (see Phase 13 step 4 in states.js) so the hit reaction takes
  // priority over every other available transition. Consumed by the
  // applyHitReaction effect, which clears pendingHit after using it.
  hitTaken: (fighter) => fighter.pendingHit !== null,

  // Phase 13 step 5: hitstun-finished. Sibling to durationElapsed but
  // reads its target duration from a fighter-runtime field
  // (pendingHitstunFrames, written by applyHitReaction) instead of a
  // state-data field (state.duration). This is the substrate that
  // makes Hitstun's duration dynamic per-hit without changing how
  // durationElapsed works for fixed-duration states.
  //
  // The comparison is `>=` rather than `>` so a hitstun value of N
  // means the fighter is in Hitstun for exactly N frames (stateFrame
  // 0 through N-1), exiting on the frame stateFrame would become N.
  // A hitstun value of 0 means "exit immediately" — the condition is
  // satisfied on the entry tick (stateFrame === 0 >= 0), and the
  // fighter transitions out of Hitstun without spending any visible
  // time there. This is the defensive path for attacks authored
  // without a hitstun field (applyHitReaction defaults to 0).
  hitstunFinished: (fighter) =>
    fighter.stateFrame >= fighter.pendingHitstunFrames,

  // KO'd. True when blastZoneSystem wrote pendingKO on the previous
  // tick and no transition has consumed it yet. Universally placed as
  // the FIRST transition in every state — ABOVE hitTaken, because a
  // fighter past the blast line is dead before any same-frame hit can
  // launch them. Consumed by the respawn effect, which clears
  // pendingKO after using it. Same detect-flag-consume shape as the
  // hitDetection → hitTaken → applyHitReaction pipeline: the system
  // needs world-level data (stage.blastZones) that conditions can't
  // see, so it detects and flags; the machine owns the state change.
  kOd: (fighter) => fighter.pendingKO === true,
};