/* =============================================================================
   threeArray.js — the MULTI-SCENE THREE.JS SYSTEM
   -----------------------------------------------------------------------------
   One renderer, one canvas, many independent three.js scenes — each occupying
   its own rectangular region of the page. The goal is React Three Fiber
   ergonomics in vanilla three.js: declarative, data-driven, automatically
   managed.

   WHAT LIVES HERE
     1. The shared infrastructure — one WebGLRenderer, one canvas, one shared
        per-frame render pass that visits every active scene.
     2. The SCENE-TYPE REGISTRY — types call registerSceneType() to plug in.
     3. The SCENE INSTANCE LIST — one per panel that declares `scene:` in
        PANELS, built once on first frame.
     4. Per-scene scissor + viewport management — each scene gets its own
        rectangle, no bleed between scenes.
     5. Culling — scenes whose panel presence AND their own weight() are both
        below SCENE_CULL do zero work this frame (no update, no render).
     6. Resize handling — the canvas tracks the window; each scene's resize()
        is called when its region's dimensions change.
     7. Disposal — scenes can implement dispose() for GPU resource cleanup.

   WHAT DOES NOT LIVE HERE
     - Specific scene types (camera setups, geometries, materials, animations).
       Those live in scene-type modules (turnScene.js, dotsScene.js) that call
       registerSceneType().
     - The scroll engine, presence calculation, or handoff gate — those are
       in infiniteScroll.js. We consume them via the read-only getters.

   HOW IT PLUGS INTO THE CORE
     A single call to registerFrameHook(updateScenes) is made on first
     start-up. The core calls our hook after every per-frame panel tick. The
     core never imports anything from us; we only read from it.

   CONTRACT FOR SCENE-TYPE FACTORIES (the rule that keeps types decoupled)
     A scene type is a factory:
       (ctx) => ({ update?, resize?, dispose?, weight?, actions? })
     ctx carries everything the type needs:
       THREE, scene, camera, renderer, width, height, panelIndex, panel,
       presence, activeFloat, active, dt, t, isClearToEnter
     The type READS ctx; it never writes scroll state. It builds its own scene
     graph into `ctx.scene` using `ctx.scene.add(...)`. Returned hooks are
     called by the system at the right times. This is the same shape as
     registerPanelType — different concern, identical mental model.

   COUPLED WITH
     - infiniteScroll.js: imports registerFrameHook, getPresence,
       getActiveFloat, getPanelCount, isClearToEnter, isActive.
     - threeStyles.css: emits #three-canvas (fixed, z:1, pointer-events:none).
     - index.html: requires the three.js import map to be in place.
   ========================================================================== */

import * as THREE from "three";
import {
  registerFrameHook,
  getPresence,
  getActiveFloat,
  getPanelCount,
  isClearToEnter,
  isActive,
} from "./infiniteScroll.js";

/* -----------------------------------------------------------------------------
   TUNING CONSTANTS
   --------------------------------------------------------------------------- */
const SCENE_CULL = 0.004;   // a scene whose presence AND weight() are both
                            //   below this contributes nothing this frame:
                            //   no update, no render, zero cost. Matched to
                            //   the previous build's threshold.
const DPR_CAP = 2;          // maximum devicePixelRatio. 2 is high-quality on
                            //   retina without obliterating GPUs on phones
                            //   with DPR=3+. Lower this if you have many
                            //   simultaneous scenes and frame budget is tight.

/* -----------------------------------------------------------------------------
   STATE
   --------------------------------------------------------------------------- */
let renderer = null;          // the single shared WebGLRenderer
let canvas = null;             // the single shared canvas element
let scenes = [];               // sparse, indexed by panel index: scenes[i] or undefined
let initialized = false;       // first-frame init flag
let canvasW = 0;               // current canvas width in CSS px
let canvasH = 0;               // current canvas height in CSS px

/* -----------------------------------------------------------------------------
   SCENE-TYPE REGISTRY
   -----------------------------------------------------------------------------
   A scene type is a name → factory function. Modules call registerSceneType()
   at import time; the registry holds the factory until a panel that uses the
   type is instantiated, at which point the factory runs once.
   --------------------------------------------------------------------------- */
const sceneTypes = new Map();

export function registerSceneType(name, factory) {
  if (typeof factory !== "function") {
    throw new Error(`registerSceneType("${name}"): factory must be a function`);
  }
  if (sceneTypes.has(name)) {
    console.warn(`Scene type "${name}" already registered; overwriting.`);
  }
  sceneTypes.set(name, factory);
}

/* -----------------------------------------------------------------------------
   SCENE ACTIONS — the panel→scene invocation primitive
   -----------------------------------------------------------------------------
   A scene type can expose named, callable operations via its `actions` hook:
     return { update, actions: { turn() {...}, zoom(level) {...} } };
   External code (typically a panel type's button handler or input handler)
   invokes them by panel index and action name, optionally with arguments
   forwarded to the action function:
     invokeSceneAction(panelIndex, "turn");
     invokeSceneAction(panelIndex, "zoom", 1.5);
   Returns true if the action was found and called, false otherwise — so
   panel types can fall back gracefully on panels whose scene doesn't expose
   the requested action.

   This is the SINGLE coupling point between panel types and scene types.
   A panel says "I'd like to invoke action X on my scene, optionally with
   these arguments." It doesn't reach into the scene array, doesn't know the
   hook's data shape, doesn't break if the scene is missing or the action
   isn't defined. Self-guarding by design.
   --------------------------------------------------------------------------- */
export function invokeSceneAction(panelIndex, actionName, ...args) {
  const s = scenes[panelIndex];
  if (!s || !s.hooks || !s.hooks.actions) return false;
  const fn = s.hooks.actions[actionName];
  if (typeof fn !== "function") return false;
  try { fn(...args); }
  catch (e) {
    console.error(`Scene action "${actionName}" on panel ${panelIndex} threw`, e);
    return false;
  }
  return true;
}

/* -----------------------------------------------------------------------------
   PANEL-SCENE LINKAGE
   -----------------------------------------------------------------------------
   A panel attaches a scene via its `scene` field on the PANELS entry:
     scene: "name"                       — shorthand, anchored to overlay
     scene: { type: "name", ...opts }    — explicit form, options below

   Options:
     fullscreen: true        — scene fills the canvas (the window), ignores
                               the overlay's bounding rect. Use when the
                               scene IS the background, not a focused element.
     anchor: HTMLElement     — explicit anchor element (rarely needed).
   --------------------------------------------------------------------------- */

// PANELS is held by main.js / infiniteScroll.js but we don't import it; we
// receive it through a one-time bootstrap call. The reason: keep the scene
// system from depending on a global, and keep the bootstrap path explicit.
let PANELS = [];
let overlaysRoot = null;

export function bootstrapScenes(panels) {
  if (initialized) return;
  PANELS = panels;
  overlaysRoot = document.getElementById("infinite-overlays");

  // Create the canvas (fixed, fullscreen, click-through). The corresponding
  // CSS rule for #three-canvas lives in threeStyles.css and sets z-index:1
  // so the canvas sits below #infinite-scroller (z:2) and #infinite-overlays
  // (z:3). pointer-events:none means clicks pass through to underlying layers.
  canvas = document.createElement("canvas");
  canvas.id = "three-canvas";
  document.body.prepend(canvas);   // first child of body, behind other layers

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,                   // transparent canvas: page bg shows through
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP));
  renderer.setClearColor(0x000000, 0);   // fully transparent clear
  renderer.autoClear = false;             // we control clears per frame

  resizeRenderer();
  window.addEventListener("resize", onWindowResize, { passive: true });

  // Build a scene instance for each panel that declared `scene:`. This runs
  // ONCE — the system assumes panel content is static after start. (Adding
  // hot-swap later means adding a buildScene(i)/disposeScene(i) pair; not
  // needed for the base build.)
  for (let i = 0; i < PANELS.length; i++) {
    const decl = PANELS[i].scene;
    if (!decl) continue;
    buildScene(i, decl);
  }

  // Register our per-frame hook with the core. From this point on, the core
  // calls updateScenes() after every per-frame panel tick.
  registerFrameHook(updateScenes);
  initialized = true;
}

/* -----------------------------------------------------------------------------
   BUILDING A SCENE INSTANCE
   -----------------------------------------------------------------------------
   For panel index `i` with a `scene` declaration, look up the factory by
   type name and call it once with a fresh ctx. The factory builds its scene
   graph by adding to ctx.scene; what it returns is the per-instance hooks
   object. We stash everything (the scene, camera, factory hooks, anchor
   resolution, last-seen size) in scenes[i].

   The ctx given to the factory has only what's needed AT BUILD TIME:
     - THREE, renderer (so the factory can introspect capabilities)
     - scene, camera (so the factory can populate them)
     - width, height (initial region size; resize() handles changes later)
     - panel, panelIndex (so the factory can read its panel's config)
   Per-frame state (presence, dt, t, active, isClearToEnter) is NOT here —
   the factory shouldn't read those at build time; it gets them in update().
   --------------------------------------------------------------------------- */
function normalizeDecl(decl) {
  if (typeof decl === "string") return { type: decl };
  return decl;
}

function buildScene(i, decl) {
  const opts = normalizeDecl(decl);
  const factory = sceneTypes.get(opts.type);
  if (!factory) {
    console.warn(`No scene type registered for "${opts.type}" at panel ${i}; skipping.`);
    return;
  }

  // Resolve the anchor: explicit > fullscreen flag > the panel's overlay.
  let anchor = null;
  if (opts.anchor instanceof HTMLElement) {
    anchor = opts.anchor;
  } else if (opts.fullscreen) {
    anchor = null;            // null anchor = fullscreen scene
  } else {
    // The default: the panel's overlay element. We find it via the index
    // attribute the core stamps in buildAll(); robust against re-ordering
    // because we don't assume the overlay is the i-th child.
    anchor = overlaysRoot && overlaysRoot.querySelector(`[data-index="${i}"]`);
    if (!anchor) {
      console.warn(`Panel ${i} scene "${opts.type}": no overlay found; falling back to fullscreen.`);
    }
  }

  // A fresh THREE.Scene and a default PerspectiveCamera. The factory will
  // typically replace the camera (e.g. with OrthographicCamera) or reposition
  // it; the default is just a sensible starting point so a factory that
  // doesn't touch the camera still works.
  const scene = new THREE.Scene();
  const initialSize = currentRegionSize(anchor);
  const camera = new THREE.PerspectiveCamera(
    50, initialSize.w / initialSize.h, 0.01, 100,
  );
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);

  const buildCtx = {
    THREE,
    renderer,
    scene,
    camera,
    width: initialSize.w,
    height: initialSize.h,
    panel: PANELS[i],
    panelIndex: i,
  };

  let hooks;
  try {
    hooks = factory(buildCtx) || {};
  } catch (e) {
    console.error(`Scene factory "${opts.type}" for panel ${i} threw`, e);
    return;
  }

  scenes[i] = {
    type: opts.type,
    opts,
    anchor,           // null = fullscreen
    scene,
    camera: buildCtx.camera, // the factory may have replaced ctx.camera
    hooks,
    lastW: initialSize.w,
    lastH: initialSize.h,
  };
}

/* -----------------------------------------------------------------------------
   REGION MEASUREMENT
   -----------------------------------------------------------------------------
   For an anchored scene, the region is the anchor's getBoundingClientRect().
   For a fullscreen scene, the region is the whole canvas (== the window).

   Returned in CSS pixels with origin TOP-LEFT (standard DOM convention). The
   renderer wants origin BOTTOM-LEFT for setScissor/setViewport; we convert
   at the use site (canvasH - y - h) to keep the rest of the code natural.
   --------------------------------------------------------------------------- */
function currentRegionSize(anchor) {
  if (!anchor) return { w: window.innerWidth, h: window.innerHeight };
  const r = anchor.getBoundingClientRect();
  // Clamp to >0 so a fully-collapsed anchor doesn't divide-by-zero in cameras.
  return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
}

function currentRegionRect(anchor) {
  if (!anchor) return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  const r = anchor.getBoundingClientRect();
  return {
    x: r.left,
    y: r.top,
    w: Math.max(1, r.width),
    h: Math.max(1, r.height),
  };
}

/* -----------------------------------------------------------------------------
   RESIZE
   -----------------------------------------------------------------------------
   On window resize, the renderer's drawing buffer must match the canvas's
   CSS size. Each scene's resize() is called by updateScenes() on the next
   frame when its region's dimensions change (not on window resize directly —
   anchored scenes also resize when the overlay re-flows for other reasons).
   --------------------------------------------------------------------------- */
function resizeRenderer() {
  canvasW = window.innerWidth;
  canvasH = window.innerHeight;
  renderer.setSize(canvasW, canvasH, false);
}

function onWindowResize() {
  resizeRenderer();
  // Per-scene resizes happen lazily in updateScenes(), so we don't need to
  // walk the scenes array here. The lazy approach is correct: a scene whose
  // region didn't change shouldn't be told it resized.
}

/* -----------------------------------------------------------------------------
   THE PER-FRAME HOOK — the heart of the system
   -----------------------------------------------------------------------------
   Called by the core's frame-hook registry after every per-frame panel tick.
   Walks every scene, decides whether to skip it, and (if not) sets its
   scissor + viewport and renders it.

   ORDER per scene:
     - read presence[i] and weight() (if any)
     - skip if BOTH below SCENE_CULL (the cull rule per project decision)
     - measure region (lazy); if size changed, call scene.resize()
     - call scene.update(ctx) — scene mutates its graph
     - set scissor + viewport to the region; render
   We clear the WHOLE canvas exactly ONCE at the top of the frame (color +
   depth), because autoClear is off. Per-scene we then only need to clear
   the depth buffer if the scene cares — but since scenes don't overlap
   (mutual scissor regions), they don't depth-conflict, so no per-scene
   depth clear is needed. (The previous build needed per-scene depth clears
   because scenes overlapped during handoff; this build's design decision
   was no overlap, so the simpler clear logic suffices.)
   --------------------------------------------------------------------------- */
function updateScenes(dt, t) {
  if (!initialized || !renderer) return;
  const N = getPanelCount();

  // Clear once, full canvas. Color clear honors clearAlpha=0 → transparent.
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, canvasW, canvasH);
  renderer.clear(true, true, false);   // color, depth, no stencil

  renderer.setScissorTest(true);

  const activeFloat = getActiveFloat();

  for (let i = 0; i < N; i++) {
    const s = scenes[i];
    if (!s) continue;

    const presence = getPresence(i);
    let weight = 0;
    if (s.hooks.weight) {
      try { weight = s.hooks.weight(); }
      catch (e) { console.error(`Scene ${i} weight() threw`, e); }
    }

    // CULL: both presence AND weight below threshold = scene is invisible
    // and not in the middle of a self-driven exit animation. Skip everything.
    if (presence < SCENE_CULL && weight < SCENE_CULL) continue;

    // MEASURE the scene's region, lazily detect a size change, fire resize().
    const rect = currentRegionRect(s.anchor);
    if (rect.w !== s.lastW || rect.h !== s.lastH) {
      s.lastW = rect.w;
      s.lastH = rect.h;
      if (s.hooks.resize) {
        try {
          s.hooks.resize({
            THREE, renderer, scene: s.scene, camera: s.camera,
            width: rect.w, height: rect.h,
            panel: PANELS[i], panelIndex: i,
          });
        } catch (e) { console.error(`Scene ${i} resize() threw`, e); }
      } else {
        // Sensible default for a PerspectiveCamera: update aspect.
        if (s.camera.isPerspectiveCamera) {
          s.camera.aspect = rect.w / rect.h;
          s.camera.updateProjectionMatrix();
        }
      }
    }

    // UPDATE: hand the scene a fresh ctx with all per-frame state.
    if (s.hooks.update) {
      try {
        s.hooks.update({
          THREE, renderer, scene: s.scene, camera: s.camera,
          width: rect.w, height: rect.h,
          panel: PANELS[i], panelIndex: i,
          presence, activeFloat,
          active: isActive(i),
          isClearToEnter: () => isClearToEnter(i),
          dt, t,
        });
      } catch (e) { console.error(`Scene ${i} update() threw`, e); }
    }

    // SCISSOR + VIEWPORT to this scene's region, then render.
    // DOM coords are top-left origin; GL coords are bottom-left → flip y.
    // Values are passed in CSS pixels: the renderer was sized with setSize()
    // in CSS px and applies setPixelRatio internally, so setScissor and
    // setViewport take CSS px to match. Don't multiply by DPR here.
    const sx = Math.round(rect.x);
    const sy = Math.round(canvasH - rect.y - rect.h);
    const sw = Math.round(rect.w);
    const sh = Math.round(rect.h);
    renderer.setScissor(sx, sy, sw, sh);
    renderer.setViewport(sx, sy, sw, sh);
    renderer.render(s.scene, s.camera);
  }

  renderer.setScissorTest(false);
}

/* -----------------------------------------------------------------------------
   DISPOSE
   -----------------------------------------------------------------------------
   Public helper to tear down a scene. Not currently called by the base build
   (scenes live for the page lifetime), but exposed so future hot-swap or
   page-transition code has a clean path. Walks the scene graph, calls
   .dispose() on every geometry/material/texture, then calls the type's own
   dispose() hook for anything the system can't see (loaders, intervals,
   shader uniforms with external resources).
   --------------------------------------------------------------------------- */
export function disposeScene(i) {
  const s = scenes[i];
  if (!s) return;

  // Walk the scene graph: dispose geometries, materials (and material's
  // textures), recursively.
  s.scene.traverse((obj) => {
    if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
    const m = obj.material;
    if (m) {
      const mats = Array.isArray(m) ? m : [m];
      for (const mat of mats) {
        for (const key of Object.keys(mat)) {
          const v = mat[key];
          if (v && v.isTexture && v.dispose) v.dispose();
        }
        if (mat.dispose) mat.dispose();
      }
    }
  });

  // Then the type's own dispose hook for anything it owns externally.
  if (s.hooks.dispose) {
    try { s.hooks.dispose({ THREE, renderer, scene: s.scene, camera: s.camera }); }
    catch (e) { console.error(`Scene ${i} dispose() threw`, e); }
  }

  scenes[i] = undefined;
}
