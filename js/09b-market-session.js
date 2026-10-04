// 09b-market-session.js
// Casablanca Stock Exchange live session-phase widget: a far-right "Market"
// button + popup showing the current trading phase for both CSE groups, based
// on Africa/Casablanca time. Moved out of 09-boot.js (it is a self-contained
// feature, not bootstrap wiring). Schedule logic lives in the tested core
// (__core.marketSession); this file owns only casaNow() + the render/popup.
// Part of the Portfolio Tracker app, loaded as an ordered plain <script>
// (shared global scope via scripts/concat.mjs) after 01-core (uses escapeHtml).
// ============================================================

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
