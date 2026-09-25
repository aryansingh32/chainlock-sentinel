import { createFileRoute } from "@tanstack/react-router";
import { InboxPage } from "@/components/pages/inbox";

export const Route = createFileRoute("/_app/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — ChainLock" },
      { name: "description", content: "Controlled document inbox." },
    ],
  }),
  component: InboxPage,
});
