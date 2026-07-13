// states.js — State definitions for the fighter.
//
// Each state is a data object describing the universal ACTION SHAPE —
// what the action is, how it composes with physics, what transitions
// exit it. Per-character TUNING (timing, hitbox geometry, damage,
// knockback) lives on the character config under `attacks` (see
// fighterA.js). The same state name reached by two different fighters
// produces the same action shape with each fighter's own tuning values.
//
// Each state is a data object with the following fields:
//
//   name:        identifier matching the table key.
//
//   duration:    number of frames before durationElapsed fires. 0 or
//                absent means "no automatic exit." For ATTACK states
//                this is OMITTED here — the character config provides
//                the value via attacks[name].duration. For MOVEMENT
//                states (Land, JumpSquat, etc.) duration lives here
//                until per-character variation is needed.
//
//   physics:    modifiers consulted by the physics system each frame the
//               fighter is in this state.
//                 gravity         — multiplier on base gravity (airborne only)
//                 friction        — multiplier on base friction
//                 horizontalMode  — 'none' | 'walk' | 'air' | 'dash'
//                 fallSpeedMax    — terminal velocity cap (optional;
//                                   only applies to airborne states)
//                 respectPlatforms — opt-out for drop-through (optional;
//                                   true means platforms aren't passed
//                                   through even with stickY held)
//                 intangible      — opt-out placeholder for future
//                                   hit-detection (optional; true means
//                                   the state has i-frames; consumer to
//                                   arrive with combat phase)
//
//   transitions: priority-ordered list of exit conditions. First matching
//               condition wins. Each entry: { when, to, effect? }.
//                 when    — name of a condition function (see conditions.js)
//                 to      — actionState to enter
//                 effect  — optional name of an effect to run at transition.
//                           May be a string for one effect, or an array
//                           of strings for ordered composition (state
//                           machine extension anticipated in Phase 11).
//
//   render:     optional. Per-state visual overrides. Currently supports
//               { color } to override fighter.config.color.
//
// Hitbox field reference (for character configs that declare hitboxes
// under attacks[stateName].hitboxes):
//   active   — [firstFrame, lastFrame] stateFrame range, inclusive.
//              Hitbox is live when stateFrame >= active[0] && stateFrame
//              <= active[1].
//   shape    — { x, y, w, h }. (x, y) is the CENTER offset from
//              fighter.{x,y}; x is mirrored by facing at the consult
//              site. w, h are full width/height (extends w/2 on each
//              side of center, h/2 above and below).
//   damage, angle, baseKnockback, knockbackGrowth, hitstun — knockback
//              parameters consumed by hit-detection (arrives Phase 12b).
//
// Phase 12a.2.5 migration: attack states (LightNeutralGround,
// LightSideGround, LightUpGround, LightDownGround) intentionally omit
// `duration` and `hitboxes`. Those moved to character data so each
// fighter can have their own jab timing, hitbox reach, knockback feel,
// etc. The state object is now the action's identity (physics shape,
// transitions, render) — the tuning is the character's. This same
// migration pattern will apply later to movement states when characters
// need different JumpSquat/Land durations.

export const states = {
  Idle: {
    name: 'Idle',
    duration: 0,
    physics: { gravity: 1.0, friction: 1.0, horizontalMode: 'none' },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'notGrounded',            to: 'Fall' },
      { when: 'jumpPressed',            to: 'JumpSquat' },
      { when: 'lightAttackPressedUp',   to: 'LightUpGround' },
      { when: 'lightAttackPressedDown', to: 'LightDownGround' },
      { when: 'lightAttackPressedSide', to: 'LightSideGround', effect: 'commitFacingFromLightAttackPress' },
      { when: 'lightAttackPressed',     to: 'LightNeutralGround' },
      { when: 'crouchInput',            to: 'Squat' },
      { when: 'stickSlammed',           to: 'Dash', effect: 'commitFacingFromSlam' },
      { when: 'horizontalInput',        to: 'Walk' },
    ],
    render: { color: '#dd5555' },
  },

  Walk: {
    name: 'Walk',
    duration: 0,
    physics: { gravity: 1.0, friction: 0, horizontalMode: 'walk' },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'notGrounded',            to: 'Fall' },
      { when: 'jumpPressed',            to: 'JumpSquat' },
      { when: 'lightAttackPressedUp',   to: 'LightUpGround' },
      { when: 'lightAttackPressedDown', to: 'LightDownGround' },
      { when: 'lightAttackPressedSide', to: 'LightSideGround', effect: 'commitFacingFromLightAttackPress' },
      { when: 'lightAttackPressed',     to: 'LightNeutralGround' },
      { when: 'crouchInput',            to: 'Squat' },
      { when: 'stickSlammed',           to: 'Dash', effect: 'commitFacingFromSlam' },
      { when: 'noHorizontalInput',      to: 'Idle' },
    ],
    render: { color: '#e06060' },
  },

  Squat: {
    name: 'Squat',
    duration: 0,
    physics: { gravity: 1.0, friction: 1.0, horizontalMode: 'none' },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'notGrounded',            to: 'Fall' },
      { when: 'jumpPressed',            to: 'JumpSquat' },
      // Phase 12a.2: full directional family on Squat. On keyboard, only
      // lightAttackPressedDown is practically reachable (the player is
      // holding down to be in Squat), but the c-stick on controllers
      // produces directional attacks independent of the main stick, so
      // the substrate must accommodate all four entry points from here.
      // Directional conditions sit before notCrouchInput so an attack
      // press while still crouched routes to LightDownGround instead of
      // racing to Idle.
      { when: 'lightAttackPressedUp',   to: 'LightUpGround' },
      { when: 'lightAttackPressedDown', to: 'LightDownGround' },
      { when: 'lightAttackPressedSide', to: 'LightSideGround', effect: 'commitFacingFromLightAttackPress' },
      { when: 'lightAttackPressed',     to: 'LightNeutralGround' },
      { when: 'notCrouchInput',         to: 'Idle' },
    ],
    render: { color: '#aa3333' },
  },

  JumpSquat: {
    name: 'JumpSquat',
    duration: 3,
    physics: { gravity: 0, friction: 0, horizontalMode: 'none' },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'durationElapsed', to: 'Fall', effect: 'applyJumpImpulse' },
    ],
    render: { color: '#ee7755' },
  },

  Fall: {
    name: 'Fall',
    duration: 0,
    physics: {
      gravity: 1.0,
      friction: 0,
      horizontalMode: 'air',
      fallSpeedMax: 6.0,         // terminal velocity for normal fall
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      // grounded first — touching down beats both fast-fall and air-jump.
      { when: 'grounded',          to: 'Land',     effect: 'resetAirActions' },
      // canAirJump before canAirDodge: a fresh jump press is the more
      // common deliberate aerial input. Both are discrete; both beat
      // sustained inputs like fast-fall. Jump-vs-dodge simultaneity is
      // a near-frame-perfect edge case and the priority order documents
      // intent for that case.
      { when: 'canAirJump',        to: 'AirJump',  effect: 'applyAirJumpImpulse' },
      // Phase 12a.4: aerial attack family. Up/Down/Forward/Back/Neutral.
      // Up and Down listed first — diagonals route to vertical moves.
      // Discrete-button attacks slot between jump (above) and dodge
      // (below); same logic as ground attack priority.
      { when: 'lightAttackPressedUp',      to: 'LightUpAir' },
      { when: 'lightAttackPressedDown',    to: 'LightDownAir' },
      { when: 'lightAttackPressedForward', to: 'LightForwardAir' },
      { when: 'lightAttackPressedBack',    to: 'LightBackAir' },
      { when: 'lightAttackPressed',        to: 'LightNeutralAir' },
      // Phase 11: shield press fires air-dodge.
      { when: 'canAirDodge',       to: 'AirDodge', effect: 'applyAirDodge' },
      // canAirJump/Dodge before fastFallTriggered: a fresh button press
      // is a discrete deliberate input; down can be held for many reasons.
      { when: 'fastFallTriggered', to: 'FastFall', effect: 'applyFastFall' },
    ],
    render: { color: '#cc5555' },
  },

  AirJump: {
    name: 'AirJump',
    duration: 0,
    physics: {
      gravity: 1.0,
      friction: 0,
      horizontalMode: 'air',
      fallSpeedMax: 6.0,
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'grounded',          to: 'Land',     effect: 'resetAirActions' },
      { when: 'canAirJump',        to: 'AirJump',  effect: 'applyAirJumpImpulse' },
      // Phase 12a.4: aerial attack family — same priority pattern as Fall.
      { when: 'lightAttackPressedUp',      to: 'LightUpAir' },
      { when: 'lightAttackPressedDown',    to: 'LightDownAir' },
      { when: 'lightAttackPressedForward', to: 'LightForwardAir' },
      { when: 'lightAttackPressedBack',    to: 'LightBackAir' },
      { when: 'lightAttackPressed',        to: 'LightNeutralAir' },
      { when: 'canAirDodge',       to: 'AirDodge', effect: 'applyAirDodge' },
      { when: 'fastFallTriggered', to: 'FastFall', effect: 'applyFastFall' },
    ],
    render: { color: '#ff7777' },
  },

  // Phase 8: FastFall. A descending commitment — once entered, the
  // fighter falls at a constant speed (gravity:0 mod prevents
  // acceleration; effect set vy to fastFallSpeed). Exits via landing,
  // air-jump-cancel, or (Phase 11) air-dodge-cancel.
  //
  // There's no fastFallTriggered transition here, so a held-down stick
  // can't repeat-fire the effect.
  FastFall: {
    name: 'FastFall',
    duration: 0,
    physics: {
      gravity: 0,                 // no acceleration — speed is constant
      friction: 0,
      horizontalMode: 'air',
      fallSpeedMax: 9.0,          // matches fastFallSpeed; redundant given
                                  // gravity:0, but defensive against any
                                  // external force that might push faster
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'grounded',   to: 'Land',    effect: 'resetAirActions' },
      // Air jump cancel of fast fall — recovery option. The impulse
      // overwrites vy, so the fast fall speed is replaced with the
      // upward velocity of the air jump.
      { when: 'canAirJump', to: 'AirJump', effect: 'applyAirJumpImpulse' },
      // Phase 12a.4: aerial attack family — same priority pattern as Fall.
      // Fast-falling into an aerial preserves the vy=9 entry into the
      // aerial state thanks to fallSpeedMax: 9.0 on the aerial states.
      { when: 'lightAttackPressedUp',      to: 'LightUpAir' },
      { when: 'lightAttackPressedDown',    to: 'LightDownAir' },
      { when: 'lightAttackPressedForward', to: 'LightForwardAir' },
      { when: 'lightAttackPressedBack',    to: 'LightBackAir' },
      { when: 'lightAttackPressed',        to: 'LightNeutralAir' },
      // Phase 11: dodge-cancel of fast fall — recovery option in any
      // direction. applyAirDodge overwrites both vx and vy, so the
      // fast-fall trajectory is replaced with the dodge trajectory.
      { when: 'canAirDodge', to: 'AirDodge', effect: 'applyAirDodge' },
    ],
    render: { color: '#cc4444' },
  },

  // Phase 11: AirDodge. A committed 20-frame trajectory in a stick-
  // determined direction. Gravity 0 and friction 0 with horizontalMode
  // 'none' together preserve the velocity set by applyAirDodge — the
  // trajectory is a straight line for the full duration.
  //
  // Only landing (grounded) or duration (durationElapsed) can exit the
  // dodge. No mid-dodge canAirJump, canAirDodge, or fastFallTriggered —
  // the dodge is a commitment. This is what gives the technique tactical
  // weight; the player chooses direction at the press and cannot change
  // their mind mid-flight.
  //
  // intangible: true is the i-frame placeholder. No system reads this
  // flag in Phase 11. When future hit-detection arrives, it will consult
  // state.physics.intangible at the point of would-be-hit. Until then,
  // the flag sits in the data shape as the architectural contract for
  // i-frames. See dataModel.md §9 for the general state-level opt-out
  // pattern that this instantiates.
  AirDodge: {
    name: 'AirDodge',
    duration: 20,
    physics: {
      gravity: 0,
      friction: 0,
      horizontalMode: 'none',
      intangible: true,           // PLACEHOLDER for future hit-detection
      respectPlatforms: true,     // Prevents wavelanding from dropping through
                                  // platforms. Without this, a stickY>0 dodge
                                  // direction would trigger drop-through, and
                                  // the fighter would pass through any platform
                                  // they aimed for. Trade-off: you can't drop
                                  // through a platform during a dodge — release
                                  // shield and press down instead.
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'grounded',         to: 'Land', effect: 'resetAirActions' },
      { when: 'durationElapsed',  to: 'Fall' },
    ],
    render: { color: '#5577cc' },
  },

  Land: {
    name: 'Land',
    duration: 4,
    physics: { gravity: 1.0, friction: 1.0, horizontalMode: 'none', respectPlatforms: true, },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'notGrounded',            to: 'Fall' },
      { when: 'lightAttackPressedUp',   to: 'LightUpGround' },
      { when: 'lightAttackPressedDown', to: 'LightDownGround' },
      { when: 'lightAttackPressedSide', to: 'LightSideGround', effect: 'commitFacingFromLightAttackPress' },
      { when: 'lightAttackPressed',     to: 'LightNeutralGround' },
      { when: 'stickSlammed',           to: 'Dash', effect: 'commitFacingFromSlam' },
      { when: 'durationElapsed',        to: 'Idle' },
    ],
    render: { color: '#bb4444' },
  },

  Dash: {
    name: 'Dash',
    duration: 10,
    physics: { gravity: 1.0, friction: 0, horizontalMode: 'dash' },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'notGrounded', to: 'Fall' },
      { when: 'jumpPressed', to: 'JumpSquat' },
      { when: 'lightAttackPressed', to: 'DashAttack' },
      { when: 'crouchInput', to: 'Squat' },
      { when: 'stickReverseFromFacing', to: 'DashBack', effect: 'commitFacingFromSlam' },
      { when: 'noHorizontalInput',      to: 'DashStop' },
      { when: 'durationElapsed',        to: 'Run' },
    ],
    render: { color: '#ff8844' },
  },

  DashBack: {
    name: 'DashBack',
    duration: 10,
    physics: { gravity: 1.0, friction: 0, horizontalMode: 'dash' },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'notGrounded', to: 'Fall' },
      { when: 'jumpPressed', to: 'JumpSquat' },
      { when: 'lightAttackPressed', to: 'DashAttack' },
      { when: 'crouchInput', to: 'Squat' },
      { when: 'stickReverseFromFacing', to: 'Dash', effect: 'commitFacingFromSlam' },
      { when: 'noHorizontalInput',      to: 'DashStop' },
      { when: 'durationElapsed',        to: 'Run' },
    ],
    render: { color: '#ee6622' },
  },

  Run: {
    name: 'Run',
    duration: 0,
    physics: { gravity: 1.0, friction: 0, horizontalMode: 'dash' },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'notGrounded', to: 'Fall' },
      { when: 'jumpPressed', to: 'JumpSquat' },
      { when: 'lightAttackPressed', to: 'DashAttack' },
      { when: 'crouchInput', to: 'Squat' },
      { when: 'stickReverseFromFacing', to: 'DashBack', effect: 'commitFacingFromSlam' },
      { when: 'noHorizontalInput',      to: 'DashStop' },
    ],
    render: { color: '#ffaa44' },
  },

  DashStop: {
    name: 'DashStop',
    duration: 4,
    physics: { gravity: 1.0, friction: 1.0, horizontalMode: 'none' },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'notGrounded',            to: 'Fall' },
      { when: 'jumpPressed',            to: 'JumpSquat' },
      { when: 'lightAttackPressedUp',   to: 'LightUpGround' },
      { when: 'lightAttackPressedDown', to: 'LightDownGround' },
      { when: 'lightAttackPressedSide', to: 'LightSideGround', effect: 'commitFacingFromLightAttackPress' },
      { when: 'lightAttackPressed',     to: 'LightNeutralGround' },
      { when: 'crouchInput',            to: 'Squat' },
      { when: 'stickSlammed',           to: 'Dash', effect: 'commitFacingFromSlam' },
      { when: 'durationElapsed',        to: 'Idle' },
    ],
    render: { color: '#aa5544' },
  },

  // Phase 12a.1: LightNeutralGround. The grounded neutral light attack
  // (jab). Stationary swing — friction:1.0 + horizontalMode:'none' stops
  // the fighter on entry and holds them in place for the duration.
  //
  // respectPlatforms: true follows the discipline anticipated in
  // calileiGame.md §10 — attack states shouldn't be droppable through
  // platforms. A player holding stickY > 0 during the jab won't fall
  // through a platform mid-swing.
  //
  // Phase 12a.2.5: duration and hitboxes migrated to character config.
  // See fighterA.attacks.LightNeutralGround for the tuning values.
  LightNeutralGround: {
    name: 'LightNeutralGround',
    physics: {
      gravity: 1.0,
      friction: 1.0,
      horizontalMode: 'none',
      respectPlatforms: true,
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      // notGrounded first — defensive. A stationary jab shouldn't be
      // able to walk off, but if some future source state hands us a
      // mid-air entry, fall instead of attacking in the air.
      { when: 'notGrounded',     to: 'Fall' },
      { when: 'durationElapsed', to: 'Idle' },
    ],
    render: { color: '#ffaa66' },
  },

  // Phase 12a.2: LightSideGround. Forward tilt (f-tilt). Entered via
  // `lightAttackPressedSide` from grounded source states.
  //
  // The entry transition fires `commitFacingFromLightAttackPress` to
  // pivot the fighter toward the press-frame stick direction. Walking
  // right + pressing left+A pivots to face left and tilts left. This
  // matches keyboard player intent (the stick IS the intended attack
  // direction) and prepares the substrate for c-stick on controllers,
  // where directional attacks are always facing-committing.
  //
  // Phase 12a.2.5: duration and hitboxes migrated to character config.
  // See fighterA.attacks.LightSideGround for the tuning values.
  LightSideGround: {
    name: 'LightSideGround',
    physics: {
      gravity: 1.0,
      friction: 1.0,
      horizontalMode: 'none',
      respectPlatforms: true,
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'notGrounded',     to: 'Fall' },
      { when: 'durationElapsed', to: 'Idle' },
    ],
    render: { color: '#ff9966' },
  },

  // Phase 12a.2: LightUpGround. Upward tilt (u-tilt). Vertical hitbox
  // above the fighter — classic combo starter in fighter design. Steeper
  // launch angle means hits send the opponent up rather than away,
  // setting up follow-up aerials.
  //
  // No facing-commit effect: the hitbox is roughly symmetric above the
  // fighter. A small forward bias (shape.x slightly positive in the
  // character config) is mirrored by facing at the consult site.
  //
  // Phase 12a.2.5: duration and hitboxes migrated to character config.
  // See fighterA.attacks.LightUpGround for the tuning values.
  LightUpGround: {
    name: 'LightUpGround',
    physics: {
      gravity: 1.0,
      friction: 1.0,
      horizontalMode: 'none',
      respectPlatforms: true,
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'notGrounded',     to: 'Fall' },
      { when: 'durationElapsed', to: 'Idle' },
    ],
    render: { color: '#ffbb55' },
  },

  // Phase 12a.2: LightDownGround. Downward tilt (d-tilt). Low, forward
  // hitbox along the ground — classic combo extender, beats most rolls,
  // shallow launch angle that's hard to escape.
  //
  // No facing-commit effect (same reasoning as up-tilt — the hitbox
  // direction is encoded by the state's shape, which is mirrored by
  // facing). The player's facing on entry determines which side the
  // hitbox extends.
  //
  // Phase 12a.2.5: duration and hitboxes migrated to character config.
  // See fighterA.attacks.LightDownGround for the tuning values.
  LightDownGround: {
    name: 'LightDownGround',
    physics: {
      gravity: 1.0,
      friction: 1.0,
      horizontalMode: 'none',
      respectPlatforms: true,
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'notGrounded',     to: 'Fall' },
      { when: 'durationElapsed', to: 'Idle' },
    ],
    render: { color: '#cc8855' },
  },

  // Phase 12a.3: DashAttack. The forward attack performed out of
  // Dash, Run, or DashBack. Single state for all three sources — same
  // move regardless of which dashing state preceded it (Melee-style).
  //
  // Momentum-preserving physics: friction:1.0 + horizontalMode:'none'
  // is the same brake-and-slide primitive Land uses. Incoming vx (set
  // by the previous dash state's 'dash' mode as facing * dashSpeed) is
  // preserved on entry and bleeds off via friction across the duration.
  // The fighter slides forward through the attack with momentum
  // decaying — the wavedash substrate generalized to attacks.
  //
  // No pivot effect needed. The engine's facing-commit discipline
  // ensures facing and motion direction always agree in dash states:
  // 'dash' horizontalMode sets vx = facing * dashSpeed, and
  // commitFacingFromSlam fires on every Dash and DashBack entry. So at
  // DashAttack entry from any of the three source states, vx and
  // facing have matching signs and the attack hitbox extends in the
  // motion direction. (If a future mechanic decouples facing from
  // motion — moonwalking, reverse-aerial-rush, etc. — a pivot effect
  // can be added at that point.)
  //
  // Directional variants intentionally absent. Pressing A while
  // dashing always produces DashAttack, regardless of stick direction.
  // This is Melee-canonical: dash attack consumes the input without
  // letting the stick route it to a tilt. Up/Down/Side conditions
  // simply aren't listed in Dash/Run/DashBack — the catch-all
  // lightAttackPressed handles all four directional intents.
  //
  // Duration and hitboxes live in character config. See
  // fighterA.attacks.DashAttack for the tuning values.
  DashAttack: {
    name: 'DashAttack',
    physics: {
      gravity: 1.0,
      friction: 1.0,
      horizontalMode: 'none',
      respectPlatforms: true,
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      // notGrounded handles edge-cancel naturally — sliding off the
      // edge of a platform during DashAttack's recovery routes to
      // Fall, which is the Melee-canonical edge-cancel behavior.
      { when: 'notGrounded',     to: 'Fall' },
      { when: 'durationElapsed', to: 'Idle' },
    ],
    render: { color: '#ff7733' },
  },

  // Phase 12a.4: aerial attack family. Five states — neutral, forward,
  // back, up, down. All share the same physics shape; only hitbox
  // geometry varies between them (and that lives in character config).
  //
  // Shared physics design:
  //   gravity: 1.0           — gravity continues during aerial
  //   friction: 0            — no horizontal damping
  //   horizontalMode: 'air'  — air-drift via stickX still works (DI)
  //   fallSpeedMax: 9.0      — matches FastFall cap so fast-fall speed
  //                            is preserved on entry from FastFall.
  //                            Also lets normal-fall aerials gain a
  //                            heavier sink-feel via continued gravity.
  //   respectPlatforms: true — attack states don't drop through
  //                            platforms mid-swing.
  //
  // Shared transitions: grounded → Land (cuts the aerial short on
  // touchdown — landing-lag substrate deferred to a future phase),
  // durationElapsed → Fall (attack finishes in the air, normal fall
  // resumes; vy clamps to Fall's 6.0 cap on exit which is a small
  // discontinuity for fast-falling exits but acceptable).
  //
  // Intentional omissions (committed aerial — Melee-canonical):
  //   - No canAirJump cancel: aerials commit, no air-jumping out
  //   - No canAirDodge cancel: aerials commit, no dodging out
  //   - No fastFallTriggered cancel: same reason
  //   - No attack chaining: no transitions to other attack states
  //
  // The hitbox-direction strategy: F-air encodes shape.x positive
  // (forward), B-air encodes shape.x negative (backward). Both mirrored
  // by facing at the consult site. No facing-commit effect needed —
  // unlike ground side-tilt which pivots the fighter, aerial F-air and
  // B-air are TWO DIFFERENT MOVES with their hitboxes on opposite sides.
  // Facing stays put; the state itself encodes the direction.
  //
  // Duration and hitboxes live in character config — see fighterA.attacks.

  LightNeutralAir: {
    name: 'LightNeutralAir',
    physics: {
      gravity: 1.0,
      friction: 0,
      horizontalMode: 'air',
      fallSpeedMax: 9.0,
      respectPlatforms: true,
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'grounded',        to: 'Land', effect: 'resetAirActions' },
      { when: 'durationElapsed', to: 'Fall' },
    ],
    render: { color: '#ddbb55' },
  },

  LightForwardAir: {
    name: 'LightForwardAir',
    physics: {
      gravity: 1.0,
      friction: 0,
      horizontalMode: 'air',
      fallSpeedMax: 9.0,
      respectPlatforms: true,
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'grounded',        to: 'Land', effect: 'resetAirActions' },
      { when: 'durationElapsed', to: 'Fall' },
    ],
    render: { color: '#ccaa44' },
  },

  LightBackAir: {
    name: 'LightBackAir',
    physics: {
      gravity: 1.0,
      friction: 0,
      horizontalMode: 'air',
      fallSpeedMax: 9.0,
      respectPlatforms: true,
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'grounded',        to: 'Land', effect: 'resetAirActions' },
      { when: 'durationElapsed', to: 'Fall' },
    ],
    render: { color: '#aa8844' },
  },

  LightUpAir: {
    name: 'LightUpAir',
    physics: {
      gravity: 1.0,
      friction: 0,
      horizontalMode: 'air',
      fallSpeedMax: 9.0,
      respectPlatforms: true,
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'grounded',        to: 'Land', effect: 'resetAirActions' },
      { when: 'durationElapsed', to: 'Fall' },
    ],
    render: { color: '#eecc66' },
  },

  LightDownAir: {
    name: 'LightDownAir',
    physics: {
      gravity: 1.0,
      friction: 0,
      horizontalMode: 'air',
      fallSpeedMax: 9.0,
      respectPlatforms: true,
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'grounded',        to: 'Land', effect: 'resetAirActions' },
      { when: 'durationElapsed', to: 'Fall' },
    ],
    render: { color: '#bb9955' },
  },

  // Phase 13 step 4: Hitstun. The destination of the universal
  // hitTaken transition.
  //
  // Phase 13 step 5: duration is now dynamic. The state's `duration`
  // field is removed; the exit condition becomes `hitstunFinished`,
  // which reads `fighter.pendingHitstunFrames` (written by
  // applyHitReaction from hit.hitstun). Each attack's authored
  // hitstun value drives how long the launched fighter spends
  // uncontrollable. Re-hits during Hitstun are handled by the
  // hitTaken self-transition: the new hit's hitstun value overwrites
  // pendingHitstunFrames and stateFrame is reset to 0 by the state
  // machine's transition logic, restarting the timer fresh.
  //
  // Physics: gravity 1.0 so launched fighters arc realistically.
  // friction 0.5 so horizontal launch persists (less stopping than
  // normal grounded states). horizontalMode 'none' so the player
  // can't drift mid-hitstun — the launch carries them where the
  // attacker put them. respectPlatforms: false matches Melee's
  // behavior of being knocked through one-way platforms when
  // hitstunned. No fallSpeedMax, so spike velocity isn't clamped
  // during hitstun — the launched fighter spends the full hitstun
  // window at full knockback velocity, then enters Fall (which DOES
  // cap at fallSpeedMax). The Fall cap is the boundary at which a
  // future Tumble state would take over for uncapped post-hitstun
  // motion (Phase 14+ refinement).
  Hitstun: {
    name: 'Hitstun',
    physics: {
      gravity:          1.0,
      friction:         0.5,
      horizontalMode:   'none',
      respectPlatforms: false,
    },
    transitions: [
      { when: 'hitTaken', to: 'Hitstun', effect: 'applyHitReaction' },
      { when: 'hitstunFinished', to: 'Fall' },
    ],
    render: { color: '#ff6060' },
  },
};