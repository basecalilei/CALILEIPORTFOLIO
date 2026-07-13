// overlay.js — Debug overlay entry point.
//
// Three responsibilities, none of them gameplay:
//
//   1. initOverlayInput(canvas, world) — install the toggle keydown
//      listener and the record-history keydown listener. Separate from
//      the gameplay input pipeline because the overlay is a meta-tool:
//      its inputs don't go through the input buffer and don't affect
//      determinism. (`canvas` is retained in the signature for callers
//      and future canvas-scoped tools, but is currently unused.)
//
//   2. drawOverlay(world, ctx) — called once per render, AFTER the
//      main render. Captures the current frame's snapshot if a
//      recording is active, then draws the visible panels (only when
//      enabled).
//
//   3. Compose the panels: live stats (top-left) and history (right
//      side), with hurtbox/hitbox world-space draws beneath them. Each
//      is a self-contained module; this file just orchestrates them.

import { overlayState, toggleOverlay, startRecording } from './overlayState.js';
import { drawLiveStatsPanel } from './liveStats.js';
import { recordFrameIfRecording, drawHistoryPanel } from './history.js';
import { drawHitboxes } from './hitboxes.js';
import { drawHurtboxes } from './hurtboxes.js';

const TOGGLE_KEY = 'Backquote';   // ` toggles the overlay
const RECORD_KEY = 'Backslash';   // \ starts a 20-frame recording

export function initOverlayInput(canvas, world) {
  // Keyboard handlers for overlay toggle and history record.
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;

    if (e.code === TOGGLE_KEY) {
      toggleOverlay();
      e.preventDefault();
      return;
    }

    if (e.code === RECORD_KEY) {
      // Pressing record always starts a fresh capture. Any in-progress
      // recording is discarded — the press means "begin from here."
      startRecording(world.frame);
      e.preventDefault();
      return;
    }
  });
}

export function drawOverlay(world, ctx) {
  // Capture into the recording buffer if a recording is in progress.
  // This runs regardless of overlay visibility so the user can record,
  // hide the overlay to keep playing, and reshow it later to inspect.
  recordFrameIfRecording(world);

  if (!overlayState.enabled) return;

  // World-space draws first (under the UI panels). Phase 13 step 2:
  // hurtboxes drawn before hitboxes so a landed attack reads as the red
  // hitbox sitting on top of the green hurtbox — active/temporal over
  // always-there.
  drawHurtboxes(world, ctx);
  drawHitboxes(world, ctx);

  drawLiveStatsPanel(world, ctx);
  drawHistoryPanel(ctx);
}