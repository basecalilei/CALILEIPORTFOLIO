/* =============================================================================
   turnScene.js — the "turn" SCENE TYPE
   -----------------------------------------------------------------------------
   A levitating model centered on screen, framed with a long-focal-length
   perspective camera (≈ 100mm equivalent) and rendered with a configurable
   surface fill plus an inverted-hull outline. FILL_MODE selects the surface
   look — "flat" (unlit flat fill, outline-only detail), "toon" (cel banding),
   or "original" (the authored PBR materials) — and OUTLINE_ENABLED toggles the
   rim. All are tunables at the top of this file. The model
   loaded is whatever GLB the PANELS entry's `file` field points to; if no
   file is specified or the load fails, a primitive Box is used as a fallback
   so the scene works regardless.

   This scene type exposes SEVEN ACTIONS via the actions hook:
     turn() — adds a quarter-turn to the held heading, which the per-frame
              update eases toward (frame-rate independent via dt). Rapid
              calls accumulate; the idle yaw-sway adds on top so the model
              keeps drifting around whatever heading the user has set.
              Discrete press; cancels any in-flight release inertia.
              Triggered externally (e.g. by a panel-type's button) through
              threeArray.js's invokeSceneAction(panelIndex, "turn").

     The next three together implement live drag with release momentum,
     driven by a panel's pointerdown / pointermove / pointerup lifecycle:
       dragRotateBegin() — user touched the model. Stops any in-flight
              release inertia so active drag supersedes momentum.
       dragRotateBy(deltaRadians) — writes both spin and spinTarget to the
              same new value so the drag is 1:1 with the pointer (no ease
              lag during the drag, no snap-back on release).
       dragRotateEnd(angularVelocity) — user released. The scene stores
              the released angular velocity and the per-frame update
              decays it down to zero (INERTIA_FRICTION / STOP_OMEGA).

     Two mirror the drag pair for the PROBE ANNOTATIONS (hover-to-measure):
       probeBegin() / probeEnd() — the panel forwards pointer enter/leave
              on the drag surface. Probing (hover OR active drag — drag
              is included scene-side so touch gets the annotations while
              spinning) extends three plotted-point callouts from random
              spots on the model's envelope, each carrying one live
              readout. See PROBE ANNOTATIONS below.

     The last is a one-time binding handshake:
       bindDragSurface(element) — the panel hands the scene the DOM element
              that should size itself to the model's on-screen footprint.
              From then on the scene writes --drag-w / --drag-h CSS custom
              properties onto the element whenever the model changes
              (fallback → GLB swap) or the canvas resizes. The scene
              treats the element opaquely; it knows nothing about classes
              or layout.

   The scene also runs an IDLE LEVITATE animation while visible: a slow
   vertical float, a gentle horizontal sway, and a small tip. All tunable
   at the top of this file.

   IN-SCENE HUD
     A canvas-textured plane anchored to the bottom of the viewport
     (horizontally centered) shows three live stats about the model's
     motion across three stacked lines: cumulative ROTATION (odometer),
     current ANGLE (signed heading), and current VELOCITY (deg/sec,
     smoothed). Lives in the scene rather than the panel's HTML overlay
     so the data source (integrating holder.rotation.y in update()) and
     the display (canvas text) stay in one file with no cross-module
     reads. See the HUD STATS DISPLAY block below for the dimensions and
     the rising-edge redraw gate.

   DECOUPLED FROM ANY PANEL TYPE
     The scene knows nothing about buttons, overlays, or HTML. Its only
     interface to the outside world is:
       - ctx fields it reads each frame (presence, dt, t, active, panel.file)
       - the `turn` action it exposes
       - the `weight` it reports for the handoff gate / cull
     Any panel type — turnPanel, a future autoSpinPanel, anything — can drive
     it. The panel type and the scene type are independently swappable.

   COUPLED WITH
     - threeArray.js: imports registerSceneType. The scene array's update()
       hook hands us the ctx envelope every visible frame.
     - infiniteScroll.js: (transitively) presence/active/isClearToEnter via
       the update() ctx; registers a weight() so the handoff gate sees this
       scene.
     - three/addons/loaders/GLTFLoader.js: pinned via the import map in
       index.html.
   ========================================================================== */

import { registerSceneType } from "./threeArray.js";
import { registerWeight, isClearToEnter } from "./infiniteScroll.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/* -----------------------------------------------------------------------------
   PER-SCENE-TYPE TUNABLES
   -----------------------------------------------------------------------------
   All knobs that shape the look and feel of the "turn" scene live here, at
   the top of the file, so they can be tweaked without reading the rest of
   the implementation. Change a value, reload, see the effect.
   --------------------------------------------------------------------------- */

// --- CAMERA / FRAMING --------------------------------------------------------
// FOV approximating a 100mm focal length on a 35mm-equivalent sensor. The
// long lens flattens perspective — the model looks framed rather than
// dramatic, which suits a centered hero shot. Math: FOV(deg) =
// 2 * atan(sensorH / (2 * focalLength)). With sensorH = 24mm and f = 100mm,
// that's ~13.7°. Round to 14 for a clean number.
const CAMERA_FOV = 14;
// Camera distance. With the long lens this is set further back so the model
// isn't clipped by the near plane and has room for the levitate motion.
const CAMERA_DISTANCE = 8;

// --- MODEL VISIBLE SIZE (RESPONSIVE) ----------------------------------------
// The model is auto-scaled so its longest axis (computed from the bounding
// box) equals `currentTargetSize` in world units, where `currentTargetSize`
// is a function of viewport width: small on phones, full on desktop.
//
// Why responsive: at our fixed CAMERA_FOV / CAMERA_DISTANCE, the model's
// on-screen size is a constant fraction of viewport HEIGHT (~51%). On a
// narrow portrait phone (e.g., 375×812) that's the same ~51% of 812 = 408px,
// which is 113% of viewport width — the model spills off-screen horizontally
// or feels overwhelming. Scaling TARGET_SIZE down on narrow viewports keeps
// the model at a comfortable fraction of width too.
//
// Linear interp between two breakpoints. Below BP_NARROW: fully MIN. Above
// BP_WIDE: fully MAX. Between: linear. The math is in computeTargetSize().
//
// Why scale ONLY this constant (and the bob amplitudes — see below) rather
// than e.g. moving the camera back: scaling the world-space target leaves
// the camera's lens character intact. A wider FOV would warp perspective;
// a more distant camera would shrink everything proportionally but also
// blunt the depth cues. Scaling the model is the surgical fix.
//
// PER-MODEL TUNING: each turn panel can scale this responsive baseline via
// a `modelScale` field on its PANELS entry in main.js (read in the factory,
// where sizing state lives). The constants below remain the SHARED
// calibration; modelScale is the per-model knob multiplied on top.
const TARGET_SIZE_MAX = 1.0;          // world units at wide viewports
const TARGET_SIZE_MIN = 0.4;          // world units at narrow viewports
const BP_NARROW_PX    = 400;          // ≤ this viewport width → fully MIN
const BP_WIDE_PX      = 1200;         // ≥ this viewport width → fully MAX

function computeTargetSize() {
  const w = window.innerWidth;
  if (w <= BP_NARROW_PX) return TARGET_SIZE_MIN;
  if (w >= BP_WIDE_PX)   return TARGET_SIZE_MAX;
  const t = (w - BP_NARROW_PX) / (BP_WIDE_PX - BP_NARROW_PX);
  return TARGET_SIZE_MIN + t * (TARGET_SIZE_MAX - TARGET_SIZE_MIN);
}

// --- TURN ACTION -------------------------------------------------------------
// Quarter-turn rotation (the angle the model rotates each time the action
// fires). Tunable here in case "quarter" turns into "eighth" or "half"
// later. The motion is exponential easing toward the target — frame-rate
// independent via dt, same pattern as everything else easing in this
// project (grow, fade, etc).
const TURN_ANGLE = Math.PI / 2;       // radians; the angle per action call
const TURN_SPEED = 7.0;               // exponential easing rate (s⁻¹).
                                      //   Higher = snappier; lower = lazier.

// --- DRAG-RELEASE INERTIA ----------------------------------------------------
// When the user releases a drag, the rotation continues with the release
// angular velocity and decays exponentially — the same momentum-feel the
// grid modal has on its pan release, and what an iOS scroll does after a
// fling.
//
// FRICTION matches gridModal.js for consistent feel across the project. At
// 4.0 s⁻¹ the spin loses ~63% of its speed in 250ms and is effectively
// stationary in about a second.
//
// STOP_OMEGA is the snap-to-zero threshold: below this angular speed, vSpin
// is set to 0 outright to avoid asymptotic crawl. 0.05 rad/s ≈ 2.9 °/s,
// well below visible motion at this camera FOV.
const INERTIA_FRICTION = 4.0;         // exponential decay rate (s⁻¹)
const INERTIA_STOP_OMEGA = 0.05;      // rad/s; below this, snap to 0

// --- DRAG SURFACE FOOTPRINT --------------------------------------------------
// The scene tracks the model's on-screen footprint and writes width/height
// CSS custom properties (--drag-w / --drag-h) into a panel-provided element
// — the drag surface. Updated on model swap (fallback → GLB) and on resize.
//
// PAD is comfort margin per side in world units. The Y-axis envelope ALSO
// includes the full bob amplitude (FLOAT_A + FLOAT_B) on each side, since
// the bob translates the model vertically without changing the bbox.
//
// Sway / tip rotations slightly change the projected silhouette, but peak
// amplitudes (~0.25 rad) are small enough that the PAD absorbs them. If a
// future model has weird proportions that read wrong, this is the knob.
const DRAG_SURFACE_PAD = 0.1;         // world units of pad per side

// --- IDLE LEVITATE MOTION ----------------------------------------------------
// The model is alive while visible: a vertical bob, a yaw sway (gentle
// left-right turn around the vertical axis), and a pitch tip (gentle nod
// toward/away from camera). All driven by sums of sines at incommensurate
// angular frequencies so the pattern never visibly repeats.
//
// Each axis has TWO components (A and B) summed together — single-period
// sines feel mechanical because they repeat audibly; two periods at
// non-integer ratios feel organic. Tweak amplitudes to taste; tweak the
// angular frequencies if you want faster/slower idle motion.
//
// All amplitudes in radians except FLOAT (world units). Set both A and B
// of an axis to 0 to disable that axis.
const FLOAT_A = 0.04;                 // vertical bob, world units (primary)
const FLOAT_B = 0.02;                 // vertical bob, world units (secondary)
const FLOAT_W_A = 0.9;                // angular frequency (rad/s) — primary
const FLOAT_W_B = 0.37;               // angular frequency (rad/s) — secondary

const SWAY_A = 0.14;                  // yaw rotation, radians (primary)
const SWAY_B = 0.10;                  // yaw rotation, radians (secondary)
const SWAY_W_A = 0.6;
const SWAY_W_B = 0.23;

const TIP_A = 0.10;                   // pitch rotation, radians
const TIP_W_A = 0.75;

// Per-instance phase desync. If multiple turn scenes are visible at once
// (or the user scrolls through them quickly), they should not all be bobbing
// in unison — that reads as mechanical. The phase is computed from the
// panel index, so each instance has its own steady phase offset.
const PHASE_PER_INDEX = 1.7;          // radians of phase offset per panel index

// --- ENTER/EXIT ANIMATION SPEEDS ---------------------------------------------
// Four independent rate constants — one for each of the four animation
// primitives. The PANELS entry's `enter` and `exit` fields select WHICH of
// these primitives runs on each transition (see PANEL-LEVEL ANIMATION
// CONFIG, below); these constants control HOW FAST.
//
// All four are exponential easing rates in inverse seconds (s⁻¹), the same
// shape as every other easing in this project. Higher = snappier; lower =
// lazier. They are NOT directly comparable in feel — equal numbers for grow
// and fade produce different visual durations because scale and opacity
// have different perceptual thresholds. Tune by eye.
const GROW_IN_SPEED = 12.0;            // enter "grow"  or "both": scale  0 → 1
const FADE_IN_SPEED = 12.0;            // enter "fade"  or "both": opacity 0 → 1
const SHRINK_OUT_SPEED = 12.0;         // exit  "shrink" or "both": scale  1 → 0
const FADE_OUT_SPEED = 12.0;           // exit  "fade"   or "both": opacity 1 → 0

// --- PANEL-LEVEL ANIMATION CONFIG --------------------------------------------
// Defaults used when a PANELS entry doesn't specify `enter` or `exit`.
// These match the old build's behavior: grow in (scale 0→1, opacity stays
// at 1), fade out (opacity 1→0, scale holds at 1).
//
// Valid values:
//   enter: "grow" | "fade" | "both"
//   exit:  "shrink" | "fade" | "both"
// "both" runs scale AND opacity simultaneously on their own clocks at the
// matching speed constants — set GROW_IN_SPEED and FADE_IN_SPEED to the same
// value if you want them visually locked.
const DEFAULT_ENTER = "grow";
const DEFAULT_EXIT  = "fade";

// --- HUD STATS DISPLAY -------------------------------------------------------
// PROBE ANNOTATIONS — hover-to-measure. Replaces the old bottom-center HUD
// readout block. While the user probes the model (pointer over the drag
// surface, or an active drag — see probeBegin/probeEnd in the header),
// three plotted-point callouts extend from random spots on the model's
// bounding envelope, each carrying one live readout at the end of an
// elbow leader line (visualLanguage.md: "plotted-point annotations").
// When the probe ends, everything retracts and the panel rests EMPTY —
// data on demand.
//
// Same architectural pattern as before: the data source (rotation
// integrator in update()) and the display (GL hairlines + canvas-texture
// label planes) both live in this scene, no coupling to the panel's HTML.
//
// SPACES: the anchor ring radius is derived from the model's WORLD-unit
// bounding envelope, so anchors track the viewport-responsive size. It
// reads the UNTUNED envelope (annEnvScale in the factory backs the
// per-model `modelScale` out), so the apparatus sits identically across
// panels regardless of per-model tuning. Everything outward of the
// anchor — cross arms, leader lengths, label planes, text — is authored
// in SCREEN PIXELS and converted through wUnit, so the annotation
// apparatus reads at a constant UI size like the chrome it is.
const ANN_ANCHOR_PAD_WORLD = -0.2;  // gap between model envelope and anchors
const ANN_CROSS_PX = 5;             // half-arm of the anchor registration cross
const ANN_DIAG_PX = 100;             // radial leader segment length
const ANN_SHELF_PX = 4;            // horizontal shelf the label sits on
const ANN_GAP_PX = 6;               // shelf end → label edge gap
const ANN_LABEL_W_PX = 160;         // fits "VELOCITY > -999.9°/s"
const ANN_LABEL_H_PX = 16;
const ANN_TEXT_HEIGHT_PX = 11;      // instrument-tier small (Hornet)
const ANN_CANVAS_UPSCALE = 4;       // supersample factor for DPR-safe crispness
const ANN_TEXT_COLOR = "#a2a4a5";   // tuned light grey (lighter than --ink-dim)
const ANN_GLOW_COLOR = "#3c3c3c";   // write-event flash; matches --brand-blue
const ANN_GLOW_SECONDS = 3.7;       // label appearance afterglow decay
const ANN_LINE_COLOR = 0xa2a4a5;    // tuned mid grey; lightness also via alpha
const ANN_LINE_ALPHA = 0.9;         // hairline-by-transparency — just above the
                                    //   --line token's 0.16, so leaders read as
                                    //   live apparatus, not page furniture
const ANN_LEADER_GAP_PX = 8;        // leader stops short of the cross — the
                                    //   fiducial is never touched (schematic
                                    //   convention)
// Readouts are the instrument tier → Hornet Display (label grammar:
// "a label stating what something IS is Hornet"). Glitched Book fallback
// keeps the old look if Hornet ever fails to load.
const ANN_FONT_FAMILY = '"Hornet Display", "Glitched Book", ui-monospace, monospace';
const ANN_LETTER_SPACING = "0.08em"; // Tier 3 spec (visualLanguage.md)

// Thousands separator for the ROTATED odometer readout. Replaces
// toLocaleString("en-US"), which routes through Intl machinery on every
// call — needless weight for fixed en-US grouping of a non-negative
// integer, in a string that rebuilds every probed frame. Plain digit
// grouping: walk back from the end in threes.
function groupThousands(n) {
  const s = String(n);
  let out = s.slice(-3);
  for (let i = s.length - 3; i > 0; i -= 3) {
    out = s.slice(Math.max(0, i - 3), i) + "," + out;
  }
  return out;
}
// Extension/retraction — machinery motion, fast and eased. Out is faster
// than in (release should feel snappy, same asymmetry as the vortex).
const PROBE_IN_SPEED = 14.0;        // s⁻¹ exponential ease, extend
const PROBE_OUT_SPEED = 22.0;       // s⁻¹ exponential ease, retract
const ANN_STAGGER_S = 0.07;         // delay between successive callouts (in only)
const ANN_DIAG_FRAC = 0.6;          // grow 0..this draws the diagonal; rest, the shelf

// IDLE MOTION on a deployed callout, split per the motion grammar:
//   DRIFT (machinery idle) — the label end floats gently on incommensurate
//     sine sums while the anchor stays dead still; the leader follows.
//     The apparatus reads as HELD, not printed. 0 disables.
//   RE-ACQUISITION (discrete information event) — every few seconds ONE
//     anchor darts to a fresh spot within its third of the circle; the
//     readout glides after it on a slower ease, the leader stretching
//     between (always connected at both ends). Uneven interval on
//     purpose. Set ANN_REACQ_MIN_S = Infinity to disable.
const ANN_DRIFT_AMP_PX = 80;         // peak label-end drift, screen px
const ANN_REACQ_MIN_S = 1.2;        // s between re-acquisitions (randomized
const ANN_REACQ_MAX_S = 2.0;        //   in [min, max])
const ANN_ANCHOR_MOVE_SPEED = 10.0; // s⁻¹ — the + darts (fast machinery)
const ANN_LABEL_FOLLOW_SPEED = 2.0; // s⁻¹ — the readout glides after (lag
                                    //   is what makes the leader stretch)

// FREE FIDUCIALS — extra registration crosses that deploy with the probe
// but carry no readout: unassigned measurement marks. Each scatters to a
// random spot just outside the anchor ring and re-acquires on its OWN
// independent timer — faster than the callouts, since a mark nobody is
// reading is free to move — darting there in a straight line. Set
// ANN_FREE_COUNT = 0 to disable.
const ANN_FREE_COUNT = 2;
const ANN_FREE_CROSS_PX = 3;        // half-arm; a step smaller than the callouts'
const ANN_FREE_SPREAD_PX = 90;      // max px beyond the anchor ring
const ANN_FREE_REACQ_MIN_S = 0.9;   // s between re-acquisitions, per cross
const ANN_FREE_REACQ_MAX_S = 2.6;   //   (randomized in [min, max])

// ACQUISITION FRAME — four corner brackets (the site's reticle language;
// see the scroll indicator's traveler) sized to the model's un-rotated
// footprint. Deploys FIRST in the stagger — acquire the target, then
// measure it — with the arms drawing on from the corners. The frame
// TRACKS the model's levitate bob through a lagged ease, always a beat
// behind like a tracking reticle chasing a live target, plus a whisper of
// horizontal drift. Set ANN_FRAME_CORNER_PX = 0 to disable.
const ANN_FRAME_PAD_PX = 16;        // gap between model footprint and frame
const ANN_FRAME_CORNER_PX = 14;     // corner arm length
const ANN_FRAME_FOLLOW_SPEED = 4.5; // s⁻¹ bob-tracking lag (lower = lazier)
const ANN_FRAME_DRIFT_AMP_PX = 1.5; // horizontal idle drift, screen px

// LINKED PAIR — two registration marks joined by a line that is ALWAYS
// connected at both ends. Each end darts on its own independent clock
// (deliberately a different range than the free fiducials, so no two
// clocks in the apparatus share a cadence) and the link stretches live
// between them. New targets reject spots too close to the other end —
// a link that collapses to a stub stops reading as one. Set
// ANN_PAIR_ENABLED = false to disable.
const ANN_PAIR_ENABLED = false;
const ANN_PAIR_REACQ_MIN_S = 1.4;   // s between re-acquisitions, per end
const ANN_PAIR_REACQ_MAX_S = 3.4;
const ANN_PAIR_MIN_SEP_PX = 70;     // rejected-target radius around the other end

// HEADING INDEX — CUR.ANGLE made graphical: a radial tick riding the
// heading dial at the model's LIVE heading (twelve-o'clock zero, clockwise
// positive — a compass card viewed face-on). Driven 1:1 by the composed
// rotation, so it sweeps with drags, whips with inertia, and wanders with
// the idle sway. Set ANN_HEADING_TICK_PX = 0 to disable.
const ANN_HEADING_TICK_PX = 9;      // tick length, centered across the dial
const ANN_HEADING_TICK_THICK_PX = 2.5; // tick thickness — the tick is a thin
                                    //   quad, since WebGL ignores line width

// HEADING DIAL — the compass card the tick rides through: a full circle
// of dots centered on the model. The dial (and the tick with it) sizes
// off the anchor ring through two knobs, coarse then fine:
//   dial radius = annRingRadius() × SCALE + PAD_PX
// So SCALE = 1.15 pushes it 15% out; PAD_PX = -30 pulls it 30px in at any
// scale. On deploy the card sweeps in dot by dot from twelve o'clock.
// The dot UNDER the needle lights up as the active index — it snaps from
// dot to dot (a discrete register) while the needle sweeps continuously.
// Red-as-active follows the pager's precedent (.si-readout-index rests on
// --brand-red), not the warn semantics.
// Set ANN_DIAL_DOT_COUNT = 0 to disable the dots (the tick remains).
const ANN_DIAL_DOT_COUNT = 36;      // one dot per 10°
const ANN_DIAL_DOT_PX = 2;          // dot size, screen px
const ANN_DIAL_RADIUS_SCALE = 1.2;  // coarse: multiplier on the anchor ring
const ANN_DIAL_RADIUS_PAD_PX = 0;   // fine: px added after the scale
const ANN_DIAL_HOT_SCALE = 2.2;     // the active dot grows this many ×
const ANN_DIAL_HOT_ALPHA = 0.85;    // and reads at indicator strength, not hairline
const ANN_DIAL_HOT_COLOR = 0xff5e2e; // matches infiniteStyles.css --brand-red

// Velocity readout smoothing: raw dθ/dt is jittery at small dt (sub-frame
// noise dominates near zero). Exponential ease with rate ~9 s⁻¹ gives a
// readable signal that still tracks rapid drags. Higher = snappier readout,
// lower = laggier.
const HUD_VELOCITY_SMOOTH_SPEED = 9.0;

// --- SURFACE FILL / OUTLINE SHADING ------------------------------------------
// A configurable surface fill plus an inverted-hull outline. Both are
// scene-local: they touch only this file. No post-processing pass is used
// (the scene array renders one scissored render() per region with no
// EffectComposer), so the outline is real back-side geometry, not a screen
// effect. See the module-level helpers below registerSceneType for the how.
//
// FILL_MODE selects how the model surface is shaded:
//   "flat"     → unlit flat fill (FILL_COLOR), no shading or texture. With the
//                outline on, this is the "coloring-book" look: a white shape
//                read only by its black outline.
//   "toon"     → MeshToonMaterial cel banding, keeping the model's color/maps.
//   "original" → leave the model's authored PBR materials untouched.
// OUTLINE_ENABLED toggles the rim independently of the fill.
const FILL_MODE = "flat";
const OUTLINE_ENABLED = true;

// Flat-fill color (FILL_MODE === "flat"). White "paper" by default.
const FILL_COLOR = 0x494949;

// Bands in the toon lighting ramp (FILL_MODE === "toon"). 2 = hard light/shadow;
// 3–4 reads as classic cel shading; higher approaches smooth. The ramp is a
// tiny single-channel LUT sampled by dot(N,L) — see getToonGradientMap.
const TOON_STEPS = 4;

// Outline color and thickness. THICKNESS is in screen space (NDC half-units):
// the vertex shader pushes the hull along the view-space normal scaled by
// clip.w, so the rim stays a roughly constant on-screen width regardless of
// the model's autoFit scale, the responsive re-fit, or the enter/exit grow.
// Start near 0.003–0.005; raise for a chunkier line. Pure black for max
// contrast against the flat-white fill; 0x2a2622 is the project's warmer ink.
const OUTLINE_COLOR = 0x626c70;
const OUTLINE_THICKNESS = 0.0015;

/* -----------------------------------------------------------------------------
   GLB LOADING — module-level cache
   -----------------------------------------------------------------------------
   Multiple turn scenes can share the same GLB file (or load different ones).
   The loader itself is shared across all instances (one loader allocation
   regardless of how many panels use this scene type). Loaded scenes are
   cached by URL so the same file isn't fetched twice.
   --------------------------------------------------------------------------- */
const gltfLoader = new GLTFLoader();
const gltfCache = new Map();   // url -> Promise<gltf>

function loadGltf(url) {
  if (gltfCache.has(url)) return gltfCache.get(url);
  const promise = new Promise((resolve, reject) => {
    gltfLoader.load(url, resolve, undefined, reject);
  });
  gltfCache.set(url, promise);
  return promise;
}

/* -----------------------------------------------------------------------------
   DEFERRED LOAD SCHEDULING — keep GLB fetches off the startup critical path
   -----------------------------------------------------------------------------
   Scene factories run at bootstrap (threeArray.js), which used to mean every
   turn panel's GLB fetch + main-thread parse started AT PAGE LOAD, competing
   with first-paint assets (fonts, the dots scene, panel-0 imagery) while the
   user is looking at panel 0.

   Instead, each instance queues its load here and it starts on an IDLE SLICE
   after first paint. Slices are pumped ONE LOAD PER SLICE (the same reasoning
   as wallPanel's chunked init): GLTFLoader parses on the main thread, and
   staggering the fetch starts spreads the parses out instead of landing all
   three in the same frame window.

   The timeout bounds the deferral: if the main thread never goes idle (a
   busy tab, a slow device), loads still start within IDLE_LOAD_TIMEOUT_MS.
   Safari has no requestIdleCallback; a short fixed delay stands in — it only
   needs to clear first paint + the module graph, not be precise.

   Late arrival is safe BY CONSTRUCTION: every instance starts on the
   fallback mesh and swaps when its GLB lands (the block in the factory), so
   deferral changes sequencing, not correctness. The accepted trade: a user
   who scrolls to a turn panel faster than its GLB can load briefly sees the
   fallback box. The first-approach kick in update() bounds that window — see
   the factory's MODEL CREATION block.
   --------------------------------------------------------------------------- */
const IDLE_LOAD_TIMEOUT_MS = 4000;
const idleLoadQueue = [];
let idleLoadPumpArmed = false;

function requestIdleSlice(fn) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(fn, { timeout: IDLE_LOAD_TIMEOUT_MS });
  } else {
    setTimeout(fn, 500);
  }
}

function queueIdleLoad(fn) {
  idleLoadQueue.push(fn);
  if (idleLoadPumpArmed) return;
  idleLoadPumpArmed = true;
  requestIdleSlice(pumpIdleLoads);
}

function pumpIdleLoads() {
  const fn = idleLoadQueue.shift();
  if (fn) fn();   // a no-op if the first-approach kick already started it
  if (idleLoadQueue.length) {
    requestIdleSlice(pumpIdleLoads);
  } else {
    idleLoadPumpArmed = false;
  }
}

/* -----------------------------------------------------------------------------
   FALLBACK MESH
   -----------------------------------------------------------------------------
   If no `file` is specified or the GLB fails to load, this primitive stands
   in. It uses the same target-size auto-scaling pipeline as a loaded GLB so
   the rest of the code (idle motion, turn action) is identical regardless.
   --------------------------------------------------------------------------- */
function makeFallbackMesh(THREE) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0x3a7bd5,
    roughness: 0.4,
    metalness: 0.0,
  });
  return new THREE.Mesh(geometry, material);
}

/* -----------------------------------------------------------------------------
   AUTO-SCALE — fit any model into a target-size envelope
   -----------------------------------------------------------------------------
   Different GLB files have wildly different scales. Auto-scaling means we
   never have to manually tune per-model.
     1. Compute the model's bounding box.
     2. Find the longest axis.
     3. Scale uniformly so that axis = targetSize.
     4. Re-center on the origin so rotation is around the model's middle.

   IDEMPOTENT ACROSS RE-FITS: multiplyScalar(targetSize / longest) uses the
   CURRENT bounding box, so calling autoFit again with a different target
   rescales correctly without compounding. This is what lets the responsive
   resize hook re-fit the same model whenever viewport class changes.
   --------------------------------------------------------------------------- */
function autoFit(THREE, object3d, targetSize) {
  const box = new THREE.Box3().setFromObject(object3d);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (longest > 0) {
    const scale = targetSize / longest;
    object3d.scale.multiplyScalar(scale);
  }
  // Re-measure post-scale to center it.
  const box2 = new THREE.Box3().setFromObject(object3d);
  const center = box2.getCenter(new THREE.Vector3());
  object3d.position.sub(center);
}

/* -----------------------------------------------------------------------------
   TOON GRADIENT RAMP — module-level, cached by step count
   -----------------------------------------------------------------------------
   MeshToonMaterial quantizes its diffuse term by sampling a 1-D LUT with
   dot(N, lightDir) remapped to [0,1]. A NearestFilter texture of N evenly
   spaced grey steps turns that smooth term into N hard bands — the cel look.
   One LUT per distinct step count is enough for every instance, so we cache.
   --------------------------------------------------------------------------- */
const gradientMapCache = new Map();   // steps -> THREE.DataTexture

function getToonGradientMap(THREE, steps) {
  if (gradientMapCache.has(steps)) return gradientMapCache.get(steps);
  const n = Math.max(2, steps | 0);
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.round((i / (n - 1)) * 255);
  const tex = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;   // hard band edges, no interpolation
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;               // R8 rows aren't 4-byte aligned for
                                         // arbitrary step counts
  tex.needsUpdate = true;
  gradientMapCache.set(steps, tex);
  return tex;
}

/* -----------------------------------------------------------------------------
   TOON RE-SKIN — swap a material to MeshToonMaterial, preserving look inputs
   -----------------------------------------------------------------------------
   We keep the source material's color and texture maps (by reference — the
   GPU textures stay shared, so we must NOT dispose the source material's
   textures) and drop only the PBR-specific terms (metalness/roughness), which
   toon shading doesn't use. transparent/opacity/side carry over so the
   existing enter/exit fade keeps working unchanged.
   --------------------------------------------------------------------------- */
function toToonMaterial(THREE, src, gradientMap) {
  const m = new THREE.MeshToonMaterial({ gradientMap });
  if (!src) return m;
  if (src.color) m.color.copy(src.color);
  if (src.map) m.map = src.map;
  if (src.normalMap) {
    m.normalMap = src.normalMap;
    if (src.normalScale) m.normalScale.copy(src.normalScale);
  }
  if (src.emissive) m.emissive.copy(src.emissive);
  if (src.emissiveMap) m.emissiveMap = src.emissiveMap;
  if (src.emissiveIntensity != null) m.emissiveIntensity = src.emissiveIntensity;
  if (src.alphaMap) m.alphaMap = src.alphaMap;
  if (src.aoMap) m.aoMap = src.aoMap;
  if (src.vertexColors != null) m.vertexColors = src.vertexColors;
  if (src.name) m.name = src.name;
  m.side = src.side;
  m.transparent = src.transparent;
  m.opacity = src.opacity;
  return m;
}

/* Unlit flat fill. MeshBasicMaterial ignores lights entirely, so the surface
   reads as one solid FILL_COLOR with no shading gradient and no texture — every
   bit of perceived form then comes from the outline. We deliberately drop the
   source map/color/vertexColors (pure flat fill is the point) but carry over
   side/transparent/opacity so the enter/exit fade still drives it. */
function toFlatMaterial(THREE, src) {
  const m = new THREE.MeshBasicMaterial({ color: FILL_COLOR });
  if (!src) return m;
  if (src.name) m.name = src.name;
  m.side = src.side;
  m.transparent = src.transparent;
  m.opacity = src.opacity;
  return m;
}

// Re-skin every mesh in `root` according to FILL_MODE. Outlines are skipped so
// they keep their own ShaderMaterial. Called only when FILL_MODE !== "original"
// (the caller guards that), so this only ever produces flat or toon materials.
function applyFillToModel(THREE, root, mode, gradientMap) {
  const convert = (mm) =>
    mode === "flat" ? toFlatMaterial(THREE, mm) : toToonMaterial(THREE, mm, gradientMap);
  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    if (obj.userData.isToonOutline) return;        // never re-skin outlines
    obj.material = Array.isArray(obj.material) ? obj.material.map(convert) : convert(obj.material);
  });
}

/* -----------------------------------------------------------------------------
   INVERTED-HULL OUTLINE — back-side shell expanded in the vertex shader
   -----------------------------------------------------------------------------
   The standard no-post-process outline: draw the geometry a second time with
   front faces culled (side: BackSide) and every vertex pushed OUT along its
   normal. Where the pushed-out back faces stick past the model's silhouette,
   you see them as a rim; everywhere else the model's own front faces occlude
   them (depthWrite on). The expansion lives entirely in the vertex shader, so:
     - the CPU geometry.boundingBox is untouched → autoFit / captureModelSize
       (and therefore model sizing + the drag-surface footprint) are unaffected
       even though the outline shares the model's subtree;
     - thickness is computed in clip space scaled by w, so the rim is a roughly
       constant on-screen width regardless of how far autoFit scaled the model.

   uOpacity is driven per-frame by the scene's enter/exit fade (a raw
   ShaderMaterial doesn't honor .opacity, so we multiply alpha ourselves).

   CAVEAT: like all inverted-hull outlines, hard-normal seams (e.g. a cube's
   edges, or split-normal GLBs) can show small gaps at sharp corners, since
   each face pushes along its own normal. Smooth-normalled models are clean.
   If skeletal animation is ever added to this scene, outlines would need to be
   SkinnedMeshes bound to the same skeleton; today nothing animates the rig, so
   a plain Mesh sharing the geometry tracks the bind pose correctly.
   --------------------------------------------------------------------------- */
const OUTLINE_VERTEX_SHADER = `
  uniform float uThickness;
  void main() {
    // Normal in view space; project its direction into clip space and offset
    // the clip-space position along it, scaled by w for constant screen width.
    vec3 viewNormal = normalize(normalMatrix * normal);
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec3 clipNormal = normalize((projectionMatrix * vec4(viewNormal, 0.0)).xyz);
    clip.xy += clipNormal.xy * uThickness * clip.w;
    gl_Position = clip;
  }
`;

const OUTLINE_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

function makeOutlineMaterial(THREE) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(OUTLINE_COLOR) },
      uThickness: { value: OUTLINE_THICKNESS },
      uOpacity: { value: 1 },
    },
    vertexShader: OUTLINE_VERTEX_SHADER,
    fragmentShader: OUTLINE_FRAGMENT_SHADER,
    side: THREE.BackSide,
    transparent: true,   // so uOpacity can fade the rim on exit
    depthWrite: true,    // model front faces occlude the hull interior
  });
}

// Add one outline child per mesh, all sharing `outlineMat`. The child shares
// the parent's geometry (by reference) with an identity local transform, so it
// overlays the parent exactly and contributes an identical bounding box. We
// collect targets before adding so we don't mutate the tree mid-traversal.
function addOutlinesToModel(THREE, root, outlineMat) {
  const targets = [];
  root.traverse((obj) => {
    if ((obj.isMesh || obj.isSkinnedMesh) && !obj.userData.isToonOutline) {
      targets.push(obj);
    }
  });
  for (const mesh of targets) {
    const outline = new THREE.Mesh(mesh.geometry, outlineMat);
    outline.userData.isToonOutline = true;
    mesh.add(outline);
  }
}

/* -----------------------------------------------------------------------------
   REGISTER THE SCENE TYPE
   --------------------------------------------------------------------------- */
registerSceneType("turn", (ctx) => {
  const { THREE, scene, camera, width, height, panel, panelIndex } = ctx;

  // ---- CAMERA -----------------------------------------------------------
  // The factory replaces the default camera's FOV with our long-lens value
  // and pulls the camera back to give the model room. The default
  // PerspectiveCamera has aspect set from build-time width/height; the
  // system updates aspect automatically on region size changes (we don't
  // override resize()).
  camera.fov = CAMERA_FOV;
  camera.aspect = width / height;
  camera.near = 0.1;
  camera.far = 100;
  camera.position.set(0, 0, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  // ---- LIGHTS -----------------------------------------------------------
  // Key from upper-right, fill from below-left, soft ambient. Three lights
  // for definite form without the model going flat.
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2, 3, 4);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xb8c8ff, 0.4);
  fill.position.set(-2, -1, 2);
  scene.add(fill);

  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambient);

  // ---- MODEL HOLDER -----------------------------------------------------
  // A Group that contains the model. We rotate the GROUP for the turn
  // action and the tip wobble — leaving the model itself unrotated so we
  // can swap it (fallback → loaded GLB) without losing transform state.
  const holder = new THREE.Group();
  scene.add(holder);

  // ---- LEVITATE PIVOT ---------------------------------------------------
  // A second wrapper. It owns:
  //   - the world-units position bob (vertical float).
  //   - the per-frame grow scale (driven by handoff-gate ease).
  // Splitting transforms by concern: the bob writes to `levitate.position`,
  // the turn writes to a private `spin` variable (NEVER to holder.rotation
  // directly — see below). This means turning the model does not reset
  // anything about the levitate motion, and tuning the levitate (or
  // disabling it) does not affect the turn behavior.
  const levitate = new THREE.Group();
  scene.add(levitate);
  scene.remove(holder);
  levitate.add(holder);

  // ---- TURN ACTION STATE ------------------------------------------------
  // The turn action eases a private `spin` value toward `spinTarget`. The
  // per-frame update composes the model's actual Y rotation as
  //   holder.rotation.y = spin + sway * grow
  // so the idle yaw-sway adds ON TOP of whatever heading the user has
  // turned to. The turn does NOT write to holder.rotation directly — that
  // is the only thing that guarantees turning never resets levitate, and
  // levitate never fights the turn tween.
  //
  // Each click adds TURN_ANGLE to `spinTarget`. Rapid clicks accumulate; the
  // exponential easing keeps the motion smooth regardless of click rhythm.
  //
  // Drag state. `vSpin` is the angular velocity (rad/s) used for release
  // inertia after a drag. `dragActive` is true while the user is actively
  // dragging; per-frame inertia integration is gated on it being false.
  // The three drag actions (begin / by / end) keep these consistent:
  //   begin → dragActive = true, vSpin = 0  (kill any in-flight inertia)
  //   by    → spin/spinTarget direct write (1:1 with pointer; no ease)
  //   end   → dragActive = false, vSpin = released angular velocity
  let spin = 0;
  let spinTarget = 0;
  let vSpin = 0;
  let dragActive = false;

  function triggerTurn() {
    spinTarget += TURN_ANGLE;
    // A discrete `turn` action overrides any in-flight release inertia. If
    // we left vSpin alive, the inertia integration would fight the eased
    // approach to spinTarget. Discrete > momentum.
    vSpin = 0;
  }

  function dragRotateBegin() {
    dragActive = true;
    vSpin = 0;
  }

  // Live drag move — writes BOTH `spin` and `spinTarget` to the same value
  // so the rotation is 1:1 with the pointer (no easing lag during the drag,
  // no snap-back from the eased approach). The per-frame ease in update()
  // is then a no-op while spin === spinTarget. The existing `turn` action
  // and the idle yaw-sway still work unchanged on top (sway is added to
  // spin every frame, regardless of how spin got there).
  // Called externally via invokeSceneAction(i, "dragRotateBy", delta).
  function dragRotateBy(deltaRadians) {
    spin += deltaRadians;
    spinTarget = spin;
  }

  function dragRotateEnd(angularVelocity) {
    dragActive = false;
    // The panel measures release velocity in rad/s and hands it here. The
    // per-frame integrator (update()) decays it down to zero.
    vSpin = angularVelocity || 0;
  }

  // ---- DRAG SURFACE FOOTPRINT ------------------------------------------
  // The scene owns the camera and the model, so it owns the math for
  // converting "model size in world units" → "drag area size in CSS pixels".
  // The PANEL owns the surface DOM element and hands it to us once via
  // `bindDragSurface`. From then on, we write width/height into it via
  // --drag-w / --drag-h whenever the inputs change (model swap, resize).
  //
  // currentCanvasH is the only canvas dimension we need for the math (the
  // projection is uniform — vertical FOV maps world units to pixels through
  // canvas HEIGHT regardless of aspect). We track it via the resize hook.
  // currentModelSize is the post-autoFit bounding box, captured after each
  // model setup (fallback or GLB swap).
  let dragSurfaceEl = null;
  let currentCanvasH = height;
  const currentModelSize = new THREE.Vector3(1, 1, 1);
  // Responsive sizing — recomputed in the resize hook when the viewport
  // class changes. Drives autoFit AND the bob amplitude scaling so the
  // motion feels proportional regardless of viewport.
  //
  // PER-MODEL MULTIPLIER: panel.modelScale (authored in main.js next to
  // `file`) scales the responsive baseline for THIS instance. 1 = shared
  // default; 1.2 = 20% bigger at every viewport width. Folded into
  // currentTargetSize (not applied only at autoFit) deliberately: the
  // drag-surface footprint and the bob amplitude (via sizeRatio) follow
  // the tuned size automatically — a bigger model bobs proportionally
  // more and its drag surface hugs its actual footprint.
  //
  // The ANNOTATION apparatus is the deliberate exception: it reads the
  // UNTUNED envelope via annEnvScale, so the readout graphics and the
  // heading dial stay the same size across all turn panels regardless of
  // per-model tuning. autoFit is uniform, so multiplying fitted extents
  // by annEnvScale (= 1 / modelScale) recovers the untuned extent exactly.
  const modelScale =
    (panel && Number.isFinite(panel.modelScale) && panel.modelScale > 0)
      ? panel.modelScale
      : 1;
  const targetSize = () => computeTargetSize() * modelScale;
  const annEnvScale = 1 / modelScale;
  let currentTargetSize = targetSize();

  function captureModelSize(model) {
    new THREE.Box3().setFromObject(model).getSize(currentModelSize);
  }

  // Apply autoFit + captureModelSize safely against ancestor transforms.
  //
  // THE BUG THIS FIXES: setFromObject (used by both autoFit and
  // captureModelSize) computes the WORLD-space bbox. When the model is
  // attached to a holder that has been rotated by the user, the world
  // bbox is rotated too, and autoFit's recenter step (object3d.position
  // .sub(center)) mixes that world-space center with a local-space
  // position write. Each resize-after-rotate then drifts the model
  // further off origin until it flies out of frame. For a non-cube model
  // (or a cube authored corner-at-origin, very common in Blender), this
  // is immediately visible.
  //
  // THE FIX: detach the model before fitting. With no parent,
  // matrixWorld = matrix, so setFromObject reads the LOCAL extent — the
  // same coordinate space as the position write. The math then composes
  // correctly. We reattach after; the holder's rotation was never touched,
  // so the user's drag state survives unchanged.
  //
  // captureModelSize is folded into the same helper because we want the
  // un-rotated extent for the drag-surface envelope too. Otherwise the
  // drag surface would resize as the user spun a non-cube model.
  //
  // Idempotent across callers: at initial fallback build and on GLB-load
  // swap, the model is already detached (autoFit-then-add was the previous
  // ordering), so the remove/add here are no-ops.
  function refitModel() {
    if (!currentModel) return;
    const parent = currentModel.parent;
    if (parent) parent.remove(currentModel);
    autoFit(THREE, currentModel, currentTargetSize);
    captureModelSize(currentModel);
    if (parent) parent.add(currentModel);
  }

  function writeFootprint() {
    if (!dragSurfaceEl) return;
    // Standard perspective projection: a world-unit length at the camera's
    // focal plane projects to canvasH / (2 * dist * tan(fov/2)) pixels.
    // This is per WORLD unit, independent of horizontal aspect.
    const fovRad = CAMERA_FOV * Math.PI / 180;
    const pxPerWorld = currentCanvasH / (2 * CAMERA_DISTANCE * Math.tan(fovRad / 2));
    const worldW = currentModelSize.x + 2 * DRAG_SURFACE_PAD;
    // Vertical envelope includes the peak bob amplitude on each side, since
    // the bob translates without changing the bbox. The bob is scaled by
    // sizeRatio in update() (see there), so we apply the same scaling here
    // — otherwise the drag surface would over-pad vertically on mobile.
    const sizeRatio = currentTargetSize / TARGET_SIZE_MAX;
    const peakBob = (FLOAT_A + FLOAT_B) * sizeRatio;
    const worldH = currentModelSize.y + 2 * DRAG_SURFACE_PAD + 2 * peakBob;
    dragSurfaceEl.style.setProperty("--drag-w", `${worldW * pxPerWorld}px`);
    dragSurfaceEl.style.setProperty("--drag-h", `${worldH * pxPerWorld}px`);
  }

  function bindDragSurface(el) {
    dragSurfaceEl = el;
    // Initial write — the model is already set up by this point (eager scene
    // build), so currentModelSize is meaningful. If GLB loads later, the
    // .then below re-runs writeFootprint with the loaded model's bbox.
    writeFootprint();
  }

  // ---- ANIMATION MODE (read from PANELS entry) -------------------------
  // The panel's `enter` and `exit` fields select WHICH animation primitives
  // run on each transition. We read them once here at build time (so the
  // per-frame update doesn't redo this lookup every frame) and store flags.
  // A panel with neither field falls back to the module defaults.
  const enterMode = (panel && panel.enter) || DEFAULT_ENTER;
  const exitMode  = (panel && panel.exit)  || DEFAULT_EXIT;

  // Pre-compute flags. Doing this once at build time keeps update() free of
  // string comparisons in the hot path.
  const enterGrows = enterMode === "grow" || enterMode === "both";
  const enterFades = enterMode === "fade" || enterMode === "both";
  const exitShrinks = exitMode === "shrink" || exitMode === "both";
  const exitFades   = exitMode === "fade"   || exitMode === "both";

  // ---- SELF-DRIVEN ANIMATION STATE -------------------------------------
  // Two independent 0..1 values, one per visual property:
  //   growScale  → drives levitate.scale (0 = invisible, 1 = full size)
  //   growOpacity → drives every fadeable material's opacity
  // Each eases on its own clock at its own speed constant (see the four
  // SPEED constants above). The PER-DIRECTION speed depends on whether the
  // animation is entering (target=1) or exiting (target=0).
  //
  // STARTING STATE (used both at construction AND on every re-enter — see
  // "RISING-EDGE RESET" in update() below):
  //   - Property animated by the enter mode → starts at 0 (will ease to 1).
  //   - Property NOT animated by the enter mode → starts at 1 (always
  //     visible at full value for the duration of the enter animation).
  //
  // This means: for "enter: grow, exit: fade", the scene exits with
  // scale=1, opacity=0. On re-enter, we RESET both back to their starting
  // states (scale=0, opacity=1) before the grow-in begins again. Without
  // this reset, opacity would stay at 0 and the model would be invisible
  // forever.
  const animState = {
    growScale:   enterGrows ? 0 : 1,
    growOpacity: enterFades ? 0 : 1,
  };

  // Last-frame `target` value, for rising-edge detection in update(). Starts
  // at 0 (matches "panel hasn't been entered yet"), so the very first frame
  // where target becomes 1 fires the reset path — which is a no-op because
  // animState is already in its starting state. Subsequent re-enters trigger
  // a real reset.
  let lastTarget = 0;

  // The handoff-gate weight is the MIN of the two — the scene is "still
  // present" only as much as its LIMITING property says it is. If scale is
  // 0 but opacity is 1, nothing is visible (scale=0 means nothing renders),
  // so weight should be 0. If scale is 1 but opacity is 0.3, the scene is
  // 30% visible — that's what blocks the next panel's entry.
  //
  // This formula generalizes across all 9 enter×exit combinations: for a
  // mode that doesn't animate a property in the active direction, that
  // property is pinned at 1 by the rising-edge reset, so MIN correctly
  // reads the eased property as the weight.
  registerWeight(panelIndex, () => Math.min(animState.growScale, animState.growOpacity));

  // Collect fadeable materials from a given root. Called once after the
  // fallback is added, and again if a GLB swaps the fallback out. We force
  // `transparent = true` on every material — required for opacity < 1 to
  // render correctly. (If the panel's mode never fades, the opacity write
  // in update() pegs at 1.0, which is harmless.)
  const fadeMats = [];
  function collectFadeMats(root) {
    fadeMats.length = 0;
    root.traverse((obj) => {
      if (!obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        m.transparent = true;
        fadeMats.push(m);
      }
    });
  }

  // ---- SURFACE FILL + OUTLINE STATE (scene-local shading) --------------
  // The toon gradient ramp is shared module-wide (cached by step count) and
  // only built when FILL_MODE is "toon". The outline materials are per-instance
  // because their uOpacity uniform is driven by THIS scene's enter/exit fade.
  // Stored in a list (one entry in practice — a single shared material per
  // model) so the update loop and the rebuild-on-swap path can iterate
  // uniformly.
  const gradientMap = FILL_MODE === "toon" ? getToonGradientMap(THREE, TOON_STEPS) : null;
  const outlineMats = [];

  // (Re)build the outline for the current model. Disposes any previous outline
  // material first (matters on the fallback → GLB swap, where the old model's
  // outline children are dropped with their subtree by holder.remove). Adds one
  // shared back-side hull per mesh; all share a single material so they fade as
  // one. Sharing the base geometry is what keeps the bounding box — and thus
  // model sizing and the drag-surface footprint — unchanged (see the outline
  // helpers above registerSceneType).
  function rebuildOutlines(model) {
    for (let i = 0; i < outlineMats.length; i++) outlineMats[i].dispose();
    outlineMats.length = 0;
    if (!OUTLINE_ENABLED) return;
    const mat = makeOutlineMaterial(THREE);
    addOutlinesToModel(THREE, model, mat);
    outlineMats.push(mat);
  }

  // Full shading pass for a freshly-installed model (fallback or GLB). Replaces
  // the old bare collectFadeMats call at both model-setup sites below.
  // ORDER MATTERS: fill re-skin first, THEN collect fade materials (so the fade
  // drives the new fill mats), and ONLY THEN add outlines — outline opacity is
  // driven by its own shader uniform, so the outline meshes must stay out of
  // fadeMats. (collectFadeMats traverses the model, so adding outlines after it
  // keeps them uncollected without needing a skip-flag in that hot helper.)
  function applyShading(model) {
    if (FILL_MODE !== "original") applyFillToModel(THREE, model, FILL_MODE, gradientMap);
    collectFadeMats(model);
    rebuildOutlines(model);
  }

  // ---- MODEL CREATION + GLB LOAD ---------------------------------------
  // Start with the fallback so the scene works regardless of whether a GLB
  // is present. autoFit normalizes the framing for both fallback and GLB;
  // collectFadeMats wires up the material list for the fade animation.
  let currentModel = makeFallbackMesh(THREE);
  refitModel();
  holder.add(currentModel);
  applyShading(currentModel);
  writeFootprint();

  // Load the GLB if a file is specified — DEFERRED, not eager (see the
  // DEFERRED LOAD SCHEDULING block at module level for the full why). Two
  // triggers race, whichever fires first wins, the flag makes the loser a
  // no-op:
  //   1. an idle slice after first paint (the normal path — the model is
  //      ready long before the user scrolls to it), or
  //   2. the first update() call — the scene un-culls only when its panel
  //      first approaches (presence crosses SCENE_CULL), so this kick is
  //      the insurance for "user started scrolling before idle ever fired".
  // On arrival, swap the fallback out and re-collect fade materials from
  // the new model.
  //
  // No file → the flag starts settled so beginModelLoad (and update()'s
  // kick check) short-circuits forever.
  let modelLoadStarted = !(panel && panel.file);

  function beginModelLoad() {
    if (modelLoadStarted) return;
    modelLoadStarted = true;
    loadGltf(panel.file)
      .then((gltf) => {
        holder.remove(currentModel);
        currentModel = gltf.scene;
        // gltf.scene is detached at this point — refitModel's remove/add
        // pair is a no-op, but reads currentTargetSize at call time so a
        // mid-load viewport resize is still honored.
        refitModel();
        holder.add(currentModel);
        applyShading(currentModel);
        writeFootprint();
      })
      .catch((err) => {
        console.warn(`turnScene: failed to load "${panel.file}" for panel ${panelIndex}; using fallback.`, err);
      });
  }

  if (!modelLoadStarted) queueIdleLoad(beginModelLoad);


  // ---- PROBE ANNOTATIONS (hover-to-measure readouts) ----------------------
  // See the ANN_* constants block for the concept, spaces, and grammar
  // notes. Structure per callout k (three total, one stat each):
  //
  //        + anchor cross              (on the model's bounding envelope)
  //         \
  //          \   diagonal leader       (radial, ANN_DIAG_PX)
  //           \_____ shelf             (horizontal, ANN_SHELF_PX)
  //                  ROTATED > 34°     (canvas-texture label plane)
  //
  // The three anchor angles are re-rolled on every probe entry — one per
  // third of the circle with jitter, so the callouts never bunch but land
  // somewhere fresh each time (the instrument re-acquiring measurement
  // points). The whole apparatus is screen-facing at z=0 with
  // depthTest:false and high renderOrder — annotation chrome drawn over
  // the model, not in-world geometry.

  // Probe state. `probeHover` is written by the probeBegin/probeEnd
  // actions (forwarded by the panel from the drag surface's pointer
  // enter/leave); the EFFECTIVE probing state also includes dragActive,
  // so touch — which has no hover — gets the annotations while spinning.
  let probeHover = false;
  let probeAge = 0;                    // seconds since the current probe began
  let wasProbing = false;              // rising-edge detector for re-rolls
  let nextReacqIn = 0;                 // s until the next re-acquisition beat
  const annBaseAngle   = [0, 0, 0];    // center of each callout's third
  const annTargetAngle = [0, 0, 0];    // where the callout is headed
  const annAnchorAngle = [0, 0, 0];    // eased fast — the + darts
  const annLabelAngle  = [0, 0, 0];    // eased slow — the readout glides after
  const annSides  = [1, 1, 1];         // +1 label extends right, -1 left
  const annGrow   = [0, 0, 0];         // per-callout extension ease, 0..1

  // Free fiducials: current + target positions (straight-line dart), one
  // independent re-acq timer each, and a per-cross deploy grow.
  const freeX  = new Array(ANN_FREE_COUNT).fill(0);
  const freeY  = new Array(ANN_FREE_COUNT).fill(0);
  const freeTX = new Array(ANN_FREE_COUNT).fill(0);
  const freeTY = new Array(ANN_FREE_COUNT).fill(0);
  const freeReacqIn = new Array(ANN_FREE_COUNT).fill(0);
  const freeGrow    = new Array(ANN_FREE_COUNT).fill(0);

  // Acquisition frame: deploy grow + the lagged bob-tracking channel.
  let frameGrow = 0;
  let frameLagY = 0;

  // Linked pair: two marks joined by a live link. Per-end current + target
  // positions (straight-line dart) and independent re-acq clocks; the pair
  // deploys as ONE instrument (single grow).
  const pairX  = [0, 0], pairY  = [0, 0];
  const pairTX = [0, 0], pairTY = [0, 0];
  const pairReacqIn = [0, 0];
  let pairGrow = 0;

  // Heading index: deploy grow only — its position is the live heading.
  let headingGrow = 0;

  function probeBegin() { probeHover = true; }
  function probeEnd()   { probeHover = false; }

  // The anchor ring — the bbox's bounding circle (half-diagonal clears the
  // silhouette at any heading) plus the tuned pad. Reads currentModelSize
  // live so a resize refit moves the ring. Shared by the callout anchors,
  // the free-fiducial scatter, and updateAnnotations.
  //
  // annEnvScale backs the per-model size tuning out of the fitted bbox, so
  // the ring (and the dial derived from it) is identical across panels —
  // see the sizing block in the factory where annEnvScale is defined.
  function annRingRadius() {
    return 0.5 * Math.hypot(currentModelSize.x, currentModelSize.y) * annEnvScale +
           ANN_ANCHOR_PAD_WORLD;
  }

  function rollFreeTarget(j) {
    const a = Math.random() * Math.PI * 2;
    const r = annRingRadius() + Math.random() * ANN_FREE_SPREAD_PX * wUnit;
    freeTX[j] = Math.cos(a) * r;
    freeTY[j] = Math.sin(a) * r;
  }

  function rollPairTarget(e) {
    // Same scatter as the free fiducials, but reject targets that would
    // collapse the link below its minimum reading length. The retry cap
    // means a pathological run of rejections just accepts the last pick —
    // a rare short link beats an infinite loop.
    const minSep = ANN_PAIR_MIN_SEP_PX * wUnit;
    for (let tries = 0; tries < 4; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = annRingRadius() + Math.random() * ANN_FREE_SPREAD_PX * wUnit;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (tries === 3 ||
          Math.hypot(x - pairTX[1 - e], y - pairTY[1 - e]) >= minSep) {
        pairTX[e] = x;
        pairTY[e] = y;
        return;
      }
    }
  }

  function rollAnchors() {
    // One angle per third of the circle (guaranteed spread), jittered
    // within its third, the whole set rotated by a random offset so the
    // thirds themselves aren't a fixed grid. Sides derive from the
    // anchor's hemisphere so a label always extends AWAY from the model.
    // All three angle channels start coincident; re-acquisition later
    // moves the target and lets the anchor/label eases chase it.
    const offset = Math.random() * Math.PI * 2;
    for (let k = 0; k < 3; k++) {
      const base = offset + k * (Math.PI * 2 / 3);
      const a = base + (Math.random() - 0.5) * 1.1;   // ±0.55 rad in the third
      annBaseAngle[k]   = base;
      annTargetAngle[k] = a;
      annAnchorAngle[k] = a;
      annLabelAngle[k]  = a;
      annSides[k] = Math.cos(a) >= 0 ? 1 : -1;
    }
    // Free fiducials scatter fresh too — current snaps to target (no dart
    // on entry; they pop in place via their deploy grow) and each timer
    // restarts on its own random beat.
    for (let j = 0; j < ANN_FREE_COUNT; j++) {
      rollFreeTarget(j);
      freeX[j] = freeTX[j];
      freeY[j] = freeTY[j];
      freeReacqIn[j] = ANN_FREE_REACQ_MIN_S +
        Math.random() * (ANN_FREE_REACQ_MAX_S - ANN_FREE_REACQ_MIN_S);
    }
    // The linked pair scatters fresh too — end 0 first so end 1's
    // separation check sees a real position, currents snapped to targets.
    for (let e = 0; e < 2; e++) {
      rollPairTarget(e);
      pairX[e] = pairTX[e];
      pairY[e] = pairTY[e];
      pairReacqIn[e] = ANN_PAIR_REACQ_MIN_S +
        Math.random() * (ANN_PAIR_REACQ_MAX_S - ANN_PAIR_REACQ_MIN_S);
    }
  }

  // World-units-per-screen-pixel at the model's plane — the px→world
  // bridge for everything outward of the anchor ring. Same projection
  // math writeFootprint uses; cached and refreshed in resize().
  function computeWUnit(h) {
    const vFOV = CAMERA_FOV * Math.PI / 180;
    return (2 * Math.tan(vFOV / 2) * CAMERA_DISTANCE) / h;
  }
  let wUnit = computeWUnit(height);

  // LEADER LINES — one LineSegments holding the segment-drawn apparatus:
  // 3 callouts × 4 segments (cross ×2, diagonal, shelf), ANN_FREE_COUNT
  // free fiducials × 2 (cross arms), the linked pair (2 crosses × 2 + the
  // link = 5), and the acquisition frame's 4 corners × 2 arms. (The
  // heading tick is a quad — see tickMesh — since GL lines can't
  // thicken.) Positions are rewritten per frame while anything is
  // deployed — a few hundred floats, nothing. GL lines rasterize at 1px
  // regardless of driver — exactly the hairline the vocabulary wants.
  const ANN_SEGMENTS = 3 * 4 + ANN_FREE_COUNT * 2 + 5 + 4 * 2;
  const annLinePositions = new Float32Array(ANN_SEGMENTS * 2 * 3);
  const annLineGeometry = new THREE.BufferGeometry();
  const annLinePosAttr = new THREE.BufferAttribute(annLinePositions, 3);
  annLinePosAttr.setUsage(THREE.DynamicDrawUsage);
  annLineGeometry.setAttribute("position", annLinePosAttr);
  const annLineMaterial = new THREE.LineBasicMaterial({
    color: ANN_LINE_COLOR,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,                  // chrome: always over the model
  });
  const annLines = new THREE.LineSegments(annLineGeometry, annLineMaterial);
  annLines.renderOrder = 100;          // after the model (default 0)
  annLines.frustumCulled = false;      // positions churn; skip stale-bounds culling
  scene.add(annLines);

  // HEADING DIAL DOTS — a THREE.Points card (real points, not 1px line
  // stubs, which alias badly at dot scale). sizeAttenuation:false keeps
  // the size in screen pixels; the devicePixelRatio multiply mirrors how
  // dotsScene handles point sizing — window DPR capped at 2, which may
  // run a hair large if the renderer caps lower, but that's a cosmetic
  // half-pixel, tunable via ANN_DIAL_DOT_PX. Positions are rewritten per
  // frame like the lines; the deploy reveal is via setDrawRange — the
  // card sweeps in dot by dot rather than fading.
  const dialPositions = new Float32Array(ANN_DIAL_DOT_COUNT * 3);
  const dialGeometry = new THREE.BufferGeometry();
  const dialPosAttr = new THREE.BufferAttribute(dialPositions, 3);
  dialPosAttr.setUsage(THREE.DynamicDrawUsage);
  dialGeometry.setAttribute("position", dialPosAttr);
  dialGeometry.setDrawRange(0, 0);
  const ANN_DPR = Math.min(window.devicePixelRatio || 1, 2);
  const dialMaterial = new THREE.PointsMaterial({
    color: ANN_LINE_COLOR,
    size: ANN_DIAL_DOT_PX * ANN_DPR,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  const dialDots = new THREE.Points(dialGeometry, dialMaterial);
  dialDots.renderOrder = 99;           // beneath the lines, above the model
  dialDots.frustumCulled = false;
  scene.add(dialDots);

  // HEADING TICK — a thin quad, not a GL line: WebGL ignores linewidth on
  // nearly every platform, so real thickness needs geometry. Unit plane,
  // positioned/rotated/scaled per frame (local X = length along the
  // radial, local Y = thickness).
  const tickMaterial = new THREE.MeshBasicMaterial({
    color: ANN_LINE_COLOR,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  const tickMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), tickMaterial);
  tickMesh.renderOrder = 102;          // over the card and the leaders
  tickMesh.frustumCulled = false;
  scene.add(tickMesh);

  // HOT DOT — the active index: a single-point layer that overdraws the
  // card dot under the needle (PointsMaterial is uniform per object, so
  // one dot at a different size/color means a second object). It SNAPS
  // from dot to dot while the needle sweeps continuously between them.
  const hotDotPositions = new Float32Array(3);
  const hotDotGeometry = new THREE.BufferGeometry();
  const hotDotPosAttr = new THREE.BufferAttribute(hotDotPositions, 3);
  hotDotPosAttr.setUsage(THREE.DynamicDrawUsage);
  hotDotGeometry.setAttribute("position", hotDotPosAttr);
  const hotDotMaterial = new THREE.PointsMaterial({
    color: ANN_DIAL_HOT_COLOR,
    size: ANN_DIAL_DOT_PX * ANN_DIAL_HOT_SCALE * ANN_DPR,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  const hotDot = new THREE.Points(hotDotGeometry, hotDotMaterial);
  hotDot.renderOrder = 103;            // over everything in the apparatus
  hotDot.frustumCulled = false;
  scene.add(hotDot);

  // LABEL PLANES — one small canvas texture per stat; same canvas-plane
  // pattern the old HUD (and dotsScene's counter) used. Fixed PIXEL size
  // via wUnit; geometry rebuilt on resize.
  const annInk   = new THREE.Color(ANN_TEXT_COLOR);
  const annGlowC = new THREE.Color(ANN_GLOW_COLOR);
  const annMix   = new THREE.Color();
  const annLabels = [0, 1, 2].map(() => {
    const canvas = document.createElement("canvas");
    canvas.width  = ANN_LABEL_W_PX * ANN_CANVAS_UPSCALE;
    canvas.height = ANN_LABEL_H_PX * ANN_CANVAS_UPSCALE;
    const ctx2d = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = 101;            // above the leader lines
    scene.add(mesh);
    return {
      canvas, ctx2d, texture, mat, mesh,
      lastText: null,       // repaint gate
      visible: false,       // discrete show/hide at full line extension
      glowAge: Infinity,    // appearance-afterglow clock; Infinity = settled
    };
  });

  function applyAnnLabelGeometry() {
    const w = ANN_LABEL_W_PX * wUnit;
    const h = ANN_LABEL_H_PX * wUnit;
    for (const l of annLabels) {
      l.mesh.geometry.dispose();
      l.mesh.geometry = new THREE.PlaneGeometry(w, h);
    }
  }
  applyAnnLabelGeometry();

  // Repaint one label. `side` picks the text alignment so the text always
  // hugs the shelf end (left-aligned on right-hemisphere callouts, right-
  // aligned on left ones). `glow` 0..1 lerps ink → write-flash blue: the
  // same afterglow the DISPLACED counter uses, but fired ONCE, on the
  // label's APPEARANCE — a discrete write. The per-frame value updates
  // that follow are continuously varying and get no glow
  // (visualLanguage.md's continuously-varying exclusion).
  function renderAnnLabel(l, text, side, glow) {
    const cw = l.canvas.width;
    const ch = l.canvas.height;
    l.ctx2d.clearRect(0, 0, cw, ch);
    const fontPx = ANN_TEXT_HEIGHT_PX * ANN_CANVAS_UPSCALE;
    l.ctx2d.font = `${fontPx}px ${ANN_FONT_FAMILY}`;
    // letterSpacing on Canvas 2D: Chrome 99+/Safari 16+/Firefox 113+;
    // older browsers silently render tighter. Same fallback as before.
    l.ctx2d.letterSpacing = ANN_LETTER_SPACING;
    l.ctx2d.textBaseline = "middle";
    const padPx = 2 * ANN_CANVAS_UPSCALE;
    annMix.copy(annInk).lerp(annGlowC, glow);
    l.ctx2d.fillStyle = `#${annMix.getHexString()}`;
    if (side >= 0) {
      l.ctx2d.textAlign = "left";
      l.ctx2d.fillText(text, padPx, ch / 2);
    } else {
      l.ctx2d.textAlign = "right";
      l.ctx2d.fillText(text, cw - padPx, ch / 2);
    }
    l.texture.needsUpdate = true;
  }

  // Canvas fillText won't re-rasterize when a late-loading font resolves
  // (same issue the old HUD and dotsScene handle). Request Hornet at our
  // size; on resolve, void the repaint gates so the next probed frame
  // repaints with the real face. No eager repaint needed — labels are
  // invisible until a probe happens, which is after fonts settle in
  // practice; and a fallback-face label is better than a blank one.
  if (document.fonts && typeof document.fonts.load === "function") {
    const fontPx = ANN_TEXT_HEIGHT_PX * ANN_CANVAS_UPSCALE;
    document.fonts.load(`${fontPx}px "Hornet Display"`)
      .then(() => { for (const l of annLabels) l.lastText = null; })
      .catch(() => { /* fallback face is fine */ });
  }

  // Segment writer for the leader-line buffer. Returns the advanced cursor.
  function writeSeg(p, x1, y1, x2, y2) {
    annLinePositions[p++] = x1; annLinePositions[p++] = y1; annLinePositions[p++] = 0;
    annLinePositions[p++] = x2; annLinePositions[p++] = y2; annLinePositions[p++] = 0;
    return p;
  }

  // Per-frame geometry + label pass while any callout is extended. All
  // lengths outward of the anchor ring are px→world via wUnit.
  const annTexts = ["", "", ""];
  function updateAnnotations(angleStr, velStr, rotationStr, sceneVis, dt, t,
                             bobY, headingY) {
    // Anchor ring — see annRingRadius (shared with the fiducial scatter).
    const annR = annRingRadius();

    annTexts[0] = `ROTATED > ${rotationStr}°`;
    annTexts[1] = `CUR.ANGLE > ${angleStr}°`;
    annTexts[2] = `VELOCITY > ${velStr}°/s`;

    const crossW    = ANN_CROSS_PX * wUnit;
    const diagW     = ANN_DIAG_PX  * wUnit;
    const shelfW    = ANN_SHELF_PX * wUnit;
    const gapW      = ANN_LEADER_GAP_PX * wUnit;
    const driftW    = ANN_DRIFT_AMP_PX * wUnit;
    const labelHalf = (ANN_GAP_PX + ANN_LABEL_W_PX / 2) * wUnit;
    const labelLift = (ANN_LABEL_H_PX / 2 + 1) * wUnit;   // bottom edge ~1px above shelf

    let p = 0;   // write cursor into annLinePositions
    for (let k = 0; k < 3; k++) {
      const g = annGrow[k];
      const side = annSides[k];

      // Chase the target: the anchor darts (fast ease), the label glides
      // (slow ease). At rest all three angles coincide and the leader is
      // purely radial; during a re-acquisition they diverge and the
      // leader stretches between them — connected at both ends.
      annAnchorAngle[k] += (annTargetAngle[k] - annAnchorAngle[k]) *
        (1 - Math.exp(-ANN_ANCHOR_MOVE_SPEED * dt));
      annLabelAngle[k] += (annTargetAngle[k] - annLabelAngle[k]) *
        (1 - Math.exp(-ANN_LABEL_FOLLOW_SPEED * dt));

      const ax = Math.cos(annAnchorAngle[k]) * annR;
      const ay = Math.sin(annAnchorAngle[k]) * annR;

      // DRIFT (machinery idle) — the label end floats on per-callout
      // incommensurate sine sums; the anchor stays dead still. Same
      // sum-of-sines recipe as the model's levitate, tiny amplitude.
      const ph = k * 2.1 + panelIndex * PHASE_PER_INDEX;
      const driftX = (Math.sin(t * 0.50 + ph) +
                      Math.sin(t * 0.23 + ph * 1.7)) * 0.5 * driftW;
      const driftY = (Math.sin(t * 0.41 + ph * 1.3) +
                      Math.sin(t * 0.19 + ph * 0.6)) * 0.5 * driftW;

      // Elbow rides the LAGGED angle plus drift.
      const ex = Math.cos(annLabelAngle[k]) * (annR + diagW) + driftX;
      const ey = Math.sin(annLabelAngle[k]) * (annR + diagW) + driftY;

      // Leader: starts a gap short of the cross, aimed at the live elbow.
      let ndx = ex - ax, ndy = ey - ay;
      const nLen = Math.hypot(ndx, ndy) || 1;
      ndx /= nLen; ndy /= nLen;
      const lx = ax + ndx * gapW;            // leader start (off the cross)
      const ly = ay + ndy * gapW;

      // The cross pops in fast relative to the leader draw (a discrete
      // acquisition mark, softened just enough not to be a 1-frame pop).
      const cs = Math.min(1, g * 4) * crossW;
      // Draw-on: the diagonal covers grow 0..DIAG_FRAC, the shelf the rest.
      const dT = Math.min(1, g / ANN_DIAG_FRAC);
      const sT = Math.max(0, (g - ANN_DIAG_FRAC) / (1 - ANN_DIAG_FRAC));
      const dx = lx + (ex - lx) * dT;        // diagonal tip (as drawn)
      const dy = ly + (ey - ly) * dT;
      const sx = ex + side * shelfW * sT;    // shelf tip (as drawn)

      p = writeSeg(p, ax - cs, ay, ax + cs, ay);   // cross —
      p = writeSeg(p, ax, ay - cs, ax, ay + cs);   // cross |
      p = writeSeg(p, lx, ly, dx, dy);             // diagonal leader
      p = writeSeg(p, ex, ey, sx, ey);             // shelf (degenerate until sT>0)

      // Label: discrete show at full extension, discrete hide the moment
      // retraction starts — information appears and disappears as an
      // event, it never fades. Appearance re-arms the write-flash.
      const l = annLabels[k];
      const show = g > 0.98;
      if (show && !l.visible) { l.glowAge = 0; l.lastText = null; }
      l.visible = show;
      l.mat.opacity = show ? sceneVis : 0;

      if (show) {
        l.mesh.position.set(ex + side * (shelfW + labelHalf), ey + labelLift, 0);
        const glowing = l.glowAge < ANN_GLOW_SECONDS;
        if (glowing) l.glowAge += dt;
        if (l.lastText !== annTexts[k] || glowing) {
          const remain = Math.max(0, 1 - l.glowAge / ANN_GLOW_SECONDS);
          renderAnnLabel(l, annTexts[k], side, remain * remain);
          l.lastText = annTexts[k];
        }
      }
    }

    // FREE FIDUCIALS — unassigned registration marks: straight-line dart
    // toward their targets (same machinery ease as the callout anchors),
    // cross popping with each mark's own deploy grow. No leader, no label.
    const freeCrossW = ANN_FREE_CROSS_PX * wUnit;
    const dartEase = 1 - Math.exp(-ANN_ANCHOR_MOVE_SPEED * dt);
    for (let j = 0; j < ANN_FREE_COUNT; j++) {
      freeX[j] += (freeTX[j] - freeX[j]) * dartEase;
      freeY[j] += (freeTY[j] - freeY[j]) * dartEase;
      const cs = Math.min(1, freeGrow[j] * 4) * freeCrossW;
      p = writeSeg(p, freeX[j] - cs, freeY[j], freeX[j] + cs, freeY[j]);
      p = writeSeg(p, freeX[j], freeY[j] - cs, freeX[j], freeY[j] + cs);
    }

    // LINKED PAIR — two marks whose link is ALWAYS connected at both
    // ends: each end darts on its own clock and the line stretches live
    // between them, gapped off both crosses like every leader. The link
    // draws outward from its midpoint on deploy. If the ends transit
    // close enough that the gaps would cross, the gap is dropped for
    // those frames rather than letting the link invert.
    for (let e = 0; e < 2; e++) {
      pairX[e] += (pairTX[e] - pairX[e]) * dartEase;
      pairY[e] += (pairTY[e] - pairY[e]) * dartEase;
    }
    {
      const cs = Math.min(1, pairGrow * 4) * freeCrossW;
      p = writeSeg(p, pairX[0] - cs, pairY[0], pairX[0] + cs, pairY[0]);
      p = writeSeg(p, pairX[0], pairY[0] - cs, pairX[0], pairY[0] + cs);
      p = writeSeg(p, pairX[1] - cs, pairY[1], pairX[1] + cs, pairY[1]);
      p = writeSeg(p, pairX[1], pairY[1] - cs, pairX[1], pairY[1] + cs);

      let ux = pairX[1] - pairX[0];
      let uy = pairY[1] - pairY[0];
      const uLen = Math.hypot(ux, uy) || 1;
      ux /= uLen; uy /= uLen;
      const linkGap = uLen > 4 * gapW ? gapW : 0;
      const ax0 = pairX[0] + ux * linkGap, ay0 = pairY[0] + uy * linkGap;
      const bx0 = pairX[1] - ux * linkGap, by0 = pairY[1] - uy * linkGap;
      const mx = (ax0 + bx0) / 2, my = (ay0 + by0) / 2;
      p = writeSeg(p,
        mx + (ax0 - mx) * pairGrow, my + (ay0 - my) * pairGrow,
        mx + (bx0 - mx) * pairGrow, my + (by0 - my) * pairGrow);
    }

    // HEADING DIAL — the card the tick rides through. Dots laid from
    // twelve o'clock, clockwise (the tick's convention), so the deploy
    // sweep and the needle share an origin. drawRange does the reveal —
    // ceil(N × grow) dots — while positions track the live dial radius.
    const dialR = annR * ANN_DIAL_RADIUS_SCALE + ANN_DIAL_RADIUS_PAD_PX * wUnit;
    for (let d = 0; d < ANN_DIAL_DOT_COUNT; d++) {
      const a = Math.PI / 2 - (d / ANN_DIAL_DOT_COUNT) * Math.PI * 2;
      dialPositions[d * 3]     = Math.cos(a) * dialR;
      dialPositions[d * 3 + 1] = Math.sin(a) * dialR;
      dialPositions[d * 3 + 2] = 0;
    }
    dialPosAttr.needsUpdate = true;
    dialGeometry.setDrawRange(0, Math.ceil(ANN_DIAL_DOT_COUNT * headingGrow));

    // HEADING INDEX — the needle: a thin quad riding the dial at the
    // model's live heading. Driven 1:1 by the simulation — the
    // analog-gauge case: a needle driven live is machinery, not a tweened
    // value, the same continuous-motion license the rotating model has.
    // The hot dot is its discrete counterpart: the card index under the
    // needle, snapping dot to dot while the needle sweeps between them.
    {
      const hA = Math.PI / 2 - headingY;
      const hx = Math.cos(hA);
      const hy = Math.sin(hA);
      tickMesh.position.set(hx * dialR, hy * dialR, 0);
      tickMesh.rotation.z = hA;
      tickMesh.scale.set(
        Math.max(ANN_HEADING_TICK_PX * wUnit * headingGrow, 1e-6),
        Math.max(ANN_HEADING_TICK_THICK_PX * wUnit, 1e-6),
        1
      );

      if (ANN_DIAL_DOT_COUNT > 0) {
        const N = ANN_DIAL_DOT_COUNT;
        // Which dot the needle is over: dot d sits at π/2 − d·2π/N and
        // the needle at π/2 − headingY, so d = headingY·N/2π — rounded to
        // the nearest index, wrapped positive.
        const d = ((Math.round(headingY / (Math.PI * 2) * N) % N) + N) % N;
        const a = Math.PI / 2 - (d / N) * Math.PI * 2;
        hotDotPositions[0] = Math.cos(a) * dialR;
        hotDotPositions[1] = Math.sin(a) * dialR;
        hotDotPositions[2] = 0;
        hotDotPosAttr.needsUpdate = true;
        hotDotMaterial.size =
          ANN_DIAL_DOT_PX * ANN_DIAL_HOT_SCALE * ANN_DPR * headingGrow;
      }
    }

    // ACQUISITION FRAME — four corner brackets around the model's
    // UN-ROTATED footprint (deliberately the same choice as the drag
    // surface: the envelope doesn't resize as the model spins). The frame
    // chases the rendered bob through a lagged ease — a tracking reticle,
    // always a beat behind the target — plus a whisper of horizontal
    // drift. Arms draw on from the corners with the frame's deploy grow.
    frameLagY += (bobY - frameLagY) * (1 - Math.exp(-ANN_FRAME_FOLLOW_SPEED * dt));
    // annEnvScale: frame extents read the UNTUNED envelope, matching the
    // anchor ring — per-model size tuning moves the model, not the frame.
    const fHalfW = currentModelSize.x * annEnvScale / 2 + ANN_FRAME_PAD_PX * wUnit;
    const fHalfH = currentModelSize.y * annEnvScale / 2 + ANN_FRAME_PAD_PX * wUnit;
    const fArm = ANN_FRAME_CORNER_PX * wUnit * frameGrow;
    const fDriftX = (Math.sin(t * 0.34) + Math.sin(t * 0.13 + 2.4)) *
                    0.5 * ANN_FRAME_DRIFT_AMP_PX * wUnit;
    for (let cy = -1; cy <= 1; cy += 2) {
      for (let cx = -1; cx <= 1; cx += 2) {
        const kx = cx * fHalfW + fDriftX;
        const ky = cy * fHalfH + frameLagY;
        p = writeSeg(p, kx, ky, kx - cx * fArm, ky);   // horizontal arm, inward
        p = writeSeg(p, kx, ky, kx, ky - cy * fArm);   // vertical arm, inward
      }
    }

    annLinePosAttr.needsUpdate = true;
  }

  // ---- ROTATION INTEGRATOR STATE (feeds the annotation readouts) ---------
  // ROTATED accumulates |Δrotation.y| every frame, so even the idle sway
  // ticks the odometer up. VELOCITY is the per-frame Δ divided by dt
  // (smoothed). CUR.ANGLE is rotation.y mapped into signed (-180, 180].
  let cumulativeRotationRad = 0;
  let prevHolderY = 0;              // last frame's rotation.y for Δ math
  let displayVelDegPerSec = 0;      // smoothed velocity for display


  // ---- RETURN HOOKS -----------------------------------------------------
  return {
    // Update per frame. Drives the self-driven enter/exit animation
    // (independently for scale and opacity), the turn ease, and the idle
    // levitate motion. Composition is:
    //   levitate.scale    = growScale                     (enter/exit scale)
    //   material.opacity  = growOpacity (per material)    (enter/exit fade)
    //   levitate.position = (0, floatY * growScale, 0)    (vertical bob)
    //   spin              eases toward spinTarget         (turn action)
    //   holder.rotation.x = tip * growScale               (idle pitch)
    //   holder.rotation.y = spin + sway * growScale       (turn heading + yaw sway)
    //   holder.rotation.z = 0                             (no roll)
    // Idle amplitudes are scaled by `growScale` so they ease in/out
    // alongside the visible model (or stay at full amplitude if the
    // panel's mode never animates scale). `spin` is NOT scaled — the
    // heading persists even at zero scale, so a re-arrival comes back to
    // whatever heading was last set.
    update({ dt, t }) {
      // FIRST-APPROACH KICK. threeArray only calls update() once this
      // scene un-culls, i.e. its panel is approaching for the first time —
      // if the idle-slice load hasn't started by now, start it immediately
      // (see the MODEL CREATION block). Settles to a false compare after
      // the first kick; for fileless scenes it starts settled.
      if (!modelLoadStarted) beginModelLoad();

      // The handoff-gate target: 1 if we're clear to enter, 0 otherwise.
      // Both growScale and growOpacity ease toward this SAME target value;
      // they differ only in WHICH SPEED CONSTANT they use, and whether the
      // panel's mode even animates them.
      const target = isClearToEnter(panelIndex) ? 1 : 0;

      // RISING-EDGE RESET. When the panel transitions from exiting (or
      // never-yet-entered) to entering, reset both properties to their
      // enter starting states. This re-arms the enter animation cleanly:
      // the property animated by enter starts at 0 and eases up; the
      // property NOT animated by enter snaps to 1 so it's never "missing".
      //
      // Without this, a panel with "exit: fade" leaves growOpacity at 0,
      // and on re-enter the enter mode (e.g. "grow") wouldn't touch
      // opacity — so the model would be invisible forever. The reset is
      // what lets the same primitive run cleanly on every re-arrival.
      //
      // We only reset on RISING edge (target was 0, now 1). Falling edge
      // (entering → exiting) does NOT reset — the exit eases from
      // whatever current values are, so an aborted entry feels natural.
      if (target === 1 && lastTarget === 0) {
        animState.growScale   = enterGrows ? 0 : 1;
        animState.growOpacity = enterFades ? 0 : 1;
      }
      lastTarget = target;

      // SCALE EASING. Speed depends on direction (in vs out) and is only
      // applied if the panel's mode includes scale in that direction.
      // - target > growScale → we're heading in → use GROW_IN_SPEED if
      //   the enter mode grows scale; otherwise stay pinned (mode doesn't
      //   animate scale on the way in).
      // - target < growScale → we're heading out → use SHRINK_OUT_SPEED
      //   if exit shrinks; otherwise stay pinned at 1.
      if (target > animState.growScale && enterGrows) {
        animState.growScale +=
          (target - animState.growScale) * (1 - Math.exp(-GROW_IN_SPEED * dt));
      } else if (target < animState.growScale && exitShrinks) {
        animState.growScale +=
          (target - animState.growScale) * (1 - Math.exp(-SHRINK_OUT_SPEED * dt));
      }
      // If neither condition matched, growScale holds at its current value.
      // This is correct: when the panel's mode doesn't animate scale in
      // the current direction, scale should stay where the rising-edge
      // reset put it (1, in that case). When mid-ease and the user has
      // just reversed scroll direction, this also holds — the next frame
      // will match the new direction's condition.

      // OPACITY EASING. Same structure as scale, with the opacity flags
      // and constants. The two animations are fully independent: a panel
      // in "enter: both, exit: fade" mode gets growScale animating only on
      // enter and growOpacity animating in both directions.
      if (target > animState.growOpacity && enterFades) {
        animState.growOpacity +=
          (target - animState.growOpacity) * (1 - Math.exp(-FADE_IN_SPEED * dt));
      } else if (target < animState.growOpacity && exitFades) {
        animState.growOpacity +=
          (target - animState.growOpacity) * (1 - Math.exp(-FADE_OUT_SPEED * dt));
      }

      const growScale = animState.growScale;
      const growOpacity = animState.growOpacity;

      // APPLY: scale and opacity.
      levitate.scale.setScalar(growScale);
      for (let k = 0; k < fadeMats.length; k++) {
        fadeMats[k].opacity = growOpacity;
      }
      // Outline rim fades with the model. A raw ShaderMaterial ignores
      // .opacity, so we drive alpha through the uOpacity uniform instead.
      for (let k = 0; k < outlineMats.length; k++) {
        outlineMats[k].uniforms.uOpacity.value = growOpacity;
      }

      // Idle motion — sums of sines at incommensurate frequencies, with a
      // per-instance phase offset so multiple instances don't drift in unison.
      //   floatY (world units) → vertical bob, applied to position.y
      //   sway   (radians)     → yaw rotation around Y, ADDED to spin
      //   tip    (radians)     → pitch rotation around X
      //
      // BOB SCALES WITH RESPONSIVE TARGET SIZE. FLOAT_A/B are world-space
      // amplitudes calibrated for TARGET_SIZE_MAX = 1.0. When the model
      // shrinks on a narrow viewport, the bob would otherwise stay at the
      // same world-space amplitude — which reads as a disproportionately
      // larger bob relative to the smaller model. Scaling by sizeRatio
      // keeps the bob a consistent fraction of the model size. Sway and
      // tip are rotations (radians) — scale-invariant — so they're not
      // multiplied here.
      const phase = panelIndex * PHASE_PER_INDEX;
      const sizeRatio = currentTargetSize / TARGET_SIZE_MAX;
      const floatY =
        (Math.sin(t * FLOAT_W_A + phase) * FLOAT_A +
         Math.sin(t * FLOAT_W_B + phase) * FLOAT_B) * sizeRatio;
      const sway =
        Math.sin(t * SWAY_W_A + phase) * SWAY_A +
        Math.sin(t * SWAY_W_B + phase) * SWAY_B;
      const tip = Math.sin(t * TIP_W_A + phase * 1.3) * TIP_A;

      // Turn-action ease — `spin` is the held heading. Adding to spinTarget
      // queues additional rotations; the easing handles in-between cases.
      // Frame-rate independent via dt, same shape as grow easing above.
      //
      // Release-drag inertia is integrated FIRST (just below): it writes
      // both spin and spinTarget so the ease line is a no-op while inertia
      // is active. Once vSpin decays past INERTIA_STOP_OMEGA it snaps to 0,
      // spinTarget continues to equal spin, and the ease stays a no-op
      // until something else (a `turn` call, another drag) moves
      // spinTarget away from spin.
      if (!dragActive) {
        if (Math.abs(vSpin) > INERTIA_STOP_OMEGA) {
          spin += vSpin * dt;
          spinTarget = spin;
          vSpin *= Math.exp(-INERTIA_FRICTION * dt);
        } else if (vSpin !== 0) {
          vSpin = 0;
        }
      }
      spin += (spinTarget - spin) * (1 - Math.exp(-TURN_SPEED * dt));

      // Compose final transforms. Idle amplitudes scaled by growScale so
      // the motion eases in with the model's scale arrival.
      levitate.position.y = floatY * growScale;
      holder.rotation.set(tip * growScale, spin + sway * growScale, 0);

      // ---- ROTATION INTEGRATOR + PROBE ANNOTATIONS -------------------
      // Runs AFTER holder.rotation.set so we read the final composed
      // rotation for this frame. ΔrotationY captures everything that
      // moved the model this frame: drag, inertia decay, idle sway, and
      // the growScale ramp of sway during enter/exit. All of it ticks
      // the odometer and shows up in the velocity readout.
      const currentY = holder.rotation.y;
      const deltaY = currentY - prevHolderY;
      prevHolderY = currentY;

      // ROTATION (odometer): sum of |Δ| each frame. Monotonic, never
      // resets — even idle sway ticks it ~7°/sec.
      cumulativeRotationRad += Math.abs(deltaY);

      // VELOCITY (deg/sec, signed). Raw dθ/dt is jittery at small dt, so
      // we ease the *displayed* value. The min-dt guard prevents huge
      // spikes if dt comes in unusually small (first frame, etc).
      const safeDt = Math.max(dt, 0.001);
      const instantVelDeg = (deltaY / safeDt) * 180 / Math.PI;
      displayVelDegPerSec +=
        (instantVelDeg - displayVelDegPerSec) *
        (1 - Math.exp(-HUD_VELOCITY_SMOOTH_SPEED * dt));

      // NOTE: the integrators above (prevHolderY, cumulativeRotationRad,
      // displayVelDegPerSec) are STATEFUL and must run every frame — skip
      // a frame and the odometer under-counts, the velocity ease decays
      // from a stale sample. Their DISPLAY formatting, by contrast, is
      // pure and only consumed by updateAnnotations — so the string
      // builds (and the angle normalization that feeds one of them) live
      // inside the annVis gate below, next to their one consumer. The
      // probe apparatus is retracted almost all of the time; the settled
      // path pays for math, never for strings.

      // PROBE STATE. Self-heal first: if the scene is effectively
      // invisible (user scrolled away mid-hover), drop the hover latch —
      // pointerleave isn't guaranteed once the drag surface goes
      // pointer-events:none, so we can't rely on the panel to tell us.
      const sceneVis = Math.min(growScale, growOpacity);
      if (sceneVis < 0.05) probeHover = false;

      // Probing = hover OR active drag (the touch story — see header).
      const probing = probeHover || dragActive;

      // Rising edge → re-roll the anchor set, restart the stagger clock,
      // schedule the first re-acquisition beat, and sync the frame's
      // tracking channel to the current bob so it doesn't swoop on entry.
      if (probing && !wasProbing) {
        rollAnchors();
        probeAge = 0;
        nextReacqIn = ANN_REACQ_MIN_S +
          Math.random() * (ANN_REACQ_MAX_S - ANN_REACQ_MIN_S);
        frameLagY = floatY * growScale;
      }
      wasProbing = probing;
      if (probing) probeAge += dt;

      // RE-ACQUISITION — every few seconds, ONE anchor picks a fresh spot
      // within its third; the eases in updateAnnotations do the rest (the
      // + darts, the readout glides after). Only while fully deployed —
      // a jump during extension would read as a glitch — and never across
      // the hemisphere boundary, so a label never has to flip sides
      // mid-probe (a rejected pick just skips this beat; the miss is
      // invisible). Uneven interval, re-rolled per beat.
      if (probing && probeAge > 1.0) {
        nextReacqIn -= dt;
        if (nextReacqIn <= 0) {
          nextReacqIn = ANN_REACQ_MIN_S +
            Math.random() * (ANN_REACQ_MAX_S - ANN_REACQ_MIN_S);
          const k = (Math.random() * 3) | 0;
          const target = annBaseAngle[k] + (Math.random() - 0.5) * 1.1;
          if (Math.cos(target) * annSides[k] > 0.08) annTargetAngle[k] = target;
        }
        // Free fiducials run their own independent clocks — each darts on
        // its own beat, so the field of marks never moves in unison.
        for (let j = 0; j < ANN_FREE_COUNT; j++) {
          freeReacqIn[j] -= dt;
          if (freeReacqIn[j] <= 0) {
            freeReacqIn[j] = ANN_FREE_REACQ_MIN_S +
              Math.random() * (ANN_FREE_REACQ_MAX_S - ANN_FREE_REACQ_MIN_S);
            rollFreeTarget(j);
          }
        }
        // The linked pair's ends likewise — one end darting while the
        // other holds is what makes the link stretch.
        if (ANN_PAIR_ENABLED) {
          for (let e = 0; e < 2; e++) {
            pairReacqIn[e] -= dt;
            if (pairReacqIn[e] <= 0) {
              pairReacqIn[e] = ANN_PAIR_REACQ_MIN_S +
                Math.random() * (ANN_PAIR_REACQ_MAX_S - ANN_PAIR_REACQ_MIN_S);
              rollPairTarget(e);
            }
          }
        }
      }

      // Deploy eases, one stagger family: the FRAME leads (slot 0 —
      // acquire the target), the callouts follow (slots 1–3 — measure
      // it), the free fiducials trail (slots 4+). On the way OUT
      // everything retracts together, faster — machinery motion,
      // asymmetric like the vortex.
      let annVis = 0;
      {
        const tf = probing ? 1 : 0;
        const rate = tf ? PROBE_IN_SPEED : PROBE_OUT_SPEED;
        frameGrow += (tf - frameGrow) * (1 - Math.exp(-rate * dt));
        if (frameGrow > annVis) annVis = frameGrow;
      }
      for (let k = 0; k < 3; k++) {
        const tk = (probing && probeAge >= (k + 1) * ANN_STAGGER_S) ? 1 : 0;
        const rate = tk ? PROBE_IN_SPEED : PROBE_OUT_SPEED;
        annGrow[k] += (tk - annGrow[k]) * (1 - Math.exp(-rate * dt));
        if (annGrow[k] > annVis) annVis = annGrow[k];
      }
      for (let j = 0; j < ANN_FREE_COUNT; j++) {
        const tj = (probing && probeAge >= (4 + j) * ANN_STAGGER_S) ? 1 : 0;
        const rate = tj ? PROBE_IN_SPEED : PROBE_OUT_SPEED;
        freeGrow[j] += (tj - freeGrow[j]) * (1 - Math.exp(-rate * dt));
        if (freeGrow[j] > annVis) annVis = freeGrow[j];
      }
      {
        // Pair and heading trail the free crosses in the stagger family.
        const slot = 4 + ANN_FREE_COUNT;
        const tp = (ANN_PAIR_ENABLED && probing &&
                    probeAge >= slot * ANN_STAGGER_S) ? 1 : 0;
        let rate = tp ? PROBE_IN_SPEED : PROBE_OUT_SPEED;
        pairGrow += (tp - pairGrow) * (1 - Math.exp(-rate * dt));
        if (pairGrow > annVis) annVis = pairGrow;

        const th = (probing && probeAge >= (slot + 1) * ANN_STAGGER_S) ? 1 : 0;
        rate = th ? PROBE_IN_SPEED : PROBE_OUT_SPEED;
        headingGrow += (th - headingGrow) * (1 - Math.exp(-rate * dt));
        if (headingGrow > annVis) annVis = headingGrow;
      }

      // Reveal is via LENGTH/drawRange, not fade — the materials carry
      // the hairline alpha × the scene's net visibility so the apparatus
      // exits with the model. The hot dot reads at indicator strength;
      // it's meaningless without a card, hence the count gate.
      const appVis = annVis > 0.001 ? sceneVis : 0;
      annLineMaterial.opacity = ANN_LINE_ALPHA * appVis;
      dialMaterial.opacity = annLineMaterial.opacity;
      tickMaterial.opacity = ANN_LINE_ALPHA * appVis;
      hotDotMaterial.opacity =
        ANN_DIAL_DOT_COUNT > 0 ? ANN_DIAL_HOT_ALPHA * appVis : 0;
      if (annVis > 0.001) {
        // READOUT FORMATTING — moved from the unconditional path above
        // (see the NOTE there): these strings exist only for the probe
        // apparatus, so they're built only while it's deployed.
        //
        // ANGLE (deg, signed, normalized to (-180, 180]). Sway oscillates
        // around the user's heading, so the signed range keeps idle motion
        // showing as small numbers near 0 instead of jumping to 350° / 10°.
        let angleDeg = currentY * 180 / Math.PI;
        angleDeg = ((angleDeg % 360) + 540) % 360 - 180;

        const angleStr    = Math.round(angleDeg).toString();
        const velStr      = displayVelDegPerSec.toFixed(1);
        const rotationStr =
          groupThousands(Math.round(cumulativeRotationRad * 180 / Math.PI));

        updateAnnotations(angleStr, velStr, rotationStr, sceneVis, dt, t,
                          floatY * growScale, currentY);
      } else {
        // Fully retracted: park the labels and reset their discrete
        // visibility so the next probe starts from a clean slate.
        for (const l of annLabels) {
          if (l.mat.opacity !== 0) l.mat.opacity = 0;
          l.visible = false;
          l.glowAge = Infinity;
        }
      }
    },

    // RESIZE hook. Defining this turns OFF the system's default aspect-update
    // behavior (threeArray.js falls back to that only when no resize is
    // provided), so we update aspect ourselves AND re-write the footprint
    // since pxPerWorld depends on canvas height.
    //
    // ALSO: re-evaluate the responsive target size. window.innerWidth might
    // have crossed a breakpoint, in which case the model needs to re-fit at
    // the new target. refitModel detaches the model before autoFit and
    // captureModelSize — that's what keeps the user's rotation (held on
    // holder) from corrupting the fit math when resize happens after a
    // drag. See refitModel for the full reasoning.
    resize({ width: w, height: h }) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      currentCanvasH = h;

      const newTargetSize = targetSize();
      if (Math.abs(newTargetSize - currentTargetSize) > 0.001 && currentModel) {
        currentTargetSize = newTargetSize;
        refitModel();
      }
      writeFootprint();
      // The annotation apparatus is authored in CSS pixels: refresh the
      // px→world bridge and rebuild the fixed-pixel label planes — same
      // dispose-old-allocate-new pattern the old HUD used. Cheap, fires
      // only on actual resize events. Leader-line geometry needs no
      // rebuild — it's rewritten from wUnit every probed frame anyway.
      wUnit = computeWUnit(h);
      applyAnnLabelGeometry();
    },

    // Weight for the cull check. Matches our registered handoff-gate
    // weight: the scene is "visible" to the degree of its MIN property
    // (because both must be non-zero for the scene to actually render).
    // The threeArray cull skips us when presence AND this min are below
    // SCENE_CULL — i.e. when the scene is truly invisible.
    weight: () => Math.min(animState.growScale, animState.growOpacity),

    // ACTIONS — public-facing operations callable from outside via
    // invokeSceneAction(panelIndex, name, ...args) in threeArray.js. Any
    // panel type (or any other code) can invoke these without knowing how
    // the scene is implemented.
    actions: {
      turn: triggerTurn,
      dragRotateBegin,
      dragRotateBy,
      dragRotateEnd,
      probeBegin,
      probeEnd,
      bindDragSurface,
    },
  };
});