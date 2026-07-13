/* =============================================================================
   sidebarContact.js — the "contact" view of the sidebar
   -----------------------------------------------------------------------------
   The work-inquiry view: kicker + display heading, a short intro with a
   direct mailto line, and a three-field transmission form (name / contact /
   message) that relays submissions to my inbox through Formspree.

   WHY FORMSPREE (AND WHY THE ENDPOINT IS SAFE IN CLIENT CODE)
     The site is static — there's no server to receive a POST, and browser
     JS must never hold real mail credentials (anything shipped to the
     client is public). A form-relay endpoint is the standard static-site
     answer: the form POSTs JSON to FORM_ENDPOINT and Formspree forwards it
     to the account inbox. The endpoint ID is public-by-design — it can only
     cause mail to be SENT TO me, never read anything — so exposing it here
     is fine. Spam is filtered server-side; the hidden _gotcha honeypot
     field feeds that filter (bots fill it, humans never see it).

   STATE TABLE (per visualLanguage.md's state grammar — states first)
     | state   | color | motion                        | announcement          |
     |---------|-------|-------------------------------|-----------------------|
     | idle    | blue  | activity register on the rule | —                     |
     | missing | red   | register off, field shake     | / FIELDS.REQUIRED     |
     | sending | blue  | register off, readout pulse   | / MSG.SENDING         |
     | sent    | green | register off                  | / MSG.SENT            |
     | failed  | red   | register off                  | / SEND.FAILED · RETRY |

     JS toggles one state class on the <form>; all copy and color live in
     the stylesheet (::before content), mirroring the shop gate's pattern —
     the JS mutates state, never wording. "missing" and "failed" are both
     warn-red: one meaning (rejection / fault), and red is never used as an
     index in this component, so the semantics stay single-purpose.

   LIFECYCLE / ANIMATION SCOPING
     The scramble + hover-wave layering (rules in textAnimation.md) runs on
     the HEAD ONLY — title and intro copy. The form is deliberately outside
     the animated subtree: startScramble rebuilds text nodes into spans,
     which must never touch live inputs, and onEnter re-fires on every
     sidebar reveal (per sidebar.md), which would re-scramble over a
     visitor's draft. Because buildDOM runs exactly once, a half-typed
     draft survives closing and reopening the sidebar for free.

     The ambient activity register is gated on an `is-live` class the
     lifecycle hooks toggle on the view root — the shell exposes no
     visibility class, so the hooks are the visibility signal. A hidden
     view animates nothing.

     A submission in flight is NOT cancelled on view exit — the message
     should still send. The fetch resolves against the hidden, persistent
     DOM; the result state greets the visitor on their next reveal.

   COUPLED WITH
     - sidebarContactStyles.css: emits .sidebar-view-contact and inner
       classes; owns all state copy and color.
     - main.js: imports `contactView` and includes it in initSidebar.
     - textScramble.js / textHoverWave.js / cancels.js: head animation.
     - Formspree (external): FORM_ENDPOINT below relays to the inbox.
   ========================================================================== */

import { startScramble }     from "./textScramble.js";
import { startHoverWave }    from "./textHoverWave.js";
import { createCancelGroup } from "./cancels.js";

/* -----------------------------------------------------------------------------
   RELAY + CONTENT CONSTANTS
   --------------------------------------------------------------------------- */

/* The Formspree relay endpoint. Managed in the Formspree dashboard;
   swapping providers later means changing this URL and the payload shape
   in wireForm — nothing else. */
const FORM_ENDPOINT = "https://formspree.io/f/xjgqlprw";

/* The address displayed on the page and used for the mailto line.
   ⚠ PLACEHOLDER — swap in the real address. One edit; the DOM derives
   both the href and the visible text from this constant. */
const CONTACT_EMAIL = "kaminoko.jp@proton.me";

/* Subject line Formspree stamps on the relayed email. */
const MAIL_SUBJECT = "// CALILEI.CONTACT — new transmission";

/* Loose-but-real email shape check for the reply-to convenience: if the
   visitor's CONTACT line parses as an email it's passed as Formspree's
   _replyto, so replying in a mail client goes straight back to them.
   Anything that doesn't parse is simply skipped — a malformed _replyto
   would make the whole submission bounce, and CONTACT is free-text by
   design (phone numbers welcome). */
const EMAIL_RE = /^\S+@\S+\.\S+$/;

/* -----------------------------------------------------------------------------
   ANIMATION STATE
   -----------------------------------------------------------------------------
   One cancels group holds the head's entry + hover cancels (four entries
   during a view session). Insertion order is significant: scrambles first,
   hovers second, so cancelAll restores the text nodes before the hover
   layer removes its listeners. Full layering rationale: textAnimation.md.
   --------------------------------------------------------------------------- */

const cancels = createCancelGroup();

// Wave radius for the hover layer. Smaller than the primitive's default
// reads as focal/subtle — suits permanent copy next to a working form.
const HOVER_WAVE_RADIUS = 5;

/* -----------------------------------------------------------------------------
   THE FORM — wiring, validation, transmission
   -----------------------------------------------------------------------------
   Called once from buildDOM. All state transitions funnel through
   setState, which swaps exactly one state class on the <form>; the
   stylesheet owns what each state looks and reads like.
   --------------------------------------------------------------------------- */

const STATE_CLASSES = ["is-missing", "is-sending", "is-sent", "is-failed"];

function wireForm(form) {
  const button = form.querySelector(".sidebar-contact-send");
  const gotcha = form.querySelector(".sidebar-contact-gotcha");
  const fields = {
    name:    form.querySelector('[data-field="name"]'),
    contact: form.querySelector('[data-field="contact"]'),
    message: form.querySelector('[data-field="message"]'),
  };
  const inputOf = (wrap) => wrap.querySelector("input, textarea");

  let isSending = false; // guards double-submit alongside the disabled button

  function setState(state) {
    form.classList.remove(...STATE_CLASSES);
    if (state) form.classList.add(state);
  }

  /* Any edit clears the field's own warn mark and returns the instrument
     to idle from a terminal state (missing / sent / failed) — the readout
     never lingers over fresh input. This can't fire mid-send: the fields
     are readonly while is-sending. */
  Object.values(fields).forEach((wrap) => {
    inputOf(wrap).addEventListener("input", () => {
      wrap.classList.remove("is-missing");
      setState(null);
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isSending) return;

    const values = {};
    for (const [key, wrap] of Object.entries(fields)) {
      values[key] = inputOf(wrap).value.trim();
    }

    /* --- validate: all three fields required ----------------------------- */
    const missing = Object.entries(fields).filter(([key]) => !values[key]);
    if (missing.length) {
      missing.forEach(([, wrap]) => {
        // Re-trigger the shake on consecutive rejected submits: drop the
        // class, force a reflow, re-add — otherwise the keyframes only
        // play the first time the class appears. (Same trick as the gate.)
        wrap.classList.remove("is-missing");
        void wrap.offsetWidth;
        wrap.classList.add("is-missing");
      });
      setState("is-missing");
      inputOf(missing[0][1]).focus();
      return;
    }

    /* --- transmit --------------------------------------------------------- */
    isSending = true;
    setState("is-sending");
    button.disabled = true;
    // Lock the draft during flight: the payload is already captured, so
    // edits mid-send would silently diverge from what actually transmitted.
    Object.values(fields).forEach((w) => inputOf(w).setAttribute("readonly", ""));

    const payload = {
      name:     values.name,
      contact:  values.contact,
      message:  values.message,
      _subject: MAIL_SUBJECT,
      _gotcha:  gotcha.value, // honeypot — humans leave it empty
    };
    if (EMAIL_RE.test(values.contact)) payload._replyto = values.contact;

    try {
      const res = await fetch(FORM_ENDPOINT, {
        method:  "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`relay responded ${res.status}`);

      // Clear the draft only on confirmed success — a failed transmission
      // must never eat the visitor's message.
      Object.values(fields).forEach((w) => (inputOf(w).value = ""));
      setState("is-sent");
    } catch {
      setState("is-failed"); // draft intact; the readout invites a retry
    } finally {
      isSending = false;
      button.disabled = false;
      Object.values(fields).forEach((w) => inputOf(w).removeAttribute("readonly"));
    }
  });
}

/* -----------------------------------------------------------------------------
   THE VIEW
   --------------------------------------------------------------------------- */

export const contactView = {
  name: "contact",

  buildDOM(nav) {
    const el = document.createElement("div");
    el.className = "sidebar-view-contact";
    el.innerHTML = `
      <div class="sidebar-contact-head">
        <div class="sidebar-contact-kicker">// OPEN.FOR.WORK</div>
        <h2 class="sidebar-contact-title">CONTACT.ME\\</h2>
        <div class="sidebar-contact-copy">
          <p>
            > The channel is live.
          </p>
          <p>
            - COMMISSIONS
            <br>
            - COLLABORATIONS
            <br>
            - CONTRACT.WORK
          </p>
          <p>
            > If you want to build something,
            <br>
            > I want to hear about it.
          </p>  
          <p class="sidebar-contact-mailline">
            <span class="sidebar-contact-prompt" aria-hidden="true">/&gt;</span>
            mail: <a class="sidebar-contact-mail"
                     href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
          </p>
        </div>
      </div>

      <form class="sidebar-contact-form" novalidate>
        <div class="sidebar-contact-field" data-field="name">
          <label class="sidebar-contact-label" for="sidebar-contact-name">/ 01 · NAME</label>
          <input class="sidebar-contact-input" id="sidebar-contact-name" name="name"
                 type="text" autocomplete="name" spellcheck="false"
                 placeholder="who's transmitting" />
        </div>

        <div class="sidebar-contact-field" data-field="contact">
          <label class="sidebar-contact-label" for="sidebar-contact-contact">/ 02 · CONTACT</label>
          <input class="sidebar-contact-input" id="sidebar-contact-contact" name="contact"
                 type="text" autocomplete="email" spellcheck="false"
                 placeholder="email / phone" />
        </div>

        <div class="sidebar-contact-field" data-field="message">
          <label class="sidebar-contact-label" for="sidebar-contact-message">/ 03 · MESSAGE</label>
          <textarea class="sidebar-contact-area" id="sidebar-contact-message" name="message"
                    rows="6" placeholder="what are we building?"></textarea>
        </div>

        <input class="sidebar-contact-gotcha" type="text" name="_gotcha"
               tabindex="-1" autocomplete="off" aria-hidden="true" />

        <div class="sidebar-contact-rule"><span class="sidebar-contact-scan"></span></div>

        <div class="sidebar-contact-foot">
          <button class="sidebar-contact-send" type="submit">[ TRANSMIT > ]</button>
          <div class="sidebar-contact-status" aria-live="polite"></div>
        </div>
      </form>
    `;

    wireForm(el.querySelector(".sidebar-contact-form"));
    return el;
  },

  onEnter(el) {
    // Visibility signal for CSS ambients: the rule's activity register
    // runs only while .is-live, so the hidden view animates nothing.
    el.classList.add("is-live");

    cancels.cancelAll();
    const title = el.querySelector(".sidebar-contact-title");
    const copy  = el.querySelector(".sidebar-contact-copy");

    // Scrambles registered first → tick first each frame → produce the
    // baseline color that hover then overrides for chars near the cursor.
    // (Layering + cancel-order rationale: textAnimation.md.)
    if (title) cancels.add(startScramble(title));
    if (copy)  cancels.add(startScramble(copy));

    if (title) cancels.add(startHoverWave(title, { waveRadius: HOVER_WAVE_RADIUS }));
    if (copy)  cancels.add(startHoverWave(copy,  { waveRadius: HOVER_WAVE_RADIUS }));
  },

  onExit(el) {
    el.classList.remove("is-live");
    cancels.cancelAll();
  },
};