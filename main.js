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
    <p class="dots-body"><br>- CURRENTLY:<br> 3D DESIGNER / AI SPECIALIST<br>@ NOABRANDS - (FUSION)</p>
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
    <p class="turn-body">> ROOTED IN SOIL<br>> POINTED AT THE STARS</p>
  </div>
  <div class="turn-controls">
    <button class="turn-btn turn-btn--ghost turn-btn--minor" data-action="info">OPEN INFO</button>
    <button class="turn-btn turn-btn--ghost turn-btn--major" data-action="grid">[ VIEW.GRID ]</button>
  </div>`,
    infoHtml: `
      <p class="turn-info-kicker">PORTFOLIO ENTRY / 01</p>
      <h2 class="turn-info-heading">BASE</h2>
      <div class="turn-info-text">
        <p>This info sheet modal is currently under construction.</p>
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
      
      { src: "images/base/thumb/1thumb.webp", full: "images/base/full/1full.webp", caption: `<h2>Image 1</h2><p>Caption for image 1.</p>` },
      { src: "images/base/thumb/2thumb.webp", full: "images/base/full/2full.webp", caption: `<h2>Image 2</h2><p>Caption for image 2.</p>` },
      { src: "images/base/thumb/3thumb.webp", full: "images/base/full/3full.webp", caption: `<h2>Image 3</h2><p>Caption for image 3.</p>` },
      { src: "images/base/thumb/4thumb.webp", full: "images/base/full/4full.webp", caption: `<h2>Image 4</h2><p>Caption for image 4.</p>` },
      { src: "images/base/thumb/5thumb.webp", full: "images/base/full/5full.webp", caption: `<h2>Image 5</h2><p>Caption for image 5.</p>` },
      { src: "images/base/thumb/6thumb.webp", full: "images/base/full/6full.webp", caption: `<h2>Image 6</h2><p>Caption for image 6.</p>` },
      { src: "images/base/thumb/7thumb.webp", full: "images/base/full/7full.webp", caption: `<h2>Image 7</h2><p>Caption for image 7.</p>` },
      { src: "images/base/thumb/8thumb.webp", full: "images/base/full/8full.webp", caption: `<h2>Image 8</h2><p>Caption for image 8.</p>` },
      { src: "images/base/thumb/9thumb.webp", full: "images/base/full/9full.webp", caption: `<h2>Image 9</h2><p>Caption for image 9.</p>` },
      { src: "images/base/thumb/10thumb.webp", full: "images/base/full/10full.webp", caption: `<h2>Image 10</h2><p>Caption for image 10.</p>` },
      { src: "images/base/thumb/11thumb.webp", full: "images/base/full/11full.webp", caption: `<h2>Image 11</h2><p>Caption for image 11.</p>` },
      { src: "images/base/thumb/12thumb.webp", full: "images/base/full/12full.webp", caption: `<h2>Image 12</h2><p>Caption for image 12.</p>` },
      { src: "images/base/thumb/13thumb.webp", full: "images/base/full/13full.webp", caption: `<h2>Image 13</h2><p>Caption for image 13.</p>` },
      { src: "images/base/thumb/14thumb.webp", full: "images/base/full/14full.webp", caption: `<h2>Image 14</h2><p>Caption for image 14.</p>` },
      { src: "images/base/thumb/15thumb.webp", full: "images/base/full/15full.webp", caption: `<h2>Image 15</h2><p>Caption for image 15.</p>` },
      { src: "images/base/thumb/16thumb.webp", full: "images/base/full/16full.webp", caption: `<h2>Image 16</h2><p>Caption for image 16.</p>` },
      { src: "images/base/thumb/17thumb.webp", full: "images/base/full/17full.webp", caption: `<h2>Image 17</h2><p>Caption for image 17.</p>` },
      { src: "images/base/thumb/18thumb.webp", full: "images/base/full/18full.webp", caption: `<h2>Image 18</h2><p>Caption for image 18.</p>` },
      { src: "images/base/thumb/19thumb.webp", full: "images/base/full/19full.webp", caption: `<h2>Image 19</h2><p>Caption for image 19.</p>` },
      { src: "images/base/thumb/20thumb.webp", full: "images/base/full/20full.webp", caption: `<h2>Image 20</h2><p>Caption for image 20.</p>` },
      { src: "images/base/thumb/21thumb.webp", full: "images/base/full/21full.webp", caption: `<h2>Image 21</h2><p>Caption for image 21.</p>` },
      { src: "images/base/thumb/22thumb.webp", full: "images/base/full/22full.webp", caption: `<h2>Image 22</h2><p>Caption for image 22.</p>` },
      { src: "images/base/thumb/23thumb.webp", full: "images/base/full/23full.webp", caption: `<h2>Image 23</h2><p>Caption for image 23.</p>` },
      { src: "images/base/thumb/24thumb.webp", full: "images/base/full/24full.webp", caption: `<h2>Image 24</h2><p>Caption for image 24.</p>` },
      { src: "images/base/thumb/25thumb.webp", full: "images/base/full/25full.webp", caption: `<h2>Image 25</h2><p>Caption for image 25.</p>` },
      { src: "images/base/thumb/26thumb.webp", full: "images/base/full/26full.webp", caption: `<h2>Image 26</h2><p>Caption for image 26.</p>` },
      { src: "images/base/thumb/27thumb.webp", full: "images/base/full/27full.webp", caption: `<h2>Image 27</h2><p>Caption for image 27.</p>` },
      { src: "images/base/thumb/28thumb.webp", full: "images/base/full/28full.webp", caption: `<h2>Image 28</h2><p>Caption for image 28.</p>` },
      { src: "images/base/thumb/29thumb.webp", full: "images/base/full/29full.webp", caption: `<h2>Image 29</h2><p>Caption for image 29.</p>` },
      { src: "images/base/thumb/30thumb.webp", full: "images/base/full/30full.webp", caption: `<h2>Image 30</h2><p>Caption for image 30.</p>` },
      { src: "images/base/thumb/31thumb.webp", full: "images/base/full/31full.webp", caption: `<h2>Image 31</h2><p>Caption for image 31.</p>` },
      { src: "images/base/thumb/32thumb.webp", full: "images/base/full/32full.webp", caption: `<h2>Image 32</h2><p>Caption for image 32.</p>` },
      { src: "images/base/thumb/33thumb.webp", full: "images/base/full/33full.webp", caption: `<h2>Image 33</h2><p>Caption for image 33.</p>` },
      { src: "images/base/thumb/34thumb.webp", full: "images/base/full/34full.webp", caption: `<h2>Image 34</h2><p>Caption for image 34.</p>` },
      { src: "images/base/thumb/35thumb.webp", full: "images/base/full/35full.webp", caption: `<h2>Image 35</h2><p>Caption for image 35.</p>` },
      { src: "images/base/thumb/36thumb.webp", full: "images/base/full/36full.webp", caption: `<h2>Image 36</h2><p>Caption for image 36.</p>` },
      { src: "images/base/thumb/37thumb.webp", full: "images/base/full/37full.webp", caption: `<h2>Image 37</h2><p>Caption for image 37.</p>` },
      { src: "images/base/thumb/38thumb.webp", full: "images/base/full/38full.webp", caption: `<h2>Image 38</h2><p>Caption for image 38.</p>` },
      { src: "images/base/thumb/39thumb.webp", full: "images/base/full/39full.webp", caption: `<h2>Image 39</h2><p>Caption for image 39.</p>` },
      { src: "images/base/thumb/40thumb.webp", full: "images/base/full/40full.webp", caption: `<h2>Image 40</h2><p>Caption for image 40.</p>` },
      { src: "images/base/thumb/41thumb.webp", full: "images/base/full/41full.webp", caption: `<h2>Image 41</h2><p>Caption for image 41.</p>` },
      { src: "images/base/thumb/42thumb.webp", full: "images/base/full/42full.webp", caption: `<h2>Image 42</h2><p>Caption for image 42.</p>` },
      { src: "images/base/thumb/43thumb.webp", full: "images/base/full/43full.webp", caption: `<h2>Image 43</h2><p>Caption for image 43.</p>` },
      { src: "images/base/thumb/44thumb.webp", full: "images/base/full/44full.webp", caption: `<h2>Image 44</h2><p>Caption for image 44.</p>` },
      { src: "images/base/thumb/45thumb.webp", full: "images/base/full/45full.webp", caption: `<h2>Image 45</h2><p>Caption for image 45.</p>` },
      { src: "images/base/thumb/46thumb.webp", full: "images/base/full/46full.webp", caption: `<h2>Image 46</h2><p>Caption for image 46.</p>` },
      { src: "images/base/thumb/47thumb.webp", full: "images/base/full/47full.webp", caption: `<h2>Image 47</h2><p>Caption for image 47.</p>` },
      { src: "images/base/thumb/48thumb.webp", full: "images/base/full/48full.webp", caption: `<h2>Image 48</h2><p>Caption for image 48.</p>` },
      { src: "images/base/thumb/49thumb.webp", full: "images/base/full/49full.webp", caption: `<h2>Image 49</h2><p>Caption for image 49.</p>` },
      { src: "images/base/thumb/50thumb.webp", full: "images/base/full/50full.webp", caption: `<h2>Image 50</h2><p>Caption for image 50.</p>` },
      { src: "images/base/thumb/51thumb.webp", full: "images/base/full/51full.webp", caption: `<h2>Image 51</h2><p>Caption for image 51.</p>` },
      { src: "images/base/thumb/52thumb.webp", full: "images/base/full/52full.webp", caption: `<h2>Image 52</h2><p>Caption for image 52.</p>` },
      { src: "images/base/thumb/53thumb.webp", full: "images/base/full/53full.webp", caption: `<h2>Image 53</h2><p>Caption for image 53.</p>` },
      { src: "images/base/thumb/54thumb.webp", full: "images/base/full/54full.webp", caption: `<h2>Image 54</h2><p>Caption for image 54.</p>` },
      { src: "images/base/thumb/55thumb.webp", full: "images/base/full/55full.webp", caption: `<h2>Image 55</h2><p>Caption for image 55.</p>` },
      { src: "images/base/thumb/56thumb.webp", full: "images/base/full/56full.webp", caption: `<h2>Image 56</h2><p>Caption for image 56.</p>` },
      { src: "images/base/thumb/57thumb.webp", full: "images/base/full/57full.webp", caption: `<h2>Image 57</h2><p>Caption for image 57.</p>` },
      { src: "images/base/thumb/58thumb.webp", full: "images/base/full/58full.webp", caption: `<h2>Image 58</h2><p>Caption for image 58.</p>` },
      { src: "images/base/thumb/59thumb.webp", full: "images/base/full/59full.webp", caption: `<h2>Image 59</h2><p>Caption for image 59.</p>` },
      { src: "images/base/thumb/60thumb.webp", full: "images/base/full/60full.webp", caption: `<h2>Image 60</h2><p>Caption for image 60.</p>` },
      { src: "images/base/thumb/61thumb.webp", full: "images/base/full/61full.webp", caption: `<h2>Image 61</h2><p>Caption for image 61.</p>` },
      { src: "images/base/thumb/62thumb.webp", full: "images/base/full/62full.webp", caption: `<h2>Image 62</h2><p>Caption for image 62.</p>` },
      { src: "images/base/thumb/63thumb.webp", full: "images/base/full/63full.webp", caption: `<h2>Image 63</h2><p>Caption for image 63.</p>` },
      { src: "images/base/thumb/64thumb.webp", full: "images/base/full/64full.webp", caption: `<h2>Image 64</h2><p>Caption for image 64.</p>` },
      { src: "images/base/thumb/65thumb.webp", full: "images/base/full/65full.webp", caption: `<h2>Image 65</h2><p>Caption for image 65.</p>` },
      { src: "images/base/thumb/66thumb.webp", full: "images/base/full/66full.webp", caption: `<h2>Image 66</h2><p>Caption for image 66.</p>` },
      { src: "images/base/thumb/67thumb.webp", full: "images/base/full/67full.webp", caption: `<h2>Image 67</h2><p>Caption for image 67.</p>` },
      { src: "images/base/thumb/68thumb.webp", full: "images/base/full/68full.webp", caption: `<h2>Image 68</h2><p>Caption for image 68.</p>` },
      { src: "images/base/thumb/69thumb.webp", full: "images/base/full/69full.webp", caption: `<h2>Image 69</h2><p>Caption for image 69.</p>` },
      { src: "images/base/thumb/70thumb.webp", full: "images/base/full/70full.webp", caption: `<h2>Image 70</h2><p>Caption for image 70.</p>` },
      { src: "images/base/thumb/71thumb.webp", full: "images/base/full/71full.webp", caption: `<h2>Image 71</h2><p>Caption for image 71.</p>` },
      { src: "images/base/thumb/72thumb.webp", full: "images/base/full/72full.webp", caption: `<h2>Image 72</h2><p>Caption for image 72.</p>` },
      { src: "images/base/thumb/73thumb.webp", full: "images/base/full/73full.webp", caption: `<h2>Image 73</h2><p>Caption for image 73.</p>` },
      { src: "images/base/thumb/74thumb.webp", full: "images/base/full/74full.webp", caption: `<h2>Image 74</h2><p>Caption for image 74.</p>` },
      { src: "images/base/thumb/75thumb.webp", full: "images/base/full/75full.webp", caption: `<h2>Image 75</h2><p>Caption for image 75.</p>` },
      { src: "images/base/thumb/76thumb.webp", full: "images/base/full/76full.webp", caption: `<h2>Image 76</h2><p>Caption for image 76.</p>` },
      { src: "images/base/thumb/77thumb.webp", full: "images/base/full/77full.webp", caption: `<h2>Image 77</h2><p>Caption for image 77.</p>` },
      { src: "images/base/thumb/78thumb.webp", full: "images/base/full/78full.webp", caption: `<h2>Image 78</h2><p>Caption for image 78.</p>` },
      { src: "images/base/thumb/79thumb.webp", full: "images/base/full/79full.webp", caption: `<h2>Image 79</h2><p>Caption for image 79.</p>` },
      { src: "images/base/thumb/80thumb.webp", full: "images/base/full/80full.webp", caption: `<h2>Image 80</h2><p>Caption for image 80.</p>` },
      { src: "images/base/thumb/81thumb.webp", full: "images/base/full/81full.webp", caption: `<h2>Image 81</h2><p>Caption for image 81.</p>` },
      { src: "images/base/thumb/82thumb.webp", full: "images/base/full/82full.webp", caption: `<h2>Image 82</h2><p>Caption for image 82.</p>` },
      { src: "images/base/thumb/83thumb.webp", full: "images/base/full/83full.webp", caption: `<h2>Image 83</h2><p>Caption for image 83.</p>` },
      { src: "images/base/thumb/84thumb.webp", full: "images/base/full/84full.webp", caption: `<h2>Image 84</h2><p>Caption for image 84.</p>` },
      { src: "images/base/thumb/85thumb.webp", full: "images/base/full/85full.webp", caption: `<h2>Image 85</h2><p>Caption for image 85.</p>` },
      { src: "images/base/thumb/86thumb.webp", full: "images/base/full/86full.webp", caption: `<h2>Image 86</h2><p>Caption for image 86.</p>` },
      { src: "images/base/thumb/87thumb.webp", full: "images/base/full/87full.webp", caption: `<h2>Image 87</h2><p>Caption for image 87.</p>` },
      { src: "images/base/thumb/88thumb.webp", full: "images/base/full/88full.webp", caption: `<h2>Image 88</h2><p>Caption for image 88.</p>` },
      { src: "images/base/thumb/89thumb.webp", full: "images/base/full/89full.webp", caption: `<h2>Image 89</h2><p>Caption for image 89.</p>` },
      { src: "images/base/thumb/90thumb.webp", full: "images/base/full/90full.webp", caption: `<h2>Image 90</h2><p>Caption for image 90.</p>` },
      { src: "images/base/thumb/91thumb.webp", full: "images/base/full/91full.webp", caption: `<h2>Image 91</h2><p>Caption for image 91.</p>` },
      { src: "images/base/thumb/92thumb.webp", full: "images/base/full/92full.webp", caption: `<h2>Image 92</h2><p>Caption for image 92.</p>` },
      { src: "images/base/thumb/93thumb.webp", full: "images/base/full/93full.webp", caption: `<h2>Image 93</h2><p>Caption for image 93.</p>` },
      { src: "images/base/thumb/94thumb.webp", full: "images/base/full/94full.webp", caption: `<h2>Image 94</h2><p>Caption for image 94.</p>` },
      { src: "images/base/thumb/95thumb.webp", full: "images/base/full/95full.webp", caption: `<h2>Image 95</h2><p>Caption for image 95.</p>` },
      { src: "images/base/thumb/96thumb.webp", full: "images/base/full/96full.webp", caption: `<h2>Image 96</h2><p>Caption for image 96.</p>` },
      { src: "images/base/thumb/97thumb.webp", full: "images/base/full/97full.webp", caption: `<h2>Image 97</h2><p>Caption for image 97.</p>` },
      { src: "images/base/thumb/98thumb.webp", full: "images/base/full/98full.webp", caption: `<h2>Image 98</h2><p>Caption for image 98.</p>` },
      { src: "images/base/thumb/99thumb.webp", full: "images/base/full/99full.webp", caption: `<h2>Image 99</h2><p>Caption for image 99.</p>` },
      { src: "images/base/thumb/100thumb.webp", full: "images/base/full/100full.webp", caption: `<h2>Image 100</h2><p>Caption for image 100.</p>` },
      { src: "images/base/thumb/101thumb.webp", full: "images/base/full/101full.webp", caption: `<h2>Image 101</h2><p>Caption for image 101.</p>` },
      { src: "images/base/thumb/102thumb.webp", full: "images/base/full/102full.webp", caption: `<h2>Image 102</h2><p>Caption for image 102.</p>` },
      { src: "images/base/thumb/103thumb.webp", full: "images/base/full/103full.webp", caption: `<h2>Image 103</h2><p>Caption for image 103.</p>` },
      { src: "images/base/thumb/104thumb.webp", full: "images/base/full/104full.webp", caption: `<h2>Image 104</h2><p>Caption for image 104.</p>` },
      { src: "images/base/thumb/105thumb.webp", full: "images/base/full/105full.webp", caption: `<h2>Image 105</h2><p>Caption for image 105.</p>` },
      { src: "images/base/thumb/106thumb.webp", full: "images/base/full/106full.webp", caption: `<h2>Image 106</h2><p>Caption for image 106.</p>` },
      { src: "images/base/thumb/107thumb.webp", full: "images/base/full/107full.webp", caption: `<h2>Image 107</h2><p>Caption for image 107.</p>` },
      { src: "images/base/thumb/108thumb.webp", full: "images/base/full/108full.webp", caption: `<h2>Image 108</h2><p>Caption for image 108.</p>` },
      { src: "images/base/thumb/109thumb.webp", full: "images/base/full/109full.webp", caption: `<h2>Image 109</h2><p>Caption for image 109.</p>` },
      { src: "images/base/thumb/110thumb.webp", full: "images/base/full/110full.webp", caption: `<h2>Image 110</h2><p>Caption for image 110.</p>` },
      { src: "images/base/thumb/111thumb.webp", full: "images/base/full/111full.webp", caption: `<h2>Image 111</h2><p>Caption for image 111.</p>` },
      { src: "images/base/thumb/112thumb.webp", full: "images/base/full/112full.webp", caption: `<h2>Image 112</h2><p>Caption for image 112.</p>` },
      { src: "images/base/thumb/113thumb.webp", full: "images/base/full/113full.webp", caption: `<h2>Image 113</h2><p>Caption for image 113.</p>` },
      { src: "images/base/thumb/114thumb.webp", full: "images/base/full/114full.webp", caption: `<h2>Image 114</h2><p>Caption for image 114.</p>` },
      { src: "images/base/thumb/115thumb.webp", full: "images/base/full/115full.webp", caption: `<h2>Image 115</h2><p>Caption for image 115.</p>` },
      { src: "images/base/thumb/116thumb.webp", full: "images/base/full/116full.webp", caption: `<h2>Image 116</h2><p>Caption for image 116.</p>` },
      { src: "images/base/thumb/117thumb.webp", full: "images/base/full/117full.webp", caption: `<h2>Image 117</h2><p>Caption for image 117.</p>` },
      { src: "images/base/thumb/118thumb.webp", full: "images/base/full/118full.webp", caption: `<h2>Image 118</h2><p>Caption for image 118.</p>` },
      { src: "images/base/thumb/119thumb.webp", full: "images/base/full/119full.webp", caption: `<h2>Image 119</h2><p>Caption for image 119.</p>` },
      { src: "images/base/thumb/120thumb.webp", full: "images/base/full/120full.webp", caption: `<h2>Image 120</h2><p>Caption for image 120.</p>` },
      { src: "images/base/thumb/121thumb.webp", full: "images/base/full/121full.webp", caption: `<h2>Image 121</h2><p>Caption for image 121.</p>` },
      { src: "images/base/thumb/122thumb.webp", full: "images/base/full/122full.webp", caption: `<h2>Image 122</h2><p>Caption for image 122.</p>` },
      { src: "images/base/thumb/123thumb.webp", full: "images/base/full/123full.webp", caption: `<h2>Image 123</h2><p>Caption for image 123.</p>` },
      { src: "images/base/thumb/124thumb.webp", full: "images/base/full/124full.webp", caption: `<h2>Image 124</h2><p>Caption for image 124.</p>` },
      { src: "images/base/thumb/125thumb.webp", full: "images/base/full/125full.webp", caption: `<h2>Image 125</h2><p>Caption for image 125.</p>` },
      { src: "images/base/thumb/126thumb.webp", full: "images/base/full/126full.webp", caption: `<h2>Image 126</h2><p>Caption for image 126.</p>` },
      { src: "images/base/thumb/127thumb.webp", full: "images/base/full/127full.webp", caption: `<h2>Image 127</h2><p>Caption for image 127.</p>` },
      { src: "images/base/thumb/128thumb.webp", full: "images/base/full/128full.webp", caption: `<h2>Image 128</h2><p>Caption for image 128.</p>` },
      { src: "images/base/thumb/129thumb.webp", full: "images/base/full/129full.webp", caption: `<h2>Image 129</h2><p>Caption for image 129.</p>` },
      { src: "images/base/thumb/130thumb.webp", full: "images/base/full/130full.webp", caption: `<h2>Image 130</h2><p>Caption for image 130.</p>` },
      { src: "images/base/thumb/131thumb.webp", full: "images/base/full/131full.webp", caption: `<h2>Image 131</h2><p>Caption for image 131.</p>` },
      { src: "images/base/thumb/132thumb.webp", full: "images/base/full/132full.webp", caption: `<h2>Image 132</h2><p>Caption for image 132.</p>` },
      { src: "images/base/thumb/133thumb.webp", full: "images/base/full/133full.webp", caption: `<h2>Image 133</h2><p>Caption for image 133.</p>` },
      { src: "images/base/thumb/134thumb.webp", full: "images/base/full/134full.webp", caption: `<h2>Image 134</h2><p>Caption for image 134.</p>` },
      { src: "images/base/thumb/135thumb.webp", full: "images/base/full/135full.webp", caption: `<h2>Image 135</h2><p>Caption for image 135.</p>` },
      { src: "images/base/thumb/136thumb.webp", full: "images/base/full/136full.webp", caption: `<h2>Image 136</h2><p>Caption for image 136.</p>` },
      { src: "images/base/thumb/137thumb.webp", full: "images/base/full/137full.webp", caption: `<h2>Image 137</h2><p>Caption for image 137.</p>` },
      { src: "images/base/thumb/138thumb.webp", full: "images/base/full/138full.webp", caption: `<h2>Image 138</h2><p>Caption for image 138.</p>` },
      { src: "images/base/thumb/139thumb.webp", full: "images/base/full/139full.webp", caption: `<h2>Image 139</h2><p>Caption for image 139.</p>` },
      { src: "images/base/thumb/140thumb.webp", full: "images/base/full/140full.webp", caption: `<h2>Image 140</h2><p>Caption for image 140.</p>` },
      { src: "images/base/thumb/141thumb.webp", full: "images/base/full/141full.webp", caption: `<h2>Image 141</h2><p>Caption for image 141.</p>` },
      { src: "images/base/thumb/142thumb.webp", full: "images/base/full/142full.webp", caption: `<h2>Image 142</h2><p>Caption for image 142.</p>` },
      { src: "images/base/thumb/143thumb.webp", full: "images/base/full/143full.webp", caption: `<h2>Image 143</h2><p>Caption for image 143.</p>` },
      { src: "images/base/thumb/144thumb.webp", full: "images/base/full/144full.webp", caption: `<h2>Image 144</h2><p>Caption for image 144.</p>` },
      { src: "images/base/thumb/1clipthumb.webp", full: "images/base/clip/1clip.mp4", caption: `<h2>Video 1</h2><p>Caption for video 1.</p>` },
      { src: "images/base/thumb/1clipthumb.webp", full: "images/base/clip/1clip.mp4", caption: `<h2>Video 1</h2><p>Caption for video 1.</p>` },
{ src: "images/base/thumb/2clipthumb.webp", full: "images/base/clip/2clip.mp4", caption: `<h2>Video 2</h2><p>Caption for video 2.</p>` },
{ src: "images/base/thumb/3clipthumb.webp", full: "images/base/clip/3clip.mp4", caption: `<h2>Video 3</h2><p>Caption for video 3.</p>` },
{ src: "images/base/thumb/4clipthumb.webp", full: "images/base/clip/4clip.mp4", caption: `<h2>Video 4</h2><p>Caption for video 4.</p>` },
{ src: "images/base/thumb/5clipthumb.webp", full: "images/base/clip/5clip.mp4", caption: `<h2>Video 5</h2><p>Caption for video 5.</p>` },
{ src: "images/base/thumb/6clipthumb.webp", full: "images/base/clip/6clip.mp4", caption: `<h2>Video 6</h2><p>Caption for video 6.</p>` },
{ src: "images/base/thumb/7clipthumb.webp", full: "images/base/clip/7clip.mp4", caption: `<h2>Video 7</h2><p>Caption for video 7.</p>` },
{ src: "images/base/thumb/8clipthumb.webp", full: "images/base/clip/8clip.mp4", caption: `<h2>Video 8</h2><p>Caption for video 8.</p>` },
{ src: "images/base/thumb/9clipthumb.webp", full: "images/base/clip/9clip.mp4", caption: `<h2>Video 9</h2><p>Caption for video 9.</p>` },
{ src: "images/base/thumb/10clipthumb.webp", full: "images/base/clip/10clip.mp4", caption: `<h2>Video 10</h2><p>Caption for video 10.</p>` },
{ src: "images/base/thumb/11clipthumb.webp", full: "images/base/clip/11clip.mp4", caption: `<h2>Video 11</h2><p>Caption for video 11.</p>` },
{ src: "images/base/thumb/12clipthumb.webp", full: "images/base/clip/12clip.mp4", caption: `<h2>Video 12</h2><p>Caption for video 12.</p>` },
{ src: "images/base/thumb/13clipthumb.webp", full: "images/base/clip/13clip.mp4", caption: `<h2>Video 13</h2><p>Caption for video 13.</p>` },
{ src: "images/base/thumb/14clipthumb.webp", full: "images/base/clip/14clip.mp4", caption: `<h2>Video 14</h2><p>Caption for video 14.</p>` },
{ src: "images/base/thumb/15clipthumb.webp", full: "images/base/clip/15clip.mp4", caption: `<h2>Video 15</h2><p>Caption for video 15.</p>` },
{ src: "images/base/thumb/16clipthumb.webp", full: "images/base/clip/16clip.mp4", caption: `<h2>Video 16</h2><p>Caption for video 16.</p>` },
{ src: "images/base/thumb/17clipthumb.webp", full: "images/base/clip/17clip.mp4", caption: `<h2>Video 17</h2><p>Caption for video 17.</p>` },
{ src: "images/base/thumb/18clipthumb.webp", full: "images/base/clip/18clip.mp4", caption: `<h2>Video 18</h2><p>Caption for video 18.</p>` },
{ src: "images/base/thumb/19clipthumb.webp", full: "images/base/clip/19clip.mp4", caption: `<h2>Video 19</h2><p>Caption for video 19.</p>` },
{ src: "images/base/thumb/20clipthumb.webp", full: "images/base/clip/20clip.mp4", caption: `<h2>Video 20</h2><p>Caption for video 20.</p>` },
{ src: "images/base/thumb/21clipthumb.webp", full: "images/base/clip/21clip.mp4", caption: `<h2>Video 21</h2><p>Caption for video 21.</p>` },
{ src: "images/base/thumb/22clipthumb.webp", full: "images/base/clip/22clip.mp4", caption: `<h2>Video 22</h2><p>Caption for video 22.</p>` },
{ src: "images/base/thumb/23clipthumb.webp", full: "images/base/clip/23clip.mp4", caption: `<h2>Video 23</h2><p>Caption for video 23.</p>` },
{ src: "images/base/thumb/24clipthumb.webp", full: "images/base/clip/24clip.mp4", caption: `<h2>Video 24</h2><p>Caption for video 24.</p>` },
{ src: "images/base/thumb/25clipthumb.webp", full: "images/base/clip/25clip.mp4", caption: `<h2>Video 25</h2><p>Caption for video 25.</p>` },
      
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
    <p class="turn-body">> FROM THIS BOX<br>> CRUDE THINGS WILL COME</p>
  </div>
  <div class="turn-controls">
    <button class="turn-btn turn-btn--ghost turn-btn--minor" data-action="info">OPEN.INFO</button>
    <button class="turn-btn turn-btn--ghost turn-btn--major" data-action="grid">[ VIEW.GRID ]</button>
  </div>`,
    infoHtml: `
      <p class="turn-info-kicker">PORTFOLIO ENTRY / 02</p>
      <h2 class="turn-info-heading">CRUDEBOX</h2>
      <div class="turn-info-text">
        <p>This info sheet modal is currently under construction.</p>
      </div>`,
    gridImages: [
      
      { src: "images/crude/thumb/1thumb.webp", full: "images/crude/full/1full.webp", caption: `<h2>Image 1</h2><p>Caption for image 1.</p>` },
{ src: "images/crude/thumb/2thumb.webp", full: "images/crude/full/2full.webp", caption: `<h2>Image 2</h2><p>Caption for image 2.</p>` },
{ src: "images/crude/thumb/3thumb.webp", full: "images/crude/full/3full.webp", caption: `<h2>Image 3</h2><p>Caption for image 3.</p>` },
{ src: "images/crude/thumb/4thumb.webp", full: "images/crude/full/4full.webp", caption: `<h2>Image 4</h2><p>Caption for image 4.</p>` },
{ src: "images/crude/thumb/5thumb.webp", full: "images/crude/full/5full.webp", caption: `<h2>Image 5</h2><p>Caption for image 5.</p>` },
{ src: "images/crude/thumb/6thumb.webp", full: "images/crude/full/6full.webp", caption: `<h2>Image 6</h2><p>Caption for image 6.</p>` },
{ src: "images/crude/thumb/7thumb.webp", full: "images/crude/full/7full.webp", caption: `<h2>Image 7</h2><p>Caption for image 7.</p>` },
{ src: "images/crude/thumb/8thumb.webp", full: "images/crude/full/8full.webp", caption: `<h2>Image 8</h2><p>Caption for image 8.</p>` },
{ src: "images/crude/thumb/9thumb.webp", full: "images/crude/full/9full.webp", caption: `<h2>Image 9</h2><p>Caption for image 9.</p>` },
{ src: "images/crude/thumb/10thumb.webp", full: "images/crude/full/10full.webp", caption: `<h2>Image 10</h2><p>Caption for image 10.</p>` },
{ src: "images/crude/thumb/11thumb.webp", full: "images/crude/full/11full.webp", caption: `<h2>Image 11</h2><p>Caption for image 11.</p>` },
{ src: "images/crude/thumb/12thumb.webp", full: "images/crude/full/12full.webp", caption: `<h2>Image 12</h2><p>Caption for image 12.</p>` },
{ src: "images/crude/thumb/13thumb.webp", full: "images/crude/full/13full.webp", caption: `<h2>Image 13</h2><p>Caption for image 13.</p>` },
{ src: "images/crude/thumb/14thumb.webp", full: "images/crude/full/14full.webp", caption: `<h2>Image 14</h2><p>Caption for image 14.</p>` },
{ src: "images/crude/thumb/15thumb.webp", full: "images/crude/full/15full.webp", caption: `<h2>Image 15</h2><p>Caption for image 15.</p>` },
{ src: "images/crude/thumb/16thumb.webp", full: "images/crude/full/16full.webp", caption: `<h2>Image 16</h2><p>Caption for image 16.</p>` },
{ src: "images/crude/thumb/17thumb.webp", full: "images/crude/full/17full.webp", caption: `<h2>Image 17</h2><p>Caption for image 17.</p>` },
{ src: "images/crude/thumb/18thumb.webp", full: "images/crude/full/18full.webp", caption: `<h2>Image 18</h2><p>Caption for image 18.</p>` },
{ src: "images/crude/thumb/19thumb.webp", full: "images/crude/full/19full.webp", caption: `<h2>Image 19</h2><p>Caption for image 19.</p>` },
{ src: "images/crude/thumb/20thumb.webp", full: "images/crude/full/20full.webp", caption: `<h2>Image 20</h2><p>Caption for image 20.</p>` },
{ src: "images/crude/thumb/21thumb.webp", full: "images/crude/full/21full.webp", caption: `<h2>Image 21</h2><p>Caption for image 21.</p>` },
{ src: "images/crude/thumb/22thumb.webp", full: "images/crude/full/22full.webp", caption: `<h2>Image 22</h2><p>Caption for image 22.</p>` },
{ src: "images/crude/thumb/23thumb.webp", full: "images/crude/full/23full.webp", caption: `<h2>Image 23</h2><p>Caption for image 23.</p>` },
{ src: "images/crude/thumb/24thumb.webp", full: "images/crude/full/24full.webp", caption: `<h2>Image 24</h2><p>Caption for image 24.</p>` },
{ src: "images/crude/thumb/25thumb.webp", full: "images/crude/full/25full.webp", caption: `<h2>Image 25</h2><p>Caption for image 25.</p>` },
{ src: "images/crude/thumb/26thumb.webp", full: "images/crude/full/26full.webp", caption: `<h2>Image 26</h2><p>Caption for image 26.</p>` },
{ src: "images/crude/thumb/27thumb.webp", full: "images/crude/full/27full.webp", caption: `<h2>Image 27</h2><p>Caption for image 27.</p>` },
{ src: "images/crude/thumb/28thumb.webp", full: "images/crude/full/28full.webp", caption: `<h2>Image 28</h2><p>Caption for image 28.</p>` },
{ src: "images/crude/thumb/29thumb.webp", full: "images/crude/full/29full.webp", caption: `<h2>Image 29</h2><p>Caption for image 29.</p>` },
{ src: "images/crude/thumb/30thumb.webp", full: "images/crude/full/30full.webp", caption: `<h2>Image 30</h2><p>Caption for image 30.</p>` },
{ src: "images/crude/thumb/31thumb.webp", full: "images/crude/full/31full.webp", caption: `<h2>Image 31</h2><p>Caption for image 31.</p>` },
{ src: "images/crude/thumb/32thumb.webp", full: "images/crude/full/32full.webp", caption: `<h2>Image 32</h2><p>Caption for image 32.</p>` },
{ src: "images/crude/thumb/33thumb.webp", full: "images/crude/full/33full.webp", caption: `<h2>Image 33</h2><p>Caption for image 33.</p>` },
{ src: "images/crude/thumb/34thumb.webp", full: "images/crude/full/34full.webp", caption: `<h2>Image 34</h2><p>Caption for image 34.</p>` },
{ src: "images/crude/thumb/35thumb.webp", full: "images/crude/full/35full.webp", caption: `<h2>Image 35</h2><p>Caption for image 35.</p>` },
{ src: "images/crude/thumb/36thumb.webp", full: "images/crude/full/36full.webp", caption: `<h2>Image 36</h2><p>Caption for image 36.</p>` },
{ src: "images/crude/thumb/37thumb.webp", full: "images/crude/full/37full.webp", caption: `<h2>Image 37</h2><p>Caption for image 37.</p>` },
{ src: "images/crude/thumb/38thumb.webp", full: "images/crude/full/38full.webp", caption: `<h2>Image 38</h2><p>Caption for image 38.</p>` },
{ src: "images/crude/thumb/39thumb.webp", full: "images/crude/full/39full.webp", caption: `<h2>Image 39</h2><p>Caption for image 39.</p>` },
{ src: "images/crude/thumb/40thumb.webp", full: "images/crude/full/40full.webp", caption: `<h2>Image 40</h2><p>Caption for image 40.</p>` },
{ src: "images/crude/thumb/41thumb.webp", full: "images/crude/full/41full.webp", caption: `<h2>Image 41</h2><p>Caption for image 41.</p>` },
{ src: "images/crude/thumb/42thumb.webp", full: "images/crude/full/42full.webp", caption: `<h2>Image 42</h2><p>Caption for image 42.</p>` },
{ src: "images/crude/thumb/43thumb.webp", full: "images/crude/full/43full.webp", caption: `<h2>Image 43</h2><p>Caption for image 43.</p>` },
{ src: "images/crude/thumb/44thumb.webp", full: "images/crude/full/44full.webp", caption: `<h2>Image 44</h2><p>Caption for image 44.</p>` },
{ src: "images/crude/thumb/45thumb.webp", full: "images/crude/full/45full.webp", caption: `<h2>Image 45</h2><p>Caption for image 45.</p>` },
{ src: "images/crude/thumb/46thumb.webp", full: "images/crude/full/46full.webp", caption: `<h2>Image 46</h2><p>Caption for image 46.</p>` },
{ src: "images/crude/thumb/47thumb.webp", full: "images/crude/full/47full.webp", caption: `<h2>Image 47</h2><p>Caption for image 47.</p>` },
{ src: "images/crude/thumb/48thumb.webp", full: "images/crude/full/48full.webp", caption: `<h2>Image 48</h2><p>Caption for image 48.</p>` },
{ src: "images/crude/thumb/49thumb.webp", full: "images/crude/full/49full.webp", caption: `<h2>Image 49</h2><p>Caption for image 49.</p>` },
{ src: "images/crude/thumb/50thumb.webp", full: "images/crude/full/50full.webp", caption: `<h2>Image 50</h2><p>Caption for image 50.</p>` },
{ src: "images/crude/thumb/51thumb.webp", full: "images/crude/full/51full.webp", caption: `<h2>Image 51</h2><p>Caption for image 51.</p>` },
{ src: "images/crude/thumb/52thumb.webp", full: "images/crude/full/52full.webp", caption: `<h2>Image 52</h2><p>Caption for image 52.</p>` },
{ src: "images/crude/thumb/53thumb.webp", full: "images/crude/full/53full.webp", caption: `<h2>Image 53</h2><p>Caption for image 53.</p>` },
{ src: "images/crude/thumb/54thumb.webp", full: "images/crude/full/54full.webp", caption: `<h2>Image 54</h2><p>Caption for image 54.</p>` },
{ src: "images/crude/thumb/55thumb.webp", full: "images/crude/full/55full.webp", caption: `<h2>Image 55</h2><p>Caption for image 55.</p>` },
{ src: "images/crude/thumb/56thumb.webp", full: "images/crude/full/56full.webp", caption: `<h2>Image 56</h2><p>Caption for image 56.</p>` },
{ src: "images/crude/thumb/57thumb.webp", full: "images/crude/full/57full.webp", caption: `<h2>Image 57</h2><p>Caption for image 57.</p>` },
{ src: "images/crude/thumb/58thumb.webp", full: "images/crude/full/58full.webp", caption: `<h2>Image 58</h2><p>Caption for image 58.</p>` },
{ src: "images/crude/thumb/59thumb.webp", full: "images/crude/full/59full.webp", caption: `<h2>Image 59</h2><p>Caption for image 59.</p>` },
{ src: "images/crude/thumb/60thumb.webp", full: "images/crude/full/60full.webp", caption: `<h2>Image 60</h2><p>Caption for image 60.</p>` },
{ src: "images/crude/thumb/61thumb.webp", full: "images/crude/full/61full.webp", caption: `<h2>Image 61</h2><p>Caption for image 61.</p>` },
{ src: "images/crude/thumb/62thumb.webp", full: "images/crude/full/62full.webp", caption: `<h2>Image 62</h2><p>Caption for image 62.</p>` },
{ src: "images/crude/thumb/63thumb.webp", full: "images/crude/full/63full.webp", caption: `<h2>Image 63</h2><p>Caption for image 63.</p>` },
{ src: "images/crude/thumb/64thumb.webp", full: "images/crude/full/64full.webp", caption: `<h2>Image 64</h2><p>Caption for image 64.</p>` },
{ src: "images/crude/thumb/65thumb.webp", full: "images/crude/full/65full.webp", caption: `<h2>Image 65</h2><p>Caption for image 65.</p>` },
{ src: "images/crude/thumb/66thumb.webp", full: "images/crude/full/66full.webp", caption: `<h2>Image 66</h2><p>Caption for image 66.</p>` },
{ src: "images/crude/thumb/67thumb.webp", full: "images/crude/full/67full.webp", caption: `<h2>Image 67</h2><p>Caption for image 67.</p>` },
{ src: "images/crude/thumb/68thumb.webp", full: "images/crude/full/68full.webp", caption: `<h2>Image 68</h2><p>Caption for image 68.</p>` },
{ src: "images/crude/thumb/69thumb.webp", full: "images/crude/full/69full.webp", caption: `<h2>Image 69</h2><p>Caption for image 69.</p>` },
{ src: "images/crude/thumb/70thumb.webp", full: "images/crude/full/70full.webp", caption: `<h2>Image 70</h2><p>Caption for image 70.</p>` },
{ src: "images/crude/thumb/71thumb.webp", full: "images/crude/full/71full.webp", caption: `<h2>Image 71</h2><p>Caption for image 71.</p>` },
{ src: "images/crude/thumb/72thumb.webp", full: "images/crude/full/72full.webp", caption: `<h2>Image 72</h2><p>Caption for image 72.</p>` },
{ src: "images/crude/thumb/73thumb.webp", full: "images/crude/full/73full.webp", caption: `<h2>Image 73</h2><p>Caption for image 73.</p>` },
{ src: "images/crude/thumb/74thumb.webp", full: "images/crude/full/74full.webp", caption: `<h2>Image 74</h2><p>Caption for image 74.</p>` },
{ src: "images/crude/thumb/75thumb.webp", full: "images/crude/full/75full.webp", caption: `<h2>Image 75</h2><p>Caption for image 75.</p>` },
{ src: "images/crude/thumb/76thumb.webp", full: "images/crude/full/76full.webp", caption: `<h2>Image 76</h2><p>Caption for image 76.</p>` },
{ src: "images/crude/thumb/77thumb.webp", full: "images/crude/full/77full.webp", caption: `<h2>Image 77</h2><p>Caption for image 77.</p>` },
{ src: "images/crude/thumb/78thumb.webp", full: "images/crude/full/78full.webp", caption: `<h2>Image 78</h2><p>Caption for image 78.</p>` },
{ src: "images/crude/thumb/79thumb.webp", full: "images/crude/full/79full.webp", caption: `<h2>Image 79</h2><p>Caption for image 79.</p>` },
{ src: "images/crude/thumb/80thumb.webp", full: "images/crude/full/80full.webp", caption: `<h2>Image 80</h2><p>Caption for image 80.</p>` },
{ src: "images/crude/thumb/81thumb.webp", full: "images/crude/full/81full.webp", caption: `<h2>Image 81</h2><p>Caption for image 81.</p>` },
{ src: "images/crude/thumb/82thumb.webp", full: "images/crude/full/82full.webp", caption: `<h2>Image 82</h2><p>Caption for image 82.</p>` },
{ src: "images/crude/thumb/83thumb.webp", full: "images/crude/full/83full.webp", caption: `<h2>Image 83</h2><p>Caption for image 83.</p>` },
{ src: "images/crude/thumb/84thumb.webp", full: "images/crude/full/84full.webp", caption: `<h2>Image 84</h2><p>Caption for image 84.</p>` },
{ src: "images/crude/thumb/85thumb.webp", full: "images/crude/full/85full.webp", caption: `<h2>Image 85</h2><p>Caption for image 85.</p>` },
{ src: "images/crude/thumb/86thumb.webp", full: "images/crude/full/86full.webp", caption: `<h2>Image 86</h2><p>Caption for image 86.</p>` },
{ src: "images/crude/thumb/87thumb.webp", full: "images/crude/full/87full.webp", caption: `<h2>Image 87</h2><p>Caption for image 87.</p>` },
{ src: "images/crude/thumb/88thumb.webp", full: "images/crude/full/88full.webp", caption: `<h2>Image 88</h2><p>Caption for image 88.</p>` },
{ src: "images/crude/thumb/89thumb.webp", full: "images/crude/full/89full.webp", caption: `<h2>Image 89</h2><p>Caption for image 89.</p>` },
{ src: "images/crude/thumb/90thumb.webp", full: "images/crude/full/90full.webp", caption: `<h2>Image 90</h2><p>Caption for image 90.</p>` },
{ src: "images/crude/thumb/91thumb.webp", full: "images/crude/full/91full.webp", caption: `<h2>Image 91</h2><p>Caption for image 91.</p>` },
{ src: "images/crude/thumb/92thumb.webp", full: "images/crude/full/92full.webp", caption: `<h2>Image 92</h2><p>Caption for image 92.</p>` },
{ src: "images/crude/thumb/93thumb.webp", full: "images/crude/full/93full.webp", caption: `<h2>Image 93</h2><p>Caption for image 93.</p>` },
{ src: "images/crude/thumb/94thumb.webp", full: "images/crude/full/94full.webp", caption: `<h2>Image 94</h2><p>Caption for image 94.</p>` },
{ src: "images/crude/thumb/95thumb.webp", full: "images/crude/full/95full.webp", caption: `<h2>Image 95</h2><p>Caption for image 95.</p>` },
{ src: "images/crude/thumb/96thumb.webp", full: "images/crude/full/96full.webp", caption: `<h2>Image 96</h2><p>Caption for image 96.</p>` },
{ src: "images/crude/thumb/97thumb.webp", full: "images/crude/full/97full.webp", caption: `<h2>Image 97</h2><p>Caption for image 97.</p>` },
{ src: "images/crude/thumb/98thumb.webp", full: "images/crude/full/98full.webp", caption: `<h2>Image 98</h2><p>Caption for image 98.</p>` },
{ src: "images/crude/thumb/99thumb.webp", full: "images/crude/full/99full.webp", caption: `<h2>Image 99</h2><p>Caption for image 99.</p>` },
{ src: "images/crude/thumb/100thumb.webp", full: "images/crude/full/100full.webp", caption: `<h2>Image 100</h2><p>Caption for image 100.</p>` },
{ src: "images/crude/thumb/101thumb.webp", full: "images/crude/full/101full.webp", caption: `<h2>Image 101</h2><p>Caption for image 101.</p>` },
{ src: "images/crude/thumb/102thumb.webp", full: "images/crude/full/102full.webp", caption: `<h2>Image 102</h2><p>Caption for image 102.</p>` },
{ src: "images/crude/thumb/103thumb.webp", full: "images/crude/full/103full.webp", caption: `<h2>Image 103</h2><p>Caption for image 103.</p>` },
{ src: "images/crude/thumb/104thumb.webp", full: "images/crude/full/104full.webp", caption: `<h2>Image 104</h2><p>Caption for image 104.</p>` },
{ src: "images/crude/thumb/105thumb.webp", full: "images/crude/full/105full.webp", caption: `<h2>Image 105</h2><p>Caption for image 105.</p>` },
{ src: "images/crude/thumb/106thumb.webp", full: "images/crude/full/106full.webp", caption: `<h2>Image 106</h2><p>Caption for image 106.</p>` },
{ src: "images/crude/thumb/107thumb.webp", full: "images/crude/full/107full.webp", caption: `<h2>Image 107</h2><p>Caption for image 107.</p>` },
{ src: "images/crude/thumb/108thumb.webp", full: "images/crude/full/108full.webp", caption: `<h2>Image 108</h2><p>Caption for image 108.</p>` },
{ src: "images/crude/thumb/109thumb.webp", full: "images/crude/full/109full.webp", caption: `<h2>Image 109</h2><p>Caption for image 109.</p>` },
{ src: "images/crude/thumb/110thumb.webp", full: "images/crude/full/110full.webp", caption: `<h2>Image 110</h2><p>Caption for image 110.</p>` },
{ src: "images/crude/thumb/111thumb.webp", full: "images/crude/full/111full.webp", caption: `<h2>Image 111</h2><p>Caption for image 111.</p>` },
{ src: "images/crude/thumb/112thumb.webp", full: "images/crude/full/112full.webp", caption: `<h2>Image 112</h2><p>Caption for image 112.</p>` },
{ src: "images/crude/thumb/113thumb.webp", full: "images/crude/full/113full.webp", caption: `<h2>Image 113</h2><p>Caption for image 113.</p>` },
{ src: "images/crude/thumb/114thumb.webp", full: "images/crude/full/114full.webp", caption: `<h2>Image 114</h2><p>Caption for image 114.</p>` },
{ src: "images/crude/thumb/115thumb.webp", full: "images/crude/full/115full.webp", caption: `<h2>Image 115</h2><p>Caption for image 115.</p>` },
{ src: "images/crude/thumb/116thumb.webp", full: "images/crude/full/116full.webp", caption: `<h2>Image 116</h2><p>Caption for image 116.</p>` },
{ src: "images/crude/thumb/117thumb.webp", full: "images/crude/full/117full.webp", caption: `<h2>Image 117</h2><p>Caption for image 117.</p>` },
{ src: "images/crude/thumb/118thumb.webp", full: "images/crude/full/118full.webp", caption: `<h2>Image 118</h2><p>Caption for image 118.</p>` },
{ src: "images/crude/thumb/119thumb.webp", full: "images/crude/full/119full.webp", caption: `<h2>Image 119</h2><p>Caption for image 119.</p>` },
{ src: "images/crude/thumb/120thumb.webp", full: "images/crude/full/120full.webp", caption: `<h2>Image 120</h2><p>Caption for image 120.</p>` },
{ src: "images/crude/thumb/121thumb.webp", full: "images/crude/full/121full.webp", caption: `<h2>Image 121</h2><p>Caption for image 121.</p>` },
{ src: "images/crude/thumb/122thumb.webp", full: "images/crude/full/122full.webp", caption: `<h2>Image 122</h2><p>Caption for image 122.</p>` },
{ src: "images/crude/thumb/123thumb.webp", full: "images/crude/full/123full.webp", caption: `<h2>Image 123</h2><p>Caption for image 123.</p>` },
{ src: "images/crude/thumb/124thumb.webp", full: "images/crude/full/124full.webp", caption: `<h2>Image 124</h2><p>Caption for image 124.</p>` },
{ src: "images/crude/thumb/125thumb.webp", full: "images/crude/full/125full.webp", caption: `<h2>Image 125</h2><p>Caption for image 125.</p>` },
{ src: "images/crude/thumb/126thumb.webp", full: "images/crude/full/126full.webp", caption: `<h2>Image 126</h2><p>Caption for image 126.</p>` },
{ src: "images/crude/thumb/127thumb.webp", full: "images/crude/full/127full.webp", caption: `<h2>Image 127</h2><p>Caption for image 127.</p>` },
{ src: "images/crude/thumb/128thumb.webp", full: "images/crude/full/128full.webp", caption: `<h2>Image 128</h2><p>Caption for image 128.</p>` },
{ src: "images/crude/thumb/129thumb.webp", full: "images/crude/full/129full.webp", caption: `<h2>Image 129</h2><p>Caption for image 129.</p>` },
{ src: "images/crude/thumb/130thumb.webp", full: "images/crude/full/130full.webp", caption: `<h2>Image 130</h2><p>Caption for image 130.</p>` },
{ src: "images/crude/thumb/131thumb.webp", full: "images/crude/full/131full.webp", caption: `<h2>Image 131</h2><p>Caption for image 131.</p>` },
{ src: "images/crude/thumb/132thumb.webp", full: "images/crude/full/132full.webp", caption: `<h2>Image 132</h2><p>Caption for image 132.</p>` },
{ src: "images/crude/thumb/133thumb.webp", full: "images/crude/full/133full.webp", caption: `<h2>Image 133</h2><p>Caption for image 133.</p>` },
{ src: "images/crude/thumb/134thumb.webp", full: "images/crude/full/134full.webp", caption: `<h2>Image 134</h2><p>Caption for image 134.</p>` },
{ src: "images/crude/thumb/135thumb.webp", full: "images/crude/full/135full.webp", caption: `<h2>Image 135</h2><p>Caption for image 135.</p>` },
{ src: "images/crude/thumb/136thumb.webp", full: "images/crude/full/136full.webp", caption: `<h2>Image 136</h2><p>Caption for image 136.</p>` },
{ src: "images/crude/thumb/137thumb.webp", full: "images/crude/full/137full.webp", caption: `<h2>Image 137</h2><p>Caption for image 137.</p>` },
{ src: "images/crude/thumb/138thumb.webp", full: "images/crude/full/138full.webp", caption: `<h2>Image 138</h2><p>Caption for image 138.</p>` },
{ src: "images/crude/thumb/139thumb.webp", full: "images/crude/full/139full.webp", caption: `<h2>Image 139</h2><p>Caption for image 139.</p>` },
{ src: "images/crude/thumb/140thumb.webp", full: "images/crude/full/140full.webp", caption: `<h2>Image 140</h2><p>Caption for image 140.</p>` },
{ src: "images/crude/thumb/141thumb.webp", full: "images/crude/full/141full.webp", caption: `<h2>Image 141</h2><p>Caption for image 141.</p>` },
{ src: "images/crude/thumb/142thumb.webp", full: "images/crude/full/142full.webp", caption: `<h2>Image 142</h2><p>Caption for image 142.</p>` },
{ src: "images/crude/thumb/143thumb.webp", full: "images/crude/full/143full.webp", caption: `<h2>Image 143</h2><p>Caption for image 143.</p>` },
{ src: "images/crude/thumb/144thumb.webp", full: "images/crude/full/144full.webp", caption: `<h2>Image 144</h2><p>Caption for image 144.</p>` },
{ src: "images/crude/thumb/145thumb.webp", full: "images/crude/full/145full.webp", caption: `<h2>Image 145</h2><p>Caption for image 145.</p>` },
{ src: "images/crude/thumb/146thumb.webp", full: "images/crude/full/146full.webp", caption: `<h2>Image 146</h2><p>Caption for image 146.</p>` },
{ src: "images/crude/thumb/147thumb.webp", full: "images/crude/full/147full.webp", caption: `<h2>Image 147</h2><p>Caption for image 147.</p>` },
{ src: "images/crude/thumb/148thumb.webp", full: "images/crude/full/148full.webp", caption: `<h2>Image 148</h2><p>Caption for image 148.</p>` },
{ src: "images/crude/thumb/149thumb.webp", full: "images/crude/full/149full.webp", caption: `<h2>Image 149</h2><p>Caption for image 149.</p>` },
{ src: "images/crude/thumb/150thumb.webp", full: "images/crude/full/150full.webp", caption: `<h2>Image 150</h2><p>Caption for image 150.</p>` },
{ src: "images/crude/thumb/151thumb.webp", full: "images/crude/full/151full.webp", caption: `<h2>Image 151</h2><p>Caption for image 151.</p>` },
{ src: "images/crude/thumb/152thumb.webp", full: "images/crude/full/152full.webp", caption: `<h2>Image 152</h2><p>Caption for image 152.</p>` },
{ src: "images/crude/thumb/153thumb.webp", full: "images/crude/full/153full.webp", caption: `<h2>Image 153</h2><p>Caption for image 153.</p>` },
{ src: "images/crude/thumb/154thumb.webp", full: "images/crude/full/154full.webp", caption: `<h2>Image 154</h2><p>Caption for image 154.</p>` },
{ src: "images/crude/thumb/155thumb.webp", full: "images/crude/full/155full.webp", caption: `<h2>Image 155</h2><p>Caption for image 155.</p>` },
{ src: "images/crude/thumb/156thumb.webp", full: "images/crude/full/156full.webp", caption: `<h2>Image 156</h2><p>Caption for image 156.</p>` },
{ src: "images/crude/thumb/157thumb.webp", full: "images/crude/full/157full.webp", caption: `<h2>Image 157</h2><p>Caption for image 157.</p>` },
{ src: "images/crude/thumb/158thumb.webp", full: "images/crude/full/158full.webp", caption: `<h2>Image 158</h2><p>Caption for image 158.</p>` },
{ src: "images/crude/thumb/159thumb.webp", full: "images/crude/full/159full.webp", caption: `<h2>Image 159</h2><p>Caption for image 159.</p>` },
{ src: "images/crude/thumb/160thumb.webp", full: "images/crude/full/160full.webp", caption: `<h2>Image 160</h2><p>Caption for image 160.</p>` },
{ src: "images/crude/thumb/161thumb.webp", full: "images/crude/full/161full.webp", caption: `<h2>Image 161</h2><p>Caption for image 161.</p>` },
{ src: "images/crude/thumb/162thumb.webp", full: "images/crude/full/162full.webp", caption: `<h2>Image 162</h2><p>Caption for image 162.</p>` },
{ src: "images/crude/thumb/163thumb.webp", full: "images/crude/full/163full.webp", caption: `<h2>Image 163</h2><p>Caption for image 163.</p>` },
{ src: "images/crude/thumb/164thumb.webp", full: "images/crude/full/164full.webp", caption: `<h2>Image 164</h2><p>Caption for image 164.</p>` },
{ src: "images/crude/thumb/165thumb.webp", full: "images/crude/full/165full.webp", caption: `<h2>Image 165</h2><p>Caption for image 165.</p>` },
{ src: "images/crude/thumb/166thumb.webp", full: "images/crude/full/166full.webp", caption: `<h2>Image 166</h2><p>Caption for image 166.</p>` },
{ src: "images/crude/thumb/167thumb.webp", full: "images/crude/full/167full.webp", caption: `<h2>Image 167</h2><p>Caption for image 167.</p>` },
{ src: "images/crude/thumb/168thumb.webp", full: "images/crude/full/168full.webp", caption: `<h2>Image 168</h2><p>Caption for image 168.</p>` },
{ src: "images/crude/thumb/169thumb.webp", full: "images/crude/full/169full.webp", caption: `<h2>Image 169</h2><p>Caption for image 169.</p>` },
{ src: "images/crude/thumb/170thumb.webp", full: "images/crude/full/170full.webp", caption: `<h2>Image 170</h2><p>Caption for image 170.</p>` },
{ src: "images/crude/thumb/171thumb.webp", full: "images/crude/full/171full.webp", caption: `<h2>Image 171</h2><p>Caption for image 171.</p>` },
{ src: "images/crude/thumb/172thumb.webp", full: "images/crude/full/172full.webp", caption: `<h2>Image 172</h2><p>Caption for image 172.</p>` },
{ src: "images/crude/thumb/173thumb.webp", full: "images/crude/full/173full.webp", caption: `<h2>Image 173</h2><p>Caption for image 173.</p>` },
{ src: "images/crude/thumb/174thumb.webp", full: "images/crude/full/174full.webp", caption: `<h2>Image 174</h2><p>Caption for image 174.</p>` },
{ src: "images/crude/thumb/175thumb.webp", full: "images/crude/full/175full.webp", caption: `<h2>Image 175</h2><p>Caption for image 175.</p>` },
{ src: "images/crude/thumb/176thumb.webp", full: "images/crude/full/176full.webp", caption: `<h2>Image 176</h2><p>Caption for image 176.</p>` },
{ src: "images/crude/thumb/177thumb.webp", full: "images/crude/full/177full.webp", caption: `<h2>Image 177</h2><p>Caption for image 177.</p>` },
{ src: "images/crude/thumb/178thumb.webp", full: "images/crude/full/178full.webp", caption: `<h2>Image 178</h2><p>Caption for image 178.</p>` },
{ src: "images/crude/thumb/179thumb.webp", full: "images/crude/full/179full.webp", caption: `<h2>Image 179</h2><p>Caption for image 179.</p>` },
{ src: "images/crude/thumb/180thumb.webp", full: "images/crude/full/180full.webp", caption: `<h2>Image 180</h2><p>Caption for image 180.</p>` },
{ src: "images/crude/thumb/181thumb.webp", full: "images/crude/full/181full.webp", caption: `<h2>Image 181</h2><p>Caption for image 181.</p>` },
{ src: "images/crude/thumb/182thumb.webp", full: "images/crude/full/182full.webp", caption: `<h2>Image 182</h2><p>Caption for image 182.</p>` },
{ src: "images/crude/thumb/183thumb.webp", full: "images/crude/full/183full.webp", caption: `<h2>Image 183</h2><p>Caption for image 183.</p>` },
{ src: "images/crude/thumb/184thumb.webp", full: "images/crude/full/184full.webp", caption: `<h2>Image 184</h2><p>Caption for image 184.</p>` },
{ src: "images/crude/thumb/185thumb.webp", full: "images/crude/full/185full.webp", caption: `<h2>Image 185</h2><p>Caption for image 185.</p>` },
{ src: "images/crude/thumb/186thumb.webp", full: "images/crude/full/186full.webp", caption: `<h2>Image 186</h2><p>Caption for image 186.</p>` },
{ src: "images/crude/thumb/187thumb.webp", full: "images/crude/full/187full.webp", caption: `<h2>Image 187</h2><p>Caption for image 187.</p>` },
      
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
      <p class="turn-info-kicker">PORTFOLIO ENTRY / 03</p>
      <h2 class="turn-info-heading">AZULI</h2>
      <div class="turn-info-text">
        <p>This info sheet modal is currently under construction.</p>
      </div>`,
    gridImages: [
      
      { src: "images/azuli/thumb/1thumb.webp", full: "images/azuli/full/1full.webp", caption: `<h2>Image 1</h2><p>Caption for image 1.</p>` },
{ src: "images/azuli/thumb/2thumb.webp", full: "images/azuli/full/2full.webp", caption: `<h2>Image 2</h2><p>Caption for image 2.</p>` },
{ src: "images/azuli/thumb/3thumb.webp", full: "images/azuli/full/3full.webp", caption: `<h2>Image 3</h2><p>Caption for image 3.</p>` },
{ src: "images/azuli/thumb/4thumb.webp", full: "images/azuli/full/4full.webp", caption: `<h2>Image 4</h2><p>Caption for image 4.</p>` },
{ src: "images/azuli/thumb/5thumb.webp", full: "images/azuli/full/5full.webp", caption: `<h2>Image 5</h2><p>Caption for image 5.</p>` },
{ src: "images/azuli/thumb/6thumb.webp", full: "images/azuli/full/6full.webp", caption: `<h2>Image 6</h2><p>Caption for image 6.</p>` },
{ src: "images/azuli/thumb/7thumb.webp", full: "images/azuli/full/7full.webp", caption: `<h2>Image 7</h2><p>Caption for image 7.</p>` },
{ src: "images/azuli/thumb/8thumb.webp", full: "images/azuli/full/8full.webp", caption: `<h2>Image 8</h2><p>Caption for image 8.</p>` },
{ src: "images/azuli/thumb/9thumb.webp", full: "images/azuli/full/9full.webp", caption: `<h2>Image 9</h2><p>Caption for image 9.</p>` },
{ src: "images/azuli/thumb/10thumb.webp", full: "images/azuli/full/10full.webp", caption: `<h2>Image 10</h2><p>Caption for image 10.</p>` },
{ src: "images/azuli/thumb/11thumb.webp", full: "images/azuli/full/11full.webp", caption: `<h2>Image 11</h2><p>Caption for image 11.</p>` },
{ src: "images/azuli/thumb/12thumb.webp", full: "images/azuli/full/12full.webp", caption: `<h2>Image 12</h2><p>Caption for image 12.</p>` },
{ src: "images/azuli/thumb/13thumb.webp", full: "images/azuli/full/13full.webp", caption: `<h2>Image 13</h2><p>Caption for image 13.</p>` },
{ src: "images/azuli/thumb/14thumb.webp", full: "images/azuli/full/14full.webp", caption: `<h2>Image 14</h2><p>Caption for image 14.</p>` },
{ src: "images/azuli/thumb/15thumb.webp", full: "images/azuli/full/15full.webp", caption: `<h2>Image 15</h2><p>Caption for image 15.</p>` },
{ src: "images/azuli/thumb/16thumb.webp", full: "images/azuli/full/16full.webp", caption: `<h2>Image 16</h2><p>Caption for image 16.</p>` },
{ src: "images/azuli/thumb/17thumb.webp", full: "images/azuli/full/17full.webp", caption: `<h2>Image 17</h2><p>Caption for image 17.</p>` },
{ src: "images/azuli/thumb/18thumb.webp", full: "images/azuli/full/18full.webp", caption: `<h2>Image 18</h2><p>Caption for image 18.</p>` },
{ src: "images/azuli/thumb/19thumb.webp", full: "images/azuli/full/19full.webp", caption: `<h2>Image 19</h2><p>Caption for image 19.</p>` },
{ src: "images/azuli/thumb/20thumb.webp", full: "images/azuli/full/20full.webp", caption: `<h2>Image 20</h2><p>Caption for image 20.</p>` },
{ src: "images/azuli/thumb/21thumb.webp", full: "images/azuli/full/21full.webp", caption: `<h2>Image 21</h2><p>Caption for image 21.</p>` },
{ src: "images/azuli/thumb/22thumb.webp", full: "images/azuli/full/22full.webp", caption: `<h2>Image 22</h2><p>Caption for image 22.</p>` },
{ src: "images/azuli/thumb/23thumb.webp", full: "images/azuli/full/23full.webp", caption: `<h2>Image 23</h2><p>Caption for image 23.</p>` },
{ src: "images/azuli/thumb/24thumb.webp", full: "images/azuli/full/24full.webp", caption: `<h2>Image 24</h2><p>Caption for image 24.</p>` },
{ src: "images/azuli/thumb/25thumb.webp", full: "images/azuli/full/25full.webp", caption: `<h2>Image 25</h2><p>Caption for image 25.</p>` },
{ src: "images/azuli/thumb/26thumb.webp", full: "images/azuli/full/26full.webp", caption: `<h2>Image 26</h2><p>Caption for image 26.</p>` },
{ src: "images/azuli/thumb/27thumb.webp", full: "images/azuli/full/27full.webp", caption: `<h2>Image 27</h2><p>Caption for image 27.</p>` },
{ src: "images/azuli/thumb/28thumb.webp", full: "images/azuli/full/28full.webp", caption: `<h2>Image 28</h2><p>Caption for image 28.</p>` },
{ src: "images/azuli/thumb/29thumb.webp", full: "images/azuli/full/29full.webp", caption: `<h2>Image 29</h2><p>Caption for image 29.</p>` },
{ src: "images/azuli/thumb/30thumb.webp", full: "images/azuli/full/30full.webp", caption: `<h2>Image 30</h2><p>Caption for image 30.</p>` },
{ src: "images/azuli/thumb/31thumb.webp", full: "images/azuli/full/31full.webp", caption: `<h2>Image 31</h2><p>Caption for image 31.</p>` },
{ src: "images/azuli/thumb/32thumb.webp", full: "images/azuli/full/32full.webp", caption: `<h2>Image 32</h2><p>Caption for image 32.</p>` },
{ src: "images/azuli/thumb/33thumb.webp", full: "images/azuli/full/33full.webp", caption: `<h2>Image 33</h2><p>Caption for image 33.</p>` },
{ src: "images/azuli/thumb/34thumb.webp", full: "images/azuli/full/34full.webp", caption: `<h2>Image 34</h2><p>Caption for image 34.</p>` },
{ src: "images/azuli/thumb/35thumb.webp", full: "images/azuli/full/35full.webp", caption: `<h2>Image 35</h2><p>Caption for image 35.</p>` },
{ src: "images/azuli/thumb/36thumb.webp", full: "images/azuli/full/36full.webp", caption: `<h2>Image 36</h2><p>Caption for image 36.</p>` },
{ src: "images/azuli/thumb/37thumb.webp", full: "images/azuli/full/37full.webp", caption: `<h2>Image 37</h2><p>Caption for image 37.</p>` },
{ src: "images/azuli/thumb/38thumb.webp", full: "images/azuli/full/38full.webp", caption: `<h2>Image 38</h2><p>Caption for image 38.</p>` },
{ src: "images/azuli/thumb/39thumb.webp", full: "images/azuli/full/39full.webp", caption: `<h2>Image 39</h2><p>Caption for image 39.</p>` },
{ src: "images/azuli/thumb/40thumb.webp", full: "images/azuli/full/40full.webp", caption: `<h2>Image 40</h2><p>Caption for image 40.</p>` },
{ src: "images/azuli/thumb/41thumb.webp", full: "images/azuli/full/41full.webp", caption: `<h2>Image 41</h2><p>Caption for image 41.</p>` },
{ src: "images/azuli/thumb/42thumb.webp", full: "images/azuli/full/42full.webp", caption: `<h2>Image 42</h2><p>Caption for image 42.</p>` },
{ src: "images/azuli/thumb/43thumb.webp", full: "images/azuli/full/43full.webp", caption: `<h2>Image 43</h2><p>Caption for image 43.</p>` },
{ src: "images/azuli/thumb/44thumb.webp", full: "images/azuli/full/44full.webp", caption: `<h2>Image 44</h2><p>Caption for image 44.</p>` },
{ src: "images/azuli/thumb/45thumb.webp", full: "images/azuli/full/45full.webp", caption: `<h2>Image 45</h2><p>Caption for image 45.</p>` },
{ src: "images/azuli/thumb/46thumb.webp", full: "images/azuli/full/46full.webp", caption: `<h2>Image 46</h2><p>Caption for image 46.</p>` },
{ src: "images/azuli/thumb/47thumb.webp", full: "images/azuli/full/47full.webp", caption: `<h2>Image 47</h2><p>Caption for image 47.</p>` },
{ src: "images/azuli/thumb/48thumb.webp", full: "images/azuli/full/48full.webp", caption: `<h2>Image 48</h2><p>Caption for image 48.</p>` },
{ src: "images/azuli/thumb/49thumb.webp", full: "images/azuli/full/49full.webp", caption: `<h2>Image 49</h2><p>Caption for image 49.</p>` },
{ src: "images/azuli/thumb/50thumb.webp", full: "images/azuli/full/50full.webp", caption: `<h2>Image 50</h2><p>Caption for image 50.</p>` },
{ src: "images/azuli/thumb/51thumb.webp", full: "images/azuli/full/51full.webp", caption: `<h2>Image 51</h2><p>Caption for image 51.</p>` },
{ src: "images/azuli/thumb/52thumb.webp", full: "images/azuli/full/52full.webp", caption: `<h2>Image 52</h2><p>Caption for image 52.</p>` },
{ src: "images/azuli/thumb/53thumb.webp", full: "images/azuli/full/53full.webp", caption: `<h2>Image 53</h2><p>Caption for image 53.</p>` },
{ src: "images/azuli/thumb/54thumb.webp", full: "images/azuli/full/54full.webp", caption: `<h2>Image 54</h2><p>Caption for image 54.</p>` },
{ src: "images/azuli/thumb/55thumb.webp", full: "images/azuli/full/55full.webp", caption: `<h2>Image 55</h2><p>Caption for image 55.</p>` },
{ src: "images/azuli/thumb/56thumb.webp", full: "images/azuli/full/56full.webp", caption: `<h2>Image 56</h2><p>Caption for image 56.</p>` },
{ src: "images/azuli/thumb/57thumb.webp", full: "images/azuli/full/57full.webp", caption: `<h2>Image 57</h2><p>Caption for image 57.</p>` },
{ src: "images/azuli/thumb/58thumb.webp", full: "images/azuli/full/58full.webp", caption: `<h2>Image 58</h2><p>Caption for image 58.</p>` },
{ src: "images/azuli/thumb/59thumb.webp", full: "images/azuli/full/59full.webp", caption: `<h2>Image 59</h2><p>Caption for image 59.</p>` },
{ src: "images/azuli/thumb/60thumb.webp", full: "images/azuli/full/60full.webp", caption: `<h2>Image 60</h2><p>Caption for image 60.</p>` },
{ src: "images/azuli/thumb/61thumb.webp", full: "images/azuli/full/61full.webp", caption: `<h2>Image 61</h2><p>Caption for image 61.</p>` },
{ src: "images/azuli/thumb/62thumb.webp", full: "images/azuli/full/62full.webp", caption: `<h2>Image 62</h2><p>Caption for image 62.</p>` },
{ src: "images/azuli/thumb/63thumb.webp", full: "images/azuli/full/63full.webp", caption: `<h2>Image 63</h2><p>Caption for image 63.</p>` },
{ src: "images/azuli/thumb/64thumb.webp", full: "images/azuli/full/64full.webp", caption: `<h2>Image 64</h2><p>Caption for image 64.</p>` },
{ src: "images/azuli/thumb/65thumb.webp", full: "images/azuli/full/65full.webp", caption: `<h2>Image 65</h2><p>Caption for image 65.</p>` },
{ src: "images/azuli/thumb/66thumb.webp", full: "images/azuli/full/66full.webp", caption: `<h2>Image 66</h2><p>Caption for image 66.</p>` },
{ src: "images/azuli/thumb/67thumb.webp", full: "images/azuli/full/67full.webp", caption: `<h2>Image 67</h2><p>Caption for image 67.</p>` },
{ src: "images/azuli/thumb/68thumb.webp", full: "images/azuli/full/68full.webp", caption: `<h2>Image 68</h2><p>Caption for image 68.</p>` },
{ src: "images/azuli/thumb/69thumb.webp", full: "images/azuli/full/69full.webp", caption: `<h2>Image 69</h2><p>Caption for image 69.</p>` },
{ src: "images/azuli/thumb/70thumb.webp", full: "images/azuli/full/70full.webp", caption: `<h2>Image 70</h2><p>Caption for image 70.</p>` },
{ src: "images/azuli/thumb/71thumb.webp", full: "images/azuli/full/71full.webp", caption: `<h2>Image 71</h2><p>Caption for image 71.</p>` },
{ src: "images/azuli/thumb/72thumb.webp", full: "images/azuli/full/72full.webp", caption: `<h2>Image 72</h2><p>Caption for image 72.</p>` },
{ src: "images/azuli/thumb/73thumb.webp", full: "images/azuli/full/73full.webp", caption: `<h2>Image 73</h2><p>Caption for image 73.</p>` },
{ src: "images/azuli/thumb/74thumb.webp", full: "images/azuli/full/74full.webp", caption: `<h2>Image 74</h2><p>Caption for image 74.</p>` },
{ src: "images/azuli/thumb/75thumb.webp", full: "images/azuli/full/75full.webp", caption: `<h2>Image 75</h2><p>Caption for image 75.</p>` },
{ src: "images/azuli/thumb/76thumb.webp", full: "images/azuli/full/76full.webp", caption: `<h2>Image 76</h2><p>Caption for image 76.</p>` },
{ src: "images/azuli/thumb/77thumb.webp", full: "images/azuli/full/77full.webp", caption: `<h2>Image 77</h2><p>Caption for image 77.</p>` },
{ src: "images/azuli/thumb/78thumb.webp", full: "images/azuli/full/78full.webp", caption: `<h2>Image 78</h2><p>Caption for image 78.</p>` },
{ src: "images/azuli/thumb/79thumb.webp", full: "images/azuli/full/79full.webp", caption: `<h2>Image 79</h2><p>Caption for image 79.</p>` },
{ src: "images/azuli/thumb/80thumb.webp", full: "images/azuli/full/80full.webp", caption: `<h2>Image 80</h2><p>Caption for image 80.</p>` },
{ src: "images/azuli/thumb/81thumb.webp", full: "images/azuli/full/81full.webp", caption: `<h2>Image 81</h2><p>Caption for image 81.</p>` },
{ src: "images/azuli/thumb/82thumb.webp", full: "images/azuli/full/82full.webp", caption: `<h2>Image 82</h2><p>Caption for image 82.</p>` },
{ src: "images/azuli/thumb/83thumb.webp", full: "images/azuli/full/83full.webp", caption: `<h2>Image 83</h2><p>Caption for image 83.</p>` },
{ src: "images/azuli/thumb/84thumb.webp", full: "images/azuli/full/84full.webp", caption: `<h2>Image 84</h2><p>Caption for image 84.</p>` },
{ src: "images/azuli/thumb/85thumb.webp", full: "images/azuli/full/85full.webp", caption: `<h2>Image 85</h2><p>Caption for image 85.</p>` },
{ src: "images/azuli/thumb/86thumb.webp", full: "images/azuli/full/86full.webp", caption: `<h2>Image 86</h2><p>Caption for image 86.</p>` },
{ src: "images/azuli/thumb/87thumb.webp", full: "images/azuli/full/87full.webp", caption: `<h2>Image 87</h2><p>Caption for image 87.</p>` },
{ src: "images/azuli/thumb/88thumb.webp", full: "images/azuli/full/88full.webp", caption: `<h2>Image 88</h2><p>Caption for image 88.</p>` },
{ src: "images/azuli/thumb/89thumb.webp", full: "images/azuli/full/89full.webp", caption: `<h2>Image 89</h2><p>Caption for image 89.</p>` },
{ src: "images/azuli/thumb/90thumb.webp", full: "images/azuli/full/90full.webp", caption: `<h2>Image 90</h2><p>Caption for image 90.</p>` },
{ src: "images/azuli/thumb/91thumb.webp", full: "images/azuli/full/91full.webp", caption: `<h2>Image 91</h2><p>Caption for image 91.</p>` },
{ src: "images/azuli/thumb/92thumb.webp", full: "images/azuli/full/92full.webp", caption: `<h2>Image 92</h2><p>Caption for image 92.</p>` },
{ src: "images/azuli/thumb/93thumb.webp", full: "images/azuli/full/93full.webp", caption: `<h2>Image 93</h2><p>Caption for image 93.</p>` },
{ src: "images/azuli/thumb/94thumb.webp", full: "images/azuli/full/94full.webp", caption: `<h2>Image 94</h2><p>Caption for image 94.</p>` },
{ src: "images/azuli/thumb/95thumb.webp", full: "images/azuli/full/95full.webp", caption: `<h2>Image 95</h2><p>Caption for image 95.</p>` },
{ src: "images/azuli/thumb/96thumb.webp", full: "images/azuli/full/96full.webp", caption: `<h2>Image 96</h2><p>Caption for image 96.</p>` },
{ src: "images/azuli/thumb/97thumb.webp", full: "images/azuli/full/97full.webp", caption: `<h2>Image 97</h2><p>Caption for image 97.</p>` },
{ src: "images/azuli/thumb/98thumb.webp", full: "images/azuli/full/98full.webp", caption: `<h2>Image 98</h2><p>Caption for image 98.</p>` },
{ src: "images/azuli/thumb/99thumb.webp", full: "images/azuli/full/99full.webp", caption: `<h2>Image 99</h2><p>Caption for image 99.</p>` },
{ src: "images/azuli/thumb/100thumb.webp", full: "images/azuli/full/100full.webp", caption: `<h2>Image 100</h2><p>Caption for image 100.</p>` },
{ src: "images/azuli/thumb/101thumb.webp", full: "images/azuli/full/101full.webp", caption: `<h2>Image 101</h2><p>Caption for image 101.</p>` },
{ src: "images/azuli/thumb/102thumb.webp", full: "images/azuli/full/102full.webp", caption: `<h2>Image 102</h2><p>Caption for image 102.</p>` },
{ src: "images/azuli/thumb/103thumb.webp", full: "images/azuli/full/103clip.mp4", caption: `<h2>Video 42</h2><p>Caption for video 103.</p>` },
{ src: "images/azuli/thumb/104thumb.webp", full: "images/azuli/full/104clip.mp4", caption: `<h2>Video 42</h2><p>Caption for video 104.</p>` },
      
    ],
  },

  
{
  type: "wall",
  html: `<img class="wall-logo" src="assets/Calilei.svg" alt="">`,
},


  {
  type: "desktop",
  items: [
    { type: "md",    name: "test",   src: "assets/md/test.md" },
    { type: "md",    name: "NOTES",  lineColor: "#000000", fillColor: "#ffbb00",
      content: "## Scratch\n\n- [x] desktopMd\n- [ ] polish\n\nstatus: _draft_\n" },
    {
      type: "folder",
      name: "Projects",
      lineColor: "#000000",
      fillColor: "#00a7f5",
      contents: [
        {
          type: "folder",
          name: "Calilei",
          lineColor: "#000000",
          fillColor: "#ffffff",
          contents: [
            {
              type: "folder",
              name: "Assets",
              lineColor: "#000000",
              fillColor: "#ffffff",
              contents: [
                { type: "image", name: "logo",   src: "images/base/full/1full.webp", thumb: "images/base/thumb/1thumb.webp" },
                { type: "image", name: "icon",   src: "images/base/full/2full.webp", thumb: "images/base/thumb/2thumb.webp" },
              ],
            },
            { type: "note", name: "README", content: "Calilei project notes\n\n- " },
          ],
        },
        {
          type: "folder",
          name: "Drafts",
          lineColor: "#000000",
          fillColor: "#ffffff",
          contents: [
            { type: "image", name: "sketch", src: "images/base/full/3full.webp", thumb: "images/base/thumb/3thumb.webp" },
          ],
        },
      ],
    },
    {
              type: "folder",
              name: "folder",
              lineColor: "#000000",
              fillColor: "#fa1d00",
              contents: [
                { type: "image", name: "logo",   src: "images/base/full/6full.webp", thumb: "images/base/thumb/6thumb.webp" },
                { type: "image", name: "icon",   src: "images/base/full/7full.webp", thumb: "images/base/thumb/7thumb.webp" },
              ],
            },
    {
              type: "folder",
              name: "folder",
              lineColor: "#000000",
              fillColor: "#00c74c",
              contents: [
                { type: "image", name: "logo",   src: "images/base/full/8full.webp", thumb: "images/base/thumb/8thumb.webp" },
                { type: "image", name: "icon",   src: "images/base/full/9full.webp", thumb: "images/base/thumb/9thumb.webp" },
              ],
            },
    {
              type: "folder",
              name: "folder",
              lineColor: "#000000",
              fillColor: "#ffb921",
              contents: [
                { type: "image", name: "logo",   src: "images/base/full/10full.webp", thumb: "images/base/thumb/10thumb.webp" },
                { type: "image", name: "icon",   src: "images/base/full/11full.webp", thumb: "images/base/thumb/11thumb.webp" },
              ],
            },                
    { type: "note", name: "thoughts", content: "[ ] " },
    { type: "image", name: "photo", src: "images/base/full/4full.webp", thumb: "images/base/thumb/4thumb.webp" },
    {
      type: "audio",
      name: "song.mp3",
      src: "assets/beats/necktat.mp3",
      cover: "assets/beats/necktatcover.png",
      lineColor: "#c75d34",
      fillColor: "rgba(199, 93, 52, 0.12)",
      pauseOnMinimize: false, 
      loop: true,
      playOnOpen: true,   
    },
    {
      type: "video",
      name: "showreel",
      src: "assets/videos/videotest.mp4",
      lineColor: "#c75d34",
      fillColor: "rgba(199, 93, 52, 0.10)",
      playOnOpen: true,
      loop: true,
    },
  ],
},

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