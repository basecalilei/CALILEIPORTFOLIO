// physicsSystem.js — Per-frame physics update with state modulation.
//
// For each fighter:
//   1. If airborne, apply gravity scaled by the current state's mod and
//      capped by the state's terminal velocity (fallSpeedMax).
//   2. Dispatch to a horizontal-motion mode based on the state's
//      declared mode ('none', 'walk', 'air', 'dash').
//   3. Integrate velocity into position.
//
// The state machine decided WHAT the fighter is doing this frame; this
// system EXECUTES it physically. State is read-only here — physics never
// changes actionState (that's the state system's job).

import * as physics from '../core/physics.js';

const horizontalModes = {
  none: (fighter, _stickX, cfg, mods) => {
    physics.applyFriction(fighter, cfg.friction * mods.friction);
  },

  walk: (fighter, stickX, cfg, _mods) => {
    physics.setHorizontalSpeed(fighter, stickX * cfg.walkSpeed);
    if (stickX !== 0) fighter.facing = stickX > 0 ? 1 : -1;
  },

  // Air mode: drift control via airAccel additive velocity, capped at
  // airSpeedMax. Unlike walk, facing is NOT committed to stick direction
  // here — the player can drift backward while still facing forward,
  // which is what makes B-air accessible from stick-back + attack
  // (without it, holding back in the air flips facing immediately and
  // the "back" relationship is destroyed before the press evaluates).
  // The last facing commit happens from a ground action (walk, dash,
  // ground tilt) and persists across the entire airborne phase until
  // the next ground action overrides it. This decoupling of facing
  // from air-motion is the substrate property that also enables future
  // moonwalk-style mechanics where motion and facing point opposite ways.
  //
  // Phase 12a.4 retro note: this divergence from walk was a discovery,
  // not an original design. The facing-commit line existed in air mode
  // as a copy-paste from walk and was inert until aerial back-attacks
  // existed to surface the bug.
  air: (fighter, stickX, cfg, _mods) => {
    physics.addHorizontalVelocity(fighter, stickX * cfg.airAccel, cfg.airSpeedMax);
  },

  // Dash mode: vx is committed to fighter.facing * dashSpeed each frame.
  // Reads facing (not stickX) — direction changes go through transition
  // effects (commitFacingFromSlam); physics picks up the new facing on
  // its next call. This is what gives dash-back its instant reversal feel.
  dash: (fighter, _stickX, cfg, _mods) => {
    physics.setHorizontalSpeed(fighter, fighter.facing * cfg.dashSpeed);
  },
};

export function physicsSystem(world) {
  for (const fighter of world.fighters) {
    const state = world.states[fighter.actionState];
    const mods = state.physics;
    const cfg = fighter.config.physics;

    const now = fighter.inputBuffer[0];
    const stickX = now ? now.stickX : 0;

    // Gravity is only applied to airborne bodies. The state's gravity
    // multiplier scales the magnitude; the state's fallSpeedMax caps
    // downward velocity. States that don't declare fallSpeedMax don't
    // get a cap (grounded states never reach this branch anyway).
    if (!fighter.grounded) {
      physics.applyGravity(
        fighter,
        cfg.gravity * mods.gravity,
        mods.fallSpeedMax,
      );
    }

    const mode = horizontalModes[mods.horizontalMode];
    if (!mode) {
      throw new Error(
        `physicsSystem: unknown horizontalMode '${mods.horizontalMode}' ` +
        `in state '${state.name}'`,
      );
    }
    mode(fighter, stickX, cfg, mods);

    physics.integrate(fighter);
  }
}