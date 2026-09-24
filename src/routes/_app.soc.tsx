import { createFileRoute } from "@tanstack/react-router";
import { SocPage } from "@/components/pages/soc";

export const Route = createFileRoute("/_app/soc")({
  head: () => ({
    meta: [
      { title: "SOC Dashboard — ChainLock" },
      { name: "description", content: "SENTINEL security operations." },
    ],
  }),
  component: SocPage,
});
