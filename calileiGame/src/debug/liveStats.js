// liveStats.js — The per-frame live stats panel (top-left).
//
// Shows the current frame's full state for each fighter. This is the
// "what's happening right now" panel — for "what just happened in the
// last 20 frames," see history.js.

import { fmt, signed, bit } from './format.js';

const PANEL_X = 8;
const PANEL_Y = 8;
const PADDING = 8;
const LINE_HEIGHT = 14;
const FONT = '11px Glitched';
const TEXT_COLOR = '#e6e6e6';
const ACCENT_COLOR = '#ffd060';
const BG_COLOR = 'rgba(0, 0, 0, 0.65)';
const BORDER_COLOR = 'rgba(255, 255, 255, 0.15)';

export function drawLiveStatsPanel(world, ctx) {
  const lines = buildLines(world);
  drawPanel(ctx, lines);
}

// Returns the bottom Y coordinate of the panel after drawing. The color
// editor uses this to position itself directly below.
export function getLiveStatsBottomY(world) {
  const lines = buildLines(world);
  return PANEL_Y + lines.length * LINE_HEIGHT + PADDING * 2;
}

function buildLines(world) {
  const lines = [];
  lines.push({ text: `frame: ${world.frame}`, accent: true });

  for (let i = 0; i < world.fighters.length; i++) {
    const f = world.fighters[i];
    lines.push(null);
    lines.push({ text: `fighter ${i}: ${f.config.name}`, accent: true });
    lines.push({ text: `  state:   ${f.actionState} (${f.stateFrame})` });
    lines.push({ text: `  pos:     x=${fmt(f.x)}  y=${fmt(f.y)}` });
    lines.push({ text: `  vel:     vx=${fmt(f.vx)} vy=${fmt(f.vy)}` });
    lines.push({
      text:
        `  ground:  ${f.grounded ? 'yes' : 'no '}` +
        `   facing: ${f.facing > 0 ? 'right' : 'left'}`,
    });
    lines.push({
      text:
        `  airjump: ${f.airJumpsUsed}/${f.config.physics.maxAirJumps}`,
    });
    lines.push({
      text: `  damage:  ${f.damage.toFixed(1)}%`,
    });

    const now = f.inputBuffer[0];
    if (now) {
      lines.push({
        text:
          `  sticks:  L=(${signed(now.stickX)},${signed(now.stickY)})` +
          `  R=(${signed(now.cStickX)},${signed(now.cStickY)})`,
      });
      lines.push({
        text:
          `  attack:  jmp=${bit(now.jump)} la=${bit(now.lightattack)}` +
          ` ha=${bit(now.heavyattack)} ls=${bit(now.lightspecial)}` +
          ` hs=${bit(now.heavyspecial)} grb=${bit(now.grab)}`,
      });
      lines.push({
        text:
          `  defense: shd=${bit(now.shield)}` +
          `  depth=${now.shieldDepth.toFixed(2)}`,
      });
    } else {
      lines.push({ text: '  input:   (buffer empty)' });
    }

    // Phase 13 step 3: pendingHit row. When null, displays "—" so the
    // panel height stays stable (no jitter when hits land). When set,
    // shows the attacker's positional index, the damage, angle, base
    // knockback, knockback growth, and hitstun frames — every field
    // that step 4 will consume when computing the hit reaction.
    const p = f.pendingHit;
    const pendingText = p
      ? `F${p.attackerIndex} d=${p.damage} a=${p.angle}` +
        ` bk=${p.baseKnockback} kg=${p.knockbackGrowth} hs=${p.hitstun}`
      : '—';
    lines.push({ text: `  pending: ${pendingText}` });
  }

  return lines;
}

function drawPanel(ctx, lines) {
  ctx.save();
  ctx.font = FONT;
  ctx.textBaseline = 'top';

  let maxWidth = 0;
  for (const line of lines) {
    if (!line) continue;
    const w = ctx.measureText(line.text).width;
    if (w > maxWidth) maxWidth = w;
  }

  const panelW = Math.ceil(maxWidth) + PADDING * 2;
  const panelH = lines.length * LINE_HEIGHT + PADDING * 2;

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(PANEL_X, PANEL_Y, panelW, panelH);
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 1;
  ctx.strokeRect(PANEL_X + 0.5, PANEL_Y + 0.5, panelW - 1, panelH - 1);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    ctx.fillStyle = line.accent ? ACCENT_COLOR : TEXT_COLOR;
    ctx.fillText(
      line.text,
      PANEL_X + PADDING,
      PANEL_Y + PADDING + i * LINE_HEIGHT,
    );
  }

  ctx.restore();
}
