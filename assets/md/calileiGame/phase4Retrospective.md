## Phase 4: Input

Phase 4 connects the keyboard to the game. Before this phase, the fighter falls and sits — no agency. After this phase, the fighter still falls and sits, because Phase 5 hasn't given the inputs anywhere to *go* yet. But the pipeline is fully built and inspectable: every frame, the keyboard state becomes a snapshot, the snapshot enters the fighter's history, and the history is queryable.

This phase has three concepts, each in its own file. **The keyboard listener** tracks which physical keys are currently held. **The input buffer** holds a rolling history of recent snapshots per fighter. **The input system** is the per-frame glue that pushes the current snapshot into each fighter's buffer.

The interesting design choices live in *why* it's shaped this way — and in what kinds of questions become askable as a result.

### The keyboard listener, conceptually

This is the one place in the engine that talks to the browser's DOM API. Game logic never reads from the keyboard directly. The listener is a translation layer between "what physical keys is the operating system telling me are pressed right now" and "what does the game think the player is doing."

It owns one piece of state: a Set of currently-held key codes. When a key goes down, add it. When a key goes up, remove it.

> *When the window receives a keydown event:*
> *Add the event's code to the held-keys set.*
>
> *When the window receives a keyup event:*
> *Remove the event's code from the held-keys set.*

There's a subtle gotcha that bites every keyboard handler ever written: what happens if the user holds a key, alt-tabs out of the window, and releases the key while another app has focus? The browser never delivers the keyup — it went to the other window. When the user comes back, your held-keys set still has the key. The fighter walks forever.

> *When the window loses focus:*
> *Clear the held-keys set entirely.*

This is a reset, not a fix. We accept that if the user releases mid-blur, we lose that information; what we don't accept is the held set lying about reality. On blur, we assume nothing.

There's also a small piece of browser plumbing: the Space and arrow keys default to scrolling the page. We don't want that.

> *When a keydown event arrives for a key the game uses (arrows, Space):*
> *Tell the browser not to do its default action.*

That's the entire keyboard listener. State: one Set. Behavior: add on press, remove on release, clear on blur, suppress scrolling.

### Building a snapshot

The Set is the raw OS-level state. Game logic doesn't want to ask "is the KeyW key down?" — it wants to ask "is the stick pointing up?" The translation happens in a function called `getCurrentInput`. It reads the Set, computes a snapshot, returns it.

The snapshot shape is **gamepad-flavored**: an analog stick decomposed into x and y axes, and a handful of named buttons. This shape is deliberate. A future gamepad module would produce snapshots with the same shape, and nothing downstream would need to change.

> *To build the current input snapshot:*
>
> *Start with stickX = 0.*
> *If LeftArrow or KeyA is held, subtract 1.*
> *If RightArrow or KeyD is held, add 1.*
>
> *Start with stickY = 0.*
> *If UpArrow or KeyW is held, subtract 1.*
> *If DownArrow or KeyS is held, add 1.*
>
> *Build a button object: jump = Space is held, attack = KeyZ is held, shield = KeyX is held.*
>
> *Return an object with stickX, stickY, jump, attack, shield.*

A couple of things to notice.

**stickX and stickY are integers**, not floats. On a keyboard, the stick is digital — fully neutral or fully pushed. A gamepad implementation would return values like 0.7 to express partial deflection. Game logic that wants to know "is the stick deflected at all" can compare to zero; logic that wants "is the stick fully pressed" can check for ±1; logic that wants magnitudes will work in either case. The shape doesn't lock out analog input — keyboard just always uses the extremes.

**Y is positive when pressing down.** Y-down again. The same convention as the rest of the engine. Pressing the down arrow gives stickY = +1, which matches "stick is pointing toward larger y values." When `crouchInput` in Phase 5 asks "is stickY positive?", that's checking for "is the player pressing down."

**Both arrows AND WASD map to the same axes.** Players who prefer one or the other can use either. If they press both, the result is sensible: LeftArrow + KeyD would give stickX = -1 + 1 = 0, the same as no input at all. The signs add naturally.

**Z and X are captured but unused.** Attack and shield buttons exist in the snapshot from Phase 4 onward, even though nothing reads them yet. This is a deliberate Phase 4 decision: the snapshot shape is the contract with the rest of the engine, and we don't want to keep changing the contract every time a new mechanic arrives. Building the full contract early means later phases just consume fields that were already there.

This function is called fresh every time someone asks for the current input. It allocates a new object. There's no caching. It's cheap — building a small object is microseconds — and "no cached state" is the architectural rule.

### The input buffer, conceptually

The buffer is the engine's memory of recent input. Without it, the only question we could ask is "what is the player doing right now?" With it, we can ask "did the player press jump in the last 5 frames?" or "did the stick go from neutral to right within the last 3 frames?"

Every fighter has its own buffer, because in a future multiplayer scenario each fighter is driven by its own input source. The buffer is a flat array of snapshots, with the most recent at index 0 and older snapshots at higher indices.

> *Buffer is a list of snapshots.*
> *buffer[0] is "now."*
> *buffer[1] is "one frame ago."*
> *buffer[N] is "N frames ago."*

The convention "newest at index 0" reads naturally in transition rules: `wasPressedWithin(buffer, 'jump', 5)` means "look at the last five entries," which directly maps to indices 0 through 4. The alternative — newest at the highest index — would force every condition to compute `buffer.length - 1 - i`, which is the kind of thing that leaks bugs.

The buffer has a fixed maximum size of 12 frames. Twelve is enough to cover all the Melee-class input windows we'd ever want — most timing windows in that game are between 3 and 8 frames; 12 gives headroom. Entries older than 12 frames fall off the end.

> *To push a snapshot into the buffer:*
> *Insert the snapshot at index 0 (everything else shifts up).*
> *If the buffer now has more than 12 entries, drop the oldest.*

This is the only operation that mutates the buffer. Reads are non-destructive: the buffer is the source of truth for input history, and conditions consult it without changing it.

### Query helpers on the buffer

Some questions about input history are common enough to deserve named helpers. Phase 4 adds two; Phase 5 will add more.

**Was a button pressed within the last N frames?**

> *To answer "was key K pressed within the last N frames":*
> *Walk through the buffer from newest to oldest, up to N entries.*
> *For each pair of adjacent entries (current and one older):*
> *If the current frame has K held, AND the previous frame did not, that's a rising edge.*
> *Return true on the first rising edge found.*
> *If no rising edge in N frames, return false.*

The function looks for a **rising edge** — a transition from "not held" to "held." If the player holds Space across many frames, the rising edge only happens on the first frame; subsequent frames have Space held in both the current entry and the previous entry. This is what distinguishes a *press* from a *hold*: the press is an event, the hold is a state.

This is the helper that will let "jumpPressed" be a one-time event even when the player keeps holding Space. The buffer remembers the transition; the helper finds it.

**Getting recent stick history.**

> *To get the last N stick positions:*
> *Walk the buffer up to N entries.*
> *Return a list of {stickX, stickY} pairs, newest first.*

Used by future conditions that care about stick motion patterns — like dash detection in Phase 7, which looks for "stick went from neutral to a direction within the last 5 frames."

### The input system, conceptually

The input system is the per-frame glue. Every tick, it pushes the current snapshot into every fighter's buffer.

> *Every frame, for each fighter in the World:*
> *Push the current input snapshot into the fighter's buffer.*

That's the entire system. Two lines of conceptual logic. The complexity isn't in *how* it pushes — it's in *what* the snapshot represents and *which* fighters get *which* snapshots.

In Phase 4 with one fighter, the snapshot built by `getCurrentInput` goes into the fighter's buffer. In a future two-player setup, each fighter would have its own input source: player 1 from the keyboard, player 2 from a gamepad, or both from a network connection. The system would route different snapshots to different fighters. The buffer's shape doesn't change; only the source.

### The full pipeline, end to end

The data flow from a key press to a queryable buffer:

> *Player presses Space.*
> *Browser fires keydown event.*
> *Keyboard listener adds 'Space' to the held-keys Set.*
>
> *... time passes, browser fires rAF ...*
>
> *main.js calls getCurrentInput, which reads the Set and builds a snapshot: {stickX: 0, stickY: 0, jump: true, attack: false, shield: false}.*
> *main.js calls tick with the snapshot.*
> *tick calls inputSystem.*
> *inputSystem pushes the snapshot into fighter.inputBuffer.*
> *After tick, fighter.inputBuffer[0] has the snapshot with jump=true.*
>
> *Next frame, Space is still held.*
> *getCurrentInput builds a fresh snapshot with jump=true.*
> *inputSystem pushes it.*
> *Now buffer[0] has jump=true, buffer[1] also has jump=true.*
> *Calling wasPressedWithin(buffer, 'jump', 5) looks for a rising edge in the last 5 entries.*
> *It finds buffer[1] has jump=true and buffer[2] has jump=false → rising edge → returns true.*
>
> *Player releases Space, Browser fires keyup, listener removes 'Space' from Set.*
> *Next frame's snapshot has jump=false.*
>
> *... five frames later, all entries within the last 5 frames have jump=false ...*
>
> *wasPressedWithin returns false.*

The Phase 4 game doesn't *do* anything with this. The fighter still just falls. But you can open the browser DevTools, type `world.fighters[0].inputBuffer[0]`, and see your own keypresses landing in the buffer in real time. This is the first phase where the game is observably alive.

### Why this architecture

A few alternative designs would have worked:

We could have **read keyboard state directly from conditions** ("if Space is held right now"). This would skip the buffer entirely. It would also be wrong — conditions need to know about transitions and recent history, not just instantaneous state. "Did the player press jump within the last 5 frames" can't be answered from the current frame alone.

We could have **pushed individual events into a queue** (keydown event, keyup event, etc.). This would be more precise. It would also be far more complex, and platform fighters don't need sub-frame precision. The "snapshot per frame" model matches how Melee actually polls its controllers, and at 60Hz it's plenty of resolution.

We could have **made the buffer a circular array** with a write pointer, instead of unshifting onto the front and truncating. This would be more efficient. It would also make reads more complex (index arithmetic with modulo). The Phase 4 implementation favors clarity over efficiency at a scale where neither matters.

### What's load-bearing

A handful of decisions from Phase 4 echo through every later phase.

**The snapshot shape is final.** Adding a new button or stick axis later would require either changing the shape (and updating every consumer) or adding a new buffer alongside the existing one. The current shape — two-axis stick plus three buttons — was chosen to be enough.

**The buffer is per-fighter.** Even with one player, the buffer lives on the fighter object. This matters when a second fighter is added: nothing changes structurally. Each fighter still has its own buffer; each fighter's input source is decoupled.

**`buffer[0]` is "now."** The newest-first convention is referenced in every condition that ever queries the buffer. Reversing it would touch dozens of lines.

**One snapshot per tick, not per rAF.** When the fixed-timestep loop runs catch-up ticks (multiple ticks in one rAF call), each tick gets the same snapshot — but the buffer gets one new entry per tick, not per rAF. So a catch-up frame puts the same snapshot into the buffer multiple times. This is correct: the buffer is a frame-by-frame record, and if three frames happened, three entries should reflect those three frames.

**The blur-clears-Set behavior.** Without it, the fighter walks forever after alt-tab. With it, the held-keys state is sometimes wrong (e.g., the user pressed a key while we were blurred and we never saw the keydown). The clear-on-blur policy chooses "definitely wrong on resume, then definitely right after the next keydown" over "possibly stuck forever."

**Keyboard is the only DOM consumer in the engine.** Every other module is DOM-agnostic. If we ever want to run the game in a headless environment (server-side simulation, replay verification, automated testing), we replace this one file with a stub that produces snapshots from some other source.

---

**a buffered input fires later than its press frame when the current state doesn't have a transition that the input would trigger.** The buffer keeps the press alive while the fighter is in a state that doesn't care, and the input "lands" the moment the fighter enters a state that does care — within whatever window that condition uses.

Concrete scenarios in our current build:

**Press jump during the 3 frames of JumpSquat.** JumpSquat's only transition is `durationElapsed` — it doesn't check `jumpPressed`. So a Space press during JumpSquat doesn't do anything that frame. But after JumpSquat exits to Fall, Fall doesn't check `jumpPressed` either — it checks `canAirJump`, which uses a 3-frame window. If your Space press was within the last 3 frames when Fall first evaluates, the press fires there as an air jump. So a press during JumpSquat frame 1 → fires 2 frames later in Fall as an air jump. The press was buffered for 2 frames.

**Press jump during the 4 frames of Land.** Land doesn't check `jumpPressed`. The fighter waits out Land's duration, transitions to Idle, and Idle's first stateSystem check evaluates `jumpPressed` using the 5-frame `JUMP_BUFFER_FRAMES` window. If the press is still within 5 frames, it fires — Idle → JumpSquat. So a press on Land's first frame fires 4 frames later in Idle. The press was buffered for 4 frames. This is the classic "jump out of landing lag" feel — you press during the landing, and the engine remembers it for you.

**Press jump just before landing.** You're in Fall, about to touch down. You press Space one frame before grounded fires. Fall's `canAirJump` doesn't fire because no air jumps left. Fall transitions to Land via `grounded`. Land doesn't check `jumpPressed`. Land runs for 4 frames, then Idle. Idle checks `jumpPressed` within 5 frames. If the original press was 5 frames ago or fewer, it fires in Idle and you jump out of Land's lag. A press 1 frame before landing → 1 frame in Fall + 4 frames in Land + 1 frame in Idle's first check = the press is at buffer index 5 when it fires. Buffered for 5 frames.

**The hard ceiling.** Every condition that looks back through the buffer has its own window. `jumpPressed` uses 5 frames. `canAirJump` uses 3. `stickSlammed` uses 5. The buffer holds 12 entries, but no current condition actually scans all 12 — the longest-reaching condition tops out at 5. So in practice, the maximum delay between press and fire in the current build is around 5 frames, not 12.

**What about the dash example you used?** You can also delay Dash similarly. Press a direction during JumpSquat → it sits in the buffer. JumpSquat exits to Fall, which doesn't have a `stickSlammed → Dash` transition (only grounded states do). Fall continues until you land, transitions to Land, and Land *does* check `stickSlammed` (priority above `durationElapsed`). If your direction-press is still within the 5-frame window when Land evaluates, you fire directly into Dash from Land. Press a direction on JumpSquat's last frame → 1 frame later you're in Fall → fall to ground → Land → Dash on Land's first frame. The press fires 2-ish frames after the snapshot, depending on how long Fall lasted.

The general pattern: **a press is buffered for exactly the number of frames between the snapshot and the next state that has a matching transition condition with an open window.** If no such state arrives within the window, the press expires unused.

This is what gives the engine its "responsive" feel without requiring frame-perfect input. The player doesn't have to wait for the exact frame Land ends to press jump — they can press during Land and the engine catches it. The architecture for this is just "the press lives in the buffer; transitions ask the buffer if it's seen one recently." No special-case "input buffering" code anywhere. It's an emergence.

That's Phase 4. The engine now sees the player. It just doesn't do anything with that information yet — the fighter falls under gravity, lands, and sits.