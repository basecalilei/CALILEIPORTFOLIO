/* =============================================================================
   main.js — the ENTRY POINT (composition root)
   -----------------------------------------------------------------------------
   This file is the only thing index.html loads. Its job is to compose the
   app: import the panel-type and scene-type modules (each is a side-effect
   import that registers itself with the relevant registry), author the
   PANELS array, and start the system.

   START-UP ORDER (matters):
     1. Side-effect imports register all panel and scene types into their
        registries. (Order of imports doesn't matter — registries are
        order-independent.)
     2. start(PANELS) builds the spacers and overlays in the DOM, then kicks
        off the per-frame loop. Once this returns, every overlay element
        exists and can be found via its data-index.
     3. bootstrapScenes(PANELS) creates the canvas and the renderer, walks
        PANELS looking for entries that declared a scene, runs each scene's
        factory once to build its scene graph, and registers a per-frame
        hook with the core. From the next frame onward, scenes update and
        render as part of the main loop.

   Why start() comes before bootstrapScenes(): scenes that anchor to a
   panel's overlay need the overlay element to exist in the DOM first. The
   core builds overlays; the scene system finds them by query. Keeping this
   order explicit (rather than auto-wiring it inside one of the modules)
   preserves the rule that the core doesn't know about scenes — main.js
   composes the two layers, neither layer references the other.

   ADD A PANEL TYPE later:
     1. Build the module (e.g. levitatePanel.js) that calls registerPanelType.
     2. Import it here for the side effect.
     3. Use { type: "levitate", ... } entries in PANELS.

   ADD A SCENE TYPE later:
     1. Build the module that calls registerSceneType.
     2. Import it here for the side effect.
     3. Add `scene: "name"` (or { type: "name", ...opts }) to any PANELS
        entry that should host it.

   REMOVE A TYPE: delete its import + delete any PANELS entries that use it.
   ========================================================================== */

// Panel type modules. Each one self-registers on import.

import "./cursor.js";
import { initMusicPlayer } from "./musicPlayer.js";
import "./turnPanel.js";
import "./dotsPanel.js";
import "./wallPanel.js";
import "./hudPanel.js";
//import "./gamePanel.js";
import "./desktopPanel.js";
import "./desktopImage.js";
import "./desktopNote.js";
import "./desktopAudio.js";
import "./desktopVideo.js";
import "./desktopMd.js";

import "./pdfModal.js";

// Scene type modules. Each one self-registers on import.
import "./turnScene.js";
import "./dotsScene.js";

// Sidebar modules. Each one self-registers on import.

import { initSidebar } from "./sidebar.js";
import { homeView }    from "./sidebarHome.js";
import { aboutView }   from "./sidebarAbout.js";
import { projectsView } from "./sidebarProjects.js";
import { ethosView } from "./sidebarEthos.js";
import { processView } from "./sidebarProcess.js";
import { shopView }    from "./sidebarShop.js";
import { contactView } from "./sidebarContact.js";

import { initScrollIndicator } from "./scrollIndicator.js";

// The core and the scene system.
import { start } from "./infiniteScroll.js";
import { bootstrapScenes } from "./threeArray.js";

/* -----------------------------------------------------------------------------
   PANELS — the single source of truth for what panels exist, in order.
   --------------------------------------------------------------------------- */
const PANELS = [
  {
    type: "dots",
    scene: { type: "dots", fullscreen: true },
    svg: {
      url: "assets/Calilei.svg",
      widthFraction: 0.20,
      position: { x: 0, y: 0, z: 8 },
    },
    html: `
  <p class="dots-kicker">HELLO.WORLD</p>
  <div class="dots-static">
    <h1 class="dots-title">WELCOME</h1>
    <p class="dots-body">> THANK YOU<br>> FOR BEING HERE</p>
    <p class="dots-nameplate"><br>| CAL.CALILEI<br>| DESIGNER<br>| DENVER, CO</p>
  </div>
  <p class="dots-meta">LOCAL // <span class="dots-time">--:--:--</span></p>
  <p class="dots-meta">[SESSION]&nbsp;&nbsp;0x<span class="dots-session">----</span></p>
`,
  },


  {
    type: "turn",
    scene: { type: "turn", fullscreen: true },
    file: "assets/models/baseLogoMark.glb",
    modelScale: 0.7, 
    enter: "grow",
    exit:  "both",
    html: `
  <p class="turn-kicker">PORTFOLIO ENTRY / 01</p>
  <div class="turn-static">
    <h1 class="turn-title">BASE</h1>
    <p class="turn-body">> ROOTED IN SOIL<br>> AIMED FOR THE STARS</p>
  </div>
  <div class="turn-controls">
    <button class="turn-btn turn-btn--ghost turn-btn--minor" data-action="info">OPEN INFO</button>
    <button class="turn-btn turn-btn--ghost turn-btn--major" data-action="grid">[ VIEW.GRID ]</button>
  </div>`,
    infoHtml: `
      <div class="turn-info-layout">
      <div class="turn-info-main">
      <p class="turn-info-kicker">PORTFOLIO ENTRY / 01</p>
      <h2 class="turn-info-heading">BASE</h2>
      <dl class="turn-info-spec">
        <dt class="turn-info-spec-label">Year</dt>
        <dd class="turn-info-spec-value">2025 &mdash; 2026</dd>
        <dt class="turn-info-spec-label">Role</dt>
        <dd class="turn-info-spec-value">Solo / Founder / Designer</dd>
        <dt class="turn-info-spec-label">Scope</dt>
        <dd class="turn-info-spec-value">Identity / Product / Sampling / Production / Campaign</dd>
        <dt class="turn-info-spec-label">Stack</dt>
        <dd class="turn-info-spec-value">Visual Identity / CLO3D / Physical Sampling / Overseas Manufacturing</dd>
        <dt class="turn-info-spec-label">Status</dt>
        <dd class="turn-info-spec-value">Closed &mdash; 2026</dd>
      </dl>
      <div class="turn-info-text">
        <p class="turn-info-line"><strong>BASE was an elevated essentials clothing label</strong>: built to be worn, and to still make sense in ten years.</p>
        <p class="turn-info-line">I developed it solo from early 2025 to early 2026: identity, product, samples, campaign, and bulk production, end to end.</p>

        <hr class="turn-info-rule">

        <p class="turn-info-line">The design problem was how to make a garment feel like the future without dressing it as one.</p>
        <p class="turn-info-line">Futurism in apparel usually arrives as costume; a graphic, a gimmick, a material that photographs well and wears badly.</p>
        <p class="turn-info-line">BASE put it in the construction instead.</p>
        <p class="turn-info-line">The interest lived in silhouette and paneling: where a seam breaks, how a sleeve is set, what shape the garment holds when nobody is in it.</p>

        <hr class="turn-info-rule">

        <p class="turn-info-line"><strong>The references all shared that logic.</strong></p>
        <p class="turn-info-item">Military flight gear and the suits of the NASA Shuttle program are paneled the way they are because a body has to move, seal, and survive inside them.</p>
        <p class="turn-info-item">The Nike Mag is an object drawn for a future that didn't exist yet, and then actually built.</p>
        <p class="turn-info-item">The YZY &times; Gap Round Jacket strips away everything a jacket is assumed to need until silhouette is the only thing left doing any work.</p>
        <p class="turn-info-line">Four answers, one method: the future gets in through the construction.</p>

        <hr class="turn-info-rule">

        <p class="turn-info-line"><strong>Working alone kept the loop tight.</strong></p>
        <p class="turn-info-line">I designed garments in CLO3D, so a paneling idea could be cut, draped, and judged on a body before a yard of fabric was touched; what survived that became a physical sample.</p>
        <p class="turn-info-line">What survived the sample got specced and sent out. I ran correspondence with the overseas manufacturers directly, through techpacks, revisions, and the bulk runs.</p>
        <p class="turn-info-line">The person who drew the panel lines was the same person who sewed it, shot it, and communicated it to the factory.</p>
        <p class="turn-info-line">Nothing was lost in the handoff, because there was no handoff.</p>

        <hr class="turn-info-rule">

        <p class="turn-info-line"><strong>I closed BASE in early 2026 and went to work inside the industry.</strong></p>
        <p class="turn-info-line">Running every function of a brand alone showed me the shape of the whole thing, and it showed me precisely where my own craft ran thin.</p>
        <p class="turn-info-line">I decided to spend the next stretch of my career sharpening my skills against harder problems and higher standards, rather than to keep running a company that had already taught me what I came to learn.</p>
      </div>
      </div>
      <aside class="turn-info-media">
      <div class="turn-info-media-scroll">
        <figure class="turn-info-media-item">
          <img src="images/base/full/90full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[BSE].#090</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/base/full/83full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[BSE].#083</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/base/full/87full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[BSE].#087</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/base/full/86full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[BSE].#086</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/base/full/88full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[BSE].#088</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/base/full/119full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[BSE].#119</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/base/full/2full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[BSE].#002</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/base/full/144full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[BSE].#144</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/base/full/106full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[BSE].#106</figcaption>
        </figure>
      </div>
      </aside>
      </div>`,
    // ----- gridImages: the image set for this panel's "View Grid" button --
    // Each entry is { src, full, caption }:
    //   src     — thumbnail shown in the grid (~400px on short edge)
    //   full    — full-resolution version shown in the per-image detail
    //             modal. Optional; falls back to src if absent.
    //   caption — HTML for the detail modal's caption area. Use <h2> for
    //             the title, <p> for body copy, <a> for links.
    // The grid hashes (wx, wy) world coordinates to entries, so the same
    // image always appears at the same cell regardless of drag path. No
    // configuration is needed for placement — just author entries.
    gridImages: [
      
      { src: "images/base/thumb/1thumb.webp", full: "images/base/full/1full.webp", caption: `<h2>//img.[BSE].#001</h2><p></p>` },
      { src: "images/base/thumb/2thumb.webp", full: "images/base/full/2full.webp", caption: `<h2>//img.[BSE].#002</h2><p></p>` },
      { src: "images/base/thumb/3thumb.webp", full: "images/base/full/3full.webp", caption: `<h2>//img.[BSE].#003</h2><p></p>` },
      { src: "images/base/thumb/4thumb.webp", full: "images/base/full/4full.webp", caption: `<h2>//img.[BSE].#004</h2><p></p>` },
      { src: "images/base/thumb/5thumb.webp", full: "images/base/full/5full.webp", caption: `<h2>//img.[BSE].#005</h2><p></p>` },
      { src: "images/base/thumb/6thumb.webp", full: "images/base/full/6full.webp", caption: `<h2>//img.[BSE].#006</h2><p></p>` },
      { src: "images/base/thumb/7thumb.webp", full: "images/base/full/7full.webp", caption: `<h2>//img.[BSE].#007</h2><p></p>` },
      { src: "images/base/thumb/8thumb.webp", full: "images/base/full/8full.webp", caption: `<h2>//img.[BSE].#008</h2><p></p>` },
      { src: "images/base/thumb/9thumb.webp", full: "images/base/full/9full.webp", caption: `<h2>//img.[BSE].#009</h2><p></p>` },
      { src: "images/base/thumb/10thumb.webp", full: "images/base/full/10full.webp", caption: `<h2>//img.[BSE].#010</h2><p></p>` },
      { src: "images/base/thumb/11thumb.webp", full: "images/base/full/11full.webp", caption: `<h2>//img.[BSE].#011</h2><p></p>` },
      { src: "images/base/thumb/12thumb.webp", full: "images/base/full/12full.webp", caption: `<h2>//img.[BSE].#012</h2><p></p>` },
      { src: "images/base/thumb/13thumb.webp", full: "images/base/full/13full.webp", caption: `<h2>//img.[BSE].#013</h2><p></p>` },
      { src: "images/base/thumb/14thumb.webp", full: "images/base/full/14full.webp", caption: `<h2>//img.[BSE].#014</h2><p></p>` },
      { src: "images/base/thumb/15thumb.webp", full: "images/base/full/15full.webp", caption: `<h2>//img.[BSE].#015</h2><p></p>` },
      { src: "images/base/thumb/16thumb.webp", full: "images/base/full/16full.webp", caption: `<h2>//img.[BSE].#016</h2><p></p>` },
      { src: "images/base/thumb/17thumb.webp", full: "images/base/full/17full.webp", caption: `<h2>//img.[BSE].#017</h2><p></p>` },
      { src: "images/base/thumb/18thumb.webp", full: "images/base/full/18full.webp", caption: `<h2>//img.[BSE].#018</h2><p></p>` },
      { src: "images/base/thumb/19thumb.webp", full: "images/base/full/19full.webp", caption: `<h2>//img.[BSE].#019</h2><p></p>` },
      { src: "images/base/thumb/20thumb.webp", full: "images/base/full/20full.webp", caption: `<h2>//img.[BSE].#020</h2><p></p>` },
      { src: "images/base/thumb/21thumb.webp", full: "images/base/full/21full.webp", caption: `<h2>//img.[BSE].#021</h2><p></p>` },
      { src: "images/base/thumb/22thumb.webp", full: "images/base/full/22full.webp", caption: `<h2>//img.[BSE].#022</h2><p></p>` },
      { src: "images/base/thumb/23thumb.webp", full: "images/base/full/23full.webp", caption: `<h2>//img.[BSE].#023</h2><p></p>` },
      { src: "images/base/thumb/24thumb.webp", full: "images/base/full/24full.webp", caption: `<h2>//img.[BSE].#024</h2><p></p>` },
      { src: "images/base/thumb/25thumb.webp", full: "images/base/full/25full.webp", caption: `<h2>//img.[BSE].#025</h2><p></p>` },
      { src: "images/base/thumb/26thumb.webp", full: "images/base/full/26full.webp", caption: `<h2>//img.[BSE].#026</h2><p></p>` },
      { src: "images/base/thumb/27thumb.webp", full: "images/base/full/27full.webp", caption: `<h2>//img.[BSE].#027</h2><p></p>` },
      { src: "images/base/thumb/28thumb.webp", full: "images/base/full/28full.webp", caption: `<h2>//img.[BSE].#028</h2><p></p>` },
      { src: "images/base/thumb/29thumb.webp", full: "images/base/full/29full.webp", caption: `<h2>//img.[BSE].#029</h2><p></p>` },
      { src: "images/base/thumb/30thumb.webp", full: "images/base/full/30full.webp", caption: `<h2>//img.[BSE].#030</h2><p></p>` },
      { src: "images/base/thumb/31thumb.webp", full: "images/base/full/31full.webp", caption: `<h2>//img.[BSE].#031</h2><p></p>` },
      { src: "images/base/thumb/32thumb.webp", full: "images/base/full/32full.webp", caption: `<h2>//img.[BSE].#032</h2><p></p>` },
      { src: "images/base/thumb/33thumb.webp", full: "images/base/full/33full.webp", caption: `<h2>//img.[BSE].#033</h2><p></p>` },
      { src: "images/base/thumb/34thumb.webp", full: "images/base/full/34full.webp", caption: `<h2>//img.[BSE].#034</h2><p></p>` },
      { src: "images/base/thumb/35thumb.webp", full: "images/base/full/35full.webp", caption: `<h2>//img.[BSE].#035</h2><p></p>` },
      { src: "images/base/thumb/36thumb.webp", full: "images/base/full/36full.webp", caption: `<h2>//img.[BSE].#036</h2><p></p>` },
      { src: "images/base/thumb/37thumb.webp", full: "images/base/full/37full.webp", caption: `<h2>//img.[BSE].#037</h2><p></p>` },
      { src: "images/base/thumb/38thumb.webp", full: "images/base/full/38full.webp", caption: `<h2>//img.[BSE].#038</h2><p></p>` },
      { src: "images/base/thumb/39thumb.webp", full: "images/base/full/39full.webp", caption: `<h2>//img.[BSE].#039</h2><p></p>` },
      { src: "images/base/thumb/40thumb.webp", full: "images/base/full/40full.webp", caption: `<h2>//img.[BSE].#040</h2><p></p>` },
      { src: "images/base/thumb/41thumb.webp", full: "images/base/full/41full.webp", caption: `<h2>//img.[BSE].#041</h2><p></p>` },
      { src: "images/base/thumb/42thumb.webp", full: "images/base/full/42full.webp", caption: `<h2>//img.[BSE].#042</h2><p></p>` },
      { src: "images/base/thumb/43thumb.webp", full: "images/base/full/43full.webp", caption: `<h2>//img.[BSE].#043</h2><p></p>` },
      { src: "images/base/thumb/44thumb.webp", full: "images/base/full/44full.webp", caption: `<h2>//img.[BSE].#044</h2><p></p>` },
      { src: "images/base/thumb/45thumb.webp", full: "images/base/full/45full.webp", caption: `<h2>//img.[BSE].#045</h2><p></p>` },
      { src: "images/base/thumb/46thumb.webp", full: "images/base/full/46full.webp", caption: `<h2>//img.[BSE].#046</h2><p></p>` },
      { src: "images/base/thumb/47thumb.webp", full: "images/base/full/47full.webp", caption: `<h2>//img.[BSE].#047</h2><p></p>` },
      { src: "images/base/thumb/48thumb.webp", full: "images/base/full/48full.webp", caption: `<h2>//img.[BSE].#048</h2><p></p>` },
      { src: "images/base/thumb/49thumb.webp", full: "images/base/full/49full.webp", caption: `<h2>//img.[BSE].#049</h2><p></p>` },
      { src: "images/base/thumb/50thumb.webp", full: "images/base/full/50full.webp", caption: `<h2>//img.[BSE].#050</h2><p></p>` },
      { src: "images/base/thumb/51thumb.webp", full: "images/base/full/51full.webp", caption: `<h2>//img.[BSE].#051</h2><p></p>` },
      { src: "images/base/thumb/52thumb.webp", full: "images/base/full/52full.webp", caption: `<h2>//img.[BSE].#052</h2><p></p>` },
      { src: "images/base/thumb/53thumb.webp", full: "images/base/full/53full.webp", caption: `<h2>//img.[BSE].#053</h2><p></p>` },
      { src: "images/base/thumb/54thumb.webp", full: "images/base/full/54full.webp", caption: `<h2>//img.[BSE].#054</h2><p></p>` },
      { src: "images/base/thumb/55thumb.webp", full: "images/base/full/55full.webp", caption: `<h2>//img.[BSE].#055</h2><p></p>` },
      { src: "images/base/thumb/56thumb.webp", full: "images/base/full/56full.webp", caption: `<h2>//img.[BSE].#056</h2><p></p>` },
      { src: "images/base/thumb/57thumb.webp", full: "images/base/full/57full.webp", caption: `<h2>//img.[BSE].#057</h2><p></p>` },
      { src: "images/base/thumb/58thumb.webp", full: "images/base/full/58full.webp", caption: `<h2>//img.[BSE].#058</h2><p></p>` },
      { src: "images/base/thumb/59thumb.webp", full: "images/base/full/59full.webp", caption: `<h2>//img.[BSE].#059</h2><p></p>` },
      { src: "images/base/thumb/60thumb.webp", full: "images/base/full/60full.webp", caption: `<h2>//img.[BSE].#060</h2><p></p>` },
      { src: "images/base/thumb/61thumb.webp", full: "images/base/full/61full.webp", caption: `<h2>//img.[BSE].#061</h2><p></p>` },
      { src: "images/base/thumb/62thumb.webp", full: "images/base/full/62full.webp", caption: `<h2>//img.[BSE].#062</h2><p></p>` },
      { src: "images/base/thumb/63thumb.webp", full: "images/base/full/63full.webp", caption: `<h2>//img.[BSE].#063</h2><p></p>` },
      { src: "images/base/thumb/64thumb.webp", full: "images/base/full/64full.webp", caption: `<h2>//img.[BSE].#064</h2><p></p>` },
      { src: "images/base/thumb/65thumb.webp", full: "images/base/full/65full.webp", caption: `<h2>//img.[BSE].#065</h2><p></p>` },
      { src: "images/base/thumb/66thumb.webp", full: "images/base/full/66full.webp", caption: `<h2>//img.[BSE].#066</h2><p></p>` },
      { src: "images/base/thumb/67thumb.webp", full: "images/base/full/67full.webp", caption: `<h2>//img.[BSE].#067</h2><p></p>` },
      { src: "images/base/thumb/68thumb.webp", full: "images/base/full/68full.webp", caption: `<h2>//img.[BSE].#068</h2><p></p>` },
      { src: "images/base/thumb/69thumb.webp", full: "images/base/full/69full.webp", caption: `<h2>//img.[BSE].#069</h2><p></p>` },
      { src: "images/base/thumb/70thumb.webp", full: "images/base/full/70full.webp", caption: `<h2>//img.[BSE].#070</h2><p></p>` },
      { src: "images/base/thumb/71thumb.webp", full: "images/base/full/71full.webp", caption: `<h2>//img.[BSE].#071</h2><p></p>` },
      { src: "images/base/thumb/72thumb.webp", full: "images/base/full/72full.webp", caption: `<h2>//img.[BSE].#072</h2><p></p>` },
      { src: "images/base/thumb/73thumb.webp", full: "images/base/full/73full.webp", caption: `<h2>//img.[BSE].#073</h2><p></p>` },
      { src: "images/base/thumb/74thumb.webp", full: "images/base/full/74full.webp", caption: `<h2>//img.[BSE].#074</h2><p></p>` },
      { src: "images/base/thumb/75thumb.webp", full: "images/base/full/75full.webp", caption: `<h2>//img.[BSE].#075</h2><p></p>` },
      { src: "images/base/thumb/76thumb.webp", full: "images/base/full/76full.webp", caption: `<h2>//img.[BSE].#076</h2><p></p>` },
      { src: "images/base/thumb/77thumb.webp", full: "images/base/full/77full.webp", caption: `<h2>//img.[BSE].#077</h2><p></p>` },
      { src: "images/base/thumb/78thumb.webp", full: "images/base/full/78full.webp", caption: `<h2>//img.[BSE].#078</h2><p></p>` },
      { src: "images/base/thumb/79thumb.webp", full: "images/base/full/79full.webp", caption: `<h2>//img.[BSE].#079</h2><p></p>` },
      { src: "images/base/thumb/80thumb.webp", full: "images/base/full/80full.webp", caption: `<h2>//img.[BSE].#080</h2><p></p>` },
      { src: "images/base/thumb/81thumb.webp", full: "images/base/full/81full.webp", caption: `<h2>//img.[BSE].#081</h2><p></p>` },
      { src: "images/base/thumb/82thumb.webp", full: "images/base/full/82full.webp", caption: `<h2>//img.[BSE].#082</h2><p></p>` },
      { src: "images/base/thumb/83thumb.webp", full: "images/base/full/83full.webp", caption: `<h2>//img.[BSE].#083</h2><p></p>` },
      { src: "images/base/thumb/84thumb.webp", full: "images/base/full/84full.webp", caption: `<h2>//img.[BSE].#084</h2><p></p>` },
      { src: "images/base/thumb/85thumb.webp", full: "images/base/full/85full.webp", caption: `<h2>//img.[BSE].#085</h2><p></p>` },
      { src: "images/base/thumb/86thumb.webp", full: "images/base/full/86full.webp", caption: `<h2>//img.[BSE].#086</h2><p></p>` },
      { src: "images/base/thumb/87thumb.webp", full: "images/base/full/87full.webp", caption: `<h2>//img.[BSE].#087</h2><p></p>` },
      { src: "images/base/thumb/88thumb.webp", full: "images/base/full/88full.webp", caption: `<h2>//img.[BSE].#088</h2><p></p>` },
      { src: "images/base/thumb/89thumb.webp", full: "images/base/full/89full.webp", caption: `<h2>//img.[BSE].#089</h2><p></p>` },
      { src: "images/base/thumb/90thumb.webp", full: "images/base/full/90full.webp", caption: `<h2>//img.[BSE].#090</h2><p></p>` },
      { src: "images/base/thumb/91thumb.webp", full: "images/base/full/91full.webp", caption: `<h2>//img.[BSE].#091</h2><p></p>` },
      { src: "images/base/thumb/92thumb.webp", full: "images/base/full/92full.webp", caption: `<h2>//img.[BSE].#092</h2><p></p>` },
      { src: "images/base/thumb/93thumb.webp", full: "images/base/full/93full.webp", caption: `<h2>//img.[BSE].#093</h2><p></p>` },
      { src: "images/base/thumb/94thumb.webp", full: "images/base/full/94full.webp", caption: `<h2>//img.[BSE].#094</h2><p></p>` },
      { src: "images/base/thumb/95thumb.webp", full: "images/base/full/95full.webp", caption: `<h2>//img.[BSE].#095</h2><p></p>` },
      { src: "images/base/thumb/96thumb.webp", full: "images/base/full/96full.webp", caption: `<h2>//img.[BSE].#096</h2><p></p>` },
      { src: "images/base/thumb/97thumb.webp", full: "images/base/full/97full.webp", caption: `<h2>//img.[BSE].#097</h2><p></p>` },
      { src: "images/base/thumb/98thumb.webp", full: "images/base/full/98full.webp", caption: `<h2>//img.[BSE].#098</h2><p></p>` },
      { src: "images/base/thumb/99thumb.webp", full: "images/base/full/99full.webp", caption: `<h2>//img.[BSE].#099</h2><p></p>` },
      { src: "images/base/thumb/100thumb.webp", full: "images/base/full/100full.webp", caption: `<h2>//img.[BSE].#100</h2><p></p>` },
      { src: "images/base/thumb/101thumb.webp", full: "images/base/full/101full.webp", caption: `<h2>//img.[BSE].#101</h2><p></p>` },
      { src: "images/base/thumb/102thumb.webp", full: "images/base/full/102full.webp", caption: `<h2>//img.[BSE].#102</h2><p></p>` },
      { src: "images/base/thumb/103thumb.webp", full: "images/base/full/103full.webp", caption: `<h2>//img.[BSE].#103</h2><p></p>` },
      { src: "images/base/thumb/104thumb.webp", full: "images/base/full/104full.webp", caption: `<h2>//img.[BSE].#104</h2><p></p>` },
      { src: "images/base/thumb/105thumb.webp", full: "images/base/full/105full.webp", caption: `<h2>//img.[BSE].#105</h2><p></p>` },
      { src: "images/base/thumb/106thumb.webp", full: "images/base/full/106full.webp", caption: `<h2>//img.[BSE].#106</h2><p></p>` },
      { src: "images/base/thumb/107thumb.webp", full: "images/base/full/107full.webp", caption: `<h2>//img.[BSE].#107</h2><p></p>` },
      { src: "images/base/thumb/108thumb.webp", full: "images/base/full/108full.webp", caption: `<h2>//img.[BSE].#108</h2><p></p>` },
      { src: "images/base/thumb/109thumb.webp", full: "images/base/full/109full.webp", caption: `<h2>//img.[BSE].#109</h2><p></p>` },
      { src: "images/base/thumb/110thumb.webp", full: "images/base/full/110full.webp", caption: `<h2>//img.[BSE].#110</h2><p></p>` },
      { src: "images/base/thumb/111thumb.webp", full: "images/base/full/111full.webp", caption: `<h2>//img.[BSE].#111</h2><p></p>` },
      { src: "images/base/thumb/112thumb.webp", full: "images/base/full/112full.webp", caption: `<h2>//img.[BSE].#112</h2><p></p>` },
      { src: "images/base/thumb/113thumb.webp", full: "images/base/full/113full.webp", caption: `<h2>//img.[BSE].#113</h2><p></p>` },
      { src: "images/base/thumb/114thumb.webp", full: "images/base/full/114full.webp", caption: `<h2>//img.[BSE].#114</h2><p></p>` },
      { src: "images/base/thumb/115thumb.webp", full: "images/base/full/115full.webp", caption: `<h2>//img.[BSE].#115</h2><p></p>` },
      { src: "images/base/thumb/116thumb.webp", full: "images/base/full/116full.webp", caption: `<h2>//img.[BSE].#116</h2><p></p>` },
      { src: "images/base/thumb/117thumb.webp", full: "images/base/full/117full.webp", caption: `<h2>//img.[BSE].#117</h2><p></p>` },
      { src: "images/base/thumb/118thumb.webp", full: "images/base/full/118full.webp", caption: `<h2>//img.[BSE].#118</h2><p></p>` },
      { src: "images/base/thumb/119thumb.webp", full: "images/base/full/119full.webp", caption: `<h2>//img.[BSE].#119</h2><p></p>` },
      { src: "images/base/thumb/120thumb.webp", full: "images/base/full/120full.webp", caption: `<h2>//img.[BSE].#120</h2><p></p>` },
      { src: "images/base/thumb/121thumb.webp", full: "images/base/full/121full.webp", caption: `<h2>//img.[BSE].#121</h2><p></p>` },
      { src: "images/base/thumb/122thumb.webp", full: "images/base/full/122full.webp", caption: `<h2>//img.[BSE].#122</h2><p></p>` },
      { src: "images/base/thumb/123thumb.webp", full: "images/base/full/123full.webp", caption: `<h2>//img.[BSE].#123</h2><p></p>` },
      { src: "images/base/thumb/124thumb.webp", full: "images/base/full/124full.webp", caption: `<h2>//img.[BSE].#124</h2><p></p>` },
      { src: "images/base/thumb/125thumb.webp", full: "images/base/full/125full.webp", caption: `<h2>//img.[BSE].#125</h2><p></p>` },
      { src: "images/base/thumb/126thumb.webp", full: "images/base/full/126full.webp", caption: `<h2>//img.[BSE].#126</h2><p></p>` },
      { src: "images/base/thumb/127thumb.webp", full: "images/base/full/127full.webp", caption: `<h2>//img.[BSE].#127</h2><p></p>` },
      { src: "images/base/thumb/128thumb.webp", full: "images/base/full/128full.webp", caption: `<h2>//img.[BSE].#128</h2><p></p>` },
      { src: "images/base/thumb/129thumb.webp", full: "images/base/full/129full.webp", caption: `<h2>//img.[BSE].#129</h2><p></p>` },
      { src: "images/base/thumb/130thumb.webp", full: "images/base/full/130full.webp", caption: `<h2>//img.[BSE].#130</h2><p></p>` },
      { src: "images/base/thumb/131thumb.webp", full: "images/base/full/131full.webp", caption: `<h2>//img.[BSE].#131</h2><p></p>` },
      { src: "images/base/thumb/132thumb.webp", full: "images/base/full/132full.webp", caption: `<h2>//img.[BSE].#132</h2><p></p>` },
      { src: "images/base/thumb/133thumb.webp", full: "images/base/full/133full.webp", caption: `<h2>//img.[BSE].#133</h2><p></p>` },
      { src: "images/base/thumb/134thumb.webp", full: "images/base/full/134full.webp", caption: `<h2>//img.[BSE].#134</h2><p></p>` },
      { src: "images/base/thumb/135thumb.webp", full: "images/base/full/135full.webp", caption: `<h2>//img.[BSE].#135</h2><p></p>` },
      { src: "images/base/thumb/136thumb.webp", full: "images/base/full/136full.webp", caption: `<h2>//img.[BSE].#136</h2><p></p>` },
      { src: "images/base/thumb/137thumb.webp", full: "images/base/full/137full.webp", caption: `<h2>//img.[BSE].#137</h2><p></p>` },
      { src: "images/base/thumb/138thumb.webp", full: "images/base/full/138full.webp", caption: `<h2>//img.[BSE].#138</h2><p></p>` },
      { src: "images/base/thumb/139thumb.webp", full: "images/base/full/139full.webp", caption: `<h2>//img.[BSE].#139</h2><p></p>` },
      { src: "images/base/thumb/140thumb.webp", full: "images/base/full/140full.webp", caption: `<h2>//img.[BSE].#140</h2><p></p>` },
      { src: "images/base/thumb/141thumb.webp", full: "images/base/full/141full.webp", caption: `<h2>//img.[BSE].#141</h2><p></p>` },
      { src: "images/base/thumb/142thumb.webp", full: "images/base/full/142full.webp", caption: `<h2>//img.[BSE].#142</h2><p></p>` },
      { src: "images/base/thumb/143thumb.webp", full: "images/base/full/143full.webp", caption: `<h2>//img.[BSE].#143</h2><p></p>` },
      { src: "images/base/thumb/144thumb.webp", full: "images/base/full/144full.webp", caption: `<h2>//img.[BSE].#144</h2><p></p>` },
      { src: "images/base/thumb/1clipthumb.webp", full: "images/base/clip/1clip.mp4", caption: `<h2>//vid.[BSE].#145</h2><p></p>` },
      { src: "images/base/thumb/1clipthumb.webp", full: "images/base/clip/1clip.mp4", caption: `<h2>//vid.[BSE].#145</h2><p></p>` },
{ src: "images/base/thumb/2clipthumb.webp", full: "images/base/clip/2clip.mp4", caption: `<h2>//vid.[BSE].#146</h2><p></p>` },
{ src: "images/base/thumb/3clipthumb.webp", full: "images/base/clip/3clip.mp4", caption: `<h2>//vid.[BSE].#147</h2><p></p>` },
{ src: "images/base/thumb/4clipthumb.webp", full: "images/base/clip/4clip.mp4", caption: `<h2>//vid.[BSE].#148</h2><p></p>` },
{ src: "images/base/thumb/5clipthumb.webp", full: "images/base/clip/5clip.mp4", caption: `<h2>//vid.[BSE].#149</h2><p></p>` },
{ src: "images/base/thumb/6clipthumb.webp", full: "images/base/clip/6clip.mp4", caption: `<h2>//vid.[BSE].#150</h2><p></p>` },
{ src: "images/base/thumb/7clipthumb.webp", full: "images/base/clip/7clip.mp4", caption: `<h2>//vid.[BSE].#151</h2><p></p>` },
{ src: "images/base/thumb/8clipthumb.webp", full: "images/base/clip/8clip.mp4", caption: `<h2>//vid.[BSE].#152</h2><p></p>` },
{ src: "images/base/thumb/9clipthumb.webp", full: "images/base/clip/9clip.mp4", caption: `<h2>//vid.[BSE].#153</h2><p></p>` },
{ src: "images/base/thumb/10clipthumb.webp", full: "images/base/clip/10clip.mp4", caption: `<h2>//vid.[BSE].#154</h2><p></p>` },
{ src: "images/base/thumb/11clipthumb.webp", full: "images/base/clip/11clip.mp4", caption: `<h2>//vid.[BSE].#155</h2><p></p>` },
{ src: "images/base/thumb/12clipthumb.webp", full: "images/base/clip/12clip.mp4", caption: `<h2>//vid.[BSE].#156</h2><p></p>` },
{ src: "images/base/thumb/13clipthumb.webp", full: "images/base/clip/13clip.mp4", caption: `<h2>//vid.[BSE].#157</h2><p></p>` },
{ src: "images/base/thumb/14clipthumb.webp", full: "images/base/clip/14clip.mp4", caption: `<h2>//vid.[BSE].#158</h2><p></p>` },
{ src: "images/base/thumb/15clipthumb.webp", full: "images/base/clip/15clip.mp4", caption: `<h2>//vid.[BSE].#159</h2><p></p>` },
{ src: "images/base/thumb/16clipthumb.webp", full: "images/base/clip/16clip.mp4", caption: `<h2>//vid.[BSE].#160</h2><p></p>` },
{ src: "images/base/thumb/17clipthumb.webp", full: "images/base/clip/17clip.mp4", caption: `<h2>//vid.[BSE].#161</h2><p></p>` },
{ src: "images/base/thumb/18clipthumb.webp", full: "images/base/clip/18clip.mp4", caption: `<h2>//vid.[BSE].#162</h2><p></p>` },
{ src: "images/base/thumb/19clipthumb.webp", full: "images/base/clip/19clip.mp4", caption: `<h2>//vid.[BSE].#163</h2><p></p>` },
{ src: "images/base/thumb/20clipthumb.webp", full: "images/base/clip/20clip.mp4", caption: `<h2>//vid.[BSE].#164</h2><p></p>` },
{ src: "images/base/thumb/21clipthumb.webp", full: "images/base/clip/21clip.mp4", caption: `<h2>//vid.[BSE].#165</h2><p></p>` },
{ src: "images/base/thumb/22clipthumb.webp", full: "images/base/clip/22clip.mp4", caption: `<h2>//vid.[BSE].#166</h2><p></p>` },
{ src: "images/base/thumb/23clipthumb.webp", full: "images/base/clip/23clip.mp4", caption: `<h2>//vid.[BSE].#167</h2><p></p>` },
{ src: "images/base/thumb/24clipthumb.webp", full: "images/base/clip/24clip.mp4", caption: `<h2>//vid.[BSE].#168</h2><p></p>` },
{ src: "images/base/thumb/25clipthumb.webp", full: "images/base/clip/25clip.mp4", caption: `<h2>//vid.[BSE].#169</h2><p></p>` },
      
    ],
  },


{
    type: "turn",
    scene: { type: "turn", fullscreen: true },
    file: "assets/models/crudeLogoMark.glb",
    modelScale: 0.6, 
    enter: "grow",
    exit:  "both",
    html: `
      <p class="turn-kicker">PORTFOLIO ENTRY / 02</p>
  <div class="turn-static">
    <h1 class="turn-title">CRUDEBOX</h1>
    <p class="turn-body">> FROM THIS CRUDE BOX<br>> CRUDE THINGS WILL COME</p>
  </div>
  <div class="turn-controls">
    <button class="turn-btn turn-btn--ghost turn-btn--minor" data-action="info">OPEN.INFO</button>
    <button class="turn-btn turn-btn--ghost turn-btn--major" data-action="grid">[ VIEW.GRID ]</button>
  </div>`,
    infoHtml: `
      <div class="turn-info-layout">
      <div class="turn-info-main">
      <p class="turn-info-kicker">PORTFOLIO ENTRY / 02</p>
      <h2 class="turn-info-heading">CRUDEBOX</h2>
      <dl class="turn-info-spec">
        <dt class="turn-info-spec-label">Year</dt>
        <dd class="turn-info-spec-value">2023 &mdash; 2024</dd>
        <dt class="turn-info-spec-label">Role</dt>
        <dd class="turn-info-spec-value">Associate Designer</dd>
        <dt class="turn-info-spec-label">Scope</dt>
        <dd class="turn-info-spec-value">Apparel Design / Sample Making / Drop Production</dd>
        <dt class="turn-info-spec-label">Stack</dt>
        <dd class="turn-info-spec-value">Cut-Sew / Visual Identity / In-House Production</dd>
        <dt class="turn-info-spec-label">Status</dt>
        <dd class="turn-info-spec-value">Brand Active &mdash; Departed 2024</dd>
      </dl>
      <div class="turn-info-text">
        <p class="turn-info-line"><strong>CRUDEBOX is an anime apparel label built on tapestry.</strong></p>
        <p class="turn-info-line">I joined in early 2023 as associate designer, brought on for apparel design and sewing, and stayed through late 2024.</p>

        <hr class="turn-info-rule">

        <p class="turn-info-line">The garment starts as a blank; a hoodie or a crewneck, quiet, unremarkable on purpose. One sleeve is cut away and rebuilt in woven tapestry.</p>
        <p class="turn-info-line">A garment made entirely of tapestry can be a costume. A single sleeve is an intervention.</p>
        <p class="turn-info-line">The blank has to stay a blank for the sleeve to land. Everything else in the piece gets out of its way.</p>

        <hr class="turn-info-rule">

        <p class="turn-info-line"><strong>The name is the thesis.</strong></p>
        <p class="turn-info-line">Tapestry is a low-resolution medium. Woven on a jacquard, an image arrives coarse and pixelated, stitches visible, reassembled in thread you can feel with your hand.</p>
        <p class="turn-info-line">Rather than smoothing the weave and chasing print fidelity, CRUDEBOX made the coarseness the entire proposition.</p>
        <p class="turn-info-line"><strong>The art direction is the counterweight.</strong></p>
        <p class="turn-info-item">Black on black. Hard collegiate type, X-marked.</p>
        <p class="turn-info-item">Product lit in near-total shadow, a single sliver of light and nothing else.</p>
        <p class="turn-info-item">Packaging as severe as the garment is loud.</p>
        <p class="turn-info-line">Crude object, immaculate frame. The tension between the two is the brand.</p>

        <hr class="turn-info-rule">

        <p class="turn-info-line"><strong>Production ran in house.</strong></p>
        <p class="turn-info-line">I was responsible for helping to get each drop through it, and I ran the machines myself: cutting panels, working the serger.</p>
        <p class="turn-info-line">A design decision you have to execute a hundred times with your own hands stops being theoretical very quickly.</p>

        <hr class="turn-info-rule">

        <p class="turn-info-line"><strong>The founder became my mentor.</strong></p>
        <p class="turn-info-line">A genius brand designer and creative director; two years working beside him was my real education: graphic design, brand systems, marketing, and the universal principles sitting underneath all of it.</p>
        <p class="turn-info-line">I left in late 2024 to build BASE. Entry 01 exists because of what I learned here.</p>
        <p class="turn-info-line">CRUDEBOX is still dropping. I still maintain a strong relationship with my mentor and am still learning from him.</p>
      </div>
      </div>
      <aside class="turn-info-media">
      <div class="turn-info-media-scroll">
        <figure class="turn-info-media-item">
          <img src="images/crude/full/70full.webp" alt="CRUDE wordmark on black, flanked by X marks, above the line FROM THIS CRUDE BOX CRUDE THINGS WILL COME" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[CRD].#070</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/crude/full/110full.webp" alt="Five tapestry-sleeved hoodies hung from a bare branch against black" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[CRD].#110</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/crude/full/75full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[CRD].#075</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/crude/full/4full.webp" alt="Black crewneck with one woven tapestry sleeve, lit hard on cracked concrete" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[CRD].#004</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/crude/full/178full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[CRD].#178</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/crude/full/166full.webp" alt="Six hoodies on a rack, each sleeve woven with a different anime figure" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[CRD].#166</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/crude/full/122full.webp" alt="Stacks of matte black CRUDE BOX packaging, wordmark in white" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[CRD].#122</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/crude/full/164full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[CRD].#164</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/crude/full/180full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[CRD].#180</figcaption>
        </figure>
      </div>
      </aside>
      </div>`,
    gridImages: [
      
      { src: "images/crude/thumb/1thumb.webp", full: "images/crude/full/1full.webp", caption: `<h2>//img.[CRD].#001</h2><p></p>` },
{ src: "images/crude/thumb/2thumb.webp", full: "images/crude/full/2full.webp", caption: `<h2>//img.[CRD].#002</h2><p></p>` },
{ src: "images/crude/thumb/3thumb.webp", full: "images/crude/full/3full.webp", caption: `<h2>//img.[CRD].#003</h2><p></p>` },
{ src: "images/crude/thumb/4thumb.webp", full: "images/crude/full/4full.webp", caption: `<h2>//img.[CRD].#004</h2><p></p>` },
{ src: "images/crude/thumb/5thumb.webp", full: "images/crude/full/5full.webp", caption: `<h2>//img.[CRD].#005</h2><p></p>` },
{ src: "images/crude/thumb/6thumb.webp", full: "images/crude/full/6full.webp", caption: `<h2>//img.[CRD].#006</h2><p></p>` },
{ src: "images/crude/thumb/7thumb.webp", full: "images/crude/full/7full.webp", caption: `<h2>//img.[CRD].#007</h2><p></p>` },
{ src: "images/crude/thumb/8thumb.webp", full: "images/crude/full/8full.webp", caption: `<h2>//img.[CRD].#008</h2><p></p>` },
{ src: "images/crude/thumb/9thumb.webp", full: "images/crude/full/9full.webp", caption: `<h2>//img.[CRD].#009</h2><p></p>` },
{ src: "images/crude/thumb/10thumb.webp", full: "images/crude/full/10full.webp", caption: `<h2>//img.[CRD].#010</h2><p></p>` },
{ src: "images/crude/thumb/11thumb.webp", full: "images/crude/full/11full.webp", caption: `<h2>//img.[CRD].#011</h2><p></p>` },
{ src: "images/crude/thumb/12thumb.webp", full: "images/crude/full/12full.webp", caption: `<h2>//img.[CRD].#012</h2><p></p>` },
{ src: "images/crude/thumb/13thumb.webp", full: "images/crude/full/13full.webp", caption: `<h2>//img.[CRD].#013</h2><p></p>` },
{ src: "images/crude/thumb/14thumb.webp", full: "images/crude/full/14full.webp", caption: `<h2>//img.[CRD].#014</h2><p></p>` },
{ src: "images/crude/thumb/15thumb.webp", full: "images/crude/full/15full.webp", caption: `<h2>//img.[CRD].#015</h2><p></p>` },
{ src: "images/crude/thumb/16thumb.webp", full: "images/crude/full/16full.webp", caption: `<h2>//img.[CRD].#016</h2><p></p>` },
{ src: "images/crude/thumb/17thumb.webp", full: "images/crude/full/17full.webp", caption: `<h2>//img.[CRD].#017</h2><p></p>` },
{ src: "images/crude/thumb/18thumb.webp", full: "images/crude/full/18full.webp", caption: `<h2>//img.[CRD].#018</h2><p></p>` },
{ src: "images/crude/thumb/19thumb.webp", full: "images/crude/full/19full.webp", caption: `<h2>//img.[CRD].#019</h2><p></p>` },
{ src: "images/crude/thumb/20thumb.webp", full: "images/crude/full/20full.webp", caption: `<h2>//img.[CRD].#020</h2><p></p>` },
{ src: "images/crude/thumb/21thumb.webp", full: "images/crude/full/21full.webp", caption: `<h2>//img.[CRD].#021</h2><p></p>` },
{ src: "images/crude/thumb/22thumb.webp", full: "images/crude/full/22full.webp", caption: `<h2>//img.[CRD].#022</h2><p></p>` },
{ src: "images/crude/thumb/23thumb.webp", full: "images/crude/full/23full.webp", caption: `<h2>//img.[CRD].#023</h2><p></p>` },
{ src: "images/crude/thumb/24thumb.webp", full: "images/crude/full/24full.webp", caption: `<h2>//img.[CRD].#024</h2><p></p>` },
{ src: "images/crude/thumb/25thumb.webp", full: "images/crude/full/25full.webp", caption: `<h2>//img.[CRD].#025</h2><p></p>` },
{ src: "images/crude/thumb/26thumb.webp", full: "images/crude/full/26full.webp", caption: `<h2>//img.[CRD].#026</h2><p></p>` },
{ src: "images/crude/thumb/27thumb.webp", full: "images/crude/full/27full.webp", caption: `<h2>//img.[CRD].#027</h2><p></p>` },
{ src: "images/crude/thumb/28thumb.webp", full: "images/crude/full/28full.webp", caption: `<h2>//img.[CRD].#028</h2><p></p>` },
{ src: "images/crude/thumb/29thumb.webp", full: "images/crude/full/29full.webp", caption: `<h2>//img.[CRD].#029</h2><p></p>` },
{ src: "images/crude/thumb/30thumb.webp", full: "images/crude/full/30full.webp", caption: `<h2>//img.[CRD].#030</h2><p></p>` },
{ src: "images/crude/thumb/31thumb.webp", full: "images/crude/full/31full.webp", caption: `<h2>//img.[CRD].#031</h2><p></p>` },
{ src: "images/crude/thumb/32thumb.webp", full: "images/crude/full/32full.webp", caption: `<h2>//img.[CRD].#032</h2><p></p>` },
{ src: "images/crude/thumb/33thumb.webp", full: "images/crude/full/33full.webp", caption: `<h2>//img.[CRD].#033</h2><p></p>` },
{ src: "images/crude/thumb/34thumb.webp", full: "images/crude/full/34full.webp", caption: `<h2>//img.[CRD].#034</h2><p></p>` },
{ src: "images/crude/thumb/35thumb.webp", full: "images/crude/full/35full.webp", caption: `<h2>//img.[CRD].#035</h2><p></p>` },
{ src: "images/crude/thumb/36thumb.webp", full: "images/crude/full/36full.webp", caption: `<h2>//img.[CRD].#036</h2><p></p>` },
{ src: "images/crude/thumb/37thumb.webp", full: "images/crude/full/37full.webp", caption: `<h2>//img.[CRD].#037</h2><p></p>` },
{ src: "images/crude/thumb/38thumb.webp", full: "images/crude/full/38full.webp", caption: `<h2>//img.[CRD].#038</h2><p></p>` },
{ src: "images/crude/thumb/39thumb.webp", full: "images/crude/full/39full.webp", caption: `<h2>//img.[CRD].#039</h2><p></p>` },
{ src: "images/crude/thumb/40thumb.webp", full: "images/crude/full/40full.webp", caption: `<h2>//img.[CRD].#040</h2><p></p>` },
{ src: "images/crude/thumb/41thumb.webp", full: "images/crude/full/41full.webp", caption: `<h2>//img.[CRD].#041</h2><p></p>` },
{ src: "images/crude/thumb/42thumb.webp", full: "images/crude/full/42full.webp", caption: `<h2>//img.[CRD].#042</h2><p></p>` },
{ src: "images/crude/thumb/43thumb.webp", full: "images/crude/full/43full.webp", caption: `<h2>//img.[CRD].#043</h2><p></p>` },
{ src: "images/crude/thumb/44thumb.webp", full: "images/crude/full/44full.webp", caption: `<h2>//img.[CRD].#044</h2><p></p>` },
{ src: "images/crude/thumb/45thumb.webp", full: "images/crude/full/45full.webp", caption: `<h2>//img.[CRD].#045</h2><p></p>` },
{ src: "images/crude/thumb/46thumb.webp", full: "images/crude/full/46full.webp", caption: `<h2>//img.[CRD].#046</h2><p></p>` },
{ src: "images/crude/thumb/47thumb.webp", full: "images/crude/full/47full.webp", caption: `<h2>//img.[CRD].#047</h2><p></p>` },
{ src: "images/crude/thumb/48thumb.webp", full: "images/crude/full/48full.webp", caption: `<h2>//img.[CRD].#048</h2><p></p>` },
{ src: "images/crude/thumb/49thumb.webp", full: "images/crude/full/49full.webp", caption: `<h2>//img.[CRD].#049</h2><p></p>` },
{ src: "images/crude/thumb/50thumb.webp", full: "images/crude/full/50full.webp", caption: `<h2>//img.[CRD].#050</h2><p></p>` },
{ src: "images/crude/thumb/51thumb.webp", full: "images/crude/full/51full.webp", caption: `<h2>//img.[CRD].#051</h2><p></p>` },
{ src: "images/crude/thumb/52thumb.webp", full: "images/crude/full/52full.webp", caption: `<h2>//img.[CRD].#052</h2><p></p>` },
{ src: "images/crude/thumb/53thumb.webp", full: "images/crude/full/53full.webp", caption: `<h2>//img.[CRD].#053</h2><p></p>` },
{ src: "images/crude/thumb/54thumb.webp", full: "images/crude/full/54full.webp", caption: `<h2>//img.[CRD].#054</h2><p></p>` },
{ src: "images/crude/thumb/55thumb.webp", full: "images/crude/full/55full.webp", caption: `<h2>//img.[CRD].#055</h2><p></p>` },
{ src: "images/crude/thumb/56thumb.webp", full: "images/crude/full/56full.webp", caption: `<h2>//img.[CRD].#056</h2><p></p>` },
{ src: "images/crude/thumb/57thumb.webp", full: "images/crude/full/57full.webp", caption: `<h2>//img.[CRD].#057</h2><p></p>` },
{ src: "images/crude/thumb/58thumb.webp", full: "images/crude/full/58full.webp", caption: `<h2>//img.[CRD].#058</h2><p></p>` },
{ src: "images/crude/thumb/59thumb.webp", full: "images/crude/full/59full.webp", caption: `<h2>//img.[CRD].#059</h2><p></p>` },
{ src: "images/crude/thumb/60thumb.webp", full: "images/crude/full/60full.webp", caption: `<h2>//img.[CRD].#060</h2><p></p>` },
{ src: "images/crude/thumb/61thumb.webp", full: "images/crude/full/61full.webp", caption: `<h2>//img.[CRD].#061</h2><p></p>` },
{ src: "images/crude/thumb/62thumb.webp", full: "images/crude/full/62full.webp", caption: `<h2>//img.[CRD].#062</h2><p></p>` },
{ src: "images/crude/thumb/63thumb.webp", full: "images/crude/full/63full.webp", caption: `<h2>//img.[CRD].#063</h2><p></p>` },
{ src: "images/crude/thumb/64thumb.webp", full: "images/crude/full/64full.webp", caption: `<h2>//img.[CRD].#064</h2><p></p>` },
{ src: "images/crude/thumb/65thumb.webp", full: "images/crude/full/65full.webp", caption: `<h2>//img.[CRD].#065</h2><p></p>` },
{ src: "images/crude/thumb/66thumb.webp", full: "images/crude/full/66full.webp", caption: `<h2>//img.[CRD].#066</h2><p></p>` },
{ src: "images/crude/thumb/67thumb.webp", full: "images/crude/full/67full.webp", caption: `<h2>//img.[CRD].#067</h2><p></p>` },
{ src: "images/crude/thumb/68thumb.webp", full: "images/crude/full/68full.webp", caption: `<h2>//img.[CRD].#068</h2><p></p>` },
{ src: "images/crude/thumb/69thumb.webp", full: "images/crude/full/69full.webp", caption: `<h2>//img.[CRD].#069</h2><p></p>` },
{ src: "images/crude/thumb/70thumb.webp", full: "images/crude/full/70full.webp", caption: `<h2>//img.[CRD].#070</h2><p></p>` },
{ src: "images/crude/thumb/71thumb.webp", full: "images/crude/full/71full.webp", caption: `<h2>//img.[CRD].#071</h2><p></p>` },
{ src: "images/crude/thumb/72thumb.webp", full: "images/crude/full/72full.webp", caption: `<h2>//img.[CRD].#072</h2><p></p>` },
{ src: "images/crude/thumb/73thumb.webp", full: "images/crude/full/73full.webp", caption: `<h2>//img.[CRD].#073</h2><p></p>` },
{ src: "images/crude/thumb/74thumb.webp", full: "images/crude/full/74full.webp", caption: `<h2>//img.[CRD].#074</h2><p></p>` },
{ src: "images/crude/thumb/75thumb.webp", full: "images/crude/full/75full.webp", caption: `<h2>//img.[CRD].#075</h2><p></p>` },
{ src: "images/crude/thumb/76thumb.webp", full: "images/crude/full/76full.webp", caption: `<h2>//img.[CRD].#076</h2><p></p>` },
{ src: "images/crude/thumb/77thumb.webp", full: "images/crude/full/77full.webp", caption: `<h2>//img.[CRD].#077</h2><p></p>` },
{ src: "images/crude/thumb/78thumb.webp", full: "images/crude/full/78full.webp", caption: `<h2>//img.[CRD].#078</h2><p></p>` },
{ src: "images/crude/thumb/79thumb.webp", full: "images/crude/full/79full.webp", caption: `<h2>//img.[CRD].#079</h2><p></p>` },
{ src: "images/crude/thumb/80thumb.webp", full: "images/crude/full/80full.webp", caption: `<h2>//img.[CRD].#080</h2><p></p>` },
{ src: "images/crude/thumb/81thumb.webp", full: "images/crude/full/81full.webp", caption: `<h2>//img.[CRD].#081</h2><p></p>` },
{ src: "images/crude/thumb/82thumb.webp", full: "images/crude/full/82full.webp", caption: `<h2>//img.[CRD].#082</h2><p></p>` },
{ src: "images/crude/thumb/83thumb.webp", full: "images/crude/full/83full.webp", caption: `<h2>//img.[CRD].#083</h2><p></p>` },
{ src: "images/crude/thumb/84thumb.webp", full: "images/crude/full/84full.webp", caption: `<h2>//img.[CRD].#084</h2><p></p>` },
{ src: "images/crude/thumb/85thumb.webp", full: "images/crude/full/85full.webp", caption: `<h2>//img.[CRD].#085</h2><p></p>` },
{ src: "images/crude/thumb/86thumb.webp", full: "images/crude/full/86full.webp", caption: `<h2>//img.[CRD].#086</h2><p></p>` },
{ src: "images/crude/thumb/87thumb.webp", full: "images/crude/full/87full.webp", caption: `<h2>//img.[CRD].#087</h2><p></p>` },
{ src: "images/crude/thumb/88thumb.webp", full: "images/crude/full/88full.webp", caption: `<h2>//img.[CRD].#088</h2><p></p>` },
{ src: "images/crude/thumb/89thumb.webp", full: "images/crude/full/89full.webp", caption: `<h2>//img.[CRD].#089</h2><p></p>` },
{ src: "images/crude/thumb/90thumb.webp", full: "images/crude/full/90full.webp", caption: `<h2>//img.[CRD].#090</h2><p></p>` },
{ src: "images/crude/thumb/91thumb.webp", full: "images/crude/full/91full.webp", caption: `<h2>//img.[CRD].#091</h2><p></p>` },
{ src: "images/crude/thumb/92thumb.webp", full: "images/crude/full/92full.webp", caption: `<h2>//img.[CRD].#092</h2><p></p>` },
{ src: "images/crude/thumb/93thumb.webp", full: "images/crude/full/93full.webp", caption: `<h2>//img.[CRD].#093</h2><p></p>` },
{ src: "images/crude/thumb/94thumb.webp", full: "images/crude/full/94full.webp", caption: `<h2>//img.[CRD].#094</h2><p></p>` },
{ src: "images/crude/thumb/95thumb.webp", full: "images/crude/full/95full.webp", caption: `<h2>//img.[CRD].#095</h2><p></p>` },
{ src: "images/crude/thumb/96thumb.webp", full: "images/crude/full/96full.webp", caption: `<h2>//img.[CRD].#096</h2><p></p>` },
{ src: "images/crude/thumb/97thumb.webp", full: "images/crude/full/97full.webp", caption: `<h2>//img.[CRD].#097</h2><p></p>` },
{ src: "images/crude/thumb/98thumb.webp", full: "images/crude/full/98full.webp", caption: `<h2>//img.[CRD].#098</h2><p></p>` },
{ src: "images/crude/thumb/99thumb.webp", full: "images/crude/full/99full.webp", caption: `<h2>//img.[CRD].#099</h2><p></p>` },
{ src: "images/crude/thumb/100thumb.webp", full: "images/crude/full/100full.webp", caption: `<h2>//img.[CRD].#100</h2><p></p>` },
{ src: "images/crude/thumb/101thumb.webp", full: "images/crude/full/101full.webp", caption: `<h2>//img.[CRD].#101</h2><p></p>` },
{ src: "images/crude/thumb/102thumb.webp", full: "images/crude/full/102full.webp", caption: `<h2>//img.[CRD].#102</h2><p></p>` },
{ src: "images/crude/thumb/103thumb.webp", full: "images/crude/full/103full.webp", caption: `<h2>//img.[CRD].#103</h2><p></p>` },
{ src: "images/crude/thumb/104thumb.webp", full: "images/crude/full/104full.webp", caption: `<h2>//img.[CRD].#104</h2><p></p>` },
{ src: "images/crude/thumb/105thumb.webp", full: "images/crude/full/105full.webp", caption: `<h2>//img.[CRD].#105</h2><p></p>` },
{ src: "images/crude/thumb/106thumb.webp", full: "images/crude/full/106full.webp", caption: `<h2>//img.[CRD].#106</h2><p></p>` },
{ src: "images/crude/thumb/107thumb.webp", full: "images/crude/full/107full.webp", caption: `<h2>//img.[CRD].#107</h2><p></p>` },
{ src: "images/crude/thumb/108thumb.webp", full: "images/crude/full/108full.webp", caption: `<h2>//img.[CRD].#108</h2><p></p>` },
{ src: "images/crude/thumb/109thumb.webp", full: "images/crude/full/109full.webp", caption: `<h2>//img.[CRD].#109</h2><p></p>` },
{ src: "images/crude/thumb/110thumb.webp", full: "images/crude/full/110full.webp", caption: `<h2>//img.[CRD].#110</h2><p></p>` },
{ src: "images/crude/thumb/111thumb.webp", full: "images/crude/full/111full.webp", caption: `<h2>//img.[CRD].#111</h2><p></p>` },
{ src: "images/crude/thumb/112thumb.webp", full: "images/crude/full/112full.webp", caption: `<h2>//img.[CRD].#112</h2><p></p>` },
{ src: "images/crude/thumb/113thumb.webp", full: "images/crude/full/113full.webp", caption: `<h2>//img.[CRD].#113</h2><p></p>` },
{ src: "images/crude/thumb/114thumb.webp", full: "images/crude/full/114full.webp", caption: `<h2>//img.[CRD].#114</h2><p></p>` },
{ src: "images/crude/thumb/115thumb.webp", full: "images/crude/full/115full.webp", caption: `<h2>//img.[CRD].#115</h2><p></p>` },
{ src: "images/crude/thumb/116thumb.webp", full: "images/crude/full/116full.webp", caption: `<h2>//img.[CRD].#116</h2><p></p>` },
{ src: "images/crude/thumb/117thumb.webp", full: "images/crude/full/117full.webp", caption: `<h2>//img.[CRD].#117</h2><p></p>` },
{ src: "images/crude/thumb/118thumb.webp", full: "images/crude/full/118full.webp", caption: `<h2>//img.[CRD].#118</h2><p></p>` },
{ src: "images/crude/thumb/119thumb.webp", full: "images/crude/full/119full.webp", caption: `<h2>//img.[CRD].#119</h2><p></p>` },
{ src: "images/crude/thumb/120thumb.webp", full: "images/crude/full/120full.webp", caption: `<h2>//img.[CRD].#120</h2><p></p>` },
{ src: "images/crude/thumb/121thumb.webp", full: "images/crude/full/121full.webp", caption: `<h2>//img.[CRD].#121</h2><p></p>` },
{ src: "images/crude/thumb/122thumb.webp", full: "images/crude/full/122full.webp", caption: `<h2>//img.[CRD].#122</h2><p></p>` },
{ src: "images/crude/thumb/123thumb.webp", full: "images/crude/full/123full.webp", caption: `<h2>//img.[CRD].#123</h2><p></p>` },
{ src: "images/crude/thumb/124thumb.webp", full: "images/crude/full/124full.webp", caption: `<h2>//img.[CRD].#124</h2><p></p>` },
{ src: "images/crude/thumb/125thumb.webp", full: "images/crude/full/125full.webp", caption: `<h2>//img.[CRD].#125</h2><p></p>` },
{ src: "images/crude/thumb/126thumb.webp", full: "images/crude/full/126full.webp", caption: `<h2>//img.[CRD].#126</h2><p></p>` },
{ src: "images/crude/thumb/127thumb.webp", full: "images/crude/full/127full.webp", caption: `<h2>//img.[CRD].#127</h2><p></p>` },
{ src: "images/crude/thumb/128thumb.webp", full: "images/crude/full/128full.webp", caption: `<h2>//img.[CRD].#128</h2><p></p>` },
{ src: "images/crude/thumb/129thumb.webp", full: "images/crude/full/129full.webp", caption: `<h2>//img.[CRD].#129</h2><p></p>` },
{ src: "images/crude/thumb/130thumb.webp", full: "images/crude/full/130full.webp", caption: `<h2>//img.[CRD].#130</h2><p></p>` },
{ src: "images/crude/thumb/131thumb.webp", full: "images/crude/full/131full.webp", caption: `<h2>//img.[CRD].#131</h2><p></p>` },
{ src: "images/crude/thumb/132thumb.webp", full: "images/crude/full/132full.webp", caption: `<h2>//img.[CRD].#132</h2><p></p>` },
{ src: "images/crude/thumb/133thumb.webp", full: "images/crude/full/133full.webp", caption: `<h2>//img.[CRD].#133</h2><p></p>` },
{ src: "images/crude/thumb/134thumb.webp", full: "images/crude/full/134full.webp", caption: `<h2>//img.[CRD].#134</h2><p></p>` },
{ src: "images/crude/thumb/135thumb.webp", full: "images/crude/full/135full.webp", caption: `<h2>//img.[CRD].#135</h2><p></p>` },
{ src: "images/crude/thumb/136thumb.webp", full: "images/crude/full/136full.webp", caption: `<h2>//img.[CRD].#136</h2><p></p>` },
{ src: "images/crude/thumb/137thumb.webp", full: "images/crude/full/137full.webp", caption: `<h2>//img.[CRD].#137</h2><p></p>` },
{ src: "images/crude/thumb/138thumb.webp", full: "images/crude/full/138full.webp", caption: `<h2>//img.[CRD].#138</h2><p></p>` },
{ src: "images/crude/thumb/139thumb.webp", full: "images/crude/full/139full.webp", caption: `<h2>//img.[CRD].#139</h2><p></p>` },
{ src: "images/crude/thumb/140thumb.webp", full: "images/crude/full/140full.webp", caption: `<h2>//img.[CRD].#140</h2><p></p>` },
{ src: "images/crude/thumb/141thumb.webp", full: "images/crude/full/141full.webp", caption: `<h2>//img.[CRD].#141</h2><p></p>` },
{ src: "images/crude/thumb/142thumb.webp", full: "images/crude/full/142full.webp", caption: `<h2>//img.[CRD].#142</h2><p></p>` },
{ src: "images/crude/thumb/143thumb.webp", full: "images/crude/full/143full.webp", caption: `<h2>//img.[CRD].#143</h2><p></p>` },
{ src: "images/crude/thumb/144thumb.webp", full: "images/crude/full/144full.webp", caption: `<h2>//img.[CRD].#144</h2><p></p>` },
{ src: "images/crude/thumb/145thumb.webp", full: "images/crude/full/145full.webp", caption: `<h2>//img.[CRD].#145</h2><p></p>` },
{ src: "images/crude/thumb/146thumb.webp", full: "images/crude/full/146full.webp", caption: `<h2>//img.[CRD].#146</h2><p></p>` },
{ src: "images/crude/thumb/147thumb.webp", full: "images/crude/full/147full.webp", caption: `<h2>//img.[CRD].#147</h2><p></p>` },
{ src: "images/crude/thumb/148thumb.webp", full: "images/crude/full/148full.webp", caption: `<h2>//img.[CRD].#148</h2><p></p>` },
{ src: "images/crude/thumb/149thumb.webp", full: "images/crude/full/149full.webp", caption: `<h2>//img.[CRD].#149</h2><p></p>` },
{ src: "images/crude/thumb/150thumb.webp", full: "images/crude/full/150full.webp", caption: `<h2>//img.[CRD].#150</h2><p></p>` },
{ src: "images/crude/thumb/151thumb.webp", full: "images/crude/full/151full.webp", caption: `<h2>//img.[CRD].#151</h2><p></p>` },
{ src: "images/crude/thumb/152thumb.webp", full: "images/crude/full/152full.webp", caption: `<h2>//img.[CRD].#152</h2><p></p>` },
{ src: "images/crude/thumb/153thumb.webp", full: "images/crude/full/153full.webp", caption: `<h2>//img.[CRD].#153</h2><p></p>` },
{ src: "images/crude/thumb/154thumb.webp", full: "images/crude/full/154full.webp", caption: `<h2>//img.[CRD].#154</h2><p></p>` },
{ src: "images/crude/thumb/155thumb.webp", full: "images/crude/full/155full.webp", caption: `<h2>//img.[CRD].#155</h2><p></p>` },
{ src: "images/crude/thumb/156thumb.webp", full: "images/crude/full/156full.webp", caption: `<h2>//img.[CRD].#156</h2><p></p>` },
{ src: "images/crude/thumb/157thumb.webp", full: "images/crude/full/157full.webp", caption: `<h2>//img.[CRD].#157</h2><p></p>` },
{ src: "images/crude/thumb/158thumb.webp", full: "images/crude/full/158full.webp", caption: `<h2>//img.[CRD].#158</h2><p></p>` },
{ src: "images/crude/thumb/159thumb.webp", full: "images/crude/full/159full.webp", caption: `<h2>//img.[CRD].#159</h2><p></p>` },
{ src: "images/crude/thumb/160thumb.webp", full: "images/crude/full/160full.webp", caption: `<h2>//img.[CRD].#160</h2><p></p>` },
{ src: "images/crude/thumb/161thumb.webp", full: "images/crude/full/161full.webp", caption: `<h2>//img.[CRD].#161</h2><p></p>` },
{ src: "images/crude/thumb/162thumb.webp", full: "images/crude/full/162full.webp", caption: `<h2>//img.[CRD].#162</h2><p></p>` },
{ src: "images/crude/thumb/163thumb.webp", full: "images/crude/full/163full.webp", caption: `<h2>//img.[CRD].#163</h2><p></p>` },
{ src: "images/crude/thumb/164thumb.webp", full: "images/crude/full/164full.webp", caption: `<h2>//img.[CRD].#164</h2><p></p>` },
{ src: "images/crude/thumb/165thumb.webp", full: "images/crude/full/165full.webp", caption: `<h2>//img.[CRD].#165</h2><p></p>` },
{ src: "images/crude/thumb/166thumb.webp", full: "images/crude/full/166full.webp", caption: `<h2>//img.[CRD].#166</h2><p></p>` },
{ src: "images/crude/thumb/167thumb.webp", full: "images/crude/full/167full.webp", caption: `<h2>//img.[CRD].#167</h2><p></p>` },
{ src: "images/crude/thumb/168thumb.webp", full: "images/crude/full/168full.webp", caption: `<h2>//img.[CRD].#168</h2><p></p>` },
{ src: "images/crude/thumb/169thumb.webp", full: "images/crude/full/169full.webp", caption: `<h2>//img.[CRD].#169</h2><p></p>` },
{ src: "images/crude/thumb/170thumb.webp", full: "images/crude/full/170full.webp", caption: `<h2>//img.[CRD].#170</h2><p></p>` },
{ src: "images/crude/thumb/171thumb.webp", full: "images/crude/full/171full.webp", caption: `<h2>//img.[CRD].#171</h2><p></p>` },
{ src: "images/crude/thumb/172thumb.webp", full: "images/crude/full/172full.webp", caption: `<h2>//img.[CRD].#172</h2><p></p>` },
{ src: "images/crude/thumb/173thumb.webp", full: "images/crude/full/173full.webp", caption: `<h2>//img.[CRD].#173</h2><p></p>` },
{ src: "images/crude/thumb/174thumb.webp", full: "images/crude/full/174full.webp", caption: `<h2>//img.[CRD].#174</h2><p></p>` },
{ src: "images/crude/thumb/175thumb.webp", full: "images/crude/full/175full.webp", caption: `<h2>//img.[CRD].#175</h2><p></p>` },
{ src: "images/crude/thumb/176thumb.webp", full: "images/crude/full/176full.webp", caption: `<h2>//img.[CRD].#176</h2><p></p>` },
{ src: "images/crude/thumb/177thumb.webp", full: "images/crude/full/177full.webp", caption: `<h2>//img.[CRD].#177</h2><p></p>` },
{ src: "images/crude/thumb/178thumb.webp", full: "images/crude/full/178full.webp", caption: `<h2>//img.[CRD].#178</h2><p></p>` },
{ src: "images/crude/thumb/179thumb.webp", full: "images/crude/full/179full.webp", caption: `<h2>//img.[CRD].#179</h2><p></p>` },
{ src: "images/crude/thumb/180thumb.webp", full: "images/crude/full/180full.webp", caption: `<h2>//img.[CRD].#180</h2><p></p>` },
{ src: "images/crude/thumb/181thumb.webp", full: "images/crude/full/181full.webp", caption: `<h2>//img.[CRD].#181</h2><p></p>` },
{ src: "images/crude/thumb/182thumb.webp", full: "images/crude/full/182full.webp", caption: `<h2>//img.[CRD].#182</h2><p></p>` },
{ src: "images/crude/thumb/183thumb.webp", full: "images/crude/full/183full.webp", caption: `<h2>//img.[CRD].#183</h2><p></p>` },
{ src: "images/crude/thumb/184thumb.webp", full: "images/crude/full/184full.webp", caption: `<h2>//img.[CRD].#184</h2><p></p>` },
{ src: "images/crude/thumb/185thumb.webp", full: "images/crude/full/185full.webp", caption: `<h2>//img.[CRD].#185</h2><p></p>` },
{ src: "images/crude/thumb/186thumb.webp", full: "images/crude/full/186full.webp", caption: `<h2>//img.[CRD].#186</h2><p></p>` },
{ src: "images/crude/thumb/187thumb.webp", full: "images/crude/full/187full.webp", caption: `<h2>//img.[CRD].#187</h2><p></p>` },
      
    ],
  },


  {
    type: "turn",
    scene: { type: "turn", fullscreen: true },
    file: "assets/models/azuliLogoMark.glb",
    modelScale: 0.6, 
    enter: "grow",
    exit:  "both",
    html: `
      <p class="turn-kicker">PORTFOLIO ENTRY / 03</p>
  <div class="turn-static">
    <h1 class="turn-title">AZULI</h1>
    <p class="turn-body">> BORN OF GRANITE<br>> RAISED BY TIDE</p>
  </div>
  <div class="turn-controls">
    <button class="turn-btn turn-btn--ghost turn-btn--minor" data-action="info">OPEN.INFO</button>
    <button class="turn-btn turn-btn--ghost turn-btn--major" data-action="grid">[ VIEW.GRID ]</button>
  </div>`,
      
    infoHtml: `
      <div class="turn-info-layout">
      <div class="turn-info-main">
      <p class="turn-info-kicker">PORTFOLIO ENTRY / 03</p>
      <h2 class="turn-info-heading">AZULI</h2>
      <dl class="turn-info-spec">
        <dt class="turn-info-spec-label">Year</dt>
        <dd class="turn-info-spec-value">2021 &mdash; 2022</dd>
        <dt class="turn-info-spec-label">Role</dt>
        <dd class="turn-info-spec-value">Cut-Sew Assistant</dd>
        <dt class="turn-info-spec-label">Scope</dt>
        <dd class="turn-info-spec-value">Garment Construction / Sewing / Illustration</dd>
        <dt class="turn-info-spec-label">Stack</dt>
        <dd class="turn-info-spec-value">Patternmaking / Boro / Sashiko / Indigo / Reconstruction</dd>
        <dt class="turn-info-spec-label">Status</dt>
        <dd class="turn-info-spec-value">Closed &mdash; 2022</dd>
      </dl>
      <div class="turn-info-text">
        <p class="turn-info-line"><strong>AZULI was a bespoke Japanese Americana streetwear label, and it is where I started.</strong></p>
        <p class="turn-info-line">I worked there from early 2021 to late 2022, assisting with cut and sew. It was my introduction to apparel design and to garment construction. I had no training when I walked in.</p>

        <hr class="turn-info-rule">

        <p class="turn-info-line"><strong>Nobody taught me. I took things apart.</strong></p>
        <p class="turn-info-line">During the day I cut panels and ran a machine. After hours I stayed with the scrap fabric and taught myself patternmaking, building garments from nothing to see whether I could.</p>
        <p class="turn-info-line">I unpicked my own clothes at the seams to find out how they were held together. I spent what money I had on garments for the sole purpose of reverse engineering them.</p>

        <hr class="turn-info-rule">

        <p class="turn-info-line"><strong>The method and the material turned out to be the same thing.</strong></p>
        <p class="turn-info-line">Boro is cloth patched so many times that the patching becomes the garment. Sashiko is the reinforcing stitch, left visible on purpose. Both are traditions of taking a thing apart and putting it back with the repair still showing.</p>
        <p class="turn-info-line">The garments I was studying were made by the same operation I was using to study them.</p>

        <hr class="turn-info-rule">

        <p class="turn-info-line"><strong>I studied the designers who had already done it.</strong></p>
        <p class="turn-info-item">Kiro Hirata of Kapital, whose Kountry line takes finished garments back apart to dye, shred, patch and rebuild them.</p>
        <p class="turn-info-item">Hiroki Nakamura of visvim, who builds garments on traditional construction and traditional cloth, and lets the process stay legible in the finished piece.</p>
        <p class="turn-info-line">Both read Japanese craft through a contemporary lens; boro, sashiko, indigo. Neither of them treats the tradition as decoration.</p>

        <hr class="turn-info-rule">

        <p class="turn-info-line"><strong>Every spare hour went into drawing.</strong></p>
        <p class="turn-info-line">Looks, silhouettes, construction studies. For me, it was where art met design, and I have not stopped since.</p>

        <hr class="turn-info-rule">

        <p class="turn-info-line"><strong>The aesthetic was never the point, and that was why I found it beautiful.</strong></p>
        <p class="turn-info-item">Indigo was the dye of ordinary people. The indigo plant was abundant and perfect for cotton and flax, while silk was reserved for royalty and the upper classes. They wore blue because blue was what they could get.</p>
        <p class="turn-info-item">Boro and sashiko exist because cloth was costly and the people wearing it spent their days working the fields. Clothing wore through, so clothing was repaired, and repaired again, and the repairs stayed.</p>
        <p class="turn-info-line">Nobody sat down to design any of it. The palette, the patching, the visible stitch; all of it emerged as a byproduct of necessity, and centuries later it holds a cult following.</p>
        <p class="turn-info-line">That is the lesson I took out of this room and still carry with me today. The aesthetics I trust are the ones that emerge from a function-first mind. Beauty as a consequence, not an objective.</p>

        <hr class="turn-info-rule">

        <p class="turn-info-line"><strong>AZULI closed in late 2022 and our small team scattered to other work.</strong></p>
        <p class="turn-info-line">I call what I made here student work and I mean it plainly, without apology: it is the work of someone learning, and it looks like it.</p>
        <p class="turn-info-line">Everything in entries 02 and 01 is built on what I took apart at this table.</p>
      </div>
      </div>
      <aside class="turn-info-media">
      <div class="turn-info-media-scroll">
        <figure class="turn-info-media-item">
          <img src="images/azuli/full/37full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[AZL].#037</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/azuli/full/6full.webp" alt="Boro indigo vest on a hanger, patched in many shades with visible sashiko stitching" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[AZL].#006</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/azuli/full/80full.webp" alt="Heavily patched indigo boro jeans, worn through to the backing cloth" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[AZL].#080</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/azuli/full/32full.webp" alt="Detail of patched denim with sherpa letters appliqued over Japanese printed cotton" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[AZL].#032</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/azuli/full/35full.webp" alt="Sashiko-quilted boro chore jacket with a sherpa collar and chevron patch" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[AZL].#035</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/azuli/full/98full.webp" alt="Quilted plaid boro long coat hung in the workshop" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[AZL].#098</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/azuli/full/45full.webp" alt="" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[AZL].#045</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/azuli/full/77full.webp" alt="Patchwork denim trousers inset with printed Japanese cotton panels" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[AZL].#077</figcaption>
        </figure>
        <figure class="turn-info-media-item">
          <img src="images/azuli/full/99full.webp" alt="Grey and teal sherpa-lined haori with a chevron patch pocket" loading="lazy">
          <figcaption class="turn-info-media-tag">//img.[AZL].#099</figcaption>
        </figure>
      </div>
      </aside>
      </div>`,
    gridImages: [
      
      { src: "images/azuli/thumb/1thumb.webp", full: "images/azuli/full/1full.webp", caption: `<h2>//img.[AZL].#001</h2><p></p>` },
{ src: "images/azuli/thumb/2thumb.webp", full: "images/azuli/full/2full.webp", caption: `<h2>//img.[AZL].#002</h2><p></p>` },
{ src: "images/azuli/thumb/3thumb.webp", full: "images/azuli/full/3full.webp", caption: `<h2>//img.[AZL].#003</h2><p></p>` },
{ src: "images/azuli/thumb/4thumb.webp", full: "images/azuli/full/4full.webp", caption: `<h2>//img.[AZL].#004</h2><p></p>` },
{ src: "images/azuli/thumb/5thumb.webp", full: "images/azuli/full/5full.webp", caption: `<h2>//img.[AZL].#005</h2><p></p>` },
{ src: "images/azuli/thumb/6thumb.webp", full: "images/azuli/full/6full.webp", caption: `<h2>//img.[AZL].#006</h2><p></p>` },
{ src: "images/azuli/thumb/7thumb.webp", full: "images/azuli/full/7full.webp", caption: `<h2>//img.[AZL].#007</h2><p></p>` },
{ src: "images/azuli/thumb/8thumb.webp", full: "images/azuli/full/8full.webp", caption: `<h2>//img.[AZL].#008</h2><p></p>` },
{ src: "images/azuli/thumb/9thumb.webp", full: "images/azuli/full/9full.webp", caption: `<h2>//img.[AZL].#009</h2><p></p>` },
{ src: "images/azuli/thumb/10thumb.webp", full: "images/azuli/full/10full.webp", caption: `<h2>//img.[AZL].#010</h2><p></p>` },
{ src: "images/azuli/thumb/11thumb.webp", full: "images/azuli/full/11full.webp", caption: `<h2>//img.[AZL].#011</h2><p></p>` },
{ src: "images/azuli/thumb/12thumb.webp", full: "images/azuli/full/12full.webp", caption: `<h2>//img.[AZL].#012</h2><p></p>` },
{ src: "images/azuli/thumb/13thumb.webp", full: "images/azuli/full/13full.webp", caption: `<h2>//img.[AZL].#013</h2><p></p>` },
{ src: "images/azuli/thumb/14thumb.webp", full: "images/azuli/full/14full.webp", caption: `<h2>//img.[AZL].#014</h2><p></p>` },
{ src: "images/azuli/thumb/15thumb.webp", full: "images/azuli/full/15full.webp", caption: `<h2>//img.[AZL].#015</h2><p></p>` },
{ src: "images/azuli/thumb/16thumb.webp", full: "images/azuli/full/16full.webp", caption: `<h2>//img.[AZL].#016</h2><p></p>` },
{ src: "images/azuli/thumb/17thumb.webp", full: "images/azuli/full/17full.webp", caption: `<h2>//img.[AZL].#017</h2><p></p>` },
{ src: "images/azuli/thumb/18thumb.webp", full: "images/azuli/full/18full.webp", caption: `<h2>//img.[AZL].#018</h2><p></p>` },
{ src: "images/azuli/thumb/19thumb.webp", full: "images/azuli/full/19full.webp", caption: `<h2>//img.[AZL].#019</h2><p></p>` },
{ src: "images/azuli/thumb/20thumb.webp", full: "images/azuli/full/20full.webp", caption: `<h2>//img.[AZL].#020</h2><p></p>` },
{ src: "images/azuli/thumb/21thumb.webp", full: "images/azuli/full/21full.webp", caption: `<h2>//img.[AZL].#021</h2><p></p>` },
{ src: "images/azuli/thumb/22thumb.webp", full: "images/azuli/full/22full.webp", caption: `<h2>//img.[AZL].#022</h2><p></p>` },
{ src: "images/azuli/thumb/23thumb.webp", full: "images/azuli/full/23full.webp", caption: `<h2>//img.[AZL].#023</h2><p></p>` },
{ src: "images/azuli/thumb/24thumb.webp", full: "images/azuli/full/24full.webp", caption: `<h2>//img.[AZL].#024</h2><p></p>` },
{ src: "images/azuli/thumb/25thumb.webp", full: "images/azuli/full/25full.webp", caption: `<h2>//img.[AZL].#025</h2><p></p>` },
{ src: "images/azuli/thumb/26thumb.webp", full: "images/azuli/full/26full.webp", caption: `<h2>//img.[AZL].#026</h2><p></p>` },
{ src: "images/azuli/thumb/27thumb.webp", full: "images/azuli/full/27full.webp", caption: `<h2>//img.[AZL].#027</h2><p></p>` },
{ src: "images/azuli/thumb/28thumb.webp", full: "images/azuli/full/28full.webp", caption: `<h2>//img.[AZL].#028</h2><p></p>` },
{ src: "images/azuli/thumb/29thumb.webp", full: "images/azuli/full/29full.webp", caption: `<h2>//img.[AZL].#029</h2><p></p>` },
{ src: "images/azuli/thumb/30thumb.webp", full: "images/azuli/full/30full.webp", caption: `<h2>//img.[AZL].#030</h2><p></p>` },
{ src: "images/azuli/thumb/31thumb.webp", full: "images/azuli/full/31full.webp", caption: `<h2>//img.[AZL].#031</h2><p></p>` },
{ src: "images/azuli/thumb/32thumb.webp", full: "images/azuli/full/32full.webp", caption: `<h2>//img.[AZL].#032</h2><p></p>` },
{ src: "images/azuli/thumb/33thumb.webp", full: "images/azuli/full/33full.webp", caption: `<h2>//img.[AZL].#033</h2><p></p>` },
{ src: "images/azuli/thumb/34thumb.webp", full: "images/azuli/full/34full.webp", caption: `<h2>//img.[AZL].#034</h2><p></p>` },
{ src: "images/azuli/thumb/35thumb.webp", full: "images/azuli/full/35full.webp", caption: `<h2>//img.[AZL].#035</h2><p></p>` },
{ src: "images/azuli/thumb/36thumb.webp", full: "images/azuli/full/36full.webp", caption: `<h2>//img.[AZL].#036</h2><p></p>` },
{ src: "images/azuli/thumb/37thumb.webp", full: "images/azuli/full/37full.webp", caption: `<h2>//img.[AZL].#037</h2><p></p>` },
{ src: "images/azuli/thumb/38thumb.webp", full: "images/azuli/full/38full.webp", caption: `<h2>//img.[AZL].#038</h2><p></p>` },
{ src: "images/azuli/thumb/39thumb.webp", full: "images/azuli/full/39full.webp", caption: `<h2>//img.[AZL].#039</h2><p></p>` },
{ src: "images/azuli/thumb/40thumb.webp", full: "images/azuli/full/40full.webp", caption: `<h2>//img.[AZL].#040</h2><p></p>` },
{ src: "images/azuli/thumb/41thumb.webp", full: "images/azuli/full/41full.webp", caption: `<h2>//img.[AZL].#041</h2><p></p>` },
{ src: "images/azuli/thumb/42thumb.webp", full: "images/azuli/full/42full.webp", caption: `<h2>//img.[AZL].#042</h2><p></p>` },
{ src: "images/azuli/thumb/43thumb.webp", full: "images/azuli/full/43full.webp", caption: `<h2>//img.[AZL].#043</h2><p></p>` },
{ src: "images/azuli/thumb/44thumb.webp", full: "images/azuli/full/44full.webp", caption: `<h2>//img.[AZL].#044</h2><p></p>` },
{ src: "images/azuli/thumb/45thumb.webp", full: "images/azuli/full/45full.webp", caption: `<h2>//img.[AZL].#045</h2><p></p>` },
{ src: "images/azuli/thumb/46thumb.webp", full: "images/azuli/full/46full.webp", caption: `<h2>//img.[AZL].#046</h2><p></p>` },
{ src: "images/azuli/thumb/47thumb.webp", full: "images/azuli/full/47full.webp", caption: `<h2>//img.[AZL].#047</h2><p></p>` },
{ src: "images/azuli/thumb/48thumb.webp", full: "images/azuli/full/48full.webp", caption: `<h2>//img.[AZL].#048</h2><p></p>` },
{ src: "images/azuli/thumb/49thumb.webp", full: "images/azuli/full/49full.webp", caption: `<h2>//img.[AZL].#049</h2><p></p>` },
{ src: "images/azuli/thumb/50thumb.webp", full: "images/azuli/full/50full.webp", caption: `<h2>//img.[AZL].#050</h2><p></p>` },
{ src: "images/azuli/thumb/51thumb.webp", full: "images/azuli/full/51full.webp", caption: `<h2>//img.[AZL].#051</h2><p></p>` },
{ src: "images/azuli/thumb/52thumb.webp", full: "images/azuli/full/52full.webp", caption: `<h2>//img.[AZL].#052</h2><p></p>` },
{ src: "images/azuli/thumb/53thumb.webp", full: "images/azuli/full/53full.webp", caption: `<h2>//img.[AZL].#053</h2><p></p>` },
{ src: "images/azuli/thumb/54thumb.webp", full: "images/azuli/full/54full.webp", caption: `<h2>//img.[AZL].#054</h2><p></p>` },
{ src: "images/azuli/thumb/55thumb.webp", full: "images/azuli/full/55full.webp", caption: `<h2>//img.[AZL].#055</h2><p></p>` },
{ src: "images/azuli/thumb/56thumb.webp", full: "images/azuli/full/56full.webp", caption: `<h2>//img.[AZL].#056</h2><p></p>` },
{ src: "images/azuli/thumb/57thumb.webp", full: "images/azuli/full/57full.webp", caption: `<h2>//img.[AZL].#057</h2><p></p>` },
{ src: "images/azuli/thumb/58thumb.webp", full: "images/azuli/full/58full.webp", caption: `<h2>//img.[AZL].#058</h2><p></p>` },
{ src: "images/azuli/thumb/59thumb.webp", full: "images/azuli/full/59full.webp", caption: `<h2>//img.[AZL].#059</h2><p></p>` },
{ src: "images/azuli/thumb/60thumb.webp", full: "images/azuli/full/60full.webp", caption: `<h2>//img.[AZL].#060</h2><p></p>` },
{ src: "images/azuli/thumb/61thumb.webp", full: "images/azuli/full/61full.webp", caption: `<h2>//img.[AZL].#061</h2><p></p>` },
{ src: "images/azuli/thumb/62thumb.webp", full: "images/azuli/full/62full.webp", caption: `<h2>//img.[AZL].#062</h2><p></p>` },
{ src: "images/azuli/thumb/63thumb.webp", full: "images/azuli/full/63full.webp", caption: `<h2>//img.[AZL].#063</h2><p></p>` },
{ src: "images/azuli/thumb/64thumb.webp", full: "images/azuli/full/64full.webp", caption: `<h2>//img.[AZL].#064</h2><p></p>` },
{ src: "images/azuli/thumb/65thumb.webp", full: "images/azuli/full/65full.webp", caption: `<h2>//img.[AZL].#065</h2><p></p>` },
{ src: "images/azuli/thumb/66thumb.webp", full: "images/azuli/full/66full.webp", caption: `<h2>//img.[AZL].#066</h2><p></p>` },
{ src: "images/azuli/thumb/67thumb.webp", full: "images/azuli/full/67full.webp", caption: `<h2>//img.[AZL].#067</h2><p></p>` },
{ src: "images/azuli/thumb/68thumb.webp", full: "images/azuli/full/68full.webp", caption: `<h2>//img.[AZL].#068</h2><p></p>` },
{ src: "images/azuli/thumb/69thumb.webp", full: "images/azuli/full/69full.webp", caption: `<h2>//img.[AZL].#069</h2><p></p>` },
{ src: "images/azuli/thumb/70thumb.webp", full: "images/azuli/full/70full.webp", caption: `<h2>//img.[AZL].#070</h2><p></p>` },
{ src: "images/azuli/thumb/71thumb.webp", full: "images/azuli/full/71full.webp", caption: `<h2>//img.[AZL].#071</h2><p></p>` },
{ src: "images/azuli/thumb/72thumb.webp", full: "images/azuli/full/72full.webp", caption: `<h2>//img.[AZL].#072</h2><p></p>` },
{ src: "images/azuli/thumb/73thumb.webp", full: "images/azuli/full/73full.webp", caption: `<h2>//img.[AZL].#073</h2><p></p>` },
{ src: "images/azuli/thumb/74thumb.webp", full: "images/azuli/full/74full.webp", caption: `<h2>//img.[AZL].#074</h2><p></p>` },
{ src: "images/azuli/thumb/75thumb.webp", full: "images/azuli/full/75full.webp", caption: `<h2>//img.[AZL].#075</h2><p></p>` },
{ src: "images/azuli/thumb/76thumb.webp", full: "images/azuli/full/76full.webp", caption: `<h2>//img.[AZL].#076</h2><p></p>` },
{ src: "images/azuli/thumb/77thumb.webp", full: "images/azuli/full/77full.webp", caption: `<h2>//img.[AZL].#077</h2><p></p>` },
{ src: "images/azuli/thumb/78thumb.webp", full: "images/azuli/full/78full.webp", caption: `<h2>//img.[AZL].#078</h2><p></p>` },
{ src: "images/azuli/thumb/79thumb.webp", full: "images/azuli/full/79full.webp", caption: `<h2>//img.[AZL].#079</h2><p></p>` },
{ src: "images/azuli/thumb/80thumb.webp", full: "images/azuli/full/80full.webp", caption: `<h2>//img.[AZL].#080</h2><p></p>` },
{ src: "images/azuli/thumb/81thumb.webp", full: "images/azuli/full/81full.webp", caption: `<h2>//img.[AZL].#081</h2><p></p>` },
{ src: "images/azuli/thumb/82thumb.webp", full: "images/azuli/full/82full.webp", caption: `<h2>//img.[AZL].#082</h2><p></p>` },
{ src: "images/azuli/thumb/83thumb.webp", full: "images/azuli/full/83full.webp", caption: `<h2>//img.[AZL].#083</h2><p></p>` },
{ src: "images/azuli/thumb/84thumb.webp", full: "images/azuli/full/84full.webp", caption: `<h2>//img.[AZL].#084</h2><p></p>` },
{ src: "images/azuli/thumb/85thumb.webp", full: "images/azuli/full/85full.webp", caption: `<h2>//img.[AZL].#085</h2><p></p>` },
{ src: "images/azuli/thumb/86thumb.webp", full: "images/azuli/full/86full.webp", caption: `<h2>//img.[AZL].#086</h2><p></p>` },
{ src: "images/azuli/thumb/87thumb.webp", full: "images/azuli/full/87full.webp", caption: `<h2>//img.[AZL].#087</h2><p></p>` },
{ src: "images/azuli/thumb/88thumb.webp", full: "images/azuli/full/88full.webp", caption: `<h2>//img.[AZL].#088</h2><p></p>` },
{ src: "images/azuli/thumb/89thumb.webp", full: "images/azuli/full/89full.webp", caption: `<h2>//img.[AZL].#089</h2><p></p>` },
{ src: "images/azuli/thumb/90thumb.webp", full: "images/azuli/full/90full.webp", caption: `<h2>//img.[AZL].#090</h2><p></p>` },
{ src: "images/azuli/thumb/91thumb.webp", full: "images/azuli/full/91full.webp", caption: `<h2>//img.[AZL].#091</h2><p></p>` },
{ src: "images/azuli/thumb/92thumb.webp", full: "images/azuli/full/92full.webp", caption: `<h2>//img.[AZL].#092</h2><p></p>` },
{ src: "images/azuli/thumb/93thumb.webp", full: "images/azuli/full/93full.webp", caption: `<h2>//img.[AZL].#093</h2><p></p>` },
{ src: "images/azuli/thumb/94thumb.webp", full: "images/azuli/full/94full.webp", caption: `<h2>//img.[AZL].#094</h2><p></p>` },
{ src: "images/azuli/thumb/95thumb.webp", full: "images/azuli/full/95full.webp", caption: `<h2>//img.[AZL].#095</h2><p></p>` },
{ src: "images/azuli/thumb/96thumb.webp", full: "images/azuli/full/96full.webp", caption: `<h2>//img.[AZL].#096</h2><p></p>` },
{ src: "images/azuli/thumb/97thumb.webp", full: "images/azuli/full/97full.webp", caption: `<h2>//img.[AZL].#097</h2><p></p>` },
{ src: "images/azuli/thumb/98thumb.webp", full: "images/azuli/full/98full.webp", caption: `<h2>//img.[AZL].#098</h2><p></p>` },
{ src: "images/azuli/thumb/99thumb.webp", full: "images/azuli/full/99full.webp", caption: `<h2>//img.[AZL].#099</h2><p></p>` },
{ src: "images/azuli/thumb/100thumb.webp", full: "images/azuli/full/100full.webp", caption: `<h2>//img.[AZL].#100</h2><p></p>` },
{ src: "images/azuli/thumb/101thumb.webp", full: "images/azuli/full/101full.webp", caption: `<h2>//img.[AZL].#101</h2><p></p>` },
{ src: "images/azuli/thumb/102thumb.webp", full: "images/azuli/full/102full.webp", caption: `<h2>//img.[AZL].#102</h2><p></p>` },
{ src: "images/azuli/thumb/103thumb.webp", full: "images/azuli/full/103clip.mp4", caption: `<h2>//vid.[AZL].#103</h2><p></p>` },
{ src: "images/azuli/thumb/104thumb.webp", full: "images/azuli/full/104clip.mp4", caption: `<h2>//vid.[AZL].#104</h2><p></p>` },
      
    ],
  },

  
{
  type: "wall",
  html: `<img class="wall-logo" src="assets/Calilei.svg" alt="">`,
},


  {
  type: "desktop",
  items: [
    // Four empty folders, one per brand primary (tokens from
    // infiniteStyles.css :root). contents: [] authored explicitly so
    // filling them later is an edit, not a structural addition.

    { type: "folder", name: "calileiMusic", lineColor: "#000000", fillColor: "#ff4d00", 
      contents: [
      { type: "folder", name: "demos", lineColor: "#000000", fillColor: "#ff4d00", locked: true, password: "opensesame", contents: [] },
      { type: "md", name: "calileiNotation.md", lineColor: "#000000", fillColor: "#00d150",  src: "assets/md/calileiNotation.md" },
      { type: "md", name: "calileiVoice.md", lineColor: "#000000", fillColor: "#ffbb00",  src: "assets/md/calileiVoice.md", locked: true, password: "opensesame"  },
      { type: "md", name: "lineCombo.md", lineColor: "#000000", fillColor: "#ffffff",  src: "assets/md/lineCombo.md", locked: true, password: "opensesame"  },
      { type: "md", name: "comboBounce.md", lineColor: "#000000", fillColor: "#ffffff",  src: "assets/md/comboBounce.md", locked: true, password: "opensesame"  },
      { type: "md", name: "phoneticAppeal.md", lineColor: "#000000", fillColor: "#ffffff",  src: "assets/md/phoneticAppeal.md" },
      { type: "md", name: "callResponse.md", lineColor: "#000000", fillColor: "#ffffff",  src: "assets/md/callResponse.md" },
      { type: "md", name: "rhymingWords.md", lineColor: "#000000", fillColor: "#ffffff",  src: "assets/md/rhymingWords.md" },
      { type: "md", name: "prosodyMeter.md", lineColor: "#000000", fillColor: "#ffffff",  src: "assets/md/prosodyMeter.md" },
      { type: "md", name: "vividDiction.md", lineColor: "#000000", fillColor: "#ffffff",  src: "assets/md/vividDiction.md" },
      ],
    },

    { type: "folder", name: "texWax", lineColor: "#000000", fillColor: "#ffbb00", contents: [], 
      locked: true, password: "opensesame" 
    },

    { type: "folder", name: "calileiGame", lineColor: "#000000", fillColor: "#00d150", contents: [], 
      locked: true, password: "opensesame" 
    },

    { type: "folder", name: "calileiLabel", lineColor: "#000000", fillColor: "#00b8e6", contents: [], 
      locked: true, password: "opensesame" 
    },

    { type: "folder", name: "moodBoard", lineColor: "#000000", fillColor: "#dadada", contents: [], 
      locked: true, password: "opensesame" 
    },

    { type: "image", name: "calilei.jpg", src: "images/base/full/4full.webp", thumb: "images/base/thumb/4thumb.webp" },

    // The greeting — opens automatically on page load (openOnLoad),
    // positioned upper-right. x/y are fractions of the desktop surface;
    // w/h are pixels. Content is placeholder voice — rewrite freely.
    { type: "md", name: "hello.md", lineColor: "#000000", fillColor: "#ffffff",
      openOnLoad: { x: 0.58, y: 0.05, w: 480, h: 340 },
      content: "## //HELLO.[DESKTOP]\n\n> welcome to my desk.\n\n- drag things. open things.\n- drop things into folders.\n\nnothing persists — reload resets the room.\n\nstatus: _locked_\n\nThe content on this page is currently under construction" },
  ],
},

{ type: "hud", headline: "THANK.YOU", url: "calilei 2026" },

//{
//    type: "game",
//    debug: true,
//    html: `
//      <p class="game-kicker">PLAYABLE / CALILEIGAME</p>
//      <p class="game-hint">WASD / ARROWS move &middot; SPACE jump &middot; DOWN crouch / drop</p>
//    `,
//  },

];

// 1. Build the spacers + overlays, kick off the per-frame loop.
start(PANELS);

// 2. Now that overlays exist in the DOM, attach scenes. The scene system
//    finds each scene's anchor element (the panel's overlay) by querying
//    #infinite-overlays for data-index=<i>. It also registers its own per-
//    frame hook with the core, so from the next frame onward, scenes update
//    and render as part of the main loop.
bootstrapScenes(PANELS);

initScrollIndicator(); 

initMusicPlayer();

// Sidebar
initSidebar({
  initial: "home",
  views:  [homeView, aboutView, ethosView, projectsView, processView, shopView, contactView],
});