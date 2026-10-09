/* =====================================================================
   DCB Infrastructure Map — navigation (zoom, pan, pinch, keyboard)
   ===================================================================== */
window.DCB = window.DCB || {};

DCB.view = (function () {
  "use strict";
  let svg, vp, world, onClick;
  const v = { k: 1, x: 0, y: 0 };
  let userMoved = false, anim = null;
  const K_MIN = 0.2, K_MAX = 4;

  function apply() {
    vp.setAttribute("transform", "translate(" + v.x.toFixed(2) + " " + v.y.toFixed(2) + ") scale(" + v.k.toFixed(4) + ")");
    svg.style.setProperty("--zoom", v.k.toFixed(3));
    svg.classList.toggle("zoom-far", v.k < 0.55);
  }

  function size() { const r = svg.getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, top: r.top }; }

  function fitTarget(insetRight, insetLeft) {
    const s = size();
    // leave room for the floating HUD at the top and the simulation dock at the bottom
    const mobile = s.w <= 760;
    const padX = mobile ? 10 : 32, padTop = mobile ? 116 : 80, padBottom = mobile ? 76 : 76;
    const il = insetLeft || 0;
    const aw = Math.max(200, s.w - padX * 2 - (insetRight || 0) - il), ah = Math.max(200, s.h - padTop - padBottom);
    let k = Math.min(aw / world.w, ah / world.h);
    // portrait screens: favour the readable central column, pannable sideways
    if (ah > aw * 1.15) k = Math.min(ah / world.h, Math.max(k, aw / 1150));
    return { k: k, x: il + padX + aw / 2 - (world.w / 2) * k, y: padTop + Math.max(0, (ah - world.h * k) / 2) };
  }

  function animateTo(t, ms) {
    if (anim) cancelAnimationFrame(anim);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !ms) { v.k = t.k; v.x = t.x; v.y = t.y; apply(); return; }
    const s = { k: v.k, x: v.x, y: v.y }, t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      v.k = s.k + (t.k - s.k) * e; v.x = s.x + (t.x - s.x) * e; v.y = s.y + (t.y - s.y) * e;
      apply();
      if (p < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  function fit(animate, insetRight, insetLeft) { userMoved = false; animateTo(fitTarget(insetRight, insetLeft), animate ? 450 : 0); }

  function zoomAt(factor, px, py, animate) {
    const s = size();
    if (px === undefined) { px = s.w / 2; py = s.h / 2; }
    const k = Math.max(K_MIN, Math.min(K_MAX, v.k * factor));
    const wx = (px - v.x) / v.k, wy = (py - v.y) / v.k;
    const t = { k: k, x: px - wx * k, y: py - wy * k };
    userMoved = true;
    animateTo(t, animate ? 220 : 0);
  }

  function panBy(dx, dy) { v.x += dx; v.y += dy; userMoved = true; apply(); }

  /* Bring a node into the visible area (keyboard navigation, selection) */
  function ensureVisible(n, insetRight, insetLeft, insetBottom) {
    const s = size();
    const sx = n.cx * v.k + v.x, sy = n.cy * v.k + v.y;
    const margin = 40, top = s.w <= 760 ? 116 : 76, left = insetLeft || 0, right = s.w - (insetRight || 0), bottom = s.h - (insetBottom || 0);
    if (sx > left + margin && sx < right - margin && sy > top && sy < bottom - margin) return;
    animateTo({ k: v.k, x: (left + right) / 2 - n.cx * v.k, y: (top + bottom) / 2 - n.cy * v.k }, 320);
  }

  function init(svgEl, viewport, worldSize, clickHandler) {
    svg = svgEl; vp = viewport; world = worldSize; onClick = clickHandler;
    const pts = new Map();
    let start = null, moved = false, pinch = null;

    svg.addEventListener("pointerdown", e => {
      if (e.button !== undefined && e.button > 0) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { start = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, target: e.target }; moved = false; }
      if (pts.size === 2) {
        const [a, b] = Array.from(pts.values());
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: v.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: v.x, vy: v.y };
        moved = true;
      }
    });
    svg.addEventListener("pointermove", e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const s = size();
      if (pinch && pts.size >= 2) {
        const [a, b] = Array.from(pts.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const k = Math.max(K_MIN, Math.min(K_MAX, pinch.k * d / pinch.d));
        const cx = (a.x + b.x) / 2 - s.left, cy = (a.y + b.y) / 2 - s.top;
        const wx = (pinch.cx - s.left - pinch.vx) / pinch.k, wy = (pinch.cy - s.top - pinch.vy) / pinch.k;
        v.k = k; v.x = cx - wx * k; v.y = cy - wy * k; userMoved = true; apply();
        return;
      }
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) > 5) { moved = true; svg.setPointerCapture(e.pointerId); svg.classList.add("is-panning"); }
      if (moved) { v.x = start.vx + dx; v.y = start.vy + dy; userMoved = true; apply(); }
    });
    const end = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) {
        svg.classList.remove("is-panning");
        if (!moved && start && e.type === "pointerup" && onClick) onClick(start.target, e);
        start = null;
      }
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("wheel", e => {
      e.preventDefault();
      const s = size();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      zoomAt(f, e.clientX - s.left, e.clientY - s.top, false);
    }, { passive: false });
    svg.addEventListener("dblclick", e => {
      if (e.target.closest && e.target.closest(".node")) return;
      const s = size();
      zoomAt(1.6, e.clientX - s.left, e.clientY - s.top, true);
    });
  }

  return {
    init: init, fit: fit, zoomAt: zoomAt, panBy: panBy, ensureVisible: ensureVisible,
    get userMoved() { return userMoved; }, state: v
  };
})();
