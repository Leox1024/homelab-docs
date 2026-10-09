# DCB Infrastructure Map

An interactive map of the DCB infrastructure: network, power, compute, storage and failure simulations. Fully static (HTML, CSS, JavaScript, SVG), with no external dependencies and no build step.

> Pulses, LEDs and flows are illustrative: no live telemetry is connected.

Live at **https://docs.leox.me**.

## Publish on GitHub Pages

1. Create a repository and upload the **contents** of this folder to its root (`index.html` must be at the root).
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After a few minutes the site is live at `https://<user>.github.io/<repository>/`.

All paths are relative, so the site also works under a sub-path. `.nojekyll` disables Jekyll processing, and `CNAME` sets the custom domain (`docs.leox.me`).

## Run locally

Open `index.html` directly in a browser (scripts are classic scripts, so `file://` works), or:

```bash
python3 -m http.server 8000
```

## Structure

```
index.html              single page
css/style.css           interface (HUD, dock, panels, legend, responsive)
css/map.css             diagram and state styles
js/data-topology.js     nodes, positions, links, bands     ← edit this
js/data-model.js        workloads, VLANs, flows, scenarios  ← edit this
js/engine.js            dependency engine (power, CARP, WAN load balancing, quorum, workloads, paths)
js/render.js            SVG rendering with orthogonal routing
js/render-server.js     Proxmox node cards
js/flows.js             animated pulses along the computed paths
js/view.js              zoom, pan, pinch, fit to screen
js/ui.js                panel, tooltip and scenario content
js/app.js               interface state and interactions
```

## Updating the infrastructure

- **New device**: add an object to `nodes` in `js/data-topology.js` with `id`, `kind`, centre `cx/cy`, size `w/h` and the `role`/`info` texts.
- **New link**: add an object to `links` with `a`, `b`, `type` (`wan`, `lan`, `stack`, `ha`, `storage`, `tunnel`, `backup`, `replica`, `offsite`, `power`) and ports `pa`/`pb` (`["bottom", -40]` = bottom side, 40 px left of centre). `via` lists orthogonal moves: `{ y: 350 }` moves vertically to y=350, `{ x: 1000 }` moves horizontally to x=1000. LACP members share the same `bond` value (the node id).
- **New workload group**: add an entry to `services` in `js/data-model.js` with host and recovery mode (`replica`, `backup`, `none`).
- **WAN policy**: `gateways` in `js/data-model.js`. Same tier = load balancing; a higher tier number = backup only.
- **New scenario**: add an entry to `scenarios` with the `faults` (node or link ids) and the narrative steps. The consequences (paths, MASTER, active WANs, quorum, workloads) are computed by the engine, not drawn by hand.

After a change, bump `?v=` in `index.html` so browsers do not keep old files in cache.

## Interactions

- **Views**: Network · Power · Full (keys `1` `2` `3`).
- **Simulate failure** (bottom dock): WAN link, firewall, PVE01, power outage, switch unit, PVE02, UPS. In the PVE01 scenario Proxmox HA restarts the replicated workloads on PVE03 automatically.
- **Layers**: highlight a VLAN, resilience view (single points of failure), animations on/off.
- **Navigation**: drag or arrow keys to pan, wheel, pinch or `+`/`-` to zoom, `0` to fit. `Tab` moves between components, `Enter` opens details, `Esc` closes.
- With `prefers-reduced-motion` the pulses become static arrows.

## Design choices

1. **Dedicated WAN switches, not interconnected.** Each WAN has its own switch and each firewall connects to both, so a firewall failover never depends on a single WAN and a WAN failure never forces a firewall failover. A link between the two switches would add no path and would merge two failure domains.
2. **Dual WAN with load balancing plus failover.** Starlink and FWA sit in the same OPNsense gateway group: traffic is balanced across both and moves to the surviving link when monitoring detects a failure. This is routing, not LACP and not SD-WAN.
3. **WAN terminals in router mode**, offering a private transit network so both firewalls can share a CARP virtual address. Publishing is unaffected because services use outbound tunnels.
4. **OPNsense HA, active/passive.** CARP with preemption, pfsync and XMLRPC on a dedicated link. Both firewalls stay connected to both WANs and to the stack; only the MASTER forwards traffic.
5. **Stack + LACP.** The two Brocade units form one logical switch; every Proxmox node has an LACP bond with one member per unit, and both members carry traffic. This is not MLAG.
6. **Three-node cluster.** PVE03 adds capacity and a third quorum vote; Proxmox HA automatically restarts the replicated workloads of PVE01 on it if PVE01 fails.
7. **Backups in more than one place.** The backup server on PVE02 is copied to a secondary NAS on the network, whose emergency VMs give access to the backups if PVE02 stops, and monthly to an off-site NAS.
8. **Power.** Mains and an emergency diesel generator feed an online double-conversion UPS, which feeds a protected distribution for every device, WAN terminals included. The batteries only bridge the generator start-up.

Workloads are shown as generic groups on purpose: no VM names, addresses, ports or interface speeds are published.
