/* =============================================================================
   desktopMd.js — the "md" FILE TYPE (sub-module of desktopPanel)
   -----------------------------------------------------------------------------
   A Markdown SOURCE reader/editor — the VSCode "view the raw .md" experience,
   not a rendered preview. Lines are numbered in a gutter; the markdown symbols
   (#, **, `, >, -, [](), ```) stay visible and get colored by what they are.
   Bold text doesn't become bold-rendered text — it becomes `**text**` with the
   asterisks dimmed and the inner text tinted. You're always looking at source.

   WHY THIS ISN'T JUST desktopNote
     desktopNote is one <textarea>. A textarea renders uniform text — it cannot
     color individual spans inside itself. To get per-token color AND keep the
     surface editable with no framework, this uses the standard vanilla trick:
     a transparent <textarea> stacked over a <pre> "highlight backdrop".

       .desktop-md  (position: relative; the editor surface)
        ├ ::before                        → fixed line-number gutter strip
        ├ <pre> .desktop-md-highlight     → colored <span> tokens (what you SEE),
        │   └ <div class="md-line">…       one block per logical line; a CSS
        │                                  counter paints its number into the strip
        └ <textarea> .desktop-md-input    → the real editor (color: transparent,
                                            caret-color visible)

     The textarea stays the source of truth and the only interactive layer; its
     glyphs are transparent so the colored <pre> behind shows through. The caret
     and selection still paint (caret via caret-color, selection via ::selection).
     On every keystroke we re-tokenize value → per-line blocks and rebuild the
     <pre>. On scroll we mirror the textarea's scrollTop onto the backdrop, so the
     colored glyphs (and the line numbers, which live on the line blocks) stay
     under the caret.

   WRAPPING + LINE NUMBERS (why the numbers ride on the line blocks)
     Long lines soft-wrap like VSCode: a logical line spilling onto several visual
     rows keeps ONE number, aligned to its first row, and the next number drops
     down by however many rows it took. The trick that makes this exact with no
     measurement: each logical line is its own <div class="md-line"> that wraps
     independently, and its number is drawn by a CSS counter via ::before in the
     gutter strip. Because the number is physically part of the line's box, it
     can never drift from the line however the text wraps. The textarea and the
     backdrop wrap at identical points because they share width, padding, font
     metrics, and wrap rules (and the textarea's scrollbar is hidden, so it does
     not steal width and wrap earlier than the backdrop).

   ALIGNMENT IS THE WHOLE GAME
     The backdrop only lines up with the textarea if they share *identical* text
     metrics: same font-family, font-size, line-height, letter-spacing, tab-size,
     padding, and wrapping rules. The editor uses "Glitched" — the project's own
     monospaced family — so the cells stay fixed-width, and the CSS sets those
     properties on both layers explicitly (see desktopMdStyles.css). A
     proportional font would drift the two layers apart character by character.

   PERSISTENCE  (identical model to desktopNote)
     Typed content writes back to `file.content` on every input. Because `file`
     is the live item record (mutable, distinct from authored data), edits
     persist across closing/reopening the window and scrolling away and back —
     but NOT across page reload (project convention: no localStorage). A `src`
     file is fetched once on first open and its text copied into file.content;
     from then on it behaves exactly like inline content (edits persist for the
     session, reopening does not re-fetch). A page reload re-fetches from disk.

   NO fitToContent, NO lifecycle hooks
     Markdown has no inherent aspect ratio, so we never call win.fitToContent.
     Every listener attached here lives on an element inside the returned
     subtree, so it's garbage-collected when the window's DOM is destroyed —
     nothing to clean up, so onClose/onMinimize/onRestore go unused.

   AUTHORED DATA SHAPE
     Inline:    { type: "md", name: "README", content: "# Title\n\n**bold**" }
     From file: { type: "md", name: "test",   src: "assets/md/test.md" }
     `name` is required. Provide EITHER `content` (inline source) OR `src` (a
     path to a .md file fetched when the window first opens); if both are given,
     `content` wins. With neither, the editor opens empty. Optional `lineColor` /
     `fillColor` retint the icon glyph (the page outline + body) like any type.

   COUPLED WITH
     - desktopPanel.js: imports registerFileType (the ONLY thing it imports).
     - desktopMdStyles.css: emits .desktop-md-glyph + the editor/token styles.
     - index.html: <link> to desktopMdStyles.css.
     - main.js: importing this file is what installs the "md" type.
   ========================================================================== */

import { registerFileType } from "./desktopPanel.js";

/* -----------------------------------------------------------------------------
   FILE-TYPE TUNABLES
   --------------------------------------------------------------------------- */

// Starting window size before the user resizes. A touch larger than note —
// source with line numbers wants a bit more room to breathe.
const DEFAULT_WIN_W = 560;
const DEFAULT_WIN_H = 420;

// Spaces inserted when the user presses Tab inside the editor. Two keeps lines
// from marching off the right edge fast; matches the editor's tab-size in CSS.
const TAB_SPACES = "  ";

/* -----------------------------------------------------------------------------
   HTML ESCAPING
   -----------------------------------------------------------------------------
   The backdrop is built with innerHTML from user-typed text, so every literal
   character the user types MUST be escaped before it lands in the markup — both
   to render correctly (a typed "<" should show as "<", not open a tag) and so
   the editor can't be turned into an HTML-injection surface by its own content.
   We escape into token text only; the <span> wrappers we add ourselves are the
   only real markup in the output.
   --------------------------------------------------------------------------- */

function esc(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* -----------------------------------------------------------------------------
   INLINE TOKENIZER
   -----------------------------------------------------------------------------
   Scans a single line segment left-to-right into [class, text] tokens. We scan
   the RAW string (not the escaped one) so the regexes match real characters,
   then escape each token's text at emit time. Order matters: code spans first
   (their contents are literal — no markup inside), then images, links, bold,
   italic. Bold (`**` or `__`) is tried before italic (`*` or `_`) so a "**x**"
   isn't eaten as two italics. Anything with no match is consumed as a plain text
   run up to the next special character, which keeps the span count low.

   `baseClass` colors the plain text runs: "" for body (default ink, emitted
   bare with no span), "head" inside headings, "quote" inside blockquotes. Inline
   constructs (code/link/bold/italic) keep their own color regardless of base, so
   an inline `code` span inside a heading still reads as code — exactly the
   VSCode source behavior.
   --------------------------------------------------------------------------- */

const RE_CODE  = /^`([^`]+)`/;
const RE_IMG   = /^!\[([^\]]*)\]\(([^)]*)\)/;
const RE_LINK  = /^\[([^\]]*)\]\(([^)]*)\)/;
const RE_BOLD  = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/;
const RE_ITAL  = /^(\*|_)(?=\S)([^*_]+?)\1/;
const RE_NEXT  = /[`*_\[\]!]/; // characters that can begin an inline construct

function inlineTokens(s, baseClass) {
  const out = [];
  const pushText = (t) => { if (t) out.push([baseClass, t]); };

  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m;

    if ((m = RE_CODE.exec(rest))) {
      out.push(["marker", "`"], ["code", m[1]], ["marker", "`"]);
      i += m[0].length; continue;
    }
    if ((m = RE_IMG.exec(rest))) {
      out.push(["marker", "!["], ["link", m[1]], ["marker", "]("], ["url", m[2]], ["marker", ")"]);
      i += m[0].length; continue;
    }
    if ((m = RE_LINK.exec(rest))) {
      out.push(["marker", "["], ["link", m[1]], ["marker", "]("], ["url", m[2]], ["marker", ")"]);
      i += m[0].length; continue;
    }
    if ((m = RE_BOLD.exec(rest))) {
      out.push(["marker", m[1]], ["strong", m[2]], ["marker", m[1]]);
      i += m[0].length; continue;
    }
    if ((m = RE_ITAL.exec(rest))) {
      out.push(["marker", m[1]], ["em", m[2]], ["marker", m[1]]);
      i += m[0].length; continue;
    }

    // No construct here: take a plain run up to the next candidate character.
    // Skip the current char first so a lone unmatched "*" doesn't loop forever.
    let next = rest.slice(1).search(RE_NEXT);
    const take = next === -1 ? rest.length : next + 1;
    pushText(rest.slice(0, take));
    i += take;
  }
  return out;
}

/* -----------------------------------------------------------------------------
   EMIT — tokens → HTML
   -----------------------------------------------------------------------------
   Merges adjacent same-class tokens into one span (fewer DOM nodes), escapes
   text, and wraps non-default classes in <span class="md-tok-CLASS">. The empty
   base class ("") for ordinary body text is emitted bare so default text just
   inherits --md-text — no span needed for the common case.
   --------------------------------------------------------------------------- */

function emit(tokens) {
  let html = "";
  let i = 0;
  while (i < tokens.length) {
    const cls = tokens[i][0];
    let text = tokens[i][1];
    // Coalesce a run of the same class.
    let j = i + 1;
    while (j < tokens.length && tokens[j][0] === cls) { text += tokens[j][1]; j++; }
    i = j;

    const safe = esc(text);
    html += cls ? `<span class="md-tok-${cls}">${safe}</span>` : safe;
  }
  return html;
}

/* -----------------------------------------------------------------------------
   BLOCK TOKENIZER
   -----------------------------------------------------------------------------
   Line-oriented. Each line is classified by its leading syntax, the markers are
   colored, and the remainder is handed to the inline tokenizer. Fenced code
   blocks (``` or ~~~) toggle a "raw" mode in which interior lines are colored
   wholesale as code with no inline parsing — matching how a fenced block reads
   in source.
   --------------------------------------------------------------------------- */

const RE_FENCE   = /^(\s*)(`{3,}|~{3,})(.*)$/;
const RE_HEADING = /^(\s*)(#{1,6})(\s+)(.*)$/;
const RE_QUOTE   = /^(\s*)(>+)(\s?)(.*)$/;
const RE_HR      = /^(\s*)(-{3,}|\*{3,}|_{3,})\s*$/;
const RE_LIST    = /^(\s*)([-*+]|\d+\.)(\s+)(.*)$/;

function span(cls, text) {
  return `<span class="md-tok-${cls}">${esc(text)}</span>`;
}

function tokenizeBlock(value) {
  const lines = value.split("\n");
  let inFence = false;
  const htmlLines = [];

  for (const line of lines) {
    const fence = RE_FENCE.exec(line);

    // A fence line both toggles the mode and is itself drawn as a marker line
    // (the ``` plus any info string like "```js").
    if (fence) {
      inFence = !inFence;
      htmlLines.push(esc(fence[1]) + span("marker", fence[2] + fence[3]));
      continue;
    }

    // Inside a fenced block: whole line is code, no inline parsing.
    if (inFence) {
      htmlLines.push(span("code", line));
      continue;
    }

    let m;
    if ((m = RE_HEADING.exec(line))) {
      // indent + (### marker) + space + heading text (inline-parsed, head-tinted)
      htmlLines.push(esc(m[1]) + span("marker", m[2]) + esc(m[3]) + emit(inlineTokens(m[4], "head")));
      continue;
    }
    if ((m = RE_HR.exec(line))) {
      htmlLines.push(esc(m[1]) + span("marker", line.trimStart()));
      continue;
    }
    if ((m = RE_QUOTE.exec(line))) {
      htmlLines.push(esc(m[1]) + span("marker", m[2]) + esc(m[3]) + emit(inlineTokens(m[4], "quote")));
      continue;
    }
    if ((m = RE_LIST.exec(line))) {
      htmlLines.push(esc(m[1]) + span("marker", m[2]) + esc(m[3]) + emit(inlineTokens(m[4], "")));
      continue;
    }

    // Ordinary paragraph line.
    htmlLines.push(emit(inlineTokens(line, "")));
  }

  // One entry per logical line. The caller wraps each in its own block element
  // so it can wrap independently and carry its own line number (see render()).
  return htmlLines;
}

/* -----------------------------------------------------------------------------
   REGISTER WITH THE PANEL
   --------------------------------------------------------------------------- */

registerFileType("md", {

  // The icon's inner DOM. A folded page (same silhouette as the note glyph so
  // the two read as the same family of "document") overprinted with a "#" so a
  // glance distinguishes markdown from a plain note. The page outline uses
  // currentColor (so authored lineColor tints it) and the body is marked
  // desktop-glyph-fill (so fillColor tints it); the "#" is a fixed accent so it
  // always signals "markdown" regardless of icon tint.
  buildIcon(_file) {
    const wrap = document.createElement("div");
    wrap.className = "desktop-md-glyph";
    wrap.innerHTML = `
      <svg viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M3 3 H22 L33 14 V41 H3 Z"
              class="desktop-glyph-fill"
              stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        <path d="M22 3 V14 H33"
              stroke="currentColor" stroke-width="1.2"
              fill="none" stroke-linejoin="round" />
        <!-- "#" hash mark, fixed accent so the markdown affordance is constant -->
        <g stroke="#ff5a1f" stroke-width="1.6" stroke-linecap="round">
          <line x1="14" y1="22" x2="12.5" y2="37" />
          <line x1="22" y1="22" x2="20.5" y2="37" />
          <line x1="9"  y1="27" x2="26" y2="27" />
          <line x1="8"  y1="32" x2="25" y2="32" />
        </g>
      </svg>
    `;
    return wrap;
  },

  // The window's inner DOM. Builds the backdrop + transparent textarea described
  // in the file header (the gutter is a CSS strip, not an element). Returns the
  // .desktop-md root; the panel mounts it into .desktop-window-content (which it
  // sizes to 100% × 100%, position: relative).
  buildWindow(file, _win) {
    const root = document.createElement("div");
    root.className = "desktop-md";

    // The backdrop (colored, behind) and the transparent textarea (the real
    // editor, on top) stack directly in the root. The line-number gutter is no
    // longer a separate column: it's a fixed CSS strip (.desktop-md::before)
    // with the numbers themselves drawn per-line via a CSS counter (see the
    // stylesheet). That keeps every number physically attached to its own line
    // box, so it stays correct however the line wraps.
    const pre = document.createElement("pre");
    pre.className = "desktop-md-highlight";
    pre.setAttribute("aria-hidden", "true");
    const code = document.createElement("code");
    pre.appendChild(code);

    const ta = document.createElement("textarea");
    ta.className = "desktop-md-input";
    ta.value = "";                  // filled below from `content` or fetched `src`
    ta.spellcheck = false;
    ta.setAttribute("autocomplete", "off");
    ta.setAttribute("autocapitalize", "off");
    ta.setAttribute("autocorrect", "off");
    ta.setAttribute("wrap", "soft"); // soft-wrap: long lines wrap, value keeps no
                                     // inserted newlines (logical lines preserved)

    root.appendChild(pre);
    root.appendChild(ta);

    // ---- render: rebuild the backdrop from the current value ----
    // Each logical line becomes its own <div class="md-line">. The CSS counter
    // on those divs paints the line numbers, and because a wrapped line's div
    // simply grows taller, the next number drops down by however many rows it
    // took — exactly the VSCode behavior. No height measurement needed: the
    // browser does the wrapping and the numbers ride along with their lines.
    const render = () => {
      const lines = tokenizeBlock(ta.value);   // one HTML string per logical line
      let out = "";
      for (let i = 0; i < lines.length; i++) {
        out += '<div class="md-line">' + lines[i] + "</div>";
      }
      code.innerHTML = out;
    };

    // ---- sync: render + persist ----
    // The edit path (input, Tab, resolved load). Writes back into the live item
    // record so the content survives close/reopen within the session.
    const sync = () => {
      render();
      file.content = ta.value;
    };

    // ---- scroll mirroring ----
    // The textarea is the only element that scrolls. Mirror its vertical offset
    // onto the backdrop so the colored glyphs (and the per-line numbers, which
    // live in the backdrop) stay under the caret. With wrapping there is no
    // horizontal scroll, so only scrollTop needs mirroring.
    const onScroll = () => {
      pre.scrollTop = ta.scrollTop;
    };

    ta.addEventListener("input", sync);
    ta.addEventListener("scroll", onScroll);

    // ---- Tab inserts indent instead of leaving the field ----
    // Expected in a code editor. Cost: you can't Tab out by keyboard while the
    // textarea is focused (click elsewhere instead). We mutate value around the
    // selection, restore the caret, and run the same sync + scroll path so the
    // backdrop and persistence stay consistent with the manual-typing path.
    ta.addEventListener("keydown", (e) => {
      if (e.key !== "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = ta.value.slice(0, start) + TAB_SPACES + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + TAB_SPACES.length;
      sync();
      onScroll();
    });

    // ---- content source: inline `content`, else external `src` ----
    // Inline `content` (or content already loaded/edited earlier this session)
    // wins and shows synchronously. Otherwise, if `src` is a path to a .md file,
    // fetch it once: the editor opens read-only and empty, then fills when the
    // request resolves. The loaded text is copied into file.content, so from
    // that point it behaves exactly like inline content — edits persist for the
    // session and reopening the window does NOT re-fetch. We deliberately leave
    // file.content unset until the fetch resolves, so closing the window before
    // it lands doesn't poison a reopen with an empty string (a reopen re-fetches).
    if (typeof file.content === "string") {
      ta.value = file.content;
      sync();
      onScroll();
    } else if (file.src) {
      ta.readOnly = true;           // lock the soon-to-be-overwritten buffer
      onScroll();                   // mirror initial scroll (no persist yet)
      fetch(file.src)
        .then((res) => {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.text();
        })
        .then((text) => {
          ta.readOnly = false;
          ta.value = text;
          sync();                   // render + persist the loaded text
          onScroll();
        })
        .catch((err) => {
          // Show the failure in-editor via render() only — NOT sync() — so the
          // error text isn't written to file.content and a reopen re-fetches.
          ta.readOnly = false;
          ta.value = "<!-- could not load " + file.src + " — " + err.message + " -->\n";
          render();
          onScroll();
        });
    } else {
      // Neither content nor src: an empty editor.
      sync();
      onScroll();
    }

    return root;
  },

  defaultWindow: {
    width:  DEFAULT_WIN_W,
    height: DEFAULT_WIN_H,
  },
});
