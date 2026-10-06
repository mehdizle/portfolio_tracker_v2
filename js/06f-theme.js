// ============================================================
// THEME (light / dark)  (js/06f-theme.js)
// ------------------------------------------------------------
// Extracted verbatim from js/06b-import.js as the first step of decomposing
// that god-file. Fully self-contained: nothing else in the app references
// THEMES or applyTheme (they're wired only via #themeToggle below), and its
// only outbound dependencies are the guarded, earlier-loaded globals
// refreshThemeCache (01-core.js) and render (04-render.js). Loaded after
// 04-render.js in scripts/concat.mjs so `render` exists when applyTheme runs.
// ============================================================

// ---------- light / dark mode toggle ----------
// NOTE: these MUST mirror the current "THEME REFRESH" :root palette
// (the purple flat-modern pass), because applyTheme() sets these tokens
// inline on <html> and would otherwise override the CSS defaults.
const THEMES = {
  dark: {
    "--bg": "#0a0b0f",
    "--bg2": "#0f1116",
    "--panel": "#14161c",
    "--panel2": "#1b1e26",
    "--border": "#262a33",
    "--border-l": "#1d2029",
    "--text": "#eceef2",
    "--text2": "#9ca3af",
    "--muted": "#656b76",
    // subtle dark-purple accent (matches the refreshed :root)
    "--primary": "#7c5cdd",
    "--primary2": "#9a7ef0",
    "--success": "#2dd4a7",
    "--error": "#f26d6d",
    "--warn": "#f5b544",
    "--info": "#8b9cf5",
  },
  light: {
    "--bg": "#f6f6fb",
    "--bg2": "#ffffff",
    "--panel": "#ffffff",
    "--panel2": "#f1f0f8",
    "--border": "#e4e2ee",
    "--border-l": "#eeecf5",
    "--text": "#1a1725",
    "--text2": "#5a5570",
    "--muted": "#8b869c",
    // same purple identity, deepened for contrast on white panels
    "--primary": "#6d4fd0",
    "--primary2": "#7c5cdd",
    "--success": "#0f9d76",
    "--error": "#e0484d",
    "--warn": "#c77f00",
    "--info": "#5b6fd8",
  },
};
function applyTheme(name) {
  const t = THEMES[name] || THEMES.dark;
  for (const k in t) document.documentElement.style.setProperty(k, t[k]);
  // Refresh the cached theme tokens so charts/renders pick up the new palette.
  if (typeof refreshThemeCache === "function") refreshThemeCache();
  try {
    localStorage.setItem("casa_theme_v1", name);
  } catch (e) {}
  const btn = document.getElementById("themeToggle");
  if (btn)
    btn.textContent =
      name === "light" ? "\uD83C\uDF19 Dark" : "\u2600\uFE0F Light";
  // Re-render so charts recolor to the new theme. (Previously gated on the
  // now-removed allocation pie's CH_alloc, which left charts stale on toggle.)
  setTimeout(() => {
    try {
      if (typeof render === "function") render();
    } catch (e) {}
  }, 10);
}
document.getElementById("themeToggle").onclick = () => {
  const cur = (() => {
    try {
      return localStorage.getItem("casa_theme_v1") || "dark";
    } catch (e) {
      return "dark";
    }
  })();
  applyTheme(cur === "dark" ? "light" : "dark");
};
(function () {
  try {
    const s = localStorage.getItem("casa_theme_v1");
    if (s) applyTheme(s);
  } catch (e) {}
})();
