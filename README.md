# ChainLock Sentinel

Build the COMPLETE ChainLock + SENTINEL frontend prototype from the specification already provided in this conversation. Do not ask questions. Frontend-only, no backend, all mock data in Zustand.

This must be a serious military/security command interface, NOT a generic SaaS dashboard and NOT an AI-looking UI. Priorities: fast operator response, secure control, auditability, dense but readable information, high contrast, minimal decoration, hard granular controls.

STACK: React 18, Vite, TypeScript, Tailwind, shadcn/ui, react-router-dom, zustand, framer-motion, recharts, lucide-react. Inter for UI; JetBrains Mono for technical values.

DESIGN: Navy #1F4E79, Saffron #E8792B ONLY for primary actions. Green #1E8C3A, Amber #D4A017, Red #C0392B ONLY semantic status. Light #F7F9FB/#FFFFFF for Officer, Sender, Investigator, Ledger. Dark #0E1621/#152131 ONLY for SENTINEL SOC/Relay/Devices. 10px radius, restrained shadows, 8px spacing grid, projector-readable at 1920x1080, responsive to 1280px. No neon cyberpunk, no gradients, no decorative AI effects, no excessive rounded cards.

APP SHELL: collapsible left sidebar grouped OFFICER (Inbox, Document Viewer), HQ SENDER (New Distribution, Distributions), INVESTIGATION (Trace a Leak, Compare Copies, Evidence), LEDGER (Ledger Explorer), SENTINEL (SOC Dashboard, Relay Mesh, Devices & Keys). Top bar with ChainLock shield-lock logo, role badge, Air-gapped · Offline status, Ledger 3/3 offices online, user avatar with Switch role. Footer: PQC: ML-KEM-768 · ML-DSA-65 · SLH-DSA | Build v0.9 prototype.

ROUTES AND BEHAVIORS:
1 / role select + device unlock: 4 role cards, 6-digit PIN pad, simulated fingerprint scan, private-key/no-shared-password note.
2 /inbox: document table, classification, sender, received, status, Open; memory-only banner.
3 /view/:docId: IMPORTANT DEMO PAGE. On Open run ~0.8s/step: signing request with mock ML-DSA signature typing; recording ledger with Security/Audit/Command; keys released after 2/3 and 320 A/B squares filling; document appears. Persistent red caption 'No ledger record → no keys → no document.' Session panel, fingerprint explanation, Print and Close. Print creates PRINT ledger block and toast. Close wipes memory. Ledger-offline path fails step 2 and locks document. Revoked path fails key release.
4 /distribute/new: 3-step upload, recipient selection, optional Layer 4 warning, animated review showing 320 pieces/640 locked pieces/5 fingerprints/ledger commitment/package size, distribute success with REGISTER block.
5 /distributions and detail: opened counts, recipients, package stats, fingerprint commitments and document timeline.
6 /compare: two officers, visually identical pages, hidden differences toggle, A/B labels, 320-square strips, caption 'Identical to people. Unique to the computer.'
7 /trace: leak drop zone + 3 sample inputs. Animated normalisation/layers/pattern recovery. Print sample shows microdots and two independent attributions. Recharts accusation scores with threshold; single sample identifies OFF-004, merged sample OFF-002 + OFF-005. Evidence cards with ledger/signature/inclusion/witness validation and bundle button. Honest low-confidence note.
8 /evidence/:caseId: case header, verification checklist, JSON bundle export, offline terminal verifier with sequential [OK] lines.
9 /ledger: chained block explorer, filters, JSON drawer, tamper demo that breaks block 5 and all subsequent hashes, restore, checkpoint panel.
10 /soc: DARK. KPI tiles, live alert feed, critical canary alert details, Freeze access / Export evidence / Escalate; Freeze revokes officer and creates REVOKE block; detection layers; auto-appending mock event log; one-way data diode label.
11 /mesh: DARK. SVG floor/ship-deck map with workstation, relay nodes, gateway, diode, SOC; Send test beacon animates hop path and produces SOC event; node list and radio policy chips.
12 /devices: DARK. officers/devices/public keys/status/heartbeat; revoke confirmation -> REVOKE block; re-enrol. Private-key note.

SEED EXACTLY: officers OFF-001 Mehta WS-NAVAL-11, OFF-002 Iyer WS-NAVAL-12, OFF-003 Khan WS-NAVAL-13, OFF-004 Rao WS-NAVAL-14, OFF-005 Das WS-NAVAL-15. Documents DOC-007 Operation Order 7 — Sector Seven (SECRET, 10 pages, 320 pieces, 640 locked versions, all 5), DOC-008 Fleet Readiness Report Q3 (CONFIDENTIAL, 001/002/003), DOC-009 Comms Schedule — Western Fleet (SECRET, 002/004/005). Seed ~15 ledger records including REGISTER DOC-007 08:00, DECRYPT OFF-004 09:14:02, PRINT OFF-004 09:41, DECRYPT OFF-002 10:05, DECRYPT OFF-005 11:30. Seed SENTINEL alerts: critical canary DOC-007 -> OFF-004 at 14:32:07, high image match page 3 similarity 94%, medium heartbeat missing WS-NAVAL-13. Relay nodes GW-BRIDGE, RN-DECK2, RN-DECK3, RN-CORRIDOR-A.

DEMO CONTROL PANEL: floating bottom-right / D shortcut. Reset mock data; Ledger offline; canary OFF-004; image-match; kill heartbeat WS-NAVAL-14; mesh beacon; tamper ledger; revoke OFF-004. Every action mutates shared Zustand state across all routes.

GLOBAL: every button visibly works; toasts for actions; loading/empty/error states; every ledger-writing action appends a hash-chained block; fake crypto strings only. Make the live demo polished and coherent. Build actual navigable pages/components, not placeholders.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2f54811d-44ad-4e71-b5ee-d215cb07504d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
