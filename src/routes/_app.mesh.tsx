import { createFileRoute } from "@tanstack/react-router";
import { MeshPage } from "@/components/pages/mesh";

export const Route = createFileRoute("/_app/mesh")({
  head: () => ({
    meta: [
      { title: "Relay Mesh — ChainLock" },
      { name: "description", content: "SENTINEL-MESH relay topology." },
    ],
  }),
  component: MeshPage,
});
