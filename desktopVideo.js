/* =============================================================================
   desktopVideo.js — the "video" FILE TYPE (sub-module of desktopPanel)
   -----------------------------------------------------------------------------
   The second MEDIA file type registered against desktopPanel.js. A
   video-player window with a small instrumentation frame around the
   native <video controls> element: a four-color brand strip at the top
   of the content area, four hairline registration marks at the corners
   of the video stage, and two Hornet-Display HUD readouts in the top
   corners. The native controls stay — restyling them cross-browser
   isn't worth its keep (same convention as desktopAudio).

   Shares most of its core lifecycle with desktopAudio.js — same hook
   contract (onMinimize, onClose), same playbackPosition + playOnOpen +
   loop conventions, same controlsList suppression. Notable
   differences from audio:

     - FITS TO CONTENT. After loadedmetadata fires, the panel resizes
       the window to fit the video's natural aspect, plus the top
       chrome (strip + HUD band) and a small bias (LETTERBOX_BIAS ×
       videoH) that biases the window slightly taller than natural so
       letterbox always lands top/bottom rather than left/right. The
       top of the box thus has a dark band combining the explicit top
       padding and the natural top letterbox; the bottom is anchored
       by the native control bar, which sits over the natural bottom
       letterbox. See the LETTERBOX_BIAS constant for the full
       rationale.

     - DEFAULT PAUSE ON MINIMIZE. Audio defaults to keep-playing
       (background music is the canonical case). Video defaults to
       pause: a hidden video keeps consuming battery and emits audio
       from a source the user can't see. Authoring
       pauseOnMinimize: false opts out for videos that should stay
       running (ambient loops, a lecture playing while the user reads
       elsewhere). The check uses strict !== false so any other
       value — undefined, missing, or true — pauses.

     - NO COVER CONCEPT. The video is its own visual surface. The
       optional `poster` field (native to <video>) covers the "what
       shows before playback" case. No layered DOM, no fallback
       placeholder — the browser's built-in behavior renders either
       the poster image, the first decoded frame, or a black surface.

     - STRICTER AUTOPLAY POLICY. Browsers block video-with-sound
       autoplay more aggressively than audio, even with user
       activation. The .play() promise still rejects silently when
       blocked (same handling as audio); when that happens the user
       presses play manually.

   WINDOW CONTENT DOM (built by buildWindow):

     .desktop-video-wrap                        ← outer flex column
       ├── .desktop-video-strip                 ← 4-color brand strip (4px)
       │     ├── .desktop-video-strip-r
       │     ├── .desktop-video-strip-y
       │     ├── .desktop-video-strip-g
       │     └── .desktop-video-strip-b
       └── .desktop-video-stage                 ← relative; holds video + HUD
             ├── <video class="desktop-video-player" controls>
             ├── .desktop-video-regmark.tl/tr/bl/br
             ├── .desktop-video-hud.left
             │     ├── .desktop-video-pip       ← state-coded color dot
             │     └── .desktop-video-hud-label ← "PLAYING" / "PAUSED" / ...
             └── .desktop-video-hud.right
                   └── .desktop-video-hud-label ← "1920 × 1080 · 03:42"

   The HUD elements are pointer-events: none so they never intercept
   clicks meant for the native control bar at the bottom of the video.

   STATE PIP — the dot in the left HUD reads playback state at a glance.
   Mapping to brand primaries (see visualLanguage.md):

     loading  → blue   (info; pre-metadata)
     ready    → blue   (info; metadata loaded, awaiting play, or ended)
     playing  → green  (go)
     paused   → yellow (caution; halted, attention)
     error    → red    (warn)

   AUTHORED DATA SHAPE
     { type: "video", name: "clip",
       src:    "assets/clip.mp4",
       poster: "assets/clip-poster.webp",   // optional, image shown
                                             //   before playback begins.
                                             //   Native <video poster>;
                                             //   falls back to first
                                             //   frame or black if
                                             //   absent.
       lineColor: "#...",       // optional, icon stroke tint
       fillColor: "#...",       // optional, icon body fill tint
       pauseOnMinimize: true,   // optional, default TRUE. Set false to
                                //   keep playing while minimized.
       playOnOpen: false,       // optional, default false. Composes
                                //   with playbackPosition; may be
                                //   blocked by browser autoplay policy.
       loop: false,             // optional, default false
     }

   PRELOAD STRATEGY
     Same reasoning as audio — preload="metadata" loads enough to know
     duration + dimensions (so the immediate fitToContent and any seek
     work correctly) without pulling the entire video payload until
     play. Video files are typically larger than audio, so being polite
     about network is more important here than for audio.

   COUPLED WITH
     - desktopPanel.js: imports registerFileType. Uses the win handle's
       fitToContent + onMinimize + onClose.
     - desktopVideoStyles.css: emits the classes diagrammed above.
     - main.js: importing this file is what installs the "video" type.
   ========================================================================== */

import { registerFileType } from "./desktopPanel.js";

/* -----------------------------------------------------------------------------
   FILE-TYPE TUNABLES
   --------------------------------------------------------------------------- */

// Initial window dimensions before metadata loads. The panel calls
// fitToContent inside the loadedmetadata listener below, so this size
// is only visible for the few hundred ms it takes for the browser to
// read the video header. Chosen to feel roughly video-shaped (slightly
// wider than 4:3, narrower than 16:9) so the pre-fit placeholder
// doesn't snap-jolt the user when the real aspect arrives.
const DEFAULT_WIN_W = 480;
const DEFAULT_WIN_H = 320;

// Height of the four-color brand strip, in CSS px. Authored here (not
// only in CSS) because fitToContent's input is "natural content
// dimensions" — passing videoHeight + BRAND_STRIP_PX makes the resulting
// window size accommodate the strip without squeezing the video off
// its natural aspect. The value MUST match the flex-basis on
// .desktop-video-strip in desktopVideoStyles.css. If you change one,
// change the other.
const BRAND_STRIP_PX = 4;

// Height of the top HUD band — the dark letterbox strip above the
// video where the corner HUD readouts and top registration marks sit.
// Only the top has an explicit band: the bottom dark space is the
// native HTML5 control bar at the bottom of the video, which provides
// the symmetric visual weight without needing extra chrome. The band
// is produced by top padding on .desktop-video-stage; the value here
// MUST match that padding in desktopVideoStyles.css.
//
// Why fixed pixels (not proportional): keeps the readouts at a
// consistent legible size regardless of window dimensions, and
// guarantees the HUD always has a dark backdrop rather than competing
// with bright video content at the corners. The tradeoff is that at
// very small window sizes the band takes a larger share of the
// content area; acceptable because users rarely shrink media windows
// to minimum.
const HUD_BAND_PX = 32;

// Extra height bias added to the fitToContent request, as a fraction
// of the source video's height. Biases the window taller than the
// video's natural aspect would dictate, producing a natural top/bottom
// letterbox INSIDE the video element box. The letterbox creates the
// visible dark bands above and below the video.
//
// Why this is needed: fitToContent's algorithm assumes a constant
// aspect ratio, but our chrome (BRAND_STRIP_PX + HUD_BAND_PX) is
// fixed-pixel and therefore has different *relative* weight at
// different render scales. At natural scale, the chrome's share is
// negligible. At viewport-clamped scales (common for any video
// larger than ~1500px on a desktop), the chrome's relative weight
// grows, making the inner box aspect drift WIDER than the source
// aspect — without the bias, object-fit: contain would then
// letterbox on the LEFT/RIGHT (the opposite of what we want).
//
// More importantly: the bias controls how thick the bottom dark band
// is when the native control bar is auto-hidden (most of the time,
// since browsers hide controls after the user stops interacting).
// Without enough bias, the bottom letterbox is only a few px and
// disappears visually when controls hide. With this bias, the bottom
// dark band stays substantial at all times — and the controls, when
// they do appear, sit inside that dark area rather than overlaying
// the video content.
//
// 0.20 gives ~44-50px of bottom letterbox at typical desktop
// viewports (maxH ~700-830px) — thick enough to fully contain the
// native HTML5 control bar (~40px in Chrome) when it appears on
// hover, with a few px of letterbox still visible above it. Higher
// values produce thicker bands at the cost of a narrower window (the
// chrome eats more share of the fit budget). Asymmetry note: the top
// band is the bias-produced letterbox PLUS the explicit HUD_BAND_PX
// padding (~32px), while the bottom band is just the letterbox. So
// at clamp the top reads thicker than the bottom; this is by design
// to guarantee HUD readouts always have a predictable >= 32px dark
// area to sit in.
const LETTERBOX_BIAS = 0.20;

/* -----------------------------------------------------------------------------
   HELPERS
   --------------------------------------------------------------------------- */

// Format a duration in seconds as MM:SS, or H:MM:SS for >= 1h. Used
// for the right HUD readout. Falls back to "—:—" for the pre-metadata
// state and any pathological inputs (NaN, Infinity, negative).
function formatDuration(seconds) {
  if (!isFinite(seconds) || seconds < 0) return "—:—";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/* -----------------------------------------------------------------------------
   REGISTER WITH THE PANEL
   --------------------------------------------------------------------------- */

registerFileType("video", {

  // The icon's inner DOM. A play-triangle-in-rounded-rectangle glyph —
  // universal "video file" silhouette. Inline SVG matching the
  // folder/note/audio convention (single DOM node, no external asset).
  //
  // Two parts share the project's tinting mechanism:
  //   - The screen rectangle uses class="desktop-glyph-fill" so
  //     --icon-fill tints its interior (matching folder's body, note's
  //     page, audio's speaker body).
  //   - The play triangle uses fill="currentColor" so --icon-line
  //     tints it as a solid mark — gives the icon a strong focal
  //     point that reads instantly as "play / video" at small sizes.
  buildIcon(_file) {
    const wrap = document.createElement("div");
    wrap.className = "desktop-video-glyph";
    wrap.innerHTML = `
      <svg viewBox="0 0 40 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <!-- Screen rectangle: 32×22 centered in the 40×32 viewBox.
             rx="2" gives the corners a soft round so the shape reads
             as a "display" rather than a "card" — matches the project's
             gentle frosted aesthetic. -->
        <rect x="4" y="5" width="32" height="22" rx="2"
              class="desktop-glyph-fill"
              stroke="currentColor" stroke-width="1.5"
              stroke-linejoin="round" />
        <!-- Play triangle: filled with currentColor so it tints with
             --icon-line. Geometrically centered in the screen
             (midpoint at 20, 16). 9 wide × 10 tall — slightly tall, but
             the right-pointing shape reads as motion. stroke-linejoin
             round softens the apex. -->
        <path d="M16,11 L16,21 L25,16 Z"
              fill="currentColor"
              stroke="currentColor" stroke-width="0.5"
              stroke-linejoin="round" />
      </svg>
    `;
    return wrap;
  },

  // The window's inner DOM. The native <video controls> sits inside an
  // instrumentation frame: a four-color brand strip at the top, four
  // hairline corner registration marks, and two Hornet-Display HUD
  // readouts in the top corners (state pip on the left, resolution +
  // duration on the right). All HUD elements are pointer-events: none
  // so they never intercept clicks meant for the native controls.
  //
  // Five concerns beyond "show the video":
  //
  //   - FIT WINDOW TO VIDEO ASPECT. The loadedmetadata listener reads
  //     videoWidth / videoHeight and asks the panel to resize, adding
  //     BRAND_STRIP_PX to the requested height so the visible video
  //     area (not the strip + video) ends up at natural aspect. After
  //     the fit, the user can still manually resize the window —
  //     userResized becomes true and subsequent fitToContent calls
  //     are no-ops.
  //
  //   - RESUME FROM SAVED POSITION + OPT-IN PLAY-ON-OPEN. Folded into
  //     the same loadedmetadata listener as the fit, since all three
  //     concerns share the "browser is now ready" trigger. Ordering:
  //     fit first, then HUD-right populate, then seek, then play.
  //     Seek before play prevents an audible frame from t=0.
  //
  //   - DEFAULT PAUSE-ON-MINIMIZE. Inverted from audio's opt-in
  //     pattern — the check is `pauseOnMinimize !== false`, so any
  //     value other than explicit `false` pauses. Asymmetric
  //     onRestore intentionally omitted, same as audio: restoring
  //     the window is "show me the video again," not "press play
  //     for me." The play button is right there.
  //
  //   - COMMIT POSITION ON CLOSE. file.playbackPosition is rewritten
  //     from video.currentTime so the next open of the same item
  //     resumes there. Per-session only (matches audio + note
  //     pattern; page reload returns to authored data).
  //
  //   - STATE PIP. play / pause / ended / error event listeners on
  //     the video keep the pip's data-state attribute in sync with
  //     playback. CSS maps each state to a brand-primary color (see
  //     desktopVideoStyles.css). Listeners are NOT { once: true } —
  //     state changes throughout the window's lifetime.
  buildWindow(file, win) {
    // ---------- Outer wrap ----------
    // Flex column that fills the window's content area. The strip
    // takes its fixed 4px; the stage takes the rest.
    const wrap = document.createElement("div");
    wrap.className = "desktop-video-wrap";

    // ---------- Brand strip ----------
    // Four equal cells — red / yellow / green / blue, in that order.
    // Static markup; no JS state. Direct DOM rather than innerHTML
    // string so future re-orderings are explicit.
    const strip = document.createElement("div");
    strip.className = "desktop-video-strip";
    for (const tone of ["r", "y", "g", "b"]) {
      const cell = document.createElement("div");
      cell.className = `desktop-video-strip-${tone}`;
      strip.appendChild(cell);
    }
    wrap.appendChild(strip);

    // ---------- Stage ----------
    // Relative-positioned container that holds the video plus the
    // absolute-positioned HUD overlays.
    const stage = document.createElement("div");
    stage.className = "desktop-video-stage";

    // ---------- Video element ----------
    // Identical configuration to the previous implementation. The new
    // structure wraps it — the video itself behaves exactly as before.
    const video = document.createElement("video");
    video.className = "desktop-video-player";
    video.src = file.src;
    video.controls = true;
    // Suppress "Playback Speed" in the kebab overflow menu; leave
    // Download and Fullscreen intact. Same call and same reasoning as
    // desktopAudio.
    video.controlsList = "noplaybackrate";
    // Hide the Picture-in-Picture button. PiP is controlled by its
    // own IDL property rather than a controlsList value — setting
    // this also disables the right-click context-menu PiP entry and
    // any keyboard shortcut, so PiP is fully off (not just visually
    // suppressed from the native chrome).
    video.disablePictureInPicture = true;
    video.preload = "metadata";
    video.loop = !!file.loop;
    if (file.poster) {
      // Native <video poster> — image shown before playback. The
      // browser handles loading + display; no JS wiring needed beyond
      // setting the attribute. Falls back to first frame or black if
      // not authored.
      video.poster = file.poster;
    }
    stage.appendChild(video);

    // ---------- Corner registration marks ----------
    // Four hairline L-shapes, one at each corner of the stage. Drawn
    // by CSS pseudo-elements; markup is just empty positioned divs.
    for (const corner of ["tl", "tr", "bl", "br"]) {
      const mark = document.createElement("div");
      mark.className = `desktop-video-regmark ${corner}`;
      stage.appendChild(mark);
    }

    // ---------- Left HUD: state pip + label ----------
    // The pip's color is driven by data-state via CSS; we set it
    // imperatively below as playback state changes. Initial state is
    // "loading" — metadata hasn't loaded yet, so we don't know
    // anything about the video.
    const hudLeft = document.createElement("div");
    hudLeft.className = "desktop-video-hud left";
    const pip = document.createElement("div");
    pip.className = "desktop-video-pip";
    pip.dataset.state = "loading";
    const labelLeft = document.createElement("span");
    labelLeft.className = "desktop-video-hud-label";
    labelLeft.textContent = "LOADING";
    hudLeft.appendChild(pip);
    hudLeft.appendChild(labelLeft);
    stage.appendChild(hudLeft);

    // ---------- Right HUD: resolution + duration ----------
    // Populated with em-dashes pre-metadata; replaced with the real
    // values inside the loadedmetadata listener.
    const hudRight = document.createElement("div");
    hudRight.className = "desktop-video-hud right";
    const labelRight = document.createElement("span");
    labelRight.className = "desktop-video-hud-label";
    labelRight.textContent = "— × — · —:—";
    hudRight.appendChild(labelRight);
    stage.appendChild(hudRight);

    wrap.appendChild(stage);

    // ---------- State machine ----------
    // setState writes both the pip's data-state (CSS maps it to a
    // brand color) and the left label's text. Three callers below:
    // play / pause / ended event listeners, plus loadedmetadata for
    // the initial transition out of "loading".
    const setState = (name, labelText) => {
      pip.dataset.state = name;
      labelLeft.textContent = labelText;
    };

    // Single unconditional loadedmetadata listener — every video needs
    // fitToContent regardless of seek/autoplay settings. Folding all
    // four concerns (fit, HUD populate, seek, autoplay) here keeps
    // ordering explicit. { once: true } self-unregisters after the
    // first fire (loadedmetadata can fire again after a src change,
    // but we never change src so this is a safety belt).
    video.addEventListener("loadedmetadata", () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        // The natural height we'd want, plus the explicit top chrome
        // (strip + top band), plus a small bias (LETTERBOX_BIAS × videoH)
        // that biases the window taller than natural aspect. The bias
        // ensures that after fitToContent's clamping at the viewport
        // limit, the inner stage box stays NARROWER than the source
        // aspect — so letterbox lands top/bottom (good) instead of
        // left/right (bad). See LETTERBOX_BIAS constant above for the
        // full rationale.
        const biasPx = Math.round(video.videoHeight * LETTERBOX_BIAS);
        win.fitToContent(
          video.videoWidth,
          video.videoHeight + BRAND_STRIP_PX + HUD_BAND_PX + biasPx
        );

        // Populate the right HUD now that we have real numbers. The
        // dimensions × duration string is static after this — file
        // specs, not live state.
        labelRight.textContent =
          `${video.videoWidth} × ${video.videoHeight} · ${formatDuration(video.duration)}`;
      }

      // Transition out of "loading". If playOnOpen below fires a
      // synchronous play() that resolves before this microtask, the
      // play listener will overwrite this with "playing" — that's the
      // correct final state. Setting "ready" here covers the common
      // case where play is user-initiated later.
      setState("ready", "READY");

      if (file.playbackPosition) {
        video.currentTime = file.playbackPosition;
      }
      if (file.playOnOpen === true) {
        // Silent catch — browser autoplay policy may reject, more
        // aggressively for video-with-sound than for audio. When it
        // rejects, the video stays paused and the state remains
        // "ready" until the user presses play.
        video.play().catch(() => {});
      }
    }, { once: true });

    // Playback state transitions. Persistent listeners (no { once }) —
    // state changes throughout the window's lifetime as the user
    // plays, pauses, and restarts. "ended" returns to "ready" because
    // the video is ready to play again (most relevant for non-looping
    // content; looping videos generally don't fire ended).
    video.addEventListener("play",  () => setState("playing", "PLAYING"));
    video.addEventListener("pause", () => setState("paused",  "PAUSED"));
    video.addEventListener("ended", () => setState("ready",   "READY"));
    // Surface load/decode failures via the red error pip. The native
    // controls will also show a "video unavailable" overlay, but the
    // pip provides at-a-glance confirmation that the window is in a
    // failure state vs. just paused.
    video.addEventListener("error", () => setState("error",   "ERROR"));

    // Default pause on minimize. The check is `!== false` (not `===
    // true`) so the default behavior is to pause — undefined / missing
    // / true all fall through to the pause branch. The inversion vs
    // audio is the canonical illustration of why the two modules
    // can't share a generic media base class without losing this
    // per-type policy decision.
    if (file.pauseOnMinimize !== false) {
      win.onMinimize(() => video.pause());
    }

    // Commit playback position on close. Same per-session-only
    // persistence as audio and note — page reload returns to authored
    // data.
    win.onClose(() => {
      file.playbackPosition = video.currentTime;
    });

    return wrap;
  },

  defaultWindow: {
    width:  DEFAULT_WIN_W,
    height: DEFAULT_WIN_H,
  },
});