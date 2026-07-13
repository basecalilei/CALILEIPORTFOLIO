// fighterA.js — Character configuration as pure data.
//
// Stats only. No code, no functions, no imports. This file is what you
// edit to balance a character. The engine is the interpreter; this is
// the input.
//
//   walkSpeed      1.6  px/frame   — crosses main solid (600px) in ~3s
//   jumpForce      8.0  px/frame   — initial upward vy at jump
//   airAccel       0.1  px/frame²  — air drift acceleration
//   airSpeedMax    2.0  px/frame   — cap on horizontal air speed via drift
//   gravity        0.4  px/frame²  — applied each airborne frame
//   friction       0.1  px/frame²  — applied each grounded frame
//   maxAirJumps    1               — air jumps before landing
//   airJumpForce   8.0  px/frame   — vy snapped to this on each air jump
//   dashSpeed      2.8  px/frame   — committed ground burst
//   fastFallSpeed  9.0  px/frame   — vy snapped to this on fast-fall trigger
//   maxAirDodges   1               — air dodges before landing  (Phase 11)
//   airDodgeSpeed  5.0  px/frame   — velocity magnitude on dodge (Phase 11)
//
// Note: fall-speed CAPS (terminal velocity for normal Fall, etc.) live
// in the state data as `state.physics.fallSpeedMax`. Different states
// have different caps (Fall caps at 6, FastFall holds 9). The character
// declares the per-character fast-fall TARGET speed; states declare
// the caps and gravity scaling.
//
// Phase 11 note: airDodgeSpeed is the magnitude of the velocity vector
// applied at dodge entry. With a normalized stick direction × this speed,
// cardinals and diagonals both produce the same total magnitude. Tuning
// this number changes wavedash slide distance noticeably — at 5.0,
// horizontal wavedashes slide ~60-65px on the main floor before stopping.
//
// Phase 12a.2.5 note: `attacks` table added. Per-state attack tunables
// (duration, hitboxes, damage, knockback) live on the character config
// rather than on state-data because they vary per character. State data
// describes the universal action shape (LightNeutralGround = "stationary
// grounded swing"); character data describes how THIS fighter performs
// it (timing, hitbox geometry, damage, knockback parameters).
//
// Each `attacks[stateName]` entry has:
//   duration  — total frames before durationElapsed exits to Idle
//   hitboxes  — array of hitbox descriptors. Field meanings documented
//               in states.js header (active, shape, damage, angle,
//               baseKnockback, knockbackGrowth, hitstun).
//
// If a character lacks a corresponding entry for an attack state they
// can reach, that state will hang at undefined duration. This is
// intentional — characters must author their attack data. The bug
// surfaces immediately on first press, which is the development
// feedback loop we want.

export const fighterA = {
  name: 'Fighter A',
  body: {
    width: 30,
    height: 60,
  },
  physics: {
    gravity:       0.4,
    friction:      0.1,
    walkSpeed:     1.6,
    jumpForce:     11.0,
    airAccel:      0.1,
    airSpeedMax:   2.0,
    maxAirJumps:   1,
    airJumpForce:  8.0,
    dashSpeed:     4.8,
    fastFallSpeed: 9.0,
    maxAirDodges:  5,    // Phase 11
    airDodgeSpeed: 8.0,  // Phase 11
    weight:        100,  // Phase 13 step 4 — knockback formula divisor
  },
  color: '#dd5555',

  // Phase 13 (step 2): hurtboxes — the defensive geometry that step 3's
  // hit detection will resolve against attacker hitboxes. Lives here on
  // character config (not state data) because hurtbox size and position
  // are per-character: fighterA's body is 30×60, a heavier fighter would
  // be much larger, and that scales every state's hurtbox.
  //
  // Shape:
  //   hurtboxes: {
  //     default:     [{ shape: {x, y, w, h} }, ...],   <- fallback for
  //                                                       any state not
  //                                                       explicitly
  //                                                       listed below
  //     <stateName>: [{ shape: {x, y, w, h} }, ...],   <- per-state
  //                                                       override
  //   }
  //
  // Lookup is `hurtboxes[actionState] ?? hurtboxes.default`. Most states
  // fall through to default. Only states that need different geometry
  // (Squat compresses; future attack states might extend a limb's
  // hurtbox forward) author their own entry.
  //
  // Per-entry `shape` is center-anchored — (x, y) is the offset from
  // the fighter's bottom-center anchor to the box center; w and h are
  // full extents. shape.x is mirrored by fighter.facing at the consult
  // site so author data is symmetric (positive x is "forward"
  // regardless of which direction the fighter is facing). This is the
  // same convention as hitboxes.
  //
  // Forward-compat: the list-of-entries shape is what supports per-limb
  // hurtboxes later — arm, leg, head, body as separate entries on the
  // same state, each independently positioned. Active windows
  // (`active: [first, last]` per entry) can be added later for phased
  // hurtboxes where a limb only extends partway through a state. Today
  // every entry is treated as active for the whole state.
  //
  // Intangibility — "this fighter is unhittable right now" — is
  // expressed via the existing state-level flag `state.physics
  // .intangible === true`, NOT by an empty hurtbox list. Hit detection
  // and the debug viz both skip the victim when that flag is set.
  // Single source of truth.
  hurtboxes: {
    // Covers the body exactly: 30 wide, 60 tall, centered horizontally
    // on the feet anchor, extending upward. y=-30 places the box center
    // 30px above the feet — the body's vertical midpoint — so the box
    // edges land at y-60 (head) and y (feet).
    default: [
      { shape: { x: 0, y: -30, w: 30, h: 60 } },
    ],
    // Squat: shorter and lower. 40 tall (vs 60), still 30 wide. Center
    // at y=-20 (vs -30) so the top edge drops from y-60 to y-40 while
    // the bottom stays at the feet. Visually: the fighter "compresses"
    // downward — head goes down, feet stay planted — which matches
    // what a real crouch does.
    Squat: [
      { shape: { x: 0, y: -20, w: 30, h: 40 } },
    ],
  },

  // Phase 12a.2.5: attack tunables. Keyed by attack-state name. Values
  // were originally authored on state-data and migrated here when the
  // need to support a second character (with different attack feel)
  // forced the question of which data layer they belonged on.
  //
  // Frame budgets follow a startup / active / recovery breakdown — the
  // hitbox `active` window indexes into stateFrame (0-indexed), the
  // `duration` is the total before durationElapsed fires.
  attacks: {
    // Jab. Fast, short reach, low damage. The all-purpose poke.
    // 6 startup + 4 active + 12 recovery = 22 frames.
    LightNeutralGround: {
      duration: 22,
      hitboxes: [
        {
          active:           [6, 9],
          shape:            { x: 35, y: -30, w: 40, h: 25 },
          damage:           4,
          angle:            80,
          baseKnockback:    30,
          knockbackGrowth:  60,
          hitstun:          14,
        },
      ],
    },

    // Forward tilt. Longer reach, more damage, slower than jab.
    // 7 startup + 5 active + 14 recovery = 26 frames.
    LightSideGround: {
      duration: 26,
      hitboxes: [
        {
          active:           [7, 11],
          shape:            { x: 45, y: -25, w: 50, h: 30 },
          damage:           7,
          angle:            361,
          baseKnockback:    40,
          knockbackGrowth:  80,
          hitstun:          18,
        },
      ],
    },

    // Up tilt. Vertical hitbox above head — combo starter. Steeper
    // launch angle (90°) sets up follow-up aerials.
    // 6 startup + 5 active + 13 recovery = 24 frames.
    LightUpGround: {
      duration: 24,
      hitboxes: [
        {
          active:           [6, 10],
          shape:            { x: 5, y: -55, w: 45, h: 35 },
          damage:           6,
          angle:            90,
          baseKnockback:    35,
          knockbackGrowth:  90,
          hitstun:          16,
        },
      ],
    },

    // Down tilt. Low ground-level hitbox — combo extender, shallow
    // launch angle. Fastest of the tilts to start.
    // 5 startup + 4 active + 13 recovery = 22 frames.
    LightDownGround: {
      duration: 22,
      hitboxes: [
        {
          active:           [5, 8],
          shape:            { x: 30, y: -8, w: 50, h: 18 },
          damage:           5,
          angle:            30,
          baseKnockback:    25,
          knockbackGrowth:  70,
          hitstun:          14,
        },
      ],
    },

    // Phase 12a.3: dash attack. Forward-extended hitbox, mid-body
    // height, larger than tilts. The fighter slides forward through
    // the attack as the dash momentum bleeds off via friction (see
    // DashAttack state's physics). Strong knockback at a diagonal
    // launch angle — a Melee-style approach tool.
    //
    // 7 startup + 7 active + 10 recovery = 24 frames.
    DashAttack: {
      duration: 24,
      hitboxes: [
        {
          active:           [7, 13],
          shape:            { x: 40, y: -28, w: 55, h: 35 },
          damage:           9,
          angle:            45,
          baseKnockback:    50,
          knockbackGrowth:  70,
          hitstun:          22,
        },
      ],
    },

    // Phase 12a.4: aerial attacks. Five moves — neutral, forward,
    // back, up, down. F-air and B-air are SEPARATE moves with hitboxes
    // on opposite sides; they don't pivot the fighter. The hitbox's
    // shape.x is negative for B-air, positive for F-air, both mirrored
    // by facing at the consult site.

    // Neutral air ("sex kick"). Long active window with consistent
    // damage. All-around aerial poke. Slight forward bias on the
    // hitbox center.
    // 7 startup + 12 active + 13 recovery = 32 frames.
    LightNeutralAir: {
      duration: 32,
      hitboxes: [
        {
          active:           [7, 18],
          shape:            { x: 5, y: -30, w: 45, h: 40 },
          damage:           7,
          angle:            60,
          baseKnockback:    30,
          knockbackGrowth:  60,
          hitstun:          18,
        },
      ],
    },

    // Forward air. Strong horizontal launcher in facing direction.
    // Higher damage and knockback than tilts — a kill move at higher
    // damage percentages.
    // 8 startup + 5 active + 17 recovery = 30 frames.
    LightForwardAir: {
      duration: 30,
      hitboxes: [
        {
          active:           [8, 12],
          shape:            { x: 40, y: -30, w: 45, h: 30 },
          damage:           10,
          angle:            45,
          baseKnockback:    45,
          knockbackGrowth:  90,
          hitstun:          22,
        },
      ],
    },

    // Back air. Hitbox extends BEHIND the fighter (negative shape.x —
    // mirrored by facing means it appears opposite of facing direction).
    // Strongest knockback of the aerial set — the signature kill move
    // in Melee tradition.
    // 7 startup + 4 active + 17 recovery = 28 frames.
    LightBackAir: {
      duration: 28,
      hitboxes: [
        {
          active:           [7, 10],
          shape:            { x: -35, y: -30, w: 40, h: 30 },
          damage:           11,
          angle:            45,
          baseKnockback:    50,
          knockbackGrowth:  100,
          hitstun:          24,
        },
      ],
    },

    // Up air. Vertical hitbox above the head. Low damage but high
    // vertical knockback growth — combo starter at low %, kill move
    // at very high %. Centered (shape.x: 0) — no forward bias.
    // 6 startup + 5 active + 15 recovery = 26 frames.
    LightUpAir: {
      duration: 26,
      hitboxes: [
        {
          active:           [6, 10],
          shape:            { x: 0, y: -65, w: 50, h: 35 },
          damage:           7,
          angle:            90,
          baseKnockback:    30,
          knockbackGrowth:  100,
          hitstun:          18,
        },
      ],
    },

    // Down air. Downward hitbox below the fighter. Angle 270 (straight
    // down) — a SPIKE. Used to send airborne opponents toward the
    // bottom blast-zone or grounded opponents flat. Long startup
    // matches Melee dair commitment.
    // 9 startup + 6 active + 17 recovery = 32 frames.
    LightDownAir: {
      duration: 32,
      hitboxes: [
        {
          active:           [9, 14],
          shape:            { x: 0, y: 15, w: 40, h: 30 },
          damage:           9,
          angle:            270,
          baseKnockback:    40,
          knockbackGrowth:  80,
          hitstun:          20,
        },
      ],
    },
  },
};