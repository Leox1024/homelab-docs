/* =====================================================================
   Homelab Docs — topology (target architecture)
   ---------------------------------------------------------------------
   WHAT exists and HOW it is connected. The diagram, dependencies and
   failure scenarios are all computed from this file: to change the
   infrastructure, edit nodes and links here.

   Coordinates: 1800 × 1312 world space. Each node has a centre (cx, cy)
   and a size (w, h). Link ports are [side, offset] from the centre of
   that side; "via" lists orthogonal moves ({x} = move horizontally,
   {y} = move vertically).
   ===================================================================== */
window.HomelabDocs = window.HomelabDocs || {};

HomelabDocs.topology = {
  meta: {
    name: "Homelab Docs",
    disclaimer: "Flows, pulses and LEDs are illustrative: no live telemetry is connected."
  },

  world: { w: 1800, h: 1330 },

  /* Horizontal bands that tell the story from the outside in */
  bands: [
    { id: "band-wan", n: "01", title: "Internet access", sub: ["Dual WAN · load balanced"],
      members: ["starlink", "fwa", "wsw1", "wsw2"], x0: 440, x1: 1360, gutter: true },
    { id: "band-fw", n: "02", title: "Security & routing", sub: ["OPNsense HA · CARP"],
      members: ["opn01", "opn02"], x0: 440, x1: 1360, gutter: true },
    { id: "band-lan", n: "03", title: "VLAN switching", sub: ["Brocade · 2-unit stack"],
      members: ["b1", "b2"], x0: 440, x1: 1360, gutter: true },
    { id: "band-cmp", n: "04", title: "Compute & storage", sub: ["Proxmox VE cluster · 3 nodes"],
      members: ["pve01", "pve03", "pve02", "jbod"], padTop: 50, gutter: false },
    { id: "band-pwr", n: "05", title: "Power", sub: ["Mains + diesel generator", "online UPS"],
      members: ["grid", "gen", "ups", "pdu"], x0: 40, padTop: 10, padBottom: 10, gutter: true }
  ],

  nodes: [
    /* ---------- External ---------- */
    { id: "internet", kind: "cloud", label: "Internet", sub: "public network",
      cx: 900, cy: 64, w: 240, h: 64, layer: "ext",
      role: "Reached through two independent access links",
      info: [
        { h: "Role", p: "Public network, reached through two independent links (Starlink and FWA) that are used at the same time." },
        { h: "Publishing", p: "No inbound ports are opened on the WAN: services are published through tunnels initiated from the inside." }
      ] },

    { id: "cloudflare", kind: "ext", icon: "cloud", label: "Cloudflare Tunnel", sub: "web publishing",
      cx: 560, cy: 64, w: 190, h: 54, layer: "ext",
      role: "Publishes web services without open WAN ports",
      info: [
        { h: "Role", p: "Cloudflare edge that receives web requests and forwards them through an outbound tunnel to an endpoint on PVE01." },
        { h: "During failures", li: [
          "WAN link down: the tunnel re-establishes over the remaining link.",
          "PVE01 down: the tunnel returns once the publishing endpoints are started on PVE03."
        ] }
      ] },

    { id: "vps", kind: "ext", icon: "server", label: "VPS · FRP", sub: "TCP/UDP publishing",
      cx: 1240, cy: 64, w: 190, h: 54, layer: "ext",
      role: "Publishes individual TCP/UDP ports with a static IPv4",
      info: [
        { h: "Role", p: "Cloud VPS with a static IPv4 running an FRP server: individual TCP/UDP ports are exposed through an outbound tunnel." },
        { h: "External monitoring", p: "Also watches the services from outside, so outages remain visible even when the site is unreachable." }
      ] },

    { id: "offsite", kind: "ext", icon: "archive", label: "Off-site NAS", sub: "monthly copy",
      cx: 1610, cy: 64, w: 190, h: 54, layer: "ext",
      role: "Off-site tier of the backup strategy",
      info: [
        { h: "Role", p: "Storage datasets are replicated every month to a NAS outside the infrastructure." },
        { h: "Why it matters", p: "It is the only copy that survives the loss of the whole rack." }
      ] },

    /* ---------- 01 · Internet access ---------- */
    { id: "starlink", kind: "carrier", icon: "satellite", label: "Starlink", sub: "satellite", wanTag: "WAN 1",
      cx: 720, cy: 192, w: 210, h: 60,
      role: "Satellite Internet access · load balanced",
      info: [
        { h: "Role", p: "Satellite Internet access, independent from FWA. Both links are active: OPNsense balances traffic across them and moves everything to the surviving link if one fails." },
        { h: "Connection", p: "The provider terminal stays in router mode and offers a private transit network on WAN SW 1, shared by both firewalls through a CARP virtual address." }
      ] },

    { id: "fwa", kind: "carrier", icon: "antenna", label: "FWA", sub: "fixed wireless access", wanTag: "WAN 2",
      cx: 1080, cy: 192, w: 210, h: 60,
      role: "Fixed wireless Internet access · load balanced",
      info: [
        { h: "Role", p: "Fixed wireless access (external antenna and SIM), independent from Starlink. Active at the same time as Starlink: load balancing plus failover." },
        { h: "Connection", p: "Provider terminal in router mode with a private transit network on WAN SW 2, shared by both firewalls through CARP." }
      ] },

    { id: "wsw1", kind: "wansw", label: "WAN SW 1", sub: "Starlink segment",
      cx: 720, cy: 300, w: 200, h: 46,
      role: "Brings WAN 1 to both firewalls",
      info: [
        { h: "Role", p: "Dedicated to WAN 1 only: delivers Starlink to both OPNsense 01 and OPNsense 02 on an isolated L2 segment." },
        { h: "Why it is not linked to WAN SW 2", li: [
          "Each firewall is already connected to both WAN switches, so a link between them would add no path.",
          "The switch shares the failure domain of its own WAN: losing it equals losing Starlink, which the gateway group already handles.",
          "Interconnecting them would merge two L2 domains or require a trunk, with no benefit."
        ] }
      ] },

    { id: "wsw2", kind: "wansw", label: "WAN SW 2", sub: "FWA segment",
      cx: 1080, cy: 300, w: 200, h: 46,
      role: "Brings WAN 2 to both firewalls",
      info: [
        { h: "Role", p: "Dedicated to WAN 2 only: delivers FWA to both firewalls on an isolated L2 segment." },
        { h: "Independence", p: "No link to WAN SW 1: the two WANs remain separate failure domains." }
      ] },

    /* ---------- 02 · Security & routing ---------- */
    { id: "opn01", kind: "firewall", label: "OPNsense 01", sub: "Sophos · primary",
      cx: 720, cy: 452, w: 230, h: 78,
      ports: ["WAN1", "WAN2", "LAN", "SYNC"],
      role: "Firewall, router and VLAN gateway · CARP MASTER",
      info: [
        { h: "Role", p: "Firewall, router and gateway for every VLAN. Under normal conditions it is the CARP MASTER, handles all traffic and balances it across both WANs." },
        { h: "Interfaces", li: [
          "WAN 1 → WAN SW 1 (Starlink)",
          "WAN 2 → WAN SW 2 (FWA)",
          "LAN → 802.1Q trunk to stack unit 1",
          "SYNC → direct link to OPNsense 02"
        ] },
        { h: "High availability", li: [
          "CARP with preemption: if any CARP interface loses link, the node gives up all virtual addresses together.",
          "pfsync replicates the state table, so existing connections survive a failover.",
          "XMLRPC keeps the configuration in sync from primary to secondary."
        ] }
      ] },

    { id: "opn02", kind: "firewall", label: "OPNsense 02", sub: "Sophos · secondary",
      cx: 1080, cy: 452, w: 230, h: 78,
      ports: ["WAN1", "WAN2", "LAN", "SYNC"],
      role: "Secondary firewall · CARP BACKUP",
      info: [
        { h: "Role", p: "BACKUP node: connected to both WANs and to the stack, receives states (pfsync) and configuration (XMLRPC), ready to become MASTER." },
        { h: "Interfaces", li: [
          "WAN 1 → WAN SW 1 · WAN 2 → WAN SW 2",
          "LAN → 802.1Q trunk to stack unit 2",
          "SYNC → direct link to OPNsense 01"
        ] }
      ] },

    /* ---------- 03 · VLAN switching ---------- */
    { id: "b1", kind: "switch", unit: 1, label: "Brocade SW1", sub: "24 ports · unit 1",
      cx: 720, cy: 612, w: 240, h: 64,
      role: "Stack unit 1",
      info: [
        { h: "Role", p: "Unit 1 of the switch stack. Carries every VLAN." },
        { h: "Stack", p: "Both units form a single logical switch: one control plane, one configuration." },
        { h: "Connections", li: [
          "802.1Q trunk from OPNsense 01.",
          "One member of the LACP bond of each Proxmox node.",
          "Part of the access devices (PoE)."
        ] }
      ] },

    { id: "b2", kind: "switch", unit: 2, label: "Brocade SW2", sub: "24 ports · unit 2",
      cx: 1080, cy: 612, w: 240, h: 64,
      role: "Stack unit 2",
      info: [
        { h: "Role", p: "Unit 2 of the switch stack. Together with unit 1 it forms a single logical switch." },
        { h: "Connections", li: [
          "802.1Q trunk from OPNsense 02.",
          "The second member of the LACP bond of each Proxmox node.",
          "Part of the access devices (PoE)."
        ] }
      ] },

    { id: "access", kind: "access", label: "Access devices", sub: "Wi-Fi · IoT · CCTV",
      cx: 1500, cy: 532, w: 200, h: 66,
      role: "Clients on the stack access ports",
      info: [
        { h: "Role", p: "Access points, cameras and IoT devices connected to the access ports of the stack." },
        { h: "Redundancy", p: "Each device has a single link and depends on the stack unit it is plugged into. Critical devices are spread across both units." },
        { h: "Power", p: "PoE devices are powered by the switch and inherit its UPS protection." }
      ] },

    /* ---------- 04 · Compute & storage ---------- */
    { id: "pve01", kind: "server", label: "PVE01", sub: "Primary compute node", model: "HPE ProLiant",
      cx: 470, cy: 885, w: 440, h: 250,
      pools: [ { name: "system", topo: "mirror", disks: 2, kind: "ssd" },
               { name: "VMs", topo: "striped mirror", disks: 4, kind: "ssd" } ],
      tree: [
        ["Compute", ["Most production workloads", "publishing · applications · management · development"]],
        ["Storage", ["System pool · ZFS mirror", "VM pool · ZFS striped mirror"]],
        ["Network", ["LACP bond across both stack units", "VLAN-aware bridge"]],
        ["Protection", ["Daily backup to the backup server", "Selected workloads replicated to PVE03 (HA)"]]
      ],
      role: "Main compute node",
      info: [
        { h: "Role", p: "Runs most of the workloads: service publishing, applications, management and development." },
        { h: "Network", p: "LACP bond with one member on each stack unit: both links carry traffic, and losing one only reduces bandwidth." },
        { h: "Local storage", li: [ "System pool · ZFS mirror", "VM pool · ZFS striped mirror" ] },
        { h: "Management", p: "Out-of-band management through HPE iLO." }
      ] },

    { id: "pve03", kind: "server", label: "PVE03", sub: "Secondary compute node",
      cx: 900, cy: 885, w: 300, h: 250, recovery: true,
      pools: [ { name: "local storage", topo: "ZFS", abstract: true } ],
      tree: [
        ["Compute", ["Secondary node, similar to PVE01", "automatic failover target for PVE01"]],
        ["Network", ["LACP bond across both stack units"]],
        ["Cluster", ["Third quorum vote"]]
      ],
      role: "Secondary compute node and recovery target",
      info: [
        { h: "Role", p: "Smaller third node, similar to PVE01. It adds compute capacity and a third quorum vote to the cluster." },
        { h: "If PVE01 fails", p: "Proxmox HA automatically restarts the replicated workloads (publishing, web applications, network services) on PVE03. The rest is restored from backup or waits for PVE01." },
        { h: "Network", p: "LACP bond with one member on each stack unit." }
      ] },

    { id: "pve02", kind: "server", label: "PVE02", sub: "Storage & backup node",
      cx: 1330, cy: 885, w: 440, h: 250,
      pools: [ { name: "system", topo: "mirror", disks: 2, kind: "ssd" },
               { name: "VMs", topo: "mirror", disks: 2, kind: "ssd" } ],
      protection: ["Periodic snapshots", "SSD → HDD tier replication", "Monthly off-site copy"],
      tree: [
        ["Compute", ["NAS storage · backup server · other VMs"]],
        ["Storage", ["System and VM pools · ZFS mirror", "External disk enclosure for the NAS"]],
        ["Network", ["LACP bond across both stack units"]],
        ["Protection", ["Snapshots, tier replication, off-site copy"]]
      ],
      role: "Storage, backup and NAS",
      info: [
        { h: "Role", p: "Hosts the NAS (ZFS pools on the external disk enclosure) and the backup server that protects every VM and container." },
        { h: "Data chain", p: "VMs and containers → backup server → datastore on the NAS SSD tier → replicated to the HDD tier → copy on the secondary NAS → monthly off-site copy." },
        { h: "If PVE02 fails", p: "The secondary NAS keeps a copy of the backups and runs emergency VMs that give access to them." },
        { h: "Local storage", li: [ "System pool · ZFS mirror", "VM pool · ZFS mirror" ] }
      ] },

    { id: "jbod", kind: "jbod", label: "Disk enclosure", sub: "6 disks · SSD and HDD tiers",
      cx: 1330, cy: 1087, w: 320, h: 84,
      pools: [ { name: "SSD tier", topo: "RAIDZ1", disks: 3, kind: "ssd" },
               { name: "HDD tier", topo: "RAIDZ1", disks: 3, kind: "hdd" } ],
      role: "NAS data · SSD tier and HDD tier",
      info: [
        { h: "Pools", li: [ "SSD tier · 3 disks in RAIDZ1 (hot data, backup datastore)", "HDD tier · 3 disks in RAIDZ1 (replica of the SSD tier)" ] },
        { h: "Data protection", li: [ "Periodic snapshots", "Weekly replication SSD tier → HDD tier", "Weekly scrubs and S.M.A.R.T. tests", "Monthly copy to the off-site NAS" ] }
      ] },

    { id: "nas2", kind: "nas", label: "Secondary NAS", sub: "backup copy", sub2: "emergency VMs",
      cx: 1628, cy: 885, w: 124, h: 104,
      role: "Backup copy with emergency access",
      info: [
        { h: "Role", p: "A second NAS on the network. It keeps its own copy of the backups and runs a few VMs that give emergency access to them if PVE02 is unavailable." },
        { h: "Not the off-site copy", p: "It sits on the local network; the off-site NAS is a separate, remote copy." }
      ] },

    /* ---------- 05 · Power ---------- */
    { id: "grid", kind: "grid", layer: "power", label: "Mains", sub: "power input",
      cx: 300, cy: 1226, w: 170, h: 44,
      role: "Power input",
      info: [ { h: "Role", p: "Power input to the rack." } ] },

    { id: "gen", kind: "generator", layer: "power", label: "Diesel generator", sub: "emergency power",
      cx: 300, cy: 1282, w: 170, h: 44,
      role: "Emergency power upstream of the UPS",
      info: [
        { h: "Role", p: "Emergency diesel generator upstream of the UPS. When mains fails it takes over the UPS input, so the UPS batteries only bridge the start-up." },
        { h: "Capacity", p: "3 kW, about 12 hours of runtime on a full tank (always kept full)." },
        { h: "Result", p: "A mains outage does not drain the UPS: equipment keeps running on generator power." }
      ] },

    { id: "ups", kind: "ups", layer: "power", label: "UPS", sub: "online double conversion",
      cx: 590, cy: 1252, w: 240, h: 84,
      role: "Online double-conversion UPS",
      info: [
        { h: "How it works", p: "Online double conversion: equipment always runs from the inverter, so switching to battery causes no interruption." },
        { h: "Internal fault", p: "The UPS switches to bypass: equipment keeps running directly from mains, without protection." },
        { h: "Battery runtime", p: "About 2–2.5 hours, far more than the generator needs to start." },
        { h: "Inputs", p: "Fed by mains and, during an outage, by the diesel generator." }
      ] },

    { id: "pdu", kind: "pdu", layer: "power", label: "Rack distribution", sub: "UPS outlets + PDU",
      cx: 900, cy: 1252, w: 200, h: 52,
      role: "Protected distribution downstream of the UPS",
      info: [
        { h: "Role", p: "Distributes UPS-protected power to every device in the rack, including the WAN terminals." },
        { h: "Good practice", p: "Redundant pairs (OPNsense 01/02, stack units) should not depend on the same power strip." }
      ] }
  ],

  /* ---------------------------------------------------------------------
     Links. type: wan · lan · stack · ha · storage · tunnel
                  backup · replica · offsite (logical) · power
     --------------------------------------------------------------------- */
  links: [
    /* Internet → access links */
    { id: "l-inet-sl", a: "internet", b: "starlink", type: "wan", pa: ["bottom", -50], pb: ["top", 0], via: [{ y: 130 }, { x: 720 }] },
    { id: "l-inet-fwa", a: "internet", b: "fwa", type: "wan", pa: ["bottom", 50], pb: ["top", 0], via: [{ y: 130 }, { x: 1080 }] },
    { id: "l-cf", a: "cloudflare", b: "internet", type: "tunnel", pa: ["right", 0], pb: ["left", 0],
      label: { t: "tunnel", x: 717, y: 55 }, note: "Tunnel initiated outbound from a publishing endpoint: no open WAN ports." },
    { id: "l-vps", a: "vps", b: "internet", type: "tunnel", pa: ["left", 0], pb: ["right", 0],
      label: { t: "tunnel", x: 1083, y: 55 }, note: "FRP tunnel initiated outbound towards the VPS." },

    /* Access links → WAN switches */
    { id: "l-sl-wsw1", a: "starlink", b: "wsw1", type: "wan", pa: ["bottom", 0], pb: ["top", 0], note: "WAN 1 transit network (terminal in router mode)." },
    { id: "l-fwa-wsw2", a: "fwa", b: "wsw2", type: "wan", pa: ["bottom", 0], pb: ["top", 0], note: "WAN 2 transit network (terminal in router mode)." },

    /* WAN switches → firewalls: each firewall reaches both WANs */
    { id: "l-wsw1-opn1", a: "wsw1", b: "opn01", type: "wan", pa: ["bottom", -40], pb: ["top", -40], note: "WAN 1 of OPNsense 01." },
    { id: "l-wsw2-opn2", a: "wsw2", b: "opn02", type: "wan", pa: ["bottom", 40], pb: ["top", 40], note: "WAN 2 of OPNsense 02." },
    { id: "l-wsw1-opn2", a: "wsw1", b: "opn02", type: "wan", pa: ["bottom", 40], pb: ["top", -80], via: [{ y: 350 }, { x: 1000 }], note: "WAN 1 of OPNsense 02." },
    { id: "l-wsw2-opn1", a: "wsw2", b: "opn01", type: "wan", pa: ["bottom", -20], pb: ["top", 80], via: [{ y: 378 }, { x: 800 }], note: "WAN 2 of OPNsense 01." },

    /* HA */
    { id: "l-ha", a: "opn01", b: "opn02", type: "ha", pa: ["right", 0], pb: ["left", 0],
      label: { t: "HA SYNC", x: 900, y: 444 }, label2: { t: "pfsync · XMLRPC", x: 900, y: 469 },
      note: "Dedicated direct link for pfsync (state table) and XMLRPC (configuration). CARP advertisements travel on every shared network (WAN 1, WAN 2, VLANs)." },

    /* Firewalls → stack */
    { id: "l-opn1-b1", a: "opn01", b: "b1", type: "lan", pa: ["bottom", 0], pb: ["top", 0], vlans: "all",
      label: { t: "802.1Q trunk", x: 728, y: 552, anchor: "start" }, note: "802.1Q trunk carrying every VLAN to unit 1." },
    { id: "l-opn2-b2", a: "opn02", b: "b2", type: "lan", pa: ["bottom", 0], pb: ["top", 0], vlans: "all",
      note: "802.1Q trunk carrying every VLAN to unit 2. Connected and ready: it carries traffic as soon as OPNsense 02 becomes MASTER." },

    /* Stacking (ring of two cables) */
    { id: "l-stack-a", a: "b1", b: "b2", type: "stack", pa: ["right", -12], pb: ["left", -12], vlans: "all",
      label: { t: "STACK", x: 900, y: 592 }, note: "Stacking link: both units act as one logical switch. This is neither an LACP bundle nor MLAG." },
    { id: "l-stack-b", a: "b1", b: "b2", type: "stack", pa: ["right", 12], pb: ["left", 12], vlans: "all",
      note: "Second stacking link (ring topology): losing one cable does not split the stack." },

    /* Stack → Proxmox: LACP bonds with one member per stack unit */
    { id: "l-b1-pve1", a: "b1", b: "pve01", type: "lan", bond: "pve01", pa: ["bottom", -100], pb: ["top", 150], vlans: "all",
      label: { t: "LACP · both units", x: 612, y: 734, anchor: "end" }, note: "Member 1 of the PVE01 LACP bond." },
    { id: "l-b2-pve1", a: "b2", b: "pve01", type: "lan", bond: "pve01", pa: ["bottom", -100], pb: ["top", 190], via: [{ y: 690 }, { x: 660 }], vlans: "all",
      note: "Member 2 of the PVE01 LACP bond, on the other stack unit." },
    { id: "l-b1-pve3", a: "b1", b: "pve03", type: "lan", bond: "pve03", pa: ["bottom", 60], pb: ["top", -120], vlans: "all",
      note: "Member 1 of the PVE03 LACP bond." },
    { id: "l-b2-pve3", a: "b2", b: "pve03", type: "lan", bond: "pve03", pa: ["bottom", -60], pb: ["top", 120], vlans: "all",
      note: "Member 2 of the PVE03 LACP bond, on the other stack unit." },
    { id: "l-b1-pve2", a: "b1", b: "pve02", type: "lan", bond: "pve02", pa: ["bottom", 100], pb: ["top", -190], via: [{ y: 672 }, { x: 1140 }], vlans: "all",
      note: "Member 1 of the PVE02 LACP bond." },
    { id: "l-b2-pve2", a: "b2", b: "pve02", type: "lan", bond: "pve02", pa: ["bottom", 100], pb: ["top", -150], vlans: "all",
      label: { t: "LACP · both units", x: 1188, y: 734, anchor: "start" }, note: "Member 2 of the PVE02 LACP bond, on the other stack unit." },

    /* Stack → access devices (single ports, PoE) */
    { id: "l-b1-acc", a: "b1", b: "access", type: "lan", poe: true, pa: ["top", 70], pb: ["left", -12], via: [{ y: 520 }], vlans: [20, 30, 90],
      note: "Access ports on unit 1 (PoE)." },
    { id: "l-b2-acc", a: "b2", b: "access", type: "lan", poe: true, pa: ["top", 90], pb: ["left", 13], via: [{ y: 545 }], vlans: [20, 30, 90],
      note: "Access ports on unit 2 (PoE)." },

    /* Storage */
    { id: "l-pve2-jbod", a: "pve02", b: "jbod", type: "storage", pa: ["bottom", 0], pb: ["top", 0],
      note: "Direct link between PVE02 and the disk enclosure; the disks are used by the NAS." },

    /* Secondary NAS on the network */
    { id: "l-b2-nas2", a: "b2", b: "nas2", type: "lan", pa: ["right", -12], pb: ["top", 0], via: [{ x: 1628 }],
      note: "Secondary NAS on the local network." },

    /* Logical data-protection relationships (not cables) */
    { id: "l-repl", a: "pve01", b: "pve03", type: "replica", logical: true, pa: ["right", 0], pb: ["left", 0],
      label: { t: "replica", x: 720, y: 877 }, note: "Scheduled replication of the critical workloads from PVE01 to PVE03, so they can be started there if PVE01 fails." },
    { id: "l-bkp", a: "pve01", b: "pve02", type: "backup", logical: true, pa: ["bottom", 100], pb: ["left", 100], via: [{ y: 1080 }, { x: 1080 }],
      label: { t: "daily backup", x: 790, y: 1072 }, note: "Daily backup of PVE01 VMs and containers to the backup server on PVE02. Physically it travels through the stack and the firewall (routed between VLANs)." },
    { id: "l-bkp3", a: "pve03", b: "pve02", type: "backup", logical: true, pa: ["right", 60], pb: ["left", 60],
      note: "Daily backup of PVE03 to the backup server on PVE02." },
    { id: "l-bkp-nas2", a: "pve02", b: "nas2", type: "backup", logical: true, pa: ["right", 0], pb: ["left", 0],
      note: "Backups are also copied to the secondary NAS." },
    { id: "l-offsite", a: "jbod", b: "offsite", type: "offsite", logical: true, pa: ["right", 0], pb: ["right", 0], via: [{ x: 1760 }, { y: 64 }],
      label: { t: "monthly off-site copy", x: 1776, y: 640, rotate: -90 }, note: "Monthly replication of the storage datasets to the off-site NAS." },

    /* Power */
    { id: "p-grid-ups", a: "grid", b: "ups", type: "power", pa: ["right", 0], pb: ["left", -14], via: [{ x: 430 }, { y: 1238 }] },
    { id: "p-gen-ups", a: "gen", b: "ups", type: "power", pa: ["right", 0], pb: ["left", 14], via: [{ x: 430 }, { y: 1266 }],
      note: "Takes over the UPS input when mains fails." },
    { id: "p-ups-pdu", a: "ups", b: "pdu", type: "power", pa: ["right", 0], pb: ["left", 0], label: { t: "protected", x: 755, y: 1243 } },
    { id: "p-pve1", a: "pdu", b: "pve01", type: "power", pa: ["top", -40], pb: ["left", 0], via: [{ y: 1186 }, { x: 210 }] },
    { id: "p-b1", a: "pdu", b: "b1", type: "power", pa: ["top", -40], pb: ["left", 22], via: [{ y: 1186 }, { x: 210 }] },
    { id: "p-opn1", a: "pdu", b: "opn01", type: "power", pa: ["top", -40], pb: ["left", 26], via: [{ y: 1186 }, { x: 210 }] },
    { id: "p-wsw1", a: "pdu", b: "wsw1", type: "power", pa: ["top", -40], pb: ["left", 14], via: [{ y: 1186 }, { x: 210 }] },
    { id: "p-sl", a: "pdu", b: "starlink", type: "power", pa: ["top", -40], pb: ["left", 20], via: [{ y: 1186 }, { x: 210 }] },
    { id: "p-pve3", a: "pdu", b: "pve03", type: "power", pa: ["top", 0], pb: ["bottom", 0] },
    { id: "p-pve2", a: "pdu", b: "pve02", type: "power", pa: ["right", 0], pb: ["bottom", -180], via: [{ x: 1150 }] },
    { id: "p-jbod", a: "pdu", b: "jbod", type: "power", pa: ["right", 0], pb: ["bottom", 0], via: [{ x: 1330 }] },
    { id: "p-b2", a: "pdu", b: "b2", type: "power", pa: ["right", 0], pb: ["right", 22], via: [{ x: 1712 }] },
    { id: "p-opn2", a: "pdu", b: "opn02", type: "power", pa: ["right", 0], pb: ["right", 26], via: [{ x: 1712 }] },
    { id: "p-wsw2", a: "pdu", b: "wsw2", type: "power", pa: ["right", 0], pb: ["right", 14], via: [{ x: 1712 }] },
    { id: "p-fwa", a: "pdu", b: "fwa", type: "power", pa: ["right", 0], pb: ["right", 20], via: [{ x: 1712 }] }
  ],

  /* Fixed labels along the power spines */
  powerLabels: [
    { t: "protected distribution", x: 198, y: 640, rotate: -90 },
    { t: "protected distribution", x: 1726, y: 700, rotate: 90 }
  ]
};
