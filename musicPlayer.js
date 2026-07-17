/* =============================================================================
   musicPlayer.js — the CORNER MUSIC PLAYER (site-wide enhancement module)
   -----------------------------------------------------------------------------
   A persistent bottom-right audio player for an AUTHORED TRACK LIST: a
   circular cover-art disc that spins while music plays, a prev / play-pause
   / next transport, and a Hornet instrument readout (state announcement +
   track title). Autoplays on page load where the browser permits; degrades
   honestly where it doesn't (see AUTOPLAY). Tracks cycle: each 'ended'
   advances to the next, wrapping per the `loop` option.

   Like scrollIndicator and cursor it is persistent, eagerly-mounted UI that
   lives OUTSIDE the scroll system: no panel type, no weight, no frame hook,
   never reads or writes activeFloat. The disc spin is a CSS animation whose
   play-state follows the audio element — no per-frame JS at all.

   THE PLAYLIST
     The list is AUTHORED IN THIS FILE — the TRACKS block right below this
     header (a deliberate deviation from main.js-authors-content, in the
     sidebar views' precedent of self-authored modules; it keeps the
     already-large main.js lean). initMusicPlayer() with no arguments plays
     the authored list; passing { tracks, loop, volume } from main.js
     overrides it, so the composition-root style remains available.
     One <audio> element serves the whole list — loadTrack() swaps its src,
     the cover art, and the title. Wrap-aware indexing uses the codebase's
     double-mod idiom (((i % N) + N) % N), same as the core's dist[] and the
     indicator's active mark. The element-level `loop` flag is NOT used for
     lists (it would swallow the 'ended' event the cycle depends on); the
     one exception is a single-track list with loop:true, which gets the
     element flag back because it's gapless.

   DEAD FILES SKIP; A DEAD LIST STOPS
     A track whose source fails to load logs a warning and auto-advances,
     so one bad path can't silence the rest of the set. A consecutive-error
     counter (reset whenever playback actually begins — the 'playing'
     event) stops the skipping at / NO.SIGNAL once every track in the list
     has failed in a row, so an entirely dead list can't skip-loop forever.

   THE STATE MACHINE (per visualLanguage.md's state grammar)
     Four named states, each with one color, one motion behavior, and one
     announced Hornet readout. The state lives in data-state on the root;
     the CSS derives everything (spin play-state, icon swap, readout color)
     from that one attribute:

       playing   green   disc spins            / NOW.PLAYING
       paused    dim     disc frozen in place  / PAUSED
       standby   blue    disc still            / TAP.TO.START
       error     red     disc still            / NO.SIGNAL   (whole list dead)

     The single source of truth for playing/paused is the <audio> element
     itself: the UI updates in its 'play'/'pause' event handlers, never by
     assumption at the call sites. Anything that pauses the audio — the
     transport, a future module, devtools — keeps the UI honest for free.

   AUTOPLAY (the honest version)
     Browsers block unmuted audio autoplay until the user has interacted
     with the page (Chrome's autoplay policy; no module can bypass it). So
     init ATTEMPTS play() via attemptPlay(), which branches on the promise:
       - resolved → the 'play' event fires and the UI enters `playing`.
       - rejected → enter `standby` (/ TAP.TO.START, blue = awaiting input)
         and arm listeners that resume on the first pointerdown or keydown
         anywhere on the page — usually within a couple of seconds of
         arrival, which is as close to "autoplay" as the platform allows.
     The gesture listeners ignore events originating inside the widget
     (pointer target, or keyboard focus, within root) so a first gesture
     that IS a transport button doesn't double-fire — the buttons own their
     own gestures. The 'play' handler disarms them regardless of which path
     started playback. Every programmatic start goes through attemptPlay()
     so the blocked fallback is uniform (init, error-skip, track advance —
     though advances after a first interaction always succeed: the
     interaction flag is page-sticky for the session).

   THE TRANSPORT
     prev / play-pause / next, in one hairline-segmented cluster. Glyphs
     are HAIRLINE STROKES, not filled solids — the same 1px currentColor
     dialect as the cursor's and indicator's marks, per the visual
     language's one-weight rule: a hollow play triangle, two hairline pause
     strokes, and chevron-plus-bar skips (|< / >|) that keep the media
     convention while landing in the site's code-syntax vocabulary. Button
     chrome follows turn-btn (the codebase's boxed-button dialect): ghost
     resting, brand-blue flood with white glyph on hover, a mechanical
     key-press on :active, brand-blue focus-visible ring. The back button's
     behavior also descends from the real convention: more than
     PREV_RESTART_S seconds into a track it RESTARTS the track; earlier, it
     goes to the previous one. Skipping in either direction starts
     playback, even from paused — the convention every mainstream player
     follows. Manual skips always wrap, regardless of `loop` (loop governs
     only the automatic cycle).

   THE DISC
     A circular <img> of the cover art with a spindle-hub dot — reads as a
     record. The spin is the visual language's analog-gauge case: machinery
     driven 1:1 by playback, so continuous rotation is sanctioned (the
     motion IS the state). Pausing freezes the animation IN PLACE via
     animation-play-state — a platter stops where it stops. The art <img>
     is a permanent node toggled per track: shown when the track authors a
     cover that loads, hidden (falling back to the plain ink disc) when the
     cover is absent or fails.

   THE SIDEBAR DODGE (same published contract as scrollIndicator)
     sidebar.js toggles `sidebar-is-open` on <body>; sidebarStyles.css owns
     the sheet width as --sidebar-width. The dodge is pure CSS in
     musicPlayerStyles.css — body.sidebar-is-open shifts the player left by
     var(--sidebar-width) on the sheet's own 0.45s var(--ease), so the two
     travel as one object. One-directional: the sidebar never knows this
     module exists; delete the sidebar and var(--sidebar-width, 0px) makes
     the dodge a no-op.

   ACCESSIBILITY
     Unlike scrollIndicator (a mirror of scroll, deliberately aria-hidden),
     this is a real control with no redundant counterpart, so it stays in
     the accessibility tree: real <button>s whose aria-labels track the
     action they'd perform; the title is real text. The buttons declare the
     cursor.js protocol (--cursor: pointer) so the site cursor renders its
     clickable variant.

   KNOWN COEXISTENCE
     The desktop panel's "audio" file type owns its own <audio> elements;
     opening one while this widget plays will layer both tracks. Not
     handled here — a cross-module "audio focus" channel is a shared-
     primitive conversation, not something either module should solve by
     reaching into the other.

   COUPLED WITH
     - sidebar.js / sidebarStyles.css: the `sidebar-is-open` body class and
       the --sidebar-width token (published contract — drives the dodge).
     - musicPlayerStyles.css: all presentation, keyed off data-state.
     - index.html: <link> to musicPlayerStyles.css.
     - main.js: initMusicPlayer() — bare; the playlist is authored below.
       ({ tracks, loop, volume } may be passed to override.) No dependency
       on start(); ordering is flexible.
   ========================================================================== */

/* =============================================================================
   AUTHORING — the playlist. Edit this block; the machinery below shouldn't
   need touching to change what plays. Each entry:
     src    — audio file path (required)
     cover  — cover-art image path (optional; omitted → plain ink disc)
     title  — readout title (optional; omitted → UNTITLED)
   Tracks play in order; DEFAULT_LOOP wraps last → first on the automatic
   cycle (manual skips always wrap regardless).
   ========================================================================== */
const TRACKS = [
  { src: "assets/tracks/CALILEI.mp3", title: "CALILEI.mp3" },
  { src: "assets/tracks/EXODUS.mp3", title: "EXODUS.mp3" },
  { src: "assets/tracks/NUCLEAR.mp3", title: "NUCLEAR.mp3" },
  { src: "assets/tracks/WINGS.mp3",  title: "WINGS.mp3" },
  { src: "assets/tracks/2055.mp3", title: "2055.mp3" },
  { src: "assets/tracks/BROTHERS.mp3", title: "BROTHERS.mp3" },
  { src: "assets/tracks/RIDDANCE.mp3", title: "RIDDANCE.mp3" },
  { src: "assets/tracks/COLORS.mp3", title: "COLORS.mp3" },
  { src: "assets/tracks/BELIEVE.mp3", title: "BELIEVE.mp3" },
  { src: "assets/tracks/BLEED.mp3", title: "BLEED.mp3" },
  { src: "assets/tracks/RAINDOWN.mp3", title: "RAINDOWN.mp3" },
  { src: "assets/tracks/COMET.mp3", title: "COMET.mp3" },
  { src: "assets/tracks/LOCATION.mp3", title: "LOCATION.mp3" },
  { src: "assets/tracks/FIELDS.mp3", title: "FIELDS.mp3" },
  // { src: "assets/beats/track2.mp3", cover: "assets/beats/track2cover.png", title: "TRACK.02" },
  // { src: "assets/beats/track3.mp3", title: "TRACK.03" },
];
const DEFAULT_LOOP   = true;
const DEFAULT_VOLUME = 1;

let mounted = false;

/* Back-button convention: past this many seconds into a track, "back"
   restarts the track instead of going to the previous one. Set to 0 to make
   back always mean "previous track". */
const PREV_RESTART_S = 3;

/**
 * All parameters are OVERRIDES — a bare initMusicPlayer() plays the TRACKS
 * list authored above with the authored defaults.
 * @param {Object}  [opts]
 * @param {Array<{src: string, cover?: string, title?: string}>} [opts.tracks]
 *                  replacement playlist, in play order
 * @param {boolean} [opts.loop]   wrap from the last track to the first;
 *                                manual skips always wrap regardless
 * @param {number}  [opts.volume] 0..1
 */
export function initMusicPlayer({
  tracks = TRACKS,
  loop   = DEFAULT_LOOP,
  volume = DEFAULT_VOLUME,
} = {}) {
  if (mounted) return;   // idempotent — a double-init is a silent no-op
  if (!tracks.length) {
    console.warn("[musicPlayer] no tracks (authored TRACKS empty, or an empty override passed) — not mounting");
    return;
  }
  mounted = true;

  const N = tracks.length;

  /* ---------------------------------------------------------------------------
     THE AUDIO — one element for the whole list, created detached (an <audio>
     plays without being in the DOM). Default preload is right here: the
     current track is meant to play immediately, unlike desktopAudio's
     many-files-might-exist case where metadata-only is.
     --------------------------------------------------------------------------- */
  const audio = new Audio();
  audio.volume = volume;
  // A single looping track keeps the element-level flag: gapless, and there
  // is no "next" for the ended-driven cycle to advance to anyway.
  if (N === 1 && loop) audio.loop = true;

  /* ---------------------------------------------------------------------------
     BUILD — disc | readout | transport, in a row. All static after init; the
     mutable pieces are data-state on the root, the readout texts, the art
     src/hidden pair, and the buttons' aria-labels. Appended to <body>:
     removing the import (plus the <link> and this file pair) erases every
     trace — the same deletion rule cursor.js and scrollIndicator.js follow.
     --------------------------------------------------------------------------- */
  const root = document.createElement("div");
  root.className = "music-player";
  root.dataset.state = "standby";   // resolved within ms by the play() attempt

  const disc = document.createElement("div");
  disc.className = "mp-disc";
  // The art is a permanent node; loadTrack() shows/points it per track and a
  // failed load hides it, degrading to the plain ink disc underneath —
  // cover-or-placeholder as one state machine, no branching (desktopAudio's
  // idea, adapted for a swappable source).
  const art = document.createElement("img");
  art.className = "mp-disc-art";
  art.alt = "";                     // decorative; the title carries the info
  art.draggable = false;
  art.hidden = true;
  art.addEventListener("error", () => { art.hidden = true; });
  const hub = document.createElement("div");
  hub.className = "mp-disc-hub";    // the spindle hole
  disc.append(art, hub);

  const readout = document.createElement("div");
  readout.className = "mp-readout";
  const stateEl = document.createElement("div");
  stateEl.className = "mp-state";
  stateEl.textContent = "/ STANDBY";
  const titleEl = document.createElement("div");
  titleEl.className = "mp-title";
  readout.append(stateEl, titleEl);

  /* The transport — three real buttons in one segmented cluster. Glyphs are
     hairline strokes (the cursor's / indicator's 1px currentColor dialect);
     both play/pause glyphs live in the DOM and the CSS shows one per
     data-state — a discrete swap, per the motion rules (information steps). */
  const transport = document.createElement("div");
  transport.className = "mp-transport";

  const prevBtn = document.createElement("button");
  prevBtn.className = "mp-btn mp-prev";
  prevBtn.type = "button";
  prevBtn.setAttribute("aria-label", "Previous track");
  prevBtn.innerHTML = `
    <svg class="mp-icon" width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" fill="none">
      <line x1="2.5" y1="3.25" x2="2.5" y2="8.75" stroke="currentColor"/>
      <polyline points="9.5,1.5 4.5,6 9.5,10.5" stroke="currentColor"/>
    </svg>`;

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "mp-btn mp-toggle";
  toggleBtn.type = "button";
  toggleBtn.setAttribute("aria-label", "Play");
  toggleBtn.innerHTML = `
    <svg class="mp-icon mp-icon-play" width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" fill="none">
      <path d="M3.5 1.5 L10 6 L3.5 10.5 Z" stroke="currentColor"/>
    </svg>
    <svg class="mp-icon mp-icon-pause" width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" fill="none">
      <line x1="4.5" y1="1.5" x2="4.5" y2="10.5" stroke="currentColor"/>
      <line x1="7.5" y1="1.5" x2="7.5" y2="10.5" stroke="currentColor"/>
    </svg>`;

  const nextBtn = document.createElement("button");
  nextBtn.className = "mp-btn mp-next";
  nextBtn.type = "button";
  nextBtn.setAttribute("aria-label", "Next track");
  nextBtn.innerHTML = `
    <svg class="mp-icon" width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" fill="none">
      <polyline points="2.5,1.5 7.5,6 2.5,10.5" stroke="currentColor"/>
      <line x1="9.5" y1="3.25" x2="9.5" y2="8.75" stroke="currentColor"/>
    </svg>`;

  transport.append(prevBtn, toggleBtn, nextBtn);
  root.append(disc, readout, transport);
  document.body.appendChild(root);

  /* ---------------------------------------------------------------------------
     STATE + PLAYLIST MACHINERY — one writer for the visual state (setState),
     one writer for the track position (loadTrack). playing/paused are driven
     by the audio element's own events; standby and error are set at the two
     places they can arise.
     --------------------------------------------------------------------------- */
  let index = 0;         // current track; loadTrack() is its only writer
  let errorStreak = 0;   // consecutive source failures; N in a row = dead list

  const setState = (state, announcement, ariaLabel) => {
    root.dataset.state = state;
    stateEl.textContent = announcement;
    toggleBtn.setAttribute("aria-label", ariaLabel);
  };

  /** Point the player at track i (wrap-aware) and optionally start it. */
  function loadTrack(i, andPlay) {
    index = ((i % N) + N) % N;              // the codebase's wrap idiom
    const t = tracks[index];

    titleEl.textContent = t.title || "UNTITLED";

    if (t.cover) {
      art.hidden = false;
      // Guard the re-assign: setting an identical src still re-runs the
      // load in some browsers, which can flash the image.
      if (art.getAttribute("src") !== t.cover) art.src = t.cover;
    } else {
      art.hidden = true;
      art.removeAttribute("src");
    }

    audio.src = t.src;
    if (andPlay) attemptPlay();
  }

  /** Every programmatic start goes through here so the autoplay-blocked
      fallback is uniform: on rejection, announce standby and arm the
      first-gesture resume. (armGesture is idempotent — re-adding the same
      listener refs is a no-op.) */
  function attemptPlay() {
    audio.play().catch(() => {
      if (root.dataset.state !== "error") setState("standby", "/ TAP.TO.START", "Play");
      armGesture();
    });
  }

  /* ---------------------------------------------------------------------------
     FIRST-GESTURE RESUME — see AUTOPLAY in the header.
     --------------------------------------------------------------------------- */
  const onFirstPointer = (e) => {
    if (root.contains(e.target)) return;                 // the transport owns its own gestures
    audio.play().catch(() => {});
  };
  const onFirstKey = () => {
    if (root.contains(document.activeElement)) return;   // Enter on a button = that button's job
    audio.play().catch(() => {});
  };
  function armGesture() {
    window.addEventListener("pointerdown", onFirstPointer);
    window.addEventListener("keydown", onFirstKey);
  }
  function disarmGesture() {
    window.removeEventListener("pointerdown", onFirstPointer);
    window.removeEventListener("keydown", onFirstKey);
  }

  /* ---------------------------------------------------------------------------
     AUDIO EVENTS — the element is the single source of truth for the UI.
     --------------------------------------------------------------------------- */
  audio.addEventListener("play", () => {
    disarmGesture();   // whatever started playback, the first-gesture arm is done
    setState("playing", "/ NOW.PLAYING", "Pause");
  });

  audio.addEventListener("pause", () => setState("paused", "/ PAUSED", "Play"));

  // 'playing' (actual rendering began) rather than 'play' (paused flag
  // flipped) for the streak reset: 'play' fires even for a source that is
  // about to fail, 'playing' only for one that genuinely started.
  audio.addEventListener("playing", () => { errorStreak = 0; });

  audio.addEventListener("ended", () => {
    // Natural end of the last track with loop off: stop. The element has
    // already fired 'pause', so the readout honestly shows / PAUSED.
    if (!loop && index === N - 1) return;
    loadTrack(index + 1, true);
  });

  audio.addEventListener("error", () => {
    console.warn(`[musicPlayer] track failed to load: ${tracks[index].src}`);
    errorStreak += 1;
    if (errorStreak >= N) {
      // Every track in the list has failed consecutively — stop skipping
      // and say so. Warn red is sanctioned here: this component uses red
      // for nothing else, and a fully dead list is a genuine failure.
      disarmGesture();
      setState("error", "/ NO.SIGNAL", "Play");
      return;
    }
    loadTrack(index + 1, true);   // skip the dead file, keep the set going
  });

  /* ---------------------------------------------------------------------------
     TRANSPORT — skips start playback (even from paused) and always wrap;
     `loop` governs only the automatic cycle. Back restarts past
     PREV_RESTART_S seconds, per the real-player convention.
     --------------------------------------------------------------------------- */
  toggleBtn.addEventListener("click", () => {
    if (audio.paused) attemptPlay();
    else audio.pause();
  });

  prevBtn.addEventListener("click", () => {
    if (audio.currentTime > PREV_RESTART_S) {
      audio.currentTime = 0;
      attemptPlay();
    } else {
      loadTrack(index - 1, true);
    }
  });

  nextBtn.addEventListener("click", () => loadTrack(index + 1, true));

  /* ---------------------------------------------------------------------------
     KICKOFF — point at track 0, then attempt autoplay; attemptPlay owns the
     blocked fallback.
     --------------------------------------------------------------------------- */
  loadTrack(0, false);
  attemptPlay();
}