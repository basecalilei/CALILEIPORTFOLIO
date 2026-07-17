/* =============================================================================
   sidebarProjects.js — the "projects" view of the sidebar
   -----------------------------------------------------------------------------
   A content view that lists portfolio projects. Each project entry is a
   data-block (title / date / type) followed by a thumbnail image. The same
   shell as sidebarAbout (title + body), with the project list appended below.

   Project entries are authored inline in this module — same rationale as
   sidebarAbout's body copy: the content is owned by this view, and a flat
   HTML literal is the lightest way to express it. If the project list ever
   needs to come from outside (CMS, fetched JSON, multiple environments), the
   contract changes — `projectsView` becomes a function that takes the list
   and returns the view. Don't pre-build that flexibility; wait for a real
   reason.

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
     ordering: scramble registered first → ticks first each frame;
     hover registered second → ticks after, writing its tints last and
     winning the paint for chars near the cursor. See sidebarAbout.js's
     file header for the full color-write coordination rationale.

     Project entries (data-blocks + thumbnails) are NOT animated by
     either primitive — they appear with the shell's opacity cross-fade.
     If they should animate on entry too, a follow-up iteration can
     scramble each data value, stagger the entries in like sidebarHome's
     wave, attach hover to each data block, or invent something specific
     to the project tiles.

     Re-entry replays from scratch — cancelAll() in onExit stops the
     scramble + hover combo and restores the original DOM synchronously,
     so the next entry starts from a clean state.

   COUPLED WITH
     - sidebarProjectsStyles.css: emits .sidebar-view-projects and inner classes.
     - sidebar.js: imports `projectsView` and includes it in initSidebar.
     - textScramble.js: provides the startScramble primitive (entry).
     - textHoverWave.js: provides the startHoverWave primitive (interaction, layered mode).
     - cancels.js: provides the createCancelGroup helper.
     - projectModal.js: opened from each thumbnail's click handler. The modal
       grows from the clicked thumb (FLIP) and renders the project's expanded
       data block + media stack. This view passes the whole PROJECTS list plus
       the clicked index; the modal's prev/next cycle that list internally and
       import nothing from this module.
     - images/base/thumb/*.webp: the per-project thumbnail assets.
   ========================================================================== */

import { startScramble }     from "./textScramble.js";
import { startHoverWave }    from "./textHoverWave.js";
import { createCancelGroup } from "./cancels.js";
import { openProjectModal }  from "./projectModal.js";

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
// sidebar views (sidebarAbout, sidebarEthos, etc.).
const HOVER_WAVE_RADIUS = 5;

/* -----------------------------------------------------------------------------
   PROJECT DATA
   -----------------------------------------------------------------------------
   Authored as an array of objects. Adding a project is one entry, not a
   copy/paste of HTML.

   Schema:
     title — string, the project's display name
     date  — string, format-free (typically "MM-DD-YY")
     type  — string, the project's discipline/category
     tools — array of strings, joined with ", " in the modal's TOOLS row.
             OK to be a single tool or a dozen; the row wraps. Omit
             entirely if the project doesn't need to list tools.
     note  — string, the project's body/description text. Shown as the
             modal's NOTE row. Wraps freely; can be multiple sentences.
             Omit if the project doesn't need a description.
     thumb — string, path to the sidebar thumbnail (images/base/thumb/*.webp)
     media — string, raw HTML for the modal's media stack (images, videos,
             paragraphs, headings — anything the user wants in any order).
             Authored as a template literal so the HTML is real HTML the
             editor can highlight, not stringified objects. The modal's
             stylesheet applies default sizing to direct children
             (full-width img/video, readable-column p, etc.).

   Only title / date / type / thumb are required; tools / note / media are
   optional. If a project has no media, the modal just shows the title +
   data block with nothing beneath.
   --------------------------------------------------------------------------- */

const PROJECTS = [
  
  {
  title: "MANNEQUIN TECHPACK SYSTEM",
  date:  "05-02-26",
  type:  "TECHNICAL DESIGN",
  tools: ["CLO3D", "Blender", "Illustrator", "Photoshop"],
  note:  "The end-to-end techpack system I built for Noabrands Fusion. Reliable production documentation to run our mannequins through overseas manufacturers in China and Mexico across form, hardware, and finish",
  thumb: "images/projects/noabrandsTechpack/thumb/1thumb.webp",
  media: `
    <h3>FUSION — TECHPACK SYSTEM</h3>
    <p>// The brief: <strong>build the techpack system from zero</strong>
       <br>
       <br>
       > Before I joined, Noabrands Fusion had no techpack system.
       <br>
       <br>
       <strong>I owned the initiative end to end</strong>: the documentation that lets our mannequins actually get built.
       <br>
       <br>
       > <strong>The job</strong>: reliable production documentation to communicate with overseas manufacturers in China and Mexico, and land clean factory runs across every part of the product — form, hardware and finish.
       <br>
       <br>
       > A mannequin isn't just one thing. It's a sculpted form, a set of hardware and bases, a cloth cover and a finish; each with its own process and its own failure points. The system had to hold all of it.
       <br>
       <br>
       > I brought my fashion background working with overseas factories to lead it, and introduced CLO3D digital patterning and cloth simulation to the cloth-covered forms.
       <br>
       <br>
       > It ran on constant back-and-forth; 3D design, engineering, pattern-making, physical sampling. Communicating revisions cleanly between those teams was half the work.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <img src="images/projects/noabrandsTechpack/full/1full.webp" alt="The techpack document system" loading="lazy" decoding="async">
    <p>// <strong>THE TECHPACK</strong>
       <br>
       <br>
       - The core deliverable: a standardized assembly & components document.
       <br>
       - Every form broken down the same way: package overview, forms, photos, spec, base, cloth-cover, finishes, etc.
       <br>
       - One single source-of-truth that the factory can trust, part number to part number.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <img src="images/projects/noabrandsTechpack/full/2full.webp" alt="The form range" loading="lazy" decoding="async">
    <p>// <strong>THE FORMS</strong>
       <br>
       <br>
       - Six cloth-covered mannequins developed for American Eagle Outfitters.
       <br>
       - The technical-illustration language that opens each package before the specs begin.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

       <img src="images/projects/noabrandsTechpack/full/3full.webp" alt="Finished forms on stands" loading="lazy" decoding="async">
    <p>// <strong>REALIZED</strong>
       <br>
       <br>
       - The forms as they ship; canvas-covered torsos on adjustable stands with brass finials.
       <br>
       - Proof the documentation lands; what's drawn in the techpack is what comes off the line.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <img src="images/projects/noabrandsTechpack/full/4full.webp" alt="Hardware and assembly documentation" loading="lazy" decoding="async">
    <p>// <strong>HARDWARE & ASSEMBLY</strong>
       <br>
       <br>
       - <strong>The challenge</strong>: a mannequin carries hardware, not just a shape.
       <br>
       - Foam parts, neck plates, finials, magnet assemblies, injection-molded flanges, bases; every part needed to be documented.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <img src="images/projects/noabrandsTechpack/full/5full.webp" alt="A finished cloth-covered form" loading="lazy" decoding="async">
    <p>// <strong>THE COVER</strong>
       <br>
       <br>
       - A finished cloth-covered form developed for Kith
       <br>
       - Form and cloth often needed to be coupled in one spec.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <img src="images/projects/noabrandsTechpack/full/6full.webp" alt="A finished cloth-covered form" loading="lazy" decoding="async">
    <p>// <strong>THE SPEC</strong>
       <br>
       <br>
       - Cloth covers are documented the same way any soft-good would be; cutting patterns, construction instructions, seam-and-stitch spec, etc.
       <br>
       - The cover was patterned in CLO3D and cloth-simulated before a single physical sample.
       <br>
       - Fewer sampling rounds, tighter fit, a cleaner hand-off to the factory.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <img src="images/projects/noabrandsTechpack/full/7full.webp" alt="The client-facing installation manual system" loading="lazy" decoding="async">
    <p>// <strong>THE INSTALL MANUAL</strong>
       <br>
       <br>
       - The client-facing half of the system: installation manuals per form.
       <br>
       - Safety & care, a visual parts list, and step-by-step magnetic assembly; all 3D-graphics, not photographed.
       <br>
       - Built to cut support tickets and get customers set up right out of the box.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <img src="images/projects/noabrandsTechpack/full/8full.webp" alt="Revision summary format" loading="lazy" decoding="async">
    <p>// <strong>REVISION CONTROL</strong>
       <br>
       <br>
       - Changes had to move cleanly between 3D design, engineering, pattern-making and sampling.
       <br>
       - A revision-summary format was implimented to make sure every team sees the same changes.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <img src="images/projects/noabrandsTechpack/full/9full.webp" alt="Nike Jordan form lineup" loading="lazy" decoding="async">
    <p>// <strong>NIKE JORDAN</strong>
       <br>
       <br>
       - The system at client scale: Fusion Specialties for Nike Jordan.
       <br>
       - A full form lineup, torsos to full bodies, documented end to end and handed to the floor.</p>
  `,
},

{
  title: "FUSION BRAND SYSTEM",
  date:  "04-28-26",
  type:  "BRAND IDENTITY",
  tools: ["Illustrator", "Photoshop", "Blender", "ComfyUI"],
  note:  "A new branding system proposed for Noabrands Fusion; logomark, logotype and the visual identity built to carry them. The word itself drove the concept: the Fusion of humans and technical design. All of it about the people behind the fabrication.",
  thumb: "images/projects/noabrandsBrand/thumb/1thumb.webp",
  media: `
    <h3>FUSION — 2026 BRAND SYSTEM</h3>
    <p>// The brief: <strong>a new identity for Fusion</strong>
       <br>
       <br>
       > I rebuilt the logomark and logotype, and built a visual identity to pair with them.
       <br>
       <br>
       > The word drove the direction. Fusion:
       <br>
       <br>
       - a perfect circle / a flawed circle
       <br>
       - inorganic / organic
       <br>
       - machine / human
       <br>
       <br>
       > That was the whole concept.
       <br>
       <br>
       > Fusion is a fabrication studio where designers use technology to develop products. The fusion, to me, was the coming together of the digital and physical sides of what we did. 3D design in software on one end, hands-on fabrication on the other.
       <br>
       <br>
       > So the system pairs the rigid design language of technical drawings; measurement lines, alignment marks, grids; with blue and red color fields, fades, gradients and organic shapes.
       <br>
       <br>
       > The people behind the fabrication, and the juxtaposition between the technical and the human nature of the work.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <img src="images/projects/noabrandsBrand/full/1full.webp" alt="The logo, before and after" loading="lazy" decoding="async">
    <p>// <strong>THE MARK</strong>
       <br>
       <br>
       - Before and after: the old enclosed monogram, and what replaced it.
       <br>
       - The new mark is an orbit; a hard center held inside softer rings, the machine and the human in one form.
       <br>
       - The logotype was rebuilt alongside it, rounded and evenly weighted.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <img src="images/projects/noabrandsBrand/full/2full.webp" alt="The 2026 branding proposal cover" loading="lazy" decoding="async">
 
    <img src="images/projects/noabrandsBrand/full/3full.webp" alt="Information and human — the two circles" loading="lazy" decoding="async">
    <p>// <strong>THE CONCEPT</strong>
       <br>
       <br>
       - Two circles. One drawn by a machine, one drawn by a hand.
       <br>
       - <strong>INFORMATION</strong> and <strong>HUMAN</strong> ;the perfect circle and the flawed one.
       <br>
       - Every other decision in the system comes out of this page.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <div class="media-grid-2">
      <img src="images/projects/noabrandsBrand/full/4full.webp" alt="The brand guidelines contents" loading="lazy" decoding="async">
      <img src="images/projects/noabrandsBrand/full/5full.webp" alt="The brand direction proposal cover" loading="lazy" decoding="async">
    </div>
 
    <img src="images/projects/noabrandsBrand/full/6full.webp" alt="Logomark construction and spacing" loading="lazy" decoding="async">
 
    <img src="images/projects/noabrandsBrand/full/7full.webp" alt="The blueprint" loading="lazy" decoding="async">
    <p>// <strong>THE TECHNICAL SIDE</strong>
       <br>
       <br>
       - Measurement lines, alignment marks, grids; the mark drawn to rule so it can be broken deliberately everywhere else.
       <br>
       - And on the blueprint, red annotation in someone's handwriting. The technical language, with a person still holding the pen.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <img src="images/projects/noabrandsBrand/full/8full.webp" alt="The logotype over a technical form" loading="lazy" decoding="async">
    <p>// <strong>THE LOGOTYPE</strong>
       <br>
       <br>
       - Rendered soft and dimensional, laid over a dimensioned technical form.
       <br>
       - Blue running to red across the word; the two halves of the studio in one lockup.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <img src="images/projects/noabrandsBrand/full/9full.webp" alt="The logomark rendered" loading="lazy" decoding="async">
 
    <img src="images/projects/noabrandsBrand/full/10full.webp" alt="The mark held by the form" loading="lazy" decoding="async">
    <p>// <strong>MACHINE / HUMAN</strong>
       <br>
       <br>
       - The mannequin holding the mark; jointed arms, articulated hands, cradling a soft red field.
       <br>
       - The clearest statement in the system: the manufactured body, holding the human thing.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <img src="images/projects/noabrandsBrand/full/11full.webp" alt="The people of Fusion" loading="lazy" decoding="async">
    <p>// <strong>THE PEOPLE OF FUSION</strong>
       <br>
       <br>
       - Figures rendered as color and motion, resolved just enough to read as people.
       <br>
       - The line the whole identity hangs on; the people behind the fabrication.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
 
    <div class="media-grid-2">
      <img src="images/projects/noabrandsBrand/full/12full.webp" alt="Who we are" loading="lazy" decoding="async">
      <img src="images/projects/noabrandsBrand/full/13full.webp" alt="What we do" loading="lazy" decoding="async">
    </div>
 
    <img src="images/projects/noabrandsBrand/full/14full.webp" alt="The hand at the end of the process" loading="lazy" decoding="async">
    <p>// <strong>THE HAND</strong>
       <br>
       <br>
       - Where it lands: a sculptor finishing a face by hand.
       <br>
       - Everything upstream is software, spec and grid. It still ends with a person and a tool.</p>
  `,
},

  {
  title: "FUSION × TEAM USA 2026",
  date:  "04-11-26",
  type:  "APPAREL DESIGN",
  tools: ["Blender", "ZBrush", "CLO3D", "Substance Painter"],
  note:  "Marketing creative for Noabrands to launch a collection of six soccer mannequins we produced for Nike, timed to the World Cup. A full Fusion x Nike, Team USA kit spanning apparel, footwear, match balls, bags, and the brand system; a world for the display product to live in.",
  thumb: "images/projects/noabrandsTeamUsa/thumb/1thumb.webp",
  media: `
    <h3>FUSION × NIKE — TEAM USA</h3>
    <p>// The brief: <strong>launch six soccer mannequins</strong>
       <br>
       <br>
       > NOABRANDS builds display — mannequins, fixtures and props — under the FUSION line. The job was to promote a collection of six soccer mannequins we produced for Nike, and to time it to the World Cup.
       <br>
       <br>
       > So I didn't render the mannequins alone. I built the whole team around them: a full Fusion × Nike, Team USA kit, with Fusion sitting front-of-shirt as the sponsor.
       <br>
       <br>
       > One system, three colorways, carried across every asset so the collection reads as a single drop.
       <br>
       <br>
       > Produced end to end:
       <br>
       <br>
       - Assets modeled in Blender, or sculpted in ZBrush
       <br>
       - Apparel patterned and cloth-simulated in CLO3D
       <br>
       - Every material authored in Substance Painter
       <br>
       - Lit and rendered in Blender
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsTeamUsa/full/1full.webp" alt="The match kit" loading="lazy" decoding="async">
    <p>// <strong>THE KIT</strong>
       <br>
       <br>
       - Jersey, shorts and socks across all three colorways.
       <br>
       - Nike, the Team USA crest and Fusion as front-of-shirt sponsor, numbered 10.
       <br>
       - The baseline the rest of the collection is built from.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsTeamUsa/full/2full.webp" alt="The tracksuit" loading="lazy" decoding="async">
    <p>// <strong>THE TRACKSUIT</strong>
       <br>
       <br>
       - Anthem jacket and tapered jogger, three colorways.
       <br>
       - USA across the chest; Fusion and Noabrands marks kept quiet.
       <br>
       - The travel half of the kit; worn to the pitch, not on it.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsTeamUsa/full/3full.webp" alt="The full apparel line on the rack" loading="lazy" decoding="async">
    <p>// <strong>THE LINE</strong>
       <br>
       <br>
       - The full apparel range merchandised as it would hang in-store.
       <br>
       - Jerseys, shorts, jackets and joggers across all three colorways.
       <br>
       - Proof the system holds as one collection, not a set of one-offs.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsTeamUsa/full/4full.webp" alt="The six soccer mannequins in play" loading="lazy" decoding="async">
    <p>// <strong>THE SIX</strong>
       <br>
       <br>
       - The actual product: the six soccer mannequins, posed mid-play.
       <br>
       <br>
       - Everything else in this project exists to sell these.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsTeamUsa/full/5full.webp" alt="The boot, three colorways" loading="lazy" decoding="async">
    <p>// <strong>THE BOOT</strong>
       <br>
       <br>
       - A firm-ground boot in the three team colorways.
       <br>
       - Nike swoosh, USA and 10 detailing carried onto the heel.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsTeamUsa/full/6full.webp" alt="The boot, full turnaround" loading="lazy" decoding="async">
    <p>// <strong>THE BOOT — 360</strong>
       <br>
       <br>
       - The same boot read from every angle: profile, heel, top and front.
       <br>
       - A last material and stitch check before it goes on a mannequin.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsTeamUsa/full/7full.webp" alt="The footwear packaging" loading="lazy" decoding="async">
    <p>// <strong>THE BOX</strong>
       <br>
       <br>
       - Nike × Fusion × USA footwear packaging, colorway-coded to the boot inside.
       <br>
       - Full retail treatment: size tab, spec label, etc.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsTeamUsa/full/8full.webp" alt="The match ball, boxed and loose" loading="lazy" decoding="async">
    <p>// <strong>THE BALL</strong>
       <br>
       <br>
       - The match ball, shown boxed and loose across four colorways.
       <br>
       - Team USA, Fusion and Noabrands graphics wrapped to the panel seams.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsTeamUsa/full/9full.webp" alt="The backpack" loading="lazy" decoding="async">
    <p>// <strong>THE PACK</strong>
       <br>
       <br>
       - A team backpack, three colorways, with a ball cradled in the base.
       <br>
       - USA at the crown; Fusion and the crest on the front pocket.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsTeamUsa/full/10full.webp" alt="The duffel" loading="lazy" decoding="async">
    <p>// <strong>THE DUFFEL</strong>
       <br>
       <br>
       - The Fusion team duffel, two angles each across the three colorways.
       <br>
       - Big front-panel Fusion lockup; USA and 10 on the end caps.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsTeamUsa/full/11full.webp" alt="The ball bag" loading="lazy" decoding="async">
    <p>// <strong>THE BALL BAG</strong>
       <br>
       <br>
       - Mesh carry loaded with the full ball set.
       <br>
       - Fusion webbing on the strap; the whole colorway story in one shot.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsTeamUsa/full/12full.webp" alt="The mannequin heads" loading="lazy" decoding="async">
    <p>// <strong>THE HEADS</strong>
       <br>
       <br>
       - Back to the core product: the mannequin head in a range of tones and finishes.
       <br>
       - A flocked, matte surface with a subtle two-tone split and USA mark.
       <br>
       - The display hardware Fusion actually sells, dressed into the team.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsTeamUsa/full/13full.webp" alt="The caps" loading="lazy" decoding="async">
    <p>// <strong>THE CAP</strong>
       <br>
       <br>
       - Patch-front caps, one per colorway.
       <br>
       - USA, the Fusion lockup and the atom motif, rotated across the three.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsTeamUsa/full/14full.webp" alt="The Fusion brand system on flags" loading="lazy" decoding="async">
    <p>// <strong>THE FLAGS</strong>
       <br>
       <br>
       - The Fusion identity flown out: monogram, full lockup, the Fusion × USA mark and a repeat pattern.
       <br>
       - The kit-of-parts every other asset pulls from.</p>
  `,
 },

  {
  title: "THE MATCHUP",
  date:  "03-08-26",
  type:  "3D DESIGN",
  tools: ["Blender", "ZBrush", "Substance Painter", "Unreal Engine", "Houdini"],
  note:  "During my round-one interview with Noabrands, I was asked to return for round-two prepared to showcase skill in anatomy. I created a collections of mannequins, and presented them through a basketball story staged as a showroom. This project was designed to showcase my experience with designing the human form, pose authoring, and a wider range of 3D design.",
  thumb: "images/projects/noabrandsMatchup/thumb/1thumb.webp",
  media: `
    <h3>NOA_RND02 — THE MATCHUP</h3>
    <p>// The brief for round two: <strong>Anatomy and 3D Design</strong>
       <br>
       <br>
       > NOABRANDS is the largest global mannequin supplier. Mannequins, fixtures, props and displays for fashion and retail. So I built the thing they actually make: a showroom.
       <br>
       <br>
       > The concept is a basketball story. Two teams: the <strong>Anchorage Polarbears</strong>, a squad of misfits and underdogs, against the undefeated <strong>Chicago Titans</strong>.
       <br>
       <br>
       > The anatomy carries the story. 
       <br>
       <br>
       - The Polarbears: designed with relatable, realistic human proportions.
       <br>
       - The Titans: outrageously stylized forms designed to read as intimidating and powerful.
       <br>
       <br>
       > Produced end to end:
       <br>
       <br>
       - Environment, props, and mannequins modeled in Blender or sculpted in ZBrush
       <br>
       - Materials authored in Substance Painter
       <br>
       - Everything staged with custom shaders in Unreal Engine
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsMatchup/full/1full.webp" alt="Anchorage Polarbears" loading="lazy" decoding="async">
    <p>// <strong>THE ANCHORAGE POLARBEARS</strong>
       <br>
       <br>
       - The underdogs, the protagonists.
       <br>
       - Relatable, realistic human proportions; athletes you could stand next to.
       <br>
       - Posed mid-play to carry believable weight and range of motion.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsMatchup/full/2full.webp" alt="The monument" loading="lazy" decoding="async">
    <p>// <strong>THE MONUMENT</strong>
       <br>
       <br>
       - A cast display monument for the Anchorage side of the hall.
       <br>
       - Sculpted in ZBrush; weathered finish authored in Substance Painter.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsMatchup/full/3full.webp" alt="Chicago Titans" loading="lazy" decoding="async">
    <p>// <strong>THE CHICAGO TITANS</strong>
       <br>
       <br>
       - The undefeated antagonists.
       <br>
       - Oversized mass and height, exaggerated shoulder-to-waist ratio.
       <br>
       - Anatomy tuned to read as a threat.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsMatchup/full/4full.webp" alt="The hall" loading="lazy" decoding="async">
    <p>// <strong>THE HALL</strong>
       <br>
       <br>
       - The whole world in one frame: mascot, player, monument, championship trophy.
       <br>
       - The retail-display language Noabrands actually fabricates.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsMatchup/full/5full.webp" alt="The dunk" loading="lazy" decoding="async">
    <p>// <strong>THE DUNK</strong>
       <br>
       <br>
       - A single player at the apex of a jump.
       <br>
       - Pose authored to hold tension head to toe.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsMatchup/full/6full.webp" alt="The glazed bear" loading="lazy" decoding="async">
    <p>// <strong>THE GLAZED BEAR</strong>
       <br>
       <br>
       - A seated bear in a cracked ceramic glaze; a material study in Substance Painter.
       <br>
       - Backlit through the cage mesh to catch the crackle.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsMatchup/full/7full.webp" alt="The floor" loading="lazy" decoding="async">
    <p>// <strong>THE FLOOR</strong>
       <br>
       <br>
       - The wider set: statues, plinths, trophies and figures staged like a showroom.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <video src="images/projects/noabrandsMatchup/full/8full.mp4" autoplay muted loop playsinline loading="lazy"></video>
    <p>// <strong>UNREAL ENGINE WALKTHROUGH</strong>
       <br>
       <br>
       - Walkthrough of the environment: UE5 3rd person blueprint.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsMatchup/full/9full.webp" alt="The forms" loading="lazy" decoding="async">

    <h3>TECHNICAL — THE MANNEQUIN SYSTEM</h3>
    <p>// The figures aren't one-off sculpts. They're a reusable, riggable mannequin asset built on a low-poly subdivision workflow.
       <br>
       <br>
       > <strong>The goal:</strong> clean edgeflow for subdivision, with topology laid out to accommodate the muscle groups, so anatomical definition stays crisp after subdividing, held by edge creasing rather than by raw density.
       <br>
       <br>
       > Same discipline from the large forms down to the details; muscle masses, fingernails and toenails all resolve cleanly through edge creasing and subdivision.
       <br>
       <br>
       > <strong>The payoff:</strong> one asset, many poses. Pose direction can be iterated rapidly without hand-sculpting anatomy into a high-poly mesh in ZBrush each time.
       <br>
       <br>
       > Deformation was designed in, not patched after. Topology placed to optimize for both anatomical definition and clean bending.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsMatchup/full/10full.webp" alt="Base mesh topology" loading="lazy" decoding="async">
    <p>// <strong>EDGEFLOW</strong>
       <br>
       <br>
       - The A-pose base mesh topology. Creased edges shown in red.
       <br>
       - Loops routed to follow the muscle groups so subdivision reinforces the anatomy instead of softening it.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsMatchup/full/11full.webp" alt="Subdivided mesh" loading="lazy" decoding="async">
    <p>// <strong>SUBDIVISION</strong>
       <br>
       <br>
       - The cage after subdivision.
       <br>
       - Creasing holds crisp definition through the smooth; no added manual sculpting.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsMatchup/full/12full.webp" alt="Hand topology" loading="lazy" decoding="async">
    <p>// <strong>THE HAND</strong>
       <br>
       <br>
       - Clean quad flow through the knuckles and the nail beds.
       <br>
       - Built to deform through a full range of grip without pinching.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsMatchup/full/13full.gif" alt="Nail and form detail" loading="lazy" decoding="async">
    <p>// <strong>THE DETAILS</strong>
       <br>
       <br>
       - Fingernail and toenail detail; which is important to Noabrands, was modeled into the flow, not floated on top.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <video src="images/projects/noabrandsMatchup/full/14full.mp4" autoplay muted loop playsinline loading="lazy"></video>
       <p>// <strong>POSE PIPELINE</strong>
       <br>
       <br>
       - Forms modeled in an A-pose, then rigged with volume preservation and controllers.
       <br>
       - Dynamic posed authored in Blender against reference, with a focus on balance. 
       <br>
       - A final shape key polishes the pose and corrects anatomical errors introduced by the rig constraints.
       <br>
       - Shown here: A-pose → posed → shape-key applied.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

       <img src="images/projects/noabrandsMatchup/full/15full.webp" alt="Panelized mannequin set" loading="lazy" decoding="async">

       <h3>BONUS — THE PANELIZATION HDA</h3>
    <p>// A side tool that outgrew the brief.
       <br>
       <br>
       > I built a Houdini HDA with custom solvers based on the panelization method in Jadon, Thomaszewski, Apolinarska & Poranne's <strong>"Continuous deformation based panelization for design rationalization"</strong> (SIGGRAPH Asia 2022).
       </p>

       <a class="pdf-card"
       href="assets/docs/discrete_panelization.pdf"
       data-pdf-src="assets/docs/discrete_panelization.pdf"
       data-pdf-title="CONTINUOUS DEFORMATION BASED PANELIZATION"
       data-pdf-meta="Jadon, Thomaszewski, Apolinarska & Poranne — SIGGRAPH Asia 2022">
      <span class="pdf-card-kicker">DOCUMENT — PDF</span>
      <span class="pdf-card-title">Continuous deformation based panelization for design rationalization</span>
      <span class="pdf-card-meta">The research the HDA's solvers are built on.</span>
      <span class="pdf-card-open">OPEN READER</span>
      </a>

       <p>
       > The paper reformulates panelization as a smooth deformation: the mesh is nudged until adjacent faces settle into shared flat panels, so faceting emerges from the geometry instead of being hand-cut.
       <br>
       <br>
       > I used it as a procedural stylization pass — feed in a clean anatomical mesh, get back a faceted, low-poly form with controllable panel density.
       <br>
       <br>
       > It didn't make the final environment, but it became a genuinely powerful, reusable HDA: research turned into a production tool.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

    <img src="images/projects/noabrandsMatchup/full/16full.webp" alt="Panelized dribble pose" loading="lazy" decoding="async">
    <p>// <strong>ONE PASS, ONE FIGURE</strong>
       <br>
       <br>
       - A single dribble pose, stylized.
       <br>
       - Flat panels emerge across the muscle forms
       <br>
       - The anatomy still reads through the facets.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>

       <h3>TURNAROUNDS — THE FACETED SET</h3>

    <div class="media-grid-2">
      <video src="images/projects/noabrandsMatchup/full/18full.mp4" autoplay muted loop playsinline></video>
      <video src="images/projects/noabrandsMatchup/full/19full.mp4" autoplay muted loop playsinline></video>
      <video src="images/projects/noabrandsMatchup/full/20full.mp4" autoplay muted loop playsinline></video>
      <video src="images/projects/noabrandsMatchup/full/21full.mp4" autoplay muted loop playsinline></video>
      <video src="images/projects/noabrandsMatchup/full/22full.mp4" autoplay muted loop playsinline></video>
      <video src="images/projects/noabrandsMatchup/full/23full.mp4" autoplay muted loop playsinline></video>
      <video src="images/projects/noabrandsMatchup/full/24full.mp4" autoplay muted loop playsinline></video>
      <video src="images/projects/noabrandsMatchup/full/25full.mp4" autoplay muted loop playsinline></video>
      <video src="images/projects/noabrandsMatchup/full/26full.mp4" autoplay muted loop playsinline></video>
      <video src="images/projects/noabrandsMatchup/full/27full.mp4" autoplay muted loop playsinline></video>
      <video src="images/projects/noabrandsMatchup/full/28full.mp4" autoplay muted loop playsinline></video>
      <video src="images/projects/noabrandsMatchup/full/29full.mp4" autoplay muted loop playsinline></video>
      <video src="images/projects/noabrandsMatchup/full/30full.mp4" autoplay muted loop playsinline></video>
    </div>
  `,
},


  {
  title: "NIKE TRAINING: SPEED",
  date:  "03-01-26",
  type:  "APPAREL DESIGN",
  tools: ["ZBrush", "CLO3D", "Substance Painter", "Blender"],
  note:  "Eight looks that I designed and patterned to present during my round two interview for an apparel designer roll at Nike Training.",
  thumb: "images/projects/nikeTrainingSpeed/thumb/1thumb.webp",
  media: `
    <h3>NK_TR_RND02 — SPEED</h3>
    <p>//  The brief I gave myself was one word: <strong>Speed</strong>
       <br>
       <br> 
       > I read it less as aerodynamics than as a dialogue between lockdown and release: compression where the body wants support, volume where it wants range and air.
       <br>
       <br>
       > All eight looks sit at different points on that single axis.
       <br>
       <br>
       > From second-skin catsuits and seamed leggings to barrel-leg sweats and wide cropped volumes.
       <br>
       <br>
       > Everything is held together by a monochrome grey system so cut, proportion and texture carry the collection instead of color.
       <br>
       <br>
       > Cropped hems keep the waist free so nothing catches; ribbed cuffs and collars lock the wrists, ankles and neck so the loose middle never reads sloppy.
       <br>
       <br>
       > Produced end to end as digital collection, every piece is a real drafted-and-simulated pattern: 
       <br>
       <br>
       - The mannequin sculpted in ZBrush to a specific training body
       <br>
       - Patterns drafted and cloth-simulated in CLO3D
       <br>
       - Materials authored in Substance Painter
       <br>
       - Lit and rendered in Blender. 
       <br>
       <br>
      > Each look is shown with its technical flat (zeroForm) and its flattened pattern nest
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
    </p>

    <img src="images/projects/nikeTrainingSpeed/full/1full.webp" alt="Look 01" loading="lazy" decoding="async">
    <p>// <strong>LOOK.01</strong>
       <br>
       <br>
       - Raglan crew in mixed knit over seamed compression leggings. 
       <br>
       - The baseline: locked lower half, structured shoulder. 
       <br>
       - A standing collar to frame it. 
       <br>
       - Reads calm, still built to move.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
       </p>

    <img src="images/projects/nikeTrainingSpeed/full/2full.webp" alt="Look 02" loading="lazy" decoding="async">
    <p>// <strong>LOOK.02</strong>
       <br>
       <br>
       - Sleeveless racer crop and a slim cuffed jogger.
       <br>
       - Paneling maps to the body.
       <br>
       - Cropped hem keeps the core open.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
       </p>

    <img src="images/projects/nikeTrainingSpeed/full/3full.webp" alt="Look 03" loading="lazy" decoding="async">
    <p>// <strong>LOOK.03</strong>
       <br>
       <br>
       - Mock-neck crop with a contrast tech shoulder
       <br>
       - Balloon barrel-leg sweats.
       <br>
       - Lockdown up top, maximum air below.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
       </p>

    <img src="images/projects/nikeTrainingSpeed/full/4full.webp" alt="Look 04" loading="lazy" decoding="async">
    <p>// <strong>LOOK.04</strong>
       <br>
       <br>
       - High-neck ribbed racer over a tapered cargo jogger. 
       <br>
       - The utility register: cinched ankle, working pockets.
       <br>
       - Cropped and quick.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
       </p>

    <img src="images/projects/nikeTrainingSpeed/full/5full.webp" alt="Look 05" loading="lazy" decoding="async">
    <p>// <strong>LOOK.05</strong>
       <br>
       <br>
       - Cropped raglan sweatshirt over loose heavyweight sweats.
       <br>
       - Curved cut legs with cinching drawstring on the outside create dynamic stacking.
       <br>
       - Darts placed to hold volume without bulk.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
       </p>

    <img src="images/projects/nikeTrainingSpeed/full/6full.webp" alt="Look 06" loading="lazy" decoding="async">
    <p>// <strong>LOOK.06</strong>
       <br>
       <br>
       - Sleeveless hooded crop and wide, flared sweats.
       <br> 
       - Structured three-piece hood.
       <br>
       - Shown mid-movement, which is the whole point.</p>

    <img src="images/projects/nikeTrainingSpeed/full/7full.webp" alt="Look 07" loading="lazy" decoding="async">
    <p>// <strong>LOOK.07</strong>
       <br>
       <br>
       - Ribbed quarter-zip catsuit with waist cutouts. 
       <br>
       - One continuous pattern, second skin
       <br> 
       - The cutouts do cooling and line at once
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
       </p>

    <img src="images/projects/nikeTrainingSpeed/full/8full.webp" alt="Look 08" loading="lazy" decoding="async">
    <p>// <strong>LOOK.08</strong>
       <br>
       <br>
       - Hooded shrug-yoke layered over a zip-front romper. 
       <br>
       - The most constructed piece in the line-up.
       <br>
       - A structural overlayer that reads like a harness,
       closing the range the collection opened.
       <br>
       <br>
       --------------------------------------
       <br>
       </p>
       </p>
  `,
},


  
  
 


];

/* -----------------------------------------------------------------------------
   ENTRY MARKUP
   -----------------------------------------------------------------------------
   One project = one .sidebar-projects-entry containing the data-block and
   the thumbnail. The data-block uses a 1-cell row (TITLE spans full width)
   followed by a 2-cell row (DATE | TYPE). Borders between cells are emitted
   by CSS via :nth-of-type / adjacency selectors — the HTML stays flat.

   Tags inside values are escaped only by the fact that PROJECTS values are
   all author-controlled string literals here; if values ever come from
   user input, escape them before interpolation.
   --------------------------------------------------------------------------- */

function entryMarkup(p, i) {
  return `
    <article class="sidebar-projects-entry">
      <div class="sidebar-projects-data">
        <div class="sidebar-projects-data-row sidebar-projects-data-row-full">
          <div class="sidebar-projects-data-cell">
            <span class="sidebar-projects-data-label">TITLE</span>
            <span class="sidebar-projects-data-value">${p.title}</span>
          </div>
        </div>
        <div class="sidebar-projects-data-row sidebar-projects-data-row-split">
          <div class="sidebar-projects-data-cell">
            <span class="sidebar-projects-data-label">DATE</span>
            <span class="sidebar-projects-data-value">${p.date}</span>
          </div>
          <div class="sidebar-projects-data-cell">
            <span class="sidebar-projects-data-label">TYPE</span>
            <span class="sidebar-projects-data-value">${p.type}</span>
          </div>
        </div>
      </div>
      <img
        class="sidebar-projects-thumb"
        src="${p.thumb}"
        alt="${p.title}"
        data-project-index="${i}"
        loading="lazy"
        decoding="async"
      />
    </article>
  `;
}

/* -----------------------------------------------------------------------------
   THE VIEW
   --------------------------------------------------------------------------- */

export const projectsView = {
  name: "projects",

  buildDOM(nav) {
    const el = document.createElement("div");
    el.className = "sidebar-view-projects";
    el.innerHTML = `
      <h2 class="sidebar-projects-title">Project</h2>
      <div class="sidebar-projects-body">
        <p>
          > My recent work indexed as project sheets.
          <br> 
          <br>
          - Click a thumbnail to learn more about each project.
        </p>
      </div>
      <div class="sidebar-projects-list">
        ${PROJECTS.map((p, i) => entryMarkup(p, i)).join("")}
      </div>
    `;

    // Click delegation for thumbnails: open the project modal at the
    // clicked entry, passing the WHOLE list (so the modal's prev/next can
    // cycle without importing this module), the index, and the clicked
    // thumb as the FLIP origin. Only the thumb is a click target (it has
    // cursor: pointer); the data block above is selectable text,
    // intentionally not clickable.
    el.addEventListener("click", (e) => {
      const thumb = e.target.closest("[data-project-index]");
      if (!thumb) return;
      const idx = +thumb.dataset.projectIndex;
      if (PROJECTS[idx]) openProjectModal(PROJECTS, idx, thumb);
    });

    return el;
  },

  onEnter(el) {
    cancels.cancelAll();
    const title = el.querySelector(".sidebar-projects-title");
    const body  = el.querySelector(".sidebar-projects-body");

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