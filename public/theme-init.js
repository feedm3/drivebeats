(() => {
  var t = localStorage.getItem("theme");
  var d =
    t === "dark" ||
    (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  var e = document.documentElement;
  // Keep the colors in sync with THEME_COLOR_LIGHT/DARK in
  // src/lib/theme-color.ts (the --background values from globals.css).
  var m = document.getElementById("theme-color");
  try {
    e.classList.remove("light", "dark");
    e.classList.add(d ? "dark" : "light");
    e.style.colorScheme = d ? "dark" : "light";
    if (m) {
      m.content = d ? "#0f0f0f" : "#ffffff";
      m.removeAttribute("media");
    }
  } catch (_e) {}
})();
