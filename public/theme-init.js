(() => {
  var t = localStorage.getItem("theme");
  var d =
    t === "dark" ||
    (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  var e = document.documentElement;
  try {
    e.classList.remove("light", "dark");
    e.classList.add(d ? "dark" : "light");
    e.style.colorScheme = d ? "dark" : "light";
  } catch (_e) {}
})();
