// stateMachine.js — Generic state interpreter.
//
// transition(fighter, states) walks the current state's transitions in
// priority order, fires the first one whose condition matches, runs the
// effect if any, changes actionState, and resets stateFrame. If no
// transition fires, stateFrame is incremented.
//
// The interpreter knows nothing about specific states, conditions, or
// effects — it resolves them by name through the registries. Adding,
// removing, or reordering states requires no changes here.
//
// Critical convention: when a transition fires, we DO NOT evaluate the
// new state's transitions on the same frame. This guarantees every state
// gets at least one frame of physics, prevents infinite-loop potential
// (A → B → A in zero frames), and matches how Melee's state machine
// behaves. The new state's first evaluation is the next tick.

import { conditions } from './conditions.js';
import { effects } from './effects.js';

export function transition(fighter, states) {
  const state = states[fighter.actionState];
  if (!state) {
    throw new Error(
      `stateMachine: unknown actionState '${fighter.actionState}'`,
    );
  }

  for (const t of state.transitions) {
    const cond = conditions[t.when];
    if (!cond) {
      throw new Error(
        `stateMachine: unknown condition '${t.when}' in state '${state.name}'`,
      );
    }
    if (cond(fighter, state)) {
      if (t.effect) {
        const eff = effects[t.effect];
        if (!eff) {
          throw new Error(
            `stateMachine: unknown effect '${t.effect}' in transition ` +
            `from '${state.name}' to '${t.to}'`,
          );
        }
        eff(fighter);
      }
      fighter.actionState = t.to;
      fighter.stateFrame = 0;
      return;
    }
  }

  // No transition fired — advance the in-state frame counter so that
  // durationElapsed-style conditions eventually fire.
  fighter.stateFrame += 1;
}
