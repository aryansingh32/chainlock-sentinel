import { createFileRoute } from "@tanstack/react-router";
import { LedgerPage } from "@/components/pages/ledger";

export const Route = createFileRoute("/_app/ledger")({
  head: () => ({
    meta: [
      { title: "Ledger Explorer — ChainLock" },
      { name: "description", content: "Hash-chained, witness-co-signed audit ledger." },
    ],
  }),
  component: LedgerPage,
});
