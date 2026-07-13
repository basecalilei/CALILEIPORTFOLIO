// world.js — The single source of truth for game state.
//
// The World is a passive data container. Every value that matters across
// frames lives here. Nothing else (renderer, input handler, systems) holds
// game state. If a value can be derived from the World, it is derived fresh
// each frame and never cached.
//
// Phase 5: the World now also references the state definitions (the data
// the state machine interprets). Like the stage, states are static
// "config-shaped" data — they don't change during play but they're part
// of what systems need to do their work. Putting them on the World keeps
// systems decoupled (they don't import state data directly) and matches
// the architecture's "one World, one source of truth" principle.

export function createWorld(stage, states) {
  return {
    frame: 0,
    stage,
    states,
    fighters: [],
  };
}
