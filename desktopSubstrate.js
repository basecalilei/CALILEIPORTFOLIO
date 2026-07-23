/* =============================================================================
   desktopSubstrate.js — the "substrate" FILE TYPE (desktopPanel family)
   -----------------------------------------------------------------------------
   Hosts CALILEI.[SUBSTRATE] — the emergent-motion design tool — in a
   desktop window: a white stage of concentric metaball spheres beside a
   dark instrument sidecar of schema-driven controls. The engine is the
   two ported sub-modules (desktopSubstrateSim.js — behavior,
   desktopSubstrateScene.js — rendering); THIS file is the hosting: the
   window DOM, the control panel, the clock, liveness, and teardown.

   THE WINDOW IS AN ALTERNATE COMPOSITION ROOT for the tool — it plays
   the role the standalone page's inline script played: build the panel,
   construct the SphereStage, wire the schema rows, boot a composition.
   The panel-builder section below is that script, ported near-verbatim;
   its functional changes are marked PORT.

   THE CLOCK
     This module owns a requestAnimationFrame loop while the tool is
     live, passing frame-timestamp deltas (seconds) into stage.tick(dt);
     the stage's own 50ms clamp still applies. The loop exists only
     while LIVE — a closed, minimized, blurred, or off-panel substrate
     schedules nothing and burns no GPU.

   LIVENESS — one rule: THE TOOL RUNS WHILE FOCUS IS WITHIN ITS ROOT.
     desktopGame's focus model, adapted one step: the game's input is
     the keyboard, so ITS surface is the focus target; the substrate's
     input is the controls INSIDE the window, so liveness is focus-
     WITHIN — dragging a slider keeps the sim running because the
     slider is a descendant. The wiring:

     pointerdown → root.focus() (Safari doesn't focus tabindexed
                elements on click natively — the same explicit call
                desktopGame makes; natively-focusable controls then
                take focus themselves, which still counts)
     focusin  → loop starts (delta base reset: a resume, never a
                catch-up)
     focusout → loop stops, if focus actually left the root
     click    → a microtask re-anchors focus if the click destroyed the
                focused element (Remove pool / Remove sphere / a
                composition swap rebuilding the sections) — a click
                INSIDE must never read as clicking away
     minimize → blur + stop; the frozen frame flies to the taskbar
     restore  → refocus (restoring IS "give me the tool back")
     Escape   → deliberate release valve (game parity)
     scroll away → the live loop watches its overlay's .is-clear class,
                the desktop's own interaction gate — identical read and
                reasoning to desktopGame (the core's .is-active opens a
                dead zone near the panel edge; see that file's header).
                The loop also re-verifies focus-within each frame,
                because removing a focused element drops focus to
                <body> WITHOUT firing focusout.

     No auto-resume on scroll-back: the frozen frame and the CLICK TO
     RESUME chip (pure CSS off :focus-within — the hint reads the same
     truth the loop does) wait for a deliberate click. Opening the
     window auto-focuses: opening IS the deliberate ask, and unlike the
     game there is no keyboard to capture by surprise.

   THE FROZEN FRAME
     Stopping rAF leaves the last presented frame on screen — but
     renderer.setSize clears it, so the ResizeObserver repaints once
     via stage.tick(0) (a pure repaint: uniforms rewritten, nothing
     advanced) whenever the window is drag-resized while idle. The
     in-panel PAUSE button is a different axis entirely — it freezes
     SIM time while the loop keeps running — and is kept verbatim.

   SESSION SNAPSHOT
     onClose serializes the whole stage — globals, layers, pools
     (color, visibility, params) — into file.state; the next open
     boots from it (else COMPOSITIONS[0]). The audio/note persistence
     pattern at full width: session-only, schema values only. Blob
     positions and phases reseed fresh, which is correct — they were
     never authored. Pause is deliberately not part of the snapshot.

   THE SECOND RENDERER
     threeArray's one-renderer rule governs the scroll scene system; a
     window's content is its own world — the same posture as the game's
     canvas. One WebGL context per open, released hard on close
     (dispose + forceContextLoss) so open/close cycles never creep
     toward the browser's context cap.

   COMPOSITIONS — authored IN THIS FILE (the musicPlayer TRACKS
     precedent: the preset library is this feature's content, and the
     PANELS entry stays one line). Each entry is one full stage state;
     the first is the boot state for a fresh session. Adding an entry
     here is the whole of authoring a new preset.
   ========================================================================== */

import { registerFileType } from "./desktopPanel.js";
import * as Sim from "./desktopSubstrateSim.js";
import { SphereStage } from "./desktopSubstrateScene.js";

/* -----------------------------------------------------------------------------
   THE COMPOSITION LIBRARY — ported verbatim from the standalone page.
   --------------------------------------------------------------------------- */

const COMPOSITIONS = [
  {
    /* The hero: four tightly nested polychrome layers. */
    name: 'TEXWAX',
    global: { rotation: 0.25, tilt: 12, timeScale: 0.2 },
    spheres: [
      {
        radius: 1.00, spin: 1.0, tiltOffset: 0, backOpacity: 0.9,
        pools: [{
          hex: '#00b8e6',
          params: {
            blobCount: 10, blobSize: 0.9, sizeVariance: 0.5, pulse: 0.25,
            spread: 0.7, cohesion: 0.0, separation: 2.0, wander: 2.0,
            swirl: 2.0, speed: 0.6, tension: 0.6, cling: 0.6,
            wobble: 0.5, wobbleScale: 1.0, wobbleSpeed: 2.0, opacity: 0.95
          }
        }]
      },
      {
        radius: 0.98, spin: 1.0, tiltOffset: 0, backOpacity: 0.9,
        pools: [{
          hex: '#00d150',
          params: {
            blobCount: 8, blobSize: 0.9, sizeVariance: 0.4, pulse: 0.4,
            spread: 1.25, cohesion: 0.1, separation: 2.0, wander: 2.0,
            swirl: 0.6, speed: 1.0, tension: 0.4, cling: 0.75,
            wobble: 0.45, wobbleScale: 1.2, wobbleSpeed: 0.5, opacity: 0.95
          }
        }]
      },
      {
        radius: 0.96, spin: 1.5, tiltOffset: 0, backOpacity: 0.9,
        pools: [{
          hex: '#ffbb00',
          params: {
            blobCount: 10, blobSize: 0.9, sizeVariance: 0.25, pulse: 0.3,
            spread: 1.6, cohesion: 0.1, separation: 2.0, wander: 2.0,
            swirl: 0.3, speed: 0.6, tension: 0.6, cling: 0.6,
            wobble: 0.5, wobbleScale: 1.5, wobbleSpeed: 0.5, opacity: 0.95
          }
        }]
      },
      {
        radius: 0.94, spin: 2.0, tiltOffset: 0, backOpacity: 0.9,
        pools: [{
          hex: '#ff4d00',
          params: {
            blobCount: 10, blobSize: 0.9, sizeVariance: 0.35, pulse: 0.4,
            spread: 1.6, cohesion: 0.0, separation: 2.0, wander: 2.0,
            swirl: 2.0, speed: 0.6, tension: 0.4, cling: 0.6,
            wobble: 0.5, wobbleScale: 1.0, wobbleSpeed: 0.5, opacity: 0.95
          }
        }]
      }
    ]
  },

  {
    name: 'EGG',
    global: { rotation: 0.00, tilt: 0, timeScale: 2.50 },
    spheres: [
      {
        radius: 1.00, spin: 1.00, tiltOffset: 0, backOpacity: 1.00,
        pools: [{
          hex: '#f0f0f0',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.20, pulse: 0.50,
            spread: 0.55, cohesion: 0.50, separation: 0.25, wander: 2.00,
            swirl: 0.20, speed: 0.35, tension: 1.09, cling: 1.20,
            wobble: 0.31, wobbleScale: 1.5, wobbleSpeed: 1.00, opacity: 0.25
          }
        }, {
          hex: '#f0f0f0',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.20, pulse: 0.50,
            spread: 0.55, cohesion: 0.50, separation: 0.25, wander: 2.00,
            swirl: 0.20, speed: 0.35, tension: 1.09, cling: 1.20,
            wobble: 0.31, wobbleScale: 1.5, wobbleSpeed: 1.00, opacity: 0.25
          }
        }, {
          hex: '#f0f0f0',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.20, pulse: 0.50,
            spread: 0.55, cohesion: 0.50, separation: 0.25, wander: 2.00,
            swirl: 0.20, speed: 0.35, tension: 1.09, cling: 1.20,
            wobble: 0.31, wobbleScale: 1.5, wobbleSpeed: 1.00, opacity: 0.25
          }
        }, {
          hex: '#f0f0f0',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.20, pulse: 0.50,
            spread: 0.55, cohesion: 0.50, separation: 0.25, wander: 2.00,
            swirl: 0.20, speed: 0.35, tension: 1.09, cling: 1.20,
            wobble: 0.31, wobbleScale: 1.5, wobbleSpeed: 1.00, opacity: 0.25
          }
        }]
      },
      {
        radius: 0.36, spin: -0.60, tiltOffset: 0, backOpacity: 1.00,
        pools: [{
          hex: '#ffb300',
          params: {
            blobCount: 5, blobSize: 0.90, sizeVariance: 0.30, pulse: 0.60,
            spread: 0.40, cohesion: 0.32, separation: 0.70, wander: 2.00,
            swirl: -0.50, speed: 0.30, tension: 0.35, cling: 1.00,
            wobble: 0.50, wobbleScale: 0.7, wobbleSpeed: 1.19, opacity: 0.50
          }
        }, {
          hex: '#ffb300',
          params: {
            blobCount: 5, blobSize: 0.90, sizeVariance: 0.30, pulse: 0.60,
            spread: 0.40, cohesion: 0.32, separation: 0.70, wander: 2.00,
            swirl: -0.50, speed: 0.30, tension: 0.35, cling: 1.00,
            wobble: 0.50, wobbleScale: 0.7, wobbleSpeed: 1.19, opacity: 0.50
          }
        }, {
          hex: '#ffb300',
          params: {
            blobCount: 5, blobSize: 0.90, sizeVariance: 0.30, pulse: 0.60,
            spread: 0.40, cohesion: 0.32, separation: 0.70, wander: 2.00,
            swirl: -0.50, speed: 0.30, tension: 0.35, cling: 1.00,
            wobble: 0.50, wobbleScale: 0.7, wobbleSpeed: 1.19, opacity: 0.50
          }
        }, {
          hex: '#ffb300',
          params: {
            blobCount: 5, blobSize: 0.90, sizeVariance: 0.30, pulse: 0.60,
            spread: 0.40, cohesion: 0.32, separation: 0.70, wander: 2.00,
            swirl: -0.50, speed: 0.30, tension: 0.35, cling: 1.00,
            wobble: 0.50, wobbleScale: 0.7, wobbleSpeed: 1.19, opacity: 0.50
          }
        }]
      },
      {
        radius: 0.40, spin: 1.00, tiltOffset: 0, backOpacity: 1.00,
        pools: [{
          hex: '#ffc800',
          params: {
            blobCount: 7, blobSize: 0.38, sizeVariance: 0.35, pulse: 0.12,
            spread: 0.70, cohesion: 0.80, separation: 0.50, wander: 0.90,
            swirl: 0.30, speed: 0.60, tension: 0.65, cling: 1.00,
            wobble: 0.12, wobbleScale: 3.0, wobbleSpeed: 0.50, opacity: 1.00
          }
        }]
      }
    ]
  },
  {
    /* A dish under the lens: one sphere, three cultures of small
       quick cells — high separation and wander, near-zero cohesion,
       so everything divides and collides instead of pooling. */
    name: 'PETRI',
    global: { rotation: 0.18, tilt: 24, timeScale: 0.9 },
    spheres: [
      {
        radius: 1.0, spin: 1.0, tiltOffset: 0, backOpacity: 0.55,
        pools: [
          {
            hex: '#e91e8c',
            params: {
              blobCount: 16, blobSize: 0.16, sizeVariance: 0.6, pulse: 0.25,
              spread: 1.5, cohesion: 0.15, separation: 1.6, wander: 1.7,
              swirl: 0.2, speed: 1.2, tension: 0.7, cling: 0.8,
              wobble: 0.1, wobbleScale: 5.0, wobbleSpeed: 1.2, opacity: 0.95
            }
          },
          {
            hex: '#00c853',
            params: {
              blobCount: 14, blobSize: 0.2, sizeVariance: 0.5, pulse: 0.3,
              spread: 1.3, cohesion: 0.25, separation: 1.4, wander: 1.5,
              swirl: -0.4, speed: 1.0, tension: 0.75, cling: 0.7,
              wobble: 0.12, wobbleScale: 6.0, wobbleSpeed: 1.4, opacity: 0.9
            }
          },
          {
            hex: '#651fff',
            params: {
              blobCount: 12, blobSize: 0.24, sizeVariance: 0.7, pulse: 0.2,
              spread: 1.6, cohesion: 0.1, separation: 1.8, wander: 1.9,
              swirl: 0.6, speed: 1.4, tension: 0.8, cling: 0.6,
              wobble: 0.08, wobbleScale: 7.0, wobbleSpeed: 1.6, opacity: 0.85
            }
          }
        ]
      }
    ]
  },

  {
    name: 'ALLOY',
    global: { rotation: 0.25, tilt: 12, timeScale: 1.00 },
    spheres: [
      {
        radius: 1.00, spin: 1.00, tiltOffset: 0, backOpacity: 0.90,
        pools: [{
          hex: '#b4b5b6',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.50, pulse: 0.25,
            spread: 0.70, cohesion: 0.00, separation: 2.00, wander: 2.00,
            swirl: 2.00, speed: 0.60, tension: 0.60, cling: 0.60,
            wobble: 0.50, wobbleScale: 8.0, wobbleSpeed: 2.00, opacity: 0.50
          }
        }, {
          hex: '#aab1ad',
          params: {
            blobCount: 8, blobSize: 0.90, sizeVariance: 0.40, pulse: 0.40,
            spread: 1.25, cohesion: 0.10, separation: 2.00, wander: 2.00,
            swirl: 0.60, speed: 1.00, tension: 0.40, cling: 0.75,
            wobble: 0.45, wobbleScale: 8.0, wobbleSpeed: 0.50, opacity: 0.50
          }
        }, {
          hex: '#ebebeb',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.25, pulse: 0.30,
            spread: 1.60, cohesion: 0.10, separation: 2.00, wander: 2.00,
            swirl: 0.30, speed: 0.60, tension: 0.60, cling: 0.60,
            wobble: 0.50, wobbleScale: 8.0, wobbleSpeed: 0.50, opacity: 0.50
          }
        }, {
          hex: '#7a7a7a',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.35, pulse: 0.40,
            spread: 1.60, cohesion: 0.00, separation: 2.00, wander: 2.00,
            swirl: 2.00, speed: 0.60, tension: 0.40, cling: 0.60,
            wobble: 0.50, wobbleScale: 8.0, wobbleSpeed: 0.50, opacity: 0.50
          }
        }]
      },
      {
        radius: 0.98, spin: 1.00, tiltOffset: 0, backOpacity: 0.90,
        pools: [{
          hex: '#1c1c1c',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.50, pulse: 0.25,
            spread: 0.70, cohesion: 0.00, separation: 2.00, wander: 2.00,
            swirl: 2.00, speed: 0.60, tension: 0.60, cling: 0.60,
            wobble: 0.50, wobbleScale: 8.0, wobbleSpeed: 2.00, opacity: 0.50
          }
        }, {
          hex: '#5c605e',
          params: {
            blobCount: 8, blobSize: 0.90, sizeVariance: 0.40, pulse: 0.40,
            spread: 1.25, cohesion: 0.10, separation: 2.00, wander: 2.00,
            swirl: 0.60, speed: 1.00, tension: 0.40, cling: 0.75,
            wobble: 0.45, wobbleScale: 8.0, wobbleSpeed: 0.50, opacity: 0.50
          }
        }, {
          hex: '#5f5f5d',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.25, pulse: 0.30,
            spread: 1.60, cohesion: 0.10, separation: 2.00, wander: 2.00,
            swirl: 0.30, speed: 0.60, tension: 0.60, cling: 0.60,
            wobble: 0.50, wobbleScale: 8.0, wobbleSpeed: 0.50, opacity: 0.50
          }
        }, {
          hex: '#c4c4c4',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.35, pulse: 0.40,
            spread: 1.60, cohesion: 0.00, separation: 2.00, wander: 2.00,
            swirl: 2.00, speed: 0.60, tension: 0.40, cling: 0.60,
            wobble: 0.50, wobbleScale: 8.0, wobbleSpeed: 0.50, opacity: 0.50
          }
        }]
      }
    ]
  },

  {
    name: 'BUBBLE',
    global: { rotation: 0.25, tilt: 12, timeScale: 0.50 },
    spheres: [
      {
        radius: 1.00, spin: 1.00, tiltOffset: 0, backOpacity: 0.90,
        pools: [{
          hex: '#00b8e6',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.50, pulse: 0.25,
            spread: 0.70, cohesion: 0.00, separation: 2.00, wander: 2.00,
            swirl: 2.00, speed: 0.60, tension: 0.60, cling: 0.60,
            wobble: 0.50, wobbleScale: 8.0, wobbleSpeed: 2.00, opacity: 0.20
          }
        }, {
          hex: '#7aedf5',
          params: {
            blobCount: 8, blobSize: 0.90, sizeVariance: 0.40, pulse: 0.40,
            spread: 1.25, cohesion: 0.10, separation: 2.00, wander: 2.00,
            swirl: 0.60, speed: 1.00, tension: 0.40, cling: 0.75,
            wobble: 0.45, wobbleScale: 8.0, wobbleSpeed: 0.50, opacity: 0.20
          }
        }, {
          hex: '#82dcf2',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.25, pulse: 0.30,
            spread: 1.60, cohesion: 0.10, separation: 2.00, wander: 2.00,
            swirl: 0.30, speed: 0.60, tension: 0.60, cling: 0.60,
            wobble: 0.50, wobbleScale: 8.0, wobbleSpeed: 0.50, opacity: 0.20
          }
        }, {
          hex: '#48c1f4',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.35, pulse: 0.40,
            spread: 1.60, cohesion: 0.00, separation: 2.00, wander: 2.00,
            swirl: 2.00, speed: 0.60, tension: 0.40, cling: 0.60,
            wobble: 0.50, wobbleScale: 8.0, wobbleSpeed: 0.50, opacity: 0.20
          }
        }]
      },
      {
        radius: 0.86, spin: 1.00, tiltOffset: 0, backOpacity: 0.90,
        pools: [{
          hex: '#00b8e6',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.50, pulse: 0.25,
            spread: 0.70, cohesion: 0.00, separation: 2.00, wander: 2.00,
            swirl: 2.00, speed: 0.60, tension: 0.60, cling: 0.60,
            wobble: 0.50, wobbleScale: 1.0, wobbleSpeed: 2.00, opacity: 0.50
          }
        }, {
          hex: '#00849e',
          params: {
            blobCount: 8, blobSize: 0.90, sizeVariance: 0.40, pulse: 0.40,
            spread: 1.25, cohesion: 0.10, separation: 2.00, wander: 2.00,
            swirl: 0.60, speed: 1.00, tension: 0.40, cling: 0.75,
            wobble: 0.45, wobbleScale: 1.2, wobbleSpeed: 0.50, opacity: 0.50
          }
        }, {
          hex: '#0091ff',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.25, pulse: 0.30,
            spread: 1.60, cohesion: 0.10, separation: 2.00, wander: 2.00,
            swirl: 0.30, speed: 0.60, tension: 0.60, cling: 0.60,
            wobble: 0.50, wobbleScale: 1.2, wobbleSpeed: 0.50, opacity: 0.50
          }
        }, {
          hex: '#00ccff',
          params: {
            blobCount: 10, blobSize: 0.90, sizeVariance: 0.35, pulse: 0.40,
            spread: 1.60, cohesion: 0.00, separation: 2.00, wander: 2.00,
            swirl: 2.00, speed: 0.60, tension: 0.40, cling: 0.60,
            wobble: 0.50, wobbleScale: 1.0, wobbleSpeed: 0.50, opacity: 0.50
          }
        }]
      },
      {
        radius: 0.93, spin: 1.00, tiltOffset: 0, backOpacity: 1.00,
        pools: [{
          hex: '#89cae6',
          params: {
            blobCount: 16, blobSize: 0.60, sizeVariance: 0.00, pulse: 0.12,
            spread: 1.60, cohesion: 0.21, separation: 2.00, wander: 0.90,
            swirl: 0.30, speed: 0.60, tension: 0.33, cling: 0.67,
            wobble: 0.34, wobbleScale: 1.8, wobbleSpeed: 0.50, opacity: 0.35
          }
        }, {
          hex: '#3dade6',
          params: {
            blobCount: 16, blobSize: 0.60, sizeVariance: 0.00, pulse: 0.12,
            spread: 1.60, cohesion: 0.21, separation: 2.00, wander: 0.90,
            swirl: 0.30, speed: 0.60, tension: 0.33, cling: 0.67,
            wobble: 0.34, wobbleScale: 1.8, wobbleSpeed: 0.50, opacity: 0.35
          }
        }, {
          hex: '#1f96e0',
          params: {
            blobCount: 16, blobSize: 0.60, sizeVariance: 0.00, pulse: 0.12,
            spread: 1.60, cohesion: 0.21, separation: 2.00, wander: 0.90,
            swirl: 0.30, speed: 0.60, tension: 0.33, cling: 0.67,
            wobble: 0.34, wobbleScale: 1.8, wobbleSpeed: 0.50, opacity: 0.35
          }
        }, {
          hex: '#29afd1',
          params: {
            blobCount: 16, blobSize: 0.60, sizeVariance: 0.00, pulse: 0.12,
            spread: 1.60, cohesion: 0.21, separation: 2.00, wander: 0.90,
            swirl: 0.30, speed: 0.60, tension: 0.33, cling: 0.67,
            wobble: 0.34, wobbleScale: 1.8, wobbleSpeed: 0.50, opacity: 0.35
          }
        }]
      },
      {
        radius: 1.00, spin: -1.00, tiltOffset: 0, backOpacity: 1.00,
        pools: [{
          hex: '#ffffff',
          params: {
            blobCount: 16, blobSize: 0.38, sizeVariance: 0.35, pulse: 0.12,
            spread: 1.60, cohesion: 0.80, separation: 0.50, wander: 2.00,
            swirl: 0.30, speed: 0.60, tension: 1.40, cling: 1.00,
            wobble: 0.12, wobbleScale: 3.0, wobbleSpeed: 0.50, opacity: 1.00
          }
        }, {
          hex: '#ffffff',
          params: {
            blobCount: 16, blobSize: 0.38, sizeVariance: 0.35, pulse: 0.12,
            spread: 1.60, cohesion: 0.80, separation: 0.50, wander: 2.00,
            swirl: 0.30, speed: 0.60, tension: 1.40, cling: 1.00,
            wobble: 0.12, wobbleScale: 3.0, wobbleSpeed: 0.50, opacity: 1.00
          }
        }]
      }
    ]
  },

  {
    name: 'SUMI',
    global: { rotation: 0.10, tilt: -18, timeScale: 0.10 },
    spheres: [
      {
        radius: 1.00, spin: 0.80, tiltOffset: 0, backOpacity: 1.00,
        pools: [{
          hex: '#101014',
          params: {
            blobCount: 5, blobSize: 0.75, sizeVariance: 0.45, pulse: 0.10,
            spread: 0.90, cohesion: 0.90, separation: 0.60, wander: 0.80,
            swirl: 1.10, speed: 0.50, tension: 0.90, cling: 1.60,
            wobble: 0.22, wobbleScale: 3.0, wobbleSpeed: 0.30, opacity: 1.00
          }
        }]
      },
      {
        radius: 0.80, spin: -1.20, tiltOffset: 10, backOpacity: 0.40,
        pools: [{
          hex: '#2b2b45',
          params: {
            blobCount: 8, blobSize: 0.50, sizeVariance: 0.50, pulse: 0.15,
            spread: 1.10, cohesion: 0.60, separation: 0.80, wander: 1.10,
            swirl: -0.80, speed: 0.65, tension: 0.80, cling: 1.30,
            wobble: 0.18, wobbleScale: 3.5, wobbleSpeed: 0.40, opacity: 0.80
          }
        }]
      },
      {
        radius: 0.58, spin: 1.60, tiltOffset: -12, backOpacity: 0.93,
        pools: [{
          hex: '#4a4a7a',
          params: {
            blobCount: 11, blobSize: 0.39, sizeVariance: 0.83, pulse: 0.20,
            spread: 1.40, cohesion: 0.35, separation: 1.10, wander: 1.40,
            swirl: 1.00, speed: 2.00, tension: 0.99, cling: 0.90,
            wobble: 0.10, wobbleScale: 6.5, wobbleSpeed: 0.80, opacity: 0.60
          }
        }]
      }
    ]
  }
];

/* -----------------------------------------------------------------------------
   Small DOM helpers
   --------------------------------------------------------------------------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function btn(label, className) {
  const b = el("button", className, label);
  b.type = "button";
  return b;
}

/* -----------------------------------------------------------------------------
   REGISTRATION — the "substrate" type
   --------------------------------------------------------------------------- */

registerFileType("substrate", {

  // A sphere under rotation carrying two pools: tintable outline and
  // equator (currentColor), fillable pool bodies (desktop-glyph-fill).
  buildIcon() {
    const wrap = el("div", "desktop-substrate-glyph");
    wrap.innerHTML = `
      <svg viewBox="0 0 36 36" fill="none"
           xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="18" cy="18" r="13"
                stroke="currentColor" stroke-width="1.5" />
        <ellipse cx="18" cy="18" rx="13" ry="4.2"
                 stroke="currentColor" stroke-width="0.9" opacity="0.5" />
        <path d="M11.5,12.6 C13.2,10.2 17.4,9.8 19.2,12.0
                 C21.0,14.2 19.6,17.2 16.6,17.8
                 C13.6,18.4 10.4,16.6 10.8,14.4
                 C11.0,13.6 11.1,13.2 11.5,12.6 Z"
              class="desktop-glyph-fill"
              stroke="currentColor" stroke-width="1.2" />
        <path d="M21.6,20.0 C23.8,18.9 26.4,19.9 26.8,21.9
                 C27.2,23.9 25.3,25.6 23.0,25.3
                 C20.7,25.0 19.6,23.1 20.5,21.5
                 C20.8,20.9 21.1,20.3 21.6,20.0 Z"
              class="desktop-glyph-fill"
              stroke="currentColor" stroke-width="1.2" />
      </svg>
    `;
    return wrap;
  },

  buildWindow(file, win) {
    // ---------- DOM: root > frame(sidecar panel + stage) ----------
    const root = el("div", "desktop-substrate");
    root.tabIndex = 0;               // the focus anchor; controls inside
                                     //   also count — liveness is focus-WITHIN

    const frame = el("div", "substrate-frame");
    root.appendChild(frame);

    const panel = el("aside", "desktop-substrate-panel");
    frame.appendChild(panel);

    const masthead = el("header", "substrate-masthead");
    masthead.appendChild(el("div", "substrate-title", "// CALILEI.[SUBSTRATE]"));
    masthead.appendChild(el("p", null,
      "Graphic liquid pools traversing the surface of translucent, " +
      "concentric rotating spheres."));
    masthead.appendChild(el("p", null,
      "The volume is implied by motion, depth is implied by opacity."));
    panel.appendChild(masthead);

    const stageBlock = el("section", "substrate-block");
    stageBlock.appendChild(el("div", "substrate-block-title", "Stage"));
    const globalRowsEl = el("div");
    stageBlock.appendChild(globalRowsEl);
    const randRow = el("div", "btns");
    const randPoolsBtn = btn("Randomize pools");
    const randColorBtn = btn("Randomize color");
    randRow.appendChild(randPoolsBtn);
    randRow.appendChild(randColorBtn);
    stageBlock.appendChild(randRow);
    const pauseRow = el("div", "btns");
    const pauseBtn = btn("Pause");
    pauseRow.appendChild(pauseBtn);
    stageBlock.appendChild(pauseRow);
    panel.appendChild(stageBlock);

    const compBlock = el("section", "substrate-block");
    compBlock.appendChild(el("div", "substrate-block-title", "User compositions"));
    const compListEl = el("div", "substrate-comps");
    compBlock.appendChild(compListEl);
    panel.appendChild(compBlock);

    const spheresEl = el("div", "substrate-spheres");
    panel.appendChild(spheresEl);

    const foot = el("footer", "substrate-foot");
    const addSphereBtn = btn("Add sphere");
    const sphereCountEl = el("span", "count");
    foot.appendChild(addSphereBtn);
    foot.appendChild(sphereCountEl);
    panel.appendChild(foot);

    const stageEl = el("div", "desktop-substrate-stage");
    frame.appendChild(stageEl);

    // ---------- The stage (its canvas appends into stageEl) ----------
    let stage;
    try {
      stage = new SphereStage(stageEl);
    } catch (err) {
      console.error(
        `desktopSubstrate "${file.name}": WebGL context creation failed`, err);
      stageEl.appendChild(el("p", "stage-error",
        "WebGL unavailable — the substrate needs a GPU context."));
      return root;                   // an inert window beats a thrown build
    }

    // The hint rides ABOVE the canvas (appended after it); CSS shows it
    // only while focus is elsewhere — see :focus-within in the styles.
    const hint = el("div", "desktop-substrate-hint");
    hint.appendChild(el("span", null, "CLICK TO RESUME"));
    stageEl.appendChild(hint);

    /* ======================================================== the panel
       Ported from the standalone page's inline script. Structure and
       identifiers kept intentionally close; the only functional
       changes are marked PORT. */

    let sphereNum = 0;

    /* Registry of live sphere sections. Each ui carries one rec per
       pool section — the handles the global randomize buttons reach
       through. Built sections register here; removal deregisters. */
    const sphereUIs = [];

    /* ------------------------------------------------ shared row builder */

    function fmtVal(v, def) {
      return Number(v).toFixed(def.fmt) + (def.unit || "");
    }

    /* One slider row: label + live readout above a full-width track.
       Returns a sync() so randomize can push sim state back into the UI. */
    function sliderRow(def, get, set) {
      const row = el("div", "row");

      const head = el("div", "row-head");
      const label = el("span", null, def.label);
      const val = el("span", "val");
      head.appendChild(label);
      head.appendChild(val);

      const input = document.createElement("input");
      input.type = "range";
      input.min = def.min;
      input.max = def.max;
      input.step = def.step;
      input.setAttribute("aria-label", def.label);
      input.addEventListener("input", () => {
        set(parseFloat(input.value));
        val.textContent = fmtVal(get(), def);
      });

      row.appendChild(head);
      row.appendChild(input);

      function sync() {
        input.value = get();
        val.textContent = fmtVal(get(), def);
      }
      sync();

      return { el: row, sync };
    }

    /* ------------------------------------------------------ stage block */

    const GLOBAL_PARAMS = [
      { key: "rotation",  label: "Rotation",  min: -1.2, max: 1.2, step: 0.01, def: 0.25, fmt: 2 },
      { key: "tilt",      label: "Axis tilt", min: -45,  max: 45,  step: 1,    def: 12,   fmt: 0, unit: "\u00B0" },
      { key: "timeScale", label: "Sim speed", min: 0,    max: 2.5, step: 0.01, def: 1,    fmt: 2 }
    ];

    const globalSyncs = [];
    GLOBAL_PARAMS.forEach((def) => {
      stage.setGlobal(def.key, def.def);
      const row = sliderRow(def,
        () => stage.global[def.key],
        (v) => stage.setGlobal(def.key, v));
      globalSyncs.push(row.sync);
      globalRowsEl.appendChild(row.el);
    });

    pauseBtn.addEventListener("click", () => {
      const paused = !stage.global.paused;
      stage.setGlobal("paused", paused);
      pauseBtn.textContent = paused ? "Resume" : "Pause";
      pauseBtn.setAttribute("aria-pressed", String(paused));
    });

    /* ------------------------------------------------------- pool blocks */

    function buildPoolSection(layer, ui, sim) {
      const details = document.createElement("details");
      details.className = "pool";
      details.open = true;
      details.style.setProperty("--accent", sim.color);

      /* Header: swatch, name, hide toggle, open marker. PORT: the
         toggle's initial state reads sim.visible — a session snapshot
         can restore a hidden pool (the standalone always booted
         pools visible). */
      const summary = document.createElement("summary");
      const dot = el("span", "dot");
      const name = el("span", "pool-name", sim.name);
      const vis = btn(sim.visible ? "Hide" : "Show", "vis");
      details.classList.toggle("is-hidden", !sim.visible);
      vis.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        sim.visible = !sim.visible;
        vis.textContent = sim.visible ? "Hide" : "Show";
        details.classList.toggle("is-hidden", !sim.visible);
      });
      const marker = el("span", "marker");
      summary.appendChild(dot);
      summary.appendChild(name);
      summary.appendChild(vis);
      summary.appendChild(marker);
      details.appendChild(summary);

      const body = el("div", "pool-body");

      /* Color — the pool inks its own section through --accent. */
      const colorRow = el("div", "row color-row");
      const colorHead = el("div", "row-head");
      const colorLabel = el("span", null, "Color");
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = sim.color;
      colorInput.setAttribute("aria-label", sim.name + " color");
      colorInput.addEventListener("input", () => {
        sim.color = colorInput.value;
        details.style.setProperty("--accent", sim.color);
      });
      colorHead.appendChild(colorLabel);
      colorHead.appendChild(colorInput);
      colorRow.appendChild(colorHead);
      body.appendChild(colorRow);

      /* Every behavior control comes straight from the schema. */
      const syncs = [];
      Sim.POOL_PARAMS.forEach((def) => {
        const row = sliderRow(def,
          () => sim.params[def.key],
          (v) => sim.setParam(def.key, v));
        syncs.push(row.sync);
        body.appendChild(row.el);
      });

      /* The section's handle: everything a global button needs to
         reach this pool — resync after a randomize, recolor, or tear
         down. The section's own buttons go through the same closures. */
      const rec = {
        sim,
        refreshColor() {
          colorInput.value = sim.color;
          details.style.setProperty("--accent", sim.color);
        },
        refresh() {
          rec.refreshColor();
          syncs.forEach((s) => s());
        },
        remove() {
          stage.removePool(layer, sim);
          details.remove();
          const k = ui.poolRecs.indexOf(rec);
          if (k !== -1) ui.poolRecs.splice(k, 1);
          ui.updatePoolFooter();
        }
      };
      ui.poolRecs.push(rec);

      const btns = el("div", "btns");
      const randBtn = btn("Randomize");
      randBtn.addEventListener("click", () => {
        sim.randomize();
        rec.refresh();
      });
      const removeBtn = btn("Remove", "danger");
      removeBtn.addEventListener("click", rec.remove);
      btns.appendChild(randBtn);
      btns.appendChild(removeBtn);
      body.appendChild(btns);

      details.appendChild(body);
      ui.poolsEl.appendChild(details);
    }

    /* Opts that make a new pool a sibling of the section above it:
       every schema param plus the color, and nothing else. Position,
       swirl axis, and per-blob phases still seed fresh, so the pair
       behaves alike without landing on top of each other. Null when
       the sphere has no pools left — the caller then gets schema
       defaults in a random color. */
    function inheritOpts(ui) {
      const above = ui.poolRecs[ui.poolRecs.length - 1];
      if (!above) return null;
      return {
        color: above.sim.color,
        params: Object.assign({}, above.sim.params)
      };
    }

    function addPoolTo(layer, ui, opts) {
      if (layer.pools.length >= Sim.MAX_POOLS) return;
      ui.poolCounter++;
      const sim = new Sim.PoolSim(Object.assign(
        { name: "Pool " + ui.num + "." + ui.poolCounter }, opts || {}));
      stage.addPool(layer, sim);
      buildPoolSection(layer, ui, sim);
      ui.updatePoolFooter();
    }

    /* ----------------------------------------------------- sphere blocks */

    function updateSphereFooter() {
      const n = stage.spheres.length;
      addSphereBtn.disabled = n >= SphereStage.MAX_SPHERES;
      sphereCountEl.textContent = n + " / " + SphereStage.MAX_SPHERES;
    }

    function buildSphereSection(layer) {
      const ui = { num: ++sphereNum, poolCounter: 0, poolRecs: [] };
      sphereUIs.push(ui);

      const details = document.createElement("details");
      details.className = "sphere";
      details.open = true;

      const summary = document.createElement("summary");
      const name = el("span", "sphere-name", "Sphere " + ui.num);
      const marker = el("span", "marker");
      summary.appendChild(name);
      summary.appendChild(marker);
      details.appendChild(summary);

      const body = el("div", "sphere-body");

      /* Layer controls: radius, spin, tilt offset, back-side opacity. */
      const rows = el("div", "sphere-rows");
      SphereStage.SPHERE_PARAMS.forEach((def) => {
        const row = sliderRow(def,
          () => layer.params[def.key],
          (v) => { layer.params[def.key] = v; });
        rows.appendChild(row.el);
      });
      body.appendChild(rows);

      ui.poolsEl = el("div", "pools");
      body.appendChild(ui.poolsEl);

      const btns = el("div", "btns sphere-btns");
      const addPoolBtn = btn("Add pool");
      /* Inherits from the section directly above. Visibility is not a
         setting — a new pool always arrives visible, so the click
         always shows its result. */
      addPoolBtn.addEventListener("click", () => {
        addPoolTo(layer, ui, inheritOpts(ui));
      });
      const poolCount = el("span", "count");
      const removeSphereBtn = btn("Remove sphere", "danger");
      removeSphereBtn.addEventListener("click", () => {
        stage.removeSphere(layer);
        details.remove();
        const k = sphereUIs.indexOf(ui);
        if (k !== -1) sphereUIs.splice(k, 1);
        updateSphereFooter();
      });
      btns.appendChild(addPoolBtn);
      btns.appendChild(poolCount);
      btns.appendChild(removeSphereBtn);
      body.appendChild(btns);

      details.appendChild(body);
      spheresEl.appendChild(details);

      ui.updatePoolFooter = function () {
        addPoolBtn.disabled = layer.pools.length >= Sim.MAX_POOLS;
        poolCount.textContent = layer.pools.length + " / " + Sim.MAX_POOLS;
      };
      ui.updatePoolFooter();

      return ui;
    }

    /* Params for a sphere the user adds by hand: it nests inside the
       smallest existing layer and counter-rotates against the last, so
       concentricity is legible the moment it appears. */
    function autoLayerParams() {
      const count = stage.spheres.length;
      let radius = 1;
      if (count > 0) {
        let minR = 1;
        stage.spheres.forEach((s) => { minR = Math.min(minR, s.params.radius); });
        radius = Math.max(0.25, Math.round(minR * 72) / 100);
      }
      return { radius, spin: count % 2 === 0 ? 1 : -1 };
    }

    /* layerOpts omitted -> derive one; poolsOpts is a list of pool
       opts ({ color, params, visible }); omitted -> one pool with
       schema defaults in a random color. PORT: an EMPTY poolsOpts list
       now means exactly that — no pools — so a session snapshot of an
       emptied sphere round-trips (the standalone forced one in). */
    function addSphere(layerOpts, poolsOpts) {
      if (stage.spheres.length >= SphereStage.MAX_SPHERES) return;
      const layer = stage.addSphere(layerOpts || autoLayerParams());
      if (!layer) return;
      const ui = buildSphereSection(layer);
      const pools = poolsOpts || [null];
      pools.slice(0, Sim.MAX_POOLS).forEach((opts) => {
        addPoolTo(layer, ui, opts);
      });
      updateSphereFooter();
    }

    addSphereBtn.addEventListener("click", () => { addSphere(); });

    /* ------------------------------------------------------ compositions */

    /* Swap the whole stage — Stage globals, layers, pools, and their
       panel sections — for one library entry (or a session snapshot;
       same shape). Teardown goes through the scene's own removal path
       so GPU resources are disposed; numbering restarts so the rebuilt
       panel reads like a fresh boot. Pause is deliberately not part of
       a composition. */
    function applyComposition(spec) {
      while (stage.spheres.length) {
        stage.removeSphere(stage.spheres[stage.spheres.length - 1]);
      }
      sphereUIs.length = 0;
      spheresEl.innerHTML = "";
      sphereNum = 0;

      GLOBAL_PARAMS.forEach((def) => {
        const v = (spec.global && spec.global[def.key] != null)
          ? spec.global[def.key] : def.def;
        stage.setGlobal(def.key, v);
      });
      globalSyncs.forEach((s) => s());

      spec.spheres.slice(0, SphereStage.MAX_SPHERES).forEach((entry) => {
        addSphere(entry, (entry.pools || []).map((p) => ({
          color: p.hex,
          params: p.params,
          visible: p.visible        // PORT: snapshots carry visibility
        })));
      });
      updateSphereFooter();
    }

    COMPOSITIONS.forEach((spec) => {
      const b = btn(spec.name);
      b.addEventListener("click", () => { applyComposition(spec); });
      compListEl.appendChild(b);
    });

    /* -------------------------------------------------- global randomize */

    /* Reroll the behavior of every enabled pool, holding the palette.
       Counts and sphere layers are untouched; hidden pools sit the
       roll out entirely. Each pool goes through its own
       sim.randomize() — reseed, fresh swirl axis and all — so this
       reads as pressing every visible section's Randomize button at
       once; the color it rolls is simply put back before anyone sees
       it. */
    function randomizePools() {
      sphereUIs.forEach((ui) => {
        ui.poolRecs.forEach((rec) => {
          if (!rec.sim.visible) return;
          const color = rec.sim.color;
          rec.sim.randomize();
          rec.sim.color = color;
          rec.refresh();
        });
      });
    }

    /* Reink every pool and touch nothing else — motion, counts, and
       all behavior params hold still while the palette rerolls. The
       scene picks each color up through its per-frame lastColor
       check. */
    function randomizeColors() {
      sphereUIs.forEach((ui) => {
        ui.poolRecs.forEach((rec) => {
          rec.sim.color = Sim.randomPoolColor();
          rec.refreshColor();
        });
      });
    }

    randPoolsBtn.addEventListener("click", randomizePools);
    randColorBtn.addEventListener("click", randomizeColors);

    /* --------------------------------------------------- session snapshot */

    /* The full stage as schema values — the same shape as a
       COMPOSITIONS entry, plus per-pool visibility. Blob positions and
       phases are deliberately absent: they were never authored, and
       reseeding is the tool's own boot behavior. */
    function serialize() {
      return {
        global: {
          rotation: stage.global.rotation,
          tilt: stage.global.tilt,
          timeScale: stage.global.timeScale
        },
        spheres: stage.spheres.map((layer) => ({
          radius: layer.params.radius,
          spin: layer.params.spin,
          tiltOffset: layer.params.tiltOffset,
          backOpacity: layer.params.backOpacity,
          pools: layer.pools.map((rec) => ({
            hex: rec.sim.color,
            visible: rec.sim.visible,
            params: Object.assign({}, rec.sim.params)
          }))
        }))
      };
    }

    /* Boot: last session's state if this window was closed before,
       else the library's opening frame. Then frame zero, synchronously
       — tick(0) is a pure repaint, so the window opens showing the
       composition under the hint even before focus arrives. */
    applyComposition(file.state || COMPOSITIONS[0]);
    stage.tick(0);

    /* ---------------------------------------------- the clock + liveness */

    let rafId = 0;        // 0 = not scheduled; doubles as the live flag
    let lastNow = 0;
    let minimized = false;
    let overlayEl = null; // ancestor .infinite-overlay — resolved lazily
                          //   on first focus (buildWindow runs pre-insert)

    function loop(now) {
      rafId = requestAnimationFrame(loop);

      /* Off-panel self-check — the desktop's own gate; identical read
         and reasoning to desktopGame. The focus-within re-check guards
         the one hole focus events leave: removing the focused element
         drops focus to <body> without a focusout (the click re-anchor
         below normally heals that within the same task; this is the
         belt to that suspender). */
      const a = document.activeElement;
      if (!overlayEl || !overlayEl.classList.contains("is-clear") ||
          !a || !root.contains(a)) {
        blurWithin();
        stopLoop();
        return;
      }

      const dt = (now - lastNow) / 1000;
      lastNow = now;
      stage.tick(dt);     // the stage's own 50ms clamp applies
    }

    function startLoop() {
      if (rafId) return;
      lastNow = performance.now();         // resume elapses ~0 — a pause
      rafId = requestAnimationFrame(loop); //   is a pause, never a lurch
    }

    function stopLoop() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    /* Release focus from wherever it sits inside the root. The blur
       fires focusout, which stops the loop — focus stays the single
       writer of liveness. */
    function blurWithin() {
      const a = document.activeElement;
      if (a && a !== document.body && root.contains(a)) a.blur();
    }

    /* ---------- focus = liveness (focus-WITHIN — see header) ---------- */

    root.addEventListener("focusin", () => {
      if (minimized) return;               // restore refocuses for us
      if (!overlayEl) overlayEl = root.closest(".infinite-overlay");
      startLoop();
    });

    root.addEventListener("focusout", (e) => {
      if (!e.relatedTarget || !root.contains(e.relatedTarget)) stopLoop();
    });

    /* Clicking anywhere focuses the root. Most browsers focus a
       tabindexed element on click natively; Safari historically
       doesn't, so make it explicit (game parity). Natively-focusable
       controls then take focus themselves — still inside, still
       live. */
    root.addEventListener("pointerdown", () => {
      root.focus({ preventScroll: true });
    });

    /* A click that destroys the focused element (Remove pool / Remove
       sphere / a composition swap rebuilding the sections) drops focus
       to <body> silently. Re-anchor before the next frame: a click
       inside must never read as clicking away. */
    root.addEventListener("click", () => {
      queueMicrotask(() => {
        const a = document.activeElement;
        if (!a || !root.contains(a)) root.focus({ preventScroll: true });
      });
    });

    root.addEventListener("keydown", (e) => {
      if (e.code === "Escape") blurWithin(); // deliberate release valve
    });

    /* ---------- window resize ----------
       Windows resize by drag — the viewport 'resize' event never fires
       for that. Observe the stage's container instead. */

    const ro = new ResizeObserver(() => {
      stage.resize();
      if (!rafId) stage.tick(0);  // setSize cleared the frozen frame —
    });                           //   repaint it without advancing time
    ro.observe(stageEl);

    /* ---------- window lifecycle ---------- */

    win.onMinimize(() => {
      minimized = true;
      blurWithin();               // a hidden tool must not hold focus;
      stopLoop();                 //   the frozen frame flies to the taskbar
    });

    win.onRestore(() => {
      minimized = false;
      root.focus({ preventScroll: true }); // restoring IS "give me it back"
    });

    win.onClose(() => {
      file.state = serialize();   // snapshot FIRST — teardown empties
      stopLoop();                 //   the stage
      ro.disconnect();
      stage.dispose();            // materials, geometry, renderer, context
    });

    /* Deferred one frame so the panel has inserted this window (focus
       on a detached node is a no-op). Opening IS the deliberate ask —
       and unlike the game, there is no keyboard to capture by
       surprise. */
    requestAnimationFrame(() => root.focus({ preventScroll: true }));

    return root;
  },

  defaultWindow: { width: 820, height: 540 }
});
