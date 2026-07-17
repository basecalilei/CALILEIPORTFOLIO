# calileiNotation

**Version:** 0.8.0
**Status:** Foundation — metric grid + vocal layer (sustain, pitch, anchor, hits, rhyme) + lyric structure (combo / line / linePart)
**Part of:** `calileiStyle` (the broader framework describing Calilei's personal music style)

---

## 0. Purpose

`calileiNotation` is a plain-text system for writing musical ideas as code.
It is built declaratively: terms are **declared**, relationships are **defined**,
and the grammar grows one rule at a time.

This file is the canonical spec. It is self-contained and does **not** depend on
any other notation system, skill, or framework.

---

## 1. Design laws

These are fixed decisions. Later rules must not violate them.

| # | Law |
|---|-----|
| L1 | **Time is vertical and sequential.** Stacked lines read top→bottom as bar 1, bar 2, bar 3 … There is no simultaneity — no layered/polyphonic voices. |
| L2 | **Whitespace is non-semantic (cosmetic).** Spacing never changes meaning. |
| L3 | **A bar always contains exactly 4 beats.** |
| L4 | **Everything is declared before use.** No implicit symbols. A `slot` holds a `rest`, an `anchor`, a `syllable`, or a `sustain`. |
| L5 | **Structure ≠ duration.** The grid encodes *how a beat is divided* (into N **equal** parts), never absolute time. Names like "8th" or "triplet" are interpretation, assuming beat = quarter note. Absolute timing waits for tempo/meter declarations. |
| L6 | **One slot, at most one onset.** A slot introduces at most one *delivered* syllable (one onset). Its occupant is a new onset (`syllable`), a continuation of the previous onset (`sustain`), or silence (`rest`). The text in an onset labels that single utterance regardless of dictionary syllable count; two delivered syllables = two slots. calileiNotation notates **delivery**, not text. |
| L7 | **Pitch is relative.** A pitch tag is a scale degree `1`–`7` relative to an (as-yet-undeclared) tonic — never an absolute frequency. Consistent with L5. It is optional on any onset or sustain, and a `rest` never takes one. Realizing pitch as sound will require a tonic/key declaration (future). |
| L8 | **The anchor is a silent reference.** `#` marks where the instrumental's primary repetitive hit is *expected*; by itself it reads as a `rest` and makes no sound. It is **scaffolding**, never content — it never shares a slot with an occupant, and **realizing** a skeleton replaces every `#` with a `syllable`, a `sustain`, or a `rest`. A finished (realized) grid contains no `#`. |
| L9 | **A hit is a vocal accent, independent of the anchor.** `*` tags an onset (a `syllable` or placeholder) as a **hit** — an emphasized landing in the flow. It marks emphasis only: not pitch, not coincidence with `#`. The `#` anchor (instrumental) and the `*` hit (vocal) are **separate layers**; their alignment or offset is what produces *bounce* (the grammar of that offset is `comboBounce.md`). `*` attaches to onsets only — never a `rest`, `sustain`, or `anchor`. |
| L10 | **Lyric structure is a second hierarchy over the same timeline.** The metric tree (`bar → beat → slot`) and the lyric tree (`lineCombo → line → linePart`) are **independent partitions of one slot stream**. Lyric units are bracketed *spans* that may begin and end mid-bar and span multiple bars; they do **not** align to barlines. They nest properly (combo ⊃ line ⊃ linePart) and never cross — brackets are balanced and well-nested. This introduces no simultaneity: both trees group the same sequential slots (L1), two ways at once. |

---

## 1b. Guidelines (descriptive)

Guidelines describe how the system is *used well*. Unlike laws (§1), they are **not
enforced by the grammar** — they capture musical/phonetic reality, and have
exceptions.

| # | Guideline |
|---|-----------|
| G1 | **Elision heuristic.** A technically-multi-syllable word can legitimately collapse into one slot only when its syllables meet at a **vowel or glide**, letting them fuse into a single onset (e.g. `sayin'` → "sayn"). When a **consonant sits at the junction**, it forces a syllable break and the word *cannot* be delivered as one onset (e.g. `takin'` has no one-onset form — there is no "takn"). Such a word must span multiple slots (`ta:kin'`). |
| G2 | **Typical anchor placement.** The anchor is the single slot the listener most strongly expects a hit on, set by the instrumental — usually the downbeat of **beat 1**, with a period that can vary (every bar, or every other). The even midpoint between anchors — the downbeat of **beat 3**, when the anchor sits on the 1 — is *not* a second anchor; it's where exposed vocal hits gravitate (anchorHit vs. bareHit — see `comboBounce.md`). This is a tendency, not a rule; an instrumental can place its anchor anywhere a hit is expected. |
| G3 | **Hits and bounce.** Hits *gravitate* toward the anchor or the even spots between anchors (anchor on the beat-1 downbeat → hits tend toward the downbeats of 1 and 3), but they are free to land anywhere. **Bounce comes from how lines, syllables, and hits are arranged *around* the anchor** — from the push-and-pull against the pulse, not from locking onto it. The full grammar of this — anchorHit vs. bareHit, the placement shapes, the two hard rules — is `comboBounce.md`. |
| G4 | **Combo shape (per `lineCombo.md`).** A well-formed `lineCombo` contains **exactly two lines** (call → response). A `line` is either **undivided** (no marked lineParts) or split into **two** lineParts (the `[A]` / `[B]` caesura). The notation can *represent* other shapes for analysis, but the writing style treats two-lines / two-or-zero-parts as the norm. |
| G5 | **Rhyme binds on the hits.** The combo's defining rhyme lands on each line's **hit** (`*`) — per `lineCombo.md` §6 — so the binding pair usually shares a letter on the two hits. Secondary threads (the trailing syllable of a multisyllabic rhyme, or an internal rhyme) ride **non-hit** onsets. A **trail** rhymes *by hand* (§11): it has no combo to anchor it, so tag its rhyme explicitly. |

---

## 2. Primitives

The atomic glyphs of the system.

| Term | Glyph | Definition |
|------|-------|------------|
| `barline` | `\|\|` | Delimits the start and end of a **bar**. |
| `beatline` | `\|` | Separates **beats** inside a bar. |
| `subdivision marker` | `:` | Splits a **beat** into equal **slots**. |
| `rest` | `_` | An empty **slot** — a position with no event. |
| `anchor` | `#` | A **silent reference** marking where the instrumental's primary hit is expected. Reads as a rest; scaffolding only (L8). |
| `syllable placeholder` | `x` | A filled slot whose syllable is not yet decided — one delivered onset, TBD. |
| `sustain` | `>` | Continues the previous onset into this slot — a held vowel, **not** a new onset. |
| `hit` | `*` | Optional **prefix** tag on an onset: marks that syllable as a *hit* — a vocal accent (L9). |
| `pitch` | `1`–`7` | Optional trailing tag on an onset or sustain: a relative scale degree (L7). |
| `rhyme tag` | `=A`…`=Z` | Optional trailing tag on an onset: groups onsets that rhyme. Same letter = same rhyme thread. Goes **after** the pitch tag. |
| `lineCombo` | `{ }` | Brackets a **combo** — a two-line call-and-response unit (L10, G4). |
| `line` | `[ ]` | Brackets a **line** of lyric. |
| `linePart` | `( )` | Brackets a **half** of a line (`[A]` or `[B]`). |

> Note: `barline` is two pipes `\|\|`; `beatline` is a single pipe `\|`.
> A **realized syllable** is not a fixed glyph — it is literal text (see §3).
> A slot whose content is *exactly* `x` is a placeholder; any longer run of text
> is a realized syllable (so `ex`, `next`, `box` are literal words, not placeholders).
> "**degree**" in this spec always means *slot-count per beat*; the 1–7 pitch
> values are written as **pitch** to avoid colliding with that term.

---

## 3. Structure

```
grid  →  contains one or more bars (one per line)
bar   →  contains exactly 4 beats
beat  →  contains one or more slots (joined by ":")
slot  →  contains exactly 1 occupant   (a rest, anchor, syllable, OR sustain)
```

- **grid** — the whole notation space. Read top to bottom = forward in time (L1).
- **bar** — one line. Opens with `||`, closes with `||`. Always 4 beats (L3).
- **beat** — one of the 4 positions in a bar, separated by `|`. A beat is a
  **container**: it holds 1+ slots, split by the subdivision marker `:`.
- **slot** — the smallest container. Holds exactly one occupant.
- **degree** — the number of slots in a beat.

### Occupants

A slot holds exactly one of:

```
occupant
├── rest            "_"                  silence / no onset
├── anchor          "#"                  silent reference — expected hit (L8); scaffolding only
├── syllable        one NEW onset (L6)        ── may carry hit (*), pitch, and/or rhyme (=)
│   ├── placeholder "x"                  onset present, content TBD
│   └── realized    literal text         the actual sung syllable
└── sustain         ">"                  continues the previous onset ── may carry a pitch
```

Tag order on an onset: `[*] core [pitch] [=rhyme]` — hit prefix, then the
syllable/placeholder, then the optional pitch digit, then the optional rhyme tag.
E.g. `*post1`, `*x2`, `*yay2`, `*wait1=A`, `for2=B`.

A **realized syllable** is any run of characters *except* the reserved glyphs
(`|`, `:`, `_`, `>`, `#`, `*`, `.`, `=`, `!`, `~`, `{`, `}`, `[`, `]`, `(`, `)`) and
whitespace. Apostrophes and other letters are fine (`sayin'`, `what`, `im`). Case is
preserved but cosmetic. Per L6 the text names **one** onset regardless of its
dictionary syllable count.

### Pitch tag (`1`–`7`)

Any onset or sustain may carry an optional **pitch** — a single trailing digit
`1`–`7`, no space (`x1`, `she3`, `>5`). It is a *relative* scale degree (L7).
An onset with no pitch tag is rhythm-only ("there is a syllable here, pitch
unspecified"). A `rest` never takes a pitch. Parsing convention: a trailing `1`–`7`
on a realized syllable is read as pitch (sung labels rarely end in a digit; a literal
trailing digit is a deferred edge case).

### Rhyme tag (`=A`…`=Z`)

An onset may carry an optional **rhyme tag** — `=` plus one uppercase letter,
trailing, **after** the pitch (`wait1=A`, `for2=B`, `*x1=C`). Onsets sharing a letter
**rhyme together** (one rhyme thread per letter).

- For now the tag asserts only *that* they rhyme — **any kind** (perfect, slant, exact
  word match). Reserved for later: a qualifier mark such as `=A!` or `=A~` to specify
  the *kind* of rhyme. `!` and `~` are held for this and must not be used as text yet.
- The **binding** combo rhyme rides the two lines' **hits** (G5); secondary threads
  (the next syllable of a multisyllabic rhyme, or an internal rhyme) ride non-hit
  onsets. So a two-syllable end-rhyme reads as two threads side by side (`*wait1=A`
  then `for2=B`, recurring).
- A rhyme tag attaches to **onsets only** — not a `rest`, `sustain`, or `anchor`.
- A **trail** (a line outside any combo) rhymes by hand — tag it explicitly (G5).

### Hit tag (`*`)

An onset (syllable or placeholder) may carry an optional **hit** — a leading `*`,
no space (`*post1`, `*x2`). A hit marks the syllable as a **vocal accent**: an
emphasized landing in the flow.

- It is a property of the **vocal**, not the instrumental. The `#` anchor is the
  instrumental's pulse; the `*` hit is where the voice *lands hard*. They are
  independent layers (L9).
- It attaches to **onsets only** — never a `rest`, `sustain`, or `anchor`. A hit is
  an articulation; you cannot accent a hold or a silence.
- It carries no meaning about pitch and does not assert coincidence with `#`.
- Hits and the anchor together create **bounce** — see G3, and `comboBounce.md` for the full treatment.

### Sustain (`>`)

`>` holds the **most recent onset** into the current slot — a continued vowel, not
a re-articulation.

- **Bare `>`** holds at the **same pitch** as what it continues.
- **`>N`** holds the vowel but **moves to pitch N** (melisma / glide).
- It **chains** for longer holds: `x1:>3:>5` is one onset gliding `1 → 3 → 5`.
- It may **cross a barline** to hold the previous bar's final onset into the next bar.
- A `>` with **no prior onset** anywhere before it is **illegal**.

Because a sustain consumes a slot of time without a new onset, `>` is also how
**uneven durations** are written: hold some slots, articulate others
(e.g. triplet `x:>:x` = a long note then a short one within the beat).

A `>` looks past **silent slots** (`_` and `#`) to find the onset it continues —
silence does not break a sustain's lineage, it just isn't a new onset.

### Anchor (`#`)

The anchor `#` marks where the instrumental's primary repetitive hit is *expected*
— typically an 808, kick, or a big snare/clap. It is the pulse the vocalist phrases
**against**, which is what makes pocket and syncopation visible on the grid.

- It is **silent** — by itself a slot of `#` sounds like a `rest` (L8).
- It is **scaffolding** — a tool for laying out a blank skeleton before words.
- It **never coexists** with content: put a syllable in that slot and the `#` is gone.
- It takes **no pitch tag**.

### Skeleton vs realized

A grid has two phases:

- **Skeleton** — a template. May contain anchors `#` (expected hits) and
  placeholders `x` (onsets, content TBD) alongside rests and subdivisions.
- **Realized** — filled in. Every `#` has been *resolved* to whatever the vocal
  actually does at that position:
  - an **onset** lands on the hit → a `syllable`
  - a **held note** rolls over it → a `sustain`
  - nothing lands → a `rest`

A fully realized grid contains **no `#`**. (Placeholders `x` may remain — an `x` is
a real onset whose text/pitch is simply still TBD; only `#` is required to disappear.)

Example — a skeleton with an anchor on beat 3:

```
skeleton:  || _ | _ | # | _ ||
```

Realized as one syllable sustained across the whole bar (the `#` becomes a `>`):

```
realized:  || x2 | > | > | > ||
                       ^
                       the anchor's slot — now a sustain rolling over the expected hit
```

```
_           degree 1   → undivided beat
_:_         degree 2    → "8ths"
_:_:_       degree 3    → "triplet"
_:_:_:_     degree 4    → "16ths"
```

An undivided beat (`_`) is simply degree 1 — it falls out of the same rule, no
special case. Each beat declares its **own** degree independently; beats within a
bar may mix degrees freely:

```
|| _ | _ | _:_:_ | _ ||     ← three straight beats, then a triplet
```

> **Terminology note:** in everyday speech a "measure" = a single bar, but here
> "a 4-bar measure" just means *a grid of 4 bars*. We track the container as
> **grid**; "measure" is informal shorthand for "a block of N bars."

---

## 3b. Lyric structure (the second hierarchy)

Everything in §3 is the **metric** hierarchy — how time is divided. Lyric structure
is a **separate** hierarchy laid over the *same* slots (L10): how the *words* are
grouped into the units of the writing style.

```
metric tree:   grid → bar → beat → slot          (how time divides)
lyric  tree:   lineCombo → line → linePart        (how words group)
                         └ both partition the same slot stream ┘
```

### The slot stream

Read across all bars (top to bottom, left to right, L1), the grid is one continuous
sequence of slots — the **slot stream**. Lyric units are **spans** over that stream:
a unit opens at some slot and closes at a later slot, covering everything between.
Because they live on the stream, **lyric units ignore barlines** — a combo can open
on a pickup mid-bar and close three bars later, mid-bar.

### The three units

| Unit | Brackets | Is |
|------|----------|----|
| `lineCombo` | `{ … }` | the two-line call-and-response unit — the atomic creative unit (G4) |
| `line` | `[ … ]` | one line of lyric |
| `linePart` | `( … )` | a half of a line — `[A]` (call) or `[B]` (response) |

They **nest**: `lineCombo ⊃ line ⊃ linePart`. Brackets are balanced and properly
nested; they never cross.

### Placement rules

- **Opening** brackets **prefix** the first slot of the unit — before any `*` hit and
  the word: `{[we1`, `[(need1`.
- **Closing** brackets **suffix** the last slot of the unit — after the pitch tag:
  `*day2]`, `work1)`, `*yay2)]}`.
- When several stack on one slot, **opens go outermost-first** (`{` `[` `(`) and
  **closes innermost-first** (`)` `]` `}`).
- A unit may open or close on **any** slot, including a `rest` or `sustain` (e.g. a
  line that ends on a held note closes on its `>` slot).

### Caesura, pauses, and trails — for free

- **Caesura** — the `[A]`/`[B]` split is simply the **boundary between the two
  lineParts** (`)` … `(`). The pause itself is the rests in that gap; no dedicated
  glyph is needed.
- **Silent half** — a `linePart` whose slots are all rests (a half made of silence).
- **Trail** — a `line` placed **outside** any `lineCombo` (a `[ … ]` after a `{ … }`,
  not inside it). Its position binds it to the combo it follows. No special mark —
  exactly as `lineCombo.md` §11 specifies.

---

## 4. Whitespace convention

Whitespace is cosmetic (L2), but the **house style** is:

- pad each `barline` and `beatline` with a single space on each side
- keep the `subdivision marker` `:` **unpadded** (`_:_`, never `_ : _`) — the tight
  binding visually groups slots into one beat, while the padded `|` separates beats
- a `sustain` `>` sits in a slot like any occupant; join it with `:`, unpadded (`x1:>3`)
- a `pitch` tag trails its onset/sustain immediately, no space (`x1`, `she3`, `>5`)
- a `rhyme tag` trails the pitch immediately, no space (`wait1=A`, `for2=B`, `*x1=C`)
- a `hit` `*` prefixes its onset immediately, no space (`*post1`, `*x2`)
- structural brackets **glue** to their slot token, no space — opens prefix the first
  slot (`{[we1`), closes suffix the last (`*yay2)]}`); stacked brackets stay glued
- an `anchor` `#` sits in a slot like a rest — padded by the surrounding `|`, not specially
- do **not** pad the `rest` glyph specially

So these parse identically:

```
|| _:_ | _:_ | _:_ | _:_ ||      ← house style (preferred, readable)
||_:_|_:_|_:_|_:_||              ← legal, same meaning
```

---

## 5. Grammar

Formal grammar as it stands at v0.8.0 (EBNF-style):

```ebnf
grid        = bar , { newline , bar } ;
bar         = "||" , beat , "|" , beat , "|" , beat , "|" , beat , "||" ;
beat        = slot , { ":" , slot } ;     (* 1+ slots; ":" splits them *)
slot        = { open } , occupant , { close } ;   (* brackets may affix a slot *)
occupant    = rest | anchor | syllable | sustain ;
rest        = "_" ;
anchor      = "#" ;                        (* silent reference; skeleton only (L8) *)
syllable    = [ hit ] , ( placeholder | realized ) , [ pitch ] , [ rhyme ] ;
sustain     = ">" , [ pitch ] ;
hit         = "*" ;                        (* vocal accent; onsets only (L9) *)
placeholder = "x" ;                        (* slot content is exactly "x" *)
realized    = char , { char } ;            (* run of non-reserved chars *)
pitch       = "1" | "2" | "3" | "4" | "5" | "6" | "7" ;
rhyme       = "=" , letter ;               (* rhyme thread; onsets only *)
letter      = "A" | "B" | … | "Z" ;
open        = "{" | "[" | "(" ;            (* lineCombo / line / linePart open *)
close       = ")" | "]" | "}" ;            (* linePart / line / lineCombo close *)
char        = ? any character except reserved glyphs and whitespace ? ;
            (* reserved: "|" ":" "_" ">" "#" "*" "." "=" "!" "~"
                         "{" "}" "[" "]" "(" ")" *)
```

Reserved-but-undefined: `.` (future feature) and `!` `~` (future rhyme-kind
qualifiers, e.g. `=A!` / `=A~`) must not be used as literal text yet.

Constraints not expressible in the grammar:
- a `sustain` is **illegal** unless some onset precedes it (this bar or a prior one) — §3.
- an `anchor` belongs to a **skeleton**; a realized grid contains none (L8).
- a `hit` `*` and a `rhyme` `=` attach to onsets only — never `rest`/`sustain`/`anchor`.
- structural brackets, read across the whole grid, must be **balanced and properly
  nested** (`{` ⊃ `[` ⊃ `(`); they never cross (L10, §3b).

(Whitespace around `||` and `|` is permitted and ignored — see §4.)

---

## 6. Canonical example

An empty 4-bar grid (all beats degree 1):

```
|| _ | _ | _ | _ ||
|| _ | _ | _ | _ ||
|| _ | _ | _ | _ ||
|| _ | _ | _ | _ ||
```

Subdivision degrees (each bar uniform here, but they need not be):

```
|| _:_ | _:_ | _:_ | _:_ ||            ← 8ths      (degree 2)
|| _:_:_ | _:_:_ | _:_:_ | _:_:_ ||    ← triplets  (degree 3)
|| _:_:_:_ | _:_:_:_ | _:_:_:_ | _:_:_:_ ||   ← 16ths (degree 4)
```

Mixed degrees within one bar (each beat declares its own):

```
|| _ | _:_ | _:_:_ | _:_:_:_ ||
   d1   d2     d3       d4
```

A lyric **skeleton** — placeholders mark where syllables land, not yet what they are:

```
|| x:x | x:_ | x:x | _:x ||
   └┬┘   └┬┘   └┬┘   └┬┘
   2syl  syl   2syl  rest
         +rest        +syl
```

The same idea **realized** — placeholders replaced by sung syllables:

```
|| she | know | what:im | sayin' ||
    1      1      2          1        ← onsets per beat
```

Here `what:im` is two onsets across two slots, while `sayin'` is a single onset
in one slot (delivered "sayn") — legal under L6, and singable under G1 because the
collapse happens at a glide, not a consonant.

**Sustain + pitch** — the canonical melody example:

```
|| x1:>3 | _ | x5 | x1:x1 ||
   └──┬─┘  ┬   ┬   └──┬──┘
   one    rest │   two onsets,
   onset,      │   both pitch 1
   held 1→3    onset at pitch 5
```

A held vowel rising across a triplet (one onset, two sustains):

```
|| oh1:>3:>5 | _ | _ | _ ||     ← "oh" articulated once, gliding 1 → 3 → 5
```

A sustain **crossing a barline** (the previous bar's last onset held into the next):

```
|| _ | _ | _ | hi5 ||
|| >5 | _ | _ | _ ||            ← "hi" held through the downbeat of bar 2
```

An **anchor skeleton** — `#` marks the expected instrumental hit (here, beat 1 of
each bar). Silent on its own; a reference to write the vocal against:

```
|| # | _ | _ | _ ||
|| # | _ | _ | _ ||
|| # | _ | _ | _ ||
|| # | _ | _ | _ ||
```

Realizing it — the vocal can land **on** the anchor, **dodge** it (rest), or **roll
over** it (sustain). All three resolve the `#` away:

```
|| hit1 | _ | _ | _ ||      ← onset lands on the anchor
|| _ | _ | x | _ ||         ← anchor dodged: vocal enters off the pulse (rest on 1)
|| go3 | > | _ | _ ||       ← onset just before/on the pulse, held over it
```

### Full pipeline: blank → skeleton → filled

The clearest illustration of the whole system. A **blank** anchor grid (instrumental
pulse on the beat-1 downbeat), a **skeleton** that lays in rhythm + hits + placeholder
pitches, and the **filled** version with realized words. `*` marks the vocal hits;
note they sit on beat-1 / beat-3 onsets — riding and pushing against the anchor (G3):

```
blank
|| # | _ | _ | _ ||
|| # | _ | _ | _ ||
|| # | _ | _ | _ ||

skeleton
|| _ | _ | _ | x1:x1:x1:_ ||
|| *x1:x1:x1:x1 | _:x1:x1:_ | *x2:_ | x1:_:x1:_ ||
|| _:x1:x1:_ | x1:x1:x1:_ | *x2:_ | _ ||

filled
|| _ | _ | _ | we1:would1:just1:_ ||
|| *post1:on1:that1:block1 | _:eve1:ry1:_ | *day2:_ | need1:_:work1:_ ||
|| _:I1:could1:_ | get1:you1:some1:_ | *yay2:_ | _ ||
```

Reading the filled grid: bar 1 opens with a hit on `post`, runs four straight onsets
across beat 1, rests into `eve:ry`, hits `day` on beat 3, then `need _ work` with a
gap. The pickup line `we would just` lives in the prior bar's beat 4, leaning into
the downbeat. The hits (`post`, `day`, `yay`) anchor the bounce; everything else
weaves around them.

### Bracketed: the same filled grid as one lineCombo

Now with the lyric structure layer (§3b) — a single `{combo}` of two `[lines]`, the
second split into two `(lineParts)`. Note the brackets ignore barlines: the combo
opens on the bar-1 pickup and closes mid-bar-3.

```
|| _ | _ | _ | {[we1:would1:just1:_ ||
|| *post1:on1:that1:block1 | _:eve1:ry1:_ | *day2]:_ | [(need1:_:work1):_ ||
|| _:(I1:could1:_ | get1:you1:some1:_ | *yay2)]}:_ | _ ||
```

Structure read-out (metric position is independent of all of this):

```
{ lineCombo
  [ line 1 ]   we would just · post on that block · every · day      (undivided)
  [ line 2 ]
    ( part A )   need _ work
       ‹_ _›     ← caesura: the rests between the halves
    ( part B )   I could _ get you some _ yay
}
```

### Two combos and a trail

A longer passage showing the full structure layer at work — two `{combos}` back to
back, then a `[trail]` (a line sitting *outside* both combos). Lines 1 and the trail
have a silent first half (a blank `[A]`), so they read as undivided; the rest split
into `(A)(B)`. Note the trail opens in the same bar where combo 2 closes, without
crossing it — combo 2 ends on `calls` (beat 1), the trail opens on `aint` (beat 3).

```
|| _ | _ | _:_:{[swear1:_ | I1:used1:to1:_ ||
|| *wait1:_:for2]:_ | _ | _ | _ ||
|| [(*run2:through2:them2:_ | hun2:dreds2:a1:_ | *day1):_:(what1:_ | I1:used1:to1:_ ||
|| *pray1:_:for2)]}:_ | _ | _ | _ ||
|| {[(*I2:know2:they2:_ | mad2:that2:I1:_ | *changed1):_:(aint1:_ | whi1:ppin1:the1:_ ||
|| *same1:_:sauce2)]:_ | _ | _ | _ ||
|| [(*I2:know2:they2:_ | mad2:that2:I1:_ | *changed1):_:(aint1:_ | ma1:kin1:the1:_ ||
|| *same1:_:calls2)]}:_ | _ | _:[aint1:_ | tak1:in1:no1:_ ||
|| *days1:_:off2]:_ | _ | _ | _ ||
```

Structure read-out:

```
{ combo 1
  [ swear I used to wait for ]                                  L1 (blank [A] → undivided)
  [ (run through them hundreds a day)(what I used to pray for) ]  L2
}
{ combo 2
  [ (I know they mad that I changed)(aint whippin the same sauce) ]  L3
  [ (I know they mad that I changed)(aint makin the same calls) ]    L4
}
[ aint takin no days off ]                                      TRAIL (outside both combos)
```

The rhyme that binds all this can now be marked. Below is the same passage as a
**skeleton with rhyme tags** — `=A` / `=B` are the two syllables of the recurring
end-rhyme (`wait·for`, `pray·for`, `same·sauce`, `same·calls`, `days·off`), and `=C`
is the internal rhyme at each `[A]` half (`day`, `changed`, `changed`). The trail's
`=A` / `=B` are tagged by hand (G5) since it sits outside any combo:

```
|| _ | _ | _:_:{[x1:_ | x1:x1:x1:_ ||
|| *x1=A:_:x2=B]:_ | _ | _ | _ ||
|| [(*x2:x2:x2:_ | x2:x2:x1:_ | *x1=C):_:(x1:_ | x1:x1:x1:_ ||
|| *x1=A:_:x2=B)]}:_ | _ | _ | _ ||
|| {[(*x2:x2:x2:_ | x2:x2:x1:_ | *x1=C):_:(x1:_ | x1:x1:x1:_ ||
|| *x1=A:_:x2=B)]:_ | _ | _ | _ ||
|| [(*x2:x2:x2:_ | x2:x2:I1:_ | *x1=C):_:(x1:_ | x1:x1:x1:_ ||
|| *x1=A:_:x2=B)]}:_ | _ | _:[x1:_ | x1:x1:x1:_ ||
|| *x1=A:_:x2=B]:_ | _ | _ | _ ||
```

```
rhyme threads
  A : wait  pray  same  same  days     (1st syllable of the end-rhyme — on the hits)
  B : for   for   sauce calls off      (2nd syllable — the /ɔ/ thread, non-hit onsets)
  C : day   changed     changed        (internal rhyme at the [A] halves)
```

Anatomy of one bar:

```
|| _ | _ | _ | _ ||
^^  ^   ^   ^   ^  ^^
||  b1  b2  b3  b4 ||
open            close
    └─ beats, separated by beatlines ─┘
```

---

## 7. Roadmap (not yet defined)

Declared as *open* — do not assume behavior until specified.

- **tonic / key** — the reference that turns relative pitch (1–7) into actual notes.
  Needed by L7: pitch tags are silent until a tonic + scale/mode are declared.
  *(next candidate)*  *(note: distinct from the `#` anchor, which is rhythmic, not tonal)*
- **rhyme-kind qualifiers** — extra marks on a rhyme tag to specify the *kind*
  (perfect / slant / exact word match), e.g. `=A!`, `=A~`. `!` and `~` are reserved
  for this. *(natural follow-on to the rhyme tag)*
- **octaves & chromaticism** — extend pitch beyond the diatonic `1`–`7` (register
  marks, sharps/flats). Deferred by agreement.
- **grouping** — companion to sustains for nested / irregular rhythms beyond what
  equal slots + holds can express.
- **non-vocal events** — drum hits, instrument notes: occupants other than a vocal
  syllable. (The anchor *references* the instrumental but does not *sound* it.)
- **timbre / sound identity** — *what voice or instrument* delivers an onset.
- **`.` (reserved)** — the dot is set aside for a future feature; undefined for now,
  and not usable as literal text.
- Integration of external documentation (`lineCombo.md`, `callResponse.md`,
  `rhymingWords.md`, ghostwriter/lyricist concepts) to be *refactored into* this
  framework as the structure layer matures.

**Resolved:**
- ~~subdivision~~ — a beat is a container of equal slots, split by `:` (v0.2.0).
- ~~vocal event~~ — a slot can hold a syllable: placeholder `x` or realized text,
  one onset each (v0.3.0).
- ~~tie / sustain~~ — `>` continues an onset across slots and barlines; chainable
  (v0.4.0).
- ~~uneven rhythm~~ — reachable by holding some slots with `>` while articulating
  others, e.g. `x:>:x` (v0.4.0; fully arbitrary ratios still bounded by degree).
- ~~relative pitch~~ — onsets and sustains carry an optional `1`–`7` tag (v0.4.0).
- ~~anchor / skeletons~~ — `#` is a silent reference marking the expected hit;
  resolves to syllable/sustain/rest on realization (v0.5.0).
- ~~hits~~ — `*` prefixes an onset as a vocal accent, independent of the anchor;
  hits + anchor = bounce (v0.6.0).
- ~~lyric structure~~ — `{combo}` / `[line]` / `(linePart)` bracket spans over the
  slot stream, a second hierarchy independent of bars (v0.7.0). Caesura and trails
  fall out for free (§3b).
- ~~rhyme tag~~ — `=A`…`=Z` groups onsets into rhyme threads; binds on the hits,
  trails tagged by hand (v0.8.0). Rhyme *kind* qualifiers deferred.

---

*calileiNotation is a component of calileiStyle. This spec supersedes nothing
external because it depends on nothing external.*
