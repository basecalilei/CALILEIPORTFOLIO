/* =============================================================================
   desktopNote.js — the "note" FILE TYPE (sub-module of desktopPanel)
   -----------------------------------------------------------------------------
   The second pluggable file-type registered against desktopPanel.js. A
   minimal Windows-Notepad-style text file: the icon is a small page-with-
   lines glyph; the window opens a textarea that the user can type into.

   PERSISTENCE
     Typed content writes back to `file.content` on every input event.
     Because `file` is the live item state (mutable, distinct from the
     authored data), edits persist across:
       - closing and reopening the window in the same session
       - scrolling away from the desktop panel and back
     Edits DO NOT persist across page reload — by project convention
     (no localStorage), authored data is the only initial state and
     refreshing returns to it.

   COPYING THE SHAPE TO A NEW FILE-TYPE
     Use this file (or desktopImage.js) as a template. Steps:
       1. Pick a type name (registered via registerFileType("<name>", ...)).
       2. buildIcon — return the inner DOM of the icon, sized to fit the
          panel's .desktop-icon-inner slot (56×48).
       3. buildWindow — return the inner DOM of the window content area.
          The second argument is a narrow handle:
            win.fitToContent(naturalW, naturalH)  — request size
            win.close()                            — programmatic close
          For types whose content has an inherent aspect (image, video),
          use fitToContent. For types without (notes, text), skip it.
       4. defaultWindow — optional starting size.
       5. Create a matching <name>Styles.css, link in index.html, import
          in main.js.

   AUTHORED DATA SHAPE
     { type: "note", name: "readme", content: "Hello!" }

     Only `name` and `content` are required. content defaults to "" if
     not authored. spreadTypeFields (in desktopPanel.js) copies content
     into the live item state.

   COUPLED WITH
     - desktopPanel.js: imports registerFileType.
     - desktopNoteStyles.css: emits .desktop-note-glyph and the textarea
       styles (.desktop-note-area).
     - main.js: importing this file is what installs the "note" type.
   ========================================================================== */

import { registerFileType } from "./desktopPanel.js";

/* -----------------------------------------------------------------------------
   FILE-TYPE TUNABLES
   --------------------------------------------------------------------------- */

// Default window size on first open. Notepad-style aspect: slightly
// wider than tall, room for ~50 monospace columns and a few lines.
const DEFAULT_WIN_W = 480;
const DEFAULT_WIN_H = 340;

/* -----------------------------------------------------------------------------
   REGISTER WITH THE PANEL
   --------------------------------------------------------------------------- */

registerFileType("note", {

  // The icon's inner DOM. A page-with-lines glyph rendered as inline SVG
  // — single DOM node, no external asset dependency. Uses currentColor
  // for stroke + line ink so the panel's .desktop-icon-inner colour
  // rule (warm off-white at rest, --accent during drop-candidate
  // highlight) applies uniformly.
  buildIcon(_file) {
    const wrap = document.createElement("div");
    wrap.className = "desktop-note-glyph";
    wrap.innerHTML = `
      <svg viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <!-- Page with a folded top-right corner. The notch reads as the
             classic "document with corner-fold" file affordance. The
             body path is marked desktop-glyph-fill so --icon-fill (from
             the authored fillColor) tints the page interior; without an
             authored fillColor the CSS fallback keeps the original
             barely-there white. -->
        <path d="M3 3 H22 L33 14 V41 H3 Z"
              class="desktop-glyph-fill"
              stroke="currentColor" stroke-width="1.5"
              stroke-linejoin="round" />
        <path d="M22 3 V14 H33"
              stroke="currentColor" stroke-width="1.2"
              fill="none" stroke-linejoin="round" />
        <!-- Text lines inside the page. Last line is short, like a
             paragraph's tail. -->
        <line x1="9"  y1="22" x2="27" y2="22" stroke="currentColor" stroke-width="1" opacity="0.55" />
        <line x1="9"  y1="27" x2="27" y2="27" stroke="currentColor" stroke-width="1" opacity="0.55" />
        <line x1="9"  y1="32" x2="27" y2="32" stroke="currentColor" stroke-width="1" opacity="0.55" />
        <line x1="9"  y1="37" x2="21" y2="37" stroke="currentColor" stroke-width="1" opacity="0.55" />
      </svg>
    `;
    return wrap;
  },

  // The window's inner DOM. A plain textarea that fills the content
  // area. Two-way bound to file.content via the input event — every
  // keystroke writes back to the live item state. On reopen the
  // textarea is rebuilt from file.content, so the user sees their
  // last edit (within the session).
  //
  // We don't use the `win` handle here — notes have no inherent
  // aspect, so we don't call fitToContent. The defaultWindow below
  // gives the user a reasonable starting frame they can resize.
  buildWindow(file, _win) {
    const ta = document.createElement("textarea");
    ta.className = "desktop-note-area";
    ta.value = file.content || "";
    ta.placeholder = "";
    ta.spellcheck = false;

    // Persist typed content into the live item. file IS the item
    // record from state.items, so this mutation is read by the next
    // open of the same item.
    ta.addEventListener("input", () => {
      file.content = ta.value;
    });

    return ta;
  },

  defaultWindow: {
    width:  DEFAULT_WIN_W,
    height: DEFAULT_WIN_H,
  },
});