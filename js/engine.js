/* =====================================================================
   Homelab Docs — dependency engine
   ---------------------------------------------------------------------
   From topology + model + simulated faults it computes: power, node
   states, CARP MASTER, active WANs, cluster quorum, workload states and
   the paths of the illustrative flows. No telemetry: it is an
   architectural model.
   ===================================================================== */
window.HomelabDocs = window.HomelabDocs || {};

HomelabDocs.engine = (function () {
  "use strict";
  const T = HomelabDocs.topology, M = HomelabDocs.model;

  const nodeById = {}, linkById = {}, svcById = {};
  T.nodes.forEach(n => { nodeById[n.id] = n; });
  T.links.forEach(l => { linkById[l.id] = l; });
  M.services.forEach(s => { svcById[s.id] = s; });

  const adj = {};
  T.nodes.forEach(n => { adj[n.id] = []; });
  T.links.forEach(l => { adj[l.a].push(l); adj[l.b].push(l); });

  const powerIn = {}, poeIn = {};
  T.links.forEach(l => {
    if (l.type === "power") (powerIn[l.b] = powerIn[l.b] || []).push(l);
    if (l.poe) (poeIn[l.b] = poeIn[l.b] || []).push(l);
  });

  const tierOf = {};
  M.gateways.forEach(g => { tierOf[g.node] = g.tier; });

  const TRANSIT = { wan: 1, lan: 1, tunnel: 1, stack: 3 };   // hop costs
  const INTERNAL = { lan: 1, stack: 1 };                       // internal network (quorum)

  const other = (l, id) => (l.a === id ? l.b : l.a);
  const kindOf = id => nodeById[id].kind;

  /* ---------------- Power ---------------- */
  /* started = the backup generator has had time to start (reaction phase) */
  function computePower(faults, started) {
    const P = {};
    const gridUp = T.nodes.some(n => n.kind === "grid" && !faults.has(n.id));
    function visit(id) {
      if (P[id]) return P[id];
      const n = nodeById[id];
      let r;
      if (n.kind === "grid") {
        r = faults.has(id) ? { powered: false, feed: "off" } : { powered: true, feed: "grid" };
      } else if (n.kind === "generator") {
        // stands by while mains is present, starts when it is lost
        r = faults.has(id) ? { powered: false, feed: "off" }
          : gridUp ? { powered: false, feed: "standby" }
          : started ? { powered: true, feed: "gen" } : { powered: false, feed: "starting" };
      } else if (n.kind === "ups") {
        const inOk = (powerIn[id] || []).some(l => visit(l.a).powered && !faults.has(l.id));
        const broken = faults.has(id);
        const feed = broken ? (inOk ? "bypass" : "off") : (inOk ? "online" : "battery");
        r = { powered: feed !== "off", feed: feed };
      } else if (powerIn[id]) {
        const src = powerIn[id].find(l => visit(l.a).powered && !faults.has(l.id));
        r = src ? { powered: true, feed: P[src.a].feed === "grid" || P[src.a].feed === "gen" ? "online" : P[src.a].feed } : { powered: false, feed: "off" };
      } else if (poeIn[id]) {
        const srcs = poeIn[id].filter(l => visit(l.a).powered && !faults.has(l.a) && !faults.has(l.id));
        r = srcs.length ? { powered: true, feed: P[srcs[0].a].feed, poe: true } : { powered: false, feed: "off", poe: true };
      } else {
        r = { powered: true, feed: "ext" };   // outside the electrical perimeter
      }
      P[id] = r;
      return r;
    }
    T.nodes.forEach(n => visit(n.id));
    return P;
  }

  /* ---------------- Graph helpers ---------------- */
  function reach(src, dst, linkOk, nodeOk) {
    const seen = new Set([src]), q = [src];
    while (q.length) {
      const cur = q.shift();
      if (cur === dst) return true;
      for (const l of adj[cur]) {
        if (!linkOk(l)) continue;
        const nx = other(l, cur);
        if (seen.has(nx) || !nodeOk(nx)) continue;
        seen.add(nx); q.push(nx);
      }
    }
    return false;
  }

  /* Dijkstra over physical links. ctx.carriers = WANs allowed for transit,
     ctx.avoid = links to skip (used to pin a flow to one bond member). */
  function shortestPath(src, dst, ctx) {
    if (!src || !dst) return null;
    if (src === dst) return [];
    const dist = {}, prev = {}, done = new Set();
    dist[src] = 0;
    const allowed = id => {
      if (id === src || id === dst) return true;
      if (!ctx.up[id]) return false;
      const k = kindOf(id);
      if (k === "firewall") return id === ctx.master;
      if (k === "carrier") return ctx.carriers.indexOf(id) >= 0;
      return k === "cloud" || k === "wansw" || k === "switch";
    };
    while (true) {
      let cur = null, best = Infinity;
      for (const id in dist) if (!done.has(id) && dist[id] < best) { best = dist[id]; cur = id; }
      if (cur === null) return null;
      if (cur === dst) break;
      done.add(cur);
      for (const l of adj[cur]) {
        const cost = TRANSIT[l.type];
        if (!cost || !ctx.linkUp[l.id] || (ctx.avoid && ctx.avoid.has(l.id))) continue;
        const nx = other(l, cur);
        if (!allowed(nx)) continue;
        const d = best + cost;
        if (dist[nx] === undefined || d < dist[nx]) { dist[nx] = d; prev[nx] = { l: l, from: cur }; }
      }
    }
    const steps = [];
    let at = dst;
    while (at !== src) { const p = prev[at]; steps.unshift({ l: p.l.id, dir: p.l.a === p.from ? 1 : -1 }); at = p.from; }
    return steps;
  }

  /* ---------------- Roles: CARP and gateway group ---------------- */
  function carpMaster(up, linkUp) {
    let best = null, bestDem = Infinity;
    M.carp.forEach(fw => {
      if (!up[fw]) return;
      const dem = adj[fw].filter(l => (l.type === "wan" || l.type === "lan") && !linkUp[l.id]).length;
      if (dem < bestDem) { best = fw; bestDem = dem; }
    });
    return best;
  }

  function usableWans(master, up, linkUp) {
    if (!master) return [];
    return M.gateways.slice().sort((a, b) => a.tier - b.tier).map(g => g.node).filter(c =>
      up[c] && reach(master, c, l => l.type === "wan" && linkUp[l.id],
        id => id === c || id === master || kindOf(id) === "wansw"));
  }

  /* Load balancing: every usable WAN in the best available tier is active */
  function activeSet(usable) {
    if (!usable.length) return [];
    const t = tierOf[usable[0]];
    return usable.filter(c => tierOf[c] === t);
  }

  /* ---------------- Quorum ---------------- */
  function computeQuorum(up, linkUp) {
    const comp = {};
    let k = 0;
    T.nodes.forEach(n => {
      if (comp[n.id] !== undefined || !up[n.id]) return;
      const q = [n.id]; comp[n.id] = k;
      while (q.length) {
        const cur = q.shift();
        adj[cur].forEach(l => {
          if (!INTERNAL[l.type] || !linkUp[l.id]) return;
          const nx = other(l, cur);
          if (comp[nx] === undefined && up[nx]) { comp[nx] = k; q.push(nx); }
        });
      }
      k++;
    });
    const voters = M.cluster.voters;
    const votes = {};
    voters.forEach(v => { if (up[v]) votes[comp[v]] = (votes[comp[v]] || 0) + 1; });
    let bestComp = null, bestVotes = 0;
    Object.keys(votes).forEach(c => { if (votes[c] > bestVotes) { bestVotes = votes[c]; bestComp = +c; } });
    const need = Math.floor(voters.length / 2) + 1;
    const reachable = {};
    voters.forEach(v => { reachable[v] = !!up[v] && comp[v] === bestComp && bestVotes >= 2; });
    return { votes: bestVotes, total: voters.length, need: need, quorate: bestVotes >= need, reachable: reachable };
  }

  /* ---------------- Workloads ---------------- */
  function computeServices(up, quorum, failover) {
    const S = {};
    const rh = M.cluster.recoveryHost;
    M.services.forEach(s => {
      if (up[s.host]) S[s.id] = { status: "running", on: s.host };
      else if (s.recovery === "replica" && s.host !== rh && up[rh] && quorum.quorate)
        S[s.id] = failover ? { status: "recovered", on: rh } : { status: "ready", on: null };
      else S[s.id] = { status: "down", on: null };
    });
    M.services.forEach(s => {
      if (S[s.id].on && (s.depsNodes || []).some(n => !up[n])) S[s.id].status = "degraded";
    });
    for (let i = 0; i < 2; i++) {
      M.services.forEach(s => {
        const st = S[s.id];
        if (!st.on || st.status === "degraded") return;
        if ((s.deps || []).some(d => !S[d].on || S[d].status === "degraded")) st.status = "degraded";
      });
    }
    const bk = S[M.protection.backupService];
    const copy = M.protection.backupCopyHost;
    const backupOk = (bk && bk.on && bk.status !== "degraded") || !!(copy && up[copy]);
    M.services.forEach(s => {
      if (!S[s.id].on && S[s.id].status === "down" && s.recovery === "backup" && !up[s.host])
        S[s.id].status = backupOk ? "restorable" : "down";
    });
    return S;
  }

  /* ---------------- Main computation ---------------- */
  const baselineRoles = (function () {
    const P = computePower(new Set(), true);
    const up = {}, linkUp = {};
    T.nodes.forEach(n => { up[n.id] = P[n.id].powered; });
    T.links.forEach(l => { linkUp[l.id] = up[l.a] && up[l.b]; });
    const master = carpMaster(up, linkUp);
    return { master: master, activeWans: activeSet(usableWans(master, up, linkUp)) };
  })();

  /**
   * opts.faults : array/Set of failed ids (nodes or links)
   * opts.detect   : false → detection phase: roles frozen as before the failure,
   *                  generator still starting
   * opts.failover : true  → replicated workloads restarted on the recovery host
   */
  function compute(opts) {
    opts = opts || {};
    const faults = new Set(opts.faults || []);
    const detect = opts.detect !== false;
    const P = computePower(faults, detect);

    const up = {};
    T.nodes.forEach(n => { up[n.id] = n.kind === "ups" ? P[n.id].powered : (!faults.has(n.id) && P[n.id].powered); });

    const linkUp = {};
    T.links.forEach(l => {
      if (l.type === "power") linkUp[l.id] = P[l.a].powered && !faults.has(l.id);
      else if (!l.logical) linkUp[l.id] = up[l.a] && up[l.b] && !faults.has(l.id);
    });

    const liveMaster = carpMaster(up, linkUp);
    const liveUsable = usableWans(liveMaster, up, linkUp);
    const master = detect ? liveMaster : baselineRoles.master;
    const activeWans = detect ? activeSet(liveUsable) : baselineRoles.activeWans;
    // during detection, WANs not yet re-evaluated stay "standby"
    const usable = detect ? liveUsable : M.gateways.map(g => g.node).filter(c => up[c]);

    const quorum = computeQuorum(up, linkUp);
    const services = computeServices(up, quorum, !!opts.failover);
    const S = services;
    const running = id => S[id] && S[id].on && S[id].status !== "degraded";

    // Logical data-protection relationships
    T.links.forEach(l => {
      if (!l.logical) return;
      if (l.type === "backup") linkUp[l.id] = up[l.a] && up[l.b] && running(M.protection.backupService);
      else if (l.type === "replica") linkUp[l.id] = up[l.a] && up[l.b];
      else if (l.type === "offsite") linkUp[l.id] = !!(S[M.protection.nasService] && S[M.protection.nasService].on) && up[l.a];
    });

    // Illustrative flows
    const ctx = { up: up, linkUp: linkUp, master: master, carriers: activeWans };
    const endOf = e => {
      if (e.node) return up[e.node] ? e.node : null;
      const st = S[e.service];
      return st && st.on && up[st.on] ? st.on : null;
    };
    // LACP: lane i uses bond member i of the destination
    const bondAvoid = (dst, i) => {
      if (!dst) return null;
      const members = adj[dst].filter(l => l.bond === dst && linkUp[l.id]);
      if (members.length < 2) return null;
      const keep = members[i % members.length];
      return new Set(members.filter(l => l !== keep).map(l => l.id));
    };
    const flows = [], returns = [];
    M.flows.forEach(f => {
      if (f.returnOf) { returns.push(f); return; }
      if (f.link) { flows.push({ id: f.id, def: f, steps: linkUp[f.link] ? [{ l: f.link, dir: 1 }] : null }); return; }
      const a = endOf(f.from), b = endOf(f.to);
      const lanes = f.wan && activeWans.length > 1 ? activeWans : [null];
      lanes.forEach((wan, i) => {
        const lctx = Object.assign({}, ctx, { carriers: wan ? [wan] : activeWans, avoid: bondAvoid(b, i) });
        let steps = null;
        if (a && b) {
          if (f.routed) {
            const p1 = master && up[master] ? shortestPath(a, master, lctx) : null;
            const p2 = p1 ? shortestPath(master, b, lctx) : null;
            steps = p1 && p2 ? p1.concat(p2) : null;
          } else steps = shortestPath(a, b, lctx);
        }
        flows.push({ id: lanes.length > 1 ? f.id + "#" + i : f.id, def: f, steps: steps, lanes: lanes.length });
      });
    });

    // return traffic: same pair of devices, opposite direction, on the parallel link
    returns.forEach(f => {
      let d = 0;
      flows.some(fl => (fl.steps || []).some(st => (st.l === f.returnOf ? (d = st.dir, true) : false)));
      flows.push({ id: f.id, def: f, steps: d && linkUp[f.link] ? [{ l: f.link, dir: -d }] : null });
    });

    const linkFlows = {};
    flows.forEach(fl => (fl.steps || []).forEach(s => {
      const list = linkFlows[s.l] = linkFlows[s.l] || [];
      if (list.indexOf(fl.def.id) < 0) list.push(fl.def.id);
    }));

    // Link states
    const links = {};
    T.links.forEach(l => {
      if (l.type === "power") {
        const src = P[l.a].feed;
        links[l.id] = { up: linkUp[l.id], state: src === "standby" || src === "starting" ? src : !linkUp[l.id] ? "dead" : (src === "grid" || src === "gen" ? "grid" : src) };
      } else {
        const act = (linkFlows[l.id] || []).length > 0;
        links[l.id] = { up: !!linkUp[l.id], state: !linkUp[l.id] ? "down" : (act ? "active" : "idle"), flows: linkFlows[l.id] || [] };
      }
    });

    // Node states
    const nodes = {};
    T.nodes.forEach(n => {
      const p = P[n.id];
      const flags = { battery: p.feed === "battery", bypass: p.feed === "bypass" };
      let state;
      if (n.kind === "ups") state = p.feed === "off" ? "off" : p.feed;
      else if (n.kind === "generator") state = faults.has(n.id) ? "down" : ({ standby: "standby", starting: "starting", gen: "running" }[p.feed] || "standby");
      else if (faults.has(n.id)) state = "down";
      else if (!p.powered) state = "off";
      else {
        const lanLinks = adj[n.id].filter(l => l.type === "lan");
        const upCount = lanLinks.filter(l => linkUp[l.id]).length;
        switch (n.kind) {
          case "firewall":
            state = n.id === master ? "master" : "backup";
            flags.demoted = adj[n.id].some(l => (l.type === "wan" || l.type === "lan") && !linkUp[l.id]);
            break;
          case "carrier":
            state = activeWans.indexOf(n.id) >= 0 ? "active" : (usable.indexOf(n.id) >= 0 ? "standby" : "isolated");
            break;
          case "access":
          case "server":
            state = upCount === lanLinks.length ? "active" : (upCount > 0 ? "degraded" : "isolated");
            break;
          case "jbod": state = up.pve02 ? "active" : "orphan"; break;
          default: state = "active";
        }
      }
      nodes[n.id] = { state: state, up: up[n.id], powered: p.powered, feed: p.feed, flags: flags };
    });

    return {
      faults: faults, detect: detect, failover: !!opts.failover,
      nodes: nodes, links: links, services: services, flows: flows,
      master: master, activeWans: activeWans, quorum: quorum, power: P, up: up
    };
  }

  /* ---------------- Dependencies for highlighting ---------------- */
  function related(id) {
    const nodes = new Set([id]), links = new Set();
    adj[id].forEach(l => { links.add(l.id); nodes.add(other(l, id)); });
    // upstream power chain
    const seen = new Set([id]), stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      (powerIn[cur] || []).concat(poeIn[cur] || []).forEach(l => {
        links.add(l.id);
        nodes.add(l.a);
        if (!seen.has(l.a)) { seen.add(l.a); stack.push(l.a); }
      });
    }
    return { nodes: nodes, links: links };
  }

  return {
    compute: compute, related: related, baselineRoles: baselineRoles,
    nodeById: nodeById, linkById: linkById, svcById: svcById, adj: adj, other: other
  };
})();
