import { createFileRoute } from "@tanstack/react-router";
import { ViewerPage } from "@/components/pages/viewer";

export const Route = createFileRoute("/_app/view/$docId")({
  head: () => ({
    meta: [
      { title: "Controlled Viewer — ChainLock" },
      { name: "description", content: "Log-before-decrypt document access." },
    ],
  }),
  component: ViewerPage,
});
