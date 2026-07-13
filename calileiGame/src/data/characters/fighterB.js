// fighterB.js — Dummy fighter config for Phase 13 step 1.
//
// A hit target that needs to exist before hurtboxes, hit detection, and
// knockback can be developed and tested end-to-end. Cloning fighterA via
// shallow spread means tuning changes to fighterA's body / physics /
// attacks propagate to B automatically until B is given its own identity.
//
// Shallow-copy caveat: `body`, `physics`, and `attacks` are shared object
// references with fighterA. Nothing in the engine mutates these (character
// config is read-only by convention — fighter runtime mutates the fighter,
// never its config), so the sharing is safe today. When Phase 14c gives
// FighterB its own moveset, this file becomes a full standalone character
// definition with its own physics/body/attacks objects, and the shared
// references go away.
//
// Identity overrides — `name` and `color` — make B visually and
// diagnostically distinguishable from A in the renderer and the live-
// stats panel. Color picked for high contrast against fighterA's red.

import { fighterA } from './fighterA.js';

export const fighterB = {
  ...fighterA,
  name:  'Fighter B',
  color: '#5577dd',
};
