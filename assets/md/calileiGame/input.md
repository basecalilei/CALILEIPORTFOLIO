# input.md

The input layer is what turns physical key presses into queryable game-input history. It has the smallest surface area of any subsystem in the engine — a handful of modules, none larger than ~100 lines — and yet it carries some of the most consequential design decisions, because everything downstream consults its outputs. The snapshot contract is what every condition, every effect, every future system that reads "what is the player doing right now" depends on. Since the game was embedded in the Calilei site, the contract carries even more weight: it now has **two producers** (the standalone keyboard module and the site's focus-scoped listeners in `desktopGame.js`) feeding the same consumers.

This document covers the keyboard listener in `input/keyboard.js`, the snapshot construction, the frozen `NEUTRAL_SNAPSHOT`, the rolling buffer in `core/inputBuffer.js`, the buffer query helpers (including Phase 12's `pressIndex`), the positional routing that feeds two fighters, and the meta-input discipline that keeps non-gameplay input (debug overlay toggles, mouse interactions) out of the simulation. It cross-references `stateMachine.md` §6 for the buffer-query patterns conditions actually use — those live with the conditions, not here.

Read this before adding new key bindings, adding new fields to the snapshot, or writing systems that need to read input. The contract changes are the riskiest kind of input work — once a field is in the contract, every consumer *and every producer* depends on its shape.

---

## 1. The four-stage pipeline

```
keyboard listener → snapshot → buffer → conditions
```

Four stages, one direction. Each stage has a single responsibility.

1. **Keyboard listener** (`input/keyboard.js` standalone; focus-scoped listeners in the site's `desktopGame.js` when embedded). Maintains the OS-level held-keys state via `keydown`/`keyup`/`blur` listeners. The one piece of game-adjacent state that lives outside the World.

2. **Snapshot construction** (`getCurrentInput()` in `keyboard.js`, or `buildSnapshot()` in the embed). Builds a fresh `InputSnapshot` from the held-keys set on every call. Called once per rAF by the composition root, which assembles the positional array `inputsByFighter` — `[getCurrentInput(), NEUTRAL_SNAPSHOT]` today: the human's snapshot for `fighters[0]`, the engine's frozen all-at-rest instance for the dummy at `fighters[1]`.

3. **Buffer** (`core/inputBuffer.js`, `systems/inputSystem.js`). Each fighter has a 12-entry rolling buffer of recent snapshots. `inputSystem` is a positional dispatcher: it pushes `inputsByFighter[i]` onto `fighters[i]`'s buffer at the start of every tick, knowing nothing about which source produced which snapshot.

4. **Conditions** (`core/conditions.js`). Read the buffer to answer questions: rising edges, sustained holds, neutral-then-direction patterns, press-context reads, frame-counted windows. See `stateMachine.md` §6 for the full pattern catalog.

The pipeline is strictly one-way. The Set is mirrored into snapshots; snapshots are pushed into the buffer; conditions query the buffer. Nothing flows backward. This is what makes input deterministic from the perspective of game logic — once a snapshot is in the buffer, it's frozen, and everything downstream sees the same frozen value.

---

## 2. Stage 1: the keyboard listener

```js
const heldKeys = new Set();

window.addEventListener('keydown', (e) => {
  heldKeys.add(e.code);
  if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
});
window.addEventListener('keyup',   (e) => heldKeys.delete(e.code));
window.addEventListener('blur',    ()  => heldKeys.clear());
```

The Set is the one piece of state outside the World. This is principled, not a leak: it's I/O state — a mirror of the OS keyboard — not game state. Game logic never reaches into `heldKeys`; it only sees the snapshots produced from it.

### This module is standalone-only

`keyboard.js` installs **window-level** listeners — correct for a page whose only interactive surface is the game, and exactly wrong inside the Calilei site, where the game shares a page with dozens of other interactive surfaces. The embedded build does not import this module. Instead, `desktopGame.js` (site repo) maintains its own held-keys Set fed by **element-scoped** listeners on the game window's focusable surface: the game hears the keyboard only while its surface holds DOM focus, `preventDefault` on arrows/space applies only while focused, and blur both clears the held set *and* pauses the loop. Browser focus is the input-exclusivity mechanism — click a note and type WASD, the note gets it.

Everything below this stage is identical in both builds: same snapshot shape, same buffer, same conditions. The producer is swappable; the contract is not.

### `event.code`, not `event.key`

The listeners use `e.code` (the physical key) rather than `e.key` (the layout-mapped character). A player on an AZERTY keyboard still presses the same physical keys an QWERTY player does — the W key is `KeyW` on both, even though `e.key` would be `'z'` on AZERTY and `'w'` on QWERTY. Layout-independence is a strict gain at no cost; switch keys never become an issue, and remapping work happens at one site (the snapshot construction) rather than throughout the codebase.

### `PREVENT_DEFAULT` for browser keys

Arrow keys and space are intercepted with `e.preventDefault()` to stop the browser from scrolling the page when the player uses them. The list is intentionally minimal — any key not in `PREVENT_DEFAULT` still triggers its default browser behavior, which is the right tradeoff for non-gameplay keys (Cmd+L should still focus the address bar; F12 should still open DevTools).

### The blur handler

```js
window.addEventListener('blur', () => heldKeys.clear());
```

If the window loses focus mid-press (alt-tab, clicking another tab), the OS may never deliver the matching `keyup`. Without this listener, keys would appear stuck — the held-keys set would say `KeyD` is held forever, and the fighter would walk into the right wall until the player clicked back, refocused, and tapped D again to release.

Clearing on blur is the safer default. The cost is that holding a key through an alt-tab releases it; the player has to re-press after returning to the tab. This is correct behavior for the vast majority of cases (focused window = active input; unfocused = paused intent).

---

## 3. Stage 2: snapshot construction

`getCurrentInput()` builds a fresh `InputSnapshot` on every call. No caching, no memoization — the function is small, and a fresh object every rAF call costs almost nothing.

```js
let stickX = 0;
if (heldKeys.has('ArrowLeft')  || heldKeys.has('KeyA')) stickX -= 1;
if (heldKeys.has('ArrowRight') || heldKeys.has('KeyD')) stickX += 1;

let stickY = 0;
if (heldKeys.has('ArrowUp')    || heldKeys.has('KeyW')) stickY -= 1;
if (heldKeys.has('ArrowDown')  || heldKeys.has('KeyS')) stickY += 1;

// ...buttons by key check...

return { stickX, stickY, cStickX: 0, cStickY: 0, jump, lightattack, ... };
```

Several things to notice.

**Multiple keys map to the same logical input.** ArrowLeft OR KeyA both produce stickX -= 1. This is by design — players use different conventions and the engine accommodates both. Adding a third or fourth physical key for the same logical input is a one-line OR addition.

**Holding both left and right produces stickX = 0.** Not stickX = -1 (last-press wins) or stickX = NaN — the additive logic naturally cancels them out. This matches gamepad behavior: a stick at the dead-center reads 0 regardless of conflicting inputs.

**Stick values are integers on keyboard.** `stickX` and `stickY` are -1, 0, or +1. The contract supports analog (any value in [-1.0, +1.0]), but keyboard can't produce intermediate values. Conditions that compare `stickX !== 0` work on both keyboard and gamepad without changes.

**Y-down convention.** stickY > 0 means "down on the stick" (consistent with the engine's overall coordinate convention). ArrowUp/KeyW set stickY -= 1; ArrowDown/KeyS set stickY += 1.

**`shieldDepth` is faked on keyboard.** `shield ? 1.0 : 0.0`. A real analog trigger would produce intermediate values for light-shield. On keyboard, light-shield is unavailable; the field exists so the contract is uniform, and a future gamepad path just produces real analog values into the same slot.

---

## 4. The snapshot contract

The shape every consumer downstream depends on:

```js
{
  // Sticks (analog on gamepad, ternary on keyboard)
  stickX,  stickY,
  cStickX, cStickY,

  // Buttons (boolean)
  jump,
  lightattack,
  heavyattack,
  lightspecial,
  heavyspecial,
  grab,
  shield,

  // Analog
  shieldDepth,
}
```

Twelve slots. Most are unused today. They exist anyway. This is the "claim slots" discipline — slots are claimed up front so adding the consuming logic later is purely additive: no contract migration, no buffer reshape, no "older snapshots don't have this field" defensive code.

### Field semantics

**`stickX`, `stickY`** — Left stick. The primary direction-of-intent input. Walk, dash, crouch, drop-through, and stick-slam-based actions all read this.

**`cStickX`, `cStickY`** — Right stick (the "c-stick" in Melee parlance). Reserved for smash-attack direction (a deliberate directional input distinct from the left stick's "where I want to move") and aerial-attack direction. Always 0 on keyboard; analog on future gamepad. Adding a c-stick consumer is purely additive — and the slot's mere existence already shaped design twice in Phase 12 (jab-vs-tilt stayed stick-based rather than inventing a modifier key, and aerial directions read the left stick, both "because the c-stick will exist").

**`jump`** — Boolean. Consumed by `jumpPressed` and `canAirJump`.

**`lightattack`** — Consumed since Phase 12 by the whole attack-condition family (`lightAttackPressed` and its five directional variants) and by `commitFacingFromLightAttackPress`. The busiest button in the contract.

**`heavyattack`** — Smash-attack family (charged, committed). Reserved.

**`lightspecial`, `heavyspecial`** — Special move family. Light = neutral-pressed special. Heavy = charge-pressed or held variant. Reserved.

**`grab`** — Grab attack. Bypasses shield. Reserved for Phase 17.

**`shield`** — Boolean. Consumed since Phase 11 by `canAirDodge`; the grounded shield consumer arrives in Phase 16.

**`shieldDepth`** — Analog 0.0 to 1.0. Light-shield (partial) vs hard-shield (full) will eventually have different gameplay properties (different shieldstun, different push-back, different size). Reserved.

### `NEUTRAL_SNAPSHOT` — the contract's zero

`core/inputBuffer.js` exports the frozen all-at-rest instance of the contract:

```js
export const NEUTRAL_SNAPSHOT = Object.freeze({
  stickX: 0, stickY: 0, cStickX: 0, cStickY: 0,
  jump: false, lightattack: false, heavyattack: false,
  lightspecial: false, heavyspecial: false, grab: false,
  shield: false, shieldDepth: 0.0,
});
```

It's the input source for any fighter without a live producer — fighterB today, and by extension any future disconnected controller or pre-spawn fighter. One shared, frozen object: every tick pushes the *same reference* into the dummy's buffer, which is safe precisely because snapshots are never mutated after entering the buffer (§5), and `Object.freeze` turns any violation of that rule into an immediate error rather than corruption across every consumer at once. It lives in `core/` rather than `input/` because it belongs to the contract, not to any producer — both composition roots import it.

### Two producers, one contract

The contract is now expressed in three places that must stay field-for-field identical: `getCurrentInput()` (standalone), `buildSnapshot()` in the site's `desktopGame.js` (embed), and `NEUTRAL_SNAPSHOT` (the shared zero). Conditions can't tell which producer built the snapshot they're reading — that's the point, and it's the same property that will make a gamepad producer a drop-in later. The practical rule it creates: **adding a snapshot field is a three-site edit** (see the recipe in §10). Miss the embed's producer and the field silently reads `undefined` there — falsy, so boolean consumers "work" in a way that hides the bug until an analog consumer doesn't.

### Why so many slots claimed up front

The alternative — adding fields as features arrive — sounds simpler. It isn't. Each addition would have to:

- Update `getCurrentInput()` to populate the new field.
- Update every existing consumer to either handle missing fields defensively (`now?.newField ?? false`) or to assume the new field is present.
- Migrate the buffer somehow — old snapshots in the buffer at the moment of the addition wouldn't have the new field.
- Handle the case where a condition reads the new field on a snapshot from before the field existed.

Claiming slots up front skips all of this. Every snapshot, from the first tick of the program, has every field. Conditions can read `now.heavyspecial` without checking whether the field exists. New consumers are added without touching anything in the existing pipeline.

The cost is a slightly larger snapshot object (12 fields instead of 5), which is negligible at this scale.

The slots weren't all claimed in one stroke. The engine's history is that 5 fields were claimed early (`stickX, stickY, jump, attack, shield`), then expanded to the current 12 after substantial development on the substrate — `attack` split into `lightattack`/`heavyattack`, the c-stick fields added, `lightspecial`/`heavyspecial`/`grab` added, and `shield` joined by analog `shieldDepth`. The discipline held across both waves: each expansion came before consumers existed for the new fields, and the contract has been stable since each was made. The lesson isn't "claim every conceivable slot on day one." It's "claim slots before consumers arrive, and once claimed, leave them stable."

### Gameplay-role naming

Field names describe what the input *does* (`lightattack`, `heavyattack`), not what hardware produces it (`buttonA`, `buttonB`). This is what makes input source changes localized — if a future gamepad puts heavyattack on a different button than the keyboard's KeyC, only `getCurrentInput` changes. Every condition that reads `now.heavyattack` continues to work without modification.

The same principle scales to remapping: a settings menu that lets the player choose which key triggers light attack changes only the mapping in `getCurrentInput`; it never touches the snapshot contract or anything downstream.

---

## 5. Stage 3: the buffer

```js
export const BUFFER_SIZE = 12;

export function createInputBuffer() {
  return [];
}

export function pushInput(buffer, snapshot) {
  buffer.unshift(snapshot);
  if (buffer.length > BUFFER_SIZE) {
    buffer.length = BUFFER_SIZE;
  }
}
```

The buffer is a fixed-size rolling window. `buf[0]` is the freshest snapshot. `buf[N]` is N frames ago. Older entries fall off the end when the buffer exceeds `BUFFER_SIZE`.

**12 frames is the size.** This covers Melee-class input windows — most techniques rely on 5-12 frame windows — with headroom. The number is a tuning knob; changing it would let conditions look further back at the cost of memory and the cost of "old inputs from previous states" leaking into the current state's reads.

**Newest-at-front convention.** `unshift` puts new snapshots at index 0. This reads naturally in conditions: `wasPressedWithin(buf, 'jump', 5)` is "was jump pressed within the last 5 entries," and the walk goes `buf[0]`, `buf[1]`, `buf[2]`, etc. — newest to oldest.

**Snapshots are never mutated after entering the buffer.** Older entries are append-only history. Any "derived" value (rising edges, sustained patterns) is computed fresh from the buffer at query time, never stored as a separate field. This is the same discipline as "no caching of values derivable from the World" — the buffer is the single source of truth for input history.

**The buffer is per-fighter.** Each fighter has its own `inputBuffer` field, created by `createInputBuffer()` in `createFighter`. This was authored in Phase 4 with a comment predicting "when P2 arrives, this is where the controller → fighter routing will live." Phase 13 confirmed the prediction with one refinement: the routing *decision* moved up to the composition root, and the input system became a pure positional dispatcher.

### `inputSystem` orchestration

```js
export function inputSystem(world, inputsByFighter) {
  for (let i = 0; i < world.fighters.length; i++) {
    pushInput(world.fighters[i].inputBuffer, inputsByFighter[i]);
  }
}
```

The system runs first in tick order. By the time `stateSystem`, `physicsSystem`, `collisionSystem`, and `hitDetectionSystem` run, every fighter's `buf[0]` is that fighter's freshest snapshot. The system knows nothing about keyboards, dummies, or future gamepads — `inputsByFighter[i]` goes to `fighters[i]`, full stop. Swapping the dummy's `NEUTRAL_SNAPSHOT` for a second human, an AI, or a replay stream is a one-entry change in the root's array, with zero changes here. See `tick.md` §3 for why input running first is load-bearing and `tick.md` §5 for why routing lives in the root.

---

## 6. Buffer query helpers

`inputBuffer.js` exports three query helpers used by conditions:

```js
wasPressedWithin(buffer, key, frames)  // rising-edge detection → boolean
pressIndex(buffer, key, frames)        // rising-edge location → index | -1
getStickHistory(buffer, frames)        // last N stick states
```

**`wasPressedWithin`** walks the buffer newest-to-oldest, comparing each frame to the next-older one. Returns true if `key` went from false → true (a rising edge) at any point within `frames` snapshots. This is the primitive behind every "button pressed within window" condition.

```js
const limit = Math.min(frames, buffer.length - 1);
for (let i = 0; i < limit; i++) {
  if (buffer[i][key] && !buffer[i + 1][key]) return true;
}
return false;
```

The `Math.min(frames, buffer.length - 1)` guard is what keeps the function from reading past the end of the buffer when the buffer is shorter than the requested window (which only matters in the first few ticks of a fresh fighter). The comparison `buf[i] && !buf[i+1]` is the textbook rising-edge: "this frame the key is held, the next-older frame it wasn't, so the press happened between them."

**`pressIndex`** (Phase 12) is the same walk with a different return: the *position* of the rising edge, or -1.

```js
export function pressIndex(buffer, key, frames) {
  const limit = Math.min(frames, buffer.length - 1);
  for (let i = 0; i < limit; i++) {
    if (buffer[i][key] && !buffer[i + 1][key]) return i;
  }
  return -1;
}
```

The point of returning the index: the caller can then read *other fields of the snapshot at the press frame* — `buf[idx].stickX` is "where the stick was when the button went down," not "where it is now," across however many buffered frames separate the player's commitment from the state machine's evaluation. This is the press-carries-its-own-context primitive behind all five directional attack conditions and `commitFacingFromLightAttackPress`, and the substrate smash-vs-tilt detection and DI will reuse. `wasPressedWithin(b, k, f)` is exactly `pressIndex(b, k, f) !== -1`; the boolean form is kept because most callers only want existence and shouldn't be handed an index to misuse.

**`getStickHistory`** returns an array of `{stickX, stickY}` snapshots for the last N frames, newest first.

```js
const limit = Math.min(frames, buffer.length);
const history = [];
for (let i = 0; i < limit; i++) {
  history.push({ stickX: buffer[i].stickX, stickY: buffer[i].stickY });
}
return history;
```

Currently no condition uses `getStickHistory`. It's there for techniques that care about stick *motion patterns* — quarter-circle inputs, dash detection via fast stick rotation, motion-based smash attacks. Reserved like the c-stick field; available when a consumer arrives.

### When to add a new helper

The existing helpers cover most patterns. A new helper earns its place when several conditions would otherwise duplicate the same walk-the-buffer logic — `pressIndex` is the worked example: it arrived in Phase 12 exactly when five directional-attack conditions would all have inlined the same find-the-press walk. Examples that haven't materialized but could:

- `wasReleasedWithin(buffer, key, frames)` — same as `wasPressedWithin` but for the falling edge. Useful for "released within window" patterns.
- `heldForAtLeast(buffer, key, frames)` — return true if `key` has been continuously true for at least `frames` consecutive snapshots. Currently the fast-fall commit path implements this inline; if a second condition needed the same pattern, it would graduate to a helper.
- `stickEntered(buffer, axis, direction, frames)` — neutral-to-direction detection on a specific axis. Currently `stickSlammed` implements this inline for stickX.

The discipline: don't preemptively add helpers. Wait for the second use (or, as with `pressIndex`, the simultaneous fifth) to materialize, then factor.

---

## 7. Stage 4: conditions (cross-reference)

Conditions consume the buffer to answer questions. The full catalog of buffer-query patterns lives in `stateMachine.md` §6: field reads, current-snapshot reads, rising-edge with window, neutral-to-direction with window, press-context reads, sustained-hold counter, runtime-event reads, compound, state-aware.

For each pattern, that document gives the canonical condition and explains the design choices around window sizes (why `JUMP_BUFFER_FRAMES = 5` and `AIRJUMP_BUFFER_FRAMES = 3` are different, why `FAST_FALL_FRESH_WINDOW = 3` is a structural maximum rather than a feel knob, etc.).

What this document is responsible for is everything upstream of those conditions — making sure the buffer is correctly populated, the snapshot contract is stable, and the meta-input doesn't contaminate the buffer.

---

## 8. Meta-input discipline

Some keyboard input is *for the engine*, not for the simulation. The most important example today is the debug overlay's backtick-toggle:

```js
// in debug/overlay.js — separate from input/keyboard.js
window.addEventListener('keydown', (e) => {
  if (e.code === 'Backquote') overlayState.enabled = !overlayState.enabled;
});
```

This listener is registered separately from the gameplay keyboard. The backtick press is not added to the gameplay `heldKeys` set, never enters a snapshot, never reaches a fighter's input buffer, and never affects any condition.

The embedded build honors the same discipline with better scoping: `desktopGame.js` handles backtick inside the game surface's *element-scoped* keydown (it toggles the hitbox/hurtbox canvas overlay), so the key fires only while the game is focused and never leaks site-wide — the wart the standalone overlay's window-level listener has is structurally gone there. Either way, the toggle stays outside the gameplay pipeline.

### Why this matters

Determinism. The simulation's state is determined by `(World, sequence of snapshots)`. If overlay toggles entered the buffer, replay tooling would have to record and replay them too, even though they don't affect game state. Worse, a hypothetical condition that someone forgot was reading some buffer field would suddenly respond to "did the player open the overlay" in a non-deterministic way (the overlay state depends on user choices, not on game logic).

The cleaner rule: **the input buffer carries only gameplay input.** Anything that doesn't affect the simulation goes through its own listener, mutates its own state, and never touches the gameplay pipeline.

### The general pattern

Future meta-input falls into the same bucket:

- Pause/unpause keys
- Menu navigation in non-gameplay screens
- Screenshot triggers
- Replay scrubber controls
- Debug commands (frame-step, slow-mo, fast-forward)

All of these get their own listeners. None of them enter the input buffer or pass through `getCurrentInput`. The discipline is checked by asking: "would this input affect the simulation's deterministic state?" If yes, gameplay pipeline. If no, separate listener.

The overlay's mouse interactions for the color editor follow the same pattern — they install their own canvas-level mouse listeners and never go through any input pipeline at all.

---

## 9. Recipe: adding a new key binding

Suppose you want to add an alternate key for jump — currently mapped to `Space`, you want to also accept `KeyJ`.

1. **Edit `getCurrentInput` in `input/keyboard.js`.** The current `jump` line:

   ```js
   jump: heldKeys.has('Space'),
   ```

   becomes:

   ```js
   jump: heldKeys.has('Space') || heldKeys.has('KeyJ'),
   ```

2. **Done.** No other file changes. Conditions consume `now.jump`, not the underlying key. The buffer doesn't care which key produced the press.

If the new key is one that the browser handles by default (e.g., a function key, a Tab, an arrow key), add it to `PREVENT_DEFAULT` so the browser doesn't intercept it.

---

## 10. Recipe: adding a new snapshot field

Suppose a new input is needed that doesn't fit any existing slot — a dedicated taunt button.

1. **Add the field to every expression of the contract.** This is a three-site edit, and all three must land together:

   - `getCurrentInput` in `input/keyboard.js` (the standalone producer). Pick a gameplay-role name (`taunt`, not `buttonT`):

     ```js
     return {
       // ...existing fields...
       taunt: heldKeys.has('KeyT'),
     };
     ```

   - `NEUTRAL_SNAPSHOT` in `core/inputBuffer.js` (the frozen zero): `taunt: false`.
   - `buildSnapshot` in the site's `desktopGame.js` (the embed producer — remember the vendor rule: this edit happens in the site repo, not the vendored tree).

   Missing the neutral leaves the dummy's snapshots without the field; missing the embed producer leaves the field `undefined` in the site — falsy, so boolean consumers silently "work" until an analog consumer doesn't.

2. **Optionally document the field in the snapshot-shape comment** at the top of `keyboard.js` so the contract is discoverable.

3. **Done for the contract.** The buffer accepts the new field automatically (`pushInput` is shape-agnostic). All existing snapshots in the buffer at the moment of the change won't have `taunt`, but no existing consumer reads it, so they're not affected. New snapshots (frame N+1 onward) have the field.

4. **For the new field to do anything, add a condition** to `core/conditions.js` that reads it. Follow the rising-edge pattern from `stateMachine.md` §6 if the input is a discrete press:

   ```js
   tauntPressed: (f, _s) =>
     wasPressedWithin(f.inputBuffer, 'taunt', 5),
   ```

5. **Reference the condition from state transitions** that should fire on taunt.

The new field is part of the contract once it's added. Removing it later would be a contract-breaking change requiring every consumer to be updated, so add fields you intend to keep.

### Should I claim the slot or fold into an existing field?

If the new input is a *variant* of an existing input (e.g., "smash attack" as a directional variant of attack), prefer a new field over overloading an existing one. Overloading creates coupling — a condition that wants the basic attack now has to disambiguate from the variant.

If the input is *parametric* on an existing input (e.g., shield depth as a continuous version of shield), use a separate field for the parameter. The current `shield`/`shieldDepth` pairing is the model: one binary "is the shield active," one analog "how deep is the shield."

If you'd be writing the same logic three times for three closely-related inputs, consider whether the snapshot field should be a single value with a small enum/value space rather than three booleans. This is rare but worth being open to.

---

## 11. Recipe: adding a new buffer query helper

If a buffer-walking pattern would otherwise be duplicated across multiple conditions, add a helper to `core/inputBuffer.js`.

1. **Write the helper.** Signature shape: `(buffer, key | axis, frames, ...)`. Match the existing helpers' conventions — Math.min the requested frames against `buffer.length` (or `buffer.length - 1` for any pattern that pairs adjacent frames), walk newest-to-oldest, return early on match.

2. **Export it.**

3. **Use it from `core/conditions.js`.** Import it like the existing `wasPressedWithin` import.

4. **Refactor the conditions that were inlining the pattern** to use the new helper. This is the "factor on second use" discipline — the helper earns its place by replacing inline duplication, not by anticipating future need.

The buffer helpers stay small and orthogonal. A helper that does "rising edge of `key` within `frames` AND stickY > 0" is doing two jobs; split it into two existing helpers (`wasPressedWithin` + a current-snapshot check) at the call site. Helpers should compose, not encapsulate compound logic.

---

## 12. Load-bearing decisions

**The Set of held keys is the one piece of state outside the World.** It mirrors the OS, not the game. Game logic never reads it directly; it only sees the snapshots `getCurrentInput` produces.

**`event.code`, not `event.key`.** Layout-independence is a hard requirement. Switching to `event.key` would break behavior for any keyboard layout other than US-English QWERTY.

**The blur listener clears the held set.** Without it, alt-tabbing mid-press leaves keys stuck. The tradeoff is that holding a key across an alt-tab releases it, which is the correct default.

**`PREVENT_DEFAULT` is minimal by design.** Only the keys the simulation actively uses are intercepted. This preserves browser-default behavior for everything else (DevTools, address bar focus, page reload).

**The snapshot contract claims all 12 slots up front.** Adding consumers is purely additive — no field-existence checks, no buffer reshape, no migration code. Slots can be unused for years and cost nothing.

**Field names are gameplay roles, not hardware names.** `lightattack`, not `buttonZ`. Source-mapping changes (different key, gamepad button, remapping settings) localize to `getCurrentInput`. Every downstream consumer is insulated.

**Multiple physical keys mapping to one logical input is the norm.** ArrowLeft and KeyA both produce stickX -= 1. The OR pattern is one line per alternative and never grows past `getCurrentInput`.

**Holding opposite directions zeroes the stick.** Additive logic at the snapshot construction means left+right = 0 stickX, up+down = 0 stickY. Matches gamepad dead-center behavior; no last-press-wins logic anywhere.

**`buf[0]` is freshest.** Convention is enforced by `unshift` in `pushInput`. Conditions walk buf[0], buf[1], buf[2] — newest to oldest, reading naturally.

**Snapshots are never mutated after entering the buffer.** Edge detection and pattern recognition are derived at query time. No "cached rising edge" fields on the snapshot itself.

**The buffer is per-fighter; the routing is positional and root-owned.** Each fighter has its own buffer, and `inputsByFighter[i]` feeds `fighters[i]` — the Phase 4 prediction ("this is where controller → fighter routing will live") landed in Phase 13 with the routing decision one level up, in the composition root. `inputSystem` stays a source-agnostic dispatcher; the root's array is the entire wiring diagram.

**`BUFFER_SIZE = 12` is the chosen window.** Covers all current and anticipated Melee-class input windows (5-12 frames) with headroom. Reducing the buffer would risk truncating valid lookbacks; expanding it would let very stale inputs leak into condition matches.

**`NEUTRAL_SNAPSHOT` is one frozen shared object.** Every inputless fighter's every tick pushes the same reference. Safe because buffered snapshots are immutable by rule, and `Object.freeze` makes the rule self-enforcing. It lives in `core/`, not `input/` — it belongs to the contract, not to a producer.

**The contract has two producers that must not drift.** `getCurrentInput` and the embed's `buildSnapshot` build the identical shape; `NEUTRAL_SNAPSHOT` is the third expression of it. A field added to one and not the others is the input layer's version of a silent wrong-layer bug (see the three-site recipe in §10).

**`pressIndex` returns a position, not a boolean, on purpose.** The press-context pattern — read the snapshot *at the press frame* — is what directional attacks are built on and what DI will be built on. Collapsing it into more `wasPressedWithin` variants ("wasPressedWithinWithUpHeld") would multiply conditions instead of composing one primitive.

**Meta-input goes through separate listeners.** Debug overlay backtick, mouse interactions, future pause/menu/replay controls — none of these enter the gameplay pipeline. The buffer carries only inputs that affect the simulation. The embed's element-scoped backtick handling is the same rule with tighter scoping.

**The pipeline is strictly one-way.** Keyboard → snapshot → buffer → conditions. Nothing flows backward. No condition mutates a snapshot. No effect pushes into the buffer. The shape is preserved everywhere.

---

## 13. When to revisit this doc

Update when:

- A new field is added to the snapshot contract (§4 grows).
- A new buffer query helper is added (§6 grows; the helper appears here and is cross-referenced from `stateMachine.md` for the conditions that consume it).
- The keyboard mapping in `getCurrentInput` changes substantially — e.g., a configurable key-bindings system that pulls from saved settings rather than hardcoding.
- A new input source is added (gamepad, touch, network for multiplayer). The four-stage pipeline diagram in §1 grows the stage-1 box; the snapshot construction (§3) gains alternative paths that produce the same contract. The embed's `buildSnapshot` was the first such addition — a template for the rest: swap the producer, keep the contract.
- A snapshot field gains its first consumer (update the field-semantics list in §4 — `lightattack` in Phase 12 and `shield` in Phase 11 are the precedents).
- A new class of meta-input arrives (pause menus, replay scrubbers) that needs its own listener and its own state outside the buffer.
- `BUFFER_SIZE` changes — note the new value and why.
- The "claim slots" discipline is ever revisited — e.g., if the contract grows enough fields that a more dynamic shape becomes worth the cost.

The doc is the contract for how inputs reach the simulation. If the code does something this doc doesn't describe, or if the contract drifts from what consumers expect, one of them is wrong.
