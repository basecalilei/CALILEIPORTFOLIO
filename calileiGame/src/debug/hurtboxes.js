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
// Drawn after the renderer's hitboxes (the renderer draws those
// unconditionally now), so where the two overlap the hurtbox sits on
// top — the inverse of the Phase 13 order. Both stay translucent.
//
// Neutral ink rather than a brand color, deliberately. Green now means
// "grounded" on the fighter body and blue means "airborne"; a green
// hurtbox drawn over a green fighter was unreadable, and every brand
// hue is spoken for (yellow = attacking, red = harm/hitbox). Ink is the
// one channel left that never collides with a state fill, and it suits
// a diagnostic overlay: this box is geometry, not a role.

const HURTBOX_FILL    = 'rgba(58, 58, 58, 0.12)';
const HURTBOX_OUTLINE = 'rgba(58, 58, 58, 0.70)';
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
