// renderer.js — Reads the World, draws to the canvas. Never writes.
//
// The renderer is a pure function of state. It holds no references between
// frames, caches nothing, and never mutates the World. Every frame, the
// canvas is cleared and redrawn entirely from the current World.
//
// Phase 8: stage geometry changed shape. Solids draw as filled rectangles
// (top is landable, all four sides collide). Platforms draw as thin
// lines (one-way landable from above). The visual distinction is
// immediate — the main floor now looks like a solid block extending down
// to the blast zone, not a single line.

const BACKGROUND_COLOR = '#f5f5f5';   // very light grey, almost white
const SOLID_FILL = '#e5e6e6';         // stage block — lightly darker than bg
const SOLID_STROKE = '#3a3a3a';       // dark grey outline, not quite black
const PLATFORM_COLOR = '#3a3a3a';     // soft platforms — same dark ink
const PLATFORM_WIDTH = 1;             // unchanged

export function render(world, ctx) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, width, height);

  drawStage(world.stage, ctx);
  for (const fighter of world.fighters) {
    drawFighter(fighter, ctx, world.states);
  }
}

function drawStage(stage, ctx) {
  // Solids — filled rectangle with a thin outline so the top edge reads
  // as a landable surface against the dark background.
  ctx.fillStyle = SOLID_FILL;
  ctx.strokeStyle = SOLID_STROKE;
  ctx.lineWidth = PLATFORM_WIDTH;
  for (const solid of stage.solids) {
    const w = solid.right - solid.left;
    const h = solid.bottom - solid.top;
    ctx.fillRect(solid.left, solid.top, w, h);
    ctx.strokeRect(solid.left, solid.top, w, h);
  }

  // Soft platforms — thin line, no fill (you can see through them).
  ctx.strokeStyle = PLATFORM_COLOR;
  ctx.lineWidth = PLATFORM_WIDTH;
  for (const platform of stage.platforms) {
    ctx.beginPath();
    ctx.moveTo(platform.x1, platform.y);
    ctx.lineTo(platform.x2, platform.y);
    ctx.stroke();
  }
}

function drawFighter(fighter, ctx, states) {
  const { width: bw, height: bh } = fighter.config.body;
  const state = states[fighter.actionState];
  const color = (state.render && state.render.color) || fighter.config.color;
  ctx.fillStyle = color;
  ctx.fillRect(fighter.x - bw / 2, fighter.y - bh, bw, bh);
}
