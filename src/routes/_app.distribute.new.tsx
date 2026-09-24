import { createFileRoute } from "@tanstack/react-router";
import { DistributePage } from "@/components/pages/distribute";

export const Route = createFileRoute("/_app/distribute/new")({
  head: () => ({
    meta: [
      { title: "New Distribution — ChainLock" },
      { name: "description", content: "Build and register recipient-fingerprinted packages." },
    ],
  }),
  component: DistributePage,
});
