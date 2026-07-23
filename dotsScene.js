/* =============================================================================
   dotsScene.js — the "dots" SCENE TYPE
   -----------------------------------------------------------------------------
   A field of ~22k typographic-symbol sprites — each particle is randomly
   one of fourteen marks ( . [] > + - / # </> : = ^ o [ ] ) — drifting on
   a layered 3D flow field, with a cursor-driven wake that catches them
   along the path of motion and gives a trailing swirl on fast sweeps.
   Originally a standalone sketch ("Drift"); ported here as a scene type
   so it composes with the rest of the project. The symbol per particle
   is assigned at construction (same pattern as color) but no longer
   strictly frozen — see AMBIENT LIFE below; the shape itself is computed
   in the fragment shader via per-shape SDFs.

   AMBIENT LIFE (idle motion, split per visualLanguage.md's motion rules)
     Two idle behaviors keep the field reading as a live sensor rather
     than a paused simulation:
       - TWINKLE (carrier): a fixed random subset of particles slowly
         drifts in luminance — smooth, floored, per-particle random
         period so nothing beats in sync. Pure shader work (uTime +
         aTwinkle); zero CPU cost. Suppressed on disturbed particles —
         idle may be analog, activity must be discrete.
       - GLYPH SWAPS (information): every so often a small burst of
         particles gets its symbol discretely reassigned — data fields
         being rewritten. Snaps, never blends. This is what retires the
         old "aShape uploaded once, never re-uploaded" invariant: swaps
         re-upload the shape buffer (~88 kB) a couple of times per
         second, noise next to the per-frame position upload.

   THE FIELD HAS MEMORY
     Each particle carries a persistent velocity. Frame to frame, the velocity
     is eased toward the ambient flow (no spring, no home) and additively
     nudged by the cursor wake. Drag bleeds energy so disturbances settle out
     naturally. Position wraps toroidally on x/y (seamless because wraps happen
     offscreen); z is softly reflected so cursor energy can't slowly pile
     particles against the depth boundary.

   IN-SCENE HUD
     A canvas-textured plane anchored to the bottom-left of the viewport
     shows a live count of cursor-displaced particles ("DISPLACED > 12,078").
     Lives in the scene rather than the HTML overlay so the data source
     (per-particle wake state, in the integration loop) and the display
     (a textured plane) stay in one file with no cross-module reads. See
     the HUD PLANE block below for the depth-test / renderOrder rationale
     and the rising-edge counter logic.

   WHAT IS PER-INSTANCE vs MODULE-SCOPED
     Module-scope (stateless after init):
       - CONFIG, shaders, the 3D simplex noise function, the three seeded
         noise instances, and the FlowField.sample function. Pure data and
         pure functions — safe to share across any number of scene instances.
     Per-instance (built inside the factory closure):
       - The particle buffers (positions, velocities, colors, speeds), the
         BufferGeometry, the ShaderMaterial (each instance has its own
         uniforms — especially `uGrow`), the Pointer state (with listeners
         scoped to this instance's camera), and the `grow` value for the
         handoff gate.
     Two simultaneous instances would have independent fields and pointers
     sharing the same underlying flow — correct: the flow is the universe;
     each scene is a window into it.

   COUPLED WITH
     - threeArray.js: imports registerSceneType. The scene array's update()
       hands us the ctx envelope every visible frame.
     - infiniteScroll.js: registerWeight + isClearToEnter for the handoff
       gate. Our `grow` eases toward the gate's verdict; we report it as
       both the cull weight and the registered handoff weight.
     - dotsStyles.css: emits the .dots-overlay positioning and dots-* type.
       (Owned by dotsPanel; the scene itself emits no DOM.)

   ASSUMPTIONS
     - The scene is used with `fullscreen: true` so its scissor region covers
       the whole window. The pointer NDC math (clientX / window.innerWidth)
       relies on this. A sub-region anchor would need offset-aware math; if
       that case ever arises, generalize then.
   ========================================================================== */

import { registerSceneType } from "./threeArray.js";
import { registerWeight, isClearToEnter } from "./infiniteScroll.js";

/* -----------------------------------------------------------------------------
   CONFIG — single source of truth for all tunables. Read-only at runtime
   (we never mutate this object; per-instance derived values live as
   factory-closure variables).
   --------------------------------------------------------------------------- */
const CONFIG = {
  particles: {
    count: 22000,           // density chosen to cover a viewport-sized field
    // bounds — half-extent on x/y — is DERIVED from the camera + viewport at
    // build time and on resize, so the field always fully covers the visible
    // area. If it were smaller, the toroidal wrap would tile copies of the
    // field inside the viewport — a disturbance on one edge would mirror to
    // the opposite. Margin pads it beyond visible so wrap seams happen safely
    // offscreen.
    boundsMargin: 1.25,     // field extent = visible half-extent × this
    depth: 24,              // half-extent on z (kept shallow for parallax)

    // Per-particle size response to speed. The vertex shader computes a
    // "wake intensity" — how much each particle is moving FASTER than the
    // ambient-flow baseline — and applies size flare to that:
    //   size = uBaseSize * (sizeRest + wake * sizeFlare)
    // Ambient-flow particles (no cursor influence) have wake = 0 and render
    // at uBaseSize * sizeRest, regardless of sizeFlare. Cursor-disturbed
    // particles have wake > 0, reaching wake = 1 at maximum cursor speed.
    //   sizeRest  — the ambient size multiplier. All undisturbed dots.
    //   sizeFlare — additional size added at full cursor flare. 0.0 disables
    //               the size response entirely (only alpha responds to the
    //               cursor). Higher values produce more dramatic flare.
    // These two knobs are independent: changing sizeFlare does NOT shift
    // the resting size.
    sizeRest: 0.85,
    sizeFlare: 1.5,
  },

  flow: {
    // Two octaves of noise layered for large drift + finer curl.
    scaleA: 0.012,          // spatial frequency, coarse current
    scaleB: 0.045,          // spatial frequency, fine eddies
    timeScale: 0.045,       // how fast the whole field evolves
    strength: 2.6,          // ambient drift force magnitude
    curl: 0.9,              // weight of the finer octave

    // FLOW GRID resolution (see the FLOW GRID block in the factory). The
    // field is reconstructed per particle by bilinear interpolation from
    // small lattices refreshed once per frame, instead of six noise
    // evaluations per particle per frame (~132k noise calls → ~18.6k, and
    // the per-particle work drops from 6 simplex evals to 2 bilinear
    // reads). Values are LATTICE POINTS per axis; higher = closer to the
    // exact field, more noise calls per refresh. Measured reconstruction
    // error vs the exact field (mean / max, as % of mean field magnitude,
    // 50k random points at desktop bounds):
    //   33 / 9  → 16.5% / 65%   ( 5.0k calls, 26.7× cut)
    //   49 / 9  →  8.5% / 29%   (10.5k calls, 12.6× cut)
    //   65 / 13 →  4.7% / 17%   (18.6k calls,  7.1× cut)  ← default
    //   81 / 13 →  3.3% / 11%   (28.4k calls,  4.7× cut)
    // Error is smooth and seam-free (bilinear of a smooth field); what it
    // costs visually is a slight softening of the finest eddies. Drop to
    // 49 or 33 only after eyeballing the field at that setting.
    gridXY: 65,             // lattice points per x and y axis
    gridZ: 13,              // lattice points on z
  },

  motion: {
    drag: 0.965,            // velocity retention per frame (<1 = bleed off)
    maxSpeed: 55,           // physics clamp — keeps swipes from flinging
                            //   particles to infinity
    // Perceptual reference at which a particle reads as fully "disturbed"
    // (drives the shader's flare). Decoupled from maxSpeed: maxSpeed is the
    // physics safety limit; flareSpeed is the visual reference so flare
    // triggers on normal cursor sweeps long before the clamp kicks in.
    flareSpeed: 22,
    // How strongly an undisturbed particle's velocity eases back to the
    // ambient flow. Low + frame-rate-relative = slow reabsorption, no
    // snapping, no spring.
    reabsorb: 0.55,
    // Feather-light pull toward z=0 so cursor energy doesn't slowly
    // accumulate particles at the depth boundary over minutes. Tiny on
    // purpose — imperceptible as a force, just prevents pile-up.
    zCentering: 0.015,
  },

  pointer: {
    radius: 24,             // world-space reach of the cursor wake
    strength: 220,          // impulse scale; multiplied by cursor speed
    swirl: 1.4,             // tangential (curl) component → trailing vortex
    falloff: 2.2,           // exponent on the radial falloff (higher = tighter)
  },

  // VORTEX — the held-click attractor. While the user holds primary mouse,
  // an intensity value `vortex` exponentially eases up; on release it snaps
  // toward zero. Two forces, both multiplied by that intensity:
  //   - radial pull toward the cursor (with a small anti-collapse repel
  //     right at the very center so particles don't pile up to a point)
  //   - tangential spin perpendicular to the radial direction; magnitude
  //     scales INVERSELY with distance so closer particles orbit faster,
  //     producing the gradient/shear that reads as a vortex
  // The "shape" of the vortex isn't drawn — it's the equipotential of the
  // radial pull. We wobble it organically by perturbing the effective
  // radius via low-frequency noise sampled on (angle, time), so the
  // boundary breathes and warps instead of being a perfect static circle.
  vortex: {
    radius: 30,             // reach; how far from cursor particles feel the swirl
    pullStrength: 250,       // radial inward force magnitude
    spinStrength: 220,      // tangential force; the headline "orbit" knob
    spinFalloff: 1.0,       // closer = faster orbit. spin ∝ 1/(dist/radius + ε)^falloff
                            //   1.0 = inverse, 1.5 = sharper gradient, 0.5 = gentler
    pullCorePush: 0.25,     // small outward repel near the very center as a fraction
                            //   of pullStrength — prevents collapse-to-point. 0 to
                            //   disable; raise toward 1 to push particles out into
                            //   a clearer orbital band.
    coreRadius: 0.18,       // size of the anti-collapse region as a fraction of
                            //   `radius`. Inside this, the radial sign flips to
                            //   "push out" (scaled by pullCorePush).
    wobbleAmplitude: 0.15,  // wobble depth as a fraction of `radius`. The effective
                            //   pull radius at angle θ at time t is
                            //   radius * (1 + wobbleAmplitude * noise(θ, t)).
    wobbleFreq: 0.8,        // wobble time speed (rad/s scale for the noise's time axis)
    wobbleSpatial: 2.5,     // angular frequency of the wobble around the circle.
                            //   2.5 ≈ 2-3 lobes warping around the perimeter.
    easeInRate: 4.0,        // exponential rate (s⁻¹) toward 1 while pressed
    easeOutRate: 12.0,      // exponential rate (s⁻¹) toward 0 on release (snappier
                            //   than ease-in, so released particles don't get
                            //   re-tugged as they fly off in their new trajectory)

    // VORTEX-driven size gradient. While the vortex is held, particles near
    // the cursor get a per-particle size bump that falls off with distance.
    // Separate channel from CONFIG.particles.sizeFlare (which responds to
    // speed); the two are additive in the vertex shader.
    //   size = uBaseSize * (sizeRest + wake * sizeFlare + vortexBoost)
    //   vortexBoost = (1 - dist/radius)^sizeFalloff * intensity * sizeFlare
    // The two effects naturally reinforce: inner particles orbit faster
    // (speed-based flare) AND sit closer to cursor (this distance-based
    // flare). Together they produce a strong size gradient that reads as
    // "particles are pulled into the vortex and grow as they're caught."
    sizeFlare: 1.5,         // size addition at the very center (multiplier on
                            //   uBaseSize, on top of the resting term). 0 to
                            //   disable; raise toward 2-3 for stronger effect.
    sizeFalloff: 12.0,       // exponent on the radial falloff. Higher = more
                            //   concentrated at center, sharper edge to the
                            //   size gradient. 1.0 = linear; 2.0 = squared
                            //   (smooth, centered); 4+ = pinpoint center bump.
  },

  camera: {
    fov: 55,
    near: 0.1,
    far: 400,
    z: 95,
  },

  // Four flat colors, assigned at random one-per-particle. Rendered with
  // normal alpha blending so they read as solid graphic dots (red+green
  // overlap doesn't wash toward yellow the way additive blending does).
  // Hex strings here, converted to THREE.Color in the factory — keeps CONFIG
  // free of any Three.js dependency at module-load time.
  color: {
    palette: ["#ff5e2e", "#00d9ff", "#00eb14", "#ffd000", 
      "#e5eaec", "#e4dddd", "#e9e9e9", "#a8a8a8", 
  //    "#c2c2c2", "#e4dddd", "#e9eeec", "#bec0c2", 
  //    "#d9dbe0", "#b8b8b8", "#bebebe", "#838383", 
    ],
  },

  // AMBIENT LIFE — the field's idle behaviors (see the file header and
  // visualLanguage.md's "Motion" section for the carrier/information split).
  twinkle: {
    fraction: 0.12,   // share of particles that twinkle at all
    depth: 0.65,      // luminance floor for a twinkler (1 = no dip). Never
                      //   0 — a blackout would read as an information event.
                      //   Oscillation rates are shader literals (~10–25s
                      //   periods), same convention as the wake floor.
  },
  glyphSwap: {
    minInterval: 0.25, // s between swap bursts — randomized in [min, max].
    maxInterval: 0.85, //   Uneven on purpose: even intervals read as a
                       //   metronome, uneven ones as live activity.
    maxPerBurst: 3,    // 1..N particles reassigned per burst
  },

  // HUD — a canvas-textured plane that lives in the scene (not in the HTML
  // overlay) and displays a live count of cursor-displaced particles. Sits
  // at the bottom-left of the viewport. Keeps the panel/scene boundary
  // clean: the data (per-particle displacement state) and the display
  // (canvas text) both live in the scene, with no cross-module reads.
  //
  // All dimensions are in SCREEN pixels — the plane is rebuilt in resize()
  // so the HUD reads at the same pixel size regardless of viewport. (The
  // SVG plane stays a fixed FRACTION of viewport width; the HUD stays a
  // fixed PIXEL size. Different goals — the SVG is a logotype that should
  // scale with the page, the HUD is UI chrome that shouldn't.)
  hud: {
    marginPx: 28,             // distance from the viewport's bottom-left
    textHeightPx: 14,         // intended on-screen text height
    planeWidthPx: 240,        // sized to hold "DISPLACED > 999,999" comfortably
    planeHeightPx: 22,        // padding around the text band
    canvasUpscale: 4,         // texture is 4× the pixel size for crispness at
                              //   any DPR / zoom; drop to 2× if memory matters
    textColor: "#6b6052",     // matches infiniteStyles.css --ink-dim
    // Update afterglow — a fresh write flashes the write color and decays
    // back to textColor, phosphor-style. Blue = information write, per
    // visualLanguage.md's color semantics. Hardcoded hex like textColor:
    // matches infiniteStyles.css --brand-blue.
    glowColor: "#00b8e6",
    glowSeconds: 0.9,         // decay duration (quadratic ease-out of intensity)
    fontFamily: '"Glitched Book", ui-monospace, monospace',
    letterSpacing: "0.18em",  // close to .dots-meta in dotsStyles.css
  },
};

/* -----------------------------------------------------------------------------
   GROW SPEED — how fast the scene fades in/out on entry/exit. Lower than the
   panel overlay's 10.0 because particles fading on a tighter clock feels
   abrupt; 6.0 matches turnScene's GROW_IN_SPEED and gives a more "settles in"
   character.
   --------------------------------------------------------------------------- */
const GROW_SPEED = 12.0;

/* -----------------------------------------------------------------------------
   SYMBOL SET — each particle is randomly assigned one of N symbols at init,
   then keeps it for its lifetime. The integer ID is stored in the `aShape`
   per-particle attribute (uploaded once, never re-uploaded); the fragment
   shader branches on it to compute the appropriate SDF.

     ID  symbol  rendering
     ──  ──────  ───────────────────────────────────────────────────────
      0  .       small filled disk (period) — radius 0.18
      1  []      hollow square outline — Chebyshev ring (exempted from
                 the 0.14 stroke convention; weight set by outer/inner)
      2  >       right-pointing chevron, two diagonal segments
      3  +       plus, two perpendicular segments
      4  -       single horizontal segment
      5  /       single diagonal segment
      6  #       hash, two horizontal + two vertical segments
      7  </>     composite code-tag glyph (< + / + > sub-marks; merges
                 into one chunky mark at 0.14 stroke)
      8  :       colon, two small filled disks stacked — radius 0.10
      9  =       equals, two horizontal segments stacked
     10  ^       caret, two diagonal segments meeting at top
     11  o       hollow circle (smaller round ring — exempted from
                 the 0.14 stroke convention)
     12  [       left bracket, vertical with two short serifs
     13  ]       right bracket, mirror of [

   All segment-based shapes use a 0.14 stroke; "[]" and "o" use their own
   outer/inner radii instead; "." and ":" are filled and use a radius.

   To add a new symbol: bump SHAPE_COUNT and add a branch in FRAGMENT_SHADER.
   Nothing else needs to change.
   --------------------------------------------------------------------------- */
const SHAPE_COUNT = 14;

/* -----------------------------------------------------------------------------
   3D SIMPLEX NOISE (Stefan Gustavson / Ashima, public domain). Inlined so the
   project has no extra dependency. A factory builds an independently-seeded
   generator; sample with noise3(x, y, z).
   --------------------------------------------------------------------------- */
function createNoise3D(seed = Math.random()) {
  // Build a seeded permutation table via a small xorshift PRNG, then a
  // Fisher–Yates shuffle. Same seed → same table → reproducible noise.
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = (seed * 2147483647) | 0 || 1;
  const rand = () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 4294967296);
  };
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }

  const grad3 = new Float32Array([
    1,1,0, -1,1,0, 1,-1,0, -1,-1,0,
    1,0,1, -1,0,1, 1,0,-1, -1,0,-1,
    0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1,
  ]);

  const F3 = 1 / 3;
  const G3 = 1 / 6;

  return function noise3(xin, yin, zin) {
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
    const sk = (xin + yin + zin) * F3;
    const i = Math.floor(xin + sk);
    const j = Math.floor(yin + sk);
    const k = Math.floor(zin + sk);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);

    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0)      { i1=1;j1=0;k1=0; i2=1;j2=1;k2=0; }
      else if (x0 >= z0) { i1=1;j1=0;k1=0; i2=1;j2=0;k2=1; }
      else               { i1=0;j1=0;k1=1; i2=1;j2=0;k2=1; }
    } else {
      if (y0 < z0)       { i1=0;j1=0;k1=1; i2=0;j2=1;k2=1; }
      else if (x0 < z0)  { i1=0;j1=1;k1=0; i2=0;j2=1;k2=1; }
      else               { i1=0;j1=1;k1=0; i2=1;j2=1;k2=0; }
    }

    const x1 = x0 - i1 + G3,     y1 = y0 - j1 + G3,     z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2*G3,   y2 = y0 - j2 + 2*G3,   z2 = z0 - k2 + 2*G3;
    const x3 = x0 - 1 + 3*G3,    y3 = y0 - 1 + 3*G3,    z3 = z0 - 1 + 3*G3;

    const ii = i & 255, jj = j & 255, kk = k & 255;

    let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
    if (t0 > 0) {
      const gi = permMod12[ii + perm[jj + perm[kk]]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi]*x0 + grad3[gi+1]*y0 + grad3[gi+2]*z0);
    }
    let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
    if (t1 > 0) {
      const gi = permMod12[ii+i1 + perm[jj+j1 + perm[kk+k1]]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi]*x1 + grad3[gi+1]*y1 + grad3[gi+2]*z1);
    }
    let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
    if (t2 > 0) {
      const gi = permMod12[ii+i2 + perm[jj+j2 + perm[kk+k2]]] * 3;
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi]*x2 + grad3[gi+1]*y2 + grad3[gi+2]*z2);
    }
    let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
    if (t3 > 0) {
      const gi = permMod12[ii+1 + perm[jj+1 + perm[kk+1]]] * 3;
      t3 *= t3;
      n3 = t3 * t3 * (grad3[gi]*x3 + grad3[gi+1]*y3 + grad3[gi+2]*z3);
    }
    return 32 * (n0 + n1 + n2 + n3);   // ≈ [-1, 1]
  };
}

/* -----------------------------------------------------------------------------
   SHARED NOISE GENERATORS — module-scope. Three distinct seeds per axis so
   the field isn't symmetric or diagonal. Stateless after construction:
   sampling reads the permutation table and returns a value. Safe to share
   across any number of dotsScene instances.
   --------------------------------------------------------------------------- */
const noiseX = createNoise3D(0.137);
const noiseY = createNoise3D(0.611);
const noiseZ = createNoise3D(0.902);

/* -----------------------------------------------------------------------------
   FLOW FIELD — a pure function of (position, time) → ambient velocity.

   STRUCTURE (load-bearing for the FLOW GRID in the factory): the field
   decomposes into two PLANAR components —
     (fx, fy) depends only on (x, y)   — sampleFlowXY
     fz       depends only on (x, z)   — sampleFlowZ
   stepParticles does NOT evaluate these per particle. It reconstructs the
   field by bilinear interpolation from two small lattices refreshed once per
   frame (see FLOW GRID), cutting ~132k noise evaluations per frame to ~18.6k
   at the default resolution — reconstruction error ~4.7% mean / 17% max of
   field magnitude, smooth and seam-free (measured; table in CONFIG.flow).

   If you ever change the field's structure (e.g. make fx depend on z), the
   planar decomposition breaks: update the components AND the grid to match,
   or fall back to calling sampleFlow per particle (the exact composed
   reference below — kept precisely so an A/B against ground truth is one
   swapped call in stepParticles).
   --------------------------------------------------------------------------- */
const flowScratchXY = new Float32Array(2);   // scratch for the composed reference

/* (fx, fy) at (x, y): coarse current + fine eddies. Writes dst[di], dst[di+1]
   so grid fills go straight into the lattice with zero allocation. Time is
   the third noise coordinate, so the whole field evolves over time. */
function sampleFlowXY(dst, di, x, y, t) {
  const { scaleA, scaleB, timeScale, strength, curl } = CONFIG.flow;
  const tt = t * timeScale;

  // Coarse current — slow, large-scale directional drift.
  const ax = noiseX(x * scaleA,         y * scaleA,         tt);
  const ay = noiseY(x * scaleA,         y * scaleA,         tt + 50);

  // Fine eddies — offset spatial coords so they don't alias the coarse octave.
  const bx = noiseX(x * scaleB + 100,   y * scaleB,         tt);
  const by = noiseY(x * scaleB,         y * scaleB + 100,   tt + 50);

  dst[di]     = (ax + bx * curl) * strength;
  dst[di + 1] = (ay + by * curl) * strength;
}

/* fz at (x, z) — same two-octave shape, damped so the cloud stays planar-ish. */
function sampleFlowZ(x, z, t) {
  const { scaleA, scaleB, timeScale, strength, curl } = CONFIG.flow;
  const tt = t * timeScale;
  const az = noiseZ(x * scaleA,         z * scaleA,         tt + 99);
  const bz = noiseZ(x * scaleB,         z * scaleB + 100,   tt + 99);
  return (az + bz * curl) * strength * 0.4;
}

/* EXACT composed field — the ground-truth reference the grid approximates.
   Not on the hot path; kept for debugging and one-time uses. */
function sampleFlow(out, x, y, z, t) {
  sampleFlowXY(flowScratchXY, 0, x, y, t);
  out.set(flowScratchXY[0], flowScratchXY[1], sampleFlowZ(x, z, t));
  return out;
}

/* -----------------------------------------------------------------------------
   SHADERS — each particle carries a fixed color (aColor) and a per-particle
   speed (aSpeed). Speed drives point size and per-fragment alpha so motion
   reads visually; color stays flat. uGrow multiplies the fragment's final
   alpha so the whole field fades in/out via the handoff gate.
   --------------------------------------------------------------------------- */
const VERTEX_SHADER = /* glsl */ `
  attribute float aSpeed;
  attribute vec3  aColor;
  attribute float aShape;     // per-particle symbol ID (0..SHAPE_COUNT-1)
  attribute float aTwinkle;   // 0 = steady; (0,1] = twinkle seed (phase + rate)

  uniform float uMaxSpeed;
  uniform float uPixelRatio;
  uniform float uBaseSize;
  uniform float uSizeRest;    // resting size multiplier (undisturbed dots)
  uniform float uSizeFlare;   // additional size at full speed
  uniform float uTime;        // scene time, seconds — drives the twinkle only
  uniform float uTwinkleDepth;// twinkler luminance floor (CONFIG.twinkle.depth)

  // VORTEX size-gradient uniforms — driven by the held-click attractor in
  // the per-frame update. uVortexI is the eased intensity (0..1); when it's
  // ~0 the entire vortexBoost term collapses to zero and this shader path
  // is effectively free.
  uniform vec2  uVortexPos;
  uniform float uVortexI;
  uniform float uVortexR;
  uniform float uVortexSize;
  uniform float uVortexFalloff;

  varying float vIntensity;   // 0 = calm, 1 = fast — drives opacity
  varying vec3  vColor;       // this particle's fixed color
  varying float vDim;         // ambient twinkle luminance, uTwinkleDepth..1
  varying float vShape;       // this particle's symbol ID (constant across the
                              //   point's quad — varyings on GL_POINTS come
                              //   from the single vertex, no interpolation)

  void main() {
    // Normalize speed into a perceptual intensity (gentle compression).
    float n = clamp(aSpeed / uMaxSpeed, 0.0, 1.0);
    vIntensity = pow(n, 0.6);
    vColor = aColor;
    vShape = aShape;

    vec4 mv = modelViewMatrix * vec4(position, 1.0);

    // Size response: compute a separate "wake" intensity that's zero for
    // particles moving at ambient-flow speed and ramps to 1 only when the
    // particle is moving significantly faster (i.e., disturbed by the
    // cursor). Without this remap, vIntensity at ambient speed sits around
    // ~0.25 (the flow gives every particle some baseline motion), which
    // means uSizeFlare would visibly affect ambient-particle size — making
    // sizeFlare and sizeRest non-independent. The remap fixes that:
    // ambient particles always render at uBaseSize * uSizeRest; uSizeFlare
    // only scales the cursor-driven flare.
    //
    // The 0.30 floor is tuned to the project's default flow.strength of
    // 2.6 — ambient vIntensity rarely exceeds it. If you push flow.strength
    // much higher (3.5+), bump this floor proportionally; if you drop it
    // toward zero, lower the floor or remove it. Kept as a shader literal
    // rather than a CONFIG knob to avoid a third coupled tunable; lift it
    // out if it ever needs to vary at runtime.
    float wake = clamp((vIntensity - 0.30) / 0.70, 0.0, 1.0);

    // AMBIENT TWINKLE (carrier motion — visualLanguage.md "Motion").
    // Each twinkler oscillates between uTwinkleDepth and 1.0 on its own
    // random period and phase, both derived from the aTwinkle seed, so no
    // two particles beat in sync. Rates span ~0.25–0.6 rad/s (periods of
    // roughly 10–25s) — shader literals by the same convention as the
    // 0.30 wake floor above. Steady particles (aTwinkle == 0) get tw = 0
    // and vDim collapses to 1.0. The final (1.0 - wake) factor suppresses
    // the twinkle on cursor-disturbed particles: idle may be analog,
    // activity must be discrete — a particle mid-flare snaps to full
    // luminance and stays there until the wake decays.
    float tw    = step(0.0001, aTwinkle);
    float phase = aTwinkle * 6.2831853;
    float rate  = mix(0.25, 0.6, fract(aTwinkle * 7.31));
    float osc   = 0.5 + 0.5 * sin(uTime * rate + phase);
    vDim = 1.0 - tw * osc * (1.0 - uTwinkleDepth) * (1.0 - wake);

    // Vortex-driven size boost: position-based, peaks at the cursor, fades
    // to zero at the vortex radius. Scales with the eased vortex intensity
    // so it activates the moment the user holds and decays as they release.
    // Independent of speed — a calm particle right at the cursor still gets
    // enlarged the instant the vortex spins up. Additive with the wake.
    vec2 toVortex = position.xy - uVortexPos;
    float vDist = length(toVortex);
    float vProx = 1.0 - clamp(vDist / uVortexR, 0.0, 1.0);
    float vortexBoost = pow(vProx, uVortexFalloff) * uVortexI * uVortexSize;

    float size = uBaseSize * (uSizeRest + wake * uSizeFlare + vortexBoost);
    gl_PointSize = size * uPixelRatio * (180.0 / -mv.z);

    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float uGrow;        // handoff-gate fade (0..1), multiplies alpha

  varying float vIntensity;
  varying vec3  vColor;
  varying float vDim;         // ambient twinkle luminance from the vertex stage
  varying float vShape;       // per-particle symbol ID; constant across the
                              //   point's quad (varyings on GL_POINTS come
                              //   from the single vertex — no interpolation),
                              //   so the branch below has no warp divergence
                              //   within a particle.

  // Signed distance from p to the line segment a-b. Used by every line-based
  // shape (>, +, -, /, #, </>, =, ^, [, ]). Standard formula: project p onto
  // the segment with the parameter clamped to [0,1], then take the Euclidean
  // distance to the projection. Cheap (a few muls + a sqrt) and well-behaved
  // for fwidth().
  float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    vec2 uv = gl_PointCoord - 0.5;   // -0.5..0.5, origin at sprite center
    float alpha;

    // Each branch produces an anti-aliased mask for one symbol. Every shape
    // uses fwidth() on its distance function so the edge feather stays ~1
    // screen pixel regardless of how big the sprite gets — same crispness
    // trick as the original disk, generalized.
    //
    // Tuning constants per branch (sizes of segments and thickness) are
    // chosen so the fourteen symbols read at a heavy, typographic weight at
    // base size. They're shader literals rather than uniforms because tuning
    // them is a one-time visual decision; lift them to uniforms only if
    // you ever need to tweak shape geometry at runtime. Most line-based
    // shapes a stroke; the "[]" square ring and the "o" round ring
    // use their own outer/inner radii instead of a single stroke.
    int shape = int(vShape + 0.5);

    if (shape == 0) {
      // "." — small filled disk (sits well below 0.5 so it reads as a
      // period, not just a smaller version of the old dot). Filled shape,
      // no "stroke" — controlled by its radius alone.
      float d = length(uv);
      float aa = fwidth(d);
      alpha = 1.0 - smoothstep(0.18 - aa, 0.18, d);

    } else if (shape == 1) {
      // "[]" — hollow square. Chebyshev distance (max-norm) gives concentric
      // square rings; the outline is the band between an outer and inner
      // square. Its visual weight is governed by the
      // outer/inner radius pair, not a single stroke width.
      float d = max(abs(uv.x), abs(uv.y));
      float aa = fwidth(d);
      float outer = 1.0 - smoothstep(0.42 - aa, 0.42, d);
      float inner = 1.0 - smoothstep(0.30 - aa, 0.30, d);
      alpha = outer - inner;

    } else if (shape == 2) {
      // ">" — chevron. Two diagonal segments meeting at a tip on the right
      // side of the sprite. Symmetric across y=0.
      float d1 = sdSegment(uv, vec2(-0.30,  0.30), vec2(0.30, 0.0));
      float d2 = sdSegment(uv, vec2(-0.30, -0.30), vec2(0.30, 0.0));
      float d = min(d1, d2);
      float aa = fwidth(d);
      alpha = 1.0 - smoothstep(0.08 - aa, 0.08, d);

    } else if (shape == 3) {
      // "+" — plus. One horizontal segment and one vertical segment, sharing
      // the sprite center. At a thicker stroke the strokes overlap visibly at
      // the center, producing a chunky cross — intentional with the heavy
      // typographic weight.
      float d1 = sdSegment(uv, vec2(-0.38, 0.0), vec2(0.38, 0.0));
      float d2 = sdSegment(uv, vec2(0.0, -0.38), vec2(0.0, 0.38));
      float d = min(d1, d2);
      float aa = fwidth(d);
      alpha = 1.0 - smoothstep(0.08 - aa, 0.08, d);

    } else if (shape == 4) {
      // "-" — single horizontal segment.
      float d = sdSegment(uv, vec2(-0.38, 0.0), vec2(0.38, 0.0));
      float aa = fwidth(d);
      alpha = 1.0 - smoothstep(0.08 - aa, 0.08, d);

    } else if (shape == 5) {
      // "/" — single diagonal segment, bottom-left to top-right.
      float d = sdSegment(uv, vec2(-0.33, -0.33), vec2(0.33, 0.33));
      float aa = fwidth(d);
      alpha = 1.0 - smoothstep(0.08 - aa, 0.08, d);

    } else if (shape == 6) {
      // "#" — hash. Two horizontal segments + two vertical segments forming
      // a tic-tac-toe grid.
      float d1 = sdSegment(uv, vec2(-0.38, -0.13), vec2(0.38, -0.13));
      float d2 = sdSegment(uv, vec2(-0.38,  0.13), vec2(0.38,  0.13));
      float d3 = sdSegment(uv, vec2(-0.13, -0.38), vec2(-0.13, 0.38));
      float d4 = sdSegment(uv, vec2( 0.13, -0.38), vec2( 0.13, 0.38));
      float d = min(min(d1, d2), min(d3, d4));
      float aa = fwidth(d);
      alpha = 1.0 - smoothstep(0.08 - aa, 0.08, d);

    } else if (shape == 7) {
      // "</>" — composite code-tag glyph. Three sub-marks side by side.
      // At a 0.14 stroke the three sub-glyphs lose their internal structure
      // and merge into a single dense mark — visible as a chunky composite
      // but no longer recognizable as the literal characters. If you want
      // the < / > to read individually, drop this stroke back toward 0.04
      // or scale the sub-glyph coordinates outward.
      float dL = min(
        sdSegment(uv, vec2(-0.22,  0.18), vec2(-0.40, 0.0)),
        sdSegment(uv, vec2(-0.22, -0.18), vec2(-0.40, 0.0))
      );
      float dM = sdSegment(uv, vec2(-0.10, -0.20), vec2(0.10, 0.20));
      float dR = min(
        sdSegment(uv, vec2( 0.22,  0.18), vec2( 0.40, 0.0)),
        sdSegment(uv, vec2( 0.22, -0.18), vec2( 0.40, 0.0))
      );
      float d = min(dL, min(dM, dR));
      float aa = fwidth(d);
      alpha = 1.0 - smoothstep(0.08 - aa, 0.08, d);

    } else if (shape == 8) {
      // ":" — colon, two small filled disks stacked vertically. Filled
      // shapes, no "stroke" — controlled by their radius (0.10).
      float d1 = length(uv - vec2(0.0,  0.20));
      float d2 = length(uv - vec2(0.0, -0.20));
      float d = min(d1, d2);
      float aa = fwidth(d);
      alpha = 1.0 - smoothstep(0.10 - aa, 0.10, d);

    } else if (shape == 9) {
      // "=" — equals, two horizontal segments stacked.
      float d1 = sdSegment(uv, vec2(-0.38,  0.13), vec2(0.38,  0.13));
      float d2 = sdSegment(uv, vec2(-0.38, -0.13), vec2(0.38, -0.13));
      float d = min(d1, d2);
      float aa = fwidth(d);
      alpha = 1.0 - smoothstep(0.08 - aa, 0.08, d);

    } else if (shape == 10) {
      // "^" — caret, two diagonal segments meeting at a tip on top. Same
      // shape as ">" rotated 90° counter-clockwise: open at the bottom,
      // pointing up.
      float d1 = sdSegment(uv, vec2(-0.30, -0.18), vec2(0.0, 0.20));
      float d2 = sdSegment(uv, vec2( 0.30, -0.18), vec2(0.0, 0.20));
      float d = min(d1, d2);
      float aa = fwidth(d);
      alpha = 1.0 - smoothstep(0.08 - aa, 0.08, d);

    } else if (shape == 11) {
      // "o" — hollow circle (lowercase o). Same ring construction as "[]"
      // but using length() instead of Chebyshev distance, so the ring is
      // round. Weight set by outer/inner radii, not stroke width.
      float d = length(uv);
      float aa = fwidth(d);
      float outer = 1.0 - smoothstep(0.32 - aa, 0.32, d);
      float inner = 1.0 - smoothstep(0.20 - aa, 0.20, d);
      alpha = outer - inner;

    } else if (shape == 12) {
      // "[" — left bracket. One vertical segment + two short horizontal
      // serifs at the top and bottom. At a 0.14 stroke the serifs read as
      // squarish caps rather than thin feet — heavy bracket character.
      float dV = sdSegment(uv, vec2(-0.18, -0.38), vec2(-0.18, 0.38));
      float dT = sdSegment(uv, vec2(-0.18,  0.38), vec2( 0.10, 0.38));
      float dB = sdSegment(uv, vec2(-0.18, -0.38), vec2( 0.10, -0.38));
      float d = min(dV, min(dT, dB));
      float aa = fwidth(d);
      alpha = 1.0 - smoothstep(0.08 - aa, 0.08, d);

    } else {
      // "]" — right bracket, mirror of "[". Vertical on the right, serifs
      // extending leftward.
      float dV = sdSegment(uv, vec2( 0.18, -0.38), vec2( 0.18, 0.38));
      float dT = sdSegment(uv, vec2(-0.10,  0.38), vec2( 0.18, 0.38));
      float dB = sdSegment(uv, vec2(-0.10, -0.38), vec2( 0.18, -0.38));
      float d = min(dV, min(dT, dB));
      float aa = fwidth(d);
      alpha = 1.0 - smoothstep(0.08 - aa, 0.08, d);
    }

    // Skip pixels that didn't land on the symbol. Matches the original
    // shader's early-discard intent — most of each sprite's quad is empty
    // space around the mark, and discarding here saves the blend write.
    if (alpha < 0.01) discard;

    // Flat color over white. "More visible when disturbed" = MORE opaque
    // (more saturated against the ground), not brighter. uGrow attenuates
    // the whole field for the handoff-gate fade; vDim carries the ambient
    // twinkle (1.0 for steady or disturbed particles).
    float opacity = (0.55 + vIntensity * 0.45) * alpha * uGrow * vDim;

    gl_FragColor = vec4(vColor, opacity);
  }
`;

/* -----------------------------------------------------------------------------
   SVG → texture helper. Rasterizes an SVG by drawing it onto a hidden canvas
   at a chosen pixel width, then returns the canvas as a CanvasTexture plus
   the SVG's intrinsic aspect ratio (so the caller can size a plane to match).

   Why rasterize manually instead of leaning on THREE.TextureLoader: the
   loader uses the SVG's intrinsic pixel size (taken from viewBox or width/
   height attributes), which for a typical logo is very small — sometimes
   under 300px wide. Scaled onto a screen-sized plane the edges look jagged.
   Drawing onto a high-res canvas ourselves guarantees crisp output no matter
   what the source SVG's dimensions happen to be.

   Returns a Promise so the caller can attach the result asynchronously.
   --------------------------------------------------------------------------- */
function loadSvgAsTexture(THREE, url, rasterWidth = 2048) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const aspect = img.naturalWidth / img.naturalHeight;
      const rasterHeight = Math.max(1, Math.round(rasterWidth / aspect));
      const cnv = document.createElement("canvas");
      cnv.width = rasterWidth;
      cnv.height = rasterHeight;
      cnv.getContext("2d").drawImage(img, 0, 0, rasterWidth, rasterHeight);
      const texture = new THREE.CanvasTexture(cnv);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      resolve({ texture, aspect });
    };
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

/* -----------------------------------------------------------------------------
   REGISTER THE SCENE TYPE
   --------------------------------------------------------------------------- */
registerSceneType("dots", (ctx) => {
  const { THREE, renderer, scene, camera, width, height, panelIndex } = ctx;

  /* ---- CAMERA ------------------------------------------------------------
     Replace the default PerspectiveCamera's parameters with Drift's framing.
     The system's resize() default auto-updates camera.aspect on region size
     changes, but here we own resize() (to recompute bounds) and update aspect
     ourselves there.                                                       */
  camera.fov = CONFIG.camera.fov;
  camera.near = CONFIG.camera.near;
  camera.far = CONFIG.camera.far;
  camera.position.set(0, 0, CONFIG.camera.z);
  camera.lookAt(0, 0, 0);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  /* ---- BOUNDS (per-instance, derived from camera + region size) ----------
     Half-extent on x/y, in world units, such that the field at z=0 covers
     the entire visible area plus a margin (so wrap seams happen offscreen).
     Recomputed in resize().                                                */
  function computeBounds(w, h) {
    const vFOV = (CONFIG.camera.fov * Math.PI) / 180;
    const halfH = Math.tan(vFOV / 2) * CONFIG.camera.z;
    const halfW = halfH * (w / h);
    return Math.max(halfW, halfH) * CONFIG.particles.boundsMargin;
  }
  let bounds = computeBounds(width, height);

  /* ---- PARTICLE BUFFERS --------------------------------------------------
     Three Float32Arrays:
       positions  → uploaded to GPU each frame (DynamicDrawUsage)
       speeds     → uploaded to GPU each frame (DynamicDrawUsage)
       velocities → CPU-only, never uploaded
     Plus a static `colors` attribute uploaded once.                        */
  const { count, depth } = CONFIG.particles;
  const palette = CONFIG.color.palette.map((hex) => new THREE.Color(hex));

  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const velocities = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const shapes = new Float32Array(count);   // one symbol ID per particle (0..SHAPE_COUNT-1)
  const twinkles = new Float32Array(count); // 0 = steady; (0,1] = twinkle seed

  // Uniform fill of the volume, tiny random initial drift, color and shape
  // picked once per particle and frozen for its lifetime.
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    positions[i3]     = (Math.random() * 2 - 1) * bounds;
    positions[i3 + 1] = (Math.random() * 2 - 1) * bounds;
    positions[i3 + 2] = (Math.random() * 2 - 1) * depth;

    velocities[i3]     = (Math.random() * 2 - 1) * 0.5;
    velocities[i3 + 1] = (Math.random() * 2 - 1) * 0.5;
    velocities[i3 + 2] = (Math.random() * 2 - 1) * 0.5;

    const c = palette[(Math.random() * palette.length) | 0];
    colors[i3]     = c.r;
    colors[i3 + 1] = c.g;
    colors[i3 + 2] = c.b;

    // Uniform random over the symbol set. Float storage (WebGL1-compatible);
    // shader rounds to nearest int before branching.
    shapes[i] = (Math.random() * SHAPE_COUNT) | 0;

    // A fixed subset twinkles; the seed doubles as the shader's phase and
    // rate source. 0 is the "steady" sentinel, so twinklers get a value
    // clamped just above it. Assigned once, static for the particle's
    // lifetime — same pattern as color.
    twinkles[i] = Math.random() < CONFIG.twinkle.fraction
      ? Math.random() * 0.999 + 0.001
      : 0;
  }

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const speedAttr = new THREE.BufferAttribute(speeds, 1);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  speedAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", posAttr);
  geometry.setAttribute("aSpeed", speedAttr);
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  // Named (unlike aColor) because glyph swaps flag it for re-upload — see
  // stepGlyphSwaps below. Default StaticDrawUsage is still right: a couple
  // of uploads per second is nowhere near "dynamic".
  const shapeAttr = new THREE.BufferAttribute(shapes, 1);
  geometry.setAttribute("aShape", shapeAttr);
  geometry.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkles, 1));

  /* ---- MATERIAL (per-instance — its own uniforms, especially uGrow) ----- */
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMaxSpeed:   { value: CONFIG.motion.flareSpeed },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uBaseSize:   { value: 3.4 },
      uSizeRest:   { value: CONFIG.particles.sizeRest },
      uSizeFlare:  { value: CONFIG.particles.sizeFlare },
      uTime:         { value: 0 },   // scene seconds; twinkle clock
      uTwinkleDepth: { value: CONFIG.twinkle.depth },
      uVortexPos:    { value: new THREE.Vector2(0, 0) },
      uVortexI:      { value: 0 },
      uVortexR:      { value: CONFIG.vortex.radius },
      uVortexSize:   { value: CONFIG.vortex.sizeFlare },
      uVortexFalloff:{ value: CONFIG.vortex.sizeFalloff },
      uGrow:       { value: 0 },         // ↑ on entry, ↓ on exit, via handoff
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,                   // points don't occlude each other
    depthTest: true,                     // so the SVG plane (if any) can occlude
                                         //   particles behind it in world space.
                                         //   Reading depth is safe regardless of
                                         //   whether a plane is present: when
                                         //   no one wrote to the buffer, every
                                         //   particle passes the test trivially.
    blending: THREE.NormalBlending,      // solid colors over white, not additive
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  /* ---- SVG PLANE (optional, per-panel config) ----------------------------
     If the panel declares an `svg` field, load and rasterize it into a
     textured plane that lives in the field's 3D space. Particles in front
     draw over it; particles behind are depth-occluded by it.

     Config (all optional except url):
       svg: {
         url: "...",                       // path to the SVG
         widthFraction: 0.20,              // plane width as fraction of the
                                           //   viewport width, evaluated at the
                                           //   plane's z plane (so scale is
                                           //   resolution-aware).
         position: { x: 0, y: 0, z: 8 },   // world-unit offset; z is depth in
                                           //   the field (range ±24). Higher
                                           //   z = closer to camera.
       }

     RENDERING APPROACH — two coplanar meshes ("depth-then-visual")
       The naive single-opaque-plane approach can't fade its own opacity
       (opaque pass doesn't blend), and snapping on/off is asymmetric: on
       the way in, particles fade in around the snap so it hides in the
       near-zero opacity of the whole field; on the way out, the SVG sits
       at full opacity throughout the field's fade, then snaps off at the
       end against a now-thin field, which the eye locks onto.

       The fix is two meshes at the same world position:

         depthMesh — colorWrite:false, depthWrite:true, alphaTest:0.5,
                     transparent:false. Renders in the OPAQUE pass. Outputs
                     nothing visible; only writes depth at the SVG's solid
                     pixels. This is what occludes particles behind.

         visualMesh — transparent:true, depthWrite:false, depthTest:true,
                      renderOrder:-1. Renders in the TRANSPARENT pass with
                      renderOrder forced BEFORE particles (default 0). Draws
                      the SVG with material.opacity = grow, so the visual
                      fades smoothly with the rest of the field.

       Render sequence each frame:
         1. opaque pass — depthMesh writes silhouette depth, no color
         2. transparent pass, renderOrder=-1 — visualMesh paints the SVG
         3. transparent pass, renderOrder=0 — particles render with
            depthTest:true. Particles in front of the silhouette pass and
            draw over the visualMesh; particles behind fail and are
            discarded.

       Both meshes are toggled visible/hidden together at grow > 0.005 — a
       threshold low enough to be unnoticeable. The fade you'll see is the
       visualMesh's smooth opacity ramp, identical in feel to the particle
       field's own fade.

       NOTE on exit behavior: while the field fades out, the depthMesh
       keeps writing depth, so particles BEHIND the silhouette stay hidden
       until the panel is fully gone. This is correct — the spatial
       relationship "those particles are behind the SVG" is true regardless
       of how visible the SVG happens to be. If a dissolution effect
       (particles emerging through the SVG as it fades) is ever wanted,
       that's a different setup — drop the depthMesh entirely and accept
       that all particles render as if in front. The current behavior
       preserves depth all the way through the fade, which reads as
       "the scene leaves as a whole."

     ASYNC LOAD
       The Image fetch + canvas rasterize happens off the main thread.
       Until it completes, the scene renders without the plane (no error,
       just no logo).                                                       */
  const svgConfig = ctx.panel && ctx.panel.svg;
  let svgDepthMesh = null;
  let svgVisualMesh = null;
  let svgAspect = 1;

  function svgPlaneWorldWidth(viewportW, viewportH) {
    // The plane's z determines its distance from camera, which determines
    // its visible-frustum size. So world-width-per-fraction must be evaluated
    // at the plane's z, not at the field's z=0 (where particles live).
    const z = (svgConfig && svgConfig.position && svgConfig.position.z) ?? 8;
    const distance = CONFIG.camera.z - z;
    const vFOV = (CONFIG.camera.fov * Math.PI) / 180;
    const visibleHeight = 2 * Math.tan(vFOV / 2) * distance;
    const visibleWidth = visibleHeight * (viewportW / viewportH);
    return visibleWidth * ((svgConfig && svgConfig.widthFraction) ?? 0.20);
  }

  if (svgConfig && svgConfig.url) {
    loadSvgAsTexture(THREE, svgConfig.url)
      .then(({ texture, aspect }) => {
        svgAspect = aspect;
        const w = svgPlaneWorldWidth(width, height);
        const h = w / aspect;
        const geom = new THREE.PlaneGeometry(w, h);
        const pos = (svgConfig.position) || {};
        const px = pos.x ?? 0;
        const py = pos.y ?? 0;
        const pz = pos.z ?? 8;

        // Depth-only mesh — writes silhouette into depth buffer, draws no
        // visible pixels. Lives in the opaque pass because transparent:false.
        const depthMat = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: false,
          alphaTest: 0.5,          // discard fully-transparent texture pixels
          depthWrite: true,
          depthTest: true,
          colorWrite: false,       // no color output, only depth
        });
        svgDepthMesh = new THREE.Mesh(geom, depthMat);
        svgDepthMesh.position.set(px, py, pz);

        // Visual mesh — draws the SVG with smoothly-fading opacity. Shares
        // the geometry with the depth mesh (cheaper than allocating two).
        // renderOrder: -1 forces it to render BEFORE particles within the
        // transparent pass, so particles in front overpaint it correctly.
        const visualMat = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,       // depthMesh already owns this silhouette's depth
          depthTest: true,         // (no-op here; nothing in front in our scene)
          opacity: 0,              // starts invisible; update() ties it to grow
        });
        svgVisualMesh = new THREE.Mesh(geom, visualMat);
        svgVisualMesh.position.set(px, py, pz);
        svgVisualMesh.renderOrder = -1;

        scene.add(svgDepthMesh);
        scene.add(svgVisualMesh);
      })
      .catch((err) => {
        console.warn(`dotsScene: failed to load SVG "${svgConfig.url}"`, err);
      });
  }

  /* ---- HUD PLANE (live displacement counter) -----------------------------
     A canvas-textured plane anchored to the bottom-left of the viewport,
     showing a running count of how many particles have been disturbed by
     the cursor wake or held vortex over the session.

     WHY IN THE SCENE, NOT IN THE HTML OVERLAY
       The data source (per-particle velocity → "is this particle
       disturbed?") lives in the integration loop, which is here. Putting
       the display next to the data keeps everything in one file: no
       cross-module reads, no shared registries, no DOM side channel. The
       trade-off is one more textured plane in the scene graph. Worth it.

     WHY ONE MESH (NOT THE SVG PLANE'S DEPTH+VISUAL PAIR)
       The SVG plane is "in the world" — particles in front of it should
       overpaint, particles behind should be occluded. That requires
       writing depth and reading depth (two meshes).
       The HUD is UI chrome — it should ALWAYS render on top, regardless
       of where particles are in 3D. One mesh, depthTest:false (skip
       depth check entirely), high renderOrder (draws after particles
       within the transparent pass).

     SIZING / POSITIONING
       Dimensions are authored in SCREEN PIXELS (CONFIG.hud.*). The plane's
       world units are derived from the viewport's world-units-per-pixel
       ratio at z=0, computed in computeHudPlacement() and re-evaluated
       in resize() so the HUD stays the same SCREEN size regardless of
       viewport. (Contrast with the SVG plane, which stays a fixed
       FRACTION of viewport width — different intent, different math.)   */

  // Speed threshold for "displaced" detection. Derived from the shader's
  // wake threshold (vIntensity > 0.30) so the count tracks what the user
  // can actually SEE flaring on screen:
  //   vIntensity = pow(sp / flareSpeed, 0.6) > 0.30
  //   →  sp > flareSpeed * 0.30^(1/0.6)  ≈  flareSpeed * 0.137
  // Kept as a derived local rather than a CONFIG knob so it stays in sync
  // with the shader if flareSpeed is retuned.
  const HUD_DISPLACEMENT_SPEED =
    CONFIG.motion.flareSpeed * Math.pow(0.30, 1 / 0.6);

  // Per-particle flag: was this particle above the threshold last frame?
  // Used to detect rising-edge crossings (below → above) so the counter
  // ticks once per displacement event rather than once per frame the
  // particle is disturbed. Uint8 is 1 byte/particle (~22kB total) and
  // cheap to read/write inside the integration loop.
  const wasDisplaced = new Uint8Array(count);
  let displacedCount = 0;
  let lastRenderedCount = -1;   // forces a first paint when initial render runs

  // Update-afterglow state: seconds since the count last changed. Starts
  // at Infinity so nothing glows before the first real write. Aged by dt
  // in update(), which means a culled (frozen) field also freezes its
  // glow — consistent with the field freezing in place.
  let hudGlowAge = Infinity;

  // The two HUD inks, parsed once; renderHud lerps between them per paint.
  // THREE.Color does the hex parsing and the lerp for free.
  const hudInk  = new THREE.Color(CONFIG.hud.textColor);
  const hudGlow = new THREE.Color(CONFIG.hud.glowColor);
  const hudMix  = new THREE.Color();

  // Build the canvas the texture samples from. Upscaled so the GPU sampler
  // has plenty of source pixels — text reads crisp at any DPR or zoom.
  const hudCanvas = document.createElement("canvas");
  hudCanvas.width  = CONFIG.hud.planeWidthPx  * CONFIG.hud.canvasUpscale;
  hudCanvas.height = CONFIG.hud.planeHeightPx * CONFIG.hud.canvasUpscale;
  const hudCtx = hudCanvas.getContext("2d");
  const hudTexture = new THREE.CanvasTexture(hudCanvas);
  hudTexture.minFilter = THREE.LinearFilter;
  hudTexture.magFilter = THREE.LinearFilter;

  const hudMaterial = new THREE.MeshBasicMaterial({
    map: hudTexture,
    transparent: true,
    depthWrite: false,
    depthTest:  false,           // HUD always on top; ignore particle depth
    opacity: 0,                  // ties to `grow` in update() — fades with field
  });
  // Placeholder geometry; real dimensions are set in applyHudPlacement().
  const hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hudMaterial);
  hudMesh.renderOrder = 100;     // after particles (default 0) and SVG (-1)
  scene.add(hudMesh);

  // Repaint the canvas with a new count. Called when the displayed value
  // changes, and — per the update-afterglow — once per frame while a
  // recent write's glow decays (see the repaint gate in update()). `glow`
  // is 0..1: 1 = fresh write (full glowColor tint), 0 = settled ink.
  function renderHud(value, glow = 0) {
    const w = hudCanvas.width;
    const h = hudCanvas.height;
    hudCtx.clearRect(0, 0, w, h);

    const fontPx = CONFIG.hud.textHeightPx * CONFIG.hud.canvasUpscale;
    hudCtx.font = `${fontPx}px ${CONFIG.hud.fontFamily}`;
    // Letter-spacing on Canvas 2D is supported in modern browsers
    // (Chrome 99+, Safari 16+, Firefox 113+). Falls back gracefully to
    // 0 spacing on older browsers — the count still renders, just tighter.
    hudCtx.letterSpacing = CONFIG.hud.letterSpacing;
    hudCtx.textBaseline = "middle";
    hudCtx.textAlign = "left";
    hudMix.copy(hudInk).lerp(hudGlow, glow);
    hudCtx.fillStyle = `#${hudMix.getHexString()}`;

    // Vertically centered in the canvas; small left padding so the text
    // doesn't hug the texture edge (which would touch the plane edge).
    const padLeftPx = 2 * CONFIG.hud.canvasUpscale;
    const text = `DISPLACED > ${value.toLocaleString("en-US")}`;
    hudCtx.fillText(text, padLeftPx, h / 2);

    hudTexture.needsUpdate = true;
  }

  // Compute the HUD plane's world-space position and dimensions for the
  // current viewport. Position is the MESH CENTER, so we offset by half
  // the plane size from the viewport's bottom-left corner.
  function computeHudPlacement(w, h) {
    const vFOV = (CONFIG.camera.fov * Math.PI) / 180;
    const visibleHeight = 2 * Math.tan(vFOV / 2) * CONFIG.camera.z;
    const visibleWidth  = visibleHeight * (w / h);
    const wUnit = visibleHeight / h;                  // world units per screen pixel

    const planeW = CONFIG.hud.planeWidthPx  * wUnit;
    const planeH = CONFIG.hud.planeHeightPx * wUnit;
    const margin = CONFIG.hud.marginPx      * wUnit;

    return {
      cx: -visibleWidth  / 2 + margin + planeW / 2,
      cy: -visibleHeight / 2 + margin + planeH / 2,
      planeW,
      planeH,
    };
  }

  function applyHudPlacement(w, h) {
    const p = computeHudPlacement(w, h);
    hudMesh.position.set(p.cx, p.cy, 0);
    hudMesh.geometry.dispose();
    hudMesh.geometry = new THREE.PlaneGeometry(p.planeW, p.planeH);
  }

  applyHudPlacement(width, height);
  renderHud(0);   // initial paint so the texture isn't blank for the first frame

  // Canvas 2D's `fillText` silently falls back to a system font when the
  // requested face isn't loaded yet — and unlike CSS-rendered text it
  // does NOT swap to the real font once it loads (canvas pixels are
  // frozen after the draw). That produced a visible glitch on first
  // load: the initial paint above used a system monospace (Glitched Book
  // wasn't ready yet), so "DISPLACED > 0" rendered with the fallback's
  // wider glyphs; the next renderHud() call — triggered by the first
  // displacement event — used the now-loaded Glitched Book and the text
  // appeared to shrink.
  //
  // Fix: ask the font system for Glitched Book at the relevant size and
  // re-render once it resolves. The HUD plane's opacity starts at 0 and
  // fades in with `grow`, so this re-paint happens during fade-in —
  // before any user interaction is possible — and is invisible. The
  // immediate paint above stays as a safety net in case document.fonts
  // isn't available or the load fails; a fallback-font HUD is better
  // than a blank one.
  if (document.fonts && typeof document.fonts.load === "function") {
    const fontPx = CONFIG.hud.textHeightPx * CONFIG.hud.canvasUpscale;
    document.fonts.load(`${fontPx}px "Glitched Book"`)
      .then(() => renderHud(displacedCount))
      .catch(() => { /* keep the fallback paint; nothing else to do */ });
  }

  /* ---- POINTER (per-instance) --------------------------------------------
     Listens at window for pointermove/pointerleave. Translates the cursor
     into world-space via THIS scene's camera. Exposes addImpulse(out, x,y,z)
     for the integration loop; particles never see DOM events directly.

     NDC math (clientX / window.innerWidth) assumes the scene fills the
     window — true when the panel declares scene: { type: "dots", fullscreen:
     true }. For a sub-region anchor we'd need to subtract the anchor's
     bounding-rect offset and divide by its width/height instead.           */
  const { radius, strength: pStrength, swirl, falloff } = CONFIG.pointer;

  const world = new THREE.Vector3();
  const lastWorld = new THREE.Vector3();
  const pVel = new THREE.Vector3();
  const pDir = new THREE.Vector3();

  let pActive = false;
  let pSpeed = 0;
  let hasLast = false;

  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();

  function screenToWorld(clientX, clientY) {
    ndc.x = (clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    raycaster.ray.intersectPlane(plane, hit);
    return hit;
  }

  function onPointerMove(e) {
    const p = screenToWorld(e.clientX, e.clientY);
    world.copy(p);
    if (hasLast) {
      // Delta between events: BOTH direction and magnitude matter — the
      // direction sets the wake axis, the magnitude scales the force.
      pVel.subVectors(world, lastWorld);
      pSpeed = pVel.length();
      if (pSpeed > 1e-4) pDir.copy(pVel).normalize();
      pActive = pSpeed > 1e-3;
    }
    lastWorld.copy(world);
    hasLast = true;
  }
  function onPointerLeave() {
    pActive = false;
    pSpeed = 0;
    // Also release the vortex — the cursor's left the window, the user
    // can't be "holding" anymore. Without this the vortex would stay
    // engaged at whatever world position the cursor last had.
    vortexHeld = false;
  }

  // VORTEX state (per-instance). vortexHeld is the raw button-down flag;
  // vortex is the eased intensity actually used to scale forces. Held → ease
  // up at easeInRate. Released → ease down at easeOutRate (faster, so the
  // release feels snappy and particles fly off in their orbital trajectories
  // before the field's reabsorb starts pulling them back to ambient).
  let vortexHeld = false;
  let vortex = 0;

  function onPointerDown(e) {
    // Primary button only — ignore right-click and middle-click so context
    // menus / scroll-clicks don't trigger the vortex by accident.
    if (e.button !== 0) return;
    vortexHeld = true;
  }
  function onPointerUp(e) {
    if (e.button !== 0) return;
    vortexHeld = false;
  }

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);

  // Per-frame: cursor velocity decays so the wake fades smoothly between
  // sparse pointermove events. No move ⇒ no force.
  function pointerDecay() {
    pSpeed *= 0.82;
    if (pSpeed < 1e-3) pActive = false;
  }

  const toParticle = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  /* Add this frame's wake impulse for a particle at (x,y,z) into `out`.
     The force radiates from the cursor's PATH (its velocity), not its
     position: particles are dragged ALONG the direction of travel, and
     given a tangential swirl → trailing vortex on fast swipes. No motion
     ⇒ no force. Distance is straight-line (NOT wrapped) — wrapping would
     produce a mirror cursor on the opposite edge.                          */
  function addImpulse(out, x, y, z) {
    if (!pActive || pSpeed < 1e-3) return;
    toParticle.set(x - world.x, y - world.y, z - world.z);
    const dist = toParticle.length();
    if (dist > radius) return;

    const f = Math.pow(1 - dist / radius, falloff);
    const mag = pStrength * pSpeed * f;

    // Primary force: along direction of travel (caught in wake).
    out.x += pDir.x * mag;
    out.y += pDir.y * mag;

    // Swirl: tangent perpendicular to travel direction, signed by which side
    // of the path the particle is on → curl around the sweep.
    tangent.set(-pDir.y, pDir.x, 0);
    const side = Math.sign(toParticle.x * tangent.x + toParticle.y * tangent.y) || 1;
    out.x += tangent.x * mag * swirl * side;
    out.y += tangent.y * mag * swirl * side;
  }

  /* Add this frame's VORTEX impulse for a particle at (x,y,z) into `out`.

     Forces composed (both multiplied by current `vortex` intensity):
       1. Radial pull toward cursor in (x,y). Magnitude pullStrength,
          smoothly tapered to 0 at the outer rim (rNorm → 1) via a
          (1 - rNorm²) falloff. Inside coreRadius the sign flips to a
          gentle outward push (scaled by pullCorePush) so particles don't
          collapse to a singularity.
       2. Tangential spin perpendicular to the radial direction in (x,y).
          Magnitude scales as 1/(rNorm + ε)^spinFalloff — closer particles
          orbit faster. This is the velocity gradient that visually defines
          the swirl.

     Wobble: the effective radial position is perturbed by a low-frequency
     noise sampled at (angle * wobbleSpatial, t * wobbleFreq). The locus
     "radius = const" becomes a wobbling, breathing closed curve instead of
     a static circle. Forces compute against the perturbed rNorm, so the
     vortex's apparent shape warps with the wobble.

     z is left untouched — this is a planar vortex; the gentle z-centering
     in stepParticles is enough to handle the depth dimension.

     Distance is straight-line (no wrap), same as the wake.                 */
  function addVortexImpulse(out, x, y, z, t) {
    if (vortex < 1e-3) return;

    const dx = x - world.x;
    const dy = y - world.y;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r < 1e-3) return;     // exactly at center: skip (avoid /0; force is 0 there anyway)

    const { radius: vR, pullStrength, spinStrength, spinFalloff,
            pullCorePush, coreRadius,
            wobbleAmplitude, wobbleFreq, wobbleSpatial } = CONFIG.vortex;

    // Angle and per-particle wobble. Reuse the existing module-scope noise
    // (noiseX is fine — we just need any smooth 3D noise field). Sampling
    // at (cos(θ), sin(θ), t) keeps the noise continuous as θ wraps from
    // 2π to 0, which a 1D noise(angle, t) wouldn't.
    const theta = Math.atan2(dy, dx);
    const wobbleSample = noiseX(
      Math.cos(theta) * wobbleSpatial,
      Math.sin(theta) * wobbleSpatial,
      t * wobbleFreq,
    );
    const effectiveR = vR * (1 + wobbleAmplitude * wobbleSample);
    if (r > effectiveR) return;

    // Normalized radial position 0 (at center) to 1 (at perturbed rim).
    const rNorm = r / effectiveR;

    // Radial unit vector (points OUTWARD from cursor toward particle).
    const ux = dx / r;
    const uy = dy / r;

    // --- Radial pull ---
    // Smooth taper to 0 at rNorm = 1 via (1 - rNorm²). Strong in the
    // mid-band where you want the visible gravitation.
    const taper = 1 - rNorm * rNorm;
    let radial = -pullStrength * taper;    // negative → toward cursor

    // Anti-collapse: inside coreRadius the sign flips to a small outward
    // push. The push tapers smoothly to 0 at the boundary of the core.
    if (rNorm < coreRadius) {
      const coreT = 1 - rNorm / coreRadius;      // 1 at center, 0 at core edge
      radial += pullStrength * pullCorePush * coreT;
    }

    // --- Tangential spin ---
    // Perpendicular to the radial direction. Magnitude scales as
    // 1/(rNorm + ε)^spinFalloff so closer particles get bigger kicks. Sign
    // chosen consistent (counterclockwise) so the whole field rotates the
    // same way regardless of angle.
    const eps = 0.08;        // prevent blow-up right at center
    const spinMag = spinStrength / Math.pow(rNorm + eps, spinFalloff);

    // Counterclockwise tangent: (-uy, ux). Multiply by spin magnitude.
    const tx = -uy * spinMag;
    const ty = ux * spinMag;

    // Final forces, all scaled by the eased intensity.
    out.x += (ux * radial + tx) * vortex;
    out.y += (uy * radial + ty) * vortex;
  }

  /* ---- INTEGRATION (the hot path — 22k iterations per frame) -------------
     Reusable scratch vectors so the loop allocates nothing.                 */
  const ambient = new THREE.Vector3();
  const impulse = new THREE.Vector3();

  /* ---------------------------------------------------------------------------
     FLOW GRID — the per-frame cache of the flow field on two small lattices.

     WHY: evaluating the field exactly is six simplex calls per particle —
     ~132k noise evaluations per frame at count = 22000, the single largest
     CPU cost in the site. The field is smooth and its planar structure
     (see FLOW FIELD above) means it's fully described by:
       flowXY — (fx, fy) on an (x, y) lattice          gridXY × gridXY × 2
       flowXZ —  fz      on an (x, z) lattice          gridXY × gridZ
     Refreshing both lattices costs ~18.6k noise calls per frame at the
     default resolution (vs ~132k exact); each particle then does two
     bilinear reads (pure arithmetic, no noise). Same 22k particles, same
     field, same motion — only the lookup changed. Resolution knobs and the
     measured error table live in CONFIG.flow.

     RESOLUTION / EXTENT: fixed lattice DIMENSIONS spanning the live bounds
     (re-read every refresh, so resize takes effect next frame with no
     reallocation). Density in world units therefore varies mildly with
     viewport — irrelevant for ambient drift at 2+ samples per fine feature.
     Lattices are Float32Array, allocated once; the refresh rewrites in place.

     EDGES: lookups clamp to the lattice, which flat-extrapolates at the rim.
     Particles only reach the rim inside the offscreen boundsMargin pad (or
     transiently after a shrink-resize, until the wrap pulls them in), so the
     clamp is never visible.                                                  */
  const FLOW_GX = CONFIG.flow.gridXY;
  const FLOW_GY = CONFIG.flow.gridXY;
  const FLOW_GZ = CONFIG.flow.gridZ;
  const flowXY  = new Float32Array(FLOW_GX * FLOW_GY * 2);
  const flowXZ  = new Float32Array(FLOW_GX * FLOW_GZ);
  let flowInvCellX = 0, flowInvCellY = 0, flowInvCellZ = 0;

  function refreshFlowGrid(t) {
    const w  = bounds;                      // live — resize applies next frame
    const sx = (2 * w)     / (FLOW_GX - 1);
    const sy = (2 * w)     / (FLOW_GY - 1);
    const sz = (2 * depth) / (FLOW_GZ - 1);
    flowInvCellX = 1 / sx;
    flowInvCellY = 1 / sy;
    flowInvCellZ = 1 / sz;

    let di = 0;
    for (let gy = 0; gy < FLOW_GY; gy++) {
      const y = -w + gy * sy;
      for (let gx = 0; gx < FLOW_GX; gx++, di += 2) {
        sampleFlowXY(flowXY, di, -w + gx * sx, y, t);
      }
    }
    di = 0;
    for (let gz = 0; gz < FLOW_GZ; gz++) {
      const z = -depth + gz * sz;
      for (let gx = 0; gx < FLOW_GX; gx++, di++) {
        flowXZ[di] = sampleFlowZ(-w + gx * sx, z, t);
      }
    }
  }

  /* Reconstruct the field at (x, y, z) from the current frame's lattices —
     one bilinear read per plane, written into `out`. Replaces the exact
     sampleFlow() call on the hot path; swap this call back to
     sampleFlow(out, x, y, z, t) in stepParticles to A/B against ground
     truth. */
  function sampleFlowFromGrid(out, x, y, z) {
    // Continuous lattice coords, clamped so ix+1 / iy+1 / iz+1 stay in range.
    let fx = (x + bounds) * flowInvCellX;
    let fy = (y + bounds) * flowInvCellY;
    let fz = (z + depth)  * flowInvCellZ;
    if (fx < 0) fx = 0; else if (fx > FLOW_GX - 1.001) fx = FLOW_GX - 1.001;
    if (fy < 0) fy = 0; else if (fy > FLOW_GY - 1.001) fy = FLOW_GY - 1.001;
    if (fz < 0) fz = 0; else if (fz > FLOW_GZ - 1.001) fz = FLOW_GZ - 1.001;

    const ix = fx | 0, iy = fy | 0, iz = fz | 0;
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;

    // (fx, fy) — bilinear over the (x, y) lattice.
    const r0 = (iy * FLOW_GX + ix) * 2;
    const r1 = r0 + FLOW_GX * 2;
    const x0 = flowXY[r0]     + (flowXY[r0 + 2] - flowXY[r0])     * tx;
    const x1 = flowXY[r1]     + (flowXY[r1 + 2] - flowXY[r1])     * tx;
    const y0 = flowXY[r0 + 1] + (flowXY[r0 + 3] - flowXY[r0 + 1]) * tx;
    const y1 = flowXY[r1 + 1] + (flowXY[r1 + 3] - flowXY[r1 + 1]) * tx;
    out.x = x0 + (x1 - x0) * ty;
    out.y = y0 + (y1 - y0) * ty;

    // fz — bilinear over the (x, z) lattice.
    const s0 = iz * FLOW_GX + ix;
    const s1 = s0 + FLOW_GX;
    const z0 = flowXZ[s0] + (flowXZ[s0 + 1] - flowXZ[s0]) * tx;
    const z1 = flowXZ[s1] + (flowXZ[s1 + 1] - flowXZ[s1]) * tx;
    out.z = z0 + (z1 - z0) * tz;
  }

  function stepParticles(dt, t) {
    const { drag, maxSpeed, reabsorb, zCentering } = CONFIG.motion;
    // bounds is read once per frame (live, so resize takes effect next frame),
    // not per particle — negligible cost, no per-particle staleness.
    const wrap = bounds;

    // Loop-invariant physics factors, hoisted: both depend only on dt, so
    // computing them per particle was 22k redundant evaluations per frame
    // (Math.pow being the expensive one).
    const k = reabsorb * dt;                // reabsorption ease factor
    const d = Math.pow(drag, dt * 60);      // drag, raised to dt so behavior
                                            //   is consistent across frame rates

    // Re-sample the flow field onto the lattices for this frame. Everything
    // below reads the field via sampleFlowFromGrid — see FLOW GRID above.
    refreshFlowGrid(t);

    // Wake and vortex are both frame-constant gates (pActive / pSpeed / the
    // eased vortex strength don't change inside the loop). In the idle
    // steady state — no cursor motion, no held click — skip both calls for
    // the whole frame instead of paying 44k early-returning dispatches.
    // `impulse` is zeroed once here and stays zero for the frame.
    const anyImpulse = (pActive && pSpeed >= 1e-3) || vortex >= 1e-3;
    impulse.set(0, 0, 0);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const px = positions[i3];
      const py = positions[i3 + 1];
      const pz = positions[i3 + 2];

      // What the field "wants" at this position right now — reconstructed
      // from this frame's lattices (exact call: sampleFlow(ambient, px, py,
      // pz, t) — kept for A/B).
      sampleFlowFromGrid(ambient, px, py, pz);

      // Cursor wake — zero unless cursor is near AND moving.
      // Vortex — zero unless the user is holding a click (and eased to 0
      // shortly after release). Both contribute additively into impulse.
      if (anyImpulse) {
        impulse.set(0, 0, 0);
        addImpulse(impulse, px, py, pz);
        addVortexImpulse(impulse, px, py, pz, t);
      }

      let vx = velocities[i3];
      let vy = velocities[i3 + 1];
      let vz = velocities[i3 + 2];

      // Reabsorption: ease velocity toward ambient. NOT a spring to a home
      // position — there is no home. A gentle pull of momentum back into the
      // current. Frame-rate-relative so it stays smooth. (k hoisted above.)
      vx += (ambient.x - vx) * k;
      vy += (ambient.y - vy) * k;
      vz += (ambient.z - vz) * k;

      // Wake impulse as additive velocity change.
      vx += impulse.x * dt;
      vy += impulse.y * dt;
      vz += impulse.z * dt;

      // Feather-light z-centering. Prevents minutes of cursor disturbance
      // from slowly biasing depth distribution outward.
      vz -= pz * zCentering * dt;

      // Drag — bleed energy so disturbances settle without springing back.
      // (d hoisted above the loop — it depends only on dt.)
      vx *= d; vy *= d; vz *= d;

      // Speed clamp — physics safety on a violent swipe.
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (sp > maxSpeed) {
        const s = maxSpeed / sp;
        vx *= s; vy *= s; vz *= s;
      }

      // Integrate position.
      let nx = px + vx * dt;
      let ny = py + vy * dt;
      let nz = pz + vz * dt;

      // X / Y: toroidal wrap (seamless because wraps happen offscreen, beyond
      // the boundsMargin pad).
      if (nx >  wrap) nx -= wrap * 2; else if (nx < -wrap) nx += wrap * 2;
      if (ny >  wrap) ny -= wrap * 2; else if (ny < -wrap) ny += wrap * 2;

      // Z: NO wrap. A z-wrap is a visible full-depth teleport (a particle's
      // distance to the camera jumps). Soft reflection instead — particles
      // near the boundary lose half their z-velocity and bounce inward. No
      // seam exists so nothing flickers across it.
      if (nz > depth) {
        nz = depth;
        if (vz > 0) vz = -vz * 0.5;
      } else if (nz < -depth) {
        nz = -depth;
        if (vz < 0) vz = -vz * 0.5;
      }

      positions[i3]     = nx;
      positions[i3 + 1] = ny;
      positions[i3 + 2] = nz;

      velocities[i3]     = vx;
      velocities[i3 + 1] = vy;
      velocities[i3 + 2] = vz;

      speeds[i] = sp;        // feeds shader: size + alpha

      // Displacement counter — rising-edge detection. A particle counts
      // ONCE when its speed crosses from below the threshold to above it.
      // While it stays above, it doesn't re-count; once it drops below
      // and crosses again later, it counts again. Result: the counter
      // ticks per displacement EVENT, not per frame, so it tracks
      // user-caused interactions cleanly. Cheap branch inside the hot
      // loop — one comparison + one read/write to wasDisplaced[i].
      const above = sp > HUD_DISPLACEMENT_SPEED ? 1 : 0;
      if (above && !wasDisplaced[i]) displacedCount++;
      wasDisplaced[i] = above;
    }

    posAttr.needsUpdate = true;
    speedAttr.needsUpdate = true;
  }

  /* ---- GLYPH SWAPS (ambient information — see file header) ---------------
     Every so often a burst of 1..maxPerBurst particles gets its symbol
     discretely reassigned — data fields being rewritten somewhere in the
     array. The interval is re-rolled per burst so the rhythm stays uneven
     (a fixed cadence reads as a metronome). Runs only while update() runs,
     so a culled field doesn't churn; at grow ≈ 0 during fades the swaps
     are invisible and harmless.

     A same-symbol reroll (1-in-14) is a visual no-op and acceptable at
     this subtlety — no dedup loop (contrast the menu-hover dedup, where a
     repeat on a single watched element reads as "nothing happened";
     nobody watches one particle in 22k).

     Cost: flagging shapeAttr re-uploads the full buffer (~88 kB) a couple
     of times per second — noise next to the per-frame position upload.  */
  let nextSwapIn = CONFIG.glyphSwap.maxInterval;   // first burst after one beat
  function stepGlyphSwaps(dt) {
    nextSwapIn -= dt;
    if (nextSwapIn > 0) return;
    const { minInterval, maxInterval, maxPerBurst } = CONFIG.glyphSwap;
    nextSwapIn = minInterval + Math.random() * (maxInterval - minInterval);
    const n = 1 + ((Math.random() * maxPerBurst) | 0);
    for (let k = 0; k < n; k++) {
      const p = (Math.random() * count) | 0;
      shapes[p] = (Math.random() * SHAPE_COUNT) | 0;
    }
    shapeAttr.needsUpdate = true;
  }

  /* ---- HANDOFF-GATE PARTICIPATION ----------------------------------------
     Single-channel animator: `grow` eases toward the gate's verdict and
     drives the fragment shader's uGrow uniform. Same value is reported to
     the gate (so OTHER panels see this scene's exit) and to the cull
     (threeArray will skip us once grow drops below SCENE_CULL).

     No multi-channel re-arm needed: there's only one eased property here,
     and it's symmetric across enter/exit. See handoffGate.md §10 (three
     questions) — answers: weight = grow, visual = uGrow alpha multiply,
     law = exponential ease toward isClearToEnter ? 1 : 0.                  */
  let grow = 0;
  registerWeight(panelIndex, () => grow);

  /* ---- HOOKS ------------------------------------------------------------- */
  return {
    update({ dt, t }) {
      // Ease grow toward the gate's verdict. Same shape as every other
      // eased value in the project (exponential, frame-rate independent).
      const target = isClearToEnter(panelIndex) ? 1 : 0;
      grow += (target - grow) * (1 - Math.exp(-GROW_SPEED * dt));
      material.uniforms.uGrow.value = grow;
      material.uniforms.uTime.value = t;   // twinkle clock (carrier only)

      // The SVG plane: smooth visual fade via opacity = grow on the visual
      // mesh, while the depth mesh keeps writing the silhouette into the
      // depth buffer to occlude particles behind. Both meshes are hidden
      // together at grow < 0.005 (essentially "the panel is gone") so the
      // depth doesn't linger after the field is invisible — without that
      // hide, particles behind the silhouette would stay culled even at
      // grow=0, which would be incorrect at near-zero panel state.
      if (svgDepthMesh) {
        const present = grow > 0.005;
        svgDepthMesh.visible = present;
        svgVisualMesh.visible = present;
        svgVisualMesh.material.opacity = grow;
      }

      // HUD plane: same fade-with-grow pattern as the SVG. No depth/visual
      // split (the HUD is UI chrome, not in-world content), so opacity is
      // the only animated property here. Visible threshold mirrors the
      // SVG's so the HUD vanishes cleanly when the panel leaves.
      hudMesh.visible = grow > 0.005;
      hudMesh.material.opacity = grow;
      // Repaint on value change — and, per the update-afterglow, keep
      // repainting while a recent write's glow decays back to ink. A fresh
      // write paints at full glow; each subsequent frame paints the
      // quadratic ease-out of the remainder (steep off the peak, long
      // tail — phosphor). During rapid interaction the count changes
      // every frame, pinning the glow fully lit; it cools once the user
      // stops — the counter visibly "runs hot" under load. Idle cost is
      // unchanged (one comparison per frame); a decaying glow costs one
      // canvas repaint per frame for glowSeconds (~0.1 ms each).
      // displacedCount updates inside stepParticles below, so by the time
      // we get here this frame's count is current.
      if (displacedCount !== lastRenderedCount) {
        hudGlowAge = 0;
        renderHud(displacedCount, 1);
        lastRenderedCount = displacedCount;
      } else if (hudGlowAge < CONFIG.hud.glowSeconds) {
        hudGlowAge += dt;
        const remain = Math.max(0, 1 - hudGlowAge / CONFIG.hud.glowSeconds);
        renderHud(displacedCount, remain * remain);
      }

      // Pointer decays even between pointermove events so the wake settles.
      pointerDecay();

      // Ease the vortex intensity toward 1 (held) or 0 (released), with
      // DIFFERENT rates: holding eases up gently (easeInRate), releasing
      // snaps down quickly (easeOutRate, larger). The asymmetry matters —
      // a slow release would mean particles still feel the vortex's tug
      // as they're trying to fly off in their orbital trajectories,
      // muddying the release moment. A snappy release lets the orbital
      // velocity carry them cleanly into the ambient drift.
      {
        const target = vortexHeld ? 1 : 0;
        const rate = vortexHeld ? CONFIG.vortex.easeInRate
                                : CONFIG.vortex.easeOutRate;
        vortex += (target - vortex) * (1 - Math.exp(-rate * dt));
      }

      // Push the vortex state to the shader so the per-vertex size response
      // can use it. Cheap (a few uniform writes per frame, not per particle).
      // World position is read from the same `world` vector the cursor wake
      // uses, so size-flare follows wherever the cursor is, including when
      // the user drags while holding.
      material.uniforms.uVortexI.value = vortex;
      material.uniforms.uVortexPos.value.set(world.x, world.y);

      // Advance the simulation. Runs only when not culled — when the scene
      // is invisible AND grow has dropped below SCENE_CULL, the system skips
      // this entire update call, so the field freezes in place. When the
      // user scrolls back, the field is exactly where they left it.
      stepParticles(dt, t);
      stepGlyphSwaps(dt);   // ambient rewrites; frozen when culled, like the field
    },

    resize({ width: w, height: h }) {
      bounds = computeBounds(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // No need to reseed particles — the toroidal wrap handles new bounds
      // on the next step (any particle now outside wraps naturally).

      // Rebuild the SVG plane geometry so it stays at widthFraction of the
      // (now-different) viewport width. Dispose the old shared geometry to
      // free GPU memory; the new PlaneGeometry is cheap and gets assigned to
      // BOTH the depth mesh and the visual mesh (they share geometry — saves
      // a vertex-buffer allocation per resize). Aspect comes from the SVG's
      // natural dimensions (stored when the texture loaded), so the plane's
      // shape doesn't distort across resizes.
      if (svgDepthMesh) {
        const newW = svgPlaneWorldWidth(w, h);
        const newH = newW / svgAspect;
        svgDepthMesh.geometry.dispose();
        const newGeom = new THREE.PlaneGeometry(newW, newH);
        svgDepthMesh.geometry = newGeom;
        svgVisualMesh.geometry = newGeom;
      }

      // Rebuild the HUD plane for the new viewport so it stays at fixed
      // SCREEN PIXEL dimensions (anchored bottom-left) regardless of how
      // wide or tall the window is. Same dispose-old-allocate-new pattern
      // as the SVG; cheap, runs only on actual resize events.
      applyHudPlacement(w, h);
    },

    // Cull weight (read by threeArray). Same value the handoff gate sees.
    weight: () => grow,

    // Future-proofing: if disposeScene(i) is ever called, clean up the
    // window listeners (geometry/material are handled by the system's
    // traversal). Not invoked in the base build but exists so cleanup has
    // a path through.
    dispose() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
    },
  };
});