/**
 * Browser / iOS status bar colors.
 *
 * These must stay in sync with `--background` in `src/app/globals.css`:
 *   :root  --background: oklch(1 0 0)    -> sRGB 255,255,255 -> #ffffff
 *   .dark  --background: oklch(0.17 0 0) -> sRGB  15, 15, 15 -> #0f0f0f
 *
 * Both are achromatic (C = 0), so the conversion is OKLab -> LMS (l = m = s =
 * L^3) -> linear sRGB -> sRGB transfer function. For L = 0.17 that is
 * 0.17^3 = 0.004913 linear, and 1.055 * 0.004913^(1/2.4) - 0.055 = 0.06017,
 * i.e. 15.34/255, which rounds to 15 = 0x0f.
 *
 * `public/theme-init.js` repeats these two literals because it is a
 * dependency-free blocking script in <head> that cannot import from `src`.
 */
export const THEME_COLOR_LIGHT = "#ffffff";
export const THEME_COLOR_DARK = "#0f0f0f";

/**
 * Id of the single <meta name="theme-color"> element that reflects the
 * *resolved* theme, including a manual in-app override. It is server-rendered
 * in the root layout, primed by `public/theme-init.js` before first paint, and
 * kept up to date by `ThemeProvider`.
 */
export const THEME_COLOR_META_ID = "theme-color";

export function getThemeColor(theme: "light" | "dark") {
  return theme === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
}

/** Keeps the resolved-theme meta tag in sync after the theme toggle changes. */
export function syncThemeColorMeta(theme: "light" | "dark") {
  if (typeof document === "undefined") return;

  const meta = document.getElementById(
    THEME_COLOR_META_ID,
  ) as HTMLMetaElement | null;
  if (!meta) return;

  meta.content = getThemeColor(theme);
  // The tag is server-rendered with media="not all" as the no-JavaScript
  // fallback; dropping it here (and in theme-init.js) is what activates it.
  meta.removeAttribute("media");
}
