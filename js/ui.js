/* =====================================================================
   DCB Infrastructure Map — interface content
   ---------------------------------------------------------------------
   Pure functions that build the HTML for the side panel, tooltips and
   scenario card from the data and the engine result.
   ===================================================================== */
window.DCB = window.DCB || {};

DCB.ui = (function () {
  "use strict";
  const T = DCB.topology, M = DCB.model, E = DCB.engine;
  const esc = s => String(s === undefined || s === null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const KIND = {
    cloud: "Public network", ext: "External service", carrier: "Internet access", wansw: "WAN switch",
    firewall: "Firewall / router", switch: "VLAN switch", access: "Clients", server: "Proxmox VE node",
    jbod: "Storage", nas: "Storage", grid: "Power", generator: "Power", ups: "Power", pdu: "Power"
  };

  const LINK_TYPES = {
    wan:     { label: "WAN", desc: "Internet side: provider terminal, WAN switch and firewall." },
    lan:     { label: "LAN · 802.1Q trunk", desc: "Internal network: carries the VLANs between firewalls, stack and servers." },
    stack:   { label: "Stacking", desc: "Stacking link between the switch units: they act as one logical switch." },
    ha:      { label: "HA sync", desc: "Dedicated link between the firewalls for pfsync and XMLRPC." },
    storage: { label: "Storage", desc: "Direct link to the disk enclosure." },
    tunnel:  { label: "Publishing tunnel", desc: "Tunnel initiated from the inside towards an external service: no open WAN ports." },
    backup:  { label: "Backup (logical)", desc: "Data-protection relationship; physically it travels over the network." },
    replica: { label: "Replication (logical)", desc: "Scheduled replication of VM disks; physically it travels over the network." },
    offsite: { label: "Off-site copy (logical)", desc: "Replication to an external site over the Internet." },
    power:   { label: "Power", desc: "Power feed from the protected distribution to the device." }
  };

  const STATE_CHIP = {
    master: ["MASTER", "ok"], backup: ["BACKUP", "idle"], active: ["ACTIVE", "ok"], standby: ["STANDBY", "idle"],
    isolated: ["ISOLATED", "bad"], down: ["FAILED", "bad"], off: ["OFF", "bad"], degraded: ["DEGRADED", "warn"],
    orphan: ["NO HOST", "warn"], online: ["ONLINE", "ok"], battery: ["ON BATTERY", "power"], bypass: ["BYPASS", "warn"],
    starting: ["STARTING", "warn"], running: ["RUNNING", "ok"]
  };

  function chipFor(n, st) {
    if (n.kind === "cloud" || n.kind === "ext" || n.kind === "pdu") return null;
    const s = st.state;
    if (n.kind === "carrier" && s === "active") return ["IN USE", "ok"];
    if (n.kind === "carrier" && s === "isolated") return ["UNREACHABLE", "warn"];
    if (n.kind === "access" && s === "degraded") return ["PARTIAL", "warn"];
    if (n.kind === "server" && s === "degraded") return ["1 OF 2 LINKS", "warn"];
    if (n.kind === "grid") return s === "active" ? ["PRESENT", "ok"] : ["LOST", "bad"];
    return STATE_CHIP[s] || [s.toUpperCase(), "idle"];
  }

  function sentence(n, st) {
    const s = st.state;
    if (s === "down") return "Simulated failure: the component is unavailable.";
    if (s === "off") return "No power.";
    switch (n.kind) {
      case "firewall":
        return s === "master" ? "CARP MASTER: holds the virtual addresses and forwards all traffic."
          : "CARP BACKUP: connected, synchronised and ready to take over." + (st.flags.demoted ? " One interface has lost link, so the node has given up priority." : "");
      case "carrier":
        return s === "active" ? "Carrying traffic in the load-balancing group." : s === "standby" ? "Available in the gateway group." : "Not reachable from the MASTER firewall.";
      case "server":
        return s === "active" ? "Running, with both bond members carrying traffic." : s === "degraded" ? "Running on a single bond member: less bandwidth, no interruption." : "Isolated from the network.";
      case "access":
        return s === "degraded" ? "Some devices are isolated: they were plugged into the failed unit." : "Devices reachable.";
      case "jbod":
        return s === "orphan" ? "Powered but without a host: the pools are not accessible." : "Pools available to the NAS.";
      case "ups":
        return { online: "Feeding the equipment from the inverter; batteries charging.", battery: "Running on battery: about " + M.power.upsRuntime.replace("~", "") + " of runtime, while the generator starts.", bypass: "Bypass: equipment runs directly from mains, without protection." }[s] || "";
      case "grid": return "Mains power present.";
      case "generator":
        return { standby: "Standing by: mains is present.", starting: "Starting after the mains outage; the UPS bridges the gap on battery.", running: "Running: feeding the UPS input in place of mains (" + M.power.genRating + ", " + M.power.genRuntime + ")." }[s] || "";
      case "nas": return "Holding a copy of the backups; emergency VMs ready.";
      default: return "Operational in the model.";
    }
  }

  function powerText(id, r) {
    const p = r.power[id];
    if (!p) return "";
    const map = { online: "UPS protected", battery: "UPS battery", bypass: "Mains via UPS bypass (unprotected)", grid: "Mains", off: "None" };
    let t = map[p.feed] || p.feed;
    if (p.poe) t += " · PoE from the stack";
    return t;
  }

  function powerChain(id) {
    const names = [];
    let cur = id, guard = 0;
    while (guard++ < 8) {
      const l = T.links.find(x => x.b === cur && (x.type === "power" || x.poe));
      if (!l) break;
      names.push(E.nodeById[l.a].label);
      cur = l.a;
    }
    return names;
  }

  function resilienceOf(id) {
    const R = M.resilience;
    const f = (list, label, cls) => { const x = list.find(e => e.id === id); return x ? { label: label, cls: cls, t: x.t } : null; };
    return f(R.spof, "Single point of failure", "bad") || f(R.partial, "Partial redundancy", "warn") || f(R.redundant, "Redundant", "ok");
  }

  const stateChip = c => c ? '<span class="state-chip ' + c[1] + '">' + esc(c[0]) + "</span>" : "";

  const SVC_STATUS = {
    running: ["running", "ok"], recovered: ["running on PVE03", "rec"], ready: ["restarting on PVE03", "ready"],
    restorable: ["restorable from backup", "idle"], degraded: ["degraded", "warn"], down: ["stopped", "bad"]
  };

  function servicesHtml(n, r) {
    const list = M.services.filter(s => s.host === n.id);
    const moved = M.services.filter(s => s.host !== n.id && r.services[s.id].on === n.id);
    if (!list.length && !moved.length) return "";
    const item = s => {
      const st = r.services[s.id], ss = SVC_STATUS[st.status] || [st.status, "idle"];
      return '<li class="svc-item"><span class="svc-bar rec-' + s.recovery + '"></span><div><div class="svc-name">' + esc(s.name) +
        ' <span class="svc-status ' + ss[1] + '">' + esc(ss[0]) + '</span></div><div class="svc-role">' + esc(s.role) + "</div>" +
        '<div class="svc-dep">' + esc(M.recoveryLabels[s.recovery]) + (s.depsNote ? " · " + esc(s.depsNote) : "") + "</div></div></li>";
    };
    let h = '<section class="p-sec"><h3>Workloads</h3>';
    if (list.length) h += '<ul class="svc-list">' + list.map(item).join("") + "</ul>";
    if (moved.length) h += '<div class="svc-group">Taken over from PVE01</div><ul class="svc-list">' + moved.map(item).join("") + "</ul>";
    return h + "</section>";
  }

  function infoHtml(info) {
    return (info || []).map(sec => '<section class="p-sec"><h3>' + esc(sec.h) + "</h3>" +
      (sec.p ? "<p>" + esc(sec.p) + "</p>" : "") + (sec.li ? "<ul>" + sec.li.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") + "</section>").join("");
  }

  function linksHtml(id, r) {
    const rows = E.adj[id].map(l => {
      const o = E.nodeById[E.other(l, id)], st = r.links[l.id];
      const cls = st && (st.up ? "ok" : "bad");
      return '<li><button class="link-row" data-goto-link="' + l.id + '"><span class="lt lt-' + l.type + '"></span><span>' + esc(LINK_TYPES[l.type].label) +
        '</span><span class="arrow">→</span><strong>' + esc(o.label) + '</strong><span class="dot ' + cls + '"></span></button></li>';
    }).join("");
    return '<section class="p-sec"><h3>Connections</h3><ul class="link-list">' + rows + "</ul></section>";
  }

  function nodePanel(id, r) {
    const n = E.nodeById[id], st = r.nodes[id];
    const chain = powerChain(id);
    let h = '<header class="p-head"><div class="p-kind">' + esc(KIND[n.kind] || "") + "</div><h2>" + esc(n.label) + "</h2>" +
      '<div class="p-sub">' + esc(n.model ? n.model + " · " : "") + esc(n.sub || "") + '</div><div class="p-tags">' + stateChip(chipFor(n, st)) + "</div></header>";
    h += '<section class="p-sec p-live"><h3>Current state</h3><p>' + esc(sentence(n, st)) + "</p>";
    if (r.power[id].feed !== "ext") h += '<div class="kv"><span>Power</span><span>' + esc(powerText(id, r)) + "</span></div>";
    if (chain.length) h += '<div class="kv"><span>Fed by</span><span>' + chain.map(esc).join(" ← ") + "</span></div>";
    if (n.kind === "server") h += '<div class="kv"><span>Quorum</span><span>' + r.quorum.votes + "/" + r.quorum.total + " votes · " + (r.quorum.quorate ? "quorate" : "lost") + "</span></div>";
    h += "</section>";
    const res = resilienceOf(id);
    if (res) h += '<section class="p-sec"><h3>Resilience ' + stateChip([res.label.toUpperCase(), res.cls]) + "</h3><p>" + esc(res.t) + "</p></section>";
    h += infoHtml(n.info);
    if (n.kind === "server") h += servicesHtml(n, r);
    h += linksHtml(id, r);
    return h;
  }

  function linkPanel(id, r) {
    const l = E.linkById[id], A = E.nodeById[l.a], B = E.nodeById[l.b], st = r.links[id], lt = LINK_TYPES[l.type];
    const stTxt = l.type === "power"
      ? ({ online: "Protected", battery: "On battery", bypass: "UPS bypass", grid: "Live", dead: "No power", standby: "Standby", starting: "Starting" }[st.state] || st.state)
      : (st.up ? (st.state === "active" ? "Active" : "Connected") : "Down");
    const flows = (st.flows || []).map(fid => M.flows.find(f => f.id === fid)).filter(Boolean);
    let h = '<header class="p-head"><div class="p-kind">Link · ' + esc(lt.label) + "</div><h2>" + esc(A.label) + ' <span class="arrow">→</span> ' + esc(B.label) + "</h2>" +
      '<div class="p-tags"><span class="state-chip ' + (st.up ? "ok" : st.state === "standby" ? "idle" : "bad") + '">' + esc(stTxt.toUpperCase()) + "</span></div></header>";
    h += '<section class="p-sec"><h3>Type</h3><p>' + esc(lt.desc) + "</p>" + (l.note ? "<p>" + esc(l.note) + "</p>" : "") + "</section>";
    if (l.vlans) h += '<section class="p-sec"><h3>VLANs</h3><p>' + (l.vlans === "all" ? "All VLANs (802.1Q trunk)." : l.vlans.map(v => "VLAN " + v).join(" · ")) + "</p></section>";
    if (l.poe) h += '<section class="p-sec"><h3>PoE</h3><p>The same cable can also power the device: in Power mode it appears as a power link.</p></section>';
    if (flows.length) h += '<section class="p-sec"><h3>Illustrative flows</h3><ul>' + flows.map(f => "<li>" + esc(f.label) + "</li>").join("") + "</ul></section>";
    h += '<section class="p-sec"><div class="p-ends"><button class="link-row" data-goto="' + l.a + '">' + esc(A.label) + '</button><button class="link-row" data-goto="' + l.b + '">' + esc(B.label) + "</button></div></section>";
    return h;
  }

  function aboutPanel() {
    let h = '<header class="p-head"><div class="p-kind">About this map</div><h2>Design choices</h2><div class="p-sub">' + esc(T.meta.disclaimer) + "</div></header>";
    h += '<section class="p-sec"><h3>How to read it</h3><ul>' +
      "<li>Blue lines carry data, amber lines carry power.</li>" +
      "<li>Moving pulses show logical traffic paths. They are illustrative, not live telemetry.</li>" +
      "<li>Use <strong>Simulate</strong> to see how the infrastructure reacts when a component fails.</li></ul></section>";
    h += M.decisions.map((d, i) => '<section class="p-sec decision"><h3><span class="num">' + String(i + 1).padStart(2, "0") + "</span>" + esc(d.h) + "</h3><p>" + esc(d.p) + "</p></section>").join("");
    return h;
  }

  function tooltipNode(id, r, showRes) {
    const n = E.nodeById[id], st = r.nodes[id];
    let h = '<div class="tt-head"><strong>' + esc(n.label) + "</strong>" + stateChip(chipFor(n, st)) + '</div><div class="tt-role">' + esc(n.role) + "</div>";
    const res = showRes && resilienceOf(id);
    if (res) h += '<div class="tt-res ' + res.cls + '"><strong>' + esc(res.label) + "</strong> · " + esc(res.t) + "</div>";
    if (n.tree) h += '<ul class="tt-tree">' + n.tree.map(t => "<li><span>" + esc(t[0]) + "</span><ul>" + t[1].map(x => "<li>" + esc(x) + "</li>").join("") + "</ul></li>").join("") + "</ul>";
    return h + '<div class="tt-hint">Click for details</div>';
  }

  function tooltipLink(id) {
    const l = E.linkById[id];
    return '<div class="tt-head"><strong>' + esc(LINK_TYPES[l.type].label) + '</strong></div><div class="tt-role">' + esc(E.nodeById[l.a].label) + " → " + esc(E.nodeById[l.b].label) + "</div>" +
      (l.note ? '<div class="tt-note">' + esc(l.note) + "</div>" : "");
  }

  const RECOVERY_KIND = { auto: "automatic reaction", manual: "operator action", none: "no automatic recovery", standby: "backup copy available" };

  function counts(r) {
    const c = { on: 0, deg: 0, off: 0 };
    M.services.forEach(s => { const st = r.services[s.id].status; if (st === "running" || st === "recovered") c.on++; else if (st === "degraded") c.deg++; else c.off++; });
    return c;
  }

  function modelRows(r) {
    const c = counts(r), ups = r.nodes.ups.state, gen = r.nodes.gen ? r.nodes.gen.state : "standby";
    const wans = r.activeWans.filter(w => r.up[w]);
    return [
      ["WAN in use", wans.length ? wans.map(w => E.nodeById[w].label).join(" + ") : "none", wans.length > 1 ? "ok" : wans.length ? "warn" : "bad"],
      ["Firewall MASTER", r.master && r.up[r.master] ? E.nodeById[r.master].label : "none", r.master && r.up[r.master] ? "ok" : "bad"],
      ["Cluster quorum", r.quorum.votes + "/" + r.quorum.total + (r.quorum.quorate ? " · quorate" : " · lost"), r.quorum.quorate ? (r.quorum.votes < r.quorum.total ? "warn" : "ok") : "bad"],
      ["Workload groups", c.on + " running" + (c.deg ? " · " + c.deg + " degraded" : "") + (c.off ? " · " + c.off + " stopped" : ""), c.off || c.deg ? "warn" : "ok"],
      ["UPS", { online: "online", battery: "on battery", bypass: "bypass", off: "off" }[ups] + " · " + M.power.upsRuntime + " battery", ups === "online" ? "ok" : ups === "battery" ? "power" : "warn"],
      ["Diesel generator", gen + " · " + M.power.genRating + ", ~12 h", gen === "running" ? "ok" : gen === "starting" ? "warn" : "idle"]
    ];
  }

  function scenarioCard(sc, r, shown, manual) {
    const steps = sc.steps.map((s, i) => '<li class="ph' + s.ph + (i < shown ? " is-on" : "") + '">' + esc(s.t) + "</li>").join("");
    const rows = modelRows(r).map(x => '<div class="mrow"><span>' + esc(x[0]) + '</span><span class="mval ' + x[2] + '">' + esc(x[1]) + "</span></div>").join("");
    const needManual = sc.recovery === "manual" && !manual && shown >= sc.steps.filter(s => s.ph === 0).length;
    return '<div class="sc-head"><div><div class="sc-kicker">Simulation · ' + esc(RECOVERY_KIND[sc.recovery]) + "</div><h3>" + esc(sc.title) +
      '</h3></div><button class="icon-btn" data-sc-close aria-label="End simulation"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<ol class="sc-steps">' + steps + "</ol>" +
      '<div class="sc-model">' + rows + "</div>" +
      '<div class="sc-actions">' + (needManual ? '<button class="btn primary" data-sc-manual>' + esc(sc.manualLabel || "Recover") + "</button>" : "") +
      '<button class="btn" data-sc-replay>Replay</button><button class="btn" data-sc-close>End</button></div>';
  }

  function layersPopover(state) {
    const vl = M.vlans.map(v => '<button class="vlan-chip' + (state.vlan === v.id ? " is-on" : "") + '" data-vlan="' + v.id + '" style="--c:' + v.color + '"' +
      (v.note ? ' title="' + esc(v.note) + '"' : "") + '><span class="sw"></span><span class="vid">' + v.id + "</span>" + esc(v.name) + "</button>").join("");
    const tg = (key, label, desc) => '<label class="toggle"><input type="checkbox" data-toggle="' + key + '"' + (state[key] ? " checked" : "") + '><span class="tg"></span><span><strong>' + esc(label) + "</strong><small>" + esc(desc) + "</small></span></label>";
    return '<div class="pop-title">Highlight a VLAN</div><div class="vlan-grid">' + vl + "</div>" +
      '<div class="pop-sep"></div>' +
      tg("spof", "Resilience", "Single points of failure and redundant components") +
      tg("motion", "Animated flows", "Pulses along the active links");
  }

  return {
    esc: esc, chipFor: chipFor, nodePanel: nodePanel, linkPanel: linkPanel, aboutPanel: aboutPanel,
    tooltipNode: tooltipNode, tooltipLink: tooltipLink, scenarioCard: scenarioCard, layersPopover: layersPopover
  };
})();
