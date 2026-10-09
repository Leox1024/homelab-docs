/* =====================================================================
   DCB Infrastructure Map — application
   ---------------------------------------------------------------------
   Interface state, view modes, selection, highlighting layers,
   failure scenarios, and the glue between engine, renderer and panels.
   ===================================================================== */
(function () {
  "use strict";
  const T = DCB.topology, M = DCB.model, E = DCB.engine, R = DCB.render, UI = DCB.ui, V = DCB.view, F = DCB.flows;
  const $ = s => document.querySelector(s);
  const reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  const store = {
    get(k) { try { return window.localStorage.getItem("dcb-map:" + k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem("dcb-map:" + k, v); } catch (e) { /* storage unavailable */ } }
  };

  const S = {
    mode: store.get("mode") || "full", sel: null, selLink: null, panel: null,
    scenario: null, shown: 0, detect: true, failover: false,
    vlan: null, spof: false, motion: !reduceMQ.matches, result: null
  };
  if (["network", "power", "full"].indexOf(S.mode) < 0) S.mode = "full";
  let timers = [], prevActive = new Set();

  const svg = $("#map");
  const built = R.build(svg);
  F.init(built.layers.particles);
  V.init(svg, built.viewport, T.world, onCanvasClick);

  const wide = () => window.innerWidth > 900;
  const panelInset = () => (S.panel && wide() ? 408 : 0);
  const cardInset = () => (S.scenario && wide() ? 368 : 0);
  const sheetInset = () => (S.panel && !wide() ? Math.round(window.innerHeight * 0.62) : 0);

  /* ---------- Firewall port → link mapping ---------- */
  const fwPorts = {};
  T.nodes.filter(n => n.kind === "firewall").forEach(n => {
    const wans = E.adj[n.id].filter(l => l.type === "wan").sort((a, b) => E.nodeById[E.other(a, n.id)].cx - E.nodeById[E.other(b, n.id)].cx);
    fwPorts[n.id] = {
      WAN1: wans[0] && wans[0].id, WAN2: wans[1] && wans[1].id,
      LAN: (E.adj[n.id].find(l => l.type === "lan") || {}).id, SYNC: (E.adj[n.id].find(l => l.type === "ha") || {}).id
    };
  });

  /* ================= Compute and paint ================= */
  function compute() {
    const sc = S.scenario;
    S.result = E.compute({ faults: sc ? sc.faults : [], detect: S.detect, failover: S.failover });
    paint();
  }

  function paint() {
    const r = S.result;
    svg.dataset.mode = S.mode;
    svg.classList.toggle("in-scenario", !!S.scenario);

    T.nodes.forEach(n => {
      const st = r.nodes[n.id], els = R.nodeEls[n.id], g = els.g;
      g.dataset.state = st.state;
      g.classList.toggle("is-down", st.state === "down" || st.state === "off");
      g.classList.toggle("is-battery", st.flags.battery);
      g.classList.toggle("is-bypass", st.flags.bypass);
      g.classList.toggle("is-idle", !st.up || st.state === "orphan");
      g.classList.toggle("is-focus", !!(S.scenario && S.scenario.focus.indexOf(n.id) >= 0));
      const c = UI.chipFor(n, st);
      if (els.chip) { els.chip.g.style.display = c ? "" : "none"; if (c) R.setChip(els.chip, c[0], c[1]); }
      if (els.lcd) els.lcd.textContent = { online: "ONLINE · INVERTER", battery: "BATTERY · INVERTER", bypass: "BYPASS · UNPROTECTED", off: "OFF" }[st.state] || "";
      if (els.ports) Object.keys(els.ports).forEach(p => {
        const lid = fwPorts[n.id][p], ls = lid && r.links[lid];
        els.ports[p].dataset.state = ls ? ls.state : "idle";
      });
      if (els.nics) Object.keys(els.nics).forEach(lid => { els.nics[lid].dataset.state = r.links[lid].state; });
      g.setAttribute("aria-label", n.label + " — " + n.role + (c ? " — state: " + c[0].toLowerCase() : ""));
    });

    const nowActive = new Set();
    T.links.forEach(l => {
      const st = r.links[l.id], g = R.linkEls[l.id].g;
      g.dataset.state = st.state;
      if (st.state === "active") nowActive.add(l.id);
      if (S.scenario && prevActive.has(l.id) && !st.up && !g.classList.contains("is-broken")) {
        g.classList.add("is-broken");
        setTimeout(() => g.classList.remove("is-broken"), 2400);
      }
    });
    prevActive = nowActive;

    M.services.forEach(s => {
      const els = DCB.svcEls[s.id], st = r.services[s.id];
      if (!els) return;
      if (els.g) els.g.dataset.status = st.status;
      if (els.ghost) els.ghost.dataset.status = st.status;
    });

    F.update(r, S.mode, S.motion);
    renderScenarioCard();
    highlight();
    if (S.panel === "node" && S.sel) fillPanel(UI.nodePanel(S.sel, r), true);
    if (S.panel === "link" && S.selLink) fillPanel(UI.linkPanel(S.selLink, r), true);
  }

  /* ================= Highlighting ================= */
  function highlight() {
    let nodeSet = null, linkSet = null, svcSet = null;
    const vlan = S.vlan ? M.vlans.find(v => v.id === S.vlan) : null;
    if (S.sel) {
      const rel = E.related(S.sel);
      nodeSet = rel.nodes; linkSet = rel.links;
      svcSet = new Set(M.services.filter(s => s.host === S.sel || S.result.services[s.id].on === S.sel).map(s => s.id));
    } else if (S.selLink) {
      const l = E.linkById[S.selLink];
      nodeSet = new Set([l.a, l.b]); linkSet = new Set([l.id]);
    } else if (vlan) {
      nodeSet = new Set(T.nodes.filter(n => n.kind === "firewall" || n.kind === "switch").map(n => n.id).concat(vlan.nodes));
      linkSet = new Set(T.links.filter(l => l.vlans === "all" || (Array.isArray(l.vlans) && l.vlans.indexOf(vlan.id) >= 0))
        .filter(l => nodeSet.has(l.a) && nodeSet.has(l.b)).map(l => l.id));
      svg.style.setProperty("--vlan", vlan.color);
    } else if (S.spof) {
      nodeSet = new Set([].concat(M.resilience.spof, M.resilience.redundant, M.resilience.partial).map(x => x.id));
      linkSet = new Set();
    }
    svg.classList.toggle("has-focus", !!nodeSet);
    svg.classList.toggle("vlan-on", !!vlan && !S.sel && !S.selLink);

    T.nodes.forEach(n => {
      const g = R.nodeEls[n.id].g;
      g.classList.toggle("is-dim", !!nodeSet && !nodeSet.has(n.id));
      g.classList.toggle("is-selected", S.sel === n.id);
      g.classList.toggle("is-spof", S.spof && M.resilience.spof.some(x => x.id === n.id));
      g.classList.toggle("is-redundant", S.spof && M.resilience.redundant.some(x => x.id === n.id));
      g.classList.toggle("is-partial", S.spof && M.resilience.partial.some(x => x.id === n.id));
    });
    T.links.forEach(l => {
      const g = R.linkEls[l.id].g;
      g.classList.toggle("is-dim", !!linkSet && !linkSet.has(l.id));
      g.classList.toggle("is-hl", !!linkSet && linkSet.has(l.id));
      g.classList.toggle("is-selected", S.selLink === l.id);
    });
    document.querySelectorAll(".link-label[data-for]").forEach(t => t.classList.toggle("is-dim", !!linkSet && !linkSet.has(t.getAttribute("data-for"))));
    M.services.forEach(s => {
      const els = DCB.svcEls[s.id];
      if (!els) return;
      [els.g, els.ghost].forEach(g => { if (g) g.classList.toggle("is-hl", !!svcSet && svcSet.has(s.id)); });
    });
  }

  /* ================= Selection and panel ================= */
  function fillPanel(html, keepScroll) {
    const body = $("#panel-body"), top = body.scrollTop;
    body.innerHTML = html;
    if (keepScroll) body.scrollTop = top;
  }
  function openPanel(kind, html) {
    S.panel = kind;
    fillPanel(html, false);
    const p = $("#panel");
    p.hidden = false;
    requestAnimationFrame(() => p.classList.add("is-open"));
    document.body.classList.add("panel-open");
  }
  function closePanel() {
    S.panel = null;
    const p = $("#panel");
    p.classList.remove("is-open");
    document.body.classList.remove("panel-open");
    setTimeout(() => { if (!S.panel) p.hidden = true; }, 260);
  }

  function selectNode(id, fromKeyboard) {
    S.sel = id; S.selLink = null;
    openPanel("node", UI.nodePanel(id, S.result));
    highlight();
    hideTooltip();
    V.ensureVisible(E.nodeById[id], panelInset(), cardInset(), sheetInset());
    if (fromKeyboard) R.nodeEls[id].g.focus({ preventScroll: true });
  }
  function selectLink(id) {
    S.selLink = id; S.sel = null;
    openPanel("link", UI.linkPanel(id, S.result));
    highlight();
    hideTooltip();
  }
  function clearSelection() {
    const was = S.sel || S.selLink || S.panel;
    S.sel = null; S.selLink = null;
    if (S.panel) closePanel();
    highlight();
    return !!was;
  }

  function onCanvasClick(target) {
    dismissHint();
    closePopovers();
    const node = target.closest && target.closest(".node");
    const link = target.closest && target.closest(".link");
    if (node) return selectNode(node.getAttribute("data-id"));
    if (link) return selectLink(link.getAttribute("data-id"));
    clearSelection();
  }

  $("#panel-close").addEventListener("click", clearSelection);
  $("#panel-body").addEventListener("click", e => {
    const go = e.target.closest("[data-goto]"), gl = e.target.closest("[data-goto-link]");
    if (go) selectNode(go.getAttribute("data-goto"), true);
    else if (gl) selectLink(gl.getAttribute("data-goto-link"));
  });

  /* ================= Tooltip ================= */
  const tip = $("#tooltip");
  let hoverEl = null;
  function showTooltip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let px = x + 16, py = y + 16;
    if (px + r.width > window.innerWidth - 8) px = x - r.width - 16;
    if (py + r.height > window.innerHeight - 8) py = Math.max(8, y - r.height - 16);
    tip.style.transform = "translate(" + Math.round(px) + "px," + Math.round(py) + "px)";
  }
  function hideTooltip() {
    tip.hidden = true;
    if (hoverEl) hoverEl.classList.remove("is-hover");
    hoverEl = null;
    document.querySelectorAll(".link.is-hover-hl").forEach(l => l.classList.remove("is-hover-hl"));
  }

  svg.addEventListener("pointermove", e => {
    if (e.pointerType === "touch" || svg.classList.contains("is-panning")) return;
    const node = e.target.closest(".node"), link = !node && e.target.closest(".link");
    const elx = node || link || null;
    if (elx !== hoverEl) {
      hideTooltip();
      hoverEl = elx;
      if (node) {
        node.classList.add("is-hover");
        E.adj[node.getAttribute("data-id")].forEach(l => R.linkEls[l.id].g.classList.add("is-hover-hl"));
      } else if (link) link.classList.add("is-hover-hl");
    }
    if (node && node.getAttribute("data-id") === S.sel) tip.hidden = true;
    else if (node) showTooltip(UI.tooltipNode(node.getAttribute("data-id"), S.result, S.spof), e.clientX, e.clientY);
    else if (link) showTooltip(UI.tooltipLink(link.getAttribute("data-id")), e.clientX, e.clientY);
  });
  svg.addEventListener("pointerleave", hideTooltip);

  /* Keyboard navigation on nodes */
  svg.addEventListener("keydown", e => {
    const node = e.target.closest && e.target.closest(".node");
    if (node && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); selectNode(node.getAttribute("data-id"), true); }
  });
  svg.addEventListener("focusin", e => {
    const node = e.target.closest && e.target.closest(".node");
    if (!node) return;
    const n = E.nodeById[node.getAttribute("data-id")];
    let kb = true;
    try { kb = node.matches(":focus-visible"); } catch (err) { /* selector unsupported */ }
    if (!kb || n.id === S.sel) return;   // keyboard focus only
    V.ensureVisible(n, panelInset(), cardInset(), sheetInset());
    setTimeout(() => {
      if (document.activeElement !== node) return;
      const b = node.getBoundingClientRect();
      showTooltip(UI.tooltipNode(n.id, S.result, S.spof), b.right - 10, b.top + 10);
    }, 340);
  });
  svg.addEventListener("focusout", hideTooltip);

  /* ================= View modes ================= */
  function setMode(m) {
    S.mode = m;
    store.set("mode", m);
    document.querySelectorAll("[data-mode-btn]").forEach(b => b.setAttribute("aria-checked", String(b.getAttribute("data-mode-btn") === m)));
    paint();
  }
  document.querySelectorAll("[data-mode-btn]").forEach(b => b.addEventListener("click", () => setMode(b.getAttribute("data-mode-btn"))));

  /* ================= Layers popover ================= */
  const pop = $("#pop-layers"), btnLayers = $("#btn-layers");
  function closePopovers() {
    pop.hidden = true;
    btnLayers.setAttribute("aria-expanded", "false");
  }
  btnLayers.addEventListener("click", e => {
    e.stopPropagation();
    if (!pop.hidden) return closePopovers();
    pop.innerHTML = UI.layersPopover(S);
    pop.hidden = false;
    btnLayers.setAttribute("aria-expanded", "true");
    const first = pop.querySelector("button, input");
    if (first) first.focus({ preventScroll: true });
  });
  document.addEventListener("click", e => {
    if (!e.target.isConnected) return;   // element re-rendered inside the popover
    if (!e.target.closest(".popover") && !e.target.closest("#btn-layers")) closePopovers();
  });
  pop.addEventListener("click", e => {
    const b = e.target.closest("[data-vlan]");
    if (!b) return;
    const id = +b.getAttribute("data-vlan");
    S.vlan = S.vlan === id ? null : id;
    if (S.vlan) { S.spof = false; clearSelection(); }
    pop.innerHTML = UI.layersPopover(S);
    highlight();
    updateLayerState();
  });
  pop.addEventListener("change", e => {
    const k = e.target.getAttribute("data-toggle");
    if (!k) return;
    S[k] = e.target.checked;
    if (k === "spof" && S.spof) { S.vlan = null; clearSelection(); pop.innerHTML = UI.layersPopover(S); }
    paint();
    updateLayerState();
  });
  function updateLayerState() {
    btnLayers.querySelector(".count").hidden = !(S.vlan || S.spof);
    const chip = $("#overlay-chip");
    const label = S.vlan ? "VLAN " + S.vlan + " · " + M.vlans.find(v => v.id === S.vlan).name : S.spof ? "Resilience · single points of failure in red" : "";
    chip.hidden = !label;
    chip.querySelector("span").textContent = label;
  }
  $("#overlay-chip button").addEventListener("click", () => { S.vlan = null; S.spof = false; paint(); updateLayerState(); });

  $("#btn-about").addEventListener("click", () => {
    closePopovers();
    if (S.panel === "about") return clearSelection();
    S.sel = null; S.selLink = null;
    openPanel("about", UI.aboutPanel());
    highlight();
  });

  /* ================= Failure scenarios ================= */
  const dockItems = $("#dock .dock-items");
  dockItems.innerHTML = M.scenarios.map(sc =>
    '<button data-scenario="' + sc.id + '" aria-pressed="false" title="' + UI.esc(sc.title + " — " + sc.desc) + '" aria-label="' + UI.esc("Simulate: " + sc.title) + '">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + (R.icons[sc.icon] || R.icons.chip) + '"/></svg><span>' + UI.esc(sc.short) + "</span></button>").join("");
  dockItems.addEventListener("click", e => {
    const b = e.target.closest("[data-scenario]");
    if (!b) return;
    dismissHint();
    if (S.scenario && S.scenario.id === b.getAttribute("data-scenario")) endScenario();
    else startScenario(b.getAttribute("data-scenario"));
  });
  function syncDock() {
    dockItems.querySelectorAll("[data-scenario]").forEach(b =>
      b.setAttribute("aria-pressed", String(!!S.scenario && S.scenario.id === b.getAttribute("data-scenario"))));
  }

  function clearTimers() { timers.forEach(t => clearTimeout(t)); timers = []; }
  const fast = () => reduceMQ.matches;

  function reveal(from, to, done) {
    if (fast()) { S.shown = to; renderScenarioCard(); if (done) done(); return; }
    let i = from;
    const next = () => {
      S.shown = ++i; renderScenarioCard();
      if (i < to) timers.push(setTimeout(next, 900));
      else if (done) timers.push(setTimeout(done, 900));
    };
    timers.push(setTimeout(next, 250));
  }

  function startScenario(id) {
    clearTimers();
    const sc = M.scenarios.find(s => s.id === id);
    if (!sc) return;
    // clean starting state, then the failure
    S.scenario = null; S.detect = true; S.failover = false;
    compute();
    S.scenario = sc; S.shown = 0;
    syncDock();
    if (sc.views && sc.views.indexOf(S.mode) < 0) setMode(sc.views[0]);
    const ph0 = sc.steps.filter(s => s.ph === 0).length;
    S.detect = sc.recovery === "manual";
    $("#scenario-card").hidden = false;
    if (!V.userMoved) V.fit(true, panelInset(), cardInset());
    compute();
    reveal(0, ph0, () => {
      if (sc.recovery === "manual") { renderScenarioCard(); return; }
      S.detect = true; S.failover = true; compute();
      reveal(ph0, sc.steps.length);
    });
  }
  function manualRecovery() {   // for scenarios with recovery: "manual"
    const sc = S.scenario;
    if (!sc) return;
    clearTimers();
    S.failover = true; compute();
    reveal(sc.steps.filter(s => s.ph === 0).length, sc.steps.length);
  }
  function endScenario() {
    clearTimers();
    S.scenario = null; S.detect = true; S.failover = false;
    $("#scenario-card").hidden = true;
    syncDock();
    if (!V.userMoved) V.fit(true, panelInset(), 0);
    compute();
  }
  function renderScenarioCard() {
    const card = $("#scenario-card");
    if (!S.scenario) { card.hidden = true; return; }
    card.innerHTML = UI.scenarioCard(S.scenario, S.result, S.shown, S.failover);
  }
  $("#scenario-card").addEventListener("click", e => {
    if (e.target.closest("[data-sc-close]")) endScenario();
    else if (e.target.closest("[data-sc-replay]")) startScenario(S.scenario.id);
    else if (e.target.closest("[data-sc-manual]")) manualRecovery();
  });

  /* ================= Zoom, legend, hint ================= */
  $("#zoom-in").addEventListener("click", () => V.zoomAt(1.3, undefined, undefined, true));
  $("#zoom-out").addEventListener("click", () => V.zoomAt(1 / 1.3, undefined, undefined, true));
  $("#zoom-fit").addEventListener("click", () => V.fit(true, panelInset(), cardInset()));
  $("#btn-reset").addEventListener("click", () => {
    endScenario(); S.vlan = null; S.spof = false; clearSelection(); closePopovers();
    paint(); updateLayerState(); V.fit(true, 0, 0);
  });

  const legend = $("#legend"), legendBtn = $("#legend-toggle");
  function setLegend(open) {
    legend.classList.toggle("is-open", open);
    legendBtn.setAttribute("aria-expanded", String(open));
  }
  legendBtn.addEventListener("click", () => {
    const open = !legend.classList.contains("is-open");
    setLegend(open);
    store.set("legend", open ? "open" : "closed");
  });
  if (store.get("legend") === "open" && window.innerWidth > 760) setLegend(true);

  function dismissHint() {
    const h = $("#hint");
    if (h.hidden) return;
    h.classList.add("is-gone");
    setTimeout(() => { h.hidden = true; }, 400);
    store.set("hint", "seen");
  }
  if (store.get("hint") === "seen") $("#hint").hidden = true;
  else setTimeout(dismissHint, 9000);
  $("#hint").addEventListener("click", dismissHint);

  /* ================= Global keyboard ================= */
  document.addEventListener("keydown", e => {
    if (e.target.closest && e.target.closest("input, textarea")) return;
    if (e.key === "Escape") {
      if (!pop.hidden) return closePopovers();
      if (!clearSelection() && S.scenario) endScenario();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onNode = e.target.closest && e.target.closest(".node");
    const k = e.key;
    if (k === "1") setMode("network");
    else if (k === "2") setMode("power");
    else if (k === "3") setMode("full");
    else if (k === "+" || k === "=") V.zoomAt(1.25, undefined, undefined, true);
    else if (k === "-" || k === "_") V.zoomAt(0.8, undefined, undefined, true);
    else if (k === "0") V.fit(true, panelInset(), cardInset());
    else if (!onNode && k.indexOf("Arrow") === 0 && (e.target === document.body || e.target === svg)) {
      e.preventDefault();
      V.panBy(k === "ArrowLeft" ? 60 : k === "ArrowRight" ? -60 : 0, k === "ArrowUp" ? 60 : k === "ArrowDown" ? -60 : 0);
    } else return;
    dismissHint();
  });

  if (reduceMQ.addEventListener) reduceMQ.addEventListener("change", () => { S.motion = !reduceMQ.matches; paint(); });
  let rt = null;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (!V.userMoved) V.fit(false, panelInset(), cardInset()); }, 120); });

  // draw attention to the simulations: two red flashes shortly after load
  setTimeout(() => {
    const dock = $("#dock");
    dock.classList.add("is-attention");
    dock.addEventListener("animationend", e => { if (e.target === dock) dock.classList.remove("is-attention"); });
  }, 2000);

  /* ================= Start ================= */
  document.querySelectorAll("[data-mode-btn]").forEach(b => b.setAttribute("aria-checked", String(b.getAttribute("data-mode-btn") === S.mode)));
  compute();
  updateLayerState();
  V.fit(false);
  document.body.classList.add("is-ready");
})();
