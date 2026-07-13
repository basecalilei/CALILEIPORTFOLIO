// knockback.js — Pure knockback-velocity computation.
//
// computeKnockback(hit, victimDamage, victimWeight) → { vx, vy }
//
// Phase 13 step 4. Translates a pendingHit snapshot plus the victim's
// current percent and weight into a launch velocity. Called from the
// applyHitReaction effect; no side effects, no world reads, no fighter
// reads beyond the inputs.
//
// Formula: Melee-faithful approximation. The KB magnitude calculation
// is the standard Melee form:
//
//   total = victimDamage + moveDamage   (post-hit percent)
//   damageComp = total * 0.1 + total * moveDamage * 0.05
//   weightFactor = 200 / (weight + 100)
//   base = damageComp * weightFactor * 1.4 + 18
//   magnitude = base * (knockbackGrowth / 100) + baseKnockback
//
// magnitude is then multiplied by VELOCITY_SCALE to convert Melee's
// abstract KB units to our pixel/frame velocity units. 0.08 is a
// tuning knob — adjust after feel-testing. Light jab on 0% should
// nudge; up-air on 100% should launch toward the blast zone.
//
// Direction: angle is in degrees, attacker-facing-relative. 0° is
// forward in the attacker's facing, 90° is up, 180° is backward,
// 270° is down. Conversion to world-space velocity:
//
//   vx = magnitude * cos(angle) * attackerFacing
//   vy = -magnitude * sin(angle)         (Y-down: up is negative)
//
// attackerFacing flips vx so an angle-0 hit from a right-facing
// attacker sends the victim right; from a left-facing attacker,
// left. Vertical component is unaffected by facing (up is up).
//
// Sakurai angle (361° in Melee data) is treated as a regular angle
// here — produces near-horizontal launch since cos(361°) ≈ cos(1°).
// Proper Sakurai semantics ("horizontal at low %, vertical at high
// %") is a Phase 14+ refinement.

const VELOCITY_SCALE = 0.08;

export function computeKnockback(hit, victimDamage, victimWeight) {
  const {
    damage:           moveDamage,
    baseKnockback,
    knockbackGrowth,
    angle,
    attackerFacing,
  } = hit;

  const total        = victimDamage + moveDamage;
  const damageComp   = total * 0.1 + total * moveDamage * 0.05;
  const weightFactor = 200 / (victimWeight + 100);
  const base         = damageComp * weightFactor * 1.4 + 18;
  const magnitude    = base * (knockbackGrowth / 100) + baseKnockback;

  const speed   = magnitude * VELOCITY_SCALE;
  const radians = angle * Math.PI / 180;

  return {
    vx: speed * Math.cos(radians) * attackerFacing,
    vy: -speed * Math.sin(radians),
  };
}
