/* =====================================================================
   Homelab Docs — server card (Proxmox nodes)
   ---------------------------------------------------------------------
   Stylised server: header, chassis with disk bays and bond ports,
   hosted workload groups (coloured by recovery mode) and, on the
   recovery node, the area where replicated workloads appear.
   ===================================================================== */
window.HomelabDocs = window.HomelabDocs || {};
HomelabDocs.svcEls = {};

HomelabDocs.renderServer = function (g, n, h) {
  "use strict";
  const M = HomelabDocs.model, E = HomelabDocs.engine;
  const el = h.el, text = h.text;
  const L = -n.w / 2, Tp = -n.h / 2, W = n.w;

  h.baseCard(g, n, "card-server");
  h.icon(g, "server", L + 14, Tp + 12, 22, "node-icon");
  text(g, L + 46, Tp + 27, n.label, "node-label big");
  if (n.model) text(g, L + 46 + n.label.length * 11 + 12, Tp + 27, n.model, "node-model");
  text(g, L + 46, Tp + 42, n.sub, "node-sub");
  const chip = h.chip(g, -L - 14, Tp + 22);

  /* ---- Chassis: disk bays + bond ports ---- */
  const cy0 = Tp + 56;
  el("rect", { x: L + 14, y: cy0, width: W - 28, height: 44, rx: 6, class: "chassis" }, g);
  for (let i = 0; i < 7; i++) el("line", { x1: L + 20 + i * 4, y1: cy0 + 8, x2: L + 20 + i * 4, y2: cy0 + 36, class: "vent" }, g);
  const diskLeds = [];
  let x = L + 54;
  n.pools.forEach((p, pi) => {
    const gx = x;
    text(g, gx, cy0 + 12, p.name + " · " + p.topo, "pool-label");
    if (p.abstract) {
      const b = el("g", { class: "bay bay-abstract" }, g);
      el("rect", { x: x, y: cy0 + 18, width: 110, height: 18, rx: 2.5, class: "bay-box" }, b);
      for (let i = 0; i < 9; i++) el("line", { x1: x + 8 + i * 9, y1: cy0 + 33, x2: x + 14 + i * 9, y2: cy0 + 21, class: "bay-hatch" }, b);
      diskLeds.push(el("circle", { cx: x + 102, cy: cy0 + 27, r: 2.2, class: "led led-disk" }, b));
      x += 124;
      return;
    }
    for (let i = 0; i < p.disks; i++) {
      const b = el("g", { class: "bay bay-" + p.kind }, g);
      el("rect", { x: x, y: cy0 + 18, width: 34, height: 18, rx: 2.5, class: "bay-box" }, b);
      el("rect", { x: x + 4, y: cy0 + 24, width: 16, height: 2, rx: 1, class: "bay-slot" }, b);
      diskLeds.push(el("circle", { cx: x + 28, cy: cy0 + 27, r: 2.2, class: "led led-disk", style: "animation-delay:" + ((i * 0.41 + pi * 0.77) % 1.9).toFixed(2) + "s" }, b));
      x += 37;
    }
    if (p.disks > 1) el("path", { d: "M" + gx + " " + (cy0 + 40) + " h" + (p.disks * 37 - 3), class: "pool-bracket" }, g);
    x += 14;
  });
  // bond ports (one per stack unit)
  const nics = {};
  const bondLinks = HomelabDocs.topology.links.filter(l => l.bond === n.id)
    .sort((a, b) => E.nodeById[E.other(a, n.id)].cx - E.nodeById[E.other(b, n.id)].cx);
  bondLinks.forEach((l, i) => {
    const px = -L - 92 + i * 38;
    const pg = el("g", { class: "nic", "data-link": l.id }, g);
    el("rect", { x: px, y: cy0 + 16, width: 32, height: 20, rx: 3, class: "nic-box" }, pg);
    el("circle", { cx: px + 7, cy: cy0 + 22, r: 2.2, class: "nic-led" }, pg);
    text(pg, px + 16, cy0 + 33, "NIC" + i, "nic-text", { "text-anchor": "middle" });
    nics[l.id] = pg;
  });
  text(g, -L - 92, cy0 + 11, "LACP bond", "pool-label");

  /* ---- Workloads ---- */
  const services = M.services.filter(s => s.host === n.id);
  const wy = cy0 + 60;
  const CW = n.w >= 400 ? 132 : 126, CH = 20, GAP = 8, COLS = n.w >= 400 ? 3 : 2;

  function serviceChip(parent, s, cx, cy, ghost) {
    const sg = el("g", { class: "svc rec-" + s.recovery + (ghost ? " is-ghost" : ""), "data-svc": s.id, transform: "translate(" + cx + " " + cy + ")" }, parent);
    el("rect", { x: 0, y: 0, width: CW, height: CH, rx: 4, class: "svc-box" }, sg);
    el("rect", { x: 0, y: 0, width: 3, height: CH, rx: 1.5, class: "svc-bar" }, sg);
    text(sg, 10, 13.5, s.name, "svc-text");
    el("circle", { cx: CW - 9, cy: CH / 2, r: 2.6, class: "svc-dot" }, sg);
    return sg;
  }

  if (services.length) {
    text(g, L + 14, wy, "WORKLOADS", "section-label");
    services.forEach((s, i) => {
      const cx = L + 14 + (i % COLS) * (CW + GAP), cy = wy + 8 + Math.floor(i / COLS) * (CH + 6);
      HomelabDocs.svcEls[s.id] = { g: serviceChip(g, s, cx, cy, false) };
    });
  }

  // backup server → NAS relationship (datastore)
  const P = M.protection;
  const bi = services.findIndex(s => s.id === P.backupService), ni = services.findIndex(s => s.id === P.nasService);
  if (bi >= 0 && ni >= 0) {
    const xa = L + 14 + (bi % COLS) * (CW + GAP) + CW / 2, xb = L + 14 + (ni % COLS) * (CW + GAP) + CW / 2;
    const yy = wy + 8 + CH + 3;
    el("path", { d: "M" + xa + " " + yy + " C " + xa + " " + (yy + 16) + ", " + xb + " " + (yy + 16) + ", " + xb + " " + (yy + 2), class: "inner-flow" }, g);
    text(g, (xa + xb) / 2, yy + 20, "backup datastore", "inner-label", { "text-anchor": "middle" });
  }

  // data protection summary
  if (n.protection) {
    const py = wy + 72;
    text(g, L + 14, py, "DATA PROTECTION", "section-label");
    n.protection.forEach((t, i) => {
      el("circle", { cx: L + 18, cy: py + 13 + i * 14, r: 1.8, class: "prot-dot" }, g);
      text(g, L + 26, py + 16 + i * 14, t, "legend-mini");
    });
  }

  // recovery area: workloads replicated from other nodes
  if (n.recovery) {
    const replicas = M.services.filter(s => s.recovery === "replica" && s.host !== n.id);
    const ay = wy + 8;
    text(g, L + 14, wy, "RESERVE CAPACITY", "section-label");
    el("rect", { x: L + 14, y: ay, width: W - 28, height: (n.h / 2 - 12) - ay, rx: 6, class: "emergency-area" }, g);
    text(g, L + 24, ay + 16, "Takes over selected workloads from PVE01", "section-label emergency");
    replicas.forEach((s, i) => {
      const cx = L + 24 + (i % COLS) * (CW + 6), cy = ay + 26 + Math.floor(i / COLS) * (CH + 5);
      HomelabDocs.svcEls[s.id] = HomelabDocs.svcEls[s.id] || {};
      HomelabDocs.svcEls[s.id].ghost = serviceChip(g, s, cx, cy, true);
    });
  }

  // recovery colour legend on nodes whose workloads can move
  if (services.some(s => s.recovery === "replica")) {
    const ly = n.h / 2 - 12;
    const items = [["replica", "replicated → PVE03"], ["backup", "restore from backup"], ["none", "paused"]];
    let lx = L + 14;
    text(g, lx, ly, "IF THIS NODE FAILS", "section-label");
    lx += 112;
    items.forEach(it => {
      el("rect", { x: lx, y: ly - 8, width: 3, height: 10, rx: 1.5, class: "legend-bar rec-" + it[0] }, g);
      text(g, lx + 8, ly, it[1], "legend-mini");
      lx += it[1].length * 5.4 + 22;
    });
  }

  return { chip: chip, nics: nics, diskLeds: diskLeds };
};
