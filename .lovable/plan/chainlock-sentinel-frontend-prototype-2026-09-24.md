# ChainLock + SENTINEL frontend prototype

## Build
- Establish the navy/saffron command design system, dual light/dark operating environments, typography, compact controls, global shell, and responsive navigation.
- Create shared Zustand mock state for officers, devices, documents, distributions, alerts, relay nodes, cases, and hash-chained ledger records.
- Implement every requested route and interaction: role unlock, controlled document opening/printing/wiping, distribution, comparison, leak tracing, evidence verification/export, ledger tamper/restore, SOC response, relay beacon, and device revocation/re-enrolment.
- Add the floating demo controller and ensure every action mutates the same state across routes with visible feedback.

## Technical details
- Keep TanStack Start’s required router while implementing the requested frontend behavior with React, TypeScript, Tailwind v4, shadcn controls, Zustand, Framer Motion, Recharts, and Lucide icons.
- Store all data in browser memory only; no backend or persistence.
- Give each route unique metadata, preserve audit chain linkage for all mock writes, and validate desktop plus 1280px layouts and central workflows.
