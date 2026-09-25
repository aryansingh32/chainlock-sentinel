import { createFileRoute } from "@tanstack/react-router";
import { EvidencePage } from "@/components/pages/evidence";

export const Route = createFileRoute("/_app/evidence/$caseId")({
  head: () => ({
    meta: [
      { title: "Evidence — ChainLock" },
      { name: "description", content: "Offline-verifiable evidence bundle." },
    ],
  }),
  component: EvidencePage,
});
