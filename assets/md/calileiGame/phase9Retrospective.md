## Phase 9: Platform-Drop and State-Level-Opt-Out


Phase 9 was the most architecturally subtle of all the phases, because it was the first time two pieces of game logic *competed for the same input*. The input was stickY > 0. The two consumers were drop-through (which wanted to ignore platforms) and fast-fall (which wanted to commit to faster descent). Both fire on the same condition. Both fire correctly. And until we separated them, holding down to drop through a platform would always also commit you to fast-fall — you couldn't have one without the other.

The phase has two distinct halves. The first half adds drop-through itself, as a single rule applied at two collision sites. The second half rewrites `fastFallTriggered` to give the player a tap window where they can drop through without fast-falling.

Both halves are short in code but rich in design reasoning. Let me walk them carefully.

### The drop-through rule

The goal: when a fighter is on a soft platform and presses down, they should fall through it. When a fighter is in the air and approaches a platform from above with down held, they should pass through it instead of catching.

The natural-but-wrong approach is to add a new "DropThrough" state. The fighter transitions into it when they press down on a platform, the state lasts a few frames, during which the platform doesn't collide with them.

This is wrong for two reasons. First, the fighter is *falling* during drop-through — they're not doing some distinct action; they're in Fall, just with one piece of collision suppressed. A state would conflate "what is the fighter doing" with "what is the world ignoring," and those are different concerns. Second, a timed state would be inflexible — pressing down and holding doesn't have a fixed duration; the player's hold could last any amount of time. A frame-counted state doesn't capture that.

The right shape: a **runtime predicate** that asks, every frame, "does this fighter want to ignore platforms right now?" The answer is computed on the fly, not stored anywhere.

> *A fighter wants through platforms when:*
> *the current state allows it (state.physics.respectPlatforms is not true)*
> *AND*
> *the current input has stickY > 0.*

That's the full rule. No counters, no state, no flags. Just two questions answered from existing data.

The state-level opt-out (`respectPlatforms`) is where this rule's flexibility lives. Most states leave it unset (which reads as falsy, which means "drop-through is allowed"). A future attack state will set it to true, which blocks drop-through during the attack — being knocked off a platform mid-attack would be wrong. The flag sits in the state's physics modifier, alongside gravity, friction, horizontalMode, and fallSpeedMax. Authoring an attack to block drop-through means adding one field to the state data.

### Where the rule applies

The rule is applied at **two places in the collision system**. Both are about platforms specifically — solids don't honor the rule (you can't drop through solid geometry).

**Site 1: the platform sweep.**

Normally, the collision system tests the motion path against each platform. If the path crossed a platform's line from above, it's a hit, the fighter snaps to the line. With drop-through:

> *If the fighter wants through platforms, skip the entire platform-sweep loop.*

The platform sweep just doesn't run. Whatever motion the fighter has goes uncontested by platforms. They pass through.

**Site 2: the still-on-surface check.**

The walk-off check (from Phase 3, extended in Phase 8) asks: "if I was grounded last frame and didn't land on anything new this frame, am I still standing on a surface?" If not, clear grounded. The check normally scans both solids' tops and platforms' lines.

With drop-through:

> *If the fighter wants through platforms, ignore platforms during the still-on-surface check — only solid tops count as surfaces.*

The fighter who's standing on a soft platform with down held effectively has the platform disappear underneath them. The check sees no surface, grounded clears. Next frame's stateSystem sees notGrounded and the fighter transitions to Fall.

That's the entire drop-through implementation. About twelve lines of code in collisionSystem.js. No new states, no new conditions, no new effects, no changes to any other file.

### Tracing the standing-on-platform case

Let's walk through what happens when a fighter standing on a soft platform presses down.

> *Frame N — fighter is in Idle on the left soft platform (y=280). Player presses Down. stickY becomes +1.*
>
> *Frame N stateSystem: in Idle. crouchInput fires (priority 3 in Idle's transitions). Transition: Idle → Squat. stateFrame = 0.*
>
> *Frame N physics: state is Squat. horizontalMode 'none', apply friction. vx is 0, nothing changes. Integrate: no motion.*
>
> *Frame N collision: state is Squat, stickY > 0, Squat.physics.respectPlatforms is not true. The fighter wants through platforms.*
> *No solid hit (no relevant geometry).*
> *Platform sweep: skipped (wants through).*
> *Walk-off check fires: was grounded, didn't land. Is the fighter standing on a surface? Solids: none nearby. Platforms: ignored because wants through. Returns false.*
> *Grounded set to false.*

End of frame N: actionState = Squat, grounded = false. The fighter is technically in Squat but no longer on a platform.

> *Frame N+1 stateSystem: in Squat. notGrounded fires (priority 1). Transition: Squat → Fall.*
>
> *Frame N+1 physics: state is Fall. Not grounded, apply gravity. vy = 0.4. integrate: y becomes 280.4.*
>
> *Frame N+1 collision: state is Fall, stickY > 0, Fall.physics.respectPlatforms is not true. Wants through platforms.*
> *Platform sweep: skipped. No hit.*

The fighter is now visibly below the platform (y=280.4). They continue falling.

> *Frame N+2 onward: physics keeps adding gravity. Fighter falls through the platform line on the way down. Wants-through stays true (down held), so even though the path crosses y=280, the sweep is skipped. Fighter passes through.*

A brief Squat frame, then Fall, then the long fall to the main floor. The fighter never sees a hit. They drop through cleanly.

There's one cosmetic consequence: the player sees the fighter briefly in Squat color (#aa3333) on frame N before transitioning to Fall on frame N+1. We called this the "Squat flicker." It's one frame, ~17ms, and the user explicitly chose to accept it rather than add fighter-side state to skip Squat. Fighting it would require a `groundedOn: 'solid' | 'platform'` field — useful for future features but not earned by this one alone.

### Tracing the falling-onto-platform case

Now the other case: a fighter in the air, descending, holding down, approaching a platform from above.

> *Fighter at y=270, vy=4, in Fall, stickY > 0 (holding down).*
>
> *Frame N physics: vy gains 0.4 → 4.4. Integrate: y = 274.4.*
> *Frame N collision: state is Fall, wants through (stickY>0). Platform sweep: skipped.*
>
> *Frame N+1 physics: vy = 4.8. y = 279.2.*
> *Frame N+1 collision: skipped.*
>
> *Frame N+2 physics: vy = 5.2. y = 284.4 (crossed y=280, the platform).*
> *Frame N+2 collision: skipped. No hit.*

The fighter passes through the platform on the way down. They continue falling toward whatever's below.

If the player **releases** down mid-fall, the rule starts returning false the moment stickY becomes 0. The next frame's collision runs the platform sweep normally. If the motion path crosses a platform's line that frame, the fighter catches.

This is what makes fast-fall-then-release-then-catch possible (test scenario 7 from earlier). You're fast-falling toward a platform with down held. You release just before crossing. The next frame's collision runs platforms. If the timing is right, the platform catches you and the fighter lands.

### The state-level opt-out, foreshadowed

In Phase 9, every state leaves `respectPlatforms` unset. Drop-through works from every grounded state where it could plausibly fire — Idle (via crouchInput → Squat), Walk (same), Squat (via no transition needed; you're already there with down held), Land (the collision system clears grounded directly, before any state transition gets to react). Drop-through also works in every airborne state — Fall, AirJump, FastFall — because the platform sweep is skipped.

This is the substrate ready for combat. When an attack state arrives (Phase 11+), its physics modifier will declare `respectPlatforms: true`. The collision system reads the flag, treats the platform as solid for that state, and the fighter stays put through the attack. No changes to the collision system. No changes to the state machine. One field on one state.

### The second half: the fast-fall problem

Drop-through worked on the first build, but the user immediately noticed a feel problem: **tapping down on a platform would always also fast-fall.**

The cause was structural. Both rules look at the same input (stickY > 0). Both fire on overlapping conditions. Trace what happens when a player taps down on a platform:

> *Frame N: stickY becomes 1. Idle → Squat. Collision clears grounded.*
> *Frame N+1: Squat → Fall. Physics applies gravity, vy = 0.4. Player is still holding (or just released — the buffer says held for frame N and N+1, and we can't tell what frame N+2 will be yet).*
> *Frame N+2 stateSystem: in Fall. fastFallTriggered checks: stickY > 0 (assume still held) AND vy >= 0 (vy = 0.4, yes). Fires. Fall → FastFall.*

The fighter, after 2 frames of being in Fall, commits to fast-fall. Even if the player only tapped briefly, by the time Fall's first transition check runs, the press is still in the buffer at index 0, and fast-fall fires.

So the player has two choices in the original design: hold down very briefly (single frame, ~17ms) and hope to get only drop-through, or accept drop-through-and-fast-fall together. Either was uncomfortable. The single-frame hold is essentially impossible to time consistently.

The user wanted a clear separation: a normal-length tap (a few frames) should drop through without fast-falling. A deliberate hold (longer) should drop through AND fast-fall.

### Diagnosing what makes the two cases different

The two cases — "press down at apex of jump" (which should fast-fall instantly) and "press down on platform" (which should not) — look identical to a simple condition. Both have stickY > 0. Both have vy >= 0 by the time fastFallTriggered checks.

The difference is in the input *history*.

**Apex press:** the player was holding nothing (or something else, like jump) before pressing down. The buffer entry just before "now" has stickY = 0. The press is fresh.

**Drop-through carryover:** the player has been holding down continuously since before they were airborne. The press happened on the platform (frame N). By the time Fall checks fastFallTriggered (frame N+2), down has been held for three consecutive frames: N (the press), N+1 (Squat → Fall transition frame), N+2 (the check itself). All three frames show stickY = 1.

The buffer is what distinguishes them. The apex case shows a neutral frame right before the press. The drop-through case shows held frames going back to where the press happened.

### The two-window rewrite

The new condition has two paths:

> *fastFallTriggered, Phase 9 version:*
>
> *If stickY is not currently held (≤ 0), return false.*
> *If vy is negative (still ascending), return false.*
>
> *Fresh-press path:*
> *Look back through the buffer in a small window (FAST_FALL_FRESH_WINDOW frames).*
> *If any frame in that window has stickY = 0, the current press is recent — return true.*
>
> *Sustained-hold path:*
> *If the buffer has fewer than FAST_FALL_COMMIT_FRAMES entries, return false.*
> *Check all FAST_FALL_COMMIT_FRAMES recent entries. If every one of them has stickY > 0, the player has held long enough to commit — return true.*
>
> *Otherwise, return false.*

Two paths, two windows. Either one can fire the condition. The fresh-press path is what handles apex-style fast-fall — a recent neutral frame means "the player just started pressing down, fire instantly." The sustained-hold path is what handles "the player keeps holding through the carryover — eventually commit anyway."

### Why the windows are sized the way they are

The fresh-press window has a structural constraint. Trace the drop-through case again:

> *Frame N (the press frame). Buffer index 0 = held, index 1 = neutral (from before press).*
> *Frame N+1 (in Squat → Fall). Buffer index 0 = held, index 1 = held (the press from N), index 2 = neutral.*
> *Frame N+2 (Fall's first check). Buffer index 0 = held, index 1 = held, index 2 = held (the press), index 3 = neutral.*

For the drop-through case to suppress fast-fall, the fresh-press path must not see the neutral. The neutral is at index 3 by the time Fall checks. So the fresh-press window must look at indices 1 and 2 only — that is, FRESH_WINDOW = 3 (the loop runs `i = 1` to `i < 3`, so it inspects indices 1 and 2).

If FRESH_WINDOW were 4, the loop would also inspect index 3, find the neutral there, classify the press as fresh, and fire fast-fall. That's what we don't want for the carryover case.

If FRESH_WINDOW were 2, the loop would only inspect index 1. For the apex case (press exactly at apex), index 1 is the pre-press neutral, so it works. For "press 1 frame before apex" (where the press lands at index 1 and the neutral is at index 2), FRESH_WINDOW = 2 misses the neutral, and the player has to wait for commit instead of getting an instant apex fast-fall.

So **FRESH_WINDOW = 3 is the structural maximum**. Larger leaks. Smaller is more restrictive than necessary. 3 is the right answer.

The commit window is purely a tuning knob. It says "if the player has held for this long without a neutral, treat as committed." Setting it to 6 frames gives a ~100ms hold-to-commit feel. Smaller would make it commit faster (less forgiving tap window). Larger would extend the tap window but delay deliberate fast-fall longer. 6 was the value the user accepted after testing.

### The accepted tradeoff

There's a small regression vs Phase 8: pressing down 2-4 frames before apex (intermediate timing, not exactly-at-apex and not committed-hold) now fires fast-fall a few frames *later* than it would have in Phase 8. The fresh-press window misses (the press is at buffer index 2-4, before the neutral at index 3+), and the commit path needs the hold to reach 6 frames.

Concretely: pressing 3 frames before apex used to fast-fall exactly at apex. Now it fires about 3 frames after apex. That's ~50ms of perceptible delay in a narrow timing case.

The user accepted this regression. The alternative — preserving Phase 8 apex behavior exactly while still distinguishing carryover — would require adding a fighter-side counter ("how many frames since I was grounded?"). That'd be the route if the regression turns out to be a problem in extended testing. For Phase 9, the tradeoff was deemed acceptable.

### What's load-bearing about Phase 9

A few patterns established here will carry forward.

**State-level opt-outs.** `respectPlatforms` is the first piece of state data that the *collision system* (not the state machine) reads. The pattern — state data can declare flags that any system can consult — is general. Future flags might include "can be reflected by another fighter's attack," "vulnerable to grabs," "shielded from below," each living on the state and read by whoever cares.

**Predicates in collision, not states.** The drop-through rule didn't become a condition in the registry. It's a function inside collisionSystem.js called `wantsThroughPlatforms`. The reason: conditions are for state machine *transitions*. Drop-through isn't a transition — it's a per-frame modifier on collision behavior. Naming it as a condition would be a category error.

**Buffer-history-based input classification.** The two-window fastFallTriggered uses the buffer to ask not just "what is being pressed now" but "what was the trajectory of input that led to this moment." Apex-press and drop-through-carryover look identical at frame N+2, but their histories differ. Reading history is a tool the engine already had (Phase 4's `wasPressedWithin`, Phase 7's `stickSlammed`), just applied here for classification rather than detection.

**Drop-through is "free" in the engine's model.** No new states, no new conditions, no new effects. Just a flag on state data and twelve lines in collision. The most expressive features in the engine cost the least to add when the substrate is right.

**The Squat flicker is an architecture decision, not a bug.** Accepting one frame of Squat color is a deliberate choice to avoid adding `groundedOn` to the fighter. The flicker is the visible cost of a clean architecture. Future you might decide it's worth paying the `groundedOn` cost; for now, it isn't.

---

That's Phase 9. Drop-through emerged from a single runtime predicate. Fast-fall got rewritten to distinguish "press just happened" from "press has been held a while." Two consumers of the same input (stickY > 0) were untangled by reading the buffer's history rather than just its current value.

The phase is small in code and large in design reasoning. It's also the last *mechanical* phase — Phase 10 is purely a debug overlay, no new game behavior. After this, the engine has a complete movement system ready for combat to be layered on top.