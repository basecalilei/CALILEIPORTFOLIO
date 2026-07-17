/* =============================================================================
   sidebarAbout.js — the "about" view of the sidebar
   -----------------------------------------------------------------------------
   The condensed single-column port of the old site's About page: a framed
   portrait with its ">"-prefixed nameplate, an opening statement bracketed
   by head images, a full-bleed section band, the aviation narrative
   interleaved
   with photo figures, a dark "today" block with the four-principle cascade,
   and a full-bleed hero image closing the view. Authoring the content
   directly in this module is intentional: views own their own content (it's
   not reusable across contexts), and a fresh file with full HTML/CSS control
   is the easiest way to author a view that doesn't follow a generic template.

   ANIMATION — THE GATED REVEAL SEQUENCE
     The story reveals piece by piece, in read order, at a pace the
     reader controls. Every step element (STEP_SELECTOR; document order
     IS sequence order) starts hidden (.is-pending — visibility-based,
     so layout is final from t=0). A step runs when BOTH gates open:
       1. the previous step has completed, and
       2. the step has been SEEN — it entered the viewport at least
          once (IntersectionObserver with root: null, which clips
          through the sheet's scroll container automatically). "Seen
          once" semantics: scrolling past unrevealed steps can never
          deadlock the chain — passed steps catch up off-screen.
     Decisions on record: the sequence plays on every entry UNTIL its
     first natural completion — after that, entries land with the
     content already revealed (see FIRST PLAY-THROUGH ONLY below).
     There is deliberately no mid-play skip affordance (yet).

     TWO STEP KINDS (auto-detected: contains <img> → figure):
       - type: startTypewriter reveals the text with organic timing.
         The primitive is called BEFORE .is-pending is removed — every
         character carries inline visibility:hidden from span creation,
         so the resolved text never flashes. Chaining uses the
         primitive's onComplete option (added for this view; fires once
         at natural completion, never on cancel).
       - figure: all <img>s are decode()d first (forces the lazy fetch —
         the fade must reveal pixels, not a half-downloaded box), then
         the plate/crosses/caption pop in with the photos held
         transparent (.is-developing), and the photos fade up on the
         CSS transition. Frame first, photo second. Advancement is
         timer-based (FIGURE_REVEAL_MS, coupled with the CSS timing) —
         a timer can't be lost the way a transitionend event can. A
         figure that needs longer than the default budget authors its
         own with data-reveal-ms (see the portrait, below).

     THE PORTRAIT DEVELOPS IN TWO BEATS
       FIG.01 is a two-layer plate: a line drawing (0full) and the
       photograph (1full) stacked in one grid cell, drawing beneath. The
       figure step reveals both — beat 1, the drawing resolves on the
       shared figure timing; beat 2, the photograph WIPES in over it,
       top to bottom, behind a hard horizontal edge (a clip-path inset
       walked from 100% to 0% — timing and tuning in the CSS). A wipe
       rather than a crossfade because ink-on-white dissolving into a
       dark photograph averages to a milky middle; and a HARD edge
       rather than a soft one because a soft band just brings that
       averaging back locally, which on line art reads as blur instead
       of resolution. At every instant the plate is two states meeting
       on a line, and the line moves. The drawing is never removed: it
       stays at full opacity beneath, so a failed photo load degrades to
       the drawing rather than to an empty plate. The two beats are
       authored together in the CSS (.is-drawing / .is-photograph); the
       longer window they need is authored on the figure as
       data-reveal-ms.

     HOVER LAYER
       The display moments in HOVER_SELECTORS additionally get
       textHoverWave, started on each one's typing completion. At that
       point the typewriter's spans still exist, so hover auto-detects
       LAYERED mode and borrows them. Never start hover before a
       target's typewriter call — two span-creating primitives on the
       same element corrupt each other. Per-target insertion order in
       the cancels group stays typewriter-then-hover, which keeps
       cancellation restoring the DOM in the right order.

     TEARDOWN
       The sequencer registers its own cleanup in the cancels group
       alongside the primitives: view exit (or re-entry) mid-sequence
       disconnects the observer, clears pending timers/rAFs, and strips
       the state classes; the primitive cancels restore the text nodes.
       The DOM is never left partially hidden.

     FIRST PLAY-THROUGH ONLY
       The gated reveal is a first-read moment. A module-level
       hasPlayedThrough flag flips in stepDone when the LAST step
       finishes — which, because steps are seen-gated, means the reader
       scrolled the whole view. Later entries skip the sequence: no
       pending classes, no observer, no scrollTop reset (that reset
       exists only to serve the gate's geometry — a returning reader
       keeps their place like any normal page), and hover attaches
       immediately in STANDALONE mode to the same targets the sequence
       would have given it (HOVER_SELECTORS minus figure-kind elements,
       mirroring the step-kind rule). Session-scoped: a reload replays.
       An exit mid-sequence leaves the flag false, so the next entry
       replays from the top; resuming from a partial read is a possible
       future refinement, deliberately not built.

     STYLING RULE FOR ANIMATED SUBTREES
       Unchanged and still load-bearing: the primitives wrap EVERY text
       node inside a target — including the whitespace between authored
       elements — in classless per-character <span>s that persist until
       cancel. Inside animated targets, style only authored classes: a
       bare `span` selector would match the animation's internals, and
       a structural pseudo-class like :nth-child breaks because the
       wrapped whitespace shifts element child indices. This is why the
       statement lines carry .is-step-* classes, the credo lines carry
       .sidebar-about-credo-line — and why the principle <li>s now
       carry .is-step-* classes too (the list became a typewriter
       target in this revision).

   COUPLED WITH
     - sidebarAboutStyles.css: emits .sidebar-view-about and inner classes.
     - sidebar.js: imports `aboutView` and includes it in initSidebar.
     - textTypewriter.js: provides startTypewriter (entry; its onComplete
       option exists for this view's sequencer).
     - textHoverWave.js: provides startHoverWave (interaction, layered
       mode — borrows the typewriter's spans after each target types).
     - images/about/full/: 0full–9full.webp, numbered in order of
       appearance (0 portrait drawing, 1 portrait photograph — the two
       layers of FIG.01 — then 2 altitude image, 3–4 archive pair,
       5–8 fleet grid, 9 hero).
   ========================================================================== */

import { startTypewriter }   from "./textTypewriter.js";
import { startHoverWave }    from "./textHoverWave.js";
import { createCancelGroup } from "./cancels.js";

/* -----------------------------------------------------------------------------
   MODULE-LEVEL STATE
   --------------------------------------------------------------------------- */

const cancels = createCancelGroup();

// Set once, at the first natural completion of the FULL gated sequence.
// Because every step is seen-gated, completion implies the reader
// scrolled the entire view. Later entries skip the sequence and land
// revealed (see FIRST PLAY-THROUGH ONLY in the header). Deliberately
// session-scoped — a reload replays; persist this to localStorage if
// once-ever is wanted.
let hasPlayedThrough = false;

// Wave radius for the hover layer. The primitive's default is 35;
// smaller reads as more focal/subtle, which suits permanent copy.
const HOVER_WAVE_RADIUS = 5;

// Fraction of a step element that must be inside the viewport before its
// reveal may start. Low on purpose: a tall figure shouldn't demand half
// the sheet before it's allowed to develop.
const IN_VIEW_THRESHOLD = 0.1;

// DEFAULT time budget for one figure reveal, from .is-pending removal to
// settled photo. COUPLED WITH sidebarAboutStyles.css — the img opacity
// transition's delay + duration must finish inside this window. The
// sequencer advances on this timer rather than transitionend, because a
// timer can't be lost to a missed event.
//
// A figure whose reveal is a longer composition overrides this per
// instance with data-reveal-ms (the portrait's two-beat develop does).
// Raising the constant instead would slow every other figure's
// advancement for a reason that only exists in one of them.
const FIGURE_REVEAL_MS = 1000;

// Every element that participates in the gated reveal sequence, as one
// combined selector. DOCUMENT ORDER IS THE SEQUENCE — querySelectorAll
// returns matches in document order, so reordering content in buildDOM
// reorders the reveal with no code change here. Nested steps are fine
// (the nameplate lives inside the portrait figure): each step
// hides/reveals only itself, and a child carrying .is-pending stays
// hidden inside its already-revealed ancestor.
const STEP_SELECTOR = [
  ".sidebar-about-kicker",
  ".sidebar-about-portrait",
  ".sidebar-about-nameplate",
  ".sidebar-about-statement",
  ".sidebar-about-figure",
  ".sidebar-about-band",
  ".sidebar-about-body p",
  ".sidebar-about-dark p",
  ".sidebar-about-principles",
  ".sidebar-about-credo",
  ".sidebar-about-hero",
].join(", ");

// The display moments that ALSO get the hover-wave interaction layer,
// started when each one finishes typing (layered mode — hover borrows
// the typewriter's spans; see the header). Body copy stays hover-free.
const HOVER_SELECTORS = [
  ".sidebar-about-nameplate",
  ".sidebar-about-statement",
  ".sidebar-about-band",
  ".sidebar-about-body p",
  ".sidebar-about-credo",
];

/* -----------------------------------------------------------------------------
   THE VIEW
   --------------------------------------------------------------------------- */

export const aboutView = {
  name: "about",

  buildDOM(nav) {
    const el = document.createElement("div");
    el.className = "sidebar-view-about";
    // NOTE: "\\" in the statement's last line is a template-literal escape
    // for a single literal backslash — the authored text ends "ALTITUDE\".
    el.innerHTML = `
      <header class="sidebar-about-head">
        <p class="sidebar-about-kicker">// ABOUT.CAL</p>

        <figure class="sidebar-about-portrait" data-reveal-ms="1800">
          <div class="sidebar-about-frame">
            <!-- Two layers, one grid cell: the drawing sits in flow and
                 sets the plate's height; the photograph stacks on top and
                 develops over it. The drawing's alt is empty on purpose —
                 same subject, and two identical alts is noise. -->
            <div class="sidebar-about-stack">
              <img class="sidebar-about-photo is-drawing" src="images/about/full/0full.webp" alt="" loading="lazy" decoding="async" />
              <img class="sidebar-about-photo is-photograph" src="images/about/full/1full.webp" alt="Headshot" loading="lazy" decoding="async" />
            </div>
            <i class="sidebar-about-marks" aria-hidden="true"></i>
          </div>
          <figcaption class="sidebar-about-figcap">FIG.01 // CAL HEADSHOT </figcaption>

          <figcaption class="sidebar-about-nameplate">
            <span class="sidebar-about-nameplate-line">&gt; CAL.CALILEI</span>
            <span class="sidebar-about-nameplate-line">&gt; DESIGN.STORY</span>
            <span class="sidebar-about-nameplate-line">&gt; </span>
            <span class="sidebar-about-nameplate-line">&gt; </span>
            <span class="sidebar-about-nameplate-line">&gt; </span>
            <span class="sidebar-about-nameplate-line">&gt; </span>
            <span class="sidebar-about-nameplate-line">&gt; </span>
            
          </figcaption>
        </figure>


        <h2 class="sidebar-about-statement">
          <span class="sidebar-about-line">> DESIGN,</span>
          <span class="sidebar-about-line is-step-2">> FOR ME,</span>
          <span class="sidebar-about-line is-step-3 is-strong">/STARTED AT ALTITUDE\\</span>
        </h2>

        <figure class="sidebar-about-figure">
          <div class="sidebar-about-frame">
            <img class="sidebar-about-photo" src="images/about/full/2full.webp" alt="F-22" loading="lazy" decoding="async" />
            <i class="sidebar-about-marks" aria-hidden="true"></i>
          </div>
          <figcaption class="sidebar-about-figcap">FIG.02 // F-22 ASCENT - EDWARDS AFB - 2008 </figcaption>
          
        </figure>

      </header>

      <div class="sidebar-about-band"><span class="sidebar-about-band-prefix">//</span>BORN INTO AVIATION</div>

      <div class="sidebar-about-body">
        <p>
          > Like my father, and his father;
        </p>
        <p>
          > <strong>I grew up inside the world of military aviation.</strong>
        </p>
        <p>
          > Hangars were my classrooms, and aircraft were my first systems.
        </p>

        <figure class="sidebar-about-figure">
          <div class="sidebar-about-frame">
            <img class="sidebar-about-photo" src="images/about/full/4full.webp" alt="Insignia" loading="lazy" decoding="async" />
            <i class="sidebar-about-marks" aria-hidden="true"></i>
          </div>
          <figcaption class="sidebar-about-figcap">FIG.03 // INSIGNIA</figcaption>
        </figure>

        <p>
          > When I came of age,
        </p>
        <p>
          > I left home to serve in the U.S. Navy as an avionics electrician, specializing in the F/A-18 Super Hornet.
        </p>

        <figure class="sidebar-about-figure">
          <div class="sidebar-about-frame">
            <img class="sidebar-about-photo" src="images/about/full/5full.webp" alt="VFA-25" loading="lazy" decoding="async" />
            <i class="sidebar-about-marks" aria-hidden="true"></i>
          </div>
          <figcaption class="sidebar-about-figcap">FIG.04 // VFA-25 - CVN-75 - 2018 </figcaption>
        </figure>

        <p>
          > As an airman,
        </p>
        <p>
          > I learned how complex machines communicate,
        </p>
        <p>
          > how small details prevent catastrophic failure,
        </p>
        <p>
          > and how design must always serve a purpose.
        </p>

      </div>

      <section class="sidebar-about-dark">
        <p>
          > Today, <strong>I apply that same mindset to design.</strong>
        </p>
        <p>
          > I build systems that are clear, intentional, and grounded in real-world performance.
        </p>
        <p>
          > Whether it's a product, a brand, or a framework,
        </p>
        <p>
          > I design with the same principles that keep aircraft airborne:
        </p>

        <ul class="sidebar-about-principles">
          <li class="is-lead is-step-1"><span class="sidebar-about-slash">/</span></li>
          <li class="is-lead is-step-2"><span class="sidebar-about-slash">/</span></li>
          <li class="is-yellow is-step-3"><span class="sidebar-about-slash">/</span> PRECISION</li>
          <li class="is-red is-step-4"><span class="sidebar-about-slash">/</span> REFINEMENT</li>
          <li class="is-blue is-step-5"><span class="sidebar-about-slash">/</span> ORDER</li>
          <li class="is-green is-step-6"><span class="sidebar-about-slash">/</span> EXCELLENCE</li>
        </ul>

        <p class="sidebar-about-credo">
          <span class="sidebar-about-credo-line">AEROSPACE TAUGHT ME DISCIPLINE.</span>
          <span class="sidebar-about-credo-line">DESIGN IS HOW I EXPRESS IT.</span>
        </p>
      </section>

      <figure class="sidebar-about-hero">
        <img src="images/about/full/9full.webp" alt="F/A-18E Super Hornet launching from the carrier deck" loading="lazy" decoding="async" />
      </figure>
    `;

    // `nav` is unused: this view exposes no non-home navigation, and
    // back-to-home is handled by the shell's pinned back button.
    return el;
  },

  onEnter(el) {
    cancels.cancelAll();

    if (hasPlayedThrough) {
      // Replay visits: no sequence, no pending classes — the authored
      // DOM is already fully visible. Two deliberate differences from
      // a first visit:
      //   - scrollTop is NOT reset. The reset below exists purely to
      //     serve the gate's geometry; with no gate, a returning
      //     reader keeps their place like any normal page.
      //   - hover attaches immediately (STANDALONE mode — no
      //     typewriter spans exist for it to borrow) rather than
      //     per-step on typing completion. The img filter mirrors the
      //     sequence's step-kind rule: figure-kind elements never get
      //     hover in the animated path, so they don't get it here.
      for (const target of el.querySelectorAll(HOVER_SELECTORS.join(", "))) {
        if (target.querySelector("img")) continue;
        cancels.add(startHoverWave(target, { waveRadius: HOVER_WAVE_RADIUS }));
      }
      return;
    }

    // Always re-enter at the top: the sequence lives in read order from
    // the top, and the scroll container otherwise preserves the previous
    // visit's position — a returning reader would land at the bottom,
    // past the reveal. MUST happen before the observer attaches below:
    // the gate's initial "seen" entries are computed from current
    // geometry, and a bottom-of-page snapshot would pre-mark the tail
    // steps as seen, silently un-gating them. (el is the scroll
    // container per the .sidebar-view contract — overflow-y lives on
    // the view root.)
    el.scrollTop = 0;

    /* ---- build the step list (document order = read order) ---- */

    const steps = Array.from(el.querySelectorAll(STEP_SELECTOR)).map((stepEl) => ({
      el:    stepEl,
      // A step that contains an image reveals as a figure (frame pops,
      // photo fades in); anything else types.
      kind:  stepEl.querySelector("img") ? "figure" : "type",
      hover: HOVER_SELECTORS.some((sel) => stepEl.matches(sel)),
    }));

    for (const s of steps) s.el.classList.add("is-pending");

    /* ---- gated-chain state ---- */

    let nextIdx  = 0;          // the next step waiting to run
    let running  = false;      // a step is currently revealing
    let disposed = false;      // teardown happened (possibly mid-sequence)
    const seen   = new Set();  // step elements that have entered the viewport
    const timers = new Set();  // pending timeouts (figure advancement)
    const rafs   = new Set();  // pending rAFs (figure transition kicks)

    // root: null observes against the browser viewport, which the spec
    // clips through every overflow ancestor — including the sheet's
    // scroll container — so this needs no assumption about WHICH
    // element scrolls. "Seen once" (elements are never removed from the
    // set): scrolling past unrevealed steps must not deadlock the
    // chain; passed steps stay eligible and catch up off-screen.
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) seen.add(e.target);
      }
      tryAdvance();
    }, { root: null, threshold: IN_VIEW_THRESHOLD });

    for (const s of steps) observer.observe(s.el);

    function tryAdvance() {
      if (disposed || running || nextIdx >= steps.length) return;
      const step = steps[nextIdx];
      if (!seen.has(step.el)) return; // previous done, reader not there yet
      nextIdx++;
      running = true;
      observer.unobserve(step.el);
      if (step.kind === "figure") runFigureStep(step);
      else                        runTypeStep(step);
    }

    function stepDone() {
      running = false;
      // The final step just finished → the reader played the whole
      // sequence through. Recorded at module scope so future entries
      // skip straight to revealed content. Can't fire post-teardown:
      // typewriter completions are disposed-guarded upstream, and
      // figure timers are cleared in the teardown cancel.
      if (nextIdx >= steps.length) hasPlayedThrough = true;
      tryAdvance();
    }

    /* ---- the two step kinds ---- */

    function runTypeStep(step) {
      // Order matters: startTypewriter first (every character now carries
      // its own inline visibility:hidden), THEN unhide the element — the
      // resolved text never flashes.
      cancels.add(startTypewriter(step.el, {
        onComplete: () => {
          if (disposed) return;
          // Hover joins only after typing lands. Starting it before the
          // typewriter call would corrupt the walk (two span-creating
          // primitives on one element); starting it here finds the
          // typewriter's spans still in place → layered mode. Insertion
          // order in the cancels group stays typewriter-then-hover per
          // target, so cancellation restores the DOM in the right order.
          if (step.hover) {
            cancels.add(startHoverWave(step.el, { waveRadius: HOVER_WAVE_RADIUS }));
          }
          stepDone();
        },
      }));
      step.el.classList.remove("is-pending");
    }

    function runFigureStep(step) {
      const imgs = Array.from(step.el.querySelectorAll("img"));
      // decode() forces the fetch+decode on lazy images — the fade must
      // reveal pixels, not an empty box that's still downloading.
      Promise.all(imgs.map((img) => img.decode().catch(() => {}))).then(() => {
        if (disposed) return;
        // Frame first: the plate/crosses/caption pop in with the photos
        // held transparent, then the class drops and the photos fade up
        // on the CSS transition (see REVEAL SEQUENCE STATE in the CSS).
        step.el.classList.add("is-developing");
        step.el.classList.remove("is-pending");
        // Double rAF: the transparent state must be styled before the
        // class is removed, or the transition never runs.
        const r1 = requestAnimationFrame(() => {
          rafs.delete(r1);
          const r2 = requestAnimationFrame(() => {
            rafs.delete(r2);
            step.el.classList.remove("is-developing");
          });
          rafs.add(r2);
        });
        rafs.add(r1);

        // A figure may author its own window (the portrait's develop is a
        // two-beat composition that outruns the default); everything else
        // takes the constant.
        const budget = Number(step.el.dataset.revealMs) || FIGURE_REVEAL_MS;

        const t = setTimeout(() => {
          timers.delete(t);
          stepDone();
        }, budget);
        timers.add(t);
      });
    }

    /* ---- teardown ---- */

    // Registered in the cancels group like a primitive: exit (or
    // re-entry) mid-sequence disconnects the gate, kills pending
    // timers/rAFs, and strips the state classes so the authored DOM is
    // fully visible again. The primitive cancels in the same group
    // restore the text nodes.
    cancels.add(() => {
      disposed = true;
      observer.disconnect();
      for (const t of timers) clearTimeout(t);
      for (const r of rafs) cancelAnimationFrame(r);
      for (const s of steps) s.el.classList.remove("is-pending", "is-developing");
    });
  },

  onExit() {
    cancels.cancelAll();
  },
};