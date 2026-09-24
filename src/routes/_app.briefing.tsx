import { createFileRoute } from "@tanstack/react-router";
import { BriefingPage } from "@/components/pages/briefing";

export const Route = createFileRoute("/_app/briefing")({
  head: () => ({
    meta: [
      { title: "Briefing — ChainLock" },
      { name: "description", content: "Architecture, compliance matrix and jury demo script." },
    ],
  }),
  component: BriefingPage,
});
