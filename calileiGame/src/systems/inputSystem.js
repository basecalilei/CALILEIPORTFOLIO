// inputSystem.js — Per-frame input snapshot delivery.
//
// Pushes each fighter's input snapshot onto its rolling buffer. Runs first
// in the tick order so state machines and physics queried later in the
// frame see the freshest snapshot.
//
// Phase 13 (step 1, FighterB): the system now takes a positional array of
// snapshots — inputsByFighter[i] is delivered to fighters[i]. Source-to-
// fighter routing (keyboard for P1, neutral for the dummy, eventually
// gamepad or CPU) is decided in main.js. The Phase 4 prediction was that
// "only the source of each push changes" — and it did: from one shared
// snapshot to one snapshot per fighter, with the composition root owning
// the wiring. This system stays a generic delivery loop.

import { pushInput } from '../core/inputBuffer.js';

export function inputSystem(world, inputsByFighter) {
  for (let i = 0; i < world.fighters.length; i++) {
    pushInput(world.fighters[i].inputBuffer, inputsByFighter[i]);
  }
}
