## Phase 2: The Stage

Phase 2 is the smallest phase in the project. One new file gets created, one existing file gets a small update. No game logic is added — no physics, no fighters, no input. The only thing that changes is that the canvas now shows something other than a dark rectangle.

What this phase is really doing, beneath the surface, is **establishing the convention that stage geometry is pure data**. Not a class. Not a builder. Not a config-with-methods. A plain object describing where the platforms are. The renderer learns to read that object and draw lines on the canvas.

This convention is load-bearing for everything later. Drop-through, wall collision, the entire stage-vs-fighter relationship — all of it will lean on the assumption that the stage is just data the systems consult.

Let me walk through what's actually happening.

### The stage, conceptually

The stage is a single JavaScript object exported from `data/stages/battlefield.js`. In Phase 2 it has one field: a list of platforms. Each platform is also a plain object with coordinates.

(Note: this Phase 2 shape was later restructured significantly in Phase 8, when solids and platforms became separate collections and the main floor became a rectangle. For now, in Phase 2's worldview, everything is a platform.)

> *The stage is an object with a list of platforms.*
> *Each platform is an object with four coordinates (x1, y1, x2, y2) and a drop-through flag.*

That's the entire data model in Phase 2. No methods, no validation, no constructors. Just nested plain objects.

The specific platforms for Battlefield are:

- Main floor: a horizontal line from (180, 400) to (780, 400). The drop-through flag is false.
- Left soft platform: from (240, 280) to (380, 280). Drop-through true.
- Right soft platform: from (580, 280) to (720, 280). Drop-through true.
- Top soft platform: from (400, 180) to (560, 180). Drop-through true.

Each one is a horizontal line — y1 equals y2 — even though the data structure could in theory represent any line segment. This matters: the collision math in Phase 3 will assume horizontal lines, and the stage data is shaped to honor that.

### Why "pure data" matters

It would have been possible to write the stage as a class with methods like `addPlatform()` or `isPointOnPlatform()`. We didn't. The reason connects to one of the architectural principles: **data over code**.

When the stage is pure data, anything that wants to inspect it does so by reading fields. The collision system reads `platform.x1` and `platform.y1`. The renderer reads the same fields. A future stage editor could write to those fields without going through any API. A future serialization step could turn the stage into JSON with `JSON.stringify` and back with no custom logic.

If the stage were a class, every consumer would need to know about its methods, and any feature that wanted to inspect the stage would have to go through that class's API. The stage would become a tiny framework. Avoiding that is the entire point.

### Loading the stage into the World

The World, set up in Phase 1, has a `stage` slot. Phase 2 fills it.

In `main.js`, the composition root, the flow is:

> *When the game starts:*
> *Import the battlefield data.*
> *Pass it as an argument when creating the World.*
> *The World object now holds a reference to the stage.*

The World doesn't copy the stage data. It holds a reference. The stage data lives in the module that exported it and the World points at it. This means the stage is effectively read-only at runtime — there's no convention for "edit the stage during play" because no system writes to it. If a future phase needed dynamic geometry (a destructible platform, say), that would be a deliberate addition.

### What the renderer learns

The renderer in Phase 1 only knew how to fill the canvas with a background color. In Phase 2 it learns to read the stage from the World and draw the platforms.

Stated as conditionals:

> *Every time render is called:*
>
> *Fill the entire canvas with the background color.*
>
> *For each platform in the stage's platform list:*
> *Draw a white line from (platform.x1, platform.y1) to (platform.x2, platform.y2).*

That's the entire rendering pipeline in Phase 2. Four lines on a dark canvas.

Two small things are worth noting:

**The renderer reads from the World, not from imports.** It doesn't `import { battlefield }`. It receives the world as an argument and reads `world.stage.platforms`. This is what keeps the renderer decoupled from the specific stage being played — swap a different stage into the World and the renderer just draws whatever's there.

**The renderer holds no state between frames.** It doesn't cache the platforms. It doesn't remember the previous frame's drawing. Every render call walks the platform list fresh. This is slightly wasteful in CPU terms but it eliminates an entire category of bugs (cached state going stale) and matches Canvas's immediate-mode model.

### What the platforms mean (conceptually)

This is the part that's hidden under the data shape: the platforms don't *do* anything in Phase 2. They're just drawn. There's no collision yet, no fighter, no "this is the floor." If a fighter existed (it doesn't yet), it would pass right through the lines without noticing.

What the platforms represent is **a contract for later phases**. Phase 3 will introduce a fighter with physics, and Phase 3 will introduce collision logic. That collision logic will read the same platform data and treat it as solid. The stage data is established now so that when Phase 3 starts, the collision system has something to test against.

The drop-through flag is a particularly clean example: in Phase 2, that flag does nothing. It's a fact written into the data. Phase 9, eight phases later, will be the first time anything reads it. The phase that *added* the flag is not the phase that *uses* it. This is fine — data files are allowed to contain fields that future systems will need, as long as the fields are correct when those systems arrive.

### What's load-bearing about Phase 2

Two decisions:

**The stage is in the World, not imported by each system.** This means systems are agnostic about which stage is loaded. Future stages will plug in by swapping the data; no system code changes.

**Platforms are horizontal-only by convention.** The data structure could represent any line segment, but every platform in Battlefield has `y1 === y2`. The collision math in Phase 3 will exploit this — it will look up `platform.y1` and treat the platform as living at that y. Phase 8 made this explicit by restructuring platforms to use `{y, x1, x2}` rather than `{x1, y1, x2, y2}`. The Phase 2 shape was a stepping stone.

### What's NOT in Phase 2

It's worth naming what was deliberately *not* added:

- No platform "type" beyond drop-through. Future ledges, walls, slopes, springs — none of those exist or are anticipated in the data shape.
- No stage-level constants like gravity or air friction. Those will live on the character (Phase 3) and the state mods (Phase 5). The stage is geometry only.
- No background visuals beyond the dark fill. The renderer is utilitarian.

These are all things that *could* have been added. They weren't, because every addition would be a guess about what future phases need, and guesses tend to be wrong. The stage shape will get restructured in Phase 8 once we have real collision needs to inform the design. Adding speculative fields in Phase 2 would have made that Phase 8 restructure more painful.

---

That's Phase 2. Almost nothing happens, but the convention is established: stages are data, the World holds a reference, the renderer reads through the World. The next phase is where the engine starts to feel alive — a fighter appears, physics start running, the fighter falls and lands.