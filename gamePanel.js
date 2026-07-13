/* =============================================================================
   gamePanel.js — the "game" PANEL TYPE
   -----------------------------------------------------------------------------
   Hosts CalileiGame (the platform fighter) on a panel. This module is an
   ALTERNATE COMPOSITION ROOT for the game: it plays the role the game repo's
   main.js plays standalone — create the World, own the fixed-timestep
   accumulator, call tick(world, inputs), call render(world, ctx) — except the
   rAF heartbeat is supplied by the site's per-frame loop (this type's tick)
   instead of the game's own requestAnimationFrame.

   THE TWO CLOCKS
     The site runs at display rate (whatever rAF gives us); the game runs at a
     locked 60Hz. They meet ONLY at the accumulator below — the exact same
     boundary the game's own main.js uses. Per site frame: accumulate real dt,
     cap it (spiral-of-death guard), drain zero-or-more fixed 16.67ms game
     ticks, render once. The game stays deterministic and frame-counted; the
     site never knows the game exists.

   THE INPUT ADAPTER
     The game's own input/keyboard.js is NOT imported — it installs window-
     level listeners with unconditional preventDefault on arrows/Space (no
     teardown, no gating), which would eat keystrokes site-wide (e.g. Space
     in a desktopNote editor). Instead this module is a second producer of
     the engine's input-snapshot contract — the seam the game designed for
     exactly this ("a future gamepad module can produce the same shape").
     Keys are recorded, and defaults prevented, ONLY while a game panel is
     the active panel and past its interaction threshold. Scroll to the
     panel → the keyboard belongs to the game. Scroll away → the adapter
     goes inert and the site's keyboard behavior is untouched.

   THE VENDOR RULE
     ./calileiGame/src/** is a byte-identical copy of the game repo's src/
     tree. NEVER edit it here — sync is a dumb copy of src/ from the game
     repo, forever. Anything embed-shaped (gating, scaling, pause) lives in
     THIS file. The game's main.js / index.html / styles.css are not copied;
     they keep serving the standalone build in the game repo.

   PAUSE POLICY
     presence === 0 → fully paused: no accumulation, no ticks, no render,
     and the accumulator is cleared so re-entry doesn't burst-catch-up.
     Visible but not input-live (fading in/out, or visible-but-not-active)
     → the simulation runs on NEUTRAL input, so the fighter idles and falls
     naturally during transitions instead of freezing mid-pose.

   DEBUG (opt-in per panel: { type: "game", debug: true })
     Wires the game's own debug overlay (backtick toggle, live stats,
     history, color editor). Two caveats, both inherent to the vendored
     overlay and documented rather than patched:
       1. initOverlayInput's keydown listener is window-level — with debug
          on, Backquote/record keys are claimed site-wide. Dev flag only.
       2. The color editor's canvasCoords() doesn't compensate for CSS
          scaling, so its mouse mapping is only exact when the canvas
          happens to display at native 960×540. (Candidate fix belongs in
          the GAME repo: scale by rect→backing-store ratio.)
     While the overlay is enabled, the canvas gets pointer-events so the
     color editor can receive the mouse — which also means wheel-over-
     canvas stops scrolling the page until the overlay is toggled off.
     In normal play the canvas is click/wheel-through like everything else.

   COUPLED WITH
     - infiniteScroll.js: registerPanelType, registerWeight, isClearToEnter,
       isActive.
     - gameStyles.css: emits .game-overlay, .game-scroll-line, .game-stack,
       .game-frame, .game-canvas, .game-card (+ .game-kicker / .game-hint
       helpers) and the .game-debug-live pointer gate.
     - ./calileiGame/src/**: the vendored game engine (read-only here).
   ========================================================================== */

import {
  registerPanelType,
  registerWeight,
  isClearToEnter,
  isActive,
} from "./infiniteScroll.js";

// --- CalileiGame imports — the same set the game's main.js composes from,
//     minus input/keyboard.js (replaced by the gated adapter below) and
//     minus main.js itself (it self-executes and hunts for #game).
import { createWorld }            from "./calileiGame/src/world/world.js";
import { tick as gameTick }       from "./calileiGame/src/world/tick.js";
import { render as gameRender }   from "./calileiGame/src/render/renderer.js";
import { createFighter }          from "./calileiGame/src/entities/fighter.js";
import { battlefield }            from "./calileiGame/src/data/stages/battlefield.js";
import { fighterA }               from "./calileiGame/src/data/characters/fighterA.js";
import { fighterB }               from "./calileiGame/src/data/characters/fighterB.js";
import { states }                 from "./calileiGame/src/data/states/states.js";
// NEUTRAL_SNAPSHOT is the engine's own frozen "no input" object. The game's
// inputSystem delivers a POSITIONAL array — inputsByFighter[i] → fighters[i]
// (Phase 13) — so the panel must feed an array shaped like the one the
// standalone main.js builds, and reuse this exact neutral for non-live
// fighters rather than minting its own.
import { NEUTRAL_SNAPSHOT }       from "./calileiGame/src/core/inputBuffer.js";
// Debug overlay — importing is side-effect free; listeners only install when
// initOverlayInput() is actually called (i.e. only for panels with debug:true).
import { initOverlayInput, drawOverlay } from "./calileiGame/src/debug/overlay.js";
import { overlayState }                  from "./calileiGame/src/debug/overlayState.js";

/* -----------------------------------------------------------------------------
   PANEL-TYPE TUNABLES
   --------------------------------------------------------------------------- */
const FADE_SPEED = 20.0;      // overlay fade-easing rate (s⁻¹) — same as the
                              //   other panel types, consistent feel.
const INPUT_THRESHOLD = 0.7;  // grow level above which the panel owns the
                              //   keyboard. Same value as desktopPanel's
                              //   .is-clear gate: while the panel is still
                              //   materializing, the user's intent is more
                              //   likely "scroll past" than "play".

// --- Game-clock constants. Provenance: the game repo's main.js. Kept
//     numerically identical so the embedded build ticks exactly like the
//     standalone one.
const TARGET_FPS = 60;
const MS_PER_FRAME = 1000 / TARGET_FPS;
const MAX_PENDING_FRAMES = 5; // spiral-of-death cap. The site's core already
                              //   clamps dt to 50ms (≈3 game frames), so this
                              //   rarely binds — it's kept anyway because the
                              //   core's clamp is the core's business, not a
                              //   contract this module may lean on.

// --- Spawn points. Provenance: game main.js (Phase 13). Bottom-center
//     anchor — these are each fighter's feet. Both spawn airborne; Idle's
//     notGrounded transition sends them to Fall on the first tick, and they
//     settle onto the main floor. fighters[0] is the human-controlled A;
//     fighters[1] is the dummy B, mirrored around canvas center (x=480).
const SPAWN_Y = 100;
const SPAWN_X_A = 400;
const SPAWN_X_B = 560;

// --- Native resolution. The renderer, stage geometry, and blast zones all
//     live in this coordinate space; the backing store must stay 960×540.
//     Visual size is CSS's job (gameStyles.css scales the element).
const GAME_W = 960;
const GAME_H = 540;

/* -----------------------------------------------------------------------------
   INPUT ADAPTER — a second producer of the game's input-snapshot contract.
   -----------------------------------------------------------------------------
   Module-scope on purpose: one OS keyboard, one held-keys mirror, shared by
   every game-panel instance. Routing is trivial because only one panel can
   be active at a time — `liveIndex` names the instance that currently owns
   input, or -1 when none does (in which case the listeners are inert and
   the site sees the keyboard exactly as if this module didn't exist).

   The key→field mapping below mirrors the game's input/keyboard.js
   getCurrentInput() exactly. If the game repo rebinds keys, re-mirror here.
   --------------------------------------------------------------------------- */
const heldKeys = new Set();

// Keys whose browser default we suppress WHILE A GAME PANEL OWNS INPUT —
// the deliberate claim: down-arrow should crouch, not scroll the page out
// from under the match. Identical set to the game's keyboard.js.
const PREVENT_DEFAULT = new Set([
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space",
]);

let liveIndex = -1;          // instance index that owns input, or -1
let keyboardInstalled = false;

function ensureKeyboard() {
  if (keyboardInstalled) return;
  keyboardInstalled = true;

  window.addEventListener("keydown", (e) => {
    if (liveIndex === -1) return;          // no owner → fully inert
    heldKeys.add(e.code);                  // event.code: layout-independent
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
  });

  // keyup always clears, ownership or not — a key pressed while live and
  // released a frame after scroll-away must not linger in the mirror.
  window.addEventListener("keyup", (e) => {
    heldKeys.delete(e.code);
  });

  // Same role as the game keyboard's blur handler: if the window loses
  // focus mid-press, the OS may never deliver the matching keyup.
  window.addEventListener("blur", () => {
    heldKeys.clear();
  });
}

// Called once per frame by every instance's tick with its own liveness.
// Claims are exclusive by construction (isActive is exclusive); the mirror
// is cleared on every ownership change so no held key crosses a boundary.
function setInputLive(index, live) {
  if (live) {
    if (liveIndex !== index) {
      liveIndex = index;
      heldKeys.clear();
    }
  } else if (liveIndex === index) {
    liveIndex = -1;
    heldKeys.clear();
  }
}

// Exact mirror of the game's getCurrentInput(). The snapshot shape is the
// engine's input contract — every field present, gameplay-role names.
function buildSnapshot() {
  let stickX = 0;
  if (heldKeys.has("ArrowLeft")  || heldKeys.has("KeyA")) stickX -= 1;
  if (heldKeys.has("ArrowRight") || heldKeys.has("KeyD")) stickX += 1;

  let stickY = 0;
  if (heldKeys.has("ArrowUp")    || heldKeys.has("KeyW")) stickY -= 1;
  if (heldKeys.has("ArrowDown")  || heldKeys.has("KeyS")) stickY += 1;

  const shield = heldKeys.has("KeyX");

  return {
    stickX,
    stickY,
    cStickX: 0,
    cStickY: 0,
    jump:         heldKeys.has("Space"),
    lightattack:  heldKeys.has("KeyZ"),
    heavyattack:  heldKeys.has("KeyC"),
    lightspecial: heldKeys.has("KeyV"),
    heavyspecial: heldKeys.has("KeyB"),
    grab:         heldKeys.has("KeyN"),
    shield,
    shieldDepth: shield ? 1.0 : 0.0,
  };
}

// The live fighter (fighters[0]) is fed buildSnapshot() when this panel owns
// input, NEUTRAL_SNAPSHOT otherwise (fading in/out). The dummy (fighters[1])
// always gets NEUTRAL_SNAPSHOT — same as the standalone build. Neutral is the
// engine's own frozen singleton (imported above), so "no input" has one
// definition shared by the game and the panel.

/* -----------------------------------------------------------------------------
   PER-INSTANCE STATE
   -----------------------------------------------------------------------------
   index -> { world, canvas, ctx, accumulator, grow, debug }
   Each game panel gets its own World — two game panels in PANELS coexist
   with independent matches; input routes to whichever is active.
   --------------------------------------------------------------------------- */
const instances = new Map();

/* -----------------------------------------------------------------------------
   REGISTRATION
   --------------------------------------------------------------------------- */
registerPanelType("game", {

  buildDOM(panel /*, index */) {
    const overlay = document.createElement("div");
    overlay.className = "infinite-overlay game-overlay";

    // Optional authored HTML above the screen — same authoring convention
    // as the dots/turn panels (classes like .game-kicker / .game-hint are
    // provided by gameStyles.css, or write any markup).
    const card = panel.html ? `<div class="game-card">${panel.html}</div>` : "";

    overlay.innerHTML = `
      <div class="game-scroll-line"></div>
      <div class="game-stack">
        ${card}
        <div class="game-frame">
          <canvas class="game-canvas" width="${GAME_W}" height="${GAME_H}"></canvas>
        </div>
      </div>`;

    // init(index, overlay) doesn't receive the PANELS entry, so the one
    // per-panel config flag rides across on the node itself.
    if (panel.debug === true) overlay.dataset.gameDebug = "true";

    return overlay;
  },

  init(index, overlay) {
    const canvas = overlay.querySelector(".game-canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error(`gamePanel ${index}: failed to acquire 2D context`);
      return;
    }

    // --- Compose the game, exactly as the standalone main.js does (Phase
    //     13): two fighters — A (human-controlled) and B (the dummy hit
    //     target). The state machine and every system handle N fighters; the
    //     panel only has to spawn them and route input positionally below.
    const world = createWorld(battlefield, states);
    world.fighters.push(createFighter(fighterA, SPAWN_X_A, SPAWN_Y));
    world.fighters.push(createFighter(fighterB, SPAWN_X_B, SPAWN_Y));

    const state = {
      world,
      canvas,
      ctx,
      accumulator: 0,
      grow: 0,
      debug: overlay.dataset.gameDebug === "true",
    };
    instances.set(index, state);

    ensureKeyboard();

    if (state.debug) {
      // Installs the game's own backtick/record keydown (window-level —
      // see header caveat) and the color editor's canvas-scoped mouse
      // handlers. Vendored behavior, deliberately uncustomized.
      initOverlayInput(canvas, world);
    }

    // Console hook — the game's load-bearing debugging affordance
    // (window.world.fighters[0].actionState, etc.). Last instance wins at
    // init; the instance that owns input re-claims it per frame in tick,
    // so on a multi-game page `world` in DevTools is the one you're playing.
    window.world = world;

    // Handoff-gate participation: report this panel's visual weight.
    registerWeight(index, () => state.grow);
  },

  tick(index, overlay, presence, _dist, dt /*, t */) {
    const state = instances.get(index);
    if (!state) return;

    // (1) Self-driven fade — the standard single-channel animator: ease
    //     grow toward the gate's verdict, last-write opacity. Runs even at
    //     presence 0 so an off-screen exit keeps draining its weight and
    //     never blocks the next panel's entry.
    const target = isClearToEnter(index) ? 1 : 0;
    state.grow += (target - state.grow) * (1 - Math.exp(-FADE_SPEED * dt));
    overlay.style.opacity = state.grow.toFixed(3);

    // (2) Input ownership for this frame. isActive is exclusive, so at most
    //     one instance claims; the threshold keeps keystrokes out of a
    //     panel that's still materializing.
    const live = isActive(index) && state.grow > INPUT_THRESHOLD;
    setInputLive(index, live);
    if (live && window.world !== state.world) window.world = state.world;

    // (3) Off-screen → fully paused. Dropping the accumulator (rather than
    //     letting it fill) means scrolling back never triggers a catch-up
    //     burst — the match resumes from where it visually left off.
    if (presence <= 0) {
      state.accumulator = 0;
      return;
    }

    // (4) The fixed-timestep accumulator — the game main.js loop body,
    //     re-hosted. The site's dt is seconds; the game counts milliseconds.
    //     The same input array feeds every tick drained this frame, matching
    //     the standalone loop's once-per-rAF sampling.
    state.accumulator += dt * 1000;
    const maxAccum = MS_PER_FRAME * MAX_PENDING_FRAMES;
    if (state.accumulator > maxAccum) state.accumulator = maxAccum;

    // Phase 13 contract: tick takes a POSITIONAL array, inputsByFighter[i] →
    // fighters[i]. [0] is the human (live snapshot when the panel owns input,
    // neutral while fading); [1] is the dummy, always neutral — identical to
    // the array the standalone main.js builds. Passing a bare snapshot here
    // (the pre-Phase-13 shape) is what made inputSystem index undefined into
    // the buffer and throw in canAirJump.
    const p1 = live ? buildSnapshot() : NEUTRAL_SNAPSHOT;
    const inputsByFighter = [p1, NEUTRAL_SNAPSHOT];
    while (state.accumulator >= MS_PER_FRAME) {
      gameTick(state.world, inputsByFighter);
      state.accumulator -= MS_PER_FRAME;
    }

    // (5) Render once per site frame while visible — same cadence as the
    //     standalone build (render every rAF, ticks as the accumulator
    //     dictates). The renderer is a pure function of the World, so
    //     re-drawing an unticked World is just a cheap repaint.
    gameRender(state.world, state.ctx);

    if (state.debug) {
      drawOverlay(state.world, state.ctx);
      // Pointer gate for the color editor: only while the overlay is up
      // does the canvas catch the mouse (and, as a side effect, the wheel —
      // acceptable in a debugging session, never in normal play).
      state.canvas.classList.toggle(
        "game-debug-live",
        overlayState.enabled === true
      );
    }
  },
});