import { createFileRoute } from "@tanstack/react-router";
import { DistributionDetailPage } from "@/components/pages/distributions";

export const Route = createFileRoute("/_app/distributions/$docId")({
  head: () => ({
    meta: [
      { title: "Distribution — ChainLock" },
      { name: "description", content: "Recipient commitments and document timeline." },
    ],
  }),
  component: DistributionDetailPage,
});
