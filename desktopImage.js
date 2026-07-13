/* =============================================================================
   desktopImage.js — the "image" FILE TYPE (sub-module of desktopPanel)
   -----------------------------------------------------------------------------
   The first pluggable file-type registered against desktopPanel.js's
   sub-registry. It's the reference implementation for adding more file
   types later (text, video, audio, model, etc.) — copy this file's
   shape, change the body of buildIcon / buildWindow, give it its own
   stylesheet, register it under a new type name, and add an import to
   main.js.

   THE CONTRACT (defined in desktopPanel.js)
     registerFileType("image", {
       buildIcon(file)         — returns the inner DOM of the icon
                                  (sits inside the panel's
                                  .desktop-icon-inner slot, 56×48)
       buildWindow(file, win)  — returns the inner DOM of the window's
                                  content area. `win` is a narrow handle:
                                    win.fitToContent(naturalW, naturalH)
                                    win.close()
       defaultWindow: { width, height }
                               — initial window size before fit (and
                                  fallback if fit is never called)
     });

   AUTHORED DATA SHAPE
     { type: "image", name: "vacation",
       src:   "images/base/full/vacation.webp",
       thumb: "images/base/thumb/vacation.webp"   // optional
     }

     Only `name` and `src` are required. `thumb` is optional — if
     present, the icon uses it instead of `src` (saving network +
     decode cost on large images). The WINDOW always uses `src`. Click
     on an icon → the full image loads at that moment. Faithful to an
     image viewer: no metadata fields, just "here's an image, show me."

   FIT-TO-ASPECT
     The image is loaded asynchronously by the browser. On `load`, we
     have naturalWidth/naturalHeight and call win.fitToContent — the
     panel applies its own clamping policy (max ~82% of viewport,
     respect mins, keep title bar in bounds) and resizes accordingly.
     The window starts at defaultWindow size; once the image loads
     (typically within a few hundred ms on cached / local assets), the
     window snaps to image aspect.

   COUPLED WITH
     - desktopPanel.js: imports registerFileType.
     - desktopImageStyles.css: emits the thumbnail + viewer styles
       (.desktop-icon--image .desktop-icon-inner img, .desktop-image-view).
     - main.js: importing this file is what installs the "image" type.
   ========================================================================== */

import { registerFileType } from "./desktopPanel.js";

/* -----------------------------------------------------------------------------
   FILE-TYPE TUNABLES
   --------------------------------------------------------------------------- */

// Initial window size before the image loads. After load, the panel's
// fitToContent resizes to the image's natural aspect. These values are
// the "while we wait" placeholder — chosen to feel like a reasonable
// preview frame on most viewports.
const DEFAULT_WIN_W = 480;
const DEFAULT_WIN_H = 360;

/* -----------------------------------------------------------------------------
   REGISTER WITH THE PANEL
   --------------------------------------------------------------------------- */

registerFileType("image", {

  // The icon's inner DOM. The panel wraps this in .desktop-icon-inner
  // (56×48 slot), so the thumbnail just needs to fill that. object-fit:
  // cover (set in CSS) lets a portrait or landscape image fill the slot
  // without distortion.
  //
  // We use `file.thumb` if the author provided one, otherwise fall back
  // to `file.src` (the full image). Falling back doesn't cause extra
  // load when the window later opens — browsers cache the decoded
  // image, so the window's <img src> reuses the same decoded data.
  // Authoring a separate `thumb` is the optimisation: skip downloading
  // and decoding the full image just to render a 56×48 icon, especially
  // useful when full images are multi-megabyte .webp.
  buildIcon(file) {
    const wrap = document.createElement("div");
    wrap.className = "desktop-image-thumb";

    const img = document.createElement("img");
    img.src = file.thumb || file.src;
    img.alt = file.name || "";
    img.draggable = false;     // prevent native HTML5 drag from competing
                               // with the panel's pointer-based drag
    wrap.appendChild(img);

    return wrap;
  },

  // The window's inner DOM. The panel mounts this into
  // .desktop-window-content. We return an <img> directly (no wrapper
  // needed) sized to fill its container via CSS — object-fit: contain
  // letterboxes if the image's aspect doesn't match the (briefly)
  // pre-fit window.
  //
  // The onload callback is the fit-to-aspect trigger: once the image
  // reports its natural dimensions, we ask the panel to resize the
  // window to match. The panel owns the clamping policy; we just supply
  // the desired (natural) dimensions.
  buildWindow(file, win) {
    const img = document.createElement("img");
    img.className = "desktop-image-view";
    img.alt = file.name || "";
    img.draggable = false;

    img.addEventListener("load", () => {
      // The image is now decoded. naturalWidth/naturalHeight are the
      // raw image dimensions in CSS pixels.
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        win.fitToContent(img.naturalWidth, img.naturalHeight);
      }
    });

    // Set src AFTER attaching the listener so a cached image (which
    // would otherwise fire load synchronously during this microtask)
    // still triggers the fit.
    img.src = file.src;

    return img;
  },

  defaultWindow: {
    width:  DEFAULT_WIN_W,
    height: DEFAULT_WIN_H,
  },
});