import { createFileRoute } from "@tanstack/react-router";
import { DistributionsPage } from "@/components/pages/distributions";

export const Route = createFileRoute("/_app/distributions/")({
  head: () => ({
    meta: [
      { title: "Distributions — ChainLock" },
      { name: "description", content: "Distribution audit from the ledger." },
    ],
  }),
  component: DistributionsPage,
});
