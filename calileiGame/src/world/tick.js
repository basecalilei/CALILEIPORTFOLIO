// tick.js — The per-frame transformation.
//
// The game is the function tick(world, inputsByFighter) → world. We mutate
// the World in place rather than return a fresh copy: mutation is idiomatic
// in both JS and C++, keeps allocation pressure off the hot path, and the
// architecture treats World object identity as stable across frames.
//
// Systems run in strict order — never reordered, never conditional. Each
// system reads the World, possibly calls into core primitives, and writes
// results back to the World. Systems do not call into each other; they
// communicate only through the World.
//
// Tick order: input → state → physics → collision → hitDetection →
// blastZone.
//
// - input runs first so the buffer holds the freshest snapshot.
// - state evaluates transitions against that snapshot and updates
//   actionState before physics reads it. Putting state before physics
//   means a press-on-frame-N gets a physics consequence on frame N, not
//   frame N+1.
// - physics applies the state's modifiers and integrates velocity.
// - collision resolves landings and clears grounded for walk-offs.
// - hitDetection (Phase 13 step 3) tests attacker hitboxes against
//   victim hurtboxes using the final resolved positions, writing
//   victim.pendingHit on contact. Runs after collision because it
//   consumes positions; running it earlier would test against
//   pre-collision positions and produce edge-case bugs (false
//   negatives on edge-of-platform contact, false positives mid-clip).
//   The 1-frame lag between writing pendingHit here and the state
//   machine consuming it next tick is intentional — see
//   hitDetectionSystem's header.
// - blastZone runs last: KO is the frame's final verdict, judged on
//   the same final positions. Writes fighter.pendingKO; the kOd
//   condition consumes it next tick (same flag-then-consume shape as
//   hitDetection, same intentional 1-frame lag).
//
// Phase 13 (step 1, FighterB): the `inputs` parameter became
// `inputsByFighter`, a positional array — inputsByFighter[i] feeds
// fighters[i]. Per-fighter input sourcing (keyboard, gamepad, stub,
// future CPU) is decided in main.js, the composition root; the input
// system stays generic and just delivers what the wiring produced.

import { inputSystem } from '../systems/inputSystem.js';
import { stateSystem } from '../systems/stateSystem.js';
import { physicsSystem } from '../systems/physicsSystem.js';
import { collisionSystem } from '../systems/collisionSystem.js';
import { hitDetectionSystem } from '../systems/hitDetectionSystem.js';
import { blastZoneSystem } from '../systems/blastZoneSystem.js';

export function tick(world, inputsByFighter) {
  world.frame += 1;
  inputSystem(world, inputsByFighter);
  stateSystem(world);
  physicsSystem(world);
  collisionSystem(world);
  hitDetectionSystem(world);
  blastZoneSystem(world);
}
