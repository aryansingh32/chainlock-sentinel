import { createFileRoute } from "@tanstack/react-router";
import { ComparePage } from "@/components/pages/compare";

export const Route = createFileRoute("/_app/compare")({
  head: () => ({
    meta: [
      { title: "Compare Copies — ChainLock" },
      { name: "description", content: "Visually identical, forensically distinct copies." },
    ],
  }),
  component: ComparePage,
});
