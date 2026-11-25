"use strict";

const panel = document.querySelector(".art-panel");
const canShift = matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");

panel.addEventListener("pointermove", event => {
    if (!canShift.matches || event.pointerType !== "mouse") return;

    const { left, top, width, height } = panel.getBoundingClientRect();
    const x = ((event.clientX - left) / width - 0.5) * 14;
    const y = ((event.clientY - top) / height - 0.5) * 14;
    panel.style.setProperty("--shift-x", `${x.toFixed(2)}px`);
    panel.style.setProperty("--shift-y", `${y.toFixed(2)}px`);
});

panel.addEventListener("pointerleave", () => {
    panel.style.removeProperty("--shift-x");
    panel.style.removeProperty("--shift-y");
});
