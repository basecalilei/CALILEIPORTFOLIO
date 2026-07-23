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
//
// Hitboxes: drawn here, always, for every fighter. Promoted from the
// debug layer — until production attack animations exist, the active
// hitbox IS the attack's visual, so it belongs to production rendering,
// not behind the overlay toggle. Hurtboxes (defensive geometry) remain
// diagnostic and stay on the debug layer.
//
// Controls display: two on-screen key clusters (top-left: Z/X/Space,
// top-right: arrows) drawn as outlined keycaps that fill with a brand
// color while held — see THE BRAND PALETTE below for which and why.
// Pressed-state comes from fighters[0].inputBuffer[0] — the World —
// NOT from input/keyboard.js. Two reasons, both load-bearing: the
// renderer reads only the World, and keyboard.js is standalone-only
// (the embed never loads it — reading it here would leave the display
// dead in the site build). Reading the buffer means the display shows
// what the simulation actually received, in both composition roots,
// for free.

const BACKGROUND_COLOR = '#f5f5f5';   // very light grey, almost white
const SOLID_FILL = '#e5e6e6';         // stage block — lightly darker than bg
const SOLID_STROKE = '#3a3a3a';       // dark grey outline, not quite black
const PLATFORM_COLOR = '#3a3a3a';     // soft platforms — same dark ink
const PLATFORM_WIDTH = 1;             // unchanged

// --- The brand palette ----------------------------------------------------
//
// Four primaries, each carrying one meaning across every surface that
// draws: the fighter body (state colors live in states.js — see THE
// STATE PALETTE in its header), the hitbox, and the controls HUD.
//
//   green  #00d150   grounded
//   blue   #00b8e6   airborne
//   yellow #ffbb00   attacking
//   red    #ff4d00   harm — the hitbox, and Hitstun on the body
//
// The HUD follows from that with one rule: a key lights in the color of
// the states it produces. Press SPACE, the fighter turns blue and so
// does the key. Shield has no state until Phase 16, so its key lights
// ink-dim — when Shield ships, it gets a color like the others.
const BRAND_GREEN = '#00d150';
const BRAND_BLUE = '#00b8e6';
const BRAND_YELLOW = '#ffbb00';
const BRAND_RED = '#ff4d00';

// --- Hitbox styling -------------------------------------------------------
// Brand red at overlay alphas. Same hue as Hitstun's body color, so the
// box and the reaction it causes read as one event.
const HITBOX_FILL    = 'rgba(255, 77, 0, 0.28)';
const HITBOX_OUTLINE = 'rgba(255, 77, 0, 0.90)';
const HITBOX_LINE_WIDTH = 1.5;

// --- Controls display tuning ---------------------------------------------
const KEY_SIZE = 30;                  // square keycap side
const KEY_GAP = 6;                    // gap between caps
const KEY_STEP = KEY_SIZE + KEY_GAP;  // stride from one cap to the next
const SPACE_WIDTH = 64;              // the spacebar cap is wide
const KEY_RADIUS = 5;                 // keycap corner rounding
const KEY_MARGIN = 14;                // inset from the canvas edges
const CONTROLS_INK = '#3a3a3a';       // outline + glyph, unpressed
const CONTROLS_INK_DIM = '#9a9a9a';   // fill for a key with no state yet
const CAPTION_COLOR = '#9a9a9a';      // the small function labels
const KEY_FONT = '600 13px monospace';
const CAPTION_FONT = '9px monospace';

export function render(world, ctx) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, width, height);

  drawStage(world.stage, ctx);
  for (const fighter of world.fighters) {
    drawFighter(fighter, ctx, world.states);
  }
  // Hitboxes draw over fighter bodies (an attack extends beyond the
  // body); the controls HUD draws last, over everything.
  drawHitboxes(world, ctx);
  drawControls(world, ctx);
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

// --- Hitboxes -------------------------------------------------------------
//
// Reads fighter.config.attacks[fighter.actionState].hitboxes for each
// fighter, checks each hitbox's `active` window against fighter.stateFrame,
// and draws the world-space rectangle of every currently-active hitbox.
// If a fighter is in an attack state with no matching entry in their
// attacks table, no hitbox renders — surfacing the data gap visually.
//
// World-space drawing: hitbox coordinates are offsets from the fighter's
// position. shape.x is mirrored by fighter.facing so authoring data is
// symmetric ("30 in front" regardless of direction). shape.y is added
// directly (Y-down — negative is up). The hitbox extends w/2 on each
// side of its center horizontally, h/2 above and below vertically.

function drawHitboxes(world, ctx) {
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

// --- Controls display ----------------------------------------------------
//
// Reflects fighters[0] (the human — same diagnostic-target convention as
// the debug layer). The dummy's NEUTRAL_SNAPSHOT never lights anything.
//
// Key labels name the standalone keyboard mapping (keyboard.js). The
// site's buildSnapshot maps the same physical keys to the same contract
// fields; if that ever diverges, these labels are what to revisit.
//
// Note on X: it maps to `shield` in the snapshot contract, which no state
// consumes until Phase 16. The cap still lights while held — correct, it
// shows the input reaching the simulation — it just does nothing yet.
//
// Note on the arrows: they read the stick fields, not raw keys. Holding
// left+right together lights neither, because the game sees stickX 0.
// The display is a window into the simulation's input, not the OS's.

function drawControls(world, ctx) {
  const fighter = world.fighters[0];
  if (!fighter) return;

  // Empty object before the first tick has pushed a snapshot: every field
  // reads undefined → falsy → nothing lit. Same for any future field.
  const snap = fighter.inputBuffer[0] || {};
  const { width } = ctx.canvas;

  ctx.save();
  ctx.lineWidth = 1;
  ctx.textAlign = 'center';

  // Top-left cluster: Z, X, Space with function captions. Each fill is
  // the color of the states that key produces — attacks yellow, jump
  // blue, shield dim until Phase 16 gives it a state.
  const lx = KEY_MARGIN;
  const ly = KEY_MARGIN;
  drawLetterKey(ctx, lx, ly, KEY_SIZE, 'Z', !!snap.lightattack, BRAND_YELLOW);
  drawLetterKey(ctx, lx + KEY_STEP, ly, KEY_SIZE, 'X', !!snap.shield, CONTROLS_INK_DIM);
  drawLetterKey(ctx, lx + KEY_STEP * 2, ly, SPACE_WIDTH, 'SPACE', !!snap.jump, BRAND_BLUE);
  drawCaption(ctx, lx + KEY_SIZE / 2, ly, 'attack');
  drawCaption(ctx, lx + KEY_STEP + KEY_SIZE / 2, ly, 'shield');
  drawCaption(ctx, lx + KEY_STEP * 2 + SPACE_WIDTH / 2, ly, 'jump');

  // Top-right cluster: arrows in the classic inverted-T, one caption.
  // Green — the stick's states are the grounded movement family. (Up is
  // green too, though it feeds nothing today; jump is on SPACE.)
  const clusterW = KEY_SIZE * 3 + KEY_GAP * 2;
  const rx = width - KEY_MARGIN - clusterW;
  const ry = KEY_MARGIN;
  drawArrowKey(ctx, rx + KEY_STEP, ry, 0, -1, snap.stickY < 0, BRAND_GREEN);            // up
  drawArrowKey(ctx, rx, ry + KEY_STEP, -1, 0, snap.stickX < 0, BRAND_GREEN);            // left
  drawArrowKey(ctx, rx + KEY_STEP, ry + KEY_STEP, 0, 1, snap.stickY > 0, BRAND_GREEN);  // down
  drawArrowKey(ctx, rx + KEY_STEP * 2, ry + KEY_STEP, 1, 0, snap.stickX > 0, BRAND_GREEN); // right
  drawCaption(ctx, rx + clusterW / 2, ry + KEY_STEP, 'move');

  ctx.restore();
}

// One keycap: outlined rounded rect, filled while pressed. Returns the
// glyph color so callers draw their glyph with the right contrast.
function drawKeyCap(ctx, x, y, w, pressed, pressedFill) {
  traceRoundedRect(ctx, x + 0.5, y + 0.5, w - 1, KEY_SIZE - 1, KEY_RADIUS);
  if (pressed) {
    ctx.fillStyle = pressedFill;
    ctx.fill();
  }
  ctx.strokeStyle = CONTROLS_INK;
  ctx.stroke();
  return pressed ? BACKGROUND_COLOR : CONTROLS_INK;
}

function drawLetterKey(ctx, x, y, w, label, pressed, pressedFill) {
  const glyphColor = drawKeyCap(ctx, x, y, w, pressed, pressedFill);
  ctx.fillStyle = glyphColor;
  ctx.font = label.length > 1 ? CAPTION_FONT : KEY_FONT;
  ctx.textBaseline = 'middle';
  // +1: optical centering — monospace glyphs sit slightly high of the
  // 'middle' baseline at these sizes.
  ctx.fillText(label, x + w / 2, y + KEY_SIZE / 2 + 1);
}

function drawArrowKey(ctx, x, y, dirX, dirY, pressed, pressedFill) {
  const glyphColor = drawKeyCap(ctx, x, y, KEY_SIZE, pressed, pressedFill);
  const cx = x + KEY_SIZE / 2;
  const cy = y + KEY_SIZE / 2;
  // Triangle pointing along (dirX, dirY): tip ahead of center, base
  // corners behind it along the perpendicular (-dirY, dirX).
  const tip = 5.5;
  const back = 3.5;
  const half = 4.5;
  ctx.fillStyle = glyphColor;
  ctx.beginPath();
  ctx.moveTo(cx + dirX * tip, cy + dirY * tip);
  ctx.lineTo(cx - dirX * back - dirY * half, cy - dirY * back + dirX * half);
  ctx.lineTo(cx - dirX * back + dirY * half, cy - dirY * back - dirX * half);
  ctx.closePath();
  ctx.fill();
}

// Small function label under a cap. capTopY is the cap's y; the caption
// hangs a fixed distance below the cap's bottom edge.
function drawCaption(ctx, centerX, capTopY, text) {
  ctx.fillStyle = CAPTION_COLOR;
  ctx.font = CAPTION_FONT;
  ctx.textBaseline = 'top';
  ctx.fillText(text, centerX, capTopY + KEY_SIZE + 6);
}

// Hand-rolled rounded-rect path (rather than ctx.roundRect) so the
// renderer has zero dependence on newer canvas API surface.
function traceRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
