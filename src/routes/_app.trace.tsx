import { createFileRoute } from "@tanstack/react-router";
import { TracePage } from "@/components/pages/trace";

export const Route = createFileRoute("/_app/trace")({
  head: () => ({
    meta: [
      { title: "Trace a Leak — ChainLock" },
      { name: "description", content: "Forensic extraction and Tardos accusation." },
    ],
  }),
  component: TracePage,
});
