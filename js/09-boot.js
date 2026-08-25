// ============================================================
// 09-boot.js
// boot: a11y roving-tabindex keyboard nav for tab lists
// Part of the Portfolio Tracker app. Loaded as an ordered plain
// <script> (shared global scope) - order matters, see index.html.
// ============================================================
// ---- a11y: roving-tabindex keyboard nav for tab lists ----
/* a11y: roving-tabindex keyboard nav for tab lists */
(function () {
  "use strict";
  function wire(list) {
    const tabs = [].slice.call(list.querySelectorAll('[role="tab"]'));
    if (!tabs.length) return;
    list.addEventListener("keydown", function (e) {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let j = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown")
        j = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
        j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = tabs.length - 1;
      else return;
      e.preventDefault();
      tabs[j].focus();
      tabs[j].click();
    });
  }
  function sync(list) {
    const tabs = [].slice.call(list.querySelectorAll('[role="tab"]'));
    tabs.forEach(function (t) {
      const on = t.classList.contains("active");
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
  }
  document.addEventListener("DOMContentLoaded", function () {
    [].slice
      .call(document.querySelectorAll('[role="tablist"]'))
      .forEach(function (list) {
        wire(list);
        sync(list);
        list.addEventListener("click", function () {
          setTimeout(function () {
            sync(list);
          }, 0);
        });
      });
  });
})();

// ============================================================
// v2: delegated action dispatcher (modern event handling).
//
// A single document-level click listener handles any element carrying a
// data-act attribute, calling the named function on window with parsed
// data-args. UI uses data-act attributes instead of inline handlers; this is
// the forward-looking mechanism (one listener, no per-element wiring,
// CSP-friendly).
//
// data-args is comma-separated; JSON-ish coercion: numbers -> Number, true/false
// -> boolean, quoted strings -> string, else raw string.
// ============================================================
// Convention used across the generated HTML (replaces inline handlers):
//   data-act=NAME                function to call (looked up on window)
//   data-args="a,b,c"            literal args; coerced (number/bool/null/string)
//   special arg tokens:
//     $el       -> the element itself (was inline `this`)
//     $checked  -> element.checked   (was `this.checked`)
//     $value    -> element.value
//   data-stop="true"             call e.stopPropagation() (nested clickables)
//   data-on="change"             bind on change instead of click (inputs)
// Legacy inline on* handlers still work; this is the primary mechanism now.
(function () {
  "use strict";
  function coerce(s) {
    s = String(s).trim();
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (
      (s[0] === '"' && s[s.length - 1] === '"') ||
      (s[0] === "'" && s[s.length - 1] === "'")
    )
      return s.slice(1, -1);
    return s;
  }
  function parseArgs(raw, el) {
    if (raw == null || raw === "") return [];
    return String(raw)
      .split(",")
      .map((a) => {
        const t = a.trim();
        if (t === "$el") return el;
        if (t === "$checked") return !!el.checked;
        if (t === "$value") return el.value;
        return coerce(t);
      });
  }
  function dispatch(e, evtType) {
    const el =
      e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if (!el) return;
    if (el.getAttribute("data-on") && el.getAttribute("data-on") !== evtType)
      return;
    if (!el.getAttribute("data-on") && evtType !== "click") return;
    const fnName = el.getAttribute("data-act");
    const fn = window[fnName];
    if (typeof fn !== "function") return;
    if (el.getAttribute("data-stop") === "true") e.stopPropagation();
    if (el.tagName === "A" && el.getAttribute("href") === "#")
      e.preventDefault();
    try {
      fn.apply(null, parseArgs(el.getAttribute("data-args"), el));
    } catch (err) {
      console.error("action '" + fnName + "' failed:", err);
    }
  }
  document.addEventListener("click", (e) => dispatch(e, "click"));
  document.addEventListener("change", (e) => dispatch(e, "change"));
  document.addEventListener("input", (e) => dispatch(e, "input"));

  // Modal helpers (replace inline onclick on the static modals in index.html).
  // - [data-modal-backdrop]: clicking the backdrop itself (not its contents)
  //   hides the modal.
  // - [data-modal-close="id"]: a button that hides the modal with that id.
  document.addEventListener("click", function (e) {
    const bd = e.target && e.target.closest ? e.target : null;
    if (
      bd &&
      bd.hasAttribute &&
      bd.hasAttribute("data-modal-backdrop") &&
      e.target === bd
    ) {
      bd.style.display = "none";
      return;
    }
    const closer =
      e.target && e.target.closest
        ? e.target.closest("[data-modal-close]")
        : null;
    if (closer) {
      const id = closer.getAttribute("data-modal-close");
      const m = document.getElementById(id);
      if (m) m.style.display = "none";
    }
  });
})();
