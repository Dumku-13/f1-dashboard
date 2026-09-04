/**
 * The pre-paint theme snippet, kept OUT of lib/theme.ts on purpose.
 *
 * lib/theme.ts is `'use client'`, and importing a plain constant from a client
 * module into a server component does not hand back the string — it hands back
 * a client reference. app/layout.tsx is a server component and needs the
 * actual source text to inline, so the constant lives in this module, which
 * has no directive and is therefore importable from either side.
 */

export const APPEARANCE_KEY = 'f1.appearance'
export const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Runs before first paint, from an inline script in the document head.
 *
 * Without it the page renders in the default theme and then corrects itself
 * once React mounts — a white flash on every cold load for anyone using dark,
 * which is most of them. It is stringified rather than imported because it has
 * to execute before the bundle exists. Keep it small and dependency-free; it
 * blocks parsing.
 */
export const THEME_INIT_SCRIPT = `
(function(){
  try {
    var stored = localStorage.getItem('${APPEARANCE_KEY}');
    var resolved = (stored === 'light' || stored === 'dark')
      ? stored
      : (window.matchMedia('${DARK_QUERY}').matches ? 'dark' : 'light');
    var root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
  } catch (e) {
    /* Storage blocked, or matchMedia missing. Dark is the design's default
       and the stylesheet already assumes it, so there is nothing to do. */
  }
})();
`.trim()
