## Phase 5: The State Machine

Phase 5 is the largest single architectural addition in the entire project. Before Phase 5, the fighter is a body in space — it falls under gravity, lands on the floor, and sits. After Phase 5, the fighter has *behavior*: it can be idle, it can walk, it can jump, it can land. And the substrate that makes that work — the way states are defined, the way transitions are evaluated, the way effects modulate physics — is the same substrate that will carry every future phase.

This phase adds five files and modifies several others. The conceptual content breaks into five pieces:

1. **What a state actually is** (as data).
2. **The interpreter** that reads states and runs transitions.
3. **The registries** of named conditions and effects.
4. **The state system** that drives the interpreter for each fighter per frame.
5. **The integration with physics** — how states modulate gravity, friction, and horizontal motion.

Then the five concrete states added: Idle, Walk, JumpSquat, Fall, Land.

I'll walk each one.

### What a state actually is

A state is a data object with five (sometimes six) fields:

> *A state has:*
> *- A name (for debugging — the state can identify itself).*
> *- A duration (an integer count of frames it lasts before durationElapsed fires; 0 means "no automatic exit").*
> *- A physics-modifier object (how this state modulates gravity, friction, horizontal mode).*
> *- A transitions list (the priority-ordered exit conditions, from previous discussions).*
> *- An optional render object (per-state visual overrides; mostly used for color).*

This is the entire vocabulary. Adding any state means filling in these five fields. The interpreter and the systems don't know what specific states exist — they only know how to read this shape.

Let me unpack the physics-modifier object specifically, because it's the most important piece.

> *A physics-modifier object has:*
> *- gravity: a multiplier on the character's base gravity. 1.0 means normal, 0 means none.*
> *- friction: a multiplier on the character's base friction. 1.0 means normal, 0 means none.*
> *- horizontalMode: a string — one of 'none', 'walk', 'air', 'dash' (Phase 7 adds 'dash'). This declares HOW the state drives horizontal velocity.*

The two multipliers are why physics scales naturally per-state. The character config says "gravity is 0.4 px/frame²"; the state config says "for this state, use 1.0× that gravity, or 0×, or whatever." Physics multiplies them at the moment of application. Same idea for friction.

The horizontalMode string is the most expressive piece. It's not a value — it's a *handler selector*. Physics has multiple modes (functions, really) for how to drive vx, and the state declares which one to use:

> *'none' means: don't drive vx. Apply friction instead.*
> *'walk' means: set vx directly to stickX × walkSpeed.*
> *'air' means: accelerate vx by stickX × airAccel, capped at airSpeedMax.*

(Phase 7 adds `'dash'` — set vx to facing × dashSpeed. Phase 5 has just the three above.)

Each mode is one approach to horizontal motion. States declare what kind they want; physics knows how to apply each.

This is the core of how states "modulate" physics without owning physics: states declare modifiers, physics applies them. **States never call physics functions directly. They never set vx themselves. They just declare data, and physics reads it.**

### The interpreter

`core/stateMachine.js` exports one function: `runTransitions`. It's the engine that walks a state's transition list and applies the first match.

> *To run transitions on a fighter:*
>
> *Look up the fighter's current state definition by name (world.states[fighter.actionState]).*
>
> *Walk the state's transitions list, in order.*
>
> *For each entry:*
> *Look up the condition function by name in the conditions registry.*
> *Call it with the fighter and the state.*
> *If it returns true:*
> *Set fighter.actionState to entry.to.*
> *If entry has an effect: look it up in the effects registry, call it with the fighter.*
> *Reset fighter.stateFrame to 0.*
> *Stop (return).*
>
> *If no transition fires, increment fighter.stateFrame by 1.*

That's the entire interpreter. About fifteen lines of conditional logic. It doesn't know what Idle is, doesn't know what JumpSquat does, doesn't know what gravity is. It just reads data, calls functions by name, and writes new data.

The "transitions do not chain" rule is here implicitly: after firing a transition, the interpreter stops. The new state's transitions are not also evaluated this frame. That's intentional, and it's load-bearing. Without this rule, a state with a `durationElapsed → Fall` transition could fire on a frame where Fall's own `grounded → Land` would also fire (because the fighter is somehow already on a platform), and you'd chain Fall → Land in one frame. The next frame would then check Land's transitions — and the player would never actually see Fall in the debug overlay. The rule prevents this. Each frame, at most one transition. Each state gets at least one frame to "exist."

There's a subtle bookkeeping detail in `durationElapsed`:

> *durationElapsed returns true when state.duration is positive AND stateFrame + 1 >= state.duration.*

Why the `+1`? Because `stateFrame` is incremented at the END of the interpreter, after the no-fire path. So when the interpreter is asking "does durationElapsed fire?", stateFrame still holds the value from the *previous* frame's end-of-loop increment — which is one less than the count of frames this state has been active.

Concretely: a state with duration 3.

- Frame N: state entered. stateFrame = 0. After this frame's stateSystem (no transition fires, since 0+1=1 < 3), stateFrame becomes 1.
- Frame N+1: stateFrame = 1. After stateSystem, becomes 2.
- Frame N+2: stateFrame = 2. durationElapsed check: 2+1=3 >= 3, fires. Transition.

So duration 3 means "the state's transition fires on the third frame of being in it." Three full frames active, then exit. This matches "JumpSquat lasts 3 frames" feeling exactly like 3 frames in the debug overlay.

The `duration > 0` guard is what makes states like Idle never auto-exit. Idle has duration 0, so the condition never fires regardless of how many frames you've been in it.

### The two registries

`core/conditions.js` exports an object whose keys are condition names (strings) and whose values are functions of (fighter, state) returning a boolean.

> *conditions = {*
> *jumpPressed: a function that returns true if the fighter's input buffer has a jump rising edge within the last 5 frames.*
> *durationElapsed: a function that returns true if the state has positive duration and stateFrame+1 has reached it.*
> *grounded: a function that returns the fighter's grounded flag.*
> *notGrounded: a function that returns the opposite.*
> *horizontalInput: a function that returns true if the current snapshot's stickX is non-zero.*
> *noHorizontalInput: a function that returns true if it is zero.*
> *}*

Phase 5 adds these six. Subsequent phases add more. The registry is small; the state machine and the states reference these by string name.

The registry isolates input semantics from state definitions. `jumpPressed` is one function, defined in one place; every state that lists it gets the same behavior. If we ever wanted to change the jump buffer window from 5 to 6 frames, we'd change one constant in conditions.js. Every state that uses `jumpPressed` would benefit, without anyone touching state data.

`core/effects.js` is the parallel registry — same shape, but the values are functions of (fighter) that mutate the fighter. Phase 5 adds two:

> *effects = {*
> *applyJumpImpulse: sets fighter.vy to negative of jumpForce (a deliberate, single-frame impulse).*
> *resetAirJumps: sets fighter.airJumpsUsed to zero (this is a stub in Phase 5; Phase 6 introduces the field).*
> *}*

Effects fire **at the transition moment**, not every frame the new state is active. The state machine calls them exactly once, during the transition, after setting actionState and before returning. This is what makes "jumping" a discrete event: applyJumpImpulse fires when JumpSquat exits to Fall, vy snaps to -jumpForce, and from that frame onward the fighter is ascending under gravity. No code says "JumpSquat exits to Fall and sets velocity"; the data says "this transition has the effect applyJumpImpulse."

### The state system

`systems/stateSystem.js` is the per-frame driver. It does one thing:

> *Every frame, for each fighter in the World:*
> *Call the state machine's runTransitions on the fighter.*

That's all. The state system is a wrapper. The interesting logic is in `runTransitions` — the wrapper just iterates fighters and hands each one to the interpreter.

The state system needs to know about both the conditions registry and the effects registry (since it passes them to the interpreter), but it has no logic of its own. Adding fighters means more iterations; nothing else changes.

### Integration with physics

Phase 5 also changes `systems/physicsSystem.js` significantly. Before Phase 5, physics was unconditional: apply gravity if airborne, apply friction, integrate. After Phase 5, physics consults the current state's modifiers:

> *Every frame, for each fighter:*
>
> *Look up the fighter's current state.*
>
> *Read its physics-modifier object: gravity, friction, horizontalMode.*
>
> *If not grounded:*
> *Apply gravity using (character.gravity × state.gravity).*
>
> *Apply the horizontalMode handler:*
> *If 'none', apply friction using (character.friction × state.friction).*
> *If 'walk', set vx to stickX × character.walkSpeed. Update facing if stickX is non-zero.*
> *If 'air', accelerate vx by stickX × character.airAccel, capped at airSpeedMax. Update facing.*
>
> *Integrate.*

The modes are functions. The state declares which one to use by string. Physics looks them up in a small mode-dispatch object and calls the right one. Adding a new mode (Phase 7's 'dash') is one new entry in the dispatch and one new field on at least one state.

This is the integration: states declare *what* to do, physics knows *how* to do each. The two are loosely coupled. States don't import physics. Physics doesn't import state data. Both read the World, both write the fighter.

### The five concrete states

Phase 5 introduces five states. Here's each one as data, with brief notes on what it does and why.

**Idle.**

> *Duration: 0 (no auto-exit).*
> *Physics: gravity 1.0, friction 1.0, horizontalMode 'none'.*
> *Transitions:*
> *notGrounded → Fall (priority 1)*
> *jumpPressed → JumpSquat*
> *horizontalInput → Walk*

Idle is the resting state on the ground. It applies normal friction (which doesn't matter much, since vx is 0 when you're idle) and uses 'none' horizontal mode (so any leftover vx slows to zero). It exits on three triggers: airborne (something pushed me off the ground), jump press (the player wants to jump), or horizontal input (the player wants to walk).

The priorities matter: notGrounded comes first. If the floor disappears from under you mid-Idle (impossible in current Battlefield, but conceptually), you fall *before* you can walk. Falling is more "real" than wanting to walk; you can't walk in the air.

**Walk.**

> *Duration: 0.*
> *Physics: gravity 1.0, friction 0, horizontalMode 'walk'.*
> *Transitions:*
> *notGrounded → Fall*
> *jumpPressed → JumpSquat*
> *noHorizontalInput → Idle*

Walk is the moving state on the ground. Crucially, friction is 0 — Walk doesn't apply friction because Walk *sets* vx directly each frame (via 'walk' horizontalMode). Friction would fight that. Setting friction to 0 and using 'walk' mode means: every frame, vx is exactly stickX × walkSpeed. If you let go of the stick, vx becomes 0 — but then noHorizontalInput fires, transitioning back to Idle, where friction takes over (and does nothing, because vx is already 0).

The walking direction is the stickX value. The fighter's facing also updates to match. Walking right makes facing +1; walking left makes facing -1. This is what gives Phase 7's Dash a sensible default facing to commit to.

**JumpSquat.**

> *Duration: 3 (auto-exits after exactly 3 frames).*
> *Physics: gravity 0, friction 0, horizontalMode 'none'.*
> *Transitions:*
> *durationElapsed → Fall (with effect: applyJumpImpulse)*

JumpSquat is the "windup" between pressing jump and actually leaving the ground. For 3 frames, the fighter is grounded but not free to do anything else. Gravity is 0 because the fighter is on the ground and wouldn't accumulate vy anyway. Friction is 0 because we want any walking velocity *preserved* across the jump — a player walking right and then pressing jump should leave the ground moving right.

This is the first place momentum preservation appears explicitly in the engine. Walk's vx is whatever stickX × walkSpeed was on the last Walk frame. JumpSquat doesn't reset it. On exit, applyJumpImpulse sets vy = -jumpForce. The fighter leaves the ground with the walking vx unchanged and the new vertical impulse applied. **The player gets a horizontal jump because vx survived the transition.**

JumpSquat's 3-frame duration is also where short-hop vs full-hop will eventually live (a future phase will let the player release jump during JumpSquat to get a smaller impulse). For Phase 5, it's just a fixed 3-frame windup.

**Fall.**

> *Duration: 0.*
> *Physics: gravity 1.0, friction 0, horizontalMode 'air'.*
> *Transitions:*
> *grounded → Land (with effect: resetAirJumps)*

Fall is the airborne state. Gravity at normal multiplier pulls the fighter down. Friction is 0 because there's no ground contact to apply friction against. horizontalMode 'air' uses the air-drift physics — accelerate vx by stickX × airAccel, but cap horizontal speed at airSpeedMax (without yanking velocities that are already past the cap, per the asymmetric-cap rule from Phase 3).

Fall transitions only on grounded — that's it for Phase 5. (Phases 6-9 will add air-jump, fast-fall, and other airborne transitions.) When grounded fires, resetAirJumps runs (stub in Phase 5, real in Phase 6) and the fighter enters Land.

Notice that Fall has no upper limit on duration — you stay in Fall as long as you're airborne. Falling into the blast zone (eventually) would be a separate concern, not the state machine's. The state just describes "I am falling."

**Land.**

> *Duration: 4.*
> *Physics: gravity 1.0, friction 1.0, horizontalMode 'none'.*
> *Transitions:*
> *notGrounded → Fall*
> *durationElapsed → Idle*

Land is the landing-lag state. For 4 frames after touching down, the fighter is grounded but can't initiate new actions. Friction at full strength bleeds off any horizontal velocity from the fall. (Phase 7 will add `stickSlammed → Dash` as a transition before durationElapsed, allowing dash-out-of-landing.)

The notGrounded priority is what allows "edge-cancel landing": if the fighter lands near the edge of a platform with horizontal momentum the friction hasn't fully killed, they could slide off during Land's 4 frames. notGrounded fires, they go back to Fall. They never see Idle. This is a tiny emergence that the state data quietly enables.

### What emerges in Phase 5

Several behaviors fall out without being explicitly coded.

**Walking off an edge → Fall.** Walk has `notGrounded → Fall` as priority 1. Collision clears grounded when the fighter walks past the edge. Next frame's stateSystem fires the transition. No "walk-off" code anywhere — it's an emergence.

**Holding a direction across a jump.** You're in Walk, you press jump. Walk's `jumpPressed → JumpSquat` fires. JumpSquat preserves vx (friction 0, horizontalMode 'none'). After 3 frames, applyJumpImpulse sets vy. Fall begins with the walking vx and new vy. **Momentum carries.** Then in Fall, 'air' horizontalMode lets you drift. **Air drift works.** Then you land. Land applies friction. **You stop sliding eventually.** Whole arc, no explicit code for "preserve walking momentum into a jump."

**Landing with direction held → Walk.** Fighter lands. Fall → Land. Land's `durationElapsed → Idle` fires after 4 frames. Idle's first stateSystem then sees stickX non-zero, `horizontalInput → Walk` fires. The player wanted to keep walking after landing; the engine takes them straight into Walk. Total cost: 4 frames of Land + 1 frame of Idle + transition to Walk. **Buffered into Walk after landing**, without writing any "buffer into Walk" code.

**Jumping into a jump (you press jump again during the airborne phase).** Currently doesn't work in Phase 5 — Fall has no `jumpPressed` transition. Phase 6 will add `canAirJump`. But the substrate is ready: adding the transition is one entry in Fall's list, plus a new condition and a new effect. No interpreter changes.

### What's load-bearing about Phase 5

This is the phase that establishes the architectural patterns the entire rest of the project follows.

**States are data.** Every state, every transition, every effect — pure JS objects. The interpreter never has hardcoded knowledge of any specific state.

**Conditions and effects are name-referenced.** State definitions don't hold function references; they hold strings that the interpreter resolves through registries. This is why state data is JSON-serializable.

**Priority is declaration order.** No separate priority field. The order of entries in the transitions list *is* the priority. Reordering changes behavior without any code changes.

**Transitions don't chain.** One transition per frame per fighter. The new state gets its own frame to exist before its transitions are checked. This is what makes the debug overlay readable and makes infinite-loop bugs impossible.

**Physics is modulated by state.** Gravity scales by `state.gravity`, friction by `state.friction`, horizontal motion is selected by `state.horizontalMode`. Physics doesn't know which state is current; it reads the modifier object and applies whichever multipliers and mode it's told to use.

**The state machine doesn't grow when states grow.** Adding Phase 6's Squat, Phase 7's Dash family, Phase 8's FastFall, even Phase 9's `respectPlatforms` flag — none of those touched the interpreter. They added data, conditions, and effects. The interpreter remained the same fifteen-line piece of logic it was at the end of Phase 5.

---

Phase 5 is the inflection point. Before it, the project is a physics simulation with no agency. After it, the project is a substrate for behavior: any new state is one entry in the data, any new input semantic is one entry in the conditions registry, any new transition outcome is one entry in the effects registry. The pattern is so general that the remaining five phases (6 through 10) collectively add fewer architectural changes than Phase 5 alone.

Walk, jump, fall, land — those four behaviors define the floor of what a platform fighter can do. Phase 5 puts them in place and gives every subsequent phase a clear path: more states, same engine.