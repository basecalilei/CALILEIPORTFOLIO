// main.js — The composition root.
//
// The only file that knows about every other file. Imports modules, creates
// the initial World, and starts the game loop. Translates real wall-clock
// time into fixed game frames via an accumulator: tick runs at a locked
// 60Hz regardless of display refresh rate (60/120/144Hz monitors all behave
// identically), while render runs once per requestAnimationFrame.
//
// performance.now() is allowed here because this is scaffolding. Game logic
// inside tick never reads wall-clock time — it counts frames.
//
// Phase 13 (step 1, FighterB): main.js now owns the input-source-to-fighter
// wiring. Each rAF builds a positional inputsByFighter array — keyboard
// snapshot for fighter[0] (the human), neutral snapshot for fighter[1]
// (the Phase 13 dummy). The input system stays generic; this is where
// "who feeds whom" is decided.

import { createWorld } from './world/world.js';
import { tick } from './world/tick.js';
import { render } from './render/renderer.js';
import { battlefield } from './data/stages/battlefield.js';
import { fighterA } from './data/characters/fighterA.js';
import { fighterB } from './data/characters/fighterB.js';
import { states } from './data/states/states.js';
import { createFighter } from './entities/fighter.js';
import { initKeyboard, getCurrentInput } from './input/keyboard.js';
import { NEUTRAL_SNAPSHOT } from './core/inputBuffer.js';
import { initOverlayInput, drawOverlay } from './debug/overlay.js';

const TARGET_FPS = 60;
const MS_PER_FRAME = 1000 / TARGET_FPS;

// Spiral-of-death cap. If a tab returns from being backgrounded, rAF may
// fire with a `now` value seconds ahead of `lastTime`. Without a cap, we'd
// try to catch up with hundreds of ticks in one rAF call and freeze the
// page. Capping the accumulator means we accept a brief time skip over an
// unresponsive page — the correct tradeoff.
const MAX_PENDING_FRAMES = 5;

// Fighter spawn points. Bottom-center anchor: (SPAWN_X_*, SPAWN_Y) is the
// fighter's feet position when they appear. Spawn airborne and Idle's
// `notGrounded` transition sends them to Fall on the first tick — both
// fighters settle onto the main floor naturally.
//
// Mirrored around canvas center (x=480). Main floor spans x=180..780, so
// both spawn points sit comfortably inside the floor with room on either
// side. ~160px gap between fighters is enough that the two bodies are
// visually distinct on spawn but close enough to walk into each other
// quickly when testing hit detection in later steps.
const SPAWN_Y = 100;
const SPAWN_X_A = 400;
const SPAWN_X_B = 560;

function main() {
  const canvas = document.getElementById('game');
  if (!canvas) {
    throw new Error("main.js: could not find <canvas id='game'> in the DOM");
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('main.js: failed to acquire 2D rendering context');
  }

  initKeyboard();

  const world = createWorld(battlefield, states);
  world.fighters.push(createFighter(fighterA, SPAWN_X_A, SPAWN_Y));
  world.fighters.push(createFighter(fighterB, SPAWN_X_B, SPAWN_Y));

  initOverlayInput(canvas, world);

  // Debug-only console hook. fighters[0] is the human-controlled fighter
  // (the diagnostic target); fighters[1] is the Phase 13 dummy. Useful
  // inspections:
  //   world.fighters[0].actionState   — current state name
  //   world.fighters[0].stateFrame    — frames in current state
  //   world.fighters[0].vx, vy        — velocity
  //   world.fighters[0].grounded      — collision state
  //   world.fighters[0].inputBuffer[0] — current input snapshot
  //   world.fighters[1].inputBuffer[0] — dummy receives NEUTRAL_SNAPSHOT
  window.world = world;

  let lastTime = performance.now();
  let accumulator = 0;

  function loop(now) {
    const elapsed = now - lastTime;
    lastTime = now;
    accumulator += elapsed;

    const maxAccum = MS_PER_FRAME * MAX_PENDING_FRAMES;
    if (accumulator > maxAccum) {
      accumulator = maxAccum;
    }

    // Sample inputs once per rAF; the same snapshots are passed to every
    // tick in this rAF call. Sub-frame input precision would require
    // event queueing between ticks — out of scope for human input.
    //
    // inputsByFighter is positional: [0] feeds fighters[0] (human via
    // keyboard), [1] feeds fighters[1] (Phase 13 dummy via the frozen
    // neutral snapshot). When P2 becomes a real fighter, this array
    // grows or its entries swap — neither the input system nor tick
    // need to change.
    const inputsByFighter = [getCurrentInput(), NEUTRAL_SNAPSHOT];

    while (accumulator >= MS_PER_FRAME) {
      tick(world, inputsByFighter);
      accumulator -= MS_PER_FRAME;
    }

    render(world, ctx);
    drawOverlay(world, ctx);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

main();
