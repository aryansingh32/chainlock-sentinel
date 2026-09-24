import { createFileRoute } from "@tanstack/react-router";
import { DevicesPage } from "@/components/pages/devices";

export const Route = createFileRoute("/_app/devices")({
  head: () => ({
    meta: [
      { title: "Devices & Keys — ChainLock" },
      { name: "description", content: "Device and public-key authority." },
    ],
  }),
  component: DevicesPage,
});
