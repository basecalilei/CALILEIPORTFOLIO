// history.js — Frame-by-frame history panel (right side of canvas).
//
// Press-to-record model: pressing the record key starts a 20-frame
// capture. While capturing, each frame's world state is pushed onto
// overlayState.recordedHistory. When the capture is complete, the
// panel shows the frozen 20 frames for inspection at leisure.
//
// Pressing the record key again discards the current capture and
// starts a fresh one. The recording survives overlay-toggle off and
// on, so the workflow "record → hide overlay to play → reshow to
// inspect" works.

import {
  overlayState,
  HISTORY_FRAMES,
} from './overlayState.js';
import { fmt1, signed, bit } from './format.js';

const PANEL_X = 470;
const PANEL_Y = 8;
const PADDING = 6;
const ROW_HEIGHT = 10;
const HEADER_GAP = 4;
const STATUS_GAP = 4;
const FONT = '8px monospace';
const HEADER_FONT = '9px monospace';
const STATUS_FONT = '10px monospace';
const TEXT_COLOR = '#cfcfcf';
const NEWEST_COLOR = '#ffd060';
const HEADER_COLOR = '#9090a0';
const RECORDING_COLOR = '#ff6060';
const READY_COLOR = '#60c060';
const HINT_COLOR = '#888888';
const BG_COLOR = 'rgba(0, 0, 0, 0.75)';
const BORDER_COLOR = 'rgba(255, 255, 255, 0.15)';

// Column header (and the format for each row mirrors this layout).
const HEADER =
  'F     ST          sF  X      Y      VX    VY    G F  AJ ' +
  ' Sx Sy Cx Cy J L H Ls Hs Gr Sh';

// Called every frame from the overlay entry point. If a recording is
// active, captures the current frame's snapshot and advances progress.
// Otherwise, no-op.
export function recordFrameIfRecording(world) {
  if (!overlayState.isRecording) return;

  // fighters[0] is the human-controlled fighter — the diagnostic target.
  // The history panel records one fighter's frame-by-frame trace; the
  // human's fighter is the one whose inputs and reactions matter for
  // debugging. The Phase 13 dummy in fighters[1] sits in Idle with
  // neutral input and produces no interesting history of its own. When
  // a "tracked fighter" selector arrives (likely Phase 14c, when both
  // slots hold real fighters), this becomes overlayState.trackedFighter
  // or similar — the rest of this file is already fighter-agnostic.
  const fighter = world.fighters[0];
  if (!fighter) return;

  const now = fighter.inputBuffer[0];
  const entry = {
    frame: world.frame,
    state: fighter.actionState,
    sf: fighter.stateFrame,
    x: fighter.x,
    y: fighter.y,
    vx: fighter.vx,
    vy: fighter.vy,
    g: fighter.grounded,
    f: fighter.facing,
    aj: fighter.airJumpsUsed,
    ajm: fighter.config.physics.maxAirJumps,
    sx: now ? now.stickX : 0,
    sy: now ? now.stickY : 0,
    cx: now ? now.cStickX : 0,
    cy: now ? now.cStickY : 0,
    j: now ? now.jump : false,
    la: now ? now.lightattack : false,
    ha: now ? now.heavyattack : false,
    ls: now ? now.lightspecial : false,
    hs: now ? now.heavyspecial : false,
    gr: now ? now.grab : false,
    sh: now ? now.shield : false,
  };

  overlayState.recordedHistory.unshift(entry);
  overlayState.recordingProgress += 1;

  if (overlayState.recordingProgress >= HISTORY_FRAMES) {
    overlayState.isRecording = false;
  }
}

export function drawHistoryPanel(ctx) {
  const rows = overlayState.recordedHistory.map(formatRow);
  const status = buildStatusLine();

  ctx.save();
  ctx.textBaseline = 'top';

  // Measure to size the panel — header sets the width even when empty.
  ctx.font = HEADER_FONT;
  const headerW = ctx.measureText(HEADER).width;

  ctx.font = FONT;
  let maxRowW = headerW;
  for (const r of rows) {
    const w = ctx.measureText(r).width;
    if (w > maxRowW) maxRowW = w;
  }

  const panelW = Math.ceil(maxRowW) + PADDING * 2;
  // Height: padding + status + gap + header + gap + (rows or hint line)
  const contentRows = Math.max(rows.length, 1);
  const panelH =
    PADDING * 2 +
    ROW_HEIGHT + STATUS_GAP +    // status line
    ROW_HEIGHT + HEADER_GAP +    // header
    contentRows * ROW_HEIGHT;

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(PANEL_X, PANEL_Y, panelW, panelH);
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 1;
  ctx.strokeRect(PANEL_X + 0.5, PANEL_Y + 0.5, panelW - 1, panelH - 1);

  // Status line at top
  ctx.font = STATUS_FONT;
  ctx.fillStyle = status.color;
  ctx.fillText(status.text, PANEL_X + PADDING, PANEL_Y + PADDING);

  // Header below status
  ctx.font = HEADER_FONT;
  ctx.fillStyle = HEADER_COLOR;
  ctx.fillText(
    HEADER,
    PANEL_X + PADDING,
    PANEL_Y + PADDING + ROW_HEIGHT + STATUS_GAP,
  );

  // Rows (or empty-state hint)
  ctx.font = FONT;
  const rowsTopY =
    PANEL_Y + PADDING + ROW_HEIGHT + STATUS_GAP + ROW_HEIGHT + HEADER_GAP;

  if (rows.length === 0) {
    ctx.fillStyle = HINT_COLOR;
    ctx.fillText(
      '(no recording yet — press \\ to capture 20 frames)',
      PANEL_X + PADDING,
      rowsTopY,
    );
  } else {
    for (let i = 0; i < rows.length; i++) {
      // Newest entry (most recent of the capture) gets the accent color.
      ctx.fillStyle = i === 0 ? NEWEST_COLOR : TEXT_COLOR;
      ctx.fillText(rows[i], PANEL_X + PADDING, rowsTopY + i * ROW_HEIGHT);
    }
  }

  ctx.restore();
}

// Compose the status line: shows current recording state.
function buildStatusLine() {
  if (overlayState.isRecording) {
    return {
      text:
        `● RECORDING  ${overlayState.recordingProgress}/${HISTORY_FRAMES}` +
        `  (from frame ${overlayState.recordingCapturedAt})`,
      color: RECORDING_COLOR,
    };
  }
  if (overlayState.recordedHistory.length > 0) {
    return {
      text:
        `✓ captured ${overlayState.recordedHistory.length} frames` +
        ` (from frame ${overlayState.recordingCapturedAt})` +
        `   — press \\ to recapture`,
      color: READY_COLOR,
    };
  }
  return {
    text: 'HISTORY  (press \\ to record 20 frames)',
    color: HINT_COLOR,
  };
}

function formatRow(e) {
  return (
    String(e.frame).padStart(5, ' ') + ' ' +
    e.state.padEnd(10, ' ') + '  ' +
    String(e.sf).padStart(2, ' ') + ' ' +
    fmt1(e.x, 6) + ' ' +
    fmt1(e.y, 6) + ' ' +
    fmt1(e.vx, 5) + ' ' +
    fmt1(e.vy, 5) + ' ' +
    (e.g ? 'Y' : '.') + ' ' +
    (e.f > 0 ? 'R' : 'L') + '  ' +
    e.aj + '/' + e.ajm + ' ' +
    signed(e.sx) + ' ' + signed(e.sy) + ' ' +
    signed(e.cx) + ' ' + signed(e.cy) + ' ' +
    bit(e.j) + ' ' + bit(e.la) + ' ' + bit(e.ha) + ' ' +
    bit(e.ls) + ' ' + bit(e.hs) + ' ' + bit(e.gr) + ' ' +
    bit(e.sh)
  );
}
