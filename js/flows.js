/* =====================================================================
   Homelab Atlas — illustrative flows
   ---------------------------------------------------------------------
   Glowing pulses travelling along the paths computed by the engine.
   They show logical flows, NOT telemetry. With prefers-reduced-motion
   (or animations off) static arrows are drawn instead.
   ===================================================================== */
window.Atlas = window.Atlas || {};

Atlas.flows = (function () {
  "use strict";
  const R = Atlas.render;
  let layer, staticLayer, raf = null, running = false, motion = true, last = 0, t = 0;
  const active = {};                // id → { key, segs, len, parts, color, speed, bidir }
  const SPEED = 62;                 // world px/s: slow enough to follow

  function polyline(steps) {
    const pts = [];
    steps.forEach(s => {
      let p = R.route(Atlas.engine.linkById[s.l]).slice();
      if (s.dir < 0) p.reverse();
      p.forEach((q, i) => {
        const prev = pts[pts.length - 1];
        if (i === 0 && prev && prev.x === q.x && prev.y === q.y) return;
        pts.push(q);
      });
    });
    const segs = [];
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < 0.01) continue;
      segs.push({ a: a, b: b, d: d, s: len });
      len += d;
    }
    return { segs: segs, len: len };
  }

  function pointAt(f, dist) {
    const segs = f.segs;
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].s <= dist) lo = mid; else hi = mid - 1; }
    const s = segs[lo], r = (dist - s.s) / s.d;
    return { x: s.a.x + (s.b.x - s.a.x) * r, y: s.a.y + (s.b.y - s.a.y) * r, seg: s };
  }

  function clear(id) {
    const f = active[id];
    if (!f) return;
    f.parts.forEach(p => p.el.remove());
    (f.statics || []).forEach(e => e.remove());
    delete active[id];
  }

  function makeStatic(f, color) {
    const els = [];
    for (let d = 40; d < f.len - 20; d += 90) {
      const p = pointAt(f, d);
      const ang = Math.atan2(p.seg.b.y - p.seg.a.y, p.seg.b.x - p.seg.a.x) * 180 / Math.PI;
      els.push(R.el("path", { d: "M-4 -4 L2 0 L-4 4", class: "chevron c-" + color, transform: "translate(" + p.x + " " + p.y + ") rotate(" + ang + ")" }, staticLayer));
    }
    return els;
  }

  /** result: engine output; mode: network | power | full */
  function update(result, mode, motionOn) {
    motion = motionOn;
    const want = {};
    result.flows.forEach(fl => {
      if (!fl.steps || !fl.steps.length) return;
      if (fl.def.modes && fl.def.modes.indexOf(mode) < 0) return;
      want[fl.id] = fl;
    });
    Object.keys(active).forEach(id => {
      const key = want[id] ? JSON.stringify(want[id].steps) + motion : null;
      if (!want[id] || active[id].key !== key) clear(id);
    });
    Object.keys(want).forEach(id => {
      if (active[id]) return;
      const fl = want[id], geo = polyline(fl.steps);
      if (geo.len < 1) return;
      const f = { key: JSON.stringify(fl.steps) + motion, segs: geo.segs, len: geo.len, parts: [], color: fl.def.color, bidir: !!fl.def.bidir };
      if (motion) {
        const lanes = fl.lanes > 1 ? 0.65 : 1;   // load-balanced flows are split across lanes
        const n = Math.max(f.bidir ? 1 : 2, Math.round(geo.len / 230 * (fl.def.density || 1) * lanes));
        const dirs = f.bidir ? [1, -1] : [1];
        dirs.forEach(dir => {
          for (let i = 0; i < n; i++) {
            const c = R.el("circle", { r: 5.5, class: "particle c-" + f.color, fill: "url(#pg-" + f.color + ")" }, layer);
            f.parts.push({ el: c, off: (i / n) * geo.len + (dir < 0 ? geo.len / (2 * n) : 0), dir: dir });
          }
        });
      } else f.statics = makeStatic(f, f.color);
      active[id] = f;
    });
    if (motion && Object.keys(active).length) start(); else stop();
    if (motion) frame(performance.now(), true);
  }

  function frame(now, once) {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    t += dt;
    Object.keys(active).forEach(id => {
      const f = active[id];
      f.parts.forEach(p => {
        let d = (p.off + t * SPEED) % f.len;
        if (p.dir < 0) d = f.len - d;
        const q = pointAt(f, d);
        const edge = Math.min(d, f.len - d);
        p.el.setAttribute("cx", q.x.toFixed(1));
        p.el.setAttribute("cy", q.y.toFixed(1));
        p.el.setAttribute("opacity", Math.min(1, edge / 24).toFixed(2));
      });
    });
    if (!once && running) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true; last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (motion && Object.keys(active).length) start();
  });

  function init(particleLayer) {
    layer = particleLayer;
    staticLayer = R.el("g", { class: "static-flows" }, particleLayer);
  }

  return { init: init, update: update };
})();
