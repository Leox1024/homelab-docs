/* =====================================================================
   Homelab Docs — logical model
   ---------------------------------------------------------------------
   Workloads, VLANs, redundancy rules, illustrative flows, scenarios and
   design notes. engine.js combines these rules with the topology to
   compute states, paths and the consequences of each failure.
   ===================================================================== */
window.HomelabDocs = window.HomelabDocs || {};

HomelabDocs.model = {
  /* OPNsense gateway group: same tier = load balancing, lower tier = higher priority */
  gateways: [
    { node: "starlink", tier: 1 },
    { node: "fwa", tier: 1 }
  ],

  /* CARP priority order (lowest advskew first) */
  carp: ["opn01", "opn02"],

  /* Backup power figures shown in panels and in the simulation card */
  power: { upsRuntime: "~2–2.5 h", genRating: "3 kW", genRuntime: "~12 h on a full tank" },

  /* Proxmox cluster: voting nodes and the node that takes over replicated workloads */
  cluster: { voters: ["pve01", "pve02", "pve03"], recoveryHost: "pve03" },

  /* Services used by the data-protection relationships */
  protection: { backupService: "bkp", nasService: "nas", backupCopyHost: "nas2" },

  /* ------------------------------------------------------------------
     Workload groups (deliberately generic). recovery = what happens if
     the host fails:
       replica → replicated to the recovery host, restarted there by HA
       backup  → restored from the backup server (slower)
       none    → paused until the host returns
     ------------------------------------------------------------------ */
  services: [
    { id: "pub", name: "Publishing", role: "Tunnel endpoints for published services", host: "pve01", recovery: "replica" },
    { id: "web", name: "Web apps", role: "File sharing and collaboration", host: "pve01", recovery: "replica",
      deps: ["nas"], depsNote: "data stored on the NAS" },
    { id: "net", name: "Network services", role: "Remote access VPN and Wi-Fi controller", host: "pve01", recovery: "replica" },
    { id: "ctr", name: "Containers", role: "Production container hosts", host: "pve01", recovery: "backup" },
    { id: "mon", name: "Monitoring", role: "Service and network monitoring", host: "pve01", recovery: "backup" },
    { id: "auto", name: "Automation", role: "Scheduled maintenance and configuration", host: "pve01", recovery: "backup" },
    { id: "dev", name: "Development", role: "Development environments", host: "pve01", recovery: "none" },
    { id: "lab", name: "Lab & desktops", role: "Lab services and desktop VMs", host: "pve01", recovery: "none" },

    { id: "nas", name: "NAS storage", role: "ZFS pools on the disk enclosure", host: "pve02", recovery: "none", depsNodes: ["jbod"] },
    { id: "bkp", name: "Backup server", role: "Backups of every VM and container", host: "pve02", recovery: "none",
      deps: ["nas"], depsNote: "backup datastore on the NAS SSD tier" },
    { id: "other", name: "Other VMs", role: "General-purpose virtual machines", host: "pve02", recovery: "none" }
  ],

  recoveryLabels: {
    replica: "Replicated · restarts automatically on PVE03",
    backup: "Restored from backup",
    none: "Paused until the node returns"
  },

  /* VLANs (VLAN 1 is the switch default and is not routed) */
  vlans: [
    { id: 10, name: "Server", color: "#60a5fa", nodes: ["pve01", "pve02", "pve03"], note: "Proxmox management" },
    { id: 20, name: "Guest", color: "#f472b6", nodes: ["pve01", "pve02", "pve03", "access"] },
    { id: 30, name: "IoT", color: "#a3e635", nodes: ["access"] },
    { id: 40, name: "Production", color: "#22d3ee", nodes: ["pve01", "pve02", "pve03"] },
    { id: 50, name: "Management", color: "#e879f9", nodes: ["pve01", "pve02", "pve03"] },
    { id: 60, name: "Storage", color: "#34d399", nodes: ["pve01", "pve02", "pve03"] },
    { id: 70, name: "Development", color: "#facc15", nodes: ["pve01", "pve02", "pve03"] },
    { id: 80, name: "Kubernetes", color: "#818cf8", nodes: ["pve01", "pve02", "pve03"] },
    { id: 90, name: "CCTV", color: "#fb7185", nodes: ["pve01", "pve02", "pve03", "access"] },
    { id: 100, name: "DMZ", color: "#fb923c", nodes: ["pve01", "pve03"], note: "Publishing endpoints" }
  ],

  /* ------------------------------------------------------------------
     Illustrative flows (NOT telemetry). from/to: node or service.
     wan: true    → spread across every active WAN (load balancing)
     routed: true → goes through the CARP MASTER (inter-VLAN routing)
     returnOf     → runs on "link" opposite to the traffic crossing "returnOf"
     Flows towards a bonded node alternate between bond members (LACP).
     ------------------------------------------------------------------ */
  flows: [
    { id: "f-web", label: "Web services published through Cloudflare Tunnel", from: { node: "cloudflare" }, to: { service: "pub" }, wan: true, color: "tunnel", modes: ["network", "full"] },
    { id: "f-frp", label: "TCP/UDP ports published through FRP", from: { node: "vps" }, to: { service: "pub" }, wan: true, color: "tunnel", modes: ["network", "full"], density: 0.6 },
    { id: "f-cli", label: "Client Internet traffic", from: { node: "internet" }, to: { node: "access" }, wan: true, color: "wan", modes: ["network", "full"] },
    { id: "f-app", label: "Workload Internet traffic", from: { node: "internet" }, to: { service: "ctr" }, wan: true, color: "lan", modes: ["network", "full"], density: 0.7 },
    { id: "f-bkp", label: "Nightly backup (routed between VLANs)", from: { node: "pve01" }, to: { service: "bkp" }, routed: true, color: "backup", modes: ["full"], density: 0.7 },
    { id: "f-sync", label: "HA state synchronisation (pfsync)", link: "l-ha", bidir: true, color: "ha", modes: ["network", "full"], density: 0.5 },
    { id: "f-stack-ret", label: "Return traffic across the stack", link: "l-stack-b", returnOf: "l-stack-a", color: "lan", modes: ["network", "full"], density: 0.8 }
  ],

  /* ------------------------------------------------------------------
     Failure scenarios. faults = failed nodes or links.
     recovery: auto (reacts on its own) · manual (operator action)
               · none (no recovery mechanism)
     Each step belongs to phase 0 (failure) or 1 (reaction).
     views: modes in which the scenario makes sense.
     ------------------------------------------------------------------ */
  scenarios: [
    { id: "wan", key: "A", short: "WAN", icon: "antenna", title: "WAN link failure", desc: "The FWA link goes down", teaser: "What happens if an Internet link drops?",
      faults: ["fwa"], recovery: "auto", views: ["network", "full"], focus: ["fwa", "starlink", "wsw1", "opn01"],
      steps: [
        { ph: 0, t: "The FWA link stops responding." },
        { ph: 0, t: "Sessions balanced onto FWA are interrupted; traffic on Starlink keeps flowing." },
        { ph: 1, t: "Gateway monitoring removes FWA from the load-balancing group." },
        { ph: 1, t: "All traffic now leaves through Starlink. OPNsense 01 stays MASTER: a WAN failure does not trigger a firewall failover." },
        { ph: 1, t: "Interrupted sessions reconnect; the Cloudflare and FRP tunnels re-establish on their own." }
      ] },

    { id: "fw", key: "B", short: "Firewall", icon: "shield", title: "Firewall failure", desc: "OPNsense 01 stops", teaser: "What happens if the main firewall dies?",
      faults: ["opn01"], recovery: "auto", views: ["network", "full"], focus: ["opn01", "opn02", "l-ha"],
      steps: [
        { ph: 0, t: "OPNsense 01 stops and its CARP advertisements cease." },
        { ph: 0, t: "Traffic going through the primary node is interrupted." },
        { ph: 1, t: "OPNsense 02 takes over every virtual address (WAN 1, WAN 2, VLANs) and becomes MASTER." },
        { ph: 1, t: "The state table is already in sync through pfsync: existing connections carry on." },
        { ph: 1, t: "Traffic flows through OPNsense 02 and stack unit 2, still balanced across both WANs." }
      ] },

    { id: "pve01", key: "C", short: "PVE01", icon: "server", title: "PVE01 failure", desc: "The primary compute node stops", teaser: "What happens if the main server dies?",
      faults: ["pve01"], recovery: "auto", views: ["full"], focus: ["pve01", "pve03"],
      steps: [
        { ph: 0, t: "PVE01 stops: its workloads go offline." },
        { ph: 0, t: "The cluster keeps quorum with PVE02 and PVE03 (2 of 3 votes)." },
        { ph: 1, t: "Proxmox HA detects the failure and automatically restarts the replicated workloads on PVE03." },
        { ph: 1, t: "Part of the load now runs on PVE03: publishing, web apps and network services (data written after the last replication is lost)." },
        { ph: 1, t: "The remaining workloads are restored from backup or wait for PVE01." }
      ] },

    { id: "power", key: "D", short: "Power", icon: "bolt", title: "Power outage", desc: "Mains power is lost", teaser: "What happens during a power cut?",
      faults: ["grid"], recovery: "auto", views: ["power", "full"], focus: ["grid", "ups", "pdu"],
      steps: [
        { ph: 0, t: "Mains power is lost." },
        { ph: 0, t: "The online UPS moves to battery with no interruption (about 2–2.5 h of runtime) while the diesel generator starts." },
        { ph: 1, t: "The 3 kW generator takes over the UPS input (about 12 h on a full tank): the UPS leaves battery mode and keeps running." },
        { ph: 1, t: "Everything on the protected distribution stays up, WAN terminals included; PoE devices stay powered by the stack." }
      ] },

    { id: "lan", key: "E", short: "Switch", icon: "switch", title: "Switch unit failure", desc: "Brocade SW1 stops",
      faults: ["b1"], recovery: "auto", views: ["network", "full"], focus: ["b1", "b2", "opn01", "opn02"],
      steps: [
        { ph: 0, t: "Stack unit 1 stops; unit 2 keeps running as a reduced stack." },
        { ph: 0, t: "Every Proxmox bond loses one member and continues on unit 2 with less bandwidth." },
        { ph: 0, t: "OPNsense 01 loses its LAN trunk: traffic through it is interrupted." },
        { ph: 1, t: "With CARP preemption OPNsense 01 releases every virtual address: OPNsense 02 becomes MASTER." },
        { ph: 1, t: "The cluster keeps all three votes; access devices plugged into unit 1 stay isolated." }
      ] },

    { id: "pve02", key: "F", short: "PVE02", icon: "disk", title: "PVE02 failure", desc: "The storage & backup node stops",
      faults: ["pve02"], recovery: "standby", views: ["full"], focus: ["pve02", "jbod", "nas2"],
      steps: [
        { ph: 0, t: "PVE02 stops: its NAS storage and backup server go offline." },
        { ph: 0, t: "Workloads that keep their data on the NAS (web apps) are degraded." },
        { ph: 1, t: "The secondary NAS still holds a copy of the backups, and its emergency VMs give access to them." },
        { ph: 1, t: "PVE01 and PVE03 keep running; the cluster keeps quorum (2 of 3 votes)." }
      ] },

    { id: "ups", key: "G", short: "UPS", icon: "battery", title: "UPS fault", desc: "The UPS switches to bypass",
      faults: ["ups"], recovery: "auto", views: ["power", "full"], focus: ["ups", "grid", "pdu"],
      steps: [
        { ph: 0, t: "The UPS detects an internal fault." },
        { ph: 1, t: "It switches to bypass: equipment keeps running directly from mains." },
        { ph: 1, t: "Without the UPS, a mains outage would interrupt power until the diesel generator starts." }
      ] }
  ],

  /* Single points of failure and redundancy ("Resilience" layer) */
  resilience: {
    spof: [
      { id: "pdu", t: "Single distribution downstream of the UPS: redundant pairs should not share a power strip." },
      { id: "access", t: "Single-link devices depend on the stack unit they are plugged into." }
    ],
    redundant: [
      { id: "starlink", t: "Two independent WANs, load balanced with automatic failover." },
      { id: "fwa", t: "Two independent WANs, load balanced with automatic failover." },
      { id: "wsw1", t: "One switch per WAN: losing it equals losing that WAN only." },
      { id: "wsw2", t: "One switch per WAN: losing it equals losing that WAN only." },
      { id: "opn01", t: "CARP HA pair with synchronised states." },
      { id: "opn02", t: "CARP HA pair with synchronised states." },
      { id: "b1", t: "Redundant hardware; the stack shares one control plane, so firmware updates and configuration affect both units." },
      { id: "b2", t: "Redundant hardware; the stack shares one control plane, so firmware updates and configuration affect both units." },
      { id: "pve03", t: "Third node: extra capacity, a third quorum vote and the HA failover target for PVE01." },
      { id: "nas2", t: "Second copy of the backups, with emergency VMs to reach them if PVE02 stops." },
      { id: "grid", t: "Mains backed by an emergency diesel generator." },
      { id: "gen", t: "Emergency diesel generator: a mains outage does not drain the UPS." }
    ],
    partial: [
      { id: "pve01", t: "Partial redundancy: the replicated workloads restart automatically on PVE03, the others are restored from backup." },
      { id: "pve02", t: "Primary NAS and backup server; the secondary NAS keeps a copy of the backups and emergency access to them." },
      { id: "jbod", t: "Single enclosure for the primary NAS data; backups are also copied to the secondary NAS." },
      { id: "ups", t: "Single UPS backed by the generator; on an internal fault it switches to bypass and equipment keeps running without protection." }
    ]
  },

  /* About panel: design choices */
  decisions: [
    { h: "Dedicated WAN switches, not interconnected",
      p: "Each WAN has its own switch and each firewall is connected to both. A link between WAN SW 1 and WAN SW 2 would add no path and would merge two failure domains. Losing a WAN switch equals losing only that WAN." },
    { h: "Dual WAN: load balancing plus failover",
      p: "Starlink and FWA are both active in the same OPNsense gateway group: traffic is balanced across them and moves to the surviving link when monitoring detects a failure. This is routing, not LACP (which bundles links to the same device) and not SD-WAN." },
    { h: "WAN terminals in router mode",
      p: "A shared CARP virtual address needs several addresses on the same WAN segment, so the provider terminals offer a private transit network. Publishing is unaffected because services use outbound tunnels." },
    { h: "OPNsense HA, active/passive",
      p: "CARP with preemption, pfsync for states and XMLRPC for configuration over a dedicated link. Both firewalls stay connected to both WANs and to the stack; only the MASTER forwards traffic." },
    { h: "Stacking, LACP and MLAG are different things",
      p: "The two Brocade units form a stack (one logical switch). Each Proxmox node uses an LACP bond with one member on each unit, so both links carry traffic. This is not MLAG, which involves two switches with separate control planes." },
    { h: "Three-node Proxmox cluster",
      p: "PVE03 adds compute capacity and a third quorum vote: the cluster keeps quorum when any single node stops." },
    { h: "Automatic failover of PVE01",
      p: "Critical workloads are replicated to PVE03 and restarted there automatically by Proxmox HA if PVE01 fails; the others are restored from backup or wait. Normal load distribution, failover, restore and migration remain distinct actions." },
    { h: "Backups in more than one place",
      p: "The backup server on PVE02 is copied to a secondary NAS on the network, whose emergency VMs give access to the backups if PVE02 stops, and every month to an off-site NAS." },
    { h: "Power",
      p: "Mains and an emergency diesel generator feed an online double-conversion UPS, which feeds a protected distribution for every device, WAN terminals included. The batteries (about 2–2.5 h) only bridge the generator start-up; the 3 kW generator runs for about 12 hours on a full tank." }
  ]
};
