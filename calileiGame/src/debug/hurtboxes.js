// hurtboxes.js — Debug visualization of active hurtboxes.
//
// Reads fighter.config.hurtboxes for each fighter, resolves the entry
// list via per-state lookup with a 'default' fallback, and draws the
// world-space rectangle of every entry. Hit detection (Phase 13 step 3)
// will be the second consumer of this same data; until then, this viz
// is the only one.
//
// Phase 13 (step 2): introduced. Also the first real consumer of the
// state-level `physics.intangible` opt-out (Phase 11 placeholder) —
// when a state is marked intangible (AirDodge today), no hurtbox
// renders here, and hit detection will treat the fighter as unhittable.
//
// Lookup precedence per fighter:
//   1. If state.physics.intangible === true → no hurtbox renders.
//   2. Else look up fighter.config.hurtboxes[actionState].
//   3. Else fall back to fighter.config.hurtboxes.default.
//   4. Else (no hurtboxes table on the character at all) draw nothing —
//      the data gap surfaces visually, matching the loud-failure
//      philosophy from Phase 12's attacks-table migration.
//
// World-space drawing mirrors hitbox conventions exactly: hurtbox
// coordinates are offsets from the fighter's bottom-center anchor.
// shape.x is mirrored by fighter.facing so authoring data is symmetric
// (positive x is "forward" regardless of facing direction). shape.y is
// added directly (Y-down — negative is up). The box extends w/2 on
// each side of its center horizontally, h/2 above and below vertically.
//
// Drawn before hitboxes in the overlay so that when an attack lands,
// the red hitbox sits on top of the green hurtbox in the z-order — the
// active/temporal thing draws over the always-there thing.

const HURTBOX_FILL    = 'rgba(80, 220, 80, 0.22)';
const HURTBOX_OUTLINE = 'rgba(80, 220, 80, 0.85)';
const HURTBOX_LINE_WIDTH = 1.5;

export function drawHurtboxes(world, ctx) {
  for (const fighter of world.fighters) {
    const state = world.states[fighter.actionState];
    if (state?.physics?.intangible === true) continue;

    const hurtboxes =
      fighter.config.hurtboxes?.[fighter.actionState]
      ?? fighter.config.hurtboxes?.default;
    if (!hurtboxes) continue;

    for (const hb of hurtboxes) {
      drawHurtbox(ctx, fighter, hb);
    }
  }
}

function drawHurtbox(ctx, fighter, hb) {
  const centerX = fighter.x + fighter.facing * hb.shape.x;
  const centerY = fighter.y + hb.shape.y;
  const left    = centerX - hb.shape.w / 2;
  const top     = centerY - hb.shape.h / 2;

  ctx.fillStyle   = HURTBOX_FILL;
  ctx.strokeStyle = HURTBOX_OUTLINE;
  ctx.lineWidth   = HURTBOX_LINE_WIDTH;

  ctx.fillRect(left, top, hb.shape.w, hb.shape.h);
  ctx.strokeRect(left, top, hb.shape.w, hb.shape.h);
}
