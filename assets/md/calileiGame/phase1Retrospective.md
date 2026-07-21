## Phase 1: The Empty Loop

The goal of Phase 1 is to make the page run a game loop at 60 frames per second, every second, forever. Nothing visible happens in the world yet — there's no fighter, no stage, no physics. But the heartbeat of the engine is established.

There are three concepts that have to exist for the heartbeat to work: **the World** (a container for state), **the tick** (the function that advances state by one frame), and **the loop** (the wall-clock-time scaffold that decides when to call tick).

Let me walk each one as conditional logic.

### The World, conceptually

The World is a single object. Every value that matters across frames lives on it. In Phase 1, the World is almost empty — there's nothing to put in it yet — but the shape is established.

> *When the game starts:*
> *Create a World object with a frame counter set to zero, a reference to the stage, a reference to the state definitions, and an empty list of fighters.*

That's it. The World exists. It has slots for things that will be filled in later phases. The frame counter is the only mutable field that gets touched in Phase 1.

### The tick, conceptually

Tick is the function that transforms the World by one frame. In Phase 1, all it does is increment the frame counter. No systems exist yet.

> *Every time tick is called:*
> *Increment the World's frame counter by one.*

That's the entire game logic in Phase 1. It runs 60 times per second and the only observable effect is that `world.frame` keeps going up.

### The loop, conceptually

The loop is the bridge between the browser's wall-clock time and the game's frame-counted time. It's the only place in the engine that reads the real clock. From this point onward, everything inside `tick` counts frames, not milliseconds.

The loop is built around a **fixed timestep accumulator**. The idea: the browser tells you when it wants to draw a frame (via `requestAnimationFrame`), and that call comes at roughly 60 times per second on a 60Hz monitor — but it could come at 144 times per second on a 144Hz monitor, or irregularly if the tab was just unhidden. We don't want the game's speed to depend on the monitor's refresh rate. So we measure how much time has elapsed since last call, accumulate it, and run as many ticks as that elapsed time covers.

Three things have to be tracked across loop calls:

- `lastTime`: the wall-clock time the loop was last entered.
- `accumulator`: how much wall-clock time has built up since we last ran a tick. Starts at zero.
- A constant `MS_PER_FRAME` = 1000 / 60 ≈ 16.67 ms — the wall-clock duration of one game frame.

Now the loop logic:

> *Every time the browser calls the loop function with a wall-clock timestamp:*
>
> *Step 1: Compute how much wall-clock time has elapsed since the last call. Add that to the accumulator. Update `lastTime` to the current timestamp.*
>
> *Step 2: If the accumulator has grown larger than five frames' worth of time, clip it back to five frames. This is the "spiral of death" cap.*
>
> *Step 3: Capture the current input snapshot once. (In Phase 1 there are no inputs yet, but the structure is in place.)*
>
> *Step 4: While the accumulator holds enough time for at least one full frame, call tick with the World and the inputs, then subtract one frame's worth of time from the accumulator. Repeat until the accumulator is less than one frame.*
>
> *Step 5: Call render to draw the current World to the canvas.*
>
> *Step 6: Ask the browser to call the loop again on the next display frame.*

### Why each step is shaped the way it is

**Step 1** is just bookkeeping. We need to know how much real time passed because that's what determines how many ticks to run.

**Step 2** is the spiral-of-death guard. The scenario it protects against: the user switches to a different tab for thirty seconds. The browser pauses `requestAnimationFrame` while the tab is hidden. When they switch back, the loop fires with a timestamp thirty seconds in the future. Without the cap, the accumulator would suddenly hold thirty seconds of pending time (1800 frames). The while loop in step 4 would try to run 1800 ticks in one shot, freezing the page. With the cap, we accept that we lost time — the game skips forward briefly — rather than freezing the page trying to catch up.

> *If accumulator > five frames' worth of time:*
> *Set accumulator = five frames' worth of time.*

Five frames is arbitrary but small. The choice means: if anything causes more than 80 ms of pending time, we throw away the excess. The game's not "catching up" past that — but the page stays responsive, which is the right tradeoff.

**Step 3** establishes the input convention: input is sampled **once per loop call**, not once per tick. If multiple ticks fire in one loop call (the accumulator caught up), all of those ticks see the same input snapshot. This is the only way it can work for keyboard input — the user's finger position doesn't change in microseconds between catch-up ticks. For more precise input (a gamepad or analog stick), you could imagine sampling per tick, but for keyboard this is exactly right.

**Step 4** is the heart of the fixed timestep:

> *While accumulator ≥ one frame's worth of time:*
> *Call tick(world, inputs).*
> *Subtract one frame's worth of time from accumulator.*

The "while" is critical. If only enough time has passed for one frame, this runs once. If enough time has passed for three frames (because the browser was busy and skipped frames), this runs three times. If not enough time has passed for even one frame (because the display is 144Hz and we ran a tick on the previous loop call), this runs zero times — and that's fine, we just render again.

This is what makes the game's clock independent of the display's clock. Tick runs exactly 60 times per second of wall time, regardless of whether the display is refreshing at 30, 60, 120, or 144Hz.

**Step 5** runs once per loop call — once per rAF. Rendering is separate from ticking. On a 144Hz monitor, you might tick 60 times per second but render 144 times per second; on a 30Hz monitor, you might render 30 times per second but still tick 60 times per second (running two ticks per loop call). In Phase 1 the render is just "clear the canvas to a dark color" — no fighter, no stage to draw.

**Step 6** asks for the next frame. The browser decides when to fire it based on the display refresh rate.

### What the renderer does in Phase 1

Almost nothing.

> *Every time render is called:*
> *Fill the entire canvas with the background color (#111111).*

That's it. The canvas gets cleared to dark gray every frame. Since nothing else is drawn yet, the result is a dark rectangle on the page. But the rendering pipeline is in place: render reads the World (well, will read it in later phases — in Phase 1 it doesn't need anything from the World yet), writes to the canvas, and returns. It holds no state between calls.

### What's load-bearing about Phase 1

Three decisions made here carry forward through every later phase:

**The 60Hz lock.** Every duration in the game — JumpSquat's 3 frames, Land's 4 frames, the input buffer's 12 frames — is implicitly "at 60Hz." If we changed the timestep, all of those tunings would need re-deriving.

**Input sampled once per loop, not per tick.** This will matter when the input buffer is added in Phase 4. The buffer gets one new entry per tick, but if multiple ticks fire in one rAF, all of them push the same snapshot. This is fine for human input but is worth knowing.

**Render is separate from tick.** Render runs after the while loop, not inside it. If we rendered inside the tick loop, we'd render multiple times per rAF (wasted work) or only the final state (information loss). Rendering once per rAF after all catch-up ticks is the cleanest choice.

---

That's the full logic of Phase 1, stated as conditionals. There are six files involved but the actual game logic is exactly two operations: "increment a counter" and "fill the canvas." The rest is the scaffolding that makes those two operations run reliably at 60Hz forever.