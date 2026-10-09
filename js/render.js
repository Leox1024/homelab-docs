/* =====================================================================
   Homelab Docs — SVG rendering
   ---------------------------------------------------------------------
   Builds the diagram from the data: bands, orthogonally routed links
   and stylised nodes for each device type.
   ===================================================================== */
window.HomelabDocs = window.HomelabDocs || {};

HomelabDocs.render = (function () {
  "use strict";
  const T = HomelabDocs.topology, M = HomelabDocs.model, E = HomelabDocs.engine;
  const NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, str, cls, extra) {
    const t = el("text", Object.assign({ x: x, y: y, class: cls }, extra || {}), parent);
    t.textContent = str;
    return t;
  }

  /* ---------------- Geometry ---------------- */
  function portPoint(n, port) {
    const side = port[0], off = port[1] || 0;
    if (side === "top") return { x: n.cx + off, y: n.cy - n.h / 2 };
    if (side === "bottom") return { x: n.cx + off, y: n.cy + n.h / 2 };
    if (side === "left") return { x: n.cx - n.w / 2, y: n.cy + off };
    return { x: n.cx + n.w / 2, y: n.cy + off };
  }

  const routeCache = {};
  function route(l) {
    if (routeCache[l.id]) return routeCache[l.id];
    const A = E.nodeById[l.a], B = E.nodeById[l.b];
    const s = portPoint(A, l.pa), e = portPoint(B, l.pb);
    const pts = [s];
    let cur = s;
    (l.via || []).forEach(v => {
      cur = { x: v.x !== undefined ? v.x : cur.x, y: v.y !== undefined ? v.y : cur.y };
      pts.push(cur);
    });
    if (cur.x !== e.x && cur.y !== e.y) {
      const endVertical = l.pb[0] === "top" || l.pb[0] === "bottom";
      if (!l.via || !l.via.length) {
        const startVertical = l.pa[0] === "top" || l.pa[0] === "bottom";
        if (startVertical && endVertical) { const my = (cur.y + e.y) / 2; pts.push({ x: cur.x, y: my }, { x: e.x, y: my }); }
        else if (!startVertical && !endVertical) { const mx = (cur.x + e.x) / 2; pts.push({ x: mx, y: cur.y }, { x: mx, y: e.y }); }
        else pts.push(startVertical ? { x: cur.x, y: e.y } : { x: e.x, y: cur.y });
      } else pts.push(endVertical ? { x: e.x, y: cur.y } : { x: cur.x, y: e.y });
    }
    pts.push(e);
    routeCache[l.id] = pts;
    return pts;
  }

  function pathD(pts, r) {
    r = r === undefined ? 10 : r;
    let d = "M" + pts[0].x + " " + pts[0].y;
    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y), d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const rr = Math.min(r, d1 / 2, d2 / 2);
      const a = { x: p1.x - (p1.x - p0.x) / d1 * rr, y: p1.y - (p1.y - p0.y) / d1 * rr };
      const b = { x: p1.x + (p2.x - p1.x) / d2 * rr, y: p1.y + (p2.y - p1.y) / d2 * rr };
      d += " L" + a.x + " " + a.y + " Q" + p1.x + " " + p1.y + " " + b.x + " " + b.y;
    }
    const last = pts[pts.length - 1];
    return d + " L" + last.x + " " + last.y;
  }

  /* ---------------- Icons (24×24) ---------------- */
  const ICONS = {
    globe: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3C9.5 5.6 8.2 8.6 8.2 12s1.3 6.4 3.8 9",
    cloud: "M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.2 4.4 4.4 0 0 0 7 18z",
    server: "M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01",
    archive: "M3 5h18v4H3zM5 9v10h14V9M10 13h4",
    satellite: "M5 19a9 9 0 0 1 0-12.7l6.4 6.3L5 19zM9.5 9.6l5-5M15 3l6 6M13.5 6.5l4 4M18 14a4 4 0 0 1-4 4M21 14a7 7 0 0 1-7 7",
    antenna: "M12 10v11M8 21h8M12 10a1.5 1.5 0 1 0 0-.01M7.8 5.8a6 6 0 0 0 0 8.4M16.2 5.8a6 6 0 0 1 0 8.4M5 3a10 10 0 0 0 0 14M19 3a10 10 0 0 1 0 14",
    shield: "M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6l7-3zM9 12l2 2 4-4",
    switch: "M3 8h18v8H3zM6 12h.01M9 12h.01M12 12h.01M15 12h.01M18 12h.01",
    vote: "M4 11h16v9H4zM8 11V5h8v6M10 8l1.5 1.5L14 7",
    wifi: "M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01",
    camera: "M3 7h11v10H3zM14 10l7-3v10l-7-3",
    chip: "M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4",
    bolt: "M13 2L4 14h7l-1 8 9-12h-7l1-8z",
    plug: "M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8zM12 18v4",
    generator: "M3 8h14v11H3zM17 11h4v5h-4M6 8V5h5v3M11 10.5l-2.5 4h3l-1 3",
    battery: "M3 7h15v10H3zM21 10v4M6 10v4M9 10v4",
    disk: "M5 3h14v18H5zM12 14a3 3 0 1 0 0-.01M8 6h8"
  };
  function icon(parent, name, x, y, size, cls) {
    const g = el("g", { transform: "translate(" + x + " " + y + ") scale(" + (size / 24) + ")", class: "icon " + (cls || "") }, parent);
    el("path", { d: ICONS[name] || ICONS.chip }, g);
    return g;
  }

  /* ---------------- Bands ---------------- */
  function renderBands(layer) {
    T.bands.forEach(b => {
      const ms = b.members.map(id => E.nodeById[id]);
      const minX = Math.min.apply(null, ms.map(n => n.cx - n.w / 2));
      const maxX = Math.max.apply(null, ms.map(n => n.cx + n.w / 2));
      const minY = Math.min.apply(null, ms.map(n => n.cy - n.h / 2));
      const maxY = Math.max.apply(null, ms.map(n => n.cy + n.h / 2));
      const x0 = b.x0 !== undefined ? b.x0 : minX - 22, x1 = b.x1 !== undefined ? b.x1 : maxX + 22;
      const y0 = minY - (b.padTop !== undefined ? b.padTop : 22), y1 = maxY + (b.padBottom !== undefined ? b.padBottom : 22);
      const g = el("g", { class: "band", "data-band": b.id }, layer);
      el("rect", { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 14, class: "band-box" }, g);
      if (b.gutter) {
        text(g, x0 + 14, y0 + 24, b.n, "band-num");
        text(g, x0 + 14, y0 + 40, b.title.toUpperCase(), "band-title");
        b.sub.forEach((s, i) => text(g, x0 + 14, y0 + 54 + i * 13, s, "band-sub"));
      } else {
        text(g, x0 + 14, y0 + 20, b.n + "  " + b.title.toUpperCase(), "band-title");
        text(g, x0 + 14, y0 + 35, b.sub.join(" · "), "band-sub");
      }
    });
  }

  /* ---------------- Links ---------------- */
  const linkEls = {};
  function renderLinks(layers) {
    const dataLinks = T.links.filter(l => l.type !== "power" && !l.logical);
    const logical = T.links.filter(l => l.logical);
    const power = T.links.filter(l => l.type === "power");

    function build(l, parent, withHalo) {
      const d = pathD(route(l));
      const g = el("g", {
        class: "link t-" + l.type + (l.logical ? " is-logical" : "") + (l.poe ? " has-poe" : ""),
        "data-id": l.id
      }, parent);
      if (withHalo) el("path", { d: d, class: "halo" }, g);
      if (l.type === "stack") el("path", { d: d, class: "rail" }, g);
      el("path", { d: d, class: "glow" }, g);
      el("path", { d: d, class: "base" }, g);
      if (l.type === "power" || l.poe) el("path", { d: d, class: "flow" }, g);
      el("path", { d: d, class: "hit" }, g);
      linkEls[l.id] = { g: g };
      return g;
    }

    dataLinks.forEach(l => build(l, layers.data, true));
    power.forEach(l => el("path", { d: pathD(route(l)), class: "halo halo-power", "data-for": l.id }, layers.powerHalo));
    power.forEach(l => build(l, layers.power, false));
    logical.forEach(l => build(l, layers.logical, true));

    // Labels
    T.links.forEach(l => {
      [l.label, l.label2].forEach((lb, i) => {
        if (!lb) return;
        const attrs = { "text-anchor": lb.anchor || "middle", "data-for": l.id };
        if (lb.rotate) attrs.transform = "rotate(" + lb.rotate + " " + lb.x + " " + lb.y + ")";
        text(layers.labels, lb.x, lb.y, lb.t, "link-label t-" + l.type + (i ? " sub" : ""), attrs);
      });
    });
    (T.powerLabels || []).forEach(lb => {
      text(layers.labels, lb.x, lb.y, lb.t, "link-label t-power spine", {
        "text-anchor": "middle", transform: "rotate(" + lb.rotate + " " + lb.x + " " + lb.y + ")"
      });
    });
  }

  /* ---------------- Nodes ---------------- */
  const nodeEls = {};

  function chip(g, x, y, anchor) {
    const c = el("g", { class: "chip", transform: "translate(" + x + " " + y + ")" }, g);
    const r = el("rect", { x: 0, y: -8, width: 40, height: 16, rx: 8, class: "chip-bg" }, c);
    const t = text(c, 0, 4, "", "chip-text");
    return { g: c, rect: r, text: t, anchor: anchor || "end", x: x };
  }

  function baseCard(g, n, cls) {
    el("rect", { x: -n.w / 2, y: -n.h / 2, width: n.w, height: n.h, rx: n.kind === "cloud" ? n.h / 2 : 10, class: "card " + (cls || "") }, g);
    el("rect", { x: -n.w / 2 - 4, y: -n.h / 2 - 4, width: n.w + 8, height: n.h + 8, rx: (n.kind === "cloud" ? n.h / 2 : 10) + 4, class: "focus-ring" }, g);
  }

  function stdHeader(g, n, iconName, opts) {
    opts = opts || {};
    const x0 = -n.w / 2 + 14;
    icon(g, iconName, x0, (opts.iy !== undefined ? opts.iy : -n.h / 2 + 10), opts.isize || 22, "node-icon");
    const tx = x0 + (opts.isize || 22) + 10;
    text(g, tx, opts.ly !== undefined ? opts.ly : -2, n.label, "node-label");
    if (n.sub) text(g, tx, (opts.ly !== undefined ? opts.ly : -2) + 15, n.sub, "node-sub");
  }

  const builders = {
    cloud(g, n) {
      baseCard(g, n, "card-cloud");
      icon(g, "globe", -n.w / 2 + 22, -12, 24, "node-icon");
      text(g, -n.w / 2 + 58, -1, n.label, "node-label big");
      text(g, -n.w / 2 + 58, 14, n.sub, "node-sub");
      return { chip: chip(g, n.w / 2 - 16, 0) };
    },
    ext(g, n) {
      baseCard(g, n, "card-ext card-ext-" + n.id);
      stdHeader(g, n, n.icon, { iy: -11, ly: -1 });
      return {};
    },
    carrier(g, n) {
      baseCard(g, n, "card-carrier");
      stdHeader(g, n, n.icon, { iy: -12, ly: -2 });
      text(g, n.w / 2 - 12, -n.h / 2 + 17, n.wanTag || "", "tier-tag", { "text-anchor": "end" });
      return { chip: chip(g, n.w / 2 - 12, n.h / 2 - 15) };
    },
    wansw(g, n) {
      baseCard(g, n, "card-wansw");
      text(g, -n.w / 2 + 14, -2, n.label, "node-label");
      text(g, -n.w / 2 + 14, 12, n.sub, "node-sub");
      const leds = [];
      for (let i = 0; i < 4; i++) {
        el("rect", { x: n.w / 2 - 70 + i * 14, y: -9, width: 10, height: 8, rx: 1.5, class: "port" }, g);
        leds.push(el("rect", { x: n.w / 2 - 68 + i * 14, y: 3, width: 6, height: 3, rx: 1, class: "led" + (i < 3 ? " led-on" : "") }, g));
      }
      return { leds: leds };
    },
    firewall(g, n) {
      baseCard(g, n, "card-fw");
      stdHeader(g, n, "shield", { iy: -n.h / 2 + 10, ly: -n.h / 2 + 25 });
      const ports = {};
      (n.ports || []).forEach((p, i) => {
        const x = -n.w / 2 + 14 + i * 52;
        const pg = el("g", { class: "fw-port", "data-port": p }, g);
        el("rect", { x: x, y: n.h / 2 - 22, width: 46, height: 14, rx: 3, class: "fw-port-box" }, pg);
        el("circle", { cx: x + 8, cy: n.h / 2 - 15, r: 2.4, class: "fw-port-led" }, pg);
        text(pg, x + 14, n.h / 2 - 11.5, p, "fw-port-text");
        ports[p] = pg;
      });
      return { chip: chip(g, n.w / 2 - 12, -n.h / 2 + 16), ports: ports };
    },
    switch(g, n) {
      baseCard(g, n, "card-switch");
      text(g, -n.w / 2 + 14, -n.h / 2 + 22, n.label, "node-label");
      text(g, -n.w / 2 + 14, -n.h / 2 + 37, n.sub, "node-sub");
      const grid = el("g", { class: "port-grid" }, g);
      const leds = [];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 12; c++) {
        const x = -n.w / 2 + 14 + c * 11.5, y = n.h / 2 - 20 + r * 8;
        el("rect", { x: x, y: y, width: 9, height: 6, rx: 1, class: "port" }, grid);
        if ((c * 7 + r * 3) % 5 < 2) leds.push(el("rect", { x: x + 1.5, y: y + 1.5, width: 6, height: 3, rx: 1, class: "led led-on led-blink", style: "animation-delay:" + ((c * 0.37 + r * 0.61) % 2).toFixed(2) + "s" }, grid));
      }
      for (let i = 0; i < 4; i++) el("rect", { x: n.w / 2 - 66 + i * 13, y: n.h / 2 - 20, width: 10, height: 14, rx: 1.5, class: "sfp" + (i < 2 ? " sfp-stack" : "") }, g);
      return { chip: chip(g, n.w / 2 - 12, -n.h / 2 + 18), leds: leds };
    },
    access(g, n) {
      baseCard(g, n, "card-access");
      text(g, -n.w / 2 + 14, -n.h / 2 + 22, n.label, "node-label");
      text(g, -n.w / 2 + 14, -n.h / 2 + 37, n.sub, "node-sub");
      ["wifi", "chip", "camera"].forEach((ic, i) => icon(g, ic, -n.w / 2 + 14 + i * 26, n.h / 2 - 24, 16, "node-icon small"));
      return { chip: chip(g, n.w / 2 - 12, n.h / 2 - 16) };
    },
    server(g, n) { return HomelabDocs.renderServer(g, n, { el: el, text: text, icon: icon, chip: chip, baseCard: baseCard }); },
    jbod(g, n) {
      baseCard(g, n, "card-jbod");
      text(g, -n.w / 2 + 14, -n.h / 2 + 20, n.label, "node-label");
      text(g, -n.w / 2 + 14, -n.h / 2 + 35, n.sub, "node-sub");
      const bays = [];
      let x = -n.w / 2 + 14;
      const by = n.h / 2 - 36;
      n.pools.forEach((p, pi) => {
        const gx = x;
        for (let i = 0; i < p.disks; i++) {
          const b = el("g", { class: "bay bay-" + p.kind }, g);
          el("rect", { x: x, y: by, width: 38, height: 18, rx: 2.5, class: "bay-box" }, b);
          el("rect", { x: x + 4, y: by + 6, width: 20, height: 2, rx: 1, class: "bay-slot" }, b);
          bays.push(el("circle", { cx: x + 31, cy: by + 9, r: 2.2, class: "led led-disk", style: "animation-delay:" + ((i * 0.53 + pi * 0.29) % 1.7).toFixed(2) + "s" }, b));
          x += 42;
        }
        text(g, gx + (p.disks * 42 - 4) / 2, n.h / 2 - 6, p.name + " · " + p.topo, "pool-label", { "text-anchor": "middle" });
        if (pi === 0) {
          // internal replication from the SSD tier to the HDD tier
          el("path", { d: "M" + (x - 1) + " " + (by + 9) + " h18 M" + (x + 12) + " " + (by + 5) + " l5 4 -5 4", class: "inner-repl solid" }, g);
          x += 26;
        }
      });
      return { chip: chip(g, n.w / 2 - 12, -n.h / 2 + 17), diskLeds: bays };
    },
    nas(g, n) {
      baseCard(g, n, "card-nas");
      icon(g, "archive", -n.w / 2 + 12, -n.h / 2 + 11, 18, "node-icon");
      text(g, -n.w / 2 + 12, -n.h / 2 + 50, n.label, "node-label");
      text(g, -n.w / 2 + 12, -n.h / 2 + 66, n.sub, "node-sub");
      if (n.sub2) text(g, -n.w / 2 + 12, -n.h / 2 + 81, n.sub2, "node-sub");
      return { chip: chip(g, n.w / 2 - 10, -n.h / 2 + 20) };
    },
    generator(g, n) {
      baseCard(g, n, "card-power");
      stdHeader(g, n, "generator", { iy: -11, ly: -1 });
      return { chip: chip(g, n.w / 2 - 10, -n.h / 2 - 1) };
    },
    grid(g, n) {
      baseCard(g, n, "card-power");
      stdHeader(g, n, "plug", { iy: -12, ly: -1 });
      return { chip: chip(g, n.w / 2 - 10, -n.h / 2 - 1) };
    },
    ups(g, n) {
      baseCard(g, n, "card-ups");
      icon(g, "battery", -n.w / 2 + 14, -n.h / 2 + 12, 22, "node-icon");
      text(g, -n.w / 2 + 46, -n.h / 2 + 23, n.label, "node-label");
      text(g, -n.w / 2 + 46, -n.h / 2 + 37, n.sub, "node-sub");
      el("rect", { x: -n.w / 2 + 14, y: n.h / 2 - 32, width: n.w - 28, height: 22, rx: 4, class: "lcd" }, g);
      const lcd = text(g, -n.w / 2 + 24, n.h / 2 - 17, "ONLINE · INVERTER", "lcd-text");
      return { chip: chip(g, n.w / 2 - 12, -n.h / 2 + 18), lcd: lcd };
    },
    pdu(g, n) {
      baseCard(g, n, "card-power");
      stdHeader(g, n, "bolt", { iy: -12, ly: -1 });
      return {};
    }
  };

  function renderNodes(layer) {
    T.nodes.forEach(n => {
      const g = el("g", {
        class: "node k-" + n.kind + (n.layer === "power" ? " is-power" : "") + (n.layer === "ext" ? " is-ext" : ""),
        transform: "translate(" + n.cx + " " + n.cy + ")",
        "data-id": n.id, tabindex: 0, role: "button",
        "aria-label": n.label + " — " + n.role
      }, layer);
      const parts = (builders[n.kind] || builders.ext)(g, n) || {};
      el("rect", { x: -n.w / 2 - 7, y: -n.h / 2 - 7, width: n.w + 14, height: n.h + 14, rx: 14, class: "res-ring" }, g);
      nodeEls[n.id] = Object.assign({ g: g }, parts);
    });
  }

  function setChip(c, label, cls) {
    if (!c) return;
    c.text.textContent = label;
    const w = Math.max(28, label.length * 6.1 + 14);
    const x0 = c.anchor === "end" ? -w : 0;
    c.rect.setAttribute("x", x0);
    c.rect.setAttribute("width", w);
    c.text.setAttribute("x", x0 + w / 2);
    c.text.setAttribute("text-anchor", "middle");
    c.g.setAttribute("class", "chip " + (cls || ""));
  }

  /* ---------------- Definitions (gradients, patterns) ---------------- */
  function renderDefs(svg) {
    const defs = el("defs", null, svg);
    const pat = el("pattern", { id: "dots", width: 28, height: 28, patternUnits: "userSpaceOnUse" }, defs);
    el("circle", { cx: 1, cy: 1, r: 1, class: "bg-dot" }, pat);
    const colors = { wan: "#38bdf8", lan: "#7aa7ff", tunnel: "#c084fc", backup: "#34d399", ha: "#f472b6" };
    Object.keys(colors).forEach(k => {
      const g = el("radialGradient", { id: "pg-" + k }, defs);
      el("stop", { offset: "0%", "stop-color": "#ffffff", "stop-opacity": 1 }, g);
      el("stop", { offset: "28%", "stop-color": colors[k], "stop-opacity": 1 }, g);
      el("stop", { offset: "100%", "stop-color": colors[k], "stop-opacity": 0 }, g);
    });
    const vg = el("radialGradient", { id: "vignette", cx: "50%", cy: "40%", r: "75%" }, defs);
    el("stop", { offset: "0%", "stop-color": "#0f1a33", "stop-opacity": 0.55 }, vg);
    el("stop", { offset: "100%", "stop-color": "#060a13", "stop-opacity": 0 }, vg);
  }

  function build(svg) {
    renderDefs(svg);
    const vp = el("g", { id: "viewport" }, svg);
    const W = T.world.w, H = T.world.h;
    el("rect", { x: -2000, y: -2000, width: W + 4000, height: H + 4000, fill: "url(#dots)", class: "bg-grid" }, vp);
    el("rect", { x: -200, y: -200, width: W + 400, height: H + 400, fill: "url(#vignette)", "pointer-events": "none" }, vp);
    const layers = {};
    ["bands", "data", "powerHalo", "power", "logical", "flows", "nodes", "labels", "particles"].forEach(k => {
      layers[k] = el("g", { class: "layer layer-" + k }, vp);
    });
    // particles sit below the nodes: they enter and leave each device
    vp.insertBefore(layers.particles, layers.nodes);
    renderBands(layers.bands);
    renderLinks(layers);
    renderNodes(layers.nodes);
    return { viewport: vp, layers: layers };
  }

  return {
    el: el, text: text, icon: icon, route: route, pathD: pathD, build: build,
    nodeEls: nodeEls, linkEls: linkEls, setChip: setChip, icons: ICONS
  };
})();
