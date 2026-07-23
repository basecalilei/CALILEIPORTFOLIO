/* =============================================================================
   sidebarProcess.js — the "process" view of the sidebar
   -----------------------------------------------------------------------------
   A content view that lists design-discipline PROCESSES. Each process entry
   is a Hornet kicker (PROCESS / 01) above a hairline-framed row: an icon
   tile on the left (the click target) and a data-block on the right
   (TITLE, then LOGIC) — the same data-sheet language as sidebarProjects,
   with an icon column in place of a thumbnail.

   The card is deliberately thin: it identifies the discipline and nothing
   more. Everything else about a process — what its logic resolves into,
   the body copy, the imagery — belongs to the process sheet the modal
   opens, so the list stays scannable.

   Process entries are authored inline in this module — same rationale as
   sidebarProjects' PROJECTS array: the content is owned by this view, and
   a data array + markup function is the lightest way to express a uniform
   list. If the process list ever needs to come from outside, the contract
   changes then; don't pre-build that flexibility.

   PER-PROCESS ACCENT
     Each process carries a brand-primary accent, inherited from the old
     site's per-discipline color bars (pattern-making = green, flowform-
     design = blue, visual-scripting = yellow). The accent is set as a
     --process-accent custom property inline on the entry root; the
     stylesheet reads it for the entry's edge bar, the icon glyph
     (currentColor), and the kicker. Category-tag color per
     visualLanguage.md — one meaning per entry, never red (red is
     warn/active, and a process can't fail).

   ICONS
     Authored as inline SVG in each entry's `icon` field so the glyph
     inherits --process-accent via currentColor and needs no fetch. The
     SVGs currently in the data are PLACEHOLDERS — replace each with the
     real graphic by pasting its markup into the field. Keep
     stroke="currentColor" (and/or fill="currentColor") on the artwork so
     the accent inheritance keeps working; keep viewBox and drop any
     fixed width/height attributes (the stylesheet sizes the glyph).

   CLICK MODEL
     Only the icon tile is interactive (a <button> carrying
     data-process-index); the data block is selectable text, intentionally
     not clickable — mirrors sidebarProjects, where only the thumb opens
     the modal. The click passes the WHOLE PROCESSES list + the clicked
     index to openProcessModal (the modal's prev/next buttons cycle the
     list without importing this module), with the tile as the FLIP
     origin.

   LAYERED ANIMATION LIFECYCLE
     The title and body run two animation primitives in parallel:
       - textScramble: the entry animation, cycling glyphs and brand-color
         flicker that resolves to the authored text over ~1.1s.
       - textHoverWave: the interaction animation, a cursor-driven spatial
         wave that lights characters in brand colors as the cursor passes.

     Both start at t=0 in onEnter. The scramble primitive walks text
     nodes and creates per-character spans (it owns them); the hover
     primitive auto-detects the pre-existing spans and runs in "layered
     mode" — borrowing the spans, writing colors that override scramble's
     where the cursor is near, leaving scramble's writes visible
     elsewhere. The two coexist on the same `span.style.color` via tick
     ordering: scramble registered first → ticks first each frame; hover
     registered second → ticks after, writing its tints last and winning
     the paint for chars near the cursor. See sidebarAbout.js's file
     header for the full color-write coordination rationale.

     Process entries (kicker + icon + data-block) are NOT animated by
     either primitive — they appear with the shell's opacity cross-fade,
     matching sidebarProjects' choice for its entries. If they should
     animate on entry too, a follow-up iteration can scramble the data
     values or stagger the entries in like sidebarHome's wave.

     Re-entry replays from scratch — cancelAll() in onExit stops the
     scramble + hover combo and restores the original DOM synchronously,
     so the next entry starts from a clean state.

   COUPLED WITH
     - sidebarProcessStyles.css: emits .sidebar-view-process and inner classes.
     - main.js: imports `processView` and includes it in initSidebar's views.
     - textScramble.js: provides startScramble (entry).
     - textHoverWave.js: provides startHoverWave (interaction, layered mode).
     - cancels.js: provides the createCancelGroup helper.
     - processModal.js: opened from each icon tile's click handler. The
       modal grows from the clicked tile (FLIP) and renders the process's
       hero (kicker / title / taglines) + authored media stack. This view
       passes the whole PROCESSES list plus the clicked index; the modal's
       prev/next cycle that list internally and import nothing from this
       module.
   ========================================================================== */

import { startScramble }     from "./textScramble.js";
import { startHoverWave }    from "./textHoverWave.js";
import { createCancelGroup } from "./cancels.js";
import { openProcessModal }  from "./processModal.js";

/* -----------------------------------------------------------------------------
   MODULE-LEVEL STATE
   -----------------------------------------------------------------------------
   Single cancels group holds both the entry and hover cancels for both
   elements (title and body) — four entries total during a view session.
   Order of insertion is significant for cancel ordering: scrambles first,
   hovers second, so on cancelAll the scramble's DOM restore runs before
   hover's listener removal (which doesn't need the spans anymore at that
   point). See the file header for the full lifecycle rationale.
   --------------------------------------------------------------------------- */

const cancels = createCancelGroup();

// Wave radius for the hover layer. The primitive's default is 50;
// smaller reads as more focal/subtle, matching the choice in the other
// sidebar views (sidebarAbout, sidebarProjects, etc.).
const HOVER_WAVE_RADIUS = 5;

/* -----------------------------------------------------------------------------
   PROCESS DATA
   -----------------------------------------------------------------------------
   Authored as an array of objects. Adding a process is one entry, not a
   copy/paste of HTML. Entry numbers (/ 01, / 02, ...) are derived from
   array position — reordering the array renumbers the set.

   Schema:
     title    — string, the discipline's display name (uppercase, hyphenated
                to match the old site's headings: PATTERN-MAKING)
     logic    — string, the LOGIC field's value. Abbreviated to read as a
                declared-width instrument field (2D / 3D / NUM); swap for
                the full words (TWO-DIMENSIONAL, ...) if the field feels
                too terse in place.
     taglines — array of strings, the modal hero's slash lines, stored
                VERBATIM (leading slash and all) so the data is WYSIWYG
                and a line can deviate from the /X grammar. Any count;
                the modal styles the last line strong. NOT RENDERED IN
                THE CARD — the card stays thin on purpose.
     accent   — string, a CSS color expression for the entry's category
                color. Use the brand tokens: var(--brand-green|blue|yellow).
     icon     — string, inline SVG markup for the tile glyph. PLACEHOLDER
                art for now — see ICONS in the file header before replacing.
     media    — string, raw HTML for the modal's content stack below the
                hero. Authored as a template literal, same contract as
                PROJECTS[].media, with the process building blocks from
                processModalStyles.css available: .process-callout,
                .process-dark, .process-bleed, .process-datawall, .process-break,
                .process-workflow (one pipeline step: head + body + shot),
                .process-card (expandable workflow card — behavior wired by
                processCards.js via processModal; author markup only),
                .process-launch (gated hand-off control — behavior wired by
                processLaunchGate.js via processModal; author markup only,
                with the soft access key on data-launch-key and the
                hand-off name on data-launch),
                .media-grid-2, plus styled p / h3 / ul / img / video.
                Empty string = the modal shows the hero alone.

   Tags inside values are escaped only by the fact that PROCESSES values
   are all author-controlled string literals here; if values ever come
   from user input, escape them before interpolation.
   --------------------------------------------------------------------------- */

const PROCESSES = [

  {
    title:    "PATTERN-MAKING",
    logic:    "2D",
    taglines: [
      "/TWO-DIMENSIONAL LOGIC",
      "/RESOLVES INTO FORM",
      ".APPLIED.GEOMETRY",
    ],
    accent:   "var(--brand-green)",
    // PLACEHOLDER — a flat pattern piece with a dart and a dashed grainline.
    icon: `
      <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
           fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M10 8 H38 L34 40 H14 Z" />
        <path d="M21.5 8 L24 17 L26.5 8" />
        <path d="M24 21 V36" stroke-dasharray="3 3" />
      </svg>
    `,
    media: `
      <img class="process-bleed"
           src="images/process/patternMaking/full/1full.webp"
           alt="Hand-drafted paper patterns"
           loading="lazy" decoding="async">

      <div class="process-callout">
        <p>/ PATTERN-MAKING IS MORE THAN CRAFT;</p>
        <p>/ IT IS THE STUDY OF FORM</p>
      </div>

      <p>> How does two-dimensional geometry resolve into three-dimensional structure?</p>

      <p>> How do flat shapes connect, fold, and interact to create volume, movement, and constraint?</p>

      <ul>
        <li>Lines define load paths</li>
        <li>Curves manage tension</li>
        <li>Angles determine how material behaves in space</li>
        <li>Material properties govern three-dimensional resolution</li>
        <li>Small adjustments propagate through the entire form</li>
      </ul>

      <p>> My mindset toward pattern-making goes beyond apparel.</p>

      <p>> I approach pattern making the way an engineer approaches structure; with geometry, precision, and intent.</p>

      <div class="process-callout">
        <p>/ SURFACES, INTERFACES, AND ASSEMBLIES;</p>
        <p>/ SPATIAL PROBLEMS TO BE SOLVED</p>
      </div>

      <div class="process-dark">
        <p>> In my work, I leverage complex mathematics to create technically
           accurate patterns, and realize forms that are too intricate to be
           accurately patterned by hand alone.</p>

        <p>> The original pattern-making system that I developed, The Iso-Parametric Pattern-Making Methodology 
           <strong>[IPM]</strong>, is a robust framework for designing patterns
           through controlled parameters and repeatable logic.</p>

        <p>> Rather than manual trial and error of traditional pattern-making,
           I use a system of parametrization and conformal mapping solvers to
           create patterns that are free of surface distortion and human error.</p>
      </div>

      <div class="process-break">- WORKFLOW<span>(s):</span></div>

      <div class="process-workflow">
        <div class="process-workflow-head">
          <span class="process-workflow-index">WF / 01</span>
          <h3 class="process-workflow-tool">// ISO-PARAMETRIC PATTERNING:</h3>
          <span class="process-workflow-role">/ [ HOUDINI ]</span>
        </div>
        <div class="process-workflow-body">
          <p>> In [<strong>HOUDINI</strong>], I procedurally model
             “ZEROFORMS” of apparel and other soft-goods as geometry with
             developable surfaces, defining base topology and edge flow
             without enforcing physical shape.</p>
          <p>> Panel boundaries and size-grading targets are encoded as
             attributes, allowing proportions and construction logic to be
             adjusted parametrically.</p>
          <p>> Using VEX scripting and custom solvers, I explore form through
             controlled geometrical operations while preserving topological
             continuity.</p>
          <p>> The geometry is prepared for conformal mapping through
             developability and panelization solvers, conditioning each piece
             for distortion-free flattening.</p>
          <p>> Pattern pieces are flattened directly from three-dimensional
             form, producing geometrically exact, manufacturable patterns
             derived from the source geometry.</p>
          <p>> This workflow inverts traditional patternmaking by extracting
             flat logic from form, rather than imposing form onto flat
             shapes.</p>
        </div>
        <div class="process-workflow-media">
          <video src="images/process/patternMaking/full/2full.mp4" autoplay muted loop playsinline loading="lazy"></video>
          <video src="images/process/patternMaking/full/3full.mp4" autoplay muted loop playsinline loading="lazy"></video>
        </div>
      </div>

      <div class="process-workflow">
        <div class="process-workflow-head">
          <span class="process-workflow-index">WF / 02</span>
          <h3 class="process-workflow-tool">// PHYSICAL VALIDATION:</h3>
          <span class="process-workflow-role">/ [ CLO3D ]</span>
        </div>
        <div class="process-workflow-body">
          <p>> In [<strong>CLO3D</strong>], I validate generated patterns
             through physically based cloth simulation to evaluate fit, drape,
             and structural behavior.</p>
          <p>> Simulation reveals tension, folding, and material response,
             allowing design decisions to be tested against real-world
             physical conditions.</p>
          <p>> I manually refine details that benefit from human judgment,
             including construction adjustments, finishing elements, and
             assembly considerations.</p>
          <p>> Final patterns are prepared for manufacturing, ensuring
             accurate scaling, seam consistency, and production-ready
             output.</p>
          <p>> This stage confirms that computationally derived patterns
             translate cleanly from geometric idealization into physical
             reality.</p>
        </div>
        <div class="process-workflow-media">
          <video src="images/process/patternMaking/full/4full.mp4" autoplay muted loop playsinline loading="lazy"></video>
          <video src="images/process/patternMaking/full/5full.mp4" autoplay muted loop playsinline loading="lazy"></video>
        </div>
      </div>

    <img src="images/process/patternMaking/full/6full.webp"
                   alt="pattern demos"
                   loading="lazy" decoding="async">

      <div class="process-dark">
        <p>> My [<strong>Iso-Parametric Patterning Methodology</strong>] goes
           far beyond this brief overview.</p>
        <p>> This was just a small part of a larger framework for translating
           form into manufacturable patterns.</p>
        <p>> The full methodology is a system of thought that encompasses
           additional processes, solvers, and theoretical foundations.</p>
      </div>

      <button class="process-launch" type="button" data-launch="ipm" data-launch-key="opensesame">
        <span class="process-launch-mark">[ I<i>.</i>P<i>.</i>M ]</span>
        <span class="process-launch-cue">/ CLICK TO EXPLORE THE FULL SYSTEM</span>
        <span class="process-launch-arrow" aria-hidden="true"></span>
      </button>
    `,
  },

  {
    title:    "FLOWFORM-DESIGN",
    logic:    "3D",
    taglines: [
      "/THREE-DIMENSIONAL LOGIC",
      "/RESOLVES INTO FUNCTION",
      ".APPLIED.GEOMETRY",
    ],
    accent:   "var(--brand-blue)",
    // PLACEHOLDER — streamlines pinching around a center body line.
    icon: `
      <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
           fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M5 14 C18 14, 26 21, 43 21" />
        <path d="M5 24 H43" />
        <path d="M5 34 C18 34, 26 27, 43 27" />
      </svg>
    `,
    media: `
      <img class="process-bleed"
           src="images/process/flowformDesign/full/1full.webp"
           alt="CFD streamlines over an aircraft flowform"
           loading="lazy" decoding="async">

      <div class="process-callout">
        <p>/ AIR AND GEOMETRY</p>
        <p>/ AIRCRAFT ARE FLOWFORMS FIRST</p>
      </div>

      <p>> Flowform design is the study of how air moves across geometry, and the resulting aerodynamics.</p>

      <p>> In this discipline, rather than \u201Cform follows function\u201D; form essentially <strong><em>is</em></strong> function.</p>

      <ul>
        <li>Structure defines load path</li>
        <li>Surfaces become lift generators</li>
        <li>Edges become flow control</li>
        <li>Material properties determine limits</li>
        <li>Small adjustments propagate into all stability derivatives</li>
      </ul>

      <p>> Every other system; structural, thermal, electrical, human; must align with the geometry.</p>

      <p>> The goal is a coherent flowform, where every curve and edge is optimized for aerial supremacy.</p>

      <div class="process-callout">
        <p>/ AIR FOLLOWS FORM</p>
        <p>/ FLIGHT FOLLOWS AIR</p>
      </div>

      <div class="process-dark">
        <p>> Through a structured virtual pipeline, I iterate flowforms
           digitally, refining every surface to shape airflow, lift, and
           overall aerodynamic behavior.</p>

        <p>> Each adjustment is deliberate and measurable, enabling extensive
           exploration of design possibilities and precise optimization of
           aerodynamic characteristics.</p>

        <p>> The result is a coherent flowform with surfaces and curves that
           are refined to balance stability, responsiveness, and efficiency
           across the full flight envelope.</p>
      </div>

      <div class="process-break">- WORKFLOW<span>(s):</span></div>

      <div class="process-workflow">
        <div class="process-workflow-head">
          <span class="process-workflow-index">WF / 01</span>
          <h3 class="process-workflow-tool">// DIGITAL FLOWFORM MODELING:</h3>
          <span class="process-workflow-role">/ RHINO</span>
        </div>
        <div class="process-workflow-body">
          <p>> I begin my flowform workflow by defining aircraft flowform
             geometry in CAD [<strong>RHINO</strong>] using nurbs modeling
             techniques.</p>
          <p>> Each surface is controlled with parametric precision to ensure
             smooth, continuous flow paths.</p>
          <p>> Planform, section, and camber are shaped to guide air and
             enable stability.</p>
          <p>> This geometry serves as the foundation for all subsequent
             analysis and simulation, transforming concept into a testable,
             data-driven system.</p>
        </div>
        <img src="images/process/flowformDesign/full/2full.webp"
             alt="Rhino — NURBS flowform modeling viewports"
             loading="lazy" decoding="async">
      </div>

      <div class="process-workflow">
        <div class="process-workflow-head">
          <span class="process-workflow-index">WF / 02</span>
          <h3 class="process-workflow-tool">// COMPUTATIONAL FLUID DYNAMICS ANALYSIS:</h3>
          <span class="process-workflow-role">/ ANSYS FLUENT</span>
        </div>
        <div class="process-workflow-body">
          <p>> Once the geometry is defined, I analyze it using cfd software
             [<strong>ANSYS FLUENT</strong>], where the form is tested against
             physics.</p>
          <p>> Pressure distributions, flow separation, and force coefficients
             are quantified.</p>
          <p>> Beyond how it looks, the aircraft begins to reveal how it will
             act.</p>
          <p>> These insights guide precise adjustments, allowing the geometry
             to be iteratively refined for optimal aerodynamic performance.</p>
        </div>
        <img src="images/process/flowformDesign/full/3full.webp"
             alt="ANSYS Fluent — CFD analysis of the flowform"
             loading="lazy" decoding="async">
      </div>

      <div class="process-workflow">
        <div class="process-workflow-head">
          <span class="process-workflow-index">WF / 03</span>
          <h3 class="process-workflow-tool">// REAL-TIME FLIGHT DATA VALIDATION:</h3>
          <span class="process-workflow-role">/ JSBSIM</span>
        </div>
        <div class="process-workflow-body">
          <p>> Next, I feed the stability/control derivatives and other
             necessary data into a flight dynamics simulator
             [<strong>JSBSIM</strong>] to compute real-time flight dynamics.</p>
          <p>> This step closes the loop between flow data and motion.</p>
          <p>> The entire aircraft, from physical properties to flow response,
             is represented as code.</p>
          <p>> Geometry becomes forces, forces become states, states become
             behavior.</p>
        </div>
        <img src="images/process/flowformDesign/full/4full.webp"
             alt="JSBSim — real-time flight dynamics validation"
             loading="lazy" decoding="async">
      </div>

      <div class="process-workflow">
        <div class="process-workflow-head">
          <span class="process-workflow-index">WF / 04</span>
          <h3 class="process-workflow-tool">// FLIGHT DYNAMICS SIMULATION:</h3>
          <span class="process-workflow-role">/ FLIGHTGEAR</span>
        </div>
        <div class="process-workflow-body">
          <p>> To validate the system as a pilot experiences it, I interface
             the flight model and a graphical representation with an
             open-source flight simulation platform
             [<strong>FLIGHTGEAR</strong>] to conduct virtual test flights.</p>
          <p>> Here, the design is no longer abstract.</p>
          <p>> Stability, response, and handling qualities can be observed,
             tuned, and iterated long before physical prototypes exist.</p>
        </div>
        <img src="images/process/flowformDesign/full/5full.webp"
             alt="FlightGear — virtual test flight of the flowform"
             loading="lazy" decoding="async">
      </div>
    `,
  },

  {
    title:    "VISUAL-SCRIPTING",
    logic:    "NUM",
    taglines: [
      "/NUMERICAL LOGIC",
      "/RESOLVES INTO DESIGN",
      ".APPLIED.LOGIC",
    ],
    accent:   "var(--brand-yellow)",
    // PLACEHOLDER — two source nodes wired into an output node.
    icon: `
      <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
           fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <circle cx="11" cy="13" r="4" />
        <circle cx="11" cy="35" r="4" />
        <circle cx="37" cy="24" r="4.5" />
        <path d="M15 13 C24 13, 24 24, 32.5 24" />
        <path d="M15 35 C24 35, 24 24, 32.5 24" />
      </svg>
    `,
    media: `
      <div class="process-datawall">POINTS / VERTICES / COORDINATES / X / Y / Z / EDGES / LINES / CONNECTIONS / FACES / POLYGONS / QUADS / TRIANGLES / NGONS / SURFACES / PATCHES / PANELS / NORMALS / TANGENTS / BINORMALS / CURVATURE / PRINCIPAL CURVATURE / GAUSSIAN CURVATURE / MEAN CURVATURE / UV COORDINATES / PARAMETRIC POSITIONS / WEIGHTS / ATTRIBUTES / COLORS / RGB / RGBA / TEXTURE COORDINATES / MATERIAL ASSIGNMENTS / THICKNESS / STRESS / STRAIN / TENSION / COMPRESSION / DENSITY / MASS / TOPOLOGY / CONNECTIVITY / VERTEX INDICES / EDGE INDICES / FACE INDICES / BOUNDARY EDGES / HOLES / CREASES / SEAMS / EDGE LOOPS / EDGE RINGS / FACE LOOPS / FACE GROUPS / PATCH GROUPS / SHELLS / SOLID BODIES / VOLUMES / CELLS / PARTICLES / INSTANCES / OBJECT REFERENCES / TRANSFORMS / TRANSLATION / ROTATION / SCALE / MATRIX / ORIENTATION / LOCAL COORDINATES / WORLD COORDINATES / PARAMETER FIELDS / SCALAR FIELDS / VECTOR FIELDS / DIRECTIONAL FIELDS / FLOW FIELDS / VELOCITY / ACCELERATION / FORCE VECTORS / CONSTRAINTS / BOUNDARY CONDITIONS / COLLISION BODIES / INTERSECTION CURVES / SPLINES / CURVES / BEZIER CURVES / NURBS / CONTROL POINTS / KNOTS / TANGENT VECTORS / DERIVATIVES / GRADIENTS / ATTRACTORS / REPULSERS / GUIDES / PATHS / ANIMATION CURVES / KEYFRAMES / TRIGGERS / EVENTS / LOGIC NODES / PARAMETERS / SLIDERS / INPUT VALUES / OUTPUT VALUES / CONDITIONS / RULES / WEIGHTS / ATTRIBUTES PER ELEMENT / METADATA / TAGS / GROUPS / SELECTION SETS / MATERIAL IDS / LAYERS / HIERARCHIES / PARENT / CHILD / SIBLING RELATIONSHIPS / INSTANCED TRANSFORMS / DEFORMATION VECTORS / MORPH TARGETS / SIMULATION STATE / TEMPERATURE / PRESSURE / VELOCITY FIELD / DENSITY FIELD / FORCE FIELD / GRAVITY / WIND / FRICTION / COEFFICIENTS / TIME / TIMESTEPS / LIFESPAN / PARTICLE ID / PARTICLE TYPE / PARTICLE ATTRIBUTES / SURFACE SAMPLING POINTS / VERTEX COLORS / FACE COLORS / BARYCENTRIC COORDINATES / AREA / PERIMETER / VOLUME / MASS PROPERTIES / CENTER OF MASS / MOMENT OF INERTIA / STIFFNESS / FLEXIBILITY / ELASTICITY / PLASTICITY / STRAIN ENERGY / ENERGY DENSITY / CONSTRAINT WEIGHTS / SOFTBODY PROPERTIES / RIGIDBODY PROPERTIES / BONE WEIGHTS / SKINNING / JOINT POSITIONS / JOINT ORIENTATIONS / IK CHAINS / FK CHAINS / SHAPE KEYS / BLENDSHAPES / CONTROL CURVES / ANIMATION TRACKS / EVENTS / TRIGGERS / LOGIC FLAGS / BOOLEAN STATES / COLLISION FLAGS / GROUP FLAGS / SELECTION FLAGS / ATTRIBUTE MAPS / NOISE MAPS / PATTERN MAPS / TEXTURE MAPS / HEIGHT MAPS / NORMAL MAPS / DISPLACEMENT MAPS / UV MAPS / SHADING ATTRIBUTES / LIGHTING ATTRIBUTES / CAMERA PARAMETERS / RENDER ATTRIBUTES / RESOLUTION / LEVEL OF DETAIL / SUBDIVISION LEVEL / TOPOLOGY MAPS / ADJACENCY / NEIGHBORHOOD RELATIONSHIPS / PATH NETWORKS / FLOWLINES / STREAMLINES / ISOLINES / CONTOURS / GRADIENT VECTORS / CURVATURE DIRECTIONS / PRINCIPAL DIRECTIONS / ENERGY GRADIENTS / PRESSURE GRADIENTS / PARTICLE TRAJECTORIES / PARTICLE VELOCITY / PARTICLE ACCELERATION / SIMULATION PARAMETERS / TIME STEPS / ITERATION COUNTS / CONVERGENCE FLAGS / ERROR METRICS / STABILITY METRICS / REFINEMENT LEVELS / PARAMETRIC CURVES / PARAMETRIC SURFACES / CONSTRAINT SOLVERS / DEFORMATION MATRICES / TRANSFORMATION MATRICES / LOCAL SPACE / WORLD SPACE / OBJECT SPACE / PARENT SPACE / BONE SPACE / ANIMATION CURVES / MODIFIERS / EFFECTORS / FIELD INFLUENCE / ATTRACTOR POSITION / ATTRACTOR STRENGTH / REPULSOR POSITION / REPULSOR STRENGTH / GRID POINTS / VERTEX NORMALS / FACE NORMALS / EDGE NORMALS / EDGE CREASE VALUES / EDGE WEIGHTS / FACE WEIGHTS / VERTEX WEIGHTS / MATERIAL CHANNELS / SHADER PARAMETERS / TEXTURE CHANNELS / UV ISLANDS / UV SHEETS / UV PATCHES / MESH TOPOLOGY / VERTEX CONNECTIVITY / EDGE CONNECTIVITY / FACE CONNECTIVITY / ADJACENCY MATRICES / CONNECTIVITY MATRICES / INCIDENCE MATRICES / NEIGHBOR LISTS / SEAM EDGES / BORDER EDGES / ISOLATED VERTICES / DUMMY POINTS / CONTROL POINTS / KNOT VECTORS / PARAMETRIC WEIGHTS / BARYCENTRIC COORDINATES / INTERPOLATION WEIGHTS / SAMPLING POINTS / PARTICLE ATTRIBUTES / SIMULATION FLAGS / RANDOM SEEDS / NOISE PARAMETERS / VELOCITY VECTORS / ACCELERATION VECTORS / FORCE VECTORS / TORQUE / ANGULAR VELOCITY / ANGULAR ACCELERATION / ROTATION MATRICES / ORIENTATION QUATERNIONS / SCALE FACTORS / TRANSFORMATION MATRICES / BOUNDING BOXES / BOUNDING SPHERES / CONVEX HULLS / COLLISION SHAPES / RAY INTERSECTION POINTS / RAY NORMALS / SURFACE PARAMETERS / PARAMETRIC COORDINATES / ISOPARAMETERS / UV COORDINATES / CURVE PARAMETERS / FIELD VALUES / ATTRIBUTE GRIDS / ATTRIBUTE FIELDS / ATTRACTOR GRIDS / GUIDES / CONTROL GRIDS / PARTICLE SYSTEMS / FLUID CELLS / FLUID PARTICLES / VORTICITY / TEMPERATURE FIELD / PRESSURE FIELD / DENSITY FIELD / VELOCITY FIELD / FORCES / TORQUE / CONSTRAINT MATRICES / SOFTBODY PROPERTIES / RIGIDBODY PROPERTIES / BOUNDARY CONDITIONS / COLLISION FLAGS / MATERIAL PROPERTIES / ELASTICITY / PLASTICITY / FRICTION / COEFFICIENTS / TIME / TIMESTEPS / SIMSTATE / EMERGENCE PARAMETERS / DERIVED PARAMETERS / OUTPUT ATTRIBUTES / STABILITY COEFFICIENTS / FIELD INTERPOLATION VALUES / CURVATURE GRADIENTS //////////////////////////// <strong>DATA</strong></div>

      <div class="process-callout">
        <p>/ GEOMETRY AS DATA</p>
        <p>/ VISUALS AS DATA</p>
      </div>

      <p>> Visual scripting is a way of understanding and designing systems through data.</p>

      <p>> I define the conditions under which forms and visual attributes are allowed to emerge.</p>

      <ul>
        <li>Parameters establish degrees of freedom</li>
        <li>Connections and dependencies govern local behavior</li>
        <li>Constraints define physical and logical limits</li>
        <li>Solvers negotiate competing requirements</li>
        <li>Small adjustments propagate through the system</li>
      </ul>

      <p>> I use nodes and code to formalize my intent into explicit logic, and design with measurable, adjustable systems.</p>

      <p>> My workflows are anchored in geometry-first computation; processes that treat design as something to be solved.</p>

      <div class="process-callout">
        <p>/ A UNIFYING META-DISCIPLINE</p>
        <p>/ DESIGN THROUGH SYSTEMS</p>
      </div>

      <div class="process-dark">
        <p>> I treat creativity as an experimental process where I leverage
           computation to navigate complexity, revealing relationships and
           behaviors that are otherwise invisible.</p>

        <p>> This mindset allows me to explore complex geometries and
           behaviors that are impossible to manage manually, while
           maintaining precision, repeatability, and control.</p>

        <p>> I approach design as the orchestration of data; geometry,
           materials, motion, and visual effects unfold through computation,
           resulting in systems that are controlled and inherently
           connected.</p>
      </div>

      <div class="process-break">- WORKFLOW<span>(s):</span></div>

      <div class="process-card">
        <button class="process-card-head" type="button" aria-expanded="false">
          <span class="process-card-icon">
            <!-- PLACEHOLDER icon — a curved patch with its control points. -->
            <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
                 fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M8 32 C8 16, 40 16, 40 32" />
              <path d="M8 38 C8 22, 40 22, 40 38" />
              <circle cx="8" cy="32" r="2" fill="currentColor" stroke="none" />
              <circle cx="40" cy="32" r="2" fill="currentColor" stroke="none" />
              <circle cx="24" cy="21.5" r="2" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span class="process-card-index">WF / 01</span>
          <span class="process-card-title">GEOMETRY EXPLORATION: <span>&mdash; [ HOUDINI ]</span></span>
          <span class="process-card-state" aria-hidden="true"></span>
        </button>
        <div class="process-card-body">
          <div class="process-card-inner">
            <div class="process-card-text">
              <div class="process-card-tags">
                <p>/ FORM AS DATA</p>
                <p>/ THE LOGIC OF SOLVERS</p>
              </div>
              <p>
              <br>
              > In [<strong>HOUDINI</strong>], I treat geometrical attributes as structured datasets;
              <br>
              <br>
              </p>
              <div class="process-card-terms">
                <span>COORDINATES</span><span>POINTS</span><span>EDGES</span><span>FACES</span><span>ANGLES</span><span>CURVATURE</span><span>NORMALS</span>
              </div>
              <p>
              <br>
              > I use SOPs, VOPs, and VEX scripting to formalize data
                 relationships, and define procedural rules that govern
                 geometry.</p>
              <p>> Solvers negotiate developable surfaces and polygonal
                 topology, allowing complex forms to emerge predictably.</p>
              <p>> I actively study the latest research in discrete
                 differential geometry, and parametric modeling to inform the
                 creation of advanced solvers.
              <br>   
              <br>
              </p>
              <div class="process-card-note">A visual scripting workflow that
                 enables me to design emergent structures, discover elegant
                 forms, and build powerful procedural modeling tools</div>
            </div>
            <div class="process-card-media">
            <video src="images/process/visualScripting/full/1full.mp4" autoplay muted loop playsinline loading="lazy"></video> 
            <video src="images/process/visualScripting/full/2full.mp4" autoplay muted loop playsinline loading="lazy"></video>
            </div>
          </div>
        </div>
      </div>

      <div class="process-card">
        <button class="process-card-head" type="button" aria-expanded="false">
          <span class="process-card-icon">
            <!-- PLACEHOLDER icon — a viewport frame holding a wireframe solid. -->
            <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
                 fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M6 10 H42 V38 H6 Z" />
              <path d="M6 17 H42" />
              <path d="M18 23 L24 20 L30 23 V31 L24 34 L18 31 Z" />
              <path d="M18 23 L24 26 L30 23" />
              <path d="M24 26 V34" />
            </svg>
          </span>
          <span class="process-card-index">WF / 02</span>
          <span class="process-card-title">WEB DESIGN: <span>&mdash; [ VSCODE ]</span></span>
          <span class="process-card-state" aria-hidden="true"></span>
        </button>
        <div class="process-card-body">
          <div class="process-card-inner">
            <div class="process-card-text">
              <div class="process-card-tags">
                <p>/ INTERACTION AS DATA</p>
                <p>/ THE LOGIC OF STATE AND MOTION</p>
              </div>
              <p>
              <br>
              > In [<strong>VSCODE</strong>], I treat interfaces as structured datasets;
              <br>
              <br>
              </p>
              <div class="process-card-terms">
                <span>STATE</span><span>EVENTS</span><span>LAYOUT</span><span>TYPOGRAPHY</span><span>EASING</span><span>GEOMETRY</span><span>SHADERS</span><span>FRAMES</span>
              </div>
              <p>
              <br>
              > I write vanilla HTML, CSS, and JavaScript; defining the rules that
                 govern how an interface responds to input, scroll, and
                 time.</p>
              <p>> Layout, motion, and real-time three-dimensional scenes are
                 computed every frame from a single source of truth, so complex
                 behavior emerges predictably and stays fully controllable.</p>
              <p>> Principles of typography, motion design, and real-time
                 rendering inform me in the creation of interfaces that are both
                 performant and visually expressive.
              <br>
              <br>   
              </p>
              <div class="process-card-note">A visual scripting workflow that enables
                 me to design interactive, aesthetically considered websites and
                 web applications</div>
            </div>
            <div class="process-card-media">
              <img src="images/process/visualScripting/full/3full.webp"
                   alt="A WebGL scene rendered in the browser with three.js"
                   loading="lazy" decoding="async">
              <img src="images/process/visualScripting/full/4full.webp"
                   alt="Interface code and the interactive page it drives"
                   loading="lazy" decoding="async">
            </div>
          </div>
        </div>
      </div>

      <div class="process-card">
        <button class="process-card-head" type="button" aria-expanded="false">
          <span class="process-card-icon">
            <!-- PLACEHOLDER icon — a branching growth skeleton. -->
            <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
                 fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M24 42 V19" />
              <path d="M24 30 L14 21" />
              <path d="M24 30 L34 21" />
              <path d="M24 19 L17 9" />
              <path d="M24 19 L31 9" />
            </svg>
          </span>
          <span class="process-card-index">WF / 03</span>
          <span class="process-card-title">FOLIAGE DESIGN: <span>&mdash; [ SPEEDTREE ]</span></span>
          <span class="process-card-state" aria-hidden="true"></span>
        </button>
        <div class="process-card-body">
          <div class="process-card-inner">
            <div class="process-card-text">
              <div class="process-card-tags">
                <p>/ PHYTOMORPHOLOGY AS DATA</p>
                <p>/ THE LOGIC OF DISTRIBUTION AND GROWTH</p>
              </div>
              <p> 
              <br>
              > In [<strong>SPEEDTREE</strong>], I treat trunks, branches, and leaves as structured datasets;
              <br>
              <br>
              </p>
              <div class="process-card-terms">
                <span>GROWTH</span><span>HIERARCHY</span><span>PHYLLOTAXY</span><span>DENSITY</span><span>VARIATION</span><span>GRAVITY</span><span>WIND</span>
              </div>
              <p>
              <br>
              > I use rule-based generation systems to define how trunks,
                 branches, leaves, and clusters emerge through iterative
                 growth logic.</p>
              <p>> Distribution, scaling, and orientation of foliage elements
                 are parameterized and computed procedurally.</p>
              <p>> I draw from botany, ecology, and natural growth models to
                 inform the production of botanically plausible forms with
                 controlled variation.
              <br>
              <br>   
              </p>
              <div class="process-card-note">A visual scripting workflow
                 rooted in natural growth logic that enables me to design
                 coherent foliage structures</div>
            </div>
            <div class="process-card-media">
              <img src="images/process/visualScripting/full/5full.webp"
                   alt="SpeedTree — branch generation and spine curves"
                   loading="lazy" decoding="async">
              <img src="images/process/visualScripting/full/6full.webp"
                   alt="SpeedTree — full grown tree with generation graph"
                   loading="lazy" decoding="async">
            </div>
          </div>
        </div>
      </div>

      <div class="process-card">
        <button class="process-card-head" type="button" aria-expanded="false">
          <span class="process-card-icon">
            <!-- PLACEHOLDER icon — a ridgeline over its baseline. -->
            <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
                 fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M4 37 L16 17 L24 27 L32 11 L44 37" />
              <path d="M4 37 H44" />
            </svg>
          </span>
          <span class="process-card-index">WF / 04</span>
          <span class="process-card-title">LANDSCAPE DESIGN: <span>&mdash; [ GAEA ]</span></span>
          <span class="process-card-state" aria-hidden="true"></span>
        </button>
        <div class="process-card-body">
          <div class="process-card-inner">
            <div class="process-card-text">
              <div class="process-card-tags">
                <p>/ GEOMORPHOLOGY AS DATA</p>
                <p>/ THE LOGIC OF EROSION AND FORMATION</p>
              </div>
              <p>
              <br>
              > In [<strong>GAEA</strong>], I treat terrain as structured datasets;
              <br>
              <br>
              </p>
              <div class="process-card-terms">
                <span>ELEVATION</span><span>SLOPE</span><span>FLOW</span><span>DISPLACEMENT</span><span>SEDIMENT</span><span>STRATIFICATION</span><span>SCALE</span>
              </div>
              <p>
              <br>
              > I create procedural node networks to compute geological
                 processes that shape landscape form over time.</p>
              <p>> Erosion, weathering, deposition, and tectonic influence are
                 resolved through iterative simulation, producing land forms
                 that reflect natural causality.</p>
              <p>> I apply principles from geomorphology and physical geology
                 to guide parameterization and control emergent landscape
                 behavior.
              <br>
              <br>
              </p>
              <div class="process-card-note">A visual scripting workflow for
                 geological systems that enables me to design believable and
                 scalable terrains</div>
            </div>
            <div class="process-card-media">
              <img src="images/process/visualScripting/full/7full.webp"
                   alt="Gaea — terrain heightfield with erosion node graph"
                   loading="lazy" decoding="async">
              <img src="images/process/visualScripting/full/8full.webp"
                   alt="Gaea — rendered alpine terrain and node network"
                   loading="lazy" decoding="async">
            </div>
          </div>
        </div>
      </div>

      <div class="process-card">
        <button class="process-card-head" type="button" aria-expanded="false">
          <span class="process-card-icon">
            <!-- PLACEHOLDER icon — stratified block with a fracture. -->
            <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
                 fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M10 12 H38 V38 H10 Z" />
              <path d="M10 21 H38" />
              <path d="M10 30 H38" />
              <path d="M21 12 L26 38" stroke-dasharray="3 3" />
            </svg>
          </span>
          <span class="process-card-index">WF / 05</span>
          <span class="process-card-title">GEOLOGY DESIGN: <span>&mdash; [ HOUDINI ]</span></span>
          <span class="process-card-state" aria-hidden="true"></span>
        </button>
        <div class="process-card-body">
          <div class="process-card-inner">
            <div class="process-card-text">
              <div class="process-card-tags">
                <p>/ LITHOLOGY AS DATA</p>
                <p>/ THE LOGIC OF STRATIFICATION AND FRACTURE</p>
              </div>
              <p>
              <br>
              > In [<strong>HOUDINI</strong>], I treat geological structures as structured datasets;
              <br>
              <br>
              </p>
              <div class="process-card-terms">
                <span>STRATIFICATION</span><span>FRACTURE</span><span>GRAIN</span><span>EROSION</span><span>WEATHERING</span><span>DENSITY</span>
              </div>
              <p>
              <br>
              > I create procedural geometry networks and custom solvers to
                 model the natural processes that shape rock form.</p>
              <p>> Layering, fracturing, and erosion are computed as
                 rule-driven operations, allowing controlled variation to
                 emerge from simple geological principles.</p>
              <p>> This approach supports both macro form and micro detail,
                 producing physically plausible structures that remain
                 consistent across different scales and contexts.
              <br>
              <br>   
              </p>
              <div class="process-card-note">A visual scripting workflow
                 grounded in geological logic that enables me to design
                 believable, diverse rock forms through controlled,
                 data-driven processes</div>
            </div>
            <div class="process-card-media">
              <img src="images/process/visualScripting/full/9full.webp"
                   alt="Houdini — blockout to fractured rock form"
                   loading="lazy" decoding="async">
              <img src="images/process/visualScripting/full/10full.webp"
                   alt="Houdini — rendered canyon strata with network view"
                   loading="lazy" decoding="async">
            </div>
          </div>
        </div>
      </div>

      <div class="process-card">
        <button class="process-card-head" type="button" aria-expanded="false">
          <span class="process-card-icon">
            <!-- PLACEHOLDER icon — a material swatch sphere, half textured. -->
            <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
                 fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <circle cx="24" cy="24" r="15" />
              <path d="M12 15 H36" />
              <path d="M10 22 H38" />
              <path d="M12 29 H36" />
              <path d="M17 36 H31" />
            </svg>
          </span>
          <span class="process-card-index">WF / 06</span>
          <span class="process-card-title">MATERIAL DESIGN: <span>&mdash; [ SUBSTANCE DESIGNER ]</span></span>
          <span class="process-card-state" aria-hidden="true"></span>
        </button>
        <div class="process-card-body">
          <div class="process-card-inner">
            <div class="process-card-text">
              <div class="process-card-tags">
                <p>/ TEXTURE AS DATA</p>
                <p>/ THE LOGIC OF SURFACE PROPERTIES</p>
              </div>
              <p>
              <br>
              > In [<strong>SUBSTANCE DESIGNER</strong>], I treat material attributes as structured datasets;
              <br>
              <br>
              </p>
              <div class="process-card-terms">
                <span>COLOR</span><span>ROUGHNESS</span><span>METALLICITY</span><span>HEIGHT</span><span>NORMALS</span><span>EMISSION</span><span>REFLECTANCE</span>
              </div>
              <p>
              <br>
              > I create node networks and define parametric rules that
                 procedurally generate complex textures and layered
                 surfaces.</p>
              <p>> Interactions between nodes, maps, and parameters are
                 computed, resulting in seamless patterns and surface
                 attributes that can be controllably adjusted.</p>
              <p>> Every element is connected and measured, enabling systematic
                 exploration of texture, surface detail, and material
                 variation.
              <br>
              <br>
              </p>
              <div class="process-card-note">A visual scripting workflow that
                 enables me to design complex, data-driven textures and layered
                 surfaces</div>
            </div>
            <div class="process-card-media">
              <img src="images/process/visualScripting/full/11full.webp"
                   alt="Substance Designer — procedural material graph and preview"
                   loading="lazy" decoding="async">
              <img src="images/process/visualScripting/full/12full.webp"
                   alt="Substance Designer — woven fabric material rendered"
                   loading="lazy" decoding="async">
            </div>
          </div>
        </div>
      </div>

      <div class="process-card">
        <button class="process-card-head" type="button" aria-expanded="false">
          <span class="process-card-icon">
            <!-- PLACEHOLDER icon — a lit sphere with an incident ray. -->
            <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
                 fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <circle cx="26" cy="26" r="13" />
              <circle cx="20" cy="20" r="3" fill="currentColor" stroke="none" />
              <path d="M6 6 L15 15" />
              <path d="M6 14 L6 6 L14 6" />
            </svg>
          </span>
          <span class="process-card-index">WF / 07</span>
          <span class="process-card-title">MATERIAL SHADING: <span>&mdash; [ UNREAL ENGINE ]</span></span>
          <span class="process-card-state" aria-hidden="true"></span>
        </button>
        <div class="process-card-body">
          <div class="process-card-inner">
            <div class="process-card-text">
              <div class="process-card-tags">
                <p>/ OPTICS AS DATA</p>
                <p>/ THE LOGIC OF ILLUMINATION</p>
              </div>
              <p>
              <br>
              > In [<strong>UNREAL ENGINE</strong>], I treat light and surface response as structured datasets;
              <br>
              <br>
              </p>
              <div class="process-card-terms">
                <span>INTENSITY</span><span>DIRECTION</span><span>SUBSURFACE.SCATTERING</span><span>REFLECTION</span><span>REFRACTION</span><span>AMBIENT.OCCLUSION</span>
              </div>
              <p>
              <br>
              > I write scripts and create node networks to define logical
                 rules that govern surface response under lighting and
                 environmental conditions.</p>
              <p>> Shading networks compute interactions between lights,
                 materials, and geometry, producing predictable,
                 physically-informed surface behavior.</p>
              <p>> Principles of optics and physically-based rendering inform
                 me in the creation of surfaces that are both accurate and
                 visually expressive.
              <br>
              <br>   
              </p>
              <div class="process-card-note">A visual scripting workflow that
                 enables me to design shading models that support visual
                 storytelling with high-fidelity material rendering</div>
            </div>
            <div class="process-card-media">
              <img src="images/process/visualScripting/full/13full.webp"
                   alt="Unreal Engine — glass shader and its material graph"
                   loading="lazy" decoding="async">
              <img src="images/process/visualScripting/full/14full.webp"
                   alt="Unreal Engine — material spheres lit in a test scene"
                   loading="lazy" decoding="async">
            </div>
          </div>
        </div>
      </div>

      <div class="process-card">
        <button class="process-card-head" type="button" aria-expanded="false">
          <span class="process-card-icon">
            <!-- PLACEHOLDER icon — a body fracturing under an incident force. -->
            <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
                 fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M14 16 H38 V40 H14 Z" />
              <path d="M14 27 L26 22 L30 33 L38 29" />
              <path d="M4 8 L12 14" />
              <path d="M4 14 L4 8 L10 8" />
            </svg>
          </span>
          <span class="process-card-index">WF / 08</span>
          <span class="process-card-title">GEOMETRY SIMULATION: <span>&mdash; [ VARIOUS SOFTWARE ]</span></span>
          <span class="process-card-state" aria-hidden="true"></span>
        </button>
        <div class="process-card-body">
          <div class="process-card-inner">
            <div class="process-card-text">
              <div class="process-card-tags">
                <p>/ FORCES AS DATA</p>
                <p>/ THE LOGIC OF INTERACTION</p>
              </div>
              <p>
              <br>
              > In [<strong>HOUDINI</strong>], [<strong>FUSION360</strong>], [<strong>CLO3D</strong>], and [<strong>UNREAL ENGINE</strong>], I treat physical properties as structured datasets;
              <br>
              <br>
              </p>
              <div class="process-card-terms">
                <span>MASS</span><span>WEIGHT</span><span>STIFFNESS</span><span>ELASTICITY</span><span>DAMPING</span><span>SURFACE.ATTRIBUTES</span>
              </div>
              <p>
              <br>
              > Interactions between properties are computed iteratively,
                 resolving collisions, deformations, and dynamic responses
                 according to system rules.</p>
              <p>> Whether I am working with rigid bodies, cloth, fluids, or
                 articulated mechanisms, my mindset remains the same;</p>
              <p>> Geometry and forces are represented as data, and interact
                 within a measurable system, resulting in controlled simulation
                 of physical phenomena.
              <br>
              <br>   
              </p>
              <div class="process-card-note">A visual scripting workflow that
                 enables me to build accurate simulation models that guide
                 design, and verify feasibility</div>
            </div>
            <div class="process-card-media">
              <img src="images/process/visualScripting/full/15full.webp"
                   alt="Houdini — FLIP fluid solver running through a canyon"
                   loading="lazy" decoding="async">
              <img src="images/process/visualScripting/full/16full.webp"
                   alt="Rigid-body destruction simulation mid-shatter"
                   loading="lazy" decoding="async">
            </div>
          </div>
        </div>
      </div>

      <div class="process-card">
        <button class="process-card-head" type="button" aria-expanded="false">
          <span class="process-card-icon">
            <!-- PLACEHOLDER icon — particles advected along a flow curve. -->
            <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
                 fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M5 36 C16 36, 14 12, 26 12 C36 12, 36 26, 44 26" />
              <circle cx="12" cy="30" r="1.8" fill="currentColor" stroke="none" />
              <circle cx="24" cy="12.5" r="1.8" fill="currentColor" stroke="none" />
              <circle cx="35" cy="20" r="1.8" fill="currentColor" stroke="none" />
              <circle cx="43" cy="26" r="1.8" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span class="process-card-index">WF / 09</span>
          <span class="process-card-title">FX AND MOTION DESIGN: <span>&mdash; [ TOUCHDESIGNER ]</span></span>
          <span class="process-card-state" aria-hidden="true"></span>
        </button>
        <div class="process-card-body">
          <div class="process-card-inner">
            <div class="process-card-text">
              <div class="process-card-tags">
                <p>/ PARTICLES AS DATA</p>
                <p>/ THE LOGIC OF EMERGENT BEHAVIOR</p>
              </div>
              <p>
              <br>
              > In [<strong>TOUCHDESIGNER</strong>], I treat particles, forces, and fields as structured datasets;
              <br>
              <br>
              </p>
              <div class="process-card-terms">
                <span>POSITION</span><span>VELOCITY</span><span>ACCELERATION</span><span>DENSITY</span><span>ROTATION</span><span>COLLISION</span><span>TURBULENCE</span>
              </div>
              <p>
              <br>
              > I write scripts and create node networks to compute emergent
                 motion patterns while remaining adjustable in real time.</p>
              <p>> Forces, attractors, constraints, and turbulence are computed
                 continuously, producing complex motion from simple,
                 well-defined rulesets.</p>
              <p>> Guided by procedural design principles, I refine visual
                 systems that respond intuitively to context and stimuli.
              <br>
              <br>   
              </p>
              <div class="process-card-note">A visual scripting workflow
                 combining mathematics and visual elements that enables me to
                 design emergent motion systems</div>
            </div>
            <div class="process-card-media">
              <img src="images/process/visualScripting/full/17full.webp"
                   alt="TouchDesigner — particle flow network and output"
                   loading="lazy" decoding="async">
              <img src="images/process/visualScripting/full/18full.webp"
                   alt="TouchDesigner — emergent filament motion system"
                   loading="lazy" decoding="async">
            </div>
          </div>
        </div>
      </div>

      <div class="process-card">
        <button class="process-card-head" type="button" aria-expanded="false">
          <span class="process-card-icon">
            <!-- PLACEHOLDER icon — a trigger firing into a state transition. -->
            <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
                 fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M5 10 H19 V20 H5 Z" />
              <path d="M29 28 H43 V38 H29 Z" />
              <path d="M19 15 H24 V33 H29" />
              <circle cx="24" cy="15" r="2.2" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span class="process-card-index">WF / 10</span>
          <span class="process-card-title">EVENT LOGIC: <span>&mdash; [ UNREAL ENGINE ]</span></span>
          <span class="process-card-state" aria-hidden="true"></span>
        </button>
        <div class="process-card-body">
          <div class="process-card-inner">
            <div class="process-card-text">
              <div class="process-card-tags">
                <p>/ GAMEPLAY AS DATA</p>
                <p>/ THE LOGIC OF SYSTEM STATES</p>
              </div>
              <p>
              <br>
              > In [<strong>UNREAL ENGINE</strong>], I treat triggers, and system states as structured datasets;
              <br>
              <br>
              </p>
              <div class="process-card-terms">
                <span>PLAYER.INPUTS</span><span>SPATIAL.RELATIONSHIPS</span><span>TIMERS</span><span>COLLISIONS</span><span>ENVIRONMENTAL.SIGNALS</span>
              </div>
              <p>
              <br>
              > I script C++ and Blueprint networks to define logical
                 relationships and create procedural rules that govern how
                 systems respond and interact.</p>
              <p>> Event flows and state changes are computed iteratively,
                 allowing complex interactive behaviors to emerge predictably
                 while remaining fully controllable.</p>
              <p>> I leverage modular design principles to build reusable and
                 maintainable gameplay systems.
              <br>
              <br>   
              </p>
              <div class="process-card-note">A visual scripting workflow for
                 interactive systems that enables me to design responsive and
                 coherent gameplay mechanics</div>
            </div>
            <div class="process-card-media">
              <img src="images/process/visualScripting/full/19full.webp"
                   alt="Unreal Engine — animation sequencer driving a creature"
                   loading="lazy" decoding="async">
              <img src="images/process/visualScripting/full/20full.webp"
                   alt="Unreal Engine — character pawn event graph"
                   loading="lazy" decoding="async">
            </div>
          </div>
        </div>
      </div>
    `,
  },

];

/* -----------------------------------------------------------------------------
   ENTRY MARKUP
   -----------------------------------------------------------------------------
   One process = one .sidebar-process-entry:
     - the kicker (PROCESS / NN) sits top-left, outside the framed row,
       per the label grammar in visualLanguage.md;
     - the frame holds the icon tile (a <button>, the only click target)
       and the data-block: two full-width rows, TITLE then LOGIC. Borders
       between cells are emitted by CSS via adjacency selectors — the HTML
       stays flat.
   The per-process accent rides in as an inline --process-accent custom
   property; the stylesheet consumes it, falling back to neutral tokens
   if an entry omits it.
   --------------------------------------------------------------------------- */

function entryMarkup(p, i) {
  const num = String(i + 1).padStart(2, "0");
  return `
    <article class="sidebar-process-entry" style="--process-accent: ${p.accent};">
      <span class="sidebar-process-kicker">PROCESS / ${num}</span>
      <div class="sidebar-process-frame">
        <button
          class="sidebar-process-icon"
          type="button"
          data-process-index="${i}"
          aria-label="Open ${p.title}"
        >${p.icon}</button>
        <div class="sidebar-process-data">
          <div class="sidebar-process-data-row sidebar-process-data-row-full">
            <div class="sidebar-process-data-cell">
              <span class="sidebar-process-data-label">TITLE</span>
              <span class="sidebar-process-data-value">${p.title}</span>
            </div>
          </div>
          <div class="sidebar-process-data-row sidebar-process-data-row-full">
            <div class="sidebar-process-data-cell">
              <span class="sidebar-process-data-label">LOGIC</span>
              <span class="sidebar-process-data-value">${p.logic}</span>
            </div>
          </div>
        </div>
      </div>
    </article>
  `;
}

/* -----------------------------------------------------------------------------
   THE VIEW
   --------------------------------------------------------------------------- */

export const processView = {
  name: "process",

  buildDOM(nav) {
    const el = document.createElement("div");
    el.className = "sidebar-view-process";
    el.innerHTML = `
      <h2 class="sidebar-process-title">Process</h2>
      <div class="sidebar-process-body">
        <p>
          > My design disciplines indexed as process sheets.
          <br>
          <br>
          - Click an icon to learn more about the way I work.
        </p>
      </div>
      <div class="sidebar-process-list">
        ${PROCESSES.map((p, i) => entryMarkup(p, i)).join("")}
      </div>
    `;

    // Click delegation for icon tiles: open the process modal at the
    // clicked entry, passing the WHOLE list (so the modal's prev/next can
    // cycle without importing this module), the index, and the clicked
    // tile as the FLIP origin. Only the tile is a click target; the data
    // block is selectable text, intentionally not clickable (mirrors
    // sidebarProjects' thumb-only model).
    el.addEventListener("click", (e) => {
      const tile = e.target.closest("[data-process-index]");
      if (!tile) return;
      const idx = +tile.dataset.processIndex;
      if (PROCESSES[idx]) openProcessModal(PROCESSES, idx, tile);
    });

    return el;
  },

  onEnter(el) {
    cancels.cancelAll();
    const title = el.querySelector(".sidebar-process-title");
    const body  = el.querySelector(".sidebar-process-body");

    // Scrambles registered first → tick first each frame → produce the
    // baseline color that hover then overrides for chars near the cursor.
    if (title) cancels.add(startScramble(title));
    if (body)  cancels.add(startScramble(body));

    // Hovers registered second → tick after scrambles → write their
    // tints last each frame for lit chars. Layered mode is auto-
    // detected from the per-char span structure scramble produces.
    if (title) cancels.add(startHoverWave(title, { waveRadius: HOVER_WAVE_RADIUS }));
    if (body)  cancels.add(startHoverWave(body,  { waveRadius: HOVER_WAVE_RADIUS }));
  },

  onExit() {
    cancels.cancelAll();
  },
};