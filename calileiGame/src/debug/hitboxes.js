// hitboxes.js — Debug visualization of active hitboxes.
//
// Reads fighter.config.attacks[fighter.actionState].hitboxes for each
// fighter, checks each hitbox's `active` window against fighter.stateFrame,
// and draws the world-space rectangle of every currently-active hitbox.
//
// Phase 12a.2.5: hitboxes moved from state-data to character-data because
// they're tunable per character (Falcon's jab hitbox != Marth's jab
// hitbox). The state's name identifies which attack; the character's
// attacks table provides the geometry and stats. If a fighter is in an
// attack state with no matching entry in their attacks table, no hitbox
// renders — surfacing the data gap visually.
//
// World-space drawing: hitbox coordinates are offsets from the fighter's
// position. shape.x is mirrored by fighter.facing so authoring data is
// symmetric ("30 in front" regardless of direction). shape.y is added
// directly (Y-down — negative is up). The hitbox extends w/2 on each
// side of its center horizontally, h/2 above and below vertically.
//
// Called from drawOverlay only when the overlay is enabled. Without the
// overlay, attacks are visually invisible — correct, since there are no
// attack animations yet. The hitbox visualization is the developer-
// facing surrogate for animation until production art exists.

const HITBOX_FILL    = 'rgba(255, 60, 60, 0.28)';
const HITBOX_OUTLINE = 'rgba(255, 60, 60, 0.85)';
const HITBOX_LINE_WIDTH = 1.5;

export function drawHitboxes(world, ctx) {
  for (const fighter of world.fighters) {
    const hitboxes = fighter.config.attacks?.[fighter.actionState]?.hitboxes;
    if (!hitboxes) continue;

    for (const hb of hitboxes) {
      if (!isHitboxActive(hb, fighter.stateFrame)) continue;
      drawHitbox(ctx, fighter, hb);
    }
  }
}

// active is [firstFrame, lastFrame] inclusive. stateFrame is 0-indexed
// (0 on entry, increments by 1 each tick the state survives — see
// stateMachine.md §5).
function isHitboxActive(hb, stateFrame) {
  return stateFrame >= hb.active[0] && stateFrame <= hb.active[1];
}

function drawHitbox(ctx, fighter, hb) {
  const centerX = fighter.x + fighter.facing * hb.shape.x;
  const centerY = fighter.y + hb.shape.y;
  const left    = centerX - hb.shape.w / 2;
  const top     = centerY - hb.shape.h / 2;

  ctx.fillStyle   = HITBOX_FILL;
  ctx.strokeStyle = HITBOX_OUTLINE;
  ctx.lineWidth   = HITBOX_LINE_WIDTH;

  ctx.fillRect(left, top, hb.shape.w, hb.shape.h);
  ctx.strokeRect(left, top, hb.shape.w, hb.shape.h);
}