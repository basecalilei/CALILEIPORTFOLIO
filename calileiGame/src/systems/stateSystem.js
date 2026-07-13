// stateSystem.js — Per-frame state machine evaluation.
//
// Iterates fighters and runs the generic state interpreter against the
// state data. The interpreter handles transition logic and stateFrame
// bookkeeping; this system just iterates and dispatches.
//
// Tick order: this runs AFTER input (so the state machine sees the
// freshest snapshot) and BEFORE physics (so physics applies the new
// state's modifiers on the same frame the transition fired — no 1-frame
// lag between input and consequence).

import { transition } from '../core/stateMachine.js';

export function stateSystem(world) {
  for (const fighter of world.fighters) {
    transition(fighter, world.states);
  }
}
