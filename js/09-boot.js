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
    // Split on commas, but NOT commas inside single/double quotes - so a quoted
    // argument may safely contain a comma (e.g. a name). Unquoted args split
    // exactly as before, so this is backward compatible.
    const rawStr = String(raw);
    const chunks = [];
    let cur = "";
    let quote = null;
    for (let i = 0; i < rawStr.length; i++) {
      const ch = rawStr[i];
      if (quote) {
        if (ch === quote) quote = null;
        cur += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        cur += ch;
      } else if (ch === ",") {
        chunks.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    chunks.push(cur);
    return chunks.map((a) => {
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

  // Ticker badge: when a real logo (logos/<TICKER>.png) actually loads, reveal
  // it and hide the monogram fallback. Delegated on the capture phase because
  // the img "load" event does not bubble. No inline onerror/onload handlers,
  // keeping the app's no-inline-handler model. If the logo 404s the monogram
  // simply stays visible.
  document.addEventListener(
    "load",
    function (e) {
      const img = e.target;
      if (
        !img ||
        img.tagName !== "IMG" ||
        !img.classList ||
        !img.classList.contains("tkr-logo")
      )
        return;
      // Guard against zero-size / broken decodes.
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        img.style.display = "block";
        const wrap = img.parentNode;
        const mono = wrap && wrap.querySelector(".tkr-mono");
        if (mono) mono.style.display = "none";
      }
    },
    true,
  );

  // Ticker logo fallback: the badge tries logos/<TICKER>.svg first. If that
  // 404s (or fails to decode), swap to the next candidate in data-logo-fallbacks
  // (comma-separated, e.g. the .png). When the list is exhausted the monogram
  // simply stays. Error events don't bubble, so listen on the capture phase.
  document.addEventListener(
    "error",
    function (e) {
      const img = e.target;
      if (
        !img ||
        img.tagName !== "IMG" ||
        !img.classList ||
        !img.classList.contains("tkr-logo")
      )
        return;
      const raw = img.getAttribute("data-logo-fallbacks") || "";
      const list = raw.split(",").filter(Boolean);
      if (!list.length) return; // no more candidates -> keep the monogram
      const next = list.shift();
      img.setAttribute("data-logo-fallbacks", list.join(","));
      img.src = next;
    },
    true,
  );

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

// ===================== Casablanca market session tracker =====================
// A far-right "Market" button opens a popup showing the LIVE session phase for
// both trading groups of the Casablanca Stock Exchange (CSE), based on the
// current time in Africa/Casablanca (computed via Intl so it is correct no
// matter the viewer's own timezone). Shows what has passed, where we are now,
// and what's next, for Group 1 (Continuous) and Group 3 (Fixing).
//
// Schedule (local Casablanca time). Edit here if the exchange changes hours.
// Times are "HH:MM"; each phase is [start, end) except instantaneous points.
(function () {
  // Schedule + pure phase logic live in the tested core (src/core/market-session.js),
  // exposed via __core.marketSession. This UI owns only casaNow() (Intl) + render.
  const MS = (typeof __core !== "undefined" && __core.marketSession) || null;
  if (!MS) return; // core not loaded (e.g. isolated context) - skip the widget
  const GROUPS = MS.MARKET_GROUPS;
  const toMins = MS.toMins;
  const fmtRange = MS.fmtRange;
  const classifyPhases = MS.classifyPhases;
  const overallLabel = (now, isWeekend) =>
    MS.overallLabel(now.mins, isWeekend, GROUPS);

  // --- Casablanca "now" ------------------------------------------------------
  // Returns { mins, hh, mm, dow, hhmm, dateLabel } where mins = minutes since
  // midnight in Africa/Casablanca and dow = 0(Sun)..6(Sat).
  function casaNow() {
    const now = new Date();
    let parts;
    try {
      const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Casablanca",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        year: "numeric",
        month: "short",
        day: "2-digit",
      });
      parts = {};
      for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
    } catch (_) {
      // Fallback: assume the viewer is already in Casablanca time.
      const h = now.getHours(),
        m = now.getMinutes();
      const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
        now.getDay()
      ];
      parts = {
        hour: String(h).padStart(2, "0"),
        minute: String(m).padStart(2, "0"),
        weekday: wd,
        day: String(now.getDate()).padStart(2, "0"),
        month: "",
        year: "",
      };
    }
    let hh = parseInt(parts.hour, 10);
    if (hh === 24) hh = 0; // some engines emit "24" at midnight
    const mm = parseInt(parts.minute, 10);
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dow =
      dowMap[parts.weekday] != null
        ? dowMap[parts.weekday]
        : new Date().getDay();
    return {
      mins: hh * 60 + mm,
      hh,
      mm,
      dow,
      hhmm: parts.hour + ":" + parts.minute,
      dateLabel:
        (parts.weekday || "") +
        " " +
        (parts.day || "") +
        " " +
        (parts.month || "") +
        " " +
        (parts.year || ""),
    };
  }

  function stateColor(state) {
    return state === "now"
      ? "var(--success)"
      : state === "past"
        ? "var(--muted)"
        : "var(--text2)";
  }

  function renderGroup(g, now, marketOpenToday) {
    const rows = classifyPhases(g.phases, now.mins, marketOpenToday);
    const items = rows
      .map((p) => {
        const isNow = p.state === "now";
        const dot = p.state === "past" ? "\u2713" : isNow ? "\u25CF" : "\u25CB";
        const bg = isNow
          ? "background:rgba(38,208,124,.10);border-radius:6px;"
          : "";
        const strike = p.state === "past" ? "opacity:.6;" : "";
        return (
          '<div style="display:flex;gap:10px;align-items:flex-start;padding:6px 8px;' +
          bg +
          strike +
          '">' +
          '<span style="color:' +
          stateColor(p.state) +
          ';font-weight:700;min-width:14px">' +
          dot +
          "</span>" +
          '<div style="flex:1">' +
          '<div style="display:flex;justify-content:space-between;gap:12px">' +
          '<b style="color:' +
          (isNow ? "var(--success)" : "var(--text)") +
          '">' +
          escapeHtml(p.label) +
          (isNow ? " \u2014 now" : "") +
          "</b>" +
          '<span class="mini" style="font-family:var(--mono);color:var(--text2);white-space:nowrap">' +
          fmtRange(p) +
          "</span>" +
          "</div>" +
          '<div class="mini" style="color:var(--text2);margin-top:2px">' +
          escapeHtml(p.desc) +
          "</div>" +
          "</div></div>"
        );
      })
      .join("");
    // "next" hint
    const nowRow = rows.find((r) => r.state === "now");
    const nextRow = rows.find((r) => r.state === "upcoming");
    let hint = "";
    if (!marketOpenToday) hint = "Market closed today (weekend).";
    else if (nowRow) {
      const minsLeft = nowRow.point ? 0 : nowRow.eMin - now.mins;
      hint =
        "Currently in <b>" +
        escapeHtml(nowRow.label) +
        "</b>" +
        (nextRow
          ? " \u2014 next: <b>" +
            escapeHtml(nextRow.label) +
            "</b> at " +
            nextRow.start
          : "") +
        (minsLeft > 0
          ? ' <span class="mini">(' + minsLeft + " min left)</span>"
          : "");
    } else if (nextRow && now.mins < nextRow.sMin) {
      hint =
        "Opens with <b>" +
        escapeHtml(nextRow.label) +
        "</b> at " +
        nextRow.start +
        ".";
    } else {
      hint = "Session finished for today.";
    }
    return (
      '<div style="border:1px solid var(--border);border-radius:10px;padding:12px 12px 8px;margin-bottom:14px">' +
      '<div style="font-weight:700;margin-bottom:2px">' +
      escapeHtml(g.name) +
      "</div>" +
      '<div class="mini" style="color:var(--text2);margin-bottom:8px">' +
      escapeHtml(g.note) +
      "</div>" +
      items +
      '<div class="mini" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);color:var(--text)">' +
      hint +
      "</div>" +
      "</div>"
    );
  }

  let _msTimer = null;

  function renderMarketSession() {
    const now = casaNow();
    const isWeekend = now.dow === 0 || now.dow === 6;
    const marketOpenToday = !isWeekend;
    const clock = document.getElementById("msClock");
    if (clock)
      clock.textContent =
        now.dateLabel.trim() +
        " \u00B7 " +
        now.hhmm +
        " Casablanca" +
        (isWeekend ? " \u00B7 market closed (weekend)" : "");
    const body = document.getElementById("marketSessionBody");
    if (body) {
      body.innerHTML =
        GROUPS.map((g) => renderGroup(g, now, marketOpenToday)).join("") +
        '<div class="mini" style="color:var(--text2)">Times are Casablanca local time. Holidays are not accounted for \u2014 the exchange is also closed on public holidays.</div>';
    }
    // keep the button label fresh too
    const lbl = document.getElementById("marketSessionBtnLabel");
    if (lbl) lbl.textContent = overallLabel(now, isWeekend);
  }

  window.openMarketSession = function () {
    const m = document.getElementById("marketSessionModal");
    if (!m) return;
    renderMarketSession();
    m.style.display = "flex";
    if (_msTimer) clearInterval(_msTimer);
    _msTimer = setInterval(renderMarketSession, 15000); // live refresh
  };
  window.closeMarketSession = function () {
    const m = document.getElementById("marketSessionModal");
    if (m) m.style.display = "none";
    if (_msTimer) {
      clearInterval(_msTimer);
      _msTimer = null;
    }
  };

  // Close on backdrop click (the modal has data-modal-backdrop, handled in the
  // generic handler above) and stop the timer when it closes that way.
  document.addEventListener("click", function (e) {
    const m = document.getElementById("marketSessionModal");
    if (m && e.target === m && _msTimer) {
      clearInterval(_msTimer);
      _msTimer = null;
    }
  });

  // Keep the button label showing the live phase even before opening.
  function tickButtonLabel() {
    const lbl = document.getElementById("marketSessionBtnLabel");
    if (!lbl) return;
    const now = casaNow();
    lbl.textContent = overallLabel(now, now.dow === 0 || now.dow === 6);
  }
  if (document.getElementById("marketSessionBtnLabel")) tickButtonLabel();
  else document.addEventListener("DOMContentLoaded", tickButtonLabel);
  setInterval(tickButtonLabel, 60000);
})();
