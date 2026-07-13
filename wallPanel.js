/* =============================================================================
   wallPanel.js — the "wall" PANEL TYPE
   -----------------------------------------------------------------------------
   A two-layer panel:

     1. The OVERLAY (.wall-overlay) — left-pinned text block (kicker /
        title / body), scroll-linked: it shifts up/down with --shift as
        the user scrolls between panels, fades via the handoff gate.

     2. The TEXTWALL (.wall-textwall) — a 90% × 90% viewport-fixed
        content block that sits BEHIND the overlay. Does NOT move with
        scroll; the overlay scrolls over the top of it. Fades in/out
        with the same `grow` value as the overlay so the two layers
        enter and leave as one panel.

        The textWall is NOT a scroll container. Its content is fit to
        the box in TWO PHASES: (1) a binary-search on font-size finds
        the largest size that doesn't overflow at the base line-height;
        (2) line-height is then stretched to fill remaining vertical
        space. Combined with text-align: justify in the stylesheet
        (interior lines edge-to-edge; the last line stays ragged, since
        justifying a final line of few terms looks worse than letting
        it sit naturally), the result is text that fills the box
        vertically with horizontally-justified interior lines. Re-run
        on every size change via a ResizeObserver and after web fonts
        finish loading.

        SPAN LAYER + TEXTURE ZONES — the wall's visible text lives in
        ONE absolute-positioned span layer (.wall-spanlayer) holding a
        single span-ified copy of the text, shared by all four
        cursor-driven text-animation primitives via the family's
        layered mode. The original text in .wall-textwall-content
        stays in flow at color: transparent (its scrollHeight is what
        the fit measures). The wall is invisibly partitioned into four
        cursor QUADRANTS; which primitive responds depends on which
        quadrant the cursor is in (see QUADRANT_PRIMITIVES). Event
        routing per primitive is done through four nested
        display:contents wrappers (.wall-zone) — see ZONE ROUTING
        below. A module-level mouse listener synthesizes enter/move/
        leave to exactly one zone at a time.

   No scene, no buttons, no modal. Self-driven fade only — the same
   handoff-gate contract every other panel type uses.

   WHY THE TEXTWALL IS A SIBLING OF THE OVERLAY (NOT A CHILD)
     The overlay carries `transform: translateY(calc(-50% + var(--shift)))`.
     A transformed ancestor creates a containing block for any positioned
     descendant — fixed OR absolute — so a child of the overlay would
     inherit the overlay's shifted coordinate space and drag along with
     scroll. Sibling escapes that: the textWall lives directly in
     #infinite-overlays (which is itself position:fixed at viewport
     coverage, no transform), so absolute positioning there is
     effectively viewport-relative and the textWall stays still as the
     overlay shifts past.

     Same pattern turnPanel.js uses for its drag surface (and for the
     same containing-block reason).

   STACKING — NO Z-INDEX NEEDED
     Sibling positioned elements without explicit z-index stack by DOM
     order: later = higher. The textWall is `insertBefore`-d ahead of
     the overlay in #infinite-overlays so the overlay paints above it.
     That's how the overlay "scrolls over" the textWall.

   FIT-TO-BOX — TWO PHASES, MEASURED ON CLEAN TEXT
     The textWall hosts an inner .wall-textwall-content element sized
     to 100% of the padded inner area. The fit runs in two phases on
     this element:

       Phase 1 — FONT-SIZE (horizontal density). Binary-search between
         FIT_MIN_PX and FIT_MAX_PX for the largest size that doesn't
         overflow at the base line-height. Checks both scrollHeight vs
         clientHeight and scrollWidth vs clientWidth. Converges in
         O(log) layout measurements.

       Phase 2 — LINE-HEIGHT (vertical justify). Same logic as
         text-align: justify, applied to between-line space instead
         of between-word space. The line count N is fixed at the
         settled font-size, so scrollHeight is linear in line-
         height — solve in one shot for the lh that lands the last
         line's glyphs at the bottom of the box. Any bottom half-
         leading inside the last line-box overshoots clientHeight
         and is clipped by overflow:hidden on the outer wall, so
         only empty leading is removed (never glyphs).

     SPAN-LAYER ISOLATION. The probes write font-size on the content
     element, which the span layer inherits — so without isolation,
     every scrollHeight read would force a relayout of ~4,500 spans,
     nine times per fit, even though the fit only measures the PLAIN
     in-flow text. fitTextToBox therefore sets content-visibility:
     hidden on the span layer for the duration of the (synchronous)
     fit and restores it before returning. All probes then lay out a
     single text node; the spans relayout ONCE at the settled metrics.
     Everything happens inside one rAF callback, so the browser paints
     once — the hidden state is never visible. Where content-visibility
     is unsupported, the inline style is ignored and the fit simply
     runs at the old (slower) cost: graceful, no branching needed.

     Phase 2 only stretches upward. If the font-size phase had to
     settle at FIT_MIN_PX with content still overflowing (viewport
     too small for the content), shrinking line-height below the base
     would only cramp lines without solving the overflow — outer
     overflow:hidden clips the excess instead. Graceful degradation.

     A ResizeObserver re-runs the fit whenever the textWall changes
     size (viewport resize, CSS load completing, etc.) — and refreshes
     the cached wall rect (see CACHED RECT below). Each schedule is
     RAF-coalesced so a burst of resize events runs the fit once per
     frame at most. The fit also re-runs once after
     document.fonts.ready resolves — initial layout might use
     fallback-font metrics, and ResizeObserver doesn't fire on font
     swap since the outer box doesn't change size.

     STALE CENTERS AFTER A RE-FIT. The primitives cache per-character
     centers, recomputed on every (synthetic) mouseenter. A re-fit
     moves every character, so if a primitive is ACTIVE when the fit
     runs, fitTextToBox re-dispatches mouseenter to its zone at the
     last known cursor position to force a center recompute against
     the settled layout. Inactive primitives self-heal on their next
     enter (the primitives' own recompute-on-enter behavior).

   ZONE ROUTING — FOUR PRIMITIVES, ONE SPAN SET
     All four primitives borrow the SAME spans (layered mode), but each
     needs its own rootEl to listen on — events can't be routed
     per-primitive on a shared element. The trick: four nested
     display:contents wrappers between the span layer and the spans,

       .wall-spanlayer > zone-tl > zone-tr > zone-bl > zone-br > spans

     Each zone is one primitive's rootEl. A TreeWalker from any zone
     finds the same text nodes (they're descendants of all four), so
     every primitive borrows the same spans; but each primitive's
     listeners live on its own zone, so dispatching an event to a zone
     fires exactly that primitive. display:contents generates no box —
     the wrappers are layout-invisible and the text lays out exactly
     as if the spans were direct children of the span layer. The
     nesting order is arbitrary (no capture-phase listeners anywhere
     in the family; verified).

     SYNTHETIC EVENTS MUST NOT BUBBLE. mouseenter/mouseleave don't by
     default; mousemove is constructed without bubbles. A bubbling
     mousemove dispatched to an inner zone would climb to the outer
     zones and trip their primitives' deferred-enter fallback (a
     mousemove with cursorInside=false activates the primitive),
     silently waking all four. Non-bubbling dispatch fires target-
     phase listeners only.

     PROPERTY OVERLAP NOTE. hoverScramble and hoverWave both write
     style.color. With one-active-at-a-time gating they only co-write
     during the decay window after a diagonal tl↔br crossing — and
     layered mode's defensive per-frame re-writes on lit characters
     self-heal any clobbered color within a frame. Worst case is a
     one-frame flicker on a fast crossing through center; accepted.
     (two edits: import + QUADRANT_PRIMITIVES entry).

   DOCUMENT-LEVEL CURSOR HANDLING — MODULE-LEVEL, CACHED RECT
     The wall is pointer-events: none and must stay that way. It
     covers ~90% of the viewport and lives as a sibling of the
     scroller in #infinite-overlays, so any pointer-events: auto on
     the wall would catch wheel/touch and break scroll — the events
     would bubble up through #infinite-overlays but never reach the
     scroller, since the scroller isn't an ancestor. Synthetic
     dispatch on a zone fires that zone's primitive's listeners
     (which don't care about hit-testing once an event is dispatched
     directly to their target) without changing the wall's hit-test
     transparency.

     ONE listener pair for the whole module (mousemove + mouseleave on
     document), attached on first instance init, iterating instances.
     Per instance, the visibility gate (grow > HOVER_VISIBILITY_-
     THRESHOLD) and the readiness gate (idle init complete) run BEFORE
     any other work — invisible or not-yet-ready walls cost a Map
     iteration step and two comparisons per mousemove, nothing more.

     The wall's rect is CACHED, not read per move. The textWall is
     viewport-fixed (inset: 5vh 5vw, no transform, unaffected by
     scroll), so its rect only changes when the viewport does — and
     the ResizeObserver already fires exactly then. The handler
     refreshes state.wallRect with one getBoundingClientRect per
     resize; mousemoves read the cache. Zero rect reads per move.

     Consequence of the gates: the data-quadrant DevTools mirror is
     only live while the wall is visible (it used to track the raw
     cursor on invisible walls too — that required the per-move rect
     read this design removes). tick() clears the mirror on fade-out.

   IDLE-CHUNKED PRIMITIVE INIT
     Span-ifying ~4,500 characters and starting four primitives (each
     computing ~4,500 character centers) is the expensive part of wall
     setup. None of it is needed for first paint — the zone markup
     renders as plain text, visually identical to the span-ified
     version. init() therefore builds the cheap DOM synchronously and
     defers the expensive work to idle time: five chunks (one
     span-ify pass + four primitive starts), one per idle slice via
     requestIdleCallback (setTimeout fallback), each with a timeout so
     a busy page can't stall readiness indefinitely. state.ready
     gates the cursor synthesis until all chunks have run; until then
     the wall is a static (correct-looking) surface.

     Idle-time was chosen over init-on-approach (|dist| band in tick):
     a 30–90ms setup hitch during the approach scroll would be visible
     jank at the worst moment, whereas idle chunks finish long before
     a human reaches the panel.

     wallPanel span-ifies the text ITSELF (matching the exact DOM
     shape the entry primitives produce: every text node the sole
     child of a <span>), so all four primitives auto-detect layered
     mode symmetrically. Letting the first primitive create the spans
     (standalone mode) would work too, but would make conflict
     self-healing depend on start order — standalone mode writes on
     transitions only, layered mode re-writes lit chars defensively
     per frame, and the defensive writes are what heal the
     color-surface overlap described under ZONE ROUTING.

   AUTHORING
     - panel.html         — markup for the scrollable overlay
                            (kicker / title / body).
     - panel.textWallHtml — markup for the textWall content. Optional;
                            DEFAULT_TEXTWALL_HTML below is used when
                            absent. Authored markup is placed in both
                            the measurement layer and the span layer
                            automatically — the author supplies
                            content, not the wrappers. Children that
                            should scale with the fit should use em
                            units so they inherit from the wrapper's
                            JS-set font-size; px/rem on children stays
                            fixed.

   COUPLED WITH
     - infiniteScroll.js: registerPanelType, registerWeight, isClearToEnter.
     - wallStyles.css: emits .wall-overlay, .wall-card, .wall-kicker,
       .wall-title, .wall-body, .wall-textwall, .wall-textwall-content,
       .wall-spanlayer, .wall-zone.
   ========================================================================== */

import { registerPanelType, registerWeight, isClearToEnter } from "./infiniteScroll.js";
import { startHoverScramble }   from "./textHoverScramble.js";
import { startSplitPrint }      from "./textSplitPrint.js";
import { startUnderscore } from "./textUnderscore.js";
import { startHoverWave }       from "./textHoverWave.js";

/* -----------------------------------------------------------------------------
   PANEL-TYPE TUNABLES
   --------------------------------------------------------------------------- */
const FADE_SPEED = 12.0;   // self-driven fade easing rate (s⁻¹). Matches
                           //   turnPanel.js so the feel is identical between
                           //   types.

// Fit-to-box tunables.
//   FIT_MIN_PX — readability floor. Below this the text becomes
//     unreadable. If even MIN overflows, we accept clipping rather
//     than further shrinking.
//   FIT_MAX_PX — upper bound for the font-size binary search. Set
//     high enough to effectively act as no cap for realistic content
//     amounts (the binary search converges to a content-appropriate
//     size); the bound just prevents runaway growth on degenerate
//     short content + huge viewport combinations.
//   FIT_EPSILON — binary-search precision. 0.5px is sub-perceptible
//     and converges quickly across the search range.
//   FIT_BASE_LINE_HEIGHT — line-height used during phase 1 (font-size
//     search). Tight (1.2) so the font-size phase can pack characters
//     densely; phase 2 stretches this upward as needed to absorb any
//     residual vertical space. The CSS fallback in wallStyles.css
//     mirrors this value.
const FIT_MIN_PX           = 6;
const FIT_MAX_PX           = 200;
const FIT_EPSILON          = 0.5;
const FIT_BASE_LINE_HEIGHT = 1.2;

// HOVER_VISIBILITY_THRESHOLD — grow value above which synthetic hover
// events fire on a zone to drive its primitive. 0.5 = the wall is more
// visible than not. Below this, the module-level mousemove handler
// skips the instance entirely — invisible wall panels cost two
// comparisons per move. See §DOCUMENT-LEVEL CURSOR HANDLING.
const HOVER_VISIBILITY_THRESHOLD = 0.5;

// IDLE_INIT_TIMEOUT_MS — requestIdleCallback timeout per init chunk.
// On a busy page the browser may not grant idle time promptly; the
// timeout forces each chunk to run within this bound so the wall's
// interactivity can't be deferred indefinitely. Five chunks → worst
// case readiness ≈ 5 × this value; typically all chunks run within
// the first idle moments after load.
const IDLE_INIT_TIMEOUT_MS = 1000;

// QUADRANT_PRIMITIVES — which hover primitive responds in which cursor
// quadrant. All four run in layered mode on ONE shared span set; the
// quadrant only selects which primitive receives synthetic events.
// The mapping is aesthetic preference, no architectural meaning —
// swapping is two edits (import + entry). Note the color-surface
// overlap between hoverScramble and hoverWave described in the file
// header (ZONE ROUTING) if changing this set.
const QUADRANT_PRIMITIVES = {
  tl: startHoverScramble,    // glyph cycling — "data corruption" at cursor
  tr: startSplitPrint,       // CMYK-style misregistration shadows
  bl: startUnderscore,       // Colored underscores around cursor
  br: startHoverWave,        // proximity wave — character tinting near cursor
};

const QUADRANT_KEYS = ["tl", "tr", "bl", "br"];

/* -----------------------------------------------------------------------------
   PER-INSTANCE STATE + MODULE-LEVEL CURSOR CACHE
   --------------------------------------------------------------------------- */
const instances = new Map(); // index -> per-instance state (see init for shape)

// Last known cursor position, shared by all instances. Used by the
// module-level handlers and by fitTextToBox's post-fit center refresh
// (which needs coordinates outside any mouse event).
let lastCursorX = -10000;
let lastCursorY = -10000;

// The module-level document listeners are attached once, on the first
// instance's init — not at module load, so importing the type without
// authoring a wall panel costs nothing.
let docListenersAttached = false;

/* -----------------------------------------------------------------------------
   DEFAULT TEXTWALL CONTENT
   -----------------------------------------------------------------------------
   One continuous run of " / "-separated terms. Multi-word terms (e.g.
   "SOLID BODIES", "PRINCIPAL DIRECTIONS") are joined with non-breaking
   spaces at module load so they wrap as atomic units — only the " / "
   separators are line-break candidates.
   --------------------------------------------------------------------------- */
const TERMS_RAW = `
POINTS/VERTICES/EDGES/FACES/POLYGONS/TRIANGLES/QUADS/NGONS/TETS/HEXES/SURFACES/PATCHES/PANELS/SHELLS/ISLANDS/SOLID.BODIES/VOLUMES/CELLS/VOXELS/VDBS/OPENVDB/SDFS/SIGNED.DISTANCE.FIELDS/LEVEL.SETS/FOG.VOLUMES/DENSITY.GRIDS/X/Y/Z/W/UVS/UVWS/BARYCENTRIC.COORDINATES/PARAMETRIC.COORDINATES/ISOPARAMETERS/WORLD.SPACE/OBJECT.SPACE/LOCAL.SPACE/TANGENT.SPACE/SCREEN.SPACE/NDC/CLIP.SPACE/NORMALS/VERTEX.NORMALS/FACE.NORMALS/EDGE.NORMALS/TANGENTS/BITANGENTS/BINORMALS/CURVATURE/GAUSSIAN.CURVATURE/MEAN.CURVATURE/PRINCIPAL.CURVATURE/PRINCIPAL.DIRECTIONS/GEODESICS/HEAT.METHOD/POINT.ATTRIBUTES/PRIMITIVE.ATTRIBUTES/VERTEX.ATTRIBUTES/DETAIL.ATTRIBUTES/P/N/V/CD/ID/PTNUM/PRIMNUM/PSCALE/ORIENT/UP/PIECE/NAME/CLASS/GROUPS/SELECTION.SETS/MATERIAL.IDS/TAGS/METADATA/LAYERS/COLLECTIONS/HIERARCHIES/PARENT/CHILD/SIBLING/TOPOLOGY/CONNECTIVITY/ADJACENCY.MATRICES/INCIDENCE.MATRICES/NEIGHBOR.LISTS/EDGE.LOOPS/EDGE.RINGS/FACE.LOOPS/BOUNDARY.EDGES/SEAM.EDGES/CREASE.EDGES/HOLES/NON.MANIFOLD.EDGES/WINDING.ORDER/SPLINES/CURVES/POLYLINES/BEZIER/NURBS/B.SPLINES/HERMITE/CATMULL.ROM/CONTROL.POINTS/KNOTS/KNOT.VECTORS/DEGREE/TANGENT.VECTORS/DERIVATIVES/ARC.LENGTH/RESAMPLE/SUBDIVISION/CATMULL.CLARK/LOOP.SUBDIVISION/DOO.SABIN/DECIMATION/REMESHING/RETOPOLOGY/QUAD.DOMINANT/TRIANGULATION/DELAUNAY/VORONOI/CONVEX.HULLS/ALPHA.SHAPES/MARCHING.CUBES/MARCHING.SQUARES/DUAL.CONTOURING/RAY.MARCHING/RAY.CASTING/SPHERE.TRACING/RAY.INTERSECTIONS/BOUNDING.BOXES/BOUNDING.SPHERES/KD.TREES/OCTREES/BVH/SPATIAL.HASHING/SCATTER/POISSON.DISK/BLUE.NOISE/HALTON/SOBOL/STRATIFIED.SAMPLING/SURFACE.SAMPLING/VOLUME.SAMPLING/COPY.TO.POINTS/INSTANCE/PACKED.PRIMITIVES/TRANSFORMS/TRANSLATION/ROTATION/SCALE/SHEAR/QUATERNIONS/EULER.ANGLES/AXIS.ANGLE/3X3.MATRICES/4X4.MATRICES/TRANSFORMATION.MATRICES/BIND.POSE/REST.POSE/SCALAR.FIELDS/VECTOR.FIELDS/TENSOR.FIELDS/DIRECTIONAL.FIELDS/FLOW.FIELDS/CURL.NOISE/DIVERGENCE/VORTICITY/GRADIENT/CURL/LAPLACIAN/VELOCITY/ACCELERATION/FORCE/TORQUE/ANGULAR.VELOCITY/ANGULAR.ACCELERATION/MOMENTUM/KINETIC.ENERGY/POTENTIAL.ENERGY/PERLIN.NOISE/SIMPLEX.NOISE/WORLEY.NOISE/GABOR.NOISE/CELLULAR.NOISE/TURBULENCE/FBM/RIDGED.MULTIFRACTAL/BILLOW/HASH.FUNCTIONS/RANDOM.SEEDS/WHITE.NOISE/PINK.NOISE/L.SYSTEMS/FRACTALS/RECURSION/ITERATION/GENERATIONS/RULES/GRAMMARS/CELLULAR.AUTOMATA/REACTION.DIFFUSION/DIFFUSION.LIMITED.AGGREGATION/FLOCKING/BOIDS/AGENTS/PARTICLES/EMITTERS/SOURCES/SINKS/LIFESPAN/AGE/BIRTH.RATE/ADVECTION/DIFFUSION/RIGID.BODIES/SOFT.BODIES/CLOTH/VELLUM/GRAINS/WIRES/HAIR/FUR/FLIP/PIC.FLIP/SPH/PBD/POSITION.BASED.DYNAMICS/FEM/FINITE.ELEMENTS/PYRO/SMOKE/FIRE/COMBUSTION/CONSTRAINTS/GLUE/PIN/SPRING/WELD/CONE.TWIST/HINGE/SLIDER/STIFFNESS/DAMPING/ELASTICITY/PLASTICITY/FRICTION/RESTITUTION/VISCOSITY/SURFACE.TENSION/COHESION/ADHESION/BUOYANCY/GRAVITY/WIND/VORTEX/DRAG/STRESS/STRAIN/TENSION/COMPRESSION/STRAIN.ENERGY/COLLISIONS/PROXY/STATIC.COLLIDERS/DEFORMING.COLLIDERS/SOLVERS/SUBSTEPS/TIMESTEPS/CONVERGENCE/TOLERANCE/ERROR.METRICS/STABILITY/DENSITY/MASS/CENTER.OF.MASS/MOMENT.OF.INERTIA/AREA/PERIMETER/VOLUME/THICKNESS/SHADERS/VERTEX.SHADERS/FRAGMENT.SHADERS/GEOMETRY.SHADERS/TESSELLATION.SHADERS/COMPUTE.SHADERS/GLSL/HLSL/VEX/WRANGLES/VOPS/SOPS/DOPS/COPS/CHOPS/TOPS/DATS/MATS/COMPS/LOPS/HDAS/GEO.NODES/MODIFIERS/DRIVERS/BLUEPRINTS/NIAGARA/LUMEN/NANITE/PCG/CHAOS/CONTROL.RIG/SEQUENCER/WORLD.POSITION.OFFSET/MATERIAL.INSTANCES/RENDER.TARGETS/SCENE.CAPTURE/MATERIALS/ALBEDO/BASE.COLOR/ROUGHNESS/METALLIC/SPECULAR/IOR/NORMAL.MAPS/BUMP.MAPS/DISPLACEMENT.MAPS/HEIGHT.MAPS/AO/OCCLUSION/EMISSION/SUBSURFACE.SCATTERING/TRANSMISSION/OPACITY/ALPHA/SHEEN/CLEARCOAT/ANISOTROPY/UV.MAPS/UV.ISLANDS/UV.SEAMS/UDIMS/TEXTURE.COORDINATES/TEXTURE.CHANNELS/MIPMAPS/FILTERING/WRAPPING/RGB/RGBA/HSV/HSL/LAB/LCH/ACES/LINEAR/SRGB/GAMMA/TONEMAPPING/LUTS/BIT.DEPTH/FLOAT/HALF/EXR/16.BIT/32.BIT/CAMERAS/FOCAL.LENGTH/APERTURE/DEPTH.OF.FIELD/FOV/EXPOSURE/ISO/SHUTTER/VERTEX.COLORS/FACE.COLORS/LIGHTS/DIRECTIONAL/POINT/SPOT/AREA/SKY/IES/INTENSITY/COLOR.TEMPERATURE/FALLOFF/KEYFRAMES/TIMELINE/FRAMES/FPS/TIME/DELTA.TIME/EASING/TWEENING/INTERPOLATION/CUBIC/STEP/FCURVES/ANIMATION.TRACKS/EXPRESSIONS/TRIGGERS/EVENTS/SKELETONS/BONES/JOINTS/IK.CHAINS/FK.CHAINS/BONE.WEIGHTS/SKINNING/RIGS/CONTROL.CURVES/SHAPE.KEYS/BLENDSHAPES/MORPH.TARGETS/POSES/RETARGETING/NODES/WIRES/SOCKETS/INPUTS/OUTPUTS/PARAMETERS/SLIDERS/TOGGLES/COOKING/EVALUATION/FEEDBACK.LOOPS/DAG/SUBNETWORKS/FOR.LOOPS/FOREACH/SWITCH/MERGE/CHANNELS/SAMPLES/OSC/MIDI/DMX/ART.NET/NDI/SYPHON/SPOUT/AUDIO.REACTIVE/FFT/SPECTROGRAMS/ENVELOPES/WAVEFORMS/KINECT/DEPTH.MAPS/POINT.CLOUDS/LIDAR/PHOTOGRAMMETRY/STRUCTURE.FROM.MOTION/MESH.RECONSTRUCTION/ISOSURFACES/ISOLINES/CONTOURS/STREAMLINES/FLOWLINES/TRAJECTORIES/ATTRACTORS/REPULSORS/EFFECTORS/FIELD.INFLUENCE/MASKS/RAMPS/FALLOFF/WEIGHTS/INTERACTIONS/COUPLINGS/CONNECTIONS/RELATIONSHIPS/DEPENDENCIES/NETWORKS/GRAPHS/PROPAGATION/CASCADES/AVALANCHES/ACCUMULATION/ACCRETION/AGGREGATION/GROWTH/DECAY/FEEDBACK/RESONANCE/HOMEOSTASIS/EQUILIBRIUM/DISEQUILIBRIUM/METASTABILITY/PHASE.SPACE/STATE.SPACE/ATTRACTOR.BASINS/LIMIT.CYCLES/STRANGE.ATTRACTORS/NONLINEARITY/SENSITIVITY/BIFURCATIONS/THRESHOLDS/TIPPING.POINTS/CRITICALITY/PHASE.TRANSITIONS/SYMMETRY.BREAKING/SCALE.INVARIANCE/SELF.SIMILARITY/POWER.LAWS/PATTERNS/STRUCTURE/ORDER/DISORDER/ENTROPY/NEGENTROPY/INFORMATION/COMPLEXITY/EVOLUTION/ADAPTATION/MUTATION/SELECTION/MORPHOGENESIS/DEVELOPMENT/TRANSFORMATION/BEHAVIOR/TENDENCY/AGENCY/AUTONOMY/INTELLIGENCE/COGNITION/EMERGENCE
`;

// Process once at module load: collapse all whitespace runs, then rejoin
// terms with " / " while replacing inner spaces with non-breaking spaces
// so multi-word terms ("SOLID BODIES", "POSITION BASED DYNAMICS") wrap
// as atomic units.
const DEFAULT_TEXTWALL_HTML = TERMS_RAW
  .replace(/\s+/g, " ")
  .trim()
  .split(" / ")
  .map(t => t.replace(/ /g, "\u00A0"))
  .join(" / ");

/* -----------------------------------------------------------------------------
   SPAN-IFY — produce the layered-mode DOM shape
   -----------------------------------------------------------------------------
   Replaces every text node under rootEl with per-character spans, each
   span holding exactly one text node — the same DOM shape the entry
   primitives (textScramble, textTypewriter) produce, and the shape the
   interaction primitives' layered-mode auto-detection matches ("every
   text node is the sole child of a <span> parent"). All four wall
   primitives therefore start as symmetric layered borrowers of these
   spans: none owns DOM restore, all use defensive per-frame writes on
   lit characters (which is what self-heals the hoverScramble/hoverWave
   color-surface overlap — see file header, ZONE ROUTING).

   Layout-equivalence note: per-character inline spans preserve text
   layout exactly (wrapping, justification, whitespace) — the same
   equivalence the fit relies on between the span layer and the plain
   measurement text.
   --------------------------------------------------------------------------- */
function spanifyTextNodes(rootEl) {
  // Gather first, mutate second — walking and replacing simultaneously
  // would invalidate the TreeWalker.
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.textContent) textNodes.push(n);
  }
  for (const node of textNodes) {
    const chars = Array.from(node.textContent);
    const frag  = document.createDocumentFragment();
    for (const ch of chars) {
      const span = document.createElement("span");
      span.textContent = ch;
      frag.appendChild(span);
    }
    node.parentNode.replaceChild(frag, node);
  }
}

/* -----------------------------------------------------------------------------
   FIT-TO-BOX — TWO-PHASE 2D JUSTIFY, MEASURED ON CLEAN TEXT
   -----------------------------------------------------------------------------
   See file header for the full reasoning. Brief recap:

   PHASE 1 (font-size) — binary-search the largest font-size such that
   the content doesn't overflow at FIT_BASE_LINE_HEIGHT. Both vertical
   and horizontal overflow are checked.

   PHASE 2 (line-height) — vertical justify. Distributing leading
   between lines is the vertical analog of text-align: justify
   distributing space between words. At the settled font-size, line
   count N is fixed, so scrollHeight = N × F × lh is linear in lh.
   That linearity lets us solve the right lh in closed form rather
   than iterating:

     targetLh = (clientH − F/2) / (scrollH/baseLh − F/2)

   derived so the last line's glyphs land at the box's bottom edge.
   The "− F/2" terms account for CSS putting half-leading inside
   the line-box; that bottom half-leading then overshoots clientH
   and is clipped by overflow:hidden, leaving glyphs intact.

   The reset of line-height before phase 1 is load-bearing: on
   re-fits, phase 2 from the PREVIOUS run has left line-height
   stretched, and the font-size search would otherwise read that
   stretched value as its base. Resetting makes successive fits
   produce consistent results regardless of prior state.

   SPAN-LAYER ISOLATION (see file header): the span layer is content-
   visibility: hidden for the duration of the fit so the probes lay
   out only the plain measurement text, not ~4,500 spans. Restored
   before returning; the spans relayout once at the settled metrics.
   The whole function runs synchronously inside one rAF callback, so
   the hidden state never reaches paint.
   --------------------------------------------------------------------------- */
function fitTextToBox(state) {
  const content = state.textWallContent;

  // Take the span layer out of layout for the probe sequence. Where
  // content-visibility is unsupported the write is ignored and the fit
  // simply pays the old per-probe span-relayout cost — correct either way.
  state.spanLayer.style.contentVisibility = "hidden";

  // Reset line-height before phase 1. See section header for why.
  content.style.lineHeight = String(FIT_BASE_LINE_HEIGHT);

  // -- Phase 1: font-size binary search --
  let lo = FIT_MIN_PX;
  let hi = FIT_MAX_PX;
  while (hi - lo > FIT_EPSILON) {
    const mid = (lo + hi) / 2;
    content.style.fontSize = mid + "px";
    const overflows =
      content.scrollHeight > content.clientHeight ||
      content.scrollWidth  > content.clientWidth;
    if (overflows) hi = mid; else lo = mid;
  }
  // Settle at the largest known fit. If even FIT_MIN_PX overflowed,
  // lo stays at MIN and outer overflow:hidden clips the excess —
  // graceful degradation for viewports too small to show all the
  // content. Phase 2 is then guarded out (scrollHeight already
  // >= clientHeight at MIN, no room to stretch upward).
  content.style.fontSize = lo + "px";

  // -- Phase 2: vertical justify (closed-form line-height solve) --
  // Only enter when there's room to grow. If phase 1 had to clip,
  // stretching line-height down doesn't fix the overflow.
  if (content.scrollHeight < content.clientHeight) {
    const F = lo;
    const targetLh =
      (content.clientHeight - F / 2) /
      (content.scrollHeight / FIT_BASE_LINE_HEIGHT - F / 2);
    content.style.lineHeight = String(targetLh);
  }

  // Bring the span layer back. Its one relayout at the settled metrics
  // happens lazily (next read or paint).
  state.spanLayer.style.contentVisibility = "";

  // A re-fit moves every character, so an ACTIVE primitive's cached
  // char centers are now stale (it would otherwise keep animating at
  // the old positions until the cursor exits and re-enters). Re-
  // dispatching mouseenter at the last cursor position triggers the
  // primitive's own recompute-on-enter path against the settled
  // layout. Inactive primitives self-heal on their next real enter.
  if (state.activeQuadrant) {
    state.zones[state.activeQuadrant].dispatchEvent(
      new MouseEvent("mouseenter", { clientX: lastCursorX, clientY: lastCursorY }),
    );
  }
}

/* -----------------------------------------------------------------------------
   DOCUMENT-LEVEL CURSOR HANDLING — see file header for the full picture
   -----------------------------------------------------------------------------
   One module-level mousemove + mouseleave pair for ALL wall instances,
   attached on first init. Per move, per instance: readiness gate,
   visibility gate, then quadrant computation against the CACHED rect
   (refreshed only by the ResizeObserver — the wall is viewport-fixed,
   so its rect can't change between resizes), then synthesis of enter/
   move/leave to exactly one zone.
   --------------------------------------------------------------------------- */
function computeQuadrant(rect, x, y) {
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    return null;
  }
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  return (y < cy ? "t" : "b") + (x < cx ? "l" : "r");
}

// Bring state.activeQuadrant to targetQ, dispatching leave to the
// outgoing zone and enter to the incoming one. Covers enter-from-
// outside, leave-to-outside, midline crossings, and forced wind-downs
// (targetQ = null) from tick() and the document mouseleave handler.
function setActiveQuadrant(state, targetQ, x, y) {
  if (state.activeQuadrant === targetQ) return;
  if (state.activeQuadrant) {
    state.zones[state.activeQuadrant].dispatchEvent(
      new MouseEvent("mouseleave", { clientX: x, clientY: y }),
    );
  }
  state.activeQuadrant = targetQ;
  if (targetQ) {
    state.zones[targetQ].dispatchEvent(
      new MouseEvent("mouseenter", { clientX: x, clientY: y }),
    );
  }
}

function onDocMouseMove(e) {
  lastCursorX = e.clientX;
  lastCursorY = e.clientY;

  for (const state of instances.values()) {
    // Gates first — a not-yet-ready or invisible wall does no further
    // work per move. (An activeQuadrant can't survive grow dropping
    // below the threshold: tick() winds it down every frame.)
    if (!state.ready || !state.wallRect) continue;
    if (state.grow <= HOVER_VISIBILITY_THRESHOLD) continue;

    const next = computeQuadrant(state.wallRect, lastCursorX, lastCursorY);
    setActiveQuadrant(state, next, lastCursorX, lastCursorY);

    // Mousemove on the active zone every move so the primitive's
    // proximity field tracks the cursor smoothly. MUST NOT BUBBLE:
    // a bubbling move would climb the nested zones and trip the
    // ancestor primitives' deferred-enter fallback (see file header,
    // ZONE ROUTING).
    if (state.activeQuadrant) {
      state.zones[state.activeQuadrant].dispatchEvent(
        new MouseEvent("mousemove", { clientX: lastCursorX, clientY: lastCursorY }),
      );
    }

    // data-quadrant DevTools mirror — equality-gated DOM write. Live
    // only while the wall is visible (the rect read this used to
    // require on invisible walls is exactly what this design removed);
    // tick() clears it on fade-out.
    if (next !== state.quadrant) {
      state.quadrant = next;
      state.textWall.dataset.quadrant = next || "";
    }
  }
}

// Cursor exits the document entirely. The cursor can leave while its
// last in-document position was inside a wall's rect; without the
// explicit reset that wall's state would lock at "still here" and the
// active primitive's loop would keep running until the cursor returned.
function onDocMouseLeave() {
  for (const state of instances.values()) {
    setActiveQuadrant(state, null, lastCursorX, lastCursorY);
    if (state.quadrant !== null) {
      state.quadrant = null;
      state.textWall.dataset.quadrant = "";
    }
  }
}

function ensureDocListeners() {
  if (docListenersAttached) return;
  docListenersAttached = true;
  document.addEventListener("mousemove", onDocMouseMove, { passive: true });
  document.addEventListener("mouseleave", onDocMouseLeave);
}

/* -----------------------------------------------------------------------------
   IDLE SCHEDULING — for the deferred primitive init
   --------------------------------------------------------------------------- */
function scheduleIdle(fn) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(fn, { timeout: IDLE_INIT_TIMEOUT_MS });
  } else {
    // Safari (no requestIdleCallback): a macrotask still lands after
    // the current load work, which is the part that matters.
    setTimeout(fn, 0);
  }
}

/* -----------------------------------------------------------------------------
   REGISTER WITH THE CORE
   -----------------------------------------------------------------------------
   buildDOM stashes the PANELS entry on the overlay element (via a private
   property) so init can read `textWallHtml`. Same bridge pattern
   turnPanel.js uses to get `infoHtml` / `gridImages` across — the core
   only passes index + overlay into init.
   --------------------------------------------------------------------------- */
const PANEL_REF = "__wallPanelRef__";

registerPanelType("wall", {

  buildDOM(panel /*, index */) {
    const overlay = document.createElement("div");
    overlay.className = "infinite-overlay wall-overlay";
    overlay.innerHTML = `<div class="wall-card">${panel.html || ""}</div>`;
    overlay[PANEL_REF] = panel;
    return overlay;
  },

  init(index, overlay) {
    const panel = overlay[PANEL_REF];

    const state = {
      grow: 0,
      ready: false,          // true once the idle init chain (span-ify +
                             //   four primitive starts) has completed;
                             //   gates the cursor synthesis until then
      textWall: null,        // the 90% × 90% outer box
      textWallContent: null, // inner fit-target + positioning context
      spanLayer: null,       // the ONE absolute overlay carrying the
                             //   visible, span-ified text
      fitRaf: null,          // rAF handle for coalescing ResizeObserver fires
      resizeObserver: null,
      wallRect: null,        // cached textWall rect; refreshed by the
                             //   ResizeObserver, read by every mousemove
      quadrant: null,        // cursor's current quadrant (mirror for the
                             //   data-quadrant attr; live while visible)
      zones: {},             // q → display:contents wrapper (that
                             //   quadrant's primitive's rootEl)
      zoneCancels: {},       // q → primitive cancel fn (held for symmetry;
                             //   never currently called — wall instances
                             //   are not torn down)
      activeQuadrant: null,  // which quadrant's primitive currently has
                             //   cursor "inside" from its perspective.
                             //   Differs from .quadrant when the wall is
                             //   fading or the cursor has left the doc —
                             //   we want the primitive to wind down even
                             //   if .quadrant would still report a value.
    };
    instances.set(index, state);

    // `grow` (0..1) drives the fade — eased toward isClearToEnter(index)
    // in tick(), reported as this panel's weight so the handoff gate
    // sees its presence in the sequencing.
    registerWeight(index, () => state.grow);

    // Build the textWall layer:
    //   .wall-textwall          — the 90vw × 90vh padded outer box
    //   .wall-textwall-content  — inner wrapper, 100% × 100% of the
    //                             padded inner area; holds the PLAIN
    //                             text (color: transparent) that the
    //                             fit algorithm measures
    //   .wall-spanlayer         — absolute inset:0 child; carries the
    //                             visible text (span-ified in idle time)
    //   .wall-zone × 4          — nested display:contents wrappers
    //                             inside the span layer; per-primitive
    //                             event targets (see file header,
    //                             ZONE ROUTING)
    //
    // The author supplies CONTENT, not the wrappers — a custom
    // textWallHtml automatically inherits the fit behavior and the
    // zone routing.
    const textHtml = panel.textWallHtml || DEFAULT_TEXTWALL_HTML;

    state.textWall = document.createElement("div");
    state.textWall.className = "wall-textwall";
    state.textWall.dataset.quadrant = ""; // live-updated while visible by
                                          // the module-level mousemove handler.

    state.textWallContent = document.createElement("div");
    state.textWallContent.className = "wall-textwall-content";
    // The measurement layer: in flow, invisible (color: transparent in
    // CSS). Its scrollHeight is what fitTextToBox reads — the absolute
    // span layer contributes nothing to it (out of flow).
    state.textWallContent.innerHTML = textHtml;
    state.textWall.appendChild(state.textWallContent);

    // The span layer + nested zones. The text goes in the INNERMOST
    // zone so all four wrappers are ancestors of (and can therefore
    // walk to) the same spans. Nesting order is arbitrary — no
    // capture-phase listeners exist in the primitive family, so depth
    // confers nothing. The text renders immediately as plain text;
    // span-ification happens in idle time and is visually identical
    // (per-char inline spans don't change text layout).
    state.spanLayer = document.createElement("div");
    state.spanLayer.className = "wall-spanlayer";
    let zoneParent = state.spanLayer;
    for (const q of QUADRANT_KEYS) {
      const zone = document.createElement("div");
      zone.className = "wall-zone";
      zone.dataset.zone = q; // DevTools orientation only
      zoneParent.appendChild(zone);
      state.zones[q] = zone;
      zoneParent = zone;
    }
    zoneParent.innerHTML = textHtml; // innermost zone carries the text
    state.textWallContent.appendChild(state.spanLayer);

    // Sibling of the overlay, inserted BEFORE so the overlay paints
    // above it (see file header for the containing-block reasoning).
    overlay.parentNode.insertBefore(state.textWall, overlay);

    // Fit on initial render and on every size change, and refresh the
    // cached rect — the wall is viewport-fixed, so the ResizeObserver
    // fires exactly (and only) when the rect can change. The observer
    // fires once when observation starts (initial fit + initial rect —
    // runs after layout settles, so CSS-from-link timing is also
    // handled correctly) and again on every subsequent size change.
    // The fit itself never resizes the outer box (it writes font-size/
    // line-height on the inner content), so no observer feedback loop.
    // RAF-coalesced so a burst of resize events runs the fit once per
    // frame at most.
    const scheduleFit = () => {
      if (state.fitRaf !== null) return;
      state.fitRaf = requestAnimationFrame(() => {
        state.fitRaf = null;
        fitTextToBox(state);
      });
    };
    state.resizeObserver = new ResizeObserver(() => {
      state.wallRect = state.textWall.getBoundingClientRect();
      scheduleFit();
    });
    state.resizeObserver.observe(state.textWall);

    // Re-fit once after web fonts finish loading. The initial fit
    // might run with fallback-font metrics; when the real font
    // arrives, character widths and line heights shift slightly and
    // the fit becomes wrong. ResizeObserver doesn't catch this on
    // its own — the outer box doesn't change size when a font
    // swaps, only the text rendering inside it does. document.fonts
    // .ready resolves once per page lifecycle (when all currently-
    // pending fonts complete), so each instance subscribes safely.
    document.fonts.ready.then(scheduleFit);

    // Module-level cursor handling — one listener pair for all wall
    // instances, attached on the first init.
    ensureDocListeners();

    // Deferred primitive init — see file header, IDLE-CHUNKED
    // PRIMITIVE INIT. Five chunks, one per idle slice: span-ify the
    // innermost zone, then start one primitive per chunk (each start
    // walks the shared spans in layered mode and computes ~4,500
    // character centers — the expensive part). Until the chain
    // completes the wall renders as a static plain-text surface and
    // the synthesis no-ops via state.ready.
    //
    // Span-ify MUST run before any primitive starts — the primitives'
    // layered-mode auto-detection requires the spans to already exist;
    // a primitive starting against plain text would go standalone and
    // claim span ownership. The job-queue order guarantees this.
    const innermostZone = zoneParent;
    const jobs = [() => spanifyTextNodes(innermostZone)];
    for (const q of QUADRANT_KEYS) {
      jobs.push(() => {
        state.zoneCancels[q] = QUADRANT_PRIMITIVES[q](state.zones[q]);
      });
    }
    const runNextJob = () => {
      const job = jobs.shift();
      if (!job) {
        state.ready = true;
        return;
      }
      job();
      scheduleIdle(runNextJob);
    };
    scheduleIdle(runNextJob);
  },

  tick(index, overlay, _presence, _dist, dt /*, t */) {
    const state = instances.get(index);
    if (!state) return;

    // Self-driven fade — same pattern as turnPanel.js (see handoffGate.md §4).
    // Ease `grow` toward the gate's verdict; last-write opacity on BOTH
    // the overlay AND the textWall so the two layers enter/leave as one.
    const target = isClearToEnter(index) ? 1 : 0;
    state.grow += (target - state.grow) * (1 - Math.exp(-FADE_SPEED * dt));
    const alpha = state.grow.toFixed(3);
    overlay.style.opacity = alpha;
    state.textWall.style.opacity = alpha;

    // If the wall faded out while a primitive still thinks the cursor
    // is inside, wind it down here — the mousemove handler skips
    // invisible instances entirely, so it can't deliver the closing
    // leave, and mousemove may not fire again anyway if the user has
    // stopped moving the cursor. tick runs every frame, so this fires
    // reliably on the first frame grow crosses the threshold downward.
    // The data-quadrant mirror is cleared with it (mirror is only live
    // while visible — see onDocMouseMove).
    if (state.grow <= HOVER_VISIBILITY_THRESHOLD) {
      if (state.activeQuadrant) {
        setActiveQuadrant(state, null, lastCursorX, lastCursorY);
      }
      if (state.quadrant !== null) {
        state.quadrant = null;
        state.textWall.dataset.quadrant = "";
      }
    }
  },
});