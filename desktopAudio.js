/* =============================================================================
   desktopAudio.js — the "audio" FILE TYPE (sub-module of desktopPanel)
   -----------------------------------------------------------------------------
   The first MEDIA file type registered against desktopPanel.js. An
   audio-player window: speaker glyph icon, opens to a vertical layout
   with an album cover above a native `<audio controls>` element inside
   a fixed-size window.

   This is also the first file type that exercises the lifecycle-hook
   contract on the `win` handle (onMinimize / onClose). Where image and
   note built straight from { fitToContent, close }, audio needs to
   react to two panel-level lifecycle moments:

     1. MINIMIZE — opt-in pause. Music that keeps playing in the
        background is a common reason to minimize, so the default is
        "keep playing." Authoring `pauseOnMinimize: true` opts a
        specific clip into pausing instead (long voice memos, sounds
        the author doesn't want bleeding into other content, etc.).
        On RESTORE we intentionally DO NOT auto-resume — restoring
        the window is "show me the chrome again," not "press play
        for me." If the user wants playback back, the play button is
        right there.

     2. CLOSE — commit `audio.currentTime` to `file.playbackPosition`
        so reopening resumes from where they left off. Runs before
        DOM teardown (per the win.onClose contract), so currentTime
        is still readable. Same per-session-only persistence model as
        desktopNote — a page reload returns to authored data.

   AUTHORED DATA SHAPE
     { type: "audio", name: "song",
       src:   "assets/song.mp3",
       cover: "assets/song-cover.webp",  // optional, album art. Any format
                                          //   <img> understands. Absent or
                                          //   failed-to-load → fall back to
                                          //   a faint placeholder square.
       lineColor: "#...",       // optional, icon stroke tint
       fillColor: "#...",       // optional, icon body fill tint
       pauseOnMinimize: false,  // optional, default false (keep playing)
       playOnOpen: false,       // optional, default false (wait for play
                                //   button). Composes with playbackPosition
                                //   — resumes from saved position, then
                                //   plays.
       loop: false,             // optional, default false
     }

     Only `name` and `src` are required. lineColor / fillColor follow the
     same convention as folder and note glyphs — they map to --icon-line
     and --icon-fill on the icon, via desktopPanel.js's per-icon tint
     logic in buildIconEl. The fillColor tints the speaker body (via
     class="desktop-glyph-fill"); lineColor tints the stroke
     (currentColor → --icon-line via .desktop-icon-inner's color rule).

   PRELOAD STRATEGY
     `<audio>` defaults to "auto" which downloads the whole file eagerly
     even before the user clicks play. We set "metadata" — enough to
     know duration (so playbackPosition resume can seek before play, and
     the control shows total time correctly) but not the full payload.
     The user clicking play kicks off the rest. The right balance for a
     desktop panel where multiple audio files might exist and the user
     might never open most of them.

   COUPLED WITH
     - desktopPanel.js: imports registerFileType. Uses the expanded
       win handle's onMinimize + onClose hooks.
     - desktopAudioStyles.css: emits .desktop-audio-glyph and
       .desktop-audio-player.
     - main.js: importing this file is what installs the "audio" type.
   ========================================================================== */

import { registerFileType } from "./desktopPanel.js";

/* -----------------------------------------------------------------------------
   FILE-TYPE TUNABLES
   --------------------------------------------------------------------------- */

// Fixed window dimensions — audio has no inherent aspect to fit-to,
// so we don't call win.fitToContent. The size is tuned to comfortably
// hold the stacked layout: 36px window header + 16px top padding +
// 240px square cover + 12px gap + ~54px native audio control + 16px
// bottom padding ≈ 374, rounded up to 380 for a small breathing
// margin. Width 280 gives a 248px inner area, which centers the
// 240-max-width cover and player with a few px of side air.
const DEFAULT_WIN_W = 280;
const DEFAULT_WIN_H = 380;

/* -----------------------------------------------------------------------------
   REGISTER WITH THE PANEL
   --------------------------------------------------------------------------- */

registerFileType("audio", {

  // The icon's inner DOM. A classic speaker-with-soundwaves glyph: a
  // small back box on the left flaring into a triangular cone, with
  // two arcs emanating right (decreasing opacity outward to convey
  // "sound dispersing"). Inline SVG — single DOM node, no external
  // asset dependency, same convention as the folder and note glyphs.
  //
  // The body path is marked desktop-glyph-fill so --icon-fill tints
  // the speaker interior (defaults to the same near-transparent white
  // as folder + note via the CSS fallback). All strokes are
  // currentColor so --icon-line tints them uniformly via the
  // .desktop-icon-inner color rule.
  buildIcon(_file) {
    const wrap = document.createElement("div");
    wrap.className = "desktop-audio-glyph";
    wrap.innerHTML = `
      <svg viewBox="0 0 40 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <!-- Speaker body: back box (x 3..9, y 12..20) flaring into a
             cone whose diaphragm spans (16, 6..26). One closed path
             traces the whole silhouette. -->
        <path d="M3,12 H9 L16,6 V26 L9,20 H3 Z"
              class="desktop-glyph-fill"
              stroke="currentColor" stroke-width="1.5"
              stroke-linejoin="round" />
        <!-- Sound waves. Two concentric arcs to the right of the
             diaphragm. The closer wave is stronger; the further is
             fainter — reads as sound traveling outward and fading.
             Stroke-only (no fill), round caps for the soft "wave"
             feel rather than chiseled line ends. -->
        <path d="M20,12 A4,4 0 0 1 20,20"
              stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" opacity="0.85" />
        <path d="M24,8 A8,8 0 0 1 24,24"
              stroke="currentColor" stroke-width="1.2"
              stroke-linecap="round" opacity="0.5" />
      </svg>
    `;
    return wrap;
  },

  // The window's inner DOM. A vertical container holds an album-cover
  // area above a native <audio controls> element. The native control
  // supplies play/pause, seek, volume, mute, and timeline display for
  // free — no custom transport bar needed. The cover degrades cleanly
  // to a placeholder when no `cover` is authored or when the image
  // fails to load (see the cover block below). Styling for both pieces
  // via desktopAudioStyles.css.
  //
  // Four pieces of behaviour beyond "show the control":
  //
  //   - RESUME FROM SAVED POSITION. file.playbackPosition (written by
  //     onClose below on a previous close) is seeked-to once the
  //     browser knows the duration. We listen for loadedmetadata
  //     rather than seeking immediately, because setting currentTime
  //     before metadata loads can silently fail or get clamped to 0
  //     in some browsers.
  //
  //   - OPT-IN PLAY-ON-OPEN. file.playOnOpen === true makes the audio
  //     start playing as soon as the browser is ready. Distinct from
  //     "auto-resume on reopen" (which we deliberately don't do —
  //     deriving play/pause from prior runtime state is surprise UX):
  //     this is authored intent, not state-driven. Composes with
  //     RESUME above — both fire from the same loadedmetadata
  //     callback so the seek runs BEFORE play, avoiding an audible
  //     frame of audio from t=0 before snapping to the saved time.
  //     The play() promise is caught silently — modern browsers may
  //     reject if user activation is missing, but the play button is
  //     right there.
  //
  //   - OPT-IN PAUSE-ON-MINIMIZE. Default is keep-playing (the typical
  //     use of background-minimized music). Authoring
  //     pauseOnMinimize: true opts in. Asymmetric on purpose: we don't
  //     register onRestore — see the file-header comment for why.
  //
  //   - COMMIT POSITION ON CLOSE. file.playbackPosition is rewritten
  //     from the live audio element's currentTime, so the next open
  //     of the same item resumes there. file IS the live item record
  //     (mutable), same pattern note uses for textarea content.
  //     Fires inside the onClose hook, which runs BEFORE the panel
  //     destroys the window DOM — so the audio element is still alive
  //     and currentTime is readable.
  buildWindow(file, win) {
    // Container holds the album cover (above) and the audio control
    // (below) in a vertical flex layout (CSS owns the layout details).
    // Returning a container rather than just the <audio> element is
    // the only structural difference from a "naked" file type: the
    // panel appends whatever Node we return to .desktop-window-content
    // unchanged, so wrapping is invisible to the panel.
    const container = document.createElement("div");
    container.className = "desktop-audio-container";

    // Cover area. The div itself carries the placeholder appearance
    // (faint translucent square defined in CSS), so an unauthored or
    // failed cover degrades to the placeholder automatically — no
    // empty-state branching needed. When file.cover is authored, an
    // <img> is layered on top; on successful load it covers the
    // placeholder via object-fit. On the error event the img removes
    // itself, revealing the placeholder again. One visual state
    // machine: cover-or-placeholder.
    const cover = document.createElement("div");
    cover.className = "desktop-audio-cover";
    if (file.cover) {
      const img = document.createElement("img");
      img.alt = "";
      img.draggable = false;  // prevent native HTML5 drag from competing
                              // with the window's pointer-based drag
      // Attach error BEFORE setting src so an immediate failure (cached
      // 404, malformed path) still triggers the listener. Same defensive
      // ordering desktopImage uses for its load listener.
      img.addEventListener("error", () => { img.remove(); });
      img.src = file.cover;
      cover.appendChild(img);
    }
    container.appendChild(cover);

    const audio = document.createElement("audio");
    audio.className = "desktop-audio-player";
    audio.src = file.src;
    audio.controls = true;
    // Native <audio controls> includes an overflow menu (kebab icon in
    // Chrome) with "Playback Speed" and "Download" entries by default.
    // controlsList suppresses specific built-ins by name; "noplaybackrate"
    // removes speed control while leaving Download (and everything else)
    // intact. Firefox doesn't surface playback rate in its native
    // controls regardless, so the attribute is harmlessly moot there.
    audio.controlsList = "noplaybackrate";
    audio.preload = "metadata";
    audio.loop = !!file.loop;

    // Apply seek + autoplay once the browser knows the file's duration.
    // Single shared listener so the ordering is guaranteed — seek BEFORE
    // play, never the other way around. { once: true } self-unregisters
    // after the first fire (loadedmetadata can fire again after a src
    // change, but we never change src so this is a safety belt).
    const wantsSeek = !!file.playbackPosition;
    const wantsPlay = file.playOnOpen === true;
    if (wantsSeek || wantsPlay) {
      audio.addEventListener("loadedmetadata", () => {
        if (wantsSeek) {
          audio.currentTime = file.playbackPosition;
        }
        if (wantsPlay) {
          // Catch the promise rejection silently — see file-header /
          // buildWindow doc above for why we don't log it.
          audio.play().catch(() => {});
        }
      }, { once: true });
    }

    // Opt-in pause on minimize. Strict === true to require explicit
    // authoring; truthy-but-not-true values (undefined, missing) leave
    // the default "keep playing" behavior in place. Symmetric onRestore
    // intentionally omitted — restoring the window doesn't mean the
    // user wants the audio back.
    if (file.pauseOnMinimize === true) {
      win.onMinimize(() => audio.pause());
    }

    // Commit the current playback position on close. file is the live
    // item record from state.items, so the next openWindowFor on this
    // item picks up the saved position via the loadedmetadata listener
    // above. Per-session only — page reload returns to authored data.
    win.onClose(() => {
      file.playbackPosition = audio.currentTime;
    });

    container.appendChild(audio);
    return container;
  },

  defaultWindow: {
    width:  DEFAULT_WIN_W,
    height: DEFAULT_WIN_H,
  },
});
