// colorEditor.js — Per-state color authoring panel.
//
// Shows every state defined on the World as a row with a color swatch
// and the current hex value. Clicking a row selects that state for
// editing; an H/S/L slider widget appears below, mutating the state's
// render.color in real time as the user drags.
//
// This is the first piece of the overlay that *mutates* the World
// (specifically, world.states[name].render.color). The mutation is
// intentional and scoped: color affects only the renderer, no game
// logic reads it, so editing it does not break determinism or change
// gameplay. It's the same category of action as the eventual "force
// fighter into state X" dev tool.

import { overlayState } from './overlayState.js';
import { hexToHSL, hslToHex } from './format.js';

const PANEL_X = 8;
const PADDING = 8;
const HEADER_HEIGHT = 14;
const ROW_HEIGHT = 14;
const PANEL_WIDTH = 220;

const SWATCH_W = 14;
const SWATCH_H = 10;
const NAME_X_OFFSET = 24;
const HEX_X_OFFSET = 130;

const FONT = '11px monospace';
const TEXT_COLOR = '#e6e6e6';
const HEADER_COLOR = '#ffd060';
const SELECTED_COLOR = '#ffd060';
const BG_COLOR = 'rgba(0, 0, 0, 0.65)';
const BORDER_COLOR = 'rgba(255, 255, 255, 0.15)';

// Slider geometry.
const SLIDER_PANEL_GAP = 6;        // Gap between state list and sliders
const SLIDER_PANEL_PADDING = 8;
const SLIDER_ROW_HEIGHT = 18;
const SLIDER_LABEL_W = 12;
const SLIDER_TRACK_GAP = 6;        // Between label and track
const SLIDER_TRACK_WIDTH = 140;
const SLIDER_TRACK_HEIGHT = 4;
const SLIDER_VALUE_GAP = 6;        // Between track and value text
const SLIDER_THUMB_RADIUS = 5;
const SLIDER_PANEL_HEIGHT =
  SLIDER_PANEL_PADDING * 2 + SLIDER_ROW_HEIGHT * 4;

const CHANNELS = [
  { key: 'h', label: 'H', max: 360 },
  { key: 's', label: 'S', max: 100 },
  { key: 'l', label: 'L', max: 100 },
];

// Position is computed dynamically from where the live-stats panel ends.
// drawColorEditorPanel takes a `topY` argument from the entry point so
// the two panels stack cleanly even as the live-stats panel resizes.

export function drawColorEditorPanel(world, ctx, topY) {
  const stateNames = Object.keys(world.states);
  const listH = PADDING * 2 + HEADER_HEIGHT + stateNames.length * ROW_HEIGHT;

  ctx.save();
  ctx.font = FONT;
  ctx.textBaseline = 'top';

  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(PANEL_X, topY, PANEL_WIDTH, listH);
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 1;
  ctx.strokeRect(PANEL_X + 0.5, topY + 0.5, PANEL_WIDTH - 1, listH - 1);

  // Header
  ctx.fillStyle = HEADER_COLOR;
  ctx.fillText('COLORS (click to edit)', PANEL_X + PADDING, topY + PADDING);

  // State rows
  for (let i = 0; i < stateNames.length; i++) {
    const name = stateNames[i];
    const state = world.states[name];
    const color = colorOf(state);
    const rowY = topY + PADDING + HEADER_HEIGHT + i * ROW_HEIGHT;
    const isSelected = overlayState.selectedColorState === name;

    // Swatch
    ctx.fillStyle = color;
    ctx.fillRect(PANEL_X + PADDING, rowY + 1, SWATCH_W, SWATCH_H);
    ctx.strokeStyle = isSelected ? SELECTED_COLOR : '#555';
    ctx.strokeRect(
      PANEL_X + PADDING + 0.5,
      rowY + 1.5,
      SWATCH_W - 1,
      SWATCH_H - 1,
    );

    // Name and hex
    ctx.fillStyle = isSelected ? SELECTED_COLOR : TEXT_COLOR;
    ctx.fillText(name, PANEL_X + PADDING + NAME_X_OFFSET, rowY);
    ctx.fillText(color, PANEL_X + PADDING + HEX_X_OFFSET, rowY);
  }

  ctx.restore();

  // Slider panel beneath
  if (overlayState.selectedColorState) {
    drawSliderPanel(world, ctx, topY + listH + SLIDER_PANEL_GAP);
  }
}

function drawSliderPanel(world, ctx, topY) {
  const name = overlayState.selectedColorState;
  const state = world.states[name];
  if (!state) return;

  const color = colorOf(state);
  const hsl = hexToHSL(color);

  ctx.save();
  ctx.font = FONT;
  ctx.textBaseline = 'top';

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(PANEL_X, topY, PANEL_WIDTH, SLIDER_PANEL_HEIGHT);
  ctx.strokeStyle = BORDER_COLOR;
  ctx.strokeRect(
    PANEL_X + 0.5,
    topY + 0.5,
    PANEL_WIDTH - 1,
    SLIDER_PANEL_HEIGHT - 1,
  );

  for (let i = 0; i < CHANNELS.length; i++) {
    const ch = CHANNELS[i];
    const rowY = topY + SLIDER_PANEL_PADDING + i * SLIDER_ROW_HEIGHT;
    drawSlider(ctx, rowY, ch.label, hsl[ch.key], ch.max);
  }

  // Hex display
  const hexY =
    topY + SLIDER_PANEL_PADDING + CHANNELS.length * SLIDER_ROW_HEIGHT;
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(color, PANEL_X + SLIDER_PANEL_PADDING, hexY);

  ctx.restore();
}

function drawSlider(ctx, rowY, label, value, max) {
  const x = PANEL_X + SLIDER_PANEL_PADDING;
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(label, x, rowY);

  const trackX = x + SLIDER_LABEL_W + SLIDER_TRACK_GAP;
  const trackY = rowY + 5;

  // Track
  ctx.fillStyle = '#444';
  ctx.fillRect(trackX, trackY, SLIDER_TRACK_WIDTH, SLIDER_TRACK_HEIGHT);

  // Thumb
  const thumbX = trackX + (value / max) * SLIDER_TRACK_WIDTH;
  const thumbY = trackY + SLIDER_TRACK_HEIGHT / 2;
  ctx.fillStyle = '#cfcfcf';
  ctx.beginPath();
  ctx.arc(thumbX, thumbY, SLIDER_THUMB_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Value text
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(
    String(value),
    trackX + SLIDER_TRACK_WIDTH + SLIDER_VALUE_GAP,
    rowY,
  );
}

// ---- Mouse interaction ----
//
// Click handling needs to know the current layout, which depends on
// where the panel was positioned this frame. The entry point in
// overlay.js passes `topY` (the same value used for drawing) into the
// click handler so hit-test geometry matches exactly.

export function handleColorEditorClick(world, canvasX, canvasY, topY) {
  const stateNames = Object.keys(world.states);

  // State list rows
  for (let i = 0; i < stateNames.length; i++) {
    const rowY = topY + PADDING + HEADER_HEIGHT + i * ROW_HEIGHT;
    if (
      canvasX >= PANEL_X &&
      canvasX <= PANEL_X + PANEL_WIDTH &&
      canvasY >= rowY &&
      canvasY <= rowY + ROW_HEIGHT
    ) {
      overlayState.selectedColorState = stateNames[i];
      return true;
    }
  }

  // Slider thumbs (only if a state is selected)
  if (overlayState.selectedColorState) {
    const listH = PADDING * 2 + HEADER_HEIGHT + stateNames.length * ROW_HEIGHT;
    const sliderTopY = topY + listH + SLIDER_PANEL_GAP;
    const trackX =
      PANEL_X + SLIDER_PANEL_PADDING + SLIDER_LABEL_W + SLIDER_TRACK_GAP;

    for (let i = 0; i < CHANNELS.length; i++) {
      const ch = CHANNELS[i];
      const rowY = sliderTopY + SLIDER_PANEL_PADDING + i * SLIDER_ROW_HEIGHT;
      const trackY = rowY + 5;

      // Allow a slop region above/below the track so the user doesn't
      // have to hit the 4px track exactly.
      if (
        canvasX >= trackX &&
        canvasX <= trackX + SLIDER_TRACK_WIDTH &&
        canvasY >= trackY - 6 &&
        canvasY <= trackY + SLIDER_TRACK_HEIGHT + 6
      ) {
        overlayState.activeSliderDrag = {
          stateName: overlayState.selectedColorState,
          channel: ch.key,
          max: ch.max,
          trackX,
        };
        // Apply immediately so the click position registers without
        // requiring a follow-up mousemove.
        updateColorFromDrag(world, canvasX);
        return true;
      }
    }
  }

  return false;
}

export function handleColorEditorDrag(world, canvasX) {
  if (!overlayState.activeSliderDrag) return false;
  updateColorFromDrag(world, canvasX);
  return true;
}

export function handleColorEditorRelease() {
  overlayState.activeSliderDrag = null;
}

function updateColorFromDrag(world, canvasX) {
  const drag = overlayState.activeSliderDrag;
  if (!drag) return;

  const state = world.states[drag.stateName];
  if (!state) return;

  const rel = clamp01((canvasX - drag.trackX) / SLIDER_TRACK_WIDTH);
  const newValue = Math.round(rel * drag.max);

  const hsl = hexToHSL(colorOf(state));
  hsl[drag.channel] = newValue;

  if (!state.render) state.render = {};
  state.render.color = hslToHex(hsl.h, hsl.s, hsl.l);
}

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function colorOf(state) {
  return (state.render && state.render.color) || '#dd5555';
}
